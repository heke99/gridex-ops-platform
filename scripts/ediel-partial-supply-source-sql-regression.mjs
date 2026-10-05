// Focused mechanical PostgreSQL source/atomicity/time/replay checks. Current
// legal/rule admission and legacy activation effects are declared fixtures;
// this is not native replay, authentic issuer or formal acceptance evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
function fn(file,name){const text=readFileSync(new URL(file,import.meta.url),'utf8'),a=[text.indexOf(`CREATE FUNCTION ${name}`),text.indexOf(`CREATE OR REPLACE FUNCTION ${name}`)].filter(x=>x>=0).sort((x,y)=>x-y)[0],b=text.indexOf('$$;',a);if(a<0||b<0)throw Error(name);return text.slice(a,b+3)}
const raw=(code,objects,sender='54321',receiver='12345')=>["UNB+UNOC:3+54321:14+12345:14+261001:1200+I++23-DDQ-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A",`BGM+${code}+DOC+9`,`NAD+FR+${sender}:160:SVK`,`NAD+DO+${receiver}:160:SVK`,...objects.flatMap((own,i)=>[`LIN+${i+1}++${own.point}:::${own.agency??'9'}`,"CCI++Z13",`CAV+${own.reason??'Z22'}`,`RFF+LI:${own.li}`,"RFF+Z05:TES",`NAD+UD+${own.customer}:SE1:260`,`DTM+92:${own.start}:203`]),"UNT+20+M","UNZ+1+I"].join("'")+"'"
const q=s=>`'${String(s).replaceAll("'","''")}'`
const run=async(source=id(30),actor=id(2),company=id(1))=>{await db.exec('SET ROLE service_role');try{return await db.query('SELECT public.ediel_apply_supply_source_v1($1,$2,$3) b',[company,source,actor])}finally{await db.exec('RESET ROLE')}}
const activate=(source=id(30),actor=id(2),date=null)=>db.query('SELECT * FROM public.activate_customer_supply_v1($1,$2,$3,$4,$5,NULL)',[id(1),id(10),source,date,actor])
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_inbound_context;CREATE SCHEMA gridex_ediel_source_rules;CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_outbound_dispatch;
 CREATE TABLE companies(id uuid PRIMARY KEY);CREATE TABLE user_profiles(id uuid PRIMARY KEY,user_status text);CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 CREATE TABLE customers(id uuid PRIMARY KEY,company_id uuid,org_number text,personal_number text);
 CREATE TABLE customer_sites(id uuid PRIMARY KEY,company_id uuid,customer_id uuid);
 CREATE TABLE metering_points(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,ediel_metering_point_id text,grid_owner_ediel_id text,grid_area_code text);
 CREATE TABLE customer_contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,status text,contract_version text,signed_version text,signed_at timestamptz,version_snapshot jsonb);
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text,status text,message_sent_at timestamptz,message_received_at timestamptz,immutable_rendered_at timestamptz,immutable_payload_hash text,customer_id uuid,metering_point_id uuid);
 CREATE TABLE supplier_switch_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,site_id uuid,customer_site_id uuid,contract_id uuid,customer_contract_id uuid,outbound_z03_message_id uuid,inbound_z04_message_id uuid,rff_li_reference text,status text,lifecycle_blocked bool,confirmed_start_date date,updated_at timestamptz,updated_by uuid);
 CREATE TABLE customer_supply_periods(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,contract_id uuid,customer_contract_id uuid,start_date date,actual_start_date date,end_date date,market_start_at timestamptz,market_end_at timestamptz,source text,source_process text,source_message_id uuid,source_end_message_id uuid,source_switch_request_id uuid,status text,market_state_version bigint,metadata jsonb,updated_at timestamptz DEFAULT now());
 CREATE TABLE gridex_received_sources.supply_source_transitions(source_message_id uuid PRIMARY KEY,company_id uuid,payload_hash text,source_code text,source_objects jsonb,previous_states jsonb,resulting_states jsonb,qualified_switch_ids uuid[],actor_user_id uuid);
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,previous_assessment_id uuid);
 CREATE TABLE gridex_received_sources.regulated_supply_ground_versions(id uuid,company_id uuid,legal_actor_id uuid);
 CREATE TABLE legal_context_fixture(message_id uuid PRIMARY KEY,basis jsonb);
 CREATE TABLE tenant_ediel_profiles(id uuid PRIMARY KEY,company_id uuid,environment text,market text,is_enabled bool,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE tenant_actor_roles(id uuid PRIMARY KEY,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE tenant_actor_identifiers(id uuid PRIMARY KEY,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 CREATE FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE b jsonb;BEGIN SELECT basis INTO b FROM public.legal_context_fixture WHERE message_id=$2;IF b IS NULL THEN RAISE EXCEPTION 'captured_legal_fixture_unavailable';END IF;RETURN b;END$$;
 CREATE TABLE gridex_ediel_transport.attempts(id uuid PRIMARY KEY,message_id uuid,company_id uuid,environment text,binding jsonb,classification text,provider_result jsonb,entered_at timestamptz,observed_at timestamptz);
 CREATE TABLE gridex_outbound_dispatch.attempts(id uuid,message_id uuid,company_id uuid,environment text,binding jsonb);
 CREATE TABLE gridex_outbound_dispatch.originals(message_id uuid,company_id uuid,environment text,payload_hash text,raw_payload text);
 CREATE TABLE gridex_outbound_dispatch.events(attempt_id uuid,company_id uuid,environment text,message_id uuid,kind text,facts jsonb,observed_at timestamptz);
 CREATE FUNCTION gridex_ediel_source_rules.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
 CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"applied":false,"reason":"preserved_other_source"}'::jsonb$$;
 CREATE FUNCTION public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer DEFAULT 100) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"updated":0}'::jsonb$$;
 CREATE FUNCTION gridex_received_sources.billing_supply_basis_v1(uuid,uuid,timestamptz,timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
 CREATE FUNCTION gridex_received_sources.object_owner_proof_consistent(jsonb,jsonb,timestamptz) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION public.activate_customer_supply_v1(uuid,uuid,uuid,date DEFAULT NULL,uuid DEFAULT NULL,text DEFAULT NULL) RETURNS TABLE(supplier_switch_request_id uuid,supply_period_id uuid,contract_id uuid,customer_application_id uuid,workflow_id uuid,domain_event_id uuid,notification_job_id uuid) LANGUAGE plpgsql AS $$DECLARE p public.customer_supply_periods%rowtype;BEGIN SELECT * INTO STRICT p FROM public.customer_supply_periods WHERE company_id=$1 AND source_switch_request_id=$2 FOR UPDATE;UPDATE public.customer_supply_periods SET status='active',actual_start_date=$4,updated_at=now(),metadata=metadata||jsonb_build_object('activationKey',$6) WHERE id=p.id;UPDATE public.supplier_switch_requests SET status='completed' WHERE id=$2;RETURN QUERY SELECT $2,p.id,p.contract_id,NULL::uuid,NULL::uuid,NULL::uuid,NULL::uuid;END$$;`)
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.permission_transition_immutable_v1','gridex_received_sources.permission_time_v1','gridex_received_sources.permission_date_v1'])await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',name))
 await db.exec(fn('../supabase/migrations/20260930161624_ediel_supply_market_source_lifecycle.sql','gridex_received_sources.supply_wire_v1'))
 await db.exec(fn('../supabase/migrations/20260930174333_ediel_production_contract_source_commands.sql','gridex_received_sources.production_contract_hash_v1'))
 await db.exec(fn('../supabase/migrations/20260930204937_ediel_shared_accepted_source_basis.sql','gridex_ediel_transport.accepted_source_basis_v1'));

 await db.exec(`ALTER TABLE company_memberships ADD COLUMN id uuid DEFAULT gen_random_uuid();ALTER TABLE supplier_switch_requests ADD COLUMN completed_at timestamptz;
 ALTER TABLE metering_points ADD COLUMN product_direction text;ALTER TABLE customer_contracts ADD COLUMN energy_direction text;
 ALTER TABLE gridex_received_sources.regulated_supply_ground_versions ADD COLUMN environment text,ADD COLUMN dso_actor_id uuid,ADD COLUMN grid_area_code text,ADD COLUMN process text,ADD COLUMN bilateral_agreement_id uuid,ADD COLUMN consumption_supply_period_id uuid,ADD COLUMN source_reference text,ADD COLUMN source_sha256 text,ADD COLUMN legal_decision_reference text,ADD COLUMN registry_version text,ADD COLUMN approved_at timestamptz,ADD COLUMN valid_from timestamptz,ADD COLUMN valid_to timestamptz,ADD COLUMN revoked_at timestamptz;
 CREATE TABLE platform_actor_identifiers(id uuid PRIMARY KEY,actor_id uuid,identifier_type text,identifier_value text,is_verified boolean,valid_from date,valid_to date);
 CREATE TABLE tenant_bilateral_agreements(id uuid PRIMARY KEY,company_id uuid,environment text,counterparty_actor_id uuid,is_enabled boolean,source_reference text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid,company_id uuid,environment text,payload_hash text);
 CREATE TABLE gridex_received_sources.object_assessments(id uuid,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,previous_assessment_id uuid);
 ALTER TABLE gridex_received_sources.validation_assessments ADD COLUMN owner text DEFAULT 'canonical-runtime-with-registry-v1',ADD COLUMN facts_hash text;
 CREATE TABLE gridex_received_sources.prodat_application_facets(assessment_id uuid,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,application_facts_text text,application_facts_hash text);
 CREATE TABLE gridex_received_sources.prodat_response_facets(assessment_id uuid,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,response_facts_text text,response_facts_hash text);
 CREATE FUNCTION gridex_received_sources.require_prodat_application_objects_v1(c uuid,source_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE f jsonb;BEGIN SELECT application_facts_text::jsonb||jsonb_build_object('assessmentId',assessment_id) INTO f FROM gridex_received_sources.prodat_application_facets WHERE company_id=c AND source_message_id=source_id;IF f IS NULL THEN RAISE EXCEPTION 'declared_full_application_fixture_required';END IF;RETURN f;END$$;
 CREATE FUNCTION gridex_received_sources.prodat_application_object_accepted_v1(c uuid,source_id uuid,canonical_id uuid,scope jsonb) RETURNS boolean LANGUAGE plpgsql AS $$DECLARE f jsonb:=gridex_received_sources.require_prodat_application_objects_v1(c,source_id);BEGIN RETURN f->>'assessmentId'=canonical_id::text AND f->>'headerDecision'='accepted' AND EXISTS(SELECT FROM jsonb_array_elements(f->'objects')o WHERE o->>'applicationDecision'='accepted' AND o-'applicationDecision'-'reasonCodes'=scope);END$$;
 CREATE FUNCTION gridex_received_sources.validate_prodat_application_v1(text,jsonb,jsonb,jsonb) RETURNS boolean LANGUAGE SQL AS $$SELECT $2->>'functionalDecision'='accepted' AND $3->>'headerDecision'='accepted'$$;
 DROP FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid);`);
 await db.exec(fn('../supabase/migrations/20260930161624_ediel_supply_market_source_lifecycle.sql','public.ediel_apply_supply_source_v1'));
 await db.exec(`ALTER FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) SET SCHEMA gridex_received_sources;ALTER FUNCTION gridex_received_sources.ediel_apply_supply_source_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_legal_context_v1;CREATE FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) RETURNS jsonb LANGUAGE SQL AS $$SELECT gridex_received_sources.apply_supply_before_legal_context_v1($1,$2,$3)$$;`);
 await db.exec(`DROP FUNCTION gridex_received_sources.billing_supply_basis_v1(uuid,uuid,timestamptz,timestamptz);`);await db.exec(fn('../supabase/migrations/20260930181909_ediel_source_consumer_authority_bridges.sql','gridex_received_sources.billing_supply_basis_v1'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930201111_ediel_normal_switch_source_atomic_confirmation.sql',import.meta.url),'utf8'));checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930211830_ediel_supply_source_initial_scope_continuity.sql',import.meta.url),'utf8'));checks++
 await db.exec(fn('../supabase/migrations/20260930204728_ediel_native_intent_and_source_request_guards.sql','gridex_received_sources.apply_supply_before_legal_context_v1'));checks++;
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001043234_ediel_prodat_supply_own_effect_partition.sql',import.meta.url),'utf8'));checks++;
 await db.exec(`INSERT INTO companies VALUES('${id(1)}');INSERT INTO user_profiles VALUES('${id(2)}','active');INSERT INTO company_memberships VALUES('${id(1)}','${id(2)}','active',true,now());INSERT INTO tenant_ediel_profiles VALUES('${id(70)}','${id(1)}','test','electricity',true,'2000-01-01',NULL);INSERT INTO tenant_actor_roles VALUES('${id(71)}','${id(1)}','test','${id(50)}','electricity_supplier','2000-01-01',NULL);INSERT INTO tenant_actor_identifiers VALUES('${id(72)}','${id(1)}','test','${id(50)}','EdielId','12345','2000-01-01',NULL);`)

 const objects=[{point:'735123456789012345',li:'A',customer:'CA',start:'202601010000'},{point:'735123456789012352',li:'B',customer:'CB',start:'202601010000'},{point:'735123456789012369',li:'C',customer:'CC',start:'202601010000'},{point:'735123456789012376',li:'D',customer:'CD',start:'202601010000'}];
 for(const[index,o]of objects.entries()){
  const n=index*100,original=raw('Z03',[o],'12345','54321');
  await db.exec(`INSERT INTO customers VALUES('${id(3+n)}','${id(1)}',NULL,'${o.customer}');INSERT INTO customer_sites VALUES('${id(4+n)}','${id(1)}','${id(3+n)}');INSERT INTO metering_points VALUES('${id(5+n)}','${id(1)}','${id(3+n)}','${id(4+n)}','${o.point}','54321','TES',NULL);INSERT INTO customer_contracts VALUES('${id(6+n)}','${id(1)}','${id(3+n)}','${id(5+n)}','signed','1','1','2025-12-01','{}',NULL);`);
  await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_sent_at,immutable_rendered_at,immutable_payload_hash,customer_id,metering_point_id) VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03',$3,'acknowledged','2025-12-15','2025-12-15',encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5)",[id(20+n),id(1),original,id(3+n),id(5+n)]);
  await db.query("INSERT INTO gridex_ediel_transport.attempts VALUES($1,$2,$3,'test',jsonb_build_object('originalHash',encode(sha256(convert_to($4,'UTF8')),'hex'),'to','dso@example.invalid'),'accepted','{\"accepted\":[\"dso@example.invalid\"],\"rejected\":[]}',now(),now())",[id(80+n),id(20+n),id(1),original]);
  await db.exec(`INSERT INTO supplier_switch_requests VALUES('${id(10+n)}','${id(1)}','${id(3+n)}','${id(5+n)}','${id(4+n)}',NULL,'${id(6+n)}',NULL,'${id(20+n)}',NULL,'${o.li}','sent',false,NULL,now(),NULL)`);
 }
 await db.exec(`UPDATE supplier_switch_requests SET status='completed' WHERE id='${id(210)}'`);
 const incoming=raw('Z04',objects),tokens=(await db.query('SELECT gridex_received_sources.closure_wire_tokens_v2($1) t',[incoming])).rows[0].t;
 const scopes=tokens.filter(t=>t.tag==='LIN').map(t=>({messageIndex:0,messageReference:'M',objectId:t.elements[3][0],identityAgency:t.elements[3][3],registers:[{segmentIndex:t.index,lineIndex:Number(t.elements[1][0])-1,lineNumber:t.elements[1][0],registerIndex:null,registerPosition:1}]}));
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_received_at,customer_id,metering_point_id) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z04',$3,'received','2025-12-16',$4,$5)",[id(30),id(1),incoming,id(3),id(5)]);
 await db.query('INSERT INTO legal_context_fixture VALUES($1,$2)',[id(30),{companyId:id(1),family:'PRODAT',code:'Z04',actorRole:'electricity_supplier',legalActorId:id(50),legalEdielId:'12345'}]);
 const facts={syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'accepted',registerValidation:{owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:scopes.map(scope=>({...scope,disposition:'accepted',reasons:[]}))}};
 const app={headerDecision:'accepted',objects:scopes.map((scope,index)=>({...scope,applicationDecision:index===1?'rejected':'accepted',reasonCodes:index===1?['DECLARED_NATIONAL_BAD']:[]}))};
 await db.query("INSERT INTO gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text,previous_assessment_id,facts_hash) VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,NULL,encode(sha256(convert_to($5,'UTF8')),'hex'))",[id(40),id(30),id(1),incoming,JSON.stringify(facts)]);
 await db.query("INSERT INTO gridex_received_sources.prodat_application_facets VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[id(40),id(30),id(1),incoming,JSON.stringify(app)]);await db.query("INSERT INTO gridex_received_sources.prodat_response_facets VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),'{}',encode(sha256(convert_to('{}','UTF8')),'hex'))",[id(40),id(30),id(1),incoming]);
 await db.exec('BEGIN');
 const result=(await run()).rows[0].b;assert.equal(result.applied,true);assert.equal(result.periods.length,2);checks++;
 assert.deepEqual(result.partition.map(p=>p.disposition),['applied','held','held','applied']);checks++;
 assert.equal(result.partition[1].reason,'own_application_not_accepted');assert.equal(result.partition[2].reason,'normal_z04_locked_original_scope_required');checks++;
assert.equal((await db.query('SELECT gridex_received_sources.committed_supply_effects_v1($1,$2) b',[id(1),id(30)])).rows[0].b.length,0);checks++;
 await db.exec('COMMIT');
 const committed=(await db.query('SELECT gridex_received_sources.committed_supply_effects_v1($1,$2) b',[id(1),id(30)])).rows[0].b;assert.equal(committed.length,2);assert.deepEqual(committed.map(e=>e.objectScope),[scopes[0],scopes[3]]);checks++;
 await assert.rejects(db.query('SELECT gridex_received_sources.committed_supply_effects_v1($1,$2,$3) b',[id(1),id(30),[scopes[1].registers[0].segmentIndex]]),/uncommitted/);checks++;
 assert.equal((await db.query('SELECT raw_payload FROM ediel_messages WHERE id=$1',[id(30)])).rows[0].raw_payload,incoming);checks++;
 assert.equal((await db.query('SELECT count(*)::int n FROM customer_supply_periods')).rows[0].n,2);checks++;
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.normal_switch_confirmations')).rows[0].n,2);checks++;
 assert.equal((await run()).rows[0].b.idempotent,true);checks++;

 const firstPeriod=result.periods.find(p=>p.customer_id===id(3));
 assert.equal((await db.query('SELECT gridex_received_sources.supply_period_source_basis_v1($1,$2,$3,$4) b',[id(1),firstPeriod.id,'2026-01-01T00:00Z','2026-02-01T00:00Z'])).rows[0].b.qualified,true);checks++;
 async function incomingSource(source,assessment,code,items,rejectedIndices=[],functional='accepted'){
  const payload=raw(code,items).replaceAll('DTM+92:',code==='Z05'?'DTM+93:':'DTM+92:');
  const decoded=(await db.query('SELECT gridex_received_sources.closure_wire_tokens_v2($1) t',[payload])).rows[0].t;
  const scopes=decoded.filter(t=>t.tag==='LIN').map(t=>({messageIndex:0,messageReference:'M',objectId:t.elements[3][0],identityAgency:t.elements[3][3],registers:[{segmentIndex:t.index,lineIndex:Number(t.elements[1][0])-1,lineNumber:t.elements[1][0],registerIndex:null,registerPosition:1}]}));
  await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_received_at,customer_id,metering_point_id) VALUES($1,$2,'test','inbound','edifact','PRODAT',$3,$4,'received','2026-01-02',$5,$6)",[source,id(1),code,payload,items.length>1?id(303):null,items.length>1?id(305):null]);
  await db.query('INSERT INTO legal_context_fixture VALUES($1,$2)',[source,{companyId:id(1),family:'PRODAT',code,actorRole:'electricity_supplier',legalActorId:id(50),legalEdielId:'12345'}]);
  const facts={syntaxDecision:'accepted',applicationDecision:rejectedIndices.length?'rejected':'accepted',functionalDecision:functional,registerValidation:{owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:scopes.map(scope=>({...scope,disposition:'accepted',reasons:[]}))}},app={headerDecision:'accepted',objects:scopes.map((scope,index)=>({...scope,applicationDecision:rejectedIndices.includes(index)?'rejected':'accepted',reasonCodes:rejectedIndices.includes(index)?['DECLARED_NATIONAL_BAD']:[]}))};
  await db.query("INSERT INTO gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text,previous_assessment_id,facts_hash) VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,NULL,encode(sha256(convert_to($5,'UTF8')),'hex'))",[assessment,source,id(1),payload,JSON.stringify(facts)]);
  await db.query("INSERT INTO gridex_received_sources.prodat_application_facets VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[assessment,source,id(1),payload,JSON.stringify(app)]);await db.query("INSERT INTO gridex_received_sources.prodat_response_facets VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),'{}',encode(sha256(convert_to('{}','UTF8')),'hex'))",[assessment,source,id(1),payload]);return{scopes,payload};
 }
 const ending=objects.filter((_,index)=>[0,3].includes(index)).map(o=>({...o,start:'202701010000'}));
 await incomingSource(id(31),id(41),'Z05',ending,[1]);
 const ended=(await run(id(31))).rows[0].b;assert.equal(ended.applied,true);assert.equal(ended.periods.length,1);assert.equal(ended.periods[0].id,firstPeriod.id);assert.equal(ended.periods[0].status,'ending');checks++;
 assert.equal((await db.query('SELECT gridex_received_sources.committed_supply_effects_v1($1,$2) b',[id(1),id(31)])).rows[0].b.length,1);checks++;
 const followupModule=process.env.EDIEL_SUPPLY_END_FOLLOWUP_MODULE?await import(pathToFileURL(process.env.EDIEL_SUPPLY_END_FOLLOWUP_MODULE).href):null;
 if(followupModule)await followupModule.default({phase:'birth',db,id,sourceId:id(31),ended,initialSourceId:id(30),run,incomingSource,objects});
 assert.equal((await db.query('SELECT gridex_received_sources.supply_period_source_basis_v1($1,$2,$3,$4) b',[id(1),firstPeriod.id,'2026-01-01T00:00Z','2026-02-01T00:00Z'])).rows[0].b.currentSourceMessageId,id(31));checks++;
 await incomingSource(id(32),id(42),'Z04',[objects[1]],[],'manual_review');
 const heldFunction=(await run(id(32))).rows[0].b;assert.equal(heldFunction.applied,false);assert.equal(heldFunction.reason,'supply_complete_own_application_and_function_required');checks++;
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.supply_object_effect_receipts WHERE source_message_id=$1',[id(32)])).rows[0].n,0);checks++;
 await incomingSource(id(33),id(43),'Z04',[{...objects[1],reason:'Z26'}]);
 const missingGround=(await run(id(33))).rows[0].b;assert.equal(missingGround.applied,false);assert.ok(missingGround.partition[0].reason.startsWith('regulated_supply_'));checks++;
 await db.exec(`INSERT INTO platform_actor_identifiers VALUES('${id(901)}','${id(902)}','EdielId','54321',true,'2000-01-01',NULL);
 INSERT INTO tenant_bilateral_agreements VALUES('${id(903)}','${id(1)}','test','${id(902)}',true,'DECLARED SYNTHETIC SOURCE','2000-01-01',NULL);
 INSERT INTO gridex_received_sources.regulated_supply_ground_versions(id,company_id,legal_actor_id,environment,dso_actor_id,grid_area_code,process,bilateral_agreement_id,source_reference,source_sha256,legal_decision_reference,registry_version,approved_at,valid_from,valid_to) VALUES('${id(904)}','${id(1)}','${id(50)}','test','${id(902)}','TES','assigned_supply','${id(903)}','DECLARED SYNTHETIC SOURCE',repeat('a',64),'DECLARED SYNTHETIC DECISION','DECLARED SYNTHETIC VERSION','2025-01-01','2000-01-01','2100-01-01');`);
 const regulated=(await run(id(33))).rows[0].b;assert.equal(regulated.applied,true);assert.equal(regulated.periods.length,1);assert.equal(regulated.periods[0].source_process,'assigned_supply');checks++;
 assert.equal((await db.query('SELECT gridex_received_sources.committed_supply_effects_v1($1,$2) b',[id(1),id(33)])).rows[0].b.length,1);checks++;
 await db.exec(`CREATE FUNCTION public.fail_effect_fixture() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'declared_last_effect_failure';END$$;CREATE TRIGGER fail_last_effect BEFORE INSERT ON gridex_received_sources.supply_object_partitions FOR EACH ROW EXECUTE FUNCTION public.fail_effect_fixture();`);
 await incomingSource(id(34),id(44),'Z04',[{...objects[2],reason:'Z26'}]);
 await assert.rejects(run(id(34)),/declared_last_effect_failure/);checks++;
 assert.equal((await db.query('SELECT count(*)::int n FROM customer_supply_periods WHERE source_message_id=$1',[id(34)])).rows[0].n,0);checks++;
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.supply_object_effect_receipts WHERE source_message_id=$1',[id(34)])).rows[0].n,0);checks++;
 await db.exec('DROP TRIGGER fail_last_effect ON gridex_received_sources.supply_object_partitions');
 const wrongTenant=(await run(id(30),id(2),id(99))).rows[0].b;assert.equal(wrongTenant.applied,false);checks++;
 await incomingSource(id(35),id(45),'Z05',[{...objects[0],reason:'Z24',start:'202701010000'}]);
 const restored=(await run(id(35))).rows[0].b;assert.equal(restored.applied,true);assert.equal(restored.periods[0].id,firstPeriod.id);assert.equal(restored.periods[0].source_end_message_id,null);checks++;
 assert.equal((await db.query('SELECT gridex_received_sources.committed_supply_effects_v1($1,$2) b',[id(1),id(35)])).rows[0].b.length,1);checks++;
 const future={...objects[2],li:'C-future',start:'202701010000'},futureOriginal=raw('Z03',[future],'12345','54321');
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_sent_at,immutable_rendered_at,immutable_payload_hash,customer_id,metering_point_id) VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03',$3,'acknowledged','2025-12-15','2025-12-15',encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5)",[id(420),id(1),futureOriginal,id(203),id(205)]);
 await db.query("INSERT INTO gridex_ediel_transport.attempts VALUES($1,$2,$3,'test',jsonb_build_object('originalHash',encode(sha256(convert_to($4,'UTF8')),'hex'),'to','dso@example.invalid'),'accepted','{\"accepted\":[\"dso@example.invalid\"],\"rejected\":[]}',now(),now())",[id(480),id(420),id(1),futureOriginal]);
 await db.exec(`INSERT INTO supplier_switch_requests(id,company_id,customer_id,metering_point_id,site_id,contract_id,outbound_z03_message_id,rff_li_reference,status,lifecycle_blocked) VALUES('${id(410)}','${id(1)}','${id(203)}','${id(205)}','${id(204)}','${id(206)}','${id(420)}','C-future','sent',false)`);
 await incomingSource(id(36),id(46),'Z04',[future]);const futureConfirmed=(await run(id(36))).rows[0].b;assert.equal(futureConfirmed.applied,true);checks++;
 await incomingSource(id(37),id(47),'Z04',[{...future,reason:'Z24'},{...objects[3],reason:'Z24'}],[1]);
 const withdrawn=(await run(id(37))).rows[0].b;assert.equal(withdrawn.applied,true);assert.equal(withdrawn.periods[0].status,'cancelled');assert.equal(withdrawn.partition[1].disposition,'held');checks++;
 assert.equal((await db.query('SELECT gridex_received_sources.committed_supply_effects_v1($1,$2) b',[id(1),id(37)])).rows[0].b.length,1);checks++;
 const changedCohort=await incomingSource(id(38),id(48),'Z04',[future]);
 const closedCohort=(await db.query('SELECT gridex_received_sources.normal_switch_scope_effect_v1($1,$2,$3,$4,$5,$6) b',[id(1),id(38),id(2),changedCohort.scopes[0],[id(20)],id(48)])).rows[0].b;
 assert.equal(closedCohort.applied,false);assert.equal(closedCohort.reason,'supply_original_cohort_changed');checks++;
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.supply_object_effect_receipts WHERE source_message_id=$1',[id(38)])).rows[0].n,0);checks++;
 await assert.rejects(db.query('SELECT gridex_received_sources.normal_switch_scope_effect_v1($1,$2,$3,$4,$5,$6) b',[id(1),id(38),id(2),changedCohort.scopes[0],[id(420)],id(40)]),/scoped_canonical_assessment_changed/);checks++;
 await incomingSource(id(39),id(49),'Z04',[{...future,reason:'Z24',agency:'89'}]);const wrongNamespace=(await run(id(39))).rows[0].b;assert.equal(wrongNamespace.applied,false);assert.equal(wrongNamespace.partition[0].reason,'z04c_exact_original_unavailable');checks++;
 await incomingSource(id(40),id(51),'Z05',[{...objects[0],start:'202801010000',agency:'89'}]);const wrongEndNamespace=(await run(id(40))).rows[0].b;assert.equal(wrongEndNamespace.applied,false);assert.equal(wrongEndNamespace.partition[0].reason,'z05_accepted_relationship_baseline_required');checks++;
 if(followupModule)await followupModule.default({phase:'finish',db,id,sourceId:id(31),ended,initialSourceId:id(30),run,incomingSource,objects});
 if(process.env.EDIEL_SUPPLY_COMPOSITION_MODULE){const{default:compose}=await import(process.env.EDIEL_SUPPLY_COMPOSITION_MODULE.startsWith('file:')?new URL(process.env.EDIEL_SUPPLY_COMPOSITION_MODULE).href:pathToFileURL(process.env.EDIEL_SUPPLY_COMPOSITION_MODULE).href);await compose({db,id,raw,sourceId:id(30),canonicalAssessmentId:id(40),scopes,objects,result,app,facts,committed})}
 await db.exec(`DELETE FROM legal_context_fixture;UPDATE customer_contracts SET status='cancelled'`);assert.equal((await run()).rows[0].b.idempotent,true);checks++;
 await assert.rejects(db.exec('UPDATE gridex_received_sources.supply_object_partitions SET result=\'{}\''),/immutable/);checks++;
 await assert.rejects(db.exec('DELETE FROM gridex_received_sources.supply_object_effect_receipts'),/immutable/);checks++;
 const acl=(await db.query("SELECT has_table_privilege('service_role','gridex_received_sources.supply_object_effect_receipts','INSERT') mint,has_function_privilege('service_role','gridex_received_sources.normal_switch_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)','EXECUTE') bypass")).rows[0];assert.deepEqual(acl,{mint:false,bypass:false});checks++;
 console.log(`PASS ${checks} focused partial supply actual-native-body mechanics; named application/legal/rule/transport fixtures, not native/original evidence`);
}catch(error){console.error(error.message,error.code,error.where,error.stack?.split('\n').filter(line=>line.includes('ediel-partial-supply')));process.exitCode=1}finally{await db.close()}
