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
