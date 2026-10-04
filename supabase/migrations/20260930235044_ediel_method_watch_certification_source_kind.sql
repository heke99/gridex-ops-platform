-- Actual CLI forward. A registered certification original is distinct from a
-- customer-agreed live method request. It grants no market or method watch.
BEGIN;
CREATE FUNCTION gridex_metering_method_changes.certification_basis_v1(m public.ediel_messages) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE positive boolean;negative boolean;q jsonb;BEGIN
 IF m.id IS NULL OR m.company_id IS NULL OR m.environment IS DISTINCT FROM 'test'
  OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact'
  OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z09'
  OR EXISTS(SELECT FROM gridex_metering_method_changes.origins o WHERE o.company_id=m.company_id AND o.message_id=m.id)
  THEN RETURN NULL;END IF;
 SELECT EXISTS(SELECT FROM gridex_negative_fixtures.positive_consumptions f WHERE f.message_id=m.id AND f.company_id=m.company_id),
  EXISTS(SELECT FROM gridex_negative_fixtures.negative_prepared_consumptions f WHERE f.message_id=m.id AND f.company_id=m.company_id)
  INTO positive,negative;
 IF positive AND negative THEN RAISE EXCEPTION 'metering_method_change_fixture_source_ambiguous';END IF;
 IF NOT positive AND NOT negative THEN RETURN NULL;END IF;
 q:=CASE WHEN positive THEN gridex_negative_fixtures.require_positive_message_v1(m.company_id,m.id,'Z09')
  ELSE gridex_negative_fixtures.require_negative_message_v1(m.company_id,m.id,'Z09') END;
 IF gridex_metering_method_changes.fixture_qualification_v1(q,m.company_id,positive) IS NOT TRUE
  OR q->>'wireSha256' IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  THEN RAISE EXCEPTION 'metering_method_change_current_test_original_required';END IF;
 RETURN q;
END $$;

CREATE FUNCTION public.ediel_metering_method_change_send_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;q jsonb;kind text;BEGIN
 -- This is the existing provider-phase permission/source owner, not a new
 -- guide decision or an environment-derived certification authorization.
 PERFORM public.ediel_require_metering_method_change_source_current_v1(p_company_id,p_message_id,p_actor_user_id);
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id AND id=p_message_id FOR SHARE;
 q:=gridex_metering_method_changes.certification_basis_v1(m);
 IF q IS NOT NULL THEN kind:='certification';
 ELSIF EXISTS(SELECT FROM gridex_metering_method_changes.origins o WHERE o.company_id=m.company_id AND o.message_id=m.id) THEN kind:='agreement';
 ELSE kind:='not_applicable';END IF;
 RETURN jsonb_build_object('version',1,'kind',kind,'companyId',m.company_id,'environment',m.environment,
  'messageId',m.id,'sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'intentId',m.intent_id);
END $$;

DO $$DECLARE body text;needle text;replacement text;BEGIN
 SELECT pg_get_functiondef('gridex_method_expectations.require_binding_v1(public.ediel_messages,jsonb)'::regprocedure) INTO body;
 needle:=$old$wire:=gridex_metering_method_changes.wire_v1(m.raw_payload);$old$;
 replacement:=$new$IF gridex_metering_method_changes.certification_basis_v1(m) IS NOT NULL THEN
  IF binding->'meteringMethodExpectationPlan' IS NOT NULL AND binding->'meteringMethodExpectationPlan'<>'null'::jsonb
   THEN RAISE EXCEPTION 'ediel_method_expectation_certification_watch_not_applicable';END IF;
  RETURN binding;
 END IF;
 wire:=gridex_metering_method_changes.wire_v1(m.raw_payload);$new$;
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'ediel_method_expectation_fixture_owner_contract_changed';END IF;
 EXECUTE replace(body,needle,replacement);
END $$;
REVOKE ALL ON FUNCTION gridex_metering_method_changes.certification_basis_v1(public.ediel_messages),
 public.ediel_metering_method_change_send_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_metering_method_change_send_basis_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
