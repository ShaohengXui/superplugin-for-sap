#!/usr/bin/env node
// Inject sp4sap HUD statusLine into the user's Claude Code settings.json.
// Idempotent: overwrites any existing statusLine only if --force, otherwise
// leaves a user-customized statusLine untouched.
//
// Usage:
//   node scripts/hud/install-statusline.mjs           # install (skip if present)
//   node scripts/hud/install-statusline.mjs --force   # overwrite existing
//   node scripts/hud/install-statusline.mjs --uninstall

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const UNINSTALL = args.has('--uninstall');

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..', '..');
const statuslineScript = path.join(pluginRoot, 'scripts', 'hud', 'statusline.mjs').replace(/\\/g, '/');

const desired = {
  type: 'command',
  command: `node "${statuslineScript}"`,
  padding: 0,
};

function readJson(p) {
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

const settings = readJson(settingsPath);

if (UNINSTALL) {
  if (settings.statusLine) {
    delete settings.statusLine;
    writeJson(settingsPath, settings);
    console.log('✅ Removed statusLine from', settingsPath);
  } else {
    console.log('ℹ️  No statusLine set; nothing to remove.');
  }
  process.exit(0);
}

const current = settings.statusLine;
const isSc4sap = current && typeof current.command === 'string' && current.command.includes('sp4sap') && current.command.includes('statusline.mjs');

if (current && !isSc4sap && !FORCE) {
  console.log('⚠️  Existing non-sp4sap statusLine found in', settingsPath);
  console.log('    Current:', JSON.stringify(current));
  console.log('    Re-run with --force to overwrite.');
  process.exit(0);
}

settings.statusLine = desired;
writeJson(settingsPath, settings);
console.log('✅ Installed sp4sap HUD statusLine into', settingsPath);
console.log('   Restart Claude Code to see it render below the input box.');
