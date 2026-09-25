# PR #372 acceptance and bounded pilot gate — 2026-09-25

Scope: `codex/e035-correction-context-20260924` against `main` at
`2a148d39d631fc759c99cd1c69350b5e2147dbdb`. PR #310 is excluded.
Skill routing: repository `executing-plans`, `acquire-codebase-knowledge`,
`quality-playbook`, `test-driven-development`, `differential-review`,
`supabase`, `supabase-postgres-best-practices`, `verification-before-completion`.
Final independent review is conditional on a frozen diff. UI, performance and
skill authoring are outside this batch. No parallel agent writes.

The last fully checked published head is
`5ceaf288c592218bccee9b0f66b5a42e6c3ffc1d`, tree
`6cf66a708be932602c56fccc3e6e1bcd146c2326`. OPS run `36148887580`
passed clean replay job `108116835933`: five native files, **339/339**, case view, tenant/parity and
schema snapshot `c3ec834faa7c27e3db0f4424a2afcc8205ea4bf17035b8c7d5aba56b4b0bdb37`.
Tenant `36148887469`, browser `36148887215`, Ediel `36148887290` and full
E2E `36148887634` succeeded; production crawler `36148887432` skipped.
Those results are evidence for that head only.

| Acceptance requirement | Existing implementation | Exact evidence | Remaining proof and risk |
| --- | --- | --- | --- |
| Task 3b, prospective transitions from twelve process tables and rollback | `20260924073337_correction_process_facts_v1.sql` installs always-on write/delete and truncate guards; `capture_v1` keeps bounded linkage fields and old/new scope. | Native `scripts/ediel-correction-context-native.test.ts`: catalog, task update/delete/rollback, graph cascade/SET NULL, invoice-test archive both unsigned and signed, legacy contract event, actual case/operation job claim, swallowed event. All in OPS `36144530332` 337/337. | Table/route sampling cannot certify uninstrumented pre-epoch changes. A missing producer can omit a safety-relevant link. Keep `complete:false`. |
| Task 3b, request and point owner history under event volume | `20260925140000`, `20260925150000`, `20260925154500` forwards; `switch_event_subject_v1` uses immutable old/new request and point candidates, unknown IDs wildcard. New forward `20260925163000` scopes across a distinct incoming request customer using the historical physical point. | Native covers 1,001 unrelated events, distinct point, prior owner after reassignment, deletion of event/request/point at both cutoffs and actual UTILTS; 339/339 OPS `36148887580`. Independent read-only review found the B-request/A-point omission. Test-only head `467a143b` produced actual RED in OPS `36149861401`, job `108120098151`: 339 passed/1 failed, request receipt `[]` instead of `['INSERT']`. Earlier behavioral RED `5a4f626b` and UUID RED `8800d014` were fixed at `f75b69ea`. | Candidate `9b95746f` awaits native GREEN of the cross-customer request/event at old/current cutoffs and regression for 1,001 unrelated B/null-point requests/events. Authentic schema/type artifacts and final review must match the final head. Pre-epoch stays `complete:false`. |
| Task 3b, witness, gaps, access and bounds | `20260924080601` and `20260924085942` use post-commit witness, tenant permission, immutable private RLS tables, 1,000 fact and byte bounds. | Native uncommitted witness denial, cross-tenant denial, failed write rollback, 1,001 scoped overflow, saved cutoff and pre-epoch `complete:false` in OPS `36147085260`. | No assigned lawful retention/purge policy for new process archive, readsets and witnesses; existing `edifact_raw_payloads` 1095-day archive, `legal_audit` 3650-day archive and `ediel_polling` 395-day delete do not assign this evidence. A policy and a safe fail-closed purge/archive qualification are needed before broad use. |
| Task 4, same database snapshot and bounded five-owner receipt | `20260924120822` and follow-up combined forwards select source, process, concern, outbound and document owners in one statement; `lib/ediel/sources/combinedCorrectionReadset.ts` validates count, scope, hash, time, tenant and relationships before use. | Native actual Z08H and document attempt, concurrent pre/post commit process/concern cutoff, saved bytes/hash, readset inspection and failed combined owner RPC; 339/339 OPS `36148887580`; authentic schema fingerprint above. | One-statement MVCC is established statically and by boundary cases, not an adversarial commit inside acquisition. Retention and all permission/overflow combinations are not exhaustively qualified. Incomplete/invalid owners must continue to hold. |
| Task 4, actual E30/E66/S07 effect | Combined inspector feeds the UTILTS comparison and inbound processor. | Native actual E66 and E30/S07 witnessed-C hold, persisted disposition/CONTRL and zero meter-series effects; actual failed combined RPC also saved internal review/none, no APERAK or meter series in OPS `36148887580` (339/339). | No positive C authority, reopening, or pre-epoch completeness follows. The earlier intermittent Storage `unconfirmed` failed stage was never isolated; six later mutation cases passed, without proving a causal fix. |
| Whole PR and rollout | Draft PR #372; main unchanged at the checked base. | Earlier exact-head PR workflows above; no GitHub review approval recorded. | Freeze final diff, independent whole-PR review including R1/R2 and switch ownership, remedy findings, same-head CI and authentic generated contracts. Staging, production preflight and pilot GO are separate gates. |

## Retention inventory and decision gate

| Evidence | Current technical behavior | Missing decision or proof |
| --- | --- | --- |
| Process `epochs`, `facts`, `gaps` | Private RLS tables; UPDATE, DELETE and TRUNCATE blocked by immutable triggers. `epochs.complete` is constrained false. | Assign a lawful retention category and duration for identifiers, statuses and dates. A future archive/purge must leave bounded historical reads incomplete and preserve required dispute evidence. |
| Process `witnesses`, `readsets`, `combined_snapshots` | Private RLS, append-only records; readsets and combined snapshots contain bounded serialized evidence and hashes. | Define separate lifetime and archive treatment for saved receipts and linked witnesses; qualify an expired or unavailable owner as hold-only. |
| Existing general policies and cleanup | `edifact_raw_payloads` is 1095-day archive, `legal_audit` 3650-day archive, `ediel_polling` 395-day delete. `gridex_run_launch_retention_cleanup` handles API, webhook, billing-provider and mail logs, not these process tables. | Neither an existing category nor the cleanup job assigns process evidence. Do not use telemetry deletion or silently retain it indefinitely. Business/legal owner must choose the policy before broad production data enters this ledger. |

The technical archive currently resists direct deletion, so an accidental
cleanup does not silently turn a complete receipt into false authority. That
is not a lawful retention decision or a tested archival recovery path.

## Pilot preparation (not authorization to execute)

1. Freeze a final SHA and review its full diff. Require all applicable PR jobs,
   native replay, authentic generated types/schema, security/tenant gates and
   independently resolved findings on that same tree. Main/head must still be
   checked before a merge decision.
2. Run `full-e2e.yml` `mode=runtime` by explicit dispatch against isolated
   staging credentials. The runtime job creates synthetic tenants and exercises
   invitation/contract lifecycle, with `GRIDEX_E2E_ALLOW_OUTBOUND=NO`; it
   does **not** exercise E035 correction receipt or UTILTS hold. Qualify those
   separately with synthetic point/request/message identities, disabled market
   routing and exact saved receipt/ACK/zero-series assertions. PR `smoke` and
   `coverage` do **not** execute `runtime-staging`, `real-customer-staging`,
   `full` or nightly release. Read artifacts before the pilot decision.
3. Assess deployment coupling before merge: `.github/workflows/vercel-production-deploy.yml`
   starts on every push to `main` and creates a Vercel production deployment
   when `VERCEL_TOKEN` is present. Thus merge is a possible production action.
   Protected `production-certification-e2e.yml` is separate manual dispatch.
4. First production qualification: explicit synthetic tenant/actor and a
   nonmarket test identity only, with outbound, billing, meter ingestion and
   real customer processing disabled. Observe saved five-owner receipt,
   `complete:false`, internal hold, CONTRL behavior, zero meter-series writes,
   tenant audit and error rate. Record identifiers and before/after counts
   without secrets or customer payloads. No live market/customer send.
5. Stop on an unexpected send, meter series, cross-tenant read, non-hold on
   incomplete evidence, or unexplained unconfirmed outcome. Disable pilot
   routing and workers, preserve evidence, revert deployment to the last
   accepted main deployment. Forward database migrations require a separate
   recovery plan; do not assume down migrations.

**Current verdict: NO-GO** for production pilot or merge. The history/retention
matrix, independent final review and protected runtime-stage evidence remain
open. This verdict remains until each gate is documented against one frozen
head, not merely a green PR smoke run.
