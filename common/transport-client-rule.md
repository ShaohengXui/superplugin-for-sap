# Transport Client Rule

When creating a CTS (Change and Transport System) request, the **source client** must always be explicit — never let the MCP layer fall back to an implicit or session-dependent default. A transport opened in the wrong client is silently invisible in the correct client's STMS queue, creates the classic "my object is active in DEV-100 but not in DEV-200" support ticket, and cannot be reassigned after creation without destructive SCC1 copy or manual re-registration.

## Rule

Every call to `CreateTransport` MUST pass the `client` parameter, resolved in this order:

1. **`.sc4sap/sap.env`** → `SAP_CLIENT` (the value the MCP server is actually connected with).
2. **`.sc4sap/config.json`** → `client` (alternative project-level override).
3. If both are missing → **fail fast**; do not proceed with a CreateTransport call. Ask the user to run `/sp4sap:setup` or manually specify the client.

Never rely on the tool's default — there is no guaranteed default, and behavior varies by SAP backend release and RFC/SOAP flavor.

## Why the client matters (SCC4 context)

- SAP systems host multiple **clients** (e.g., 100 for dev, 200 for QA-local, 800 for customizing).
- Each client has a role declared in **SCC4** (`Development` / `Test` / `Customizing` / `Production` / `SAP reference`) and a change-recording mode.
- A transport request is anchored to the client it was opened in. Code objects (PROG, CLAS, DTEL) are client-independent, but the transport *record itself* lives against one client. Moving objects to a transport from a different client raises warnings or silently fails depending on the backend.
- When a user switches sessions (e.g., SAP GUI logon to client 200 while the MCP server is still wired to 100), creating a transport without an explicit client risks either the wrong client being used or a plain API error.

## Resolution Pseudo-Code

```python
def resolve_transport_client():
    client = read_env(".sc4sap/sap.env", "SAP_CLIENT")
    if not client:
        client = read_json(".sc4sap/config.json", "client")
    if not client:
        raise "Refuse to CreateTransport — no client resolved. Run /sp4sap:setup or set SAP_CLIENT manually."
    return client

client = resolve_transport_client()
CreateTransport(
    transport_type="K",    # customizing 'S' or workbench 'K'
    description="...",
    owner=env("SAP_USER"),
    client=client,         # <-- REQUIRED
    target_system=...,
)
```

## Enforcement

- **`sap-executor`** MUST apply this rule before every `CreateTransport` call. When the rule fails, stop and report; do not silently skip.
- **`sap-bc-consultant`** MUST reference this rule when advising on transport creation / client strategy.
- **`sap-code-reviewer`** MAY flag it as a **MAJOR** finding if a freshly-created transport in the current session is missing a recorded client-of-origin.

## Setup contract

`/sp4sap:setup` writes `SAP_CLIENT` to `.sc4sap/sap.env` during Step 4 (SAP connection info). As long as setup completes without skipping that step, the value required by this rule is always present for every subsequent transport-creating call. If a user hand-edits `sap.env` to remove the client, they break this rule and `CreateTransport` must fail fast.
