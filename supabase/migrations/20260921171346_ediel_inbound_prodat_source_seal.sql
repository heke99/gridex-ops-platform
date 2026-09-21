-- PR367: insertion-scoped received-source seal; existing guard and privileges retained.
BEGIN;
CREATE OR REPLACE FUNCTION public.gridex_validate_ediel_message_contract() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare v_canonical boolean;
begin
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
  return new;
end $$;
COMMIT;
