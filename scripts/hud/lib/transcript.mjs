// Fast transcript JSONL scanner. Reads only the tail (~256KB) to stay <50ms.
import { openSync, readSync, closeSync, statSync, existsSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';

const TAIL_BYTES = 256 * 1024;

export function readTail(path, bytes = TAIL_BYTES) {
  if (!existsSync(path)) return '';
  const st = statSync(path);
  const size = st.size;
  const start = Math.max(0, size - bytes);
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function* iterLines(text) {
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    if (nl === -1) { yield text.slice(i); return; }
    yield text.slice(i, nl);
    i = nl + 1;
  }
}

function safeJson(line) {
  if (!line || line[0] !== '{') return null;
  try { return JSON.parse(line); } catch { return null; }
}

// Find the most recent assistant usage block — that gives "current context size".
// CC transcripts embed message.usage on assistant entries.
export function latestUsage(transcriptPath) {
  const tail = readTail(transcriptPath);
  const lines = tail.split('\n');
  // skip possibly partial first line
  for (let i = lines.length - 1; i >= 1; i--) {
    const rec = safeJson(lines[i]);
    if (!rec) continue;
    const msg = rec.message || rec;
    const usage = msg.usage || rec.usage;
    if (usage && (usage.input_tokens != null || usage.output_tokens != null)) {
      return { usage, model: msg.model || rec.model };
    }
  }
  return null;
}

// Heuristic: is the agent currently working?
// We use two signals together:
//   1. mtime freshness — CC streams tokens into the transcript as they arrive,
//      so a transcript modified within the last few seconds almost always means
//      an in-flight response.
//   2. last assistant record has tool_use blocks without a trailing tool_result
//      → CC is waiting on a tool callback.
// Returns { working: boolean, mtimeAgoMs: number } so the caller can pick a
// color/style based on recency.
export function activityState(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return { working: false, mtimeAgoMs: Infinity };
  }
  let st; try { st = statSync(transcriptPath); } catch { return { working: false, mtimeAgoMs: Infinity }; }
  const ago = Date.now() - st.mtimeMs;

  // Structural decision first (robust). mtime is only a tiebreaker.
  const tail = readTail(transcriptPath, 128 * 1024);
  const lines = tail.split('\n');

  // Find the last parseable assistant record — that tells us the turn state.
  let lastAssistantIdx = -1;
  let lastAssistant = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const r = safeJson(lines[i]);
    if (!r) continue;
    if ((r.type || r.role) === 'assistant') { lastAssistantIdx = i; lastAssistant = r; break; }
  }
  if (!lastAssistant) {
    // No assistant record yet → definitely idle (user just started).
    return { working: false, mtimeAgoMs: ago };
  }

  const msg = lastAssistant.message || lastAssistant;
  const stopReason = msg.stop_reason || lastAssistant.stop_reason;
  const content = msg.content || lastAssistant.content || [];

  // If the turn ended cleanly (end_turn / stop_sequence), we're idle.
  if (stopReason === 'end_turn' || stopReason === 'stop_sequence' || stopReason === 'refusal') {
    return { working: false, mtimeAgoMs: ago };
  }

  // If the assistant is waiting on tool results, collect pending tool_use ids
  // and see if all were answered afterwards.
  const toolUseIds = [];
  if (Array.isArray(content)) {
    for (const b of content) if (b?.type === 'tool_use' && b.id) toolUseIds.push(b.id);
  }
  // Collect pending tool_use blocks along with their names / subagent types
  // so the HUD can report *what* the agent is doing, not just that it's busy.
  const toolUseBlocks = [];
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b?.type === 'tool_use' && b.id) {
        // Identify the subagent for Agent/Task tool_use blocks. Field precedence:
        //   1. input.subagent_type — old /agents tool name
        //   2. input.agent         — alt variant
        //   3. input.name          — new Agent tool (Claude Code ≥ 1.x passes a freeform
        //                            name like "agent-mm-ariba" or the subagent slug)
        // Falling back to input.name matters: without it the HUD just shows "agent"
        // for every delegation even when the caller passed a specific identifier.
        toolUseBlocks.push({
          id: b.id,
          name: b.name || 'tool',
          subagent: b.input?.subagent_type || b.input?.agent || b.input?.name || null,
          description: b.input?.description || null,
        });
      }
    }
  }
  if (toolUseBlocks.length > 0) {
    const answered = new Set();
    for (let i = lastAssistantIdx + 1; i < lines.length; i++) {
      const r = safeJson(lines[i]);
      if (!r) continue;
      const c = r?.message?.content || r?.content || [];
      if (Array.isArray(c)) {
        for (const b of c) if (b?.type === 'tool_result' && b.tool_use_id) answered.add(b.tool_use_id);
      }
    }
    const pending = toolUseBlocks.filter((b) => !answered.has(b.id));
    if (pending.length > 0) {
      return { working: true, mtimeAgoMs: ago, pending };
    }
    return { working: false, mtimeAgoMs: ago };
  }

  // No stop_reason, no tool_use → likely mid-stream. Trust fresh mtime (<2s).
  return { working: ago < 2000, mtimeAgoMs: ago };
}

// Scan transcript tail for recent tool_result blocks whose matching tool_use
// has name starting with `prefix` (e.g. `mcp__plugin_sp4sap_sap__`).
// Returns 'ok' | 'error' | 'unknown' based on the most recent such call.
// 'error' when the tool_result has is_error:true or content looks like an MCP
// transport error (disconnected / not available). 'unknown' when no matching
// call was seen within windowMs — caller falls back to the installed-file check.
export function mcpConnectionState(transcriptPath, prefix = 'mcp__plugin_sp4sap_sap__', windowMs = 10 * 60 * 1000) {
  if (!transcriptPath || !existsSync(transcriptPath)) return 'unknown';
  const tail = readTail(transcriptPath, 512 * 1024);
  const lines = tail.split('\n');
  const cutoff = Date.now() - windowMs;
  const idToName = new Map();
  let last = null;
  for (const line of lines) {
    const rec = safeJson(line);
    if (!rec) continue;
    const ts = Date.parse(rec.timestamp || rec.ts || '') || 0;
    if (ts && ts < cutoff) continue;
    const msg = rec.message || rec;
    const content = msg.content || rec.content || [];
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === 'tool_use' && b.id && typeof b.name === 'string' && b.name.startsWith(prefix)) {
        idToName.set(b.id, b.name);
      } else if (b?.type === 'tool_result' && b.tool_use_id && idToName.has(b.tool_use_id)) {
        const isErr = b.is_error === true;
        const cText = typeof b.content === 'string'
          ? b.content
          : Array.isArray(b.content)
            ? b.content.map((x) => (typeof x === 'string' ? x : x?.text || '')).join(' ')
            : '';
        const looksDisconnected = /MCP server.*(disconnected|not available|no longer available)|MCP error|server disconnected/i.test(cText);
        last = { ts: ts || Date.now(), ok: !isErr && !looksDisconnected };
      }
    }
  }
  if (!last) return 'unknown';
  return last.ok ? 'ok' : 'error';
}

// Current context size = input + both cache buckets (output is not in the context window going forward).
export function contextSize(u) {
  if (!u) return 0;
  return (u.input_tokens || 0)
       + (u.cache_creation_input_tokens || 0)
       + (u.cache_read_input_tokens || 0);
}

function scanDirForUsage(dir, cutoff, tailBytes, priceFor, costOf) {
  let total = 0;
  let oldest = Date.now();
  let files;
  try { files = readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { return { costUsd: 0, oldestMs: Date.now() }; }
  for (const f of files) {
    const full = join(dir, f);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.mtimeMs < cutoff) continue;
    const tail = readTail(full, tailBytes);
    for (const line of iterLines(tail)) {
      const rec = safeJson(line);
      if (!rec) continue;
      const ts = Date.parse(rec.timestamp || rec.ts || '') || st.mtimeMs;
      if (ts < cutoff) continue;
      const msg = rec.message || rec;
      const usage = msg.usage || rec.usage;
      const model = msg.model || rec.model;
      if (usage && model) {
        total += costOf(usage, priceFor(model));
        if (ts < oldest) oldest = ts;
      }
    }
  }
  return { costUsd: total, oldestMs: oldest };
}

// 5h rolling block — current project only (block limits are typically per-session scope).
export function collectBlockUsage(transcriptPath, priceFor, costOf, windowMs = 5 * 60 * 60 * 1000) {
  const dir = dirname(transcriptPath);
  if (!existsSync(dir)) return { costUsd: 0, oldestMs: Date.now() };
  return scanDirForUsage(dir, Date.now() - windowMs, 1024 * 1024, priceFor, costOf);
}

// 7-day rolling — scans ALL project session dirs under ~/.claude/projects/.
// Anthropic's weekly limit is account-wide, so we aggregate across every project.
export function collectWeeklyUsage(transcriptPath, priceFor, costOf, windowMs = 7 * 24 * 60 * 60 * 1000) {
  const projectDir = dirname(transcriptPath);                 // ~/.claude/projects/<hash>
  const rootDir    = dirname(projectDir);                     // ~/.claude/projects
  if (!existsSync(rootDir)) return { costUsd: 0, oldestMs: Date.now() };
  const cutoff = Date.now() - windowMs;
  let total = 0;
  let oldest = Date.now();
  let entries;
  try { entries = readdirSync(rootDir, { withFileTypes: true }); } catch { return { costUsd: 0, oldestMs: Date.now() }; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = join(rootDir, e.name);
    const r = scanDirForUsage(sub, cutoff, 512 * 1024, priceFor, costOf);
    total += r.costUsd;
    if (r.oldestMs < oldest) oldest = r.oldestMs;
  }
  return { costUsd: total, oldestMs: oldest };
}
