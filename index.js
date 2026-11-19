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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync, copyFileSync, createReadStream, createWriteStream } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const name = 'dsh-plugin-offline-sync';

const STATE_FILE = 'pack-state.json';

// --- DSH desktop installer: treated as a virtual, checkable item in the UI. ---
// The download station (download.deepseek.com) is the authoritative source for
// the "latest" version: the Content-Disposition header on the installer URL
// names a file like "deepseek-harness-0.2.2-rc.3-win-x64.exe", which we parse
// for the version. A HEAD request is enough — no need to download ~300MB.
const DSH_INSTALLER_VIRTUAL_NAME = '@dsh-installer';
const DSH_INSTALLER_DIR_NAME = 'dsh-installer';
const DSH_INSTALLER_STATE_FILE = 'dsh-installer-state.json';
const DSH_DOWNLOAD_URLS = {
  win: 'https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe',
  mac: 'https://download.deepseek.com/desktop/dsh-latest-macos-arm64.dmg',
};

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

// ---- DSH desktop installer helpers ----

/** Parse the DSH version out of a Content-Disposition filename like
 *  "deepseek-harness-0.2.2-rc.3-win-x64.exe" → "0.2.2-rc.3".
 *  Returns null if nothing looks like a version. */
function parseDshVersionFromFilename(filename) {
  if (!filename) return null;
  // Strip quotes if present.
  const m = filename.match(/deepseek-harness[-.]([0-9]+.[0-9]+.[0-9]+(?:[-+][A-Za-z0-9.]+)?)/i);
  return m ? m[1] : null;
}

/** Compare two semver-ish versions (handles rc/alpha/beta/empty).
 *  Returns -1 / 0 / 1, or null if either is unparseable. */
function cmpDshVersion(a, b) {
  if (!a || !b) return null;
  const parse = (v) => {
    const core = v.split(/[-+]/)[0];
    const parts = core.split('.').map(Number);
    if (parts.some(isNaN)) return null;
    const rest = v.slice(core.length); // e.g. "-rc.3" or ""
    // Pre-release: present sorts LOWER than absent (0.2.2-rc.3 < 0.2.2).
    const pre = rest.startsWith('-') ? rest.slice(1) : null;
    return { parts, pre };
  };
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < len; i++) {
    const x = pa.parts[i] || 0, y = pb.parts[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;   // a is release, b is pre → a newer
  if (pb.pre === null) return -1;
  // Semver pre-release precedence: compare dot-separated identifiers left to
  // right; numeric identifiers compare numerically, others lexically; a
  // shorter valid prefix sorts lower (rc.3 < rc.3.1).
  const ia = pa.pre.split('.'), ib = pb.pre.split('.');
  const plen = Math.max(ia.length, ib.length);
  for (let i = 0; i < plen; i++) {
    const xa = ia[i], xb = ib[i];
    if (xa === undefined) return -1;   // a ran out first → lower
    if (xb === undefined) return 1;
    const na = /^[0-9]+$/.test(xa), nb = /^[0-9]+$/.test(xb);
    if (na && nb) {
      if (xa !== xb) return Number(xa) < Number(xb) ? -1 : 1;
    } else if (na !== nb) {
      return na ? -1 : 1;   // numeric < non-numeric
    } else if (xa !== xb) {
      return xa < xb ? -1 : 1;
    }
  }
  return 0;
}

/** HEAD a URL and read Content-Disposition + Content-Length without
 *  downloading the body. Returns { version, size, filename } or { error }. */
async function probeRemoteVersion(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const cd = res.headers.get('content-disposition') || '';
    const size = Number(res.headers.get('content-length')) || 0;
    const fm = cd.match(/filename[^;\n=]*=\s*["']?([^"';\n]+)/i);
    const filename = fm ? fm[1] : '';
    return { version: parseDshVersionFromFilename(filename), size, filename, status: res.status };
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}

/** Detect the locally installed DSH desktop version.
 *  Win: DeepSeek Harness.exe VersionInfo.FileVersion. Mac: app Info.plist.
 *  Best-effort; returns null when undetectable. */
function detectLocalDshVersion() {
  try {
    if (process.platform === 'win32') {
      const candidates = [
        join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe'),
        join(process.env.PROGRAMFILES || '', 'DeepSeek Harness', 'DeepSeek Harness.exe'),
      ];
      for (const exe of candidates) {
        if (!existsSync(exe)) continue;
        // Use powershell only to read version info (no network).
        const r = spawnSync('powershell', [
          '-NoProfile', '-Command',
          "(Get-Item '" + exe.replace(/'/g, "''") + "').VersionInfo.FileVersion",
        ], { encoding: 'utf8' });
        const v = (r.stdout || '').trim();
        if (v) return v;
      }
    } else if (process.platform === 'darwin') {
      const plist = '/Applications/DeepSeek Harness.app/Contents/Info.plist';
      if (existsSync(plist)) {
        const r = spawnSync('defaults', ['read', plist, 'CFBundleShortVersionString'], { encoding: 'utf8' });
        const v = (r.stdout || '').trim();
        if (v) return v;
      }
    }
  } catch {}
  return null;
}

function dshInstallerDir(outputDir) {
  return join(outputDir, DSH_INSTALLER_DIR_NAME);
}

function loadDshInstallerState(outputDir) {
  const p = join(outputDir, DSH_INSTALLER_STATE_FILE);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

function saveDshInstallerState(outputDir, state) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, DSH_INSTALLER_STATE_FILE), JSON.stringify(state, null, 2));
}

/** Stream-download an installer to <outputDir>/dsh-installer/<filename>.
 *  Existing older files for the same platform are removed first.
 *  Returns { ok, path, filename, version, size }. */
async function downloadDshInstaller(outputDir, platform) {
  const url = DSH_DOWNLOAD_URLS[platform];
  if (!url) return { ok: false, error: 'unknown platform: ' + platform };
  const probe = await probeRemoteVersion(url);
  if (probe.error) return { ok: false, error: probe.error };
  if (!probe.version) return { ok: false, error: 'could not detect latest version from ' + url };
  const dir = dshInstallerDir(outputDir);
  mkdirSync(dir, { recursive: true });
  const ext = platform === 'win' ? '.exe' : '.dmg';
  const filename = 'deepseek-harness-' + probe.version + '-' + platform + ext;
  const dest = join(dir, filename);
  // Remove any stale installer for this platform.
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isFile() && ent.name.endsWith(ext) && ent.name !== filename) {
      try { rmSync(join(dir, ent.name), { force: true }); } catch {}
    }
  }
  const tmp = dest + '.part';
  if (existsSync(tmp)) rmSync(tmp, { force: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    return { ok: false, error: 'download failed: HTTP ' + res.status };
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  if (existsSync(dest)) rmSync(dest, { force: true });
  copyFileSync(tmp, dest);
  rmSync(tmp, { force: true });
  return { ok: true, path: dest, filename, version: probe.version, size: probe.size || statSync(dest).size };
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
    stderr: r.stderr || (r.error ? r.error.message : ''),
    exitCode: r.status,
  };
}

/**
 * Copy a list of absolute file paths to the system clipboard as files
 * (so the user can paste them into a folder / chat / file picker).
 *
 * Windows: PowerShell `Set-Clipboard -LiteralPath` accepts multiple paths.
 * macOS: `osascript` tells Finder to set the clipboard to POSIX file refs.
 * Linux: try `xclip` with text/uri-list; fall back to `xsel` with plain paths.
 * Returns the run() result object so the caller can report failures.
 */
function copyFilesToClipboard(files) {
  if (process.platform === 'win32') {
    const list = files.map(f => "'" + f.replace(/'/g, "''") + "'").join(',');
    return run('powershell', [
      '-NoProfile', '-Command',
      'Set-Clipboard -LiteralPath @(' + list + ')',
    ]);
  }
  if (process.platform === 'darwin') {
    const list = files.map(f => 'POSIX file "' + f.replace(/"/g, '\\"') + '"').join(', ');
    return run('osascript', ['-e', 'tell application "Finder" to set the clipboard to {' + list + '}']);
  }
  // Linux: prefer xclip with the text/uri-list target (file-paste friendly).
  const uriList = files.map(f => 'file://' + f).join('\n') + '\n';
  const xc = run('xclip', ['-selection', 'clipboard', '-t', 'text/uri-list'], { input: uriList });
  if (xc.ok) return xc;
  const xs = run('xsel', ['--clipboard', '--input'], { input: files.join('\n') });
  return xs.ok ? xs : xc;
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
        let stage = null;
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
          stage = join(outputDir, '.stage-' + stamp);
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
            toolVersion: '0.3.1',
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
        } finally {
          if (stage) {
            try { rmSync(stage, { recursive: true, force: true }); } catch {}
          }
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

    // GET /dsh-plugin-offline-sync/dsh-version — detect the latest DSH desktop
    // installer version from the download station via a HEAD request (no body
    // download) and compare it against the last-downloaded version recorded in
    // the output dir state. Also reports the locally installed DSH version
    // (best-effort). The download station is the authoritative "latest" source.
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-offline-sync/dsh-version',
      handler: async (req, res) => {
        try {
          const outputDir = defaultOutputDir();
          const state = loadDshInstallerState(outputDir);
          const localVersion = detectLocalDshVersion();
          const platforms = [];
          for (const key of Object.keys(DSH_DOWNLOAD_URLS)) {
            const probe = await probeRemoteVersion(DSH_DOWNLOAD_URLS[key]);
            const dir = dshInstallerDir(outputDir);
            const ext = key === 'win' ? '.exe' : '.dmg';
            let files = [];
            if (existsSync(dir)) {
              files = readdirSync(dir, { withFileTypes: true })
                .filter(e => e.isFile() && e.name.endsWith(ext))
                .map(e => e.name);
            }
            const last = state[key] || null;
            const cmp = (probe.version && last && last.version) ? cmpDshVersion(probe.version, last.version) : null;
            const neverDownloaded = !last || !last.version;
            platforms.push({
              key,
              url: DSH_DOWNLOAD_URLS[key],
              latestVersion: probe.version || null,
              latestSize: probe.size || 0,
              filename: probe.filename || null,
              error: probe.error || null,
              lastDownloadedVersion: last ? last.version : null,
              lastDownloadedAt: last ? (last.downloadedAt || null) : null,
              hasUpdate: !neverDownloaded && cmp === 1,
              files,
            });
          }
          json(res, 200, { outputDir, localVersion, platforms });
        } catch (e) {
          json(res, 500, { error: String(e && e.message || e) });
        }
      },
    }));

    // POST /dsh-plugin-offline-sync/download-dsh — download the latest DSH
    // installer(s) for the requested platforms into <outputDir>/dsh-installer/.
    // This is a standalone job, separate from plugin packing: installers are
    // NOT put into the ZIP. Re-checking a platform (force:true) re-downloads
    // even if the recorded version already matches the remote latest.
    // body: { outputDir?: string, platforms: ('win'|'mac')[], force?: boolean }
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-offline-sync/download-dsh',
      handler: async (req, res) => {
        try {
          const body = await readBody(req);
          const outputDir = (body && body.outputDir) || defaultOutputDir();
          const requested = Array.isArray(body && body.platforms) ? body.platforms : [];
          const forcePlats = Array.isArray(body && body.forcePlatforms) ? body.forcePlatforms : [];
          const force = !!(body && body.force);
          if (requested.length === 0) {
            json(res, 400, { error: 'no platforms requested' });
            return;
          }
          const state = loadDshInstallerState(outputDir);
          const results = [];
          for (const key of requested) {
            if (!DSH_DOWNLOAD_URLS[key]) {
              results.push({ platform: key, ok: false, error: 'unknown platform' });
              continue;
            }
            const probe = await probeRemoteVersion(DSH_DOWNLOAD_URLS[key]);
            const last = state[key] || null;
            const forced = force || forcePlats.indexOf(key) !== -1;
            if (!forced && probe.version && last && last.version &&
                cmpDshVersion(probe.version, last.version) === 0) {
              results.push({ platform: key, ok: true, skipped: true, version: last.version, path: last.path || null, filename: last.filename || null });
              continue;
            }
            const dl = await downloadDshInstaller(outputDir, key);
            if (dl.ok) {
              state[key] = { version: dl.version, path: dl.path, filename: dl.filename, downloadedAt: Date.now() };
              saveDshInstallerState(outputDir, state);
            }
            results.push({ platform: key, ...dl });
          }
          json(res, 200, { ok: results.every(r => r.ok), results });
        } catch (e) {
          json(res, 500, { error: String(e && e.stack || e) });
        }
      },
    }));

    // POST /dsh-plugin-offline-sync/copy-last — copy the most recent ZIP archive
    // (and its same-basename .txt packing list) to the system clipboard.
    // body: { outputDir?: string }
    routes.push(webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-offline-sync/copy-last',
      handler: async (req, res) => {
        try {
          const body = await readBody(req);
          const outputDir = (body && body.outputDir) || defaultOutputDir();
          if (!existsSync(outputDir)) {
            json(res, 404, { error: 'output directory does not exist' });
            return;
          }
          const entries = readdirSync(outputDir, { withFileTypes: true });
          const zips = entries
            .filter(e => e.isFile() && /^dsh-plugins-.*\.zip$/i.test(e.name))
            .map(e => {
              let mtime = 0;
              try { mtime = statSync(join(outputDir, e.name)).mtimeMs; } catch {}
              return { name: e.name, mtime };
            })
            .sort((a, b) => b.mtime - a.mtime);
          if (zips.length === 0) {
            json(res, 404, { error: 'no packed ZIP found' });
            return;
          }
          const latest = zips[0];
          const zipPath = join(outputDir, latest.name);
          const txtName = latest.name.replace(/\.zip$/i, '') + '.txt';
          const txtPath = join(outputDir, txtName);
          const files = [zipPath];
          const hasTxt = existsSync(txtPath);
          if (hasTxt) files.push(txtPath);
          // Include any downloaded DSH installer files (separate job, but the
          // copy action bundles them together for easy transfer).
          const installerFiles = [];
          const instDir = dshInstallerDir(outputDir);
          if (existsSync(instDir)) {
            for (const ent of readdirSync(instDir, { withFileTypes: true })) {
              if (ent.isFile() && /\.(exe|dmg)$/i.test(ent.name)) {
                const p = join(instDir, ent.name);
                installerFiles.push(p);
                files.push(p);
              }
            }
          }
          const cr = copyFilesToClipboard(files);
          if (!cr.ok) {
            json(res, 500, { error: 'clipboard copy failed', stdout: cr.stdout, stderr: cr.stderr, platform: process.platform });
            return;
          }
          json(res, 200, {
            ok: true,
            zipName: latest.name,
            txtName: hasTxt ? txtName : null,
            installerFiles,
            files,
          });
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
          // Also clear downloaded DSH installers (separate job, but history
          // cleanup removes them together). Count removed installer files.
          let installerDeleted = 0;
          const instDir = dshInstallerDir(outputDir);
          if (existsSync(instDir)) {
            try {
              const instEntries = readdirSync(instDir, { withFileTypes: true });
              for (const ent of instEntries) {
                if (ent.isFile()) { try { rmSync(join(instDir, ent.name), { force: true }); installerDeleted++; } catch {} }
              }
              rmSync(instDir, { recursive: true, force: true });
            } catch {}
          }
          let stateCleared = false;
          if (resetState) {
            const statePath = join(outputDir, STATE_FILE);
            if (existsSync(statePath)) {
              try { rmSync(statePath, { force: true }); stateCleared = true; } catch {}
            }
            const instStatePath = join(outputDir, DSH_INSTALLER_STATE_FILE);
            if (existsSync(instStatePath)) {
              try { rmSync(instStatePath, { force: true }); } catch {}
            }
          }
          json(res, 200, { ok: true, deleted, installerDeleted, stateCleared });
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
