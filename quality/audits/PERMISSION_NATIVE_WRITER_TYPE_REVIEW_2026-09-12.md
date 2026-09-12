# Task11a native fix1 — independent scoped review

## Spec Compliance

- ✅ **Spec compliant for reviewed hosted publication.** Reviewed the frozen six-file diff against published `2a4e6ff7f9402125f28b8a2bbb604fd9b6cf1ecb`, the fix brief including controller routing, and the author report. Revised candidate SHA256: `ac1a2b63476e1eb509b622adbfbab924f8c143c65bac3a046a739df7ea9d4536`. **Task11a native remains NOT_ACCEPTED.**
- The addition follows the explicit routing: full original `canonical_manage_platform_user_access(jsonb)` definition, only the two replacement-UNION company expressions changed to `null::uuid`, and the original service-role ACL statements. Existing candidate logic stays unchanged before the final transaction commit (`scripts/sql/forward-candidates/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql:546–800`). The manifest changes only the candidate hash (`scripts/sql/canonical-permission-native-sources.json:1044–1047`).
- Baseline P07 now expects original-source 42804 with row preservation. Candidate P07 exercises all four replacement shapes, keeps a B-local override, and checks stable replay/conflict outcomes. The baseline admission and receipt count both change from nine to ten (`scripts/canonical-permission-native-fixture.py:212–242,252,282`; `scripts/canonical-permission-native-runner.py:144–164`; `scripts/test-canonical-permission-native-runner.py:19–21`).

## Strengths

- **The correction fits the evidenced type path.** The original UNION arms both supplied an unknown NULL to a UUID target; PostgreSQL 17 resolves an all-unknown UNION output column as text. Explicit UUID typing fixes that column before INSERT assignment while preserving its global NULL value. This is a source/type conclusion consistent with the reported 42804, not a new native reproduction. The rule is confirmed by the [PostgreSQL 17 UNION type-resolution documentation](https://www.postgresql.org/docs/17/typeconv-union-case.html); source evidence is `supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql:650–658` and its unchanged admitted UUID table definition. The candidate casts are at `scripts/sql/forward-candidates/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql:714–717`.
- **Full-source preservation is enforceable.** The construction regression derives the expected entire writer from the admitted original and substitutes exactly the two known expressions, then checks one complete occurrence and the admitted original ACL block. It does not alter source pins or manufacture a writer stub (`scripts/test-canonical-permission-native-fixture.py:49–77`). The diff preserves actor/target checks, advisory lock, request hash, existing-result return, overlap/catalog validation, global-only mutation, and audit/result insertion (`scripts/sql/forward-candidates/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql:549–798`).
- **New controls test the command outcome.** Candidate P07 checks exact global key/effect arrays, retained local override, cumulative result/audit counts, effective array/wrapper/context decisions, replay equality with the stored result, and changed-request 23505 with complete fixture row equality. Baseline P07 seeds a real stored deny before testing failure, so its unchanged-row assertion can detect loss from the preceding DELETE (`scripts/canonical-permission-native-fixture.py:212–242`). Existing overlap/unknown-key and actor negatives remain in P25/P26 (`scripts/canonical-permission-native-fixture.py:272–282`).
- **The proof boundary is unchanged.** The existing runner still applies the exact candidate transactionally, checks first-application rows, repeat catalog/ACL stability, ACL recovery, all candidate cases and final rollback equality. The full writer now participates in those existing catalog comparisons. This diff changes neither ownership/network/privacy handling nor workflow execution (`scripts/canonical-permission-native-runner.py:144–181`; frozen diff contains only its baseline summary-label change).

## Issues

### Critical

None found.

### Important

None found.

### Minor

None raised.

## Cannot verify / evidence boundary

- ⚠️ The first hosted job's source/baseline9/ACL-repeat/recovery/P01–P06 successes are partial evidence for the prior candidate. Its P07 failure and cleanup success do not establish acceptance of this revision. The revised baseline P07 and replacement/replay/conflict cases have not executed natively.
- ⚠️ The reported 39 construction tests and hash/copy probes remain author evidence; no suite was rerun during review. The construction checks verify generation and exact source substitution, not PostgreSQL execution. Root must publish the reviewed bytes and inspect actual baseline10, candidate102, repeat/ACL recovery, preservation and exact-owned cleanup results before accepting Task11a.
- ⚠️ The previous review's staged F16/full-policy-composition distinction and outstanding Task11b CRUD100/relationship18, managed Storage/token, replay/types/parity, migration registration and production gates remain unchanged. This scoped review does not reopen or close them.

## Checks and Assessment

- Read the scoped frozen diff once in full; no output truncation, changed-file reread, Git command, local/native SQL, installation, implementation/index/memory mutation or delegation. Retained the previous task reviewer/Supabase source-preservation and verification discipline; checked official PostgreSQL 17 type-resolution documentation for the specific failure hypothesis. No additional source crawl or test run was necessary: the original writer/table path was already inspected in review1 and the full added body is present in this diff.
- **Task quality: Approved for reviewed hosted publication.** Findings: **0 Critical, 0 Important, 0 Minor**. The correction is limited to the authorized type repair and adds meaningful failure/replay controls. **Native NOT_ACCEPTED** until the revised hosted proof succeeds.
