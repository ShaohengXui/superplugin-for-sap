#!/usr/bin/env node

/**
 * sp4sap Permission Handler Hook (PermissionRequest, matcher: Bash)
 * Handles Bash permission requests with SAP-aware context.
 * Adapted from OMC permission-handler.mjs.
 *
 * Auto-approves safe operations, warns on destructive ones.
 */

import { readStdin } from './lib/stdin.mjs';

// Safe bash patterns that can be auto-approved
const SAFE_PATTERNS = [
  /^(ls|dir|cat|head|tail|wc|find|grep|rg|fd)\b/,
  /^git\s+(status|log|diff|branch|show|remote)\b/,
  /^node\s+--version/,
  /^npm\s+(ls|list|view|info)\b/,
  /^echo\b/,
  /^pwd$/,
  /^which\b/,
  /^type\b/,
];

// Dangerous patterns that should warn
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf?\s+\//,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\bcurl\s.*\|\s*(sh|bash)\b/,
];

async function main() {
  try {
    const input = await readStdin();
    let data = {};
    try { data = JSON.parse(input); } catch {}

    const toolInput = data.tool_input || data.toolInput || {};
    const command = typeof toolInput === 'string' ? toolInput : (toolInput.command || '');

    if (!command) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Check for dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        console.log(JSON.stringify({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            additionalContext: `[SC4SAP WARNING] Potentially dangerous command detected. Proceed with caution.`
          }
        }));
        return;
      }
    }

    // Safe commands pass through silently
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
