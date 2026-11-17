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

const EXCLUDED_FILE = 'excluded.json';

/**
 * Load the list of plugin names the user has excluded from the list.
 * Stored next to the pack state so moving the output dir keeps it.
 */
function loadExcluded(outputDir) {
  const p = join(outputDir, EXCLUDED_FILE);
  if (!existsSync(p)) return [];
  try {
    const v = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch { return []; }
}

function saveExcluded(outputDir, list) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, EXCLUDED_FILE), JSON.stringify(list, null, 2));
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
 * Recursively copy a directory WITHOUT skipping node_modules. Used for the
 * billion-context runtime payload (which MUST include its node_modules).
 */
function copyRecursive(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const ent of readdirSync(src, { withFileTypes: true })) {
    if (ent.name === STATE_FILE) continue;
    const sf = join(src, ent.name);
    const df = join(dest, ent.name);
    if (ent.isDirectory()) copyRecursive(sf, df);
    else if (ent.isFile()) copyFileSync(sf, df);
  }
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
 *   node install.cjs [--profile <name>] [--yes] [--confirm] [--list] [--skip-bili]
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
const CONFIRM_EACH = hasFlag('--confirm');
const LIST_ONLY = hasFlag('--list');
const SKIP_BILI = hasFlag('--skip-bili');

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
  // Read one byte at a time until newline/EOF so each answer is consumed
  // independently of how the input is buffered (pipe vs interactive TTY).
  let line = '';
  const buf = Buffer.alloc(1);
  while (true) {
    let r;
    try { r = fs.readSync(0, buf, 0, 1, null); } catch { r = 0; }
    if (r === 0) break;
    const ch = buf.toString('utf8', 0, r);
    if (ch === '\n') break;
    if (ch === '\r') continue;
    line += ch;
  }
  return line.trim().toLowerCase();
}

function main() {
  const here = __dirname;
  const manifest = readJson(path.join(here, 'manifest.json'));
  if (!manifest) {
    console.error('[dsh-plugin-offline-sync] 未找到与 install.cjs 同级的 manifest.json');
    process.exit(1);
  }

  const profile = profileDir(PROFILE);
  if (!fs.existsSync(path.join(profile, 'package.json'))) {
    console.error('[dsh-plugin-offline-sync] 目标 profile 不存在: ' + profile);
    console.error('  请使用 --profile <名称> 指定，或设置 DSH_PROFILE_DIR。');
    process.exit(1);
  }

  const plugins = manifest.plugins || [];
  console.log('[dsh-plugin-offline-sync] profile 目录: ' + profile);
  console.log('[dsh-plugin-offline-sync] 打包时间: ' + (manifest.packedAt || '?'));
  console.log('[dsh-plugin-offline-sync] 本包包含 ' + plugins.length + ' 个插件');
  console.log('');

  if (LIST_ONLY) {
    for (const p of plugins) {
      const tv = targetVersion(profile, p.name);
      const status = tv ? '已安装 ' + tv : '未安装';
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
    console.log('  打包版本:   ' + p.version);
    console.log('  已安装版本: ' + (tv ? tv : '(未安装)'));
    if (cmp === -1) console.log('  → 打包版本比已安装版本旧');
    else if (cmp === 1) console.log('  → 打包版本比已安装版本新');
    else if (cmp === 0) console.log('  → 版本相同');
    else if (!hasIt) console.log('  → 将全新安装');

    let choice;
    if (AUTO_YES) {
      choice = 'y';
    } else if (CONFIRM_EACH) {
      // User explicitly asked to confirm every plugin.
      choice = ask('  安装/覆盖？[y/N/q]  y=安装  N=跳过(默认)  q=退出剩余  ', ['y']);
    } else {
      // Default: install when the packed version is newer, or when the
      // plugin isn't installed yet. Skip same/older versions silently.
      if (!hasIt || cmp === 1) {
        choice = 'y';
        console.log('  → 自动安装（版本更新或新增）');
      } else {
        choice = 'n';
        console.log('  → 跳过（版本相同或更旧；使用 --confirm 可逐个确认）');
      }
    }
    if (choice === 'q') { decisions.push({ name: p.name, action: 'skip' }); break; }
    if (choice === 'y' || choice === 'yes') {
      decisions.push({ name: p.name, action: 'install' });
    } else {
      decisions.push({ name: p.name, action: 'skip' });
    }
  }

  const toInstall = decisions.filter(d => d.action === 'install').map(d => d.name);
  if (toInstall.length === 0) {
    console.log('\\n[dsh-plugin-offline-sync] 没有需要安装的插件。');
    return;
  }

  console.log('\\n[dsh-plugin-offline-sync] 正在安装: ' + toInstall.join(', '));

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
      console.error('  [跳过] ' + name + ': 包中未找到该插件');
      continue;
    }
    if (fs.existsSync(dest)) {
      try { fs.rmSync(dest, { recursive: true, force: true }); }
      catch (e) {
        console.error('  [跳过] ' + name + ': 无法删除旧版本: ' + e.message);
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
    console.log('  [完成] ' + name + '@' + (newPkg.version || '?'));
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
      console.log('  [完成] 已合并 ' + toAdd.length + ' 个补丁块到 cordis.patch.yml');
    }
  }

  writeJson(profilePkgPath, profilePkg);

  // --- billion-context locally-runnable program sync update ---
  if (!SKIP_BILI && toInstall.includes('billion-context')) {
    const biliDir = path.join(here, 'runtime', 'billion-context');
    const biliPayload = path.join(biliDir, 'payload', 'node_modules', 'billion-context', 'dist', 'index.js');
    const biliUpdate = path.join(biliDir, 'update.ps1');
    if (fs.existsSync(biliPayload) && fs.existsSync(biliUpdate)) {
      const biliRuntime = readJson(path.join(biliDir, 'runtime.json')) || {};
      console.log('');
      console.log('[billion-context] 正在更新本地可运行程序到 ' + (biliRuntime.version || '?') +
        (biliRuntime.commit ? ' (' + biliRuntime.commit + ')' : ''));
      if (process.platform === 'win32') {
        const { spawnSync } = require('child_process');
        const r = spawnSync('powershell', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', biliUpdate,
          '-PayloadDir', path.join(biliDir, 'payload'),
          '-SkipPrompt', '-NoSmokeTest',
        ], { stdio: 'inherit' });
        if (r.status !== 0) {
          console.error('[billion-context] update.ps1 退出码 ' + r.status +
            '. The plugin itself was installed; you can retry manually:');
          console.error('  powershell -File "' + biliUpdate + '" -PayloadDir "' +
            path.join(biliDir, 'payload') + '"');
        }
      } else {
        console.log('[billion-context] 运行时更新仅支持 Windows（update.ps1），当前平台跳过。');
      }
    } else {
      console.log('[billion-context] 包中未找到运行时 payload，跳过本地可运行程序更新。');
    }
  }

  console.log('\\n[dsh-plugin-offline-sync] 完成。请重启 DSH（或重新加载 profile）使插件生效。');
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
3. By default, automatically install plugins that are newer than the installed version (or not yet installed), and skip same/older versions. Pass \`--confirm\` to be asked about every plugin.
4. Copy the plugin files, update \`package.json\`, and merge loader patch entries.

Then restart DeepSeek Harness (or reload the profile) for the plugins to activate.

### Options

\`\`\`
node install.cjs             # default: auto-install newer/new plugins, skip same/older
node install.cjs --confirm   # ask [y/N] for every plugin
node install.cjs --yes       # install everything without asking
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
          const excluded = loadExcluded(outputDir);
          const excludedSet = new Set(excluded);
          const enriched = plugins
            .filter(p => !excludedSet.has(p.name))
            .map(p => {
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
          const excludedPlugins = plugins
            .filter(p => excludedSet.has(p.name))
            .map(p => ({ name: p.name, version: p.version, description: p.description }));
          json(res, 200, { profile: prof, outputDir, plugins: enriched, excluded: excludedPlugins });
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

          // --- billion-context locally-runnable program: stage runtime payload ---
          const biliSelected = selected.find(p => p.name === 'billion-context');
          if (biliSelected) {
            const biliRuntimeDir = join(__dirname, 'runtime', 'bili');
            const fetchScript = join(biliRuntimeDir, 'fetch-payload.ps1');
            const updateScript = join(biliRuntimeDir, 'update.ps1');
            if (existsSync(fetchScript) && existsSync(updateScript)) {
              console.log('[dsh-plugin-offline-sync] billion-context selected: fetching runtime payload via fetch-payload.ps1 ...');
              const fr = run('powershell', [
                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fetchScript,
                '-Version', biliSelected.version, '-StageOnly',
              ], { encoding: 'utf8' });
              if (!fr.ok) {
                throw new Error('fetch-payload.ps1 failed:\n' + (fr.stderr || fr.stdout));
              }
              const m = fr.stdout.match(/STAGE_JSON=(\{[^\r\n]+\})/);
              if (!m) throw new Error('fetch-payload.ps1 did not emit STAGE_JSON:\n' + fr.stdout);
              const stageInfo = JSON.parse(m[1]);
              console.log('[dsh-plugin-offline-sync] billion-context payload staged at: ' + stageInfo.stageDir +
                ' (version ' + stageInfo.version + (stageInfo.commit ? ', commit ' + stageInfo.commit : '') + ')');
              const biliOut = join(stage, 'runtime', 'billion-context');
              mkdirSync(biliOut, { recursive: true });
              copyFileSync(updateScript, join(biliOut, 'update.ps1'));
              // payload = the staged npm prefix dir (contains node_modules + shims)
              copyRecursive(stageInfo.stageDir, join(biliOut, 'payload'));
              // small manifest for the installer to read version/commit
              writeFileSync(join(biliOut, 'runtime.json'), JSON.stringify({
                package: 'billion-context',
                version: stageInfo.version,
                commit: stageInfo.commit || '',
                builtAt: new Date().toISOString(),
              }, null, 2));
              try { rmSync(stageInfo.stageDir, { recursive: true, force: true }); } catch {}
            } else {
              console.log('[dsh-plugin-offline-sync] warning: billion-context selected but runtime/bili scripts missing; skipping runtime payload.');
            }
          }

          const manifest = {
            tool: 'dsh-plugin-offline-sync',
            toolVersion: '0.2.1',
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

          // Write a packing list (.txt) with the same basename as the ZIP,
          // containing each plugin's name and version.
          const listName = zipName.replace(/\.zip$/i, '') + '.txt';
          const listPath = join(outputDir, listName);
          const listContent = manifestPlugins
            .map(p => p.name + ' ' + p.version)
            .join('\n') + '\n';
          writeFileSync(listPath, listContent, 'utf8');

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

    // POST /dsh-plugin-offline-sync/exclude — add a plugin to the exclude list.
    // body: { name: string, outputDir?: string }
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-offline-sync/exclude',
      handler: async (req, res) => {
        try {
          const body = await readBody(req);
          const name = body && typeof body.name === 'string' ? body.name.trim() : '';
          if (!name) { json(res, 400, { error: 'name required' }); return; }
          const outputDir = body.outputDir || defaultOutputDir();
          const list = loadExcluded(outputDir);
          if (!list.includes(name)) list.push(name);
          saveExcluded(outputDir, list);
          json(res, 200, { ok: true, excluded: list });
        } catch (e) {
          json(res, 500, { error: String(e && e.message || e) });
        }
      },
    }));

    // POST /dsh-plugin-offline-sync/restore — remove plugin(s) from the exclude list.
    // body: { name?: string, names?: string[], all?: boolean, outputDir?: string }
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-offline-sync/restore',
      handler: async (req, res) => {
        try {
          const body = await readBody(req);
          const outputDir = body.outputDir || defaultOutputDir();
          let list = loadExcluded(outputDir);
          if (body.all) {
            list = [];
          } else {
            const toRemove = [];
            if (body.name) toRemove.push(body.name);
            if (Array.isArray(body.names)) toRemove.push(...body.names);
            if (toRemove.length === 0) { json(res, 400, { error: 'name, names, or all required' }); return; }
            list = list.filter(n => !toRemove.includes(n));
          }
          saveExcluded(outputDir, list);
          json(res, 200, { ok: true, excluded: list });
        } catch (e) {
          json(res, 500, { error: String(e && e.message || e) });
        }
      },
    }));

    // POST /dsh-plugin-offline-sync/clear-history — delete generated ZIP archives.
    // body: { outputDir?: string, resetState?: boolean }
    //   resetState=false (default): only delete ZIP files, keep pack-state.json.
    //   resetState=true: also delete pack-state.json so "changed" detection starts fresh.
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-offline-sync/clear-history',
      handler: async (req, res) => {
        try {
          const body = await readBody(req);
          const outputDir = (body && body.outputDir) || defaultOutputDir();
          const resetState = !!(body && body.resetState);
          if (!existsSync(outputDir)) {
            json(res, 200, { ok: true, deleted: 0, stateCleared: false });
            return;
          }
          let deleted = 0;
          const entries = readdirSync(outputDir, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.isFile() && /^dsh-plugins-.*\.(zip|txt)$/i.test(ent.name)) {
              try { rmSync(join(outputDir, ent.name), { force: true }); deleted++; } catch {}
            }
          }
          let stateCleared = false;
          if (resetState) {
            const statePath = join(outputDir, STATE_FILE);
            if (existsSync(statePath)) {
              try { rmSync(statePath, { force: true }); stateCleared = true; } catch {}
            }
          }
          json(res, 200, { ok: true, deleted, stateCleared });
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
