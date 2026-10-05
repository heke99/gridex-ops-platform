# E035 case-navigation repair round 5 — implementation receipt

Status: IMPLEMENTED_NOT_NATIVE_VERIFIED. Task BASE `a7cf4215b20d3d5bcd02fad64e3f58ce6aada49e`; root-owned checkpoint commits may precede this implementation commit. This is round 5 of the existing case-navigation task, not a new retry budget or whole-E035 acceptance.

## Confirmed cause and bounded repair

Actual controller evidence: OPS35896688338/native107302259653 retained124 PASS, then `scripts/ediel-case-view-native.test.ts:158` failed because `public.customer_case_events` was absent. The source migration `20260520_batch_5_cases_audit_email_ux.sql` defines the real ten-column event model used by db.ts and engine.ts, but its checksum-pinned registered bootstrap substitution omits that table. Production-only presence was previously recorded in `quality/audits/GRIDEX-PROD-PARITY-2026-09-04.md:94`. No historical migration, bootstrap, assertion, or event model was removed/replaced.

Controller's bounded read-only hosted catalog check during this round confirms the old ten-column table, RLS enabled, zero existing case/company/customer ownership mismatches, and an existing `customer_case_events_customer_company_fk`. No customer rows or secrets were copied, no hosted writes were performed. The September customer-chain repair skipped this absent table during clean replay; the new forward conditionally supplies that same composite customer FK while preserving the live constraint.

Supabase CLI2.101.0 `migration new --help`, then `migration new restore_customer_case_events_atomic_status` genuinely created `20260923180557_restore_customer_case_events_atomic_status.sql`. Final SHA256: `290357346253461628c6d341ba383d16690b62613dc8ce913eb3044965cd59a8`. Its final unpublished bytes were registered with the repository checksum command; no historical manifest entry changed.

The forward creates the original table only if missing, preserves existing rows, enforces required ownership columns and a validated `(customer_case_id,company_id,customer_id)` FK to the locked case identity, restores the composite customer FK if absent, and supplies case/company/customer/actor indexes. Existing incompatible ownership fails validation instead of being reassigned. RLS is enabled; PUBLIC/anon/authenticated table access is revoked and only the established service role receives table CRUD grants. Existing frontend access is not expanded.

The confirmed partial-write defect was three separate HTTP transactions: case UPDATE, event INSERT, audit INSERT. The status helper now makes one server-only `gridex_update_customer_case_status` call. SECURITY INVOKER, empty search_path, explicit EXECUTE revocation/grant, row locking and scoped/source selection protect the write boundary. Actor/company/customer attribution is derived from the actual case. The SQL requires an active public profile, real active selected-company membership, writable active/onboarding company, and company-scoped cases.write through the established resolver. That resolver validates the real auth user, deletion and bans within its existing definer boundary; no new auth.users grant or direct invoker read was added. Canonical platform identity is allowed for Support only with the same mandatory membership/company checks. Actual Ediel-source rows explicitly deny platform mutation, including when expectedSource is omitted, matching the Ediel action.

The RPC preserves optional source, trimmed/fallback event message, status payload, success/info classification, actor, resolved/closed timestamps and full returned row as JSONB. Audit keeps existing action/new_values/customer metadata and adds the locked previous status; the canonical audit trigger supplies required actor/request/resource/status context. Any event or audit failure aborts all writes. No ACK, source approval, supply, billing, notification or outbound call was introduced.

## Verification and coverage

Activated: systematic-debugging and test-driven-development/writing-good-tests for the confirmed path and RED proof; Supabase and postgres-best-practices for schema/ACL/FK/locking; verification-before-completion for these gates. Read project contract, active E035 context, bounded prior case receipts, source/runtime/canonical schema/ACLs and relevant skill guidance. Controller already fetched current Supabase changelog and RLS docs; no relevant API break. The settled brief supplies the plan; no new design or second implementer. Broad repository security/performance audits, UI changes, deployment, reusable skills, and speculative refactors are outside this bounded repair. Root owns independent review, publication, shared checkpoint and authentic artifacts.

New HTTP-boundary tests execute the real helper and installed client with only fetch stubbed. Before repair: 3 intended failures (two three-request results and wrong endpoint). After repair: 3 PASS. They verify one atomic RPC, exact company/source/actor boundary for Ediel and Support, returned row, and propagated error without fallback writes. The old mock-only status predicate test is replaced by this stronger request contract; existing list tests remain.

The native fixture preserves real GoTrue users, canonical registry Z06/G writer, A/B tenant/customer list assertions, unchanged Support default-list assertions, browser navigation/status and post-browser source/ACK/supply/billing/outbound invariants. B's existing positive status writer now explicitly holds cases.write; the separate reader remains read-only. Added actual disposable assertions cover:

- wrong source/company/actor, nonexistent or absent actor, read-only actor, invalid status and company-A permission with company-B membership;
- real BEFORE INSERT failures at event and audit stages, comparing the complete persisted case/events/audits before/after to prove rollback;
- actual anon and authenticated HTTP event reads/inserts and RPC calls denied, plus catalog RLS state;
- service-role event insertion with wrong case/company/customer combinations rejected by real FKs;
- Support optional-source positive, event shape and canonical audit context;
- platform-member Support positive, actual Ediel-source denial without expectedSource, and removed-membership denial;
- executing this actual forward against populated relation inside a rolled-back transaction, preserving exact rows; removing only the new case-owner FK and assigning an event to another valid customer/company proves restoration rejects incompatible case ownership and does not rewrite it.

Executed using Node22 `/root/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`:

- Focused Vitest: `customer-case-status-transaction`, `customer-case-list-query`, `ediel-case-db-boundary`, `ediel-operational-case-route`, `ediel-operational-case-action`, `operations-support-controltower-phase-5-6`, `ediel-operational-cases-view`: **29 tests/7 files PASS**.
- `tsc --noEmit -p tsconfig.app.json`, `tsconfig.tests.json`, `tsconfig.scripts.json`: PASS. Scripts check repeated after final native fixture additions.
- Affected ESLint: PASS, zero errors/one existing `_customers` unused warning in db.ts.
- Migration integrity: **605 files/509 version groups PASS**, checksums verified.
- Migration provenance: **STATIC_PROVENANCE_PASS**, 512 timestamped files.
- Tenant service-role ratchet: PASS, **2401**, below unchanged2402 baseline.
- `git diff --check`: PASS.
- Generated-type guard: **expected pending FAILURE**, migration tail changed to this forward. Generated types/schema and their manifest were not hand-edited or falsely advanced.

No local Docker/psql is available. New SQL, native negatives, actual protected browser and post-browser state HAVE NOT RUN locally; unit/TypeScript checks do not qualify those gates. No full-suite/build claim for this round. Controller must publish the frozen candidate, obtain independent scoped SPEC/QUALITY review, run ordinary authentic replay/browser, reconcile genuinely generated types/schema, and repeat exact-head gates. Whole E035 remains incomplete. No push, deployment, hosted write, market communication, main or PR310 change by implementer.
