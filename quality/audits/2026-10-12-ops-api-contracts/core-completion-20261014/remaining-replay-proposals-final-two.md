# Independent final source review: two private replay proposals

2026-10-14. Verdict: **approved for the bounded source review of these exact private bytes; no confirmed P1/P2 introduced**. This is not executable replay, native installation, full-source coherence, GEN, CI or production acceptance. I authored neither proposal. Reviewed canonical workspace `/tmp/gridex-ops-final`, observed HEAD `6b3a51b2f84ea6dfaed6559a877d6db3c8130f77`.

| Private proposal | Bytes | SHA256 |
| --- | ---: | --- |
| `permission-catalog-derived-proposal.sql` | 14074 | `1c2bdd4276b99f15d838a80adb1bb63def487e8db2e31405e5821264f4a7c5d9` |
| `sc031-atomic-effect-private-proposal.sql` | 50773 | `29a8213426de1eeb0be2ed29976846aef1622239347f269325f0005a9ea97e55` |

Both live under `/tmp/gridex-ops-core-completion-20261014/`. I read the proposals and accompanying source assessments, compared their actual SQL with the original immutable migration files, and independently computed the source/body hashes. Only this private report was written. No SQL execution, engine, tests, native/business RPCs, GEN, CI, network or canonical modification was performed.

## Permission catalog

Original `20261013104143_ops_api_seven_permission_catalog_keys.sql` is 9675 bytes, SHA256 `2ce4e07ee2dee8ffb352e0e387092e7eb8a9bc6802723d408b40b9e0671e4519`. The derivative adds a second complete profile to the initial metadata gate. The original native profile still pairs its entire ordered column array with its exact raw ACL and owner/RLS settings. The canonical profile pairs its entire ordered column array with exactly 26 semantic ACL tuples and the same owner/RLS settings. It does not accept independent mixtures of the two profiles.

Canonical columns agree with the actual CREATE TABLE in `supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql:435`: `id,key,name,description,category,is_active,created_at`, nullable key, NOT NULL active flag, and the declared types/defaults. The nullable unique key accepts the explicit non-null inserted keys. Canonical ACL adds only the source-owned retention-owner SELECT/UPDATE from `20261001000500_ediel_artifact_retention_decision_and_purge.sql:158` to the three existing ALL8 roles. I independently counted 26 unique tuples; every grantor is postgres and every tuple is nongrantable. The aggregate preserves grantor/grantee/privilege/grantability, explicit PUBLIC, multiplicity and unknown identity failures; it neither manufactures raw aclitem ordering nor mutates grants.

Constraints and noninternal-trigger refusal remain unchanged. Starting at the first original source INSERT comment, the entire remaining SQL is byte-identical to the original: all seven source INSERTs, complete existing-row snapshots, attribute conflict refusal, disabled-flag preservation, role_permissions preservation, full raw table ACL/OID before/after comparison, notification and transaction close. No reactivation, assignments, table reorder or privilege changes were added. Actual OID is excluded only from profile admission and still preserved afterward. Unknown metadata refuses and the original transaction rolls back inserts on a late mismatch.

## SC031 atomic effect

Original effect migration `20261014113214_ops_api_atomic_bb0b_authfree_effect.sql` is 19343 bytes, SHA256 `a2a7e91e1bbb97e0b2d73171b1e0893fad9e4acf915ca620c02f25b8e6aa4a0d`. Independent source comparisons show the original initial transport checks are unchanged (apart from a separating blank line), the original executable invocation is retained, and the entire original transport cleanup tail is byte-identical.

The sealed source independently hashes to `bb0bd0cedeabc3ba40872eae8cead8b6a8a9ff298c567baa324a1b4044045b04` at 966553 bytes. Removing exactly the original two transaction tokens gives 966540 bytes and SHA256 `af1652d62cadee0e0184af0574342c0d5104982705eab5b100c51fdf90afc02b`. No sealed installer bytes or 12-part qualifications were changed.

The two literal bodies independently occur exactly once in their authoritative files and match these hashes:

| Body | Bytes | MD5 | SHA256 |
| --- | ---: | --- | --- |
| Old sealed projection | 8513 | `575139caedf161f007a16b64873bb727` | `c384bcefd09417f9d5220f01de98d7139ac7b8f461fbac590edb8779a5ff260a` |
| Current SC031 projection | 17512 | `4682314319fefd9d2d258b0d31b7b554` | `6d5e21a429db0d8d1a0e07a08bf391f0ae643118b20ac19d2059490feaf2f500` |

Old source is the bb0b `effective-main-source.sql`, file SHA256 `c11997abcc9ed915954cf43eff9ed23a86e0ec3786a9059bfb025d8a042fa1c7`. Current source is immutable `20261014011520_ediel_sc031_source_owned_business_projection.sql`, file SHA256 `d4555df6177b1d702a4262fc0d305986e0e029bbf50124a285e5418e3beb3a89`.

Normalization begins only after all original transport/12-part/raw/token/executable gates. Signature, owner, ACL, argument/return ABI, language, config, security, volatility, parallelism, defaults and remaining declared function attributes must match the explicit source profile. Unknown literal/metadata or crossed literal/hash pairs refuse. Missing function fails the STRICT catalog read. The proposal changes only the exact current468 body to exact old575 through its fetched definition, then checks the same OID and every pg_proc field except prosrc. After unchanged sealed execution, that same old state is required again. The current branch then restores the current literal, and final comparison requires the complete pg_proc row to equal the incoming snapshot. The old575 branch remains old; it receives no SC031/current-main credit.

There is no direct business function invocation in the added adapter. The sealed atomic source contains no target-name occurrence. Target occurrences in effective-main source are its declaration, metadata/ACL references and the require_plan body declaration, rather than an installer invocation of that onboarding chain. The companion source assessment records the broader static statement classification. This review does not substitute source classification for observed execution of the dynamic installer or concurrency behavior.

BEGIN/COMMIT cover qualification, temporary replacement, sealed execution, restoration and cleanup. No added exception handler swallows a failure. A restore/body/identity mismatch therefore cannot commit the temporary state separately. pg_proc equality is a SQL composite-row assertion, not a claim to preserve tuple-system metadata such as xmin. No acceptance of an unknown module fingerprint was added; the original installer retains its complete-state gates while the exact old body is temporarily visible.

## Applicability limits

The resulting current468 catalog intentionally differs from the sealed old575 whole-module fingerprint. Neither proposal nor this review establishes a new sealed global fingerprint or current full selected-input proof. Source review cannot establish PL/pgSQL execution, successful native compile/replay, runtime traffic behavior, late-error rollback observation, concurrent catalog mutation behavior, clean/upgrade completion or tenant isolation. Those remain with the existing qualified producer and exact final canonical artifact/input manifest.

Fresh authenticated custody/file claims are reported blocked by CLI 401; I did not retry authentication or independently observe that response. These remain private proposals until fresh custody and canonical source ownership are established. No historical ledger rows, checksum replacement, applied migration claim or alternate producer route is authorized by this review. Any byte, path, routing or source-pin change requires a corresponding final applicability review.
