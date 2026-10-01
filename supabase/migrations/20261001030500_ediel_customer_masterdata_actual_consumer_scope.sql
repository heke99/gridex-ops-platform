-- Same shared END_USER_ADDRESS_CODES. Z01/Z03 actualUD remain mandatory;
-- other real producers opt into the private preparation, not into a capability.
-- Removing a parsed selector cannot bypass an already captured private origin.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_customer_masterdata.require_current_v1(c uuid,message uuid,actor uuid,phase text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;p gridex_customer_masterdata.preparations%rowtype;b jsonb;ud jsonb;obj jsonb;q jsonb;BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=message AND company_id=c FOR UPDATE;IF m.id IS NULL THEN RAISE EXCEPTION 'customer_masterdata_message_required';END IF;
 IF m.direction<>'outbound' OR m.message_family<>'PRODAT' OR (m.message_code IN('Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09')) IS NOT TRUE THEN RETURN;END IF;
 IF m.message_code NOT IN('Z01','Z03') AND nullif(m.parsed_payload->>'customerMasterdataSourceContextId','') IS NULL AND NOT EXISTS(SELECT FROM gridex_customer_masterdata.originals WHERE company_id=c AND message_id=m.id) THEN RETURN;END IF;
 ud:=gridex_customer_masterdata.wire_ud_v1(m.raw_payload);IF ud IS NOT NULL AND jsonb_array_length(ud)=0 AND NOT EXISTS(SELECT FROM gridex_customer_masterdata.originals WHERE company_id=c AND message_id=m.id) THEN RETURN;END IF;
 IF NOT EXISTS(SELECT FROM gridex_customer_masterdata.originals WHERE message_id=m.id AND company_id=c) THEN
  PERFORM gridex_customer_life_events.require_actor_v1(c,actor,phase);
  IF m.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS NOT NULL AND m.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS NULL THEN q:=gridex_negative_fixtures.require_positive_message_v1(c,m.id,m.message_code);
  ELSIF m.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS NOT NULL AND m.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS NULL THEN q:=gridex_negative_fixtures.require_negative_message_v1(c,m.id,m.message_code);END IF;
  IF q->>'authorizesBusinessEffect'='false' AND q->>'companyId'=c::text AND m.environment='test' THEN RETURN;END IF;
 END IF;
 SELECT prep.* INTO p FROM gridex_customer_masterdata.originals o JOIN gridex_customer_masterdata.preparations prep ON prep.id=o.preparation_id WHERE o.company_id=c AND o.message_id=m.id AND o.payload_hash=m.immutable_payload_hash FOR SHARE OF prep;
 IF p.id IS NULL OR p.customer_id IS DISTINCT FROM m.customer_id OR (p.environment IS NOT NULL AND p.environment IS DISTINCT FROM m.environment) OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'customer_masterdata_immutable_original_required';END IF;
 b:=gridex_customer_masterdata.basis_v1(c,p.customer_id,actor,p.as_of,p.environment,phase,p.observed_at,p.basis#>'{sourceProof,sourceIds}');
 IF b IS DISTINCT FROM p.basis OR ud IS NULL THEN RAISE EXCEPTION 'customer_masterdata_current_source_changed';END IF;
 FOR obj IN SELECT item FROM jsonb_array_elements(ud)item LOOP IF obj->'customerIdentity' IS DISTINCT FROM b->'customerIdentity' OR obj->'endUserMasterdata' IS DISTINCT FROM gridex_customer_masterdata.wire_masterdata_v1(b->'endUserMasterdata') THEN RAISE EXCEPTION 'customer_masterdata_actual_wire_changed';END IF;END LOOP;
END$$;
CREATE OR REPLACE FUNCTION gridex_customer_masterdata.prelock_new_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE p gridex_customer_masterdata.preparations%rowtype;BEGIN
 IF NEW.direction='outbound' AND NEW.message_family='PRODAT' AND NEW.message_code IN('Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09') AND nullif(NEW.parsed_payload->>'customerMasterdataSourceContextId','') IS NOT NULL THEN
 SELECT * INTO p FROM gridex_customer_masterdata.preparations WHERE id=(NEW.parsed_payload->>'customerMasterdataSourceContextId')::uuid AND company_id=NEW.company_id;
 IF p.id IS NOT NULL THEN PERFORM m.id FROM public.ediel_messages m WHERE m.company_id=NEW.company_id AND m.id IN(SELECT value::uuid FROM jsonb_array_elements_text(p.basis#>'{sourceProof,sourceIds}')) ORDER BY m.id FOR UPDATE;END IF;END IF;RETURN NEW;END$$;
CREATE OR REPLACE FUNCTION gridex_customer_masterdata.bind_original_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE p gridex_customer_masterdata.preparations%rowtype;b jsonb;obj jsonb;ud jsonb;q jsonb;fixture_actor uuid;BEGIN
 IF NEW.direction<>'outbound' OR NEW.message_family<>'PRODAT' OR (NEW.message_code IN('Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09')) IS NOT TRUE THEN RETURN NEW;END IF;
 IF NEW.message_code NOT IN('Z01','Z03') AND nullif(NEW.parsed_payload->>'customerMasterdataSourceContextId','') IS NULL THEN RETURN NEW;END IF;
 ud:=gridex_customer_masterdata.wire_ud_v1(NEW.raw_payload);IF ud IS NOT NULL AND jsonb_array_length(ud)=0 THEN RETURN NEW;END IF;
 IF NEW.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS NOT NULL AND NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS NULL THEN
  SELECT actor_user_id INTO fixture_actor FROM gridex_negative_fixtures.positive_witnesses WHERE id=(NEW.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId')::uuid AND company_id=NEW.company_id FOR SHARE;
  q:=gridex_negative_fixtures.prepared_positive_fixture_v1(NEW.company_id,(NEW.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId')::uuid,NEW.raw_payload,fixture_actor);
 ELSIF NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS NOT NULL AND NEW.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS NULL THEN
  SELECT actor_user_id INTO fixture_actor FROM gridex_negative_fixtures.negative_prepared_witnesses WHERE id=(NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId')::uuid AND company_id=NEW.company_id FOR SHARE;
  q:=gridex_negative_fixtures.prepared_negative_fixture_v1(NEW.company_id,(NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId')::uuid,NEW.raw_payload,fixture_actor);END IF;
 IF q->>'authorizesBusinessEffect'='false' AND q->>'companyId'=NEW.company_id::text AND NEW.environment='test' THEN RETURN NEW;END IF;
 IF nullif(NEW.parsed_payload->>'customerMasterdataSourceContextId','') IS NULL THEN RAISE EXCEPTION 'customer_masterdata_protected_source_context_required';END IF;
 SELECT * INTO p FROM gridex_customer_masterdata.preparations WHERE id=(NEW.parsed_payload->>'customerMasterdataSourceContextId')::uuid AND company_id=NEW.company_id FOR SHARE;
 IF p.id IS NULL OR p.actor_user_id IS DISTINCT FROM NEW.created_by OR p.customer_id IS DISTINCT FROM NEW.customer_id OR (p.environment IS NOT NULL AND p.environment IS DISTINCT FROM NEW.environment) OR NEW.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'customer_masterdata_prepared_source_scope_required';END IF;
 b:=gridex_customer_masterdata.basis_v1(NEW.company_id,p.customer_id,p.actor_user_id,p.as_of,p.environment,'prepare',p.observed_at,p.basis#>'{sourceProof,sourceIds}');
 IF b IS DISTINCT FROM p.basis OR ud IS NULL THEN RAISE EXCEPTION 'customer_masterdata_prepared_source_changed';END IF;
 FOR obj IN SELECT item FROM jsonb_array_elements(ud)item LOOP IF obj->'customerIdentity' IS DISTINCT FROM b->'customerIdentity' OR obj->'endUserMasterdata' IS DISTINCT FROM gridex_customer_masterdata.wire_masterdata_v1(b->'endUserMasterdata') THEN RAISE EXCEPTION 'customer_masterdata_actual_wire_changed';END IF;END LOOP;
 INSERT INTO gridex_customer_masterdata.originals(message_id,company_id,preparation_id,payload_hash) VALUES(NEW.id,NEW.company_id,p.id,NEW.immutable_payload_hash);RETURN NEW;
END$$;
-- Preparation identity includes its actual authorized preparer. Prior rows and
-- their immutable original bindings are preserved; another actor gets a new
-- preparation instead of borrowing an unusable credential.
DO $$DECLARE old_name text;BEGIN
 SELECT conname INTO STRICT old_name FROM pg_constraint WHERE conrelid='gridex_customer_masterdata.preparations'::regclass AND contype='u' AND conkey=(SELECT array_agg(attnum ORDER BY ord)::smallint[] FROM unnest(ARRAY['company_id','customer_id','environment','as_of','basis_hash']) WITH ORDINALITY x(name,ord) JOIN pg_attribute a ON a.attrelid='gridex_customer_masterdata.preparations'::regclass AND a.attname=x.name);
 EXECUTE format('ALTER TABLE gridex_customer_masterdata.preparations DROP CONSTRAINT %I',old_name);
END$$;
ALTER TABLE gridex_customer_masterdata.preparations ADD CONSTRAINT customer_masterdata_preparation_actor_basis_key UNIQUE NULLS NOT DISTINCT(company_id,customer_id,environment,as_of,actor_user_id,basis_hash);
CREATE OR REPLACE FUNCTION public.ediel_prepare_customer_masterdata_v1(p_company_id uuid,p_customer_id uuid,p_actor_user_id uuid,p_as_of timestamptz,p_environment text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;prep gridex_customer_masterdata.preparations%rowtype;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_masterdata_service_required' USING ERRCODE='42501';END IF;
 b:=gridex_customer_masterdata.basis_v1(p_company_id,p_customer_id,p_actor_user_id,p_as_of,p_environment,'prepare');IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 INSERT INTO gridex_customer_masterdata.preparations(company_id,customer_id,environment,as_of,observed_at,actor_user_id,basis,basis_hash) VALUES(p_company_id,p_customer_id,p_environment,p_as_of,statement_timestamp(),p_actor_user_id,b,encode(sha256(convert_to(b::text,'UTF8')),'hex')) ON CONFLICT DO NOTHING RETURNING * INTO prep;
 IF prep.id IS NULL THEN SELECT * INTO STRICT prep FROM gridex_customer_masterdata.preparations WHERE company_id=p_company_id AND customer_id=p_customer_id AND environment IS NOT DISTINCT FROM p_environment AND as_of=p_as_of AND actor_user_id=p_actor_user_id AND basis=b;END IF;
 RETURN (b-'sourceProof')||jsonb_build_object('sourceContextId',prep.id);
END$$;

COMMIT;
