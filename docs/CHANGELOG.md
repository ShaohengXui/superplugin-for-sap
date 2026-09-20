# Changelog

← [Back to README](../README.md) · [Installation](INSTALLATION.md) · [Features](FEATURES.md)

All notable changes to sp4sap are documented here. For full release notes, see [GitHub Releases](https://github.com/ShaohengXui/superplugin-for-sap/releases).

The project adheres to [Semantic Versioning](https://semver.org/) and the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

---

## [Unreleased]

_No unreleased changes yet._

---

## [0.6.2] - 2026-04-21

Follow-up to 0.6.1 — cross-profile integrity + MCP-server legacy detection fixes found while adding a second SAP profile (ECC 7.40) in the same wizard session that was refreshing an S/4HANA profile.

### Added
- **ECC / BASIS < 7.50 Compatibility Matrix** in [`docs/FEATURES.md`](FEATURES.md) — 15 rows verified end-to-end on ECC 7.40 covering every MCP handler family (session/discovery, DDIC read/write, ABAP source R/W, CDS views, analysis, enhancements, transport, runtime, RAP/Behavior/Service/MetadataExt). Distinguishes ✅ full / ⚠️ partial / ❌ refused-with-clear-error / ℹ️ setup-dependent. Links to the canonical upstream matrix in `abap-mcp-adt-powerup/README.md`.
- **Legacy auto-detection docs** — explicit rules: `SAP_SYSTEM_TYPE=legacy` OR `SAP_VERSION=ECC` OR `ABAP_RELEASE < 750` → MCP server routes through `AdtClientLegacy`. Depends on upstream `abap-mcp-adt-powerup` commit d08e576+ (2026-04-21).

### Fixed
- **`bridge/mcp-server.cjs` missed the active-profile pointer** — resolved env only from legacy `<project>/.sc4sap/sap.env` + `<plugin>/.sc4sap/sap.env`. Multi-profile projects (the 0.6.0 default) failed MCP handshake with `Config not found`. Bridge now reads `<cwd>/.sc4sap/active-profile.txt` first → resolves to `${SC4SAP_HOME_DIR|~/.sc4sap}/profiles/<alias>/sap.env`. Legacy paths retained as fallback. Error message when nothing resolves now surfaces the pointer path with a `(pointer missing / present but profile env missing)` annotation.
- **Wizard identity fields inherited across profile boundaries (catastrophe-class bug)** — Step 2 (`SAP_VERSION` / `ABAP_RELEASE` / `SAP_INDUSTRY`) was collected once per wizard session and then reused for every profile created in that session. Refresh-S4 + add-ECC in one session silently persisted S4/816/tire into the new ECC profile's `config.json`, so consultant agents would suggest MATDOC/ACDOCA on an ECC backend. Fixed at three layers:
  - `skills/setup/wizard-step-04-profile-creation.md` §4.3 — meta-copy is now opt-in, not the default.
  - `skills/setup/wizard-step-04-profile-creation.md` new §4.4b — per-profile identity-field re-collection rule documented.
  - `skills/setup/wizard-steps.md` Step 2 — scope note: values apply only to the profile currently under wizard.
- **`sap-profile-cli.mjs cmdAdd` now has a deterministic guardrail** — rejects `add` payloads missing `version` / `abapRelease` / `industry` (unless `copyFrom=<sibling>` is given) with exit code 2. Independent of LLM behavior, the write path cannot persist an identity-empty profile. See wizard §4.4b.
- **`cmdAdd` did not write `blocklistProfile` to `config.json` or `sap.env`** — L1 PreToolUse hook silently defaulted to `strict` when the user had chosen `minimal` at Step 12, causing `BKPF`-class reads to be blocked contrary to user intent. `cmdAdd` now accepts a `blocklistProfile` payload (validated against `strict|standard|minimal|custom`) and writes it to both `config.json` (L1 hook source) and `sap.env` as `MCP_BLOCKLIST_PROFILE` (L2 MCP-server guard source). L1 and L2 stay in sync from the first profile creation.
- **`cmdAdd` omitted `abapRelease` from `config.json`** — Step 10 spec called for it; now included alongside `sapVersion` / `industry` / `activeModules` / `tier`.
- **`cmdAdd` hard-exited when `@napi-rs/keyring` was unavailable** — skill doc promised a plaintext fallback (matching `cmdMigrate`). `cmdAdd` now emits a stderr warning and writes the plaintext password to the profile env, so headless / keyring-unavailable dev machines can still add profiles.

### Upstream dependency
- MCP server `abap-mcp-adt-powerup` commit **d08e576** (2026-04-21) — `detectLegacy()` uses version/release in addition to `SAP_SYSTEM_TYPE`; `hydrateSystemContextFromEnvFile` propagates `SAP_VERSION` / `ABAP_RELEASE` / `SAP_RFC_*` into `process.env`; `UpdateFunctionModule` defaults `transport_request` to `"local"` for `$TMP` objects. Pin is NOT bumped in this release; runtime changes are picked up via `git pull` + `npm run build` in the vendor dir or plugin reinstall.

---

## [0.6.1] - 2026-04-21

### Added
- **`/sp4sap:setup` multi-profile awareness** — setup wizard now has Step 0 (legacy detection + profile bootstrap) and a dedicated profile-creation flow (`skills/setup/wizard-step-04-profile-creation.md`). Migrates pre-0.6.0 `<project>/.sc4sap/sap.env` users automatically via `sap-profile-cli.mjs migrate`; fresh installs create their first profile under `~/.sc4sap/profiles/<alias>/` with OS-keychain-backed password storage.
- **Tier-gated Step 9** — ABAP utility installation (`ZMCP_ADT_UTILS`, `ZCL_S4SAP_CM_*`, OData/ZRFC classes) now only runs on `SAP_TIER=DEV`. QA/PRD profiles refuse installation and print CTS import guidance; DEV installs are deduped across sibling profiles on the same `SAP_URL+SAP_CLIENT` via `~/.sc4sap/profiles/<alias>/.abap-utils-installed` sentinel.
- **Step 12 dual PreToolUse hooks** — setup now installs BOTH `block-forbidden-tables.mjs` AND `tier-readonly-guard.mjs` into `.claude/settings.json` (project-level), with smoke tests for each.
- **Shared profile resolver** (`scripts/lib/profile-resolve.mjs`) — `resolveSapEnvPath`, `resolveConfigJsonPath`, `resolveArtifactBase`, `readActiveSapEnv`, `readActiveConfigJson`, `readDotenv`, `normalizeTier`. Centralizes the active-profile → `~/.sc4sap/profiles/<alias>/` resolution pattern used by HUD, hooks, and scripts.
- **Gap-plan doc** (`docs/multi-profile-setup-gap.md`) — companion to `multi-profile-design.md` + `-implementation-plan.md`; records the 5 decisions made for the setup-skill retrofit.
- **Active-module awareness** (`common/active-modules.md`) — cross-module integration matrix. `SAP_ACTIVE_MODULES` env var + `activeModules` in `config.json` now drive proactive integration-field suggestions in `create-program`, `create-object`, `analyze-cbo-obj`, and consultant agents. Example: MM object + PS active → auto-suggest WBS fields (`PS_POSID` / `AUFNR`).
- **Fix #3 `handleUpdateDomain.ts`** — handler property naming aligned to `AdtDomain.update()` snake_case expectations (`value_table`, `fixed_values`, `conversion_exit`, `sign_exists`). Previously silently dropped.
- **Fix #4 `core/domain/update.ts`** (mcp-abap-adt-clients) — `patchXmlBlock` replaces `patchXmlElementAttribute` for `<doma:valueTableRef>` self-closing case; now emits full `adtcore:uri` + `adtcore:type` + `adtcore:name` attributes.

### Changed
- **Artifact paths in multi-profile mode** — `extract-spro.mjs`, `extract-customizations.mjs`, and consumer skills now write under `<project>/.sc4sap/work/<activeAlias>/` instead of `<project>/.sc4sap/` directly, per `common/multi-profile-artifact-resolution.md`. Legacy (no `active-profile.txt`) fallback preserved.
- **`rfc-backend-selection.md`** — all `SAP_RFC_*` env keys for `soap` / `native` / `gateway` / `odata` / `zrfc` backends now write to the active profile env (`~/.sc4sap/profiles/<alias>/sap.env`), never to the project folder. Bootstrap-order note for `odata` / `zrfc` backends retained (Step 9c/9d chicken-and-egg with first-time vs re-run scenarios).
- **`handleCreateTable.ts`** — auto-inject MANDT-based transparent-table skeleton (`key mandt : mandt not null`) after Create; replaces SAP backend's default CDS-style `key client : abap.clnt`. First-time users no longer hit `ExceptionResourceAlreadyExists` on UpdateTable.
- **`handleUpdateTable.ts`** — `ddl_code` schema description updated with MANDT example + annotation preservation guidance.

### Fixed
- **Password leak in `sap-profile-cli.mjs list`/`show`** — `passwordRef` field output the raw plaintext password when a profile's env used plaintext-fallback (keychain unavailable). Now returns the literal `"plaintext (masked)"` for non-keychain values; `keychain:…` refs pass through unchanged.
- **HUD ENV status after migration** — `sp4sap-status.mjs::sapEnvPresent / readConfig / activeTransport / systemInfo / sproCacheAge` all only looked at `<project>/.sc4sap/…`, which doesn't exist after multi-profile migration. Now resolve via the active-profile pointer first, with legacy fallback.
- **`block-forbidden-tables.mjs` profile mismatch** — hook reported the default `standard` blocklist even when the active profile's `config.json` said otherwise, because it read only the legacy project `config.json` (now deleted by migration). Now reads the active profile's config.
- **`code-simplifier.mjs`** and **`sap-option-tui.mjs`** — stop-hook and standalone TUI respectively read legacy project paths only; now resolve through the shared profile helper.

### Documentation
- **`INSTALLATION.md` / `.ko.md` / `.ja.md` / `.de.md`** — all four variants rewritten for 0.6.0 multi-profile setup. Adds "Multi-profile architecture" section, expands wizard table from 12 to 14 steps (new Step 0 + Step 13 HUD), documents the three-layer defense (L1a row-extraction hook + L1b tier hook + L2 MCP server guard), and adds after-setup profile-management + rollback recipes.
- README split — main page now slim (core capabilities + author + contributors). Installation / features / history moved to `docs/INSTALLATION.md` / `docs/FEATURES.md` / `docs/CHANGELOG.md` (this file).

---

## Release history

For older releases, see the [Git tag history](https://github.com/ShaohengXui/superplugin-for-sap/tags) and [GitHub Releases](https://github.com/ShaohengXui/superplugin-for-sap/releases).

### Version scheme

sp4sap follows `v{MAJOR}.{MINOR}.{PATCH}`:
- **MAJOR** — breaking changes to skill API, config schema, or minimum SAP/Claude Code version
- **MINOR** — new skills, new agents, new common rules, backward-compatible feature additions
- **PATCH** — bug fixes, documentation-only changes, non-breaking refactors

### Compatibility

- **Claude Code**: >= 2.x
- **Node.js**: >= 20.0.0
- **SAP**: ECC 6.0 / S/4HANA On-Premise / S/4HANA Cloud (Public & Private)
- **MCP server**: bundled `abap-mcp-adt-powerup` (auto-installed by `/sp4sap:setup`; version pinned by release)

---

← [Back to README](../README.md)
