# Invoice providers and invoice files (OPS)

Each organization chooses how its approved invoices reach the invoice provider. The choice is made in
OPS under **Fakturering → Integrationer** and applies to that organization only.

| Provider | How invoices are delivered | Status |
|---|---|---|
| Capway | Each approved invoice is sent through Capway's API. | Available (test environment in use) |
| Fil till fakturaleverantör | Approved invoices are collected into a file that the organization imports at its invoice provider. | Available |
| Nordfin | — | Listed, not selectable until the integration is built |

## Setup

1. Choose provider and environment (test or production) and save. Changing provider or environment
   turns sending off; it is blocked while an export run is open.
2. Capway: run **Testa Aptic-anslutning**. Sending can only be activated after a passed test.
   File: no credentials are needed; the connection is ready at once.
3. Activate sending. Every step is written to the audit log.

Invoices are never sent to a provider the organization has not selected, or to another environment
than the selected one. There is no default provider.

## Invoice files

On **Fakturor**, approve the invoices for the month and press **Skapa fakturafil**.

- Every invoice passes the same checks as an API send (underlay, locked pricing, amounts, price area).
- An invoice can be in exactly one file. The invoices are marked sent in the same transaction that
  creates the file; if any invoice changed in the meantime, no file is created.
- A file is immutable. Every download of the same file returns the same content.
- Formats: CSV (semicolon separated, UTF-8 with BOM), Excel (.xlsx) and JSON.
- Payment term: 20 days from the invoice date (Europe/Stockholm).

### Columns (CSV/Excel)

| Column | Content |
|---|---|
| Fakturanummer | Invoice number (`GX-YYYYMM-xxxxxxxx` when none is assigned) |
| Kundnummer, Kundnamn, Kundtyp | From the customer card (`private` / `business`) |
| Person-/organisationsnummer | Personal number for private customers, organization number for business customers |
| Fakturamottagare, Faktura-e-post, Referens, Gatuadress, Postnummer, Ort, Land | Invoice delivery as resolved when the invoice was prepared |
| Fakturamånad, Period från, Period till, Elområde | Billing period and price area |
| Förbrukning kWh | Consumption |
| Belopp exkl moms, Moms, Belopp inkl moms, Valuta | Amounts in SEK, two decimals |
| Fakturadatum, Förfallodatum | `YYYY-MM-DD` |
| Gridex-ID | Stable identifier of the invoice in Gridex |

Text that starts with `=`, `+`, `-` or `@` is prefixed with `'` so spreadsheet programs never run it
as a formula.

### JSON

`{ "format": "gridex_invoice_file_v1", "file_id", "billing_month", "created_at", "rows_sha256", "invoices": [...] }`.
Each invoice has the fields above plus `lines` (description, quantity, unit, unit price excl. VAT,
amount excl. VAT). `rows_sha256` identifies the exact content of the file.
