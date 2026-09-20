import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

describe('Plugin Structure Validation', () => {
  it('plugin.json exists and has required fields', () => {
    const path = join(ROOT, '.claude-plugin', 'plugin.json');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.name).toBe('sp4sap');
    const pkgVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;
    expect(data.version, 'plugin.json version must match package.json').toBe(pkgVersion);
    expect(data.skills).toBe('./skills/');
    expect(data.mcpServers).toBe('./.mcp.json');
  });

  it('marketplace.json version matches package.json', () => {
    const mpPath = join(ROOT, '.claude-plugin', 'marketplace.json');
    const mp = JSON.parse(readFileSync(mpPath, 'utf-8'));
    const pkgVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;
    expect(mp.version, 'marketplace.json root version must match package.json').toBe(pkgVersion);
    expect(mp.plugins[0].version, 'marketplace.json plugins[0].version must match package.json').toBe(pkgVersion);
  });

  it('marketplace.json exists and has required fields', () => {
    const path = join(ROOT, '.claude-plugin', 'marketplace.json');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.name).toBe('sp4sap');
    expect(data.plugins[0].category).toBe('development');
    expect(data.plugins[0].tags).toContain('sap');
    expect(data.plugins[0].tags).toContain('abap');
  });

  it('.mcp.json exists with server key "sap"', () => {
    const path = join(ROOT, '.mcp.json');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.mcpServers).toHaveProperty('sap');
    expect(data.mcpServers.sap.command).toBe('node');
  });

  it('hooks.json exists and has valid structure', () => {
    const path = join(ROOT, 'hooks', 'hooks.json');
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.hooks).toBeDefined();
    const events = Object.keys(data.hooks);
    expect(events.length).toBeGreaterThanOrEqual(11);
    expect(events).toContain('UserPromptSubmit');
    expect(events).toContain('SessionStart');
    expect(events).toContain('PreToolUse');
    expect(events).toContain('PostToolUse');
    expect(events).toContain('Stop');
  });

  it('CLAUDE.md exists', () => {
    expect(existsSync(join(ROOT, 'CLAUDE.md'))).toBe(true);
  });

  it('package.json has correct type and dependencies', () => {
    const data = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    expect(data.type).toBe('module');
    expect(data.dependencies).toHaveProperty('@anthropic-ai/sdk');
    expect(data.dependencies).toHaveProperty('@modelcontextprotocol/sdk');
    expect(data.dependencies).toHaveProperty('zod');
  });
});

describe('Directory Structure', () => {
  const requiredDirs = ['agents', 'skills', 'hooks', 'scripts', 'configs', 'src', 'bridge'];

  for (const dir of requiredDirs) {
    it(`${dir}/ directory exists`, () => {
      expect(existsSync(join(ROOT, dir))).toBe(true);
    });
  }

  const modules = ['SD', 'MM', 'FI', 'CO', 'PP', 'PS', 'PM', 'QM', 'TR', 'HCM', 'WM', 'TM', 'Ariba', 'BW'];

  for (const mod of modules) {
    it(`configs/${mod}/ directory exists`, () => {
      expect(existsSync(join(ROOT, 'configs', mod))).toBe(true);
    });
  }
});
