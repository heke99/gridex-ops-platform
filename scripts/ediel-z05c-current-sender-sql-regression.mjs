// First Z05/C restore sender authorization: bounded actual SQL regression. Real network original
// archive/review/HMAC/current authority, real permission resolution, real physical
// wire parsing, and the captured private supply owner run in one PGlite database.
// Tenant/issuer input rows and canonical admission are declared synthetic ports.
// The full-schema graph lock is a finite no-op. No native/whole/replay/RLS claim.
import {readFileSync} from 'node:fs'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {createHash,createHmac} from 'node:crypto'
import assert from 'node:assert/strict'
const root=process.env.EDIEL_SQL_REPOSITORY??fileURLToPath(new URL('..',import.meta.url))
const forwardPath=process.env.EDIEL_RESTORE_FORWARD_SQL??`${root}/supabase/migrations/20261010101233_ediel_z05c_current_sender_registry.sql`
const preimage='d2fd0bf5d193b6888d5a41c064a24e5b020446b3b5332493963fa1dedee3e5a9',postimage='aab2d2f6dcbfe17e31f92c07a70c9f9346396a2c1435a5976b1d70c8e58cb2b7'
const schema=readFileSync(`${root}/supabase/schema.sql`,'utf8')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE??`${root}/node_modules/@electric-sql/pglite/dist/index.js`).href)
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const q=v=>"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'"
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
async function service(sql,values=[]){await db.exec('set role service_role');try{return(await db.query(sql,values)).rows[0].v}finally{await db.exec('reset role')}}
const run=()=>db.query('select gridex_received_sources.other_supply_scope_effect_v1($1,$2,$3,$4,$5,$6) v',[id(1),id(103),id(2),scope,[id(102)],id(104)]).then(r=>r.rows[0].v)
const current=()=>db.query(`select gridex_network_registry_sources.network_for_company_v1('${id(1)}','54321','test') v`).then(r=>r.rows[0].v)
const domain=()=>db.query('select to_jsonb(p) state from public.customer_supply_periods p order by id').then(r=>r.rows.map(x=>x.state))
const effects=()=>db.query("select jsonb_build_object('periods',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from public.customer_supply_periods p),'switches',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb) from public.supplier_switch_requests s),'transitions',(select coalesce(jsonb_agg(to_jsonb(t) order by source_message_id),'[]'::jsonb) from gridex_received_sources.supply_source_transitions t),'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from gridex_received_sources.supply_object_effect_receipts r)) state").then(r=>r.rows[0].state)
let scope,failures=0,checks=0,migrationApplication,installedBodySha256
const passedChecks=[]
async function check(name,body){await db.exec('begin');try{await body();checks++;passedChecks.push(name);console.log(`PASS ${name}`)}catch(e){failures++;console.error(`FAIL ${name}: ${e.message}`)}finally{await db.exec('rollback')}}
try{
 await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
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
 create table platform_market_actors(id uuid primary key,name text,status text);
 create table platform_actor_identifiers(id uuid primary key,actor_id uuid,identifier_type text,identifier_value text,is_verified bool,valid_from date,valid_to date);
 create table platform_actor_roles(id uuid primary key,actor_id uuid,actor_role text,is_active bool);
 create schema gridex_requested_changes;create schema gridex_received_sources;create schema gridex_ai_processing;create schema gridex_ai_purpose_sources;create schema gridex_ediel_ack_replay;create schema gridex_regulated_supply;
 create function gridex_ediel_ack_replay.lock_current_graph_v2() returns void language plpgsql as $$begin null;end$$;
 create function gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamptz) returns boolean language plpgsql as $$begin raise exception 'out_of_scope_regulated_ground_port_called';end$$;
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
 `)
 // Actual permission resolution and actual network owner inputs are not mocked.
 for(const name of ['public.gridex_normalize_platform_role','public.gridex_get_user_permissions_in_company','public.gridex_actor_has_company_permission','gridex_requested_changes.scoped_permission_v1','gridex_requested_changes.actor_v1','gridex_requested_changes.receipt_hmac_sha256_v1','gridex_ai_processing.native_profile_v1','gridex_ai_purpose_sources.legal_scope_v1','gridex_received_sources.permission_transition_immutable_v1'])await db.exec(actual(name))
 const networkMigration=readFileSync(`${root}/supabase/migrations/20261001023514_ediel_network_registry_original_source_owner.sql`,'utf8')
 await db.exec(networkMigration.slice(networkMigration.indexOf('INSERT INTO public.permissions'),networkMigration.indexOf('CREATE FUNCTION gridex_network_registry_sources.actor_v1')))
 for(const name of ['gridex_network_registry_sources.actor_v1','gridex_network_registry_sources.claims_v1','gridex_network_registry_sources.receipt_current_v1','gridex_network_registry_sources.current_v1','gridex_network_registry_sources.network_for_company_v1','public.ediel_archive_network_registry_source_v1','public.ediel_review_network_registry_source_v1','public.ediel_revoke_network_registry_source_v1'])await db.exec(actual(name))
 // Canonical facets are a finite source port, not a canonical-runtime approval.
 await db.exec(`create function gridex_received_sources.require_prodat_application_objects_v1(c uuid,source_id uuid) returns jsonb language plpgsql as $$declare f jsonb;begin select application_facts_text::jsonb||jsonb_build_object('assessmentId',assessment_id) into f from gridex_received_sources.prodat_application_facets where company_id=c and source_message_id=source_id;if f is null then raise exception 'declared_application_fixture_required';end if;return f;end$$;`)
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.supply_wire_v1','gridex_received_sources.normal_switch_wire_v1','gridex_received_sources.permission_date_v1','gridex_received_sources.permission_time_v1','gridex_received_sources.prodat_application_object_accepted_v1','gridex_received_sources.require_supply_scope_admission_v1','gridex_received_sources.supply_wire_for_scope_v1','gridex_received_sources.supply_wire_for_period_receipt_v1','gridex_received_sources.other_supply_scope_effect_v1'])await db.exec(actual(name))
 const beforeDefinition=(await db.query("select p.prosrc, to_jsonb(p)-'prosrc' metadata from pg_proc p where p.oid='gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure")).rows[0]
 const installedPreimage=hash(beforeDefinition.prosrc),originalControl=process.env.EDIEL_Z05C_ORIGINAL_CONTROL==='1'
 console.log(`CAPTURED prosrc sha256=${installedPreimage}`)
 if(installedPreimage!==preimage&&installedPreimage!==postimage)throw Error('z05c_finite_unknown_captured_owner')
 if(originalControl&&installedPreimage!==preimage)throw Error('z05c_original_control_requires_captured_preimage')
 if(originalControl)migrationApplication='skipped_for_original_red_control'
 else if(installedPreimage===preimage){await db.exec(readFileSync(forwardPath,'utf8'));migrationApplication='applied_to_captured_preimage'}
 else migrationApplication='already_captured_postimage'
 installedBodySha256=hash((await db.query("select prosrc from pg_proc where oid='gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure")).rows[0].prosrc)
 assert.equal(installedBodySha256,originalControl?preimage:postimage)
 assert.deepEqual((await db.query("select to_jsonb(p)-'prosrc' metadata from pg_proc p where p.oid='gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure")).rows[0].metadata,beforeDefinition.metadata)
 console.log('PASS preserved installed function OID/owner/ACL/config/all pg_proc metadata except prosrc')
 await db.exec(`insert into companies values('${id(1)}','active',true,'SYNTHETIC LEGAL COMPANY','5590000000');insert into auth.users(id) values('${id(2)}'),('${id(3)}');insert into user_profiles values('${id(2)}','active'),('${id(3)}','active');insert into company_memberships(company_id,user_id,status,is_active,accepted_at) values('${id(1)}','${id(2)}','active',true,now()),('${id(1)}','${id(3)}','active',true,now());
 insert into tenant_actor_identifiers values('${id(4)}','${id(1)}','test','${id(5)}','EdielId','12345','2020-01-01',null);insert into tenant_actor_roles values('${id(6)}','${id(1)}','test','${id(5)}','electricity_supplier','2020-01-01',null);insert into tenant_ediel_profiles values('${id(7)}','${id(1)}','test','electricity',true,'2020-01-01',null);
 insert into platform_market_actors values('${id(60)}','SYNTHETIC NETWORK','active');insert into platform_actor_identifiers values('${id(63)}','${id(60)}','EdielId','54321',true,'2020-01-01',null);insert into platform_actor_roles values('${id(64)}','${id(60)}','grid_owner',true);`)
 for(const key of ['communication.write','communication.read','customers.read','customers.write','contracts.read','contracts.write','metering.write'])await db.exec(`insert into permissions(key,name,is_active) values('${key}','SYNTHETIC',true) on conflict(key) do nothing`)
 await db.exec(`insert into user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect) select u.id,'${id(1)}',p.id,p.key,true,'active','allow' from auth.users u cross join permissions p`)
 const key=Buffer.alloc(32,22),clause={locator:'page 1 synthetic',quote:'synthetic dated network registry scope'},bytes=Buffer.from('%PDF-1.7\nsynthetic dated network registry scope\n%%EOF')
 await db.exec(`insert into gridex_network_registry_sources.issuer_keys values('${id(61)}','${id(1)}','test','${id(60)}','SYNTHETIC VERSION1','SYNTHETIC ISSUER COMPETENCE','${'a'.repeat(64)}',decode('${key.toString('hex')}','hex'),'2019-01-01','2099-01-01');insert into gridex_network_registry_sources.representations values('${id(62)}','${id(1)}','test','${id(61)}','${id(60)}','SYNTHETIC NETWORK REPRESENTATION','${'b'.repeat(64)}','2019-01-01','2099-01-01')`)
 const submission={environment:'test',networkActorId:id(60),validFrom:'2020-01-01T00:00:00Z',validUntil:'2098-12-31T00:00:00Z',source:{bytesBase64:bytes.toString('base64'),mimeType:'application/pdf',reference:'SYNTHETIC DATED NETWORK ORIGINAL',version:'1'}}
 const claims=(await db.query('select gridex_network_registry_sources.claims_v1($1,$2) v',[id(1),submission])).rows[0].v
 const payload=Buffer.from(JSON.stringify({format:'ediel_network_registry_receipt_v1',receiptId:'SYNTHETIC',claims,sourceHash:hash(bytes),sourceReference:submission.source.reference,sourceVersion:'1',registryVersion:'SYNTHETIC VERSION1',clause,issuedAt:'2020-01-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z'}))
 const qualified={...submission,issuerReceipt:{keyId:id(61),representationId:id(62),payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}}
 const archived=await service('select public.ediel_archive_network_registry_source_v1($1,$2,$3) v',[id(1),id(2),qualified])
 const reviewed=await service('select public.ediel_review_network_registry_source_v1($1,$2,$3,$4) v',[id(1),id(3),archived.artifactId,{sourceHash:archived.sourceHash,claimsHash:archived.claimsHash,decision:'approve',reason:'SYNTHETIC separate review',clause}])
 assert.equal(reviewed.status,'authorized');assert.equal((await current()).status,'authorized')
 const raw=reason=>["UNB+UNOC:3+54321:14+12345:14+261009:1200+I++23-DDQ-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A","BGM+Z05+DOC+9","NAD+FR+54321:160:SVK","NAD+DO+12345:160:SVK","LIN+1++735123456789012345:::9","CCI++Z13",`CAV+${reason}`,"RFF+LI:A","RFF+Z05:TES","NAD+UD+CA:SE1:260","DTM+93:202610200000:203","UNT+12+M","UNZ+1+I"].join("'")+"'"
 const restore=raw('Z24'),ending=raw('Z22'),tokens=(await db.query('select gridex_received_sources.closure_wire_tokens_v2($1) v',[restore])).rows[0].v,lin=tokens.find(t=>t.tag==='LIN')
 scope={messageIndex:0,messageReference:'M',objectId:lin.elements[3][0],identityAgency:lin.elements[3][3],registers:[{segmentIndex:lin.index,lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1}]}
 for(const [n,wire] of [[102,ending],[103,restore]])await db.query("insert into public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_received_at,customer_id,metering_point_id) values($1,$2,'test','inbound','edifact','PRODAT','Z05',$3,'received','2026-10-09',$4,$5)",[id(n),id(1),wire,id(90),id(91)])
 await db.exec(`insert into public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,market_start_at,end_date,market_end_at,source,source_message_id,source_end_message_id,status,market_state_version,metadata) values('${id(100)}','${id(1)}','${id(90)}','${id(91)}','2026-09-01','2026-09-01','2026-10-20','2026-10-19T23:00:00Z','ediel_qualified_source','${id(101)}','${id(102)}','ending',2,'{}')`)
 const state=(await domain())[0],previous={...state,end_date:null,market_end_at:null,source_end_message_id:null,status:'active',market_state_version:1}
 const endingObjects=(await db.query('select gridex_received_sources.normal_switch_wire_v1($1) v',[ending])).rows[0].v.objects
 await db.query('insert into gridex_received_sources.supply_source_transitions values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id(102),id(1),hash(ending),'Z05',endingObjects,[previous],[state],[],id(2)])
 await db.query('insert into gridex_received_sources.validation_assessments values($1,$2,$3,$4,$5,$6,null)',[id(104),id(103),id(1),'test',hash(restore),JSON.stringify({syntaxDecision:'accepted',functionalDecision:'accepted'})])
 await db.query('insert into gridex_received_sources.prodat_application_facets values($1,$2,$3,$4)',[id(104),id(103),id(1),JSON.stringify({headerDecision:'accepted',objects:[{...scope,applicationDecision:'accepted',reasonCodes:[]}]})])
 console.log(`SOURCE installedBodySha256=${installedBodySha256}; migrationApplication=${migrationApplication}`)
 await check('authorized sender restores its exact ending',async()=>{const authority=await current();assert.equal(authority.basis.companyId,id(1));assert.equal(authority.basis.environment,'test');assert.equal(authority.basis.networkEdielId,'54321');const result=await run();assert.equal(result.applied,true);const after=(await domain())[0];assert.equal(after.status,'active');assert.equal(after.end_date,null);assert.equal(after.source_end_message_id,null);assert.equal(after.market_state_version,3)})
 const deny=async name=>{const before=await effects(),result=await run();assert.equal(result.applied,false,`${name}: current authority unavailable but private owner applied restore`);assert.equal(result.reason,'z05c_current_sender_network_registry_required');assert.deepEqual(await effects(),before)}
 await check('revoked physical sender grid role holds with no domain effects',async()=>{await db.exec(`update platform_actor_roles set is_active=false where actor_id='${id(60)}'`);assert.equal((await current()).status,'held');await deny('revoked role')})
 await check('expired physical sender verified identifier holds with no effects',async()=>{await db.exec(`update platform_actor_identifiers set valid_to=current_date-1 where actor_id='${id(60)}'`);assert.equal((await current()).status,'held');await deny('expired identifier')})
 await check('current reviewer permission deny holds with no effects',async()=>{await db.exec(`insert into user_permission_overrides(user_id,permission_key,effect,valid_from,valid_to,is_active) values('${id(3)}','ediel.network_registry.review','deny',now()-interval '1 day',now()+interval '1 day',true)`);assert.equal((await current()).status,'held');await deny('reviewer deny')})
 await check('actual original artifact withdrawal holds with no effects',async()=>{const result=await service('select public.ediel_revoke_network_registry_source_v1($1,$2,$3,$4) v',[id(1),id(3),archived.artifactId,{sourceHash:archived.sourceHash,claimsHash:archived.claimsHash,reason:'SYNTHETIC original withdrawn'}]);assert.equal(result.status,'held');assert.equal((await current()).status,'held');await deny('withdrawn artifact')})
 await check('unqualified current network representation holds with no effects',async()=>{await db.exec(`insert into gridex_network_registry_sources.revocations values('representation','${id(62)}','SYNTHETIC REPRESENTATION WITHDRAWN','${'d'.repeat(64)}',now())`);assert.equal((await current()).status,'held');await deny('withdrawn representation')})
 await check('physical sender with no original registry holds with no effects',async()=>{await db.exec("update public.ediel_messages set raw_payload=replace(raw_payload,'54321','99999');update gridex_received_sources.supply_source_transitions t set payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') from public.ediel_messages m where m.id=t.source_message_id;update gridex_received_sources.validation_assessments a set source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') from public.ediel_messages m where m.id=a.source_message_id;");assert.equal((await db.query(`select gridex_network_registry_sources.network_for_company_v1('${id(1)}','99999','test') v`)).rows[0].v.status,'held');await deny('unregistered physical sender')})
 await check('same sender authority in another environment holds with no effects',async()=>{await db.exec(`update public.ediel_messages set environment='production';update gridex_received_sources.validation_assessments set environment='production';insert into tenant_actor_identifiers select '${id(140)}',company_id,'production',actor_id,identifier_type,identifier_value,valid_from,valid_to from tenant_actor_identifiers;insert into tenant_actor_roles select '${id(141)}',company_id,'production',actor_id,role_code,valid_from,valid_to from tenant_actor_roles;insert into tenant_ediel_profiles select '${id(142)}',company_id,'production',market,is_enabled,valid_from,valid_to from tenant_ediel_profiles`);assert.equal((await db.query(`select gridex_network_registry_sources.network_for_company_v1('${id(1)}','54321','production') v`)).rows[0].v.status,'held');await deny('wrong environment')})
 await check('metering actor permission deny remains held before sender admission',async()=>{const before=await domain();await db.exec(`insert into user_permission_overrides(user_id,company_id,permission_key,effect,valid_from,valid_to,is_active) values('${id(2)}','${id(1)}','metering.write','deny',now()-interval '1 day',now()+interval '1 day',true)`);const result=await run();assert.equal(result.applied,false);assert.equal(result.reason,'supply_execution_actor_unqualified');assert.deepEqual(await domain(),before)})
 await check('retained same-source receipt replay preserves existing no-write behavior',async()=>{const result=await run();assert.equal(result.applied,true);const saved=(await domain())[0];await db.query('insert into gridex_received_sources.supply_source_transitions values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id(103),id(1),hash(restore),'Z05',(await db.query('select gridex_received_sources.normal_switch_wire_v1($1) v',[restore])).rows[0].v.objects,[state],[saved],[],id(2)]);await db.exec(`update platform_actor_roles set is_active=false where actor_id='${id(60)}'`);assert.equal((await current()).status,'held');const replay=await run();assert.equal(replay.applied,true);assert.equal(replay.idempotent,true);assert.deepEqual(await domain(),[saved])})
 // Separate output-contract fault injection: the real registry owner still
 // executes every role/identifier/reviewer/current-source query. A finite port
 // corrupts one returned binding afterwards. These are defensive consumer
 // property checks, not claims that protected storage can produce this shape.
 for(const [field,value] of [['companyId',id(99)],['environment','production'],['networkEdielId','99999']])await check(`synthetic owner output ${field} mismatch holds with no effects`,async()=>{
  assert.equal((await current()).status,'authorized')
  await db.exec('alter function gridex_network_registry_sources.network_for_company_v1(uuid,text,text) rename to finite_actual_network_owner_v1')
  await db.exec(`create function gridex_network_registry_sources.network_for_company_v1(c uuid,network_id text,env text) returns jsonb language sql as $$select jsonb_set(gridex_network_registry_sources.finite_actual_network_owner_v1(c,network_id,env),'{basis,${field}}',${q(JSON.stringify(value))}::jsonb)$$`)
  await deny(`synthetic ${field} output fault`)
 })
 await check('unknown installed predecessor fails closed before changing function',async()=>{
  const installed=(await db.query("select pg_get_functiondef(p.oid) definition,p.prosrc from pg_proc p where p.oid='gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure")).rows[0]
  const unknownBody=installed.prosrc+'\n-- SYNTHETIC unknown successor preimage\n'
  await db.exec(installed.definition.replace(installed.prosrc,unknownBody))
  await db.exec('savepoint unknown_predecessor')
  await assert.rejects(db.exec(readFileSync(forwardPath,'utf8')),/z05c_sender_registry_predecessor_required/)
  await db.exec('rollback to savepoint unknown_predecessor')
  assert.equal((await db.query("select prosrc from pg_proc where oid='gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure")).rows[0].prosrc,unknownBody)
 })
 console.log(`RESULT ${checks} PASS ${failures} FAIL; actual SQL component only, synthetic issuer/canonical ports, NOT native/Supabase/full public entrypoint or concurrent replay proof`)
 console.log('EDIEL_Z05C_CURRENT_SENDER_RESULT '+JSON.stringify({checks:passedChecks,failures,migrationApplication,installedBodySha256,metadataPreserved:true,proofLimits:{nativeConcurrency:'NOT_EXERCISED',wholeScenario:'NOT_APPROVED',publicSupplyEntrypoint:'NOT_EXERCISED',rls:'NOT_EXERCISED',registryQueries:'ACTUAL_SQL',issuer:'SYNTHETIC',canonicalAdmission:'FINITE_DECLARED_FACET',globalGraphLock:'FINITE_NO_OP',priorEndingReceipt:'SYNTHETIC_RETAINED_STATE',bindingOutputFaults:'THREE_SEPARATE_SYNTHETIC_PROPERTY_CASES'}}))
 process.exitCode=failures?1:0
}catch(error){console.error('SETUP OR EXECUTION ERROR',JSON.stringify({message:error.message,code:error.code,where:error.where}));process.exitCode=2}finally{await db.close()}
