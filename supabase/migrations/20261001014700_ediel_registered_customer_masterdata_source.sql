-- End-user UD uses its own registered customer address/identity. Neither an
-- installation/invoice address nor a caller hint is a customer masterdata basis.
-- Signed original declarations remain unseeded until independently approved.
BEGIN;
CREATE SCHEMA gridex_customer_masterdata;
REVOKE ALL ON SCHEMA gridex_customer_masterdata FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_customer_masterdata.signed_declarations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),customer_id uuid NOT NULL REFERENCES public.customers(id),environment text NOT NULL CHECK(environment IN('test','production')),
 contract_id uuid NOT NULL REFERENCES public.customer_contracts(id),contract_revision text NOT NULL,contract_hash text NOT NULL CHECK(contract_hash~'^[a-f0-9]{64}$'),agreement_original bytea NOT NULL CHECK(octet_length(agreement_original) BETWEEN 1 AND 10485760),agreement_sha256 text NOT NULL CHECK(agreement_sha256=encode(sha256(agreement_original),'hex')),
 valid_from timestamptz NOT NULL,valid_to timestamptz CHECK(valid_to>valid_from),customer_identity jsonb NOT NULL,end_user_masterdata jsonb NOT NULL,
 source_reference text NOT NULL CHECK(length(source_reference)>0),source_version text NOT NULL CHECK(length(source_version)>0),source_original bytea NOT NULL CHECK(octet_length(source_original) BETWEEN 1 AND 10485760),source_sha256 text NOT NULL CHECK(source_sha256=encode(sha256(source_original),'hex')),
 approved_by uuid NOT NULL REFERENCES auth.users(id),approved_at timestamptz NOT NULL,UNIQUE(company_id,customer_id,environment,source_reference,source_version));
CREATE TABLE gridex_customer_masterdata.revocations(declaration_id uuid PRIMARY KEY REFERENCES gridex_customer_masterdata.signed_declarations(id),source_reference text NOT NULL CHECK(length(source_reference)>0),source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),actor_user_id uuid NOT NULL REFERENCES auth.users(id),revoked_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gridex_customer_masterdata.preparations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),customer_id uuid NOT NULL REFERENCES public.customers(id),environment text CHECK(environment IN('test','production')),as_of timestamptz NOT NULL,observed_at timestamptz NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),basis jsonb NOT NULL,basis_hash text NOT NULL CHECK(basis_hash=encode(sha256(convert_to(basis::text,'UTF8')),'hex')),UNIQUE NULLS NOT DISTINCT(company_id,customer_id,environment,as_of,basis_hash));
CREATE TABLE gridex_customer_masterdata.originals(message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL,preparation_id uuid NOT NULL REFERENCES gridex_customer_masterdata.preparations(id),payload_hash text NOT NULL,bound_at timestamptz NOT NULL DEFAULT now());
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['signed_declarations','revocations','preparations','originals'] LOOP
 EXECUTE format('ALTER TABLE gridex_customer_masterdata.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_customer_masterdata.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_customer_masterdata.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER customer_masterdata_immutable BEFORE UPDATE OR DELETE ON gridex_customer_masterdata.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
 EXECUTE format('CREATE TRIGGER customer_masterdata_no_truncate BEFORE TRUNCATE ON gridex_customer_masterdata.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
END LOOP;END$$;
CREATE FUNCTION gridex_customer_masterdata.literal_masterdata_v1(d jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(d)='object' AND NOT EXISTS(SELECT FROM jsonb_object_keys(d) k WHERE k NOT IN('nameParts','streetParts','postalCode','city','country'))
 AND jsonb_typeof(d->'nameParts')='array' AND jsonb_array_length(d->'nameParts') BETWEEN 1 AND 2 AND NOT EXISTS(SELECT FROM jsonb_array_elements(d->'nameParts') item WHERE jsonb_typeof(item)<>'string' OR length(item#>>'{}') NOT BETWEEN 1 AND 35 OR (item#>>'{}')~'[[:cntrl:]]')
 AND jsonb_typeof(d->'streetParts')='array' AND jsonb_array_length(d->'streetParts') BETWEEN 1 AND 3 AND NOT EXISTS(SELECT FROM jsonb_array_elements(d->'streetParts') item WHERE jsonb_typeof(item)<>'string' OR length(item#>>'{}') NOT BETWEEN 1 AND 35 OR (item#>>'{}')~'[[:cntrl:]]')
 AND length(d->>'postalCode') BETWEEN 1 AND 17 AND length(d->>'city') BETWEEN 1 AND 35 AND length(d->>'country')=2 AND (d->>'country')~'^[A-Z]{2}$' AND (d->>'postalCode')!~'[[:cntrl:]]' AND (d->>'city')!~'[[:cntrl:]]'
$$;
CREATE FUNCTION gridex_customer_masterdata.identity_v1(d jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT jsonb_typeof(d)='object' AND (d->>'qualifier' IN('SE1','SE2')) IS TRUE AND d->>'agency'='260' AND length(d->>'id') BETWEEN 1 AND 35 AND d->>'id'=btrim(d->>'id') AND (d->>'id')!~'[[:cntrl:]]'$$;
ALTER TABLE gridex_customer_masterdata.signed_declarations ADD CHECK(gridex_customer_masterdata.literal_masterdata_v1(end_user_masterdata) IS TRUE),ADD CHECK(gridex_customer_masterdata.identity_v1(customer_identity) IS TRUE);
CREATE FUNCTION gridex_customer_masterdata.declaration_scope_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE c uuid;customer uuid;BEGIN
 IF TG_TABLE_NAME='revocations' THEN SELECT company_id,customer_id INTO c,customer FROM gridex_customer_masterdata.signed_declarations WHERE id=NEW.declaration_id;ELSE c:=NEW.company_id;customer:=NEW.customer_id;END IF;
 IF c IS NULL OR customer IS NULL THEN RAISE EXCEPTION 'customer_masterdata_declaration_scope_required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-masterdata:'||c::text||':'||customer::text,0));
 IF TG_TABLE_NAME='revocations' THEN PERFORM id FROM gridex_customer_masterdata.signed_declarations WHERE id=NEW.declaration_id FOR UPDATE;END IF;RETURN NEW;END$$;
CREATE TRIGGER customer_masterdata_declaration_scope BEFORE INSERT ON gridex_customer_masterdata.signed_declarations FOR EACH ROW EXECUTE FUNCTION gridex_customer_masterdata.declaration_scope_v1();
CREATE TRIGGER customer_masterdata_revocation_scope BEFORE INSERT ON gridex_customer_masterdata.revocations FOR EACH ROW EXECUTE FUNCTION gridex_customer_masterdata.declaration_scope_v1();
CREATE FUNCTION gridex_customer_masterdata.basis_v1(c uuid,customer uuid,actor uuid,at timestamptz,env text,phase text,observed timestamptz DEFAULT statement_timestamp(),expected_sources jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person public.customers%rowtype;address public.customer_addresses%rowtype;declaration gridex_customer_masterdata.signed_declarations%rowtype;contract public.customer_contracts%rowtype;identity jsonb;masterdata jsonb;life jsonb;source_kind text;source_reference text;source_digest text;source jsonb;day date;name text;source_ids jsonb;BEGIN
 PERFORM gridex_customer_life_events.require_actor_v1(c,actor,phase);
 IF at IS NULL OR observed IS NULL OR NOT isfinite(at) OR NOT isfinite(observed) OR observed>statement_timestamp() OR (env IS NOT NULL AND (env IN('test','production')) IS NOT TRUE) THEN RAISE EXCEPTION 'customer_masterdata_scope_required';END IF;
 -- All immutable customer-event sources precede mutable customer/address locks.
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO source_ids FROM(SELECT DISTINCT source_message_id id FROM gridex_customer_life_events.customer_versions WHERE company_id=c AND customer_id=customer) ids;
 PERFORM m.id FROM public.ediel_messages m WHERE m.company_id=c AND m.id IN(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(expected_sources,source_ids))) ORDER BY m.id FOR UPDATE;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('customer-masterdata:'||c::text||':'||customer::text,0));
 PERFORM ct.id FROM public.customer_contracts ct WHERE ct.company_id=c AND ct.id IN(SELECT d.contract_id FROM gridex_customer_masterdata.signed_declarations d WHERE d.company_id=c AND d.customer_id=customer AND (env IS NULL OR d.environment=env)) ORDER BY ct.id FOR SHARE;
 SELECT * INTO person FROM public.customers WHERE id=customer AND company_id=c FOR UPDATE;
 IF coalesce(expected_sources,source_ids) IS DISTINCT FROM(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM(SELECT DISTINCT source_message_id id FROM gridex_customer_life_events.customer_versions WHERE company_id=c AND customer_id=customer) ids) THEN RAISE EXCEPTION 'customer_masterdata_source_epoch_changed' USING ERRCODE='40001';END IF;
 IF person.id IS NULL THEN RAISE EXCEPTION 'customer_masterdata_tenant_required' USING ERRCODE='42501';END IF;
 life:=public.ediel_customer_life_event_export_at_v1(c,customer,actor,at);
 day:=(at AT TIME ZONE 'Etc/GMT-1')::date;
 -- Future-only E effects have not altered today's observed customer/address.
 -- This current-day source is not a reconstruction of an earlier unknown day.
 IF life->>'status'='held' THEN
  IF day=(observed AT TIME ZONE 'Etc/GMT-1')::date AND NOT EXISTS(SELECT FROM gridex_customer_life_events.customer_versions v WHERE v.company_id=c AND v.customer_id=customer AND v.effective_at<=at) THEN life:=NULL;
  ELSE RETURN life;END IF;
 END IF;
 -- A mutable identity without its own dated source is observed current data,
 -- not a statement about a different historical/future market day.
 IF day=(observed AT TIME ZONE 'Etc/GMT-1')::date THEN
  PERFORM id FROM public.customer_addresses WHERE company_id=c AND customer_id=customer AND type='registered' ORDER BY id FOR SHARE;
  IF (SELECT count(*) FROM public.customer_addresses a WHERE a.company_id=c AND a.customer_id=customer AND a.type='registered' AND a.is_active IS TRUE AND (a.moved_in_at IS NULL OR a.moved_in_at<=day) AND (a.moved_out_at IS NULL OR day<a.moved_out_at))>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unique_owned_registered_customer_address']);END IF;
  SELECT * INTO address FROM public.customer_addresses a WHERE a.company_id=c AND a.customer_id=customer AND a.type='registered' AND a.is_active IS TRUE AND (a.moved_in_at IS NULL OR a.moved_in_at<=day) AND (a.moved_out_at IS NULL OR day<a.moved_out_at);
  IF address.id IS NOT NULL THEN
   identity:=CASE WHEN nullif(person.org_number,'') IS NOT NULL THEN jsonb_build_object('id',person.org_number,'qualifier','SE1','agency','260') WHEN nullif(person.personal_number,'') IS NOT NULL THEN jsonb_build_object('id',person.personal_number,'qualifier','SE2','agency','260') END;
   name:=coalesce(nullif(person.company_name,''),nullif(person.full_name,''),nullif(person.name,''));
   masterdata:=jsonb_build_object('nameParts',CASE WHEN length(name)<=35 THEN jsonb_build_array(name) WHEN length(name)<=70 THEN jsonb_build_array(substr(name,1,35),substr(name,36)) ELSE '[]'::jsonb END,'streetParts',CASE WHEN nullif(address.street_2,'') IS NULL THEN jsonb_build_array(address.street_1) ELSE jsonb_build_array(address.street_1,address.street_2) END,'postalCode',address.postal_code,'city',address.city,'country',address.country);
   source_kind:='registered_customer_address';source_reference:=address.id::text;
   source:=jsonb_build_object('customer',jsonb_build_object('id',person.id,'org_number',person.org_number,'personal_number',person.personal_number,'company_name',person.company_name,'full_name',person.full_name,'name',person.name),'address',to_jsonb(address));
  END IF;
 END IF;
 IF masterdata IS NULL OR gridex_customer_masterdata.identity_v1(identity) IS NOT TRUE OR gridex_customer_masterdata.literal_masterdata_v1(masterdata) IS NOT TRUE THEN
  IF env IS NOT NULL THEN
   PERFORM id FROM gridex_customer_masterdata.signed_declarations d WHERE d.company_id=c AND d.customer_id=customer AND d.environment=env ORDER BY id FOR SHARE;
   IF (SELECT count(*) FROM gridex_customer_masterdata.signed_declarations d WHERE d.company_id=c AND d.customer_id=customer AND d.environment=env AND d.approved_at<=statement_timestamp() AND d.valid_from<=at AND (d.valid_to IS NULL OR at<d.valid_to) AND NOT EXISTS(SELECT FROM gridex_customer_masterdata.revocations r WHERE r.declaration_id=d.id))>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unique_authentic_signed_customer_masterdata_declaration']);END IF;
   SELECT * INTO declaration FROM gridex_customer_masterdata.signed_declarations d WHERE d.company_id=c AND d.customer_id=customer AND d.environment=env AND d.approved_at<=statement_timestamp() AND d.valid_from<=at AND (d.valid_to IS NULL OR at<d.valid_to) AND NOT EXISTS(SELECT FROM gridex_customer_masterdata.revocations r WHERE r.declaration_id=d.id);
   IF declaration.id IS NOT NULL THEN
    SELECT * INTO contract FROM public.customer_contracts WHERE id=declaration.contract_id AND company_id=c FOR SHARE;
    IF contract.id IS NULL OR contract.customer_id IS DISTINCT FROM customer OR (contract.status IN('signed','active')) IS NOT TRUE OR contract.signed_at IS NULL OR contract.signed_version IS DISTINCT FROM declaration.contract_revision OR contract.document_sha256 IS DISTINCT FROM declaration.agreement_sha256 OR gridex_received_sources.production_contract_hash_v1(contract) IS DISTINCT FROM declaration.contract_hash THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_authentic_signed_masterdata_customer_contract']);END IF;
    identity:=declaration.customer_identity;masterdata:=declaration.end_user_masterdata;source_kind:='signed_contract_masterdata';source_reference:=declaration.source_reference;source:=to_jsonb(declaration);
   END IF;
  END IF;
 END IF;
 -- E owns each changed field. Its qualified effective projection overlays the
 -- end-user source, without ever falling back field-by-field to IT/IV.
 IF life->>'status'='authorized' AND (life->>'effectiveVersionCount')::integer>0 THEN
  IF life#>>'{customerFields,org_number}' IS NOT NULL THEN identity:=jsonb_build_object('id',life#>>'{customerFields,org_number}','qualifier','SE1','agency','260');ELSIF life#>>'{customerFields,personal_number}' IS NOT NULL THEN identity:=jsonb_build_object('id',life#>>'{customerFields,personal_number}','qualifier','SE2','agency','260');END IF;
  masterdata:=coalesce(masterdata,'{}')||jsonb_strip_nulls(jsonb_build_object('nameParts',life#>'{endUserMasterdata,name}','streetParts',life#>'{endUserMasterdata,street}','postalCode',life#>'{endUserMasterdata,postCode}','city',life#>'{endUserMasterdata,city}','country',life#>'{endUserMasterdata,country}'));
  source:=jsonb_build_object('base',source,'customerHistory',life);source_kind:='confirmed_customer_history';source_reference:=life->>'sourceMessageId';
 END IF;
 IF gridex_customer_masterdata.identity_v1(identity) IS NOT TRUE OR gridex_customer_masterdata.literal_masterdata_v1(masterdata) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_qualified_customer_identity_registered_address_at_requested_time']);END IF;
 source_digest:=encode(sha256(convert_to(source::text,'UTF8')),'hex');
 RETURN jsonb_build_object('status','authorized','companyId',c,'customerId',customer,'environment',env,'asOf',at,'sourceKind',source_kind,'sourceReference',source_reference,'sourceDigest',source_digest,'customerIdentity',identity,'endUserMasterdata',masterdata,'sourceProof',jsonb_build_object('rowProof',source,'sourceIds',source_ids));
END$$;
CREATE FUNCTION public.ediel_prepare_customer_masterdata_v1(p_company_id uuid,p_customer_id uuid,p_actor_user_id uuid,p_as_of timestamptz,p_environment text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;prep gridex_customer_masterdata.preparations%rowtype;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_masterdata_service_required' USING ERRCODE='42501';END IF;
 b:=gridex_customer_masterdata.basis_v1(p_company_id,p_customer_id,p_actor_user_id,p_as_of,p_environment,'prepare');IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 INSERT INTO gridex_customer_masterdata.preparations(company_id,customer_id,environment,as_of,observed_at,actor_user_id,basis,basis_hash) VALUES(p_company_id,p_customer_id,p_environment,p_as_of,statement_timestamp(),p_actor_user_id,b,encode(sha256(convert_to(b::text,'UTF8')),'hex')) ON CONFLICT DO NOTHING RETURNING * INTO prep;
 IF prep.id IS NULL THEN SELECT * INTO STRICT prep FROM gridex_customer_masterdata.preparations WHERE company_id=p_company_id AND customer_id=p_customer_id AND environment IS NOT DISTINCT FROM p_environment AND as_of=p_as_of AND basis=b;END IF;
 RETURN (b-'sourceProof')||jsonb_build_object('sourceContextId',prep.id);
END$$;
CREATE FUNCTION gridex_customer_masterdata.wire_ud_v1(raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$DECLARE token jsonb;parts jsonb;objects jsonb:='[]';BEGIN
 FOR token IN SELECT item FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(raw)) item LOOP
  IF token->>'tag'='NAD' AND token#>>'{elements,1,0}'='UD' THEN
   IF jsonb_array_length(token#>'{elements,2}') IS DISTINCT FROM 3 THEN RETURN NULL;END IF;
   parts:=jsonb_build_object('customerIdentity',jsonb_build_object('id',token#>>'{elements,2,0}','qualifier',token#>>'{elements,2,1}','agency',token#>>'{elements,2,2}'),'endUserMasterdata',jsonb_build_object('nameParts',token#>'{elements,4}','streetParts',token#>'{elements,5}','postalCode',token#>>'{elements,8,0}','city',token#>>'{elements,6,0}','country',token#>>'{elements,9,0}'));
   objects:=objects||jsonb_build_array(parts);
  END IF;
 END LOOP;RETURN objects;
END$$;
CREATE FUNCTION gridex_customer_masterdata.require_current_v1(c uuid,message uuid,actor uuid,phase text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;p gridex_customer_masterdata.preparations%rowtype;b jsonb;ud jsonb;obj jsonb;q jsonb;BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=message AND company_id=c FOR UPDATE;IF m.id IS NULL THEN RAISE EXCEPTION 'customer_masterdata_message_required';END IF;
 IF m.direction<>'outbound' OR m.message_family<>'PRODAT' OR (m.message_code IN('Z01','Z03')) IS NOT TRUE THEN RETURN;END IF;
 ud:=gridex_customer_masterdata.wire_ud_v1(m.raw_payload);IF ud IS NOT NULL AND jsonb_array_length(ud)=0 THEN RETURN;END IF;
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
 FOR obj IN SELECT item FROM jsonb_array_elements(ud)item LOOP IF obj->'customerIdentity' IS DISTINCT FROM b->'customerIdentity' OR obj->'endUserMasterdata' IS DISTINCT FROM b->'endUserMasterdata' THEN RAISE EXCEPTION 'customer_masterdata_actual_wire_changed';END IF;END LOOP;
END$$;
CREATE FUNCTION gridex_customer_masterdata.prelock_new_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE p gridex_customer_masterdata.preparations%rowtype;BEGIN
 IF NEW.direction='outbound' AND NEW.message_family='PRODAT' AND NEW.message_code IN('Z01','Z03') AND nullif(NEW.parsed_payload->>'customerMasterdataSourceContextId','') IS NOT NULL THEN
 SELECT * INTO p FROM gridex_customer_masterdata.preparations WHERE id=(NEW.parsed_payload->>'customerMasterdataSourceContextId')::uuid AND company_id=NEW.company_id;
 IF p.id IS NOT NULL THEN PERFORM m.id FROM public.ediel_messages m WHERE m.company_id=NEW.company_id AND m.id IN(SELECT value::uuid FROM jsonb_array_elements_text(p.basis#>'{sourceProof,sourceIds}')) ORDER BY m.id FOR UPDATE;END IF;END IF;RETURN NEW;END$$;
CREATE TRIGGER ediel_customer_masterdata_prelock BEFORE INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_customer_masterdata.prelock_new_v1();
CREATE FUNCTION gridex_customer_masterdata.prelock_message_v1(c uuid,message uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT NULL FROM public.ediel_messages m WHERE m.company_id=c AND m.id IN(SELECT value::uuid FROM gridex_customer_masterdata.originals o JOIN gridex_customer_masterdata.preparations p ON p.id=o.preparation_id CROSS JOIN LATERAL jsonb_array_elements_text(p.basis#>'{sourceProof,sourceIds}') WHERE o.company_id=c AND o.message_id=message) ORDER BY m.id FOR UPDATE$$;
CREATE FUNCTION gridex_customer_masterdata.bind_original_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE p gridex_customer_masterdata.preparations%rowtype;b jsonb;obj jsonb;ud jsonb;q jsonb;fixture_actor uuid;BEGIN
 IF NEW.direction<>'outbound' OR NEW.message_family<>'PRODAT' OR (NEW.message_code IN('Z01','Z03')) IS NOT TRUE THEN RETURN NEW;END IF;
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
 FOR obj IN SELECT item FROM jsonb_array_elements(ud)item LOOP IF obj->'customerIdentity' IS DISTINCT FROM b->'customerIdentity' OR obj->'endUserMasterdata' IS DISTINCT FROM b->'endUserMasterdata' THEN RAISE EXCEPTION 'customer_masterdata_actual_wire_changed';END IF;END LOOP;
 INSERT INTO gridex_customer_masterdata.originals(message_id,company_id,preparation_id,payload_hash) VALUES(NEW.id,NEW.company_id,p.id,NEW.immutable_payload_hash);RETURN NEW;
END$$;
CREATE TRIGGER ediel_customer_masterdata_bind AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_customer_masterdata.bind_original_v1();
CREATE FUNCTION public.ediel_customer_masterdata_message_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE p gridex_customer_masterdata.preparations%rowtype;m public.ediel_messages%rowtype;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_masterdata_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_customer_masterdata.prelock_message_v1(p_company_id,p_message_id);
 PERFORM gridex_customer_masterdata.require_current_v1(p_company_id,p_message_id,p_actor_user_id,'send');
 SELECT prep.* INTO p FROM gridex_customer_masterdata.originals o JOIN gridex_customer_masterdata.preparations prep ON prep.id=o.preparation_id WHERE o.company_id=p_company_id AND o.message_id=p_message_id;
 IF p.id IS NULL THEN RETURN NULL;END IF;SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id;RETURN (p.basis-'sourceProof')||jsonb_build_object('sourceContextId',p.id,'messageBinding',jsonb_build_object('id',m.id,'environment',m.environment,'intentId',m.intent_id,'routeId',m.communication_route_id,'payloadHash',m.immutable_payload_hash));END$$;
REVOKE ALL ON FUNCTION public.ediel_customer_masterdata_message_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION public.ediel_customer_masterdata_message_basis_v1(uuid,uuid,uuid) TO service_role;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_customer_masterdata' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);END LOOP;END$$;
REVOKE ALL ON FUNCTION public.ediel_prepare_customer_masterdata_v1(uuid,uuid,uuid,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_prepare_customer_masterdata_v1(uuid,uuid,uuid,timestamptz,text) TO service_role;
COMMIT;
