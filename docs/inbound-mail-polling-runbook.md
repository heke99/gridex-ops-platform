# Inbound Mail Polling — Runbook

Operational runbook for the two inbound IMAP pipelines. Verified against the
codebase 2026-07-03.

## Pipelines

| Pipeline | Mailbox table | Cron | Engine |
| --- | --- | --- | --- |
| Ediel/EDIFACT | `ediel_mailboxes` | `/api/internal/inbound-mail/cron?environment=test\|production` every 5 min | `lib/inbound-mail/edielMailboxPoller.ts` → `runInboundEdielMailEngine` |
| Manual grid-owner | `manual_communication_mailboxes` | `/api/internal/manual-inbound/cron?environment=test\|production` every 5 min | `lib/inbound-mail/manualMailboxPoller.ts` → `runManualInboundMailEngine` |

Auth: `Authorization: Bearer <CRON_SECRET>` (Vercel-injected) or
`x-cron-secret`; Ediel also accepts `EDIEL_INBOUND_CRON_SECRET`, manual accepts
`MANUAL_INBOUND_CRON_SECRET` / `x-manual-inbound-secret`. `environment` is
**required** — the cron rejects requests without it, and `company_id`
overrides are rejected for shared mailboxes.

## Locking and batch limits (Ediel)

- Mailbox lock: optimistic `UPDATE ... WHERE locked_at IS NULL OR locked_at < stale`
  (`EDIEL_INBOUND_STALE_MAILBOX_LOCK_MINUTES`, default 30) — two concurrent cron
  runs cannot poll the same mailbox.
- Due-check: `poll_interval_minutes` per mailbox (default 10; bootstrap 5).
- Batch: `EDIEL_INBOUND_MAILBOX_POLL_LIMIT` (10 mailboxes/run),
  `EDIEL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX` (25), concurrency 3 mailboxes /
  4 messages (`EDIEL_INBOUND_MAILBOX_CONCURRENCY`,
  `EDIEL_INBOUND_MESSAGE_CONCURRENCY`).
- Processing jobs: claimed via RPC `claim_inbound_processing_jobs`
  (`FOR UPDATE SKIP LOCKED`, stale reclaim 10–15 min); max
  `EDIEL_INBOUND_MAX_JOB_ATTEMPTS` (5) then `failed`.
- Poll runs are audited in `ediel_inbound_poll_runs`.

## Locking and batch limits (manual)

- Same stale-lock pattern (`MANUAL_INBOUND_STALE_MAILBOX_LOCK_MINUTES`, 30).
- Poll throttle: `poll_interval_minutes` (default 5) respected since
  2026-07-03 hardening (previously polled every cron tick).
- Batch: `MANUAL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX` (25), sequential mailboxes.
- Only messages containing a `GX-FIR-…` case reference are ingested; everything
  else stays unseen in the mailbox.

## Deduplication keys

Ediel inbound (`storeInboundEmail` / `findExistingInboundEmail`):

1. Pre-tenant, per mailbox: `internet_message_id`, `raw_message_sha256`,
   `dedupe_key = mailboxId:messageId` (unique indexes in `batch 3.sql` /
   `20260615_multitenant_integrity`); PG 23505 races handled.
2. Post-tenant, per `(company_id, environment)`:
   `sender_ediel_id + interchange_reference` and
   `sender_ediel_id + transaction_reference + external_reference`.
3. EDIFACT level: unique `(company_id, direction, sender, receiver,
   interchange_reference)` on `ediel_messages`.

Manual inbound: `provider_message_id` idempotency on `manual_inbound_messages`;
needs-review timeline events are keyed on the provider message id
(2026-07-03 hardening).

## Cursor model and known limitation

There is **no persistent IMAP UID/UIDVALIDITY cursor**. Polling fetches
`unseen` messages and marks them `\Seen` after storing. Consequences:

- If a provider resets flags or UIDVALIDITY changes, old messages are
  re-fetched. The dedupe layers above prevent duplicate rows/processing, but
  the run wastes fetch quota.
- If `\Seen` marking fails after a successful store, the message is re-fetched
  next run and deduped by Message-ID/hash — safe, but watch for repeated
  occurrences in logs.

Detection: `ediel_inbound_poll_runs` shows abnormal `fetched` counts with zero
`stored`. Suggested post-launch fix: persist `(uidvalidity, last_uid)` per
mailbox and fetch `UID > last_uid`.

## Tenant resolution for shared mailboxes

Messages in shared mailboxes are stored with `company_id = NULL` first, then
resolved by `lib/inbound-mail/inboundTenantResolver.ts` →
`lib/ediel/tenant/resolveInboundTenant.ts` using EDIFACT identifiers (UNB
sender/receiver + subaddress + application reference, per environment), route
profiles, transport routes and outbound-ACK correlation. Rules:

- missing environment → `unresolved` (never guessed)
- mailbox hint conflicting with EDIFACT evidence → `ambiguous`
- unresolved/ambiguous → `manual_review` + `ediel_unresolved_items` (never
  auto-attached)

Manual inbound resolves the tenant **from the matched request**
(`grid_owner_information_requests.company_id`), never from the mailbox.

## Failure handling

| Symptom | Where to look | Action |
| --- | --- | --- |
| Polling stopped | `ediel_inbound_poll_runs`, mailbox `last_error`, Vercel cron logs | Check IMAP credentials (`env:` secret refs), stale lock (auto-recovers after 30 min), provider outage |
| Mailbox stuck locked | `ediel_mailboxes.locked_at` / `manual_communication_mailboxes.locked_at` | Wait for stale-lock recovery (30 min) or clear `locked_at` manually after verifying no run is active |
| Repeated re-fetch of same message | poll-run stats, `internet_message_id` dedupe hits | Provider flag semantics issue; verify `\Seen` is being applied; consider UID cursor fix |
| Inbound job failures | `inbound_processing_jobs` status `failed` | Inspect `last_error`; requeue by setting status back to `queued` only after root cause is fixed |
| Unresolved tenant | `ediel_unresolved_items`, admin inbound views | Resolve manually; add/repair route profile or actor settings; reprocess |
| Manual reply unmatched | mailbox retains unseen mail with GX-FIR ref | Check `grid_owner_information_requests.case_reference`; ambiguous refs go to review |

## Reprocessing rules

- Never re-run a poll with `markSeen: false` against a production mailbox
  unless dedupe behavior is understood — stored messages are deduped, but
  processing costs repeat.
- Never manually flip `manual_email_outbox` rows from `delivery_uncertain`
  back to `queued` without checking Resend for the idempotency key first —
  the provider may already have delivered the message.
- Inbound `ediel_messages` reprocessing goes through the inbound orchestrator
  (admin actions), which is idempotent per message.
