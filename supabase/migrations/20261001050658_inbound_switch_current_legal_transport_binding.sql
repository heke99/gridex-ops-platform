BEGIN;
-- P26.A r3: NAD FR/DO are legal parties; UNB is physical transport.
-- SC-009 requires explicit current delegation without equal-ID substitution.
DO $migration$
DECLARE
  target oid := 'private.gridex_apply_inbound_switch_lifecycle_v1(uuid,uuid)'::regprocedure;
  before_row record; after_row record; definition text; previous text;
BEGIN
  SELECT oid,proowner,proacl,proconfig,prosecdef,provolatile,proparallel,pg_get_functiondef(oid) AS definition
    INTO before_row FROM pg_proc WHERE oid=target;
  definition:=before_row.definition;
  previous:=$patch$  v_event_type text; v_event_key text; v_workflow_key text; v_replayed boolean;$patch$;
  IF (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 THEN
    RAISE EXCEPTION 'inbound_switch_legal_transport_patch_cardinality'; END IF;
  definition:=replace(definition,previous,$patch$  v_event_type text; v_event_key text; v_workflow_key text; v_replayed boolean;
  v_origin_legal_sender jsonb; v_origin_legal_receiver jsonb;
  v_identity_at timestamptz; v_identity_until timestamptz;
  v_identity_actor uuid; v_transport_actor uuid; v_legal_ediel text; v_transport_ediel text;
  v_identity_count bigint; v_identifier_count bigint; v_relation_count bigint;
$patch$);
  previous:=$patch$    if original_tokens is null or v_reference is null$patch$;
  IF (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 THEN
    RAISE EXCEPTION 'inbound_switch_legal_transport_patch_cardinality'; END IF;
  definition:=replace(definition,previous,$patch$    -- The sealed original retains legal NAD independently from physical UNB.
    if original_tokens is null
      or (select count(*) from jsonb_array_elements(original_tokens) t where t->>'tag'='NAD' and t#>>'{elements,1,0}'='FR')<>1
      or (select count(*) from jsonb_array_elements(original_tokens) t where t->>'tag'='NAD' and t#>>'{elements,1,0}'='DO')<>1 then
      raise exception 'inbound_switch_source_correlation_mismatch' using errcode='23503'; end if;
    select t#>'{elements,2}' into v_origin_legal_sender from jsonb_array_elements(original_tokens) t
      where t->>'tag'='NAD' and t#>>'{elements,1,0}'='FR'
        and (t->>'index')::int < (select min((l->>'index')::int) from jsonb_array_elements(original_tokens) l where l->>'tag'='LIN');
    select t#>'{elements,2}' into v_origin_legal_receiver from jsonb_array_elements(original_tokens) t
      where t->>'tag'='NAD' and t#>>'{elements,1,0}'='DO'
        and (t->>'index')::int < (select min((l->>'index')::int) from jsonb_array_elements(original_tokens) l where l->>'tag'='LIN');
    if v_origin_legal_sender is null or jsonb_array_length(v_origin_legal_sender)<>3
      or v_origin_legal_sender->>1 is distinct from '160' or v_origin_legal_sender->>2 is distinct from 'SVK'
      or v_origin_legal_receiver is distinct from jsonb_build_array(sw.grid_owner_ediel_id,'160','SVK') then
      raise exception 'inbound_switch_source_correlation_mismatch' using errcode='23503'; end if;
    if original_tokens is null or v_reference is null$patch$);
  previous:=$patch$and t#>'{elements,2}'=jsonb_build_array(sw.grid_owner_ediel_id,'160','SVK'))<>1$patch$;
  IF (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 THEN
    RAISE EXCEPTION 'inbound_switch_legal_transport_patch_cardinality'; END IF;
  definition:=replace(definition,previous,$patch$and t#>'{elements,2}'=v_origin_legal_receiver)<>1$patch$);
  previous:=$patch$and t#>'{elements,2}'=jsonb_build_array(original_tokens->0#>>'{elements,2,0}','160','SVK'))<>1$patch$;
  IF (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 THEN
    RAISE EXCEPTION 'inbound_switch_legal_transport_patch_cardinality'; END IF;
  definition:=replace(definition,previous,$patch$and t#>'{elements,2}'=v_origin_legal_sender)<>1$patch$);
  previous:=$patch$  select * into origin from public.ediel_messages where id=origin.id and company_id=sw.company_id for update;$patch$;
  IF (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 THEN
    RAISE EXCEPTION 'inbound_switch_legal_transport_patch_cardinality'; END IF;
  definition:=replace(definition,previous,$patch$  -- Match the current supplier and its explicit transport agent before replay.
  -- These are installed canonical records, not a caller party assertion.
  perform 1 from public.tenant_ediel_profiles where company_id=sw.company_id and environment=m.environment and market='electricity' for share;
  perform 1 from public.tenant_actor_identifiers where company_id=sw.company_id and environment=m.environment and identifier_type='EdielId' for share;
  perform 1 from public.tenant_actor_roles where company_id=sw.company_id and environment=m.environment for share;
  perform 1 from public.tenant_counterparty_relations where company_id=sw.company_id and environment=m.environment and relation_type='ediel_transport_agent' for share;
  v_identity_at:=clock_timestamp();
  if not exists(select 1 from public.tenant_ediel_profiles where company_id=sw.company_id and environment=m.environment
    and market='electricity' and is_enabled and valid_from<=v_identity_at and (valid_to is null or v_identity_at<valid_to)) then
    raise exception 'inbound_switch_tenant_identity_mismatch' using errcode='23503'; end if;
  select count(distinct actor_id),count(distinct nullif(btrim(identifier_value),'')),min(actor_id::text)::uuid,min(nullif(btrim(identifier_value),''))
    into v_identity_count,v_identifier_count,v_identity_actor,v_legal_ediel from public.tenant_actor_identifiers
    where company_id=sw.company_id and environment=m.environment and identifier_type='EdielId'
      and valid_from<=v_identity_at and (valid_to is null or v_identity_at<valid_to);
  if v_identity_count<>1 or v_identifier_count<>1 or not exists(select 1 from public.tenant_actor_roles
    where company_id=sw.company_id and environment=m.environment and actor_id=v_identity_actor
      and btrim(role_code)='electricity_supplier' and valid_from<=v_identity_at and (valid_to is null or v_identity_at<valid_to)) then
    raise exception 'inbound_switch_tenant_identity_mismatch' using errcode='23503'; end if;
  select count(*),min(counterparty_actor_id::text)::uuid into v_relation_count,v_transport_actor
    from public.tenant_counterparty_relations where company_id=sw.company_id and environment=m.environment
      and relation_type='ediel_transport_agent' and is_enabled and valid_from<=v_identity_at and (valid_to is null or v_identity_at<valid_to);
  if v_relation_count=0 then
    v_transport_ediel:=v_legal_ediel;
  elsif v_relation_count=1 and v_transport_actor is distinct from v_identity_actor then
    perform 1 from public.platform_actor_identifiers where actor_id=v_transport_actor and identifier_type='EdielId' for share;
    if exists(select 1 from public.platform_actor_identifiers where actor_id=v_transport_actor and identifier_type='EdielId'
      and (valid_from is null or valid_from::timestamp at time zone 'UTC'<=v_identity_at)
      and (valid_to is null or v_identity_at<valid_to::timestamp at time zone 'UTC') and not is_verified) then
      raise exception 'inbound_switch_tenant_identity_mismatch' using errcode='23503'; end if;
    select count(distinct nullif(btrim(identifier_value),'')),min(nullif(btrim(identifier_value),'')) into v_identifier_count,v_transport_ediel
      from public.platform_actor_identifiers where actor_id=v_transport_actor and identifier_type='EdielId' and is_verified
        and (valid_from is null or valid_from::timestamp at time zone 'UTC'<=v_identity_at)
        and (valid_to is null or v_identity_at<valid_to::timestamp at time zone 'UTC');
    if v_identifier_count<>1 or v_transport_ediel=v_legal_ediel then
      raise exception 'inbound_switch_tenant_identity_mismatch' using errcode='23503'; end if;
  else raise exception 'inbound_switch_tenant_identity_mismatch' using errcode='23503'; end if;
  original_tokens:=private.gridex_inbound_switch_wire_tokens_v1(origin.raw_payload);
  if (select count(*) from jsonb_array_elements(original_tokens) t where t->>'tag'='NAD' and t#>>'{elements,1,0}'='FR')<>1
    or (select count(*) from jsonb_array_elements(original_tokens) t where t->>'tag'='NAD' and t#>>'{elements,1,0}'='DO')<>1
    or not exists(select 1 from jsonb_array_elements(original_tokens) t where t->>'tag'='NAD' and t#>>'{elements,1,0}'='FR'
      and t#>'{elements,2}'=jsonb_build_array(v_legal_ediel,'160','SVK')
      and (t->>'index')::int<(select min((l->>'index')::int) from jsonb_array_elements(original_tokens) l where l->>'tag'='LIN'))
    or not exists(select 1 from jsonb_array_elements(original_tokens) t where t->>'tag'='NAD' and t#>>'{elements,1,0}'='DO'
      and t#>'{elements,2}'=jsonb_build_array(sw.grid_owner_ediel_id,'160','SVK')
      and (t->>'index')::int<(select min((l->>'index')::int) from jsonb_array_elements(original_tokens) l where l->>'tag'='LIN'))
    or original_tokens->0#>>'{elements,2,0}' is distinct from v_transport_ediel
    or original_tokens->0#>>'{elements,3,0}' is distinct from sw.grid_owner_ediel_id then
    raise exception 'inbound_switch_tenant_identity_mismatch' using errcode='23503'; end if;
  select min(bound) into v_identity_until from (
    select valid_to as bound from public.tenant_ediel_profiles where company_id=sw.company_id and environment=m.environment
      and market='electricity' and is_enabled and valid_from<=v_identity_at and (valid_to is null or v_identity_at<valid_to)
    union all select valid_to from public.tenant_actor_identifiers where company_id=sw.company_id and environment=m.environment
      and identifier_type='EdielId' and valid_from<=v_identity_at and (valid_to is null or v_identity_at<valid_to)
    union all select valid_to from public.tenant_actor_roles where company_id=sw.company_id and environment=m.environment
      and actor_id=v_identity_actor and btrim(role_code)='electricity_supplier' and valid_from<=v_identity_at and (valid_to is null or v_identity_at<valid_to)
    union all select valid_to from public.tenant_counterparty_relations where company_id=sw.company_id and environment=m.environment
      and relation_type='ediel_transport_agent' and is_enabled and valid_from<=v_identity_at and (valid_to is null or v_identity_at<valid_to)
    union all select valid_to::timestamp at time zone 'UTC' from public.platform_actor_identifiers
      where v_relation_count=1 and actor_id=v_transport_actor and identifier_type='EdielId' and is_verified
        and (valid_from is null or valid_from::timestamp at time zone 'UTC'<=v_identity_at)
        and (valid_to is null or v_identity_at<valid_to::timestamp at time zone 'UTC')
  ) current_bounds;

  select * into origin from public.ediel_messages where id=origin.id and company_id=sw.company_id for update;$patch$);
  previous:=$patch$    return receipt.result||jsonb_build_object('replayed',true);$patch$;
  IF (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 THEN
    RAISE EXCEPTION 'inbound_switch_legal_transport_patch_cardinality'; END IF;
  definition:=replace(definition,previous,$patch$    if v_identity_until is not null and clock_timestamp()>=v_identity_until then
      raise exception 'inbound_switch_tenant_identity_expired' using errcode='23503'; end if;
    return receipt.result||jsonb_build_object('replayed',true);$patch$);
  previous:=$patch$  insert into private.gridex_inbound_switch_lifecycle_receipts(source_message_id,company_id,binding,result)$patch$;
  IF (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 THEN
    RAISE EXCEPTION 'inbound_switch_legal_transport_patch_cardinality'; END IF;
  definition:=replace(definition,previous,$patch$  if v_identity_until is not null and clock_timestamp()>=v_identity_until then
    raise exception 'inbound_switch_tenant_identity_expired' using errcode='23503'; end if;
  insert into private.gridex_inbound_switch_lifecycle_receipts(source_message_id,company_id,binding,result)$patch$);
  previous:=$patch$  return v_result;$patch$;
  IF (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 THEN
    RAISE EXCEPTION 'inbound_switch_legal_transport_patch_cardinality'; END IF;
  definition:=replace(definition,previous,$patch$  -- Check after the final owned receipt INSERT as well: its triggers can wait.
  if v_identity_until is not null and clock_timestamp()>=v_identity_until then
    raise exception 'inbound_switch_tenant_identity_expired' using errcode='23503'; end if;
  return v_result;$patch$);
  EXECUTE definition;
  SELECT oid,proowner,proacl,proconfig,prosecdef,provolatile,proparallel INTO after_row FROM pg_proc WHERE oid=target;
  IF after_row.oid IS DISTINCT FROM before_row.oid OR after_row.proowner IS DISTINCT FROM before_row.proowner
    OR after_row.proacl IS DISTINCT FROM before_row.proacl OR after_row.proconfig IS DISTINCT FROM before_row.proconfig
    OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef OR after_row.provolatile IS DISTINCT FROM before_row.provolatile
    OR after_row.proparallel IS DISTINCT FROM before_row.proparallel THEN
    RAISE EXCEPTION 'inbound_switch_legal_transport_catalog_changed'; END IF;
END;
$migration$;
COMMIT;
