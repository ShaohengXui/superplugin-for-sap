#!/usr/bin/env node

/**
 * sp4sap Session Start Hook
 * Restores persistent mode states and injects SAP context on session start.
 * Adapted from OMC session-start.mjs.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { readStdin } from './lib/stdin.mjs';

// Read JSON file safely
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
    const sessionId = data.session_id || data.sessionId || '';
    const messages = [];

    // Inject SAP development context reminder
    messages.push(`<system-reminder>
[SC4SAP] SuperPlugin for SAP is active. SAP development standards enforced:
- Custom objects require Z/Y prefix
- All changes must be assigned to transport requests
- Objects must be activated after creation/modification
- Use MCP ABAP ADT tools for all SAP system interactions
- Follow ABAP Clean Code guidelines
</system-reminder>

---
`);

    // Check for active autopilot state
    const stateDir = join(directory, '.sc4sap', 'state');
    const autopilotState = readJsonFile(join(stateDir, 'autopilot-state.json'));
    if (autopilotState?.active) {
      messages.push(`<session-restore>

[SAP AUTOPILOT MODE RESTORED]

You have an active SAP autopilot session from ${autopilotState.started_at}.
Original task: ${autopilotState.original_prompt}

Treat this as prior-session context only. Prioritize the user's newest request.

</session-restore>

---
`);
    }

    // Check for active ralph state
    const ralphState = readJsonFile(join(stateDir, 'ralph-state.json'));
    if (ralphState?.active) {
      messages.push(`<session-restore>

[SAP RALPH LOOP RESTORED]

You have an active ralph-loop session.
Original task: ${ralphState.prompt || 'SAP task in progress'}
Iteration: ${ralphState.iteration || 1}/${ralphState.max_iterations || 100}

Treat this as prior-session context only. Prioritize the user's newest request.

</session-restore>

---
`);
    }

    // Check for notepad Priority Context
    const notepadPath = join(directory, '.sc4sap', 'notepad.md');
    if (existsSync(notepadPath)) {
      try {
        const notepadContent = readFileSync(notepadPath, 'utf-8');
        const priorityMatch = notepadContent.match(/## Priority Context\n([\s\S]*?)(?=## |$)/);
        if (priorityMatch && priorityMatch[1].trim()) {
          const cleanContent = priorityMatch[1].trim().replace(/<!--[\s\S]*?-->/g, '').trim();
          if (cleanContent) {
            messages.push(`<notepad-context>
[NOTEPAD - Priority Context]
${cleanContent}
</notepad-context>`);
          }
        }
      } catch {}
    }

    if (messages.length > 0) {
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: messages.join('\n')
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
