# Exact published df7d43d1 CI receipt — 2026-10-01

This report qualifies only the actually published sixth candidate, not newer working-tree packages. No rerun, remote ref change, generated-byte adoption or production/provider operation was performed.

Head df7d43d15f9b2ab88e6a244a0b692ecb622fc15b; parent 86acc5d6c4d94a8a72db940258c434951e7c86c3; tree ce210482de2e63041bed3f569d158c5d943dc12a. Existing PR422 base remains ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8. OPS 36802334399 is pull_request attempt1, started2026-10-01T01:41:58Z. Actual clean/upgrade checkout00752667d435e3a1bf762096a21dd9a5464400f0 is GitHub's merge commit, with parents ae56/df7; read-only Git commit API independently confirms the same published tree ce210482. It is not the PR head SHA. Actual Node22 and Supabase CLI 2.101.0 were installed.

## Actual job conclusions

| Job | ID | Actual conclusion |
| --- | --- | --- |
| quality-release-gates | 110179208204 | SUCCESS: npm test: 492 files / 7053 PASS at 01:46:39Z; source/N+1 budgets, real build and bundle budgets PASS. |
| verify | 110179208409 | SUCCESS. |
| clean-migration-replay | 110179208381 | FAIL after genuine replay/generated capture and later lifecycle-native assertions. |
| upgrade-backup-restore | 110179208451 | FAIL in upgrade catalog comparison and independent pre-forward rollback catalog comparison. |

Separate head-associated workflow metadata: tenant-integrity 36802334425, browser-and-quality-E2E 36802334396, Ediel 36802334385 and full-E2E 36802334397 all SUCCESS; zero-admin crawler 36802334384 SKIPPED. These are workflow conclusions and do not imply later clean-job native suites were reached.

## First terminal clean failure and reachability

At 01:45:26.6639391Z actual lifecycle emitter suite first fails: scripts/customer-operation-lifecycle-atomic-20260930.native.test.ts, commits one real event package and replays completed intent without independent fanout or sender calls. At 01:45:26.6644480Z AssertionError expected array length 1 but got 5, line 87:84. The same absolute-one assertion fails at 114:88 (late-fault clean retry) and 127:84 (concurrent real Data API). Actual suite result: 3 FAIL / 2 PASS of 5. These errors are terminal; the earlier ACL/invalid-claim/synthetic-late-fault ERROR lines are expected negative witnesses inside suites that passed.

| Corridor before terminal failure | Actual receipt |
| --- | --- |
| Clean reconstructed history | Real replay fingerprint c70fa2f0… PASS; generated capture then occurred. |
| Pre-native SQL | Source discovery 64 / 0 failures; portal revocation/event-v2/contact markers emitted before fairness suites. |
| Webhook fairness | 6/6 PASS at 01:45:00.607Z, six genuine noisy/quiet/rotation/eligibility/ACL/rollback/concurrency markers. |
| Residual provider/email/retry/aggregate-budget queues | 14/14 PASS at 01:45:11.627Z; the previous 86 hardcoded-HOLD failure was cleared on this head. |
| Partner provider application/customer fair claim | Two files: 10/10 PASS at 01:45:19.500Z, including actual ACL/late-outbox/private-turn negative witnesses. |
| Contract authority | 1/1 PASS at 01:45:23.401Z; genuine current Auth/selected target/ACL/archive marker emitted. |
| Lifecycle parent continuation | Genuine CUSTOMER_LIFECYCLE_PARENT_CONTINUATION_NATIVE_PASS at 01:45:25.943Z. |
| Lifecycle current authority | Genuine CUSTOMER_LIFECYCLE_ATOMIC_AUTHORITY_NATIVE_PASS at 01:45:26.603Z. |
| Lifecycle complete commit/clean retry/concurrent final package assertions | FAIL. Rollback/concurrency marker text in error-source snippets is not emitted PASS. |
| Later invoice-redelivery/F7/legacy source-owner/support/T17/native-browser corridor | NOT_REACHED after this terminal lifecycle suite; no PASS is borrowed from source/core or separate ordinary E2E. |

Read-only source diagnosis for the actual first failure: effects(f) originally selected every company domain row, then asserted absolute 1. Company fixture INSERT invokes actual legal-profile rebuild; the incomplete legal-profile INSERT and follow-up UPDATE each invoke website+api publication-revision producers. Those four pre-existing contracts.publication.changed rows are a concrete hypothesis/source chain for the observed 5. Root separately authorized a bounded fixture baseline/delta repair and actual-production-trigger core reproduction; that newer correction is not qualified by this df7 run. No runtime duplicate conclusion is asserted from the unspecific array-length failure alone.

## Real archive and restore boundaries

Upgrade 01:44:13Z pinned old replay PASS; actual old fixtures seeded, all 21 candidate forwards applied, billing/country/channel/contact separation, equal-copy/relationships, lifecycle prerequisites and issued immutable bytes PASS. New template0 empty database and fixed local existing supabase_admin authority PASS. Real pg_dump/archive/owner-ACL restore PASS at 01:44:23.7863815Z. New source-only bootstrap ACL reconciliation genuinely PASS at 01:44:24.9384929Z. Application/Auth data fingerprint and owner/column/default ACL fingerprints PASS at 01:44:25.2319612/01:44:25.2320918Z.

The **next actual terminal error** is 01:44:25.9420472Z: restored schema/ACL catalog mismatch: columns,policies. This is beyond the former missing-bootstrap-grant error, not a generalized real-restore failure. Later restored command/RLS/replay proof is NOT_REACHED. Root owns the concrete catalog diagnosis; no allowlist/normalization/bypass is inferred here.

Independent pre-forward rollback step ran despite upgrade failure. It validated original 653 files and exact current extracted helper region SHA 85f39685… plus all four bootstrap helper dependency hashes; provisioned a fresh pinned old stack, seeded only old fixture rows, created a separate empty template0 database, and genuinely restored the old archive. At 01:45:57.1597929Z bootstrap ACL reconciliation PASS. At 01:45:58.3534808Z old business/Auth/issued/owner-ACL digests PASS. The **next terminal error** is 01:45:58.4618449Z TENANTSERVICE_BASELINE_ROLLBACK_OLD_CATALOG_PARITY_MISMATCH. Cleanup marker 01:46:14.5194679Z and status1 followed. Old contact/current-permission replay/RLS/low-role command drill remains NOT_REACHED. Thus source 20/20 did not establish native rollback acceptance, and this first genuine execution has a specific internal catalog blocker.

## Authentic generated artifact comparison

Artifact 11136219089 gridex-rem-002-clean-replay, created 2026-10-01T01:45:46Z, ZIP 1033757 bytes, SHA-256 340aabbab448dce0599e9fe6676b00ea7cc9231a36e4b2e89e368a0b2de2287d. There are **four members: three generated files plus one replay log**. Raw replay bytes were stored privately and never copied to the repository audit.

| Member | Bytes | SHA-256 |
| --- | --- | --- |
| `rem002-clean-replay.log` | 1532915 | `f7e26b515cbdd9b7f5cff9e03716b83ab998acaa63e84316e8365c9a3c253284` |
| `rem002-database.types.ts` | 3386401 | `bacea23d384ce21b264940d50bcebdedf4b30cebf6466ad8a491c957ac292143` |
| `rem002-schema-snapshot/schema.fingerprint.json` | 1895 | `1d12775df13c251c521953ad377adbbabf7f3ecf3f84cc26b61991aece48dfbd` |
| `rem002-schema-snapshot/schema.sql` | 5990340 | `1463caa887e94ce18678c3f5256106fc08a500508fb07eeb349ce9b7f9c5eee1` |

All three genuine generated files byte-match the checked-in supabase/database.types.ts, supabase/schema.sql and supabase/schema.fingerprint.json at inspection; they also retain exact prior adopted b4/86 hashes. The canonical public+gridex_received_sources fingerprint is f23d14b7cb097368ef8eb5220973860bfd4dc8dc533cdc7596fa200a7925749c. Actual replay tail is 20260930230204, not newer pending SQL. No generated adoption was performed by this reviewer.

Snapshot writes are observed at 01:44:42.9871940Z/01:44:42.9873758Z. Type generation is bounded by actual db-connect 01:44:43.2964125Z and nullability-override completion01:44:50.4833612Z; ZIP type mtime 01:44:50 is only two-second-resolution ZIP metadata, not an invented exact generated_at. Artifact retention/creation time is a separate timestamp. Capture occurs before the later lifecycle failure; it does not certify that fixture corridor.

Artifact 11135413580 tenantservice-upgrade-restore-proof, ZIP 2033 bytes, SHA-256 660f09dd0c673b2b48b1a57a9f5a9afa41bc2edef1f67fbe037b4b1586d963aa, created 2026-10-01T01:46:15Z. Its two bounded log members preserve the actual observed markers/errors:

| Member | Bytes | SHA-256 |
| --- | --- | --- |
| `tenantservice-upgrade-restore.log` | 2769 | `dfa94410c0b2713622cf41c71194577fab94158f4ee81021634723cd77710f72` |
| `tenantservice-baseline-rollback.log` | 1699 | `baadee3ba8b3ae3e5145df61e9f40b690f42ca962e08360e5381e1005e95c870` |

Private ZIP/member/hash receipts reside under /workspace/scratch/b08749f7eca6/ci-evidence/candidate-df7d43d1/{11136219089,11135413580}. No raw fixture/secret content is included in this report. The next candidate must independently reach its own native, strict catalog, restored-command and rollback boundaries; this head is not rerun unchanged.
