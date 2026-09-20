#!/usr/bin/env node
// Apply an Anthropic plan preset to the HUD usage-limit env vars
// in ~/.claude/settings.json → env.
//
// Usage:
//   node scripts/hud/apply-plan.mjs <plan>
//     where <plan> ∈ pro | max5x | max20x | team | api (aliases allowed)
//   node scripts/hud/apply-plan.mjs --show       # print current env + preset table
//   node scripts/hud/apply-plan.mjs --unset      # remove the three keys
//
// Values are estimates from plan-presets.json. User can override individually
// via /sp4sap:sap-option HUD flow.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESETS_PATH = path.join(__dirname, 'plan-presets.json');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const KEYS = ['SC4SAP_5H_LIMIT_USD', 'SC4SAP_WEEKLY_LIMIT_USD', 'SC4SAP_WEEKLY_EXTRA_LIMIT_USD'];

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function resolvePlan(name, presets) {
  const lc = String(name || '').toLowerCase().trim();
  if (presets.plans[lc]) return lc;
  for (const [canonical, list] of Object.entries(presets.aliases || {})) {
    if (list.includes(lc)) return canonical;
  }
  return null;
}

function showTable(presets, current) {
  console.log('Current HUD env (~/.claude/settings.json):');
  for (const k of KEYS) console.log(`  ${k} = ${current[k] ?? '(unset)'}`);
  console.log('\nAvailable plans (5h / weekly / extra, USD):');
  for (const [name, v] of Object.entries(presets.plans)) {
    console.log(`  ${name.padEnd(8)} ${String(v.fiveH).padStart(4)}  ${String(v.weekly).padStart(4)}  ${String(v.extra).padStart(4)}`);
  }
}

const arg = process.argv[2];
const presets = readJson(PRESETS_PATH);
if (!presets) { console.error('plan-presets.json not found'); process.exit(1); }
const settings = readJson(SETTINGS_PATH, {});
settings.env = settings.env || {};

if (!arg || arg === '--show') {
  showTable(presets, settings.env);
  process.exit(0);
}

if (arg === '--unset') {
  for (const k of KEYS) delete settings.env[k];
  writeJson(SETTINGS_PATH, settings);
  console.log('✅ Removed HUD limit env vars. Restart Claude Code.');
  process.exit(0);
}

const plan = resolvePlan(arg, presets);
if (!plan) {
  console.error(`Unknown plan: ${arg}`);
  showTable(presets, settings.env);
  process.exit(1);
}

const v = presets.plans[plan];
settings.env.SC4SAP_5H_LIMIT_USD = String(v.fiveH);
settings.env.SC4SAP_WEEKLY_LIMIT_USD = String(v.weekly);
settings.env.SC4SAP_WEEKLY_EXTRA_LIMIT_USD = String(v.extra);
writeJson(SETTINGS_PATH, settings);

console.log(`✅ Applied plan "${plan}":`);
console.log(`   5h=$${v.fiveH}  weekly=$${v.weekly}  extra=$${v.extra}`);
console.log('   Restart Claude Code to apply.');
