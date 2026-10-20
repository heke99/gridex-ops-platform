Finite source analysis, 2026-10-14, workspace `/tmp/gridex-ops-final`, observed HEAD `6b3a51b2f84ea6dfaed6559a877d6db3c8130f77`. The coordinator supplied actual clean/upgrade failures at immutable104143, jobs116046770876/116046770501. This reviewer independently traced source/schema but did not collect another native/backend/CI observation. Tests are not an oracle here; none were run.

Confirmed root cause: the forward's ordered pg_attribute array accepts only the previously captured OPS table layout, while canonical source creates a different seven-column physical layout and different nullability. This independently suffices to trigger permission_catalog_native_shape_changed_requires_review; an ACL-order guess is unnecessary.

| Column/property | Native expectation in104143 | Canonical source/schema |
| --- | --- | --- |
| physical order | id,key,name,description,created_at,is_active,category | id,key,name,description,category,is_active,created_at |
| key nullability | NOT NULL | nullable |
| is_active nullability | nullable | NOT NULL |
| id default/type/nullability | gen_random_uuid(),uuid,NOT NULL | identical |
| created_at default/type/nullability | now(),timestamptz,NOT NULL | identical |
| name/description/category types and defaults | text; no defaults | identical |
| is_active default/type | true,boolean | identical |

`supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql:435` creates the canonical table before later timestamped migrations. Its CREATE IF NOT EXISTS is repeated by20260522_db1_schema_repair_backfill_foundation.sql:431 and cannot reorder existing columns. The committed schema `supabase/schema.sql:122409` has the same canonical order and nullability.20260522_customer_flow_access_repair adds missing aliases/columns conditionally and a partial unique index; it does not impose key NOT NULL or reorder this already complete canonical table. A bounded source scan found no later exact-table column alteration that changes these attributes before104143. The explicit source defaults agree with both profiles.

The committed schema contains precisely the expected permissions_key_key UNIQUE(key) and permissions_pkey PRIMARY KEY(id), and no noninternal CREATE TRIGGER on public.permissions. Its permissions RLS enable statement is at180806; no force-RLS declaration appears for that relation. The original constraint/name/definition/validation and trigger guards should remain unchanged. A unique nullable key still supports the seven explicit non-null source-key INSERTs; changing historical rows/nullability to match the native shape is unnecessary and would violate preservation.

ACL qualification is separate. The immutable native expectation has three explicit grantee ACL entries, postgres/authenticated/service_role, each arwdDxtm: INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN, all granted by postgres without grant options. That is24 semantic tuples. Canonical20261001000500_ediel_artifact_retention_decision_and_purge.sql:158 explicitly adds SELECT,UPDATE on public.permissions to gridex_ediel_retention_owner. Thus the source-qualified canonical profile has26 tuples. A bounded scan found no subsequent explicit permissions-table revoke targeting that owner before104143. The coordinator explicitly authorized this exact26-tuple canonical profile. Actual raw aclitem order at the failed jobs was not observed by this reviewer and is not invented. The additional source-owned grant must not be revoked to make a captured native-only ACL string pass.

The private proposal is `/tmp/gridex-ops-core-completion-20261014/permission-catalog-derived-proposal.sql`, 14,074 bytes, SHA256 `1c2bdd4276b99f15d838a80adb1bb63def487e8db2e31405e5821264f4a7c5d9`. Immutable original104143 source SHA256 is `2ce4e07ee2dee8ffb352e0e387092e7eb8a9bc6802723d408b40b9e0671e4519`. No canonical file was edited. This reviewer authored the private proposed guard, so this note is not a noncoauthor final approval of its future canonical derivative.

The complete diff is bounded to five provenance comments, declarations for canonical ordered columns and the26 sorted ACL tuples, a read-only aclexplode aggregate, and replacement of the initial table-shape condition with two complete paired profiles. The original native expected_table/expected_columns branch is retained exactly in positive IS NOT DISTINCT FROM form. The separate canonical branch requires owner=postgres,RLS=true,force_rls=false, the entire canonical ordered column array, and the exact normalized ACL tuples. Grantor, grantee, privilege and grantable are all part of comparison; no DISTINCT drops duplicates, extra roles, grantors, privileges or grant options. PUBLIC is rendered explicitly and unexpected/unresolved role identities cannot equal the expected profile. Neither independent column/ACL allowlists nor cross-profile mixtures are accepted.

The original constraints and noninternal-trigger refusal remain byte-for-byte unchanged after the paired profile. All seven source-row definitions and exact INSERTs remain unchanged. Entire existing permissions rows are snapshotted and compared by UUID, preserving all attributes and disabled flags; preexisting source attributes still require review if they differ. INSERTs retain DO NOTHING/NOT EXISTS behavior. Existing role_permissions assignments remain snapshotted and exactly compared. Raw before_table remains untouched and after_table is still compared in full, preserving actual OID, raw ACL/order, owner and RLS. No privilege or table mutation was added; normalization only reads ACL metadata. Locks, transaction, unknown-state exception and final notification remain original. Any refusal rolls back the complete operation.

Source-diff qualification reconstructed the original exactly after removing the provenance prefix and reversing only the added declaration/initial-guard replacements. This is a code comparison, not executed SQL or a behavioral test. An eventual canonical artifact requires the coordinator's exact-path claim and independent noncoauthor reviews, then genuine existing-producer qualification. Its declared replay substitution must bind the immutable104143 source SHA separately from the artifact SHA, execute at a unique adjacent source window, omit the original executable input, and carry no fabricated historical/native ledger claim. The private proposal does not itself add any manifest or routing entry.

Relevant source SHA256 values:

- 01_db1 foundation: `85f3561be4d91cee063bbf626302de7726a09c5ce08743b250e62cee959bb5f2`.
- 20260522 backfill foundation: `aff5a3e4fb3aae6ebe682081cbce4876c5731be1c124650b19d8151abf6efc73`.
- 20260522 access repair: `7be989882e76861a0efcfb0ec53efb68c15955eb21b445b5b90c757c4c1977e2`.
- 20261001000500 grant source: `24a2026b0b37f42d02c242a0f218ab028f938f2affbc0f093355ef32c938468e`.
- Committed supabase/schema.sql: `ef8ade13f0876631c1c28fe228ac0f17588fae9b2026a951a2a44a51a64ecaeb`.

No SQL, native/business RPC, GEN, backend, migration or CI producer was run. Only the two coordinator-authorized private report/proposal files were written. No existing data damage, tenant-isolation success or full replay completion is claimed.
