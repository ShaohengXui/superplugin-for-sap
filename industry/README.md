# Industry Reference

This folder holds per-industry business-characteristic references that SAP consultant agents MUST consult when performing **configuration analysis, process design, Fit-Gap analysis, master data modeling, or requirement interpretation**.

## When to Use

Every `sap-*-consultant` agent must load the project's industry file before responding to:

- SPRO / Customizing analysis (org structure, pricing, output, account determination, etc.)
- Business process design or review
- Fit-Gap analysis
- Master data modeling
- Ambiguous requirements that require domain judgement
- SAP Industry Solution (IS-*) applicability decisions

## How to Identify Industry

Resolution order:
1. `.sc4sap/config.json` → `industry` field (canonical plugin-side source)
2. `.sc4sap/sap.env` → `SAP_INDUSTRY` (MCP-server mirror, must match config.json)
3. If both are missing, ask the user and direct them to persist via `/sp4sap:sap-option`
4. If the value is `other`, skip the industry reference and fall back to standard, industry-agnostic recommendations

**Change industry**: `/sp4sap:sap-option` → type `industry` (updates both files atomically).
**Initial selection**: `/sp4sap:setup` wizard, step 2.

## Industry Files

| File | Industry | Primary SAP Industry Solution |
|---|---|---|
| [retail.md](retail.md) | Retail | IS-Retail, CAR, S/4HANA for Retail |
| [fashion.md](fashion.md) | Fashion / Apparel | AFS, FMS, S/4HANA for Fashion |
| [cosmetics.md](cosmetics.md) | Cosmetics | IS-CP, Batch Mgmt |
| [tire.md](tire.md) | Tire | Discrete + Repetitive + Process (mixed) |
| [automotive.md](automotive.md) | Automotive | IS-Auto, JIT/JIS, Scheduling Agreement |
| [pharmaceutical.md](pharmaceutical.md) | Pharmaceutical | IS-Pharma, GMP, Serialization |
| [food-beverage.md](food-beverage.md) | Food & Beverage | IS-CP, Catch Weight, Batch, Shelf Life |
| [chemical.md](chemical.md) | Chemical | IS-Chem, EHS, Dangerous Goods, Process Mfg |
| [electronics.md](electronics.md) | Electronics / High-Tech | High-Tech, CTO, Serial Number |
| [construction.md](construction.md) | Construction / E&C | IS-EC&O, PS, Progress Billing |
| [steel.md](steel.md) | Steel / Metals | IS-Mill Products, Catch Weight, Characteristic |
| [utilities.md](utilities.md) | Utilities | IS-U, FI-CA, Device Mgmt |
| [banking.md](banking.md) | Banking / Financial Services | IS-Banking, FS-CD |
| [public-sector.md](public-sector.md) | Public Sector | IS-PS, Funds Mgmt, Grants Mgmt |

## Usage Pattern

```markdown
1. Receive request
2. Identify industry (config.json → sap.env → ask user)
3. Load `industry/{industry}.md`
4. Apply "Key Processes", "Master Data", "Common Customizations" sections to the configuration analysis
5. Explicitly warn when a proposed standard configuration conflicts with an industry characteristic
```

## File Structure

Each industry MD file contains the following sections:
- **Business Characteristics** — defining traits of the industry
- **Key Processes** — core business processes
- **Master Data Specifics** — master data peculiarities
- **Module Implications** — SD / MM / PP / FI / CO / WM / etc. implications
- **Common Customizations** — frequently required enhancements
- **SAP Industry Solutions** — relevant SAP IS offerings
- **Pitfalls / Anti-patterns** — patterns to avoid
