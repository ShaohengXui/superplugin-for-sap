#!/usr/bin/env node

/**
 * sp4sap Context Guard Hook (Stop)
 * Suggests session refresh when context usage exceeds a warning threshold.
 * Adapted from OMC context-guard-stop.mjs.
 *
 * Safety rules:
 *   - Never block context_limit stops (would cause compaction deadlock)
 *   - Never block user-requested stops (respect Ctrl+C / cancel)
 *   - Max 2 blocks per session (retry guard prevents infinite loops)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { readStdin } from './lib/stdin.mjs';

const THRESHOLD = parseInt(process.env.SC4SAP_CONTEXT_GUARD_THRESHOLD || '75', 10);
const MAX_BLOCKS = 2;

function isContextLimitStop(data) {
  const reasons = [
    data.stop_reason, data.stopReason, data.end_turn_reason,
    data.endTurnReason, data.reason,
  ].filter(v => typeof v === 'string' && v.trim().length > 0)
   .map(v => v.toLowerCase().replace(/[\s-]+/g, '_'));

  const contextPatterns = [
    'context_limit', 'context_window', 'context_exceeded',
    'context_full', 'max_context', 'token_limit',
  ];

  return reasons.some(r => contextPatterns.some(p => r.includes(p)));
}

function isUserAbort(data) {
  if (data.user_requested || data.userRequested) return true;
  const reasons = [data.stop_reason, data.stopReason, data.reason]
    .filter(v => typeof v === 'string');
  return reasons.some(r => /cancel|abort|interrupt|ctrl.c/i.test(r));
}

function estimateContextPercent(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return 0;

  let fd = -1;
  try {
    const stat = statSync(transcriptPath);
    if (stat.size === 0) return 0;

    fd = openSync(transcriptPath, 'r');
    const readSize = Math.min(4096, stat.size);
    const buf = Buffer.alloc(readSize);
    readSync(fd, buf, 0, readSize, stat.size - readSize);
    closeSync(fd);
    fd = -1;

    const tail = buf.toString('utf-8');
    const windowMatch = tail.match(/"context_window"\s{0,5}:\s{0,5}(\d+)/g);
    const inputMatch = tail.match(/"input_tokens"\s{0,5}:\s{0,5}(\d+)/g);

    if (!windowMatch || !inputMatch) return 0;

    const lastWindow = parseInt(windowMatch[windowMatch.length - 1].match(/(\d+)/)[1], 10);
    const lastInput = parseInt(inputMatch[inputMatch.length - 1].match(/(\d+)/)[1], 10);

    if (lastWindow === 0) return 0;
    return Math.round((lastInput / lastWindow) * 100);
  } catch {
    return 0;
  } finally {
    if (fd !== -1) try { closeSync(fd); } catch {}
  }
}

async function main() {
  try {
    const input = await readStdin();
    let data = {};
    try { data = JSON.parse(input); } catch {}

    // Never block context_limit or user-requested stops
    if (isContextLimitStop(data) || isUserAbort(data)) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    const transcriptPath = data.transcript_path || data.transcriptPath || '';
    const contextPercent = estimateContextPercent(transcriptPath);

    if (contextPercent < THRESHOLD) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Check block count to prevent infinite loops
    const directory = data.cwd || data.directory || process.cwd();
    const stateDir = join(directory, '.sc4sap', 'state');
    const guardFile = join(stateDir, 'context-guard-blocks.json');

    let blockCount = 0;
    try {
      if (existsSync(guardFile)) {
        const state = JSON.parse(readFileSync(guardFile, 'utf-8'));
        blockCount = state.count || 0;
      }
    } catch {}

    if (blockCount >= MAX_BLOCKS) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Record block
    try {
      if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
      writeFileSync(guardFile, JSON.stringify({ count: blockCount + 1, lastBlock: new Date().toISOString() }));
    } catch {}

    console.log(JSON.stringify({
      decision: 'block',
      reason: `[SC4SAP] Context usage at ${contextPercent}% (threshold: ${THRESHOLD}%). ` +
        `Consider running /compact to free context space, or start a fresh session. ` +
        `Save important SAP object names and transport numbers to .sc4sap/notepad.md before compacting.`
    }));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
