-- EDIEL03.01 owner-only native component: NO REAL fixture/business/authority rows.
-- Explicit TEMP-only SIMULATED dependencies/state below, never original authority.
-- Main executes on qualified disposable database only. Always rollback.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $test$
DECLARE t timestamptz:='2026-11-11T12:00:00Z'; due timestamptz; n integer; before_counts jsonb;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'native_component_requires_canonical_owner';END IF;
 -- These pure clock calculations are NOT positive installation/actor evidence.
 IF gridex_ediel_local_wait.smtp_endpoint_sha256_v1('{"version":1,"provider":"strato","host":"127.0.0.1","port":55465,"secure":true,"requireTLS":true,"rejectUnauthorized":true,"minVersion":"TLSv1.2","servername":null,"caTrustSha256":"5201b885a7890af964fb9c979b89cea6c3f50bfd6eb0622880994ff2b52f5e1f","fingerprint":"33223636915c8f1b34c90ce3e3d556de58552fbd8423b413a3f5f405af4d601b"}'::jsonb) IS DISTINCT FROM '33223636915c8f1b34c90ce3e3d556de58552fbd8423b413a3f5f405af4d601b' THEN RAISE EXCEPTION 'endpoint_fingerprint_parity_wrong';END IF;
 IF gridex_ediel_local_wait.smtp_endpoint_sha256_v1(('{"version":1,"provider":"strato","host":"127.0.0.1","port":55465,"secure":true,"requireTLS":true,"rejectUnauthorized":true,"minVersion":"TLSv1.2","servername":null,"caTrustSha256":"5201b885a7890af964fb9c979b89cea6c3f50bfd6eb0622880994ff2b52f5e1f","fingerprint":"33223636915c8f1b34c90ce3e3d556de58552fbd8423b413a3f5f405af4d601b"}'::jsonb)||jsonb_build_object('host','smtp.example.invalid')) IS NOT NULL
 OR gridex_ediel_local_wait.smtp_endpoint_sha256_v1(('{"version":1,"provider":"strato","host":"127.0.0.1","port":55465,"secure":true,"requireTLS":true,"rejectUnauthorized":true,"minVersion":"TLSv1.2","servername":null,"caTrustSha256":"5201b885a7890af964fb9c979b89cea6c3f50bfd6eb0622880994ff2b52f5e1f","fingerprint":"33223636915c8f1b34c90ce3e3d556de58552fbd8423b413a3f5f405af4d601b"}'::jsonb)||jsonb_build_object('requireTLS',false)) IS NOT NULL
 OR gridex_ediel_local_wait.smtp_endpoint_sha256_v1(('{"version":1,"provider":"strato","host":"127.0.0.1","port":55465,"secure":true,"requireTLS":true,"rejectUnauthorized":true,"minVersion":"TLSv1.2","servername":null,"caTrustSha256":"5201b885a7890af964fb9c979b89cea6c3f50bfd6eb0622880994ff2b52f5e1f","fingerprint":"33223636915c8f1b34c90ce3e3d556de58552fbd8423b413a3f5f405af4d601b"}'::jsonb)||jsonb_build_object('rejectUnauthorized',false)) IS NOT NULL
 OR gridex_ediel_local_wait.smtp_endpoint_sha256_v1(('{"version":1,"provider":"strato","host":"127.0.0.1","port":55465,"secure":true,"requireTLS":true,"rejectUnauthorized":true,"minVersion":"TLSv1.2","servername":null,"caTrustSha256":"5201b885a7890af964fb9c979b89cea6c3f50bfd6eb0622880994ff2b52f5e1f","fingerprint":"33223636915c8f1b34c90ce3e3d556de58552fbd8423b413a3f5f405af4d601b"}'::jsonb)||jsonb_build_object('credential','forbidden')) IS NOT NULL
 THEN RAISE EXCEPTION 'endpoint_validation_fail_open';END IF;
 due:=gridex_ediel_local_wait.policy_due_v1(t,60,t+interval '10 minutes');
 IF due IS DISTINCT FROM t+interval '60 seconds' THEN RAISE EXCEPTION 'default_wait_wrong';END IF;
 IF gridex_ediel_local_wait.policy_due_v1(t,1,t+interval '2 hours') IS DISTINCT FROM t+interval '1 second'
 OR gridex_ediel_local_wait.policy_due_v1(t,3600,t+interval '2 hours') IS DISTINCT FROM t+interval '1 hour' THEN RAISE EXCEPTION 'bounded_wait_wrong';END IF;
 FOREACH n IN ARRAY ARRAY[0,-1,3601] LOOP
  BEGIN
   PERFORM gridex_ediel_local_wait.policy_due_v1(t,n,t+interval '2 hours');
   RAISE EXCEPTION 'invalid_delay_accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 END LOOP;
 BEGIN
  PERFORM gridex_ediel_local_wait.policy_due_v1(t,60,t+interval '60 seconds');
  RAISE EXCEPTION 'deadline_extension_or_equal_accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM gridex_ediel_local_wait.policy_due_v1(NULL,60,t+interval '10 minutes');
  RAISE EXCEPTION 'missing_observation_accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF has_schema_privilege('service_role','gridex_ediel_local_wait','USAGE')
 OR EXISTS(SELECT FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='gridex_ediel_local_wait' AND
  (has_function_privilege('service_role',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
   OR has_function_privilege('anon',p.oid,'EXECUTE'))) THEN RAISE EXCEPTION 'new_private_authority_leaked';END IF;
 IF EXISTS(SELECT FROM gridex_ediel_local_wait.installations_v1)
 OR EXISTS(SELECT FROM gridex_ediel_local_wait.runtimes_v1)
 OR EXISTS(SELECT FROM gridex_ediel_local_wait.policies_v1)
 OR EXISTS(SELECT FROM gridex_ediel_local_wait.waits_v1) THEN RAISE EXCEPTION 'component_requires_empty_unactivated_model';END IF;
 BEGIN
  PERFORM gridex_ediel_local_wait.qualify_installation_v1('wrong-database',pg_postmaster_start_time(),repeat('a',64),repeat('b',64),clock_timestamp()+interval '10 minutes');
  RAISE EXCEPTION 'wrong_database_accepted';
 EXCEPTION WHEN check_violation THEN NULL;END;
 IF EXISTS(SELECT FROM gridex_ediel_local_wait.installations_v1) THEN RAISE EXCEPTION 'denial_partial_write';END IF;
END $test$;

-- SIMULATED SQL UNIT MODEL, not public/native source integration or scenario PASS.
-- Real product rows/guards/roles are NEVER changed. Actual function control flow
-- is copied with hash-pinned, reversible relation/dependency substitutions only.
-- FK/real actor/source/route qualification are intentionally NOT proved here.
CREATE TEMP TABLE installations_v1 AS SELECT * FROM gridex_ediel_local_wait.installations_v1 WITH NO DATA;
CREATE TEMP TABLE runtimes_v1 AS SELECT * FROM gridex_ediel_local_wait.runtimes_v1 WITH NO DATA;
CREATE TEMP TABLE policies_v1 AS SELECT * FROM gridex_ediel_local_wait.policies_v1 WITH NO DATA;
CREATE TEMP TABLE waits_v1 AS SELECT * FROM gridex_ediel_local_wait.waits_v1 WITH NO DATA;
CREATE TEMP TABLE sim_outbox AS SELECT * FROM public.ediel_outbox WITH NO DATA;
CREATE TEMP TABLE sim_messages AS SELECT * FROM public.ediel_messages WITH NO DATA;
CREATE TEMP TABLE sim_snapshots AS SELECT * FROM public.ediel_configuration_snapshots WITH NO DATA;
CREATE TEMP TABLE sim_companies AS SELECT id,status,is_active,is_paused FROM public.companies WITH NO DATA;
CREATE TEMP TABLE sim_attempts AS SELECT * FROM gridex_ediel_transport.attempts WITH NO DATA;
CREATE TEMP TABLE sim_reservations AS SELECT * FROM gridex_ediel_transport.reservations WITH NO DATA;
CREATE UNIQUE INDEX ON pg_temp.waits_v1(attempt_id);
CREATE UNIQUE INDEX ON pg_temp.sim_reservations(message_id);
CREATE UNIQUE INDEX ON pg_temp.policies_v1(outbox_id);
ALTER TABLE pg_temp.installations_v1 ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE pg_temp.runtimes_v1 ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE pg_temp.policies_v1 ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE pg_temp.policies_v1 ALTER COLUMN policy_version SET DEFAULT 'local-test-4xx-v1';
ALTER TABLE pg_temp.policies_v1 ALTER COLUMN attempt_limit SET DEFAULT 2;
CREATE TEMP TABLE sim_control(runtime_id uuid,actor_id uuid,eligible boolean,fail_prepare boolean);
INSERT INTO pg_temp.sim_control VALUES(NULL,'00000000-0000-4000-8000-000000000301',true,false);
CREATE FUNCTION pg_temp.sim_lock_graph() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
CREATE FUNCTION pg_temp.sim_lock_sources() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
CREATE FUNCTION pg_temp.sim_canonical(c uuid,operation text) RETURNS TABLE(allowed boolean)
LANGUAGE sql AS $$SELECT x.eligible AND operation='ediel.test.process' AND EXISTS(SELECT FROM pg_temp.sim_companies co WHERE co.id=c) FROM pg_temp.sim_control x$$;
CREATE FUNCTION pg_temp.sim_ack(c uuid,env text,mid uuid,actor uuid,phase text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid uuid;
BEGIN
 IF env IS DISTINCT FROM 'test' OR phase IS DISTINCT FROM 'send'
 OR NOT EXISTS(SELECT FROM pg_temp.sim_control x WHERE x.eligible AND x.actor_id=actor)
 THEN RAISE EXCEPTION 'SIMULATED_actor_denied' USING ERRCODE='42501';END IF;
 SELECT related_message_id INTO sid FROM pg_temp.sim_messages WHERE id=mid AND company_id=c;
 IF sid IS NULL THEN RAISE EXCEPTION 'SIMULATED_source_denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('technicalSyntaxAckEvidence',jsonb_build_object('sourceMessageId',sid));
END $$;
CREATE FUNCTION pg_temp.sim_delegate(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE action text:=i->>'action';mid uuid:=(i->>'messageId')::uuid;aid uuid:=(i->>'attemptId')::uuid;
 r pg_temp.sim_reservations%rowtype;a pg_temp.sim_attempts%rowtype;v_class text;
BEGIN
 SELECT * INTO r FROM pg_temp.sim_reservations WHERE message_id=mid;
 IF action='prepare' THEN
  IF (SELECT fail_prepare FROM pg_temp.sim_control) THEN RAISE EXCEPTION 'SIMULATED_late_source_denial' USING ERRCODE='55000';END IF;
  IF r.message_id IS NOT NULL AND r.state<>'released' THEN
   SELECT * INTO a FROM pg_temp.sim_attempts WHERE id=r.attempt_id;
   RETURN jsonb_build_object('proceed',false,'state',r.state,'classification',a.classification);
  END IF;
  INSERT INTO pg_temp.sim_attempts(id,message_id,company_id,environment,actor_user_id,owner,binding,created_at)
  VALUES(aid,mid,(i->>'companyId')::uuid,i->>'environment',(i->>'actorUserId')::uuid,i->'owner',i->'binding',clock_timestamp());
  INSERT INTO pg_temp.sim_reservations VALUES(mid,aid,'prepared') ON CONFLICT(message_id) DO UPDATE SET attempt_id=EXCLUDED.attempt_id,state='prepared';
  RETURN jsonb_build_object('proceed',true,'state','prepared');
 END IF;
 IF r.attempt_id IS DISTINCT FROM aid THEN RAISE EXCEPTION 'SIMULATED_stale_attempt' USING ERRCODE='55000';END IF;
 IF action='enter' THEN
  UPDATE pg_temp.sim_attempts SET entered_at=clock_timestamp() WHERE id=aid;
  UPDATE pg_temp.sim_reservations SET state='entered' WHERE message_id=mid;
  RETURN jsonb_build_object('proceed',true);
 END IF;
 IF action='observe' THEN
  v_class:=CASE WHEN i#>>'{result,error,responseCode}' ~ '^[45][0-9][0-9]$' THEN 'explicit_negative' ELSE 'unknown' END;
  UPDATE pg_temp.sim_attempts SET provider_result=i->'result',classification=v_class,observed_at=clock_timestamp() WHERE id=aid;
  UPDATE pg_temp.sim_reservations SET state='observed' WHERE message_id=mid;
  SELECT * INTO a FROM pg_temp.sim_attempts WHERE id=aid;
  RETURN jsonb_build_object('classification',v_class,'state','observed','observedAt',a.observed_at);
 END IF;
 RAISE EXCEPTION 'SIMULATED_unsupported_action';
END $$;
DO $copy_actual_control_flow$
DECLARE x record;original text;body text;inverse text;args text;rtype text;pair record;
 mappings jsonb:='[
 ["gridex_ediel_local_wait.installations_v1","pg_temp.installations_v1"],
 ["gridex_ediel_local_wait.runtimes_v1","pg_temp.runtimes_v1"],
 ["gridex_ediel_local_wait.policies_v1","pg_temp.policies_v1"],
 ["gridex_ediel_local_wait.waits_v1","pg_temp.waits_v1"],
 ["public.ediel_configuration_snapshots","pg_temp.sim_snapshots"],
 ["public.ediel_outbox","pg_temp.sim_outbox"],
 ["public.ediel_messages","pg_temp.sim_messages"],
 ["public.companies","pg_temp.sim_companies"],
 ["gridex_ediel_transport.attempts","pg_temp.sim_attempts"],
 ["gridex_ediel_transport.reservations","pg_temp.sim_reservations"],
 ["gridex_ediel_technical_ack.read_persisted_contrl_v2","pg_temp.sim_ack"],
 ["public.canonical_tenant_operation_decision","pg_temp.sim_canonical"],
 ["gridex_ediel_ack_replay.lock_current_graph_v2","pg_temp.sim_lock_graph"],
 ["gridex_bilateral_prodat.lock_source_receipts_v1","pg_temp.sim_lock_sources"],
 ["gridex_ediel_local_wait.require_policy_v1","pg_temp.sim_policy"],
 ["gridex_ediel_local_wait.delegate_transport_v1","pg_temp.sim_delegate"]]'::jsonb;
BEGIN
 -- Each declared dependency has a distinct name; the body must reverse byteexact.
 FOR x IN SELECT * FROM (VALUES
 ('gridex_ediel_local_wait.qualify_installation_v1(text,timestamptz,text,text,timestamptz,jsonb)','sim_qualify','397363124be700ce3b7d61de5e50e3d249b00a15dbcdeeb43ffec3c6dd816f21'),
 ('gridex_ediel_local_wait.require_policy_v1(uuid,uuid,text,boolean,jsonb)','sim_policy','c7d8827f184e63bf374da3142cf1c26c3f85ddf2dbbf8f0d9803ee69bc55b895'),
 ('gridex_ediel_local_wait.bind_outbox_v1(uuid,uuid,uuid,uuid,timestamptz,integer)','sim_bind','5338c97817fbb74f4acc0959fee889a5454e3db72a9f1ddd52eba115d4458446'),
 ('gridex_ediel_local_wait.outbox_fence_v1()','sim_fence','491ceb1213684ac2aa1ccb3e333f6f24a7d9a92c37e878d44ec3df3b362103c9'),
 ('gridex_ediel_transport.mutate_v1(jsonb)','sim_transport','75fc96f34752125d1e459b4bdc964fcdc17b3e5eb94fe8bdac5a1f9fe4a8c7e1')
 ) AS pins(signature,target_name,sha) LOOP
  SELECT prosrc,pg_get_function_arguments(oid),pg_get_function_result(oid) INTO original,args,rtype FROM pg_proc WHERE oid=x.signature::regprocedure;
  IF encode(sha256(convert_to(original,'UTF8')),'hex') IS DISTINCT FROM x.sha OR position('$sim_body$' in original)>0 THEN RAISE EXCEPTION 'simulation_source_pin_mismatch';END IF;
  body:=original;
  FOR pair IN SELECT value->>0 AS old_name,value->>1 AS new_name FROM jsonb_array_elements(mappings) LOOP
   body:=replace(body,pair.old_name,pair.new_name);rtype:=replace(rtype,pair.old_name,pair.new_name);
  END LOOP;
  inverse:=body;
  FOR pair IN SELECT value->>0 AS old_name,value->>1 AS new_name FROM jsonb_array_elements(mappings) WITH ORDINALITY a(value,ordinal) ORDER BY ordinal DESC LOOP
   inverse:=replace(inverse,pair.new_name,pair.old_name);
  END LOOP;
  IF inverse IS DISTINCT FROM original THEN RAISE EXCEPTION 'simulation_mapping_not_reversible';END IF;
  EXECUTE format('CREATE FUNCTION pg_temp.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $sim_body$%s$sim_body$',x.target_name,args,rtype,body);
  -- Verify PostgreSQL stored exactly the mechanically adapted body, not a new oracle.
  IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.oid=pg_my_temp_schema() AND p.proname=x.target_name AND p.prosrc=body)
  THEN RAISE EXCEPTION 'simulation_body_storage_changed';END IF;
 END LOOP;
END $copy_actual_control_flow$;
CREATE TRIGGER simulation_actual_fence BEFORE UPDATE ON pg_temp.sim_outbox FOR EACH ROW EXECUTE FUNCTION pg_temp.sim_fence();
CREATE TRIGGER simulation_immutable_installation BEFORE UPDATE OR DELETE ON pg_temp.installations_v1 FOR EACH ROW EXECUTE FUNCTION gridex_ediel_local_wait.immutable_v1();
CREATE TRIGGER simulation_immutable_runtime BEFORE UPDATE OR DELETE ON pg_temp.runtimes_v1 FOR EACH ROW EXECUTE FUNCTION gridex_ediel_local_wait.immutable_v1();
CREATE TRIGGER simulation_immutable_policy BEFORE UPDATE OR DELETE ON pg_temp.policies_v1 FOR EACH ROW EXECUTE FUNCTION gridex_ediel_local_wait.immutable_v1();
CREATE TRIGGER simulation_immutable_wait BEFORE UPDATE OR DELETE ON pg_temp.waits_v1 FOR EACH ROW EXECUTE FUNCTION gridex_ediel_local_wait.immutable_v1();
CREATE FUNCTION pg_temp.sim_new_case(delay integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();mid uuid:=gen_random_uuid();oid uuid:=gen_random_uuid();snapshot uuid:=gen_random_uuid();rid uuid;actor uuid;pid uuid;
BEGIN
 SELECT runtime_id,actor_id INTO rid,actor FROM pg_temp.sim_control;
 INSERT INTO pg_temp.sim_companies VALUES(c,'active',true,false);
 INSERT INTO pg_temp.sim_messages(id,company_id,environment,direction,message_family,raw_payload,immutable_rendered_at,immutable_payload_hash,communication_route_id,related_message_id)
 VALUES(sid,c,'test','inbound','PRODAT','SIMULATED SOURCE',NULL,NULL,NULL,NULL),
 (mid,c,'test','outbound','CONTRL','SIMULATED ACK',clock_timestamp(),encode(sha256(convert_to('SIMULATED ACK','UTF8')),'hex'),gen_random_uuid(),sid);
 INSERT INTO pg_temp.sim_outbox(id,company_id,environment,ediel_message_id,source_message_id,status,attempts,send_attempt_count,updated_by)
 VALUES(oid,c,'test',mid,sid,'queued',0,0,actor);
 INSERT INTO pg_temp.sim_snapshots(id,company_id,snapshot_version,configuration_hash) VALUES(snapshot,c,1,repeat('d',64));
 pid:=pg_temp.sim_bind(rid,oid,snapshot,actor,clock_timestamp()+interval '5 minutes',delay);
 RETURN jsonb_build_object('companyId',c,'messageId',mid,'outboxId',oid,'policyId',pid,'actorUserId',actor,'environment','test','serverBuildSha256','c49d39cf18f31450b456d9e1406dd5b7e385848d5432a3b74b908c5a3293f5af','serverSmtpEndpoint','{"version":1,"provider":"strato","host":"127.0.0.1","port":55465,"secure":true,"requireTLS":true,"rejectUnauthorized":true,"minVersion":"TLSv1.2","servername":null,"caTrustSha256":"5201b885a7890af964fb9c979b89cea6c3f50bfd6eb0622880994ff2b52f5e1f","fingerprint":"33223636915c8f1b34c90ce3e3d556de58552fbd8423b413a3f5f405af4d601b"}'::jsonb);
END $$;
CREATE FUNCTION pg_temp.sim_claim(oid uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE actor uuid;n integer;
BEGIN
 SELECT actor_id INTO actor FROM pg_temp.sim_control;
 UPDATE pg_temp.sim_outbox SET status='sending',attempts=attempts+1,send_attempt_count=send_attempt_count+1,
 locked_by='ediel-outbox-direct-'||actor::text,locked_at=clock_timestamp(),current_send_attempt_id=gen_random_uuid(),updated_by=actor
 WHERE id=oid AND status IN('queued','prepared');
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
CREATE FUNCTION pg_temp.sim_input(c jsonb,action text,aid uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o pg_temp.sim_outbox%rowtype;m pg_temp.sim_messages%rowtype;
BEGIN
 SELECT * INTO STRICT o FROM pg_temp.sim_outbox WHERE id=(c->>'outboxId')::uuid;
 SELECT * INTO STRICT m FROM pg_temp.sim_messages WHERE id=o.ediel_message_id;
 RETURN c||jsonb_build_object('action',action,'attemptId',aid,'owner',jsonb_build_object('kind','worker','outboxId',o.id,'sendAttemptId',o.current_send_attempt_id,'workerId',o.locked_by),
 'binding',jsonb_build_object('localSmtpEndpoint',c->'serverSmtpEndpoint','originalHash',m.immutable_payload_hash,'payloadHash',m.immutable_payload_hash,'payloadLength',13,'routeId',m.communication_route_id,'from','simulated@example.invalid','to','simulated-receiver@example.invalid','encoding','latin1','mimeMode','attachment','sourceRulePackEvidence',NULL,'technicalSyntaxAckEvidence',NULL));
END $$;
CREATE FUNCTION pg_temp.sim_refusal(c jsonb,code integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE aid uuid:=gen_random_uuid();r jsonb;
BEGIN
 IF pg_temp.sim_claim((c->>'outboxId')::uuid)<>1 THEN RAISE EXCEPTION 'simulation_initial_claim_failed';END IF;
 r:=pg_temp.sim_transport(pg_temp.sim_input(c,'prepare',aid));
 IF r->>'proceed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'simulation_prepare_failed';END IF;
 PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'enter',aid));
 PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'observe',aid)||jsonb_build_object('result',jsonb_build_object('error',jsonb_build_object('responseCode',code))));
 RETURN aid;
END $$;
DO $temp_acl$
DECLARE x record;
BEGIN
 FOR x IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace=pg_my_temp_schema() LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',x.signature);
 END LOOP;
END $temp_acl$;
DO $simulated_state_machine$
DECLARE runtime jsonb;c jsonb;aid uuid;aid2 uuid;before_row jsonb;before_audit jsonb;after_row jsonb;result jsonb;
 n integer;denied boolean;due timestamptz;wait_before jsonb;reservation_before jsonb;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'simulation_owner_required';END IF;
 runtime:=pg_temp.sim_qualify(gridex_ediel_local_wait.database_identity_v1(),pg_postmaster_start_time(),repeat('a',64),'c49d39cf18f31450b456d9e1406dd5b7e385848d5432a3b74b908c5a3293f5af',clock_timestamp()+interval '10 minutes','{"version":1,"provider":"strato","host":"127.0.0.1","port":55465,"secure":true,"requireTLS":true,"rejectUnauthorized":true,"minVersion":"TLSv1.2","servername":null,"caTrustSha256":"5201b885a7890af964fb9c979b89cea6c3f50bfd6eb0622880994ff2b52f5e1f","fingerprint":"33223636915c8f1b34c90ce3e3d556de58552fbd8423b413a3f5f405af4d601b"}'::jsonb);
 UPDATE pg_temp.sim_control SET runtime_id=(runtime->>'runtimeId')::uuid;
 -- Binding uses the real owner-only writer body with TEMP source/guard doubles.
 c:=pg_temp.sim_new_case(60);aid:=pg_temp.sim_refusal(c,451);
 SELECT to_jsonb(a) INTO before_audit FROM pg_temp.sim_attempts a WHERE id=aid;
 SELECT to_jsonb(o) INTO before_row FROM pg_temp.sim_outbox o WHERE id=(c->>'outboxId')::uuid;
 SELECT not_before INTO due FROM pg_temp.waits_v1 WHERE attempt_id=aid;
 IF due IS NULL OR clock_timestamp()>=due OR (SELECT count(*) FROM pg_temp.waits_v1 WHERE attempt_id=aid AND smtp_code=451)<>1 THEN RAISE EXCEPTION 'simulation_wait_not_persisted';END IF;
 FOR n IN 1..3 LOOP
  IF pg_temp.sim_claim((c->>'outboxId')::uuid)<>0 THEN RAISE EXCEPTION 'simulation_early_claim_changed_state';END IF;
 END LOOP;
 SELECT to_jsonb(o) INTO after_row FROM pg_temp.sim_outbox o WHERE id=(c->>'outboxId')::uuid;
 IF after_row IS DISTINCT FROM before_row OR (SELECT to_jsonb(a) FROM pg_temp.sim_attempts a WHERE id=aid) IS DISTINCT FROM before_audit
 THEN RAISE EXCEPTION 'simulation_early_claim_lease_counter_or_audit_changed';END IF;
 -- Serial zero-effect proof only: NOT two-session concurrency evidence.
 RAISE NOTICE 'SIMULATED before-due zero lease/counter/attempt effects PASS';
 -- A distinct one-second modeled case reaches a real wall-clock due time.
 c:=pg_temp.sim_new_case(1);aid:=pg_temp.sim_refusal(c,451);
 SELECT to_jsonb(a) INTO before_audit FROM pg_temp.sim_attempts a WHERE id=aid;
 PERFORM pg_sleep(1.05);
 SELECT not_before INTO due FROM pg_temp.waits_v1 WHERE attempt_id=aid;
 IF clock_timestamp()<due THEN RAISE EXCEPTION 'simulation_real_clock_window_not_due';END IF;
 -- Terminal revocation is exercised inside a rolled-back simulated branch;
 -- never reactivate a revoked real or modeled origin by resetting its column.
 BEGIN
  UPDATE pg_temp.runtimes_v1 SET revoked_at=clock_timestamp() WHERE id=(runtime->>'runtimeId')::uuid;
  denied:=false;
  BEGIN PERFORM pg_temp.sim_claim((c->>'outboxId')::uuid);EXCEPTION WHEN object_not_in_prerequisite_state THEN denied:=true;END;
  IF denied IS NOT TRUE THEN RAISE EXCEPTION 'simulation_revoked_runtime_claim_allowed';END IF;
  RAISE EXCEPTION 'rollback_simulated_revocation_branch' USING ERRCODE='PT001';
 EXCEPTION WHEN SQLSTATE 'PT001' THEN NULL;END;
 IF pg_temp.sim_claim((c->>'outboxId')::uuid)<>1 THEN RAISE EXCEPTION 'simulation_due_claim_failed';END IF;
 aid2:=gen_random_uuid();
 -- A forged top-level proof cannot omit the endpoint from the audit binding.
 denied:=false;
 BEGIN PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'prepare',aid2)||jsonb_build_object('binding',(pg_temp.sim_input(c,'prepare',aid2)->'binding')-'localSmtpEndpoint'));EXCEPTION WHEN object_not_in_prerequisite_state THEN denied:=true;END;
 IF denied IS NOT TRUE THEN RAISE EXCEPTION 'simulation_missing_endpoint_audit_accepted';END IF;
 -- Missing/mismatched actual SMTP destination is denied even on the same build/boot.
 denied:=false;
 BEGIN PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'prepare',aid2)-'serverSmtpEndpoint');EXCEPTION WHEN object_not_in_prerequisite_state THEN denied:=true;END;
 IF denied IS NOT TRUE THEN RAISE EXCEPTION 'simulation_missing_endpoint_accepted';END IF;
 denied:=false;
 BEGIN PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'prepare',aid2)||jsonb_build_object('serverSmtpEndpoint',(c->'serverSmtpEndpoint')||jsonb_build_object('host','smtp.example.invalid')));EXCEPTION WHEN object_not_in_prerequisite_state THEN denied:=true;END;
 IF denied IS NOT TRUE THEN RAISE EXCEPTION 'simulation_foreign_endpoint_accepted';END IF;
 -- Missing/mismatched build never releases an old cursor or prepares/enters.
 denied:=false;
 BEGIN PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'prepare',aid2)-'serverBuildSha256');EXCEPTION WHEN object_not_in_prerequisite_state THEN denied:=true;END;
 IF denied IS NOT TRUE THEN RAISE EXCEPTION 'simulation_missing_build_accepted';END IF;
 denied:=false;
 BEGIN PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'prepare',aid2)||jsonb_build_object('serverBuildSha256',repeat('f',64)));EXCEPTION WHEN object_not_in_prerequisite_state THEN denied:=true;END;
 IF denied IS NOT TRUE THEN RAISE EXCEPTION 'simulation_wrong_build_accepted';END IF;
 SELECT to_jsonb(w) INTO wait_before FROM pg_temp.waits_v1 w WHERE attempt_id=aid;
 SELECT to_jsonb(r) INTO reservation_before FROM pg_temp.sim_reservations r WHERE message_id=(c->>'messageId')::uuid;
 UPDATE pg_temp.sim_control SET fail_prepare=true;
 denied:=false;
 BEGIN PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'prepare',aid2));EXCEPTION WHEN object_not_in_prerequisite_state THEN denied:=true;END;
 IF denied IS NOT TRUE OR (SELECT to_jsonb(w) FROM pg_temp.waits_v1 w WHERE attempt_id=aid) IS DISTINCT FROM wait_before
 OR (SELECT to_jsonb(r) FROM pg_temp.sim_reservations r WHERE message_id=(c->>'messageId')::uuid) IS DISTINCT FROM reservation_before
 OR EXISTS(SELECT FROM pg_temp.sim_attempts WHERE id=aid2)
 THEN RAISE EXCEPTION 'simulation_retry_not_atomic_on_source_denial';END IF;
 UPDATE pg_temp.sim_control SET fail_prepare=false;
 result:=pg_temp.sim_transport(pg_temp.sim_input(c,'prepare',aid2));
 IF result->>'proceed' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT FROM pg_temp.waits_v1 WHERE attempt_id=aid AND consumed_at IS NOT NULL)
 OR (SELECT to_jsonb(a) FROM pg_temp.sim_attempts a WHERE id=aid) IS DISTINCT FROM before_audit
 THEN RAISE EXCEPTION 'simulation_due_retry_or_original_audit_invalid';END IF;
 denied:=false;
 BEGIN PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'enter',aid2)-'serverBuildSha256');EXCEPTION WHEN object_not_in_prerequisite_state THEN denied:=true;END;
 IF denied IS NOT TRUE OR (SELECT entered_at FROM pg_temp.sim_attempts WHERE id=aid2) IS NOT NULL THEN RAISE EXCEPTION 'simulation_entry_build_missing_allowed';END IF;
 denied:=false;
 BEGIN PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'enter',aid2)-'serverSmtpEndpoint');EXCEPTION WHEN object_not_in_prerequisite_state THEN denied:=true;END;
 IF denied IS NOT TRUE OR (SELECT entered_at FROM pg_temp.sim_attempts WHERE id=aid2) IS NOT NULL THEN RAISE EXCEPTION 'simulation_entry_endpoint_missing_allowed';END IF;
 BEGIN
  UPDATE pg_temp.sim_attempts SET binding=binding-'localSmtpEndpoint' WHERE id=aid2;
  denied:=false;
  BEGIN PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'enter',aid2));EXCEPTION WHEN object_not_in_prerequisite_state THEN denied:=true;END;
  IF denied IS NOT TRUE THEN RAISE EXCEPTION 'simulation_entry_audit_endpoint_missing_allowed';END IF;
  RAISE EXCEPTION 'rollback_simulated_audit_tamper' USING ERRCODE='PT002';
 EXCEPTION WHEN SQLSTATE 'PT002' THEN NULL;END;
 PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'enter',aid2));
 PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'observe',aid2)||jsonb_build_object('result',jsonb_build_object('error',jsonb_build_object('responseCode',451))));
 IF EXISTS(SELECT FROM pg_temp.waits_v1 WHERE attempt_id=aid2) THEN RAISE EXCEPTION 'simulation_budget_added_third_attempt';END IF;
 denied:=false;
 BEGIN UPDATE pg_temp.sim_outbox SET attempts=attempts+1,send_attempt_count=send_attempt_count+1 WHERE id=(c->>'outboxId')::uuid;EXCEPTION WHEN object_not_in_prerequisite_state THEN denied:=true;END;
 IF denied IS NOT TRUE OR (SELECT attempts FROM pg_temp.sim_outbox WHERE id=(c->>'outboxId')::uuid)<>2 THEN RAISE EXCEPTION 'simulation_budget_or_counter_reset';END IF;
 RAISE NOTICE 'SIMULATED due/revocation/build/atomic retry/budget PASS';
 c:=pg_temp.sim_new_case(60);aid:=pg_temp.sim_refusal(c,550);
 IF EXISTS(SELECT FROM pg_temp.waits_v1 WHERE attempt_id=aid) OR (SELECT classification FROM pg_temp.sim_attempts WHERE id=aid)<>'explicit_negative'
 THEN RAISE EXCEPTION 'simulation_5xx_became_wait';END IF;
 c:=pg_temp.sim_new_case(60);aid:=pg_temp.sim_refusal(c,NULL);
 IF EXISTS(SELECT FROM pg_temp.waits_v1 WHERE attempt_id=aid) OR (SELECT classification FROM pg_temp.sim_attempts WHERE id=aid)<>'unknown' THEN RAISE EXCEPTION 'simulation_unknown_became_wait';END IF;
 -- Simulate a caller trying to put an unknown outcome back on the queue.
 -- No authority is created: the real local fence must not claim/retry it.
 UPDATE pg_temp.sim_outbox SET status='queued',locked_by=NULL,locked_at=NULL WHERE id=(c->>'outboxId')::uuid;
 SELECT to_jsonb(o) INTO before_row FROM pg_temp.sim_outbox o WHERE id=(c->>'outboxId')::uuid;
 n:=pg_temp.sim_claim((c->>'outboxId')::uuid);
 -- Existing claims can consume a bounded claim attempt for a manually requeued
 -- unknown. The required invariant here is NO new transport entry/resend, not
 -- the distinct before-due zero-claim requirement proved above.
 IF n=1 THEN
  aid2:=gen_random_uuid();result:=pg_temp.sim_transport(pg_temp.sim_input(c,'prepare',aid2));
  IF result->>'proceed' IS DISTINCT FROM 'false' OR EXISTS(SELECT FROM pg_temp.sim_attempts WHERE id=aid2)
   OR (SELECT attempt_id FROM pg_temp.sim_reservations WHERE message_id=(c->>'messageId')::uuid) IS DISTINCT FROM aid
  THEN RAISE EXCEPTION 'simulation_unknown_resend_not_suppressed';END IF;
  -- Deliberate adversarial call after prepare.proceed=false; normal TS never
  -- enters here. No attempt exists: the endpoint audit lookup must fail closed.
  SELECT to_jsonb(r) INTO before_audit FROM pg_temp.sim_reservations r WHERE r.message_id=(c->>'messageId')::uuid;
  denied:=false;
  BEGIN
   PERFORM pg_temp.sim_transport(pg_temp.sim_input(c,'enter',aid2));
  EXCEPTION
   WHEN no_data_found THEN
    IF SQLERRM IS DISTINCT FROM 'query returned no rows' THEN RAISE;END IF;
    denied:=true;
   WHEN object_not_in_prerequisite_state THEN denied:=true;
  END;
  IF denied IS NOT TRUE OR EXISTS(SELECT FROM pg_temp.sim_attempts WHERE id=aid2)
   OR (SELECT to_jsonb(r) FROM pg_temp.sim_reservations r WHERE r.message_id=(c->>'messageId')::uuid) IS DISTINCT FROM before_audit
  THEN RAISE EXCEPTION 'simulation_unknown_entry_authorized';END IF;
 ELSIF n<>0 THEN RAISE EXCEPTION 'simulation_unknown_claim_count_invalid';END IF;
 IF (SELECT attempts FROM pg_temp.sim_outbox WHERE id=(c->>'outboxId')::uuid)>2
 OR EXISTS(SELECT FROM pg_temp.waits_v1 WHERE attempt_id=aid) THEN RAISE EXCEPTION 'simulation_unknown_budget_or_wait_invented';END IF;
 RAISE NOTICE 'SIMULATED 5xx/unknown non-retry PASS';
 IF EXISTS(SELECT FROM gridex_ediel_local_wait.installations_v1) OR EXISTS(SELECT FROM gridex_ediel_local_wait.runtimes_v1)
 OR EXISTS(SELECT FROM gridex_ediel_local_wait.policies_v1) OR EXISTS(SELECT FROM gridex_ediel_local_wait.waits_v1)
 THEN RAISE EXCEPTION 'simulation_touched_real_authority';END IF;
END $simulated_state_machine$;
-- No simulation function is delegated to any application role.

ROLLBACK;
