# RFC backend managed keys

Referenced by `SKILL.md` from `<Managed_Keys>` and `<Validation>`. Per-backend env fields for `SAP_RFC_BACKEND = soap | native | gateway | odata`.

## Backend selector

- `SAP_RFC_BACKEND` — `soap` (default) | `native` | `gateway` | `odata`
  - `soap` — HTTPS via `/sap/bc/soap/rfc` (reuses `SAP_URL` + `SAP_USERNAME` + `SAP_PASSWORD`; no extra fields needed)
  - `native` — SAP NW RFC SDK directly; requires the native block below **and** the SDK installed on the host
  - `gateway` — remote RFC Gateway middleware via HTTPS/JSON; no SDK on this host, only the gateway block below
  - `odata` — SAP OData v2 service `ZMCP_ADT_SRV` (pure HTTPS — no SDK, no middleware; ABAP side needs `ZCL_ZMCP_ADT_MPC`/`_DPC` installed by setup Step 9c and the service registered in `/IWFND/MAINT_SERVICE`)

## Native block (only when `SAP_RFC_BACKEND=native`)

- `SAP_RFC_ASHOST` — application server host (mutually exclusive with `SAP_RFC_MSHOST`)
- `SAP_RFC_SYSNR` — 2-digit system number (e.g. `00`)
- `SAP_RFC_CLIENT` — 3-digit client; usually same as `SAP_CLIENT`
- `SAP_RFC_USER` — RFC user (dedicated user with `S_RFC` auth recommended)
- `SAP_RFC_PASSWD` — **secret — always mask when displaying**
- `SAP_RFC_LANG` — 2-letter uppercase, default `EN`
- `SAP_RFC_MSHOST` — (optional) message server host for load-balanced connection
- `SAP_RFC_SYSID` — required when `SAP_RFC_MSHOST` is set
- `SAP_RFC_GROUP` — logon group, default `PUBLIC`
- `SAP_RFC_MSSERV` — (optional) message server service/port override
- `SAP_RFC_SNC_QOP` — SNC quality-of-protection level (e.g. `8`)
- `SAP_RFC_SNC_MYNAME` — required when `SAP_RFC_SNC_QOP` is set
- `SAP_RFC_SNC_PARTNERNAME` — required when `SAP_RFC_SNC_QOP` is set
- `SAP_RFC_SNC_LIB` — (optional) path to SNC library

## Gateway block (only when `SAP_RFC_BACKEND=gateway`)

- `SAP_RFC_GATEWAY_URL` — e.g. `https://rfc-gw.company.com:8443` (required)
- `SAP_RFC_GATEWAY_TOKEN` — Bearer token from gateway ACL — **secret, always mask when displaying**
- `SAP_RFC_GATEWAY_TLS_VERIFY` — `1` (default) or `0` (self-signed dev gateways only)

> When `SAP_RFC_BACKEND=gateway`, the existing `SAP_USERNAME`/`SAP_PASSWORD`/`SAP_CLIENT`/`SAP_LANGUAGE` values (already managed for ADT HTTPS) are forwarded to the gateway per-request as `X-SAP-User`/`X-SAP-Password`/`X-SAP-Client`/`X-SAP-Language` headers. No separate RFC user is needed on this host — the gateway uses these to open a per-developer RFC session so SAP audit trail remains accurate.

## OData block (only when `SAP_RFC_BACKEND=odata`)

- `SAP_RFC_ODATA_SERVICE_URL` — e.g. `https://sap.company.com:44300/sap/opu/odata/sap/ZMCP_ADT_SRV` (required)
- `SAP_RFC_ODATA_CSRF_TTL_SEC` — CSRF token cache TTL in seconds, default `600` (min 60)

> When `SAP_RFC_BACKEND=odata`, the existing `SAP_USERNAME` / `SAP_PASSWORD` are reused as Basic auth against the OData service URL, and `SAP_CLIENT` is appended as `?sap-client=<n>` on every request. No extra credential block is needed. The client performs an automatic CSRF handshake on first call (GET `$metadata` with `X-CSRF-Token: Fetch`), caches the token for `SAP_RFC_ODATA_CSRF_TTL_SEC` seconds, and refreshes on HTTP 403.

## Validation rules (applied by sap-option workflow)

- `SAP_RFC_BACKEND`: one of `soap` | `native` | `gateway` | `odata`. On switching:
  - → `native`: warn `SAP_RFC_USER`/`SAP_RFC_PASSWD`/`SAP_RFC_CLIENT` and one of (`SAP_RFC_ASHOST`+`SAP_RFC_SYSNR`) or (`SAP_RFC_MSHOST`+`SAP_RFC_SYSID`) must be set before MCP reconnect
  - → `gateway`: warn `SAP_RFC_GATEWAY_URL` must be set and the gateway must be reachable
  - → `odata`: warn `SAP_RFC_ODATA_SERVICE_URL` must be set, MPC/DPC classes must be installed (setup Step 9c), and the service must be registered in `/IWFND/MAINT_SERVICE`
  - Always suggest running `/sp4sap:sap-doctor` afterwards to exercise Layer 6.
- `SAP_RFC_SYSNR`: exactly 2 digits (`00`–`99`).
- `SAP_RFC_CLIENT`: exactly 3 digits.
- `SAP_RFC_LANG`: 2-letter uppercase.
- `SAP_RFC_ASHOST` / `SAP_RFC_MSHOST`: mutually exclusive — reject if both are non-empty simultaneously.
- `SAP_RFC_SNC_QOP`: one of `1`|`2`|`3`|`8`|`9`. When set, `SAP_RFC_SNC_MYNAME` and `SAP_RFC_SNC_PARTNERNAME` become required.
- `SAP_RFC_PASSWD`: no validation on content (may contain anything), but refuse empty.
- `SAP_RFC_GATEWAY_URL`: must match `^https?://[^ ]+` and not end with `/` (trailing slash is stripped automatically at call time but reject here for cleanliness).
- `SAP_RFC_GATEWAY_TLS_VERIFY`: `0` or `1`. Warn that `0` is dev-only (allows self-signed certs on internal gateways).
- `SAP_RFC_ODATA_SERVICE_URL`: must match `^https?://[^ ]+` and not end with `/` (trailing slashes stripped automatically at call time; reject on input for cleanliness).
- `SAP_RFC_ODATA_CSRF_TTL_SEC`: integer ≥ 60. Values below 60 silently clamp to 60 on the client; reject non-numeric input.
