/**
 * dsh-plugin-offline-sync host entry.
 *
 * Mounts HTTP routes under /dsh-plugin-offline-sync/*. The client half talks to the
 * host over fetch() (same-origin). The host can also be invoked by the
 * standalone installer via a JSON file the installer writes, but the primary
 * flow is: UI → host.route → produce a ZIP with plugins + installer.
 *
 * The installer script that ships inside each ZIP uses only Node built-ins
 * and does NOT depend on the DSH runtime, so it works on machines that have
 * never installed dsh-plugin-offline-sync.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync, copyFileSync, createReadStream } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const name = 'dsh-plugin-offline-sync';

const STATE_FILE = 'pack-state.json';

/**
 * Resolve the profile directory. The market does this by reading
 * `ctx.get('profileContext')`, argv --profile, or defaulting to 'web'.
 * We follow the same order but prefer the configured profile (cordis.yml).
 */
function resolveProfile(ctx, config) {
  const profileContext = ctx.get('profileContext');
  const fromContext = profileContext
    && typeof profileContext.name === 'string'
    && typeof profileContext.dir === 'string'
    ? { name: profileContext.name, dir: profileContext.dir }
    : undefined;
  if (config?.profile && fromContext && fromContext.name.toLowerCase() === String(config.profile).toLowerCase()) {
    return fromContext;
  }
  if (config?.profile) {
    // Use the configured name; fall back to default layout if dir unknown.
    const home = process.env.DSH_HOME || process.env.USERPROFILE || process.env.HOME;
    const defaultDir = join(home, '.dsh', 'profiles', String(config.profile));
    if (existsSync(defaultDir)) return { name: String(config.profile), dir: defaultDir };
    return { name: String(config.profile), dir: defaultDir };
  }
  if (fromContext) return fromContext;
  const argv = process.argv;
  const flag = argv.indexOf('--profile');
  const argvName = flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')
    ? argv[flag + 1]
    : undefined;
  const home = process.env.DSH_HOME || process.env.USERPROFILE || process.env.HOME;
  const name = argvName || 'web';
  return { name, dir: join(home, '.dsh', 'profiles', name) };
}

/**
 * Resolve the bundle-patch file path for a plugin. DSH allows several names
 * (cordis.patch.yml, dsh.patch.yml, dsh.bundle.patch.yml) and the field
 * manifest.dsh.bundle.patch can point at any of them.
 */
function resolvePatchFile(dir, manifest) {
  const candidates = [];
  if (manifest?.dsh?.bundle?.patch) candidates.push(manifest.dsh.bundle.patch);
  candidates.push('cordis.patch.yml', 'dsh.patch.yml', 'dsh.bundle.patch.yml');
  for (const c of candidates) {
    const p = join(dir, c);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Enumerate installed DSH plugins in the given profile directory.
 * A "plugin" here means any package that:
 *   - is a top-level dependency in <profile>/package.json, AND
 *   - has a dsh.bundle.patch or dsh.client field in its package.json, OR
 *   - ships a cordis.patch.yml.
 * That keeps pure libraries out of the list.
 */
function listInstalledPlugins(profileDir) {
  const pkgPath = join(profileDir, 'package.json');
  if (!existsSync(pkgPath)) return [];
  let profilePkg;
  try { profilePkg = JSON.parse(readFileSync(pkgPath, 'utf8')); }
  catch { return []; }
  const deps = profilePkg.dependencies || {};
  const nm = join(profileDir, 'node_modules');
  const result = [];
  for (const name of Object.keys(deps)) {
    const dir = join(nm, name);
    const pj = join(dir, 'package.json');
    if (!existsSync(pj)) continue;
    let manifest;
    try { manifest = JSON.parse(readFileSync(pj, 'utf8')); }
    catch { continue; }
    const isDsh = manifest.dsh
      || resolvePatchFile(dir, manifest)
      || /^dsh(-|market)/i.test(name);
    if (!isDsh) continue;
    result.push({
      name,
      version: manifest.version || '0.0.0',
      description: manifest.description || '',
      dir,
      hasClient: !!(manifest.dsh?.client || existsSync(join(dir, 'client.js'))),
      hasBundle: !!(manifest.dsh?.bundle || resolvePatchFile(dir, manifest)),
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Compute a stable fingerprint for a plugin directory: hash of every file's
 * (relative path, size, mtimeMs). Cheap to compute and good enough to detect
 * "did this plugin change since last pack". We avoid content hashing because
 * plugin trees can be large and the user-facing question is "changed or not",
 * not bit-exact reproduction.
 */
function fingerprintDir(root) {
  const hash = createHash('sha256');
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const full = join(dir, ent.name);
      const rel = full.slice(root.length + 1).replace(/\\/g, '/');
      // Skip the packer's own state and node_modules of deps (DSH provides peers).
      if (ent.name === STATE_FILE) continue;
      if (ent.name === 'node_modules') continue;
      if (ent.isDirectory()) {
        hash.update('D:' + rel + '\0');
        walk(full);
      } else if (ent.isFile()) {
        let st;
        try { st = statSync(full); }
        catch { continue; }
        hash.update('F:' + rel + ':' + st.size + ':' + Math.floor(st.mtimeMs) + '\0');
      }
    }
  };
  walk(root);
  return hash.digest('hex');
}

/**
 * Load the previous pack state (one record per plugin name → fingerprint +
 * version + packedAt). Lives next to the output directory so the user can
 * move the output dir around without losing state.
 */
function loadPackState(statePath) {
  if (!existsSync(statePath)) return {};
  try { return JSON.parse(readFileSync(statePath, 'utf8')); }
  catch { return {}; }
}

function savePackState(statePath, state) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Recursively copy a directory, skipping node_modules and the packer state.
 */
function copyPluginDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  const walk = (s, d) => {
    const entries = readdirSync(s, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === STATE_FILE) continue;
      const sf = join(s, ent.name);
      const df = join(d, ent.name);
      if (ent.isDirectory()) {
        mkdirSync(df, { recursive: true });
        walk(sf, df);
      } else if (ent.isFile()) {
        copyFileSync(sf, df);
      }
    }
  };
  walk(src, dest);
}

/**
 * Run a command synchronously, returning {ok, stdout, stderr, exitCode}.
 */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return {
    ok: r.status === 0,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    exitCode: r.status,
  };
}

/**
 * Build the ZIP. We shell out to the system `powershell` Compress-Archive,
 * which is guaranteed on Windows and avoids shipping a JS zip library.
 * On non-Windows we try the `zip` binary.
 */
function zipDirectory(srcDir, outZip) {
  if (process.platform === 'win32') {
    // Compress-Archive -Path <src>\* -DestinationPath <out> -Force
    const r = run('powershell', [
      '-NoProfile', '-Command',
      `Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${outZip}' -Force`,
    ]);
    return r;
  }
  const r = run('zip', ['-r', outZip, '.'], { cwd: srcDir });
  return r;
}

/**
 * The installer template (Node, zero deps). Injected into each produced ZIP
 * as install.cjs. It reads manifest.json, asks the user per-plugin whether
 * to update/skip, then copies files and rewrites the target profile's
 * package.json + cordis.patch.yml.
 *
 * Uses CommonJS (.cjs) so it runs under any Node >= 18 without the calling
 * shell having to set --experimental anything.
 */
const INSTALLER_TEMPLATE = String.raw`#!/usr/bin/env node
'use strict';
/**
 * dsh-plugin-offline-sync standalone installer.
 *
 * Usage:
 *   node install.cjs [--profile <name>] [--yes] [--list]
 *
 * Defaults to the 'desktop' profile (configurable; user said it's fixed).
 * Works even when dsh-plugin-offline-sync is NOT installed on the target machine —
 * it only needs Node.js and the target DSH profile to exist.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

const PROFILE = getArg('--profile') || 'desktop';
const AUTO_YES = hasFlag('--yes');
const LIST_ONLY = hasFlag('--list');

function homeDir() {
  return process.env.DSH_HOME
    || process.env.USERPROFILE
    || process.env.HOME
    || require('os').homedir();
}

function profileDir(profileName) {
  // Allow override via DSH_PROFILE_DIR for non-default layouts.
  if (process.env.DSH_PROFILE_DIR) return process.env.DSH_PROFILE_DIR;
  return path.join(homeDir(), '.dsh', 'profiles', profileName);
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyRecursive(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

function targetVersion(profile, name) {
  const nm = path.join(profile, 'node_modules', name, 'package.json');
  const m = readJson(nm);
  return m && m.version ? m.version : null;
}

function targetHasPlugin(profile, name) {
  const pj = path.join(profile, 'package.json');
  const m = readJson(pj);
  return !!(m && m.dependencies && m.dependencies[name]);
}

// Compare two semver-ish versions. Returns -1, 0, 1, or null if unparseable.
function cmpVersion(a, b) {
  if (!a || !b) return null;
  const pa = String(a).split(/[.-]/).map(x => parseInt(x, 10));
  const pb = String(b).split(/[.-]/).map(x => parseInt(x, 10));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (isNaN(x) || isNaN(y)) return null;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function ask(question, choices) {
  if (AUTO_YES) return choices[0];
  process.stdout.write(question);
  const buf = Buffer.alloc(1024);
  const r = fs.readSync(0, buf, 0, 1024, null);
  return buf.toString('utf8', 0, r).trim().toLowerCase();
}

function main() {
  const here = __dirname;
  const manifest = readJson(path.join(here, 'manifest.json'));
  if (!manifest) {
    console.error('[dsh-plugin-offline-sync] manifest.json not found next to install.cjs');
    process.exit(1);
  }

  const profile = profileDir(PROFILE);
  if (!fs.existsSync(path.join(profile, 'package.json'))) {
    console.error('[dsh-plugin-offline-sync] target profile not found: ' + profile);
    console.error('  Pass --profile <name> or set DSH_PROFILE_DIR.');
    process.exit(1);
  }

  const plugins = manifest.plugins || [];
  console.log('[dsh-plugin-offline-sync] profile: ' + profile);
  console.log('[dsh-plugin-offline-sync] packaged at: ' + (manifest.packedAt || '?'));
  console.log('[dsh-plugin-offline-sync] ' + plugins.length + ' plugin(s) in this pack');
  console.log('');

  if (LIST_ONLY) {
    for (const p of plugins) {
      const tv = targetVersion(profile, p.name);
      const status = tv ? 'installed ' + tv : 'not installed';
      console.log('  ' + p.name + '  pack=' + p.version + '  target=' + status);
    }
    return;
  }

  // Decide per-plugin.
  const decisions = [];
  for (const p of plugins) {
    const tv = targetVersion(profile, p.name);
    const hasIt = targetHasPlugin(profile, p.name);
    let cmp = null;
    if (tv) cmp = cmpVersion(p.version, tv);
    console.log('--- ' + p.name + ' ---');
    console.log('  packed version:   ' + p.version);
    console.log('  installed:        ' + (tv ? tv : '(not installed)'));
    if (cmp === -1) console.log('  → packed is OLDER than installed');
    else if (cmp === 1) console.log('  → packed is NEWER than installed');
    else if (cmp === 0) console.log('  → same version');
    else if (!hasIt) console.log('  → will be freshly installed');

    let choice;
    if (AUTO_YES) choice = 'y';
    else {
      choice = ask('  Install/overwrite? [y/N/s(ame-only/q)] ', ['y']);
    }
    if (choice === 'q') { decisions.push({ name: p.name, action: 'skip' }); break; }
    if (choice === 'y' || choice === 'yes') {
      decisions.push({ name: p.name, action: 'install' });
    } else if (choice === 's' && cmp === 0) {
      decisions.push({ name: p.name, action: 'install' });
    } else {
      decisions.push({ name: p.name, action: 'skip' });
    }
  }

  const toInstall = decisions.filter(d => d.action === 'install').map(d => d.name);
  if (toInstall.length === 0) {
    console.log('\\n[dsh-plugin-offline-sync] nothing to install.');
    return;
  }

  console.log('\\n[dsh-plugin-offline-sync] installing: ' + toInstall.join(', '));

  const profilePkgPath = path.join(profile, 'package.json');
  const profilePkg = readJson(profilePkgPath) || { name: 'profile', dependencies: {} };
  if (!profilePkg.dependencies) profilePkg.dependencies = {};
  if (!profilePkg.dsh) profilePkg.dsh = {};
  if (!profilePkg.dsh.profile) profilePkg.dsh.profile = {};
  if (!Array.isArray(profilePkg.dsh.profile.bundles)) profilePkg.dsh.profile.bundles = [];

  const nmDir = path.join(profile, 'node_modules');
  fs.mkdirSync(nmDir, { recursive: true });

  for (const name of toInstall) {
    const src = path.join(here, 'plugins', name);
    const dest = path.join(nmDir, name);
    if (!fs.existsSync(src)) {
      console.error('  [skip] ' + name + ': not found in pack');
      continue;
    }
    if (fs.existsSync(dest)) {
      try { fs.rmSync(dest, { recursive: true, force: true }); }
      catch (e) {
        console.error('  [skip] ' + name + ': cannot remove old copy: ' + e.message);
        continue;
      }
    }
    copyRecursive(src, dest);
    const newPkg = readJson(path.join(dest, 'package.json'));
    const spec = newPkg && newPkg.version ? newPkg.version : 'file:./node_modules/' + name;
    // Record with a version-range-ish spec. DSH loads from disk regardless.
    profilePkg.dependencies[name] = '^' + (newPkg.version || '0.0.0');
    if (!profilePkg.dsh.profile.bundles.includes(name)) {
      profilePkg.dsh.profile.bundles.push(name);
    }
    console.log('  [ok] ' + name + '@' + (newPkg.version || '?'));
  }

  // Merge cordis.patch.yml entries from the pack into the target patch file.
  // The pack ships a single combined patch at patch/cordis.patch.yml.
  const srcPatch = path.join(here, 'patch', 'cordis.patch.yml');
  const destPatch = path.join(profile, 'cordis.patch.yml');
  if (fs.existsSync(srcPatch)) {
    let existing = '';
    if (fs.existsSync(destPatch)) existing = fs.readFileSync(destPatch, 'utf8');
    const incoming = fs.readFileSync(srcPatch, 'utf8');
    // Naive merge: append incoming blocks whose top-level id is not already present.
    const existingIds = new Set();
    for (const m of existing.matchAll(/^\s*-\s*id:\s*['"]?([^\s'"]+)/gm)) existingIds.add(m[1]);
    const incomingBlocks = [];
    let cur = [];
    for (const line of incoming.split(/\r?\n/)) {
      if (/^-\s+(?:id|insert):/.test(line) && cur.length) {
        incomingBlocks.push(cur.join('\n'));
        cur = [];
      }
      cur.push(line);
    }
    if (cur.length) incomingBlocks.push(cur.join('\n'));
    const toAdd = incomingBlocks.filter(b => {
      // Extract the first id anywhere in the block (works for both
      // "- id: foo" and "- insert:\n    - id: foo" forms).
      const m = b.match(/-\s*id:\s*['"]?([^\s'"]+)/);
      return m && !existingIds.has(m[1]);
    });
    if (toAdd.length) {
      const merged = (existing.endsWith('\n') ? existing : existing + '\n') + toAdd.join('\n') + '\n';
      fs.writeFileSync(destPatch, merged);
      console.log('  [ok] merged ' + toAdd.length + ' patch block(s) into cordis.patch.yml');
    }
  }

  writeJson(profilePkgPath, profilePkg);
  console.log('\\n[dsh-plugin-offline-sync] done. Restart DSH (or reload the profile) to activate the plugins.');
}

main();
`;

const README_TEMPLATE = `# dsh-plugin-offline-sync pack

Packed by dsh-plugin-offline-sync. Contains:

- manifest.json — list of plugins, versions, and pack timestamp
- plugins/<name>/ — each plugin's files
- patch/cordis.patch.yml — combined loader patch for all packed plugins
- install.cjs — standalone installer (Node.js, no DSH dependency)

## Install

On the target machine, unzip this archive, open a terminal in the folder, and run:

\`\`\`
node install.cjs
\`\`\`

The installer will:
1. Locate your DSH profile (default: \`desktop\`; override with \`--profile <name>\` or \`DSH_PROFILE_DIR\`).
2. For each plugin, show the packed version vs. the version already installed on this machine.
3. Ask you, per plugin, whether to install/overwrite it.
4. Copy the plugin files, update \`package.json\`, and merge loader patch entries.

Then restart DeepSeek Harness (or reload the profile) for the plugins to activate.

### Non-interactive

\`\`\`
node install.cjs --yes       # install everything
node install.cjs --list      # just show what's in the pack vs. installed
\`\`\`
`;

/**
 * Combine the cordis.patch.yml of every selected plugin into one file
 * (with each plugin's rows prefixed so ids don't collide — they shouldn't,
 * but being safe). Actually, keep them as-is; ids are per-plugin anyway.
 */
function buildCombinedPatch(plugins, destPatchDir) {
  const blocks = [];
  for (const p of plugins) {
    const patchPath = resolvePatchFile(p.dir, p.manifest);
    if (patchPath) {
      blocks.push('# --- ' + p.name + ' ---');
      blocks.push(readFileSync(patchPath, 'utf8').replace(/\s+$/, ''));
    }
  }
  mkdirSync(destPatchDir, { recursive: true });
  writeFileSync(join(destPatchDir, 'cordis.patch.yml'), blocks.join('\n\n') + '\n');
}

export function apply(ctx, config) {
  ctx.inject(['webServer', 'clientModules'], (hostCtx) => {
    const webServer = hostCtx.webServer;
    const clientModules = hostCtx.clientModules;
    const logger = ctx.logger || console;
    const routes = [];

    const disposeRoutes = () => { for (const d of routes) d(); };

    // Resolve output dir. Default: <profileDir>/dsh-plugin-offline-sync-output.
    // User can override via config.outputDir (cordis.yml) — but we also
    // let the UI pass an outputDir per request.
    const defaultOutputDir = () => {
      const prof = resolveProfile(ctx, config);
      if (config?.outputDir) return config.outputDir;
      return join(prof.dir, 'dsh-plugin-offline-sync-output');
    };

    const json = (res, code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    const readBody = async (req) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      try { return JSON.parse(raw); } catch { return {}; }
    };

    // GET /dsh-plugin-offline-sync/plugins — list installed plugins with change info.
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-offline-sync/plugins',
      handler: async (req, res) => {
        try {
          const prof = resolveProfile(ctx, config);
          const plugins = listInstalledPlugins(prof.dir);
          const outputDir = defaultOutputDir();
          const statePath = join(outputDir, STATE_FILE);
          const state = loadPackState(statePath);
          const enriched = plugins.map(p => {
            const prev = state[p.name];
            const fp = fingerprintDir(p.dir);
            const changed = !prev || prev.fingerprint !== fp || prev.version !== p.version;
            return {
              name: p.name,
              version: p.version,
              description: p.description,
              hasClient: p.hasClient,
              hasBundle: p.hasBundle,
              changed,
              lastPackedAt: prev?.packedAt || null,
              lastPackedVersion: prev?.version || null,
            };
          });
          json(res, 200, { profile: prof, outputDir, plugins: enriched });
        } catch (e) {
          json(res, 500, { error: String(e && e.message || e) });
        }
      },
    }));

    // GET /dsh-plugin-offline-sync/output-dir — current output directory.
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-offline-sync/output-dir',
      handler: async (req, res) => {
        json(res, 200, { outputDir: defaultOutputDir() });
      },
    }));

    // POST /dsh-plugin-offline-sync/pack — build the ZIP.
    // body: { names: string[], outputDir?: string }
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-offline-sync/pack',
      handler: async (req, res) => {
        try {
          const body = await readBody(req);
          const names = Array.isArray(body.names) ? body.names : [];
          if (names.length === 0) {
            json(res, 400, { error: 'no plugins selected' });
            return;
          }
          const prof = resolveProfile(ctx, config);
          const outputDir = body.outputDir || defaultOutputDir();
          mkdirSync(outputDir, { recursive: true });

          const all = listInstalledPlugins(prof.dir);
          const selected = all.filter(p => names.includes(p.name));
          if (selected.length === 0) {
            json(res, 400, { error: 'none of the selected plugins are installed' });
            return;
          }
          // Attach manifest so buildCombinedPatch can resolve the patch file.
          for (const p of selected) {
            try { p.manifest = JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')); }
            catch { p.manifest = {}; }
          }

          const statePath = join(outputDir, STATE_FILE);
          const state = loadPackState(statePath);

          // Build staging dir.
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const stage = join(outputDir, '.stage-' + stamp);
          if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
          mkdirSync(stage, { recursive: true });

          const manifestPlugins = [];
          for (const p of selected) {
            copyPluginDir(p.dir, join(stage, 'plugins', p.name));
            manifestPlugins.push({ name: p.name, version: p.version });
          }
          buildCombinedPatch(selected, join(stage, 'patch'));

          const manifest = {
            tool: 'dsh-plugin-offline-sync',
            toolVersion: '0.2.0',
            profile: prof.name,
            packedAt: new Date().toISOString(),
            plugins: manifestPlugins,
          };
          writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
          writeFileSync(join(stage, 'install.cjs'), INSTALLER_TEMPLATE);
          writeFileSync(join(stage, 'README.txt'), README_TEMPLATE);

          const zipName = 'dsh-plugins-' + stamp + '.zip';
          const zipPath = join(outputDir, zipName);
          if (existsSync(zipPath)) rmSync(zipPath, { force: true });

          const zr = zipDirectory(stage, zipPath);
          // Clean up stage regardless.
          try { rmSync(stage, { recursive: true, force: true }); } catch {}

          if (!zr.ok) {
            json(res, 500, { error: 'zip failed', stderr: zr.stderr, stdout: zr.stdout });
            return;
          }

          // Update pack state.
          for (const p of selected) {
            state[p.name] = {
              version: p.version,
              fingerprint: fingerprintDir(p.dir),
              packedAt: manifest.packedAt,
            };
          }
          savePackState(statePath, state);

          json(res, 200, {
            ok: true,
            zipPath,
            zipName,
            packedAt: manifest.packedAt,
            plugins: manifestPlugins,
          });
        } catch (e) {
          json(res, 500, { error: String(e && e.stack || e) });
        }
      },
    }));

    // GET /dsh-plugin-offline-sync/debug-client-graph — debug: dump clientModules graph.
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-offline-sync/debug-client-graph',
      handler: async (req, res) => {
        try {
          const cm = clientModules;
          if (!cm) { json(res, 200, { error: 'no clientModules service' }); return; }
          const graph = cm.graph();
          json(res, 200, { graph });
        } catch (e) {
          json(res, 500, { error: String(e && e.stack || e) });
        }
      },
    }));

    // GET /dsh-plugin-offline-sync/open-output — open the output dir in the OS file explorer.
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-offline-sync/open-output',
      handler: async (req, res) => {
        try {
          const outputDir = defaultOutputDir();
          mkdirSync(outputDir, { recursive: true });
          if (process.platform === 'win32') run('explorer', [outputDir]);
          else if (process.platform === 'darwin') run('open', [outputDir]);
          else run('xdg-open', [outputDir]);
          json(res, 200, { outputDir });
        } catch (e) {
          json(res, 500, { error: String(e && e.message || e) });
        }
      },
    }));

    hostCtx.effect(() => {
      return () => disposeRoutes();
    }, 'dsh-plugin-offline-sync: routes');
  });
}
