#!/usr/bin/env node
/**
 * sp4sap CLI — install the SAP MCP server (+ plugin) into a coding agent.
 *
 *   sp4sap install   [--client codex|zcode|claude|all] [--scope user|project]
 *   sp4sap uninstall [--client ...] [--name sap]
 *   sp4sap status
 *   sp4sap doctor
 *
 * Design rules:
 *   1. Prefer the client's OWN CLI (codex mcp add, claude mcp add) over editing
 *      its config file. Zcode has no MCP subcommand, so it gets a documented
 *      JSON edit — the only supported path there.
 *   2. Never write a credential. We register the path to the profile env file
 *      (SC4SAP_ENV_FILE); the password stays in the OS keychain and is resolved
 *      by the MCP server itself.
 *   3. Back up before editing any file we do not own, and be idempotent.
 *   4. Everything is reversible with `uninstall`.
 *
 * The plugin route (skills + agents + MCP in one) is attempted first for
 * Claude Code and Codex because it is strictly richer; MCP-only registration is
 * the fallback so the SAP tools always end up reachable. Registering both would
 * expose the same tools twice, so we deliberately do one or the other.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const { pathToFileURL } = require('url');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const BRIDGE = path.join(PLUGIN_ROOT, 'bridge', 'mcp-server.cjs');
const PLUGIN_NAME = 'sp4sap';
const MARKETPLACE_NAME = 'sp4sap';
const DEFAULT_SERVER_NAME = 'sap';

const isWin = process.platform === 'win32';

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

const C = process.stdout.isTTY
  ? { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { r: '', g: '', y: '', d: '', b: '', x: '' };

const log = (...a) => console.log(...a);
const ok = (m) => log(`  ${C.g}✓${C.x} ${m}`);
const warn = (m) => log(`  ${C.y}!${C.x} ${m}`);
const bad = (m) => log(`  ${C.r}✗${C.x} ${m}`);
const dim = (m) => log(`    ${C.d}${m}${C.x}`);
const head = (m) => log(`\n${C.b}${m}${C.x}`);

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = {
    command: null,
    client: 'all',
    scope: null,
    name: DEFAULT_SERVER_NAME,
    envFile: null,
    plugin: true,
    tierGuard: null,
    dryRun: false,
    yes: false,
  };
  const take = (i) => argv[i + 1];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!o.command && !a.startsWith('-')) o.command = a;
    else if (a === '--client') o.client = String(take(i++));
    else if (a === '--scope') o.scope = String(take(i++));
    else if (a === '--name') o.name = String(take(i++));
    else if (a === '--env-file') o.envFile = take(i++);
    else if (a === '--mcp-only' || a === '--no-plugin') o.plugin = false;
    else if (a === '--with-plugin') o.plugin = true;
    else if (a === '--tier-guard') o.tierGuard = true;
    else if (a === '--no-tier-guard') o.tierGuard = false;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--help' || a === '-h') o.command = o.command || 'help';
    else if (a === '--version' || a === '-v') o.command = 'version';
    else if (!o.unknown) o.unknown = a;
  }
  return o;
}

// ---------------------------------------------------------------------------
// process helpers
// ---------------------------------------------------------------------------

function which(cmd) {
  try {
    const finder = isWin ? 'where' : 'which';
    const out = cp.execSync(`${finder} ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return out[0] || null;
  } catch {
    return null;
  }
}

/** Run a client CLI. Returns { ok, stdout, stderr, code }. Never throws. */
function runCli(bin, args, { timeout = 120000, env = null } = {}) {
  try {
    const stdout = cp.execFileSync(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      encoding: 'utf8',
      windowsHide: true,
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    return { ok: true, stdout, stderr: '', code: 0 };
  } catch (e) {
    return {
      ok: false,
      stdout: e.stdout ? String(e.stdout) : '',
      stderr: e.stderr ? String(e.stderr) : e.message || '',
      code: typeof e.status === 'number' ? e.status : 1,
    };
  }
}

function runCliInherit(bin, args, { dryRun, env = null } = {}) {
  const pretty = `${bin} ${args.join(' ')}`;
  if (dryRun) {
    dim(`would run: ${pretty}`);
    return { ok: true, code: 0, dryRun: true };
  }
  try {
    cp.execFileSync(bin, args, {
      stdio: 'inherit',
      windowsHide: true,
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    return { ok: true, code: 0 };
  } catch (e) {
    return { ok: false, code: typeof e.status === 'number' ? e.status : 1 };
  }
}

// ---------------------------------------------------------------------------
// JSON config editing (Zcode)
// ---------------------------------------------------------------------------

function readJsonFile(file) {
  if (!fs.existsSync(file)) return { exists: false, data: {} };
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return { exists: true, data: {} };
  try {
    return { exists: true, data: JSON.parse(raw) };
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}); refusing to edit it.`);
  }
}

/**
 * Apply `mutator` to a JSON config file. Backs up the previous contents before
 * writing, and reports whether anything actually changed so install is
 * idempotent. Returns { changed, file, backup }.
 */
function editJsonFile(file, mutator, { dryRun }) {
  const { exists, data } = readJsonFile(file);
  const before = exists ? fs.readFileSync(file, 'utf8') : null;

  const next = mutator(JSON.parse(JSON.stringify(data)));
  const text = `${JSON.stringify(next, null, 2)}\n`;

  if (before === text) return { changed: false, file, backup: null };

  if (dryRun) return { changed: true, file, backup: null, dryRun: true };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = null;
  if (before !== null) {
    backup = `${file}.sp4sap-backup-${Date.now()}`;
    fs.writeFileSync(backup, before, 'utf8');
  }
  fs.writeFileSync(file, text, 'utf8');
  return { changed: true, file, backup };
}

// ---------------------------------------------------------------------------
// client detection
// ---------------------------------------------------------------------------

function findCodex() {
  const onPath = which('codex');
  if (onPath) return onPath;
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  const base = path.join(local, 'OpenAI', 'Codex', 'bin');
  const candidates = [path.join(base, 'codex.exe')];
  try {
    for (const d of fs.readdirSync(base)) {
      candidates.push(path.join(base, d, 'codex.exe'));
    }
  } catch {
    /* ignore */
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function findZcode() {
  // Zcode ships an Electron app; the CLI entry is resources/glm/zcode.cjs.
  // It has no `mcp` subcommand, so it is only used for detection/reporting.
  const roots = [
    process.env.ZCODE_HOME,
    'D:\\software\\ZCode',
    'C:\\Program Files\\ZCode',
  ].filter(Boolean);
  for (const r of roots) {
    if (fs.existsSync(path.join(r, 'ZCode.exe'))) {
      return { app: path.join(r, 'ZCode.exe'), cli: path.join(r, 'resources', 'glm', 'zcode.cjs') };
    }
  }
  if (fs.existsSync(path.join(os.homedir(), '.zcode'))) return { app: null, cli: null };
  return null;
}

function findClaude() {
  return which('claude') || which('claude.cmd');
}

function detectClients() {
  const codexBin = findCodex();
  const claudeBin = findClaude();
  const zcode = findZcode();
  return {
    codex: { available: Boolean(codexBin), bin: codexBin },
    zcode: { available: Boolean(zcode), ...(zcode || {}) },
    claude: { available: Boolean(claudeBin), bin: claudeBin },
  };
}

/** Path to the vendored MCP server launcher the bridge will require()/spawn. */
function vendorLauncher() {
  const dir = process.env.SC4SAP_VENDOR_DIR
    ? path.resolve(process.env.SC4SAP_VENDOR_DIR)
    : path.join(PLUGIN_ROOT, 'vendor', 'abap-mcp-adt');
  return path.join(dir, 'dist', 'server', 'launcher.js');
}

// ---------------------------------------------------------------------------
// profile / env-file resolution
// ---------------------------------------------------------------------------

/**
 * Decide the project directory to bake into a client's MCP `cwd`.
 *
 * `resolveWorkspaceRoot` walks up looking for `.sc4sap/`. That is right when the
 * user runs the installer from a subdirectory of their SAP project, but it has a
 * false positive: `~/.sc4sap` is the *profile store*, so it always exists and
 * the walk-up can climb all the way to $HOME and call that the project root.
 * Only accept a root that actually holds project profile state, and never $HOME.
 */
function projectDirFor(startDir, root) {
  if (!root || root === os.homedir()) return startDir;
  const stateFiles = ['active-profile.txt', 'sap.env', 'config.json'];
  const hasState = stateFiles.some((f) => fs.existsSync(path.join(root, '.sc4sap', f)));
  return hasState ? root : startDir;
}

/**
 * Resolve the active profile's sap.env and the workspace root via the shared
 * resolver, so this CLI, the hooks and the MCP server all agree on which
 * profile is active and where the project lives.
 */
async function resolveProfile(startDir) {
  try {
    const mod = await import(
      pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'lib', 'profile-resolve.mjs')).href
    );
    const hit = mod.resolveSapEnvPath(startDir);
    const root = projectDirFor(startDir, mod.resolveWorkspaceRoot(startDir));
    return {
      envFile: hit ? hit.path : null,
      projectDir: root,
      source: hit ? hit.source : null,
    };
  } catch {
    return { envFile: null, projectDir: startDir, source: null };
  }
}

/** The env block handed to the MCP server. Never contains a credential. */
function buildServerEnv({ envFile, tierGuard, clientKey }) {
  const env = {};
  // Normalize: a client config should carry a canonical absolute path, not
  // whatever relative or 8.3-shortened form the shell happened to pass in.
  if (envFile) env.SC4SAP_ENV_FILE = path.resolve(envFile);
  // Claude Code gets L1 from its PreToolUse hook, so its in-process launch path
  // (the most heavily exercised one) is left exactly as shipped. Clients whose
  // hook coverage is absent or unverified get the MCP-layer guard instead.
  const wantGuard = tierGuard === null ? clientKey !== 'claude' : tierGuard;
  if (wantGuard) env.SC4SAP_TIER_GUARD = 'proxy';
  return env;
}

function envPairs(env) {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`);
}

// ---------------------------------------------------------------------------
// install — Claude Code
// ---------------------------------------------------------------------------

function installClaude(ctx, opts) {
  const { bin } = ctx.claude;
  const env = buildServerEnv({ ...opts, clientKey: 'claude' });
  const scope = opts.scope || 'user';
  const pluginScope = scope === 'project' ? 'project' : 'user';

  if (opts.dryRun) {
    head('Claude Code');
    dim(`would run: ${bin} plugin marketplace add ${PLUGIN_ROOT}`);
    dim(`would run: ${bin} plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME} -y -s ${pluginScope}`);
    dim('  → if the plugin route fails, fall back to MCP-only:');
    const flags = envPairs(env).map((p) => `-e ${p}`).join(' ');
    dim(`would run: ${bin} mcp add ${opts.name} -s ${scope}${flags ? ` ${flags}` : ''} -- ${process.execPath} ${BRIDGE}`);
    return { via: 'planned' };
  }

  if (opts.plugin) {
    head('Claude Code — plugin route (skills + agents + MCP)');
    const mp = runCliInherit(bin, ['plugin', 'marketplace', 'add', PLUGIN_ROOT], opts);
    if (mp.ok) {
      const inst = runCliInherit(
        bin,
        ['plugin', 'install', `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, '-y', '-s', pluginScope],
        opts,
      );
      if (inst.ok) {
        ok('Plugin installed — skills, agents and the MCP server are all wired.');
        dim('Restart Claude Code, then run /sp4sap:sap-doctor to verify.');
        return { via: 'plugin' };
      }
      bad('Plugin install failed — falling back to MCP-only registration.');
    } else {
      warn('Could not add the marketplace — falling back to MCP-only registration.');
    }
  }

  head('Claude Code — MCP-only registration');
  // Scope `user` keeps us out of the repo's own .mcp.json (which belongs to the
  // plugin manifest) and out of .claude/settings.local.json.
  const args = ['mcp', 'add', opts.name, '-s', scope];
  for (const p of envPairs(env)) args.push('-e', p);
  args.push('--', process.execPath, BRIDGE);
  const r = runCliInherit(bin, args, opts);
  if (r.ok) {
    ok(`Registered MCP server "${opts.name}" (scope: ${scope}).`);
    dim('Tools appear as mcp__sap__* — no skills/agents in this mode.');
    return { via: 'mcp' };
  }
  bad(`claude mcp add failed (exit ${r.code}).`);
  return { via: null };
}

// ---------------------------------------------------------------------------
// install — Codex
// ---------------------------------------------------------------------------

function installCodex(ctx, opts) {
  const { bin } = ctx.codex;
  const env = buildServerEnv({ ...opts, clientKey: 'codex' });

  if (opts.dryRun) {
    head('Codex');
    dim(`would run: ${bin} plugin marketplace add ${PLUGIN_ROOT}`);
    dim(`would run: ${bin} plugin add ${PLUGIN_NAME}@${MARKETPLACE_NAME}`);
    dim('  → if the plugin route fails, fall back to MCP-only:');
    dim(`would run: ${bin} mcp remove ${opts.name}`);
    const flags = envPairs(env).map((p) => `--env ${p}`).join(' ');
    dim(`would run: ${bin} mcp add ${opts.name}${flags ? ` ${flags}` : ''} -- ${process.execPath} ${BRIDGE}`);
    return { via: 'planned' };
  }

  if (opts.plugin) {
    head('Codex — plugin route (skills + MCP)');
    const mp = runCliInherit(bin, ['plugin', 'marketplace', 'add', PLUGIN_ROOT], opts);
    if (mp.ok) {
      const inst = runCliInherit(bin, ['plugin', 'add', `${PLUGIN_NAME}@${MARKETPLACE_NAME}`], opts);
      if (inst.ok) {
        ok('Plugin installed — skills and the MCP server are both wired.');
        dim('Restart Codex, then ask it to call GetSession.');
        return { via: 'plugin' };
      }
      bad('Plugin install failed — falling back to MCP-only registration.');
    } else {
      warn('Could not add the marketplace — falling back to MCP-only registration.');
    }
  }

  head('Codex — MCP-only registration');
  // Remove first so re-running updates in place instead of erroring on a
  // duplicate name.
  runCli(bin, ['mcp', 'remove', opts.name]);
  const args = ['mcp', 'add', opts.name];
  for (const p of envPairs(env)) args.push('--env', p);
  args.push('--', process.execPath, BRIDGE);
  const r = runCliInherit(bin, args, opts);
  if (r.ok) {
    ok(`Registered MCP server "${opts.name}" in ~/.codex/config.toml.`);
    dim('Verify with: codex mcp list');
    return { via: 'mcp' };
  }
  bad(`codex mcp add failed (exit ${r.code}).`);
  return { via: null };
}

// ---------------------------------------------------------------------------
// install — Zcode (no MCP subcommand: documented config-file write)
// ---------------------------------------------------------------------------

function zcodeConfigPath(scope, cwd) {
  if (scope === 'user') return path.join(os.homedir(), '.zcode', 'cli', 'config.json');
  return path.join(cwd, '.zcode', 'config.json');
}

function zcodeServerEntry(env, projectDir) {
  // ZCode's schema is strict — an unknown key silently drops the whole server.
  // Only documented stdio fields are emitted.
  return {
    type: 'stdio',
    command: process.execPath,
    args: [BRIDGE],
    cwd: projectDir,
    env,
    timeoutMs: 60000,
  };
}

function installZcode(ctx, opts) {
  // Project scope is the default: .sc4sap/active-profile.txt is itself
  // project-scoped, and ZCode's desktop app can override a user-scope file.
  const scope = opts.scope || 'project';
  const cwd = process.cwd();
  const file = zcodeConfigPath(scope, cwd);
  const env = buildServerEnv({ ...opts, clientKey: 'zcode' });

  head(`Zcode — MCP registration (${scope} scope)`);
  dim(`file: ${file}`);

  let result;
  try {
    result = editJsonFile(
      file,
      (data) => {
        data.mcp = data.mcp || {};
        data.mcp.servers = data.mcp.servers || {};
        data.mcp.servers[opts.name] = zcodeServerEntry(env, opts.projectDir || cwd);
        return data;
      },
      opts,
    );
  } catch (e) {
    bad(e.message);
    return { via: null };
  }

  if (!result.changed) {
    ok(`"${opts.name}" is already registered identically — nothing to do.`);
  } else if (result.dryRun) {
    warn(`Would write ${file}`);
    return { via: 'planned' };
  } else {
    ok(`Registered MCP server "${opts.name}".`);
    if (result.backup) dim(`backup: ${result.backup}`);
    warn('This file holds absolute, machine-specific paths — keep it out of version control.');
  }

  if (scope === 'user') {
    warn('ZCode desktop may supply its own MCP list, which overrides this file.');
    dim('If the server does not appear, use project scope or Settings → MCP.');
  }
  dim('Restart the ZCode session (all scopes auto-connect), then check Settings → MCP.');

  head('Zcode — skills / agents');
  warn('ZCode installs plugins through its UI only (no CLI subcommand).');
  dim('Settings → Plugin Management → Discover → “+” → add this path:');
  dim(PLUGIN_ROOT);
  dim('Then install "sp4sap". Skip this if you only need the SAP tools.');
  dim('Note: installing the plugin ALSO registers an MCP server, so run');
  dim(`\`sp4sap uninstall --client zcode --name ${opts.name}\` to avoid duplicate tools.`);

  return { via: 'config' };
}

// ---------------------------------------------------------------------------
// uninstall
// ---------------------------------------------------------------------------

function uninstallClaude(ctx, opts) {
  head('Claude Code');
  runCliInherit(ctx.claude.bin, ['plugin', 'uninstall', `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, '-y'], opts);
  runCliInherit(ctx.claude.bin, ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME], opts);
  const r = runCliInherit(ctx.claude.bin, ['mcp', 'remove', opts.name], opts);
  ok(r.ok ? `Removed MCP server "${opts.name}".` : 'No MCP-only registration found.');
  return { via: 'removed' };
}

function uninstallCodex(ctx, opts) {
  head('Codex');
  runCliInherit(ctx.codex.bin, ['plugin', 'remove', `${PLUGIN_NAME}@${MARKETPLACE_NAME}`], opts);
  runCliInherit(ctx.codex.bin, ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME], opts);
  const r = runCliInherit(ctx.codex.bin, ['mcp', 'remove', opts.name], opts);
  ok(r.ok ? `Removed MCP server "${opts.name}".` : 'No MCP registration found.');
  return { via: 'removed' };
}

function uninstallZcode(ctx, opts) {
  const scope = opts.scope || 'project';
  const file = zcodeConfigPath(scope, process.cwd());
  head(`Zcode (${scope} scope)`);
  if (!fs.existsSync(file)) {
    ok('No config file — nothing to remove.');
    return { via: 'removed' };
  }
  try {
    const result = editJsonFile(
      file,
      (data) => {
        if (data.mcp && data.mcp.servers) delete data.mcp.servers[opts.name];
        return data;
      },
      opts,
    );
    ok(result.changed ? `Removed MCP server "${opts.name}".` : 'Not registered — nothing to remove.');
    if (result.backup) dim(`backup: ${result.backup}`);
  } catch (e) {
    bad(e.message);
  }
  warn('If you installed sp4sap as a ZCode plugin, disable it in Settings → Plugin Management.');
  return { via: 'removed' };
}

// ---------------------------------------------------------------------------
// status / doctor
// ---------------------------------------------------------------------------

async function cmdStatus(opts) {
  const clients = detectClients();
  head('Detected clients');
  for (const [k, v] of Object.entries(clients)) {
    const label = { codex: 'Codex', zcode: 'ZCode', claude: 'Claude Code' }[k];
    if (v.available) ok(`${label}${v.bin ? ` — ${v.bin}` : ''}`);
    else warn(`${label} — not found`);
  }

  const profile = await resolveProfile(process.cwd());
  const envFile = opts.envFile || profile.envFile;
  head('SAP profile');
  if (envFile) ok(`active profile env: ${envFile}`);
  else warn('no active profile resolved — run /sp4sap:setup or pass --env-file');

  head('MCP registration');
  if (clients.codex.available) {
    const r = runCli(clients.codex.bin, ['mcp', 'get', opts.name]);
    if (r.ok) ok(`Codex: "${opts.name}" registered`);
    else warn(`Codex: "${opts.name}" not registered`);
  }
  if (clients.claude.available) {
    const r = runCli(clients.claude.bin, ['mcp', 'get', opts.name]);
    if (r.ok) ok(`Claude Code: "${opts.name}" registered`);
    else warn(`Claude Code: "${opts.name}" not registered (plugin install also provides it)`);
  }
  if (clients.zcode.available) {
    const file = zcodeConfigPath('project', process.cwd());
    let found = false;
    try {
      const { data } = readJsonFile(file);
      found = Boolean(data.mcp && data.mcp.servers && data.mcp.servers[opts.name]);
    } catch {
      /* ignore */
    }
    if (found) ok(`ZCode: "${opts.name}" registered in ${file}`);
    else warn(`ZCode: "${opts.name}" not registered in ${file}`);
  }
  return 0;
}

async function cmdDoctor(opts) {
  head('sp4sap doctor');
  log(`  plugin root : ${PLUGIN_ROOT}`);
  log(`  bridge      : ${BRIDGE} ${fs.existsSync(BRIDGE) ? '' : `${C.r}(missing)${C.x}`}`);
  log(`  node        : ${process.execPath} (${process.version})`);

  const vendorDir = process.env.SC4SAP_VENDOR_DIR
    || path.join(PLUGIN_ROOT, 'vendor', 'abap-mcp-adt');
  const launcher = vendorLauncher();
  head('Vendor MCP server');
  if (fs.existsSync(launcher)) {
    ok(`launcher present: ${launcher}`);
  } else {
    bad(`launcher missing: ${launcher}`);
    dim('Fix: node scripts/build-mcp-server.mjs');
  }

  head('Vendor pin');
  const check = runCli(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'build-mcp-server.mjs'), '--check']);
  if (check.stdout) log(check.stdout.trimEnd());
  if (check.stderr) log(check.stderr.trimEnd());
  log(`  ${C.d}exit code: ${check.code} (0 ok/unverified, 1 not installed, 2 pin drift)${C.x}`);

  const profile = await resolveProfile(process.cwd());
  const envFile = opts.envFile || profile.envFile;

  head('Active tier');
  const explain = runCli(
    process.execPath,
    [path.join(PLUGIN_ROOT, 'scripts', 'tier-guard-cli.mjs'), '--explain'],
    { env: envFile ? { SC4SAP_ENV_FILE: envFile } : null },
  );
  if (explain.stdout) log(explain.stdout.trimEnd());
  if (!explain.ok && explain.stderr) log(explain.stderr.trimEnd());

  head('Tier guard self-test');
  const deny = runCli(
    process.execPath,
    [path.join(PLUGIN_ROOT, 'scripts', 'tier-guard-cli.mjs'), '--tool', 'UpdateClass', '--json'],
    { env: envFile ? { SC4SAP_ENV_FILE: envFile } : null },
  );
  if (deny.stdout) log(deny.stdout.trimEnd());
  log(
    `  ${C.d}exit ${deny.code} — 0 means "allowed", which is correct on a DEV profile.` +
      ` On QA/PRD the same call must exit 3.${C.x}`,
  );

  head('Next');
  dim('sp4sap install --dry-run     # preview registrations');
  dim('sp4sap install               # install into every detected client');
  return 0;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const HELP = `${C.b}sp4sap${C.x} — install the SAP MCP server into a coding agent

${C.b}USAGE${C.x}
  sp4sap <command> [options]

${C.b}COMMANDS${C.x}
  install      Register sp4sap with Codex / ZCode / Claude Code
  uninstall    Remove every registration sp4sap added
  status       Show detected clients and what is registered
  doctor       Check the bridge, the vendor install and the active tier

${C.b}OPTIONS${C.x}
  --client <codex|zcode|claude|all>   Target client(s)   (default: all detected)
  --scope <user|project>              Registration scope (client-specific default)
  --name <name>                       MCP server name    (default: sap)
  --env-file <path>                   Profile sap.env to point the server at
  --mcp-only, --no-plugin             Skip the skills/agents plugin, MCP only
  --tier-guard / --no-tier-guard      Force the MCP-layer QA/PRD guard on or off
  --dry-run                           Print actions without changing anything
  -y, --yes                           Do not prompt
  -h, --help / -v, --version

${C.b}EXAMPLES${C.x}
  sp4sap install                        # every detected client
  sp4sap install --client codex         # Codex only
  sp4sap install --client zcode --scope project
  sp4sap install --mcp-only --dry-run
  sp4sap uninstall --client codex

${C.b}NOTES${C.x}
  Credentials are never written by this CLI. The MCP server resolves the active
  profile's sap.env (or SC4SAP_ENV_FILE) and reads the password from the OS
  keychain via its keychain: reference.
  The MCP-layer tier guard defaults ON for Codex and ZCode, OFF for Claude Code
  (which enforces through its PreToolUse hook on the tested in-process path).
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.command === 'version') {
    const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'));
    log(`sp4sap ${pkg.version}`);
    return 0;
  }
  if (!opts.command || opts.command === 'help') {
    log(HELP);
    return 0;
  }
  if (opts.unknown) {
    bad(`unknown option: ${opts.unknown}`);
    log(HELP);
    return 2;
  }

  if (!fs.existsSync(BRIDGE)) {
    bad(`bridge not found at ${BRIDGE} — is this a complete sp4sap checkout?`);
    return 2;
  }

  const clients = detectClients();
  const wanted = opts.client === 'all' ? ['codex', 'zcode', 'claude'] : [opts.client];
  const invalid = wanted.filter((c) => !['codex', 'zcode', 'claude'].includes(c));
  if (invalid.length) {
    bad(`unknown --client: ${invalid.join(', ')} (use codex|zcode|claude|all)`);
    return 2;
  }

  if (opts.command === 'status') return cmdStatus(opts);
  if (opts.command === 'doctor') return cmdDoctor(opts);

  if (opts.command !== 'install' && opts.command !== 'uninstall') {
    bad(`unknown command: ${opts.command}`);
    log(HELP);
    return 2;
  }

  const profile = await resolveProfile(process.cwd());
  const envFile = opts.envFile || profile.envFile;
  const effective = { ...opts, envFile, projectDir: profile.projectDir };

  if (opts.command === 'install') {
    if (opts.dryRun) head('DRY RUN — nothing will be changed');
    log(`\n  bridge : ${BRIDGE}`);
    log(`  project: ${profile.projectDir}`);
    log(`  profile: ${envFile || `${C.y}(none resolved — pass --env-file)${C.x}`}`);
    log(`  node   : ${process.execPath}`);

    // Registering a server whose vendor launcher is missing produces a client
    // that reports "connected" but lists no tools. Say so before, not after.
    if (!fs.existsSync(vendorLauncher())) {
      head('Warning — the SAP MCP server is not built yet');
      warn(`launcher missing: ${vendorLauncher()}`);
      dim('Registering now is fine, but the server will not start until you run:');
      dim('  node scripts/build-mcp-server.mjs        # ~1 min, clones at the pinned commit');
      dim('Or set SC4SAP_MCP_AUTOBUILD=1 in the client env to build on first launch.');
    }

    const results = [];
    for (const key of wanted) {
      if (!clients[key].available) {
        head(`${key} — skipped (not detected)`);
        results.push({ key, via: 'skipped' });
        continue;
      }
      const fn = { claude: installClaude, codex: installCodex, zcode: installZcode }[key];
      results.push({ key, ...fn(clients, effective) });
    }

    head('Summary');
    for (const r of results) {
      const label = { codex: 'Codex', zcode: 'ZCode', claude: 'Claude Code' }[r.key] || r.key;
      if (r.via === 'skipped') warn(`${label}: not detected`);
      else if (r.via === 'planned') warn(`${label}: would install (plugin, else MCP-only)`);
      else if (r.via === 'plugin') ok(`${label}: plugin (skills + agents + MCP)`);
      else if (r.via === 'mcp') ok(`${label}: MCP only`);
      else if (r.via === 'config') ok(`${label}: MCP via config file`);
      else bad(`${label}: failed`);
    }
    if (!opts.dryRun) {
      dim('Restart the client(s) to pick up the change.');
      dim('Verify with: sp4sap status');
    }
    return 0;
  }

  // uninstall
  for (const key of wanted) {
    if (!clients[key].available) {
      head(`${key} — skipped (not detected)`);
      continue;
    }
    const fn = { claude: uninstallClaude, codex: uninstallCodex, zcode: uninstallZcode }[key];
    fn(clients, effective);
  }
  head('Done');
  return 0;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    bad(e && e.message ? e.message : String(e));
    process.exit(1);
  });
