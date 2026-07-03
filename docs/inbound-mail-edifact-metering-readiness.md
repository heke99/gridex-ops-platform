# Inbound Mail, EDIFACT and Metering Values — Production Readiness

End-to-end verification of the inbound lifecycle. Verified against the codebase
2026-07-03 (production readiness audit).

## Full inbound lifecycle (verified chain)

1. **Outbound request created** — manual info request
   (`lib/customer-operations/requestMissingFacilityInformation.ts`) or EDIFACT
   Z01 (`lib/customer-operations/facilityLookupEdifactDispatch.ts`).
2. **Outbound sent** — manual: `manual_email_outbox` worker (idempotency key
   `manual-facility-request:{companyId}:{siteId}:{gridOwnerId}`, Resend
   `Idempotency-Key` header); EDIFACT: intent → render gateway → `ediel_outbox`
   (`lock_key` upsert, claim RPC, send guards).
3. **Correlation stored** — manual: `case_reference` (`GX-FIR-{8 hex of request
   uuid}`, unique on `grid_owner_information_requests`), outbox id + provider
   message id in request metadata; EDIFACT: `ediel_business_references`,
   interchange/transaction references on `ediel_messages`.
4. **Mailbox polled every 5 minutes** — see `docs/inbound-mail-polling-runbook.md`.
5. **Ingestion** — Ediel: `inbound_email_messages` (+ attachments, raw SHA-256);
   manual: `manual_inbound_messages`.
6. **Dedupe** — layered keys (Message-ID, raw hash, sender+interchange ref per
   company+environment, EDIFACT interchange uniqueness, provider_message_id).
7. **Tenant resolved** — strong signals only (UNB identifiers, route profiles,
   tracked outbound correlation, case reference → request.company_id). Weak
   signals (sender domain, subject text, customer name, address) never
   auto-attach: ambiguous → `manual_review`.
8. **Request/customer/site matching** — manual: case reference must match a
   unique open request; EDIFACT: `lib/ediel/matching/*` (metering point id is
   the primary key for metering flows; facility id for site flows).
9. **Parsing** — manual: `extractManualFacilityFields` +
   `scoreManualFacilityPayload` (confidence 0–1); EDIFACT:
   `lib/ediel/core/edifactParser.ts` (UNA/UNB/UNH/BGM/DTM/NAD/LOC/RFF/CCI/CAV/
   QTY/LIN/UNT/UNZ with segment-count and reference validation) →
   family-specific parsers (PRODAT/UTILTS).
10. **Validation** — manual auto-apply requires ALL of: matched request,
    credible sender (recipient/domain match against
    `grid_owner_contact_channels`), confidence ≥ 0.7, valid facility id
    (16–18 digits), known grid area, no conflict with existing verified data,
    site exists, no protected identity. Anything else → `needs_review`.
11. **Customer operation updated** — only via the matched request/operation
    (`applyManualFacilityResponse` scopes every write by
    `(company_id, site id)`); EDIFACT PRODAT/UTILTS update the matched
    operation only.
12. **Events created** — `emitCustomerOperationEvent` with stable idempotency
    keys (needs_review events keyed on provider message id since 2026-07-03).
13. **Acknowledgements** — CONTRL/APERAK/UTILTS_ERR correlate via
    `related_message_id` → reference candidates → `ediel_business_references`
    → outbound reference columns; duplicate ACKs classify as `noop`
    (`lib/ediel/ack/acknowledgementEngine.ts`); missing ACK triggers SLA
    timers (`lib/ediel/sla/`).
14. **Metering/customer/site data updated** — see below.
15. **Unresolved cases** — `manual_review` / `needs_review` /
    `ediel_unresolved_items`; never silently corrupt production data.

## Manual request tracking fields (verified stored)

`grid_owner_information_requests`: `company_id`, `customer_id`,
`customer_site_id`, `metering_point_id` (via site), `grid_owner_id`,
`case_reference` (unique), request type, requested fields, `status`
(state machine with blocked/queued/sent/waiting/received/parsed/needs_review),
`dispatch_status`, `sent_at`, `due_at`, retry bookkeeping, `recipient_email` /
`from_email` / `reply_to`, `poa_id`, template id, metadata
(`manual_email_outbox_id`, `manual_email_provider_message_id`).

Correlation is **case-reference based** (subject → to-address → body). RFC
threading headers (`In-Reply-To` / `References`) are stored (`threadId`) but not
used for matching — documented gap; acceptable because grid owners routinely
reply from ticket systems that break threading, while the GX-FIR token survives
subject prefixes. If the token is stripped entirely, the mail stays unseen in
the mailbox for manual handling (fail-safe direction).

## Manual reply parsing rules (verified)

- quoted reply chains: extraction regexes anchor on labeled fields; raw body is
  always preserved on the inbound row
- attachments (PDF/CSV/Excel/EDIFACT) are preserved raw; parsing failures keep
  the message and set review status — they never drop data
- partial/low-confidence/conflicting data → `needs_review`; verified data is
  never overwritten by weak parsed data (facility conflict check)
- body/attachment conflicts → `needs_review` (confidence gate)

## EDIFACT inbound (verified)

- `parseEdifact` validates UNA/UNB/UNZ envelope, UNH/UNT segment counts, and
  interchange/message reference correlation; malformed messages fail parsing
  and never update customer state
- family classification: PRODAT / UTILTS / CONTRL / APERAK / UTILTS_ERR
  (`lib/ediel/classify.ts`, `parseUtilts` subtype detection E66/E31/S02/S03/ERR)
- raw payload + canonical output are both stored
  (`lib/ediel/core/canonicalizeEdifact.ts`)
- syntax-rejected messages generate controlled negative ACKs; routing/tenant
  failures do NOT generate negative CONTRL (cannot know the right counterparty)
- AGT/test inbound short-circuits to the actor-testing engine — production
  customer data is never touched by test messages

## PRODAT inbound business handling (verified)

- positive facility/customer-information responses update the matched
  operation/site only (`z01Finalizer`, facility recognition, staging cases)
- negative responses / rejections create blockers with reason codes visible on
  the customer card and admin views
- duplicate responses are idempotent (message dedupe + guarded transitions)
- wrong tenant/customer/site cannot be updated: matching requires the tracked
  request/operation and tenant-scoped identifiers

## UTILTS and metering values (verified)

- metering point identification is the primary match
  (`lib/ediel/utilts/meteringObservationParser.ts`,
  `lib/ediel/flows/utiltsDataRequest.ts`); address/name are never sufficient
- period handling: `period_start`/`period_end` normalized; duplicates blocked
  by unique `(company_id, metering_point_id, period_start, period_end)` (+
  richer Ediel guard and `normalized_metering_values` dedupe)
- DST: periods are stored as absolute timestamps (timestamptz) — a DST day
  yields 23/25 hourly intervals without wrong interval counts; gaps surface as
  missing intervals in the billing completeness gate
- corrections/replacements are handled intentionally (replacement observations
  update the same period key rather than inserting duplicates)
- invalid units / impossible values / ambiguity → review, not silent insert
- billing: estimated/preliminary values block final invoicing by default
  (metering completeness gate; per-company opt-out
  `companies.metadata.billing.allow_estimated_metering_values`)
- tenant isolation: every insert carries `company_id` from the matched
  operation; portal reads are scoped by customer context

## ACK handling (verified)

- CONTRL/APERAK/UTILTS_ERR link to the correct outbound message via the
  correlation chain; unknown ACKs go to review/unresolved
- positive ACK updates ack status on the source message; negative ACK creates
  a blocker and is never hidden as "sent" (business state machine separates
  technical ack from business response)
- duplicate ACKs are `noop`; SLA timers (30 min) escalate missing ACKs
  open → warning → critical → expired (`lib/ediel/sla/checkAckDeadlines.ts`)

## Known accepted gaps

1. No IMAP UID/UIDVALIDITY cursor (see polling runbook) — dedupe layers make
   this a cost issue, not a correctness issue.
2. Threading headers not used for manual correlation (see above) — fail-safe.
3. The `(sender, interchange_reference)` unique dedupe index predates the
   `environment` column; poller queries are environment-scoped, so this only
   matters for hypothetical direct DB writers. Post-launch: extend index.
