#!/usr/bin/env node

/**
 * sp4sap Subagent Tracker Hook (SubagentStart/SubagentStop)
 * Tracks agent lifecycle for monitoring and debugging.
 * Adapted from OMC subagent-tracker.mjs.
 *
 * Usage:
 *   node subagent-tracker.mjs start  — called on SubagentStart
 *   node subagent-tracker.mjs stop   — called on SubagentStop
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { readStdin } from './lib/stdin.mjs';

function readJsonFile(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJsonFile(path, data) {
  try {
    const dir = join(path, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch {}
}

function processSubagentStart(data) {
  const directory = data.cwd || data.directory || process.cwd();
  const trackingFile = join(directory, '.sc4sap', 'state', 'subagent-tracking.json');

  const tracking = readJsonFile(trackingFile) || {
    agents: [],
    total_spawned: 0,
    total_completed: 0,
    total_failed: 0,
  };

  const agentId = data.agent_id || data.agentId || `agent-${Date.now()}`;
  const agentType = data.subagent_type || data.agent_type || 'unknown';

  tracking.agents.push({
    id: agentId,
    agent_type: agentType,
    status: 'running',
    started_at: new Date().toISOString(),
  });
  tracking.total_spawned = (tracking.total_spawned || 0) + 1;

  writeJsonFile(trackingFile, tracking);

  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: `sp4sap SubagentStart hook additional context: Agent ${agentType} started (${agentId})`
    }
  };
}

function processSubagentStop(data) {
  const directory = data.cwd || data.directory || process.cwd();
  const trackingFile = join(directory, '.sc4sap', 'state', 'subagent-tracking.json');

  const tracking = readJsonFile(trackingFile) || {
    agents: [],
    total_spawned: 0,
    total_completed: 0,
    total_failed: 0,
  };

  const agentId = data.agent_id || data.agentId || '';
  const success = data.success !== false;

  // Find and update the agent entry
  const agentIndex = tracking.agents.findIndex(a => a.id === agentId);
  if (agentIndex >= 0) {
    tracking.agents[agentIndex].status = success ? 'completed' : 'failed';
    tracking.agents[agentIndex].stopped_at = new Date().toISOString();
  }

  if (success) {
    tracking.total_completed = (tracking.total_completed || 0) + 1;
  } else {
    tracking.total_failed = (tracking.total_failed || 0) + 1;
  }

  // Remove completed/failed agents older than 10 minutes to prevent unbounded growth
  const cutoff = Date.now() - 10 * 60 * 1000;
  tracking.agents = tracking.agents.filter(a => {
    if (a.status === 'running') return true;
    const stoppedAt = a.stopped_at ? new Date(a.stopped_at).getTime() : 0;
    return stoppedAt > cutoff;
  });

  writeJsonFile(trackingFile, tracking);

  return { continue: true, suppressOutput: true };
}

async function main() {
  const action = process.argv[2]; // 'start' or 'stop'

  try {
    const input = await readStdin();
    const data = JSON.parse(input);

    let result;
    if (action === 'start') {
      result = processSubagentStart(data);
    } else if (action === 'stop') {
      result = processSubagentStop(data);
    } else {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();
