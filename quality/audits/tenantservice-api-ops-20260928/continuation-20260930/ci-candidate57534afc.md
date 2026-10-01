# Actual seventh candidate CI receipt — 57534afc

Repository: `heke99/gridex-ops-platform`, existing draft #422. This report is a read-only receipt of authorized GitHub run/job/log/artifact reads. No ref mutation, manual rerun, product/native/SQL change, provider call, live-Auth/DB exercise or original-worktree edit was performed. Raw decoded logs and downloaded archives remain private outside the repository; this report contains bounded outcome labels, counts, public source references and hashes only.

## Exact tested revision and job outcomes

| Provenance | Genuine observed value |
| --- | --- |
| Published head | `57534afc4621e084251a6a878f23b67a2d4ac62e` |
| Parent | `df7d43d15f9b2ab88e6a244a0b692ecb622fc15b` |
| Actual merge checkout | `8e1a20a461493852b9af22a364d4a11b57b0d10c`; actual checkout log and GitHub Git-commit response agree |
| Merge parents | `ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8`, `57534afc4621e084251a6a878f23b67a2d4ac62e` |
| Head and merge tree | Both `77daf9438873480823ea012a74d278831428726f` |
| OPS run | 36809457517, `pull_request`, attempt1, created `2026-10-01T03:12:45Z`, completed FAILURE, updated `2026-10-01T03:21:02Z` |
| Exact source workflow | Read from raw GitHub at this head; SHA-256 `822e37c2dc6543411d0b775c42ea9e68ba91738a5255d782a45ad38e3b32df58` |
| Latest applied migration | `20261001012959_ediel_resume_tenant_fair_claim.sql`; observed actual replay, not a future working-tree tail |
| Actual Supabase CLI | `2.101.0` |

Every time in this report is the genuine GitHub log prefix ending Z or run/artifact API UTC metadata. Local Vitest wall-clock labels are not relabeled as UTC. Raw `/pulls/422`/ref checks by root disambiguated the briefly stale cached PR-info response; this receipt independently binds run head, actual checkout and Git tree.

| Actual OPS job | Result and first failing boundary |
| --- | --- |
| verify110201031254 | FAIL: actual migration integrity678 files/582 groups, legal and hardening PASS; generated-types manifest rejects new tail at03:13:08.836Z. Later verify steps skipped. |
| quality-release-gates110201031239 | SUCCESS: actual full unit7176/7176 in500 files at03:17:54.036Z; separate quality suite45/45 in2 files. Lint/types/mechanical/docs/compatibility/release/RBAC/source/performance/build/bundle steps PASS. These are their bounded quality gates, not native business acceptance. |
| clean-migration-replay110201031266 | FAIL: reconstructed history and genuine capture PASS, then native fairness/contract/lifecycle PASS; legacy source-owner batch334PASS/43FAIL. Exact first terminal cases below. |
| upgrade-backup-restore110201031039 | FAIL overall: real upgraded archive/catalog/commands/RLS/immutable data proof PASS, then final comparison with the older tracked schema bytes fails. Fresh pre-forward old restore reaches catalog PASS but subsequent private SQL proof fails. Independent fresh-baseline backfill step SUCCESS. |

## Clean replay: observed order and genuine PASS receipts

The actual empty-stack replay verified its reconstructed foundation, canonical checksum-pinned history and CLI-owned observed ledger at03:15:41.195Z (48 official CLI ledger rows). The replay-specific fingerprint `c70fa2f017f6ce3af3ff806d948f18b58a3c196e4bf94daa9304629a3926680c` and the later full generated-schema fingerprint below are distinct logged boundaries; they must not be interchanged.

Before native commands, actual production SQL regressions emitted PRODAT source storage62/62, receive context84/84, receive-context upgrade3/3, source ledger105 checks, discovery shape64 total/0 failed, source-object decisions71 checks and committed UTILTS retries8 checks PASS. These are separate scoped counts, not a unique aggregate acceptance denominator. Expected SQL deny/fault errors are not terminal failures merely because an ERROR line exists.

At03:15:56 the genuine `PORTAL_REVOCATION_NATIVE_PASS`, Event-v2 ACL/projection/order/tenant-customer filters/limits/cursor/replay/immutability markers and `P2_CONTACT_NATIVE_PASS legacy_core=true public_v1_disabled=true` were emitted. Event-v2 cursor receipt names116 events/58 pages/59 replay checks with microsecond ties/shared IDs. These qualify their own current commands and retained source boundaries.

| Execution order after those SQL checks | Actual outcome/time |
| --- | --- |
| Webhook fair native | 6/6 PASS03:16:00.759Z |
| Residual queues/budgets/CAS | 14/14 PASS03:16:11.585Z |
| Provider-order and customer-queue pair | Two files10/10 PASS03:16:19.476Z (provider6/customer4) |
| New reachable Ediel resume fair claims | 7/7 PASS03:16:27.017Z, with seven explicit verbose ✓ cases below |
| Contract current-target authority | 1/1 PASS03:16:31.056Z; `CONTRACT_AUTHORITY_NATIVE_PASS` emitted03:16:31.051Z |
| Corrected lifecycle atomic fixture | 5/5 PASS03:16:34.454Z; every mandatory lifecycle marker emitted |
| Existing six-file source-owner batch | Two files failed/four passed;334 PASS/43 FAIL of377 at03:20:37.821Z |
| All later native/HTTP/browser commands | NOT_REACHED in this clean job, because the shell stops on the failed six-file batch |

All six actual webhook markers are present: `WEBHOOK_FAIR_NATIVE_PASS` (noisy old25/quiet3/cap5 and atomic claim-turn), `WEBHOOK_FAIR_ROTATION_NATIVE_PASS`, `WEBHOOK_FAIR_ELIGIBILITY_NATIVE_PASS`, `WEBHOOK_FAIR_ACL_NATIVE_PASS`, `WEBHOOK_FAIR_ROLLBACK_NATIVE_PASS` and `WEBHOOK_FAIR_CONCURRENCY_NATIVE_PASS` (two real sessions/disjoint SKIP LOCKED claims).

The new Ediel resume7 actual passed case labels cover:

1. Both global phases cap noisy work and persist actual limit-one tenant turns.
2. Actual company-bound engine preserves noisy rows and canonical blocked guards with zero message/request/outbox effects.
3. Current company, phase, stamp, token and expiry rechecked, frontend/private grants denied.
4. Two actual transactions return disjoint claims after observing private-turn wait.
5. Actual server lease UPSERT protects fresh competitor token and exact expiry cutoff.
6. Late tenant-turn write fault rolls every actual claim and turn back.
7. Final completion expiry reaches its sleep witness and rolls its lease write back.

No provider/render/market activation success is inferred from canonical blocked work or fair claims.

All five actual lifecycle markers now pass on the corrected baseline-sensitive fixture: `CUSTOMER_LIFECYCLE_ATOMIC_NATIVE_PASS`, `CUSTOMER_LIFECYCLE_ATOMIC_ROLLBACK_NATIVE_PASS`, `CUSTOMER_LIFECYCLE_ATOMIC_CONCURRENCY_NATIVE_PASS` (actual PostgREST parallel4/fresh1/replay3), `CUSTOMER_LIFECYCLE_PARENT_CONTINUATION_NATIVE_PASS`, and `CUSTOMER_LIFECYCLE_ATOMIC_AUTHORITY_NATIVE_PASS`. Their timeline/domain/fanout/notification counts denote the exactly one new operation-bound package while the fixture retains its genuine pre-existing baseline. No absolute baseline deletion or weakened production atomicity is accepted. Every marker records external_delivery=0.

## First terminal native failures, without guard weakening

The first listed failed case is `scripts/ediel-correction-context-native.test.ts > the separate explicit withdrawal writer retains business stops and immutable lifecycle evidence`. The actual missing-column error occurs at03:18:16.520Z: `column "source_customer_case_id" does not exist`. The stack points to `scripts/helpers/ediel-support-boundary-native-20261001.ts:123:9`; the aggregate query's line133 selects that nonexistent column from `public.customer_lifecycle_decisions`. The generic private support case immediately before it genuinely emitted `SUPPORT_PRIVATE_FINANCIAL_LIFECYCLE_BOUNDARY_NATIVE_PASS` at03:18:15.678Z. The explicit withdrawal terminal marker was not emitted. Its116 passing cases are not a substitute for that failed explicit-path assertion.

The owner native's first failed case is `real HTTP/database owners commit and persist source approval, delegated=false` at03:20:37.798Z: `inbound_switch_trusted_receive_required`. The delegated=true case and most other old owner fixture cases fail at the same new authoritative receive prerequisite. This is an actual current source/fixture integration failure; no accepted ordinary-caller business effect or permission bypass is established by that error. A separate old owner test, `a real second-write failure never grants source approval and preserves the first committed write`, expects `accepted` at `scripts/ediel-source-owner-native.test.ts:219:113` and receives `draft`. The current atomic command's rollback must not be weakened to satisfy an obsolete first-write expectation. A legitimate updated fixture must establish actual current producer/source prerequisites and preserve denial/rollback assertions; no claimed flag or manually manufactured trusted witness substitutes.

| Actual batch file | Exact split |
| --- | --- |
| ediel-correction-context-native.test.ts | 117 total:116 PASS/1 FAIL |
| ediel-source-owner-native.test.ts | 47 total:5 PASS/42 FAIL |
| ediel-utilts-consumption-native.test.ts | 117/117 PASS |
| ediel-document-reference-native.test.ts | 40/40 PASS |
| ediel-closure-wire-native.test.ts | 46/46 PASS |
| ediel-z04-ack-native.test.ts | 10/10 PASS |
| Total | 377:334 PASS/43 FAIL;4 passed/2 failed files |

Safe exact error/source receipts were sent to root and the legitimate site-fixture owner. No fix or test execution was performed by this evidence task.

## Upgraded real archive: protected proof PASS, tracked snapshot barrier afterward

The actual plan validates653 pinned historical migrations and25 forwards. Old replay/seed, legacy billing country-channel/contact separation, explicit-equal copies/relationships, historical lifecycle prerequisites and issued bytes PASS. Actual random empty template0 database and local administrator authority PASS, followed by genuine owner/ACL pg_dump archive restore at03:15:58.173Z and source-bootstrap ACL reconciliation03:15:59.367Z.

The real application/Auth data and owner/column/default-ACL fingerprints pass03:15:59.683Z. **Complete schema/function/RLS/ACL parity passes03:16:00.401Z**. This genuinely clears the previous sixth `columns,policies` catalog barrier; no comparison category, owner, role or grant was ignored or weakened for this receipt.

At03:16:00.547Z the restored database emits every protected post-restore marker:

- `TENANTSERVICE_RESTORE_AUTHENTICATED_ANON_ACL_AND_TENANT_RLS_PASS`
- `TENANTSERVICE_RESTORE_CURRENT_PERMISSION_FOREIGN_TENANT_COMMAND_DENIAL_PASS`
- `TENANTSERVICE_RESTORE_AUTHORIZED_ATOMIC_COMMAND_AND_REPLAY_PASS`
- `TENANTSERVICE_RESTORE_EXPIRED_AND_REVOKED_SESSION_REPLAY_DENIAL_PASS`
- `TENANTSERVICE_RESTORE_ISSUED_INVOICE_LOCKED_SNAPSHOT_GUARDS_PASS`

`TENANTSERVICE_RESTORE_POST_PROOF_NO_PERSISTED_EFFECT_PASS` follows03:16:01.680Z. The first failure afterward is the final plain byte comparison: tracked `supabase/schema.sql` and genuinely upgraded snapshot differ at byte173013/line2316,03:16:01.682Z. Step exit1 follows03:16:21.004Z. This is a stale tracked generated-snapshot boundary after the protected restore proof, not a remaining restored owner/ACL/catalog failure. Root separately owns exact authentic artifact adoption; this report never hand-edits generated bytes.

## Fresh pre-forward old-schema rollback: catalog PASS, later SQL stage failed

A separate real pinned ae56 stack is replayed and seeded before any candidate forward. The log binds the extracted trusted restore helper and bootstrap/query/diagnostic dependencies, retains all653 historical bytes, provisions a genuinely empty template0 target, passes local admin authority, restores the real old archive03:17:55.322Z, and reconciles source bootstrap ACL03:17:56.498Z.

`TENANTSERVICE_BASELINE_ROLLBACK_OLD_BUSINESS_AUTH_ISSUED_OWNER_ACL_FINGERPRINT_PASS` emits03:17:57.746Z and `TENANTSERVICE_BASELINE_ROLLBACK_OLD_SCHEMA_FUNCTION_RLS_ACL_PARITY_PASS`03:17:57.863Z. The next observed boundary is `TENANTSERVICE_BASELINE_ROLLBACK_SQL_FAILED_PRIVATE_CONTEXT`03:17:57.935Z, followed by private cleanup/failure03:18:17.227Z and exit1. The raw private SQL error was removed by the wrapper's original cleanup; the artifact preserves only this safe marker. Its statement/SQLSTATE is **NOT_AVAILABLE**, not guessed.

The old low-role/current authorized baseline command/replay/no-effect corridor was entered but did not emit its complete success receipt. It is **ENTERED_FAILED_PRIVATE_CONTEXT / NOT_VERIFIED**, not accepted and not an external blocker. No new-schema command is represented as an old-schema capability. Root is preparing fixed-stage/SQLSTATE-only diagnostics while retaining original gates and private values.

## Separate genuine fresh-baseline backfill qualification

The third upgrade-job step runs only after both restore wrappers have disposed their stacks. It refuses an existing configured stack, archives/replays the actual pinned ae56 repository, retains every historical byte and executes the complete unchanged dry-run/apply SQL. The real outer native case passes1/1 at03:20:15.031Z and emits a public fixed-label `BACKFILL_NATIVE_RECEIPT`.

| Real native witness | Observed outcome |
| --- | --- |
| dry_run | COMPLETE_SQL_ZERO_EFFECTS_PASS |
| low_roles | ACTUAL_42501_ZERO_EFFECTS_PASS |
| late_audit | WHOLE_DATABASE_ROLLBACK_PASS |
| agreed_null | REPAIR_PASS |
| conflicting_null | MANUAL_ZERO_COMPANY_CORRELATION_AUDIT_EFFECTS_PASS |
| missing_parent | MANUAL_ZERO_COMPANY_CORRELATION_AUDIT_EFFECTS_PASS |
| nonnull_mismatch | MANUAL_ZERO_COMPANY_CORRELATION_AUDIT_EFFECTS_PASS |
| replay | WHOLE_DATABASE_ZERO_EFFECTS_PASS |

The receipt names18 inventory triples, inventory SHA-256 `09c030efd9731059231ee28a314b7e88754b8040b8da229707f790969c047b41`, historical inventory `86e7d37a1652d482db8e6446c5e704de2317be3655fe8b28114b9e1679a747b3`, real baseline archive `4946cdcc4821fba7710a383c05c33f2eed8075d2f40d320b7df2c0b2183a5d64`, original replay `b210192b34ee9d1f8a7dce5b59e8af170347518cf17b848d638e8e7fa37d0000`, exact dry SQL `9c23172b13bf27d28a2f84ed9c2b0141b286e56052b673226667a9db06b0b3a9` and apply SQL `ba07547e3e9983738db2345f08aec15d65c094acdedd63364fd820c5c9bdafe3`. Before/after warmup hash is identical `73e82226484851f40b96084f0e7c27c74a6c5ef4a5485fdf024de77f580312c4`.

This qualifies the authored actual old-schema document-parent repair/manual/conflict/replay/whole-data-effect witnesses, including genuine permitted NULL seeds; no constraint refusal was silently converted into repair PASS. Inventory18 is not18 individually repaired production relation types. Other relation/correlation surfaces remain the separate typed core qualification. Native concurrent locking, same-tenant resource identity repair, hosted datasets/scale/timing and operational rollout remain outside this receipt. No whole T49/T55/P8 or75-item status promotion follows.

## Authentic generated artifacts, hashes and precise capture scope

Artifact11139382345 `gridex-rem-002-clean-replay`: created03:20:58Z, ZIP1066666 bytes, SHA-256 `467988e1443d04930b28b00ed0481f4ea2309a80af76f2193619830e94f91e02`. **Four members: three generated files and one private replay log**. GitHub download file references/signed URLs are not part of this report.

| Exact ZIP member | Bytes | Exact SHA-256 | ZIP DOS modification clock |
| --- | --- | --- | --- |
| rem002-database.types.ts | 3388999 | `7c49d7d7202b74e86e18407b60bbd7c6dd5ce326b9ac867636b66ab4894c05ce` | 2026-10-01 03:15:50,2-second granularity |
| rem002-schema-snapshot/schema.sql | 6034696 | `bdcf987d824a883d426555aedd72a5172e6683deb0e4bea5fdb38f89fea516e3` | 2026-10-01 03:15:42,2-second granularity |
| rem002-schema-snapshot/schema.fingerprint.json | 1895 | `1d4d044ad751bb145f787813ab92ab463a181fe3bc7e9ce0bbc0f2fd1917b62a` | 2026-10-01 03:15:42,2-second granularity |
| rem002-clean-replay.log | 1718770 | Retained private, not copied to repository | 2026-10-01 03:20:36 |

The actual snapshot writer logs schema output03:15:43.2487824Z and fingerprint output03:15:43.2489999Z. Canonical fingerprint is `c6b07ccd418ae81e3d4256abba52a5688fd2a4b16cffe50ac615c584b2e2fa38`; JSON fields are algorithm/schemas/sections/sha256 and contain no generated_at. Types CLI finishes with its version notice03:15:50.631Z; the real prescribed nullability postprocessor logs completion03:15:50.7046337Z. Exact types file creation instant is not independently logged; the ZIP clock is a file-time receipt, not a fabricated exact fractional generation timestamp. The earlier replay completion03:15:41.195Z is not types capture time.

These genuine new-tail members differ from the previously tracked b4/86/df7 hashes (types `bacea23d384ce21b264940d50bcebdedf4b30cebf6466ad8a491c957ac292143`, schema `1463caa887e94ce18678c3f5256106fc08a500508fb07eeb349ce9b7f9c5eee1`, fingerprint `1d12775df13c251c521953ad377adbbabf7f3ecf3f84cc26b61991aece48dfbd`). Root received private exact members for adoption. No generated file was edited or adopted by this task.

The actual head workflow captures the schema and its fingerprint after replay, then CLI types and prescribed nullability overrides **before** source SQL/native fixtures. It always uploads those files even after a later native failure. The late generated-hash/committed-file checks after all downstream fixtures are NOT_REACHED in clean, so a genuine artifact alone is not a clean-job PASS. Root's later adoption can resolve the separate tracked manifest/snapshot barriers without erasing this run's source-owner failures.

Private root-adoption directory: `/workspace/scratch/b08749f7eca6/ci-evidence/candidate-57534afc/11139382345/` contains exact `database.types.ts`, `schema.sql`, `schema.fingerprint.json`, ZIP and replay log, mode0600 inside mode0700. The companion private `artifact-receipt.json` preserves every original ZIP member name/hash/size/time. Schema adoption belongs to the later material candidate; this artifact certifies only actual latest tail20261001012959, never future agreement/staff/cleanup forwards.

Artifact11138543286 `tenantservice-upgrade-restore-proof`: created03:20:15Z, ZIP3716 bytes, SHA-256 `ca79ec94bbb8551326539c5d9594fbc5d799566e9e67a5e12490e3f500ce5e5d`. **Three bounded logs**: upgraded restore3929 bytes, pre-forward rollback2116, native backfill2151. They are retained privately; raw catalogs, archives/data/Auth keys/private SQL values are not uploaded by this proof artifact.

Private decoded GitHub-log SHA-256 receipts (UTF-8 re-encoding of connector's decoded text) are: verify16508 bytes `35c38f2c27266086acdacdf85e79d855839610f24b2fb41e3d5028e1d0654221`; upgrade95214 `cafba69c485e0386dfa4cd45a5acc758a3becb02b0b9be8191c19c144baa9c56`; quality242857 `6b735b129ae76641ac7dd275c813b103037d23c40fff0de1c9d76cd4dc3aeae7`; clean2329920 `b8b63821d0f6da9dd4d6546d7eb5dd8dfb23ae1f97ec07c7817be716ea81180a`. These are log provenance hashes, not generated schema fingerprints or new executions.

## Remaining reachability and other same-head workflows

Every clean command after `ediel-source-owner-native.config.ts` is NOT_REACHED: notification read/concurrency, profile/address/portal target commands, site continuation/positive chain, new atomic ACK4, support/sensitive/scanner/consumer, billing/redelivery/recipient locks, current contact/reference/intake actual HTTP and browser, company/OPS views, finance revision views, the new actual Next scanner-denial journey, dirty-navigation, event/notification/incident/legal/metering/support/case after-read. Prepared code or a success in an independent workflow cannot supply any absent marker here.

The same-head automated tenant36809457505, browser36809457528 and Ediel36809457551 workflows succeed; production crawler36809457511 is skipped. FullE2E36809457520 fails from the same manifest-tail barrier: smoke11020103067714/15 passes, only migrations fail03:13:13.460Z; coverage succeeds, runtime-staging/real-customer/full/nightly jobs skip, dependent PR-certificate110201799397 fails its smoke prerequisite. These source-specific receipts are not substitutes for the unexecuted later clean native/browser chains.

Concrete next steps are the material authentic-three-file/manifest adoption, exact legitimate old owner-fixture/explicit-withdrawal column corrections, and safe fixed-stage/SQLSTATE diagnosis of the old rollback. Preserve authoritative receive/source/transaction guards and all strict archive/data/catalog/owner/ACL gates. No unchanged rerun or blanket external block is needed. Whole original75/P0–P8 acceptance remains governed by its unchanged requirements and exact source-owned evidence ledger.
