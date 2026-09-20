#!/usr/bin/env node

/**
 * sp4sap SPRO Injector Hook (UserPromptSubmit) — SAP-SPECIFIC
 *
 * Detects SAP module context in user prompts and injects relevant
 * SPRO (SAP Project Reference Object) configuration data.
 *
 * Classification strategy:
 * 1. Try Haiku LLM classification via @anthropic-ai/sdk (fast, accurate)
 * 2. Fall back to keyword-based regex matching if API key unavailable
 *
 * Reads from: configs/{MODULE}/spro.md
 * Injects SPRO config data as additionalContext so the model
 * has reference configuration tables and transaction codes.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { readStdin } from './lib/stdin.mjs';

// SAP module keyword patterns for fallback classification
const MODULE_PATTERNS = {
  SD: /\b(sales\s*(order|document|pricing|billing|delivery|shipment|credit\s*memo|debit\s*memo|quotation|inquiry|contract|scheduling\s*agreement|rebate|output\s*determination)|sd\b|vbak|vbap|vbrk|likp|lips|va0[1-3]|vl0[1-3]|vf0[1-3]|vtfl|vofm|pricing\s*procedure|partner\s*determination|copy\s*control|item\s*categor|schedule\s*line)/i,
  MM: /\b(material\s*management|purchase\s*(order|requisition|group|organization)|vendor|mm\b|ekko|ekpo|eban|mara|marc|mard|me2[1-3mn]|migo|miro|mb5[1-9b]|source\s*list|quota\s*arrangement|info\s*record|material\s*type|valuation|procurement|goods\s*receipt)/i,
  FI: /\b(financ|general\s*ledger|accounts\s*(payable|receivable)|asset\s*accounting|fi\b|bkpf|bseg|bsid|bsad|bsis|bsas|fb[0-9]{2}|f-[0-9]{2}|fs00|chart\s*of\s*accounts|company\s*code|fiscal\s*year|posting\s*period|tax|withholding|dunning|payment\s*program|house\s*bank)/i,
  CO: /\b(controlling|cost\s*(center|element|object)|profit\s*center|internal\s*order|co\b|csks|cska|cepc|aufk|cobk|ka0[1-3]|ks0[1-3]|ke5[1-9]|cost\s*allocation|assessment|distribution|activity\s*type|statistical\s*key\s*figure|profitability\s*analysis|copa)/i,
  PP: /\b(production\s*(planning|order)|bom|bill\s*of\s*material|routing|work\s*center|pp\b|aufk|afko|afpo|stko|stpo|plko|crhd|md0[1-4]|co0[1-3]|cs0[1-3]|ca0[1-3]|mrp|capacity\s*planning|demand\s*management|shop\s*floor)/i,
  PS: /\b(project\s*(system|definition|builder)|wbs(\s*element)?|network\s*(activity|header)?|milestone(\s*billing)?|ps\b|proj\b|prps\b|afko\b|afvc\b|cj0[1-9]|cj2[0-9]|cj3[0-9]|cj4[0-9]|cj8[0-9]|cn2[1-7]|dp8[1-9]|dp9[1-9]|rpsco|budget\s*profile|settlement\s*profile|dip\s*profile|resource.related\s*billing|progress\s*analysis|investment\s*program)/i,
  PM: /\b(plant\s*maintenance|equipment|functional\s*location|maintenance\s*(order|plan|notification)|pm\b|equi|iflo|aufk|qmel|mpla|iw3[1-3n]|ia0[1-9]|ip0[1-9]|preventive|corrective|breakdown)/i,
  QM: /\b(quality\s*management|inspection|qm\b|qals|qasr|qave|qa0[1-3]|qp0[1-3]|inspection\s*(lot|plan|point|char)|quality\s*(notification|certificate)|sampling|usage\s*decision)/i,
  HCM: /\b(human\s*(capital|resource)|personnel|payroll|hcm\b|hr\b|pa0[0-9]{3}|pa[1-4]0|infotype|organizational\s*management|time\s*management|benefits|compensation|recruitment|talent)/i,
  WM: /\b(warehouse\s*management|storage\s*(bin|type|section|unit)|wm\b|lqua|lagp|lein|ls0[1-9]|lt0[1-9]|transfer\s*order|transfer\s*requirement|picking|putaway|inventory\s*management)/i,
  TM: /\b(transportation\s*management|shipment\s*(document|cost)|freight|tm\b|vttk|vttp|vt0[1-3]|carrier|route|shipping\s*point|loading\s*point|leg|stage)/i,
  BW: /\b(business\s*warehouse|bw\b|bi\b|infocube|datasource|dso|data\s*store\s*object|extraction|info\s*provider|query\s*designer|bex|transformation|data\s*transfer\s*process|open\s*hub)/i,
  TR: /\b(treasury|cash\s*management|tr\b|bank\s*accounting|cash\s*position|liquidity\s*forecast|financial\s*instrument|deal|position\s*management|market\s*risk|credit\s*risk)/i,
  Ariba: /\b(ariba|sourcing|procurement|supplier|contract\s*management|spend\s*analysis|p2p|procure.to.pay|buying|rfx|auction)/i,
};

// Available module config directories
function getAvailableModules(pluginRoot) {
  const configsDir = join(pluginRoot, 'configs');
  if (!existsSync(configsDir)) return [];

  try {
    return readdirSync(configsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

/**
 * Classify SAP module using Haiku LLM.
 * Returns the module name or null if classification fails.
 */
async function classifyWithHaiku(prompt, availableModules) {
  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: `Classify this SAP-related prompt into exactly one SAP module from this list: ${availableModules.join(', ')}. Reply with ONLY the module abbreviation (e.g., "SD", "MM", "FI"). If the prompt is not SAP-related or you cannot classify it, reply "NONE".\n\nPrompt: ${prompt.slice(0, 500)}`
      }],
    });

    const result = response.content?.[0]?.text?.trim().toUpperCase();
    if (result && result !== 'NONE' && availableModules.includes(result)) {
      return result;
    }
    return null;
  } catch {
    // API call failed — fall back to keyword matching
    return null;
  }
}

/**
 * Classify SAP module using keyword regex patterns.
 * Returns the best matching module name or null.
 */
function classifyWithKeywords(prompt) {
  const promptLower = prompt.toLowerCase();
  const matches = [];

  for (const [module, pattern] of Object.entries(MODULE_PATTERNS)) {
    const matchResult = promptLower.match(pattern);
    if (matchResult) {
      // Score based on match position (earlier = more relevant) and match count
      const allMatches = promptLower.match(new RegExp(pattern.source, 'gi'));
      const score = (allMatches ? allMatches.length : 1) * 10;
      matches.push({ module, score });
    }
  }

  if (matches.length === 0) return null;

  // Return highest scoring module
  matches.sort((a, b) => b.score - a.score);
  return matches[0].module;
}

/**
 * Read SPRO config data for a module.
 */
function readSproConfig(pluginRoot, module) {
  const sproPath = join(pluginRoot, 'configs', module, 'spro.md');
  if (!existsSync(sproPath)) return null;

  try {
    const content = readFileSync(sproPath, 'utf-8');
    if (!content.trim()) return null;
    return content;
  } catch {
    return null;
  }
}

/**
 * Read additional config files for a module (tcodes, bapi, workflows).
 */
function readModuleConfigs(pluginRoot, module) {
  const configs = {};
  const configFiles = ['tcodes.md', 'bapi.md', 'workflows.md'];

  for (const file of configFiles) {
    const filePath = join(pluginRoot, 'configs', module, file);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        if (content.trim()) {
          configs[file.replace('.md', '')] = content;
        }
      } catch {}
    }
  }

  return configs;
}

async function main() {
  if (process.env.DISABLE_SC4SAP === '1') {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  try {
    const input = await readStdin();
    if (!input.trim()) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    let data = {};
    try { data = JSON.parse(input); } catch {}

    const prompt = data.prompt || '';
    if (!prompt || prompt.length < 10) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
    if (!pluginRoot) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Get available module config directories
    const availableModules = getAvailableModules(pluginRoot);
    if (availableModules.length === 0) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Step 1: Try Haiku LLM classification
    let detectedModule = await classifyWithHaiku(prompt, availableModules);

    // Step 2: Fall back to keyword matching
    if (!detectedModule) {
      const keywordModule = classifyWithKeywords(prompt);
      if (keywordModule && availableModules.includes(keywordModule)) {
        detectedModule = keywordModule;
      }
    }

    if (!detectedModule) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Read SPRO config for the detected module
    const sproContent = readSproConfig(pluginRoot, detectedModule);
    if (!sproContent) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Read additional configs
    const additionalConfigs = readModuleConfigs(pluginRoot, detectedModule);

    // Build injection message
    const parts = [
      `<sp4sap-spro module="${detectedModule}">`,
      '',
      `## SAP Module: ${detectedModule} — SPRO Configuration Reference`,
      '',
      sproContent,
    ];

    // Add additional configs if available
    if (additionalConfigs.tcodes) {
      parts.push('', '## Transaction Codes', '', additionalConfigs.tcodes);
    }
    if (additionalConfigs.bapi) {
      parts.push('', '## BAPIs / Function Modules', '', additionalConfigs.bapi);
    }
    if (additionalConfigs.workflows) {
      parts.push('', '## Development Workflows', '', additionalConfigs.workflows);
    }

    parts.push('', `</sp4sap-spro>`);

    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: parts.join('\n')
      }
    }));
  } catch (error) {
    // Never block user workflow on SPRO injection failure
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
