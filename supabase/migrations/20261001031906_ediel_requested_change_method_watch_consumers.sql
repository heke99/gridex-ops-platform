-- Supabase CLI forward. Compose the independently reviewed requested-change
-- original with the existing observational TM-METHOD40 owner. No source, review,
-- provider result, accepted clock or business/reading approval is seeded.
BEGIN;
CREATE SCHEMA gridex_requested_method_watches;
REVOKE ALL ON SCHEMA gridex_requested_method_watches FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_requested_method_watches.entry_sources(
 attempt_id uuid PRIMARY KEY REFERENCES gridex_ediel_transport.attempts(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 message_id uuid NOT NULL REFERENCES public.ediel_messages(id),event_id uuid NOT NULL REFERENCES gridex_requested_changes.origins(event_id),
 intent_id uuid NOT NULL,source_payload_hash text NOT NULL,basis jsonb NOT NULL,basis_hash text NOT NULL,
 entry_binding_hash text NOT NULL,message_scope jsonb NOT NULL,entered_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE gridex_requested_method_watches.entry_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_requested_method_watches.entry_sources FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_requested_method_watches.entry_sources FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_requested_method_watches.entry_sources FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_requested_method_watches.entry_sources FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_requested_method_watches.message_scope_v1(m public.ediel_messages) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(m)) WHERE key=ANY(ARRAY[
 'id','company_id','environment','direction','message_standard','message_family','message_code','message_version',
 'created_by','intent_id','source_operation_id','outbound_request_id','customer_id','metering_point_id',
 'communication_route_id','route_profile_id','sender_ediel_id','receiver_ediel_id','sender_subaddress','receiver_subaddress',
 'application_reference','interchange_reference','transaction_reference','immutable_payload_hash','immutable_rendered_at']);
$$;
REVOKE ALL ON FUNCTION gridex_requested_method_watches.message_scope_v1(public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gridex_metering_method_changes.frozen_original_basis_v1(uuid,uuid) RENAME TO frozen_original_before_requested_changes_v1;
REVOKE ALL ON FUNCTION gridex_metering_method_changes.frozen_original_before_requested_changes_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_metering_method_changes.frozen_original_basis_v1(c uuid,msg uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_requested_changes.origins%rowtype;b jsonb;w jsonb;h text;old_basis jsonb;effective timestamptz;accepted jsonb;a gridex_ediel_transport.attempts%rowtype;e gridex_requested_method_watches.entry_sources%rowtype;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO o FROM gridex_requested_changes.origins WHERE company_id=c AND message_id=msg FOR SHARE;
 IF NOT FOUND THEN RETURN gridex_metering_method_changes.frozen_original_before_requested_changes_v1(c,msg);END IF;
 old_basis:=gridex_metering_method_changes.frozen_original_before_requested_changes_v1(c,msg);
 IF old_basis IS NOT NULL THEN RAISE EXCEPTION 'ediel_method_expectation_original_owner_ambiguous';END IF;
 IF (o.basis->>'variant' IN('F','G')) IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE company_id=c AND id=msg FOR SHARE;
 h:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact'
  OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z09'
  OR m.intent_id IS DISTINCT FROM o.intent_id OR m.source_operation_id IS DISTINCT FROM o.event_id::text
  OR m.environment IS DISTINCT FROM o.basis->>'environment' OR m.immutable_rendered_at IS NULL
  OR m.immutable_payload_hash IS DISTINCT FROM h OR o.payload_hash IS DISTINCT FROM h THEN RETURN NULL;END IF;
 -- A later confirmed structural version/contract change cannot relabel the
 -- original. The private entry receipt records current qualification BEFORE
 -- provider entry. It becomes observational authority only with the exact
 -- subsequently accepted native journal; it authorizes no market/reading effect.
 accepted:=gridex_ediel_transport.accepted_source_basis_v1(m);
 IF accepted IS NOT NULL THEN
  IF accepted->>'lane' IS DISTINCT FROM 'generic_journal' THEN RETURN NULL;END IF;
  SELECT * INTO e FROM gridex_requested_method_watches.entry_sources WHERE attempt_id=(accepted->>'attemptId')::uuid AND company_id=c AND environment=m.environment AND message_id=m.id;
  SELECT * INTO a FROM gridex_ediel_transport.attempts WHERE id=e.attempt_id AND company_id=c AND environment=m.environment AND message_id=m.id;
  IF e.attempt_id IS NULL OR e.event_id IS DISTINCT FROM o.event_id OR e.intent_id IS DISTINCT FROM o.intent_id
   OR e.source_payload_hash IS DISTINCT FROM h OR e.basis IS DISTINCT FROM o.basis
   OR e.basis_hash IS DISTINCT FROM encode(sha256(convert_to(o.basis::text,'UTF8')),'hex')
   OR e.entry_binding_hash IS DISTINCT FROM encode(sha256(convert_to(a.binding::text,'UTF8')),'hex')
   OR e.message_scope IS DISTINCT FROM gridex_requested_method_watches.message_scope_v1(m)
   OR e.entered_at IS DISTINCT FROM a.entered_at OR a.entered_at IS NULL
   OR (accepted->>'observedAt')::timestamptz<a.entered_at THEN RETURN NULL;END IF;
  b:=e.basis;
 ELSE
  -- Prospective sends still require actual current archive/reviewer/issuer/
  -- contract/customer/supply/intent/route/physical LI qualification.
  BEGIN
   b:=gridex_requested_changes.require_message_v1(m,o.actor_user_id);
   PERFORM gridex_ediel_source_rules.require_v1(c,m.id);
  EXCEPTION WHEN raise_exception OR insufficient_privilege THEN RETURN NULL;END;
 END IF;
 IF b IS DISTINCT FROM o.basis OR b->>'status' IS DISTINCT FROM 'authorized'
  OR b->>'eventId' IS DISTINCT FROM o.event_id::text OR b->>'companyId' IS DISTINCT FROM c::text
  OR b->>'eventKind' IS DISTINCT FROM (CASE b->>'variant' WHEN 'F' THEN 'quarter_contract' WHEN 'G' THEN 'method_contract' END) THEN RETURN NULL;END IF;
 w:=gridex_metering_method_changes.wire_v1(m.raw_payload);
 effective:=(b->>'effectiveAt')::timestamptz;
 IF w IS NULL OR w->>'code' IS DISTINCT FROM 'Z09'
  OR w#>>'{object,reason}' IS DISTINCT FROM (CASE b->>'variant' WHEN 'F' THEN 'E64' WHEN 'G' THEN 'E32' END)
  OR w#>>'{object,effective}' IS DISTINCT FROM to_char(effective AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('authorized',true,'sourceOwner','requested_change_original_v1','eventId',o.event_id,
  'sourceMessageId',m.id,'sourcePayloadHash',h,'basis',b||jsonb_build_object('subtype',b->>'variant','method',CASE b->>'variant' WHEN 'F' THEN 'Z04' WHEN 'G' THEN 'Z03' END),
  'physicalObject',w->'object','validityDay',substring(w#>>'{object,effective}',1,8));
END $$;
REVOKE ALL ON FUNCTION gridex_metering_method_changes.frozen_original_basis_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- The delegate returns fixed accepted/entered outcomes first. Only a genuine
-- fresh native entry can capture this source receipt, atomically before the
-- actual provider closure may execute. No caller row/flag can create it.
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_requested_method_entry_v1;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_before_requested_method_entry_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;m public.ediel_messages%rowtype;o gridex_requested_changes.origins%rowtype;a gridex_ediel_transport.attempts%rowtype;b jsonb;h text;e gridex_requested_method_watches.entry_sources%rowtype;
BEGIN
 IF i->>'action' IN('prepare','enter') THEN PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();END IF;
 r:=gridex_ediel_transport.mutate_before_requested_method_entry_v1(i);
 IF i->>'action' IS DISTINCT FROM 'enter' OR r->>'proceed' IS DISTINCT FROM 'true' THEN RETURN r;END IF;
 SELECT * INTO o FROM gridex_requested_changes.origins WHERE company_id=(i->>'companyId')::uuid AND message_id=(i->>'messageId')::uuid FOR SHARE;
 IF NOT FOUND OR (o.basis->>'variant' IN('F','G')) IS NOT TRUE THEN RETURN r;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=o.company_id AND id=o.message_id AND environment=i->>'environment' FOR SHARE;
 SELECT * INTO STRICT a FROM gridex_ediel_transport.attempts WHERE id=(i->>'attemptId')::uuid AND company_id=o.company_id AND environment=m.environment AND message_id=m.id FOR SHARE;
 b:=gridex_requested_changes.require_message_v1(m,a.actor_user_id,'communication.send');
 PERFORM gridex_ediel_source_rules.require_v1(m.company_id,m.id);
 PERFORM gridex_method_expectations.require_binding_v1(m,a.binding);
 h:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 IF b IS DISTINCT FROM o.basis OR a.entered_at IS NULL OR a.binding->>'originalHash' IS DISTINCT FROM h
  OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM h OR o.payload_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'ediel_method_expectation_current_entry_source_required';END IF;
 INSERT INTO gridex_requested_method_watches.entry_sources(attempt_id,company_id,environment,message_id,event_id,intent_id,source_payload_hash,basis,basis_hash,entry_binding_hash,message_scope,entered_at)
 VALUES(a.id,m.company_id,m.environment,m.id,o.event_id,o.intent_id,h,b,encode(sha256(convert_to(b::text,'UTF8')),'hex'),encode(sha256(convert_to(a.binding::text,'UTF8')),'hex'),gridex_requested_method_watches.message_scope_v1(m),a.entered_at);
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb) TO service_role;

-- Keep the existing SEND union, current actor/DENY checks, real accepted source
-- registration and observational reconcile/expiry. The common lock prefix runs
-- before any old actor/source locks; an eligible new original cannot silently
-- lose its watch when its accepted entry receipt is missing or mismatched.
ALTER FUNCTION gridex_method_expectations.mutate_v1(jsonb) RENAME TO mutate_before_requested_method_original_v1;
REVOKE ALL ON FUNCTION gridex_method_expectations.mutate_before_requested_method_original_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_method_expectations.mutate_v1(i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 IF i->>'action'='register' AND EXISTS(SELECT FROM gridex_requested_changes.origins o WHERE o.company_id=(i->>'companyId')::uuid AND o.message_id=(i->>'messageId')::uuid AND o.basis->>'variant' IN('F','G'))
  AND gridex_metering_method_changes.frozen_original_basis_v1((i->>'companyId')::uuid,(i->>'messageId')::uuid) IS NULL THEN RAISE EXCEPTION 'ediel_method_expectation_requested_original_required';END IF;
 RETURN gridex_method_expectations.mutate_before_requested_method_original_v1(i);
END $$;
REVOKE ALL ON FUNCTION gridex_method_expectations.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_method_expectations.mutate_v1(jsonb) TO service_role;

-- The existing actual send classifier and native provider wrappers call this
-- source guard. Preserve every legacy/certification case; only an actual private
-- new origin selects this independent source owner (never an input boolean).
ALTER FUNCTION public.ediel_require_metering_method_change_source_current_v1(uuid,uuid,uuid) SET SCHEMA gridex_metering_method_changes;
ALTER FUNCTION gridex_metering_method_changes.ediel_require_metering_method_change_source_current_v1(uuid,uuid,uuid) RENAME TO require_source_before_requested_changes_v1;
REVOKE ALL ON FUNCTION gridex_metering_method_changes.require_source_before_requested_changes_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_require_metering_method_change_source_current_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_requested_changes.origins%rowtype;b jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO o FROM gridex_requested_changes.origins WHERE company_id=p_company_id AND message_id=p_message_id FOR SHARE;
 IF NOT FOUND OR (o.basis->>'variant' IN('F','G')) IS NOT TRUE THEN
  PERFORM gridex_metering_method_changes.require_source_before_requested_changes_v1(p_company_id,p_message_id,p_actor_user_id);RETURN;
 END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id AND id=p_message_id FOR SHARE;
 b:=gridex_requested_changes.require_message_v1(m,p_actor_user_id,'communication.send');
 IF b IS DISTINCT FROM o.basis OR gridex_metering_method_changes.frozen_original_basis_v1(p_company_id,p_message_id) IS NULL THEN RAISE EXCEPTION 'ediel_method_expectation_requested_original_required';END IF;
END $$;
REVOKE ALL ON FUNCTION public.ediel_require_metering_method_change_source_current_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_require_metering_method_change_source_current_v1(uuid,uuid,uuid) TO service_role;

-- Ordinary method plan preparation is gated by the actual current native source
-- kind. Certification originals have no business watch. A live requested-change
-- origin is an independently qualified agreement, not a certification fixture.
DO $$DECLARE body text;needle text;replacement text;BEGIN
 SELECT pg_get_functiondef('gridex_metering_method_changes.certification_basis_v1(public.ediel_messages)'::regprocedure) INTO body;
 needle:=$old$OR EXISTS(SELECT FROM gridex_metering_method_changes.origins o WHERE o.company_id=m.company_id AND o.message_id=m.id)$old$;
 replacement:=needle||$new$ OR EXISTS(SELECT FROM gridex_requested_changes.origins o WHERE o.company_id=m.company_id AND o.message_id=m.id)$new$;
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'ediel_method_expectation_certification_owner_contract_changed';END IF;
 EXECUTE replace(body,needle,replacement);
 SELECT pg_get_functiondef('public.ediel_metering_method_change_send_basis_v1(uuid,uuid,uuid)'::regprocedure) INTO body;
 needle:=$old$ELSIF EXISTS(SELECT FROM gridex_metering_method_changes.origins o WHERE o.company_id=m.company_id AND o.message_id=m.id) THEN kind:='agreement';$old$;
 replacement:=$new$ELSIF EXISTS(SELECT FROM gridex_requested_changes.origins o WHERE o.company_id=m.company_id AND o.message_id=m.id AND o.basis->>'variant' IN('F','G')) THEN
  IF gridex_metering_method_changes.frozen_original_basis_v1(m.company_id,m.id) IS NULL THEN RAISE EXCEPTION 'ediel_method_expectation_requested_original_required';END IF;kind:='agreement';
 ELSIF EXISTS(SELECT FROM gridex_metering_method_changes.origins o WHERE o.company_id=m.company_id AND o.message_id=m.id) THEN kind:='agreement';$new$;
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'ediel_method_expectation_send_kind_owner_contract_changed';END IF;
 EXECUTE replace(body,needle,replacement);
 -- Existing same-admission and atomic accepted-transport registration owners
 -- remain intact. Only enumerate all eligible accepted original families when
 -- checking whether one received Z06 would ambiguously fulfill two requests.
 SELECT pg_get_functiondef('gridex_method_expectations.reconcile_v1(uuid,uuid)'::regprocedure) INTO body;
 needle:=$old$FOR other IN SELECT m.* FROM gridex_metering_method_changes.desired_change_receipts r JOIN public.ediel_messages m ON m.id=r.message_id
   WHERE r.company_id=b.company_id AND r.environment=b.environment$old$;
 replacement:=$new$FOR other IN SELECT m.* FROM public.ediel_messages m WHERE m.company_id=b.company_id AND m.environment=b.environment
   AND (EXISTS(SELECT FROM gridex_metering_method_changes.desired_change_receipts r WHERE r.company_id=b.company_id AND r.environment=b.environment AND r.message_id=m.id)
    OR EXISTS(SELECT FROM gridex_requested_changes.origins r WHERE r.company_id=b.company_id AND r.message_id=m.id AND r.basis->>'variant' IN('F','G')))$new$;
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'ediel_method_expectation_reconciliation_owner_contract_changed';END IF;
 EXECUTE replace(body,needle,replacement);
END $$;
COMMIT;
