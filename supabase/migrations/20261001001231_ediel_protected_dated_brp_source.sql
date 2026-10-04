-- P262: one source port for dated received responsibility and explicit first
-- signed-agreement declarations. B desired receipts never prove market state.
-- Qualification receipts are read derivatives, not business/approval events.
BEGIN;
CREATE SCHEMA gridex_brp_sources;
REVOKE ALL ON SCHEMA gridex_brp_sources FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_brp_sources.contract_declarations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),previous_declaration_id uuid UNIQUE REFERENCES gridex_brp_sources.contract_declarations(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),contract_id uuid NOT NULL REFERENCES public.customer_contracts(id),contract_revision text NOT NULL,protected_contract_hash text NOT NULL CHECK(protected_contract_hash~'^[a-f0-9]{64}$'),
 customer_id uuid NOT NULL REFERENCES public.customers(id),site_id uuid NOT NULL REFERENCES public.customer_sites(id),metering_point_id uuid NOT NULL REFERENCES public.metering_points(id),
 legal_actor_id uuid NOT NULL,legal_sender_id text NOT NULL,legal_receiver_id text NOT NULL,point_id text NOT NULL,identity_agency text NOT NULL CHECK(identity_agency IN('9','89')),grid_area_code text NOT NULL,
 registry_ground_id uuid NOT NULL REFERENCES gridex_brp_changes.registry_grounds(id),brp_ediel_id text NOT NULL CHECK(length(brp_ediel_id) BETWEEN 1 AND 35 AND brp_ediel_id=btrim(brp_ediel_id)),
 agreement_original bytea NOT NULL CHECK(octet_length(agreement_original) BETWEEN 1 AND 10485760),agreement_sha256 text NOT NULL CHECK(agreement_sha256=encode(sha256(agreement_original),'hex')),
 source_reference text NOT NULL CHECK(length(source_reference)>0),source_version text NOT NULL CHECK(length(source_version)>0),source_original bytea NOT NULL CHECK(octet_length(source_original) BETWEEN 1 AND 10485760),source_sha256 text NOT NULL CHECK(source_sha256=encode(sha256(source_original),'hex')),approved_by uuid NOT NULL REFERENCES auth.users(id),approved_at timestamptz NOT NULL,
 UNIQUE(company_id,environment,contract_id,source_reference,source_version));
CREATE TABLE gridex_brp_sources.contract_revocations(declaration_id uuid PRIMARY KEY REFERENCES gridex_brp_sources.contract_declarations(id),source_reference text NOT NULL,source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),actor_user_id uuid NOT NULL REFERENCES auth.users(id),revoked_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gridex_brp_sources.qualified_candidates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,environment text NOT NULL,customer_id uuid NOT NULL,site_id uuid NOT NULL,metering_point_id uuid NOT NULL,supply_period_id uuid NOT NULL,at timestamptz NOT NULL,
 snapshot_id uuid NOT NULL REFERENCES gridex_received_sources.object_selection_snapshots(id),readset_hash text NOT NULL,source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id),basis jsonb NOT NULL,qualified_by uuid NOT NULL REFERENCES auth.users(id),qualified_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,environment,supply_period_id,at,snapshot_id,source_message_id));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['contract_declarations','contract_revocations','qualified_candidates'] LOOP
 EXECUTE format('ALTER TABLE gridex_brp_sources.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_brp_sources.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON gridex_brp_sources.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER brp_source_no_mutation BEFORE UPDATE OR DELETE ON gridex_brp_sources.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);EXECUTE format('CREATE TRIGGER brp_source_no_truncate BEFORE TRUNCATE ON gridex_brp_sources.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
END LOOP;END$$;
CREATE FUNCTION gridex_brp_sources.declaration_scope_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE prior gridex_brp_sources.contract_declarations%rowtype;BEGIN
 IF TG_TABLE_NAME='contract_revocations' THEN SELECT * INTO prior FROM gridex_brp_sources.contract_declarations WHERE id=NEW.declaration_id;IF prior.id IS NULL THEN RAISE EXCEPTION 'brp_declaration_original_required';END IF;PERFORM pg_advisory_xact_lock(hashtextextended('contract-brp:'||prior.company_id::text||':'||prior.contract_id::text,0));PERFORM id FROM gridex_brp_sources.contract_declarations WHERE id=prior.id FOR UPDATE;
 ELSE PERFORM pg_advisory_xact_lock(hashtextextended('contract-brp:'||NEW.company_id::text||':'||NEW.contract_id::text,0));IF NEW.previous_declaration_id IS NOT NULL THEN SELECT * INTO prior FROM gridex_brp_sources.contract_declarations WHERE id=NEW.previous_declaration_id FOR UPDATE;IF prior.company_id IS DISTINCT FROM NEW.company_id OR prior.contract_id IS DISTINCT FROM NEW.contract_id OR prior.environment IS DISTINCT FROM NEW.environment OR NEW.approved_at<prior.approved_at THEN RAISE EXCEPTION 'brp_declaration_own_version_required';END IF;END IF;END IF;RETURN NEW;
END$$;
CREATE TRIGGER brp_declaration_scope BEFORE INSERT ON gridex_brp_sources.contract_declarations FOR EACH ROW EXECUTE FUNCTION gridex_brp_sources.declaration_scope_v1();
CREATE TRIGGER brp_revocation_scope BEFORE INSERT ON gridex_brp_sources.contract_revocations FOR EACH ROW EXECUTE FUNCTION gridex_brp_sources.declaration_scope_v1();
CREATE FUNCTION gridex_brp_sources.registry_basis_v1(c uuid,env text,network text,grid text,brp text,at timestamptz,ground uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g gridex_brp_changes.registry_grounds%rowtype;n integer;BEGIN
 SELECT count(*) INTO n FROM gridex_brp_changes.registry_grounds x WHERE x.company_id=c AND x.environment=env AND x.dso_ediel_id=network AND x.grid_area_code=grid AND x.brp_ediel_id=brp AND (ground IS NULL OR x.id=ground) AND x.approved_at<=statement_timestamp() AND x.valid_from<=at AND (x.valid_to IS NULL OR at<x.valid_to) AND NOT EXISTS(SELECT FROM gridex_brp_changes.revocations r WHERE r.target_kind='registry' AND r.target_id=x.id);
 IF n<>1 THEN RETURN NULL;END IF;
 SELECT * INTO g FROM gridex_brp_changes.registry_grounds x WHERE x.company_id=c AND x.environment=env AND x.dso_ediel_id=network AND x.grid_area_code=grid AND x.brp_ediel_id=brp AND (ground IS NULL OR x.id=ground) AND x.approved_at<=statement_timestamp() AND x.valid_from<=at AND (x.valid_to IS NULL OR at<x.valid_to) AND NOT EXISTS(SELECT FROM gridex_brp_changes.revocations r WHERE r.target_kind='registry' AND r.target_id=x.id) FOR SHARE;
 -- The revoker locks the parent without changing it. Recheck after SHARE so
 -- a committed revocation observed while waiting cannot escape this phase.
 IF g.id IS NULL OR EXISTS(SELECT FROM gridex_brp_changes.revocations r WHERE r.target_kind='registry' AND r.target_id=g.id) THEN RETURN NULL;END IF;
 PERFORM a.id FROM public.platform_market_actors a WHERE a.id IN(g.dso_actor_id,g.brp_actor_id) ORDER BY a.id FOR SHARE;PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.actor_id IN(g.dso_actor_id,g.brp_actor_id) ORDER BY i.id FOR SHARE;PERFORM r.id FROM public.platform_actor_roles r WHERE r.actor_id IN(g.dso_actor_id,g.brp_actor_id) ORDER BY r.id FOR SHARE;
 IF g.registry_snapshot IS DISTINCT FROM gridex_brp_changes.registry_snapshot_v1(g.dso_actor_id,g.brp_actor_id)
 OR NOT EXISTS(SELECT FROM public.platform_market_actors WHERE id=g.dso_actor_id AND status='active' AND match_status='verified') OR NOT EXISTS(SELECT FROM public.platform_market_actors WHERE id=g.brp_actor_id AND status='active' AND match_status='verified')
 OR NOT EXISTS(SELECT FROM public.platform_actor_roles WHERE actor_id=g.dso_actor_id AND actor_role='grid_owner' AND is_active) OR NOT EXISTS(SELECT FROM public.platform_actor_roles WHERE actor_id=g.brp_actor_id AND actor_role='balance_responsible' AND is_active)
 OR (SELECT count(DISTINCT actor_id) FROM public.platform_actor_identifiers WHERE lower(identifier_type) IN('edielid','ediel_id') AND identifier_value=network AND is_verified AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR valid_to>=current_date))<>1
 OR NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE actor_id=g.dso_actor_id AND lower(identifier_type) IN('edielid','ediel_id') AND identifier_value=network AND is_verified AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR valid_to>=current_date))
 OR (SELECT count(DISTINCT actor_id) FROM public.platform_actor_identifiers WHERE lower(identifier_type) IN('edielid','ediel_id') AND identifier_value=brp AND is_verified AND (valid_from IS NULL OR valid_from<=(at AT TIME ZONE 'Etc/GMT-1')::date) AND (valid_to IS NULL OR valid_to>=(at AT TIME ZONE 'Etc/GMT-1')::date))<>1
 OR NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE actor_id=g.brp_actor_id AND lower(identifier_type) IN('edielid','ediel_id') AND identifier_value=brp AND is_verified AND (valid_from IS NULL OR valid_from<=(at AT TIME ZONE 'Etc/GMT-1')::date) AND (valid_to IS NULL OR valid_to>=(at AT TIME ZONE 'Etc/GMT-1')::date)) THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('registryGroundId',g.id,'registryVersion',g.registry_version,'registrySha256',g.source_sha256,'brpActorId',g.brp_actor_id);
END$$;
-- A received change becomes a usable source through its immutable actual
-- application receipt. An accepted parser/ACK facet alone is insufficient.
CREATE FUNCTION gridex_received_sources.structural_effect_matches_v1(c uuid,env text,source_id uuid,assessment_id uuid,customer uuid,site uuid,point uuid,period uuid,object_id text,agency text,cutoff timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT count(*)=1 FROM gridex_received_sources.structural_apply_receipts r
 JOIN gridex_received_sources.sources s ON s.source_message_id=r.source_message_id AND s.company_id=r.company_id AND s.environment=r.environment AND s.payload_hash=r.payload_hash
 JOIN gridex_received_sources.object_assessments a ON a.id=r.object_assessment_id AND a.company_id=r.company_id AND a.environment=r.environment AND a.source_message_id=r.source_message_id AND a.source_payload_hash=r.payload_hash AND a.canonical_assessment_id=r.canonical_assessment_id,
 LATERAL jsonb_array_elements(a.facts_text::jsonb->'objects') own,LATERAL jsonb_array_elements(r.objects) applied
 WHERE r.company_id=c AND r.environment=env AND r.source_message_id=source_id AND r.object_assessment_id=assessment_id AND r.applied_at<=cutoff
 AND s.payload_hash=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') AND a.facts_hash=encode(sha256(convert_to(a.facts_text,'UTF8')),'hex')
 AND own->>'disposition'='accepted' AND own#>>'{business,owner}'='reviewed-received-structure-v1'
 AND own#>>'{business,companyId}'=c::text AND own#>>'{business,environment}'=env AND own#>>'{business,customerId}'=customer::text AND own#>>'{business,siteId}'=site::text AND own#>>'{business,meteringPointId}'=point::text AND own#>>'{business,supplyPeriodId}'=period::text
 AND own#>>'{object,objectId}'=object_id AND own#>>'{object,identityAgency}'=agency AND applied->'object'=own->'object' AND applied->'wire'=own#>'{business,wire}'
 AND applied->>'meteringPointId'=point::text AND applied->>'siteId'=site::text
$$;
REVOKE ALL ON FUNCTION gridex_received_sources.structural_effect_matches_v1(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
-- Equality fence for the SAME structural owner's candidate, not a latest-raw
-- chooser. The existing source_row_basis_v1 owns full witnessed original scope.
CREATE FUNCTION gridex_brp_sources.candidate_v1(body jsonb,cutoff timestamptz,c uuid,env text,customer uuid,site uuid,point uuid,at timestamptz,supply jsonb,state_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE scope public.ediel_message_intents%rowtype;own jsonb;source jsonb;b jsonb;candidate_item jsonb;all_owned jsonb:='[]';active jsonb:='[]';replaced text[]:=ARRAY[]::text[];id text;n integer;cursor_id text;ancestors text[];target jsonb;tokens jsonb;first_line integer;next_line integer;physical_line integer;code text;unknown_entry jsonb;state_at timestamptz;registry jsonb;header jsonb;physical jsonb;network text;supplier text;brp text;field jsonb;
BEGIN
 IF body->>'complete' IS DISTINCT FROM 'true' OR body->>'companyId' IS DISTINCT FROM c::text OR body->>'environment' IS DISTINCT FROM env OR jsonb_typeof(body->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'sources')>1000 OR supply->>'qualified' IS DISTINCT FROM 'true' THEN RETURN NULL;END IF;
 SELECT value INTO own FROM jsonb_array_elements(supply->'sourceObjects');IF jsonb_array_length(supply->'sourceObjects')<>1 OR (own->>'identityAgency' IN('9','89')) IS NOT TRUE THEN RETURN NULL;END IF;
 network:=supply->>'dsoEdielId';
 SELECT value INTO source FROM jsonb_array_elements(body->'sources') WHERE value->>'sourceMessageId'=supply->>'initialSourceMessageId';tokens:=gridex_received_sources.closure_wire_tokens_v2(source->>'rawPayload');
 SELECT t#>>'{elements,2,0}' INTO supplier FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='DO';IF nullif(supplier,'') IS NULL THEN RETURN NULL;END IF;
 scope.company_id:=c;scope.environment:=env;scope.customer_id:=customer;scope.customer_site_id:=site;scope.metering_point_id:=point::text;scope.sender_ediel_id:=supplier;scope.receiver_ediel_id:=network;
 FOR source IN SELECT value FROM jsonb_array_elements(body->'sources') LOOP
  b:=gridex_ai_processing.source_row_basis_v1(body,cutoff,source->>'sourceMessageId',scope,own->>'point',own->>'identityAgency');
  IF b IS NULL THEN
   tokens:=gridex_received_sources.closure_wire_tokens_v2(source->>'rawPayload');IF tokens IS NULL THEN RETURN NULL;END IF;
   SELECT t#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM';IF code NOT IN('Z04','Z06','Z10') THEN CONTINUE;END IF;
   SELECT min((t->>'index')::integer) INTO first_line FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN';
   IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='NAD' AND (t->>'index')::integer<first_line AND t#>>'{elements,1,0}'='FR' AND t#>>'{elements,2,0}'=network AND t#>>'{elements,2,1}'='160' AND t#>>'{elements,2,2}'='SVK') OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='NAD' AND (t->>'index')::integer<first_line AND t#>>'{elements,1,0}'='DO' AND t#>>'{elements,2,0}'=supplier AND t#>>'{elements,2,1}'='160' AND t#>>'{elements,2,2}'='SVK') THEN CONTINUE;END IF;
   SELECT min((t->>'index')::integer) INTO physical_line FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND t#>>'{elements,3,0}'=own->>'point' AND t#>>'{elements,3,3}'=own->>'identityAgency';IF physical_line IS NULL THEN CONTINUE;END IF;
   SELECT value INTO unknown_entry FROM jsonb_array_elements(source->'assessments') value WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(source->'assessments') child WHERE child->>'previousAssessmentId'=value->>'id');
   IF EXISTS(SELECT FROM jsonb_array_elements((unknown_entry->>'factsText')::jsonb->'objects') o WHERE o->>'disposition'='rejected' AND o#>>'{object,objectId}'=own->>'point' AND o#>>'{object,identityAgency}'=own->>'identityAgency') THEN CONTINUE;END IF;
   RETURN NULL;
  END IF;
  IF b#>>'{business,supplyPeriodId}' IS DISTINCT FROM supply->>'periodId' THEN CONTINUE;END IF;
  IF NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments a JOIN gridex_received_sources.validation_assessments v ON v.id=a.canonical_assessment_id WHERE a.id=(b->>'assessmentId')::uuid AND a.company_id=c AND a.environment=env AND a.source_message_id::text=source->>'sourceMessageId' AND v.source_payload_hash=source->>'payloadHash' AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
  IF b#>>'{business,coverageWindow,baselineSourceMessageId}' IS DISTINCT FROM supply->>'initialSourceMessageId' THEN RETURN NULL;END IF;
  all_owned:=all_owned||jsonb_build_array(jsonb_build_object('id',source->>'sourceMessageId','basis',b));
 END LOOP;
 FOR candidate_item IN SELECT value FROM jsonb_array_elements(all_owned) LOOP
  b:=candidate_item->'basis';IF b#>>'{business,wire,functionCode}'='5' THEN
   id:=b#>>'{business,replaces,sourceMessageId}';SELECT count(*) INTO n FROM jsonb_array_elements(all_owned) old WHERE old->>'id'=id AND old#>>'{basis,business,sourcePayloadHash}'=b#>>'{business,replaces,payloadHash}' AND old#>>'{basis,assessmentId}'=b#>>'{business,replaces,assessmentId}' AND old#>>'{basis,business,wire,messageCode}'=b#>>'{business,wire,messageCode}' AND old#>>'{basis,business,wire,businessCase}'=b#>>'{business,wire,businessCase}' AND old#>>'{basis,business,wire,caseReference}'=b#>>'{business,wire,caseReference}';
   IF n<>1 OR id=ANY(replaced) OR id=candidate_item->>'id' THEN RETURN NULL;END IF;replaced:=array_append(replaced,id);
  ELSIF b#>'{business,replaces}' IS NOT NULL AND b#>'{business,replaces}'<>'null'::jsonb THEN RETURN NULL;END IF;
 END LOOP;
 FOR candidate_item IN SELECT value FROM jsonb_array_elements(all_owned) LOOP
  cursor_id:=candidate_item->>'id';ancestors:=ARRAY[]::text[];WHILE cursor_id IS NOT NULL LOOP IF cursor_id=ANY(ancestors) OR cardinality(ancestors)>1000 THEN RETURN NULL;END IF;ancestors:=array_append(ancestors,cursor_id);SELECT value#>>'{basis,business,replaces,sourceMessageId}' INTO cursor_id FROM jsonb_array_elements(all_owned) value WHERE value->>'id'=cursor_id;END LOOP;
  IF NOT(candidate_item->>'id'=ANY(replaced)) AND candidate_item#>>'{basis,business,wire,businessCase}'<>'customer_only' THEN active:=active||jsonb_build_array(candidate_item);END IF;
 END LOOP;
 -- Preserve the existing structural owner's same-time ambiguity rule even
 -- when a later object contributes no usable value for this individual field.
 IF EXISTS(SELECT FROM jsonb_array_elements(active) x WHERE (x#>>'{basis,business,wire,effectiveFrom,utc}')::timestamptz<=at GROUP BY x#>>'{basis,business,wire,effectiveFrom,utc}' HAVING count(*)>1) THEN RETURN NULL;END IF;
 all_owned:=active;active:='[]'::jsonb;
 FOR candidate_item IN SELECT value FROM jsonb_array_elements(all_owned) LOOP
  b:=candidate_item->'basis';
  SELECT f.fields_text::jsonb INTO field FROM gridex_received_sources.prodat_ignored_field_facets f JOIN gridex_received_sources.object_assessments a ON a.canonical_assessment_id=f.canonical_assessment_id WHERE a.id=(b->>'assessmentId')::uuid AND a.source_message_id::text=candidate_item->>'id' AND a.company_id=c AND a.environment=env AND f.source_payload_hash=b#>>'{business,sourcePayloadHash}' AND f.fields_hash=encode(sha256(convert_to(f.fields_text,'UTF8')),'hex');
  IF field IS NULL THEN RETURN NULL;END IF;
  SELECT value INTO source FROM jsonb_array_elements(body->'sources') WHERE value->>'sourceMessageId'=candidate_item->>'id';tokens:=gridex_received_sources.closure_wire_tokens_v2(source->>'rawPayload');
  SELECT min((t->>'index')::integer) INTO first_line FROM jsonb_array_elements(b->'ownTokens')t WHERE t->>'tag'='LIN';
  SELECT count(*) INTO physical_line FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN' AND (t->>'index')::integer<first_line;
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(field) f WHERE f->>'fieldNumber'='262' AND f#>>'{occurrence,objectId}'=own->>'point' AND f#>>'{occurrence,identityAgency}'=own->>'identityAgency' AND (f#>>'{occurrence,lineIndex}')::integer=physical_line) THEN active:=active||jsonb_build_array(candidate_item);END IF;
 END LOOP;
 SELECT count(*),jsonb_agg(x)->0 INTO n,target FROM jsonb_array_elements(active) x WHERE x->>'id'=state_id::text;IF n<>1 THEN RETURN NULL;END IF;
 b:=target->'basis';state_at:=(b#>>'{business,wire,effectiveFrom,utc}')::timestamptz;
 IF state_at IS NULL OR state_at>at OR state_at<(supply->>'marketStartAt')::timestamptz OR EXISTS(SELECT FROM jsonb_array_elements(active) x WHERE x->>'id'<>state_id::text AND (x#>>'{basis,business,wire,effectiveFrom,utc}')::timestamptz>=state_at AND (x#>>'{basis,business,wire,effectiveFrom,utc}')::timestamptz<=at) THEN RETURN NULL;END IF;
 IF b#>>'{business,wire,messageCode}'<>'Z04' AND gridex_received_sources.structural_effect_matches_v1(c,env,state_id,(b->>'assessmentId')::uuid,customer,site,point,(supply->>'periodId')::uuid,own->>'point',own->>'identityAgency',cutoff) IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT count(*),jsonb_agg(t)->0 INTO n,physical FROM jsonb_array_elements(b->'ownTokens') t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='Z02';
 IF n<>1 OR physical#>>'{elements,2,1}' IS DISTINCT FROM '160' OR physical#>>'{elements,2,2}' IS DISTINCT FROM 'SVK' OR jsonb_array_length(physical#>'{elements,2}')<>3 THEN RETURN NULL;END IF;brp:=physical#>>'{elements,2,0}';IF nullif(brp,'') IS NULL OR brp<>btrim(brp) OR length(brp)>35 THEN RETURN NULL;END IF;
 -- Same accepted canonical invocation's P119 mask, never current rule reselect.
 SELECT f.fields_text::jsonb INTO field FROM gridex_received_sources.prodat_ignored_field_facets f JOIN gridex_received_sources.object_assessments a ON a.canonical_assessment_id=f.canonical_assessment_id WHERE a.id=(b->>'assessmentId')::uuid AND a.source_message_id=state_id AND a.company_id=c AND a.environment=env AND f.source_payload_hash=b#>>'{business,sourcePayloadHash}' AND f.fields_hash=encode(sha256(convert_to(f.fields_text,'UTF8')),'hex');
 SELECT value INTO source FROM jsonb_array_elements(body->'sources') WHERE value->>'sourceMessageId'=state_id::text;tokens:=gridex_received_sources.closure_wire_tokens_v2(source->>'rawPayload');
 SELECT min((t->>'index')::integer) INTO first_line FROM jsonb_array_elements(b->'ownTokens')t WHERE t->>'tag'='LIN';
 SELECT count(*) INTO physical_line FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN' AND (t->>'index')::integer<first_line;
 IF field IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(field) f WHERE f->>'fieldNumber'='262' AND f#>>'{occurrence,objectId}'=own->>'point' AND f#>>'{occurrence,identityAgency}'=own->>'identityAgency' AND (f#>>'{occurrence,lineIndex}')::integer=physical_line) THEN RETURN NULL;END IF;
 registry:=gridex_brp_sources.registry_basis_v1(c,env,network,own->>'gridArea',brp,at);IF registry IS NULL THEN RETURN NULL;END IF;
 header:=gridex_ai_processing.header_company_basis_v1(c,env,supplier,network);IF header->>'legalActorId' IS DISTINCT FROM supply->>'legalActorId' THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('status','authorized','sourceKind','accepted_supply_brp','companyId',c,'environment',env,'customerId',customer,'siteId',site,'meteringPointId',point,'at',at,'supplyPeriodId',supply->>'periodId','brpEdielId',brp,'pointId',own->>'point','identityAgency',own->>'identityAgency','legalActorId',supply->>'legalActorId','legalSenderId',supplier,'legalReceiverId',network,'gridArea',own->>'gridArea','sourceMessageId',state_id,'sourcePayloadHash',b#>>'{business,sourcePayloadHash}','assessmentId',b->>'assessmentId','registryBasis',registry);
END$$;
CREATE FUNCTION gridex_brp_sources.require_source_v1(c uuid,ct uuid,actor uuid,phase text,env text,customer uuid,site uuid,point uuid,p_at timestamptz,period uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE supply jsonb;receipt jsonb;body jsonb;candidate jsonb;answer jsonb;seen text[]:=ARRAY[]::text[];prepared gridex_brp_sources.qualified_candidates%rowtype;contract public.customer_contracts%rowtype;mp public.metering_points%rowtype;cs public.customer_sites%rowtype;d gridex_brp_sources.contract_declarations%rowtype;network jsonb;header jsonb;registry jsonb;n integer;BEGIN
 IF (phase IN('prepare','send')) IS NOT TRUE THEN RAISE EXCEPTION 'brp_source_phase_required';END IF;
 PERFORM gridex_ai_processing.authorize_purpose_phase_v1(c,actor,CASE phase WHEN 'send' THEN 'send' ELSE 'origination' END,NULL);
 IF c IS NULL OR customer IS NULL OR site IS NULL OR point IS NULL OR p_at IS NULL OR NOT isfinite(p_at) OR (env IN('test','production')) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['exact_brp_scope']);END IF;
 IF period IS NOT NULL THEN
  supply:=gridex_received_sources.supply_period_source_at_v1(c,period,p_at);
  IF supply IS NULL OR supply->>'qualified' IS DISTINCT FROM 'true' OR supply->>'customerId' IS DISTINCT FROM customer::text OR supply->>'siteId' IS DISTINCT FROM site::text OR supply->>'meteringPointId' IS DISTINCT FROM point::text OR NOT EXISTS(SELECT FROM gridex_received_sources.sources s WHERE s.source_message_id=(supply->>'initialSourceMessageId')::uuid AND s.company_id=c AND s.environment=env) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_current_source_owned_supply_relation']);END IF;
  receipt:=gridex_received_sources.open_object_selection_snapshot(c,env,clock_timestamp());body:=(receipt->>'readsetText')::jsonb;
  -- The initial original is an explicit candidate only; this fence cannot
  -- approve it when a later own source changes or makes its epoch ambiguous.
  answer:=gridex_brp_sources.candidate_v1(body,(body->>'cutoffAt')::timestamptz,c,env,customer,site,point,p_at,supply,(supply->>'initialSourceMessageId')::uuid);
  IF answer IS NOT NULL THEN seen:=array_append(seen,answer->>'sourceMessageId');END IF;
  FOR prepared IN SELECT * FROM gridex_brp_sources.qualified_candidates q WHERE q.company_id=c AND q.environment=env AND q.customer_id=customer AND q.site_id=site AND q.metering_point_id=point AND q.supply_period_id=period AND q.at=p_at LOOP
   candidate:=gridex_brp_sources.candidate_v1(body,(body->>'cutoffAt')::timestamptz,c,env,customer,site,point,p_at,supply,prepared.source_message_id);
   IF candidate IS NULL OR candidate IS DISTINCT FROM prepared.basis THEN CONTINUE;END IF;
   IF NOT(candidate->>'sourceMessageId'=ANY(seen)) THEN seen:=array_append(seen,candidate->>'sourceMessageId');answer:=candidate;END IF;
  END LOOP;
  IF cardinality(seen)<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_dated_structural_owner_brp_candidate']);END IF;RETURN answer;
 END IF;
 -- A first production/ordinary supply has no earlier DSO relation. Only an
 -- explicit authenticated same-agreement declaration can supply field262.
 SELECT * INTO contract FROM public.customer_contracts WHERE id=ct AND company_id=c FOR SHARE;
 IF contract.id IS NULL OR contract.signed_at IS NULL OR nullif(contract.signed_version,'') IS NULL OR (contract.status IN('signed','active')) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_signed_brp_agreement']);END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('contract-brp:'||c::text||':'||ct::text,0));
 SELECT count(*) INTO n FROM gridex_brp_sources.contract_declarations x WHERE x.company_id=c AND x.environment=env AND x.contract_id=ct AND x.approved_at<=statement_timestamp() AND NOT EXISTS(SELECT FROM gridex_brp_sources.contract_declarations child WHERE child.previous_declaration_id=x.id AND child.approved_at<=statement_timestamp()) AND NOT EXISTS(SELECT FROM gridex_brp_sources.contract_revocations r WHERE r.declaration_id=x.id);
 IF n<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unique_authentic_signed_contract_brp_declaration']);END IF;
 SELECT * INTO d FROM gridex_brp_sources.contract_declarations x WHERE x.company_id=c AND x.environment=env AND x.contract_id=ct AND x.approved_at<=statement_timestamp() AND NOT EXISTS(SELECT FROM gridex_brp_sources.contract_declarations child WHERE child.previous_declaration_id=x.id AND child.approved_at<=statement_timestamp()) AND NOT EXISTS(SELECT FROM gridex_brp_sources.contract_revocations r WHERE r.declaration_id=x.id) FOR SHARE;
 SELECT * INTO mp FROM public.metering_points WHERE id=point AND company_id=c FOR SHARE;SELECT * INTO cs FROM public.customer_sites WHERE id=site AND company_id=c FOR SHARE;
 IF d.customer_id IS DISTINCT FROM customer OR d.site_id IS DISTINCT FROM site OR d.metering_point_id IS DISTINCT FROM point OR contract.customer_id IS DISTINCT FROM customer OR contract.metering_point_id IS DISTINCT FROM point OR coalesce(contract.customer_site_id,contract.site_id) IS DISTINCT FROM site OR contract.customer_site_id IS NOT NULL AND contract.customer_site_id IS DISTINCT FROM site OR contract.site_id IS NOT NULL AND contract.site_id IS DISTINCT FROM site
 OR mp.id IS NULL OR cs.id IS NULL OR mp.customer_id IS DISTINCT FROM customer OR cs.customer_id IS DISTINCT FROM customer OR coalesce(mp.customer_site_id,mp.site_id) IS DISTINCT FROM site OR mp.customer_site_id IS NOT NULL AND mp.customer_site_id IS DISTINCT FROM site OR mp.site_id IS NOT NULL AND mp.site_id IS DISTINCT FROM site OR coalesce(nullif(mp.ediel_metering_point_id,''),nullif(mp.meter_point_id,'')) IS DISTINCT FROM d.point_id OR mp.grid_owner_ediel_id IS DISTINCT FROM d.legal_receiver_id OR mp.grid_area_code IS DISTINCT FROM d.grid_area_code
 OR contract.signed_version IS DISTINCT FROM d.contract_revision OR gridex_received_sources.production_contract_hash_v1(contract) IS DISTINCT FROM d.protected_contract_hash OR contract.document_sha256 IS DISTINCT FROM d.agreement_sha256 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_current_signed_brp_agreement_original_and_scope']);END IF;
 network:=gridex_ai_processing.network_registry_basis_v1(d.legal_receiver_id,env);registry:=gridex_brp_sources.registry_basis_v1(c,env,d.legal_receiver_id,d.grid_area_code,d.brp_ediel_id,p_at,d.registry_ground_id);
 IF network->>'status' IS DISTINCT FROM 'authorized' OR registry IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['authenticated_current_brp_and_network_registry']);END IF;
 header:=gridex_ai_processing.header_company_basis_v1(c,env,d.legal_sender_id,d.legal_receiver_id);IF header->>'legalActorId' IS DISTINCT FROM d.legal_actor_id::text THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_current_legal_supplier_brp_agreement']);END IF;
 RETURN jsonb_build_object('status','authorized','sourceKind','signed_contract_brp_declaration','companyId',c,'environment',env,'contractId',ct,'customerId',customer,'siteId',site,'meteringPointId',point,'at',p_at,'supplyPeriodId',NULL,'brpEdielId',d.brp_ediel_id,'pointId',d.point_id,'identityAgency',d.identity_agency,'legalActorId',d.legal_actor_id,'legalSenderId',d.legal_sender_id,'legalReceiverId',d.legal_receiver_id,'gridArea',d.grid_area_code,'declarationId',d.id,'sourceReference',d.source_reference,'sourceVersion',d.source_version,'sourceDigest',d.source_sha256,'registryBasis',registry);
END$$;
CREATE FUNCTION public.ediel_brp_field_source_v1(p_company_id uuid,p_contract_id uuid,p_actor_user_id uuid,p_environment text,p_customer_id uuid,p_site_id uuid,p_point_id uuid,p_at timestamptz,p_period_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_brp_sources.require_source_v1(p_company_id,p_contract_id,p_actor_user_id,'prepare',p_environment,p_customer_id,p_site_id,p_point_id,p_at,p_period_id)$$;
CREATE FUNCTION public.ediel_qualify_brp_source_candidate_v1(p_company_id uuid,p_contract_id uuid,p_actor_user_id uuid,p_environment text,p_customer_id uuid,p_site_id uuid,p_point_id uuid,p_at timestamptz,p_period_id uuid,p_snapshot_id uuid,p_readset_hash text,p_source_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snap gridex_received_sources.object_selection_snapshots%rowtype;supply jsonb;b jsonb;BEGIN
 PERFORM gridex_ai_processing.authorize_purpose_phase_v1(p_company_id,p_actor_user_id,'origination',NULL);
 supply:=gridex_received_sources.supply_period_source_at_v1(p_company_id,p_period_id,p_at);
 IF supply IS NULL OR supply->>'qualified' IS DISTINCT FROM 'true' OR supply->>'customerId' IS DISTINCT FROM p_customer_id::text OR supply->>'siteId' IS DISTINCT FROM p_site_id::text OR supply->>'meteringPointId' IS DISTINCT FROM p_point_id::text THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_current_source_owned_supply_relation']);END IF;
 SELECT * INTO snap FROM gridex_received_sources.object_selection_snapshots WHERE id=p_snapshot_id AND company_id=p_company_id AND environment=p_environment AND readset_hash=p_readset_hash;
 IF snap.id IS NULL OR snap.readset_hash IS DISTINCT FROM encode(sha256(convert_to(snap.readset_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'brp_candidate_protected_snapshot_required';END IF;
 b:=gridex_brp_sources.candidate_v1(snap.readset_text::jsonb,snap.cutoff_at,p_company_id,p_environment,p_customer_id,p_site_id,p_point_id,p_at,supply,p_source_message_id);
 IF b IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_dated_structural_owner_brp_candidate']);END IF;
 INSERT INTO gridex_brp_sources.qualified_candidates(company_id,environment,customer_id,site_id,metering_point_id,supply_period_id,at,snapshot_id,readset_hash,source_message_id,basis,qualified_by)
 VALUES(p_company_id,p_environment,p_customer_id,p_site_id,p_point_id,p_period_id,p_at,p_snapshot_id,p_readset_hash,p_source_message_id,b,p_actor_user_id) ON CONFLICT(company_id,environment,supply_period_id,at,snapshot_id,source_message_id) DO NOTHING;
 RETURN b;
END$$;
CREATE FUNCTION public.ediel_read_structural_effect_scope_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_snapshot_id uuid,p_readset_hash text,p_customer_id uuid,p_site_id uuid,p_point_id uuid,p_period_id uuid,p_at timestamptz,p_source_message_id uuid,p_assessment_id uuid,p_object_id text,p_identity_agency text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snap gridex_received_sources.object_selection_snapshots%rowtype;supply jsonb;BEGIN
 -- Delegate the existing protected read owner and exact current relation.
 supply:=public.ediel_read_source_supply_at_v1(p_company_id,p_actor_user_id,p_period_id,p_at);
 IF supply->>'qualified' IS DISTINCT FROM 'true' OR supply->>'customerId' IS DISTINCT FROM p_customer_id::text OR supply->>'siteId' IS DISTINCT FROM p_site_id::text OR supply->>'meteringPointId' IS DISTINCT FROM p_point_id::text THEN RETURN jsonb_build_object('applied',false);END IF;
 SELECT * INTO snap FROM gridex_received_sources.object_selection_snapshots WHERE id=p_snapshot_id AND company_id=p_company_id AND environment=p_environment AND readset_hash=p_readset_hash;
 IF snap.id IS NULL OR snap.readset_hash IS DISTINCT FROM encode(sha256(convert_to(snap.readset_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'structural_effect_protected_snapshot_required';END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(snap.readset_text::jsonb->'sources') s,LATERAL jsonb_array_elements(s->'assessments') a WHERE s->>'sourceMessageId'=p_source_message_id::text AND a->>'id'=p_assessment_id::text AND NOT EXISTS(SELECT FROM jsonb_array_elements(s->'assessments') child WHERE child->>'previousAssessmentId'=a->>'id')) THEN RETURN jsonb_build_object('applied',false);END IF;
 RETURN jsonb_build_object('applied',gridex_received_sources.structural_effect_matches_v1(p_company_id,p_environment,p_source_message_id,p_assessment_id,p_customer_id,p_site_id,p_point_id,p_period_id,p_object_id,p_identity_agency,snap.cutoff_at));
END$$;
REVOKE ALL ON FUNCTION public.ediel_read_structural_effect_scope_v1(uuid,text,uuid,uuid,text,uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_read_structural_effect_scope_v1(uuid,text,uuid,uuid,text,uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text) TO service_role;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_brp_sources' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);END LOOP;END$$;
REVOKE ALL ON FUNCTION public.ediel_brp_field_source_v1(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz,uuid),public.ediel_qualify_brp_source_candidate_v1(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_brp_field_source_v1(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz,uuid),public.ediel_qualify_brp_source_candidate_v1(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz,uuid,uuid,text,uuid) TO service_role;
ALTER FUNCTION gridex_metering_method_changes.context_v1(uuid,uuid,uuid,text) RENAME TO context_before_brp_source_v1;
CREATE FUNCTION gridex_metering_method_changes.context_v1(c uuid,event uuid,actor uuid,phase text DEFAULT 'origination') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;brp jsonb;BEGIN
 b:=gridex_metering_method_changes.context_before_brp_source_v1(c,event,actor,phase);IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 brp:=gridex_brp_sources.require_source_v1(c,(b->>'contractId')::uuid,actor,CASE phase WHEN 'send' THEN 'send' ELSE 'prepare' END,b->>'environment',(b->>'customerId')::uuid,(b->>'siteId')::uuid,(b->>'meteringPointId')::uuid,(b->>'effectiveAt')::timestamptz,(b->>'supplyPeriodId')::uuid);
 IF brp->>'status' IS DISTINCT FROM 'authorized' THEN RETURN brp;END IF;
 IF brp->>'pointId' IS DISTINCT FROM b->>'pointId' OR brp->>'identityAgency' IS DISTINCT FROM b->>'identityAgency' OR brp->>'legalActorId' IS DISTINCT FROM b->>'legalActorId' OR brp->>'legalSenderId' IS DISTINCT FROM b->>'legalSenderId' OR brp->>'legalReceiverId' IS DISTINCT FROM b->>'legalReceiverId' OR brp->>'gridArea' IS DISTINCT FROM b->>'gridArea' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_method_change_current_brp_full_scope']);END IF;
 RETURN b||jsonb_build_object('brpEdielId',brp->>'brpEdielId','brpSource',brp);
END$$;
-- Pure source scope read enables the application to ask the existing dated
-- structural owner for a candidate. It cannot reserve/persist/send an original.
CREATE FUNCTION public.ediel_metering_method_change_scope_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_metering_method_changes.context_before_brp_source_v1(p_company_id,p_event_id,p_actor_user_id,'origination')$$;
CREATE FUNCTION gridex_metering_method_changes.guard_brp_wire_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_metering_method_changes.origins%rowtype;b jsonb;tokens jsonb;nad jsonb;n integer;first_line integer;BEGIN
 SELECT * INTO o FROM gridex_metering_method_changes.origins WHERE company_id=NEW.company_id AND intent_id=NEW.intent_id;
 IF o.event_id IS NULL THEN RETURN NEW;END IF;
 IF o.message_id IS NOT NULL THEN RETURN NEW;END IF; -- Existing frozen outcome has its original immutable binder.
 b:=gridex_metering_method_changes.context_v1(o.company_id,o.event_id,o.actor_user_id);
 IF b->>'status' IS DISTINCT FROM 'authorized' OR b IS DISTINCT FROM o.basis THEN RAISE EXCEPTION 'metering_method_change_current_brp_source_required';END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(NEW.raw_payload);SELECT min((t->>'index')::integer) INTO first_line FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN';
 SELECT count(*),jsonb_agg(t)->0 INTO n,nad FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='Z02' AND (t->>'index')::integer>first_line;
 IF n<>1 OR nad#>>'{elements,2,0}' IS DISTINCT FROM b->>'brpEdielId' OR nad#>>'{elements,2,1}' IS DISTINCT FROM '160' OR nad#>>'{elements,2,2}' IS DISTINCT FROM 'SVK' OR jsonb_array_length(nad#>'{elements,2}')<>3 THEN RAISE EXCEPTION 'metering_method_change_own_source_field262_required';END IF;RETURN NEW;
END$$;
CREATE TRIGGER metering_method_own_brp_source BEFORE INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_metering_method_changes.guard_brp_wire_v1();
REVOKE ALL ON FUNCTION gridex_metering_method_changes.context_before_brp_source_v1(uuid,uuid,uuid,text),gridex_metering_method_changes.context_v1(uuid,uuid,uuid,text),gridex_metering_method_changes.guard_brp_wire_v1(),public.ediel_metering_method_change_scope_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_metering_method_change_scope_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
