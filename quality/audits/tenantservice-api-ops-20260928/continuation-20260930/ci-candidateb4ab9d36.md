# Candidate b4ab9d36 — actual CI receipt, 2026-09-30

This is a read-only receipt from completed automatic GitHub Actions jobs and their authentic artifacts. No rerun, ref mutation, source change, hosted database access or provider delivery was performed. The new native packages have prepared source and local evidence, but this run did not reach them.

## Exact tested source

Existing draft #422 head `b4ab9d36cddcd2e195879dbbe695483fbf0db53b`, tree `0e00b390c090d9befa16d36660be347728b24a57`, published parent `506add4a7da44a995f347ea81362926e8226545a`. Local frozen commit `9af577f04cf0d4ec834b466f4e21c056a12aa8d8` independently has exactly this tree.

Actual OPS [run36793102775](https://github.com/heke99/gridex-ops-platform/actions/runs/36793102775), attempt1, tested merge checkout `ba5ee706a4d1dc37c3ffabaac2e0a7c4bbbb1b6d`. All four OPS job checkout logs independently print this full SHA. Connector Git commit metadata independently confirms the same tree and parents `ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8` and the published b4ab head. Smoke, coverage and public-browser checkout logs also print this merge SHA.

The clean/upgrade jobs use Supabase CLI2.101.0. Actual upgrade planning validated653 historical SQL migrations and21 new forwards; the new SQL tail is `20260930230204_customer_operation_lifecycle_intent_atomic.sql`. This receipt does not qualify subsequent working-tree edits.

## Completed OPS outcomes and first failures

| Job | Actual outcome | Observed scope / first failure |
| --- | --- | --- |
| verify110150302773 | FAILED | Migration integrity674files/578versiongroups/checksums, public-contract legal check and database contract hardening PASS. At23:50:21.1076976Z `db:types:check` fails: migration tail changed to20260930230204; regenerate types and manifest. The committed manifest honestly still describes the earlier4b capture. This is separate from the native/restore failures. Later verify steps were not reached. |
| clean-migration-replay110150303013 | FAILED | Empty replay, all candidate forwards and authentic schema/types capture PASS. At23:52:56.5345337Z `scripts/pr164-review-remediation-regression.sql:267` errors `customer_operation_claim_service_required`; context `gridex_claim_customer_operation_jobs(text,integer)` line4, inline block line197, calling the pr164 worker with limit1. Exit3. This older SQL test fails before every listed fairness/new domain native fixture. |
| upgrade-backup-restore110150302981 | FAILED | Pinned old replay, existing rows, all21forwards, legacy billing country/channel/contact separation, explicit equal copies/relationships, historical lifecycle prerequisites and unchanged issued bytes PASS. Emptytemplate0 and actual local vendor-admin/OID boundary PASS. Actual pg_restore archive PASS23:52:39.5050910Z. At23:52:39.8749353Z the two-line fingerprint files first differ byte66,line2; see precise scope below. Later restored authorization/catalog/final clean-schema parity was not reached. |
| quality-release-gates110150303015 | FAILED | Lint0errors/101warnings, scripts/test TypeScript, mechanical gates, quality45/45, actual npmtest483files/6954tests, API docs/compatibility/local release artifact verification for2026-09-30.3 and RBAC24checks/0warnings PASS. At23:54:31.3779562Z source budget fails: `scripts/ediel-correction-context-native.test.ts`1888lines exceeds1800. Performance/build/bundle steps not reached. |

The pre-native clean SQL/source receipts retain their own scope: receive-context3/3, observed source-validation/object concurrency, source-object71checks and committed UTILTS retries8checks passed. These prerequisite successes do not establish later customer commands, browser journeys or all original requirements.

## Native ordering and reachability

The frozen workflow orders these commands after the failed pr164 SQL prerequisite. Whole-log marker scanning found zero genuine marker occurrences for the new webhook/residual/partner/contract/lifecycle/support packages. The workflow's printed shell command block is source ordering, not execution evidence.

| Ordered later corridor | b4ab actual outcome |
| --- | --- |
| Webhook fair6cases | NOT_REACHED |
| Residual tenant queues14cases | NOT_REACHED |
| Partner/provider/email/retry10cases | NOT_REACHED |
| Contract authoritative platform/target F7 native | NOT_REACHED |
| Customer operation/lifecycle atomic native | NOT_REACHED |
| Existing six-file source-owner batch, including corrected legacy support fixture | NOT_REACHED |
| Notification/read concurrency, profile/address, portal-address, site SQL/native/continuation | NOT_REACHED |
| Capabilities/writer fences; existing support SQL and T17 support continuation3cases | NOT_REACHED |
| Sensitive signed contact native6cases; billing SQL/concurrency; verified redelivery SQL/concurrency | NOT_REACHED |
| Remaining contact/HTTP/release/customer UI/settings/effect/event/read/browser corridors | NOT_REACHED |

The prior506 webhook6/6 PASS, including cleanup, remains valid evidence for its own exact candidate. This b4ab failure supplies no new fairness result. The earlier4b cleanup failure remains failed. No native result is promoted from local PostgreSQL-core or mocked boundary units.

## Authentic new generated artifact

Completed clean job artifact11132392836 `gridex-rem-002-clean-replay`, created23:53:17Z, ZIP1025847bytes SHA256 `c74b7b0c11ef0c14550a98ab4fb3ded82cabe012cd3cffa46b0a83561851b4b1`, independently equals artifact metadata digest. It contains four file members: the clean log and exactly three generated schema/type members. No screenshot or later browser evidence is present.

| Member | Bytes | SHA256 |
| --- | ---: | --- |
| rem002-database.types.ts | 3386401 | bacea23d384ce21b264940d50bcebdedf4b30cebf6466ad8a491c957ac292143 |
| rem002-schema-snapshot/schema.sql | 5990340 | 1463caa887e94ce18678c3f5256106fc08a500508fb07eeb349ce9b7f9c5eee1 |
| rem002-schema-snapshot/schema.fingerprint.json | 1895 | 1d12775df13c251c521953ad377adbbabf7f3ecf3f84cc26b61991aece48dfbd |
| rem002-clean-replay.log | 1492751 | 0ae7032a4d96f71a5a38af1afb564d40159cdc44bc4dce02e606074a7c99fed6 |

The fingerprint JSON independently declares algorithm `sha256/canonical-json/v1`, schemas `public` and `gridex_received_sources`, and canonical hash `f23d14b7cb097368ef8eb5220973860bfd4dc8dc533cdc7596fa200a7925749c`. All three generated members differ from the currently committed genuine4b artifact bytes. Exact expected new public function names for redelivery, sensitive contact, lifecycle intent and fair email/retry claims are present in the generated types. Private ledger tables are outside this public type generation scope.

Actual schema-capture log marker:23:52:43.1383173Z. Exact final types evidence is `Applied Supabase types nullability overrides: rem002-database.types.ts` at23:52:51.1736271Z. ZIP DOSmtime is23:52:42 for schema/fingerprint and23:52:50 for types; DOSmtime has two-second granularity and no timezone guarantee. The precise finalization log timestamp, not an invented replay-end timestamp, can support the manifest generated_at. The earlier internal replay fingerprint marker at23:52:40.8200859Z is distinct from this later canonical JSON snapshot hash.

All four members were extracted privately at `/workspace/scratch/b08749f7eca6/ci-evidence/candidate-b4ab9d36/11132392836/`, directory0700/file0600. Every member has zero `sb_secret_`/`sb_publishable_` and compact-JWT pattern matches; raw logs/fixture rows were not published in this report. Root can adopt the exact three generated members under their normal repository paths and update manifest provenance; this report makes no such source mutation.

## Real restore fingerprint qualification

Artifact11132218548 `tenantservice-upgrade-restore-proof`, created23:53:01Z: ZIP1126bytes SHA256 `8fa74a1244bed1057b3322aebfd908b6e87ae1f03418b48645c650f4fc2e3313` equals metadata digest. Sole sanitized member `tenantservice-upgrade-restore.log`2709bytes SHA256 `c13bdc35346d9374dc34380237f0ffc80890e60569f797e1a8001ff323024c2e`; zero sb/compact-JWT patterns. Privately extracted under sibling directory11132218548.

The safe saved failure is the comparison of `data-before.sha256` and `data-after.sha256`: first difference byte66,line2. The production fingerprint SQL emits two64-character hashes plus newlines: first synthetic application/Auth row graph, second supplemental owners and ACL/defaultACL, including grantor/grant-option semantics across non-system schemas excludingcron. Thus the observed comparison supports matching first row-data hash, with the first mismatch in the supplemental ownership/ACL digest. This classification is inferred from the actual SQL and byte/line evidence; there is no per-object diagnostic identifying which owner/ACL/defaultACL differs. The private detailed fingerprints are intentionally removed by cleanup.

Actual source postgres remains nonsuperuser; the existing local `supabase_admin` restore authority passed. The real stream now passes both the previous SET ROLE and missing-public-schema barriers. It is still not an accepted backup/restore parity run: supplemental catalog parity failed before shared schema/functions/RLS/ACL comparison, restored current authorization proof, post-proof no-effects check and final comparison to committed clean schema artifacts.

## Ancillary automatic workflows

| Run / job | Actual result | Limit |
| --- | --- | --- |
| fullE2E36793102788 smoke110150303109 | FAILED14/15 | Sole migrations failure is the old type-manifest tail; no runtime failure assigned to the14successful checks. |
| fullE2E36793102788 coverage110150303262 | SUCCESS | 483files/6954tests PASS; measured coverage ratchet PASS at23:52:54.4217537Z. |
| fullE2E36793102788 pr-certificate110151075833 | FAILED | Required deterministic PR gate failures retained. Full/runtime/realcustomer/nightly jobs SKIPPED. |
| browser36793102841 public110150303520 | SUCCESS4/4 | Public browser14.2s; authenticated staging, k6load/soak and ZAP jobs SKIPPED. |
| Ediel36793102758 targeted110150302537 | SUCCESS | Scoped masterplan-v2 regressions; not all tenant/API/browser acceptance. |
| tenant36793102842 integrity110150303285 | SUCCESS | Scoped tenant regression. |

## Continuation

Next concrete local gaps are to adopt the authentic new generated files/manifest; correct the old pr164 test's explicit service actor setup while preserving its authorization denial checks; preserve the existing source budget by bounded extraction/splitting rather than raising it; and diagnose the supplemental real restore owner/ACL difference safely. After meaningful changed bytes are frozen/published, the new automatic run must qualify exact integrated native corridors and remaining original requirements. No unchanged rerun or whole-masterplan acceptance is claimed.
