#!/usr/bin/env node

/**
 * sp4sap Transport Validator Hook (PreToolUse) — SAP-SPECIFIC
 *
 * Validates that a transport request exists before allowing MCP ABAP
 * Create/Update tools to execute. This enforces the SAP transport policy:
 * every change must be assigned to a transport request.
 *
 * Checks:
 * 1. Tool is an MCP ABAP Create* or Update* tool
 * 2. Tool input contains a transport parameter
 * 3. If no transport, injects a reminder to create/specify one
 *
 * This hook is ADVISORY (non-blocking). It injects a reminder but does
 * not deny the tool execution, since some objects (like local $TMP packages)
 * don't require transports.
 */

import { readStdin } from './lib/stdin.mjs';

// MCP ABAP tools that require a transport for non-local objects
const TRANSPORT_REQUIRED_TOOLS = new Set([
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
  'mcp__mcp-abap-adt__CreatePackage',
  'mcp__mcp-abap-adt__CreateInclude',
  'mcp__mcp-abap-adt__CreateServiceDefinition',
  'mcp__mcp-abap-adt__CreateServiceBinding',
  'mcp__mcp-abap-adt__CreateBehaviorDefinition',
  'mcp__mcp-abap-adt__CreateBehaviorImplementation',
  'mcp__mcp-abap-adt__CreateMetadataExtension',
  'mcp__mcp-abap-adt__CreateScreen',
  'mcp__mcp-abap-adt__CreateGuiStatus',
  'mcp__mcp-abap-adt__CreateTextElement',
  'mcp__mcp-abap-adt__CreateUnitTest',
  'mcp__mcp-abap-adt__CreateCdsUnitTest',
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
  'mcp__mcp-abap-adt__UpdateTextElement',
  'mcp__mcp-abap-adt__UpdateUnitTest',
  'mcp__mcp-abap-adt__UpdateCdsUnitTest',
  'mcp__mcp-abap-adt__UpdateLocalDefinitions',
  'mcp__mcp-abap-adt__UpdateLocalTypes',
  'mcp__mcp-abap-adt__UpdateLocalMacros',
  'mcp__mcp-abap-adt__UpdateLocalTestClass',
]);

// Packages that don't require transports
const LOCAL_PACKAGES = new Set(['$TMP', '$tmp', 'LOCAL', 'local']);

function isLocalPackage(toolInput) {
  const pkg = toolInput?.package || toolInput?.devclass || toolInput?.packageName || '';
  return LOCAL_PACKAGES.has(pkg.toUpperCase() === '$TMP' ? '$TMP' : pkg);
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
    const toolInput = data.tool_input || data.toolInput || {};

    // Only check MCP ABAP Create/Update tools
    if (!TRANSPORT_REQUIRED_TOOLS.has(toolName)) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Skip check for local packages ($TMP)
    if (isLocalPackage(toolInput)) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Check if transport is specified in the tool input
    const transport = toolInput.transport || toolInput.transportRequest ||
                      toolInput.transport_request || toolInput.corrNr || '';

    if (!transport) {
      const objectName = toolInput.name || toolInput.objectName || toolInput.object_name || 'unknown';
      const action = toolName.includes('Create') ? 'creating' : 'updating';

      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: `[SC4SAP TRANSPORT CHECK] You are ${action} SAP object "${objectName}" without specifying a transport request. ` +
            `SAP policy requires all changes to be assigned to a transport. ` +
            `Please either: (1) specify a transport parameter, (2) use CreateTransport to create one first, ` +
            `or (3) use ListTransports to find an existing one. ` +
            `Exception: objects in $TMP package do not require transports.`
        }
      }));
      return;
    }

    // Transport is specified — allow silently
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
