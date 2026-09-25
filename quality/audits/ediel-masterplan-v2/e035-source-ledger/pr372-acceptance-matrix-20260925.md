# PR #372 acceptance and bounded pilot gate — 2026-09-25

Scope: `codex/e035-correction-context-20260924` against `main` at
`2a148d39d631fc759c99cd1c69350b5e2147dbdb`. PR #310 is excluded.
Skill routing: repository `executing-plans`, `acquire-codebase-knowledge`,
`quality-playbook`, `test-driven-development`, `differential-review`,
`supabase`, `supabase-postgres-best-practices`, `verification-before-completion`.
Final independent review is conditional on a frozen diff. UI, performance and
skill authoring are outside this batch. No parallel agent writes.

The last fully checked published head is
`c4a9b754ae22509aea8933ddeeb916a7ae922b1a`, tree
`3bf02ef0f3765b93aac52da1444598e1db17a831`. OPS run `36147085260`
passed clean replay job `108110817739`: five native files, **338/338**, case view, tenant/parity and
schema snapshot `c3ec834faa7c27e3db0f4424a2afcc8205ea4bf17035b8c7d5aba56b4b0bdb37`.
Tenant `36147085097`, browser `36147085072`, Ediel `36147085054` and full
E2E `36147085049` succeeded; production crawler `36147085225` skipped.
Those results are evidence for that head only.

| Acceptance requirement | Existing implementation | Exact evidence | Remaining proof and risk |
| --- | --- | --- | --- |
| Task 3b, prospective transitions from twelve process tables and rollback | `20260924073337_correction_process_facts_v1.sql` installs always-on write/delete and truncate guards; `capture_v1` keeps bounded linkage fields and old/new scope. | Native `scripts/ediel-correction-context-native.test.ts`: catalog, task update/delete/rollback, graph cascade/SET NULL, invoice-test archive both unsigned and signed, legacy contract event, actual case/operation job claim, swallowed event. All in OPS `36144530332` 337/337. | Table/route sampling cannot certify uninstrumented pre-epoch changes. A missing producer can omit a safety-relevant link. Keep `complete:false`. |
| Task 3b, request and point owner history under event volume | `20260925140000`, `20260925150000`, `20260925154500` forwards; `switch_event_subject_v1` uses immutable old/new request and point candidates, unknown IDs wildcard. | Native `scripts/ediel-source-owner-native.test.ts` covers 1,001 unrelated events, distinct point, prior owner after reassignment, deletion of event/request/point at both cutoffs and actual UTILTS; 338/338 OPS `36147085260`, job `108110817739`. Prior behavioral RED `5a4f626b` 336/337, UUID RED `8800d014` 336/337; fixed at `f75b69ea`. | Pre-epoch transitions remain unknowable and `complete:false`. No historic coverage is inferred from a newer receipt. |
| Task 3b, witness, gaps, access and bounds | `20260924080601` and `20260924085942` use post-commit witness, tenant permission, immutable private RLS tables, 1,000 fact and byte bounds. | Native uncommitted witness denial, cross-tenant denial, failed write rollback, 1,001 scoped overflow, saved cutoff and pre-epoch `complete:false` in OPS `36147085260`. | No assigned lawful retention/purge policy for new process archive, readsets and witnesses; existing `edifact_raw_payloads` 1095-day archive, `legal_audit` 3650-day archive and `ediel_polling` 395-day delete do not assign this evidence. A policy and a safe fail-closed purge/archive qualification are needed before broad use. |
| Task 4, same database snapshot and bounded five-owner receipt | `20260924120822` and follow-up combined forwards select source, process, concern, outbound and document owners in one statement; `lib/ediel/sources/combinedCorrectionReadset.ts` validates count, scope, hash, time, tenant and relationships before use. | Native actual Z08H and document attempt, concurrent pre/post commit process/concern cutoff, saved bytes/hash, readset inspection; 338/338 OPS `36147085260`; authentic schema fingerprint above. | One-statement MVCC is established statically and by boundary cases, not an adversarial commit inside acquisition. A newly added actual failed-reader case awaits native CI; retention and all permission/overflow combinations are not exhaustively qualified. Incomplete/invalid owners must continue to hold. |
| Task 4, actual E30/E66/S07 effect | Combined inspector feeds the UTILTS comparison and inbound processor. | Native actual E66 and E30/S07 witnessed-C hold, persisted disposition/CONTRL and zero meter-series effects in OPS `36147085260`. | A new actual failed-reader case awaits native CI. No positive C authority, reopening, or pre-epoch completeness follows. The earlier intermittent Storage `unconfirmed` failed stage was never isolated; six later mutation cases passed, without proving a causal fix. |
| Whole PR and rollout | Draft PR #372, 156 changed files; main unchanged. | Exact-head PR workflows above, no GitHub review approval recorded. | Freeze final diff, independent whole-PR review including R1/R2 and switch ownership, remedy findings, same-head CI and authentic generated contracts. Protected staging, production preflight and pilot GO are separate gates. |

## Pilot preparation (not authorization to execute)

1. Freeze a final SHA and review its full diff. Require all applicable PR jobs,
   native replay, authentic generated types/schema, security/tenant gates and
   independently resolved findings on that same tree. Main/head must still be
   checked before a merge decision.
2. Run the protected `full-e2e.yml` runtime-staging certificate by explicit
   dispatch against an isolated staging tenant with synthetic actors and
   point IDs. Its PR `smoke` and `coverage` jobs do **not** execute
   `runtime-staging`, `real-customer-staging`, `full` or nightly release.
   Read their artifacts and verify outbound is disabled.
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
