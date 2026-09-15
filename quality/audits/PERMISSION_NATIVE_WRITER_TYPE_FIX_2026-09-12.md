# Task11a native fix1 — P07 UNION type correction

2026-09-12; published base2a4e6ff7f9402125f28b8a2bbb604fd9b6cf1ecb. Status IMPLEMENTED_NOT_VERIFIED, ready for scoped independent review; native NOT_ACCEPTED. All author edits stopped. Root owns publication and the next actual hosted gate.

## Actual failure and exact cause

OPS34682039649/job103522325029:37construction checks, source/seed, baseline9, baseline rollback, candidate first/ACL/row preservation, repeat, all-function ACL recovery andP01–P06 succeeded. P07 failed42804 at07:57:55.6058017Z then exact owned cleanup succeeded. No hosted rerun or local/native/production call was made by this author. This is partial native evidence, not complete Task11a acceptance.

P07 executes actual admitted upsert deny (already exercised by P05), then `replace_overrides` with allow_permissions=[masterdata.write], deny_permissions=[] and a distinct idempotency key. The newly executed branch is original `canonical_manage_platform_user_access(jsonb)` in20260802203000_canonical_runtime_consistency_hardening.sql lines626–659. Both INSERT UNION ALL arms at654/657 start `select null,v_target_user_id,...`; INSERT column1 is `user_permission_overrides.company_id uuid`. PostgreSQL17 resolves an all-unknown UNION output column to text before assignment, so this first column is text and cannot be assigned to uuid, accounting for42804. Both arms are type-resolved even when one unnest is empty. Upsert uses VALUES instead and inherits the target UUID type, explaining preceding native successes. [PostgreSQL17 UNION type-resolution rules](https://www.postgresql.org/docs/17/typeconv-union-case.html).

The source/type finding matches the exact hosted SQLSTATE; private server message/line was not retained, so no new raw-error reproduction is claimed. The complete writer path was read: UUID parameter declarations; text-array JSON parsing; actor/target checks; lock/request hash and idempotency lookup; overlap/catalog checks; global DELETE; failing UNION INSERT; audit/result writes. No fixture alias, role, grant or candidate resolver change explains this branch-specific mismatch.

`rg` found only one historical defining writer. Snapshot schema.sql repeats the untyped arms at3535/3538 and UUID target at67659. The actual `updateUserPermissionOverridesAction` in app/admin/users/[id]/actions.ts invokes replace_overrides via lib/admin/platformUserAccess.ts, so this is a supported original command defect, not permission granted by test setup. No live/deployed status is inferred from the snapshot.

## Scoped correction

Author reported the source defect and paused candidate edits for required root scope routing. Root authorized the minimal necessary point78 correction in the same genuine forward candidate. No user clarification or new migration timestamp was needed.

Appended the full admitted original writer with only its two global-company `null` expressions changed to `null::uuid`, followed by the exact original service-only ACL statements. Signature/declaration, every other function byte, actor/target admission, per-target lock, request hash, idempotency results, global-only scope, replacement validation, audits, other command branches and existing source permissions are preserved. The previous candidate content is byte-identical up to its final COMMIT; the writer/ACL addition is inserted immediately before that COMMIT. No historical source, source hash, slice pin, source order, schema shape or fixture grant was changed.

The same SDD and CI candidate copies now have SHA256 `ac1a2b63476e1eb509b622adbfbab924f8c143c65bac3a046a739df7ea9d4536`. The manifest diff is only forward_candidate.sha256. Original complete source composition remains SHA256 `c45021afb4b8e92415166d27ce4852d792bc190c1ac2adec3a37d3a03c1597ce`,33sources/82slices/28function slices. The original writer slice remains SHA256 `3182971b312009f5d1809f3463de3b2b9b4486da50625a109f4848daff9b5f1b`; its parent file remains `96a4402e5b642453a7358f55f9a5c93b2559a707df66b958a770318d10412930`. Unchanged original override table source remains the admitted UUID definition.

## Native expectations added, not yet executed

A new original-source baseline_P07 first proves an actual stored deny/audit/result through upsert, then invokes actual replacement, expects exactly42804 and requires complete fixture row-multiset equality. This tests rollback of the DELETE before the failed INSERT through the actual command statement/subtransaction. Baseline increases from9 to10; original-source execution still precedes candidate application.

Candidate P07 remains one of102 named cases and now executes four actual replacements after an initial global deny. Each step proves exact global override rows, same-company effective array/wrapper/context decisions, retained B-local override, exact result/audit counts, same-key replay returning the stored result without any row changes, and a changed request under that key rejecting23505 without any row changes.

| Command key | Allows | Denies | A effective masterdata.write / test.extra |
|---|---|---|---|
| replace-allow | masterdata.write | empty | true / false |
| replace-deny | empty | masterdata.write | false / false |
| replace-mixed | test.extra | masterdata.write | false / true |
| replace-empty | empty | empty | true / false |

The exact global row arrays are compared including all rows for the target (no is_active filter hiding unexpected rows). The B-local test.extra deny remains active after every global replacement. Existing P25 still tests original overlap23514/unknown-key22023 and unchanged rows; P26 retains actor42501. No test skips source writer behavior, uses direct writes as a replacement, changes company_id type or counts a setup error as permission denial.

Candidate construction now has102named cases/1029inline fixture.assert_true sites (P07 has109), plus separate expected-SQLSTATE calls and setup/ACL checks. These counts describe generated SQL, not runtime success. The existing runner already compares complete function/ACL/catalog/row state across candidate repeat/recovery, so it also covers the appended writer definition and source ACL stability without a new execution mechanism. OwnedPostgres, diagnostics, workflow and container/network/cleanup boundaries are unchanged; only the finite baseline summary label changes to10.

## Fresh local evidence

- Before implementation, two new tests failed: missing exact source-plus-two-casts writer in candidate and missing baseline_P07. After implementation, both pass.
- `python3 -B scripts/test-canonical-permission-native-admission.py`:21PASS.
- `python3 -B scripts/test-canonical-permission-native-fixture.py`:7PASS, including exact whole-writer substitution and service ACL preservation, original UUID target, baseline42804/unchanged rows and all four candidate replacement/idempotency/conflict constructions.
- `python3 -B scripts/test-canonical-permission-native-runner.py`:11PASS, including updated finite baseline10 contract and unchanged orchestration/rollback/diagnostic/target gates.
- `python3 -B scripts/canonical-permission-native-runner.py --check`:PASS;102cases/1029inline assertions/10baseline cases; candidate/composition hashes above; native NOT_RUN for this revised candidate.
- Direct Git/byte probe: prior candidate exactly preserved except appended writer/ACL; manifest only candidate hash changed; SDD/CI candidate copies equal.
- AST parsing of the4 changed Python files and `git diff --check`:PASS.

These are39construction tests and source-exact RED/GREEN assertions. They do not prove the cast change or added command cases execute in PostgreSQL; that requires the next reviewed actual native job. No local dependencies, Docker, psql or Supabase CLI were installed or invoked.

## Remaining gates and stop point

Root next: scoped independent review of this8-file author set, especially exact whole-source writer substitution/ACL and P07 transaction/idempotency SQL. Then reviewed publication and actual `canonical-permission-native-proof` OPS job. Its next expected sequence is original baseline10 including P07=42804 with unchanged rows, candidate first/repeat/ACL recovery, then all102cases including all P07 replacement variants, final catalog/row preservation and exact cleanup.

Task11a native remains NOT_ACCEPTED. Later P08–P28/C32/F16/S24/SX2 were not reached on the first hosted failure. Full11b policy stack/CRUD100/relationship18, managed Storage/token enforcement, complete replay/types/parity, migration registration and production acceptance remain open. No automatic rerun, source weakening, native acceptance or production claim.

Preserved root's unrelated dirty memory/audits and preexisting pycache; no author memory/index/commit/push/delegation. Relevant skills retained from Task11a, with systematic-debugging and TDD applied to this evidenced type-path defect. Only the report below and7implementation/candidate files are owned by this fix.

## Exact owned files at stop

| Path | SHA256 |
|---|---|
| `scripts/canonical-permission-native-fixture.py` | `c7350c51ba1b557ffa9aa7c7769b856fd49dea92cf27fd053eff26ee4e6225e3` |
| `scripts/canonical-permission-native-runner.py` | `db9ceb43d8cbe1d4c63c916625f815de17fd5c7114026848583b4a514f750b52` |
| `scripts/test-canonical-permission-native-fixture.py` | `19877ceb8ef74d77b365a76e6ca8af3e5f1bebe38fec00fae51e7ea68ccd381a` |
| `scripts/test-canonical-permission-native-runner.py` | `8c36e1f858fc8c0dd5b5d002845939e0a65104727459a103e7c37d74da6273d9` |
| `scripts/sql/canonical-permission-native-sources.json` | `f36227df8641d901eab06148e00730c34d19fe379bdb2a6391ddc7502404a188` |
| `scripts/sql/forward-candidates/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql` | `ac1a2b63476e1eb509b622adbfbab924f8c143c65bac3a046a739df7ea9d4536` |
| `.superpowers/sdd/2026-09-12-current-and-plan77-85/generated-migrations/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql` | `ac1a2b63476e1eb509b622adbfbab924f8c143c65bac3a046a739df7ea9d4536` |

The eighth file is this report. No changes to the previously approved workflow, source-admission Python or its tests, original SQL sources, private diagnostic handling, or ownership implementation.
