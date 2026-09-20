#!/usr/bin/env node

/**
 * sp4sap Syntax Checker Hook (PostToolUseFailure) — SAP-SPECIFIC
 *
 * When an MCP ABAP tool fails (Create/Update operations), this hook
 * automatically suggests running GetAbapSemanticAnalysis to diagnose
 * the issue. This helps catch ABAP syntax errors early.
 *
 * Triggers on:
 * - MCP ABAP Create* tool failures
 * - MCP ABAP Update* tool failures
 *
 * Output: Advisory message suggesting semantic analysis.
 * Does NOT auto-execute the analysis — provides guidance to the model.
 */

import { readStdin } from './lib/stdin.mjs';

// MCP ABAP tools that should trigger syntax check suggestion on failure
const ABAP_MODIFY_TOOLS_PREFIX = 'mcp__mcp-abap-adt__';
const MODIFY_ACTIONS = ['Create', 'Update'];

function isAbapModifyTool(toolName) {
  if (!toolName.startsWith(ABAP_MODIFY_TOOLS_PREFIX)) return false;
  const action = toolName.slice(ABAP_MODIFY_TOOLS_PREFIX.length);
  return MODIFY_ACTIONS.some(a => action.startsWith(a));
}

// Extract the object name from tool input for contextual guidance
function extractObjectInfo(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return { name: '', type: '' };

  const name = toolInput.name || toolInput.objectName || toolInput.object_name || '';
  // Infer type from tool name suffix (e.g., CreateClass -> Class)
  const type = toolInput.type || toolInput.objectType || '';

  return { name, type };
}

// Check if the error looks like an ABAP syntax/semantic error
function isAbapSyntaxError(error) {
  const syntaxPatterns = [
    /syntax\s+error/i,
    /semantic\s+error/i,
    /activation\s+failed/i,
    /type\s+conflict/i,
    /unknown\s+type/i,
    /field\s+"[^"]+"\s+is\s+unknown/i,
    /method\s+"[^"]+"\s+is\s+unknown/i,
    /class\s+"[^"]+"\s+is\s+unknown/i,
    /interface\s+"[^"]+"\s+is\s+unknown/i,
    /variable\s+"[^"]+"\s+is\s+already\s+defined/i,
    /statement\s+is\s+not\s+accessible/i,
    /\bABAP\b.*\berror\b/i,
  ];
  return syntaxPatterns.some(p => p.test(error));
}

async function main() {
  try {
    const input = await readStdin();
    const data = JSON.parse(input);

    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};
    const error = data.error || '';
    const isInterrupt = data.is_interrupt || false;

    // Skip on user interrupt
    if (isInterrupt) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Only trigger for ABAP Create/Update tools
    if (!isAbapModifyTool(toolName)) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    const { name: objectName } = extractObjectInfo(toolInput);
    const objectLabel = objectName ? ` for "${objectName}"` : '';

    let guidance;
    if (isAbapSyntaxError(error)) {
      guidance = `[SC4SAP SYNTAX CHECK] ABAP error detected${objectLabel}. ` +
        `Run GetAbapSemanticAnalysis to get detailed syntax/semantic analysis. ` +
        `Common fixes: check spelling of types/variables, verify interface implementations, ` +
        `ensure all referenced objects exist and are active. ` +
        `After fixing, retry the operation.`;
    } else {
      guidance = `[SC4SAP ERROR] MCP ABAP tool "${toolName}" failed${objectLabel}. ` +
        `Consider running GetAbapSemanticAnalysis to check for underlying syntax issues. ` +
        `Also verify: (1) the object exists, (2) you have authorization, ` +
        `(3) the transport request is valid, (4) the object is not locked by another user.`;
    }

    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUseFailure',
        additionalContext: guidance,
      },
    }));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
