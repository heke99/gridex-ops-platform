# Automatic manual-mail application implementation plan

**Goal:** Apply clear incoming POA information automatically to the server-resolved tenant, customer, site and request, including commercial dates, while retaining exceptions for contradictory, unauthenticated or incomplete replies.

**Architecture:** Correlate independently of AI, verify the original sender, run a tool-free reader once, then normalize evidence on the server. An atomic service-only command rechecks the source/request/site and writes commercial facts and a safe date floor. Existing market permission, readiness and outbound commands remain authoritative.

**Constraints:** Continue the isolated release branch, now integrated with main `61b29f0c`; preserve unrelated user files, Ediel ledger and shared producer scopes. No automatic contact changes, invented signatures, unauthorized test messages to suppliers or acceptance of conditional dates. Do not treat a raw quoted date as semantic proof. Canonical schema/types/checksum production remains with the existing qualified producer.

## Task 1: Pure commercial terms and date floors

Files: new `lib/inbound-mail/manualCommercialTerms.ts`, `__tests__/manual-commercial-terms.test.ts`; modify `lib/operations/switchStartDate.ts`; new `__tests__/manual-mail-switch-date-floors.test.ts`.

- [x] Write and observe failing behavioral tests for unambiguous dates, inclusive end dates, notice units, month boundaries, contradictory/conditional text and partial replies.
- [x] Implement `normalizeManualCommercialTerms({extracted, authoredText, receivedAt})`, returning `ok`, `reasons`, normalized `terms` and source `evidence`. Compute a start floor only from explicit end/start facts.
- [x] Extend `calculateEarliestSwitchStartDate` with optional `earliestSupplierStartDate`; retain move-in semantics and fix explicit days/month clamping.
- [x] Run the new suites and existing date/readiness regressions.

## Task 2: Evidence and transactional application

Files: inbound reader/recording/ingestion and new server interpretation/command modules; forward SQL migration and real PGlite tests.

- [x] Write tests proving AI suggestions can assist extraction but cannot choose identities or bypass sender/request holds.
- [x] Preserve the at-most-once paid reservation and make its saved result available before business application, including retries.
- [x] Validate full authored text and quotes, reject multi-entity/negated/conditional values, normalize canonical fields and preserve complete provenance.
- [x] Introduce `gridex_apply_manual_commercial_reply_v1`: lock request/source/site; check exact tenant/customer/site, source, current hold and status; save canonical supplier terms and evidence; update only open unsent switch dates with a safe floor. Deny anon/authenticated execution. Preserve all market gates.
- [x] Verify actual supplier-request/outbound correlation and sender evidence; do not confuse customer-info and grid-owner request IDs.
- [x] Test successful apply, partial/incomplete replies, cross-tenant attempts, retries, stale replies and rejection races against executable SQL and ingestion.

## Task 3: Visibility and delivery

- [x] Update the runbook and relevant API documentation to explain automatic facts, exceptions and provenance.
- [ ] Run relevant tests, app/test TypeScript, lint, migration and tenant boundaries.
- [ ] Obtain two independent reviews of the final source and close confirmed findings.
- [ ] Deploy using the existing authorized production workflow; verify public endpoints and actual runtime/schema readiness without exposing credentials.
- [ ] Create a canonical isolated test intake before sending the user-authorized POA test mail. A synthetic unsigned PDF and an orphan case ID are insufficient; a reply from the user cannot count as a verified supplier decision.

Current evidence and the concrete schema/checksum delivery dependency are recorded in `quality/audits/manual-poa-mail-2026-10-18/automatic-application-checkpoint.md`. Full tests on `40974bfe`: 20,167 PASS, three checksum-dependent replay failures, two intentional SKIP. The subsequent metadata-only hold identity finding is corrected with 25 new actual SQL regressions (353/353 atomic/hold/SMTP checks); source approvals must be rebound to the new freeze. The application source is unchanged by that SQL-only correction. Targeted tests/typechecks/lint pass; final transport/hold corrections and exact-source reviews are being closed before staging. No new production release or real Strato round trip is claimed.

Skill routing: using-superpowers, writing-plans, TDD, verification-before-completion, parallel delegation and existing worktree isolation apply. Agent-email-inbox and Supabase apply to untrusted mail and tenant-scoped persistence. PostgreSQL guidance applies if a forward command is required. Deployment/CLI/env skills apply at delivery. Performance-optimization now applies to the user’s explicit speed requirement: actual ImapFlow deadlock and scheduling jitter were reproduced before changing the poller. React rendering/bundle optimization, billing and Ediel rule production remain outside the current runtime correction. Shared Ediel memory remains untouched; this plan and task audit carry this work's checkpoint.

## Task 4: Fast, bounded and recoverable mailbox polling

- [x] Reproduce the ImapFlow FETCH/STORE deadlock with the installed client and correct it using completed per-UID fetches.
- [x] Measure redundant AI calls for trusted explicit POA denials; bypass only that unused reading while preserving source/customer/sender checks and positive-response AI review.
- [x] Set the manual inbound/outbox schedules and new admin mailbox default to one minute. Read back both active verified production mailbox intervals at one minute; this is configuration, not a schema migration. The new scheduler is pending application delivery.
- [x] Finish the durable future-UID checkpoint, bounded retries, 150-second soft run budget and worker-fenced persistence. Preserve existing unread backlog; no automatic historical Seen backfill.
- [ ] Run final focused regressions, typechecks/lint and bind two nonauthor affected-source reviews to the final exact head/tree/base.
- [ ] Update the authorized producer handoff. The SQL checksum remains `d92f7ab706eb6bac415929255f218d38aa5e8f287bcad1c57f7438b9c590fc54`; do not duplicate the incumbent GEN producer.

Historical build evidence: cold production-environment staging on `d6031c6a` reached READY and its synthetic tool-free AI check passed in 2,752 ms. This does not attest later runtime changes or a real Strato reply. The initial build exceeded Vercel’s maximum build time; the successful run also had different hardware, so cache alone is not an established cause. `app.gridex.se` stayed on the existing release; the standard project alias was temporarily assigned to staging and restored. No migration, final promotion or POA test mail is claimed.
