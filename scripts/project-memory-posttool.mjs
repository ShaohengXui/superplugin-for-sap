#!/usr/bin/env node

/**
 * sp4sap PostToolUse Hook: Project Memory Learning
 * Learns from tool outputs and updates project memory.
 * Adapted from OMC project-memory-posttool.mjs.
 *
 * Tracks SAP-specific patterns:
 * - Transport request numbers from Create/Update tool responses
 * - Object names and types from MCP ABAP tool responses
 * - Errors for retry guidance
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
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

// Save JSON file safely
function writeJsonFile(path, data) {
  try {
    const dir = join(path, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch {}
}

// Detect transport number in tool output
function extractTransport(output) {
  const match = output.match(/\b([A-Z]{3}K\d{6})\b/);
  return match ? match[1] : null;
}

// Detect SAP object name in tool output
function extractSapObject(toolName, output) {
  // Extract object name from successful Create/Get/Update results
  const nameMatch = output.match(/"(?:name|objectName|object_name)"\s*:\s*"([^"]+)"/i);
  return nameMatch ? nameMatch[1] : null;
}

async function main() {
  try {
    const input = await readStdin();
    const data = JSON.parse(input);

    const toolName = data.tool_name || data.toolName || '';
    const rawResponse = data.tool_response || data.toolOutput || '';
    const toolOutput = typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse);
    const directory = data.cwd || data.directory || process.cwd();

    // Only track MCP ABAP tool outputs
    if (!toolName.startsWith('mcp__mcp-abap-adt__')) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Load existing project memory
    const memoryPath = join(directory, '.sc4sap', 'project-memory.json');
    const memory = readJsonFile(memoryPath) || {
      techStack: { languages: ['ABAP'], frameworks: ['SAP'] },
      sapModules: [],
      userDirectives: [],
      customNotes: [],
      recentObjects: [],
      recentTransports: [],
    };

    let updated = false;

    // Track transport numbers
    const transport = extractTransport(toolOutput);
    if (transport) {
      if (!memory.recentTransports) memory.recentTransports = [];
      if (!memory.recentTransports.includes(transport)) {
        memory.recentTransports.unshift(transport);
        // Keep only last 20 transports
        if (memory.recentTransports.length > 20) memory.recentTransports.pop();
        updated = true;
      }
    }

    // Track SAP object names
    const objectName = extractSapObject(toolName, toolOutput);
    if (objectName) {
      if (!memory.recentObjects) memory.recentObjects = [];
      const existing = memory.recentObjects.findIndex(o => o.name === objectName);
      if (existing >= 0) {
        memory.recentObjects[existing].lastAccessed = new Date().toISOString();
        memory.recentObjects[existing].toolUsed = toolName;
      } else {
        memory.recentObjects.unshift({
          name: objectName,
          toolUsed: toolName,
          lastAccessed: new Date().toISOString()
        });
        // Keep only last 50 objects
        if (memory.recentObjects.length > 50) memory.recentObjects.pop();
      }
      updated = true;
    }

    if (updated) {
      writeJsonFile(memoryPath, memory);
    }

    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
