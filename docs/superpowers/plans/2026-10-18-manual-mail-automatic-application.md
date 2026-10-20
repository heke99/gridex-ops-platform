# Automatic manual-mail application implementation plan

**Goal:** Apply clear incoming POA information automatically to the server-resolved tenant, customer, site and request, including commercial dates and PDF/image/Excel sources, while retaining visible exceptions for contradictory, unauthenticated, unknown or incomplete replies. Each outbound/reply concerns one customer in one tenant and may include multiple facilities of that same customer. Mixed customers/tenants must not be automatically split or applied.

**Architecture:** Preserve original MIME bytes/hash, verify the original sender, extract spreadsheets/text locally and transcribe all permitted PDF/images in one tool-free OCR call. Build a complete source catalog with page/cell provenance, resolve canonical ownership on the server, then run the semantic reading and normalize evidence. OCR and semantic stages have separate at-most-once reservations. An atomic service-only command rechecks source/request/site and writes commercial facts and a safe date floor. Existing market permission, readiness and outbound commands remain authoritative. One complete semantic reading is partitioned by server-verified source locators for the same customer’s facilities. Each target has its own request/POA/application and continuation proof; no blanket end-to-end claim is made.

**Constraints:** Continue the isolated attachment worktree `/workspace/gridex-ops-attachments-20261019`, based on main `63580ae0` and mail source `1e78dbbf`, integrated at `e535113a`; the final exact head/tree is bound in PR #828. Preserve unrelated user files, Ediel ledger and shared producer scopes. No automatic contact changes, invented signatures, unauthorized test messages to suppliers or acceptance of conditional dates. Do not treat a raw quoted date or OCR identifier as canonical authority. Full permitted PDF/image documents leave the server for OpenAI OCR and are not masked first; semantic identity/email/case masking is partial. Canonical schema/types/checksum production remains with the existing qualified producer. No public wire/API change is needed for this internal flow; historical OpenAPI releases remain unchanged.

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
- [x] Validate full authored text and quotes, reject conflicting customer identity/negated/conditional values, normalize canonical fields and preserve complete provenance. Multi-facility documents are an additional task below, not covered by this historical checkmark.
- [x] Introduce `gridex_apply_manual_commercial_reply_v1`: lock request/source/site; check exact tenant/customer/site, source, current hold and status; save canonical supplier terms and evidence; update only open unsent switch dates with a safe floor. Deny anon/authenticated execution. Preserve all market gates.
- [x] Verify actual supplier-request/outbound correlation and sender evidence; do not confuse customer-info and grid-owner request IDs.
- [x] Test successful apply, partial/incomplete replies, cross-tenant attempts, retries, stale replies and rejection races against executable SQL and ingestion.

## Task 3: Visibility and delivery

- [x] Update the runbook and relevant API documentation to explain automatic facts, exceptions and provenance.
- [x] Run relevant tests, app/test TypeScript, lint, migration and tenant boundaries; retain the genuine checksum/type-generation failures as release blockers.
- [ ] Obtain two independent reviews of the final source and close confirmed findings.
- [ ] Deploy using the existing authorized production workflow; verify public endpoints and actual runtime/schema readiness without exposing credentials.
- [ ] Create a canonical isolated test intake before sending the user-authorized POA test mail. A synthetic unsigned PDF and an orphan case ID are insufficient; a reply from the user cannot count as a verified supplier decision.

Current evidence and the concrete schema/checksum delivery dependency are recorded in `quality/audits/manual-poa-mail-2026-10-18/automatic-application-checkpoint.md`. Full tests on historical `40974bfe`: 20,167 PASS, three checksum-dependent replay failures, two intentional SKIP. The subsequent metadata-only hold identity correction had 353/353 atomic/hold/SMTP checks. Later `1e78dbbf` reviews and builds apply only to their documented source. None of these historical results approves later attachment changes; the final exact-source results are bound in PR #828. **APPLICATION HOLD** remains published in [#766](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6254717292), pending qualified GEN carrier, final exact-source checks and two new independent reviews. No new deployment or real Strato round trip is claimed.

Skill routing: using-superpowers, writing-plans, TDD, verification-before-completion, parallel delegation and existing worktree isolation apply. Agent-email-inbox and Supabase apply to untrusted mail and tenant-scoped persistence. PostgreSQL guidance applies if a forward command is required. Deployment/CLI/env skills apply at delivery. Performance-optimization now applies to the user’s explicit speed requirement: actual ImapFlow deadlock and scheduling jitter were reproduced before changing the poller. React rendering/bundle optimization, billing and Ediel rule production remain outside the current runtime correction. Shared Ediel memory remains untouched; this plan and task audit carry this work's checkpoint.

## Task 4: Fast, bounded and recoverable mailbox polling

- [x] Reproduce the ImapFlow FETCH/STORE deadlock with the installed client and correct it using completed per-UID fetches.
- [x] Measure redundant AI calls for trusted explicit POA denials; bypass only that unused reading while preserving source/customer/sender checks and positive-response AI review.
- [x] Set the manual inbound/outbox schedules and new admin mailbox default to one minute. Read back both active verified production mailbox intervals at one minute; this is configuration, not a schema migration. The new scheduler is pending application delivery.
- [x] Finish the durable future-UID checkpoint, bounded retries, 150-second soft run budget and worker-fenced persistence. Preserve existing unread backlog; no automatic historical Seen backfill.
- [ ] Run final focused regressions, typechecks/lint and bind two nonauthor affected-source reviews to the final exact head/tree/base.
- [ ] Update the authorized producer handoff. The SQL checksum remains `d92f7ab706eb6bac415929255f218d38aa5e8f287bcad1c57f7438b9c590fc54`; do not duplicate the incumbent GEN producer.

Historical build evidence: cold production-environment staging on `d6031c6a` reached READY and its synthetic tool-free AI check passed in 2,752 ms. This does not attest later runtime changes or a real Strato reply. The initial build exceeded Vercel’s maximum build time; the successful run also had different hardware, so cache alone is not an established cause. `app.gridex.se` stayed on the existing release; the standard project alias was temporarily assigned to staging and restored. No migration, final promotion or POA test mail is claimed.

## Task 5: Complete bounded documents and same-customer facilities

- [x] Implement original MIME part capture, source roles, byte/hash/format validation and local full-workbook traversal within fixed bounds. Exclude forwarded history; fail closed on unsupported, encrypted, external/macro or incomplete documents.
- [x] Implement a tool-free PDF/image transcription adapter and source-bound at-most-once recording. Cover every real page/image exactly once, preserve table-row/footnote relationships, restore the original NULL-context stage read-only after canonical assignment, and never reset paid processing/failure/timeout markers.
- [x] Complete source-catalog/semantic ingestion and exact per-facility application for one canonical customer. Resolve all identities through server records and verified contact/POA/request authority; preserve each facility's conditions and citations. Document the actual semantic call count per target after source review.
- [x] Finish the dedicated superadmin `/admin/mail-review` queue for unknown, uncertain, unsupported and uncovered cases, with authenticated scope-safe source visibility.
- [ ] Freeze the complete candidate; run focused regressions/typechecks/lint and obtain two independent final reviews. Prior OCR authors cannot approve their own final source.
- [ ] Obtain the qualified schema/types/checksum carrier, then follow normal deployment and test the actual isolated intake → signed POA/archive → outbound request → Strato reply → correct customer/facility/facts/date chain, including PDF, image, Excel, multi-facility conditions, review and replay. No such production proof has been completed.

Document limits: 5 attachments, 4 MiB/file, 6 MiB total; 12 visual pages in total including images; OCR 12,000 characters/45 seconds/6,000 output tokens. The combined document corpus is bounded to 24,000 characters/160 sources/2,000 characters per source; semantics has 15 seconds/1,600 output tokens. Body-only retains its prior 12,000-character/80-source limit. Oversize or incomplete content is reviewed, never silently truncated. Body/text/Excel uses one shared semantic stage for all safely partitioned facilities; visuals add one shared OCR stage. OCR and semantics have separate usage/cost records. Each facility receives only candidates whose exact source locators belong to its canonical group.

Current integrated verification is recorded in the task checkpoint and PR #828 with exact logs/source binding. Historical component counts overlap and are not summed. The real OpenAI OCR, production schema/runtime and isolated Strato round trip remain unverified; local worker, fake-provider tests and PGlite SQL do not attest them. The final integrated run covers 61 suites: 1,691 PASS and one intentional SKIP; app/test TypeScript and lint pass. The original migration remains d92f7ab7; the additional forward migration is `20261019010000_manual_mail_multi_site_application.sql` / `072b15204cf0ac6447c5cb6ec3599b111cecbcae52379fdb5fcfd9eb978c48e7`. Both checksum registrations and the qualified schema/types tail must come from the existing producer.
