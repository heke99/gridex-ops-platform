-- Recreated after ephemeral runtime loss. NEW, previously unpublished bytes.
-- Actual independent archive/issuer/review -> legacy source-owned classification.
-- No issuer registry, approved receipt or accepted source is seeded.
BEGIN;
CREATE TABLE gridex_bilateral_customer_sources.life_event_classification_origins(
 source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,
 artifact_id uuid NOT NULL UNIQUE REFERENCES gridex_bilateral_customer_sources.artifacts(id),review_id uuid NOT NULL UNIQUE REFERENCES gridex_bilateral_customer_sources.reviews(id),
 classification_id uuid NOT NULL UNIQUE REFERENCES gridex_customer_life_events.inbound_classifications(id),canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),
 payload_hash text NOT NULL,claims_hash text NOT NULL,receipt_hash text NOT NULL,classification_row_hash text NOT NULL,ground_row_hash text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE gridex_bilateral_customer_sources.life_event_classification_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_bilateral_customer_sources.life_event_classification_origins FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_bilateral_customer_sources.life_event_classification_origins FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER classification_origin_immutable BEFORE UPDATE OR DELETE ON gridex_bilateral_customer_sources.life_event_classification_origins FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER classification_origin_no_truncate BEFORE TRUNCATE ON gridex_bilateral_customer_sources.life_event_classification_origins FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

CREATE FUNCTION gridex_bilateral_customer_sources.classification_chain_v1(c uuid,mid uuid,origin_id uuid,cutoff timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;a gridex_received_sources.validation_assessments%rowtype;sf gridex_received_sources.prodat_source_function_facets%rowtype;ctx gridex_customer_life_events.inbound_context_receipts%rowtype;leaf uuid;depth int:=0;seen uuid[]:=ARRAY[]::uuid[];last_clock timestamptz;facts jsonb;
BEGIN
 IF cutoff IS NULL OR NOT isfinite(cutoff) OR cutoff>clock_timestamp() THEN RETURN false;END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=c FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z06' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM gridex_received_sources.validation_assessments x WHERE x.source_message_id=mid AND x.company_id=c AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=x.id))<>1 THEN RETURN false;END IF;
 SELECT x.id INTO leaf FROM gridex_received_sources.validation_assessments x WHERE x.source_message_id=mid AND x.company_id=c AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=x.id);
 last_clock:=cutoff;
 LOOP
  IF leaf IS NULL OR leaf=ANY(seen) OR depth>=256 THEN RETURN false;END IF;seen:=array_append(seen,leaf);depth:=depth+1;
  SELECT * INTO a FROM gridex_received_sources.validation_assessments WHERE id=leaf FOR SHARE;
  IF a.id IS NULL OR a.company_id IS DISTINCT FROM c OR a.environment IS DISTINCT FROM m.environment OR a.source_message_id IS DISTINCT FROM mid OR a.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR a.facts_hash IS DISTINCT FROM encode(sha256(convert_to(a.facts_text,'UTF8')),'hex') OR a.assessed_at IS NULL OR a.assessed_at>last_clock THEN RETURN false;END IF;
  facts:=a.facts_text::jsonb;
  IF facts->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR facts->>'applicationDecision' IS DISTINCT FROM 'accepted' OR facts->>'functionalDecision' IS DISTINCT FROM 'accepted' THEN RETURN false;END IF;
  -- The originally signed assessment is preserved. A later assessment must
  -- independently carry the protected native customer-function facet.
  IF a.id<>origin_id THEN
   SELECT * INTO sf FROM gridex_received_sources.prodat_source_function_facets WHERE assessment_id=a.id AND company_id=c AND environment=m.environment AND source_message_id=mid FOR SHARE;
   IF sf.assessment_id IS NULL OR sf.source_payload_hash IS DISTINCT FROM a.source_payload_hash OR sf.function_facts_hash IS DISTINCT FROM encode(sha256(convert_to(sf.function_facts_text,'UTF8')),'hex') OR gridex_received_sources.validate_prodat_source_function_v1(c,mid,m.raw_payload,facts,sf.function_facts_text::jsonb) IS NOT TRUE THEN RETURN false;END IF;
   SELECT * INTO ctx FROM gridex_customer_life_events.inbound_context_receipts WHERE id=(sf.function_facts_text::jsonb->>'sourceContextReceiptId')::uuid AND company_id=c AND environment=m.environment AND source_message_id=mid FOR SHARE;
   IF ctx.id IS NULL OR ctx.recorded_at>a.assessed_at OR ctx.recorded_at>cutoff OR ctx.payload_hash IS DISTINCT FROM a.source_payload_hash OR ctx.context_facts_hash IS DISTINCT FROM sf.function_facts_text::jsonb->>'sourceContextFactsHash' THEN RETURN false;END IF;
  END IF;
  IF a.id=origin_id THEN RETURN true;END IF;
  last_clock:=a.assessed_at;leaf:=a.previous_assessment_id;
 END LOOP;
EXCEPTION WHEN invalid_text_representation OR data_exception THEN RETURN false;
END$$;

-- VOLATILE leaf: the legacy owner proof remains STABLE, while this private
-- helper owns actual current graph/source/artifact row locks and revocation.
CREATE FUNCTION gridex_bilateral_customer_sources.classification_current_v1(c uuid,mid uuid,cutoff timestamptz DEFAULT statement_timestamp()) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_bilateral_customer_sources.artifacts%rowtype;r gridex_bilateral_customer_sources.reviews%rowtype;o gridex_bilateral_customer_sources.life_event_classification_origins%rowtype;q gridex_customer_life_events.inbound_classifications%rowtype;g gridex_customer_life_events.inbound_grounds%rowtype;receipt jsonb;actual jsonb;canonical gridex_received_sources.validation_assessments%rowtype;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 -- Source-first order is also used by public review and classification revoke.
 PERFORM id FROM public.ediel_messages WHERE id=mid AND company_id=c FOR SHARE;
 SELECT * INTO o FROM gridex_bilateral_customer_sources.life_event_classification_origins WHERE source_message_id=mid AND company_id=c FOR SHARE;
 IF o.source_message_id IS NULL OR o.recorded_at>cutoff THEN RETURN NULL;END IF;
 SELECT * INTO a FROM gridex_bilateral_customer_sources.artifacts WHERE id=o.artifact_id AND company_id=c AND environment=o.environment AND source_message_id=mid FOR SHARE;
 SELECT * INTO r FROM gridex_bilateral_customer_sources.reviews WHERE id=o.review_id AND artifact_id=a.id AND company_id=c FOR SHARE;
 SELECT * INTO q FROM gridex_customer_life_events.inbound_classifications WHERE id=o.classification_id AND company_id=c AND source_message_id=mid FOR SHARE;
 SELECT * INTO g FROM gridex_customer_life_events.inbound_grounds WHERE source_message_id=mid AND company_id=c FOR SHARE;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments WHERE id=o.canonical_assessment_id;
 IF a.id IS NULL OR r.id IS NULL OR q.id IS NULL OR g.source_message_id IS NULL OR r.decision IS DISTINCT FROM 'approved' OR r.reviewer_user_id=a.submitted_by OR gridex_requested_changes.actor_v1(c,r.reviewer_user_id,'review','method_contract') IS NOT TRUE
  OR a.claims_hash IS DISTINCT FROM o.claims_hash OR a.source_hash IS DISTINCT FROM encode(sha256(a.source_bytes),'hex') OR a.claims_hash IS DISTINCT FROM encode(sha256(convert_to(a.claims::text,'UTF8')),'hex') OR a.claims->>'payloadHash' IS DISTINCT FROM o.payload_hash
  OR q.source_payload_hash IS DISTINCT FROM o.payload_hash OR g.source_payload_hash IS DISTINCT FROM o.payload_hash OR encode(sha256(convert_to(to_jsonb(q)::text,'UTF8')),'hex') IS DISTINCT FROM o.classification_row_hash OR encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex') IS DISTINCT FROM o.ground_row_hash
  OR canonical.assessed_at>a.created_at OR a.created_at>r.reviewed_at OR r.reviewed_at>q.approved_at OR q.approved_at>q.recorded_at OR q.recorded_at>o.recorded_at OR r.reviewed_at>cutoff OR q.recorded_at>cutoff
  OR EXISTS(SELECT FROM gridex_customer_life_events.classification_revocations WHERE classification_id=q.id)
  OR gridex_bilateral_customer_sources.classification_chain_v1(c,mid,o.canonical_assessment_id,cutoff) IS NOT TRUE THEN RETURN NULL;END IF;
 receipt:=gridex_bilateral_customer_sources.receipt_current_v1(a);
 IF receipt IS NULL OR receipt->'clause' IS DISTINCT FROM r.clause OR position(convert_to(r.clause->>'quote','UTF8') IN a.source_bytes)=0 OR (receipt->>'issuedAt')::timestamptz>a.created_at OR encode(sha256(decode(a.issuer_receipt->>'payloadBase64','base64')),'hex') IS DISTINCT FROM o.receipt_hash THEN RETURN NULL;END IF;
 actual:=gridex_bilateral_customer_sources.source_claims_v1(c,mid,a.agreement_id,a.supply_period_id,a.contract_id);
 -- Native lineage, not a caller canonical UUID, authorizes the single changing
 -- assessment key. Every other supply/contract/point/customer/party cell matches.
 IF actual-'canonicalAssessmentId' IS DISTINCT FROM a.claims-'canonicalAssessmentId' OR a.claims->>'canonicalAssessmentId' IS DISTINCT FROM o.canonical_assessment_id::text THEN RETURN NULL;END IF;
 RETURN receipt;
EXCEPTION WHEN raise_exception OR data_exception THEN RETURN NULL;
END$$;

CREATE FUNCTION gridex_bilateral_customer_sources.publish_life_event_classification_v1(c uuid,artifact uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_bilateral_customer_sources.artifacts%rowtype;origin gridex_bilateral_customer_sources.origins%rowtype;r gridex_bilateral_customer_sources.reviews%rowtype;existing gridex_bilateral_customer_sources.life_event_classification_origins%rowtype;
 q gridex_customer_life_events.inbound_classifications%rowtype;g gridex_customer_life_events.inbound_grounds%rowtype;ba public.tenant_bilateral_agreements%rowtype;receipt jsonb;basis jsonb;wire jsonb;own jsonb;scope jsonb;fields text[];kind text;stamp timestamptz;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO a FROM gridex_bilateral_customer_sources.artifacts WHERE id=artifact AND company_id=c;
 IF a.id IS NULL THEN RAISE EXCEPTION 'classified_customer_actual_artifact_required';END IF;
 PERFORM id FROM public.ediel_messages WHERE id=a.source_message_id AND company_id=c FOR UPDATE;
 SELECT * INTO a FROM gridex_bilateral_customer_sources.artifacts WHERE id=artifact AND company_id=c FOR SHARE;
 SELECT * INTO existing FROM gridex_bilateral_customer_sources.life_event_classification_origins WHERE source_message_id=a.source_message_id FOR SHARE;
 IF existing.source_message_id IS NOT NULL THEN
  IF existing.artifact_id IS DISTINCT FROM a.id OR existing.company_id IS DISTINCT FROM c THEN RAISE EXCEPTION 'classified_customer_origin_conflict';END IF;RETURN existing.classification_id;
 END IF;
 SELECT * INTO origin FROM gridex_bilateral_customer_sources.origins WHERE artifact_id=a.id AND company_id=c FOR SHARE;
 SELECT * INTO r FROM gridex_bilateral_customer_sources.reviews WHERE id=origin.review_id AND artifact_id=a.id AND company_id=c FOR SHARE;
 receipt:=gridex_bilateral_customer_sources.current_v1(a);
 IF receipt IS NULL OR origin.artifact_id IS NULL OR r.id IS NULL OR (receipt->>'issuedAt')::timestamptz>a.created_at OR a.created_at>r.reviewed_at THEN RAISE EXCEPTION 'classified_customer_actual_independent_current_review_required';END IF;
 wire:=gridex_customer_life_events.wire_partition_v1((SELECT raw_payload FROM public.ediel_messages WHERE id=a.source_message_id AND company_id=c));
 IF wire IS NULL OR wire->>'code' IS DISTINCT FROM 'Z06' OR jsonb_array_length(wire->'objects')<>1 THEN RAISE EXCEPTION 'classified_customer_whole_physical_owner_scope_required';END IF;own:=wire->'objects'->0;
 basis:=gridex_received_sources.supply_period_source_at_v1(c,a.supply_period_id,(own->>'effectiveAt')::timestamptz);
 IF basis->>'qualified' IS DISTINCT FROM 'true' OR basis->>'customerId' IS DISTINCT FROM a.claims->>'customerId' OR basis->>'siteId' IS DISTINCT FROM a.claims->>'siteId' OR basis->>'meteringPointId' IS DISTINCT FROM a.claims->>'meteringPointId' OR basis->>'sourceMessageId' IS DISTINCT FROM a.claims->>'supplySourceMessageId' OR basis->>'marketStateVersion' IS DISTINCT FROM a.claims->>'supplyStateVersion' OR own->>'point' IS DISTINCT FROM a.claims->>'objectId' OR own->>'identityAgency' IS DISTINCT FROM a.claims->>'identityAgency' OR own->>'effectiveAt' IS DISTINCT FROM a.claims->>'effectiveAt' OR own->>'reason' IS DISTINCT FROM 'E34' OR own ? 'customerStatus' OR own->>'projectionHeld'='true' THEN RAISE EXCEPTION 'classified_customer_same_owned_native_tuple_required';END IF;
 SELECT array_agg(f ORDER BY f) INTO fields FROM jsonb_array_elements_text(receipt->'authorizedFields') f WHERE f IN('227','228','229','231','232','316');
 IF fields IS NULL OR NOT(ARRAY['227','228','231','232','316']::text[]<@fields) THEN RAISE EXCEPTION 'classified_customer_exact_owner_fields_required';END IF;
 kind:=CASE receipt->>'lifeEventKind' WHEN 'bankruptcy' THEN 'bankruptcy' WHEN 'customer_change' THEN 'other_masterdata' END;
 IF kind IS NULL THEN RAISE EXCEPTION 'classified_customer_non_death_kind_required';END IF;
 scope:=jsonb_build_array(jsonb_build_object('periodId',basis->>'periodId','customerId',basis->>'customerId','siteId',basis->>'siteId','meteringPointId',basis->>'meteringPointId','pointId',own->>'point','identityAgency',own->>'identityAgency','gridArea',own->>'gridArea','sourceMessageId',basis->>'sourceMessageId','sourcePayloadHash',basis->>'payloadHash','marketStateVersion',basis->>'marketStateVersion','effectiveAt',own->>'effectiveAt','lineItemReference',own->>'li','classification',kind,'targetCustomerIdentity',own#>>'{customerParty,0}','targetCustomerQualifier',own#>>'{customerParty,1}'));
 SELECT * INTO ba FROM public.tenant_bilateral_agreements WHERE id=a.agreement_id AND company_id=c AND environment=a.environment FOR SHARE;
 stamp:=clock_timestamp();
 INSERT INTO gridex_customer_life_events.inbound_classifications(company_id,source_message_id,source_payload_hash,classification,approved_scope,allowed_customer_fields,source_reference,source_version,source_original,source_sha256,classification_original,classification_sha256,owner_decision_reference,approved_by,approved_at)
 VALUES(c,a.source_message_id,a.claims->>'payloadHash',kind,scope,fields,a.source_reference,a.source_version,a.source_bytes,a.source_hash,decode(a.issuer_receipt->>'payloadBase64','base64'),encode(sha256(decode(a.issuer_receipt->>'payloadBase64','base64')),'hex'),r.id::text,r.reviewer_user_id,stamp) RETURNING * INTO q;
 INSERT INTO gridex_customer_life_events.inbound_grounds(source_message_id,company_id,source_payload_hash,classification,bilateral_agreement_id,bilateral_capability_code,bilateral_source_reference,bilateral_terms_sha256,legal_decision_reference,source_reference,source_sha256,approved_scope,allowed_customer_fields,approved_by,approved_at)
 VALUES(a.source_message_id,c,a.claims->>'payloadHash',kind,ba.id,ba.capability_code,ba.source_reference,encode(sha256(convert_to(ba.terms::text,'UTF8')),'hex'),r.id::text,a.source_reference,a.source_hash,scope,fields,r.reviewer_user_id,stamp) RETURNING * INTO g;
 INSERT INTO gridex_bilateral_customer_sources.life_event_classification_origins(source_message_id,company_id,environment,artifact_id,review_id,classification_id,canonical_assessment_id,payload_hash,claims_hash,receipt_hash,classification_row_hash,ground_row_hash)
 VALUES(a.source_message_id,c,a.environment,a.id,r.id,q.id,(a.claims->>'canonicalAssessmentId')::uuid,a.claims->>'payloadHash',a.claims_hash,q.classification_sha256,encode(sha256(convert_to(to_jsonb(q)::text,'UTF8')),'hex'),encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex'));
 RETURN q.id;
END$$;
CREATE FUNCTION gridex_bilateral_customer_sources.classification_origin_publish_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN PERFORM gridex_bilateral_customer_sources.publish_life_event_classification_v1(NEW.company_id,NEW.artifact_id);RETURN NEW;END$$;
CREATE TRIGGER actual_bilateral_review_classification AFTER INSERT ON gridex_bilateral_customer_sources.origins FOR EACH ROW EXECUTE FUNCTION gridex_bilateral_customer_sources.classification_origin_publish_v1();

-- Preserve OIDs, ACLs, volatility, settings and full existing bodies. A private
-- VOLATILE helper supplies current native locks to the unchanged STABLE owner.
DO $bind$DECLARE sig text;oid_before oid;definition text;needle text;addition text;acl_before aclitem[];owner_before oid;config_before text[];vol_before "char";BEGIN
 FOR sig IN SELECT unnest(ARRAY['public.ediel_review_bilateral_customer_source_v1(uuid,uuid,uuid,jsonb)','gridex_customer_life_events.inbound_basis_v1(uuid,uuid,uuid)','gridex_customer_life_events.owner_proof_consistent_v1(jsonb,jsonb,uuid)','public.ediel_customer_life_event_inbound_basis_v1(uuid,uuid,uuid)','public.ediel_apply_customer_life_event_source_v1(uuid,uuid,uuid)']) LOOP
  SELECT oid,proacl,proowner,proconfig,provolatile,pg_get_functiondef(oid) INTO oid_before,acl_before,owner_before,config_before,vol_before,definition FROM pg_proc WHERE oid=to_regprocedure(sig);
  IF oid_before IS NULL THEN RAISE EXCEPTION 'classified_customer_owner_missing:%',sig;END IF;
  addition:='';needle:='BEGIN';
  IF sig LIKE 'public.ediel_review_bilateral%' THEN
   addition:=$x$ PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM id FROM public.ediel_messages WHERE company_id=p_company_id AND id=(SELECT source_message_id FROM gridex_bilateral_customer_sources.artifacts WHERE id=p_artifact_id AND company_id=p_company_id) FOR UPDATE;
$x$;
  ELSIF sig LIKE 'gridex_customer_life_events.inbound_basis%' THEN
   needle:=' SELECT * INTO g FROM gridex_customer_life_events.inbound_grounds';
   addition:=$x$ IF EXISTS(SELECT FROM gridex_bilateral_customer_sources.life_event_classification_origins WHERE company_id=c AND source_message_id=mid) AND gridex_bilateral_customer_sources.classification_current_v1(c,mid) IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_independent_classified_customer_source']);END IF;
$x$;
  ELSIF sig LIKE 'gridex_customer_life_events.owner_proof%' THEN
   addition:=$x$ IF EXISTS(SELECT FROM gridex_bilateral_customer_sources.life_event_classification_origins WHERE source_message_id=mid) AND gridex_bilateral_customer_sources.classification_current_v1((SELECT company_id FROM public.ediel_messages WHERE id=mid),mid) IS NULL THEN RETURN false;END IF;
$x$;
  ELSE addition:=$x$ PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
$x$;
  END IF;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'classified_customer_owner_marker_missing:%',sig;END IF;
  IF needle='BEGIN' THEN definition:=regexp_replace(definition,'BEGIN','BEGIN'||chr(10)||addition);ELSE definition:=replace(definition,needle,addition||needle);END IF;
  IF sig LIKE 'gridex_customer_life_events.inbound_basis%' THEN definition:=regexp_replace(definition,'BEGIN','BEGIN'||chr(10)||' PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();');END IF;
  IF sig LIKE 'public.ediel_review_bilateral%' THEN
   needle:=$n$RETURN jsonb_build_object('status','authorized','artifactId',a.id,'sourceMessageId',a.source_message_id);$n$;
   IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'classified_customer_review_publication_marker_missing';END IF;
   definition:=replace(definition,needle,'PERFORM gridex_bilateral_customer_sources.publish_life_event_classification_v1(p_company_id,a.id);'||needle);
  END IF;
  EXECUTE definition;
  IF (SELECT oid<>oid_before OR proacl IS DISTINCT FROM acl_before OR proowner<>owner_before OR proconfig IS DISTINCT FROM config_before OR provolatile<>vol_before FROM pg_proc WHERE oid=to_regprocedure(sig)) THEN RAISE EXCEPTION 'classified_customer_owner_identity_changed';END IF;
 END LOOP;
END$bind$;
REVOKE ALL ON FUNCTION gridex_bilateral_customer_sources.classification_chain_v1(uuid,uuid,uuid,timestamptz),gridex_bilateral_customer_sources.classification_current_v1(uuid,uuid,timestamptz),gridex_bilateral_customer_sources.publish_life_event_classification_v1(uuid,uuid),gridex_bilateral_customer_sources.classification_origin_publish_v1() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
