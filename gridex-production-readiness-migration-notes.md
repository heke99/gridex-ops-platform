# Gridex OPS Production Readiness — Migration Notes & Go-Live Checklist

Scope: customer intake / supplier switch lifecycle and metering / pricing / billing /
invoice export lifecycle hardening (branch `cursor/gridex-production-readiness-a7d8`).

## 1. Migrations (apply in timestamp order)

All migrations are guarded (`to_regclass` / `IF NOT EXISTS` / `DO $$ ... $$`) and safe to
run on databases where earlier tables are missing. Unique indexes that could conflict
with legacy data are **pre-checked**: when live duplicates exist the index is skipped
with a `RAISE NOTICE` and must be created manually after cleanup. **Watch the NOTICE
output when applying.**

### 20260702090000_gridex_production_readiness_switch_intake_constraints.sql (Migration A)

| Change | Details |
| --- | --- |
| `supplier_switch_requests` | + `readiness_snapshot jsonb`, + `readiness_checked_at timestamptz` (nullable, no backfill needed) |
| `customer_application_intakes` | + `customer_id uuid FK`, + `result jsonb`, + `completed_at timestamptz` |
| `supplier_switch_requests_open_site_uidx` | Partial unique: max one **open** switch per `(company_id, site_id)`. Skipped with NOTICE if duplicates exist — cancel/complete stale switches, then create manually. |
| `customer_application_intakes_admin_idem_uidx` | Partial unique for admin intakes (`api_client_id IS NULL`) — closes the NULL-distinct gap in the existing unique constraint. |
| `customer_contracts_single_active_per_site_uidx` | Partial unique: max one `status='active'` contract per `(company_id, site)`. Skipped with NOTICE if parallel active contracts exist — terminate/correct manually. |

Rollback: drop the added indexes/columns; no data is mutated.

### 20260702120000_gridex_billing_pricing_immutability_constraints.sql (Migration B)

| Change | Details |
| --- | --- |
| `contract_price_snapshots` | Trigger `gridex_block_contract_price_snapshot_mutation` blocks UPDATE/DELETE. Escape hatch: `set_config('app.gridex_pricing_maintenance','on',true)` within a maintenance session. |
| `pricing_runs` | Trigger `gridex_protect_locked_pricing_runs` blocks UPDATE/DELETE of `status='locked'` rows. Unlock only via the audited RPC below. |
| `gridex_unlock_pricing_runs_for_month(company_id, billing_month, actor, reason)` | `SECURITY DEFINER` RPC (service_role only) that transitions locked runs back to `success` for one month; called by `unlockBillingPeriod`. |
| **Backfill** | Older duplicate `success`/`locked` runs per `(company_id, billing_underlay_id)` are marked `superseded` (newest wins; locked preferred). |
| `pricing_runs_active_per_underlay_uidx` | Partial unique: one active (`success`/`locked`) run per company + underlay. |
| Check constraints (`NOT VALID`, validated when data permits) | `pricing_runs` period order + status set, `pricing_preview_lines.vat_rate >= 0`, `billing_underlays` period order + `price_area in (SE1..SE4)`. |
| Hot-path indexes | `normalized_metering_values`, `pricing_preview_lines`, `pricing_runs`, `billing_underlays` lookup indexes. |

Manual flag: if the constraint validation NOTICEs report rows that fail validation,
inspect and fix them, then `ALTER TABLE ... VALIDATE CONSTRAINT ...`.

### 20260702130000_gridex_invoice_export_attempts_retry.sql (Migration C)

| Change | Details |
| --- | --- |
| `invoice_export_attempts` (new) | Per-attempt audit: attempt no, idempotency key, request hash, HTTP status, outcome, error code, response excerpt, timings. RLS: service_role only. |
| `invoice_export_items` | + `attempt_count`, `next_retry_at`, `last_attempt_at`, `error_code`. Status check extended (additive) with `rejected`, `configuration_error`, `failed_retryable`, `needs_review`. |
| `invoice_export_items_retry_due_idx` | Partial index for due-retry scans. |

The application degrades gracefully pre-migration (falls back to legacy columns and
maps new statuses to `failed`), but retries only activate once this migration is live.

### 20260702140000_gridex_portal_invoice_webhook_loop.sql

| Change | Details |
| --- | --- |
| `customer_invoices_company_partner_ref_uidx` | Partial unique on `(company_id, partner_invoice_reference)` enabling idempotent portal-invoice upserts from provider events. Pre-checked; skipped with NOTICE if duplicates exist. |
| `invoice_provider_events_pending_idx` | Partial index for `status='received'` event sweeps. |

### 20260702150000_gridex_sent_invoice_protection.sql

| Change | Details |
| --- | --- |
| `invoice_export_items` | Trigger `gridex_protect_sent_invoice_export_items`: blocks DELETE and financial mutation of `sent`/`credited` items, blocks status resets to sendable states, blocks rewriting `provider_invoice_guid`. Allows legitimate webhook transitions (`credited`, `disputed`, `cancelled`, `paid`...). Maintenance escape hatch as in Migration B. |

## 2. Go-live checklist

1. **Apply the five migrations in order** on staging first; capture and review every
   `NOTICE` line. Any skipped unique index = pre-existing duplicate data that must be
   cleaned up manually (queries are embedded in each NOTICE message).
2. **Run the reconciliation SQL** (`supabase/sql/checks/production_consistency_checks.sql`)
   before and after go-live; the same checks render on `/admin/system-health`
   ("Avstämningar (produktion)"). All checks should be zero-count or explained.
3. **Cron**: `vercel.json` now schedules `/api/cron/billing/invoice-export-retry`
   every 15 minutes (retries + provider-event sweep). Verify `CRON_SECRET` is set in
   the deployment environment (same auth as the monthly billing cron).
4. **Capway environment separation**: confirm per-company Capway connection config
   points at the production endpoint before enabling live export; token/auth failures
   now surface as `configuration_error` (never auto-retried).
5. **Pricing lock discipline**: after go-live, re-pricing a locked month must go
   through "unlock billing period" (which calls the audited unlock RPC). Direct SQL
   updates against locked `pricing_runs` / `contract_price_snapshots` will be rejected
   by triggers — this is intended.
6. **Verify webhook loop**: send a provider test event; it should update
   `invoice_export_items.provider_status`, upsert the portal `customer_invoices` row,
   and mark the `invoice_provider_events` row `processed` (unknown statuses →
   `needs_review` + work-queue task).
7. **Metering gate policy**: estimated/preliminary values block final invoicing by
   default. Companies that may invoice on estimates need
   `companies.metadata.billing.allow_estimated_metering_values = true`.

## 3. Verification results (this branch)

- `npm run typecheck` — pass
- `npm run typecheck:tests` — pass
- `npm run build` — pass (Next.js production build)
- `npm test` — 98 unit tests pass (pricing core, matching service, switch readiness,
  metering completeness gate, export error classification, intake idempotency)
- Regression scripts: 105/115 pass, including `ops:hardening-regression`,
  `ops:final-contract-regression`, `api:error-boundaries`, pricing/billing/intake/
  switch/EDIEL launch suites. The 10 remaining failures were verified to also fail
  identically on `main` (pre-existing static-check drift in z01/grid-owner/batch-6/
  ops-master scripts) and were not introduced by this branch. Three previously failing
  checks (`api:error-boundaries`, `gridex:pricing-flow-regression` family,
  `gridex:website-application-ops-chain-regression`) were fixed on this branch.
- `npm run db:migrations:check` — pass (140 versions).

## 4. Remaining TODOs (documented, intentionally not built)

- Full EDIEL cancellation/reversal workflows after dispatch (manual work-queue path kept).
- Interval-level (hourly) spot × consumption matching — current monthly-average
  approach is preserved and marked in line metadata; changing it silently would alter
  live billing output.
- Distributed rate limiting, external alerting integrations, GDPR anonymization jobs.
