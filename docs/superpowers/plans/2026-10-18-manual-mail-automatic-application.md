# Automatic manual-mail application implementation plan

**Goal:** Apply clear incoming POA information automatically to the server-resolved tenant, customer, site and request, including commercial dates, while retaining exceptions for contradictory, unauthenticated or incomplete replies.

**Architecture:** Correlate independently of AI, verify the original sender, run a tool-free reader once, then normalize evidence on the server. An atomic service-only command rechecks the source/request/site and writes commercial facts and a safe date floor. Existing market permission, readiness and outbound commands remain authoritative.

**Constraints:** Continue release branch based on main `3034e14d`; preserve unrelated user files, Ediel ledger and shared producer scopes. No automatic contact changes, invented signatures, supplier dispatch or acceptance of conditional dates. Do not treat a raw quoted date as semantic proof.

## Task 1: Pure commercial terms and date floors

Files: new `lib/inbound-mail/manualCommercialTerms.ts`, `__tests__/manual-commercial-terms.test.ts`; modify `lib/operations/switchStartDate.ts`; new `__tests__/manual-mail-switch-date-floors.test.ts`.

- [ ] Write and observe failing behavioral tests for unambiguous dates, inclusive end dates, notice units, month boundaries, contradictory/conditional text and partial replies.
- [ ] Implement `normalizeManualCommercialTerms({extracted, authoredText, receivedAt})`, returning `ok`, `reasons`, normalized `terms` and source `evidence`. Compute a start floor only from explicit end/start facts.
- [ ] Extend `calculateEarliestSwitchStartDate` with optional `earliestSupplierStartDate`; retain move-in semantics and fix explicit days/month clamping.
- [ ] Run the new suites and existing date/readiness regressions.

## Task 2: Evidence and transactional application

Files: inbound reader/recording/ingestion and new server interpretation/command modules; forward SQL migration and real PGlite tests.

- [ ] Write tests proving AI suggestions can assist extraction but cannot choose identities or bypass sender/request holds.
- [ ] Preserve the at-most-once paid reservation and make its saved result available before business application, including retries.
- [ ] Validate full authored text and quotes, reject multi-entity/negated/conditional values, normalize canonical fields and preserve complete provenance.
- [ ] Introduce `gridex_apply_manual_commercial_reply_v1`: lock request/source/site; check exact tenant/customer/site, source, current hold and status; save canonical supplier terms and evidence; update only open unsent switch dates with a safe floor. Deny anon/authenticated execution. Preserve all market gates.
- [ ] Verify actual supplier-request/outbound correlation and sender evidence; do not confuse customer-info and grid-owner request IDs.
- [ ] Test successful apply, partial/incomplete replies, cross-tenant attempts, retries, stale replies and rejection races against executable SQL and ingestion.

## Task 3: Visibility and delivery

- [ ] Update the runbook and relevant API documentation to explain automatic facts, exceptions and provenance.
- [ ] Run relevant tests, app/test TypeScript, lint, migration and tenant boundaries.
- [ ] Obtain two independent reviews of the final source and close confirmed findings.
- [ ] Deploy using the existing authorized production workflow; verify public endpoints and actual runtime/schema readiness without exposing credentials.

Skill routing: using-superpowers, writing-plans, TDD, verification-before-completion, parallel delegation and existing worktree isolation apply. Agent-email-inbox and Supabase apply to untrusted mail and tenant-scoped persistence. PostgreSQL guidance applies if a forward command is required. Deployment/CLI/env skills apply at delivery. UI/performance/billing/Ediel rule-production skills are outside this bounded task unless source changes trigger them. Shared Ediel memory remains untouched; this plan and task audit carry this work's checkpoint.
