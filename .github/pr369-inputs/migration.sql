-- PR369: row-lifetime insertion context, not accepted structural authority.
BEGIN;
LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
begin
  if exists(select 1 from public.ediel_messages where execution_context_snapshot ? 'receivedProdatContext') then
    raise exception 'ediel_received_context_namespace_collision' using errcode='23514';
  end if;
end $preflight$;
CREATE OR REPLACE FUNCTION public.gridex_validate_ediel_message_contract() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare v_canonical boolean;
begin
  if tg_op='UPDATE' then
    if coalesce(old.execution_context_snapshot ? 'receivedProdatContext',false) then
      if new.raw_payload is distinct from old.raw_payload or new.immutable_payload_hash is distinct from old.immutable_payload_hash then
        raise exception 'immutable_ediel_payload_cannot_change' using errcode='23514';
      end if;
      if (new.execution_context_snapshot->'receivedProdatContext') is distinct from (old.execution_context_snapshot->'receivedProdatContext') then
        raise exception 'immutable_ediel_received_context_cannot_change' using errcode='23514';
      end if;
      if new.message_received_at is distinct from old.message_received_at then
        raise exception 'immutable_ediel_receipt_time_cannot_change' using errcode='23514';
      end if;
      if new.id is distinct from old.id or new.direction is distinct from old.direction
         or new.message_standard is distinct from old.message_standard or new.message_family is distinct from old.message_family
         or new.message_code is distinct from old.message_code then
        raise exception 'immutable_ediel_received_context_cannot_change' using errcode='23514';
      end if;
    elsif coalesce(new.execution_context_snapshot ? 'receivedProdatContext',false) then
      raise exception 'received_ediel_context_cannot_be_backfilled' using errcode='23514';
    end if;
  end if;
  v_canonical := upper(coalesce(new.message_family,'')) in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR');
  if v_canonical then
    if new.company_id is null then raise exception 'canonical_ediel_company_required' using errcode='23502'; end if;
    if nullif(btrim(coalesce(new.environment,'')),'') is null then raise exception 'canonical_ediel_environment_required' using errcode='23502'; end if;
    if new.direction='outbound' then
      if new.canonical_rule_pack_id is null then raise exception 'canonical_ediel_rule_pack_required' using errcode='23502'; end if;
      if new.communication_route_id is null then raise exception 'canonical_ediel_route_required' using errcode='23502'; end if;
      if new.route_profile_id is null and nullif(new.execution_context_snapshot->>'routeProfileId','') is null then raise exception 'canonical_ediel_route_profile_required' using errcode='23502'; end if;
      if nullif(btrim(coalesce(new.application_reference,'')),'') is null then raise exception 'canonical_ediel_application_reference_required' using errcode='23502'; end if;
      if nullif(btrim(coalesce(new.source_operation_id,new.execution_context_snapshot->>'sourceOperationId','')),'') is null then raise exception 'canonical_ediel_source_operation_required' using errcode='23502'; end if;
      if new.raw_payload is not null and nullif(btrim(new.raw_payload),'') is not null then
        new.immutable_payload_hash := encode(digest(convert_to(new.raw_payload,'UTF8'),'sha256'),'hex');
        new.immutable_rendered_at := coalesce(new.immutable_rendered_at,now());
      end if;
    end if;
  end if;
  -- Seal only newly received EDIFACT PRODAT source bytes; never backfill UPDATEs.
  -- Null is no source. Empty text is a source. Ignore a caller-supplied hash.
  if tg_op='INSERT' and new.direction='inbound'
     and upper(coalesce(new.message_family,''))='PRODAT'
     and new.message_standard='edifact' then
    new.immutable_payload_hash := case when new.raw_payload is null then null
      else encode(digest(convert_to(new.raw_payload,'UTF8'),'sha256'),'hex') end;
  end if;
  if tg_op='UPDATE' and old.immutable_payload_hash is not null then
    if new.raw_payload is distinct from old.raw_payload or new.immutable_payload_hash is distinct from old.immutable_payload_hash then
      raise exception 'immutable_ediel_payload_cannot_change' using errcode='23514';
    end if;
  end if;
  if tg_op='INSERT' then
    -- Client data never owns this reserved namespace, including ineligible rows.
    if jsonb_typeof(new.execution_context_snapshot) in ('object','array') then
      new.execution_context_snapshot := new.execution_context_snapshot - 'receivedProdatContext';
    end if;
    if new.direction='inbound' and upper(coalesce(new.message_family,''))='PRODAT'
       and new.message_standard='edifact' and new.raw_payload is not null
       and new.id is not null and new.company_id is not null
       and nullif(btrim(new.environment),'') is not null and nullif(btrim(new.message_code),'') is not null
       and new.message_received_at is not null and new.immutable_payload_hash is not null then
      new.execution_context_snapshot := (case when jsonb_typeof(new.execution_context_snapshot)='object'
        then new.execution_context_snapshot else '{}'::jsonb end) || jsonb_build_object('receivedProdatContext',jsonb_build_object(
          'version',1,'contextOrigin','database_insert','sourceMessageId',new.id,'companyId',new.company_id,
          'environment',new.environment,'messageCode',new.message_code,'payloadHash',new.immutable_payload_hash,
          'sourceReceivedAt',new.message_received_at,'capturedAt',clock_timestamp()));
    end if;
  end if;
  return new;
end $$;
COMMIT;
