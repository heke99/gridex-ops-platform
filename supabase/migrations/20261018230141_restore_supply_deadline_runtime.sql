-- Restore deployment drift without replaying unrelated historical migrations.
-- Latest regulated helper: 20261001004331; normal wrapper: 20260930201111.
-- Existing activation functions, source ledgers, market data and original
-- evidence are never replaced or invoked by this installation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('gridex:supply-deadline-runtime-repair:v1',0));
DO $preflight$
DECLARE object_name text;existing text;
BEGIN
 FOREACH object_name IN ARRAY ARRAY['public.user_profiles','public.company_memberships','public.ediel_messages','public.customer_supply_periods','public.tenant_bilateral_agreements','public.tenant_actor_roles','public.tenant_ediel_profiles','gridex_received_sources.supply_source_transitions','gridex_received_sources.regulated_supply_ground_versions','gridex_received_sources.normal_switch_confirmations','gridex_received_sources.normal_supply_activations'] LOOP
  IF to_regclass(object_name) IS NULL THEN RAISE EXCEPTION 'supply_deadline_missing_relation: %',object_name;END IF;
 END LOOP;
 FOREACH object_name IN ARRAY ARRAY['public.gridex_actor_has_company_permission(uuid,uuid,text)','gridex_regulated_supply.lock_graph_v1()','gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamp with time zone)','public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)','public.gridex_customer_application_runtime_contract_v1()'] LOOP
  IF to_regprocedure(object_name) IS NULL THEN RAISE EXCEPTION 'supply_deadline_missing_function: %',object_name;END IF;
 END LOOP;
SELECT prosrc INTO existing FROM pg_proc WHERE oid=to_regprocedure('gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)');
 IF existing IS NOT NULL AND btrim(existing,E' \t\n\r') NOT IN ($known$DECLARE changed integer;activated integer;
BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') THEN RETURN jsonb_build_object('updated',0);END IF;
 WITH due AS (SELECT p.id FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_end_message_id AND tr.company_id=p.company_id JOIN public.ediel_messages m ON m.id=tr.source_message_id AND m.company_id=tr.company_id WHERE (p_company_id IS NULL OR p.company_id=p_company_id) AND coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p.company_id,'metering.write'),false) AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) AND p.status='ending' AND p.market_end_at<=now() AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) s WHERE s->>'id'=p.id::text AND (s->>'market_state_version')::bigint=p.market_state_version AND (s->>'market_end_at')::timestamptz=p.market_end_at) ORDER BY p.market_end_at,p.id LIMIT least(greatest(coalesce(p_limit,100),1),200) FOR UPDATE OF p SKIP LOCKED)
 UPDATE public.customer_supply_periods p SET status='ended',updated_at=now() FROM due WHERE p.id=due.id AND (p_company_id IS NULL OR p.company_id=p_company_id) AND p.status='ending';
 GET DIAGNOSTICS changed=ROW_COUNT;
 -- These are separate regulated market relationships. No ordinary Z03 or
 -- consumer-contract activation/notification is introduced by this profile.
 WITH due AS (
  SELECT p.id FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_message_id AND tr.company_id=p.company_id
  JOIN public.ediel_messages m ON m.id=tr.source_message_id AND m.company_id=tr.company_id
  JOIN gridex_received_sources.regulated_supply_ground_versions g ON g.id::text=p.metadata->>'sourceGroundId' AND g.company_id=p.company_id AND g.environment=m.environment
  JOIN public.tenant_bilateral_agreements ba ON ba.id=g.bilateral_agreement_id AND ba.company_id=g.company_id AND ba.environment=g.environment AND ba.counterparty_actor_id=g.dso_actor_id
  JOIN public.tenant_actor_roles role ON role.company_id=p.company_id AND role.environment=m.environment AND role.actor_id=g.legal_actor_id AND role.role_code='electricity_supplier' AND role.valid_from<=now() AND (role.valid_to IS NULL OR now()<role.valid_to)
  JOIN public.tenant_ediel_profiles profile ON profile.company_id=p.company_id AND profile.environment=m.environment AND profile.market='electricity' AND profile.is_enabled AND profile.valid_from<=now() AND (profile.valid_to IS NULL OR now()<profile.valid_to)
  WHERE (p_company_id IS NULL OR p.company_id=p_company_id) AND p.status='confirmed_by_grid_owner' AND p.source_process IN ('assigned_supply','production_receipt_obligation') AND p.market_start_at<=now()
   AND coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p.company_id,'metering.write'),false) AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
   AND gridex_regulated_supply.ground_current_v1(g.id,p.company_id,p.metering_point_id,p.market_start_at) IS TRUE
   AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND g.revoked_at IS NULL AND g.valid_from<=now() AND (g.valid_to IS NULL OR now()<g.valid_to) AND ba.is_enabled AND ba.source_reference=g.source_reference AND ba.valid_from<=now() AND (ba.valid_to IS NULL OR now()<ba.valid_to)
      AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) saved WHERE saved->>'id'=p.id::text AND (saved->>'market_state_version')::bigint=p.market_state_version AND (saved->>'market_start_at')::timestamptz=p.market_start_at AND saved->>'customer_id'=p.customer_id::text AND saved->>'metering_point_id'=p.metering_point_id::text AND saved->>'source_process'=p.source_process AND saved->'metadata'=p.metadata)
   ORDER BY p.market_start_at,p.id LIMIT least(greatest(coalesce(p_limit,100),1),200) FOR UPDATE OF p SKIP LOCKED FOR SHARE OF g,ba,role,profile)
 UPDATE public.customer_supply_periods p SET status='active',updated_at=now() FROM due WHERE p.id=due.id AND p.status='confirmed_by_grid_owner';
 GET DIAGNOSTICS activated=ROW_COUNT;RETURN jsonb_build_object('updated',changed+activated);

END$known$) THEN RAISE EXCEPTION 'supply_deadline_helper_conflict';END IF;
SELECT prosrc INTO existing FROM pg_proc WHERE oid=to_regprocedure('public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)');
 IF existing IS NOT NULL AND btrim(existing,E' \t\n\r') NOT IN ($known$DECLARE own record;result jsonb;activated integer:=0;cursor_row gridex_received_sources.normal_activation_sweep_cursors%rowtype;scope text:=coalesce(p_company_id::text,'all');
BEGIN
 result:=gridex_received_sources.advance_supply_before_normal_switch_v1(p_company_id,p_actor_user_id,p_limit);
 INSERT INTO gridex_received_sources.normal_activation_sweep_cursors(scope_key) VALUES(scope) ON CONFLICT DO NOTHING;
 SELECT * INTO cursor_row FROM gridex_received_sources.normal_activation_sweep_cursors WHERE scope_key=scope FOR UPDATE;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations c JOIN public.customer_supply_periods p ON p.id=c.period_id AND p.company_id=c.company_id WHERE (p_company_id IS NULL OR c.company_id=p_company_id) AND p.status='confirmed_by_grid_owner' AND c.market_start_at<=now() AND NOT EXISTS(SELECT FROM gridex_received_sources.normal_supply_activations a WHERE a.period_id=c.period_id) AND (cursor_row.last_start IS NULL OR (c.market_start_at,c.period_id)>(cursor_row.last_start,cursor_row.last_period))) THEN cursor_row.last_start:=NULL;cursor_row.last_period:=NULL;END IF;
 FOR own IN SELECT c.* FROM gridex_received_sources.normal_switch_confirmations c JOIN public.customer_supply_periods p ON p.id=c.period_id AND p.company_id=c.company_id
  WHERE (p_company_id IS NULL OR c.company_id=p_company_id) AND p.status='confirmed_by_grid_owner' AND c.market_start_at<=now() AND NOT EXISTS(SELECT FROM gridex_received_sources.normal_supply_activations a WHERE a.period_id=c.period_id)
   AND (cursor_row.last_start IS NULL OR (c.market_start_at,c.period_id)>(cursor_row.last_start,cursor_row.last_period))
  ORDER BY c.market_start_at,c.period_id LIMIT least(greatest(coalesce(p_limit,100),1),200) LOOP
  BEGIN
   PERFORM public.activate_customer_supply_v1(own.company_id,own.switch_id,own.source_message_id,NULL,p_actor_user_id,NULL);activated:=activated+1;
  EXCEPTION WHEN SQLSTATE '42501' OR raise_exception THEN
   -- A revoked/cancelled/changed scope stays held; the sweep cannot fabricate
   -- a new source decision or stop unrelated own candidates.
   NULL;
  END;
  UPDATE gridex_received_sources.normal_activation_sweep_cursors SET last_start=own.market_start_at,last_period=own.period_id WHERE scope_key=scope;
 END LOOP;
 RETURN jsonb_build_object('updated',coalesce((result->>'updated')::integer,0)+activated,'normalActivated',activated);
END$known$,$known$DECLARE own record;result jsonb;activated integer:=0;cursor_row gridex_received_sources.normal_activation_sweep_cursors%rowtype;scope text:=coalesce(p_company_id::text,'all')||':'||p_actor_user_id::text;
BEGIN
 -- Verify the actor before any helper/cursor work. A service credential alone
 -- is not a qualified tenant actor; rejected actors have no cursor effects.
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.user_id=p_actor_user_id AND (p_company_id IS NULL OR cm.company_id=p_company_id) AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL AND public.gridex_actor_has_company_permission(p_actor_user_id,cm.company_id,'metering.write') IS TRUE)
 THEN RETURN jsonb_build_object('updated',0,'normalActivated',0,'reason','execution_actor_not_qualified');END IF;
 result:=gridex_received_sources.advance_supply_before_normal_switch_v1(p_company_id,p_actor_user_id,p_limit);
 INSERT INTO gridex_received_sources.normal_activation_sweep_cursors(scope_key) VALUES(scope) ON CONFLICT DO NOTHING;
 SELECT * INTO cursor_row FROM gridex_received_sources.normal_activation_sweep_cursors WHERE scope_key=scope FOR UPDATE;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations c JOIN public.customer_supply_periods p ON p.id=c.period_id AND p.company_id=c.company_id WHERE (p_company_id IS NULL OR c.company_id=p_company_id) AND public.gridex_actor_has_company_permission(p_actor_user_id,c.company_id,'metering.write') IS TRUE AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) AND p.status='confirmed_by_grid_owner' AND c.market_start_at<=now() AND NOT EXISTS(SELECT FROM gridex_received_sources.normal_supply_activations a WHERE a.period_id=c.period_id) AND (cursor_row.last_start IS NULL OR (c.market_start_at,c.period_id)>(cursor_row.last_start,cursor_row.last_period))) THEN cursor_row.last_start:=NULL;cursor_row.last_period:=NULL;END IF;
 FOR own IN SELECT c.* FROM gridex_received_sources.normal_switch_confirmations c JOIN public.customer_supply_periods p ON p.id=c.period_id AND p.company_id=c.company_id
  WHERE (p_company_id IS NULL OR c.company_id=p_company_id) AND public.gridex_actor_has_company_permission(p_actor_user_id,c.company_id,'metering.write') IS TRUE AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) AND p.status='confirmed_by_grid_owner' AND c.market_start_at<=now() AND NOT EXISTS(SELECT FROM gridex_received_sources.normal_supply_activations a WHERE a.period_id=c.period_id)
   AND (cursor_row.last_start IS NULL OR (c.market_start_at,c.period_id)>(cursor_row.last_start,cursor_row.last_period))
  ORDER BY c.market_start_at,c.period_id LIMIT least(greatest(coalesce(p_limit,100),1),200) LOOP
  BEGIN
   PERFORM public.activate_customer_supply_v1(own.company_id,own.switch_id,own.source_message_id,NULL,p_actor_user_id,NULL);activated:=activated+1;
  EXCEPTION WHEN SQLSTATE '42501' OR raise_exception THEN
   -- A revoked/cancelled/changed scope stays held; the sweep cannot fabricate
   -- a new source decision or stop unrelated own candidates.
   NULL;
  END;
  UPDATE gridex_received_sources.normal_activation_sweep_cursors SET last_start=own.market_start_at,last_period=own.period_id WHERE scope_key=scope;
 END LOOP;
 RETURN jsonb_build_object('updated',coalesce((result->>'updated')::integer,0)+activated,'normalActivated',activated);
END$known$) THEN RAISE EXCEPTION 'supply_deadline_wrapper_conflict';END IF;
SELECT prosrc INTO existing FROM pg_proc WHERE oid=to_regprocedure('public.gridex_customer_application_runtime_contract_v1()');
 IF btrim(existing,E' \t\n\r') NOT IN ($known$with checks as (
  select
    to_regclass('public.supplier_switch_requests') is not null as supplier_switch_requests_exists,
    exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.supplier_switch_requests')
        and attname = 'communication_route_id' and attnum > 0 and not attisdropped
    ) as communication_route_id_exists,
    exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.supplier_switch_requests')
        and attname = 'ediel_route_profile_id' and attnum > 0 and not attisdropped
    ) as ediel_route_profile_id_exists,
    to_regclass('public.communication_routes') is not null as communication_routes_exists,
    to_regclass('public.ediel_route_profiles') is not null as ediel_route_profiles_exists,
    to_regprocedure('extensions.digest(text,text)') is not null as pgcrypto_digest_exists,
    to_regprocedure('public.gridex_set_grid_owner_request_idempotency_key()') is not null as request_idempotency_function_exists,
    coalesce(position(
      'extensions.digest' in pg_get_functiondef(to_regprocedure('public.gridex_set_grid_owner_request_idempotency_key()'))
    ) > 0, false) as request_idempotency_digest_qualified,
    exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = to_regclass('public.grid_owner_information_requests')
        and tgname = 'trg_grid_owner_information_requests_idempotency'
        and not tgisinternal
        and tgenabled <> 'D'
    ) as request_idempotency_trigger_enabled,
    to_regprocedure('public.gridex_lock_signed_customer_contract()') is not null as signed_contract_integrity_function_exists
)
select jsonb_build_object(
  'ready',
    supplier_switch_requests_exists
    and communication_route_id_exists
    and ediel_route_profile_id_exists
    and communication_routes_exists
    and ediel_route_profiles_exists
    and pgcrypto_digest_exists
    and request_idempotency_function_exists
    and request_idempotency_digest_qualified
    and request_idempotency_trigger_enabled
    and signed_contract_integrity_function_exists,
  'checks', jsonb_build_object(
    'supplier_switch_requests_exists', supplier_switch_requests_exists,
    'communication_route_id_exists', communication_route_id_exists,
    'ediel_route_profile_id_exists', ediel_route_profile_id_exists,
    'communication_routes_exists', communication_routes_exists,
    'ediel_route_profiles_exists', ediel_route_profiles_exists,
    'pgcrypto_digest_exists', pgcrypto_digest_exists,
    'request_idempotency_function_exists', request_idempotency_function_exists,
    'request_idempotency_digest_qualified', request_idempotency_digest_qualified,
    'request_idempotency_trigger_enabled', request_idempotency_trigger_enabled,
    'signed_contract_integrity_function_exists', signed_contract_integrity_function_exists
  )
)
from checks;$known$,$known$with checks as (
  select
    to_regclass('public.supplier_switch_requests') is not null as supplier_switch_requests_exists,
    exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.supplier_switch_requests')
        and attname = 'communication_route_id' and attnum > 0 and not attisdropped
    ) as communication_route_id_exists,
    exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.supplier_switch_requests')
        and attname = 'ediel_route_profile_id' and attnum > 0 and not attisdropped
    ) as ediel_route_profile_id_exists,
    to_regclass('public.communication_routes') is not null as communication_routes_exists,
    to_regclass('public.ediel_route_profiles') is not null as ediel_route_profiles_exists,
    to_regprocedure('extensions.digest(text,text)') is not null as pgcrypto_digest_exists,
    to_regprocedure('public.gridex_set_grid_owner_request_idempotency_key()') is not null as request_idempotency_function_exists,
    coalesce(position(
      'extensions.digest' in pg_get_functiondef(to_regprocedure('public.gridex_set_grid_owner_request_idempotency_key()'))
    ) > 0, false) as request_idempotency_digest_qualified,
    exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = to_regclass('public.grid_owner_information_requests')
        and tgname = 'trg_grid_owner_information_requests_idempotency'
        and not tgisinternal
        and tgenabled <> 'D'
    ) as request_idempotency_trigger_enabled,
    to_regprocedure('public.gridex_lock_signed_customer_contract()') is not null as signed_contract_integrity_function_exists,
    to_regprocedure('public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)') is not null as supply_deadline_rpc_exists,
    to_regprocedure('gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)') is not null as supply_deadline_helper_exists,
    to_regclass('gridex_received_sources.normal_activation_sweep_cursors') is not null as supply_deadline_cursor_exists,
    to_regclass('gridex_received_sources.normal_switch_confirmations') is not null as normal_confirmation_ledger_exists,
    to_regclass('gridex_received_sources.normal_supply_activations') is not null as normal_activation_ledger_exists,
    to_regprocedure('public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)') is not null as normal_activation_command_exists,
    to_regprocedure('gridex_regulated_supply.lock_graph_v1()') is not null as regulated_supply_lock_exists,
    to_regprocedure('gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamp with time zone)') is not null as regulated_supply_ground_guard_exists,
    coalesce(has_function_privilege('service_role',to_regprocedure('public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)'),'EXECUTE') AND NOT has_function_privilege('anon',to_regprocedure('public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)'),'EXECUTE') AND NOT has_function_privilege('authenticated',to_regprocedure('public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)'),'EXECUTE'),false) as supply_deadline_rpc_service_only,
    coalesce(NOT has_function_privilege('service_role',to_regprocedure('gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)'),'EXECUTE') AND NOT has_function_privilege('anon',to_regprocedure('gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)'),'EXECUTE') AND NOT has_function_privilege('authenticated',to_regprocedure('gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)'),'EXECUTE'),false) as supply_deadline_helper_private,
    coalesce((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('gridex_received_sources.normal_activation_sweep_cursors')) AND NOT has_table_privilege('service_role',to_regclass('gridex_received_sources.normal_activation_sweep_cursors'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_table_privilege('anon',to_regclass('gridex_received_sources.normal_activation_sweep_cursors'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_table_privilege('authenticated',to_regclass('gridex_received_sources.normal_activation_sweep_cursors'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),false) as supply_deadline_cursor_private,
    NOT EXISTS(SELECT FROM (VALUES('public.user_profiles','id'),('public.user_profiles','user_status'),('public.company_memberships','company_id'),('public.company_memberships','user_id'),('public.company_memberships','status'),('public.company_memberships','is_active'),('public.company_memberships','accepted_at'),('public.ediel_messages','id'),('public.ediel_messages','company_id'),('public.ediel_messages','raw_payload'),('public.ediel_messages','environment'),('public.customer_supply_periods','id'),('public.customer_supply_periods','company_id'),('public.customer_supply_periods','status'),('public.customer_supply_periods','market_end_at'),('public.customer_supply_periods','market_start_at'),('public.customer_supply_periods','source_end_message_id'),('public.customer_supply_periods','source_message_id'),('public.customer_supply_periods','market_state_version'),('public.customer_supply_periods','customer_id'),('public.customer_supply_periods','metering_point_id'),('public.customer_supply_periods','source_process'),('public.customer_supply_periods','metadata'),('public.customer_supply_periods','updated_at'),('public.tenant_bilateral_agreements','id'),('public.tenant_bilateral_agreements','company_id'),('public.tenant_bilateral_agreements','environment'),('public.tenant_bilateral_agreements','counterparty_actor_id'),('public.tenant_bilateral_agreements','is_enabled'),('public.tenant_bilateral_agreements','source_reference'),('public.tenant_bilateral_agreements','valid_from'),('public.tenant_bilateral_agreements','valid_to'),('public.tenant_actor_roles','company_id'),('public.tenant_actor_roles','environment'),('public.tenant_actor_roles','actor_id'),('public.tenant_actor_roles','role_code'),('public.tenant_actor_roles','valid_from'),('public.tenant_actor_roles','valid_to'),('public.tenant_ediel_profiles','company_id'),('public.tenant_ediel_profiles','environment'),('public.tenant_ediel_profiles','market'),('public.tenant_ediel_profiles','is_enabled'),('public.tenant_ediel_profiles','valid_from'),('public.tenant_ediel_profiles','valid_to'),('gridex_received_sources.supply_source_transitions','source_message_id'),('gridex_received_sources.supply_source_transitions','company_id'),('gridex_received_sources.supply_source_transitions','payload_hash'),('gridex_received_sources.supply_source_transitions','resulting_states'),('gridex_received_sources.regulated_supply_ground_versions','id'),('gridex_received_sources.regulated_supply_ground_versions','company_id'),('gridex_received_sources.regulated_supply_ground_versions','environment'),('gridex_received_sources.regulated_supply_ground_versions','bilateral_agreement_id'),('gridex_received_sources.regulated_supply_ground_versions','dso_actor_id'),('gridex_received_sources.regulated_supply_ground_versions','legal_actor_id'),('gridex_received_sources.regulated_supply_ground_versions','source_reference'),('gridex_received_sources.regulated_supply_ground_versions','revoked_at'),('gridex_received_sources.regulated_supply_ground_versions','valid_from'),('gridex_received_sources.regulated_supply_ground_versions','valid_to'),('gridex_received_sources.normal_switch_confirmations','period_id'),('gridex_received_sources.normal_switch_confirmations','company_id'),('gridex_received_sources.normal_switch_confirmations','market_start_at'),('gridex_received_sources.normal_switch_confirmations','switch_id'),('gridex_received_sources.normal_switch_confirmations','source_message_id'),('gridex_received_sources.normal_supply_activations','period_id'),('gridex_received_sources.normal_activation_sweep_cursors','scope_key'),('gridex_received_sources.normal_activation_sweep_cursors','last_start'),('gridex_received_sources.normal_activation_sweep_cursors','last_period')) expected(relation_name,column_name) WHERE NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=to_regclass(expected.relation_name) AND a.attname=expected.column_name AND a.attnum>0 AND NOT a.attisdropped)) as supply_deadline_runtime_columns_ready
)
select jsonb_build_object(
  'ready',
    supplier_switch_requests_exists
    and communication_route_id_exists
    and ediel_route_profile_id_exists
    and communication_routes_exists
    and ediel_route_profiles_exists
    and pgcrypto_digest_exists
    and request_idempotency_function_exists
    and request_idempotency_digest_qualified
    and request_idempotency_trigger_enabled
    and signed_contract_integrity_function_exists
    and supply_deadline_rpc_exists
    and supply_deadline_helper_exists
    and supply_deadline_cursor_exists
    and normal_confirmation_ledger_exists
    and normal_activation_ledger_exists
    and normal_activation_command_exists
    and regulated_supply_lock_exists
    and regulated_supply_ground_guard_exists
    and supply_deadline_rpc_service_only
    and supply_deadline_helper_private
    and supply_deadline_cursor_private
    and supply_deadline_runtime_columns_ready,
  'checks', jsonb_build_object(
    'supplier_switch_requests_exists', supplier_switch_requests_exists,
    'communication_route_id_exists', communication_route_id_exists,
    'ediel_route_profile_id_exists', ediel_route_profile_id_exists,
    'communication_routes_exists', communication_routes_exists,
    'ediel_route_profiles_exists', ediel_route_profiles_exists,
    'pgcrypto_digest_exists', pgcrypto_digest_exists,
    'request_idempotency_function_exists', request_idempotency_function_exists,
    'request_idempotency_digest_qualified', request_idempotency_digest_qualified,
    'request_idempotency_trigger_enabled', request_idempotency_trigger_enabled,
    'signed_contract_integrity_function_exists', signed_contract_integrity_function_exists,
    'supply_deadline_rpc_exists', supply_deadline_rpc_exists,
    'supply_deadline_helper_exists', supply_deadline_helper_exists,
    'supply_deadline_cursor_exists', supply_deadline_cursor_exists,
    'normal_confirmation_ledger_exists', normal_confirmation_ledger_exists,
    'normal_activation_ledger_exists', normal_activation_ledger_exists,
    'normal_activation_command_exists', normal_activation_command_exists,
    'regulated_supply_lock_exists', regulated_supply_lock_exists,
    'regulated_supply_ground_guard_exists', regulated_supply_ground_guard_exists,
    'supply_deadline_rpc_service_only', supply_deadline_rpc_service_only,
    'supply_deadline_helper_private', supply_deadline_helper_private,
    'supply_deadline_cursor_private', supply_deadline_cursor_private,
    'supply_deadline_runtime_columns_ready', supply_deadline_runtime_columns_ready
  )
)
from checks;$known$) THEN RAISE EXCEPTION 'supply_deadline_readiness_conflict';END IF;
 IF EXISTS(SELECT FROM (VALUES('public.user_profiles','id'),('public.user_profiles','user_status'),('public.company_memberships','company_id'),('public.company_memberships','user_id'),('public.company_memberships','status'),('public.company_memberships','is_active'),('public.company_memberships','accepted_at'),('public.ediel_messages','id'),('public.ediel_messages','company_id'),('public.ediel_messages','raw_payload'),('public.ediel_messages','environment'),('public.customer_supply_periods','id'),('public.customer_supply_periods','company_id'),('public.customer_supply_periods','status'),('public.customer_supply_periods','market_end_at'),('public.customer_supply_periods','market_start_at'),('public.customer_supply_periods','source_end_message_id'),('public.customer_supply_periods','source_message_id'),('public.customer_supply_periods','market_state_version'),('public.customer_supply_periods','customer_id'),('public.customer_supply_periods','metering_point_id'),('public.customer_supply_periods','source_process'),('public.customer_supply_periods','metadata'),('public.customer_supply_periods','updated_at'),('public.tenant_bilateral_agreements','id'),('public.tenant_bilateral_agreements','company_id'),('public.tenant_bilateral_agreements','environment'),('public.tenant_bilateral_agreements','counterparty_actor_id'),('public.tenant_bilateral_agreements','is_enabled'),('public.tenant_bilateral_agreements','source_reference'),('public.tenant_bilateral_agreements','valid_from'),('public.tenant_bilateral_agreements','valid_to'),('public.tenant_actor_roles','company_id'),('public.tenant_actor_roles','environment'),('public.tenant_actor_roles','actor_id'),('public.tenant_actor_roles','role_code'),('public.tenant_actor_roles','valid_from'),('public.tenant_actor_roles','valid_to'),('public.tenant_ediel_profiles','company_id'),('public.tenant_ediel_profiles','environment'),('public.tenant_ediel_profiles','market'),('public.tenant_ediel_profiles','is_enabled'),('public.tenant_ediel_profiles','valid_from'),('public.tenant_ediel_profiles','valid_to'),('gridex_received_sources.supply_source_transitions','source_message_id'),('gridex_received_sources.supply_source_transitions','company_id'),('gridex_received_sources.supply_source_transitions','payload_hash'),('gridex_received_sources.supply_source_transitions','resulting_states'),('gridex_received_sources.regulated_supply_ground_versions','id'),('gridex_received_sources.regulated_supply_ground_versions','company_id'),('gridex_received_sources.regulated_supply_ground_versions','environment'),('gridex_received_sources.regulated_supply_ground_versions','bilateral_agreement_id'),('gridex_received_sources.regulated_supply_ground_versions','dso_actor_id'),('gridex_received_sources.regulated_supply_ground_versions','legal_actor_id'),('gridex_received_sources.regulated_supply_ground_versions','source_reference'),('gridex_received_sources.regulated_supply_ground_versions','revoked_at'),('gridex_received_sources.regulated_supply_ground_versions','valid_from'),('gridex_received_sources.regulated_supply_ground_versions','valid_to'),('gridex_received_sources.normal_switch_confirmations','period_id'),('gridex_received_sources.normal_switch_confirmations','company_id'),('gridex_received_sources.normal_switch_confirmations','market_start_at'),('gridex_received_sources.normal_switch_confirmations','switch_id'),('gridex_received_sources.normal_switch_confirmations','source_message_id'),('gridex_received_sources.normal_supply_activations','period_id'),('gridex_received_sources.normal_activation_sweep_cursors','scope_key'),('gridex_received_sources.normal_activation_sweep_cursors','last_start'),('gridex_received_sources.normal_activation_sweep_cursors','last_period')) expected(relation_name,column_name) WHERE (expected.relation_name<>'gridex_received_sources.normal_activation_sweep_cursors' OR to_regclass(expected.relation_name) IS NOT NULL) AND NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=to_regclass(expected.relation_name) AND a.attname=expected.column_name AND a.attnum>0 AND NOT a.attisdropped)) THEN RAISE EXCEPTION 'supply_deadline_missing_column';END IF;
 IF to_regclass('gridex_received_sources.normal_activation_sweep_cursors') IS NOT NULL AND (
  NOT EXISTS(SELECT FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='scope_key' WHERE i.indrelid=to_regclass('gridex_received_sources.normal_activation_sweep_cursors') AND i.indisprimary AND i.indnatts=1 AND i.indkey[0]=a.attnum) OR
  (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('gridex_received_sources.normal_activation_sweep_cursors') AND attnum>0 AND NOT attisdropped)<>3
  OR EXISTS(SELECT FROM (VALUES('scope_key','text'),('last_start','timestamp with time zone'),('last_period','uuid')) expected(name,type) WHERE NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=to_regclass('gridex_received_sources.normal_activation_sweep_cursors') AND a.attname=expected.name AND format_type(a.atttypid,a.atttypmod)=expected.type AND a.attnum>0 AND NOT a.attisdropped))
 ) THEN RAISE EXCEPTION 'supply_deadline_cursor_conflict';END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS gridex_received_sources.normal_activation_sweep_cursors(scope_key text PRIMARY KEY,last_start timestamptz,last_period uuid);
ALTER TABLE gridex_received_sources.normal_activation_sweep_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_received_sources.normal_activation_sweep_cursors FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION gridex_received_sources.advance_supply_before_normal_switch_v1(p_company_id uuid,p_actor_user_id uuid,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE changed integer;activated integer;
BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') THEN RETURN jsonb_build_object('updated',0);END IF;
 WITH due AS (SELECT p.id FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_end_message_id AND tr.company_id=p.company_id JOIN public.ediel_messages m ON m.id=tr.source_message_id AND m.company_id=tr.company_id WHERE (p_company_id IS NULL OR p.company_id=p_company_id) AND coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p.company_id,'metering.write'),false) AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) AND p.status='ending' AND p.market_end_at<=now() AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) s WHERE s->>'id'=p.id::text AND (s->>'market_state_version')::bigint=p.market_state_version AND (s->>'market_end_at')::timestamptz=p.market_end_at) ORDER BY p.market_end_at,p.id LIMIT least(greatest(coalesce(p_limit,100),1),200) FOR UPDATE OF p SKIP LOCKED)
 UPDATE public.customer_supply_periods p SET status='ended',updated_at=now() FROM due WHERE p.id=due.id AND (p_company_id IS NULL OR p.company_id=p_company_id) AND p.status='ending';
 GET DIAGNOSTICS changed=ROW_COUNT;
 -- These are separate regulated market relationships. No ordinary Z03 or
 -- consumer-contract activation/notification is introduced by this profile.
 WITH due AS (
  SELECT p.id FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_message_id AND tr.company_id=p.company_id
  JOIN public.ediel_messages m ON m.id=tr.source_message_id AND m.company_id=tr.company_id
  JOIN gridex_received_sources.regulated_supply_ground_versions g ON g.id::text=p.metadata->>'sourceGroundId' AND g.company_id=p.company_id AND g.environment=m.environment
  JOIN public.tenant_bilateral_agreements ba ON ba.id=g.bilateral_agreement_id AND ba.company_id=g.company_id AND ba.environment=g.environment AND ba.counterparty_actor_id=g.dso_actor_id
  JOIN public.tenant_actor_roles role ON role.company_id=p.company_id AND role.environment=m.environment AND role.actor_id=g.legal_actor_id AND role.role_code='electricity_supplier' AND role.valid_from<=now() AND (role.valid_to IS NULL OR now()<role.valid_to)
  JOIN public.tenant_ediel_profiles profile ON profile.company_id=p.company_id AND profile.environment=m.environment AND profile.market='electricity' AND profile.is_enabled AND profile.valid_from<=now() AND (profile.valid_to IS NULL OR now()<profile.valid_to)
  WHERE (p_company_id IS NULL OR p.company_id=p_company_id) AND p.status='confirmed_by_grid_owner' AND p.source_process IN ('assigned_supply','production_receipt_obligation') AND p.market_start_at<=now()
   AND coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p.company_id,'metering.write'),false) AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
   AND gridex_regulated_supply.ground_current_v1(g.id,p.company_id,p.metering_point_id,p.market_start_at) IS TRUE
   AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND g.revoked_at IS NULL AND g.valid_from<=now() AND (g.valid_to IS NULL OR now()<g.valid_to) AND ba.is_enabled AND ba.source_reference=g.source_reference AND ba.valid_from<=now() AND (ba.valid_to IS NULL OR now()<ba.valid_to)
      AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) saved WHERE saved->>'id'=p.id::text AND (saved->>'market_state_version')::bigint=p.market_state_version AND (saved->>'market_start_at')::timestamptz=p.market_start_at AND saved->>'customer_id'=p.customer_id::text AND saved->>'metering_point_id'=p.metering_point_id::text AND saved->>'source_process'=p.source_process AND saved->'metadata'=p.metadata)
   ORDER BY p.market_start_at,p.id LIMIT least(greatest(coalesce(p_limit,100),1),200) FOR UPDATE OF p SKIP LOCKED FOR SHARE OF g,ba,role,profile)
 UPDATE public.customer_supply_periods p SET status='active',updated_at=now() FROM due WHERE p.id=due.id AND p.status='confirmed_by_grid_owner';
 GET DIAGNOSTICS activated=ROW_COUNT;RETURN jsonb_build_object('updated',changed+activated);

END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.ediel_advance_supply_deadlines_v1(p_company_id uuid,p_actor_user_id uuid,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE own record;result jsonb;activated integer:=0;cursor_row gridex_received_sources.normal_activation_sweep_cursors%rowtype;scope text:=coalesce(p_company_id::text,'all')||':'||p_actor_user_id::text;
BEGIN
 -- Verify the actor before any helper/cursor work. A service credential alone
 -- is not a qualified tenant actor; rejected actors have no cursor effects.
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.user_id=p_actor_user_id AND (p_company_id IS NULL OR cm.company_id=p_company_id) AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL AND public.gridex_actor_has_company_permission(p_actor_user_id,cm.company_id,'metering.write') IS TRUE)
 THEN RETURN jsonb_build_object('updated',0,'normalActivated',0,'reason','execution_actor_not_qualified');END IF;
 result:=gridex_received_sources.advance_supply_before_normal_switch_v1(p_company_id,p_actor_user_id,p_limit);
 INSERT INTO gridex_received_sources.normal_activation_sweep_cursors(scope_key) VALUES(scope) ON CONFLICT DO NOTHING;
 SELECT * INTO cursor_row FROM gridex_received_sources.normal_activation_sweep_cursors WHERE scope_key=scope FOR UPDATE;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations c JOIN public.customer_supply_periods p ON p.id=c.period_id AND p.company_id=c.company_id WHERE (p_company_id IS NULL OR c.company_id=p_company_id) AND public.gridex_actor_has_company_permission(p_actor_user_id,c.company_id,'metering.write') IS TRUE AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) AND p.status='confirmed_by_grid_owner' AND c.market_start_at<=now() AND NOT EXISTS(SELECT FROM gridex_received_sources.normal_supply_activations a WHERE a.period_id=c.period_id) AND (cursor_row.last_start IS NULL OR (c.market_start_at,c.period_id)>(cursor_row.last_start,cursor_row.last_period))) THEN cursor_row.last_start:=NULL;cursor_row.last_period:=NULL;END IF;
 FOR own IN SELECT c.* FROM gridex_received_sources.normal_switch_confirmations c JOIN public.customer_supply_periods p ON p.id=c.period_id AND p.company_id=c.company_id
  WHERE (p_company_id IS NULL OR c.company_id=p_company_id) AND public.gridex_actor_has_company_permission(p_actor_user_id,c.company_id,'metering.write') IS TRUE AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) AND p.status='confirmed_by_grid_owner' AND c.market_start_at<=now() AND NOT EXISTS(SELECT FROM gridex_received_sources.normal_supply_activations a WHERE a.period_id=c.period_id)
   AND (cursor_row.last_start IS NULL OR (c.market_start_at,c.period_id)>(cursor_row.last_start,cursor_row.last_period))
  ORDER BY c.market_start_at,c.period_id LIMIT least(greatest(coalesce(p_limit,100),1),200) LOOP
  BEGIN
   PERFORM public.activate_customer_supply_v1(own.company_id,own.switch_id,own.source_message_id,NULL,p_actor_user_id,NULL);activated:=activated+1;
  EXCEPTION WHEN SQLSTATE '42501' OR raise_exception THEN
   -- A revoked/cancelled/changed scope stays held; the sweep cannot fabricate
   -- a new source decision or stop unrelated own candidates.
   NULL;
  END;
  UPDATE gridex_received_sources.normal_activation_sweep_cursors SET last_start=own.market_start_at,last_period=own.period_id WHERE scope_key=scope;
 END LOOP;
 RETURN jsonb_build_object('updated',coalesce((result->>'updated')::integer,0)+activated,'normalActivated',activated);
END $$;
REVOKE ALL ON FUNCTION public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer) TO service_role;

create or replace function public.gridex_customer_application_runtime_contract_v1()
returns jsonb
language sql
stable
security invoker
set search_path to 'pg_catalog','public','extensions','pg_temp'
as $function$
with checks as (
  select
    to_regclass('public.supplier_switch_requests') is not null as supplier_switch_requests_exists,
    exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.supplier_switch_requests')
        and attname = 'communication_route_id' and attnum > 0 and not attisdropped
    ) as communication_route_id_exists,
    exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.supplier_switch_requests')
        and attname = 'ediel_route_profile_id' and attnum > 0 and not attisdropped
    ) as ediel_route_profile_id_exists,
    to_regclass('public.communication_routes') is not null as communication_routes_exists,
    to_regclass('public.ediel_route_profiles') is not null as ediel_route_profiles_exists,
    to_regprocedure('extensions.digest(text,text)') is not null as pgcrypto_digest_exists,
    to_regprocedure('public.gridex_set_grid_owner_request_idempotency_key()') is not null as request_idempotency_function_exists,
    coalesce(position(
      'extensions.digest' in pg_get_functiondef(to_regprocedure('public.gridex_set_grid_owner_request_idempotency_key()'))
    ) > 0, false) as request_idempotency_digest_qualified,
    exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = to_regclass('public.grid_owner_information_requests')
        and tgname = 'trg_grid_owner_information_requests_idempotency'
        and not tgisinternal
        and tgenabled <> 'D'
    ) as request_idempotency_trigger_enabled,
    to_regprocedure('public.gridex_lock_signed_customer_contract()') is not null as signed_contract_integrity_function_exists,
    to_regprocedure('public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)') is not null as supply_deadline_rpc_exists,
    to_regprocedure('gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)') is not null as supply_deadline_helper_exists,
    to_regclass('gridex_received_sources.normal_activation_sweep_cursors') is not null as supply_deadline_cursor_exists,
    to_regclass('gridex_received_sources.normal_switch_confirmations') is not null as normal_confirmation_ledger_exists,
    to_regclass('gridex_received_sources.normal_supply_activations') is not null as normal_activation_ledger_exists,
    to_regprocedure('public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)') is not null as normal_activation_command_exists,
    to_regprocedure('gridex_regulated_supply.lock_graph_v1()') is not null as regulated_supply_lock_exists,
    to_regprocedure('gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamp with time zone)') is not null as regulated_supply_ground_guard_exists,
    coalesce(has_function_privilege('service_role',to_regprocedure('public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)'),'EXECUTE') AND NOT has_function_privilege('anon',to_regprocedure('public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)'),'EXECUTE') AND NOT has_function_privilege('authenticated',to_regprocedure('public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)'),'EXECUTE'),false) as supply_deadline_rpc_service_only,
    coalesce(NOT has_function_privilege('service_role',to_regprocedure('gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)'),'EXECUTE') AND NOT has_function_privilege('anon',to_regprocedure('gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)'),'EXECUTE') AND NOT has_function_privilege('authenticated',to_regprocedure('gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)'),'EXECUTE'),false) as supply_deadline_helper_private,
    coalesce((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('gridex_received_sources.normal_activation_sweep_cursors')) AND NOT has_table_privilege('service_role',to_regclass('gridex_received_sources.normal_activation_sweep_cursors'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_table_privilege('anon',to_regclass('gridex_received_sources.normal_activation_sweep_cursors'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_table_privilege('authenticated',to_regclass('gridex_received_sources.normal_activation_sweep_cursors'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),false) as supply_deadline_cursor_private,
    NOT EXISTS(SELECT FROM (VALUES('public.user_profiles','id'),('public.user_profiles','user_status'),('public.company_memberships','company_id'),('public.company_memberships','user_id'),('public.company_memberships','status'),('public.company_memberships','is_active'),('public.company_memberships','accepted_at'),('public.ediel_messages','id'),('public.ediel_messages','company_id'),('public.ediel_messages','raw_payload'),('public.ediel_messages','environment'),('public.customer_supply_periods','id'),('public.customer_supply_periods','company_id'),('public.customer_supply_periods','status'),('public.customer_supply_periods','market_end_at'),('public.customer_supply_periods','market_start_at'),('public.customer_supply_periods','source_end_message_id'),('public.customer_supply_periods','source_message_id'),('public.customer_supply_periods','market_state_version'),('public.customer_supply_periods','customer_id'),('public.customer_supply_periods','metering_point_id'),('public.customer_supply_periods','source_process'),('public.customer_supply_periods','metadata'),('public.customer_supply_periods','updated_at'),('public.tenant_bilateral_agreements','id'),('public.tenant_bilateral_agreements','company_id'),('public.tenant_bilateral_agreements','environment'),('public.tenant_bilateral_agreements','counterparty_actor_id'),('public.tenant_bilateral_agreements','is_enabled'),('public.tenant_bilateral_agreements','source_reference'),('public.tenant_bilateral_agreements','valid_from'),('public.tenant_bilateral_agreements','valid_to'),('public.tenant_actor_roles','company_id'),('public.tenant_actor_roles','environment'),('public.tenant_actor_roles','actor_id'),('public.tenant_actor_roles','role_code'),('public.tenant_actor_roles','valid_from'),('public.tenant_actor_roles','valid_to'),('public.tenant_ediel_profiles','company_id'),('public.tenant_ediel_profiles','environment'),('public.tenant_ediel_profiles','market'),('public.tenant_ediel_profiles','is_enabled'),('public.tenant_ediel_profiles','valid_from'),('public.tenant_ediel_profiles','valid_to'),('gridex_received_sources.supply_source_transitions','source_message_id'),('gridex_received_sources.supply_source_transitions','company_id'),('gridex_received_sources.supply_source_transitions','payload_hash'),('gridex_received_sources.supply_source_transitions','resulting_states'),('gridex_received_sources.regulated_supply_ground_versions','id'),('gridex_received_sources.regulated_supply_ground_versions','company_id'),('gridex_received_sources.regulated_supply_ground_versions','environment'),('gridex_received_sources.regulated_supply_ground_versions','bilateral_agreement_id'),('gridex_received_sources.regulated_supply_ground_versions','dso_actor_id'),('gridex_received_sources.regulated_supply_ground_versions','legal_actor_id'),('gridex_received_sources.regulated_supply_ground_versions','source_reference'),('gridex_received_sources.regulated_supply_ground_versions','revoked_at'),('gridex_received_sources.regulated_supply_ground_versions','valid_from'),('gridex_received_sources.regulated_supply_ground_versions','valid_to'),('gridex_received_sources.normal_switch_confirmations','period_id'),('gridex_received_sources.normal_switch_confirmations','company_id'),('gridex_received_sources.normal_switch_confirmations','market_start_at'),('gridex_received_sources.normal_switch_confirmations','switch_id'),('gridex_received_sources.normal_switch_confirmations','source_message_id'),('gridex_received_sources.normal_supply_activations','period_id'),('gridex_received_sources.normal_activation_sweep_cursors','scope_key'),('gridex_received_sources.normal_activation_sweep_cursors','last_start'),('gridex_received_sources.normal_activation_sweep_cursors','last_period')) expected(relation_name,column_name) WHERE NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=to_regclass(expected.relation_name) AND a.attname=expected.column_name AND a.attnum>0 AND NOT a.attisdropped)) as supply_deadline_runtime_columns_ready
)
select jsonb_build_object(
  'ready',
    supplier_switch_requests_exists
    and communication_route_id_exists
    and ediel_route_profile_id_exists
    and communication_routes_exists
    and ediel_route_profiles_exists
    and pgcrypto_digest_exists
    and request_idempotency_function_exists
    and request_idempotency_digest_qualified
    and request_idempotency_trigger_enabled
    and signed_contract_integrity_function_exists
    and supply_deadline_rpc_exists
    and supply_deadline_helper_exists
    and supply_deadline_cursor_exists
    and normal_confirmation_ledger_exists
    and normal_activation_ledger_exists
    and normal_activation_command_exists
    and regulated_supply_lock_exists
    and regulated_supply_ground_guard_exists
    and supply_deadline_rpc_service_only
    and supply_deadline_helper_private
    and supply_deadline_cursor_private
    and supply_deadline_runtime_columns_ready,
  'checks', jsonb_build_object(
    'supplier_switch_requests_exists', supplier_switch_requests_exists,
    'communication_route_id_exists', communication_route_id_exists,
    'ediel_route_profile_id_exists', ediel_route_profile_id_exists,
    'communication_routes_exists', communication_routes_exists,
    'ediel_route_profiles_exists', ediel_route_profiles_exists,
    'pgcrypto_digest_exists', pgcrypto_digest_exists,
    'request_idempotency_function_exists', request_idempotency_function_exists,
    'request_idempotency_digest_qualified', request_idempotency_digest_qualified,
    'request_idempotency_trigger_enabled', request_idempotency_trigger_enabled,
    'signed_contract_integrity_function_exists', signed_contract_integrity_function_exists,
    'supply_deadline_rpc_exists', supply_deadline_rpc_exists,
    'supply_deadline_helper_exists', supply_deadline_helper_exists,
    'supply_deadline_cursor_exists', supply_deadline_cursor_exists,
    'normal_confirmation_ledger_exists', normal_confirmation_ledger_exists,
    'normal_activation_ledger_exists', normal_activation_ledger_exists,
    'normal_activation_command_exists', normal_activation_command_exists,
    'regulated_supply_lock_exists', regulated_supply_lock_exists,
    'regulated_supply_ground_guard_exists', regulated_supply_ground_guard_exists,
    'supply_deadline_rpc_service_only', supply_deadline_rpc_service_only,
    'supply_deadline_helper_private', supply_deadline_helper_private,
    'supply_deadline_cursor_private', supply_deadline_cursor_private,
    'supply_deadline_runtime_columns_ready', supply_deadline_runtime_columns_ready
  )
)
from checks;
$function$;
REVOKE ALL ON FUNCTION public.gridex_customer_application_runtime_contract_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_customer_application_runtime_contract_v1() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
