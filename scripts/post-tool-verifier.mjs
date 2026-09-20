#!/usr/bin/env node

/**
 * sp4sap PostToolUse Hook: Verification Reminder System
 * Monitors tool execution and provides contextual guidance.
 * Adapted from OMC post-tool-verifier.mjs with SAP-specific awareness.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { readStdin } from './lib/stdin.mjs';

const cfgDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const STATE_FILE = join(cfgDir, '.sc4sap-session-stats.json');

try {
  if (!existsSync(cfgDir)) mkdirSync(cfgDir, { recursive: true });
} catch {}

function loadStats() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {}
  return { sessions: {} };
}

function saveStats(stats) {
  const tmpFile = `${STATE_FILE}.tmp.${process.pid}`;
  try {
    writeFileSync(tmpFile, JSON.stringify(stats, null, 2));
    renameSync(tmpFile, STATE_FILE);
  } catch {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function updateStats(toolName, sessionId) {
  const stats = loadStats();
  if (!stats.sessions[sessionId]) {
    stats.sessions[sessionId] = { tool_counts: {}, total_calls: 0 };
  }
  const session = stats.sessions[sessionId];
  session.tool_counts[toolName] = (session.tool_counts[toolName] || 0) + 1;
  session.total_calls = (session.total_calls || 0) + 1;
  saveStats(stats);
  return session.tool_counts[toolName];
}

// Detect failures in Bash output
function detectBashFailure(output) {
  const errorPatterns = [
    /error:/i, /failed/i, /cannot/i, /permission denied/i,
    /command not found/i, /no such file/i, /exit code: [1-9]/i,
    /fatal:/i, /abort/i,
  ];
  return errorPatterns.some(p => p.test(output));
}

// Detect write failure
function detectWriteFailure(output) {
  const errorPatterns = [
    /\berror:/i, /\bfailed to\b/i, /\bwrite failed\b/i,
    /permission denied/i, /read-only/i, /\bno such file\b/i,
  ];
  return errorPatterns.some(p => p.test(output));
}

// Generate contextual message
function generateMessage(toolName, toolOutput, toolCount) {
  switch (toolName) {
    case 'Bash':
      if (detectBashFailure(toolOutput)) {
        return 'Command failed. Please investigate the error and fix before continuing.';
      }
      break;

    case 'Task':
    case 'TaskCreate':
      if (detectWriteFailure(toolOutput)) {
        return 'Task delegation failed. Verify agent name and parameters.';
      }
      break;

    case 'Edit':
      if (detectWriteFailure(toolOutput)) {
        return 'Edit operation failed. Verify file exists and content matches exactly.';
      }
      return 'Code modified. Verify changes work as expected before marking complete.';

    case 'Write':
      if (detectWriteFailure(toolOutput)) {
        return 'Write operation failed. Check file permissions and directory existence.';
      }
      return 'File written. Test the changes to ensure they work correctly.';

    case 'Read':
      if (toolCount > 10) {
        return `Extensive reading (${toolCount} files). Consider using Grep for pattern searches.`;
      }
      break;
  }

  return '';
}

async function main() {
  if (process.env.DISABLE_SC4SAP === '1') {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  try {
    const input = await readStdin();
    const data = JSON.parse(input);

    const toolName = data.tool_name || data.toolName || '';
    const rawResponse = data.tool_response || data.toolOutput || '';
    const toolOutput = typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse);
    const sessionId = data.session_id || data.sessionId || 'unknown';

    const toolCount = updateStats(toolName, sessionId);
    const message = generateMessage(toolName, toolOutput, toolCount);

    if (message) {
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: message
        }
      }));
    } else {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    }
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
