# Incident Response Runbook

For each incident: severity, symptoms, where to look, safe first action,
rollback/pause option, duplicate-avoidance, escalation. General rules:

- Prefer pausing **one tenant or one pipeline** (kill switches,
  `docs/production-runbook.md` §4) over taking the app down.
- Never blind-resend anything in `delivery_uncertain` or with unknown ACK state.
- Log every manual production intervention in the launch/incident channel with
  timestamps and row ids.

## Incidents

### Website applications return 500
- Severity: Critical (revenue-facing)
- Look: Vercel function logs for `/api/v1/website/customer-applications`;
  `website_customer_applications.error_stage/error_code`;
  structured error `request_id`
- First action: reproduce with a staging payload; check for
  `legal_versions_missing`, provider outages, or schema drift
- Duplicate safety: idempotency unique key means retries are safe; repair path
  (`repairs`, status `partial`/`repaired`) can complete half-finished chains
- Pause: revoke website API key of the affected tenant if data corruption is
  suspected

### Duplicate customer / application / contract
- Severity: High
- Look: `website_customer_applications` by idempotency key;
  `customer_contracts` metadata `website_application_idempotency_key`;
  unique indexes (`customer_contracts_single_active_per_site_uidx`)
- First action: confirm which row is canonical (oldest with complete chain);
  do NOT delete — mark duplicates via admin flows and document
- Root cause: check whether client sent different idempotency keys

### Email dispatch fails
- Severity: High
- Look: `tenant_email_outbox` `failed` rows + `last_error`;
  Resend dashboard/status; `RESEND_API_KEY` validity
- First action: if provider outage → wait, retries back off automatically; if
  sender config → fix `company_email_settings` and requeue via admin
- Duplicate safety: provider idempotency key prevents double-send on retry

### Duplicate email sent
- Severity: Medium
- Look: `communication_logs` by idempotency key; Resend logs by
  `Idempotency-Key`
- First action: verify whether keys differed (caller bug) or provider replayed;
  the outbox never resends `sent`/`delivery_uncertain` rows automatically

### Ediel outbound stuck
- Severity: High
- Look: `ediel_outbox` statuses (`blocked` reasons, `sending` older than
  10 min → auto `delivery_uncertain`); send locks (`ediel_send_locks`);
  readiness guard output on go-live page
- First action: read the blocker code — most are intentional guards
  (certificate/route/approval). Fix config, not the guard.
- Pause: `pauseProductionSendingAction` for the tenant

### Ediel message sent to wrong route
- Severity: Critical
- Look: `ediel_messages` route/receiver columns; `communication_routes`
  `target_system`/environment; route decision logs
- First action: pause tenant production sending immediately; identify all
  affected interchange references; contact the counterparty; document for
  market-compliance follow-up
- Prevention layers: environment-scoped route decision + TGT rejection in
  production (verified) — a wrong route implies misconfigured route rows;
  re-run route materialization

### Inbound polling stops
- Severity: High (SLA for ACKs)
- Look: `ediel_inbound_poll_runs` (no rows for > 15 min = stopped); mailbox
  `last_error`, `locked_at`; Vercel cron logs
- First action: stale locks self-heal after 30 min; check IMAP credentials /
  provider outage; run the cron manually with the secret to test
- Safe: polling is read + dedupe; re-running is safe

### Inbound mail parsed incorrectly
- Severity: Medium–High
- Look: `manual_inbound_messages` + parse payloads; request `parsed_payload`,
  `confidence_score`; `needs_review` events
- First action: correct via admin review flow; the parser never overwrites
  verified data and low confidence goes to review — a wrong auto-apply implies
  confidence-gate bug: capture the payload and add a regression
- Rollback: site facility fields carry provenance
  (`facility_data_status='manually_verified_by_grid_owner'`) — restore previous
  value from audit/event trail

### EDIFACT parsing fails
- Severity: Medium
- Look: `ediel_messages` processing status, parser errors,
  `ediel_unresolved_items`
- First action: malformed inbound never updates customer state (verified);
  export raw payload, reproduce in staging, involve counterparty if their file
  is malformed; reply CONTRL is generated per ack policy

### Metering values attached to wrong metering point
- Severity: Critical (billing integrity)
- Look: `metering_values`/`normalized_metering_values` by
  `source_message_id`; matching logs on the inbound message
- First action: quarantine — mark affected billing underlays not export-ready;
  matching requires metering-point identity (verified), so a wrong attach
  implies wrong masterdata (facility id on wrong site): fix site mapping first,
  then correct values via replacement handling — never raw DELETE
- Do not run billing for affected periods until reconciled

### Tenant isolation / RLS error suspected
- Severity: Critical
- Look: Supabase logs for policy violations; the reporting user's role +
  company memberships; recent policy migrations
- First action: reproduce with a scoped test user; if confirmed cross-tenant
  read/write: pause affected tenants, capture evidence, fix policy, and assess
  GDPR notification duty (72h) per `docs/data-retention-gdpr-checklist.md`

### Customer portal API leaks or blocks data incorrectly
- Severity: Critical (leak) / High (block)
- Look: `integration_api_requests` log for the request; resolver result codes
  (`ambiguous_customer_match`, `customer_portal_link_requires_sync`)
- First action: leak → revoke the API key immediately (tenant-scoped kill),
  then audit `customer_portal_identities` links; block → check identifier
  quality from the website (email ambiguity requires customer_number)

### Supabase migration fails
- Severity: High
- Look: SQL error + NOTICE output; `db:migrations:check`
- First action: all readiness migrations are guarded/idempotent — fix the
  reported issue and re-run; never hand-edit half-applied state without
  recording the statements run

### Vercel deploy fails
- Severity: Medium
- First action: previous deployment remains active; fix build, redeploy.
  Never disable typecheck to force a deploy.

### Resend / SMTP / IMAP provider outage
- Severity: High
- Behavior: email outbox retries with backoff (no loss); Ediel SMTP failures
  keep outbox rows claimable; IMAP outage pauses polling (mail waits on server)
- First action: confirm via provider status page; monitor backlog; no manual
  action usually needed — watch for `delivery_uncertain` accumulation after
  recovery

### Supabase outage
- Severity: Critical
- First action: app is DB-dependent — status page + wait; after recovery run
  consistency checks and watch cron catch-up (bounded batches prevent stampede)

### Database performance degradation
- Severity: High
- Look: Supabase slow query log, connection count
- First action: identify offending query; heavy admin pages are bounded (limit
  200 companies / concurrency 5) — regressions here mean data growth passed
  assumptions; add index (additive) or reduce limits

### Cron backlog grows / queue stuck
- Severity: High
- Look: outbox/queue tables by status+age (`docs/daily-reconciliation-checklist.md`
  queries); `inbound_processing_jobs` retry counts
- First action: check the corresponding guard/blocker reason before increasing
  batch sizes; stuck `processing`/`sending` rows self-heal to
  `delivery_uncertain`/reclaim — investigate root cause instead of forcing

## Recommended alerts/monitors (manual setup required — no monitoring platform is integrated)

Configure in Vercel + Supabase dashboards (or the team's external monitor):

- Vercel 5xx spike (> 1% over 5 min); function duration p95 regression
- Supabase: CPU > 80% 10 min; connections > 80% pool; RLS policy violations
- `tenant_email_outbox` failed count > 0 per hour; `delivery_uncertain` > 0
- `ediel_outbox` failed/blocked growth per hour
- `ediel_inbound_poll_runs` stale > 15 min (polling liveness)
- `inbound_processing_jobs` failed > 0
- `website_customer_applications` status failed/partial > 0
- ACK SLA breaches (`checkAckDeadlines` escalations)
- `invoice_export_items` `failed_retryable` backlog > 25
- High idempotency-conflict rate (23505 spikes in logs)
- Tenant go-live blockers appearing on a live tenant

## Communication

- Internal: launch/incident channel; owner assigns severity and a scribe.
- Tenant-facing: support email from company settings; template the message
  before sending; never expose stack traces or internal ids.
