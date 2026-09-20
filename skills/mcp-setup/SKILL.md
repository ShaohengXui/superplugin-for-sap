---
name: sp4sap:mcp-setup
description: Guide to install and configure the abap-mcp-adt-powerup MCP server for SAP ADT connectivity
level: 2
model: haiku
---

# SC4SAP MCP Setup

Guides you through installing and configuring the `abap-mcp-adt-powerup` MCP server, which provides Claude Code with direct connectivity to your SAP system via ABAP Development Tools (ADT) REST APIs. The server exposes 150+ tools covering CRUD for ABAP objects (class, program, CDS, FM, table, etc.) plus runtime, transport, and data-preview operations.


<Purpose>
`abap-mcp-adt-powerup` is the bridge between Claude Code and your SAP system. Without it, no SC4SAP skills can read or write ABAP objects. This skill walks you through cloning, configuring, and registering the server so all MCP tools become available.
</Purpose>

<Response_Prefix>
Every response triggered by this skill MUST begin with `[Model: <main-model> · Dispatched: <sub-summary>]` per [`../../common/model-routing-rule.md`](../../common/model-routing-rule.md) § Response Prefix Convention.
</Response_Prefix>

<Source>
MCP server repository: https://github.com/babamba2/abap-mcp-adt-powerup.git
Installed at: `${CLAUDE_PLUGIN_ROOT}/vendor/abap-mcp-adt/` (internal directory name kept short for path-length safety on Windows).
</Source>

<Prerequisites>
- Node.js 18+ installed
- Access to a SAP system with ADT service enabled (transaction SICF, service `/sap/bc/adt` active)
- SAP user with developer authorizations (S_DEVELOP, S_TRANSPRT)
- Claude Code, ZCode, Codex, or any other MCP-capable client
</Prerequisites>

<Installation_Steps>
1. **Automatic installation (recommended)**
   The MCP server is automatically installed into the plugin's `vendor/abap-mcp-adt/` directory during setup:
   ```bash
   /sp4sap:setup          # full setup wizard (includes MCP install)
   /sp4sap:setup mcp      # MCP install only
   ```
   Or via npm:
   ```bash
   npm run build          # runs tsc + installs abap-mcp-adt into vendor/
   ```
   This clones the repo at a pinned commit, runs `npm install`, and builds it. The plugin's `.mcp.json` is pre-configured to launch `bridge/mcp-server.cjs`, which delegates to the vendor-installed server. Set `SC4SAP_VENDOR_DIR` to run against a vendor checkout outside the plugin tree.

2. **Configure the SAP connection (multi-profile, 0.6.0+)**
   Connection settings live in the **active profile**, not in the plugin directory. Create one with the setup wizard or the profile CLI — do not hand-write the file:
   ```bash
   /sp4sap:setup              # wizard: creates the profile, stores the password, writes the pointer
   ```
   Or directly:
   ```bash
   # password is read from stdin JSON only — never pass it as an argument
   echo '{"alias":"S4-DEV","url":"https://your-sap-host:44300","client":"100",
          "username":"your-user","password":"<captured>","language":"EN",
          "systemType":"s4hana","tier":"DEV"}' \
     | node scripts/sap-profile-cli.mjs add
   ```
   Layout this produces:
   ```
   ~/.sc4sap/profiles/<alias>/sap.env      # connection + policy; password is a keychain reference
   ~/.sc4sap/profiles/<alias>/config.json  # sapVersion, abapRelease, industry, activeModules, tier
   <project>/.sc4sap/active-profile.txt    # one line: the active alias
   ```
   The resulting `sap.env` looks like:
   ```env
   SAP_URL=https://your-sap-host:44300
   SAP_CLIENT=100
   SAP_AUTH_TYPE=basic
   SAP_USERNAME=your-user
   SAP_PASSWORD=keychain:sp4sap/<alias>/your-user
   SAP_LANGUAGE=EN
   SAP_SYSTEM_TYPE=s4hana          # s4hana | cloud | ecc
   SAP_VERSION=S4                  # S4 | ECC
   ABAP_RELEASE=756
   SAP_TIER=DEV                    # DEV | QA | PRD — drives the write guard
   SAP_INDUSTRY=kr
   SAP_ACTIVE_MODULES=MM,SD,FI

   # --- Blocklist policy (optional) ---
   # Controls the row-extraction guard. Defaults to `standard`.
   #   minimal  — block only PII/credentials/banking
   #   standard — minimal + Protected Business Data (ACDOCA, BKPF, VBAK, EKKO, ...)  [default]
   #   strict   — standard + Audit/Security + Communication/Workflow
   #   off      — disable the guard entirely (NOT recommended)
   # MCP_BLOCKLIST_PROFILE=standard
   # MCP_BLOCKLIST_EXTEND=ZHR_SALARY,ZCUSTOMER_PII
   # MCP_ALLOW_TABLE=ACDOCA
   ```
   - `SAP_PASSWORD`: **never store the password in plaintext here.** `sap-profile-cli.mjs add` writes the secret to the OS keychain (service `sp4sap`, account `<alias>/<username>`) and leaves only the `keychain:` reference. If the keyring module is unavailable (headless/CI) the CLI falls back to plaintext and warns on stderr.
   - `SAP_TIER`: `DEV` | `QA` | `PRD`. QA and PRD block mutations and ABAP execution in two independent layers (client hook + MCP server guard). See [`../../docs/FEATURES.md`](../../docs/FEATURES.md) § Tier-based readonly enforcement.
   - `SAP_SYSTEM_TYPE`: `s4hana` for on-premise S/4HANA, `cloud` for BTP, `ecc` for ECC.
   - `TLS_REJECT_UNAUTHORIZED`: set to `0` only for a self-signed certificate on a dev system — never in production.
   - `MCP_BLOCKLIST_PROFILE` *(optional)*: `minimal` | `standard` | `strict` | `off` — risk tier for the row-extraction guard. Leave unset for the safe default (`standard`).
   - `MCP_BLOCKLIST_EXTEND` *(optional)*: comma-separated extra names/patterns (always denied). Use for site-specific Z-tables containing sensitive data.
   - `MCP_ALLOW_TABLE` *(optional)*: comma-separated whitelist for an audited one-off bypass. Logged to stderr. Remove when not actively needed.

   How the server finds this file, in precedence order:
   1. `SC4SAP_ENV_FILE` (or `MCP_ENV_PATH`) — an absolute path, for any MCP client that launches the server from an arbitrary directory.
   2. `<cwd>/.sc4sap/active-profile.txt` → `~/.sc4sap/profiles/<alias>/sap.env`.
   3. `<cwd>/.sc4sap/sap.env` — legacy single-profile layout.
   4. `SAP_*` variables in the process environment, with no file at all.

   Process environment variables take precedence over file values. `sap.env` is **not** hot-reloaded — restart the client (or reconnect MCP) after changing it.

3. **Verify the connection**
   After restarting the client (or reconnecting MCP), run:
   ```
   /sp4sap:sap-doctor
   ```
   Or manually test by calling `GetSession` — it should return your SAP system ID, client, and username.

4. **Other MCP clients (ZCode, Codex, …)**
   The same server serves every client; only the launch configuration differs:
   ```bash
   node bridge/cli.cjs install                 # detect and register every client found
   node bridge/cli.cjs install --client codex  # or zcode / claude
   node bridge/cli.cjs install --dry-run       # preview without changing anything
   node bridge/cli.cjs status                  # what is registered where
   ```
   See [`../../mcp/README.md`](../../mcp/README.md) for the manual configuration templates and the write-guard layering per client. Clients with no hook system should set `SC4SAP_TIER_GUARD=proxy` so the QA/PRD guard is enforced in the MCP layer.

5. **Update the MCP server**
   To update to the latest version:
   ```bash
   node scripts/build-mcp-server.mjs --update
   ```
</Installation_Steps>

<Troubleshooting>
- **401 Unauthorized**: Check `SAP_USERNAME` / `SAP_PASSWORD` in `.sc4sap/sap.env`; confirm the user is not locked (SU01).
- **Connection refused**: Verify `SAP_URL` host and ICM HTTPS port; check VPN if required.
- **ADT service not found**: Activate `/sap/bc/adt` in transaction SICF and ensure ICF is running.
- **SSL certificate errors**: Add the SAP system certificate to Node.js trust store (recommended), or temporarily set `TLS_REJECT_UNAUTHORIZED=0` in `sap.env` (dev only — never in prod).
- **No tools visible in the client**: reconnect the MCP server after editing `sap.env` — changes are NOT hot-reloaded. Run the launch command in a terminal to see its stderr:
  ```bash
  node bridge/mcp-server.cjs
  ```
  The bridge prints a specific remediation for a missing profile env file or a missing vendor build. In Claude Code, MCP stderr logs also land under `%LOCALAPPDATA%\claude-cli-nodejs\Cache\<cwd-slug>\mcp-logs-plugin-sp4sap-sap\` (Claude Code only); ZCode surfaces the same output under Settings → MCP.
- **`Config not found` on startup**: the bridge could not resolve a profile. Point it at one explicitly with `SC4SAP_ENV_FILE`, or run the client from inside the project that holds `.sc4sap/active-profile.txt`.
- **Blocklist refusal on a legitimate table**: Run `/sp4sap:sap-option` to adjust `MCP_BLOCKLIST_PROFILE` or add the table to `MCP_ALLOW_TABLE` (audited bypass).
- **`vendor/abap-mcp-adt` not built**: Re-run `node scripts/build-mcp-server.mjs` (or `--update` to refresh).
</Troubleshooting>

<Security_Notes>
- Never commit `.sc4sap/sap.env` (the dotenv file with SAP credentials) to version control. It is git-ignored by default.
- Use process-level environment variables to override `sap.env` values in CI/CD, so secrets never touch disk.
- Prefer a read-only SAP user for analysis-only workflows.
- `TLS_REJECT_UNAUTHORIZED=0` is **dev-only** — never set in production. Install the SAP system certificate into Node.js trust store instead.
- The MCP server communicates only with the SAP host in `SAP_URL`. No outbound calls to third parties.
- Row-extraction on sensitive tables is gated by the blocklist policy above (`MCP_BLOCKLIST_PROFILE`, `MCP_BLOCKLIST_EXTEND`, `MCP_ALLOW_TABLE`). See `common/data-extraction-policy.md`.
</Security_Notes>

<Health_Check>
When `ARGUMENTS` is `check` / `verify` / `status` (case-insensitive), run the vendor pin health check inline and report — do not print the full installation guide.

**Execution**:
1. Resolve plugin root (from `CLAUDE_PLUGIN_ROOT` env; fallback to cache path `~/.claude/plugins/cache/sp4sap/sp4sap/<version>/`).
2. Run: `node "<plugin>/scripts/build-mcp-server.mjs" --check`
3. Read the script's exit code and stdout/stderr.
4. Format the result for the user:

| Exit | Meaning | User message (follow conversation language) |
|---|---|---|
| **0** + `pinned to <SHA> ✓` on stdout | OK — vendor matches expected pin | ✅ abap-mcp-adt vendor verified · pinned to `<SHA>` (truncate to first 12 chars) |
| **0** + `pin cannot be verified` on stderr | WARN — launcher OK, `.git` stripped (packaged cache install) | ⚠️ Vendor launcher present, but pin cannot be verified (packaged cache lacks `.git`). Expected pin: `<SHA>`. To force a verifiable reinstall: `node scripts/build-mcp-server.mjs --update`. |
| **1** | FAIL — vendor missing | ❌ abap-mcp-adt not installed. Run: `node scripts/build-mcp-server.mjs` (or `/sp4sap:setup mcp`). |
| **2** | FAIL — pin drift | ❌ abap-mcp-adt vendor drift detected (current HEAD ≠ pinned SHA). Run: `node scripts/build-mcp-server.mjs --update`. |

**Output format** (single block):
```
MCP Vendor Health Check
=======================
Status:  <OK|WARN|FAIL>
Pin:     <expected SHA>
Current: <current HEAD or "unverified" or "not installed">
Action:  <user message from table above>
```

STOP after printing — do not fall through to the full installation guide.
</Health_Check>

Task: {{ARGUMENTS}}
