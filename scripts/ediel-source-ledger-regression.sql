\set ON_ERROR_STOP on
\pset pager off
-- Real PostgreSQL role, transaction and row tests. Disposable replay ONLY.
BEGIN;
CREATE TEMP TABLE source_ledger_results(name text PRIMARY KEY,passed boolean NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.ledger_check(label text, result boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO source_ledger_results VALUES(label,coalesce(result,false)); END $$;
INSERT INTO public.companies(id,name,status) VALUES
 ('00000000-0000-4000-8000-00000000e001','Ledger A','active'),('00000000-0000-4000-8000-00000000e002','Ledger B','active');
create function pg_temp.ledger_row(company uuid, env text, payload text default 'original source', stamp timestamptz default '2026-06-20T11:00:00.123456+02:00',
 snapshot jsonb default '{"other":"retained"}', family text default 'PRODAT', standard text default 'edifact', requested_id uuid default gen_random_uuid())
returns uuid language plpgsql as $$
declare result uuid; profile public.ediel_message_profiles%rowtype; pack public.ediel_rule_packs%rowtype;
begin
 if family in ('PRODAT','UTILTS') then
  if family='PRODAT' then
   select * into strict profile from public.ediel_message_profiles where profile_key='PRODAT:Z04:L:26.A:r3' and is_enabled;
  else
   select mp.* into strict profile from public.ediel_message_profiles mp
    where mp.profile->>'family'='UTILTS' and mp.message_code='E66' and mp.direction in ('inbound','both') and mp.is_enabled
    order by mp.profile_key limit 1;
  end if;
  select * into strict pack from public.ediel_rule_packs where id=profile.rule_pack_id;
 end if;
 insert into public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,execution_context_snapshot,
 canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 values(requested_id,company,env,'inbound',standard,family,case when family='PRODAT' then 'Z04' when family='UTILTS' then 'E66' else null end,'received',payload,stamp,snapshot,
 pack.id,profile.profile_key,profile.id,case when family in ('PRODAT','UTILTS') then pack.guide_version||':r'||pack.guide_revision else null end,pack.source_hash,coalesce(profile.profile,'{}'::jsonb))
 returning id into result;
 return result;
end $$;

CREATE FUNCTION pg_temp.ledger_facts(decision text DEFAULT 'rejected') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('version',1,'owner','canonical-runtime-with-registry-v1','sourceDisposition','not_established',
  'objectDisposition','not_checked','partyDisposition','not_checked','coverage','canonical_runtime_only','originalTenantMatch','matched',
  'syntaxDecision',decision,'applicationDecision','not_applicable','functionalDecision','not_applicable','messageReference','MSG',
  'reasonCodes',jsonb_build_array('TEST_SYNTAX_REJECTION'),'rulePackEvidence',null)
$$;
CREATE FUNCTION pg_temp.ledger_inventory(snap jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('version',1,'universe','durable_received_sources','historyCoverage','before_ledger_unknown','authorityStatus','not_established',
  'selection','not_performed','status','incomplete','sources',coalesce(jsonb_agg(jsonb_build_object('sourceMessageId',value->'sourceMessageId',
  'sourcePayloadHash',value->'payloadHash','sourceReceivedAt',value->'sourceReceivedAt','capturedAt',value->'capturedAt','receiptStatus',CASE WHEN jsonb_typeof(value->'receivedContext')='object' THEN 'recorded' ELSE 'unavailable' END,
  'disposition','not_checked','status','incomplete','occurrences','[]'::jsonb,'objects','[]'::jsonb,'issues',jsonb_build_array('source_wire_unavailable'))),'[]'::jsonb),
  'issues','[]'::jsonb) FROM jsonb_array_elements(snap->'sources')
$$;
DO $$
DECLARE c uuid; env text; row_id uuid; saved jsonb; snap jsonb; receipt jsonb; first_assessment jsonb; second_assessment jsonb;
 a constant uuid:='00000000-0000-4000-8000-00000000e001'; b constant uuid:='00000000-0000-4000-8000-00000000e002';
 source_id uuid; source_hash text; inv jsonb; altered jsonb; mode text; blocked boolean; previous uuid;
BEGIN
 FOREACH c IN ARRAY ARRAY[a,b] LOOP FOREACH env IN ARRAY ARRAY['test','production'] LOOP
  row_id:=pg_temp.ledger_row(c,env);
  SELECT to_jsonb(s) INTO saved FROM gridex_received_sources.sources s WHERE source_message_id=row_id;
  PERFORM pg_temp.ledger_check(c::text||'/'||env||'/capture',saved->>'company_id'=c::text AND saved->>'environment'=env AND saved->>'raw_payload'='original source');
  PERFORM pg_temp.ledger_check(c::text||'/'||env||'/hash',saved->>'payload_hash'=encode(sha256(convert_to('original source','UTF8')),'hex'));
  PERFORM pg_temp.ledger_check(c::text||'/'||env||'/sealed-context',saved->'received_context'=(SELECT execution_context_snapshot->'receivedProdatContext' FROM public.ediel_messages WHERE public.ediel_messages.id=row_id));
  UPDATE public.ediel_messages SET status='parsed' WHERE public.ediel_messages.id=row_id;
  PERFORM pg_temp.ledger_check(c::text||'/'||env||'/retry-unchanged',(SELECT to_jsonb(s)=saved FROM gridex_received_sources.sources s WHERE source_message_id=row_id));
  EXECUTE 'SET LOCAL ROLE service_role'; snap:=public.gridex_received_source_snapshot_v1(c,env,clock_timestamp()); EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ledger_check(c::text||'/'||env||'/snapshot-scope',snap->>'companyId'=c::text AND snap->>'environment'=env
    AND NOT EXISTS(SELECT FROM jsonb_array_elements(snap->'sources') v WHERE v->>'companyId'<>c::text OR v->>'environment'<>env));
  PERFORM pg_temp.ledger_check(c::text||'/'||env||'/snapshot-manifest',EXISTS(SELECT FROM gridex_received_sources.snapshots ss WHERE ss.id=(snap->>'snapshotId')::uuid AND ss.manifest_hash=snap->>'snapshotHash'
    AND ss.manifest_hash=encode(sha256(convert_to(ss.manifest::text,'UTF8')),'hex') AND NOT (ss.manifest->'sources'->0 ? 'rawPayload')));
 END LOOP; END LOOP;
 SELECT source_message_id,payload_hash INTO source_id,source_hash FROM gridex_received_sources.sources WHERE company_id=a AND environment='test' LIMIT 1;
 SELECT to_jsonb(s) INTO saved FROM gridex_received_sources.sources s WHERE source_message_id=source_id;
 UPDATE public.ediel_messages SET company_id=b,environment='production' WHERE public.ediel_messages.id=source_id;
 PERFORM pg_temp.ledger_check('operational-reattribution-not-history',(SELECT to_jsonb(s)=saved FROM gridex_received_sources.sources s WHERE source_message_id=source_id));
 DELETE FROM public.ediel_messages WHERE public.ediel_messages.id=source_id;
 PERFORM pg_temp.ledger_check('operational-delete-retains-history',(SELECT to_jsonb(s)=saved FROM gridex_received_sources.sources s WHERE source_message_id=source_id));
 blocked:=false; BEGIN PERFORM pg_temp.ledger_row(a,'test','replacement','2026-06-20T10:00:00Z','{}','PRODAT','edifact',source_id); EXCEPTION WHEN unique_violation THEN blocked:=true; END;
 PERFORM pg_temp.ledger_check('deleted-source-uuid-cannot-be-reused',blocked AND NOT EXISTS(SELECT FROM public.ediel_messages WHERE public.ediel_messages.id=source_id));
 row_id:=pg_temp.ledger_row(a,'test',null,null);PERFORM pg_temp.ledger_check('null-source-retained',EXISTS(SELECT FROM gridex_received_sources.sources WHERE source_message_id=row_id AND payload_hash IS NULL AND source_received_at IS NULL AND received_context IS NULL));
 row_id:=pg_temp.ledger_row(a,'test','utilts',clock_timestamp(),'{}','UTILTS');PERFORM pg_temp.ledger_check('non-prodat-not-captured',NOT EXISTS(SELECT FROM gridex_received_sources.sources WHERE source_message_id=row_id));
 EXECUTE 'SET LOCAL ROLE service_role'; snap:=public.gridex_received_source_snapshot_v1(a,'test',clock_timestamp()); EXECUTE 'RESET ROLE';
 PERFORM pg_temp.ledger_check('deleted-and-unknown-receipt-discoverable',snap->>'sourceCount'='2');
 inv:=pg_temp.ledger_inventory(snap);
 EXECUTE 'SET LOCAL ROLE service_role'; receipt:=public.gridex_record_source_discovery_v1(a,'test',(snap->>'snapshotId')::uuid,snap->>'snapshotHash','physical-lin-inventory-v1',inv::text); EXECUTE 'RESET ROLE';
 PERFORM pg_temp.ledger_check('discovery-exact-serialized-evidence',receipt->>'inventoryHash'=encode(sha256(convert_to(inv::text,'UTF8')),'hex')
   AND EXISTS(SELECT FROM gridex_received_sources.discovery_attempts d WHERE d.id=(receipt->>'attemptId')::uuid AND d.inventory_text=inv::text AND d.observation_kind='unapproved_physical_discovery'));
 FOREACH mode IN ARRAY ARRAY['company','environment','snapshot-id','snapshot-hash','engine','source-approval','global-approval','selection','hash','partial-prefix','unknown-source','raw-body'] LOOP
  blocked:=false; altered:=inv;
  IF mode='source-approval' THEN altered:=jsonb_set(inv,'{sources,0,disposition}','"accepted"'); END IF;
  IF mode='global-approval' THEN altered:=jsonb_set(inv,'{authorityStatus}','"approved"'); END IF;
  IF mode='selection' THEN altered:=jsonb_set(inv,'{selection}','"selected"'); END IF;
  IF mode='hash' THEN altered:=jsonb_set(inv,'{sources,0,sourcePayloadHash}',to_jsonb(repeat('a',64))); END IF;
  IF mode='partial-prefix' THEN altered:=jsonb_set(inv,'{sources}',jsonb_build_array(inv->'sources'->0)); END IF;
  IF mode='unknown-source' THEN altered:=jsonb_set(inv,'{sources,0,sourceMessageId}',to_jsonb(gen_random_uuid())); END IF;
  IF mode='raw-body' THEN altered:=inv||'{"rawPayload":"must_not_be_stored"}'::jsonb; END IF;
  BEGIN
   EXECUTE 'SET LOCAL ROLE service_role';
   PERFORM public.gridex_record_source_discovery_v1(CASE WHEN mode='company' THEN b ELSE a END,CASE WHEN mode='environment' THEN 'production' ELSE 'test' END,
    CASE WHEN mode='snapshot-id' THEN gen_random_uuid() ELSE (snap->>'snapshotId')::uuid END,CASE WHEN mode='snapshot-hash' THEN repeat('0',64) ELSE snap->>'snapshotHash' END,
    CASE WHEN mode='engine' THEN 'untrusted' ELSE 'physical-lin-inventory-v1' END,altered::text);
   EXECUTE 'RESET ROLE';
  EXCEPTION WHEN check_violation THEN blocked:=true; END;
  PERFORM pg_temp.ledger_check('discovery-rejects-'||mode,blocked);
 END LOOP;
 EXECUTE 'SET LOCAL ROLE service_role'; first_assessment:=public.gridex_record_source_validation_v1(a,'test',source_id,source_hash,pg_temp.ledger_facts()::text);
 second_assessment:=public.gridex_record_source_validation_v1(a,'test',source_id,source_hash,pg_temp.ledger_facts('accepted')::text); EXECUTE 'RESET ROLE';
 PERFORM pg_temp.ledger_check('assessment-hash-bound',first_assessment->>'factsHash'=encode(sha256(convert_to(pg_temp.ledger_facts()::text,'UTF8')),'hex'));
 PERFORM pg_temp.ledger_check('assessment-is-not-source-approval',second_assessment->>'sourceDisposition'='not_established');
 PERFORM pg_temp.ledger_check('correction-appends-linked-history',EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.id=(second_assessment->>'assessmentId')::uuid
    AND v.previous_assessment_id=(first_assessment->>'assessmentId')::uuid) AND EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.id=(first_assessment->>'assessmentId')::uuid AND v.facts_text=pg_temp.ledger_facts()::text));
 FOREACH mode IN ARRAY ARRAY['company','environment','hash','approval','object','party','reason','rule-version','accepted-without-rule-version'] LOOP
  altered:=pg_temp.ledger_facts();blocked:=false;
  IF mode='approval' THEN altered:=jsonb_set(altered,'{sourceDisposition}','"accepted"'); END IF;
  IF mode='object' THEN altered:=jsonb_set(altered,'{objectDisposition}','"accepted"'); END IF;
  IF mode='party' THEN altered:=jsonb_set(altered,'{partyDisposition}','"accepted"'); END IF;
  IF mode='reason' THEN altered:=jsonb_set(altered,'{reasonCodes}','["private customer details"]'); END IF;
  IF mode='rule-version' THEN altered:=jsonb_set(altered,'{rulePackEvidence}','{"sourceHash":"unknown"}'); END IF;
  IF mode='accepted-without-rule-version' THEN altered:=jsonb_set(altered,'{applicationDecision}','"accepted"'); END IF;
  BEGIN EXECUTE 'SET LOCAL ROLE service_role';
   PERFORM public.gridex_record_source_validation_v1(CASE WHEN mode='company' THEN b ELSE a END,CASE WHEN mode='environment' THEN 'production' ELSE 'test' END,source_id,
    CASE WHEN mode='hash' THEN repeat('0',64) ELSE source_hash END,altered::text); EXECUTE 'RESET ROLE';
  EXCEPTION WHEN check_violation THEN blocked:=true; END;
  PERFORM pg_temp.ledger_check('assessment-rejects-'||mode,blocked);
 END LOOP;
END $$;

-- All evidence kinds are immutable even for the owner; caller roles cannot
-- bypass this by their service-role RLS exemption or table-level TRUNCATE.
DO $$ DECLARE tab text; command text; blocked boolean; rol text; signature text; BEGIN
 FOREACH tab IN ARRAY ARRAY['epoch','sources','snapshots','discovery_attempts','validation_assessments'] LOOP
  FOREACH command IN ARRAY ARRAY['UPDATE','DELETE','TRUNCATE'] LOOP
   blocked:=false; BEGIN
    IF command='UPDATE' THEN EXECUTE format('UPDATE gridex_received_sources.%I SET %I=%I',tab,CASE WHEN tab='epoch' THEN 'singleton' WHEN tab='sources' THEN 'source_message_id' ELSE 'id' END,CASE WHEN tab='epoch' THEN 'singleton' WHEN tab='sources' THEN 'source_message_id' ELSE 'id' END);
    ELSE EXECUTE format('%s %s gridex_received_sources.%I%s',command,CASE WHEN command='DELETE' THEN 'FROM' ELSE 'TABLE' END,tab,CASE WHEN command='TRUNCATE' THEN ' CASCADE' ELSE '' END); END IF;
   EXCEPTION WHEN check_violation THEN blocked:=true; END;
   PERFORM pg_temp.ledger_check(tab||'/'||command||'/immutable',blocked);
  END LOOP;
  FOREACH rol IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   PERFORM pg_temp.ledger_check(tab||'/'||rol||'/no-direct-write',NOT has_table_privilege(rol,'gridex_received_sources.'||tab,'INSERT,UPDATE,DELETE,TRUNCATE'));
  END LOOP;
  PERFORM pg_temp.ledger_check(tab||'/force-rls',EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gridex_received_sources' AND c.relname=tab AND c.relrowsecurity AND c.relforcerowsecurity));
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['public.gridex_received_source_snapshot_v1(uuid,text,timestamptz)',
  'public.gridex_record_source_discovery_v1(uuid,text,uuid,text,text,text)','public.gridex_record_source_validation_v1(uuid,text,uuid,text,text)'] LOOP
  PERFORM pg_temp.ledger_check(signature||'/service-only-invoker',NOT has_function_privilege('anon',signature,'EXECUTE') AND NOT has_function_privilege('authenticated',signature,'EXECUTE')
    AND has_function_privilege('service_role',signature,'EXECUTE') AND NOT (SELECT prosecdef FROM pg_proc WHERE oid=signature::regprocedure));
 END LOOP;
 PERFORM pg_temp.ledger_check('private-capture-not-callable',NOT has_function_privilege('service_role','gridex_received_sources.capture_insert()','EXECUTE'));
 PERFORM pg_temp.ledger_check('definers-private-fixed-path',NOT EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_received_sources' AND p.prosecdef AND NOT p.proconfig @> ARRAY['search_path=pg_catalog']));
END $$;

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
 VALUES('00000000-0000-4000-8000-00000000e010','authenticated','authenticated','e035-tenant-reader@example.invalid',now(),'{}','{}',now(),now(),false,false);
INSERT INTO public.user_profiles(id,email,full_name,user_status,created_at,updated_at)
 VALUES('00000000-0000-4000-8000-00000000e010','e035-tenant-reader@example.invalid','Rollback ledger reader','active',now(),now())
 ON CONFLICT(id) DO UPDATE SET user_status='active';
INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
 VALUES('00000000-0000-4000-8000-00000000e001','00000000-0000-4000-8000-00000000e010','member','active',now(),'{}','member',true,now(),'member');
DO $$ DECLARE tab text; visible bigint; foreign_rows bigint; blocked boolean; BEGIN
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e010',true);
 RAISE NOTICE 'E035_HUMAN_PROBE starting; version=%',version();
 FOREACH tab IN ARRAY ARRAY['sources','snapshots','discovery_attempts','validation_assessments'] LOOP
  RAISE NOTICE 'E035_HUMAN_PROBE own-scope table=%',tab;
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('SELECT count(*) FROM gridex_received_sources.%I WHERE company_id=%L',tab,'00000000-0000-4000-8000-00000000e001') INTO visible;
  RAISE NOTICE 'E035_HUMAN_PROBE own-read returned; foreign-scope table=%',tab;
  EXECUTE format('SELECT count(*) FROM gridex_received_sources.%I WHERE company_id=%L',tab,'00000000-0000-4000-8000-00000000e002') INTO foreign_rows;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ledger_check(tab||'/human-own-company-readable',visible>0);
  PERFORM pg_temp.ledger_check(tab||'/human-other-company-hidden',foreign_rows=0);
 END LOOP;
 blocked:=false;BEGIN EXECUTE 'SET LOCAL ROLE authenticated';PERFORM public.gridex_received_source_snapshot_v1('00000000-0000-4000-8000-00000000e001','test',clock_timestamp());EXECUTE 'RESET ROLE';EXCEPTION WHEN insufficient_privilege THEN blocked:=true;END;
 PERFORM pg_temp.ledger_check('human-cannot-create-service-evidence',blocked);
 RAISE NOTICE 'E035_HUMAN_PROBE disabling synthetic user';
 UPDATE public.user_profiles SET user_status='disabled' WHERE id='00000000-0000-4000-8000-00000000e010';
 EXECUTE 'SET LOCAL ROLE authenticated';SELECT count(*) INTO visible FROM gridex_received_sources.sources;EXECUTE 'RESET ROLE';
 PERFORM pg_temp.ledger_check('disabled-human-cannot-read-history',visible=0);
END $$;
TABLE source_ledger_results;
DO $$ DECLARE failed text; BEGIN SELECT string_agg(name,', ' ORDER BY name) INTO failed FROM source_ledger_results WHERE NOT passed;
 IF failed IS NOT NULL THEN RAISE EXCEPTION 'source_ledger_regression_failed: %',failed; END IF;
 RAISE NOTICE 'E035 source ledger SQL: % checks PASS', (SELECT count(*) FROM source_ledger_results);
END $$;
ROLLBACK;
