# Bounded SQL UNION/UUID variant check

2026-09-12; reviewed candidate at d6d15df9. Read-only root follow-up using variant-analysis after the executed Task11a P07 defect/fix. No SQL, history, fixture or application changes. One original defect and its snapshot duplicate; **zero additional confirmed instances** in this finite lexical sweep. No full SQL parser or dynamic-SQL completeness claim.

The root cause is type resolution before typed assignment: both UNION arms supply an unknown NULL for company_id, so UNION resolves that column as text before INSERT targets UUID. The original supported replace_overrides path was confirmed and fixed by a forward candidate; original history and schema snapshot remain evidence. PostgreSQL17 native baseline P07 now proves42804 with unchanged rows; candidate P07 replacement/replay/conflict/rollback controls passed in job103523860197.

| Search | Result | Disposition |
|---|---|---|
| Exact `select null,v_target_user_id,permission_key` across repository SQL | 4 lines in2 statements | Original migration650–658 and schema.sql3532–3539 are the same writer, not two independent defects. |
| Leading untyped `SELECT NULL` with names abstracted | 19 lines | Besides that writer: direct INSERT SELECT statements or NULL paired with a typed text arm. These lack the all-unknown compound projection into UUID. |
| `INSERT INTO` statement containing UNION SELECT before its semicolon | 7 statements in6 files | Original writer+snapshot; corrected candidate;3 distinct safe forms, one duplicated in snapshot. |
| RETURN QUERY containing UNION then NULL in the same lexical statement | 0 files | No additional candidate in this shape. |
| WITH containing UNION before INSERT in the same lexical statement | 0 files | No additional CTE-to-INSERT candidate in this shape. |

Every returned candidate statement and all leading-NULL nonduplicate contexts were inspected. The broad INSERT pattern has5/7 irrelevant/safe matches, so expansion stopped after these bounded alternative shapes; no indiscriminate scan rule was added. Semicolon/comment/dynamic construction limitations remain explicit.

| Verdict | Severity/confidence | Evidence |
|---|---|---|
| Original writer defect, corrected forward | Medium / confirmed by native old42804 and corrected P07 | 20260802203000_canonical_runtime_consistency_hardening.sql651–658; candidate711–721. Actual platform action invokes this writer. Full-function exact substitution and original service ACL are preserved. |
| Snapshot duplicate | Informational / high | supabase/schema.sql3532–3539 repeats the original writer. It is not separate deployed-state evidence and was not rewritten. |
| Explicitly typed candidate | Informational / high, refuted | Both first-column NULL expressions are NULL::uuid. |
| Audit/identity unions | Informational / high, refuted | scripts/sql/canonical-auth-provisioning-legacy-admission.sql79: text discriminator, catalog OID and to_jsonb columns are typed consistently. |
| Count over typed source UNION | Informational / high, refuted | scripts/gridex-live-repair-post-apply.sql122: outer INSERT receives text check key and count; UNION uses existing energy_direction columns. |
| Tenant-integrity finding union | Informational / high, refuted | 20260827134553_tenant_integrity_auditor_v1.sql163 and schema.sql47791: UUID identity/company expressions derive from typed rows; first-arm text casts and jsonb_build_object type the remaining columns. |
| Other leading NULL forms | Informational / high, refuted for this cause | Energy remediation INSERTs, Ediel matrix/policy seeds and analytics profile seed use direct INSERT SELECT. Invoice fee compatibility20260720190000:88/99 pairs NULL with jsonb_array_elements_text; output is intentionally text for JSON area metadata. |

Existing CI regression rule, already wired in canonical-permission-native-proof: run `python3 -B scripts/test-canonical-permission-native-fixture.py` followed by the dedicated owned `python3 -B scripts/canonical-permission-native-runner.py --native`. The construction assertion requires the entire original writer with exactly two UUID substitutions and original ACL; native baseline/candidate P07 detects loss of the fix, failed rollback, or duplicate/conflicting command effects. A blanket rule against historical NULL matches would reject immutable evidence and is not appropriate. No new gate or dependency is needed.
