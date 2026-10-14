// Actual recreated forward bodies, canonical wrapper and current deny resolver.
// External canonical facet/graph/endpoint owners are finite, declared synthetic
// IO. These probes prove local SQL mechanics, NOT native source approval/races.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash=x=>createHash('sha256').update(x).digest('hex')
const stable=v=>JSON.stringify(sort(v)),sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,sort(x)])):v
const migration=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')
const extract=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b+end.length)}
const baselineOnly = process.env.SC031_SQL_BASELINE === '1'
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA gridex_bilateral_prodat;CREATE SCHEMA gridex_ediel_inbound_context;CREATE SCHEMA gridex_ediel_technical_ack;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE companies(id uuid PRIMARY KEY,status text,is_active bool);CREATE TABLE user_profiles(id uuid PRIMARY KEY,user_status text);
 CREATE TABLE company_memberships(user_id uuid,company_id uuid,status text,is_active bool,accepted_at timestamptz);
 CREATE TABLE admin_users(user_id uuid,role text,is_active bool);CREATE TABLE user_roles(user_id uuid,role_id uuid,company_id uuid,role text,status text,is_active bool);
 CREATE TABLE roles(id uuid PRIMARY KEY,key text,name text,is_active bool);CREATE TABLE role_permissions(role_id uuid,permission_id uuid,effect text);CREATE TABLE permissions(id uuid PRIMARY KEY,key text,name text,is_active bool);
 CREATE TABLE user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,effect text,status text,is_active bool);
 CREATE TABLE user_permission_overrides(user_id uuid,company_id uuid,permission_key text,effect text,is_active bool,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text,message_received_at timestamptz,execution_context_snapshot jsonb);
 CREATE TABLE ediel_inbound_cases(id uuid PRIMARY KEY,company_id uuid,ediel_message_id uuid,status text,review_decision jsonb,reviewed_by uuid,reviewed_at timestamptz,updated_by uuid,updated_at timestamptz,failure_reason text,applied_at timestamptz,customer_id uuid,site_id uuid,metering_point_id uuid);
 CREATE TABLE customer_onboarding_operations(id uuid PRIMARY KEY,company_id uuid,channel text,idempotency_key text,status text,command_snapshot jsonb,result_snapshot jsonb,UNIQUE(company_id,channel,idempotency_key));
 CREATE TABLE audit_logs(id uuid DEFAULT gen_random_uuid(),company_id uuid,actor_user_id uuid,entity_type text,entity_id text,action text,new_values jsonb,metadata jsonb);
 CREATE TABLE ediel_message_events(id uuid DEFAULT gen_random_uuid(),company_id uuid,ediel_message_id uuid,event_type text,event_status text,message text,payload jsonb,created_by uuid);
 CREATE TABLE grid_owners(id uuid PRIMARY KEY,company_id uuid,owner_code text);
 CREATE TABLE graph_effects(operation_id uuid PRIMARY KEY,point text);
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,origin text,raw_payload text,payload_hash text,message_code text,source_received_at timestamptz,received_context jsonb,retention_purged_at timestamptz);
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY,company_id uuid,environment text,source_message_id uuid,source_payload_hash text,facts_text text);
 CREATE TABLE gridex_received_sources.prodat_object_validation_facets(assessment_id uuid,company_id uuid,environment text,source_message_id uuid,source_payload_hash text,facts_text text,facts_hash text);
 CREATE TABLE gridex_received_sources.prodat_response_facets(assessment_id uuid,company_id uuid,environment text,source_message_id uuid,source_payload_hash text,response_facts_text text,response_facts_hash text);
 CREATE TABLE application_owner_fixture(company_id uuid,source_id uuid,raw_hash text,facet jsonb);
 CREATE TABLE legal_context_fixture(company_id uuid,source_id uuid,context jsonb);
 CREATE SCHEMA gridex_ediel_retention;CREATE TABLE gridex_ediel_retention.blob_tombstones(retention_class text,target_id uuid,company_id uuid,source_hash text,created_at timestamptz);
 CREATE TABLE gridex_ediel_inbound_context.receipts(source_message_id uuid,company_id uuid,environment text,status text,direction text,payload_sha256 text,source_received_at timestamptz,context jsonb);
 CREATE TABLE endpoint_fixture(company_id uuid,source_id uuid,active bool);
 CREATE TABLE tenant_ediel_profiles(id uuid PRIMARY KEY,company_id uuid,environment text,market text,is_enabled bool,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE tenant_actor_roles(id uuid PRIMARY KEY,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
 CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable';END$$;
 CREATE FUNCTION gridex_bilateral_prodat.lock_source_receipts_v1() RETURNS void LANGUAGE plpgsql AS $$BEGIN LOCK TABLE public.legal_context_fixture IN SHARE MODE;END$$;
 CREATE FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE j jsonb;BEGIN SELECT context INTO j FROM public.legal_context_fixture WHERE company_id=$1 AND source_id=$2;IF j IS NULL THEN RAISE EXCEPTION 'declared_legal_original_missing';END IF;RETURN j;END$$;
 CREATE FUNCTION gridex_ediel_technical_ack.require_current_endpoint_v1(jsonb) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM public.endpoint_fixture WHERE company_id=($1->>'companyId')::uuid AND source_id=($1->>'sourceId')::uuid AND active) THEN RAISE EXCEPTION 'declared_current_endpoint_missing';END IF;END$$;
 CREATE FUNCTION gridex_received_sources.require_prodat_application_objects_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE j jsonb;BEGIN SELECT facet INTO j FROM public.application_owner_fixture a JOIN public.ediel_messages m ON m.id=a.source_id AND m.company_id=a.company_id WHERE a.company_id=$1 AND a.source_id=$2 AND a.raw_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');IF j IS NULL THEN RAISE EXCEPTION 'declared_complete_application_missing';END IF;RETURN j;END$$;
 CREATE FUNCTION public.ediel_require_source_bytes_available_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM gridex_received_sources.sources WHERE company_id=$1 AND source_message_id=$2 AND raw_payload IS NOT NULL) THEN RAISE EXCEPTION 'original_bytes_unavailable';END IF;END$$;
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
 CREATE FUNCTION gridex_onboard_customer_graph(command jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE op public.customer_onboarding_operations%rowtype;r jsonb;BEGIN
 SELECT * INTO op FROM public.customer_onboarding_operations WHERE company_id=(command->>'company_id')::uuid AND idempotency_key=command->>'idempotency_key';IF op.id IS NOT NULL THEN RETURN op.result_snapshot;END IF;
 r:=jsonb_build_object('ok',true,'operation_id',gen_random_uuid(),'customer_id',gen_random_uuid(),'site_id',gen_random_uuid(),'metering_point_id',gen_random_uuid(),'application_id',gen_random_uuid());
 INSERT INTO public.customer_onboarding_operations VALUES((r->>'operation_id')::uuid,(command->>'company_id')::uuid,command->>'channel',command->>'idempotency_key','completed',command,r);INSERT INTO public.graph_effects VALUES((r->>'operation_id')::uuid,command#>>'{metering_point,meter_point_id}');RETURN r;END$$;`)
 // The installed actual graph prefix includes the deny phantom fence. Empty
 // schema shells model only unrelated domains absent from these bounded probes.
 const deny=migration('20261001004953_ediel_current_company_permission_denies.sql')
 const graph=extract(deny,'CREATE OR REPLACE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2','$$;')
 const list=graph.match(/LOCK TABLE ([\s\S]*?) IN SHARE MODE/)[1].replaceAll(/\s/g,'').split(',')
 for(const table of list){const [schema]=table.split('.');if(schema!=='public'&&schema!=='auth')await db.exec(`CREATE SCHEMA IF NOT EXISTS ${schema}`);await db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id uuid)`)}
 await db.exec(extract(migration('20260727010000_contract_flow_integrity_completion.sql'),'create or replace function public.gridex_normalize_platform_role','$$;'))
 await db.exec(extract(migration('20260924003724_company_direct_permission_scope_repair.sql'),'create or replace function public.gridex_get_user_permissions_in_company','$function$;'))
 await db.exec(deny)
 await db.exec(extract(migration('20260930231958_ediel_atomic_ack_owner_persistence.sql'),'CREATE FUNCTION gridex_ediel_ack_replay.require_current_source_role_v2','$$;'))
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2'])await db.exec(extract(migration('20260930144205_ediel_permission_source_atomic_transitions.sql'),'CREATE FUNCTION '+name,'$$;'))
 await db.exec(extract(migration('20260831095000_admin_signed_contract_import_canonicalization.sql'),'create or replace function public.canonical_onboard_customer_graph','$function$;'))
 await db.exec('REVOKE ALL ON FUNCTION canonical_onboard_customer_graph(jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION canonical_onboard_customer_graph(jsonb) TO service_role')
 const metadata=async()=>(await db.query("SELECT oid,proowner,proacl,proconfig,prosecdef FROM pg_proc WHERE oid='canonical_onboard_customer_graph(jsonb)'::regprocedure")).rows[0]
 const prior=await metadata();await db.exec(migration('20261001083359_ediel_prodat_object_batch_current_source_first_effect.sql'));assert.deepEqual(await metadata(),prior);checks++;await db.exec(migration('20261001092757_ediel_completed_object_batch_read_after_retention.sql'))

 // Explicit finite storage port. Production facets are immutable canonical
 // same-assessment outputs; these rows are NOT actual backend receipts.
 await db.exec(`CREATE TABLE gridex_received_sources.prodat_ignored_field_facets(
 canonical_assessment_id uuid PRIMARY KEY,company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),source_message_id uuid NOT NULL,source_payload_hash text NOT NULL,
 fields_text text NOT NULL CHECK(octet_length(fields_text)<=262144),fields_hash text NOT NULL CHECK(fields_hash=encode(sha256(convert_to(fields_text,'UTF8')),'hex')));`)
 const target = 'gridex_prodat_object_batch.require_wire_projection_v1(text,jsonb,jsonb,text,uuid)'
 const targetMetadata = async () => (await db.query("SELECT oid,proowner,proacl,proconfig,prosecdef,provolatile,pronargdefaults,prorettype FROM pg_proc WHERE oid=$1::regprocedure",[target])).rows[0]
 const baselineDefinition=extract(migration('20261001083359_ediel_prodat_object_batch_current_source_first_effect.sql'),'CREATE FUNCTION gridex_prodat_object_batch.require_wire_projection_v1','END $$;')
 const baselineBody=baselineDefinition.slice(baselineDefinition.indexOf('AS $$')+5,baselineDefinition.lastIndexOf('$$;'))
 assert.equal((await db.query('SELECT prosrc FROM pg_proc WHERE oid=$1::regprocedure',[target])).rows[0].prosrc,baselineBody,'actual complete baseline prosrc, same source95cf body')
 console.log(`Actual baseline source binding bodySHA256=${hash(baselineBody)}; canonical source envelope95cfbaef735f513b54a6620d861cd24a98e207ed1ed3ab40f03d81d1795dc5df`)
 const targetBefore = await targetMetadata()
 if(!baselineOnly){
  const fullCatalog=async()=>(await db.query("SELECT to_jsonb(p)-'prosrc' metadata,encode(sha256(convert_to((to_jsonb(p)-'prosrc')::text,'UTF8')),'hex') metadata_hash FROM pg_catalog.pg_proc p WHERE oid=$1::regprocedure",[target])).rows[0]
  const before=await fullCatalog(),notices=[]
  // Installed PGlite0.3.14 accepts onNotice per exec/query, not constructor.
  // Capture the actual migration's protocol message, never synthesize it.
  await db.exec(migration('20261014011520_ediel_sc031_source_owned_business_projection.sql'),{onNotice:notice=>{
   if(notice.message?.startsWith('SC031 catalog preservation'))notices.push(notice.message)
  }})
  const after=await fullCatalog()
  assert.equal(notices.length,1,'exactly one genuine forward catalog NOTICE')
  const receipt=/^SC031 catalog preservation target=(\d+) metadataSHA256=([0-9a-f]{64}) before=(\{.*\}) after=(\{.*\})$/.exec(notices[0])
  assert.ok(receipt,'full target/OID/before/after/digest protocol receipt')
  const [,targetOid,digest,beforeText,afterText]=receipt
  assert.equal(Number(targetOid),targetBefore.oid)
  assert.equal(digest,hash(beforeText),'hash the exact PostgreSQL jsonb text')
  assert.equal(digest,hash(afterText),'exact PostgreSQL after text has same hash')
  assert.equal(digest,before.metadata_hash)
  assert.equal(digest,after.metadata_hash)
  assert.deepEqual(JSON.parse(beforeText),before.metadata)
  assert.deepEqual(JSON.parse(afterText),after.metadata)
  assert.deepEqual(after.metadata,before.metadata)
  console.log('DECLARED local PGlite catalog witness; NOT genuine canonical GEN/backend capture')
  console.log(notices[0])
  assert.deepEqual(await targetMetadata(),targetBefore);checks++
 }
 const portDeclaration = 'Actual canonical TS/binder fixture input; declared SQL canonical-assessment/app/source/legal/endpoint/graph storage ports; NOT native authority or concurrency.'
 const fixtures = ['L','LK'].flatMap(subtype => {
  const j=JSON.parse(readFileSync(`/tmp/sc031-v4-qualified-supplier-${subtype}-cohorts.json`,'utf8'))
  assert.equal(j.subtype,subtype);assert.ok(j.declaration.includes('NOT native'));assert.ok(j.sourceBindings)
  for(const [path,sha] of Object.entries(j.sourceBindings))assert.equal(hash(readFileSync(new URL('../'+path,import.meta.url),'utf8')),sha,`current TS fixture source ${path}`)
  return j.fixtures.map((fixture,index)=>({...fixture,subtype,extra:index===1}))
 })
 const setup = async (fixture, fields=fixture.ignored) => {
  await db.exec(`RESET ROLE;DELETE FROM gridex_received_sources.prodat_ignored_field_facets;DELETE FROM application_owner_fixture;DELETE FROM gridex_received_sources.sources;DELETE FROM ediel_messages;`)
  const row=fixture.row,rawHash=hash(row.raw_payload),app={...fixture.application,assessmentId:id(6),sourcePayloadHash:rawHash}
  await db.query("INSERT INTO ediel_messages VALUES($1,$2,'test','inbound','edifact','PRODAT',$3,$4,$5,$6)",[row.id,row.company_id,row.message_code,row.raw_payload,row.message_received_at,row.execution_context_snapshot])
  await db.query("INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,origin,raw_payload,payload_hash,message_code,source_received_at,received_context) VALUES($1,$2,'test','database_insert',$3,$4,$5,$6,$7)",[row.id,row.company_id,row.raw_payload,rawHash,row.message_code,row.message_received_at,row.execution_context_snapshot.receivedProdatContext])
  await db.query('INSERT INTO application_owner_fixture VALUES($1,$2,$3,$4)',[row.company_id,row.id,rawHash,app])
  if(fields!==null){const text=JSON.stringify(fields);await db.query("INSERT INTO gridex_received_sources.prodat_ignored_field_facets VALUES($1,$2,'test',$3,$4,$5,$6)",[id(6),row.company_id,row.id,rawHash,text,hash(text)])}
  return app
 }
 const command = (fixture,index=0) => {
  const own=fixture.application.objects[index]
  return {company_id:fixture.row.company_id,actor_user_id:id(3),channel:'ediel_inbound',
   customer:{full_name:'Synthetic Customer'},site:{facility_id:own.objectId,street:'Street',postal_code:'12345',city:'Town',country:'SE'},
   metering_point:{meter_point_id:own.objectId,ediel_reference:null},application:{source_record_id:id(7)+':object:fixture',payload_snapshot:{edielMessageId:fixture.row.id,prodatRegisters:fixture.registers[index]}}}
 }
 const run = (fixture,cmd=command(fixture),own=fixture.application.objects[0]) => db.query('SELECT gridex_prodat_object_batch.require_wire_projection_v1($1,$2,$3,$4,$5)',[fixture.row.raw_payload,own,cmd,'create_new_customer',id(3)])
 const noEffects=async()=>{const role=(await db.query('SELECT current_role r')).rows[0].r;await db.exec('RESET ROLE');const n=(await db.query("SELECT (SELECT count(*) FROM graph_effects)+(SELECT count(*) FROM gridex_prodat_object_batch.graph_receipts)+(SELECT count(*) FROM audit_logs)+(SELECT count(*) FROM ediel_message_events) n")).rows[0].n;if(role==='service_role')await db.exec('SET ROLE service_role');return n}
 for(const fixture of fixtures){
  await setup(fixture)
  console.log(`Qualified ${fixture.subtype} ${fixture.extra?'extra319':'no319'} source ${hash(fixture.row.raw_payload)}; ${portDeclaration}`)
  for(let index=0;index<2;index++){await run(fixture,command(fixture,index),fixture.application.objects[index]);checks++}
 }

 // Negative/positive projection probes still use the same qualified supplier
 // raw and complete physical descriptors. Storage tampering is DECLARED IO.
 const fixture=fixtures.find(f=>f.subtype==='L'&&f.extra),clean=fixtures.find(f=>f.subtype==='L'&&!f.extra)
 const refuse=async(action,pattern)=>{const before=await noEffects();await assert.rejects(action,pattern);assert.equal(await noEffects(),before);checks++}
 await setup(fixture)
 await refuse(()=>run(fixture,{...command(fixture),metering_point:{meter_point_id:fixture.application.objects[0].objectId,ediel_reference:'IGNORED-1'}}),/wire_meter_required/)
 await setup(clean,[]);await run(clean);checks++
 await setup(clean,null);await refuse(()=>run(clean),/ignored_canonical_facet_required/)
 await setup(fixture,null)
 // Identity-only linking requires no new business facet and retains raw checks.
 const linked={...command(fixture),customer:{},site:{facility_id:fixture.application.objects[0].objectId},metering_point:{meter_point_id:fixture.application.objects[0].objectId},update_existing:false}
 await db.query('SELECT gridex_prodat_object_batch.require_wire_projection_v1($1,$2,$3,$4,$5)',[fixture.row.raw_payload,fixture.application.objects[0],linked,'link_existing_only',id(3)]);checks++
 for(const patch of ["canonical_assessment_id='00000000-0000-4000-8000-000000000099'","company_id='00000000-0000-4000-8000-000000000099'","environment='production'","source_message_id='00000000-0000-4000-8000-000000000099'","source_payload_hash=repeat('f',64)"]){
  await setup(fixture);await db.exec('UPDATE gridex_received_sources.prodat_ignored_field_facets SET '+patch);await refuse(()=>run(fixture),/ignored_canonical_facet_required/)
 }
 await setup(fixture);await refuse(()=>db.exec("UPDATE gridex_received_sources.prodat_ignored_field_facets SET fields_hash=repeat('f',64)"),/check constraint/)
 for(const [key,value] of [['lineIndex',7],['lineNumber','9'],['registerPosition',2],['objectId','FOREIGN'],['identityAgency','89'],['messageReference','FOREIGN'],['lineItemReference','FOREIGN'],['ownReferences',{objectId:{kind:'present',value:'FOREIGN'},lineItemReference:{kind:'absent'},customerId:{kind:'unavailable'}}]]){
  const fields=structuredClone(fixture.ignored);fields.find(f=>f.fieldNumber==='319').occurrence[key]=value
  await setup(fixture,fields);await refuse(()=>run(fixture),/ignored_field_(physical_)?scope_invalid/)
 }
 const incomplete=structuredClone(fixture.ignored);delete incomplete.find(f=>f.fieldNumber==='319').occurrence.ownReferences;await setup(fixture,incomplete);await refuse(()=>run(fixture),/ignored_field_scope_invalid/)
 await setup(fixture,[...fixture.ignored,fixture.ignored[0]]);await refuse(()=>run(fixture),/ignored_field_scope_invalid/)
 const firstOnly=fixture.ignored.filter(f=>f.occurrence.lineIndex===0)
 await setup(fixture,firstOnly);await run(fixture);checks++
 await refuse(()=>run(fixture,command(fixture,1),fixture.application.objects[1]),/wire_meter_required/)
 // A valid unrelated header decision is nonmatching, never a global error.
 const header={fieldNumber:'506',sourceRule:'PRODAT26A:P119',occurrence:{scope:'header',messageReference:'M',lineIndex:null,lineNumber:null,registerPosition:null,objectId:null,identityAgency:null,lineItemReference:null,ownReferences:{objectId:{kind:'unavailable'},lineItemReference:{kind:'unavailable'},customerId:{kind:'unavailable'}}}}
 await setup(fixture,[...fixture.ignored,header]);await run(fixture);checks++
 // Component-only canonical-decision ports: full/child masks remain precise.
 // These finite decisions do NOT assert current policy makes active IT ignored.
 const occurrence=fixture.ignored.find(f=>f.fieldNumber==='319').occurrence
 const decision=fieldNumber=>({fieldNumber,sourceRule:'PRODAT26A:P119',occurrence})
 for(const [fieldNumber,sitePatch] of [['234',{street:null}],['235',{postal_code:null}],['236',{city:null}],['237',{country:'SE'}]]){
  await setup(fixture,[...fixture.ignored,decision(fieldNumber)])
  const cmd=command(fixture);cmd.site={...cmd.site,...sitePatch};await run(fixture,cmd);checks++
 }
 await setup(fixture,[...fixture.ignored,decision('INSTALLATION_GROUP')]);
 const noIt=command(fixture);noIt.site={facility_id:fixture.application.objects[0].objectId,street:null,postal_code:null,city:null,country:'SE'};await run(fixture,noIt);checks++
 await setup(fixture,[...fixture.ignored,decision('229')]);await run(fixture);checks++
 await setup(fixture,[...fixture.ignored,decision('227')]);const noId=command(fixture);noId.customer={full_name:'Synthetic Customer',personal_number:null,org_number:null};await run(fixture,noId);checks++
 await setup(fixture,[...fixture.ignored,decision('228')]);const noName=command(fixture);noName.customer={full_name:'Ediel inbound-kund',personal_number:'199001011234'};await run(fixture,noName);checks++
 await setup(fixture,[...fixture.ignored,decision('END_USER_GROUP')]);const noUd=command(fixture);noUd.customer={full_name:'Ediel inbound-kund',personal_number:null,org_number:null};await run(fixture,noUd);checks++
 await setup(fixture);await refuse(()=>run(fixture,{...command(fixture),company_id:id(99)}),/ignored_same_source_required/)
 await setup(fixture);await db.exec("UPDATE application_owner_fixture SET facet=jsonb_set(facet,'{sourcePayloadHash}',to_jsonb(repeat('f',64)))");await refuse(()=>run(fixture),/ignored_same_application_required/)
 await setup(fixture);const forged=command(fixture);forged.application.payload_snapshot.ignoredFields=[];await refuse(()=>run(fixture,{...forged,metering_point:{...forged.metering_point,ediel_reference:'IGNORED-1'}}),/wire_meter_required/)

 // Applicable D319 contrast at a DECLARED component decision port. No
 // bilateral/regulated native D admission is inferred from this raw fixture.
 const d=structuredClone(fixture);d.row.raw_payload=d.row.raw_payload.replaceAll('CAV+Z22','CAV+Z70');d.row.execution_context_snapshot.receivedProdatContext.payloadHash=hash(d.row.raw_payload)
 d.registers=d.registers.map(rows=>rows.map(r=>({...r,reasonForTransaction:'Z70',rawSegments:r.rawSegments.map(segment=>segment.replace('CAV+Z22','CAV+Z70'))})))
 d.ignored=d.ignored.filter(f=>f.fieldNumber!=='319');await setup(d)
 const required=command(d);required.metering_point.ediel_reference='IGNORED-1';await run(d,required);checks++
 await refuse(()=>run(d),/wire_meter_required/)
 await refuse(()=>run(d,{...required,metering_point:{...required.metering_point,ediel_reference:'IGNORED-2'}}),/wire_meter_required/)
 // The migration's full pg_proc guard proves more than --no-owner schema
 // dumps: deliberately changed search_path must roll back atomically.
 const beforeGuard=await targetMetadata(),definitionBefore=(await db.query('SELECT pg_get_functiondef($1::regprocedure) d',[target])).rows[0].d
 await assert.rejects(db.exec(migration('20261014011520_ediel_sc031_source_owned_business_projection.sql').replace("SET search_path TO 'pg_catalog'","SET search_path TO 'public'")),/sc031_wire_projection_catalog_changed/)
 assert.deepEqual(await targetMetadata(),beforeGuard);assert.equal((await db.query('SELECT pg_get_functiondef($1::regprocedure) d',[target])).rows[0].d,definitionBefore);checks++
 assert.equal(await noEffects(),0);checks++
 // Actual protected role/first-CAS/onboarding/receipt replay chain. External
 // current actor, endpoint, application/admission and graph are DECLARED ports.
 await db.query('INSERT INTO auth.users VALUES($1,NULL,NULL)',[id(3)]);await db.query("INSERT INTO companies VALUES($1,'active',true)",[id(2)]);await db.query("INSERT INTO user_profiles VALUES($1,'active')",[id(3)])
 await db.query("INSERT INTO company_memberships VALUES($1,$2,'active',true,now())",[id(3),id(2)])
 for(const [n,key]of [[100,'communication.write'],[101,'customers.write']]){await db.query('INSERT INTO permissions VALUES($1,$2,$2,true)',[id(n),key]);await db.query("INSERT INTO user_permissions VALUES($1,$2,$3,$4,'allow','active',true)",[id(3),id(2),id(n),key])}
 await db.query("INSERT INTO tenant_ediel_profiles VALUES($1,$2,'test','electricity',true,'2000-01-01',NULL)",[id(4),id(2)])
 await db.query("INSERT INTO tenant_actor_roles VALUES($1,$2,'test',$3,'energy_service_company','2000-01-01',NULL)",[id(5),id(2),id(3)])
 await db.query('INSERT INTO endpoint_fixture VALUES($1,$2,true)',[id(2),id(1)])
 const legal=(code,role)=>({basisKind:'observed_source_persistence',companyId:id(2),sourceId:id(1),environment:'test',family:'PRODAT',code,legalActorId:id(3),actorRole:role,applicationReference:code==='Z14'?'23-DGI-PRODAT':'23-DDQ-PRODAT',canonicalProjection:{applicationReferences:[code==='Z14'?'23-DGI-PRODAT':'23-DDQ-PRODAT'],receiverRoles:[role]},facts:{profile:{id:id(4)}}})
 const n=JSON.parse(readFileSync('/tmp/sc031-v4-qualified-N-component-cohort.json','utf8'))
 assert.ok(n.declaration.includes('role must HOLD'));for(const [path,sha]of Object.entries(n.sourceBindings))assert.equal(hash(readFileSync(new URL('../'+path,import.meta.url),'utf8')),sha)
 n.row.execution_context_snapshot={receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:n.row.id,companyId:n.row.company_id,environment:'test',messageCode:'Z14',payloadHash:hash(n.row.raw_payload),sourceReceivedAt:n.row.message_received_at,capturedAt:n.row.message_received_at}}
 await setup(n)
 const nCmd=command(n);nCmd.customer={full_name:'Ediel inbound-kund'};nCmd.site={facility_id:n.application.objects[0].objectId,street:null,postal_code:null,city:null,country:'SE'}
 await run(n,nCmd);checks++ // comparator only, never supplierN native admission
 await db.query('INSERT INTO legal_context_fixture VALUES($1,$2,$3)',[id(2),id(1),legal('Z14','energy_service_company')])
 await db.exec('SET ROLE service_role');await refuse(()=>db.query('SELECT public.ediel_read_prodat_object_batch_source_v1($1,$2,$3)',[id(2),id(1),id(3)]),/current_receiver_role_required/);await db.exec('RESET ROLE')
 await db.query("UPDATE tenant_actor_roles SET role_code='electricity_supplier'")
 await db.query('UPDATE legal_context_fixture SET context=$1',[legal('Z04','electricity_supplier')])
 const app=await setup(fixture),rawHash=hash(fixture.row.raw_payload),received=fixture.row.message_received_at
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,'test',$3,$4,$5)",[id(6),id(2),id(1),rawHash,JSON.stringify({syntaxDecision:'accepted',functionalDecision:'accepted'})])
 const full={sharedAccepted:true,objects:app.objects.map(x=>({objectId:x.objectId,identityAgency:x.identityAgency,messageReference:x.messageReference,firstLineIndex:x.registers[0].lineIndex,lineItemReference:`OWN-${x.registers[0].lineIndex+1}`,disposition:'accepted'}))}
 const response={objects:app.objects.map(x=>({id:x.objectId,li:`OWN-${x.registers[0].lineIndex+1}`,lineIndex:x.registers[0].segmentIndex,outcome:'positive'})),responses:[]}
 for(const [table,value,col]of [['prodat_object_validation_facets',full,'facts'],['prodat_response_facets',response,'response_facts']]){const text=JSON.stringify(value);await db.query(`INSERT INTO gridex_received_sources.${table}(assessment_id,company_id,environment,source_message_id,source_payload_hash,${col}_text,${col}_hash) VALUES($1,$2,'test',$3,$4,$5,$6)`,[id(6),id(2),id(1),rawHash,text,hash(text)])}
 await db.query("INSERT INTO ediel_inbound_cases(id,company_id,ediel_message_id,status,updated_at) VALUES($1,$2,$3,'pending_review',$4)",[id(7),id(2),id(1),received])
 const decisions=app.objects.map(x=>({meteringPointId:x.objectId,identityAgency:x.identityAgency,mode:'create_new_customer'}))
 const commands=app.objects.map((x,i)=>{const cmd=command(fixture,i),sid=id(7)+':object:'+hash(stable([x.objectId,x.identityAgency]));return {...cmd,idempotency_key:'ediel_inbound:'+sid,matching_policy:'create_separate',existing_customer_id:null,existing_site_id:null,existing_metering_point_id:null,update_existing:false,application:{source_record_type:'ediel_inbound_case',source_record_id:sid,payload_snapshot:{...cmd.application.payload_snapshot,mode:'create_new_customer',prodatObjects:[{meteringPointId:x.objectId,identityAgency:x.identityAgency,registers:fixture.registers[i]}]}}}})
 const plan={version:1,revision:1,fingerprint:hash(stable([id(2),id(7),id(1),rawHash,decisions])),sourceHash:rawHash,originalActorId:id(3),decisions,commands,commandHash:hash(stable(commands)),receipts:[]}
 const row=async()=>{await db.exec('RESET ROLE');const x=(await db.query('SELECT to_jsonb(c) x FROM ediel_inbound_cases c')).rows[0].x;await db.exec('SET ROLE service_role');return x}
 const cas=async patch=>{const expected=await row();return(await db.query('SELECT public.ediel_compare_and_set_prodat_object_case_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) x',[id(2),id(7),id(1),id(3),expected.updated_at,expected.status,expected.review_decision?.objectApplication?.fingerprint??null,expected.review_decision?.objectApplication?.revision??null,patch])).rows[0].x}
 await db.exec('SET ROLE service_role');assert.equal((await db.query('SELECT public.ediel_read_prodat_object_batch_source_v1($1,$2,$3) x',[id(2),id(1),id(3)])).rows[0].x.sourcePayloadHash,rawHash);checks++
 assert.equal((await cas({status:'approved',reviewed_by:id(3),reviewed_at:received,updated_by:id(3),review_decision:{objectApplication:plan}})).status,'approved');checks++
 const result=[];for(const cmd of commands){result.push((await db.query('SELECT canonical_onboard_customer_graph($1) x',[cmd])).rows[0].x);checks++}
 const appliedEffects=await noEffects();assert.equal(appliedEffects,4);checks++
 await db.exec("RESET ROLE;CREATE FUNCTION sc031_replay_tripwire() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'sc031_unexpected_replay_write';END$$;CREATE TRIGGER sc031_replay_graph BEFORE INSERT ON graph_effects FOR EACH ROW EXECUTE FUNCTION sc031_replay_tripwire();CREATE TRIGGER sc031_replay_receipt BEFORE INSERT ON gridex_prodat_object_batch.graph_receipts FOR EACH ROW EXECUTE FUNCTION sc031_replay_tripwire();SET ROLE service_role")
 assert.deepEqual((await db.query('SELECT canonical_onboard_customer_graph($1) x',[commands[0]])).rows[0].x,result[0]);assert.equal(await noEffects(),appliedEffects);checks++
 const receipts=result.map((r,i)=>({key:stable([app.objects[i].objectId,app.objects[i].identityAgency]),result:r})),donePlan={...plan,revision:2,receipts}
 assert.equal((await cas({status:'applied',updated_by:id(3),review_decision:{objectApplication:donePlan}})).status,'applied');checks++
 const finalEffects=await noEffects();assert.equal(finalEffects,6);checks++
 assert.equal(await cas({status:'applied',updated_by:id(3)}),null);assert.equal(await noEffects(),finalEffects);checks++
 // Present-facet polluted historical saved command is a projection HOLD,
 // distinct from a missing historical facet. No stored plan/hash repair.
 await db.exec('RESET ROLE;BEGIN')
 const polluted=structuredClone(donePlan);polluted.commands[0].metering_point.ediel_reference='IGNORED-1';polluted.commandHash=hash(stable(polluted.commands))
 await db.query('UPDATE ediel_inbound_cases SET review_decision=$1',[{objectApplication:polluted}]);await db.exec('SET ROLE service_role')
 await assert.rejects(db.query('SELECT canonical_onboard_customer_graph($1)',[polluted.commands[0]]),/wire_meter_required/);await db.exec('ROLLBACK;RESET ROLE;SET ROLE service_role');assert.equal(await noEffects(),finalEffects);checks++
 await db.exec('RESET ROLE;BEGIN;DELETE FROM gridex_received_sources.prodat_ignored_field_facets;SET ROLE service_role')
 await assert.rejects(db.query('SELECT canonical_onboard_customer_graph($1)',[commands[0]]),/ignored_canonical_facet_required/);await db.exec('ROLLBACK;RESET ROLE;SET ROLE service_role');assert.equal(await noEffects(),finalEffects);checks++
 assert.deepEqual((await db.query('SELECT canonical_onboard_customer_graph($1) x',[commands[0]])).rows[0].x,result[0]);assert.equal(await noEffects(),finalEffects);checks++

 console.log(`SC031 source-owned SQL ${baselineOnly?'BASELINE':'CANDIDATE'}: ${checks} PASS; actual complete comparator; source metadata/ports explicit`)
}catch(error){console.error(error.message,error.where??'',JSON.stringify({position:error.position,internalPosition:error.internalPosition,detail:error.detail}));process.exitCode=1}finally{await db.close()}
