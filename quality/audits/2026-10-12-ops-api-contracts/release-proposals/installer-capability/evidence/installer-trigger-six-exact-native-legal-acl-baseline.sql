BEGIN;
SET LOCAL check_function_bodies=true;
CREATE OR REPLACE FUNCTION gridex_received_sources.capture_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' OR TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'ediel_messages' THEN
    RAISE EXCEPTION 'received_source_capture_invalid_owner' USING ERRCODE = '23514';
  END IF;
  IF NEW.direction = 'inbound' AND upper(coalesce(NEW.message_family, '')) = 'PRODAT'
     AND NEW.message_standard = 'edifact' THEN
    -- AFTER INSERT observes the final row after PR369's BEFORE trigger sealed
    -- the source. Only database-owned original columns are copied; no status,
    -- mutable metering link, parsed_payload or validation_report is authority.
    INSERT INTO gridex_received_sources.sources (
      source_message_id, company_id, environment, origin, message_code,
      source_received_at, captured_at, raw_payload, payload_hash, received_context
    ) VALUES (
      NEW.id, NEW.company_id, NEW.environment, 'database_insert', NEW.message_code,
      NEW.message_received_at, clock_timestamp(), NEW.raw_payload,
      NEW.immutable_payload_hash,
      NEW.execution_context_snapshot -> 'receivedProdatContext'
    );
    -- No ON CONFLICT DO NOTHING. Reusing a deleted source ID must not silently
    -- attach a different receipt to old history. Normal retries are UPDATEs.
  END IF;
  RETURN NEW;
END
$function$;
ALTER FUNCTION gridex_received_sources.capture_insert() OWNER TO postgres;
REVOKE ALL ON FUNCTION gridex_received_sources.capture_insert() FROM PUBLIC,postgres,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.capture_insert() TO postgres;
CREATE OR REPLACE FUNCTION gridex_utilts_binding.guard_source_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE receipt gridex_utilts_binding.receipts%rowtype;
BEGIN
 SELECT * INTO receipt FROM gridex_utilts_binding.receipts WHERE source_message_id=OLD.id;
 IF FOUND AND (NEW.raw_payload IS DISTINCT FROM OLD.raw_payload OR
   gridex_utilts_binding.source_context_v1(NEW) IS DISTINCT FROM receipt.source_context) THEN
  RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01';
 END IF;
 RETURN NEW;
END $function$;
ALTER FUNCTION gridex_utilts_binding.guard_source_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gridex_utilts_binding.guard_source_v1() FROM PUBLIC,postgres,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_utilts_binding.guard_source_v1() TO postgres;
CREATE OR REPLACE FUNCTION public.gridex_bind_inbound_ediel_rule_pack_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rule_pack_id uuid;
  v_profile_id uuid;
  v_profile_key text;
  v_guide_version text;
  v_guide_revision text;
  v_source_hash text;
  v_effective_date date;
  v_match_count integer;
begin
  if new.direction <> 'inbound' or new.company_id is null or new.message_family not in ('PRODAT','UTILTS') then
    return new;
  end if;

  if new.canonical_rule_pack_id is not null
     and nullif(new.rule_profile_key,'') is not null
     and new.rule_profile_version_id is not null
     and nullif(new.rule_profile_version,'') is not null
     and nullif(new.rule_pack_checksum,'') is not null
     and coalesce(new.rule_pack_snapshot,'{}'::jsonb) <> '{}'::jsonb then
    return new;
  end if;

  v_effective_date := coalesce(new.message_received_at::date, new.created_at::date, current_date);

  select count(*)
  into v_match_count
  from public.ediel_message_profiles mp
  join public.ediel_rule_packs rp on rp.id = mp.rule_pack_id
  where mp.is_enabled = true
    and mp.profile->>'family' = new.message_family
    and mp.message_code = new.message_code
    and mp.direction in ('inbound','both')
    and rp.status in ('active','future')
    and rp.valid_from <= v_effective_date
    and (rp.valid_to is null or rp.valid_to >= v_effective_date);

  if v_match_count <> 1 then
    raise exception 'canonical_inbound_rule_profile_resolution_failed:%:%:%:%',
      new.message_family, coalesce(new.message_code,''), v_effective_date, v_match_count
      using errcode='23514';
  end if;

  select mp.rule_pack_id, mp.id, mp.profile_key, rp.guide_version, rp.guide_revision, rp.source_hash
  into v_rule_pack_id, v_profile_id, v_profile_key, v_guide_version, v_guide_revision, v_source_hash
  from public.ediel_message_profiles mp
  join public.ediel_rule_packs rp on rp.id = mp.rule_pack_id
  where mp.is_enabled = true
    and mp.profile->>'family' = new.message_family
    and mp.message_code = new.message_code
    and mp.direction in ('inbound','both')
    and rp.status in ('active','future')
    and rp.valid_from <= v_effective_date
    and (rp.valid_to is null or rp.valid_to >= v_effective_date)
  limit 1;

  new.canonical_rule_pack_id := v_rule_pack_id;
  new.rule_profile_key := v_profile_key;
  new.rule_profile_version_id := v_profile_id;
  new.rule_profile_version := v_guide_version || ':r' || v_guide_revision;
  new.rule_pack_checksum := v_source_hash;
  new.rule_pack_snapshot := jsonb_build_object(
    'family', new.message_family,
    'code', new.message_code,
    'direction', 'inbound',
    'environment', new.environment,
    'profileKey', v_profile_key,
    'profileVersionId', v_profile_id,
    'version', v_guide_version || ':r' || v_guide_revision,
    'checksum', v_source_hash,
    'authority', 'gridex_bind_inbound_ediel_rule_pack_evidence',
    'databaseRole', 'evidence_only',
    'effectiveDate', v_effective_date
  );

  return new;
end;
$function$;
ALTER FUNCTION gridex_bind_inbound_ediel_rule_pack_evidence() OWNER TO postgres;
REVOKE ALL ON FUNCTION gridex_bind_inbound_ediel_rule_pack_evidence() FROM PUBLIC,postgres,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_bind_inbound_ediel_rule_pack_evidence() TO postgres;
GRANT EXECUTE ON FUNCTION gridex_bind_inbound_ediel_rule_pack_evidence() TO service_role;
CREATE OR REPLACE FUNCTION public.gridex_capture_ediel_rule_pack_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profile_rule_pack_id uuid;
begin
  if new.direction='outbound' and new.message_family in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR') then
    if new.company_id is null then
      raise exception 'outbound_ediel_company_id_required' using errcode='23502';
    end if;

    if nullif(new.rule_profile_key,'') is null or new.rule_profile_version_id is null
       or nullif(new.rule_profile_version,'') is null or nullif(new.rule_pack_checksum,'') is null
       or coalesce(new.rule_pack_snapshot,'{}'::jsonb)='{}'::jsonb then
      raise exception 'outbound_ediel_rule_pack_snapshot_required' using errcode='23514';
    end if;

    select mp.rule_pack_id into v_profile_rule_pack_id
    from public.ediel_message_profiles mp
    where mp.id = new.rule_profile_version_id
      and mp.is_enabled = true;

    if v_profile_rule_pack_id is null then
      raise exception 'canonical_ediel_message_profile_required:%', new.rule_profile_version_id using errcode='23503';
    end if;

    if new.canonical_rule_pack_id is null or new.canonical_rule_pack_id <> v_profile_rule_pack_id then
      raise exception 'canonical_ediel_rule_pack_profile_mismatch:%:%', coalesce(new.canonical_rule_pack_id::text,'null'), v_profile_rule_pack_id::text using errcode='23514';
    end if;

    insert into public.ediel_rule_pack_snapshots(
      company_id,ediel_message_id,profile_key,rule_profile_version_id,profile_version,checksum,snapshot
    ) values (
      new.company_id,new.id,new.rule_profile_key,new.rule_profile_version_id,new.rule_profile_version,new.rule_pack_checksum,new.rule_pack_snapshot
    ) on conflict(ediel_message_id) do update set
      company_id=excluded.company_id,
      profile_key=excluded.profile_key,
      rule_profile_version_id=excluded.rule_profile_version_id,
      profile_version=excluded.profile_version,
      checksum=excluded.checksum,
      snapshot=excluded.snapshot;
  end if;
  return new;
end;
$function$;
ALTER FUNCTION gridex_capture_ediel_rule_pack_snapshot() OWNER TO postgres;
REVOKE ALL ON FUNCTION gridex_capture_ediel_rule_pack_snapshot() FROM PUBLIC,postgres,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_capture_ediel_rule_pack_snapshot() TO postgres;
GRANT EXECUTE ON FUNCTION gridex_capture_ediel_rule_pack_snapshot() TO service_role;
CREATE OR REPLACE FUNCTION public.gridex_validate_ediel_message_contract()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$;
ALTER FUNCTION gridex_validate_ediel_message_contract() OWNER TO postgres;
REVOKE ALL ON FUNCTION gridex_validate_ediel_message_contract() FROM PUBLIC,postgres,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_validate_ediel_message_contract() TO PUBLIC;
GRANT EXECUTE ON FUNCTION gridex_validate_ediel_message_contract() TO postgres;
GRANT EXECUTE ON FUNCTION gridex_validate_ediel_message_contract() TO anon;
GRANT EXECUTE ON FUNCTION gridex_validate_ediel_message_contract() TO authenticated;
GRANT EXECUTE ON FUNCTION gridex_validate_ediel_message_contract() TO service_role;
CREATE OR REPLACE FUNCTION public.gridex_validate_ediel_outbox_tenant_and_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare m public.ediel_messages%rowtype;
begin
  select * into m from public.ediel_messages where id=new.ediel_message_id;
  if not found then raise exception 'ediel_outbox_message_missing' using errcode='23503'; end if;
  if new.company_id is null or m.company_id is null or new.company_id<>m.company_id then
    raise exception 'ediel_outbox_message_tenant_mismatch' using errcode='23514';
  end if;
  if m.direction<>'outbound' then raise exception 'ediel_outbox_requires_outbound_message' using errcode='23514'; end if;
  if m.message_family in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR')
     and (m.rule_profile_version_id is null or nullif(m.rule_pack_checksum,'') is null) then
    raise exception 'ediel_outbox_rule_pack_snapshot_missing' using errcode='23514';
  end if;
  new.rule_profile_key:=m.rule_profile_key;
  new.rule_profile_version_id:=m.rule_profile_version_id;
  new.rule_profile_version:=m.rule_profile_version;
  new.rule_pack_checksum:=m.rule_pack_checksum;
  new.rule_pack_snapshot:=m.rule_pack_snapshot;
  return new;
end; $function$;
ALTER FUNCTION gridex_validate_ediel_outbox_tenant_and_snapshot() OWNER TO postgres;
REVOKE ALL ON FUNCTION gridex_validate_ediel_outbox_tenant_and_snapshot() FROM PUBLIC,postgres,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_validate_ediel_outbox_tenant_and_snapshot() TO PUBLIC;
GRANT EXECUTE ON FUNCTION gridex_validate_ediel_outbox_tenant_and_snapshot() TO postgres;
GRANT EXECUTE ON FUNCTION gridex_validate_ediel_outbox_tenant_and_snapshot() TO anon;
GRANT EXECUTE ON FUNCTION gridex_validate_ediel_outbox_tenant_and_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION gridex_validate_ediel_outbox_tenant_and_snapshot() TO service_role;
COMMIT;
