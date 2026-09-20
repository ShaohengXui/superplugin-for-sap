#!/usr/bin/env node
/**
 * sp4sap PreToolUse hook — Prefer GetSqlQuery + Explicit Fields
 *
 * Credit-saving guard. Two rules:
 *
 *  1. `GetTableContents` returns every column for `SELECT * FROM <table>`.
 *     For real data needs, `GetSqlQuery` with an explicit field list is
 *     dramatically cheaper (rows × needed_columns vs rows × all_columns).
 *     Hook returns `permissionDecision: "ask"` so the user can confirm
 *     when a full snapshot really is wanted (e.g., schema discovery).
 *
 *  2. `GetSqlQuery` with `SELECT *` (or `SELECT TABLE.*`) defeats the
 *     purpose. Hook returns `ask` and asks the model to enumerate fields.
 *     COUNT/SUM/MIN/MAX/AVG aggregates are exempt — they don't expand.
 *
 *  Failure mode: fails OPEN on parse errors so a broken hook can't block
 *  legitimate development.
 */

function readStdin() {
  return new Promise((done) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => done(data));
    process.stdin.on('error', () => done(data));
    setTimeout(() => done(data), 1500).unref?.();
  });
}

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function isSelectStar(sql) {
  // Strip leading whitespace + comments, normalize spaces.
  const norm = String(sql || '')
    .replace(/--[^\n]*\n/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/^SELECT\b/i.test(norm)) return false;

  // Aggregate-only is fine — no row-column expansion.
  const aggOnly = /^SELECT\s+(?:(?:COUNT|SUM|MIN|MAX|AVG)\s*\([^)]*\)(?:\s+AS\s+\w+)?\s*,?\s*)+FROM\b/i;
  if (aggOnly.test(norm)) return false;

  // Detect SELECT * or SELECT t.* (with optional DISTINCT/TOP/SINGLE qualifiers).
  return /^SELECT(?:\s+(?:DISTINCT|SINGLE|TOP\s+\d+))*\s+(?:[A-Z0-9_~/]+\.)?\*(?:\s*,|\s+FROM\b)/i.test(norm);
}

async function main() {
  const raw = await readStdin();
  if (!raw) process.exit(0);

  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }

  const toolName = payload.tool_name || payload.toolName || '';
  const toolInput = payload.tool_input || payload.toolInput || payload.arguments || {};

  if (/GetTableContents/i.test(toolName)) {
    const table = String(toolInput.table_name || toolInput.table || '').toUpperCase();
    const reason =
      `sp4sap policy — credit-saving guard:\n` +
      `  GetTableContents${table ? `(${table})` : ''} returns every column (SELECT *).\n\n` +
      `Prefer GetSqlQuery with an explicit field list:\n` +
      `  SELECT field1, field2 FROM ${table || '<table>'} WHERE ... UP TO N ROWS\n\n` +
      `Approve only if you genuinely need every column (e.g., schema-snapshot, debugging an unknown row). ` +
      `For row counts use COUNT(*), for samples use SELECT <fields>.`;
    emit('ask', reason);
  }

  if (/GetSqlQuery/i.test(toolName)) {
    const sql = String(toolInput.sql_query || toolInput.sql || toolInput.query || '');
    if (isSelectStar(sql)) {
      const reason =
        `sp4sap policy — credit-saving guard:\n` +
        `  Query uses SELECT * — returns every column.\n\n` +
        `Rewrite the query to enumerate only the fields you actually need:\n` +
        `  SELECT field1, field2, field3 FROM ... WHERE ... UP TO N ROWS\n\n` +
        `Approve only if every column is genuinely required. Aggregates (COUNT/SUM/MIN/MAX/AVG) are exempt.`;
      emit('ask', reason);
    }
  }

  process.exit(0);
}

main();
