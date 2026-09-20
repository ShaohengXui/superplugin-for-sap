# Connecting sp4sap to a generic MCP client

sp4sap's SAP capability lives in the MCP server, not in Claude Code. The same
server process serves every client; what differs is only how the client is told
to launch it.

```
any MCP client ──stdio──> bridge/mcp-server.cjs ──> vendor/abap-mcp-adt (150+ ADT tools) ──> SAP
                                │
                                └─ resolves the active profile's sap.env, sets MCP_ENV_PATH,
                                   optionally enforces the QA/PRD write guard
```

## One command install

```bash
node bridge/cli.cjs install              # every client detected on this machine
node bridge/cli.cjs install --client codex
node bridge/cli.cjs install --client zcode --scope project
node bridge/cli.cjs install --mcp-only   # skip the skills/agents plugin
node bridge/cli.cjs install --dry-run    # print what would change, change nothing

node bridge/cli.cjs status               # detected clients + what is registered
node bridge/cli.cjs doctor               # bridge, vendor pin, active tier
node bridge/cli.cjs uninstall            # remove everything it added
```

If installed via npm, the same commands are available as `sp4sap`
(`npx @shaohengxui/superplugin-for-sap install`).

What it does per client:

| Client | How | What you get |
|---|---|---|
| Claude Code | `claude plugin marketplace add` + `claude plugin install` | skills + agents + MCP; falls back to `claude mcp add -s user` |
| Codex | `codex plugin marketplace add` + `codex plugin add` | skills + MCP; falls back to `codex mcp add` |
| ZCode | writes `<repo>/.zcode/config.json` → `mcp.servers.sap` | MCP only — ZCode has no CLI for MCP or plugin install |

Design guarantees: it prefers each client's own CLI over editing its config;
it backs up any file it edits; it is idempotent (re-running updates in place);
it never writes a credential; and `uninstall` reverses it. ZCode plugin install
is UI-only (Settings → Plugin Management → Discover → `+`), and the installer
prints that path for you.

## What to point the client at (manual)

| Client | Configure with | Template |
|---|---|---|
| ZCode (plugin install) | nothing — ZCode reads `.claude-plugin/plugin.json`, `.mcp.json` and `skills/` | — |
| ZCode (workspace scope) | `<repo>/.zcode/config.json` → `mcp.servers` | [`zcode.workspace.json`](zcode.workspace.json) |
| Codex | `~/.codex/config.toml` → `[mcp_servers.sap]` | [`codex.config.toml`](codex.config.toml) |
| Claude Desktop / Cline / Continue / Zed | `mcpServers` JSON | [`generic-mcp.json`](generic-mcp.json) |
| Claude Code | nothing — `.claude-plugin/` + `.mcp.json` already wired | — |

The launch command is always the same:

```bash
node <SC4SAP_ROOT>/bridge/mcp-server.cjs
```

`SC4SAP_ROOT` is the absolute path to this repository/plugin checkout. The
bridge derives everything else from its own location, so it does not need a
`CLAUDE_PLUGIN_ROOT`-style variable.

Note for ZCode: a `.zcode/config.json` written by the installer contains
absolute, machine-specific paths (the bridge path and the profile env path), so
keep it out of version control — the installer says so when it writes one.

`zcode.workspace.json` is deliberately minimal: ZCode's configuration-file
schema is strict and drops a server whose entry carries an unknown key, so the
template contains only documented fields (no `_comment`, no placeholders beyond
the two angle-bracket paths you must replace). Templates for the tolerant
clients (`generic-mcp.json`) carry inline `_comment` guidance; the ZCode one
does not, on purpose.

## Credentials

Three supported paths, in precedence order:

1. **`SC4SAP_ENV_FILE`** (or `MCP_ENV_PATH`) — absolute path to a profile
   `sap.env`. Most reliable for non-Claude clients, because it does not depend
   on the client's working directory.
2. **Profile discovery** — `<cwd>/.sc4sap/active-profile.txt` →
   `$SC4SAP_HOME_DIR|~/.sc4sap/profiles/<alias>/sap.env`, then the legacy
   `<cwd>/.sc4sap/sap.env`. This is what Claude Code and Zcode hit, since they
   launch a plugin MCP server with the project as cwd.
3. **Process environment** — set `SAP_URL`, `SAP_CLIENT`, `SAP_USERNAME`,
   `SAP_PASSWORD`, ... in the client's `env` block. No file on disk is needed.

The password itself should stay in the OS keychain. Write a profile with
`node scripts/sap-profile-cli.mjs add`, which stores the secret under service
`sp4sap` / account `<alias>/<username>` and leaves only a
`SAP_PASSWORD=keychain:sp4sap/<alias>/<user>` reference in `sap.env`. The MCP
server resolves that reference itself at startup.

**Never commit `sap.env`, and never put a password in a client config file.**

## Write protection on QA/PRD

Three independent layers; a generic client gets layer 2 and can opt into 1.5:

| Layer | Where | Applies to |
|---|---|---|
| **L1** | `scripts/hooks/tier-readonly-guard.mjs` — client hook | Claude Code, Zcode (hooks), Codex (hooks enabled) |
| **L1.5** | `bridge/mcp-server.cjs` — MCP proxy, `SC4SAP_TIER_GUARD=proxy` | any stdio client |
| **L2** | inside `abap-mcp-adt-powerup` — server-side, uncircumventable | every client, always |

The block matrix (DEV allows everything; QA blocks mutations plus code
execution but allows `RunUnitTest`; PRD blocks both) lives in exactly one place,
`scripts/lib/tier-guard.mjs`, shared by all three enforcement points.

Clients with no hook system should set `SC4SAP_TIER_GUARD=proxy` — the bridge
then relays JSON-RPC and rejects blocked `tools/call` requests before they reach
SAP. Verified behaviour:

- `UpdateClass` / `DeleteProgram` / `ActivateObjects` on a PRD profile →
  JSON-RPC error `-32001`, the vendor server never sees the call
- `GetClass` / `tools/list` on PRD → forwarded normally
- same mutation on a DEV profile → forwarded normally
- `SC4SAP_TIER_GUARD` unset → guard off, in-process launch, byte-identical to
  the Claude Code behaviour before this option existed

## Guarding a client that has hooks

Run the portable CLI from the client's hook instead of the Claude-specific hook:

```bash
# Reads a hook payload on stdin, emits Claude/Zcode PreToolUse JSON, exit 3 on deny
echo '{"tool_name":"mcp__sap__UpdateClass"}' | node scripts/tier-guard-cli.mjs

# Or check one tool directly (CI-friendly)
node scripts/tier-guard-cli.mjs --tool UpdateClass --tier PRD --json
node scripts/tier-guard-cli.mjs --explain      # show resolved tier + source
```

Exit codes: `0` allowed, `3` denied, `2` usage error.

## Diagnostics

```bash
# Resolved tier and where it came from
node scripts/tier-guard-cli.mjs --explain

# Vendor install + pinned-SHA health
node scripts/build-mcp-server.mjs --check

# Run the server by hand to see its stderr
node bridge/mcp-server.cjs
```

If a client reports "connected" but lists no tools, the server exited during
startup — run the command above in a terminal; the bridge prints a specific
remediation for a missing env file or a missing vendor build.

## Verifying the connection end to end

1. `GetSession` → should return the SAP system ID, client and user.
2. Read one object: `GetClass` on a known class.
3. Run the object's ABAP Unit tests: `RunUnitTest`, then `GetUnitTestResult`.
   For a static read, `GetAbapSemanticAnalysis` returns the semantic check output.
4. Switch to a QA/PRD profile, attempt `UpdateClass` → must be rejected with
   `ERR_READONLY_TIER` (L2) or the L1.5 denial above.

> **There is no ATC tool.** The vendor registers no ATC / `RunAtcCheck` handler
> (see the catalog in `data/sp4sap-mcp-tools-{read,write,runtime}.md` — the only
> match for "atc" is `PatchGuiStatus`). ATC cannot be run over MCP with this
> tool set; `RunUnitTest` and `GetAbapSemanticAnalysis` are the available
> correctness checks.
