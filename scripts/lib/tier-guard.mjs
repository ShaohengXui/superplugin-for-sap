// sp4sap tier guard — portable, client-agnostic enforcement core.
//
// This module is the single source of truth for the QA/PRD block matrix. It is
// deliberately free of any Claude Code dependency (no hook payload shape, no
// $CLAUDE_PLUGIN_ROOT) so that three different consumers can share one matrix
// instead of each carrying a copy that drifts:
//
//   1. scripts/hooks/tier-readonly-guard.mjs — Claude Code PreToolUse hook (L1)
//   2. bridge/mcp-server.cjs                 — MCP-layer proxy guard (L1.5)
//   3. scripts/tier-guard-cli.mjs            — any other client's hook system / CI
//
// Matrix (Strict):
//   PRD: Create_, Update_, Delete_, Patch_, Write_, Activate_,
//        RunUnitTest, RuntimeRun{Program,Class}WithProfiling,
//        RuntimeCreateProfilerTraceParameters
//   QA:  same as PRD except RunUnitTest is allowed
//   DEV: nothing blocked.
//
// The server-side guard inside abap-mcp-adt-powerup (L2) enforces the same
// matrix independently; this module exists to reject earlier with a clearer
// message, and to cover clients that have no hook system at all.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Every registered tool matching these prefixes mutates SAP. `Patch`, `Write`
// and `Activate` match exactly one tool each today (PatchGuiStatus,
// WriteTextElementsBulk, ActivateObjects) and are prefixes rather than literals
// so a future sibling is covered on the day it ships, not the day someone
// notices. Note `Create` does NOT match `RuntimeCreate…` — startsWith, not
// substring — so runtime tools stay in RUNTIME_EXEC below.
export const MUTATION_PREFIXES = ['Create', 'Update', 'Delete', 'Patch', 'Write', 'Activate'];

export const RUNTIME_EXEC = new Set([
  'RunUnitTest',
  'RuntimeRunProgramWithProfiling',
  'RuntimeRunClassWithProfiling',
  // Sets up a server-side profiler trace. Grouped with the runs it configures:
  // those are already blocked on QA/PRD, so nothing usable is lost by blocking
  // the setup call too.
  'RuntimeCreateProfilerTraceParameters',
]);

// Allowed on QA but not PRD.
export const QA_ALLOW = new Set(['RunUnitTest']);

// ReloadProfile is always allowed — otherwise a QA/PRD session could not switch
// back to a DEV profile without an escape-hatch debate.
export const ALWAYS_ALLOW = new Set(['ReloadProfile']);

export const TIERS = ['DEV', 'QA', 'PRD'];

// MCP tools arrive as `mcp__<server>__<tool>` in Claude Code and Zcode, and as
// `<server>__<tool>` or bare `<tool>` elsewhere. Reduce any of them to the
// handler name the matrix is written against.
export function shortToolName(raw) {
  const parts = String(raw || '').split('__');
  return parts[parts.length - 1] || '';
}

export function isMutation(tool) {
  return MUTATION_PREFIXES.some((p) => tool.startsWith(p));
}

export function classifyTool(tool) {
  if (!tool) return 'other';
  if (isMutation(tool)) return 'mutation';
  if (RUNTIME_EXEC.has(tool)) return 'runtime';
  return 'other';
}

/**
 * Decide whether `tool` may run under `tier`.
 * Returns null when allowed, else { kind, reason }.
 */
export function checkToolAllowed(tool, tier) {
  const normalized = normalizeTier(tier);
  if (normalized === 'DEV') return null;
  if (ALWAYS_ALLOW.has(tool)) return null;

  if (isMutation(tool)) {
    return {
      kind: 'mutation',
      reason: `${tool} mutates SAP objects; only DEV profiles may mutate.`,
    };
  }
  if (RUNTIME_EXEC.has(tool)) {
    if (normalized === 'QA' && QA_ALLOW.has(tool)) return null;
    return {
      kind: 'runtime',
      reason: `${tool} executes ABAP code on the server and is blocked on ${normalized} profiles.`,
    };
  }
  return null;
}

// Normalize SAP_TIER — enum DEV | QA | PRD. Non-canonical values default to DEV.
export function normalizeTier(value) {
  const v = String(value || '').trim().toUpperCase();
  return TIERS.includes(v) ? v : 'DEV';
}

export function sp4sapHome() {
  return process.env.SC4SAP_HOME_DIR || join(homedir(), '.sc4sap');
}

/** Minimal KEY=VALUE dotenv parser. Returns {} on missing/unreadable file. */
export function parseDotenvText(text) {
  const out = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Read SAP_TIER from a dotenv file. Returns null when absent. */
export function readTierFromEnvFile(envFilePath) {
  if (!envFilePath || !existsSync(envFilePath)) return null;
  try {
    const env = parseDotenvText(readFileSync(envFilePath, 'utf8'));
    return env.SAP_TIER ? normalizeTier(env.SAP_TIER) : null;
  } catch {
    return null;
  }
}

/** Read the alias from <dir>/.sc4sap/active-profile.txt, or null. */
export function readActiveAlias(projectDir) {
  const p = join(projectDir, '.sc4sap', 'active-profile.txt');
  if (!existsSync(p)) return null;
  try {
    const alias = readFileSync(p, 'utf8').trim();
    return alias.length > 0 ? alias : null;
  } catch {
    return null;
  }
}

/** Walk up from `start` to the nearest ancestor containing `.sc4sap/`. */
export function walkUpForProject(start, maxDepth = 8) {
  let dir = start;
  for (let i = 0; i < maxDepth; i++) {
    if (existsSync(join(dir, '.sc4sap'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

/**
 * Resolve the effective tier for a session.
 *
 * Precedence:
 *   0. explicit `envFile` (SC4SAP_ENV_FILE / MCP_ENV_PATH) — lets a generic MCP
 *      client point at a profile env with an absolute path, no cwd dependency.
 *   1. <projectDir>/.sc4sap/active-profile.txt → <home>/profiles/<alias>/sap.env
 *   2. <projectDir>/.sc4sap/sap.env  (legacy single-profile layout)
 *
 * Returns { tier, alias, source, legacy, resolved }. `tier` defaults to DEV when
 * nothing can be read — the same fail-open posture as the hook, because the L2
 * server guard still enforces independently.
 */
export function resolveTierContext({ startDir = process.cwd(), envFile = null } = {}) {
  if (envFile) {
    const tier = readTierFromEnvFile(envFile);
    if (tier) {
      return {
        tier,
        alias: aliasFromEnvPath(envFile),
        source: envFile,
        legacy: false,
        resolved: true,
      };
    }
  }

  const projectDir = walkUpForProject(startDir);
  const alias = readActiveAlias(projectDir);
  if (alias) {
    const source = join(sp4sapHome(), 'profiles', alias, 'sap.env');
    const tier = readTierFromEnvFile(source);
    return { tier: tier ?? 'DEV', alias, source, legacy: false, resolved: tier !== null };
  }

  const legacySource = join(projectDir, '.sc4sap', 'sap.env');
  const tier = readTierFromEnvFile(legacySource);
  return {
    tier: tier ?? 'DEV',
    alias: null,
    source: legacySource,
    legacy: true,
    resolved: tier !== null,
  };
}

/**
 * Recover the profile alias from a `<home>/profiles/<alias>/sap.env` path.
 * Used when the caller supplied an explicit env file, which bypasses the
 * active-profile.txt lookup that would otherwise name the profile.
 */
export function aliasFromEnvPath(envFilePath) {
  const parts = String(envFilePath || '').split(/[\\/]/);
  const i = parts.lastIndexOf('profiles');
  if (i !== -1 && parts.length >= i + 3) return parts[i + 1] || null;
  return null;
}

/** Human-readable denial text shared by the hook, the CLI and the proxy. */
export function formatDenyMessage({ tool, alias, tier, reason, source, legacy = false }) {
  const profileLabel = alias || (legacy ? '(legacy single-profile)' : '(unresolved)');
  const lines = [
    'sp4sap tier-readonly-guard — DENIED',
    `  tool:    ${tool}`,
    `  profile: ${profileLabel}`,
    `  tier:    ${tier}`,
    `  reason:  ${reason}`,
  ];
  if (source) lines.push(`  source:  ${source}`);
  lines.push(
    '',
    'Switch to a DEV profile via /sp4sap:sap-option, then retry.',
    '(This check is backed by the MCP server-side guard — bypassing this layer does not bypass enforcement.)',
  );
  return lines.join('\n');
}
