## 2026-08-03 — Runtime schema readiness v4 incident repair

Status: VERIFIED LIVE DATABASE / READY FOR APPLICATION DEPLOY.

- Root-caused and removed the stale exact fingerprint production outage.
- Applied and verified forward migration `20260803212754` on `gridex-ops-dev`.
- Reconciled canonical manifest/ledger mappings and live readiness state.
- Added idempotent post-apply and static regressions.
- Verified API contract/OpenAPI documentation version `2026-08-03.1` and focused
  runtime/tenant/idempotency/portal checks.

# Completed verified work

## PHASE-00 — Permanent project memory

Required files, Cursor rules, checkpoint JSON and secret scan are verified.

## P0/P1 canonical lifecycle hardening

Status: VERIFIED LOCALLY

- Decoupled pricing/quote readiness from facility/PRODAT/switch readiness.
- Added resolver capabilities and stable purpose-specific blockers.
- Closed external request schemas and rejected unknown canonical API fields.
- Added explicit sanitized website-application DTO and public-ID policy.
- Split switch request creation from dispatch; deprecated the old alias.
- Replaced billing placeholders with data-backed profile, payment-term,
  provider/environment, recipient, address, OCR/reference and VAT evidence.
- Removed pricing-run/billing-underlay invoice fallbacks.
- Enforced exact hourly versus quarter-hour spot source selection.
- Added missing authenticated reconciliation cron.
- Added idempotent transactional `activate_customer_supply_v1`.
- Added canonical `supply.started` and `invoice.paid` webhook events and
  documented active/internal/planned event names.
- Synchronized OpenAPI, runtime, developer page and guides at `2026-07-27.1`.
- Added an explicit terminal contract-close operation with dependency cleanup,
  immutable closure metadata, audit, domain event and transactional outbox.
- Added canonical tenant lifecycle transitions with structured activation
  blockers and close preconditions.
- Enforced owning-tenant operational status for every integration API client.
- Removed direct company-status writes outside the canonical transition RPC.
- Added one canonical contract delete preview covering quotes, business usage,
  graph integrity, backfill diagnostics and real FK delete rules.
- Restricted permanent/bulk delete to unused `draft/ready`; published and
  terminal states now use lifecycle actions and separate list views.
- Removed delete-time legacy canonicalization and shared price-version cleanup.
- Added per-offer bulk subtransactions, durable technical references and
  server-side contract pagination.
- Repaired the final tenant lifecycle definition and made tenant closure end
  paused channels.
- Removed direct authenticated execution of the privileged delete preview.
- Separated contract-product, published-offer and customer-contract counts in
  company administration and preserved company selection in navigation.
- Aligned runtime API auth codes and resolver readiness requirements across
  OpenAPI, developer UI and the external integration guide.
- Isolated the internal contract list from readiness/delete graph failures.
- Enforced strict tenants, central role aliases and complete creation results.
- Enforced legal-identity-only customer reuse and same-customer DB invariants.
- Unified supply activation and monthly invoice export around canonical,
  idempotent database commands.
- Created draft invoice mirrors before provider send and updated them
  idempotently from provider events.
- Added lazy tenant-scoped chain tracing and complete portal invoice IDs.

## Verification

- Typecheck: pass.
- Full Vitest: 54 files, 354 tests pass.
- Targeted P0/P1 suite: 11 files, 80 tests pass.
- API contract/OpenAPI/docs checks: pass.
- Migration integrity: 304 files, 209 groups, checksums pass.
- New delete-graph migration: PostgreSQL parser accepts 32 statements.
- Dedicated contract delete-graph regression: pass.
- Dedicated contract/tenant lifecycle regression: pass.
- ESLint: pass with 125 existing warnings and no errors.
- Next.js production build: pass; `.next/BUILD_ID` generated.
- Added the service-only actor-aware contract delete v2 path with a shared dependency graph, preview token, concurrency-safe idempotent commit, explicit archive fallback, shared admin repository/actions and status filters across both admin entry points.

## 2026-07-27 P0 completion pass

- Repaired migration collision/checksum history and live slug/version integrity.
- Bound manual/web intakes and legal bundles to exact public offer identities.
- Made quote consume and canonical onboarding transactional.
- Removed status-derived signature evidence and added the contract state machine.
- Added energy-direction-aware active contract uniqueness.
- Moved invoice export runtime to the canonical graph.
- Added offer copy, fail-closed portal bundle and RBAC/lint corrections.
- Verified 356 tests, all TypeScript targets, lint, RBAC, API/OpenAPI,
  318/222 migration history, 122 P0 controls and 208 go-live controls.

## 2026-07-28 live-schema/code canonical synchronization

- Parsed the active live schema, functions, views, triggers, indexes, grants,
  RLS and remote migration history.
- Covered all 23 active live-lint function failures.
- Added a fail-closed forward migration with 41 exact active-definition
  patches and canonical schema repairs.
- Added missing onboarding/communication relations, invoice/provider fields,
  uniqueness, RLS and grants.
- Repaired canonical contract graph, energy direction, inclusive validity,
  signature retry, channel ending, legal/onboarding crypto and wrapper grants.
- Removed public quote UUID leakage and aligned runtime/OpenAPI at
  `2026-07-28.1`.
- Added preflight, rollback-only post-apply and full code/schema path
  regression.
- Verified 357 tests, TypeScript, lint with 0 errors, API docs, 319/223
  migration history, P0/go-live suites, SQL parse and production build.
- Produced the complete Swedish audit report and Docker-free apply runbook.

## 2026-07-28 canonical contract-channel completion

- Added explicit, idempotent internal/website/API channel grants separated from
  publication, with shared readiness and granular permissions.
- Routed both admin surfaces through one actor- and tenant-bound canonical
  service with post-commit state verification and failure audit.
- Made grants, channel state, validity and availability mandatory in the
  canonical TypeScript/SQL read model; missing database columns now fail
  closed instead of becoming `false`.
- Rebuilt website and API publication projections from the same immutable
  publication graph and added graph/date/hash/single-active-version checks.
- Added a strict external DTO allowlist, API scope `api_contracts.read`,
  documented errors and response/ETag/OpenAPI version `2026-07-28.2`.
- Added forward migration `20260728190000...`, post-apply introspection,
  dedicated behavior tests and a 43-control static regression.
- Verified 56 files/361 tests, all relevant TypeScript targets, API docs,
  212 go-live controls, 518 lifecycle controls, lint and production build.
- Recorded the pre-existing `20260728170000...` checksum drift as a release
  blocker; no database apply or A-H scenario was claimed.

## 2026-07-29 canonical commercial selection completion

- Added stable 12/24/36-capable price options and per-option SE-area rows.
- Replaced free-text optional fees with structured policy/condition/lifecycle components.
- Unified website and internal selection, quote hash v3, signed snapshots and billing under one v6 model.
- Added atomic service-only offer and internal customer commands, tenant/RLS guards, deterministic backfill and review evidence.
- Fixed exact component freezing and fail-closed billing identity.
- Synchronized API/OpenAPI/docs to `2026-07-30.1`.
- Verified 57 files/365 tests, TypeScript, lint, API docs, focused regression and production build.
- Database apply remains blocked by the immutable historical drift and absent authorized staging connection.

## 2026-07-30 canonical OPS/Web API release

- Added a machine-readable release manifest with deterministic OpenAPI hashes.
- Synchronized runtime, Website OpenAPI, Customer Portal OpenAPI, guide and examples at `2026-07-30.1`.
- Replaced fixed legal consent assumptions with dynamic, exact document evidence.
- Closed the targeted quote, portfolio, customer-event and portal-sync contracts.
- Added strict paired portal identity headers/payloads and a forward-only atomic portal identity/account migration.
- Synchronized Gridex Web snapshots and generated types; live readiness remains fail-closed until deployment.
- Verified 58 files/370 tests, all TypeScript targets, zero-error lint, API docs/parity, targeted tenant/idempotency/portal/webhook regressions and both production builds.
- Production remains NO-GO because immutable migration drift, database apply, live manifest, staging, provider, concurrency and two-tenant evidence are unresolved.

## 2026-07-30 immutable-history and public-contract repair

- Recovered `20260728170000...` from a trusted prior synchronized artifact and restored its registered bytes without changing the manifest checksum.
- Moved the intended inclusive `valid_to` and session-guard repairs into registered forward migration `20260730130000...`.
- Fixed release-manifest SHA-256 calculation to hash the exact serialized bytes served by both OpenAPI routes and made the manifest response non-cacheable.
- Normalized public errors to one nested envelope and removed duplicate integration-context and quote success aliases.
- Replaced raw webhook UUIDs/internal IDs with stable tenant-bound opaque references and recursively sanitized webhook data.
- Regenerated both OpenAPI documents with closed canonical error and publication-webhook schemas.
- Verified 323 migrations/227 groups, 58 files/373 tests, all TypeScript profiles, API/docs/parity, error/tenant gates, zero-error lint and production build.
- Production remains NO-GO pending migration-ledger resolution, clean/upgrade apply, deployment/live hashes, missing Web source and full environment E2E.

## 2026-07-30 Customer Portal/API production completion

- Added one strict customer sync request contract and tenant-safe identity normalization.
- Replaced public portal/application internal IDs with stable tenant-bound references.
- Added paginated portal projections and fail-closed bundle completeness.
- Added external-reference, idempotent and atomic move-out with case/event/outbox/audit state.
- Repaired v3 commercial quote acceptance in the atomic onboarding command.
- Synchronized runtime, OpenAPI and docs at `2026-07-30.2` and added compatibility/release gates.
- Verified 324 migrations/228 groups, 58 files/373 tests, all TypeScript targets, API gates, zero-error lint and production build.
- Database apply, deployment, live hashes, Gridex Web and environment E2E remain blocked and are not claimed.

## 2026-07-30 canonical price-option/API completion

- Bound price options to exact publication versions with customer type,
  default and explicit-selection rules.
- Added deterministic backfill, review evidence, publish-time validation and
  immutable publication copies without rewriting historical migrations.
- Exposed canonical top-level `price_options` and bound quote, validate and
  application assertions to the same immutable selection.
- Harmonized legal document identity and strengthened OpenAPI reachability,
  runtime fixture, example and release-identity checks.
- Restored portal contract signature-hash DTO/OpenAPI parity discovered by the
  final go-live regression.
- Synchronized both OpenAPI documents at `2026-07-30.3`.
- Verified 325 migrations/229 groups, all TypeScript profiles, 58 files/376
  tests, API gates, zero-error lint and production build.
- Database apply, post-apply, deployment, live hashes, Gridex Web and
  environment E2E remain blocked and are not claimed.

## 2026-08-01 Public Contracts runtime/OpenAPI/legal parity

- Replaced recursive public-contract DTO leakage/filtering with explicit strict canonical price-option and legal serializers.
- Made `is_default` canonical and retained `default` only as an identical deprecated compatibility alias.
- Added exact locked legal bundle identity to the legal object and every module, with fail-closed UUID, immutable, bundle and duplicate-module invariants.
- Added forward migration `20260801003000...`, exact-relation legal snapshot generation and dry-run-first idempotent audited backfill.
- Unified Website/API DTOs, repaired API legal output, added request/version headers and structured safe diagnostics.
- Regenerated both OpenAPI artifacts and release hashes at `2026-08-01.1`; added canonical fixture and route/OpenAPI/docs/version/checksum/migration gates.
- Rebuilt `/developers/customer-portal-api` into the complete integration guide.
- Static/API/domain regressions and changed-file TypeScript checks pass. Full dependency-based build, database apply and staging remain unverified. Historical `20260730220000...` checksum drift remains explicit and unblessed.

## 2026-08-01 canonical multi-tenant platform hardening

- Added explicit trusted tenant context to integration API and every implemented canonical onboarding adapter.
- Removed client-selected tenant hints from billing webhooks and public website payload processing.
- Added tenant-neutral service aliases for onboarding, number generation and effective legal projection.
- Removed unsafe number/sender fallbacks and Gridex-prefilled superadmin tenant configuration fields.
- Added fail-closed tenant capabilities, tenant-qualified relational constraints and all-tenant remediation SQL.
- Added architecture, runbook, focused tests and a static multi-tenant regression.
- Static/focused checks pass; full install/build/database/staging/all-repository evidence remains blocked and production is NO-GO.
# PHASE-38 locally verified work — 2026-08-02

- Fixed the three app and two test TypeScript failures without casts or non-null assertions.
- Upgraded Next/PostCSS/Sharp and verified zero high/critical production dependency findings.
- Repaired Ediel evidence v2 syntax, quarantine RLS, tenant-qualified relations, immutable attempts/evidence/attestations, server-derived evidence verification and matching-attempt projection guards.
- Added atomic `WEBSITE_APPLICATION_COMMITTED` audit/domain/outbox projection.
- Verified clean Node 22 install, all TypeScript targets, 417 tests, hardening regressions, migration integrity and full production build.
- Transaction-compiled both changed migrations against the connected development schema and confirmed rollback left no objects.

## 2026-08-04 — PHASE-42 canonical multitenant website application flow

- Unified tenant website readiness and enforced operation policy before intake.
- Completed fail-closed portal ownership, tenant portal URL and resumable application flow.
- Corrected exact status lineage and real job/email/webhook projection.
- Added terminal continuation safety in worker/database and durable webhook fan-out.
- Added canonical `customer_application.status_changed` and `supplier_switch.updated` events.
- Published immutable OpenAPI/docs `2026-08-04.1`.
- Added forward migration, safe ledger classifier, postflight and sync script.
- Verified migration/API/multitenant/onboarding/contract/market regressions and changed-file TypeScript syntax.
- Preserved honest pending state for database apply, deployment, full npm build and two-tenant E2E.

## 2026-08-05T15:14:58+02:00 — PHASE-44 customer legal package

- Grouped customer legal presentation into agreement, POA and withdrawal.
- Preserved exact canonical module acceptance evidence and tenant snapshots.
- Unified website and Customer Portal POA handling with fail-closed scope reuse.
- Published and verified additive API release 2026-08-05.1.

- 2026-08-05T15:20:07+02:00: Added pre-write rejection for duplicate/mixed grouped-vs-legacy legal acceptance payloads and stopped `power_of_attorney.signed` events unless the POA is actually persisted as a complete signed authorization.

## 2026-08-06T08:50:00Z — PHASE-45 OpenAPI / quote health

- Canonicalized top-level quote timestamptz hashing and nullable grid-area compares.
- Made local OpenAPI release verification fail closed for immutable artifacts/registry.
- Completed required quote and current-market-price OpenAPI examples for `2026-08-05.2`.
- Normalized application and metering-point grid/price area compares case-insensitively.
- Synchronized developer-guide contract examples to `2026-08-05.2`.
- Recorded findings in `quality/findings-2026-08-06-codebase-health.md`.

## 2026-08-14 — Post-#134 tip health residuals (b4c7)

Status: `IMPLEMENTED_NOT_VERIFIED_IN_CI`

- Ported unmerged 31d1 residuals onto tip `2afe1db8` and closed the new
  scope-heuristic Aktivera server gap introduced by #134.
- Forward migration `20260814170000_tenant_website_receipt_ready_binding.sql`.

## 2026-08-14 — Post-#135 tip health residuals (9740)

Status: `IMPLEMENTED_NOT_VERIFIED_IN_CI`

- Lifecycle resume exemption for launch-ready tenant_website clients
  (`20260814180000_tenant_website_activation_lifecycle_resume.sql`).
- Force pause when permissions promote active non-canonical clients to
  tenant_website; share `isTenantWebsiteIntegrationClient`.

## 2026-09-02 — tenant isolation remediation

Fourteen of fifteen audit findings closed, F-15 contained by a ratchet. Five
forward migrations applied and verified against `gridex-ops-dev`.

Verified: typecheck clean, 169 test files / 1066 tests pass, migration integrity
passes (558 files), the new tenant invariant gate passes against the live schema,
and eslint is clean on the changed files.

Two findings changed classification during remediation, both recorded in
`quality/audits/TENANT_TARGET_ARCHITECTURE_AND_REGISTER_2026-09-02.md`:

- F-3 was a misreading. The untenanted energy-flow rows are platform market
  events, not drift; the schema simply could not express the difference.
- F-9 was reported as latent and is a confirmed cross-tenant write:
  `setOwnElectricitySupplier` cleared `is_own_supplier` on every row in the
  database and was reachable by any tenant admin holding `switching.write`.

## 2026-09-04 — master plan P0-C: database parity and canonical schema artifacts

Status: `IMPLEMENTED_AND_LOCALLY_VERIFIED_PENDING_CI`

Worked the master remediation plan in its own order (§35). P0-A and P0-B were
verified to already exist by reading the code, not the memory files: clean
replay, the pinned Supabase CLI, local typegen and the generated-types
manifest. P0-C had no implementation, so that is what was built.

Four commits:

1. `a10c097` — parity engine (`npm run db:parity`), plan Fas 4. Both-directions
   comparison over schemas, relations (incl. view definitions and partition
   keys), columns, enum labels, constraints, indexes, functions, triggers,
   policies, grants, RLS state and extensions. Exit codes separate drift (1)
   from an unusable check (2) so a failed introspection can never read as
   parity. Ignore entries require a written reason.
2. `9825580` — `npm run db:parity:selftest`, wired into the
   `clean-migration-replay` CI job, asserting fifteen injected drift classes
   are each detected. Added `--no-ignore` so the gate cannot be widened by
   editing the exception contract.
3. `e80894c` — `db:types:gen` moved from `--linked` to `--local`, matching CI
   exactly. Generating the canonical type file from an arbitrary linked
   project violates plan §6.3 and absolute rule §36.
4. `328504a` — `npm run db:schema:snapshot` / `db:schema:check`, plan Fas 3.
   Normalized `schema.sql` plus a schema-wide `schema.fingerprint.json`
   computed from the same introspection document the parity engine uses.

Verified against a real PostgreSQL 16.13 cluster started for the purpose:
identical schemas compare clean with no false positives; every injected drift
class is detected, including a view whose tenant filter was silently removed,
a changed function overload signature and a revoked grant; the snapshot is
byte-deterministic across runs and fails closed with no baseline. Repository
gates re-run green: `db:migrations:check` (integrity 584 files, public
contract legal, contract hardening, generated types).

Honest pending state: no canonical schema baseline is committed, because the
Supabase CLI is absent from this container and clean replay cannot run here.
Production parity remains blocked on the production Supabase project. Nothing
from Fas 5 onwards was touched.

## 2026-09-04 (continued) — dockerless clean replay, tenant invariant convergence, CI gate reliability

Status: `IMPLEMENTED_AND_LOCALLY_VERIFIED_PENDING_CI`

Three further commits after the P0-C work:

5. `e752133` / `ca73d3b` — clean replay can run without Docker.
   `scripts/sql/gridex-supabase-compatible-bootstrap.sql` provisions the
   Supabase platform surface onto a plain PostgreSQL database and the replay
   script accepts `GRIDEX_REPLAY_DB_URL`. All ordering, checksum pinning and
   substitution logic is shared; the CLI path is untouched.

   The first version reconstructed the Supabase ledger by INSERT, which the
   provenance regression correctly rejected: in CLI mode the CLI produces those
   rows independently, whereas mine wrote them and then verified its own writes.
   External mode now writes nothing to the ledger and says it carries no ledger
   provenance. Proving that costs nothing: two shadows, with and without the
   ledger, compare identical under the parity engine.

6. `2506561` — `20260904120000_canonical_tenant_invariant_convergence.sql`.
   Run for the first time against a database replayed from this repository, the
   tenant isolation gate reported 21 breaches while passing against live. The
   migration closes all of them: three inbound relations classified, RLS on
   eight service-role-only tables, `security_invoker` on three views, three
   policies targeting `service_role` alone dropped, and PUBLIC execute revoked
   on six SECURITY DEFINER helpers. Each checked to be behaviour-neutral first.
   Also folds the tenant gate, the parity self-test and the schema snapshot into
   the replay step, where the database is actually alive.

7. `823b6f8` — the production dependency audit gate separates a vulnerability
   from an unreachable registry, which is what turned main red on `62272e9`.

Established from CI rather than assumed: `clean-migration-replay` is green on
main, so the pinned fingerprint is correct and the dockerless harness is the
side that differs. The harness is valid for structural work and invalid for
canonical provenance; that limit is recorded in current-task.md and handover.md.


2026-09-05: local behavior verification only: inventory selftest PASS and replay cleanup 10/10 PASS. No phase or production-parity closure.


## Active checkpoint 2026-09-05 — supersedes earlier status claims

IN_PROGRESS; no masterplan phase is complete. Publication is authorized and
PR #310 is open as draft. Head 2568c28f has passing verify/quality jobs and a
failing canonical replay completeness gate (OPS run 33971545934). This is a real
repository remediation task, not an external permission blocker.

Forward migration 20260905141608 restores seven tenant relationship triggers
while preserving the newer snapshot function. Isolated PGlite 0.3.14 tests pass
18 reference cases under authenticated/service_role, twice; live read-only
catalog assertion also passes. These tests do not establish full RLS isolation
or canonical replay provenance. Integrity and production-readiness pass for
586 files; generated-types check correctly fails the new migration tail. Do not
update the types manifest without actual authoritative generation.

Two exact reviewed read-only diagnostic inputs receive an explicit classification.
The plan still has 56 unclassified files and 32 unresolved substitutions.
Next: finish reviewed effect reconstruction and parity semantic checks, then
obtain authoritative replay/type/schema artifacts and compare both ways with
production. No production mutation has occurred in the 2026-09-05 campaign.


## Active checkpoint 2026-09-06 — supersedes previous progress

IN_PROGRESS. No phase closed. PR #310 published head 0a0f4068 has passing quality
gates and isolated reconstruction/parity SQL tests; verify fails generated-types
tail, and clean replay fails completeness (OPS 33988318141). These are required
internal remediation gates, not external permission blockers.

Next reviewed batch restores eleven invitation columns and corresponding role/FK/
unique-index effects through forward migration 20260906081839. Isolated tests
pass 18 assertions and two invalid-data rollback scenarios; the historical
regression table is frozen separately so canonical artifact refresh cannot erase
the failing baseline. Full RLS/RPC/provider E2E is not established.

Portal/API-origin source 20260609150000 is now preserved after its early bootstrap
at its original timestamp. Whole-source selection failed before the fix; actual
SQL now runs twice in an isolated fixture, preserving existing explicit origins
and valid identities, restoring match_strength=manual (read-only live default),
and verifying indexes. Other historical substitutions remain blocking.

Integrity/readiness pass for 587 files. Types still fail the new migration tail;
no manual hash or schema baseline edits. Complete historical effect review, then
run authoritative full replay, generate types/schema and verify ledger/live parity.
No production mutation performed in this batch.

## Published verification checkpoint — 2026-09-06

Code revision 8344cbb84eb6691bf7507bcc9c6580565bc6a114 is published on draft
PR #310. OPS run 34035865807 finished: quality-release-gates PASS; all isolated
reconstruction/parity SQL fixtures PASS; verify FAIL at the new generated-types
migration tail; clean replay FAIL at completeness. Later verify steps skipped
after the type gate are not certified. No phase closed and no production writes.

Next: complete the bounded Ediel environment source review, then test its complete
SQL with actual prerequisite ordering and successor hardening on PostgreSQL 17
before changing either source-suppression declaration. Full historical accounting,
authoritative schema/types generation and ledger/live comparison remain required.

Ediel next step: isolated PostgreSQL 17 CI fixture implemented; SQL composition
and diff checks pass, execution pending. Both source suppressions remain unchanged.
Inspect ediel-source-effects job before changing selection. No phase closed.

## Ediel source restoration — 2026-09-06

PostgreSQL 17 job 101502920151 in OPS run 34039266103 passed on published
revision d6967d21c4f7985c0f2a452ddaf8ae0cef8b3c60. Complete original source and
successor ran twice, including pgcrypto; synthetic backfill/history, uniqueness,
FK/column/RLS and non-owner policy assertions passed. This is isolated source
evidence, not canonical provenance or production parity.

Both bootstrap declarations now preserve source 20260602143000 at its original
timestamp. Selection regression failed SUBSTITUTED before the fix, passed after,
and rejects either declaration reverting independently. Accounting selftest now
passes 29 tests. Inventory integrity/readiness pass (587 files). Accounting now
498 FULL_FILE_SELECTED, 30 unresolved SUBSTITUTED, 4 exclusions, 55 UNCLASSIFIED;
full-effects gate correctly remains exit 1. Original SQL/checksums are unchanged.

Next: inspect CI for the restoration revision, then review the remaining source
substitutions and unclassified SQL. Authoritative canonical replay, schema/types
regeneration and bidirectional ledger/live parity remain open. No phase closed.

## Customer-flow source batch — 2026-09-06

Ediel restoration revision 69d51ee2c80a9a6221e871cc47027af66a02d125 has passing
PostgreSQL17 source-effects job 101503578599 (OPS run 34039506238). Its global
verify/types and replay/completeness gates remain red; quality is still running.
The next customer-flow source batch restores full pre-ledger selection after
its actual table prerequisites. Complete SQL runs twice in PGlite, preserving
existing values; source selection was red before and green after. Static
provenance, integrity and 29 accounting tests pass. Hosted SQL verification is
pending publication. Accounting: 499 full selected, 29 partial, 55 unknown,
4 exclusions. No phase closed or production mutation. Continue remaining source
reviews, then authoritative canonical regeneration and live/ledger parity.

## Actor-testing source batch — 2026-09-06

Customer-flow revision a201d3f2c60f9b9ad845f47f7137e4d8b0e7f9b1 has passing
hosted complete-source SQL/selection in verify job 101504319679 (OPS 34039783462).
Ediel PG17 job 101504319838 also passes. Verify subsequently fails generated
types tail; replay fails completeness. Neither is an external permission blocker.

The previously unclassified actor-testing source is now selected after its four
table prerequisites. Actual complete SQL runs twice in PGlite, validates five
index definitions and preserves evidence/messages. Selection red UNCLASSIFIED
before, green after; 29 accounting tests, static provenance and integrity pass.
Hosted actor-source test pending publication. Counts now 500 full, 29 partial,
54 unknown, 4 exclusions. Continue remaining historical source reviews; complete
canonical generation and ledger/live parity before closing any phase.

## Verified code-head checkpoint — 2026-09-06

Published code head 29dc94974825b329b9b822c2219b077d8679bb33, draft PR #310.
OPS run 34039976860: Ediel PostgreSQL 17 job 101504839380 PASS. Verify job
101504839441 passes all isolated SQL fixtures, including complete customer-flow
and actor-testing sources, then FAILS generated-types tail 20260906081839.
Clean replay job 101504839286 FAILS; complete input accounting remains unresolved.
Quality job 101504839408 is still running and is not certified. PR body records
these exact code-head results. No phase closed, production writes or manual
canonical/type hash changes. Next: inspect quality result and continue remaining
29 partial/54 unclassified sources; full authoritative replay/ledger/live parity
is still required. These are internal remediation items, not permission blockers.

## Billing completion source — 2026-09-06

Previous code-head 29dc9497 quality-release-gates is now PASS (OPS 34039976860).
Full source 20260520_batch_3_4_final_completion.sql now selected after the real
billing_export_run_id prerequisite. Isolated complete SQL passes twice with four
exact index definitions and unchanged rows in five tables. Wrong prerequisite
order is demonstrably rejected. Selection was UNCLASSIFIED before, full after.
29 accounting tests, static provenance, integrity pass. Hosted test pending.
Counts: 501 full selected, 29 partial, 53 unknown, 4 exclusions. No phase closed.
Next: verify published CI, then review status-check broad constraint removal and
profile-normalization trigger effects; do not blindly restore these sources.
Authoritative replay/schema/types/ledger/live parity remain required.

## Request-status continuation — 2026-09-06

Published billing code head a4063e3896ccefc487a2c39825c74462c444c9a2 passes full
billing SQL/selection in job 101545606099, OPS run 34055141338; verify subsequently
fails generated-types tail. Ediel PG17 passes; complete replay remains red.

Request status source 20260521_final_customer_info_request_status_check.sql is
now selected immediately after its first table definition. That reviewed boundary
has only the intended status CHECK; no earlier selected foundation references
the table. Full source passes twice with 19 exact states, unchanged rows/PK/FKs,
and atomic rejection of invalid existing data. Selection red before, green after.
29 accounting tests and static provenance pass; hosted status test pending.
Counts: 502 full selected, 29 partial, 52 unknown, 4 exclusions. Continue profile
normalization trigger/dependency review and remaining history, then authoritative
canonical replay/schema/types and ledger/live parity. No phase or merge approval.

## Profile metadata continuation — 2026-09-06

Status source on published code head 9266c1b65130302b47a78c6d26182391d3e56be9
passes hosted complete SQL, 19-state validation and selection in job 101546218730,
OPS 34055377589. Verify subsequently fails types tail; replay remains red.

Profile normalization full source is now selected at its reviewed trigger-free
foundation boundary. Two passes with valid and legacy synthetic values verify
only tracking metadata changes; identity/status/timestamps/auth FKs are preserved.
29 accounting tests, static provenance and integrity pass; hosted test pending.
Counts: 503 full, 29 partial, 51 unknown, four exclusions. Next: verify hosted
profile SQL, then test the complete auth-callback/email-event source on PG17
before restoring it ahead of normalization. Full parity remains unverified;
no production writes, phase closure, merge or deployment in this batch.

## Published verification — 2026-09-06

Verified code head 4df526a8f73228ecb1f41c672db98cebbc7bf108: OPS 34055573705,
verify job 101546734266 passes all isolated SQL, including all three new source
fixtures, then fails generated-types tail. Ediel PG17 passes; replay fails;
quality job 101546734174 is still running. PR #310 records exact results.
Next: inspect quality and test full auth-email source on PG17 before restoring
it ahead of normalization. 29 partial/51 unknown remain; no phase is closed.

Auth-email next step: full-source PostgreSQL17 test implemented, SQL composition
passes, hosted execution pending. Replay selection remains unchanged. Verify
the auth-email-source-effects job before restoring source ahead of normalization.

## Auth-email source restored — 2026-09-06

Complete auth-email source and profile normalization passed PostgreSQL17 job
101547966634, OPS 34056026728, code head b98c0d079b6846ad5f2098da598bf1d72bae31dc.
Original source is now selected after the profile bootstrap and before profile
normalization. Selection failed SUBSTITUTED before the fix; now passes, while
reversing auth/normalization order is rejected. Profile regression updated for
the verified combined order and passes. 29 accounting tests, static provenance
and integrity pass. Counts: 504 full, 28 partial, 51 unknown, four exclusions.
Hosted restoration-head validation pending. No production writes, schema/type
hash edits or phase closure. Continue historical effect accounting before full
canonical replay, generated artifacts and ledger/live parity.


## POA source verification in progress — 2026-09-07

Auth restoration e5c1005032613fd0d56d065c235f227a8b2658a7 passed auth PG17
job 101640004817 and quality-release-gates in OPS 34089519574. Full replay
and migration verification remain red. POA/request whole-source PG17 fixture
is now wired after auth fixture; SQL composition and diff checks pass, hosted
execution pending. Includes exact index definitions, 24 states, data/key/policy
preservation and two applies. Selection remains unchanged (504 full, 28 partial,
51 unknown, four excluded). Next: run hosted fixture, fix failures, then restore
source after blocker prerequisites with selection-order regression. No phase
closed; no production mutation or generated-artifact edits.


## POA source restored — 2026-09-07

Complete source twice passed PostgreSQL17 job 101641683544, OPS 34090109671,
revision 9b67081ab7685e1dcc033982d9c7762c812356f4. All 24 status values, exact
index definitions and preserved data/keys/policies passed. The full source is
now selected immediately after customer_blockers foundation. Selection failed
UNCLASSIFIED before restoration, passes after, and rejects reversed prerequisite
order. 29 accounting tests and static provenance pass. Counts: 505 full selected,
28 unresolved substitutions, 50 unclassified, four exclusions. Whole-effects
gate remains red; no phase closed. Next: verify restoration-head PG17 CI, then
continue source accounting; authoritative replay/types/schema and live/ledger
parity remain required. No production writes or artifact hash edits.


## Published POA verification — 2026-09-07

Revision aed588c0c9c40b221eeff5ccf81812736507ab67: job 101642417324,
OPS 34090366696 PASS for selection order and whole POA/auth SQL. Verify fails
generated-types tail; clean replay remains red. Quality job 101642417302 was
still running. PR #310 records exact evidence. No phase closed.

Next active review: auth_email_templates_invite_reset_sync and the unclassified
company_invite_temp_password_sync, direct_temporary_password_auth_sync_fix,
company_delete_backfill_and_admin_layout successors. The template introduces
membership constraints and an event-read policy; later SQL changes event-status
grammar and deletes orphan membership/invitation metadata. Review the combined
prerequisites, final access policy and data semantics before isolated PG17 tests
and source restoration. All four remain UNCLASSIFIED; no external blocker is
established. Full canonical/types/schema/ledger/live parity remains open.
## Active auth-chain checkpoint — 2026-09-07

Complete four-source characterization fixture added; local SQL composition and
patch validation PASS, hosted PG17 execution pending. Selection unchanged:
505 full selected, 28 partial, 50 unclassified, four exclusions. See
quality/audits/AUTH_INVITATION_CHAIN_REVIEW_2026-09-07.md for exact data/policy
risks and fixture limits. Next: run PG17, resolve fixture failures, then evaluate
final policy and data-effect reconstruction before selection changes. No phase
closed or production writes. Previous POA restoration quality job 101642417302
now PASS; full replay/types remain red.
## Auth template restoration — 2026-09-07

Complete four-source PG17 characterization PASS: revision
6b47f339bae2d5af13f7e253f75d82c7830e1995, OPS 34092843096, job 101649830022.
Wrong cleanup order is rejected; complete sources run twice. Only the DDL-only
auth template source is now restored after auth/profile prerequisites. Selection
failed UNCLASSIFIED before, passes after, and reversed order fails. Accounting
29 tests, provenance and 587-file integrity PASS. Counts: 506 full, 28 partial,
49 unknown, four exclusions. Restoration-head CI pending. Three effectful
successors remain unclassified, with lossy status/metadata and orphan-delete
semantics requiring review. Production catalog read only: legacy permissive
SELECT is combined with a RESTRICTIVE tenant/session guard; isolated legacy
predicate is not proof of live cross-tenant exposure. No production mutations,
phase closure or generated-artifact edits. Next: verify restoration head, then
review reconstruction/order for the invitation and temporary-password successors.
## Actor-FK continuation — 2026-09-07

Template restoration published at e1ffdd8749e3edb6f42b17050ee6264267366c9c;
OPS 34120804760 auth PG17 job 101738143562 PASS. No full parity claim.
Next review found a fifth related source, direct_account_temporary_password_flow.
Its conditional REFERENCES clauses are skipped when the invitation predecessor
already created disabled_by/removed_by columns. Both actor FKs exist in the live
catalog (read-only verification); the five-source fixture now characterizes their
absence and the restored profile active-company FK. Hosted execution pending.
Next: verify this order-dependent effect loss on PG17, then implement narrowly
scoped forward FK reconstruction or a fully verified prerequisite restoration.
Counts remain 506 full/28 partial/49 unknown/4 excluded. No production writes,
phase closure, generated-artifact edits or external blocker.
## Actor-FK repair awaiting PG17 — 2026-09-07

Five-source characterization passed job 101739209647, OPS 34121147911.
Forward migration 20260907121951 now restores two membership actor FKs without
historical DML. Four fixed-local PG17 cases cover existing/missing columns,
invalid actor references and incompatible same-name constraints. SQL composition,
29 accounting tests and integrity PASS (588 files/492 groups); hosted repair
execution pending. Counts: 507 full/28 partial/49 unknown/4 excluded. See
quality/audits/MEMBERSHIP_ACTOR_FK_RECONSTRUCTION_2026-09-07.md. Next: verify
hosted repair, then remaining historical effects and authoritative parity.
No production writes, types/schema hash edits or phase closure.
## Verified actor-FK reconstruction — 2026-09-07

Published code 6d9e579c8af1c7f4509cb7bbb13750711e3be4fc; OPS 34121661358,
job 101740868281 PASS. Existing/missing-column repair runs twice, preserves
identities/status/policies/RLS and clears actor references on deletion. Dirty
actor and conflicting-constraint scenarios roll back without partial repair.
Complete five-source characterization and template/POA selections also PASS.
Integrity/readiness PASS: 588 files, 492 groups, 495 ledger-eligible versions.
Types correctly fail new tail 20260907121951. Full-effects gate remains red:
507 full selected, 28 unresolved substitutions, 49 unknown, four exclusions.
No phase closed or production writes. Next: continue unclassified invitation,
direct-account and governance effect reconstruction, then authoritative complete
replay/schema/types and ledger/live parity. Actor FK repair is scoped evidence,
not complete classification of either historical source. PR #310 updated.

## 2026-09-08 — isolated RBAC characterization verified

Published d32a3457983f36b159f5180e8c5ac4fc9516842e, OPS34227210022 auth job102064145147 on PostgreSQL17.11: all seven commands PASS, including three complete RBAC originals twice, missing-view prerequisites and invalid-environment rollback. Separate review fixed missing profile status before publication; integrated review approved. This receipt closes no masterplan phase and proves neither full replay nor production parity.

2026-09-09 — Bounded RBAC prefix VERIFIED on published01e31ed8: OPS34344515597 auth102442823593 all9commands PASS, including actual selected prefix, repeated complete sources and preserved final helper. Ediel102442823708 PASS. Full replay/types/ledger/live parity and phase closure remain open. Next source20260519_saas_ui_tenant_admin stays SUBSTITUTED while statement/effect review starts.

2026-09-09 — Publishedfac58fae bounded SaaS/integrity VERIFIED: OPS34348338877 auth102455180423 alltencommands PASS, actualSaaSprefix/stable repeats/platformcleanup, eight reducedbranches, five uniqueness and fiveindex repair cases including rollback. Ediel102455180529 PASS. Full replay/types/ledger/live parity, remaining NOTNULL/FK gaps and systemwide deletion/index/identity gates remain open.

2026-09-09 bounded identity evidence: c220acd5 corrected by c0b661a9 after separate review. Deterministic legacy-key preflight and mandatory-reference-only scope approved; all FK actions/OIDs must remain intact. Same-parent assignment/key-only/override lifecycle explicitly unresolved. This is reviewed evidence, not schema/SQL or phase completion.

2026-09-09 Bounded mandatory-reference execution verified at5fb7fc74: all ten auth commands and61 reduced identity cases PASS on actual PG17; fixture recovery included. No lifecycle/full parity or phase closure.

2026-09-09 Bounded governance evidence38b8a81b independently approved: all808 source lines,17/17 first-source targets/view prerequisites, statement boundaries and later-hardening/journal qualification reviewed. Evidence only;6D2 missing three complete prerequisites and all runtime/parity gates remain open.

2026-09-09 Bounded full6D execution verified atb9afbf68: OPS34359949888 auth102494069650 passed all11 commands,15 governance lanes and61 identity cases. Actual30-prefix/17 guards, references/repeats, exact dirty/late failure and real lock boundaries verified. Journal authorization/full governance/lifecycle/parity and all masterplan phases remain open.

2026-09-09 Bounded operations restoration publishedaad37fc1: separately/integrated reviewed, exact fetched tree verified, auth12-command PG17 and quality/build PASS. Complete operations source preserves tested rows/references and exact28 indexes; this is not full replay/runtime/phase closure. Task5 import prerequisite design separately approved, minor index-name correction7c2ee774; token implementation continues under Task6 and import admission remains Task7.

2026-09-09 Bounded token prerequisite published17da3243: under-lock admission correction independently re-reviewed, exact tree verified, fixed13-command PG17 and quality/build PASS. Existing credential values/nullable compatibility preserved; final mandatory/runtime acceptance intentionally remains open for incompatible historical shapes. Task7 read-only import admission now active; no phase or production parity closure.

2026-09-09 Bounded SQL predicate correction5ecefd1f/publishedc990dfb2 verified on actual PostgreSQL17 job102659793781: original boolean/regclass failure gone; first33 observation,6 shapes and56 dirty cases PASS before separate fixture failure. Independent review approved. This closes only F-IMPORT-ADMISSION-001, not Task7, full replay or any masterplan phase.

## 2026-09-09 — Task7 verified; execution environment disconnected

Code 236637eb2368a7035e61a844d2a4f5963bd2390d, exact reviewed tree bea7af5d326c0fe11bf8477080159094f2cd71d1. OPS34410026916:
auth102662038207 PASS all14 commands, actual first33 migrations, six reduced
compatible shapes,58/58 exact dirty categories/counts with preservation/repeats,
four unresolved-final-gate variants, read-only enforcement and coherent concurrent
snapshot. Quality102662038159 PASS (195 test files/1162 tests,45 quality tests,
build/release/bundle checks); Ediel102662038204 PASS; tenant workflow34410026921
and browser-public102662038546 PASS. Verify102662037849 FAIL generated-types
tail20260909123000; clean102662038187 FAIL source completeness before full replay.
Staging/load/full production certification remains skipped or unverified.

F-IMPORT-ADMISSION-001 and F-IMPORT-FIXTURE-002 VERIFIED_CLOSED within Task7.
Both scoped code fixes independently reviewed; exact blocker equality retained.
593 inputs remain518 full/26 substituted/45 unclassified/4 excluded,71 unresolved.
Task7 bounded acceptance complete; no masterplan phase closed.

Next active item: Task8 whole-source execution contract, proposed only and awaiting
independent review. Local contract save failed when execution environment returned
409 environment_offline; no Task8 code or source-selection change exists.
Recovery summary: quality/audits/GOVERNANCE_FULL_SOURCE_EXECUTION_RECOVERY_2026-09-09.md.
Current checkpoint and this evidence persisted via working GitHub connector.
Local checkout cannot be fetched/reconciled while offline; on resume fetch this
branch, preserve any local tracked edits and ignored draft/reports, then reconcile
status by content before editing. Do not discard the separate Ediel worktree.
No production mutation, merge or deployment. Required red gates remain blocking.

2026-09-10 Continuation: environment restored; local branch fast-forwarded25cb2c2b,
pre-checkpoint status edits preserved in named stash. Hosted checkpoint OPS34411408397
job logs inspected: auth102666415931 PASS prior14 including exact dirty-category
preservation and coherent snapshot; quality102666415994 and Ediel102666416085 PASS.
Verify102666415708 fails generated-types tail20260909123000; clean102666415974
fails before full replay. Fresh input accounting593:518/26/45/4. No phase closure.
Task8 design3986a755+87b45d8d independently approved after seed/index expectation
corrections; actual SQL unexecuted. Task9 fixed whole-source fixture implementation
active, selectors unchanged; Task10 selection requires hosted proof. User explicitly
authorizes necessary production merge/migrations/deployment after verification.

2026-09-10 Task9 code34df3d0a: four integrated findings corrected and independently scoped approved, no new material breakage. Exact ACL/retained-identity, first-F allowed offer delta, CTAS alias and native6D2 rollback oracles have focused RED-before/GREEN-after static regressions. Compile/selection/emit/group/integrity/provenance/accounting PASS. Code approved for hosted publication; SQL NOT EXECUTED, Task9 acceptance OPEN. No selector or production change.

2026-09-10 Runtime correction7c2b9123 independently approved: typed positive duration comparison preserves10s/120s and1s/10s limits. Constructor regression RED/GREEN; compile/group/selection/emit/diff PASS. Nine explicit equivalent/wrong/zero SQL cases await hosted execution. No source selection or production changes.

2026-09-10 Seed correctionf07f3946 independently approved: actual roles schema uses is_system_role, while F intentionally supports no is_system. Four fixture assumptions corrected; full synthetic-role JSON preserved, company_admin permits only F name/description delta. Focused regression RED/GREEN; compile/group/selection/emit/diff PASS. Corrected SQL pending. Latest6e2e00e3 quality102808527446 including build PASS. No source selection/production change.

2026-09-10 Debug-name correctionbe74eb74 independently approved: locally reproduced libc en_US.utf8 versus Python name ordering mismatch; SQL aggregate now explicitly COLLATE C with exact15 names/count/status/RLS checks unchanged. Focused regression RED/GREEN; compile/group/selection/emit/diff PASS. Corrected PG17 pending; no source/selector/production change.

2026-09-10 Policy-winner correctione174d4e1 independently approved: exact eight retained6D2 import policies, actual6E customers UPDATE replacement, command/PUBLIC/permissiveness/null-safe expressions and bidirectional full import-policy/OID preservation. Focused RED/GREEN; compile/group/selection/emit/diff PASS. Corrected hosted SQL pending. Latest5c943a77 quality102816183495 including build and Ediel102816183701 PASS; no source selection or production change.
