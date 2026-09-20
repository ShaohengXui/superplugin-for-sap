#!/usr/bin/env node

/**
 * sp4sap PreCompact Hook: Project Memory Preservation
 * Ensures user directives and project context survive compaction.
 * Adapted from OMC project-memory-precompact.mjs.
 */

import { existsSync, readFileSync } from 'fs';
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
    const input = await readStdin();
    let data = {};
    try { data = JSON.parse(input); } catch {}

    const directory = data.cwd || data.directory || process.cwd();

    // Load project memory
    const memoryPath = join(directory, '.sc4sap', 'project-memory.json');
    const memory = readJsonFile(memoryPath);

    if (!memory || !memory.userDirectives?.length) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Re-inject user directives so they survive compaction
    const directives = memory.userDirectives.map(d => `- ${d}`).join('\n');
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreCompact',
        additionalContext: `<project-memory-preserve>\n\n[USER DIRECTIVES - Preserve across compaction]\n${directives}\n\n</project-memory-preserve>`
      }
    }));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
