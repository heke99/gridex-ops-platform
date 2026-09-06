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
