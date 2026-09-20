#!/usr/bin/env node

/**
 * sp4sap Session End Hook
 * Performs cleanup tasks when a session ends.
 * Adapted from OMC session-end.mjs.
 *
 * Cleanup:
 * - Deactivate stale mode states
 * - Log session summary to .sc4sap/logs/
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { readStdin } from './lib/stdin.mjs';

function readJsonFile(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

async function main() {
  try {
    const input = await readStdin(1000);
    let data = {};
    try { data = JSON.parse(input); } catch {}

    const directory = data.cwd || data.directory || process.cwd();
    const sessionId = data.session_id || data.sessionId || '';

    // Deactivate any active mode states
    const stateDir = join(directory, '.sc4sap', 'state');
    if (existsSync(stateDir)) {
      const modeFiles = ['ralph-state.json', 'autopilot-state.json'];
      for (const file of modeFiles) {
        const statePath = join(stateDir, file);
        const state = readJsonFile(statePath);
        if (state?.active) {
          state.active = false;
          state.ended_at = new Date().toISOString();
          state.end_reason = 'session_end';
          try {
            writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
          } catch {}
        }
      }
    }

    // Log session summary
    const logsDir = join(directory, '.sc4sap', 'logs');
    if (!existsSync(logsDir)) {
      try { mkdirSync(logsDir, { recursive: true }); } catch {}
    }

    const sessionLog = {
      session_id: sessionId,
      ended_at: new Date().toISOString(),
      directory,
    };

    // Append to daily log
    const today = new Date().toISOString().split('T')[0];
    const logFile = join(logsDir, `sessions-${today}.jsonl`);
    try {
      const logLine = JSON.stringify(sessionLog) + '\n';
      const { appendFileSync } = await import('fs');
      appendFileSync(logFile, logLine);
    } catch {}

    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
