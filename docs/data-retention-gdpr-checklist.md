# Data Retention & GDPR Checklist

Inventory of personal data in the Gridex Ops Platform and how it is handled.
Verified against schema/code 2026-07-03.

## What personal data is stored, where, and why

| Data | Tables | Purpose / lawful basis | Visibility |
| --- | --- | --- | --- |
| Name, email, phone | `customers`, `customer_contacts`, portal accounts/identities | contract fulfilment | tenant + own customer (portal) |
| Personal number / org number | `customers`, `powers_of_attorney`, website application payloads | market processes (supplier switch requires it), POA evidence | tenant admin; masked in lists where implemented |
| Addresses | `customer_sites`, `customer_addresses`, site address history | delivery point identification | tenant + own customer |
| Metering data | `metering_values`, `normalized_metering_values` | billing/settlement | tenant + own customer |
| Contracts/invoices | `customer_contracts`, `customer_invoices(+lines/documents)`, `contract_price_snapshots` | contract/billing, bookkeeping law | tenant + own customer |
| Legal acceptances | `customer_legal_acceptances` (+ version snapshots) | legal evidence | tenant admin; own customer via portal |
| Powers of attorney | `powers_of_attorney`, POA documents/events, generated PDFs | legal evidence for market actions | tenant admin; own customer |
| Raw inbound emails | `inbound_email_messages` (raw + SHA-256), `manual_inbound_messages` | Ediel transport evidence, parsing audit | platform admin + service role ONLY (RLS platform-scoped) |
| Email attachments | storage buckets + attachment rows | same as above | platform admin |
| Raw EDIFACT payloads | `ediel_messages.raw_*`, canonical snapshots | market message evidence, reprocessing | platform/tenant admin (tenant-scoped rows) |
| Audit logs | `audit_logs`, `power_of_attorney_events`, `company_go_live_reviews` | accountability | admin only |
| API logs | `integration_api_requests`, `customer_portal_api_access_logs` | abuse detection, billing of API usage | platform admin |
| Communication logs | `communication_logs`, email outboxes (subject/recipient; tenant outbox masks sensitive auth-email bodies after send) | delivery evidence | tenant admin |

## Tenant/customer scoping

- All customer-data tables carry `company_id` with RLS
  (`gridex_can_read_company`) — tenants cannot read each other's rows.
- Customer portal exposes only customer-scoped, column-selected reads
  (`lib/customer-portal/**`); raw inbound payloads and operational logs are
  **never** exposed to the portal (verified: portal event select excludes
  internal metadata; inbound tables are platform-RLS-scoped).

## Retention expectations (document + review with legal)

| Data | Retention | Mechanism |
| --- | --- | --- |
| `integration_api_requests`, `webhook_deliveries`, `communication_logs` | time-boxed cleanup exists | retention DELETE in `20260611170000_launch_readiness_*` (configurable day thresholds) |
| Raw inbound emails/attachments | keep ≥ 12 months (parsing/dispute evidence), then archive/delete | **manual — no automatic job; decide policy before launch** |
| Raw EDIFACT payloads | keep per market rules (Ediel dispute window), review yearly | manual |
| Audit/legal (audit_logs, legal acceptances, POA, price snapshots) | do NOT auto-delete; bookkeeping/legal retention (7–10 years for invoice data) | protected (immutability triggers on snapshots/sent invoices) |
| Metering values | contract + settlement lifetime | keep |

## Deletion / access requests (DSR)

- Company-level deletion: guarded flow — `getCompanyDeleteBlockers` blocks hard
  delete while history exists; `pending_deletion` status models the workflow.
- Customer-level deletion/anonymization: **no automated GDPR anonymization job
  exists** (documented in prior readiness notes as intentionally not built).
  Handle DSRs manually: verify identity → export data (portal bundle API gives
  a structured export basis) → anonymize name/contact fields where legal
  retention does not require them → record the action in `audit_logs`.
- Access requests: the customer portal bundle (`/api/v1/customer/portal-bundle`)
  plus legal acceptances/POA endpoints cover the bulk of an access export.

## Logging hygiene rules (verified/required)

- No secrets or API keys in logs; `[REDACTED]`/hash where needed
- No full personal numbers in application logs — inbound parsing stores them in
  payload columns, not in console logs (spot-checked); keep it that way
- Stack traces never sent to clients (structured safe errors; error boundaries)
- `sensitiveStorageMask` masks auth-email bodies in the tenant outbox after send

## Pre-launch actions

- [ ] Decide + document raw email/EDIFACT retention with legal
- [ ] Nominate a DSR owner and test one manual export + one anonymization on staging
- [ ] Verify processor agreements (Supabase, Vercel, Resend, IMAP provider)
- [ ] Breach process: RLS/leak incidents follow
      `docs/incident-response-runbook.md` with 72h assessment
