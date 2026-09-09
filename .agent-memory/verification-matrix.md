# Verification matrix — PHASE-43

## PR #149 production closure — 2026-08-15

| Check | Result | Evidence |
|---|---|---|
| Generated Supabase types lock | PASS local | 2,704,161 bytes; SHA `f8178706...`; tip `20260815170500` |
| Migration governance | PASS local | 450 files / 354 version groups; checksums verified |
| Ediel supplier/ESCO isolation | PASS | role unit tests + explicit AGT/TGT runtime identity |
| CI verify command chain | PASS local | migrations, tenant/API, Ediel transaction, hardening, audit |
| Quality release chain | PASS checkpoint | lint 0 errors; 87 files / 623 tests; OpenAPI/RBAC; production build |
| Tenant website/contracts/API/mail | PASS | idempotency, canonical onboarding, publication, legal snapshot, scopes |
| Test/production + two-tenant routing | PASS | separation, route materialization and isolation regressions |
| Production dependency audit | PASS | 0 vulnerabilities |
| Hosted clean empty-DB replay | PENDING | requires pushed final PR commit |
| Merge/deploy/post-deploy smoke | PENDING | gated on hosted CI |
| New privileged RPC exposure | FIXED, REVERIFY | forward migration `20260815210353` restricts restoration/integrity RPCs to `service_role` |

| Area | Status | Evidence |
|---|---|---|
| API/OpenAPI/docs version | PASS | Canonical contract remains `2026-08-04.2` |
| SVK source/layer mapping | PASS | Current FeatureServer, layer 3, four exact canonical fields |
| Import source isolation | PASS static | Old source is failed; mixed source/layer resume rejected |
| Import diagnostics | PASS static/live | Structured errors plus BRL/SE3 rollback parser proof |
| Migration integrity | PASS | 366 files / 270 groups; checksums verified |
| Live database apply | PASS | Ledger versions `20260804190000` and `20260804193000` |
| DB billing area guard | PASS | Rollback E2E canonicalized SE3 and rejected SE4 |
| Snapshot tenant guard | PASS | Nonexistent trigger field removed; contract ownership enforced |
| Underlay area propagation | PASS static | Header/items use immutable snapshot area |
| Snapshot identity checks | PASS static | Missing and cross-contract snapshot blockers |
| Existing billing backfill | N/A | Zero contracts/snapshots/underlays in connected dev project |
| Changed TS/TSX syntax | PASS | TypeScript transpile syntax diagnostics: zero |
| Full npm gates | BLOCKED | Dependencies absent; registry DNS returned `EAI_AGAIN` |
| Full official SVK import | PENDING | Requires updated deployed code/cron; active rows currently zero |
| Quote-to-invoice E2E | PENDING | Requires deployed app and real test data |

## PHASE-44 — 2026-08-05T15:14:58+02:00

| Check | Result | Evidence |
|---|---|---|
| Three-document grouping | PASS | customer legal package regression |
| Grouped acceptance -> exact module rows | PASS | static regression and source inspection |
| POA exact scope/legal identity | PASS | website/platform POA regressions |
| Tenant snapshot historical rendering | PASS | legal package regression |
| API/OpenAPI 2026-08-05.1 | PASS | version, compatibility, examples, runtime and release gates |
| Changed TS/TSX syntax | PASS | TypeScript 5.8.3 transpile, 17 files |
| Full dependency gates | BLOCKED | package mirror 404 |
| Live private/business E2E | PENDING | deployment required |

| 2026-08-05T15:20:07+02:00 | Customer Portal grouped/legacy prevalidation and signed-event fail-closed guard | PASS | `gridex-customer-legal-package-regression.cjs` |

## PHASE-45 — 2026-08-06T08:50:00Z

| Check | Result | Evidence |
|---|---|---|
| Quote timestamptz + grid-area integrity | PASS | quote null-grid-area and website quote integrity regressions |
| OpenAPI immutable release verify | PASS | `verify-openapi-release.cjs` local |
| Market-price/quote required examples | PASS | documentation examples + integrity regression |
| Application/metering-point area normalizers | PASS | explicit-input preservation regression |
| API version/compatibility/runtime | PASS | documentation version, compatibility, public-contract runtime |
| Full dependency gates | BLOCKED | `node_modules` absent |
| Live quote create/validate | PENDING | deployment required |

## PHASE-45 follow-on — 2026-08-06T08:58:00Z (`6531`)

| Check | Result | Evidence |
|---|---|---|
| Quote price_area case integrity | PASS | website quote integrity regression assertions |
| AI/BI grid-area case normalize | PASS | `gridex:aibi-grid-area-case-regression` |
| Prior PHASE-45 package on tip | PASS | merge of `ec6b` + regressions above |
| Full dependency gates | BLOCKED | `node_modules` absent |
| Live quote create/validate | PENDING | deployment required |

## PHASE-45 after BL-002 — 2026-08-06T12:57:00Z (`fb8e`)

| Check | Result | Evidence |
|---|---|---|
| Merge health package onto main+BL-002 | PASS | merge commit of `6531` |
| Billing/public/portfolio price-area case | PASS | `gridex:price-area-case-normalization-regression` |
| Quote/AI-BI/OpenAPI package still green | PASS | quote-null, website-quote-integrity, aibi, api:release:verify, docs, compatibility, explicit-input |
| Residual BL-002 RLS variants | OPEN | documented as O-005..O-008; no second overlapping migration |
| Full dependency gates | BLOCKED | `node_modules` absent |
| Live quote create/validate | PENDING | deployment required |

## POST-#110 health residuals — 2026-08-11

| Check | Result | Evidence |
|---|---|---|
| auth-outage vitest | PASS 12/12 | `__tests__/auth-outage-cron-production-safety.test.ts` |
| post-108 residuals regression | PASS | `gridex-ops-post-108-health-residuals-regression.cjs` |
| migration versions | PASS | `check-migration-versions.cjs` |
| generated types tip | PASS | pinned to `20260811114500` |
| app typecheck | PASS | `tsc -p tsconfig.app.json` |
| ggshield | BLOCKED | CLI not installed |

## EDIEL production-engine delta — 2026-08-13

| Check | Result | Evidence |
|---|---|---|
| Canonical S02/S03/S04 registry | PASS LIVE | 33 resolved rules/profile: 13 header + 20 transaction |
| R/D/O/X runtime mapping | PASS | Targeted Vitest; X maps to forbidden |
| Partial-success persistence | PASS LIVE | Rolled-back RPC E2E, idempotency, correction lineage, immutability |
| Tenant/RLS/RPC ACL | PASS LIVE | RLS on 3 tables; anon/authenticated false, service_role true |
| Supabase advisors | PASS DELTA | No new security warning or unindexed FK |
| Migration integrity/types | PASS | 426 files / 330 groups before publication |
| Typecheck/lint/build | PASS | 0 lint errors; Next.js production build complete |
| Full and quality Vitest | PASS | Full suite + quality suite |
| API/RBAC gates | PASS | Docs, compatibility, release and 24-check RBAC audit |
| Hosted CI/Vercel | PENDING | Publish/CI/deploy step remains |
| Official operation/request matrices, 511 tuples, TGT/AGT | BLOCKED EXTERNAL | Source/evidence absent; no invented values |

## POST-f2c6a729 health residuals — 2026-08-13 (`a029`)

| Check | Result | Evidence |
|---|---|---|
| auth-outage + UTILTS disposition/persistence vitest | PASS 35/35 | targeted vitest suites |
| post-332 field-511 residuals regression | PASS | includes nullable Returns lock |
| ops health regression | PASS | `gridex-ops-health-regression.cjs` |
| post-108 residuals regression | PASS | tip types pin advanced |
| UTILTS reason regression | PASS | `ediel:utilts-reason-regression` |
| migration integrity | PASS | `db:migrations:integrity` (428 files / 332 groups) |
| generated types tip | PASS | pin `20260813221500` + sha `2111c2c6...` |
| app typecheck | PASS | `tsc -p tsconfig.app.json` |
| ggshield | BLOCKED | CLI not installed |
| hosted CI | PENDING | PR publish required |

## POST-2eb61986 health residuals — 2026-08-13 (`0a00`)

| Check | Result | Evidence |
|---|---|---|
| auth-outage + UTILTS disposition/persistence vitest | PASS 43/43 | includes sibling flash + base URL + override pins |
| post-332 field-511 residuals regression | PASS | includes nullable Returns lock |
| ops health regression | PASS | `gridex-ops-health-regression.cjs` |
| UTILTS reason regression | PASS | `ediel:utilts-reason-regression` |
| migration integrity | PASS | 428 files / 332 groups |
| generated types tip | PASS | pin `20260813221500` + sha `2111c2c6...` |
| production npm audit | PASS | 0 vulnerabilities (`--omit=dev --audit-level=high`) |
| app typecheck | PASS | `tsc -p tsconfig.app.json` |
| ggshield | BLOCKED | CLI not installed |
| hosted CI | PASS | `#123` merged as `3cad481b` |

## POST-3cad481b health residuals — 2026-08-13 (`13b2`)

| Check | Result | Evidence |
|---|---|---|
| auth-outage + UTILTS disposition/persistence vitest | PASS 50/50 | public/portal flash, account_disabled reason, unified next-path, UTILTS match synthesize |
| post-332 field-511 residuals regression | PASS | nullable Returns + durable override/CI/flash/UTILTS tip locks |
| ops health regression | PASS | `gridex-ops-health-regression.cjs` |
| UTILTS reason regression | PASS | `ediel:utilts-reason-regression` |
| generated types tip | PASS | pin `20260813221500` + sha `2111c2c6...` + nullability override |
| production npm audit | PASS | 0 vulnerabilities |
| app typecheck | PASS | `tsc -p tsconfig.app.json` |
| ggshield | BLOCKED | CLI not installed |
| hosted CI | PENDING | PR publish required |

## 2026-08-14 — post-#134 tip residuals on b4c7

| Check | Result |
|---|---|
| vitest (circuit/UTILTS/lifecycle/go-live/RLS UI) | PASS 51/51 |
| gridex:post-332-field-511-health-residuals-regression | PASS |
| db:migrations:check | PASS 433 |
| security:audit-production | PASS 0 |
| tsc -p tsconfig.app.json | PASS |
| hosted CI | NOT YET |
| ggshield | BLOCKED |

## 2026-08-14 — post-#135 tip residuals on 9740

| Check | Result |
|---|---|
| vitest (go-live/lifecycle/circuit/RLS UI) | PASS 34/34 |
| db:migrations:integrity | PASS 434 |
| security:audit-production | PASS 0 |
| tsc -p tsconfig.app.json | PASS |
| hosted CI | NOT YET |
| ggshield | BLOCKED |

## 2026-08-14 — post-#143 tip residuals on 996c

| Check | Result |
|---|---|
| vitest (post-139 + post-143 inbound residuals) | PASS 4/4 |
| db:migrations:integrity | PASS 437 |
| db:types:check | PASS |
| security:audit-production | PASS 0 |
| tsc -p tsconfig.app.json | PASS |
| hosted CI | NOT YET |
| ggshield | BLOCKED |

## 2026-08-14 — post-#144 tip residuals on e76c

| Check | Result |
|---|---|
| vitest (post-139 + post-143 + post-144 inbound residuals) | PASS 6/6 |
| db:migrations:integrity | PASS 438 |
| db:types:check | PASS |
| security:audit-production | PASS 0 |
| tsc -p tsconfig.app.json | PASS |
| hosted CI | NOT YET |
| ggshield | BLOCKED |

## 2026-09-02 tenant isolation remediation

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Unit and regression tests | `npx vitest run` | 169 files / 1066 tests pass |
| Migration integrity | `npm run db:migrations:integrity` | pass, 558 files / 462 groups |
| Tenant invariants (live schema) | `npm run tenant:invariants` | all checks pass |
| Service-role ratchet | `npm run tenant:service-role-ratchet` | 2401 call sites, at baseline |
| Cross-tenant metering point / customer number | rolled-back transaction on dev | two tenants can hold both; duplicates within a tenant still rejected |
| Permission scope | `gridex_get_user_permissions_in_company` on dev | tenant owner: 36 perms own company, 0 foreign |

## 2026-09-04 — P0-C database parity and canonical schema artifacts

Environment: local PostgreSQL 16.13 cluster started for this session at
`/var/lib/postgresql/gridex-parity`, port 55432, trust auth. Not part of the
repository and not persisted. Supabase CLI absent, so clean replay was not
runnable locally.

| Check | Command | Outcome |
| --- | --- | --- |
| Parity, identical schemas | `gridex-db-parity.cjs --mode blocking` | PASS, exit 0, no false positives |
| Parity, injected drift | `gridex-db-parity.cjs --mode blocking` | FAIL as required, exit 1, 15 drift classes each detected |
| Parity modes | `--mode report-only / warning / blocking` | exit 0 / 0 / 1 |
| Parity ignore contract | entry without `reason` | exit 2, rejected |
| Parity ignore contract | valid entry | suppresses only its own finding, printed as ignored |
| Parity error paths | missing URL, non-postgres URL, unreachable server, SQL in schema name | exit 2 in every case, no comparison run |
| Parity self-test | `npm run db:parity:selftest -- <url>` | PASS, all 15 classes, both databases dropped afterwards |
| Snapshot determinism | two writes from one database | byte-identical `schema.sql` and fingerprint |
| Snapshot check, matching | `db:schema:check` vs own baseline | PASS, exit 0 |
| Snapshot check, drifted | `db:schema:check` vs drifted database | FAIL, exit 1, drifted sections named individually |
| Snapshot check, no baseline | `db:schema:check` with empty dir | exit 2, fail-closed |
| Generated types | `npm run db:types:check` | PASS, 3339422 bytes, tail `20260904103000_z01_sla_watchdog_candidate_convergence.sql` |
| Migration suite | `npm run db:migrations:check` | PASS, integrity 584 files / 488 version groups, legal, contract hardening, types |
| Workflow syntax | YAML re-parse of `ops-hardening.yml` | PASS, jobs unchanged |
| Clean replay | — | NOT RUN, Supabase CLI unavailable in container |
| Production parity | — | BLOCKED, no production Supabase project visible |

Drift classes proven detected: dropped relation, unexpected live relation,
column type, nullability, column default, dropped unique constraint, dropped
foreign key, dropped partial index, disabled RLS, rewritten policy USING
expression, dropped trigger, changed function body, changed function overload
signature, revoked grant, added enum label, and a view whose tenant filter was
silently removed.

## 2026-09-04 (continued) — dockerless replay, tenant invariants, CI gate reliability

Environment: local PostgreSQL 16.13 (port 55432) and 17.11 (port 55433)
clusters, both started for this session and not persisted. PostGIS installed
via apt; Supabase CLI 2.101.0 installed at `/opt/supabase-cli`. No Docker, so
`supabase start` and `supabase gen types` cannot run here.

| Check | Command | Outcome |
| --- | --- | --- |
| Clean replay, PG 16 | `GRIDEX_REPLAY_DB_URL=... clean-replay.sh` | 565 inputs applied, no SQL error |
| Clean replay, PG 17 | same | 565 inputs applied, no SQL error |
| Shadow vs CI-verified types | 587 objects compared | every object present, every column set identical |
| Narrow fingerprint vs pinned | replay script | MISMATCH; CI is green on main, so the harness differs, not the constant |
| Tenant invariants, before fix | `npm run tenant:invariants` on shadow | FAIL, 21 breaches |
| Tenant invariants, after fix | same | PASS, all checks passed |
| Ledger irrelevance | `db:parity` with-ledger vs no-ledger shadow | PASS, identical across every object kind |
| Provenance regression | `gridex-aud-003-migration-provenance-regression.cjs` | PASS after removing ledger writes |
| Migration integrity | `npm run db:migrations:check` | PASS, 585 files / 489 version groups |
| Generated types manifest | included above | PASS, tail bumped, hash unchanged |
| Dependency audit, reachable | `npm run security:audit-production` | PASS, retried once after a timeout |
| Dependency audit, unreachable | dead registry | exit 1, states it is not a vulnerability finding |
| Dependency audit, high advisories | stubbed report | exit 1, lists offending severities |
| Dependency audit, low only at level high | stubbed report | exit 0 |
| Dependency audit, unknown level | `GRIDEX_AUDIT_LEVEL=bogus` | exit 2 |
| Typecheck | `npm run typecheck` | PASS |
| Service-role ratchet | `npm run tenant:service-role-ratchet` | PASS, 2399 call sites |
| Agent memory git state | `check-agent-memory-git-state.cjs` | PASS |
| OPS health / contract channel / API billing | respective regressions | PASS |
| CI on this branch | — | NOT RUN; ops-hardening triggers on pull_request and push:main only |
| CI on main `62272e9` | run 2450 | clean-migration-replay success, quality-release-gates success, verify FAILURE at security:audit-production (npm registry 503) |

Full local gate battery re-run after all changes, every one exit 0:
`ops:hardening-regression`, `ops:hardening-behavior-regression`, `lint`,
`typecheck`, `typecheck:scripts`, `typecheck:tests`,
`quality/mechanical/verify.sh`, `npm test`, `api:docs`, `security:rbac`,
`db:migrations:check`, `tenant:service-role-ratchet`,
`security:audit-production`, provenance regression, agent-memory git state,
ops health, contract channel publication, API billing tenant hardening.

## 2026-09-04 — CI evidence on PR #307

| Head | verify | quality-release-gates | clean-migration-replay |
| --- | --- | --- | --- |
| ba0d323 | pass | pass | FAIL: 3 SECURITY DEFINER fns still executable by anon |
| cdcb64a | pass | pass | FAIL: same |
| b0098d8 | pass | pass | FAIL: pg_dump server version mismatch |
| 3330127 | pass | pass | pass |
| 46b77d2 | pass | pass | pass, `db:schema:check` ACTIVE and verifying `3b0dd50e...` |
| 298e67b | pass | pass | pass |

Gates proven inside the real Supabase stack: clean replay, pinned ledger (48
rows), narrow fingerprint `c70fa2f...`, tenant isolation invariants, parity
self-test (15 drift classes), schema snapshot generation, and the canonical
baseline comparison.

Two CI failures were real defects this branch introduced and fixed, not flakes:
a revoke from PUBLIC that did not remove Supabase's default-privilege grant to
anon, and a pg_dump older than the pinned PostgreSQL 17 server.


## 2026-09-05 — active parity remediation

Status: IN_PROGRESS. No phase closed. Branch codex/gridex-parity-remediation-20260905.
Inventory manifest divergence and unsafe replay cleanup fixed with red/green
regressions, wired into OPS hardening. Production catalog read only; no live
mutations. See quality/audits/MASTER_PRODUCTION_REMEDIATION_STATE.md for baseline,
findings, tests and exact next work. Publish reviewable fixes and verify hosted CI;
then exhaustive replay accounting and forward canonical reconstruction.
Prior claims of unavailable production project or completed schema phases are
superseded by current catalog access and unresolved two-way parity.

2026-09-05 publication update: implementation 49c9b2a4 committed locally; automatic review rejected branch push (payload authorization/destination trust). No workaround attempted. Request approval for the concrete branch push before hosted CI. Typecheck and focused domain 7 files/22 tests PASS locally. Production parity remains open.


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

Parity semantics: 26 isolated catalog checks PASS; expanded schema fingerprint requires authoritative recapture. Replay recovery: 14 tests PASS; no stop on preflight failure. Ownership of a pre-existing local stack after reaching startup remains unresolved; do not call this a fully isolated replay.


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

Publication review completed: 28 accounting tests, 14 recovery tests, portal SQL
and invitation SQL (18 assertions plus two rollback scenarios) pass on the current
worktree. Operational DB2B classification has its missing evidence report restored
after direct source/body review. Actual accounting: 587 inputs, 497 full selected,
31 partial, 4 exclusions, 55 unknown. Full-effects exit remains 1. The planned
batch publication is now superseded by the verified code-head checkpoint
above; continue the Ediel source review. No phase is closed.

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

## 2026-09-08 — Grouped remediation tooling, scoped evidence

Published revision 1824d69d8b31be97096dd0eecaf7fd719db40970 exactly matches
reviewed tree 1adff2d73489a416eebe8aec92fa084fb90e8162. OPS run 34198005843:
auth group job 101969998315 PASS (all six PostgreSQL 17 commands), Ediel job
101969997965 PASS, quality job 101969998228 PASS. Verify job 101969998320 passed
new mapper/status checks (15 mapper and 29 accounting tests), then failed types
tail 20260907121951; replay job 101969998208 FAIL, with full-effects accounting
still unresolved. Six historical status files preserved byte-for-byte; one
authoritative current status established. No production writes, migration
selection changes or phase closure. Scoped tooling/fixture evidence only.

## 2026-09-08 — RBAC characterization, code d32a3457

OPS34227210022: auth102064145147 PASS on PG17.11, seven fixed commands;
three complete RBAC originals twice, expected missing-view scenario and invalid
CHECK transaction rollback PASS. Ediel102064144786 and quality102064145173 PASS.
Verify102064144999 FAIL at generated-types tail20260907121951;
clean replay102064145219 FAIL, global unresolved77 unchanged. Review corrected
missing user_status prerequisite before publication; final review clean. Exact
published/reviewed tree b3e4de5bccd3b1472ad9c23888f844307c60e135. No production
writes or phase closure. Next: actual canonical-prefix restoration/effect review.

2026-09-08 read-only Vercel check: Gridex project and production deployment dpl_6qevcw57wT7X2p5yd5rQA7hzRq8c remain READY at app.gridex.se, SHA eb9a25bc989c6de808903f41c2314d5465e9c07b. No runtime-to-database binding or fresh database parity established. Supabase project access is scoped separately and currently excludes the intended Gridex project.

Follow-up: intended Supabase project access restored. Catalog-only role helper body MD5 d76c8c4ae10c4f36b772b86255f728ba matches core01; SECURITY INVOKER, search_path public/auth/extensions, authenticated/service_role EXECUTE and anon denied match selected launch-linter hardening. Fresh ledger read remains279/latest20260904222450. No production writes; no full parity or runtime/database binding proof.

2026-09-09 — RBAC prefix fix 399271d4: all four source-confirmed review findings corrected locally; prefix selection, group/status regression, provenance, 29 accounting tests and integrity589/493 pass. Scoped re-review and hostedPG17 pending; no production write or phase closure.

2026-09-09 — Published8750a5b9 exact reviewed tree5a1fd7e0. OPS34343823950: Ediel102440584673 and quality102440584712 PASS; auth102440584698 fails invitation adjacency before prefix; verify102440584657 generated-types tail20260908120000; clean102440584460 fails before replay. Fix round2 corrects placement and adds actual invitation selection coverage. No production write or phase closure.

2026-09-09 — Bounded RBAC prefix VERIFIED on published01e31ed8: OPS34344515597 auth102442823593 all9commands PASS, including actual selected prefix, repeated complete sources and preserved final helper. Ediel102442823708 PASS. Full replay/types/ledger/live parity and phase closure remain open. Next source20260519_saas_ui_tenant_admin stays SUBSTITUTED while statement/effect review starts.

2026-09-09 — SaaS Task2 locala1d807e3 restores complete source after role-permission uniqueness and invitation-status index reconstructions, matching observed intended/live definitions. Exact reference preservation and stable canonical repeats; legacy behavior separately labeled. Static selection/emit, ten-command runner/status, accounting29, integrity591/495, provenance and immutable-history checks PASS. Separate/integrated review and hostedSQL pending. Systemwide PK/FK/index/deletion gates remain open; no production changes.

2026-09-09 — Publishedfac58fae bounded SaaS/integrity VERIFIED: OPS34348338877 auth102455180423 alltencommands PASS, actualSaaSprefix/stable repeats/platformcleanup, eight reducedbranches, five uniqueness and fiveindex repair cases including rollback. Ediel102455180529 PASS. Full replay/types/ledger/live parity, remaining NOTNULL/FK gaps and systemwide deletion/index/identity gates remain open.

2026-09-09 identity evidence c0b661a9: document whitespace check passed; separate scoped re-review spec/quality approved after two Important fixes. No SQL executed for upcoming mandatory-reference repair. Fresh catalog-only dependency and Vercel/GitHub metadata observations do not establish runtime binding or parity.

2026-09-09 implementation cb49b468: mandatory-reference repair and61 reduced identity cases authored. Accounting29, selection/emit, runner/status, provenance75/49/20/4/499 and integrity592/496 PASS; immutable historical checksums preserved. SQL NOT EXECUTED locally (psql absent); task/integrated review and hosted PG17 pending. No FK action or parent-retention policy change.

2026-09-09 hosted4d851ee8 OPS34353344277: auth102471757824 FAIL after actual selected SaaS prefix+50 reduced identity PASS incl rollback/timeout. owner_copy_clean enforcement multirow UPDATE produced23505 before expected23503. Scoped fixture correction3f861459 separately approved; SQL rerun pending. Ediel102471758172/quality102471758274 PASS; verify102471758262 types tail20260909120200 FAIL; clean102471758154 FAIL before full replay. No phase closure.

2026-09-09 Hosted5fb7fc74 OPS34354458938: auth102475481933 PASS all ten commands/61 identity cases; Ediel102475482183 and quality102475482179 PASS. Verify102475482295 types tail20260909120200 FAIL; clean102475482328 beforefullreplay FAIL. Full-effects accounting73 unresolved; generated/live/ledger parity open.

2026-09-09 Catalog-only all-public-table PK presence: connected piidsfebjqjmnepdpnas has502 ordinary/partitioned public tables,502 with PK,0 without. No rows read. Key suitability, consumer consistency and runtime binding remain unverified; no phase closure.

2026-09-09 Catalog-only public constraint flags:1237 FKs/781 checks,0 unvalidated in either class on connected project. Existing validation flags only; relation completeness and lifecycle correctness remain open. No row reads or SQL mutation.

2026-09-09 Catalog-only index flags:2932 public indexes,502 primary/489 other unique,0 not-valid/not-ready/not-live. Availability flags only; workload coverage/redundancy/performance unverified. No index mutation.

2026-09-09 Governance implementation670c8a4c static PASS: selection/emit,11-command runner/status/isolation, actual RBAC prefix32, accounting29, provenance76/49/20/4/499, integrity592/496. Accounting516/26/46/4; focused274/23/37/4. All new SQL NOT EXECUTED; task/integrated review and hosted PG17 pending. HistoricalSQL/checksums intact.

2026-09-09 Hostedb9afbf68 OPS34359949888: auth102494069650 PASS11 commands incl15 governance lanes/61 identity; Ediel102494069894 PASS. Verify102494069367 FAIL types tail20260909120200; clean102494069531 FAIL beforefullreplay. Quality102494069708 app build still running. No incomplete artifact regeneration/phase closure.

2026-09-09 Final quality receipt atb9afbf68: OPS34359949888 quality102494069708 PASS incl app build/release-quality checks. Auth and Ediel already PASS; verify/types and clean full-replay still FAIL. Root status/runner covering test PASS after final SQL receipt update.

2026-09-09 Bounded sync/import catalog persisted:3 connected tables,19 columns each,RLS enabled; exact column/PK/FK/check/index metadata only. Import-row single SETNULL/composite CASCADE coexistence and sync composite SETNULL attribution retained as lifecycle review evidence; no row reads/deletion or outcome claim.

2026-09-09 Operations implementation66659b22 static PASS: exact source selection/emit, actual RBAC prefix33, fixed runner12/status, clean-replay14/accounting29 selftests, integrity592/496, provenance77/49/20/4/499. Global517/26/45/4; focused274/23/37/4. SQL NOT EXECUTED; separate review pending, then integrated review and hosted PG17. No runtime/phase closure.

2026-09-09 Task4 separate review approved66659b22, no findings; SQL NOT EXECUTED. Root status/runner covering test PASS after current-state update. Integrated review and hosted verification pending.

2026-09-09 Hostedaad37fc1 OPS34369156972: auth102525577327 PASS12 commands/61 identity cases and complete operations actual31-prefix,19 targets/28 indexes/journal/row preservation/repeat, late42703, real55P03, five reduced lanes; Ediel102525578011 PASS. Verify102525577998 FAIL types tail20260909120200; clean102525577832 FAIL beforefullreplay; quality102525577677 build pending. No phase closure.

2026-09-09 Final quality102525577677 PASS at aad37fc1:195 test files/1162 tests, app build, release-quality and bundle gates. No measured production-performance claim; verify/types and full-replay gates remain open.

2026-09-09 Other aad37fc1 CI: tenant-integrity34369156960 PASS; browser-public102525578646 PASS4 tests. FullE2E34369156957 smoke10252560080114/15 checks, sole failure generated-types tail20260909120200; PR certificate102526196220 fails on smoke dependency. Full/staging/production certification skipped, not passed. Job logs inspected; no additional runtime claim.

2026-09-09 Task6 implementation20a54995 static PASS: token/operations/governance/RBAC selection+emit, runner13/status, integrity593/497, provenance78/49/20/4/500, replay14/accounting29/group15 selftests.593 inputs518/26/45/4, focused339:275/23/37/4. SQL NOT EXECUTED; independent review pending.

2026-09-09 Task6 fix760f472e: full relation-shape admission repeated under lock; independent scoped re-review confirms finding addressed, no new breakage. Selection RED/GREEN, emit, integrity593/497 and diff checks PASS. All SQL NOT EXECUTED; integrated and hosted gates pending.

2026-09-09 Hosted17da3243 OPS34373283798: auth102539602494 PASS13 commands incl token empty/8 populated/20 dirty/rollback/real locks/both writer orders;6 later-runtime compatibility lanes retain final mandatory FAIL as required. Ediel102539600728 PASS; verify102539599786 types tail20260909123000 FAIL; clean102539599407 beforefullreplay FAIL; quality102539600224 build pending. No phase closure.

2026-09-09 Final quality102539600224 PASS at17da3243: app build,195 test files/1162 tests, release-quality/bundle checks. No measured production-performance claim. Task6 bounded verification complete; replay/types/ledger/runtime parity and phase gates remain open.

2026-09-09 Other17da3243 CI logs inspected: tenant-integrity102539601083 PASS, browser-public102539601127 PASS4 tests; smoke10253960000314/15 checks, sole generated-types tail20260909123000 failure; certificate102540129920 fails smoke dependency. Staging/full/production certificates skipped, not verified.

2026-09-09 Task7e0c4dffb (45096a65/502531e9/e0c4dffb) static PASS selection/emit/emit-checker, runner14/status, integrity593/497, provenance78/49/20/4/500 and diff.50 dirty cases authored; SQL NOT EXECUTED. relation_changed/inspection_error lack dedicated injected fixtures. Independent review pending; accounting unchanged.

2026-09-09 Task7 fixfad36a42: both Important seed-admission findings and Minor legacy-column comment resolved; independent scoped review approved, no new breakage. Four isolated cases added (54 total). Selection/emit/emit-checker and runner14/status PASS; SQL NOT EXECUTED. Integrated and hosted gates pending; no phase closure.

2026-09-09 Task7 integrated fix6511c457: roles/permissions standalone unique indexes and unreviewed metadata FKs now block. Four checker-only fixtures added (58 total). Independent integrated scoped review approved, no new Critical/Important findings. Selection/emit/emit-checker, runner14/status and diff PASS; all new SQL NOT EXECUTED. Pending exact-tree confirmation and hosted run; no phase closure.

2026-09-09 Task7 publication blocked: exact reviewed HEAD6e3c3046/tree81a9eb4e ready, but GitHub connector get_pr_info/fetch_commit repeatedly -32001 Unknown tool. Plugin metadata installed/enabled. Direct ls-remote expected17da3243; non-force push exit128 missing GitHub username authentication. No connector write reached, no successful push or new hosted run. Supabase remains working. Preserve exact reviewed payload; Task7 SQL NOT EXECUTED, Task8 depends on hosted PASS, no phase closure.

2026-09-09 Continuation: GitHub restored; exact reviewed tree81a9eb4e published as1b37fe86. OPS34408542348 auth102657264584 passes13 prior commands then Task7 fails boolean<>regclass SQL composition; correction active, no new SQL acceptance. Ediel PASS; verify types tail and clean full-effects remain red. Fresh Vercel production/maineb9a25bc and connected Supabase ledger279/tail20260904222450 verified; runtime DB binding unproven. No merge/deploy/production mutation.

2026-09-09 Task7 source correction5ecefd1f: explicit grouped boolean predicates, focused static RED/GREEN,4 truth cases; selection/runner/integrity/provenance/accounting unchanged. Separate review pending; new hosted SQL unexecuted. OPS34408542348 quality completed PASS195 files/1162 tests plus45 quality tests/build. Hosted replay artifact10126300748 confirms45 unclassified+26 substituted=71 unresolved, no schema/type artifact.
