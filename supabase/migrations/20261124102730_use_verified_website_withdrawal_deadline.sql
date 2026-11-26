-- Use the verified Website cutoff solely for the assessment of new scoped cases.
-- Preserve existing replay, reviewed billing scope and decisions lacking available evidence.
DO $consume_website_withdrawal_deadline$
DECLARE
  signature constant regprocedure := 'public.gridex_register_contract_withdrawal_case_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,jsonb)'::regprocedure;
  before_function pg_proc%ROWTYPE;
  after_function pg_proc%ROWTYPE;
  declaration_anchor constant text := $declaration_anchor$  reviewed_impact jsonb;
$declaration_anchor$;
  declaration_target constant text := $declaration_target$  reviewed_impact jsonb;
  signed_deadlines text[];
$declaration_target$;
  decision_anchor constant text := $decision_anchor$  PERFORM public.gridex_register_customer_lifecycle_decision_v1(
$decision_anchor$;
  decision_target constant text := $decision_target$  -- Exact replay and reviewed scope have already been checked under the contract lock.
  IF contract.status='signed' AND contract.withdrawal_information_sent_at IS NULL
     AND contract.signature_snapshot->>'schema'='gridex_website_contract_signature_v2' THEN
    signed_deadlines := ARRAY(
      SELECT evidence.evidence_snapshot->>'withdrawal_deadline_at'
      FROM public.customer_contract_evidence evidence
      WHERE evidence.company_id=p_company_id AND evidence.customer_contract_id=p_contract_id
        AND evidence.evidence_type='website_withdrawal_deadline_v1'
        AND evidence.captured_at=contract.signed_at
        AND evidence.evidence_snapshot->'version'='1'::jsonb
        AND evidence.evidence_snapshot->>'company_id'=p_company_id::text
        AND evidence.evidence_snapshot->>'customer_id'=p_customer_id::text
        AND evidence.evidence_snapshot->>'contract_id'=p_contract_id::text
        AND evidence.evidence_snapshot->>'application_id'=contract.signature_snapshot->>'application_id'
        AND evidence.evidence_snapshot->>'contract_publication_version_id'=contract.contract_publication_version_id::text
        AND evidence.evidence_snapshot->>'signature_snapshot_sha256'=contract.signature_snapshot_sha256
        AND evidence.evidence_snapshot->>'accepted_at'=
          to_char(contract.signed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        AND evidence.evidence_sha256=encode(sha256(convert_to(evidence.evidence_snapshot::text,'UTF8')),'hex')
        AND evidence.evidence_snapshot->>'withdrawal_deadline_at' ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
        AND pg_input_is_valid(evidence.evidence_snapshot->>'withdrawal_deadline_at','timestamp with time zone')
      ORDER BY evidence.id LIMIT 2 FOR SHARE OF evidence
    );
    IF cardinality(signed_deadlines)=1 THEN
      BEGIN
        PERFORM public.ediel_require_contract_records_available_v1(p_company_id,p_contract_id);
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM<>'customer_contract_records_retention_tombstoned' THEN RAISE; END IF;
        signed_deadlines:=ARRAY[]::text[];
      END;
    END IF;
    IF cardinality(signed_deadlines)=1 THEN
      p_assessment:=p_assessment||jsonb_build_object(
        'isDistanceAgreement',true,
        'withdrawalDeadlineAt',signed_deadlines[1],
        'withdrawalPossible',p_received_at<=signed_deadlines[1]::timestamptz
      );
    END IF;
  END IF;

  PERFORM public.gridex_register_customer_lifecycle_decision_v1(
$decision_target$;
BEGIN
  SELECT * INTO STRICT before_function FROM pg_catalog.pg_proc WHERE oid=signature;
  IF NOT before_function.prosecdef
     OR before_function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
     OR NOT has_function_privilege('service_role',signature,'execute')
     OR has_function_privilege('anon',signature,'execute')
     OR has_function_privilege('authenticated',signature,'execute') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='contract_withdrawal_deadline_owner_unknown';
  END IF;
  IF encode(sha256(convert_to(before_function.prosrc,'UTF8')),'hex') = '9612c55e0a2fea108b7117f2aecce7174868cd53c3ddabbe0d7c47d17ec4bc9b' THEN
    RETURN;
  END IF;
  IF encode(sha256(convert_to(before_function.prosrc,'UTF8')),'hex') <> 'eaa6f90a214608051d4aa7335c9fea2f71e3dc2cdc19489c1f316a6134222c01' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='contract_withdrawal_deadline_preimage_unknown';
  END IF;
  EXECUTE replace(replace(pg_catalog.pg_get_functiondef(signature),declaration_anchor,declaration_target),decision_anchor,decision_target);
  SELECT * INTO STRICT after_function FROM pg_catalog.pg_proc WHERE oid=signature;
  IF encode(sha256(convert_to(after_function.prosrc,'UTF8')),'hex') <> '9612c55e0a2fea108b7117f2aecce7174868cd53c3ddabbe0d7c47d17ec4bc9b'
     OR (to_jsonb(after_function)-'prosrc') IS DISTINCT FROM (to_jsonb(before_function)-'prosrc') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='contract_withdrawal_deadline_postflight_mismatch';
  END IF;
END
$consume_website_withdrawal_deadline$;
