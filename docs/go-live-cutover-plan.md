# Go-Live Cutover Plan

## T-3 days

- [ ] Production freeze in effect (`docs/production-freeze-checklist.md`)
- [ ] All migrations applied on staging; every `NOTICE` reviewed
- [ ] Staging smoke test passed end-to-end (`docs/staging-smoke-test-checklist.md`)
- [ ] Env checklist verified on Vercel production (`docs/env-production-checklist.md`)
- [ ] Masterdata checklist verified per tenant (`docs/masterdata-production-checklist.md`)
- [ ] Email deliverability verified (`docs/email-production-checklist.md`)
- [ ] Backup point-in-time-recovery confirmed enabled (`docs/backup-restore-checklist.md`)

## T-1 day

- [ ] Apply pending migrations to production (timestamp order); watch NOTICEs
- [ ] Run `supabase/sql/checks/production_consistency_checks.sql` — all zero/explained
- [ ] Per launching tenant: go-live page shows no blockers
      (`/admin/platform/go-live/[companyId]`); production dry-run `allowed`
- [ ] Confirm rollback owner + deputy and their access (Vercel + Supabase)

## Cutover (launch day)

1. Deploy the release build to production; verify build hash.
2. Post-deploy smoke: login, `/admin`, `/admin/system-health`, one portal
   account, `GET /api/v1/website/public-contracts` with the tenant API key.
3. For each launching tenant, superadmin presses **Make tenant live**
   (`activateLiveEdielAction`) — verify audit row in `company_go_live_reviews`
   and `live_approved_by/at` set.
4. Verify first production Ediel send passes the first-send approval flow
   intentionally (do not blanket-disable `production_send_lock_enabled`).
5. Submit one real website application per tenant (internal test person) and
   follow the chain: application → customer → site → metering point → contract
   → legal acceptances → POA → confirmation email → events.
6. Watch the first inbound polling cycles (`ediel_inbound_poll_runs`).

## Rollback plan

Application rollback (minutes):
- Vercel → promote the previous production deployment. No data migration is
  coupled to app versions; all recent migrations are additive, so the previous
  app version runs against the new schema (verified degradation paths exist —
  e.g. missing-RPC fallbacks, `missingSchema` guards).

Tenant rollback (contain one tenant):
- `pauseProductionSendingAction` for the tenant (stops outbound; inbound still
  logged) or set `companies.status='paused'` to stop all new operational writes.

Database rollback (last resort):
- Supabase PITR to the pre-cutover timestamp. Afterwards follow
  `docs/production-runbook.md` §7 (reprocessing rules): reconcile outbox tables
  and provider state (Resend idempotency keys, Ediel interchange references,
  invoice export GUIDs) BEFORE re-enabling dispatch. Never blind-resend.

New migrations added by the readiness branch (`20260703100000`,
`20260703110000`, `20260703120000`) are additive: rollback = drop the created
indexes/policies/constraint additions; no data mutation to reverse.

## First 24 hours

- Monitoring items in `docs/production-runbook.md` §5, checked at
  +1h, +4h, +12h, +24h; log results in the launch channel.
- Any Critical incident → `docs/incident-response-runbook.md`, pause affected
  tenant/pipeline rather than the whole platform when possible.
