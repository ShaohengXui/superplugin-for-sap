#!/usr/bin/env node
/**
 * sp4sap MCP Server Bridge
 *
 * Thin launcher that delegates to the vendor-installed abap-mcp-adt server.
 * Performs preflight checks so that drift between the marketplace source and
 * the running cache, or a missing vendor install, fails fast with a clear
 * message instead of showing a "connected" MCP server that cannot actually
 * answer tool calls.
 *
 * Preflight order:
 *   1. Env file resolution (.sc4sap/sap.env)
 *   2. Plugin version drift warning (cache vs marketplace plugin.json)
 *   3. Vendor launcher existence
 *      - Missing + SC4SAP_MCP_AUTOBUILD=1 → run build script then retry
 *      - Missing + no opt-in            → exit(1) with remediation steps
 *   4. Vendor node_modules self-heal
 *      - Launcher present but production deps missing (Claude Code's plugin
 *        install sometimes drops node_modules entries) → run
 *        `npm install --omit=dev` inside vendor/abap-mcp-adt automatically.
 *        Safe and idempotent; no opt-in required so first-time users connect
 *        without manual setup.
 *
 * The external server is installed via `/sp4sap:setup` or
 * `node scripts/build-mcp-server.mjs`.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const { pathToFileURL } = require('url');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
// Vendor location. Overridable so the server can be run against a vendor
// installed outside the plugin tree (global npm install, shared read-only
// checkout, CI fixture) without moving files around.
const VENDOR_DIR = process.env.SC4SAP_VENDOR_DIR
  ? path.resolve(process.env.SC4SAP_VENDOR_DIR)
  : path.join(PLUGIN_ROOT, 'vendor', 'abap-mcp-adt');
const LAUNCHER = path.join(VENDOR_DIR, 'dist', 'server', 'launcher.js');
const BUILD_SCRIPT = path.join(PLUGIN_ROOT, 'scripts', 'build-mcp-server.mjs');
const PLUGIN_JSON = path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json');

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Locate the marketplace (source-of-truth) plugin.json that corresponds to
 * this cached plugin. Claude Code's standard layout is:
 *   .../plugins/cache/<plugin>/<plugin>/<version>/  (this file)
 *   .../plugins/marketplaces/<plugin>/              (source)
 * Returns the absolute path to the marketplace plugin.json if found.
 */
function findMarketplacePluginJson() {
  const parts = PLUGIN_ROOT.split(path.sep);
  for (let i = parts.length - 1; i > 0; i--) {
    if (parts[i] === 'cache' && parts[i - 1] === 'plugins') {
      const pluginName = parts[i + 1];
      if (!pluginName) return null;
      const rootSegments = parts.slice(0, i);
      const mp = path.join(
        rootSegments.join(path.sep),
        'marketplaces',
        pluginName,
        '.claude-plugin',
        'plugin.json'
      );
      return fs.existsSync(mp) ? mp : null;
    }
  }
  return null;
}

// --- 1. Resolve env file ---------------------------------------------------
// Precedence (multi-profile 0.6.0+; explicit-path tier added for generic MCP
// clients):
//   0. $SC4SAP_ENV_FILE                                  (explicit absolute path)
//      $MCP_ENV_PATH                                     (caller-supplied handoff)
//   1. <project>/.sc4sap/active-profile.txt → ${SC4SAP_HOME_DIR|~/.sc4sap}/profiles/<alias>/sap.env
//   2. <project>/.sc4sap/sap.env                         (legacy single-file layout)
//   3. <plugin>/.sc4sap/sap.env                          (test scaffolding)
//
// `<project>` is $SC4SAP_PROJECT_DIR when set, else process.cwd(). Claude Code
// and Zcode launch a plugin MCP server with cwd = the user's project, so the
// walk-up below just works there; other clients (and CI) may launch from
// anywhere, which is what the explicit-path tier is for.
//
// If no file resolves but SAP_URL is already present in process.env, we proceed
// without a file: some clients pass credentials entirely through their `env`
// block. The vendor server reads process.env directly, so this is a supported
// configuration — not a missing-config error.

function resolveActiveProfileEnv(cwd) {
  const pointer = path.join(cwd, '.sc4sap', 'active-profile.txt');
  if (!fs.existsSync(pointer)) return null;
  let alias;
  try { alias = fs.readFileSync(pointer, 'utf8').trim(); } catch { return null; }
  if (!alias) return null;
  const homeDir = process.env.SC4SAP_HOME_DIR
    ? process.env.SC4SAP_HOME_DIR
    : path.join(os.homedir(), '.sc4sap');
  const envPath = path.join(homeDir, 'profiles', alias, 'sap.env');
  return fs.existsSync(envPath) ? envPath : null;
}

const CWD = process.env.SC4SAP_PROJECT_DIR
  ? path.resolve(process.env.SC4SAP_PROJECT_DIR)
  : process.cwd();
const PROFILE_ENV = resolveActiveProfileEnv(CWD);
const CWD_ENV = path.join(CWD, '.sc4sap', 'sap.env');
const PLUGIN_ENV = path.join(PLUGIN_ROOT, '.sc4sap', 'sap.env');

// Tier 0 — an explicitly named env file. Both names are honored because
// MCP_ENV_PATH is the historical handoff to the vendor server and is already
// used by other tooling, while SC4SAP_ENV_FILE is the documented knob for
// generic clients.
const EXPLICIT_ENV = (() => {
  const raw = process.env.SC4SAP_ENV_FILE || process.env.MCP_ENV_PATH || '';
  if (!raw) return null;
  const abs = path.resolve(raw);
  if (!fs.existsSync(abs)) {
    console.error(`[sp4sap] SC4SAP_ENV_FILE/MCP_ENV_PATH points at a missing file: ${abs}`);
    process.exit(1);
  }
  return abs;
})();

const ENV_FILE = EXPLICIT_ENV
  || PROFILE_ENV
  || (fs.existsSync(CWD_ENV) ? CWD_ENV : PLUGIN_ENV);

// Credentials supplied purely through the process environment (no file on disk).
const ENV_ONLY_MODE =
  !EXPLICIT_ENV && !PROFILE_ENV && !fs.existsSync(CWD_ENV) && !fs.existsSync(PLUGIN_ENV)
    ? Boolean(process.env.SAP_URL)
    : false;

if (ENV_FILE && fs.existsSync(ENV_FILE)) {
  process.env.MCP_ENV_PATH = ENV_FILE;
  // Pull SC4SAP_MCP_AUTOBUILD from sap.env so users can toggle it there.
  // sap.env takes precedence over .mcp.json-injected process.env.
  try {
    const envText = fs.readFileSync(ENV_FILE, 'utf8');
    const m = envText.match(/^\s*SC4SAP_MCP_AUTOBUILD\s*=\s*(.+?)\s*$/m);
    if (m) {
      const v = m[1].replace(/^["']|["']$/g, '').trim();
      process.env.SC4SAP_MCP_AUTOBUILD = v;
    }
  } catch { /* ignore parse errors; fall back to process.env */ }
} else if (ENV_ONLY_MODE) {
  console.error('[sp4sap] No env file found — using SAP_* variables from the process environment.');
} else {
  const pointerPath = path.join(CWD, '.sc4sap', 'active-profile.txt');
  console.error('[sp4sap] Config not found. Looked in:');
  console.error(`  - $SC4SAP_ENV_FILE / $MCP_ENV_PATH: ${process.env.SC4SAP_ENV_FILE || process.env.MCP_ENV_PATH || '(unset)'}`);
  console.error(`  - active-profile: ${pointerPath}${fs.existsSync(pointerPath) ? ' (pointer present, but profile env missing under ~/.sc4sap/profiles/<alias>/sap.env)' : ' (pointer missing)'}`);
  console.error(`  - ${CWD_ENV}`);
  console.error(`  - ${PLUGIN_ENV}`);
  console.error('[sp4sap] Fix with one of:');
  console.error('  1. Run "/sp4sap:setup" in your project directory (Claude Code / Zcode).');
  console.error('  2. Point SC4SAP_ENV_FILE at an absolute path to a profile sap.env.');
  console.error('  3. Set SAP_URL/SAP_CLIENT/SAP_USERNAME/SAP_PASSWORD in this server\'s env block.');
  process.exit(1);
}

// --- 2. Version drift warning (non-fatal) ---------------------------------

const cacheVer = (readJsonSafe(PLUGIN_JSON) || {}).version || 'unknown';
const mpJsonPath = findMarketplacePluginJson();
const mpVer = mpJsonPath ? ((readJsonSafe(mpJsonPath) || {}).version || 'unknown') : null;

if (mpVer && mpVer !== cacheVer) {
  console.error('[sp4sap] ⚠ Plugin version drift detected:');
  console.error(`  Cache (running):    v${cacheVer}   (${PLUGIN_ROOT})`);
  console.error(`  Marketplace (HEAD): v${mpVer}   (${path.dirname(path.dirname(mpJsonPath))})`);
  console.error('  Run /reload-plugins (or restart Claude Code) to pick up the newer source.');
  console.error(`  Continuing with cached v${cacheVer}...`);
  console.error('');
}

// --- 2b. Vendor module-type sentinel --------------------------------------
// The vendor launcher at dist/server/launcher.js is CommonJS. If vendor's own
// package.json is missing from the cache (Claude Code's plugin-pack step can
// strip files not listed in package.json → "files"), Node walks up the tree,
// finds the plugin-root package.json with "type": "module", and loads the
// launcher as ESM — crashing with `ReferenceError: exports is not defined`.
// Drop a minimal sentinel to override module type for the vendor subtree.
(function ensureVendorPackageJson() {
  const vendorPkg = path.join(VENDOR_DIR, 'package.json');
  if (fs.existsSync(vendorPkg)) return;
  if (!fs.existsSync(VENDOR_DIR)) return; // launcher preflight will handle
  try {
    fs.writeFileSync(
      vendorPkg,
      JSON.stringify(
        {
          type: 'commonjs',
          _comment:
            'sp4sap sentinel — overrides parent plugin-root "type": "module" so the CommonJS vendor launcher at dist/server/launcher.js loads correctly under Node 20+. Auto-written by bridge/mcp-server.cjs when the cache is missing vendor/abap-mcp-adt/package.json.',
        },
        null,
        2,
      ) + '\n',
    );
    console.error('[sp4sap] vendor package.json was missing — wrote CommonJS sentinel to ' + vendorPkg);
  } catch (e) {
    console.error(`[sp4sap] Could not write vendor sentinel package.json: ${e.message}`);
  }
})();

// --- 3. Vendor launcher preflight -----------------------------------------

function attemptAutoBuild() {
  console.error('');
  console.error('[sp4sap] SC4SAP_MCP_AUTOBUILD=1 — running build-mcp-server.mjs...');
  console.error('  (this clones abap-mcp-adt-powerup and runs npm install, ~1 minute)');
  try {
    cp.execSync(`node "${BUILD_SCRIPT}"`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`[sp4sap] Auto-build failed: ${e.message}`);
    return false;
  }
  if (!fs.existsSync(LAUNCHER)) {
    console.error('[sp4sap] Auto-build completed but launcher still missing. Check build output above.');
    return false;
  }
  console.error('[sp4sap] Auto-build succeeded. Starting MCP server...');
  console.error('');
  return true;
}

if (!fs.existsSync(LAUNCHER)) {
  console.error('[sp4sap] MCP server cannot start — vendor launcher missing.');
  console.error(`  Plugin version: v${cacheVer}`);
  console.error(`  Expected:       ${LAUNCHER}`);
  console.error('');
  console.error('  Likely cause: the plugin was upgraded without rebuilding vendor/.');
  console.error('  Fix options:');
  console.error(`    1. node "${BUILD_SCRIPT}"`);
  console.error('    2. Run /sp4sap:setup mcp');
  console.error('    3. Set env SC4SAP_MCP_AUTOBUILD=1 and retry');

  if (process.env.SC4SAP_MCP_AUTOBUILD === '1') {
    if (!attemptAutoBuild()) process.exit(1);
  } else {
    process.exit(1);
  }
}

// --- 4. Vendor node_modules self-heal -------------------------------------

/**
 * Verify that vendor's production deps are physically present in node_modules.
 * Checks for the dep's package.json rather than just the directory: Claude Code's
 * plugin-pack step on some setups leaves empty node_modules/<dep>/ stubs, which
 * a plain fs.existsSync(dir) would treat as "installed" and skip the self-heal
 * below (issue #27). package.json is the minimum marker of a real install.
 * Returns the first missing package name, or null if all present.
 */
function findMissingDep() {
  const pkgPath = path.join(VENDOR_DIR, 'package.json');
  const pkg = readJsonSafe(pkgPath);
  if (!pkg || !pkg.dependencies) return null;
  const nm = path.join(VENDOR_DIR, 'node_modules');
  for (const dep of Object.keys(pkg.dependencies)) {
    if (!fs.existsSync(path.join(nm, ...dep.split('/'), 'package.json'))) return dep;
  }
  return null;
}

/**
 * Locate the marketplace vendor dir that mirrors this cache vendor.
 * Returns absolute path to .../marketplaces/<plugin>/vendor/abap-mcp-adt or null.
 */
function findMarketplaceVendorDir() {
  const parts = PLUGIN_ROOT.split(path.sep);
  for (let i = parts.length - 1; i > 0; i--) {
    if (parts[i] === 'cache' && parts[i - 1] === 'plugins') {
      const pluginName = parts[i + 1];
      if (!pluginName) return null;
      const rootSegments = parts.slice(0, i);
      const mp = path.join(
        rootSegments.join(path.sep),
        'marketplaces',
        pluginName,
        'vendor',
        'abap-mcp-adt',
      );
      return fs.existsSync(mp) ? mp : null;
    }
  }
  return null;
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(s);
      try { fs.symlinkSync(target, d); } catch { /* ignore */ }
    } else if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function listAllMissingDeps() {
  const pkg = readJsonSafe(path.join(VENDOR_DIR, 'package.json'));
  if (!pkg || !pkg.dependencies) return [];
  const nm = path.join(VENDOR_DIR, 'node_modules');
  return Object.keys(pkg.dependencies).filter(
    (d) => !fs.existsSync(path.join(nm, ...d.split('/'), 'package.json')),
  );
}

function attemptDepInstall(initialMissing) {
  console.error('');
  console.error(`[sp4sap] Vendor dependency missing: ${initialMissing}`);
  console.error(`[sp4sap] Self-healing vendor in ${VENDOR_DIR}`);
  console.error('  (one-time install, ~30-60s — please wait)');

  // Pass 1: lockfile-based install (cheap, fixes most cases).
  try {
    cp.execSync('npm install --omit=dev --ignore-scripts --no-audit --no-fund', {
      cwd: VENDOR_DIR,
      stdio: 'inherit',
    });
  } catch (e) {
    console.error(`[sp4sap] Pass 1 (npm install) failed: ${e.message}`);
  }

  // Pass 1b: explicit-name install for npm-skipped deps.
  // `npm install --omit=dev` against a stale package-lock.json sometimes
  // reports "added N packages" while silently skipping deps that are listed
  // in `dependencies` (observed with pino + pino-pretty after a 0.6.x version
  // bump on Windows). Re-running with explicit names forces npm to realize the
  // full dep tree.
  let missing = listAllMissingDeps();
  if (missing.length > 0) {
    console.error(`[sp4sap] Pass 1b — explicit install for ${missing.length} dep(s): ${missing.join(', ')}`);
    try {
      const args = missing.map((d) => JSON.stringify(d)).join(' ');
      cp.execSync(
        `npm install ${args} --ignore-scripts --no-save --no-audit --no-fund`,
        { cwd: VENDOR_DIR, stdio: 'inherit' },
      );
    } catch (e) {
      console.error(`[sp4sap] Pass 1b (explicit install) failed: ${e.message}`);
    }
  }

  // Pass 2: leftovers from npm-cache/lockfile drift → copy from marketplace
  // vendor if available (it has the full node_modules tree).
  missing = listAllMissingDeps();
  if (missing.length > 0) {
    const mpVendor = findMarketplaceVendorDir();
    if (mpVendor) {
      console.error(`[sp4sap] Pass 2 — copying ${missing.length} dep(s) from marketplace vendor`);
      const mpNm = path.join(mpVendor, 'node_modules');
      const cacheNm = path.join(VENDOR_DIR, 'node_modules');
      for (const dep of missing) {
        const src = path.join(mpNm, ...dep.split('/'));
        const dest = path.join(cacheNm, ...dep.split('/'));
        if (fs.existsSync(src)) {
          try {
            copyDirSync(src, dest);
            console.error(`  ✓ ${dep}`);
          } catch (e) {
            console.error(`  ✗ ${dep}: ${e.message}`);
          }
        } else {
          console.error(`  ✗ ${dep}: not in marketplace vendor either`);
        }
      }
    } else {
      console.error('[sp4sap] Pass 2 skipped — marketplace vendor not found.');
    }
  }

  missing = listAllMissingDeps();
  if (missing.length > 0) {
    console.error(`[sp4sap] Self-heal incomplete — still missing: ${missing.join(', ')}`);
    return false;
  }
  console.error('[sp4sap] Vendor dependencies installed. Starting MCP server...');
  console.error('');
  return true;
}

const missingDep = findMissingDep();
if (missingDep) {
  if (!attemptDepInstall(missingDep)) {
    console.error('');
    console.error('[sp4sap] Manual recovery:');
    console.error(`  cd "${VENDOR_DIR}"`);
    console.error('  npm install --omit=dev');
    process.exit(1);
  }
}

// --- 5. Launch vendor MCP server ------------------------------------------

// MCP-layer tier guard (L1.5) — opt-in via SC4SAP_TIER_GUARD=proxy.
//
// Claude Code and Zcode get L1 from a PreToolUse hook. Clients with no hook
// system (Codex with hooks disabled, plain MCP clients, CI) would otherwise
// reach the vendor server with only its internal L2 guard. In proxy mode we
// spawn the vendor launcher as a child and relay JSON-RPC instead of
// require()-ing it in-process, rejecting `tools/call` for blocked tools before
// they reach SAP.
//
// Default OFF: the in-process require() path is unchanged, so Claude Code
// behavior is identical unless the user opts in.
const TIER_GUARD_MODE = String(process.env.SC4SAP_TIER_GUARD || '').toLowerCase();
const TIER_GUARD_ON = TIER_GUARD_MODE === 'proxy' || TIER_GUARD_MODE === '1' || TIER_GUARD_MODE === 'on';

function launchGuardedProxy() {
  // The matrix is shared with the Claude Code hook and the standalone CLI.
  // Imported dynamically because this file is CommonJS and the lib is ESM.
  // pathToFileURL is required: the default ESM loader rejects a bare Windows
  // drive path ("d:\...") with ERR_UNSUPPORTED_ESM_URL_SCHEME.
  import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'lib', 'tier-guard.mjs')).href)
    .then(({ checkToolAllowed, formatDenyMessage, resolveTierContext, shortToolName }) => {
      const ctx = resolveTierContext({ startDir: CWD, envFile: ENV_FILE || null });
      const tier = process.env.SAP_TIER
        ? String(process.env.SAP_TIER).toUpperCase()
        : ctx.tier;

      console.error(
        `[sp4sap] Tier guard proxy active — tier=${tier}` +
          `${ctx.alias ? ` profile=${ctx.alias}` : ''}` +
          `${ctx.resolved ? '' : ' (tier unresolved; defaulted to DEV)'}`,
      );

      const child = cp.spawn(process.execPath, [LAUNCHER], {
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Server → client: verbatim. Responses are never transformed; only the
      // request direction is inspected.
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
      child.stdin.on('error', () => {});
      process.stdout.on('error', () => {});

      // Client → server: inspect each JSON-RPC request and drop the blocked
      // ones, answering them locally so the client is not left hanging.
      let buffer = '';
      let warnedFraming = false;

      process.stdin.setEncoding('utf8');
      process.stdin.on('error', () => {});
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          handleClientLine(line);
        }
      });
      process.stdin.on('end', () => {
        if (buffer) handleClientLine(buffer);
        buffer = '';
        child.stdin.end();
      });

      function handleClientLine(line) {
        const trimmed = line.trim();
        if (!trimmed) {
          child.stdin.write(`${line}\n`);
          return;
        }
        // Only JSON-RPC requests are inspected. A Content-Length framed stream
        // (not what MCP stdio uses) cannot be parsed line-wise, so say so
        // loudly rather than pretending to guard it.
        if (!trimmed.startsWith('{')) {
          if (!warnedFraming && /^content-length:/i.test(trimmed)) {
            warnedFraming = true;
            console.error(
              '[sp4sap] Tier guard proxy: non-JSON framing detected on the client stream — ' +
                'cannot inspect messages. Relying on the server-side L2 guard.',
            );
          }
          child.stdin.write(`${line}\n`);
          return;
        }

        let msg;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          child.stdin.write(`${line}\n`);
          return;
        }

        if (msg && msg.method === 'tools/call' && msg.id !== undefined) {
          const tool = shortToolName((msg.params && msg.params.name) || '');
          const denial = checkToolAllowed(tool, tier);
          if (denial) {
            const message = formatDenyMessage({
              tool,
              alias: ctx.alias,
              tier,
              reason: denial.reason,
              source: ctx.resolved ? ctx.source : null,
              legacy: ctx.legacy,
            });
            console.error(`[sp4sap] tier-guard blocked ${tool} on ${tier}`);
            process.stdout.write(
              `${JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                error: { code: -32001, message },
              })}\n`,
            );
            return; // never reaches the vendor server
          }
        }

        child.stdin.write(`${line}\n`);
      }

      child.on('error', (e) => {
        console.error(`[sp4sap] Failed to spawn vendor MCP server: ${e.message}`);
        process.exit(1);
      });
      child.on('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        else process.exit(code === null ? 1 : code);
      });
    })
    .catch((e) => {
      console.error(`[sp4sap] Tier guard proxy unavailable (${e.message}) — starting vendor server unguarded.`);
      require(LAUNCHER);
    });
}

if (TIER_GUARD_ON) {
  launchGuardedProxy();
} else {
  require(LAUNCHER);
}
