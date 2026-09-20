#!/usr/bin/env node

/**
 * sp4sap Persistent Mode Hook (Stop)
 * Minimal continuation enforcer for sp4sap modes.
 * Adapted from OMC persistent-mode.cjs.
 *
 * Supported modes: ralph, autopilot
 * Uses CommonJS for reliability (no ESM import issues).
 */

'use strict';

const { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } = require('fs');
const { join, dirname } = require('path');
const { homedir } = require('os');

async function readStdin(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; process.stdin.removeAllListeners(); process.stdin.destroy(); resolve(Buffer.concat(chunks).toString('utf-8')); }
    }, timeoutMs);
    process.stdin.on('data', (chunk) => { chunks.push(chunk); });
    process.stdin.on('end', () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(Buffer.concat(chunks).toString('utf-8')); } });
    process.stdin.on('error', () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(''); } });
    if (process.stdin.readableEnded) { if (!settled) { settled = true; clearTimeout(timeout); resolve(Buffer.concat(chunks).toString('utf-8')); } }
  });
}

function readJsonFile(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch { return null; }
}

function writeJsonFile(path, data) {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, path);
    return true;
  } catch { return false; }
}

const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;

function getStatePath(directory, modeName, sessionId) {
  const stateDir = join(directory, '.sc4sap', 'state');
  if (sessionId && SESSION_ID_PATTERN.test(sessionId)) {
    return join(stateDir, 'sessions', sessionId, `${modeName}-state.json`);
  }
  return join(stateDir, `${modeName}-state.json`);
}

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

async function main() {
  try {
    const input = await readStdin();
    let data = {};
    try { data = JSON.parse(input); } catch {}

    const directory = data.cwd || data.directory || process.cwd();
    const sessionId = data.session_id || data.sessionId || '';

    // Never block context_limit or user-requested stops
    if (isContextLimitStop(data) || isUserAbort(data)) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Check for active modes
    const modes = ['ralph', 'autopilot'];
    let activeMode = null;
    let activeState = null;

    for (const mode of modes) {
      const statePath = getStatePath(directory, mode, sessionId);
      const state = readJsonFile(statePath);
      if (state?.active) {
        // Skip if awaiting confirmation (user hasn't confirmed yet)
        if (state.awaiting_confirmation) continue;
        activeMode = mode;
        activeState = state;
        break;
      }
    }

    if (!activeMode || !activeState) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Increment iteration for ralph
    if (activeMode === 'ralph') {
      const maxIterations = activeState.max_iterations || 100;
      const iteration = (activeState.iteration || 1) + 1;

      if (iteration > maxIterations) {
        // Max iterations reached — allow stop
        activeState.active = false;
        activeState.completed_at = new Date().toISOString();
        const statePath = getStatePath(directory, activeMode, sessionId);
        writeJsonFile(statePath, activeState);

        console.log(JSON.stringify({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext: `[SC4SAP] Ralph loop reached max iterations (${maxIterations}). Stopping.`
          }
        }));
        return;
      }

      activeState.iteration = iteration;
      activeState.last_checked_at = new Date().toISOString();
      const statePath = getStatePath(directory, activeMode, sessionId);
      writeJsonFile(statePath, activeState);
    }

    // Block the stop and continue
    console.log(JSON.stringify({
      decision: 'block',
      reason: `[SC4SAP] ${activeMode} mode is active. The boulder never stops. ` +
        `Continue until all tasks complete. ` +
        `Use "cancelsp4sap" or "stopsp4sap" to end the mode.`
    }));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
