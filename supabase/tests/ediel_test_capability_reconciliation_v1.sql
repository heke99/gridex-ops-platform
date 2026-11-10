-- B4 native contract, Main-only execution in an isolated qualified database.
-- Host must supply an existing normally saved, current TGT configuration and
-- a genuinely authorized actor through these session settings. No invented
-- portal/certificate rows or direct capability-ready fixture is permitted.
-- A missing/invalid positive prerequisite FAILS; it is not an all-deny PASS.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE postgres;
DO $test$
declare
 company uuid:=current_setting('gridex.b4_company_id')::uuid;
 configuration uuid:=current_setting('gridex.b4_configuration_id')::uuid;
 actor uuid:=current_setting('gridex.b4_actor_id')::uuid;
 c public.ediel_active_test_configurations%rowtype;
 before_prod jsonb; after_prod jsonb; witness jsonb; result jsonb; foreign_company uuid;
 before_cap jsonb; denied boolean:=false;
begin
 select * into strict c from public.ediel_active_test_configurations where id=configuration and company_id=company;
 if current_user<>'postgres' or c.environment_type<>'tgt_test' then raise exception 'b4_native_fixture_admission_failed'; end if;
 select to_jsonb(t) into before_prod from public.ediel_production_state t where company_id=company;
 select to_jsonb(t) into before_cap from public.company_capabilities t where company_id=company and capability_code='ediel_test';
 begin
  perform public.canonical_reconcile_ediel_test_capability_v1(company,null,configuration);
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied or before_cap is distinct from (select to_jsonb(t) from public.company_capabilities t where company_id=company and capability_code='ediel_test') then raise exception 'b4_denied_actor_changed_capability'; end if;
 witness:=gridex_ediel_test_capability.witness_v1(company,configuration);
 if witness is null then raise exception 'b4_positive_normal_configuration_not_qualified'; end if;
 result:=public.canonical_reconcile_ediel_test_capability_v1(company,actor,configuration);
 if result->>'allowed'<>'true' or not exists(select 1 from public.canonical_tenant_operation_decision(company,'ediel.test.process') where allowed) then raise exception 'b4_current_tgt_did_not_allow'; end if;
 if gridex_ediel_test_capability.witness_v1(null,configuration) is not null
 or gridex_ediel_test_capability.witness_v1(company,null) is not null then raise exception 'b4_missing_scope_granted'; end if;
 select company_id into foreign_company from public.company_capabilities where company_id<>company limit 1;
 if foreign_company is not null and gridex_ediel_test_capability.witness_v1(foreign_company,configuration) is not null then raise exception 'b4_foreign_configuration_granted'; end if;
 -- A historical/manual ready flag is not a current basis. This deliberately
 -- corrupts only the test transaction, proving the read-side guard denies it.
 update public.company_capabilities set configuration='{}'::jsonb where company_id=company and capability_code='ediel_test';
 if exists(select 1 from public.canonical_tenant_operation_decision(company,'ediel.test.process') where allowed) then raise exception 'b4_historical_flag_granted'; end if;
 perform public.canonical_reconcile_ediel_test_capability_v1(company,actor,configuration);
 -- Settings is a real writer without the historical snapshot trigger.
 update public.ediel_system_test_settings set is_active=false where id=c.system_test_settings_id and company_id=company;
 if exists(select 1 from public.company_capabilities where company_id=company and capability_code='ediel_test' and enabled)
 or exists(select 1 from public.canonical_tenant_operation_decision(company,'ediel.test.process') where allowed) then raise exception 'b4_settings_deactivation_not_denied'; end if;
 if gridex_ediel_test_capability.witness_v1(company,configuration) is not null then raise exception 'b4_inactive_settings_witness'; end if;
 result:=public.canonical_reconcile_ediel_test_capability_v1(company,actor,configuration);
 if result->>'allowed'<>'false' then raise exception 'b4_invalid_reconcile_granted'; end if;
 select to_jsonb(t) into after_prod from public.ediel_production_state t where company_id=company;
 if before_prod is distinct from after_prod then raise exception 'b4_production_state_changed'; end if;
 raise notice 'B4_NATIVE_CURRENT_TGT_AND_SETTINGS_INVALIDATION_PASS';
end;
$test$;
-- Exercise each selected real writer in a subtransaction, retaining the exact
-- original source rows after each variant. Only a private sentinel is caught;
-- failed assertions/errors propagate and cannot become a PASS.
DO $test$
declare
 company uuid:=current_setting('gridex.b4_company_id')::uuid;
 configuration uuid:=current_setting('gridex.b4_configuration_id')::uuid;
 actor uuid:=current_setting('gridex.b4_actor_id')::uuid;
 c public.ediel_active_test_configurations%rowtype;
 r public.ediel_route_profiles%rowtype;
 target record; result jsonb; before_foreign jsonb; affected bigint;
begin
 -- Previous block intentionally deactivated settings; restore the original
 -- active value in this rollback-only contract before independent variants.
 select * into strict c from public.ediel_active_test_configurations where id=configuration and company_id=company;
 update public.ediel_system_test_settings set is_active=true where id=c.system_test_settings_id and company_id=company;
 select * into strict r from public.ediel_route_profiles where id=c.route_profile_id and company_id=company;
 select coalesce(jsonb_agg(to_jsonb(t) order by company_id,capability_code),'[]'::jsonb) into before_foreign
 from public.company_capabilities t where company_id<>company;
 for target in select * from (values
  ('ediel_actor_settings',c.actor_profile_id),('ediel_route_profiles',c.route_profile_id),
  ('communication_routes',r.communication_route_id),('ediel_active_test_configurations',c.id),
  ('ediel_system_test_settings',c.system_test_settings_id),('ediel_counterparties',(select test_portal_counterparty_id from public.ediel_system_test_settings where id=c.system_test_settings_id))
 ) v(table_name,id)
 loop
  result:=public.canonical_reconcile_ediel_test_capability_v1(company,actor,configuration);
  if result->>'allowed'<>'true' then raise exception 'b4_writer_positive_prerequisite_missing'; end if;
  begin
   -- This setting is the real canonical actor writer's snapshot bypass. The
   -- B4 invalidator must remain effective independently of it.
   perform set_config('gridex.skip_ediel_snapshot_trigger','on',true);
   execute format('update public.%I set updated_at=clock_timestamp() where id=$1 and company_id=$2',target.table_name) using target.id,company;
   get diagnostics affected = row_count;
   if affected<>1 then raise exception 'b4_writer_target_missing'; end if;
   if exists(select 1 from public.company_capabilities where company_id=company and capability_code='ediel_test' and enabled)
    or exists(select 1 from public.canonical_tenant_operation_decision(company,'ediel.test.process') where allowed) then raise exception 'b4_real_writer_failed_to_invalidate:%',target.table_name; end if;
   raise exception 'b4_variant_rollback' using errcode='B4001';
  exception when sqlstate 'B4001' then null;
  end;
 end loop;
 if before_foreign is distinct from (select coalesce(jsonb_agg(to_jsonb(t) order by company_id,capability_code),'[]'::jsonb) from public.company_capabilities t where company_id<>company) then raise exception 'b4_other_tenant_changed'; end if;
 raise notice 'B4_NATIVE_REAL_WRITER_INVALIDATION_PASS';
end;
$test$;
-- F1: Main supplies the exact existing mailbox used by the normally saved
-- positive configuration. No mailbox/source/credential fixture is created.
-- Start/finish field sets follow markMailboxPollStarted/markMailboxPollFinished.
DO $test$
declare
 company uuid:=current_setting('gridex.b4_company_id')::uuid;
 configuration uuid:=current_setting('gridex.b4_configuration_id')::uuid;
 actor uuid:=current_setting('gridex.b4_actor_id')::uuid;
 v_mailbox uuid:=current_setting('gridex.b4_mailbox_id')::uuid;
 before_witness jsonb; before_cap jsonb; after_cap jsonb; result jsonb;
begin
 if not exists(select 1 from public.ediel_active_test_configurations c
  join public.ediel_route_profiles r on r.id=c.route_profile_id and r.company_id=c.company_id
  join public.ediel_mailboxes m on m.id=v_mailbox and m.environment='test' and m.is_active
   and (m.company_id=company or (m.company_id is null and m.is_shared_platform_mailbox))
  where c.id=configuration and c.company_id=company and
   (r.mailbox_id=m.id or (r.mailbox_id is null and m.company_id=company and r.mailbox in(m.mailbox_name,m.email_address)))) then
  raise exception 'b4_poll_positive_mailbox_binding_required';
 end if;
 result:=public.canonical_reconcile_ediel_test_capability_v1(company,actor,configuration);
 if result->>'allowed'<>'true' then raise exception 'b4_poll_positive_configuration_required'; end if;
 before_witness:=gridex_ediel_test_capability.witness_v1(company,configuration);
 select to_jsonb(t) into before_cap from public.company_capabilities t where company_id=company and capability_code='ediel_test';
 update public.ediel_mailboxes set last_polled_at=clock_timestamp(),locked_at=clock_timestamp(),
  locked_by='b4-isolated-native-contract',last_error=null,updated_at=clock_timestamp() where id=v_mailbox;
 if before_witness is distinct from gridex_ediel_test_capability.witness_v1(company,configuration)
  or not exists(select 1 from public.canonical_tenant_operation_decision(company,'ediel.test.process') where allowed) then
  raise exception 'b4_poll_start_changed_configuration_or_admission';
 end if;
 update public.ediel_mailboxes set last_successful_poll_at=clock_timestamp(),locked_at=null,
  locked_by=null,last_error=null,updated_at=clock_timestamp() where id=v_mailbox;
 select to_jsonb(t) into after_cap from public.company_capabilities t where company_id=company and capability_code='ediel_test';
 if before_witness is distinct from gridex_ediel_test_capability.witness_v1(company,configuration)
  or before_cap is distinct from after_cap
  or not exists(select 1 from public.canonical_tenant_operation_decision(company,'ediel.test.process') where allowed) then
  raise exception 'b4_poll_finish_changed_configuration_or_admission';
 end if;
 update public.ediel_mailboxes set is_active=false where id=v_mailbox;
 if exists(select 1 from public.canonical_tenant_operation_decision(company,'ediel.test.process') where allowed) then
  raise exception 'b4_mailbox_configuration_change_not_denied';
 end if;
 raise notice 'B4_NATIVE_POLL_BOOKKEEPING_PRESERVED_CONFIG_CHANGE_DENIED';
end;
$test$;
ROLLBACK;
