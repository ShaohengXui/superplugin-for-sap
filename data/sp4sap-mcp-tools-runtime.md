# SC4SAP MCP Tool Catalog — Runtime operations

Runtime diagnostics (dump / profiler / system messages), unit test execution, and service binding validation. Part of [sp4sap-mcp-tools.md](sp4sap-mcp-tools.md).

> `RuntimeListDumps`, `RuntimeListFeeds`, `RuntimeListProfilerTraceFiles`,
> `RuntimeListSystemMessages`, `RuntimeGetDumpById`, `RuntimeGetProfilerTraceData`
> and `RuntimeAnalyzeDump` / `RuntimeAnalyzeProfilerTrace` are **reads** — they
> inspect existing dumps, traces and messages rather than executing ABAP. The
> tier guard therefore leaves them available on QA and PRD. Data-exposure risk is
> handled by the blocklist layer (`MCP_BLOCKLIST_PROFILE`), not the tier guard.

## Runtime* — Dump / Profiler / Diagnostics

- mcp__plugin_sp4sap_sap__RuntimeAnalyzeDump
- mcp__plugin_sp4sap_sap__RuntimeAnalyzeProfilerTrace
- mcp__plugin_sp4sap_sap__RuntimeCreateProfilerTraceParameters
- mcp__plugin_sp4sap_sap__RuntimeGetDumpById
- mcp__plugin_sp4sap_sap__RuntimeGetProfilerTraceData
- mcp__plugin_sp4sap_sap__RuntimeListDumps
- mcp__plugin_sp4sap_sap__RuntimeListFeeds
- mcp__plugin_sp4sap_sap__RuntimeListProfilerTraceFiles
- mcp__plugin_sp4sap_sap__RuntimeListSystemMessages
- mcp__plugin_sp4sap_sap__RuntimeRunClassWithProfiling
- mcp__plugin_sp4sap_sap__RuntimeRunProgramWithProfiling

## Unit Test Execution & Validation

- mcp__plugin_sp4sap_sap__RunUnitTest
- mcp__plugin_sp4sap_sap__ValidateServiceBinding
