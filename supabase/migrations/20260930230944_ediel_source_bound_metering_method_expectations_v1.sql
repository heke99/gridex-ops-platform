-- Created by Supabase CLI2.118.0. Prospective observational TM-METHOD40.
-- The rule/offset is generated from the SAME canonical deadline facade.
-- No agreement, applied structure, meter value or legal approval is seeded.
BEGIN;
CREATE SCHEMA gridex_method_expectations;
REVOKE ALL ON SCHEMA gridex_method_expectations FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA gridex_method_expectations TO service_role;
CREATE TABLE gridex_method_expectations.editions(source_version text PRIMARY KEY,input_manifest jsonb NOT NULL,projection jsonb NOT NULL);
CREATE TABLE gridex_method_expectations.bindings(
 expectation_id uuid PRIMARY KEY REFERENCES public.ediel_business_expectations(id),
 company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),
 source_message_id uuid UNIQUE NOT NULL REFERENCES public.ediel_messages(id),event_id uuid UNIQUE NOT NULL,
 source_payload_hash text NOT NULL,source_version text NOT NULL REFERENCES gridex_method_expectations.editions(source_version),
 original_basis jsonb NOT NULL,plan jsonb NOT NULL,accepted_basis jsonb NOT NULL,
 accepted_at timestamptz NOT NULL,validity_day date NOT NULL,due_day date NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_method_expectations.observations(
 expectation_id uuid PRIMARY KEY REFERENCES gridex_method_expectations.bindings(expectation_id),
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),source_payload_hash text NOT NULL,
 own_object jsonb NOT NULL,observed_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['editions','bindings','observations'] LOOP
 EXECUTE format('ALTER TABLE gridex_method_expectations.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE gridex_method_expectations.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_method_expectations.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_method_expectations.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_method_expectations.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
END LOOP;END $$;
-- BEGIN CANONICAL METHOD EXPECTATION PROJECTION
INSERT INTO gridex_method_expectations.editions(source_version,input_manifest,projection)
SELECT value->>'sourceVersion',value->'inputManifest',value->'projection' FROM (SELECT '{"sourceVersion":"2c97fad0987131bb221c6bafb4c7c21183f6d7168a57486199b228cf1e452f31","inputManifest":{"docs/ediel/masterplan-v2/registers/source_manifest.json":"ae5561799f6c81d78a139e4f5f82e74228bb765369fc6876668ae99ac338892d","docs/ediel/masterplan-v2/registers/timers.json":"f00f75cf30363b127c9e0dbfeb21106973351bd0891404789b2afb96f0b48c38","lib/ediel/ack/canonicalAckEngine.ts":"12c4f5202a6bb9c5c072eda4c8a393688cab0a66ff598d11f1760bb89e15dbf6","lib/ediel/core/canonicalEdifactAst.ts":"d005f2dc03c40ada838079e8d5090f4b40217155d4b0b1f16d59892f3f2249d2","lib/ediel/core/canonicalMessage.ts":"718b33315b97d7540a56bf9bc92310ee6ff9d0f7c672183c925d262c1a0c7a95","lib/ediel/core/edifactEncoding.ts":"b9bb995a1a6072a74125bcbcc5be912ed524dcc991a8b00ddee018ded6822806","lib/ediel/core/edifactEnvelopeCodec.ts":"847f4138395629bd574ce6d84678509bda6c205176f878c59069e224e1df669f","lib/ediel/core/edifactSegments.ts":"ddaa82263d0cb314bc4b7c8d263b41df3e0a9336e881c830f6df463747b98812","lib/ediel/core/edifactSerializer.ts":"0e9739be139c6bfaca27a7890ac9b816e371790d228a98708d5887e8a04c8232","lib/ediel/core/edifactTokenizer.ts":"11b8b0546e794a2fe60c9aeaf6c3d811e9e6ca0e5a777171b4064a6679ced93f","lib/ediel/core/messageIdentity.ts":"47a30eb06d921331c7064ee60bae15bcf13e277dac283dc252dd52769bc99c55","lib/ediel/core/una.ts":"800c59c1bed62e014161b6e98cea096c5506046a2cda4a1c770fac655548e7a4","lib/ediel/meteringMethodExpectationPolicy.ts":"7257305914be065c7c420d8f29a414acf92aef1ad404e09b07935e78724053d2","lib/ediel/prodat/prodat26AFieldMatrix.ts":"a96b7dcddb564aad04d3be6ee7aef1117601eccd893b47869a8ddc60b3794382","lib/ediel/prodat/prodatCharacteristicFields.ts":"15a0102f79eca1ec6ae5b27eef773ec5a15b45041ebac4e52b7ef80b191115c7","lib/ediel/prodat/prodatDateFields.ts":"5dcc9d8aff057bef42fa974f9cb3cc71da3f1b2f9e04edba3a238738420705cb","lib/ediel/prodat/prodatDocumentFields.ts":"020da2a1c8d6d1350c964d14edea74f8b8371eb6ac13270b1e07969e9784908e","lib/ediel/prodat/prodatFailureEvidence.ts":"185330ecaa4783fdc9c50c62a62a2d40310f5a09cc3a53621f2c6e3e490c7b69","lib/ediel/prodat/prodatReferenceFields.ts":"ae15bcfff1c68caf6fd3227575cc3a15ba4e8d678e107d08f59a660a464e5192","lib/ediel/prodat/prodatRegisterFields.ts":"1d171216b8fd8be093a4b6d5e0d9e04cf969468ba342dfcde4771b46fe5df09c","lib/ediel/prodat/prodatRegisterGroups.ts":"142e9e441e6a94708841dec9aaddb9656b091aa04536c00ec358a6b59bcfe291","lib/ediel/prodat/render/dates.ts":"25b2cd8c56b4cb7c824c6ed6c6ecc8783b8843212387f4cb08223fc157b40505","lib/ediel/rulebook/businessSemantics.ts":"89037706cdf2433f0c3f5e08dcb079bbc564b2da5b2c8dd5b3e9d87dc4ab235d","lib/ediel/rulebook/canonicalEdielFacade.ts":"d38abf5eca669e6006dd5fd447593252773c9115599293caaa4367623ed12720","lib/ediel/rulebook/deadlinePolicy.ts":"5fe8333f61a4460a979fc62f15f9b15ffafb2faa3702b09392a5042eb08b2f34","lib/ediel/rulebook/guideRegistry.ts":"63fefd35e3fff23fbbca16d7dd702310308cbc363676e57ac1a26dcab70ad4da","lib/ediel/rulebook/mapEdielError.ts":"56cbf1985c3c82f305a4a43aa5352ff072c9be450264c479b77638c92c637334","lib/ediel/rulebook/messageParser.ts":"2534f86ccf723f5d28586b16642cce22a35f52abb87aba51baae6b6598f05a9f","lib/ediel/rulebook/prodatApplicationReference.ts":"fe20ad0bac7fb89ce5ebc85fd058c2d5644d18ad7d1b08bfe595d09a5aa9f785","lib/ediel/rulebook/prodatRulebook.ts":"bc8a47b4e2b8860026ae179e65163986039b1838c802dea7aada7f346ce4336b","lib/ediel/rulebook/prodatSubtypeRegistry.ts":"f3fb3418ee73333a097c3203384bd6d41b680adfb5ecf6e4752316c3e08568de","lib/ediel/rulebook/rulebook.ts":"de3eed230bbbf09107b3244dceb0a1950e5a0c234c6859e10f45c92779325134","lib/ediel/rulebook/utiltsApplicationReference.ts":"2a2a841900d51dfe5b121705357c8506a62365b8ec11614352a3fdf2a8711dbd","lib/ediel/rulebook/utiltsFieldMatrix.ts":"96673bf16652616e0715b3bfb36bda06caa5462c26783eacefa8f04ca4928655","lib/ediel/rulebook/utiltsMarketEngine.ts":"efece4736d43999c47aa5ad68cb226fe1b22578abe247e821a68a5b78b763f41","lib/ediel/rulebook/utiltsMarketSemantics.ts":"9262f1ea53ceeae77da7d1fb1093999f86890ae6d63b19a3d92712b417be2f10","lib/ediel/rulebook/utiltsRulebook.ts":"827b458de5859b2d08b96cfc0a4e8c89baf93874f2689a97afd3c8ee2d0f935b","lib/ediel/utilts/canonicalObservationScope.ts":"bd66e4781e1e141bc370d0bb204059d9cea98ace10f57f43c50c1c21494a61f6","scripts/generate-ediel-method-expectation-projection.cjs":"47a25c03c6c7fcac9799fa1672849c68d52c60767b975f186e9603dee2340014"},"projection":{"version":1,"ruleId":"TM-METHOD40","sourceCode":"Z09","expectedFamily":"PRODAT","expectedCode":"Z06","offset":40,"unit":"calendar_days","anchor":"z09_validity_day","timerKind":"source_validity_day_watch","automaticResendAllowed":false,"deadlineSource":{"document":"Svensk Elmarknadshandbok","edition":"26A","effectiveFrom":"2026-04-01","section":"10.2.1","pages":"198"},"constraint":{"kind":"within_after","anchor":"validity_date_from_Z09_F_or_G","offset":40,"unit":"calendar_days","condition":"metering_method_change","hard":true,"note":null}}}'::jsonb value) edition;
-- END CANONICAL METHOD EXPECTATION PROJECTION

CREATE FUNCTION gridex_method_expectations.require_binding_v1(m public.ediel_messages,binding jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE frozen jsonb;cfg jsonb;plan jsonb;admission jsonb;wire jsonb;day date;BEGIN
 wire:=gridex_metering_method_changes.wire_v1(m.raw_payload);
 IF wire IS NULL OR wire->>'code' IS DISTINCT FROM 'Z09' OR NOT EXISTS(
  SELECT FROM jsonb_each(gridex_metering_method_changes.canonical_tuple_projection_v1()) p WHERE p.value->>'reason'=wire#>>'{object,reason}') THEN
  IF binding->'meteringMethodExpectationPlan' IS NOT NULL AND binding->'meteringMethodExpectationPlan'<>'null'::jsonb THEN RAISE EXCEPTION 'ediel_method_expectation_not_applicable';END IF;RETURN binding;
 END IF;
 frozen:=gridex_metering_method_changes.frozen_original_basis_v1(m.company_id,m.id);
 IF frozen IS NULL OR frozen->>'authorized' IS DISTINCT FROM 'true' OR frozen->>'sourcePayloadHash' IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR frozen#>>'{basis,environment}' IS DISTINCT FROM m.environment THEN RAISE EXCEPTION 'ediel_method_expectation_original_required';END IF;
 SELECT projection INTO STRICT cfg FROM gridex_method_expectations.editions WHERE source_version='2c97fad0987131bb221c6bafb4c7c21183f6d7168a57486199b228cf1e452f31';
 plan:=binding->'meteringMethodExpectationPlan';admission:=binding->'admissionDecision';
 BEGIN day:=to_date(frozen->>'validityDay','YYYYMMDD');EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'ediel_method_expectation_validity_day_invalid';END;
 IF to_char(day,'YYYYMMDD') IS DISTINCT FROM frozen->>'validityDay' OR extract(year FROM day)<=0
  OR jsonb_typeof(plan) IS DISTINCT FROM 'object' OR plan-ARRAY['sourceSubtype','validityDay','policy'] IS DISTINCT FROM cfg
  OR plan->>'sourceSubtype' IS DISTINCT FROM frozen#>>'{basis,subtype}' OR plan->>'validityDay' IS DISTINCT FROM day::text
  OR jsonb_typeof(admission) IS DISTINCT FROM 'object' OR admission->>'version' IS DISTINCT FROM '1'
  OR admission->>'family' IS DISTINCT FROM 'PRODAT' OR admission->>'code' IS DISTINCT FROM 'Z09'
  OR plan->'policy' IS DISTINCT FROM jsonb_build_object('guideRevision',admission#>'{guide,guideRevision}','referenceDate',admission->'referenceDate','profileKey',admission->'profileKey','sourceTrace',admission->'sourceTrace')
 THEN RAISE EXCEPTION 'ediel_method_expectation_same_admission_required';END IF;
 RETURN binding;
END $$;
-- Public schema name is a private compositional port, not an exposed API.
CREATE FUNCTION public.require_metering_method_expectation_binding_v1(m public.ediel_messages,binding jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_method_expectations.require_binding_v1(m,binding)$$;
REVOKE ALL ON FUNCTION public.require_metering_method_expectation_binding_v1(public.ediel_messages,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_method_expectations.compatible_v1(original jsonb,accepted jsonb,own jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE b jsonb:=original->'basis';method text:=nullif(own->>'measurementMethod','');day date;BEGIN
 IF original->>'authorized' IS DISTINCT FROM 'true' OR method IS NULL OR b->>'subtype' NOT IN('F','G')
  OR nullif(own->>'sourceReceivedAt','') IS NULL OR nullif(own->>'effectiveAt','') IS NULL
  OR nullif(own->>'customerId','') IS NULL OR nullif(own->>'meteringPointId','') IS NULL
  OR nullif(own->>'objectId','') IS NULL OR nullif(own->>'identityAgency','') IS NULL
  OR nullif(own->>'legalSupplier','') IS NULL OR nullif(own->>'legalNetwork','') IS NULL
  OR own->>'companyId' IS DISTINCT FROM b->>'companyId' OR own->>'environment' IS DISTINCT FROM b->>'environment'
  OR own->>'customerId' IS DISTINCT FROM b->>'customerId' OR own->>'meteringPointId' IS DISTINCT FROM b->>'meteringPointId'
  OR own->>'objectId' IS DISTINCT FROM b->>'pointId' OR own->>'identityAgency' IS DISTINCT FROM b->>'identityAgency'
  OR own->>'legalSupplier' IS DISTINCT FROM b->>'legalSenderId' OR own->>'legalNetwork' IS DISTINCT FROM b->>'legalReceiverId'
  OR (b->>'subtype'='F' AND method IS DISTINCT FROM b->>'method') THEN RETURN false;END IF;
 day:=to_date(original->>'validityDay','YYYYMMDD');
 -- Observation criterion, not a new business validity rule or exact-instant
 -- equality: preserve both original dates and never infer a missing method.
 RETURN (own->>'sourceReceivedAt')::timestamptz >= (accepted->>'observedAt')::timestamptz
  AND ((own->>'effectiveAt')::timestamptz AT TIME ZONE 'Etc/GMT-1')::date>=day;
END $$;

CREATE FUNCTION gridex_method_expectations.reconcile_v1(expected uuid,source_filter uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b gridex_method_expectations.bindings%rowtype;e public.ediel_business_expectations%rowtype;
 src record;own jsonb;matches jsonb;other public.ediel_messages%rowtype;original jsonb;accepted jsonb;compatible_count integer;BEGIN
 SELECT * INTO b FROM gridex_method_expectations.bindings WHERE expectation_id=expected;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO e FROM public.ediel_business_expectations WHERE id=expected AND company_id=b.company_id AND environment=b.environment FOR UPDATE;
 IF e.id IS NULL OR e.status NOT IN('pending','timeout','manual_review') THEN RETURN;END IF;
 FOR src IN SELECT r.source_message_id FROM gridex_received_sources.structural_apply_receipts r
  WHERE r.company_id=b.company_id AND r.environment=b.environment AND (source_filter IS NULL OR r.source_message_id=source_filter) ORDER BY r.applied_at,r.source_message_id LOOP
  SELECT coalesce(jsonb_agg(o),'[]'::jsonb) INTO matches FROM jsonb_array_elements(gridex_received_sources.applied_structural_method_objects_v1(b.company_id,src.source_message_id))o
   WHERE gridex_method_expectations.compatible_v1(b.original_basis,b.accepted_basis,o);
  IF jsonb_array_length(matches)<>1 THEN CONTINUE;END IF;own:=matches->0;compatible_count:=0;
  -- Include accepted originals not yet registered, so late registration cannot
  -- pick the newest event or borrow one Z06 for multiple compatible requests.
  FOR other IN SELECT m.* FROM gridex_metering_method_changes.desired_change_receipts r JOIN public.ediel_messages m ON m.id=r.message_id
   WHERE r.company_id=b.company_id AND r.environment=b.environment
    AND NOT EXISTS(SELECT FROM gridex_method_expectations.bindings x JOIN gridex_method_expectations.observations z ON z.expectation_id=x.expectation_id WHERE x.source_message_id=m.id)
   ORDER BY m.id LOOP
   original:=gridex_metering_method_changes.frozen_original_basis_v1(b.company_id,other.id);
   accepted:=gridex_ediel_transport.accepted_source_basis_v1(other);
   IF accepted IS NOT NULL AND gridex_method_expectations.compatible_v1(original,accepted,own) THEN compatible_count:=compatible_count+1;END IF;
  END LOOP;
  IF compatible_count<>1 THEN CONTINUE;END IF;
  INSERT INTO gridex_method_expectations.observations(expectation_id,source_message_id,source_payload_hash,own_object)
   VALUES(e.id,src.source_message_id,own->>'sourcePayloadHash',own);
  UPDATE public.ediel_business_expectations SET status='fulfilled',fulfilled_by_message_id=src.source_message_id,updated_at=clock_timestamp(),
   metadata=metadata||jsonb_build_object('resolvedBy','observed_applied_own_Z06_method','observedMethod',own->>'measurementMethod',
    'sourceReceivedAt',own->>'sourceReceivedAt','effectiveAt',own->>'effectiveAt','appliedAt',own->>'appliedAt',
    'receivedAfterDueDay',((own->>'sourceReceivedAt')::timestamptz AT TIME ZONE 'Europe/Stockholm')::date>b.due_day,
    'authorizesMarketEffects',false,'authorizesReadingAcceptance',false,'automaticResendAllowed',false) WHERE id=e.id;
  RETURN;
 END LOOP;
END $$;

CREATE FUNCTION gridex_method_expectations.applied_source_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e uuid;BEGIN FOR e IN SELECT b.expectation_id FROM gridex_method_expectations.bindings b JOIN public.ediel_business_expectations x ON x.id=b.expectation_id
 WHERE b.company_id=NEW.company_id AND b.environment=NEW.environment AND x.status IN('pending','timeout','manual_review')
  AND EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.applied_structural_method_objects_v1(NEW.company_id,NEW.source_message_id))own
   WHERE gridex_method_expectations.compatible_v1(b.original_basis,b.accepted_basis,own)) ORDER BY b.expectation_id LOOP
 PERFORM gridex_method_expectations.reconcile_v1(e,NEW.source_message_id);END LOOP;RETURN NEW;END $$;
CREATE TRIGGER method_expectation_applied_source AFTER INSERT ON gridex_received_sources.structural_apply_receipts FOR EACH ROW EXECUTE FUNCTION gridex_method_expectations.applied_source_v1();

CREATE FUNCTION gridex_method_expectations.mutate_v1(i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c uuid:=(i->>'companyId')::uuid;env text:=i->>'environment';actor uuid:=(i->>'actorUserId')::uuid;
 action text:=i->>'action';mid uuid:=(i->>'messageId')::uuid;lim integer:=greatest(1,least(coalesce((i->>'limit')::integer,100),500));
 m public.ediel_messages%rowtype;b gridex_method_expectations.bindings%rowtype;original jsonb;accepted jsonb;binding jsonb;plan jsonb;cfg jsonb;
 expected uuid;day date;due_day date;result jsonb;e uuid;BEGIN
 IF c IS NULL OR actor IS NULL OR env IS NULL OR env NOT IN('test','production') OR action IS NULL OR action NOT IN('register','read','observe','expire') THEN RAISE EXCEPTION 'ediel_method_expectation_scope_required';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(actor,c,CASE WHEN action='read' THEN 'communication.read' WHEN action='register' THEN 'communication.send' ELSE 'communication.write' END) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_method_expectation_actor_forbidden' USING ERRCODE='42501';END IF;
 IF action='register' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=c AND environment=env AND id=mid AND direction='outbound' FOR UPDATE;
  SELECT * INTO b FROM gridex_method_expectations.bindings WHERE source_message_id=mid;
  IF FOUND THEN
   IF b.company_id IS DISTINCT FROM c OR b.environment IS DISTINCT FROM env OR b.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_method_expectation_original_changed';END IF;
   PERFORM gridex_method_expectations.reconcile_v1(b.expectation_id);
   RETURN jsonb_build_array((SELECT to_jsonb(x) FROM public.ediel_business_expectations x WHERE x.id=b.expectation_id));
  END IF;
  original:=gridex_metering_method_changes.frozen_original_basis_v1(c,mid);
  IF original IS NULL THEN RETURN '[]'::jsonb;END IF;
  accepted:=gridex_ediel_transport.accepted_source_basis_v1(m);
  IF accepted IS NULL THEN RAISE EXCEPTION 'ediel_method_expectation_actual_accepted_send_required';END IF;
  SELECT a.binding INTO STRICT binding FROM gridex_ediel_transport.attempts a WHERE a.id=(accepted->>'attemptId')::uuid AND a.company_id=c AND a.environment=env AND a.message_id=mid AND accepted->>'lane'='generic_journal';
  PERFORM gridex_method_expectations.require_binding_v1(m,binding);plan:=binding->'meteringMethodExpectationPlan';
  SELECT projection INTO STRICT cfg FROM gridex_method_expectations.editions WHERE source_version='2c97fad0987131bb221c6bafb4c7c21183f6d7168a57486199b228cf1e452f31';
  day:=to_date(original->>'validityDay','YYYYMMDD');due_day:=day+(cfg->>'offset')::integer;
  INSERT INTO public.ediel_business_expectations(company_id,environment,source_message_id,source_operation_id,expected_family,expected_code,expected_subtype,due_at,metadata)
   VALUES(c,env,mid,original->>'eventId',cfg->>'expectedFamily',cfg->>'expectedCode',NULL,((due_day+1)::timestamp AT TIME ZONE 'Europe/Stockholm'),
    jsonb_build_object('timerRuleId',cfg->>'ruleId','timerKind',cfg->>'timerKind','anchorType',cfg->>'anchor','validityDay',day,'dueDay',due_day,
     'actualAcceptedAt',accepted->>'observedAt','remoteReceiptKnown',false,'automaticResendAllowed',false,'authorizesMarketEffects',false,
     'observationCriterion','same_applied_own_Z06_explicit_method_customer_point_agency_parties_and_not_before_validity_day','preparedPolicy',plan->'policy')) RETURNING id INTO expected;
  INSERT INTO gridex_method_expectations.bindings(expectation_id,company_id,environment,source_message_id,event_id,source_payload_hash,source_version,original_basis,plan,accepted_basis,accepted_at,validity_day,due_day)
   VALUES(expected,c,env,mid,(original->>'eventId')::uuid,original->>'sourcePayloadHash','2c97fad0987131bb221c6bafb4c7c21183f6d7168a57486199b228cf1e452f31',original,plan,accepted,(accepted->>'observedAt')::timestamptz,day,due_day);
  PERFORM gridex_method_expectations.reconcile_v1(expected);
  RETURN jsonb_build_array((SELECT to_jsonb(x) FROM public.ediel_business_expectations x WHERE x.id=expected));
 END IF;
 IF action='observe' THEN
  PERFORM observed_source.id FROM public.ediel_messages observed_source WHERE observed_source.id=mid AND observed_source.company_id=c AND observed_source.environment=env AND observed_source.direction='inbound';
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_method_expectation_observed_source_scope_required';END IF;
 END IF;
 FOR e IN SELECT owned.expectation_id FROM gridex_method_expectations.bindings owned JOIN public.ediel_business_expectations x ON x.id=owned.expectation_id
  WHERE owned.company_id=c AND owned.environment=env AND (action='observe' OR mid IS NULL OR owned.source_message_id=mid)
   AND (action IN('read','observe') OR x.status='pending' AND (clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date>owned.due_day)
  ORDER BY owned.expectation_id LIMIT lim LOOP
  IF action<>'read' THEN PERFORM gridex_method_expectations.reconcile_v1(e,CASE WHEN action='observe' THEN mid ELSE NULL END);END IF;
  IF action='expire' THEN UPDATE public.ediel_business_expectations x SET status='manual_review',updated_at=clock_timestamp(),
   metadata=metadata||jsonb_build_object('expiredAt',clock_timestamp(),'automaticResendAllowed',false,'authorizesMarketEffects',false)
   FROM gridex_method_expectations.bindings owned WHERE x.id=e AND owned.expectation_id=x.id AND x.status='pending' AND (clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date>owned.due_day;END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at,x.id),'[]') INTO result FROM (SELECT x.* FROM public.ediel_business_expectations x JOIN gridex_method_expectations.bindings owned ON owned.expectation_id=x.id
  WHERE owned.company_id=c AND owned.environment=env AND (action='observe' OR mid IS NULL OR owned.source_message_id=mid) ORDER BY x.created_at,x.id LIMIT lim)x;
 RETURN result;
END $$;
CREATE FUNCTION public.gridex_ediel_metering_method_expectations_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN IF current_user<>'service_role' THEN RAISE EXCEPTION 'ediel_method_expectation_service_required' USING ERRCODE='42501';END IF;RETURN gridex_method_expectations.mutate_v1(p_input);END $$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_method_expectations' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);END LOOP;END $$;
REVOKE ALL ON FUNCTION public.gridex_ediel_metering_method_expectations_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_method_expectations.mutate_v1(jsonb),public.gridex_ediel_metering_method_expectations_v1(jsonb) TO service_role;
COMMIT;
