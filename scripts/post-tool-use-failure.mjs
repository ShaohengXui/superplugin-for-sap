#!/usr/bin/env node

/**
 * sp4sap Post-Tool-Use-Failure Hook
 * Tracks tool failures for retry guidance.
 * Writes last-tool-error.json with tool name, error, and retry count.
 * Adapted from OMC post-tool-use-failure.mjs.
 */

import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join, sep, resolve } from 'path';
import { readStdin } from './lib/stdin.mjs';
import { atomicWriteFileSync } from './lib/atomic-write.mjs';

const RETRY_WINDOW_MS = 60000;
const MAX_ERROR_LENGTH = 500;
const MAX_INPUT_PREVIEW_LENGTH = 200;

function isPathContained(targetPath, basePath) {
  const normalizedTarget = resolve(targetPath);
  const normalizedBase = resolve(basePath);
  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

function initStateDir(directory) {
  const cwd = process.cwd();
  if (!isPathContained(directory, cwd)) directory = cwd;

  const stateDir = join(directory, '.sc4sap', 'state');
  if (!existsSync(stateDir)) {
    try { mkdirSync(stateDir, { recursive: true }); } catch {}
  }
  return stateDir;
}

function truncate(str, maxLength) {
  if (!str) return '';
  const text = String(str);
  return text.length <= maxLength ? text : text.slice(0, maxLength) + '...';
}

function createInputPreview(toolInput) {
  if (!toolInput) return '';
  try {
    const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);
    return truncate(inputStr, MAX_INPUT_PREVIEW_LENGTH);
  } catch {
    return truncate(String(toolInput), MAX_INPUT_PREVIEW_LENGTH);
  }
}

function readErrorState(statePath) {
  try {
    if (!existsSync(statePath)) return null;
    return JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch {
    return null;
  }
}

function calculateRetryCount(existingState, toolName, currentTime) {
  if (!existingState || existingState.tool_name !== toolName) return 1;
  const lastErrorTime = new Date(existingState.timestamp).getTime();
  if (!Number.isFinite(lastErrorTime)) return 1;
  if (currentTime - lastErrorTime > RETRY_WINDOW_MS) return 1;
  return (existingState.retry_count || 1) + 1;
}

async function main() {
  try {
    const input = await readStdin();
    const data = JSON.parse(input);

    const toolName = data.tool_name || '';
    const toolInput = data.tool_input;
    const error = data.error || '';
    const isInterrupt = data.is_interrupt || false;
    const directory = data.cwd || data.directory || process.cwd();

    if (isInterrupt || !toolName || !error) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    const stateDir = initStateDir(directory);
    const statePath = join(stateDir, 'last-tool-error.json');
    const existingState = readErrorState(statePath);
    const retryCount = calculateRetryCount(existingState, toolName, Date.now());
    const inputPreview = createInputPreview(toolInput);

    const errorState = {
      tool_name: toolName,
      tool_input_preview: inputPreview,
      error: truncate(error, MAX_ERROR_LENGTH),
      timestamp: new Date().toISOString(),
      retry_count: retryCount,
    };

    try { atomicWriteFileSync(statePath, JSON.stringify(errorState, null, 2)); } catch {}

    let guidance;
    if (retryCount >= 5) {
      guidance = `Tool "${toolName}" has failed ${retryCount} times. Stop retrying the same approach -- try a different command, check dependencies, or ask the user for guidance.`;
    } else {
      guidance = `Tool "${toolName}" failed. Analyze the error, fix the issue, and continue working.`;
    }

    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUseFailure',
        additionalContext: guidance,
      },
    }));
  } catch (error) {
    console.log(JSON.stringify({ continue: true }));
  }
}

main();
