#!/usr/bin/env node

/**
 * sp4sap Skill Injector Hook (UserPromptSubmit)
 * Injects relevant learned skills into context based on prompt triggers.
 * Adapted from OMC skill-injector.mjs.
 *
 * Searches for .md skill files in:
 * - Project-level: .sc4sap/skills/
 * - Plugin-level: $CLAUDE_PLUGIN_ROOT/skills/
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'fs';
import { join } from 'path';
import { readStdin } from './lib/stdin.mjs';

const SKILL_EXTENSION = '.md';
const MAX_SKILLS_PER_SESSION = 5;

// In-memory cache (resets each process invocation)
const injectedCache = new Map();

// Parse YAML frontmatter from skill file
function parseSkillFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const yamlContent = match[1];
  const body = match[2].trim();

  const triggers = [];
  const triggerMatch = yamlContent.match(/triggers:\s*\n((?:\s+-\s*.+\n?)*)/);
  if (triggerMatch) {
    const lines = triggerMatch[1].split('\n');
    for (const line of lines) {
      const itemMatch = line.match(/^\s+-\s*["']?([^"'\n]+)["']?\s*$/);
      if (itemMatch) triggers.push(itemMatch[1].trim().toLowerCase());
    }
  }

  const nameMatch = yamlContent.match(/name:\s*["']?([^"'\n]+)["']?/);
  const name = nameMatch ? nameMatch[1].trim() : 'Unnamed Skill';

  return { name, triggers, content: body };
}

// Find all skill files
function findSkillFiles(directory) {
  const candidates = [];
  const seenPaths = new Set();
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;

  // Project-level skills (higher priority)
  const projectDir = join(directory, '.sc4sap', 'skills');
  if (existsSync(projectDir)) {
    try {
      for (const file of readdirSync(projectDir, { withFileTypes: true })) {
        if (file.isFile() && file.name.endsWith(SKILL_EXTENSION)) {
          const fullPath = join(projectDir, file.name);
          try {
            const realPath = realpathSync(fullPath);
            if (!seenPaths.has(realPath)) {
              seenPaths.add(realPath);
              candidates.push({ path: fullPath, scope: 'project' });
            }
          } catch {}
        }
      }
    } catch {}
  }

  // Plugin-level skills
  if (pluginRoot) {
    const pluginSkillsDir = join(pluginRoot, 'skills');
    if (existsSync(pluginSkillsDir)) {
      try {
        for (const file of readdirSync(pluginSkillsDir, { withFileTypes: true })) {
          if (file.isFile() && file.name.endsWith(SKILL_EXTENSION)) {
            const fullPath = join(pluginSkillsDir, file.name);
            try {
              const realPath = realpathSync(fullPath);
              if (!seenPaths.has(realPath)) {
                seenPaths.add(realPath);
                candidates.push({ path: fullPath, scope: 'plugin' });
              }
            } catch {}
          }
        }
      } catch {}
    }
  }

  return candidates;
}

// Find matching skills for the prompt
function findMatchingSkills(prompt, directory, sessionId) {
  const promptLower = prompt.toLowerCase();
  const candidates = findSkillFiles(directory);
  const matches = [];

  if (!injectedCache.has(sessionId)) {
    if (injectedCache.size > 500) injectedCache.clear();
    injectedCache.set(sessionId, new Set());
  }
  const alreadyInjected = injectedCache.get(sessionId);

  for (const candidate of candidates) {
    if (alreadyInjected.has(candidate.path)) continue;

    try {
      const content = readFileSync(candidate.path, 'utf-8');
      const skill = parseSkillFrontmatter(content);
      if (!skill) continue;

      let score = 0;
      for (const trigger of skill.triggers) {
        if (promptLower.includes(trigger)) score += 10;
      }

      if (score > 0) {
        matches.push({
          path: candidate.path,
          name: skill.name,
          content: skill.content,
          score,
          scope: candidate.scope,
          triggers: skill.triggers
        });
      }
    } catch {}
  }

  matches.sort((a, b) => b.score - a.score);
  const selected = matches.slice(0, MAX_SKILLS_PER_SESSION);

  for (const skill of selected) {
    alreadyInjected.add(skill.path);
  }

  return selected;
}

// Format skills for injection
function formatSkillsMessage(skills) {
  const lines = [
    '<sp4sap-skills>',
    '',
    '## Relevant SAP Skills',
    '',
    'The following skills may help with this SAP task:',
    ''
  ];

  for (const skill of skills) {
    lines.push(`### ${skill.name} (${skill.scope})`);
    lines.push('');
    lines.push(skill.content);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('</sp4sap-skills>');
  return lines.join('\n');
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

    const prompt = data.prompt || '';
    const sessionId = data.session_id || data.sessionId || 'unknown';
    const directory = data.cwd || process.cwd();

    if (!prompt) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    const matchingSkills = findMatchingSkills(prompt, directory, sessionId);

    if (matchingSkills.length > 0) {
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: formatSkillsMessage(matchingSkills)
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
