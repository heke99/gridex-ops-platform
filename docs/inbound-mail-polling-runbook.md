# Inbound Mail Polling — Runbook

Operational runbook for the two inbound IMAP pipelines. Verified against the
codebase 2026-07-03 for the historical Ediel notes; the manual pipeline section was updated 2026-10-18.

## Pipelines

| Pipeline | Mailbox table | Cron | Engine |
| --- | --- | --- | --- |
| Ediel/EDIFACT | `ediel_mailboxes` | `/api/internal/inbound-mail/cron?environment=test\|production` every 5 min | `lib/inbound-mail/edielMailboxPoller.ts` → `runInboundEdielMailEngine` |
| Manual grid-owner | `manual_communication_mailboxes` | `/api/internal/manual-inbound/cron?environment=production` every minute | `lib/inbound-mail/manualMailboxPoller.ts` → `runManualInboundMailEngine` |

Auth: `Authorization: Bearer <CRON_SECRET>` (Vercel-injected) or
`x-cron-secret`; Ediel also accepts `EDIEL_INBOUND_CRON_SECRET`, manual accepts
`MANUAL_INBOUND_CRON_SECRET` / `x-manual-inbound-secret`. `environment` is
explicitly set to `production` by production jobs. The Ediel route rejects a missing environment; the manual route accepts an optional environment, so always pass it for a poll limited to one environment. `company_id` overrides are rejected.

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

- Worker-fenced mailbox claim/release; stale lock remains 30 minutes.
- Every-minute scheduler; configure each active mailbox's `poll_interval_minutes` to 1. Configured longer intervals remain supported, with at most 10 seconds of early tolerance to avoid losing a tick to normal scheduler jitter.
- Default 25 messages/mailbox/run, bounded at 100 even if an environment override is larger. Mailboxes are considered oldest-poll first. A 150-second soft run budget stops new claims/fetches while preserving remaining work; the cron declares a 300-second platform limit.
- Complete one UID fetch before ingestion/Seen commands. Never await another IMAP command from inside the active FETCH generator.
- All mail is persisted before tenant-first correlation. GX-FIR is one strong signal; trusted reply headers and existing server records can also correlate a reply. Ambiguous messages go to review.

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

## Manual UID checkpoint and bootstrap

The manual poller retains a versioned UID/UIDVALIDITY checkpoint in the mailbox's existing private metadata. Its namespace includes the current account/folder and routing configuration. After durable bootstrap, new UIDs are considered whether or not someone has marked them Seen. Existing unread backlog and recorded failed UID retries remain eligible. A retryable new-message failure must not let the checkpoint move past that unresolved new UID. Failed Seen after successful ingestion retries safely through Message-ID/source deduplication and the saved AI reading.

Initial bootstrap takes the selected mailbox's UIDNEXT boundary and keeps existing unread mail eligible. Already-Seen historical mail before that initial boundary is not automatically backfilled; import/review it deliberately instead of treating an older answer as newly authoritative. Initialize the poller before sending the isolated test request. UIDVALIDITY/account/folder changes require a fresh bootstrap; old UID bindings cannot be reused in the new namespace.

Polling retry keys use the namespace and UID rather than RFC Message-ID, so two source UIDs cannot overwrite each other’s attempts. A terminal failure is marked Seen only after its audit/checkpoint is durably saved; optional flagging may remain incomplete on error or budget exhaustion, while the terminal UID suppresses repeated processing.

The unread search precedes the new-UID search, and results are strictly filtered above the checkpoint. This avoids racing a newly read-marked message between searches and handles IMAP's reversed `N:*` range behavior. Processing remains bounded, and the owned metadata/checkpoint update must commit before a successful poll is reported.

The prior July 2026 general note about an unseen-only cursor is historical. This task does not requalify the separate Ediel/EDIFACT cursor or its native evidence.

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
| Manual reply unmatched | persisted `manual_inbound_messages` and review queue | Check request, signed thread/source evidence and tenant resolution; ambiguous replies stay in review |

## Reprocessing rules

- Never re-run a poll with `markSeen: false` against a production mailbox
  unless dedupe behavior is understood — stored messages are deduped, but
  processing costs repeat.
- Never manually flip `manual_email_outbox` rows from `delivery_uncertain`
  back to `queued` without checking Resend for the idempotency key first —
  the provider may already have delivered the message.
- Inbound `ediel_messages` reprocessing goes through the inbound orchestrator
  (admin actions), which is idempotent per message.
