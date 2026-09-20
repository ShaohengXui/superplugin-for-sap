# Country Reference (국가별 비즈니스·규제 특성)

This folder holds per-country localization and regulatory characteristics that SAP consultants MUST consult alongside `industry/*.md` when performing **configuration analysis, process design, master-data decisions, tax/e-invoicing setup, or any requirement interpretation** that has a jurisdictional dimension.

## When to Use

`sap-*-consultant` agents load the country file for the project when dealing with:

- Date / number / currency / decimal-separator formats
- Tax determination, VAT/GST registration, withholding
- e-Invoicing, tax-reporting, real-time fiscal submissions (SDI, SII, MTD, SAT, Golden Tax, e-tax, NF-e …)
- Bank transfer / payment medium formats (SEPA, ACH, JIS, CMS, Zengin …)
- Statutory reporting (ELSTER, FEC, SPED, GSTR, BAS …)
- Address format, postal code, phone format
- Language, timezone, fiscal-year calendar
- Localization-relevant Customizing (country-specific field extensions, SAP Country Version)

## How to Identify Country

Resolution order:
1. `.sc4sap/config.json` → `country` field (canonical plugin-side source, ISO-3166 alpha-2 like `KR`, `US`, `DE`)
2. `.sc4sap/sap.env` → `SAP_COUNTRY` (MCP-server mirror)
3. Inferred from company-code country (`T001.LAND1`) when analyzing a specific CoCode
4. Ask the user if unset

Multi-country projects: load every relevant country file and flag cross-country touchpoints (intercompany, transfer pricing, VAT ESL).

## Country Files

| File | Country | Key local peculiarities |
|---|---|---|
| [kr.md](kr.md) | 🇰🇷 Korea | e-세금계산서 (KERIS/NTS), 원화, DDMMYYYY → actually YYYY.MM.DD, 주민번호 |
| [jp.md](jp.md) | 🇯🇵 Japan | 請求書 (invoice system 2023+), JPY, Zengin payments, qualified invoice |
| [cn.md](cn.md) | 🇨🇳 China | Golden Tax (金税), 发票 (Fapiao), CNY, e-fapiao rollout |
| [us.md](us.md) | 🇺🇸 United States | Sales & Use Tax (per-state), EIN, 1099, no VAT, ACH / Check |
| [de.md](de.md) | 🇩🇪 Germany | USt, ELSTER, DATEV, IBAN, GoBD, EU VAT |
| [gb.md](gb.md) | 🇬🇧 United Kingdom | VAT, MTD (HMRC), GBP, BACS / FPS |
| [fr.md](fr.md) | 🇫🇷 France | TVA, FEC, FR e-invoicing 2026, SEPA |
| [it.md](it.md) | 🇮🇹 Italy | IVA, FatturaPA / SDI, Split Payment, Esterometro |
| [es.md](es.md) | 🇪🇸 Spain | IVA, SII (real-time VAT), TicketBAI (Basque), SEPA |
| [nl.md](nl.md) | 🇳🇱 Netherlands | BTW, Dutch IBAN/SEPA, EU VAT, XAF |
| [br.md](br.md) | 🇧🇷 Brazil | NF-e / NFS-e, SPED, CFOP, CST, ICMS/IPI/PIS/COFINS |
| [mx.md](mx.md) | 🇲🇽 Mexico | CFDI 4.0, SAT, complementos, e-accounting |
| [in.md](in.md) | 🇮🇳 India | GST (CGST/SGST/IGST), e-invoicing (IRP), e-way bill |
| [au.md](au.md) | 🇦🇺 Australia | GST, STP (payroll), BAS, ABN, BSB banking |
| [sg.md](sg.md) | 🇸🇬 Singapore | GST, IRAS, FATCA/CRS, PayNow, UEN |
| [eu-common.md](eu-common.md) | 🇪🇺 EU-wide | VAT ID format, INTRASTAT, EC Sales List (ESL), VIES, OSS/IOSS |

## File Structure

Each country file contains:
- **Formats** — date, number/decimal/thousand separator, currency code, phone, postal code
- **Language & Locale** — ABAP language keys, typical locale
- **Tax System** — VAT/GST/sales tax structure, rates, registration number format
- **e-Invoicing / Fiscal Reporting** — mandatory systems, go-live dates, formats
- **Banking / Payments** — IBAN/domestic accounts, payment methods, SEPA membership
- **Master Data Peculiarities** — tax numbers, ID numbers, address format quirks
- **Statutory Reporting** — tax returns, payroll, year-end
- **SAP Country Version** — localization delivered with SAP (country-install)
- **Common Customizations** — what projects typically build on top
- **Pitfalls / Anti-patterns**

## Relationship to Industry

`industry/` drives *what the business does*. `country/` drives *what the jurisdiction requires*. Both apply simultaneously — e.g., a Korean cosmetics company loads `industry/cosmetics.md` **and** `country/kr.md`. Conflicts are rare but flag them (e.g., IS-Retail pricing rules vs Korean POS invoicing rules).

## Adding a New Country

1. Copy an existing file as a template (e.g., `kr.md` for APAC, `de.md` for EU).
2. Fill in the sections above.
3. Add a row to the table in this README.
4. If agents will actively need it, update `.sc4sap/config.json` → `country` and `sap.env` → `SAP_COUNTRY` via `/sp4sap:sap-option`.
