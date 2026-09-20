# Multi-client migration — running sp4sap outside Claude Code

Status: Phase 1–2 implemented, Phase 3–4 planned.
Scope: let Zcode, Codex and any other MCP client reach the same SAP capability
and the same safety guarantees, without forking the MCP server.

## 0. The finding that shapes everything

`abap-mcp-adt-powerup` — the thing that actually talks to SAP and holds the
150+ tools — is **not in this repository**. It is cloned into `vendor/` at a
pinned SHA by `scripts/build-mcp-server.mjs`, and `vendor/` is gitignored.

`bridge/mcp-server.cjs` is already a **thin, client-agnostic launcher**: it
derives its own root from `__dirname`, resolves the active profile's `sap.env`,
sets `MCP_ENV_PATH`, and `require()`s the vendor launcher. It contains no
Claude-Code-only API call. So the MCP layer was never the problem.

What is Claude-Code-only is everything **around** it: the orchestration hooks,
the agents, the per-phase model routing, and the L1 write guard. That is where
the migration work actually is.

## 1. Architecture comparison

| Concern | Original (Claude Code only) | After refactor |
|---|---|---|
| **MCP transport** | stdio via `.mcp.json`, `${CLAUDE_PLUGIN_ROOT}` | unchanged, plus `SC4SAP_ENV_FILE` / `SC4SAP_PROJECT_DIR` / `SC4SAP_VENDOR_DIR` so any client can launch it from any cwd |
| **Tool exposure** | 150+ tools from vendored server | identical — no server rewrite |
| **Credential source** | profile `sap.env` via cwd walk-up | explicit env file **or** cwd walk-up **or** pure process env |
| **Password storage** | OS keychain (`@napi-rs/keyring`), `keychain:<service>/<account>` ref in `sap.env` | identical — resolution happens inside the MCP server, not the client |
| **Profile isolation** | `~/.sc4sap/profiles/<alias>/` + `.sc4sap/active-profile.txt` | identical |
| **Write protection** | L1 Claude hook + L2 server guard | L1 hook **or** L1.5 MCP proxy (`SC4SAP_TIER_GUARD=proxy`) + L2 server guard |
| **Block matrix source** | duplicated in the hook | single source: `scripts/lib/tier-guard.mjs`, shared by hook / proxy / CLI |
| **Model routing** | `model:` in agent + skill frontmatter, `Agent(model:)` overrides, hardcoded `claude-opus-4-7` etc. | Claude Code keeps it; other clients ignore it (Phase 3) |
| **Skills / agents** | Claude Code skill + subagent loader | shared `skills/` still loaded by Claude Code and Zcode; Codex gets prompt orchestration (Phase 3) |
| **Client manifests** | `.claude-plugin/plugin.json` | + `.zcode-plugin/plugin.json`, `.codex-plugin/plugin.json` |
| **Statusline / HUD** | Claude Code `statusLine` + Anthropic OAuth quota API | Claude Code only — lost elsewhere |
| **`spro-injector` Haiku call** | `UserPromptSubmit` hook → Anthropic API, hardcoded model | Claude Code only — absent elsewhere (no functional loss, it is a context injector) |

## 2. What is Claude-Code-proprietary vs MCP-generic

**MCP-generic (kept, reused, unchanged)**
- `vendor/abap-mcp-adt` — the whole SAP capability
- `bridge/mcp-server.cjs` — launcher + preflight
- `scripts/sap-profile-cli.mjs`, `scripts/lib/profile-resolve.mjs` — profile store
- `runtime-deps/keyring` — OS keychain bundle
- `configs/`, `common/`, `exceptions/`, `country/`, `industry/`, `abap/` — pure reference data
- The L2 server-side guard (`ERR_READONLY_TIER`) — lives in the vendor, fires regardless of client

**Claude-Code-proprietary (must be replaced or dropped per client)**
- `hooks/hooks.json` — all 9 hook events, `$CLAUDE_PLUGIN_ROOT`
- `agents/*.md` — `model:`, `tools:`, `disallowedTools:` frontmatter; `Agent(...)` dispatch
- `skills/**/SKILL.md` — `model:`, `level:`, `internal:` frontmatter
- Per-phase model routing (`common/model-routing-rule.md`, `docs/skill-model-architecture.md`)
- `scripts/hud/*` — statusline payload, Anthropic OAuth usage API, price table
- `.claude-plugin/plugin.json` `statusLine` block
- Team-mode / `SendMessage` / `team_name` agent-teams features

**Portable, once extracted (now shared)**
- The QA/PRD block matrix → `scripts/lib/tier-guard.mjs`

## 3. Phased implementation checklist

### Phase 1 — analysis (done)
No file changes. Conclusions in §0–§2.

### Phase 2 — MVP: reach SAP from a generic client (done)

| # | File | Change | Verified by |
|---|---|---|---|
| 1 | `scripts/lib/tier-guard.mjs` | **new** — single-source block matrix + tier resolution + denial message | `tests/validation/tier-guard.test.ts` (11 tests) |
| 2 | `scripts/hooks/tier-readonly-guard.mjs` | refactored onto the shared lib; no longer pre-filters by tool name | smoke test: QA + `UpdateClass` → `deny`; QA + `RunUnitTest` → allow |
| 3 | `scripts/install-hooks.mjs` | matcher widened to `Patch\|Write\|Activate\|RuntimeCreateProfilerTraceParameters` | `tier-guard.test.ts` asserts matcher ⊇ matrix |
| 4 | `scripts/tier-guard-cli.mjs` | **new** — portable guard for non-Claude hook systems + CI; exit 0/3/2 | manual: `--tool UpdateClass --tier PRD` → exit 3 |
| 5 | `bridge/mcp-server.cjs` | `SC4SAP_ENV_FILE`/`MCP_ENV_PATH` tier-0 precedence, `SC4SAP_PROJECT_DIR`, `SC4SAP_VENDOR_DIR`, env-only mode | manual: explicit env file, DEV allow, env-only mode all pass |
| 6 | `bridge/mcp-server.cjs` | **new** opt-in L1.5 guard proxy (`SC4SAP_TIER_GUARD=proxy`) | e2e with fake vendor: PRD blocks `UpdateClass`/`ActivateObjects`, forwards `GetClass`; DEV forwards |
| 7 | `bridge/cli.cjs` | **new** — the `sp4sap` installer: `install`/`uninstall`/`status`/`doctor` for Codex, ZCode and Claude Code | `tests/validation/cli.test.ts` (14 tests) |
| 8 | `mcp/*.json`, `mcp/*.toml`, `mcp/README.md` | **new** — client config templates + operator guide | `multi-client.test.ts` (11 tests) |
| 9 | `.zcode-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json` | **new** — client manifests | `multi-client.test.ts` version-parity + schema tests |
| 10 | `package.json` | `files[]` += `mcp`, `.zcode-plugin`, `.codex-plugin`, `.agents` | `npm pack --dry-run` |

Note: `package.json` had always declared a `sc4sap` bin entry pointing at `bridge/cli.cjs`, but the
file did not exist — so an npm-installed `sp4sap` command was broken. Phase 2
item 7 creates it. `cli.test.ts` asserts the declared bin target exists.

### The installer (`sp4sap install`)

Strategy per client, preferring the client's own CLI over editing its config:

| Client | Primary | Fallback | Notes |
|---|---|---|---|
| Claude Code | `claude plugin marketplace add` + `claude plugin install -y` | `claude mcp add -s user` | plugin route gives skills + agents + MCP |
| Codex | `codex plugin marketplace add` + `codex plugin add` | `codex mcp add` | plugin route gives skills + MCP |
| ZCode | `<repo>/.zcode/config.json` → `mcp.servers.sap` | — | ZCode has **no** MCP/plugin CLI; UI-only for plugins |

Guarantees: only one registration per client (registering both the plugin and a
standalone server would expose the same tools twice); `--dry-run` is verified
side-effect free; every edited file is backed up; re-running is idempotent;
`uninstall` removes only its own entry and preserves unrelated servers;
credentials are never written; and a non-JSON config file is refused rather than
overwritten.

The MCP-layer tier guard defaults ON for Codex/ZCode and OFF for Claude Code
(whose PreToolUse hook covers the tested in-process path). `--tier-guard` /
`--no-tier-guard` override it.

### Phase 3 — skills / agents (planned)

Two options, and the recommendation:

**Option A — convert skills to MCP prompts/resources, agents to server-side tool
bundles.** Requires a shim MCP server that re-exports the vendor's tools plus
`prompts/list` / `prompts/get` generated from `skills/**/SKILL.md`, and
`resources/list` for `common/*.md` and `configs/*/`. Cost: a new server layer,
a build step to keep prompts in sync, and it still cannot express subagent
dispatch — MCP has no subagent primitive. Benefit: clients see sp4sap skills
natively.

**Option B — keep skills/agents as an optional Claude Code + Zcode enhancement
layer; expose only the tools to other clients and let the user orchestrate with
prompts. (RECOMMENDED)**

Rationale: the tool surface is the durable asset and it is already portable.
Skills are *prose procedures* over those tools — a Codex command prompt
reproduces them with no server work and no sync burden, and Codex already has
its own native subagents to play the agent roles. Option A would add a
maintenance surface that must track every skill edit, to gain a capability
(prompts) that is largely redundant with the client's own prompt library.
Worked example of the Option B pattern: `mcp/codex-command.example.toml`.

Concrete Phase 3 steps if Option B is chosen:
1. Add `mcp/codex-command.example.toml`-style commands for the skills users
   actually invoke, under `commands/` for Codex.
2. Replace `Agent(...)` dispatch prose in skills with client-neutral
   "spawn N subagents" wording (Claude Code and Codex both have subagents;
   the names differ).
3. Make the `model:` frontmatter optional — see Phase 4 risk R4.

### Phase 4 — verification (partially done; needs a live SAP system)

| Test | How | Status |
|---|---|---|
| Block matrix correctness | `npx vitest run tests/validation/tier-guard.test.ts` | ✅ 17/17 |
| Matrix vs. the real tool catalog (166 tools) | same file, `data/sp4sap-mcp-tools-*.md` | ✅ |
| Guard reaches every mutation family | matcher-sync test | ✅ |
| L1.5 proxy blocks Prod writes | fake-vendor e2e | ✅ (stub vendor) |
| Claude Code path unchanged | default mode, no `SC4SAP_TIER_GUARD` | ✅ |
| Installer dry-run is side-effect free | `tests/validation/cli.test.ts` | ✅ |
| Connect to SAP (`GetSession`) | live system | ⛔ not runnable here |
| Read an ABAP class (`GetClass`) | live system | ⛔ |
| Run ABAP Unit tests (`RunUnitTest` + `GetUnitTestResult`) | live system | ⛔ |
| Prod write rejected | live QA/PRD profile | ⛔ — see risk R1 |

**Not testable at all: ATC.** The vendor registers no ATC handler — the tool
catalog's only match for "atc" is `PatchGuiStatus`. "Run ATC" is therefore not a
valid verification step for this tool set; `RunUnitTest` and
`GetAbapSemanticAnalysis` are the available correctness checks.

## 4. Risks and rollback

**R1 — L2 guard tier hydration without `ReloadProfile` (highest risk).**
`docs/multi-profile-design.md` says the server's `@readonly(tier)` decorator
reads the tier *cached at `ReloadProfile` time*. A generic client that connects
and never calls `ReloadProfile` may leave L2 unaware of the tier. Claude Code
always goes through profile load; a bare MCP client may not.
*Mitigation:* run the Prod-write test with `SC4SAP_TIER_GUARD=proxy` so L1.5
guarantees the block regardless of L2 state; separately confirm L2 by calling
`ReloadProfile` then retrying. **Verify this before trusting L2 alone on any new
client.**

**R2 — Proxy diverges from the vendor's own framing.** The proxy assumes
newline-delimited JSON-RPC (the MCP stdio spec). If the vendor used
Content-Length framing, the proxy warns once and stops inspecting.
*Mitigation:* it is opt-in; the warning is loud; L2 still applies.

**R3 — Zcode plugin manifest acceptance is unverified.** `.zcode-plugin/plugin.json`
is added with only Zcode-supported fields, but Zcode may reject
`"mcpServers": "./.mcp.json"` (path form) in favour of an inline object.
*Mitigation:* Zcode's documented probe order falls back to
`.claude-plugin/plugin.json`, and it reads `<pluginRoot>/.mcp.json` directly, so
a rejection is survivable. If it fails, inline the server object.
*Fallback:* use `mcp/zcode.workspace.json` (workspace scope) — no plugin needed.

**R4 — Model routing.** `agents/*.md` `model:` holds full Claude IDs
(`claude-opus-4-7`) and `tests/validation/agents.test.ts:37` asserts the key
exists. Other clients ignore unknown frontmatter, so this is cosmetic there —
but a non-Anthropic client cannot honour it. `scripts/spro-injector.mjs` makes a
real Anthropic API call with a hardcoded Haiku model from a `UserPromptSubmit`
hook; that hook simply does not run elsewhere (context injection lost, nothing
broken). *Mitigation:* treat `model:` as advisory; document "single-model" mode
for non-Claude clients. Do not delete the key — it breaks the test suite.

**R5 — Orchestration loss.** Losing hooks loses: keyword detection, skill
auto-injection, SPRO/customization context injection, transport validation,
project memory, context guard, syntax checking on failure, subagent tracking,
deliverable verification, HUD. These are conveniences, not capabilities — the
tools still work — but a non-Claude client feels noticeably less "guided".

**R6 — Hardcoded connection info in a tracked file.**
`skills/setup/wizard-step-04-profile-creation.md:81` contains a real-looking
hostname and SAP user ID in an example payload (password field is the literal
`<captured>` placeholder — no secret is committed). *Mitigation:* replace with
`your-sap-host` / `DEMOUSER` in a follow-up; unrelated to this refactor but
worth cleaning while the docs are being touched.

### Rollback

Every change is additive or opt-in:

| To revert | Do |
|---|---|
| Bridge proxy | unset `SC4SAP_TIER_GUARD` (default) — restores in-process `require(LAUNCHER)` |
| Bridge env knobs | unset `SC4SAP_ENV_FILE`/`SC4SAP_PROJECT_DIR`/`SC4SAP_VENDOR_DIR` — original precedence resumes |
| Tier guard lib refactor | `git checkout scripts/hooks/tier-readonly-guard.mjs` (matrix moves back inline; hook behavior identical) |
| Hook matcher widening | `git checkout scripts/install-hooks.mjs`; then re-run `install-hooks.mjs` to restore old matchers in `settings.json` |
| New manifests / templates | delete `mcp/`, `.zcode-plugin/`, `.codex-plugin/`; revert `package.json` `files[]` |

No data migration, no vendor change, no `.mcp.json` change — so a Claude Code
user who never sets a new env var sees byte-identical behavior.
