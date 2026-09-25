# PR #372 acceptance and bounded pilot gate — 2026-09-25

Scope: `codex/e035-correction-context-20260924` against `main` at
`2a148d39d631fc759c99cd1c69350b5e2147dbdb`. PR #310 is excluded.
Skill routing: repository `executing-plans`, `acquire-codebase-knowledge`,
`quality-playbook`, `test-driven-development`, `differential-review`,
`supabase`, `supabase-postgres-best-practices`, `verification-before-completion`.
Final independent review is conditional on a frozen diff. UI, performance and
skill authoring are outside this batch. No parallel agent writes.

The latest fully checked published head is
`5239b8164189c2e2b4e5f3eb34dd0388be11faf7`, tree
`a65ddc6f720a1d3cdcf566eff36531f6c179937b`. OPS `36153744510`
passed verify `108133137430`, quality `108133137693` (including 6,081 unit
tests, build and file budget), and clean replay `108133138462`: five native
files, **340/340**, plus case-view and browser continuation. Tenant
`36153744600`, browser `36153744655`, Ediel `36153744466` and full E2E
`36153744475` succeeded; crawler `36153745011` skipped. Clean replay
artifact `10873162038` was downloaded: generated types SHA-256
`36e989375ef5313e506a04f7d6e79b4058316ed0f39eb7d9530658fa1cbbed6d`
and schema snapshot fingerprint
`c3ec834faa7c27e3db0f4424a2afcc8205ea4bf17035b8c7d5aba56b4b0bdb37`.
The artifact's types, schema SQL and fingerprint JSON match checked-in files
byte for byte. The private `gridex_correction_process` schema is outside the
public snapshot; its behavior is checked by native replay. These results are
evidence for `5239b816` only. Test-only `eb934dfe` confirmed the separate outbound history finding in OPS
`36152595429`, native job `108129302332`: **340 passed/1 failed**, combined
`originalCount` was 0 instead of 1 after standalone owner count 1. The same
head's quality job `108129302387` failed its 1,800-line file budget (1,839);
the consolidated test on `5239b816` passed the budget, native behavior and
same-head CI. The independent read-only whole-PR follow-up found no other
confirmed code defect on this tree, but withheld rollout approval pending
retention and synthetic staging. No GitHub review has been submitted.

| Acceptance requirement | Existing implementation | Exact evidence | Remaining proof and risk |
| --- | --- | --- | --- |
| Task 3b, prospective transitions from twelve process tables and rollback | `20260924073337_correction_process_facts_v1.sql` installs always-on write/delete and truncate guards; `capture_v1` keeps bounded linkage fields and old/new scope. | Native `scripts/ediel-correction-context-native.test.ts`: catalog, task update/delete/rollback, graph cascade/SET NULL, invoice-test archive both unsigned and signed, legacy contract event, actual case/operation job claim, swallowed event. All in OPS `36144530332` 337/337. | Table/route sampling cannot certify uninstrumented pre-epoch changes. A missing producer can omit a safety-relevant link. Keep `complete:false`. |
| Task 3b, request and point owner history under event volume | `20260925140000`, `20260925150000`, `20260925154500` forwards; `switch_event_subject_v1` uses immutable old/new request and point candidates, unknown IDs wildcard. New forward `20260925163000` scopes across a distinct incoming request customer using the historical physical point. | Native covers 1,001 unrelated events, distinct point, prior owner after reassignment, deletion of event/request/point at both cutoffs and actual UTILTS; 339/339 OPS `36148887580`. Independent read-only review found the B-request/A-point omission. Test-only `467a143b` produced actual RED in OPS `36149861401`, job `108120098151`: 339 passed/1 failed, request receipt `[]` instead of `['INSERT']`. `9b95746f` passed 340/340, including cross-customer positive and 1,001 unrelated B/null-point negative in OPS `36150994331`. Earlier behavioral RED `5a4f626b` and UUID RED `8800d014` were fixed at `f75b69ea`. | Pre-epoch stays `complete:false`; retention and final-head review still gate use. |
| Task 3b, witness, gaps, access and bounds | `20260924080601` and `20260924085942` use post-commit witness, tenant permission, immutable private RLS tables, 1,000 fact and byte bounds. | Native uncommitted witness denial, cross-tenant denial, failed write rollback, 1,001 scoped overflow, saved cutoff and pre-epoch `complete:false` in OPS `36147085260`. | No assigned lawful retention/purge policy for new process archive, readsets and witnesses; existing `edifact_raw_payloads` 1095-day archive, `legal_audit` 3650-day archive and `ediel_polling` 395-day delete do not assign this evidence. A policy and a safe fail-closed purge/archive qualification are needed before broad use. |
| Task 4, same database snapshot and bounded five-owner receipt | `20260924120822` and follow-up combined forwards select source, process, concern, outbound and document owners in one statement; `lib/ediel/sources/combinedCorrectionReadset.ts` validates count, scope, hash, time, tenant and relationships before use. | Native actual Z08H and document attempt, concurrent pre/post commit process/concern cutoff, saved bytes/hash, readset inspection and failed combined owner RPC; 340/340 OPS `36150994331`; authentic types/schema files match artifact above. Independent review identified an omitted pre-epoch outbound PRODAT with raw BGM Z08 but stale row code/profile in `combined_outbound_body_v3`; the standalone owner includes it. Test-only `eb934dfe` established actual RED in OPS `36152595429`, native `108129302332`: standalone count 1, combined count 0, 340 passed/1 failed. The consolidated test checks sealed unrelated exclusion and unsealed stale-metadata wildcard; it passed in native job `108133138462` as part of 340/340 on `5239b816`. | Forward `20260925173000` aligns the combined candidate predicate with standalone raw BGM Z08/unparseable PRODAT before sealed scope/count. The specific owner-set omission is closed by exact-head GREEN. Pre-epoch `complete:false` remains fail-closed. One-statement MVCC is established statically and by boundary cases, not an adversarial commit inside acquisition. Retention and all permission/overflow combinations are not exhaustively qualified. |
| Task 4, actual E30/E66/S07 effect | Combined inspector feeds the UTILTS comparison and inbound processor. | Native actual E66 and E30/S07 witnessed-C hold, persisted disposition/CONTRL and zero meter-series effects; actual failed combined RPC also saved internal review/none, no APERAK or meter series in OPS `36148887580` (339/339). | No positive C authority, reopening, or pre-epoch completeness follows. The earlier intermittent Storage `unconfirmed` failed stage was never isolated; six later mutation cases passed, without proving a causal fix. |
| Whole PR and rollout | Draft PR #372; main unchanged at the checked base. | All applicable PR flows passed on `5239b816`; clean replay artifact `10873162038` matches checked-in types/schema byte for byte. Independent read-only full-diff follow-up reviewed R1/R2, switch ownership and outbound forward without new confirmed code findings. No formal GitHub review submitted. | Bounded prospective code acceptance is supported; an adversarial commit inside a single acquisition, lawful retention/archive and E035-specific protected staging remain unqualified. A production pilot and merge remain separate GO decisions. |

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

### Minimum staging and pilot evidence record

The PR full-E2E run `36153744475` executed smoke `108133137523`, coverage
`108133138069` and PR certificate `108133905747`. Its `runtime-staging`
`108133139054`, `real-customer-staging` `108133139170`, `full` `108133139370`
and nightly certificate `108133139602` were **skipped**. The protected
`production-certification-e2e.yml` is manual and was not part of this PR run.
Do not treat PR smoke as staging or production qualification.

| Gate | Test identity and action | Saved observation required |
| --- | --- | --- |
| Isolated staging | Bind a single run ID `e035-<head8>-<UTC>` to generated synthetic tenant, actor, customer, point, source-message and switch-request IDs. Use reserved `.invalid` contact details, test environment, no real metering point or market party, disabled transport routes and billing/meter side effects. Verify staged app and migrations match the frozen PR head before seeding. | Sanitized fixture manifest with IDs, migration version and before counts; no credentials, real customer payloads or production traffic. |
| Generic runtime prerequisite | Explicitly dispatch `full-e2e.yml` `mode=runtime` on the frozen SHA after verifying staging secrets and outbound isolation. This lifecycle certificate does not invoke the E035 correction path. | Successful protected runtime artifact and same SHA; failure or skipped job blocks advancement. |
| E035-specific staging | With the synthetic tenant, exercise actual concern capture, switch point/request history, a saved five-owner cutoff receipt, and actual E30/S07/E66 inbound processing. Include a linked point and a known unrelated point; use only test EDIEL identities and no external provider call. Historical pre-epoch gaps remain `complete:false`; do not manufacture complete history. | Receipt bytes/hash and owner visibility/cutoff, witnessed facts, `complete:false`/`authority:none`, persisted internal review and CONTRL, zero APERAK, zero meter-series and invoice effects, cross-tenant denial and before/after counts. A missing or malformed owner must hold. |
| Production decision, then synthetic pilot | Record retention category/duration and archive/expiry behavior for all six private evidence tables, safe forward recovery, owner approval, final SHA CI/review, staging artifacts, and protected production preflight. Only after a signed GO use one isolated synthetic nonmarket tenant with routing, billing and ingestion disabled; record the same hold/zero-side-effect observations. | Named approver, exact SHA, run ID, start/end, evidence links, explicit abort owner and last accepted deployment ID. Any missing gate is NO-GO. |

An unexpected market send, tenant crossing, authority on incomplete history,
nonzero billing/meter effect or unexplained `unconfirmed` ends the run. Pause
the synthetic tenant's routes/workers, preserve the immutable receipt and
audit evidence, revert the application deployment to the recorded accepted
version and investigate the forward database migration separately. Merge to
`main` itself may deploy production when `VERCEL_TOKEN` is configured.

**Current verdict: NO-GO** for production pilot or merge. The history/retention
policy and safe archive/expiry behavior, protected runtime and E035-specific
stage evidence, production preflight and explicit GO remain open. Bounded
prospective code behavior and PR CI are green on `5239b816`; they do not
establish historical inception coverage or authorize live data processing.
