#!/usr/bin/env node

/**
 * sp4sap Activation Trigger Hook (PostToolUse) — SAP-SPECIFIC
 *
 * Automatically reminds to activate ABAP objects after creation or modification.
 * Fires after successful MCP ABAP Create*/Update* tool calls.
 *
 * SAP objects must be activated after creation or modification to take effect.
 * This hook injects a reminder to check for inactive objects and activate them.
 *
 * It does NOT auto-execute activation — it provides guidance to the model
 * to use GetInactiveObjects and then activate as needed.
 */

import { readStdin } from './lib/stdin.mjs';

// Tools that create or modify ABAP objects requiring activation
const ACTIVATION_TOOLS = new Set([
  // Create operations
  'mcp__mcp-abap-adt__CreateClass',
  'mcp__mcp-abap-adt__CreateInterface',
  'mcp__mcp-abap-adt__CreateProgram',
  'mcp__mcp-abap-adt__CreateFunctionGroup',
  'mcp__mcp-abap-adt__CreateFunctionModule',
  'mcp__mcp-abap-adt__CreateTable',
  'mcp__mcp-abap-adt__CreateStructure',
  'mcp__mcp-abap-adt__CreateDataElement',
  'mcp__mcp-abap-adt__CreateDomain',
  'mcp__mcp-abap-adt__CreateView',
  'mcp__mcp-abap-adt__CreateInclude',
  'mcp__mcp-abap-adt__CreateServiceDefinition',
  'mcp__mcp-abap-adt__CreateServiceBinding',
  'mcp__mcp-abap-adt__CreateBehaviorDefinition',
  'mcp__mcp-abap-adt__CreateBehaviorImplementation',
  'mcp__mcp-abap-adt__CreateMetadataExtension',
  'mcp__mcp-abap-adt__CreateScreen',
  'mcp__mcp-abap-adt__CreateGuiStatus',
  // Update operations
  'mcp__mcp-abap-adt__UpdateClass',
  'mcp__mcp-abap-adt__UpdateInterface',
  'mcp__mcp-abap-adt__UpdateProgram',
  'mcp__mcp-abap-adt__UpdateFunctionGroup',
  'mcp__mcp-abap-adt__UpdateFunctionModule',
  'mcp__mcp-abap-adt__UpdateTable',
  'mcp__mcp-abap-adt__UpdateStructure',
  'mcp__mcp-abap-adt__UpdateDataElement',
  'mcp__mcp-abap-adt__UpdateDomain',
  'mcp__mcp-abap-adt__UpdateView',
  'mcp__mcp-abap-adt__UpdateInclude',
  'mcp__mcp-abap-adt__UpdateServiceDefinition',
  'mcp__mcp-abap-adt__UpdateServiceBinding',
  'mcp__mcp-abap-adt__UpdateBehaviorDefinition',
  'mcp__mcp-abap-adt__UpdateBehaviorImplementation',
  'mcp__mcp-abap-adt__UpdateMetadataExtension',
  'mcp__mcp-abap-adt__UpdateScreen',
  'mcp__mcp-abap-adt__UpdateGuiStatus',
  'mcp__mcp-abap-adt__UpdateLocalDefinitions',
  'mcp__mcp-abap-adt__UpdateLocalTypes',
  'mcp__mcp-abap-adt__UpdateLocalMacros',
  'mcp__mcp-abap-adt__UpdateLocalTestClass',
]);

// Check if the tool output indicates success (no error)
function isSuccessfulResult(toolOutput) {
  if (!toolOutput) return false;
  // If the output contains error indicators, skip activation reminder
  const errorPatterns = [
    /\berror\b/i,
    /\bfailed\b/i,
    /\bexception\b/i,
    /\babort\b/i,
    /status["\s:]*[45]\d{2}/i,
  ];
  return !errorPatterns.some(p => p.test(toolOutput));
}

async function main() {
  try {
    const input = await readStdin();
    if (!input.trim()) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    let data = {};
    try { data = JSON.parse(input); } catch {}

    const toolName = data.tool_name || data.toolName || '';
    const rawResponse = data.tool_response || data.toolOutput || '';
    const toolOutput = typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse);

    // Only trigger for ABAP object Create/Update tools
    if (!ACTIVATION_TOOLS.has(toolName)) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Only trigger if the operation was successful
    if (!isSuccessfulResult(toolOutput)) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Extract object info for the reminder
    const toolInput = data.tool_input || data.toolInput || {};
    const objectName = toolInput.name || toolInput.objectName || toolInput.object_name || '';
    const action = toolName.includes('Create') ? 'created' : 'modified';

    const objectLabel = objectName ? ` "${objectName}"` : '';

    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `[SC4SAP ACTIVATION] ABAP object${objectLabel} was ${action}. ` +
          `Remember to activate it. Recommended workflow: ` +
          `(1) Run GetAbapSemanticAnalysis to check for syntax errors, ` +
          `(2) Use GetInactiveObjects to see all pending activations, ` +
          `(3) Activate the object(s). ` +
          `Do NOT release transports with inactive objects.`
      }
    }));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
