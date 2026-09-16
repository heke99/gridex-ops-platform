# Native final-gate receipt: diagnostic verified, reconstruction still blocked

Status: PARTIAL. Diagnostic output VERIFIED; schema/privacy/ledger/types NOT ACCEPTED.
Code:7c6a7aa70bc95c4cef33cde4bc59721701482dcf.
Tree:65aaba852dbc62b115065e85fae398df5c265121.
Run34780512868; attempt1; branchcodex/gridex-parity-remediation-20260905; PR310.
This supersedes diagnostic-pending statements in the earlier diagnostic audit.

## Actual hosted results

Job103786555047 (residual-transitions) SUCCESS, completed2026-09-13T20:27:22Z.
Source rejection controls, selected full continuation, originals-absent full
continuation and owned cleanup all succeed.

Job103786554902 (ordinary-owned-continuation) FAILURE, completed20:24:38Z.
Source/cleanup/diagnostic tests succeed. The actual ordinary shell executes144
foundation,7 residual and513 timestamp stages;5 retained prerequisites; original
SQL absent. At20:24:34.551Z all18 existing required predicates are true. The next
unchanged fingerprint gate rejects at20:24:34.683Z:

expected=c70fa2f017f6ce3af3ff806d948f18b58a3c196e4bf94daa9304629a3926680c
actual=7664566cda0fbad62af3e5b07dfd4b6e4f6cb5dd33a9cf70d775618ba2efcc4d

The diagnostic output preserves the same fingerprint observed at6a65e75. At
20:24:35.115Z the original terminal handler reports SOURCE_LITERAL_IN_PRIVATE_ARTIFACT,
stateINTAKE_COMPLETE, disposalVERIFIED. The separate exact owned-container cleanup
also succeeds. Diagnostic collection does not replace or mask the rejection.

## Limited pinned-snapshot projection (20:24:34.765Z)

SnapshotSHA256=b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30.
FingerprintQuerySHA256=7c861698fe8d3034805ca0599a6679fe0eb8543679a00058fd1e242a8ea6fa28.

companies:7 additional columns: white_label_platform_id, market_role,
technical_contact_name, technical_contact_email, brp_name, brp_status, esett_status.
Additional constraint: companies_white_label_platform_id_fkey. Column order differs;
no missing column or type/nullability difference is reported in the limited projection.

ediel_message_intents: missing ediel_message_intents_customer_company_fk;
no projected column differences. The other11 target tables have no difference in
this projection. Both compared function bodies and security-definer flags match:
- gridex_contract_platform_readiness bodySHA256=a50829a17f1be73d1d79514da1985b2d20c23be326559aee3b777c61c6e35fbb
- gridex_contract_platform_readiness_internal_v1 bodySHA256=cd7464a2cdbbc5bcbfbbdd7b8196aeb032c190b08174c0a6a0d271edc3c9171e

This is NOT full defaults, constraint semantics, RLS, ACL, indexes, physical dropped
column ordinals or ledger verification. It cannot establish the only causes of the
fingerprint difference or justify changing the expected fingerprint.

Static source confirmation:20260521_actor_testing_go_live_module.sql:53-60 adds
the7 extra columns and the white-label FK. Retain source-backed behavior rather
than dropping it to fit an old dump. The September2 composite-key migration Step2
selects only tenant-classified tables; the preceding classification migration can
reclassify tables based on client grants. That is a concrete investigation lead,
NOT a native-proven explanation for this missing FK. Do not grant client access
merely to affect classification. No SQL/source/type baseline was changed here.

## Private-input provenance census (20:24:34.808Z)

Nine physical files contain protected markers. Four have prior recorded whole-input
names;5 have no corresponding record and are exact retained original source copies:

| Physical artifact | Exact original source | SHA256 | Marker count |
| --- | --- | --- | --- |
| fixture-226cae8839b7a028.sql | 20260522_db1_schema_repair_backfill_foundation.sql | aff5a3e4fb3aae6ebe682081cbce4876c5731be1c124650b19d8151abf6efc73 | 1 |
| fixture-5a1452c85f16be82.sql | 20260623090000_z01_route_profile_actor_setting_backfill.sql | 8258b4d57c93eb2193e108befd05026a609ba29a60deaa0507a17a899300847d | 1 |
| fixture-e4d02d02d35d3ae7.sql | 20260902100000_rpc_surface_and_permission_scope_corrections.sql | 9753cd0f10a120a32826286a0eeb08d6f7e2b51704014decf60243e5eaa1a919 | 1 |
| replay-source-120.sql | 01_db2b_preflight_views.sql | 884cc115dee1b169eae11ef37a2b319d894a85cff5971ebf050ad2be026e39d7 | 3 |
| replay-source-121.sql | 03_db2b_validation_views.sql | f84d355c54d20bd0fcd3f86426bcd0e56435a1e8713fad3ec7a239f480a2b5e5 | 3 |

Each hash was independently rechecked against its local immutable original and
migration-history manifest. The4 prior named artifacts are dedupe-whole-H2.sql,
prefix-1.sql, repair-whole-E2.sql and replay-source-1.sql. A recorded name is not
an acceptance exemption. Complete writer/handle/phase/staging/inode/hash provenance
must be checked, without publishing protected literals, output, customer data or
raw database definitions. No broad privacy exception or file-erasure fix was made.
This evidence concerns the isolated replay; it does not show production exfiltration.

## Boundaries and follow-up

CI publication/start and the owned workflow identity are fixed. Canonical admission
accounts600 inputs with0 unresolved (588 originals,7 explicit residuals,5 exclusions).
The old selector still reports588/2/5/5. Source accounting is not final effects.

Official managed lifecycle/ledger remains unsupported in the mandatory OPS route.
Generated types remain stale at migration tail20260911114443 and are not regenerated
from the failed diagnostic database. No production/main/deployment writes occurred.

Next: exact provenance repair with real negative tests/native privacy proof; prove
and fix the FK/classification boundary; reconcile all schema semantics in the
supported managed environment; establish real ledger; regenerate accepted types.

Skill routing: systematic debugging, source differential/fp-check and verification
before completion for this evidence checkpoint. No independent reviewer/subagent
or full UI/performance/security-scanner pass is claimed. Current status is solely
.agent-memory/current-state.md; points85/86 remain incomplete.
