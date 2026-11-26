-- Only future signatures through the exact Website finalizer receive a cutoff receipt.
-- Use the existing retention-managed contract evidence. Keep existing signed rows and response shape.
DO $website_withdrawal_deadline_receipt$
DECLARE
  signature constant regprocedure := 'public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,text,text,text)'::regprocedure;
  before_function pg_proc%ROWTYPE;
  after_function pg_proc%ROWTYPE;
  definition text;
  declaration_anchor constant text := $declaration_anchor$  v_signature_sha256 text;
$declaration_anchor$;
  declaration_target constant text := $declaration_target$  v_signature_sha256 text;
  v_persisted_withdrawal_deadline timestamptz;
  v_withdrawal_receipt jsonb;
$declaration_target$;
  receipt_anchor constant text := $receipt_anchor$  where id=p_contract_id and company_id=p_company_id;

  return jsonb_build_object($receipt_anchor$;
  receipt_target constant text := $receipt_target$  where id=p_contract_id and company_id=p_company_id
  returning withdrawal_deadline_at into v_persisted_withdrawal_deadline;

  if v_contract.signed_at is null
     and p_signature_snapshot->>'schema' = 'gridex_website_contract_signature_v2'
     and v_withdrawal_deadline is not null then
    if v_persisted_withdrawal_deadline is distinct from v_withdrawal_deadline then
      raise exception using errcode='23514', message='website_withdrawal_deadline_not_persisted';
    end if;
    v_withdrawal_receipt := jsonb_build_object(
      'version', 1,
      'company_id', p_company_id,
      'customer_id', v_contract.customer_id,
      'contract_id', p_contract_id,
      'application_id', p_application_id,
      'contract_publication_version_id', v_contract.contract_publication_version_id,
      'signature_snapshot_sha256', v_signature_sha256,
      'accepted_at', to_char(p_accepted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'withdrawal_deadline_at', to_char(v_persisted_withdrawal_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
    insert into public.customer_contract_evidence (
      company_id, customer_contract_id, evidence_type, evidence_snapshot, evidence_sha256, captured_at
    ) values (
      p_company_id, p_contract_id, 'website_withdrawal_deadline_v1', v_withdrawal_receipt,
      encode(extensions.digest(convert_to(v_withdrawal_receipt::text,'UTF8'),'sha256'),'hex'),
      p_accepted_at
    );
  end if;

  return jsonb_build_object($receipt_target$;
BEGIN
  SELECT * INTO STRICT before_function FROM pg_catalog.pg_proc WHERE oid=signature;
  IF before_function.proowner <> 'postgres'::regrole
     OR before_function.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
     OR NOT before_function.prosecdef
     OR before_function.proconfig IS DISTINCT FROM ARRAY['search_path=public, extensions, pg_temp']
     OR NOT has_function_privilege('service_role',signature,'execute')
     OR has_function_privilege('anon',signature,'execute')
     OR has_function_privilege('authenticated',signature,'execute') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='website_withdrawal_receipt_owner_unknown';
  END IF;
  IF encode(sha256(convert_to(before_function.prosrc,'UTF8')),'hex') = '9f915bc2ee4bb2599c531185b6e43a0a7c511671a41ba203b9bcb8728219788b' THEN
    RETURN;
  END IF;
  IF encode(sha256(convert_to(before_function.prosrc,'UTF8')),'hex') <> '1c58eb222614ad7f11c7ef7ba27c203b8cd5376ee13dfde9e35b4c507637c3d4' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='website_withdrawal_receipt_preimage_unknown';
  END IF;
  definition := pg_catalog.pg_get_functiondef(signature);
  EXECUTE replace(replace(definition,declaration_anchor,declaration_target),receipt_anchor,receipt_target);
  SELECT * INTO STRICT after_function FROM pg_catalog.pg_proc WHERE oid=signature;
  IF encode(sha256(convert_to(after_function.prosrc,'UTF8')),'hex') <> '9f915bc2ee4bb2599c531185b6e43a0a7c511671a41ba203b9bcb8728219788b'
     OR (to_jsonb(after_function)-'prosrc') IS DISTINCT FROM (to_jsonb(before_function)-'prosrc') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='website_withdrawal_receipt_postflight_mismatch';
  END IF;
END
$website_withdrawal_deadline_receipt$;
