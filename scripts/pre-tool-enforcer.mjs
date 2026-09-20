#!/usr/bin/env node

/**
 * sp4sap PreToolUse Hook: Reminder Enforcer
 * Injects contextual reminders before every tool execution.
 * Adapted from OMC pre-tool-enforcer.mjs with SAP-specific guidance.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { readStdin } from './lib/stdin.mjs';

// Simple JSON field extraction
function extractJsonField(input, field, defaultValue = '') {
  try {
    const data = JSON.parse(input);
    return data[field] ?? defaultValue;
  } catch {
    const match = input.match(new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, 'i'));
    return match ? match[1] : defaultValue;
  }
}

// Get todo status from project-local todos
function getTodoStatus(directory) {
  let pending = 0;
  let inProgress = 0;

  const localPaths = [
    join(directory, '.sc4sap', 'todos.json'),
    join(directory, '.claude', 'todos.json')
  ];

  for (const todoFile of localPaths) {
    if (existsSync(todoFile)) {
      try {
        const data = JSON.parse(readFileSync(todoFile, 'utf-8'));
        const todos = data.todos || (Array.isArray(data) ? data : []);
        pending += todos.filter(t => t.status === 'pending').length;
        inProgress += todos.filter(t => t.status === 'in_progress').length;
      } catch {}
    }
  }

  if (pending + inProgress > 0) {
    return `[${inProgress} active, ${pending} pending] `;
  }
  return '';
}

// Generate contextual message based on tool type
function generateMessage(toolName, todoStatus) {
  const messages = {
    TodoWrite: `${todoStatus}Mark todos in_progress BEFORE starting, completed IMMEDIATELY after finishing.`,
    Bash: `${todoStatus}Use parallel execution for independent tasks. Use run_in_background for long operations.`,
    Edit: `${todoStatus}Verify changes work after editing. Test functionality before marking complete.`,
    Write: `${todoStatus}Verify changes work after editing. Test functionality before marking complete.`,
    Read: `${todoStatus}Read multiple files in parallel when possible for faster analysis.`,
    Grep: `${todoStatus}Combine searches in parallel when investigating multiple patterns.`,
    Glob: `${todoStatus}Combine searches in parallel when investigating multiple patterns.`,
    Task: `${todoStatus}Launch multiple agents in parallel when tasks are independent. Use run_in_background for long operations.`,
  };

  return messages[toolName] || '';
}

async function main() {
  if (process.env.DISABLE_SC4SAP === '1') {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  try {
    const input = await readStdin();

    const toolName = extractJsonField(input, 'tool_name') || extractJsonField(input, 'toolName', 'unknown');
    const directory = extractJsonField(input, 'cwd') || extractJsonField(input, 'directory', process.cwd());

    const todoStatus = getTodoStatus(directory);
    const message = generateMessage(toolName, todoStatus);

    if (!message) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: message
      }
    }));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
