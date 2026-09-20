import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ALWAYS_ALLOW,
  MUTATION_PREFIXES,
  QA_ALLOW,
  RUNTIME_EXEC,
  checkToolAllowed,
  classifyTool,
  normalizeTier,
  shortToolName,
} from '../../scripts/lib/tier-guard.mjs';

const ROOT = join(__dirname, '..', '..');

describe('tier guard — block matrix', () => {
  it('DEV allows everything, including mutations', () => {
    expect(checkToolAllowed('UpdateClass', 'DEV')).toBeNull();
    expect(checkToolAllowed('DeleteProgram', 'DEV')).toBeNull();
    expect(checkToolAllowed('RunUnitTest', 'DEV')).toBeNull();
    expect(checkToolAllowed('RuntimeRunProgramWithProfiling', 'DEV')).toBeNull();
  });

  it('QA blocks mutations but allows RunUnitTest', () => {
    expect(checkToolAllowed('CreateClass', 'QA')).not.toBeNull();
    expect(checkToolAllowed('UpdateClass', 'QA')).not.toBeNull();
    expect(checkToolAllowed('DeleteClass', 'QA')).not.toBeNull();
    expect(checkToolAllowed('RunUnitTest', 'QA')).toBeNull();
  });

  it('PRD blocks mutations and all runtime execution', () => {
    expect(checkToolAllowed('UpdateClass', 'PRD')).not.toBeNull();
    expect(checkToolAllowed('RunUnitTest', 'PRD')).not.toBeNull();
    expect(checkToolAllowed('RuntimeRunClassWithProfiling', 'PRD')).not.toBeNull();
    expect(checkToolAllowed('RuntimeCreateProfilerTraceParameters', 'PRD')).not.toBeNull();
  });

  it('covers every mutation prefix and runtime tool on QA and PRD', () => {
    // Regression guard: the 0.6.18 release closed a gap where Patch/Write/
    // Activate and RuntimeCreateProfilerTraceParameters were added to the
    // matrix. Assert each one is actually blocked, so a future prefix rename
    // cannot silently reopen it.
    const mutations = ['PatchGuiStatus', 'WriteTextElementsBulk', 'ActivateObjects'];
    for (const t of mutations) {
      expect(MUTATION_PREFIXES.some((p) => t.startsWith(p)), `${t} must match a prefix`).toBe(true);
      expect(checkToolAllowed(t, 'QA'), `${t} on QA`).not.toBeNull();
      expect(checkToolAllowed(t, 'PRD'), `${t} on PRD`).not.toBeNull();
    }
    for (const t of RUNTIME_EXEC) {
      expect(checkToolAllowed(t, 'PRD'), `${t} on PRD`).not.toBeNull();
    }
  });

  it('never blocks read tools', () => {
    for (const t of ['GetClass', 'ReadProgram', 'SearchObject', 'GetSession', 'ListTransports']) {
      expect(checkToolAllowed(t, 'PRD'), `${t} must stay readable on PRD`).toBeNull();
    }
  });

  it('always allows ReloadProfile so a locked session can escape', () => {
    for (const t of ALWAYS_ALLOW) {
      expect(checkToolAllowed(t, 'PRD')).toBeNull();
      expect(checkToolAllowed(t, 'QA')).toBeNull();
    }
  });

  it('classifies tool kinds consistently with the matrix', () => {
    expect(classifyTool('UpdateClass')).toBe('mutation');
    expect(classifyTool('RunUnitTest')).toBe('runtime');
    expect(classifyTool('GetClass')).toBe('other');
    // `Create` is a prefix, not a substring — Runtime* must not be a mutation.
    expect(classifyTool('RuntimeCreateProfilerTraceParameters')).toBe('runtime');
  });

  it('normalizes unknown tiers to DEV and is case-insensitive', () => {
    expect(normalizeTier('prd')).toBe('PRD');
    expect(normalizeTier(' qa ')).toBe('QA');
    expect(normalizeTier('PRODUCTION')).toBe('DEV');
    expect(normalizeTier(undefined)).toBe('DEV');
  });

  it('strips the MCP namespace from tool names', () => {
    expect(shortToolName('mcp__plugin_sp4sap_sap__UpdateClass')).toBe('UpdateClass');
    expect(shortToolName('mcp__sap__UpdateClass')).toBe('UpdateClass');
    expect(shortToolName('UpdateClass')).toBe('UpdateClass');
  });

  it('keeps QA_ALLOW a strict subset of RUNTIME_EXEC', () => {
    for (const t of QA_ALLOW) expect(RUNTIME_EXEC.has(t)).toBe(true);
  });
});

describe('tier guard — installed hook matcher stays in sync with the matrix', () => {
  it('routes every blocked tool family to the L1 hook', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'install-hooks.mjs'), 'utf-8');
    const m = src.match(/marker: 'tier-readonly-guard\.mjs',[\s\S]*?matcher:\s*\n?\s*'([^']+)'/);
    expect(m, 'could not locate the tier-readonly-guard matcher').not.toBeNull();

    const matcher = m![1];
    // Every mutation prefix must appear in the matcher, otherwise the hook is
    // never invoked for that tool and only the server-side L2 guard applies.
    for (const prefix of MUTATION_PREFIXES) {
      expect(matcher, `matcher must route ${prefix}* to the hook`).toContain(prefix);
    }
    for (const tool of RUNTIME_EXEC) {
      expect(matcher, `matcher must route ${tool} to the hook`).toContain(tool);
    }
  });
});

/**
 * The tier guard is validated against `data/sp4sap-mcp-tools-*.md`, the
 * committed inventory of every tool the vendor MCP server registers. Without
 * this, the matrix is only as good as whoever last edited it by hand — which is
 * exactly how the 0.6.18 gap (Activate/Patch/Write) went unnoticed.
 *
 * The catalogs group tools by *topic*, not by guard class, so membership in the
 * write/runtime catalog does not by itself mean "must be blocked". A tool must
 * be blocked when it mutates SAP or executes ABAP; reading a dump is neither.
 */
describe('tier guard — validated against the committed tool catalog', () => {
  const parseCatalog = (which: 'read' | 'write' | 'runtime'): string[] => {
    const raw = readFileSync(join(ROOT, 'data', `sp4sap-mcp-tools-${which}.md`), 'utf-8');
    return [...raw.matchAll(/^- (mcp__\S+)/gm)].map((m) => shortToolName(m[1]));
  };

  /**
   * Runtime diagnostics that read dumps / traces / messages. They neither mutate
   * SAP objects nor execute ABAP, so the tier guard deliberately allows them on
   * QA and PRD — blocking them would cost diagnosis capability for no security
   * gain. Data-exposure risk is the *blocklist* layer's job
   * (`block-forbidden-tables.mjs`, `MCP_BLOCKLIST_PROFILE`), not this one.
   *
   * This list is exhaustive and asserted below: adding a member means a tool
   * stopped being a mutation/execution, which should be a deliberate decision.
   */
  const ALLOWED_DIAGNOSTICS = [
    'RuntimeAnalyzeDump',
    'RuntimeAnalyzeProfilerTrace',
    'RuntimeGetDumpById',
    'RuntimeGetProfilerTraceData',
    'RuntimeListDumps',
    'RuntimeListFeeds',
    'RuntimeListProfilerTraceFiles',
    'RuntimeListSystemMessages',
    'ValidateServiceBinding',
  ];

  it('the catalogs are present and non-trivial', () => {
    // Guards against a vacuous pass if the catalog files are ever removed.
    expect(parseCatalog('read').length).toBeGreaterThan(50);
    expect(parseCatalog('write').length).toBeGreaterThan(50);
    expect(parseCatalog('runtime').length).toBeGreaterThan(5);
  });

  it('blocks every catalogued mutation and ABAP execution on PRD', () => {
    const tools = [...parseCatalog('write'), ...parseCatalog('runtime')];
    const unexpected = tools.filter(
      (t) => !checkToolAllowed(t, 'PRD') && !ALLOWED_DIAGNOSTICS.includes(t),
    );
    expect(
      unexpected,
      `write/runtime tools not blocked on PRD: ${unexpected.join(', ')} — ` +
        'either extend MUTATION_PREFIXES / RUNTIME_EXEC, or add to ALLOWED_DIAGNOSTICS with a reason.',
    ).toEqual([]);
  });

  it('blocks every catalogued mutation on QA as well', () => {
    const unexpected = parseCatalog('write').filter(
      (t) => !checkToolAllowed(t, 'QA') && !ALLOWED_DIAGNOSTICS.includes(t),
    );
    expect(unexpected, `write tools not blocked on QA: ${unexpected.join(', ')}`).toEqual([]);
  });

  it('blocks no catalogued read tool on PRD', () => {
    const blocked = parseCatalog('read').filter((t) => checkToolAllowed(t, 'PRD'));
    expect(blocked, `read tools wrongly blocked: ${blocked.join(', ')}`).toEqual([]);
  });

  it('the allowed-diagnostics list stays exactly as reviewed', () => {
    // If a genuine execution tool ever needs to join this list, the change must
    // be visible in review rather than inferred.
    expect(ALLOWED_DIAGNOSTICS).toHaveLength(9);
    for (const t of ALLOWED_DIAGNOSTICS) {
      expect(MUTATION_PREFIXES.some((p) => t.startsWith(p)), `${t} must not be a mutation`).toBe(
        false,
      );
      expect(RUNTIME_EXEC.has(t), `${t} must not be an execution`).toBe(false);
    }
  });

  it('every catalogued tool is classified — none is silently unguarded', () => {
    // A tool that is neither blocked nor in the reviewed allowlist would be an
    // unreviewed hole; this asserts the two sets cover the whole catalog.
    const all = [
      ...parseCatalog('write'),
      ...parseCatalog('runtime'),
      ...parseCatalog('read'),
    ];
    expect(all.length).toBeGreaterThan(150);
    const unclassified = all.filter((t) => {
      const blocked = checkToolAllowed(t, 'PRD') !== null;
      return !blocked && !ALLOWED_DIAGNOSTICS.includes(t) && classifyTool(t) === 'other';
    });
    // Read tools land here by design; assert they are the read catalog.
    const reads = new Set(parseCatalog('read'));
    const suspicious = unclassified.filter((t) => !reads.has(t));
    expect(suspicious, `uncatalogued-and-unguarded: ${suspicious.join(', ')}`).toEqual([]);
  });

  it('no tool name is catalogued twice', () => {
    // A duplicate would double-count and let a real gap hide behind a repeat.
    const all = [
      ...parseCatalog('read'),
      ...parseCatalog('write'),
      ...parseCatalog('runtime'),
    ];
    const dupes = all.filter((t, i) => all.indexOf(t) !== i);
    expect([...new Set(dupes)], `duplicated catalog entries: ${dupes.join(', ')}`).toEqual([]);
  });

  it('records the tools the live server registers but the catalog omitted', () => {
    // Probing the real vendored server (`tools/list`) on 2026-09-18 registered
    // 143 tools; these five were absent from the catalog and have since been
    // added. GetTableContents/GetSqlQuery stay out of the read catalog on
    // purpose — they are prompt-gated row-extraction tools, documented as
    // excluded in that file's header.
    const cat = new Set([
      ...parseCatalog('read'),
      ...parseCatalog('write'),
      ...parseCatalog('runtime'),
    ]);
    for (const t of ['RuntimeListFeeds', 'RuntimeListSystemMessages', 'ReloadProfile']) {
      expect(cat.has(t), `${t} must be catalogued`).toBe(true);
    }
    const readHeader = readFileSync(join(ROOT, 'data', 'sp4sap-mcp-tools-read.md'), 'utf-8');
    expect(readHeader).toContain('GetTableContents');
    expect(readHeader).toMatch(/EXCLUDED from this list/);
  });
});
