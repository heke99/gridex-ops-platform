# PR #372 acceptance and bounded pilot gate — 2026-09-25

Scope: `codex/e035-correction-context-20260924` against `main` at
`2a148d39d631fc759c99cd1c69350b5e2147dbdb`. PR #310 is excluded.
Skill routing: repository `executing-plans`, `acquire-codebase-knowledge`,
`quality-playbook`, `test-driven-development`, `differential-review`,
`supabase`, `supabase-postgres-best-practices`, `verification-before-completion`.
Final independent review is conditional on a frozen diff. UI, performance and
skill authoring are outside this batch. No parallel agent writes.

The last fully checked published code head is
`9b95746f89f47eb74a266371d26e34d339454b85`, tree
`514944425f549a5a53ff1a076bb346b0056dd493`. OPS `36150994331`
passed verify `108123918788`, quality `108123918375`, and clean replay
`108123918736`: five native files, **340/340**. Tenant `36150994491`, browser
`36150994326`, Ediel `36150994442` and full E2E `36150994370` succeeded;
crawler `36150994333` skipped. Clean replay artifact `10872180562` was
downloaded: generated types SHA-256
`36e989375ef5313e506a04f7d6e79b4058316ed0f39eb7d9530658fa1cbbed6d`
and schema snapshot fingerprint
`c3ec834faa7c27e3db0f4424a2afcc8205ea4bf17035b8c7d5aba56b4b0bdb37`.
The artifact's types, schema SQL and fingerprint JSON match checked-in files
byte for byte. The private `gridex_correction_process` schema is outside the
public snapshot; its behavior is checked by native replay. These results are
evidence for `9b95746f` only. Test-only `eb934dfe` confirmed the separate outbound history finding in OPS
`36152595429`, native job `108129302332`: **340 passed/1 failed**, combined
`originalCount` was 0 instead of 1 after standalone owner count 1. The same
head's quality job `108129302387` failed its 1,800-line file budget (1,839);
the local test consolidation now passes that budget and typecheck. The narrow
forward candidate `20260925173000` still awaits exact-head native GREEN.

| Acceptance requirement | Existing implementation | Exact evidence | Remaining proof and risk |
| --- | --- | --- | --- |
| Task 3b, prospective transitions from twelve process tables and rollback | `20260924073337_correction_process_facts_v1.sql` installs always-on write/delete and truncate guards; `capture_v1` keeps bounded linkage fields and old/new scope. | Native `scripts/ediel-correction-context-native.test.ts`: catalog, task update/delete/rollback, graph cascade/SET NULL, invoice-test archive both unsigned and signed, legacy contract event, actual case/operation job claim, swallowed event. All in OPS `36144530332` 337/337. | Table/route sampling cannot certify uninstrumented pre-epoch changes. A missing producer can omit a safety-relevant link. Keep `complete:false`. |
| Task 3b, request and point owner history under event volume | `20260925140000`, `20260925150000`, `20260925154500` forwards; `switch_event_subject_v1` uses immutable old/new request and point candidates, unknown IDs wildcard. New forward `20260925163000` scopes across a distinct incoming request customer using the historical physical point. | Native covers 1,001 unrelated events, distinct point, prior owner after reassignment, deletion of event/request/point at both cutoffs and actual UTILTS; 339/339 OPS `36148887580`. Independent read-only review found the B-request/A-point omission. Test-only `467a143b` produced actual RED in OPS `36149861401`, job `108120098151`: 339 passed/1 failed, request receipt `[]` instead of `['INSERT']`. `9b95746f` passed 340/340, including cross-customer positive and 1,001 unrelated B/null-point negative in OPS `36150994331`. Earlier behavioral RED `5a4f626b` and UUID RED `8800d014` were fixed at `f75b69ea`. | Pre-epoch stays `complete:false`; retention and final-head review still gate use. |
| Task 3b, witness, gaps, access and bounds | `20260924080601` and `20260924085942` use post-commit witness, tenant permission, immutable private RLS tables, 1,000 fact and byte bounds. | Native uncommitted witness denial, cross-tenant denial, failed write rollback, 1,001 scoped overflow, saved cutoff and pre-epoch `complete:false` in OPS `36147085260`. | No assigned lawful retention/purge policy for new process archive, readsets and witnesses; existing `edifact_raw_payloads` 1095-day archive, `legal_audit` 3650-day archive and `ediel_polling` 395-day delete do not assign this evidence. A policy and a safe fail-closed purge/archive qualification are needed before broad use. |
| Task 4, same database snapshot and bounded five-owner receipt | `20260924120822` and follow-up combined forwards select source, process, concern, outbound and document owners in one statement; `lib/ediel/sources/combinedCorrectionReadset.ts` validates count, scope, hash, time, tenant and relationships before use. | Native actual Z08H and document attempt, concurrent pre/post commit process/concern cutoff, saved bytes/hash, readset inspection and failed combined owner RPC; 340/340 OPS `36150994331`; authentic types/schema files match artifact above. Independent review identified an omitted pre-epoch outbound PRODAT with raw BGM Z08 but stale row code/profile in `combined_outbound_body_v3`; the standalone owner includes it. Test-only `eb934dfe` established actual RED in OPS `36152595429`, native `108129302332`: standalone count 1, combined count 0, 340 passed/1 failed. The local consolidated test checks both sealed unrelated exclusion and unsealed stale-metadata wildcard within file budget. | Forward `20260925173000` aligns the combined candidate predicate with standalone raw BGM Z08/unparseable PRODAT before sealed scope/count. It still needs native GREEN and exact-head CI. A missing candidate undercounts outbound history; `complete:false` remains fail-closed. One-statement MVCC is established statically and by boundary cases, not an adversarial commit inside acquisition. Retention and all permission/overflow combinations are not exhaustively qualified. |
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
