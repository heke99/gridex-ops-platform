# Independent final source review — remaining replay proposals

Verdict: **APPROVE both exact private proposals for bounded source review**, with no blocking mismatch found. This is not execution, native replay, full-source coherence, GEN, installation, publication or runtime acceptance. New canonical claims remain blocked pending fresh authenticated ref/custody; no alternate publication or producer path was used.

Reviewed workspace `/tmp/gridex-ops-final` at `6b3a51b2f84ea6dfaed6559a877d6db3c8130f77`; I authored neither proposal. This review writes only this report. No SQL/engine, tests, native/backend/GEN/CI, network or canonical source changes were performed.

## Exact approval identities

| Private proposal | SHA-256 |
| --- | --- |
| `/tmp/gridex-ops-core-completion-20261014/permission-catalog-derived-proposal.sql` | `1c2bdd4276b99f15d838a80adb1bb63def487e8db2e31405e5821264f4a7c5d9` |
| `/tmp/gridex-ops-core-completion-20261014/sc031-atomic-effect-private-proposal.sql` | `29a8213426de1eeb0be2ed29976846aef1622239347f269325f0005a9ea97e55` |

Read both complete proposals and accompanying `permission-catalog-replay-analysis.md` and `sc031-atomic-effect-private-source-assessment.md`; checked source definitions, guards and transformation/preservation structure independently. Fresh `sha256sum` matches both requested identities.

## Permission catalog derivative

The original native profile and the new canonical profile are paired alternatives, not independent column/ACL allowlists. Native retains exact raw ACL, owner/RLS/force-RLS and its entire ordered columns array; canonical retains the same owner/RLS/force-RLS plus its exact canonical ordered columns and exact 26 semantic ACL tuples. Both exclude only the fixed captured OID from admission, then preserve the actual incoming OID in the full before/after table comparison. Cross-profile combinations fail.

Canonical column order/nullability matches `01_db1_schema_repair_core_helpers_and_canonical_tables.sql:435` and committed schema: `id,key,name,description,category,is_active,created_at`, nullable key and NOT NULL active flag. Canonical permission-table SELECT/UPDATE for `gridex_ediel_retention_owner` is explicitly source-owned in `20261001000500_ediel_artifact_retention_decision_and_purge.sql:158`. The other three grantees retain all eight privileges each. I independently counted 26 unique tuples, all grantor postgres and all non-grantable. `aclexplode` aggregate retains grantor/grantee/privilege/grantable, maps PUBLIC explicitly, includes no DISTINCT and cannot silently discard unknown grants or duplicates. Raw ACL order is never manufactured or changed; NULL/extra/unknown ACLs fail the complete canonical equality.

Constraints and noninternal-trigger refusal remain unchanged. The seven INSERTs and all subsequent row/active-flag/assignment/raw-table checks are byte-for-byte the original tail beginning at the first source INSERT comment. The proposal only reads schema/ACL metadata and inserts missing source-owned permission keys. Existing rows, UUIDs, disabled flags and role_permissions assignments remain exact. Existing attribute conflicts refuse, rather than being repaired implicitly. Locks and the single original transaction retain rollback of all inserts on failure. No table reordering, new grants, assignment writes or business RPC was added.

## SC031 atomic effect derivative

The exact current and old body constants independently match their authoritative declarations, including all literal bytes:

- Old: 8,513 bytes, MD5 `575139caedf161f007a16b64873bb727`, SHA-256 `c384bcefd09417f9d5220f01de98d7139ac7b8f461fbac590edb8779a5ff260a`, extracted from sealed `effective-main-source.sql`.
- Current: 17,512 bytes, MD5 `4682314319fefd9d2d258b0d31b7b554`, SHA-256 `6d5e21a429db0d8d1a0e07a08bf391f0ae643118b20ac19d2059490feaf2f500`, extracted from immutable `20261014011520_ediel_sc031_source_owned_business_projection.sql`.

Normalization begins after every original 12-part/source/token/executable guard and before the unchanged executable invocation. The proposal preserves raw source SHA `bb0bd0cedeabc3ba40872eae8cead8b6a8a9ff298c567baa324a1b4044045b04`, executable SHA `af1652d62cadee0e0184af0574342c0d5104982705eab5b100c51fdf90afc02b`, lengths, transaction-token extraction and transport cleanup. Reversing the added declarations and normalization/restoration block reproduces the original effect apart from one added blank line before EXECUTE; no original guard or executed statement differs. Original effect SHA remains `a2a7e91e1bbb97e0b2d73171b1e0893fad9e4acf915ca620c02f25b8e6aa4a0d`.

The target must be the exact five-argument function, namespace/name, postgres-owned, postgres-only raw EXECUTE ACL, invoker PLpgSQL with volatile/parallel/strict/leakproof/search_path/cost/rows/default/argument-name/return/support/transform/binary/SQL-body attributes qualified explicitly. PUBLIC, app-role or otherwise altered function ACL is rejected before normalization. Missing target refuses through STRICT lookup. Both constants require literal and digest equality; only exact current468 or exact old575 incoming bodies qualify. Extra grants or an unknown same-signature body are not normalized.

For current468, CREATE OR REPLACE changes only the exact fetched definition's body, and whole non-prosrc `pg_proc` equality plus exact old575 body is checked immediately. The original sealed installer must then complete unchanged, including its whole-state and protected checks. The proposal rechecks the same OID/non-body row and old575 afterward, restores current468, and requires complete final `pg_proc` row equality to the incoming snapshot before transport cleanup. Existing old575 takes the no-normalization branch and must remain exactly old575; it receives no SC031 credit.

BEGIN/COMMIT cover normalization, unchanged eight-component execution, restoration and cleanup in one transaction. No exception handler swallows a refusal, and no intermediate COMMIT or external action is added. A failed source/attribute/module/late cleanup check therefore prevents a committed intermediate old body. No new privileges or business invocation are introduced. The temporary body is not a committed installation; runtime concurrent behavior has not been exercised.

Source inspection of the successful sealed complete-state branch confirms it consists of metadata observation/qualification and fixed catalog registration, with no target/business onboarding invocation. Other target occurrences are stored function definitions, signature metadata or ACL/owner DDL. In particular, a PERFORM inside a CREATE FUNCTION body is stored source, not an invocation during installation. This agrees with the accompanying finite AST assessment; this reviewer did not run another parser or SQL engine. The wrapper itself invokes only catalog/definition helpers plus the unchanged sealed installer.

## Limits and next gate

These approvals bind the exact private source bytes only. Neither adapter constitutes a ledger registration or establishes that the final current468 catalog equals the old sealed bb0 whole-state fingerprint. Current native old575 does not acquire SC031 completion through the old branch. Qualified producer execution must still prove both accepted branches, unknown-state refusal, full-row restoration and late-failure rollback, then establish current-main source applicability/coherent replay under existing custody. No claims, public refs, historical migration edits, transport staging changes or producer work were created by this review.
