#!/usr/bin/env node
/**
 * sp4sap PreToolUse hook — Tier Readonly Guard (L1)
 *
 * Blocks mutation / code-execution MCP tool calls when the currently active
 * SAP profile is QA or PRD. Layer 1 of the two-layer defense (MCP server is
 * Layer 2).
 *
 * The block matrix lives in `scripts/lib/tier-guard.mjs` — shared verbatim with
 * the MCP-layer proxy guard (`bridge/mcp-server.cjs`) and the standalone
 * `scripts/tier-guard-cli.mjs`, so all three can never disagree.
 *
 * Tier resolution (see resolveTierContext in the shared lib):
 *   0. $SC4SAP_ENV_FILE / $MCP_ENV_PATH — explicit env file, absolute path
 *   1. Walk up from cwd to `.sc4sap/active-profile.txt`
 *      → $SC4SAP_HOME_DIR/profiles/<alias>/sap.env  (fallback ~/.sc4sap/...)
 *   2. <projectDir>/.sc4sap/sap.env  (legacy single-profile mode)
 *
 * This hook does NOT pre-filter by tool name: it evaluates every tool the
 * client routes to it and exits 0 for anything outside the matrix. That keeps
 * it correct even when a client's matcher regex is narrower than the matrix
 * (the matcher in scripts/install-hooks.mjs is a routing optimization, not a
 * security boundary).
 *
 * Known unguarded vector (tracked separately, deliberately NOT blocked here):
 *   RuntimeCallDispatch invokes an arbitrary ZMCP_ADT_DISPATCH action, and the
 *   action name is a runtime argument — so write actions (SSF_UPLOAD, …) cannot
 *   be told apart from read actions (SSF_EXISTS, CUA_FETCH, …) by tool name
 *   alone. Blocking it outright would also remove its read uses on QA/PRD.
 *
 * Failure mode: fails OPEN on any parse/IO error. MCP server L2 guard still
 * enforces, so missing hook = slower UX but not unsafe.
 */

import {
  checkToolAllowed,
  formatDenyMessage,
  resolveTierContext,
  shortToolName,
} from '../lib/tier-guard.mjs';

function readStdin() {
  return new Promise((done) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => done(data));
    process.stdin.on('error', () => done(data));
    setTimeout(() => done(data), 1500).unref?.();
  });
}

async function main() {
  const raw = await readStdin();
  if (!raw) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const tool = shortToolName(payload.tool_name || payload.toolName || '');
  if (!tool) process.exit(0);

  let ctx;
  try {
    ctx = resolveTierContext({
      startDir: process.cwd(),
      envFile: process.env.SC4SAP_ENV_FILE || process.env.MCP_ENV_PATH || null,
    });
  } catch {
    process.exit(0);
  }

  const denial = checkToolAllowed(tool, ctx.tier);
  if (!denial) process.exit(0);

  const message = formatDenyMessage({
    tool,
    alias: ctx.alias,
    tier: ctx.tier,
    reason: denial.reason,
    source: ctx.source,
    legacy: ctx.legacy,
  });

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: message,
      },
    }),
  );
  process.exit(0);
}

main();
