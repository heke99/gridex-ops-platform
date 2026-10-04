-- Genuine positive TGT originals have their own immutable one-use provenance.
-- This transport admission never creates a live BRP approval/origin/history.
BEGIN;
ALTER FUNCTION public.ediel_require_brp_change_source_current_v1(uuid,uuid) SET SCHEMA gridex_brp_changes;
ALTER FUNCTION gridex_brp_changes.ediel_require_brp_change_source_current_v1(uuid,uuid)
 RENAME TO require_current_before_positive_test_v1;
REVOKE ALL ON FUNCTION gridex_brp_changes.require_current_before_positive_test_v1(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_require_brp_change_source_current_v1(p_company_id uuid,p_message_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;tokens jsonb;q jsonb;physical_b boolean;
BEGIN
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id AND id=p_message_id FOR SHARE;
 tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);
 physical_b:=EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='Z09')
  AND EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}'='Z27');
 IF physical_b AND NOT EXISTS(SELECT FROM gridex_brp_changes.origins WHERE company_id=p_company_id AND message_id=p_message_id)
  AND m.environment='test' AND m.direction='outbound' AND m.message_standard='edifact' AND m.message_family='PRODAT' AND m.message_code='Z09' THEN
  -- The source owner checks registered original bytes, actual run/role/case/
  -- revision/step/expiry, sole consumed message and normal canonical witness.
  q:=gridex_negative_fixtures.require_positive_message_v1(p_company_id,p_message_id,'Z09');
  IF q->>'kind' IS DISTINCT FROM 'source_qualified_positive_fixture' OR q->>'version' IS DISTINCT FROM '1'
   OR q->>'companyId' IS DISTINCT FROM p_company_id::text OR q->>'roleCode' IS DISTINCT FROM 'supplier'
   OR q->>'suite' IS DISTINCT FROM 'PRODAT' OR q->>'expectedOutcome' IS DISTINCT FROM 'positive'
   OR q->'expectedDiagnosticCodes' IS DISTINCT FROM '[]'::jsonb OR q->'authorizesBusinessEffect' IS DISTINCT FROM 'false'::jsonb
  THEN RAISE EXCEPTION 'brp_change_positive_test_original_required';END IF;
  RETURN;
 END IF;
 -- A genuine production origin, including one in test environment, never falls
 -- back after its source/contract/register/physical-scope qualification fails.
 PERFORM gridex_brp_changes.require_current_before_positive_test_v1(p_company_id,p_message_id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_require_brp_change_source_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_brp_change_source_current_v1(uuid,uuid) TO service_role;
COMMIT;
