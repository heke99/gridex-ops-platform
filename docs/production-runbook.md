# Gridex Ops Platform — Production Runbook

Verified against the codebase 2026-07-03 (production readiness audit).

## 1. Deployment

- Hosting: Vercel (Next.js 16, `npm run build` = `next build --webpack`).
- Database: Supabase Postgres (service role server-side only; RLS on tenant tables).
- Deploy steps: merge to `main` → Vercel production deploy → run
  `docs/staging-smoke-test-checklist.md` steps marked "post-deploy" →
  watch dashboards for 30 minutes.
- Migrations: apply via Supabase in **timestamp order** after the base trilogy;
  see §2. Always apply on staging first and read every `NOTICE`.

## 2. Migration ordering (important)

`supabase/migrations` contains 13 non-timestamped legacy foundation files. On a
fresh database apply in this order **before** the timestamped set:

1. `01_db1_schema_repair_core_helpers_and_canonical_tables.sql`
2. `02_db1_operations_ediel_billing_dedupe_and_storage.sql`
3. `03_db1_backfill_functions_rls_reports_and_finish.sql`
4. `ediel_rules.sql`
5. `Batch 1+2.sql`, `batch 3.sql`, `batch 4+5+6.sql`
6. (db2/db2b files only as part of the controlled reconciliation procedure)

Then all `YYYYMMDDHHMMSS_*.sql` in order. `npm run db:migrations:check` verifies
no duplicate versions. The production database already has all of these; do not
rename the legacy files.

## 3. Cron matrix (vercel.json)

| Path | Schedule | Lock / idempotency | Notes |
| --- | --- | --- | --- |
| `/api/internal/inbound-mail/cron?environment=test\|production` | */5 min | mailbox `locked_at` optimistic lock, stale 30 min; job claim RPC `claim_inbound_processing_jobs` (SKIP LOCKED) | batch 10 mailboxes / 25 msgs |
| `/api/ediel/outbox/process` | */5 min | claim RPC / CAS `prepared→sending`; `lock_key` upsert; stale `sending` → `delivery_uncertain` (10 min) | batch 25 |
| `/api/internal/email/outbox/process` | */5 min | `queued→processing` + `lock_token`; stale 15 min → `delivery_uncertain` | retry ≤5, auth mails 1 |
| `/api/internal/manual-email/outbox/process` | */5 min | `queued→sending` claim; stale 15 min → `delivery_uncertain` (hardening 2026-07-03) | retry ≤5 |
| `/api/internal/manual-inbound/cron?environment=…` | */5 min | mailbox lock + poll-interval throttle (2026-07-03) | GX-FIR replies only |
| `/api/internal/webhooks/dispatch` | */5 min | `webhook_deliveries` status transitions, unique idempotency_key | max 8 attempts |
| `/api/internal/customer-operations/cron` | */5 min | job claim locks; guarded status transitions | also resumes stuck intents |
| `/api/cron/pricing/spot-prices` | 03:15 daily | upsert by (area, date) | |
| `/api/cron/ediel/actor-readiness?mode=full` | 02:25 daily | full readiness sweep | |
| `/api/internal/system/health` | 02:35 daily | read-only checks | renders on /admin/system-health |
| `/api/internal/platform/grid-areas/import/cron` | */10 min | import cursor | |
| `/api/cron/billing/monthly` | 04:20 monthly | pricing run locks + immutability triggers | |
| `/api/cron/billing/invoice-export-retry` | */15 min | guarded retry statuses, `invoice_export_attempts` audit | never retries `configuration_error` |

Auth: all cron routes validate `Authorization: Bearer <CRON_SECRET>` (Vercel
injects it) or per-route secrets (`EDIEL_INBOUND_CRON_SECRET`,
`EMAIL_OUTBOX_CRON_SECRET`, `MANUAL_INBOUND_CRON_SECRET`, …) with
`timingSafeEqual`. **Accepted risk M8:** one shared `CRON_SECRET` unlocks all
jobs — set per-route secrets post-launch to reduce blast radius.

## 4. Kill switches / pause controls (all server-side)

| Scope | Mechanism | Effect |
| --- | --- | --- |
| Whole tenant | `companies.status = 'paused' / 'suspended'` (`lib/tenant/governance.ts`) | `requireCompanyOperationalForWrites` blocks new operational writes; history readable |
| Website application intake | tenant pause above, or revoke/disable the website API key (`integration_api_clients.status`) | intake rejected with 401/403 |
| Customer email dispatch (tenant) | `company_email_settings.is_active=false` or `sender_mode='disabled'`; per-event `email_event_rules.enabled=false` | `getEffectiveSender` throws / event cancelled; queued rows preserved |
| Resend sending (platform) | remove/rotate `RESEND_API_KEY` (env) | provider throws safe error; outbox rows stay queued and retry later |
| Ediel outbound sending | `pauseProductionSendingAction` → `ediel_send_locks` + `ediel_production_status='paused'` | outbox claims blocked; queued messages preserved; inbound still received |
| Ediel first-send | `production_send_lock_enabled` on `ediel_actor_settings` | blocks first production send until approved |
| IMAP/inbound polling | set mailbox `is_active=false` (`ediel_mailboxes` / `manual_communication_mailboxes`) | poller skips mailbox; mail stays on server |
| Manual inbound parsing | deactivate manual mailbox (above) or pause tenant | replies stay unseen in mailbox |
| Automatic customer operation processing | tenant pause; jobs go `needs_review` on repeated failure | no double-processing |
| Metering ingestion | Ediel pause (inbound business handling stops at review for paused tenants) | raw messages preserved |
| Invoice generation/export | billing cron secrets + `invoice_export_items` status guards; sent-invoice protection triggers | `configuration_error` never auto-retries |
| Legal mail | `block_legal_mail_when_unverified` | blocks legal/critical templates on unverified domain |
| Manual mail from Ediel address | `isEdielReservedSender` block (`MANUAL_EMAIL_ALLOW_EDIEL_SENDER` emergency override) | prevents transport mailbox misuse |

Disabling dispatch never deletes queued rows — outbox tables retain them for
resume. Disabled/paused states are visible on `/admin/system-health`, the
go-live page and company cards.

## 5. Logs and dashboards to watch (first 24h)

- Vercel: function errors / 5xx rate, cron execution logs
- Supabase: database CPU, connections, RLS errors in logs
- `/admin/system-health` — reconciliation checks ("Avstämningar (produktion)")
- `/admin/messages` + `/admin/ediel` — outbound blocked/failed counts, ACK SLA
- `tenant_email_outbox` / `manual_email_outbox` — `failed`, `delivery_uncertain`
- `ediel_inbound_poll_runs` — polling liveness (stale > 15 min = incident)
- `inbound_processing_jobs` — `failed` count
- `website_customer_applications` — `failed` / `partial` statuses
- `invoice_export_items` — `failed_retryable` backlog, `needs_review`

## 6. Known failure modes

See `docs/incident-response-runbook.md` for per-incident procedures. Summary:

- Duplicate submits → idempotency unique keys return stored responses (no 500)
- Worker crash mid-send → `delivery_uncertain` (email) / claim reclaim (Ediel)
- IMAP flag reset → re-fetch storm, deduped (see polling runbook)
- Provider outage (Resend/SMTP/IMAP) → outbox retries with backoff; monitor backlog
- Migration NOTICE about skipped unique index → pre-existing duplicates, clean
  up then create index manually (embedded queries in NOTICE)

## 7. Reprocessing rules (post-restore / post-incident)

- Never blind-resend `delivery_uncertain` email rows — check the provider by
  idempotency key first.
- Never reprocess inbound mail by clearing `\Seen` without understanding the
  dedupe consequences (safe for storage, costly for processing).
- After a database restore: run `supabase/sql/checks/production_consistency_checks.sql`,
  reconcile `ediel_outbox` rows in `sending` (they will resolve to
  `delivery_uncertain`), verify `invoice_export_items` against the provider
  before re-running export retries, and DO NOT re-run billing for locked months
  (immutability triggers will refuse; use the audited unlock RPC only after review).
- Ediel: verify the last sent interchange references against counterparty ACKs
  before releasing new outbound.
