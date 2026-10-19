# Inbound Mail Polling — Runbook

Operational runbook for the two inbound IMAP pipelines. Verified against the
codebase 2026-07-03 for the historical Ediel notes; the manual pipeline section was updated 2026-10-18. The attachment extension builds on main `63580ae0` and mail source `1e78dbbf`, integrated at `e535113a`; the final exact source and reviews are bound in [PR #828](https://github.com/heke99/gridex-ops-platform/pull/828). Earlier `1e78dbbf` source reviews and builds remain historical evidence. This document does not attest deployment or a real Strato round trip; see the [current application hold](../quality/audits/manual-poa-mail-2026-10-18/automatic-application-checkpoint.md).

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

## Manual documents and bounded AI stages

Each outbound request/reply concerns one customer in one tenant; several facilities of that same customer are in scope. A conflicting subject must not attach another customer's document to the subject's customer. Canonical server records, verified contact and exact request/facility ownership determine routing. Unknown customers, mixed customers/tenants, uncovered facilities and ambiguous conditions require visible review. Multi-facility application keeps one immutable original and rechecks each target request, POA, site and source inside the canonical transaction. The superadmin queue at `/admin/mail-review` includes partial results, failed continuations and nonterminal matched replies older than 15 minutes. Exact-source reviews, qualified schema delivery and a real Strato round trip remain separate release gates.

The manual MIME capture retains original part bytes, SHA-256, MIME part number, declared type, filename and source role. Current attachments are distinct from quoted/forwarded history. File bytes, hash and actual format are checked before derived text is used. Derived sources retain attachment/hash plus page or worksheet/cell locators. Malformed MIME, unsupported/encrypted/macro documents, missing content and exceeded bounds stop automatic application instead of silently dropping an attachment or condition.

| Stage | Input and limit | Paid attempts |
| --- | --- | --- |
| Capture/parser | At most 5 attachments, 4 MiB/file and 6 MiB total; local XLSX/XLS/CSV/text extraction, all stored worksheets/cells within 16 sheets/20,000 cells/16 MiB unpacked/8 seconds | No provider call |
| PDF/image transcription | PDF and PNG/JPEG/WebP; at most 12 visual pages in total, counting an image as one page; 12,000 output characters, 45 seconds, 6,000 output tokens | One reserved OCR call for all files/pages on the original inbound |
| Semantic reading | Document corpus: 24,000 characters, 160 source paragraphs, 2,000 characters/paragraph; 15 seconds, 1,600 output tokens. Body-only remains 12,000 characters/80 paragraphs | One reserved shared semantic call for the complete source, including safely partitioned same-customer facilities |

Full permitted PDF/image bytes leave the server for OpenAI OCR. Those documents are not masked first. Semantic input masks common Swedish identity numbers, email addresses and GX references; this does not remove all personal data. Both phases use the fixed OpenAI Responses destination, `store:false`, no model tools and no model authority to assign identities or write business facts. Local Excel extraction does not mean the derived text remains local: it enters the subsequent semantic call.

OCR eligibility requires cryptographically verified original-source DKIM and an exact active verified registry sender, including when the original parent is not yet assigned to a tenant/customer. It grants reading only. Its `manual_automation.documentReading` reservation/result is distinct from the semantic `ai_read_only` stage. Exact source/hash/manifest/extractor/context witnesses are required to reuse a result. Canonical assignment after a NULL-context transcription permits read-only restoration of that saved result, never a new NULL-context reservation on an assigned row.

Body/text/Excel uses one shared semantic stage, including safely partitioned facilities of the same customer; visual documents add one shared OCR stage before semantics. Do not promise one paid call per email or a fixed text-only cost for images/PDFs. Each stage records its own usage/cost estimate when returned by the provider. Processing, failure and timeout markers are not reset by polling retry or normalization. A paid stage can remain `processing` after a crash or persistence failure and must go to review rather than be paid again. No global monthly budget is enforced. See the [manual POA runbook](manual-poa-mail-runbook.md) for privacy, cost and production-test details.

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
| Manual attachment cannot be completed or linked | attachment manifest/source locators, `manual_automation.documentReading`, semantic status and review reasons | Preserve the original; review unknown customer, unsupported format, OCR uncertainty, missing page/condition or bound overflow. The candidate's dedicated superadmin queue is `/admin/mail-review`; production availability requires final delivery. |

## Reprocessing rules

- Never re-run a poll with `markSeen: false` against a production mailbox
  unless dedupe behavior is understood — stored messages are deduped, but
  parsing/DB work may repeat. The manual OCR and semantic reservations must survive retry; never clear a stage to force a second paid call.
- Never manually flip `manual_email_outbox` rows from `delivery_uncertain`
  back to `queued` without checking Resend for the idempotency key first —
  the provider may already have delivered the message.
- Inbound `ediel_messages` reprocessing goes through the inbound orchestrator
  (admin actions), which is idempotent per message.
