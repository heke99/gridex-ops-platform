// AT-Z04C-SUPPLIER correlation: bounded actual SQL regression of the captured
// Z04/Z24 branch of gridex_received_sources.other_supply_scope_effect_v1.
// The captured owner, its wire parsers, admission, sent-original predicate and
// actual company-permission resolution run in one PGlite database. Tenant rows,
// canonical facets and the provider-acceptance journal are declared synthetic
// ports; the global graph lock is a finite no-op. No native/public-entrypoint,
// ACK, concurrency, RLS or market claim; the owner caller writes transitions.
import {readFileSync} from 'node:fs'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const root=process.env.EDIEL_SQL_REPOSITORY??fileURLToPath(new URL('..',import.meta.url))
// Postimage of 20261010101233_ediel_z05c_current_sender_registry.sql, the
// latest migration redefining this owner; the Z04/Z24 branch is unchanged by it.
const capturedOwner='aab2d2f6dcbfe17e31f92c07a70c9f9346396a2c1435a5976b1d70c8e58cb2b7'
const schema=readFileSync(`${root}/supabase/schema.sql`,'utf8')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE??`${root}/node_modules/@electric-sql/pglite/dist/index.js`).href)
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const hash=v=>createHash('sha256').update(v).digest('hex')
function actual(name){
 const start=schema.indexOf(`CREATE FUNCTION ${name}(`)
 if(start<0)throw Error(`Missing actual captured function ${name}`)
 const tail=schema.slice(start),match=tail.match(/\bAS (\$[A-Za-z_]*\$)/)
 if(!match)throw Error(`Missing dollar body ${name}`)
 const end=tail.indexOf(match[1]+';',match.index+match[0].length)
 if(end<0)throw Error(`Missing end body ${name}`)
 return tail.slice(0,end+match[1].length+1)
}
// Fixed synthetic identities.
const COMPANY=id(1),ACTOR=id(2),FOREIGN_ACTOR=id(3),SUPPLIER='12345',DSO='54321',FOREIGN_DSO='99999'
const CUSTOMER=id(90),POINT_ROW=id(91),DECOY_CUSTOMER=id(92),DECOY_POINT_ROW=id(93)
const P='735123456789012345',DECOY_P='735123456789012346'
const ORIGINAL=id(201),CONFIRMATION=id(202),DECOY_ORIGINAL=id(211),DECOY_CONFIRMATION=id(212)
const SWITCH=id(300),DECOY_SWITCH=id(301),PERIOD=id(400),DECOY_PERIOD=id(401)
const minute=days=>{const d=new Date(Date.now()+days*86400000);return d.toISOString().slice(0,10).replaceAll('-','')+'0000'}
const START=minute(30),PAST_START=minute(-2)
function wire({code='Z04',sender=DSO,receiver=SUPPLIER,point=P,reason='Z24',li='LI-A',customer='CA',start=START}={}){
 const body=[`BGM+${code}+DOC-${code}-${li}+9`,`NAD+FR+${sender}:160:SVK`,`NAD+DO+${receiver}:160:SVK`,`LIN+1++${point}:::9`,'CCI++Z13',`CAV+${reason}`,`RFF+LI:${li}`,'RFF+Z05:TES',`NAD+UD+${customer}:SE1:260`,`DTM+92:${start}:203`]
 return ["UNB+UNOC:3+"+sender+":14+"+receiver+":14+261018:1200+I++23-DDQ-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A",...body,`UNT+${body.length+2}+M`,"UNZ+1+I"].join("'")+"'"
}
const call=(source,cohort=[ORIGINAL],actor=ACTOR)=>db.query('select gridex_received_sources.other_supply_scope_effect_v1($1,$2,$3,$4,$5,$6) v',[COMPANY,source.id,actor,source.scope,cohort,source.canonical]).then(r=>r.rows[0].v)
const effects=()=>db.query(`select jsonb_build_object(
 'periods',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from public.customer_supply_periods p),
 'switches',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb) from public.supplier_switch_requests s),
 'originals',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]'::jsonb) from public.ediel_messages m where direction='outbound'),
 'transitions',(select coalesce(jsonb_agg(to_jsonb(t) order by source_message_id),'[]'::jsonb) from gridex_received_sources.supply_source_transitions t),
 'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from gridex_received_sources.supply_object_effect_receipts r)) state`).then(r=>r.rows[0].state)
const row=(table,key)=>db.query(`select to_jsonb(t) v from ${table} t where id=$1`,[key]).then(r=>r.rows[0]?.v)
let sequence=500
// One genuinely received C per case: own payload hash, own accepted canonical
// assessment and own accepted application object scope from the actual tokens.
async function received(spec={},{direction='inbound',customer=CUSTOMER,point=POINT_ROW}={}){
 const raw=wire(spec),source=id(++sequence),canonical=id(++sequence)
 await db.query("insert into public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_received_at,customer_id,metering_point_id) values($1,$2,'test',$3,'edifact','PRODAT',$4,$5,'received',now(),$6,$7)",[source,COMPANY,direction,spec.code??'Z04',raw,customer,point])
 const tokens=(await db.query('select gridex_received_sources.closure_wire_tokens_v2($1) v',[raw])).rows[0].v,lin=tokens.find(t=>t.tag==='LIN')
 const scope={messageIndex:0,messageReference:'M',objectId:lin.elements[3][0],identityAgency:lin.elements[3][3],registers:[{segmentIndex:lin.index,lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1}]}
 await db.query('insert into gridex_received_sources.validation_assessments values($1,$2,$3,$4,$5,$6,null)',[canonical,source,COMPANY,'test',hash(raw),JSON.stringify({syntaxDecision:'accepted',functionalDecision:'accepted'})])
 await db.query('insert into gridex_received_sources.prodat_application_facets values($1,$2,$3,$4)',[canonical,source,COMPANY,JSON.stringify({headerDecision:'accepted',objects:[{...scope,applicationDecision:'accepted',reasonCodes:[]}]})])
 return {id:source,canonical,scope,raw}
}
async function refused(name,reason,source,options={}){
 const before=await effects(),result=await call(source,options.cohort,options.actor)
 assert.equal(result.applied,false,`${name}: wrong correlation applied a cancellation`)
 assert.equal(result.reason,reason,`${name}: ${JSON.stringify(result)}`)
 assert.deepEqual(await effects(),before,`${name}: refused C mutated business state`)
}
let failures=0,checks=0
const passedChecks=[]
async function check(name,body){await db.exec('begin');try{await body();checks++;passedChecks.push(name);console.log(`PASS ${name}`)}catch(e){failures++;console.error(`FAIL ${name}: ${e.message}`)}finally{await db.exec('rollback')}}
try{
 await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz);
 create table companies(id uuid primary key,status text,is_active bool,legal_name text,org_number text);
 create table user_profiles(id uuid primary key,user_status text);
 create table company_memberships(id uuid default gen_random_uuid(),company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 create table permissions(id uuid primary key default gen_random_uuid(),key text unique,name text,category text,is_active bool);
 create table roles(id uuid primary key,key text,name text,is_active bool);
 create table admin_users(user_id uuid,is_active bool,role text);
 create table user_roles(id uuid primary key default gen_random_uuid(),user_id uuid,company_id uuid,role_id uuid,role text,is_active bool,status text);
 create table role_permissions(id uuid primary key default gen_random_uuid(),role_id uuid,permission_id uuid,permission_key text,effect text);
 create table user_permissions(id uuid primary key default gen_random_uuid(),user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active bool,status text,effect text);
 create table user_permission_overrides(id uuid primary key default gen_random_uuid(),company_id uuid,user_id uuid,permission_key text,effect text,valid_from timestamptz,valid_to timestamptz,is_active bool);
 create table tenant_actor_identifiers(id uuid primary key,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 create table tenant_actor_roles(id uuid primary key,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
 create table tenant_ediel_profiles(id uuid primary key,company_id uuid,environment text,market text,is_enabled bool,valid_from timestamptz,valid_to timestamptz);
 create table platform_actor_identifiers(id uuid primary key,actor_id uuid,identifier_type text,identifier_value text,is_verified bool,valid_from date,valid_to date);
 create table platform_actor_roles(id uuid primary key,actor_id uuid,actor_role text,is_active bool);
 create schema gridex_requested_changes;create schema gridex_received_sources;create schema gridex_ai_processing;create schema gridex_ai_purpose_sources;create schema gridex_ediel_ack_replay;create schema gridex_regulated_supply;create schema gridex_network_registry_sources;create schema gridex_ediel_transport;
 create function gridex_ediel_ack_replay.lock_current_graph_v2() returns void language plpgsql as $$begin null;end$$;
 create function gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamptz) returns boolean language plpgsql as $$begin raise exception 'out_of_scope_regulated_ground_port_called';end$$;
 create function gridex_network_registry_sources.network_for_company_v1(uuid,text,text) returns jsonb language plpgsql as $$begin raise exception 'out_of_scope_z05c_registry_port_called';end$$;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text,status text,message_sent_at timestamptz,message_received_at timestamptz,immutable_rendered_at timestamptz,immutable_payload_hash text,customer_id uuid,metering_point_id uuid);
 create table public.customer_supply_periods(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,contract_id uuid,customer_contract_id uuid,start_date date,actual_start_date date,end_date date,market_start_at timestamptz,market_end_at timestamptz,source text,source_process text,source_message_id uuid,source_end_message_id uuid,source_switch_request_id uuid,status text,market_state_version bigint,metadata jsonb,updated_at timestamptz default now());
 create table public.supplier_switch_requests(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,site_id uuid,customer_site_id uuid,contract_id uuid,customer_contract_id uuid,outbound_z03_message_id uuid,inbound_z04_message_id uuid,rff_li_reference text,status text,lifecycle_blocked bool,confirmed_start_date date,updated_at timestamptz,updated_by uuid,completed_at timestamptz);
 create table public.metering_points(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,ediel_metering_point_id text,grid_owner_ediel_id text,grid_area_code text,product_direction text);
 create table public.customers(id uuid primary key,company_id uuid,org_number text,personal_number text);
 create table gridex_received_sources.supply_source_transitions(source_message_id uuid primary key,company_id uuid,payload_hash text,source_code text,source_objects jsonb,previous_states jsonb,resulting_states jsonb,qualified_switch_ids uuid[],actor_user_id uuid);
 create table gridex_received_sources.validation_assessments(id uuid primary key,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,previous_assessment_id uuid);
 create table gridex_received_sources.prodat_application_facets(assessment_id uuid,source_message_id uuid,company_id uuid,application_facts_text text);
 create table gridex_received_sources.regulated_supply_ground_versions(id uuid,company_id uuid,legal_actor_id uuid);
 create table gridex_received_sources.supply_object_effect_receipts(id uuid,source_message_id uuid,company_id uuid,environment text,payload_hash text,effect_text text,effect_hash text,object_scope jsonb);
 -- Declared provider-acceptance journal port (the real journal is native-only).
 create table gridex_ediel_transport.synthetic_provider_acceptances(message_id uuid primary key);
 create function gridex_ediel_transport.accepted_source_basis_v1(p_message public.ediel_messages) returns jsonb language sql stable as $$select jsonb_build_object('messageId',a.message_id) from gridex_ediel_transport.synthetic_provider_acceptances a where a.message_id=p_message.id$$;
 `)
 for(const name of ['public.gridex_normalize_platform_role','public.gridex_get_user_permissions_in_company','public.gridex_actor_has_company_permission','gridex_requested_changes.scoped_permission_v1','gridex_requested_changes.actor_v1','gridex_requested_changes.receipt_hmac_sha256_v1','gridex_ai_processing.native_profile_v1','gridex_ai_purpose_sources.legal_scope_v1','gridex_received_sources.permission_transition_immutable_v1'])await db.exec(actual(name))
 // Canonical facets are a finite source port, not a canonical-runtime approval.
 await db.exec(`create function gridex_received_sources.require_prodat_application_objects_v1(c uuid,source_id uuid) returns jsonb language plpgsql as $$declare f jsonb;begin select application_facts_text::jsonb||jsonb_build_object('assessmentId',assessment_id) into f from gridex_received_sources.prodat_application_facets where company_id=c and source_message_id=source_id;if f is null then raise exception 'declared_application_fixture_required';end if;return f;end$$;`)
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.supply_wire_v1','gridex_received_sources.normal_switch_wire_v1','gridex_received_sources.permission_date_v1','gridex_received_sources.permission_time_v1','gridex_received_sources.prodat_application_object_accepted_v1','gridex_received_sources.require_supply_scope_admission_v1','gridex_received_sources.supply_wire_for_scope_v1','gridex_received_sources.supply_wire_for_period_receipt_v1','gridex_received_sources.sent_source_is_current_v1','gridex_received_sources.other_supply_scope_effect_v1'])await db.exec(actual(name))
 const installed=hash((await db.query("select prosrc from pg_proc where oid='gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure")).rows[0].prosrc)
 console.log(`CAPTURED prosrc sha256=${installed}`)
 assert.equal(installed,capturedOwner,'z04c_unknown_captured_owner')
 await db.exec(`insert into companies values('${COMPANY}','active',true,'SYNTHETIC LEGAL COMPANY','5590000000');insert into auth.users(id,email_confirmed_at) values('${ACTOR}',now()),('${FOREIGN_ACTOR}',now());insert into user_profiles values('${ACTOR}','active'),('${FOREIGN_ACTOR}','active');
 insert into company_memberships(company_id,user_id,status,is_active,accepted_at) values('${COMPANY}','${ACTOR}','active',true,now());
 insert into tenant_actor_identifiers values('${id(4)}','${COMPANY}','test','${id(5)}','EdielId','${SUPPLIER}','2020-01-01',null);insert into tenant_actor_roles values('${id(6)}','${COMPANY}','test','${id(5)}','electricity_supplier','2020-01-01',null);insert into tenant_ediel_profiles values('${id(7)}','${COMPANY}','test','electricity',true,'2020-01-01',null);`)
 for(const key of ['communication.write','communication.read','customers.read','customers.write','contracts.read','contracts.write','metering.write'])await db.exec(`insert into permissions(key,name,is_active) values('${key}','SYNTHETIC',true) on conflict(key) do nothing`)
 // The foreign actor holds permissions but no membership in this company.
 await db.exec(`insert into user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect) select u.id,'${COMPANY}',p.id,p.key,true,'active','allow' from auth.users u cross join permissions p`)
 // Two sent, provider-accepted own Z03 originals, each with a confirmed future period.
 const original=async(message,spec,customer,point)=>{const raw=wire({code:'Z03',sender:SUPPLIER,receiver:DSO,reason:'Z22',...spec});await db.query("insert into public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_sent_at,immutable_rendered_at,immutable_payload_hash,customer_id,metering_point_id) values($1,$2,'test','outbound','edifact','PRODAT','Z03',$3,'sent',now()-interval '3 days',now()-interval '3 days',$4,$5,$6)",[message,COMPANY,raw,hash(raw),customer,point]);await db.query('insert into gridex_ediel_transport.synthetic_provider_acceptances values($1)',[message])}
 await original(ORIGINAL,{},CUSTOMER,POINT_ROW)
 await original(DECOY_ORIGINAL,{point:DECOY_P,li:'LI-B',customer:'CB'},DECOY_CUSTOMER,DECOY_POINT_ROW)
 const startDate=(await db.query('select gridex_received_sources.permission_date_v1($1) d,gridex_received_sources.permission_time_v1($1) t',[START])).rows[0]
 await db.query(`insert into public.supplier_switch_requests(id,company_id,customer_id,metering_point_id,outbound_z03_message_id,inbound_z04_message_id,rff_li_reference,status,confirmed_start_date) values
  ($1,$2,$3,$4,$5,$6,'LI-A','accepted',$11),($7,$2,$8,$9,$10,$12,'LI-B','accepted',$11)`,[SWITCH,COMPANY,CUSTOMER,POINT_ROW,ORIGINAL,CONFIRMATION,DECOY_SWITCH,DECOY_CUSTOMER,DECOY_POINT_ROW,DECOY_ORIGINAL,startDate.d,DECOY_CONFIRMATION])
 await db.query(`insert into public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,market_start_at,source,source_message_id,source_switch_request_id,status,market_state_version,metadata) values
  ($1,$2,$3,$4,$5,$6,'ediel_qualified_source',$7,$8,'confirmed_by_grid_owner',1,'{}'),($9,$2,$10,$11,$5,$6,'ediel_qualified_source',$12,$13,'confirmed_by_grid_owner',1,'{}')`,[PERIOD,COMPANY,CUSTOMER,POINT_ROW,startDate.d,startDate.t,CONFIRMATION,SWITCH,DECOY_PERIOD,DECOY_CUSTOMER,DECOY_POINT_ROW,DECOY_CONFIRMATION,DECOY_SWITCH])
 const baseline=await effects()

 await check('exact C cancels only the right confirmed future period and its switch; decoy untouched',async()=>{
  const c=await received(),decoyPeriod=await row('public.customer_supply_periods',DECOY_PERIOD),decoySwitch=await row('public.supplier_switch_requests',DECOY_SWITCH),before=await row('public.customer_supply_periods',PERIOD)
  const result=await call(c)
  assert.equal(result.applied,true,JSON.stringify(result))
  assert.deepEqual(result.plans.map(p=>[p.kind,p.periodId,p.switchId]),[['cancel_start',PERIOD,SWITCH]])
  assert.deepEqual(result.previousStates.map(s=>s.id),[PERIOD]);assert.deepEqual(result.previousSwitches.map(s=>s.id),[SWITCH])
  const period=await row('public.customer_supply_periods',PERIOD),sw=await row('public.supplier_switch_requests',SWITCH)
  assert.equal(period.status,'cancelled');assert.equal(period.market_state_version,before.market_state_version+1)
  assert.equal(period.metadata.startCancellationSource,c.id);assert.equal(period.start_date,before.start_date);assert.equal(period.source_message_id,CONFIRMATION)
  assert.equal(sw.status,'cancelled_before_start');assert.equal(sw.inbound_z04_message_id,c.id);assert.notEqual(sw.completed_at,null)
  assert.deepEqual(result.periods.map(p=>[p.id,p.status]),[[PERIOD,'cancelled']])
  assert.deepEqual(await row('public.customer_supply_periods',DECOY_PERIOD),decoyPeriod);assert.deepEqual(await row('public.supplier_switch_requests',DECOY_SWITCH),decoySwitch)
  assert.deepEqual((await effects()).originals,baseline.originals)
  assert.equal((await db.query('select count(*)::int n from public.customer_supply_periods')).rows[0].n,2,'a cancellation must not create a period')
 })
 await check('replay of the committed C is idempotent and changes nothing',async()=>{
  const c=await received(),first=await call(c)
  assert.equal(first.applied,true)
  const objects=(await db.query('select gridex_received_sources.normal_switch_wire_v1($1) v',[c.raw])).rows[0].v.objects
  // Retained owner receipt as written by the caller (ediel_apply_supply_source_v1).
  await db.query('insert into gridex_received_sources.supply_source_transitions values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[c.id,COMPANY,hash(c.raw),'Z04',JSON.stringify(objects),JSON.stringify(first.previousStates),JSON.stringify(first.periods),[SWITCH],ACTOR])
  const settled=await effects()
  for(let attempt=0;attempt<2;attempt++){const replay=await call(c);assert.equal(replay.applied,true);assert.equal(replay.idempotent,true);assert.deepEqual(replay.periods,first.periods);assert.deepEqual(await effects(),settled)}
 })
 await check('a different payload under a retained source receipt is a replay conflict',async()=>{
  const c=await received()
  await db.query('insert into gridex_received_sources.supply_source_transitions values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[c.id,COMPANY,hash(c.raw+'X'),'Z04','[]','[]','[]',[],ACTOR])
  await assert.rejects(call(c),/supply_replay_conflict/)
 })
 await check('C with no confirmation period yet cancels only the switch and creates no period',async()=>{
  await db.exec(`delete from public.customer_supply_periods where id='${PERIOD}'`)
  const c=await received(),result=await call(c)
  assert.equal(result.applied,true);assert.deepEqual(result.plans.map(p=>[p.kind,p.periodId,p.switchId]),[['cancel_start',null,SWITCH]]);assert.deepEqual(result.periods,[])
  assert.equal((await row('public.supplier_switch_requests',SWITCH)).status,'cancelled_before_start')
  assert.equal((await db.query(`select count(*)::int n from public.customer_supply_periods where metering_point_id='${POINT_ROW}'`)).rows[0].n,0)
 })
 // Wrong correlation: every bounded physical key must match the sealed sent original.
 for(const [name,spec] of [['wrong LI',{li:'LI-X'}],['decoy point under own LI',{point:DECOY_P}],['unknown point',{point:'735123456789099999'}],['wrong customer identity',{customer:'CX'}],['wrong start',{start:minute(31)}],['foreign grid-owner sender',{sender:FOREIGN_DSO}],['decoy LI under own point',{li:'LI-B'}]])
  await check(`${name} is z04c_exact_original_unavailable with no mutation`,async()=>refused(name,'z04c_exact_original_unavailable',await received(spec)))
 await check('original with swapped sender/receiver is z04c_exact_original_unavailable',async()=>{
  const swapped=wire({code:'Z03',sender:DSO,receiver:SUPPLIER,reason:'Z22'})
  await db.query('update public.ediel_messages set raw_payload=$2,immutable_payload_hash=$3 where id=$1',[ORIGINAL,swapped,hash(swapped)])
  await refused('swapped original parties','z04c_exact_original_unavailable',await received())
 })
 await check('original L of a different own reason (not Z22/Z23) is not a cancellable original',async()=>{
  const other=wire({code:'Z03',sender:SUPPLIER,receiver:DSO,reason:'Z25'})
  await db.query('update public.ediel_messages set raw_payload=$2,immutable_payload_hash=$3 where id=$1',[ORIGINAL,other,hash(other)])
  await refused('Z25 original','z04c_exact_original_unavailable',await received())
 })
 await check('C before its original is sent is held for bounded correlation, then applies only to that original',async()=>{
  await db.exec(`update public.ediel_messages set status='queued',message_sent_at=null where id='${ORIGINAL}'`)
  const c=await received()
  await refused('unsent original','z04c_exact_original_unavailable',c)
  await db.exec(`update public.ediel_messages set status='sent',message_sent_at=now() where id='${ORIGINAL}'`)
  await db.exec(`delete from gridex_ediel_transport.synthetic_provider_acceptances where message_id='${ORIGINAL}'`)
  await refused('original without provider acceptance','z04c_exact_original_unavailable',c)
  await db.query('insert into gridex_ediel_transport.synthetic_provider_acceptances values($1)',[ORIGINAL])
  const result=await call(c)
  assert.equal(result.applied,true);assert.deepEqual(result.plans.map(p=>[p.periodId,p.switchId]),[[PERIOD,SWITCH]])
  assert.equal((await row('public.customer_supply_periods',DECOY_PERIOD)).status,'confirmed_by_grid_owner')
 })
 await check('original whose sealed bytes changed after sending is not current',async()=>{
  await db.exec(`update public.ediel_messages set immutable_payload_hash=repeat('0',64) where id='${ORIGINAL}'`)
  await refused('rewritten original','z04c_exact_original_unavailable',await received())
 })
 await check('two switches claiming the same original are ambiguous, not arbitrarily chosen',async()=>{
  await db.query(`insert into public.supplier_switch_requests(id,company_id,customer_id,metering_point_id,outbound_z03_message_id,rff_li_reference,status) values($1,$2,$3,$4,$5,'LI-A','accepted')`,[id(302),COMPANY,CUSTOMER,POINT_ROW,ORIGINAL])
  await refused('ambiguous switches','z04c_exact_original_unavailable',await received())
 })
 await check('matched original outside the frozen source cohort is not applied',async()=>refused('cohort','supply_original_cohort_changed',await received(),{cohort:[DECOY_ORIGINAL]}))
 await check('C bound to a foreign customer row is z04c_locked_original_mismatch',async()=>refused('foreign customer row','z04c_locked_original_mismatch',await received({},{customer:DECOY_CUSTOMER})))
 await check('C bound to a foreign metering point row is z04c_locked_original_mismatch',async()=>refused('foreign point row','z04c_locked_original_mismatch',await received({},{point:DECOY_POINT_ROW})))
 await check('original bound to another point than its switch is z04c_locked_original_mismatch',async()=>{
  await db.exec(`update public.ediel_messages set metering_point_id='${DECOY_POINT_ROW}' where id='${ORIGINAL}'`)
  await refused('original/switch point','z04c_locked_original_mismatch',await received())
 })
 await check('two periods tied to the same switch are z04c_conflicting_periods',async()=>{
  await db.query(`insert into public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,status,source_message_id,market_state_version,metadata) values($1,$2,$3,$4,current_date+40,'confirmed_by_grid_owner',$5,1,'{}')`,[id(402),COMPANY,CUSTOMER,POINT_ROW,CONFIRMATION])
  await refused('duplicate period','z04c_conflicting_periods',await received())
 })
 // Already executed effect: never silently cancel; hold for controlled compensation.
 await check('confirmed period whose start has passed (not activated) requires compensation',async()=>{
  const past=(await db.query('select gridex_received_sources.permission_date_v1($1) d,gridex_received_sources.permission_time_v1($1) t',[PAST_START])).rows[0]
  await db.query('update public.customer_supply_periods set start_date=$2,market_start_at=$3 where id=$1',[PERIOD,past.d,past.t])
  const raw=wire({code:'Z03',sender:SUPPLIER,receiver:DSO,reason:'Z22',start:PAST_START});await db.query('update public.ediel_messages set raw_payload=$2,immutable_payload_hash=$3 where id=$1',[ORIGINAL,raw,hash(raw)])
  assert.equal((await row('public.customer_supply_periods',PERIOD)).status,'confirmed_by_grid_owner')
  await refused('passed start','z04c_effect_already_executed_compensation_required',await received({start:PAST_START}))
 })
 await check('activated period requires compensation and is not cancelled',async()=>{
  await db.exec(`update public.customer_supply_periods set status='active',actual_start_date=current_date where id='${PERIOD}'`)
  await refused('active period','z04c_effect_already_executed_compensation_required',await received())
 })
 await check('completed switch requires compensation',async()=>{
  await db.exec(`update public.supplier_switch_requests set status='completed' where id='${SWITCH}'`)
  await refused('completed switch','z04c_effect_already_executed_compensation_required',await received())
 })
 await check('period start differing from the cancelled start requires compensation, not a guess',async()=>{
  await db.exec(`update public.customer_supply_periods set start_date=start_date+1 where id='${PERIOD}'`)
  await refused('start mismatch','z04c_effect_already_executed_compensation_required',await received())
 })
 // Role, direction and actor boundaries.
 await check('wrong direction (outbound C) is refused',async()=>refused('outbound','supply_source_unavailable',await received({},{direction:'outbound'})))
 await check('receiver without a current supplier role is refused',async()=>{
  await db.exec(`update tenant_actor_roles set role_code='energy_service_company' where id='${id(6)}'`)
  await refused('esco receiver','supply_legal_actor_unqualified',await received())
 })
 await check('receiver supplier role expired before reception is refused',async()=>{
  await db.exec(`update tenant_actor_roles set valid_to=now()-interval '1 day' where id='${id(6)}'`)
  await refused('expired role','supply_legal_actor_unqualified',await received())
 })
 await check('C addressed to a foreign receiver is refused',async()=>refused('foreign receiver','supply_legal_actor_unqualified',await received({receiver:'77777'})))
 await check('foreign execution actor without membership is refused',async()=>refused('foreign actor','supply_execution_actor_unqualified',await received(),{actor:FOREIGN_ACTOR}))
 await check('actor with metering.write denied is refused',async()=>{
  await db.exec(`insert into user_permission_overrides(user_id,company_id,permission_key,effect,valid_from,valid_to,is_active) values('${ACTOR}','${COMPANY}','metering.write','deny',now()-interval '1 day',now()+interval '1 day',true)`)
  await refused('metering deny','supply_execution_actor_unqualified',await received())
 })
 await check('C without accepted canonical function is refused',async()=>{
  const c=await received()
  await db.query("update gridex_received_sources.validation_assessments set facts_text=$2 where id=$1",[c.canonical,JSON.stringify({syntaxDecision:'accepted',functionalDecision:'rejected'})])
  const before=await effects()
  await db.exec('savepoint unaccepted')
  await assert.rejects(call(c),/supply_own_canonical_application_and_function_required/)
  await db.exec('rollback to savepoint unaccepted')
  assert.deepEqual(await effects(),before)
 })
 assert.deepEqual(await effects(),baseline,'every case rolled back to the shared baseline')
 console.log(`RESULT ${checks} PASS ${failures} FAIL; actual SQL component only, synthetic tenant/canonical/provider ports, NOT native/Supabase/public entrypoint or ACK proof`)
 console.log(`Z04C correlation own SQL: ${checks} cases ${failures?'FAIL':'PASS'};`)
 console.log('EDIEL_Z04C_CORRELATION_RESULT '+JSON.stringify({checks:passedChecks,failures,installedBodySha256:installed,proofLimits:{native:'NOT_EXERCISED',publicSupplyEntrypoint:'NOT_EXERCISED',ack:'NOT_EXERCISED',concurrency:'NOT_EXERCISED',rls:'NOT_EXERCISED',canonicalAdmission:'FINITE_DECLARED_FACET',providerAcceptance:'FINITE_DECLARED_JOURNAL',globalGraphLock:'FINITE_NO_OP',transitionWriter:'SYNTHETIC_RETAINED_RECEIPT'}}))
 process.exitCode=failures?1:0
}catch(error){console.error('SETUP OR EXECUTION ERROR',JSON.stringify({message:error.message,code:error.code,where:error.where}));process.exitCode=2}finally{await db.close()}
