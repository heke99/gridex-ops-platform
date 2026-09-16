# PR310 schema grant dispositions — 2026-09-15

Status: PARTIAL. Reference and release gates unchanged. Full-schema source
artifact10394485748 on335f987f is the evidence basis. ZIP SHA256
4009f365e8b7e255611992a12c031df159da2e16a4e46875af25593668d4aecb.
Reference document e404dd6b8493da3332e15fde7622ef22098157d7933d98c0bc0d3992e3818106;
replay document4b5d003fea640f0f2f52a3e410fc07a01988e92f5bc6cfc8b3055ec9c2709755.

## Exact scope and material distinction

There are1512 added relation grant rows and24 removed, with no changed rows.
Most additions attach to62 relations absent from the reference, but72 attach
to12 existing relations. These are not automatically accepted as new schema.
Existing-table additions comprise24 administrative privileges on6 operational
tables and48 privileges on3 control views plus3 inbound processing tables.

The six operational tables are batch4c_security_checks,
customer_duplicate_resolution_events, customer_lifecycle_decisions,
customer_merge_events, customer_readiness_snapshots, document_ai_extractions.
Each adds authenticated MAINTAIN, REFERENCES, TRIGGER and TRUNCATE; the reference
retains SELECT/INSERT/UPDATE/DELETE. The exact immutable BL-001 migration
20260809143000_gridex_ops_bl_001_write_permission_hardening.sql (SHA256
fb44170d175071caebd377d90daf3ab80a383bd9a9bce3a96196121c5616c93b), lines43–66,
authors explicit authenticated/service-role DML and row policies. Its GRANT does
not revoke older native default ALL privileges. TRUNCATE is outside RLS row
filtering, so this is a privilege difference, not a harmless policy rename.

A staged candidate removes only those four authenticated privileges on those
six tables. It preserves DML, other principals, policies and rows. It is not a
selected migration, not production-deployed and not yet an accepted schema.
A fixed owned PG17 fixture executes the exact whole source GRANT over legacy
ALL grants and deliberately deny-all synthetic RLS. It must prove original
TRUNCATE succeeds despite invisible rows, repaired TRUNCATE fails42501,
DML/service-role grants and policies/rows remain, missing final table rolls back
prior revokes, and repetition is idempotent. Source-selection check passes;
native SQL remains required. Synthetic RLS is not an application actor test.
CLI creation of a genuine migration filename is required before promotion.

The48 additions on gridex_automation_control_center_v,
gridex_batch_2b_live_control_tower_v, gridex_batch_2c_control_tower_summary_v,
inbound_ediel_match_attempts, inbound_ediel_parse_results and
inbound_email_attachments remain OPEN for source/application authorization
review. New-relation grants also remain OPEN; creation alone is not evidence
that every native default privilege is intended.

## Removed privileges

All24 removed relation rows are the eight anon table privileges on exactly
three tables: auth_email_events, company_customer_number_sequences and
inbound_processing_jobs. The schema policy review independently observes the
same three anon-restrictive guards removed. A missing anon policy is therefore
not by itself evidence of current anonymous table reachability. Do not restore
anonymous privileges merely to match the old dump. Effective PUBLIC/inherited
roles, functions and native actor SQL still require verification.

Three removed authenticated EXECUTE rows affect
gridex_db4b_archive_customer_registry_row(text,text,boolean,text),
gridex_default_customer_number_prefix(uuid), gridex_next_customer_number(uuid).
20260904120000_canonical_tenant_invariant_convergence.sql:76–86 explicitly
restricts PUBLIC/anon and retains service_role; earlier emergency convergence
also controls effective grants. Native effective-principal qualification is
required before these are accepted or reversed.

There are110 added function grant rows, including12 PUBLIC and7 anon entries.
The public additions include company-guard trigger functions, four DB2 helpers,
gridex_assert_same_company and gridex_emit_domain_event. Trigger-only functions
cannot be treated as arbitrary RPCs, while an invoker function still depends on
its reachable table privileges. These function-body/effective-role contracts
remain OPEN; no blanket approval is inferred from SECURITY INVOKER alone.

Schema ACL rows differ by public owner postgres versus pg_database_owner and
PUBLIC USAGE. The dump was emitted with no owner, and native/portable bootstrap
ownership differ. Keep this as an explicit projection/ownership limitation;
do not rewrite the reference or grant/revoke unrelated schema capabilities.
