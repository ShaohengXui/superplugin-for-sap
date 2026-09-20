#!/usr/bin/env node

/**
 * sp4sap PreCompact Hook
 * Preserves important context before compaction occurs.
 * Adapted from OMC pre-compact.mjs.
 *
 * Saves critical state to .sc4sap/ so it survives compaction:
 * - Active SAP objects being worked on
 * - Transport request numbers
 * - Current task context
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
    const messages = [];

    // Inject project memory summary for post-compact context
    const memoryPath = join(directory, '.sc4sap', 'project-memory.json');
    const memory = readJsonFile(memoryPath);
    if (memory) {
      const parts = [];
      if (memory.sapModules?.length) {
        parts.push(`SAP Modules: ${memory.sapModules.join(', ')}`);
      }
      if (memory.recentTransports?.length) {
        parts.push(`Recent Transports: ${memory.recentTransports.slice(0, 5).join(', ')}`);
      }
      if (memory.recentObjects?.length) {
        const objectNames = memory.recentObjects.slice(0, 10).map(o => o.name);
        parts.push(`Recent Objects: ${objectNames.join(', ')}`);
      }
      if (memory.userDirectives?.length) {
        parts.push(`User Directives:\n${memory.userDirectives.map(d => `  - ${d}`).join('\n')}`);
      }

      if (parts.length > 0) {
        messages.push(`[SC4SAP CONTEXT PRESERVATION]\n${parts.join('\n')}`);
      }
    }

    // Inject notepad priority context
    const notepadPath = join(directory, '.sc4sap', 'notepad.md');
    if (existsSync(notepadPath)) {
      try {
        const notepadContent = readFileSync(notepadPath, 'utf-8');
        const priorityMatch = notepadContent.match(/## Priority Context\n([\s\S]*?)(?=## |$)/);
        if (priorityMatch && priorityMatch[1].trim()) {
          const cleanContent = priorityMatch[1].trim().replace(/<!--[\s\S]*?-->/g, '').trim();
          if (cleanContent) {
            messages.push(`[NOTEPAD - Priority Context]\n${cleanContent}`);
          }
        }
      } catch {}
    }

    if (messages.length > 0) {
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreCompact',
          additionalContext: messages.join('\n\n---\n\n')
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
