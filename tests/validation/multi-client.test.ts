import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

const readJson = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), 'utf-8'));

describe('multi-client plugin manifests', () => {
  it('ships a ZCode manifest with a name ZCode accepts', () => {
    const p = '.zcode-plugin/plugin.json';
    expect(existsSync(join(ROOT, p)), `${p} must exist`).toBe(true);
    const m = readJson(p);
    // ZCode requires ^[a-z0-9][a-z0-9._-]{0,127}$
    expect(m.name).toMatch(/^[a-z0-9][a-z0-9._-]{0,127}$/);
    expect(m.version).toBe(pkg.version);
    expect(m.skills).toBe('./skills/');
  });

  it('ships a Codex manifest with required interface metadata', () => {
    const p = '.codex-plugin/plugin.json';
    expect(existsSync(join(ROOT, p)), `${p} must exist`).toBe(true);
    const m = readJson(p);
    expect(m.name).toBe('sp4sap');
    expect(m.version).toBe(pkg.version);
    expect(m.skills).toBe('./skills/');
    expect(m.interface?.displayName).toBeTruthy();
    expect(Array.isArray(m.interface?.defaultPrompt)).toBe(true);
  });

  it('keeps all three client manifests on the same version', () => {
    const versions = [
      readJson('.claude-plugin/plugin.json').version,
      readJson('.zcode-plugin/plugin.json').version,
      readJson('.codex-plugin/plugin.json').version,
      pkg.version,
    ];
    expect(new Set(versions).size, `version drift: ${versions.join(' / ')}`).toBe(1);
  });

  it('does not leak Claude-Code-only keys into the ZCode manifest', () => {
    // ZCode's plugin schema records but does not execute `agents`/`settings`,
    // and has no `statusLine` concept. Keeping the ZCode manifest minimal is
    // what makes it safe: the Claude manifest keeps those fields.
    const m = readJson('.zcode-plugin/plugin.json');
    for (const k of ['statusLine', 'agents', 'commands', 'hooks']) {
      expect(m, `ZCode manifest should not declare ${k}`).not.toHaveProperty(k);
    }
  });
});

describe('generic MCP configuration templates', () => {
  const templates = ['mcp/generic-mcp.json', 'mcp/zcode.workspace.json'];

  for (const t of templates) {
    it(`${t} is valid JSON with a server pointing at the bridge`, () => {
      expect(existsSync(join(ROOT, t)), `${t} must exist`).toBe(true);
      const raw = readFileSync(join(ROOT, t), 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(raw).toContain('bridge/mcp-server.cjs');
    });
  }

  it('codex template names the bridge and the explicit env-file knob', () => {
    const raw = readFileSync(join(ROOT, 'mcp', 'codex.config.toml'), 'utf-8');
    expect(raw).toContain('[mcp_servers.sap]');
    expect(raw).toContain('bridge/mcp-server.cjs');
    expect(raw).toContain('SC4SAP_ENV_FILE');
  });

  it('no template contains a hardcoded credential', () => {
    // A password assignment is only acceptable when the value is a keychain
    // reference, a placeholder, or an env interpolation — never a literal.
    const ACCEPTABLE = /^(keychain:|<|\*+|your-|xxx|placeholder|\$\{)/i;

    for (const t of [...templates, 'mcp/codex.config.toml', 'mcp/README.md']) {
      const raw = readFileSync(join(ROOT, t), 'utf-8');

      for (const m of raw.matchAll(/SAP_PASSWORD\s*=\s*([^\s"'`]+)/g)) {
        expect(
          ACCEPTABLE.test(m[1]),
          `${t}: SAP_PASSWORD must be a keychain reference or placeholder, got "${m[1]}"`,
        ).toBe(true);
      }

      expect(raw, `${t} must not hardcode a bearer token`).not.toMatch(
        /Bearer\s+[A-Za-z0-9._-]{20,}/,
      );
      expect(raw, `${t} must not hardcode an API key`).not.toMatch(/\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/);
    }
  });
});

describe('bridge exposes the documented generic-client knobs', () => {
  const src = readFileSync(join(ROOT, 'bridge', 'mcp-server.cjs'), 'utf-8');

  it('honors an explicit env file and a project-dir override', () => {
    expect(src).toContain('SC4SAP_ENV_FILE');
    expect(src).toContain('MCP_ENV_PATH');
    expect(src).toContain('SC4SAP_PROJECT_DIR');
    expect(src).toContain('SC4SAP_VENDOR_DIR');
  });

  it('guards the tier proxy on the client request stream, not the response stream', () => {
    // The proxy must inspect what the CLIENT sends (tools/call requests) and
    // forward the vendor's responses untouched. Getting this backwards makes
    // the guard a no-op that still reports itself as active.
    expect(src).toContain("msg.method === 'tools/call'");
    expect(src).toContain('process.stdin.on(');
    expect(src).toContain('child.stdout.pipe(process.stdout)');
    expect(src).not.toContain('process.stdin.pipe(child.stdin)');
  });

  it('defaults the proxy off so Claude Code behaviour is unchanged', () => {
    expect(src).toContain("TIER_GUARD_MODE === 'proxy'");
    expect(src).toMatch(/if \(TIER_GUARD_ON\) \{\s*\n\s*launchGuardedProxy\(\);\s*\n\} else \{\s*\n\s*require\(LAUNCHER\);/);
  });
});
