-- Controlled reconciliation for the verified Gridex OPS live database.
-- Maps actual Supabase ledger rows to canonical files, records verified schema
-- effects, repairs the confirmed duplicate primary website credential once,
-- and mirrors capability readiness to the legacy compatibility row.

begin;

insert into public.canonical_migration_manifest(
  version,filename,checksum,applied_environment,verified_at,verification_source,
  release_identifier,schema_fingerprint,applied_ledger_version,applied_ledger_name,
  verification_kind,effect_verified,effect_evidence
)
values
  ('20260531080000','20260531080000_fix_customer_internal_notes_customer_fk.sql','7e9f3e5ea9fbb59f5d16b3ce62332924a8c6680c52c9caa78fcabd73d89ae52c','production',now(),'live_ledger_name_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260531075508','fix_customer_internal_notes_customer_fk','ledger_alias',true,jsonb_build_object('relation','public.customer_internal_notes')),
  ('20260625110000','20260625110000_ediel_message_intents_foundation.sql','fbae1c1259fdbdc65ee5880878c8b9b6d40480352e43512c8caec02a2b928d15','production',now(),'live_ledger_name_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260625121236','ediel_message_intents_foundation','ledger_alias',true,jsonb_build_object('relation','public.ediel_message_intents')),
  ('20260625120000','20260625120000_ai_bi_reconciliation_approval_audit.sql','73daade130d9ca220f5331af474957e7c989e69db8dff7fe9099144d81fcb6a6','production',now(),'live_ledger_name_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260625125336','ai_bi_reconciliation_approval_audit','ledger_alias',true,jsonb_build_object('relations',jsonb_build_array('public.ai_list_imports','public.ai_list_import_rows','public.ai_list_discrepancies'))),
  ('20260626120000','20260626120000_gridex_manual_grid_owner_communication_pipeline.sql','335fa9593acbb32951250e1aa88b7c6914b1faadfd1d48fbfc6931fcbebc4aaf','production',now(),'live_ledger_name_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260626084231','gridex_manual_grid_owner_communication_pipeline','ledger_alias',true,jsonb_build_object('relations',jsonb_build_array('public.grid_owner_contact_channels','public.grid_owner_information_requests','public.manual_email_outbox','public.manual_inbound_messages'))),
  ('20260709150000','20260709150000_supplier_switch_automation_key_idempotency.sql','7b0d097baed204956259a87d261020d19240aeb4c2e7ece441267ed4c84a868b','production',now(),'live_ledger_name_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260709151611','supplier_switch_automation_key_idempotency','ledger_alias',true,jsonb_build_object('ledger_name_verified',true)),
  ('20260709160000','20260709160000_advisor_function_search_path.sql','4a2f3730c57980b7bd4613362e1c767aef171d827cc1224a7cea11ac14ffa20f','production',now(),'live_ledger_name_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260709152749','advisor_function_search_path','ledger_alias',true,jsonb_build_object('ledger_name_verified',true)),
  ('20260709161000','20260709161000_advisor_function_execute_revokes.sql','12ccd6d475d7d528763b47fa188b8310da7e907141b82d9ce5751bb7ec39e253','production',now(),'live_ledger_name_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260709152817','advisor_function_execute_revokes','ledger_alias',true,jsonb_build_object('ledger_name_verified',true)),
  ('20260709162000','20260709162000_advisor_security_invoker_views.sql','58a0f64c84a26ad8a299f0afb8ee0a91298a6f9b5b2fd66c55423341835eaa6c','production',now(),'live_ledger_name_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260709152838','advisor_security_invoker_views','ledger_alias',true,jsonb_build_object('ledger_name_verified',true)),
  ('20260709163000','20260709163000_advisor_rls_no_policy_hardening.sql','6e7ae6ae680084526b7ca141b69e96c17dc458ece3b95ed05563c80bdf1f7047','production',now(),'live_ledger_name_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260709152901','advisor_rls_no_policy_hardening','ledger_alias',true,jsonb_build_object('ledger_name_verified',true)),
  ('20260802010000','20260802010000_canonical_tenant_operation_policy_lifecycle.sql','257ff7b6e84466c0f90103116e94f18e0f2e56b4e381cb0c15e4ad5008307082','production',now(),'live_ledger_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260802010000','canonical_tenant_operation_policy_lifecycle','ledger',true,jsonb_build_object('relations',jsonb_build_array('public.canonical_audit_events','public.canonical_domain_events','public.canonical_event_outbox'))),
  ('20260802011000','20260802011000_canonical_ediel_production_state.sql','7f50878b2c23889c967bceab5aa85ed0361af7aad9b3a3784b688e6cbd2bb502','production',now(),'live_ledger_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260802011000','canonical_ediel_production_state','ledger',true,jsonb_build_object('relation','public.ediel_production_state')),
  ('20260802012000','20260802012000_ediel_configuration_snapshots.sql','fcbace3668721747a2761ae120f2488589bb54c1ebcf25e932dbcd8ee611cf62','production',now(),'live_ledger_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260802012000','ediel_configuration_snapshots','ledger',true,jsonb_build_object('relation','public.ediel_configuration_snapshots')),
  ('20260802013000','20260802013000_ediel_test_evidence_v2.sql','96f058911d2499fdf2f540e7b2db541cbbc0ffd5ba798858b349779497ecf46d','production',now(),'live_ledger_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260802013000','ediel_test_evidence_v2','ledger',true,jsonb_build_object('relations',jsonb_build_array('public.actor_test_attempts','public.actor_test_attempt_evidence','public.actor_test_manual_attestations'))),
  ('20260802014000','20260802014000_canonical_provisioning_access.sql','4fd103508d86a85ee41c168af90a25fdbbd546d17efea7ebcec91935c3c790fc','production',now(),'live_ledger_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260802014000','canonical_provisioning_access','ledger',true,jsonb_build_object('relations',jsonb_build_array('public.canonical_provisioning_requests','public.company_provisioning_jobs'))),
  ('20260802015000','20260802015000_canonical_backfill_constraints.sql','03be13ac213573978894b2261452c098ee0f082245e2387e60a0068ffffd9049','production',now(),'live_ledger_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260802015000','canonical_backfill_constraints','ledger',true,jsonb_build_object('relation','public.canonical_migration_manifest')),
  ('20260802160000','20260802160000_website_application_committed_canonical_event.sql','55c2511768bfa5cc132d4a3a29223e169c4bc43b5c9323dab3d50361b9a4e23c','production',now(),'live_ledger_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260802160000','website_application_committed_canonical_event','ledger',true,jsonb_build_object('function','public.project_website_application_committed_event')),
  ('20260802170000','20260802170000_canonical_security_convergence.sql','e34618a9cb0c780f3fd75034ab113e48d99a27d8983e5d0fcbfc4a53ee27370a','production',now(),'live_ledger_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260802170000','canonical_security_convergence','ledger',true,jsonb_build_object('relations',jsonb_build_array('public.canonical_readiness_shadow_comparisons','public.canonical_ediel_profile_identities'))),
  ('20260802180000','20260802180000_canonical_provisioning_privilege_convergence.sql','da32e713b3f3d4b34abefa381f8fac200f133f1ef4fe43892b333f60c9b03eeb','production',now(),'live_ledger_and_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,'20260802180000','canonical_provisioning_privilege_convergence','ledger',true,jsonb_build_object('privilege_convergence_verified',true)),
  ('20260802230000','20260802230000_public_contract_delivery_consistency.sql','e0c0cc58a7fa5cedced8c84211623b646e35f9441388f27140f89c978bc056b6','production',now(),'live_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,null,null,'schema_effect',true,jsonb_build_object('view','public.canonical_public_contract_delivery_readiness_v')),
  ('20260802231000','20260802231000_tenant_website_provisioning_guards.sql','8ff7ffba346f7d1f8d085279ba1045095d9d56a2e7f24c9715a5222b4f4c5b8c','production',now(),'live_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,null,null,'schema_effect',true,jsonb_build_object('relations',jsonb_build_array('public.tenant_website_installation_receipts'),'functions',jsonb_build_array('public.gridex_provision_tenant_website_client_v1','public.gridex_repair_duplicate_primary_website_client_v1'))),
  ('20260802232000','20260802232000_migration_truth_readiness.sql','dc977bb14a66bc4f12939437428198d3daf7bd174ada16ff42133b44405ef1e2','production',now(),'live_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,null,null,'schema_effect',true,jsonb_build_object('view','public.canonical_migration_readiness_v','function','public.gridex_refresh_platform_schema_state_v2')),
  ('20260802233000','20260802233000_security_definer_execution_lockdown.sql','890d50a81d5eee6e6201968250e3ba025adef0608ca8a926d7798e86ee153600','production',now(),'live_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,null,null,'schema_effect',true,jsonb_build_object('security_definer_execute_lockdown_verified',true)),
  ('20260803093000','20260803093000_platform_schema_runtime_columns_v3.sql','0795a6c34195efe355e4e0a15c1946eba1c5259a7afb51c8d670191a2dd77730','production',now(),'live_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,null,null,'schema_effect',true,jsonb_build_object('columns',jsonb_build_array('canonical_migration_manifest.applied_ledger_version','canonical_migration_manifest.applied_ledger_name','canonical_migration_manifest.verification_kind','canonical_migration_manifest.effect_verified','canonical_migration_manifest.effect_evidence'))),
  ('20260803093100','20260803093100_gridex_runtime_capabilities_v3.sql','b93af4c0f46274513dad17a7c3145c6c1563b0f21570eb655420738607e000f8','production',now(),'live_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,null,null,'schema_effect',true,jsonb_build_object('view','public.gridex_runtime_schema_capabilities_v3')),
  ('20260803093200','20260803093200_gridex_migration_governance_v3.sql','104554751e3418b051647150170f80884fb537747a4c399737f83852bcd16089','production',now(),'live_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,null,null,'schema_effect',true,jsonb_build_object('view','public.gridex_migration_governance_v3')),
  ('20260803093300','20260803093300_duplicate_primary_client_audit_contract_v3.sql','bd4ef630b6404162789efd00ccc612ef6c78f40c2d10a12a2af0ef45faf9b123','production',now(),'live_schema_effect_reconciliation','20260803093300-gridex-runtime-readiness-v3',null,null,null,'schema_effect',true,jsonb_build_object('function','public.gridex_repair_duplicate_primary_website_client_v1','audit_contract','canonical_v3'))
on conflict(version,filename) do update set
  checksum=excluded.checksum,
  applied_environment=excluded.applied_environment,
  verified_at=excluded.verified_at,
  verification_source=excluded.verification_source,
  release_identifier=excluded.release_identifier,
  applied_ledger_version=excluded.applied_ledger_version,
  applied_ledger_name=excluded.applied_ledger_name,
  verification_kind=excluded.verification_kind,
  effect_verified=excluded.effect_verified,
  effect_evidence=excluded.effect_evidence;

-- Supabase MCP recorded the first live deployment of the repaired RPC with an
-- automatic timestamp. Preserve it as an explicit live-ledger alias. Clean
-- databases do not receive this row because the automatic ledger version does
-- not exist there.
insert into public.canonical_migration_manifest(
  version,filename,checksum,applied_environment,verified_at,verification_source,
  release_identifier,schema_fingerprint,applied_ledger_version,applied_ledger_name,
  verification_kind,effect_verified,effect_evidence
)
select
  '20260803081939',
  'live-ledger-alias/20260803081939_duplicate_primary_client_audit_contract_v3.sql',
  'bd4ef630b6404162789efd00ccc612ef6c78f40c2d10a12a2af0ef45faf9b123',
  'production',now(),'live_supabase_mcp_ledger_alias',
  '20260803093300-gridex-runtime-readiness-v3',null,
  ledger.version::text,ledger.name,'ledger_alias',true,
  jsonb_build_object('canonical_version','20260803093300','canonical_filename','20260803093300_duplicate_primary_client_audit_contract_v3.sql')
from supabase_migrations.schema_migrations ledger
where ledger.version::text='20260803081939'
  and ledger.name='duplicate_primary_client_audit_contract_v3'
on conflict(version,filename) do update set
  checksum=excluded.checksum,
  applied_environment=excluded.applied_environment,
  verified_at=excluded.verified_at,
  verification_source=excluded.verification_source,
  release_identifier=excluded.release_identifier,
  applied_ledger_version=excluded.applied_ledger_version,
  applied_ledger_name=excluded.applied_ledger_name,
  verification_kind=excluded.verification_kind,
  effect_verified=excluded.effect_verified,
  effect_evidence=excluded.effect_evidence;

-- Once canonical migration versions have been registered by Supabase CLI,
-- promote their manifest rows from schema-effect evidence to exact ledger
-- mappings. Before that point the rows remain valid schema-effect attestations.
update public.canonical_migration_manifest manifest
set applied_ledger_version=ledger.version::text,
    applied_ledger_name=ledger.name,
    verification_kind='ledger',
    verified_at=now(),
    verification_source='canonical_supabase_ledger_mapping'
from supabase_migrations.schema_migrations ledger
where manifest.version in ('20260803093000','20260803093100','20260803093200','20260803093300')
  and ledger.version::text=manifest.version
  and ledger.name=regexp_replace(manifest.filename,'^[0-9]{14}_|\.sql$','','g');

-- Re-running does not create duplicate audit events once a single primary remains.
do $repair$
begin
  if (
    select count(*)
    from public.integration_api_clients
    where company_id='b3ad1bf6-fa45-41a6-8054-2e0862e82aca'::uuid
      and profile_key='tenant_website'
      and status='active'
      and deleted_at is null
      and coalesce(nullif(metadata->>'environment',''),'production')='production'
      and lower(coalesce(metadata->>'primary','true')) not in ('false','0','no')
  ) > 1 then
    perform public.gridex_repair_duplicate_primary_website_client_v1(
      'b3ad1bf6-fa45-41a6-8054-2e0862e82aca'::uuid,
      'production',
      'bf2f3755-4a84-446a-b361-b6aa7149c39a'::uuid,
      '14805078-5af1-466f-9e00-ad0896b02dfa'::uuid,
      'Keep the most recently used production website credential after verified duplicate-primary repair on 2026-08-03.'
    );
  end if;
end
$repair$;

update public.canonical_migration_manifest
set release_identifier='20260803093300-gridex-runtime-readiness-v3',
    schema_fingerprint=(select schema_fingerprint from public.gridex_runtime_schema_capabilities_v3),
    verified_at=coalesce(verified_at,now())
where effect_verified;

update public.platform_schema_state
set current_version='20260803093300-gridex-runtime-readiness-v3',
    is_ready=(select is_ready from public.gridex_runtime_schema_capabilities_v3),
    blocking_issues=(select to_jsonb(blocking_issues) from public.gridex_runtime_schema_capabilities_v3),
    verified_at=now(),
    updated_at=now()
where id=true;

commit;
