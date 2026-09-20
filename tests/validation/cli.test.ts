import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ROOT = join(__dirname, '..', '..');
const CLI = join(ROOT, 'bridge', 'cli.cjs');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

/** Run the CLI; never throws, returns { code, stdout, stderr }. */
function cli(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: opts.cwd || ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(opts.env || {}) },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e: any) {
    return {
      code: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ? String(e.stdout) : '',
      stderr: e.stderr ? String(e.stderr) : '',
    };
  }
}

let tmp: string;
let profileEnv: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sp4sap-cli-'));
  profileEnv = join(tmp, 'sap.env');
  writeFileSync(profileEnv, 'SAP_TIER=DEV\nSAP_URL=https://example.invalid:44300\nSAP_CLIENT=100\n');
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('sp4sap CLI — surface', () => {
  it('the declared bin entry point actually exists', () => {
    // package.json has always declared bin.sp4sap -> bridge/cli.cjs; before this
    // it was missing, so an npm-installed `sp4sap` command was broken.
    expect(existsSync(join(ROOT, pkg.bin.sp4sap))).toBe(true);
  });

  it('reports the package version', () => {
    const r = cli(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(pkg.version);
  });

  it('prints help with every documented command', () => {
    const r = cli(['--help']);
    expect(r.code).toBe(0);
    for (const c of ['install', 'uninstall', 'status', 'doctor']) {
      expect(r.stdout, `help must document ${c}`).toContain(c);
    }
  });

  it('rejects an unknown client with exit 2', () => {
    const r = cli(['install', '--client', 'notepad']);
    expect(r.code).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/unknown --client/);
  });

  it('rejects an unknown command with exit 2', () => {
    const r = cli(['frobnicate']);
    expect(r.code).toBe(2);
  });
});

describe('sp4sap CLI — dry run is side-effect free', () => {
  it('writes nothing to the project', () => {
    const proj = join(tmp, 'dryrun-proj');
    mkdirSync(proj, { recursive: true });

    const r = cli(['install', '--client', 'zcode', '--mcp-only', '--env-file', profileEnv, '--dry-run'], {
      cwd: proj,
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/DRY RUN/);
    expect(r.stdout).toMatch(/would install|Would write/i);

    expect(existsSync(join(proj, '.zcode')), 'dry run must not create .zcode/').toBe(false);
    expect(readdirSync(proj)).toEqual([]);
  });

  it('does not claim a plugin was installed', () => {
    const r = cli(['install', '--client', 'zcode', '--dry-run', '--env-file', profileEnv]);
    expect(r.stdout).not.toMatch(/Plugin installed/i);
  });
});

describe('sp4sap CLI — Zcode registration round trip', () => {
  const proj = () => {
    const p = join(tmp, `proj-${Math.random().toString(36).slice(2)}`);
    mkdirSync(p, { recursive: true });
    return p;
  };

  it('writes a strict-schema stdio entry pointing at the bridge', () => {
    const p = proj();
    const r = cli(['install', '--client', 'zcode', '--mcp-only', '--env-file', profileEnv], { cwd: p });
    expect(r.code).toBe(0);

    const cfg = JSON.parse(readFileSync(join(p, '.zcode', 'config.json'), 'utf-8'));
    const entry = cfg.mcp.servers.sap;
    expect(entry).toBeTruthy();

    // ZCode drops a server whose schema has an unknown key, so the key set is
    // load-bearing, not cosmetic.
    expect(Object.keys(entry).sort()).toEqual(
      ['args', 'command', 'cwd', 'env', 'timeoutMs', 'type'].sort(),
    );
    expect(entry.type).toBe('stdio');
    expect(entry.args.join(' ')).toContain(join('bridge', 'mcp-server.cjs'));
    expect(entry.cwd).toBe(p);

    // The tier guard is on for non-Claude clients; credentials are never written.
    expect(entry.env.SC4SAP_TIER_GUARD).toBe('proxy');
    expect(entry.env.SC4SAP_ENV_FILE).toBe(profileEnv);
    expect(JSON.stringify(entry)).not.toMatch(/SAP_PASSWORD|password/i);
  });

  it('is idempotent', () => {
    const p = proj();
    cli(['install', '--client', 'zcode', '--mcp-only', '--env-file', profileEnv], { cwd: p });
    const first = readFileSync(join(p, '.zcode', 'config.json'), 'utf-8');
    const r = cli(['install', '--client', 'zcode', '--mcp-only', '--env-file', profileEnv], { cwd: p });
    expect(r.stdout).toMatch(/already registered/);
    expect(readFileSync(join(p, '.zcode', 'config.json'), 'utf-8')).toBe(first);
  });

  it('uninstall removes only its own entry and leaves a backup', () => {
    const p = proj();
    cli(['install', '--client', 'zcode', '--mcp-only', '--env-file', profileEnv], { cwd: p });
    const r = cli(['uninstall', '--client', 'zcode'], { cwd: p });
    expect(r.code).toBe(0);

    const cfg = JSON.parse(readFileSync(join(p, '.zcode', 'config.json'), 'utf-8'));
    expect(cfg.mcp.servers.sap).toBeUndefined();
    expect(readdirSync(join(p, '.zcode')).some((f) => f.includes('sp4sap-backup'))).toBe(true);
  });

  it('preserves unrelated servers already in the file', () => {
    const p = proj();
    mkdirSync(join(p, '.zcode'), { recursive: true });
    writeFileSync(
      join(p, '.zcode', 'config.json'),
      JSON.stringify({ mcp: { servers: { other: { type: 'stdio', command: 'x' } } } }, null, 2),
    );

    cli(['install', '--client', 'zcode', '--mcp-only', '--env-file', profileEnv], { cwd: p });
    const cfg = JSON.parse(readFileSync(join(p, '.zcode', 'config.json'), 'utf-8'));
    expect(cfg.mcp.servers.other).toBeTruthy();
    expect(cfg.mcp.servers.sap).toBeTruthy();

    cli(['uninstall', '--client', 'zcode'], { cwd: p });
    const after = JSON.parse(readFileSync(join(p, '.zcode', 'config.json'), 'utf-8'));
    expect(after.mcp.servers.other).toBeTruthy();
    expect(after.mcp.servers.sap).toBeUndefined();
  });

  it('refuses to edit a config file that is not valid JSON', () => {
    const p = proj();
    mkdirSync(join(p, '.zcode'), { recursive: true });
    writeFileSync(join(p, '.zcode', 'config.json'), '{ this is not json');
    const r = cli(['install', '--client', 'zcode', '--mcp-only', '--env-file', profileEnv], { cwd: p });
    expect(r.stdout + r.stderr).toMatch(/not valid JSON/);
    // And it must leave the broken file exactly as it found it.
    expect(readFileSync(join(p, '.zcode', 'config.json'), 'utf-8')).toBe('{ this is not json');
  });
});

describe('sp4sap CLI — status and doctor run clean', () => {
  it('status exits 0', () => {
    const r = cli(['status']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Detected clients/);
  });

  it('doctor exits 0 and reports the vendor state', () => {
    const r = cli(['doctor']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Vendor MCP server/);
  });
});
