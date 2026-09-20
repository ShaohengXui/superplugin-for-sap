#!/usr/bin/env node
/**
 * sp4sap tier-guard CLI — enforce the QA/PRD block matrix outside Claude Code.
 *
 * Claude Code gets L1 enforcement from scripts/hooks/tier-readonly-guard.mjs.
 * Zcode and Codex have their own hook systems, and some clients have none at
 * all — this CLI is the portable entry point for all of those, plus CI.
 *
 * Usage
 *   # Explicit tool (scripted / CI)
 *   node scripts/tier-guard-cli.mjs --tool UpdateClass
 *   node scripts/tier-guard-cli.mjs --tool UpdateClass --tier PRD --json
 *
 *   # Hook mode — reads a hook payload on stdin, auto-detects tool_name
 *   echo '{"tool_name":"mcp__sap__UpdateClass"}' | node scripts/tier-guard-cli.mjs
 *
 *   # Diagnostics
 *   node scripts/tier-guard-cli.mjs --explain
 *
 * Output formats (--format)
 *   claude (default) — Claude Code / Zcode PreToolUse JSON on stdout
 *   plain            — human message on stderr, nothing on stdout
 *
 * Exit codes
 *   0  allowed
 *   3  denied  (distinct so a hook wrapper can tell "block" from "crashed")
 *   2  usage / IO error
 *
 * Tier resolution follows scripts/lib/tier-guard.mjs: $SC4SAP_ENV_FILE /
 * $MCP_ENV_PATH first, then .sc4sap/active-profile.txt walk-up, then the
 * legacy <project>/.sc4sap/sap.env. --tier overrides resolution entirely.
 *
 * Note this is a convenience/UX layer: the authoritative, uncircumventable
 * enforcement is the guard inside the MCP server (L2). This CLI exists so a
 * non-Claude client can reject a doomed call before it hits the wire.
 */

import { readFileSync } from 'node:fs';
import {
  checkToolAllowed,
  formatDenyMessage,
  resolveTierContext,
  shortToolName,
} from './lib/tier-guard.mjs';

const DENY_EXIT = 3;
const ERR_EXIT = 2;

function parseArgs(argv) {
  const opts = { tool: null, tier: null, json: false, explain: false, format: 'claude' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tool') opts.tool = argv[++i] ?? null;
    else if (a === '--tier') opts.tier = argv[++i] ?? null;
    else if (a === '--format') opts.format = argv[++i] ?? 'claude';
    else if (a === '--json') opts.json = true;
    else if (a === '--explain') opts.explain = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function readStdinSync() {
  try {
    if (process.stdin.isTTY) return '';
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function toolFromStdinPayload(raw) {
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    return payload.tool_name || payload.toolName || null;
  } catch {
    // Tolerate a raw tool name on stdin (e.g. `echo UpdateClass | ...`).
    const bare = raw.trim();
    return /^[\w:-]+$/.test(bare) ? bare : null;
  }
}

const HELP = `sp4sap tier-guard — block SAP mutations on QA/PRD

  --tool <name>     MCP tool name or handler name (e.g. UpdateClass)
  --tier <tier>     DEV | QA | PRD (overrides profile resolution)
  --format <fmt>    claude (default) | plain
  --json            machine-readable result on stdout
  --explain         print resolved tier context and exit 0
  --help            this text

Exit: 0 allowed · ${DENY_EXIT} denied · ${ERR_EXIT} error`;

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  const stdinRaw = opts.tool ? '' : readStdinSync();
  const rawTool = opts.tool || toolFromStdinPayload(stdinRaw);
  const tool = shortToolName(rawTool);

  const ctx = resolveTierContext({
    startDir: process.cwd(),
    envFile: process.env.SC4SAP_ENV_FILE || process.env.MCP_ENV_PATH || null,
  });
  const tier = opts.tier ? String(opts.tier).toUpperCase() : ctx.tier;

  if (opts.explain) {
    process.stdout.write(
      `${JSON.stringify(
        {
          tier,
          tierSource: opts.tier ? 'cli-flag' : ctx.resolved ? ctx.source : 'default(DEV)',
          alias: ctx.alias,
          legacy: ctx.legacy,
          envFile: ctx.source,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  if (!tool) {
    process.stderr.write(
      `sp4sap tier-guard: no tool name. Pass --tool <name> or pipe a hook payload on stdin.\n`,
    );
    return ERR_EXIT;
  }

  const denial = checkToolAllowed(tool, tier);

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({
        tool,
        tier,
        alias: ctx.alias,
        allowed: !denial,
        kind: denial?.kind ?? null,
        reason: denial?.reason ?? null,
      })}\n`,
    );
  }

  if (!denial) return 0;

  const message = formatDenyMessage({
    tool,
    alias: ctx.alias,
    tier,
    reason: denial.reason,
    source: ctx.resolved ? ctx.source : null,
    legacy: ctx.legacy,
  });

  if (opts.format === 'plain') {
    process.stderr.write(`${message}\n`);
    return DENY_EXIT;
  }

  // Claude Code / Zcode PreToolUse contract.
  if (!opts.json) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: message,
        },
      })}\n`,
    );
  }
  return DENY_EXIT;
}

process.exit(main());
