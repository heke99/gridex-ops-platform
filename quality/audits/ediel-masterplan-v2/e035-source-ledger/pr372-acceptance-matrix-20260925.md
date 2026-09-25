# PR #372 acceptance and bounded pilot gate — 2026-09-25

Scope: `codex/e035-correction-context-20260924` against `main` at
`2a148d39d631fc759c99cd1c69350b5e2147dbdb`. PR #310 is excluded.
Skill routing: repository `executing-plans`, `acquire-codebase-knowledge`,
`quality-playbook`, `test-driven-development`, `differential-review`,
`supabase`, `supabase-postgres-best-practices`, `verification-before-completion`.
Final independent review is conditional on a frozen diff. UI, performance and
skill authoring are outside this batch. No parallel agent writes.

The last fully checked published head before this batch is
`f1835f4ceb550f4a7ebc2cbf925a2b1b21f4bc97`, tree
`449764cfaeab2e132fbb15866c8b75e0b93ec83f`. OPS run `36144530332`
passed verify `108102263275`, quality/build `108102262765`, and clean replay
`108102263065`: five native files, **337/337**, case view, tenant/parity and
schema snapshot `c3ec834faa7c27e3db0f4424a2afcc8205ea4bf17035b8c7d5aba56b4b0bdb37`.
Tenant `36144530307`, browser `36144530470`, Ediel `36144530398` and full
E2E `36144530308` succeeded; production crawler `36144530353` skipped.
Those results are evidence for that head only.

| Acceptance requirement | Existing implementation | Exact evidence | Remaining proof and risk |
| --- | --- | --- | --- |
| Task 3b, prospective transitions from twelve process tables and rollback | `20260924073337_correction_process_facts_v1.sql` installs always-on write/delete and truncate guards; `capture_v1` keeps bounded linkage fields and old/new scope. | Native `scripts/ediel-correction-context-native.test.ts`: catalog, task update/delete/rollback, graph cascade/SET NULL, invoice-test archive both unsigned and signed, legacy contract event, actual case/operation job claim, swallowed event. All in OPS `36144530332` 337/337. | Table/route sampling cannot certify uninstrumented pre-epoch changes. A missing producer can omit a safety-relevant link. Keep `complete:false`. |
| Task 3b, request and point owner history under event volume | `20260925140000`, `20260925150000`, `20260925154500` forwards; `switch_event_subject_v1` uses immutable old/new request and point candidates, unknown IDs wildcard. | Native `scripts/ediel-source-owner-native.test.ts` covers 1,001 unrelated events, distinct point, prior owner after reassignment and actual UTILTS; 337/337 OPS `36144530332`. Prior behavioral RED `5a4f626b` 336/337, UUID RED `8800d014` 336/337; fixed at `f75b69ea`. | After actual event/request/point deletion with an old cutoff is not separately proven yet. A false exclusion could let a correction bypass a hold; an overbroad wildcard can exhaust budget and hold unnecessarily. This is the next bounded test batch. |
| Task 3b, witness, gaps, access and bounds | `20260924080601` and `20260924085942` use post-commit witness, tenant permission, immutable private RLS tables, 1,000 fact and byte bounds. | Native uncommitted witness denial, cross-tenant denial, failed write rollback, 1,001 scoped overflow, saved cutoff and pre-epoch `complete:false` in OPS `36144530332`. | No assigned lawful retention/purge policy for new process archive, readsets and witnesses; existing policy categories do not establish it. No claim of indefinite lawful storage or full historical completeness. A policy and a safe fail-closed purge/archive qualification are needed before broad use. |
| Task 4, same database snapshot and bounded five-owner receipt | `20260924120822` and follow-up combined forwards select source, process, concern, outbound and document owners in one statement; `lib/ediel/sources/combinedCorrectionReadset.ts` validates count, scope, hash, time, tenant and relationships before use. | Native actual Z08H and document attempt, concurrent pre/post commit process/concern cutoff, saved bytes/hash, readset inspection; 337/337 OPS `36144530332`; authentic schema fingerprint above. | One-statement MVCC is established statically and by boundary cases, not an adversarial commit inside acquisition. Failed-owner/retention and all permission/overflow combinations are not exhaustively qualified. Incomplete/invalid owners must continue to hold. |
| Task 4, actual E30/E66/S07 effect | Combined inspector feeds the UTILTS comparison and inbound processor. | Native actual E66 and E30/S07 witnessed-C hold, persisted disposition/CONTRL and zero meter-series effects in OPS `36144530332`. | No positive C authority, reopening, or pre-epoch completeness follows. The earlier intermittent Storage `unconfirmed` failed stage was never isolated; six later mutation cases passed, without proving a causal fix. |
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
