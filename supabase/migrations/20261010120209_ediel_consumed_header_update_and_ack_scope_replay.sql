-- Preserves consumed protected rejection originals across tenant-resolution updates.
-- Reads persisted ACK scopes through the same protected owner used by their writer.
-- Exact genuine predecessor bodies, immutable principals/profile/evidence, OID and ACL guards.
BEGIN;

DO $h_native_replay_forward$
DECLARE target_oid oid;after_oid oid;old_body text;new_body text;before_definition text;after_definition text;before_metadata jsonb;after_metadata jsonb;
BEGIN
 target_oid:='public.gridex_bind_inbound_ediel_rule_pack_evidence()'::regprocedure;
 SELECT p.prosrc,to_jsonb(p)-'prosrc' INTO STRICT old_body,before_metadata FROM pg_proc p WHERE p.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM 'b0773e5506090d50768e4cf7ad336f49515206e1357d84f6da02d6714f26651d' THEN
  RAISE EXCEPTION 'h_native_replay_forward_unknown_preimage:binder';
 END IF;
 new_body:=$h_native_replay_body$
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
  if tg_op='INSERT' and gridex_ediel_header_negative_birth.is_bound_v1(new,true) is true then return new;end if;
  -- A consumed assigned negative may update public status/report projections
  -- without acquiring a missing operational profile or changing its original.
  if tg_op='UPDATE'
     and gridex_ediel_header_negative_birth.is_bound_v1(old,false) is true
     and gridex_ediel_header_negative_birth.is_bound_v1(new,false) is true
     and ROW(new.id,new.company_id,new.environment,new.direction,new.message_standard,new.message_family,new.message_code,new.resolved_company_id,new.raw_payload,new.immutable_payload_hash,new.created_by,new.created_at,new.message_created_at,new.message_received_at,new.message_version,new.inbound_email_message_id,new.mailbox_message_id,new.sender_ediel_id,new.receiver_ediel_id,new.sender_sub_address,new.receiver_sub_address,new.parsed_unb_sender_ediel_id,new.parsed_unb_receiver_ediel_id,new.application_reference,new.interchange_reference,new.external_reference)
         is not distinct from ROW(old.id,old.company_id,old.environment,old.direction,old.message_standard,old.message_family,old.message_code,old.resolved_company_id,old.raw_payload,old.immutable_payload_hash,old.created_by,old.created_at,old.message_created_at,old.message_received_at,old.message_version,old.inbound_email_message_id,old.mailbox_message_id,old.sender_ediel_id,old.receiver_ediel_id,old.sender_sub_address,old.receiver_sub_address,old.parsed_unb_sender_ediel_id,old.parsed_unb_receiver_ediel_id,old.application_reference,old.interchange_reference,old.external_reference)
     and ROW(new.canonical_rule_pack_id,new.rule_profile_key,new.rule_profile_version_id,new.rule_profile_version,new.rule_pack_checksum,new.rule_pack_snapshot)
         is not distinct from ROW(old.canonical_rule_pack_id,old.rule_profile_key,old.rule_profile_version_id,old.rule_profile_version,old.rule_pack_checksum,old.rule_pack_snapshot)
     and gridex_ediel_header_negative_birth.evidence_v1(old) is not null
     and gridex_ediel_header_negative_birth.evidence_v1(new)
         is not distinct from gridex_ediel_header_negative_birth.evidence_v1(old)
  then return new;end if;
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
$h_native_replay_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN
  RAISE EXCEPTION 'h_native_replay_forward_unique_body_required:binder';
 END IF;
 after_definition:=replace(before_definition,old_body,new_body);
 IF replace(after_definition,new_body,old_body) IS DISTINCT FROM before_definition THEN
  RAISE EXCEPTION 'h_native_replay_forward_full_definition_inverse_required:binder';
 END IF;
 EXECUTE after_definition;
 after_oid:='public.gridex_bind_inbound_ediel_rule_pack_evidence()'::regprocedure;
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_metadata FROM pg_proc p WHERE p.oid=after_oid;
 IF after_oid IS DISTINCT FROM target_oid OR after_metadata IS DISTINCT FROM before_metadata THEN
  RAISE EXCEPTION 'h_native_replay_forward_metadata_changed:binder';
 END IF;
 IF (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=target_oid) IS DISTINCT FROM 'ca403a7cb7fc48dd3a3e7aa13faa5533ed8c72f909090dd9ee0f6183933db391' THEN
  RAISE EXCEPTION 'h_native_replay_forward_postimage_mismatch:binder';
 END IF;
END $h_native_replay_forward$;

DO $h_native_replay_forward$
DECLARE target_oid oid;after_oid oid;old_body text;new_body text;before_definition text;after_definition text;before_metadata jsonb;after_metadata jsonb;
BEGIN
 target_oid:='gridex_ediel_ack_replay.require_readonly_prodat_ledger_v2(public.ediel_messages)'::regprocedure;
 SELECT p.prosrc,to_jsonb(p)-'prosrc' INTO STRICT old_body,before_metadata FROM pg_proc p WHERE p.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM '0689be7506e4d163895ce4904a1a52c8bb95debf53e1807ab9c33a40990d3774' THEN
  RAISE EXCEPTION 'h_native_replay_forward_unknown_preimage:readonly-ledger';
 END IF;
 new_body:=$h_native_replay_body$
DECLARE source public.ediel_messages%rowtype;scopes jsonb;a jsonb;scope jsonb;n bigint;BEGIN
 a:=gridex_ack_authority.wire_v1(m.raw_payload);
 IF m.message_family IS DISTINCT FROM 'APERAK' OR a#>>'{type,2}' IS DISTINCT FROM '96A' OR a#>>'{type,4}' IS DISTINCT FROM 'E2SE6A' THEN RETURN;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND direction='inbound' AND environment=m.environment AND (company_id=m.company_id OR company_id IS NULL) FOR SHARE;
 IF source.id IS NULL OR nullif(source.raw_payload,'') IS NULL THEN RAISE EXCEPTION 'ediel_ack_replay_actual_source_unavailable';END IF;
 scopes:=gridex_ediel_ack_guide.prodat_original_outcomes_v1(m,source);
 SELECT count(*) INTO n FROM gridex_ediel_ack_guide.outbound_prodat_scopes WHERE ack_message_id=m.id;
 -- Older already consumed native originals are qualified from their protected
 -- source/witness/raw guide, without retroactive ledger INSERT or repair.
 IF n=0 THEN RETURN;END IF;
 IF n<>jsonb_array_length(scopes) THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_original_changed';END IF;
 FOR scope IN SELECT x FROM jsonb_array_elements(scopes)x LOOP
  IF NOT EXISTS(SELECT FROM gridex_ediel_ack_guide.outbound_prodat_scopes r WHERE r.ack_message_id=m.id AND r.company_id=m.company_id AND r.environment=m.environment AND r.source_message_id=source.id
   AND r.source_payload_sha256=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') AND r.ack_payload_sha256=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
   AND r.scope_kind=scope->>'scope' AND r.scope_reference=scope->>'reference' AND r.physical_source_reference=scope->'physicalReference' AND r.outcome=scope->>'outcome') THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_original_changed';END IF;
 END LOOP;
END $h_native_replay_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN
  RAISE EXCEPTION 'h_native_replay_forward_unique_body_required:readonly-ledger';
 END IF;
 after_definition:=replace(before_definition,old_body,new_body);
 IF replace(after_definition,new_body,old_body) IS DISTINCT FROM before_definition THEN
  RAISE EXCEPTION 'h_native_replay_forward_full_definition_inverse_required:readonly-ledger';
 END IF;
 EXECUTE after_definition;
 after_oid:='gridex_ediel_ack_replay.require_readonly_prodat_ledger_v2(public.ediel_messages)'::regprocedure;
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_metadata FROM pg_proc p WHERE p.oid=after_oid;
 IF after_oid IS DISTINCT FROM target_oid OR after_metadata IS DISTINCT FROM before_metadata THEN
  RAISE EXCEPTION 'h_native_replay_forward_metadata_changed:readonly-ledger';
 END IF;
 IF (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=target_oid) IS DISTINCT FROM 'cd2f651928a847e5cf7134e3b8fb2decd67033ffe201d46005b993d55ee82871' THEN
  RAISE EXCEPTION 'h_native_replay_forward_postimage_mismatch:readonly-ledger';
 END IF;
END $h_native_replay_forward$;

COMMIT;
