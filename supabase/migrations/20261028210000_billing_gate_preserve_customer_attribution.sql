-- Preserve the persisted normalized customer's historical attribution when a
-- billing gate is recorded. This is a new, bounded adaptation of the qualified
-- R18 guard semantics to the private legacy setter on main c412cd5f; it does not
-- copy the private wrapper migration or depend on its unreleased source basis.
-- The public wrapper remains byte-for-byte unchanged, including a separately
-- delivered replacement of that wrapper. No new privilege or source is granted.
DO $migration$
DECLARE
  target_oid oid := to_regprocedure('gridex_billing_source.gridex_set_metering_billing_gate_before_source_v2(uuid,uuid,uuid,jsonb)');
  wrapper_oid oid := to_regprocedure('public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)');
  source_body text;
  replacement_body text;
  definition text;
  metadata_before jsonb;
  wrapper_before jsonb;
  before_sha256 constant text := 'ae17f8fecee74797cdaa04532a79dc4dd3d093825da4c56131b97907c1bb2567';
  after_sha256 constant text := '75bf07120c781727004ff0871bbb0172d0a5c6f2dca996f46074a9f0136af53d';
  anchor constant text := E'  update public.metering_values set\n';
  guard constant text := $guard$  -- A billing decision may preserve attribution, but cannot reassign history.
  if nullif(p_gate->>'customer_id','') is not null and not exists(
    select 1 from public.normalized_metering_values n
    where n.id=p_normalized_value_id and n.company_id=p_company_id
      and n.source_metering_value_id=p_metering_value_id and n.revision_status='current'
      and n.customer_id=nullif(p_gate->>'customer_id','')::uuid
  ) then
    raise exception using errcode='23514',message='billing_gate_customer_attribution_mismatch';
  end if;

$guard$;
BEGIN
  IF target_oid IS NULL OR wrapper_oid IS NULL THEN
    RAISE EXCEPTION 'billing_gate_attribution_function_missing' USING ERRCODE = '55000';
  END IF;
  SELECT p.prosrc, pg_get_functiondef(p.oid), to_jsonb(p) - 'prosrc'
  INTO source_body, definition, metadata_before
  FROM pg_proc p WHERE p.oid = target_oid;
  SELECT to_jsonb(p) INTO wrapper_before FROM pg_proc p WHERE p.oid = wrapper_oid;

  -- Accept only the reviewed preimage or our exact postimage. An unrelated
  -- function revision requires review rather than a best-effort text patch.
  IF encode(sha256(convert_to(source_body, 'UTF8')), 'hex') = after_sha256 THEN
    RETURN;
  END IF;
  IF encode(sha256(convert_to(source_body, 'UTF8')), 'hex') <> before_sha256 THEN
    RAISE EXCEPTION 'billing_gate_attribution_preimage_mismatch' USING ERRCODE = '55000';
  END IF;
  IF (length(source_body) - length(replace(source_body, anchor, ''))) <> length(anchor) THEN
    RAISE EXCEPTION 'billing_gate_attribution_anchor_mismatch' USING ERRCODE = '55000';
  END IF;
  replacement_body := replace(source_body, anchor, guard || anchor);
  IF encode(sha256(convert_to(replacement_body, 'UTF8')), 'hex') <> after_sha256 THEN
    RAISE EXCEPTION 'billing_gate_attribution_postimage_mismatch' USING ERRCODE = '55000';
  END IF;

  -- Reuse PostgreSQL's complete definition so OID, owner, ACL, SECURITY DEFINER,
  -- argument/default metadata, search_path and other settings are preserved.
  IF strpos(definition, source_body) = 0 THEN
    RAISE EXCEPTION 'billing_gate_attribution_definition_mismatch' USING ERRCODE = '55000';
  END IF;
  EXECUTE overlay(definition PLACING replacement_body
    FROM strpos(definition, source_body) FOR length(source_body));

  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = target_oid)
       IS DISTINCT FROM metadata_before
     OR (SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_proc p WHERE p.oid = target_oid)
       IS DISTINCT FROM after_sha256
     OR (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid = wrapper_oid)
       IS DISTINCT FROM wrapper_before THEN
    RAISE EXCEPTION 'billing_gate_attribution_metadata_changed' USING ERRCODE = '55000';
  END IF;
END
$migration$;
