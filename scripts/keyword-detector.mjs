#!/usr/bin/env node

/**
 * sp4sap Keyword Detector Hook (UserPromptSubmit)
 * Detects sp4sap: skill keywords and invokes skill tools.
 * Adapted from OMC keyword-detector.mjs for SAP-specific keywords.
 *
 * Supported keywords:
 * 1. cancelsp4sap: Stop active modes
 * 2. ralph: Persistence mode until task completion
 * 3. autopilot: Full autonomous SAP execution
 * 4. release: CTS transport release workflow
 * 5. mcp-setup: MCP ABAP ADT server configuration
 */

import { readStdin } from './lib/stdin.mjs';

// Extract prompt from various JSON structures
function extractPrompt(input) {
  try {
    const data = JSON.parse(input);
    if (data.prompt) return data.prompt;
    if (data.message?.content) return data.message.content;
    if (Array.isArray(data.parts)) {
      return data.parts
        .filter(p => p.type === 'text')
        .map(p => p.text)
        .join(' ');
    }
    return '';
  } catch {
    return '';
  }
}

// Sanitize text to prevent false positives from code blocks, URLs, file paths
function sanitizeForKeywordDetection(text) {
  return text
    .replace(/<(\w[\w-]*)[\s>][\s\S]*?<\/\1>/g, '')
    .replace(/<\w[\w-]*(?:\s[^>]*)?\s*\/>/g, '')
    .replace(/https?:\/\/[^\s)>\]]+/g, '')
    .replace(/(?<=^|[\s"'`(])(?:\/)?(?:[\w.-]+\/)+[\w.-]+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '');
}

// Check for informational context (questions about keywords, not activations)
const INFORMATIONAL_INTENT_PATTERNS = [
  /\b(?:what(?:'s|\s+is)|what\s+are|how\s+(?:to|do\s+i)\s+use|explain|tell\s+me\s+about|describe)\b/i,
];

function isInformationalKeywordContext(text, position, keywordLength) {
  const start = Math.max(0, position - 80);
  const end = Math.min(text.length, position + keywordLength + 80);
  const context = text.slice(start, end);
  return INFORMATIONAL_INTENT_PATTERNS.some((pattern) => pattern.test(context));
}

function hasActionableKeyword(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);

  for (const match of text.matchAll(globalPattern)) {
    if (match.index === undefined) continue;
    if (isInformationalKeywordContext(text, match.index, match[0].length)) continue;
    return true;
  }
  return false;
}

/**
 * Create a skill invocation message that tells Claude to use the Skill tool
 */
function createSkillInvocation(skillName, originalPrompt) {
  return `[MAGIC KEYWORD: ${skillName.toUpperCase()}]

You MUST invoke the skill using the Skill tool:

Skill: sp4sap:${skillName}

User request:
${originalPrompt}

IMPORTANT: Invoke the skill IMMEDIATELY. Do not proceed without loading the skill instructions.`;
}

/**
 * Create proper hook output with additionalContext
 */
function createHookOutput(additionalContext) {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext
    }
  };
}

async function main() {
  // Skip guard
  if (process.env.DISABLE_SC4SAP === '1') {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  try {
    const input = await readStdin();
    if (!input.trim()) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    const prompt = extractPrompt(input);
    if (!prompt) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    const cleanPrompt = sanitizeForKeywordDetection(prompt).toLowerCase();

    // Detect sp4sap-specific keywords
    let detectedSkill = null;

    // Cancel keywords
    if (hasActionableKeyword(cleanPrompt, /\b(cancelsp4sap|stopsp4sap)\b/i)) {
      detectedSkill = 'cancel';
    }
    // Autopilot — full autonomous SAP execution
    else if (hasActionableKeyword(cleanPrompt, /\bsp4sap[\s:]+autopilot\b/i) ||
             hasActionableKeyword(cleanPrompt, /\bsap\s+autopilot\b/i)) {
      detectedSkill = 'autopilot';
    }
    // Ralph — persistent loop with SAP verification
    else if (hasActionableKeyword(cleanPrompt, /\bsp4sap[\s:]+ralph\b/i) ||
             hasActionableKeyword(cleanPrompt, /\bsap\s+ralph\b/i)) {
      detectedSkill = 'ralph';
    }
    // Release — CTS transport release workflow
    else if (hasActionableKeyword(cleanPrompt, /\bsp4sap[\s:]+release\b/i) ||
             hasActionableKeyword(cleanPrompt, /\b(release\s+transport|transport\s+release)\b/i)) {
      detectedSkill = 'release';
    }
    // MCP Setup — MCP ABAP ADT configuration
    else if (hasActionableKeyword(cleanPrompt, /\bsp4sap[\s:]+mcp[\s-]?setup\b/i) ||
             hasActionableKeyword(cleanPrompt, /\b(setup|configure)\s+mcp[\s-]?abap\b/i)) {
      detectedSkill = 'mcp-setup';
    }
    // Setup — initial plugin setup
    else if (hasActionableKeyword(cleanPrompt, /\bsp4sap[\s:]+setup\b/i)) {
      detectedSkill = 'setup';
    }

    if (!detectedSkill) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    console.log(JSON.stringify(createHookOutput(createSkillInvocation(detectedSkill, prompt))));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
