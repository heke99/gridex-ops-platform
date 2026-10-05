// masterplan: SC-016
// Actual caller/source/grant consumers over the unchanged finite permission
// harness. Canonical/legal/Z13 acceptance, separate assignment approval,
// governance, event storage and writer-graph admission are declared ports.
// This is embedded SQL evidence, never native replay or authentic approval.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,readdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const self=fileURLToPath(import.meta.url),root=resolve(dirname(self),'..')
const require=createRequire(import.meta.url),ts=require('typescript')
const hash=value=>createHash('sha256').update(value).digest('hex')
const read=file=>readFileSync(resolve(root,file),'utf8')
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const sourceFile='supabase/migrations/20261001044351_ediel_partial_permission_source_effects.sql'
const grantFile='supabase/migrations/20261001043917_ediel_service_source_network_period_timing.sql'
const matchesFile='supabase/migrations/20261001000926_ediel_service_evidence_archive_review.sql'

function definition(file,name){
 const source=read(file),pattern=new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${name.replaceAll('.','\\.')}\\(`,'gi'),found=[...source.matchAll(pattern)]
 assert.equal(found.length,1,`one exact owner definition: ${name}`)
 const start=found[0].index,end=source.indexOf('$$;',source.indexOf('$$',start)+2)
 assert.ok(end>start)
 return source.slice(start,end+3)
}
function moduleConsumers(file,bindings){
 const source=read(file),exports={}
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
 new Function('require','exports',js)(name=>{assert.ok(Object.hasOwn(bindings,name),`unprovided production import ${name}`);return bindings[name]},exports)
 return exports
}
function functionConsumers(file,names,bindings){
 const source=read(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true)
 const declarations=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text))
 assert.equal(declarations.length,names.length,'every complete production caller body extracted once')
 const code=declarations.map(node=>node.getText(ast).replace(/^export /,'')).join('\n')
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
 return new Function(...Object.keys(bindings),`${js};return {${names.join(',')}}`)(...Object.values(bindings))
}

export default async function probe({db,id,incoming,permission}){
 let checks=0
 const check=async fn=>{await fn();checks++}
 const company=id(1),actor=id(2),customer=id(3),pid=id(810),sid=id(830)
 const points=['735123456789012345','735123456789012352','735123456789012369'],li='LI-SC016-ONLY-A'
 const execute=async(sql,parameters=[])=>{await db.exec('SET ROLE service_role');try{return await db.query(sql,parameters)}finally{await db.exec('RESET ROLE')}}

 // Add finite relation dependencies, then execute the existing table, ACL,
 // history and grant-scope trigger foundation without changing its bytes.
 await db.exec(`CREATE TABLE customers(id uuid PRIMARY KEY,company_id uuid);
 CREATE TABLE customer_sites(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,facility_id text);
 CREATE TABLE metering_points(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,customer_site_id uuid,site_id uuid,ediel_metering_point_id text);
 CREATE TABLE platform_market_actors(id uuid PRIMARY KEY);
 CREATE TABLE tenant_ediel_profiles(id uuid PRIMARY KEY,company_id uuid,environment text);
 CREATE TABLE tenant_counterparty_relations(id uuid PRIMARY KEY);
 CREATE TABLE tenant_actor_identifiers(id uuid PRIMARY KEY,company_id uuid,actor_id uuid,environment text,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE platform_actor_identifiers(id uuid PRIMARY KEY,actor_id uuid,identifier_type text,identifier_value text,is_verified boolean,valid_from date,valid_to date);`)
 const foundation=read('supabase/migrations/20260930143025_ediel_service_assignment_grants_v1.sql')
 const boundary='create function public.ediel_service_assignment_assessment_v1('
 assert.equal(foundation.split(boundary).length,2)
 await db.exec(foundation.slice(0,foundation.indexOf(boundary))+'COMMIT;')
 await db.exec(`CREATE SCHEMA gridex_service_administration;CREATE SCHEMA gridex_service_permission;
 ALTER TABLE ediel_service_assignments ADD scope_basis_version bigint;
 ALTER TABLE ediel_service_evidence ADD permission_agreement_reference text,ADD permission_requested_method text,ADD permission_network_contract_start date,ADD permission_network_contract_end date,ADD permission_purpose_code text,ADD permission_reporting_frequency text,ADD permission_request_grid_area text,ADD permission_reporting_term_kind text,ADD permission_customer_classification text,ADD permission_termination_reason text,ADD permission_termination_at timestamptz;
 CREATE TABLE gridex_service_administration.commands(command_id uuid PRIMARY KEY,company_id uuid,actor_user_id uuid,input jsonb,result jsonb);
 CREATE TABLE declared_sc016_assignment_approval(company_id uuid,assignment_id uuid,approved_version bigint,allowed boolean);
 CREATE FUNCTION public.ediel_service_assignment_assessment_v1(c uuid,a uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT CASE WHEN EXISTS(SELECT FROM public.declared_sc016_assignment_approval f JOIN public.ediel_service_assignments s ON s.id=f.assignment_id AND s.company_id=f.company_id WHERE f.company_id=c AND f.assignment_id=a AND f.approved_version=s.scope_basis_version AND f.allowed AND s.status='active') THEN jsonb_build_object('status','authorized') ELSE jsonb_build_object('status','held','missing',jsonb_build_array('DECLARED_SEPARATE_ASSIGNMENT_APPROVAL_REQUIRED')) END$$;
 CREATE TABLE declared_sc016_writer_admission(allowed boolean);INSERT INTO declared_sc016_writer_admission VALUES(true);
 CREATE FUNCTION gridex_service_permission.lock_request_writer_v1() RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM public.declared_sc016_writer_admission WHERE allowed) THEN RAISE EXCEPTION 'DECLARED_WRITER_ADMISSION_HELD';END IF;END$$;`)
 await db.exec(definition(matchesFile,'gridex_service_administration.permission_matches_assignment_v1'))
 await db.exec(definition(grantFile,'public.ediel_service_administration_command_v1'))
 await db.exec(`REVOKE ALL ON FUNCTION public.ediel_service_administration_command_v1(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.ediel_service_administration_command_v1(uuid,uuid,jsonb) TO service_role;`)

 await db.query('INSERT INTO customers VALUES($1,$2),($3,$4)',[customer,company,uid(99),id(99)])
 for(let i=0;i<points.length;i++){
  await db.query('INSERT INTO customer_sites VALUES($1,$2,$3,$4)',[uid(900+i),company,customer,points[i]])
  await db.query('INSERT INTO metering_points VALUES($1,$2,$3,$4,$4,$5)',[uid(910+i),company,customer,uid(900+i),points[i]])
 }
 await db.query('INSERT INTO customer_sites VALUES($1,$2,$3,$4)',[uid(999),id(99),uid(99),points[1]])
 await db.query('INSERT INTO metering_points VALUES($1,$2,$3,$4,$4,$5)',[uid(998),id(99),uid(99),uid(999),points[1]])
 const registry=async()=>(await db.query("SELECT jsonb_build_object('sites',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM customer_sites s),'points',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM metering_points p)) state")).rows[0].state
 const originalRegistry=await registry()
 await permission(810,points.map(point=>({point,li})))
 const seed=await incoming(830,'Z14',[{point:points[0],li,permission:'PERM-SC016-A',status:'A74',start:'202601010000',end:'202701010000'}])
 const rawHash=hash(seed.wire)
 // Synthetic immutable metadata on the fixture source is declared here; the
 // real executor/attester computes and binds its own hash and private receipt.
 await db.query('UPDATE ediel_messages SET immutable_payload_hash=$1,immutable_rendered_at=now() WHERE id=$2',[rawHash,sid])
 const originals=async()=>(await db.query('SELECT to_jsonb(m) row FROM ediel_messages m WHERE id=ANY($1::uuid[]) ORDER BY id',[[sid,id(5810)]])).rows.map(row=>row.row)
 const originalBytes=await originals()
 const effects=async()=>(await db.query('SELECT gridex_received_sources.committed_permission_effects_v1($1,$2,NULL) effects',[company,sid])).rows[0].effects
 const sites=async()=>(await db.query('SELECT * FROM metering_permission_sites WHERE company_id=$1 AND metering_permission_id=$2 ORDER BY facility_id',[company,pid])).rows
 const grants=async()=>(await db.query('SELECT * FROM ediel_data_access_grants ORDER BY id')).rows
 const rpcCalls=[],reads=[],events=[]
 const sdk={
  async rpc(name,input){
   rpcCalls.push({name,input})
   try{
    let result
    if(name==='ediel_apply_permission_source_v1')result=await execute('SELECT public.ediel_apply_permission_source_v1($1,$2,$3,$4) data',[input.p_company_id,input.p_source_message_id,input.p_actor_user_id,input.p_expected_permission_id])
    else if(name==='ediel_service_administration_command_v1')result=await execute('SELECT public.ediel_service_administration_command_v1($1,$2,$3::jsonb) data',[input.p_company_id,input.p_actor_user_id,JSON.stringify(input.p_input)])
    else if(name==='gridex_actor_has_company_permission')result=await db.query('SELECT public.gridex_actor_has_company_permission($1,$2,$3) data',[input.p_actor_user_id,input.p_company_id,input.p_permission])
    else throw Error(`unprovided SDK RPC ${name}`)
    return{data:result.rows[0].data,error:null}
   }catch(error){return{data:null,error}}
  },
  from(table){
   assert.ok(['ediel_messages','metering_permissions','company_memberships','user_profiles'].includes(table),'bounded real SQL read adapter')
   reads.push(table);const filters=[],parameters=[]
   const query={select(){return query},eq(column,value){assert.match(column,/^[a-z_]+$/);parameters.push(value);filters.push(`${column}=$${parameters.length}`);return query},not(column,operator,value){assert.equal(operator,'is');assert.equal(value,null);assert.match(column,/^[a-z_]+$/);filters.push(`${column} IS NOT NULL`);return query},async maybeSingle(){const result=await db.query(`SELECT * FROM public.${table} WHERE ${filters.join(' AND ')}`,parameters);assert.ok(result.rows.length<=1);return{data:result.rows[0]??null,error:null}}}
   return query
  },
 }
 const permissionConsumers=moduleConsumers('lib/ediel/permissions/permissionMarketTransition.ts',{'@/lib/supabase/service':{supabaseService:sdk}})
 const automatic=functionConsumers('lib/onboarding/inboundEdielLinking.ts',['applyInboundProdatZ14ToMeteringPermission'],{applyPermissionMarketSource:permissionConsumers.applyPermissionMarketSource,createEdielMessageEvent:async event=>events.push(event)}).applyInboundProdatZ14ToMeteringPermission
 const manual=functionConsumers('lib/onboarding/infoRequests.ts',['getMeteringPermissionById','applyZ14SnapshotToMeteringPermission'],{supabaseService:sdk,applyPermissionMarketSource:permissionConsumers.applyPermissionMarketSource,requireCompanyOperationalForWrites:async c=>{assert.equal(c,company,'declared company operational port')}}).applyZ14SnapshotToMeteringPermission
 const auth=functionConsumers('lib/ediel/services/authorization.ts',['assertEdielTenantActor'],{supabaseService:sdk}).assertEdielTenantActor
 // Entire schema/administration production module is executed. Its unrelated
 // route/origination imports are finite rejection ports and never invoked.
 const administration=moduleConsumers('lib/ediel/services/administration.ts',{
  zod:require('zod'),'@/lib/supabase/service':{supabaseService:sdk},'./authorization':{assertEdielTenantActor:auth},
  './commands':{coordinateEdielServicePermission:()=>{throw Error('unexpected service origination')}},
  '@/lib/ediel/flows/prodatServicePermission':{prepareAndQueueServicePermissionZ13:()=>{throw Error('unexpected Z13 origination')},prepareAndQueueServicePermissionZ18:()=>{throw Error('unexpected Z18 origination')}},
  './limits':moduleConsumers('lib/ediel/services/limits.ts',{}),
 }).executeEdielServiceAdministration
 const message=(await db.query('SELECT * FROM ediel_messages WHERE id=$1',[sid])).rows[0]
 let first,committed
 await check(async()=>{
  const requested=(await db.query('SELECT gridex_received_sources.permission_partition_wire_v1(raw_payload) wire FROM ediel_messages WHERE id=$1',[id(5810)])).rows[0].wire
  const received=(await db.query('SELECT gridex_received_sources.permission_partition_wire_v1(raw_payload) wire FROM ediel_messages WHERE id=$1',[sid])).rows[0].wire
  assert.deepEqual(requested.objects.map(object=>object.point),points);assert.deepEqual(received.objects.map(object=>object.point),[points[0]])
  for(const original of originalBytes){assert.equal(hash(original.raw_payload),original.immutable_payload_hash);assert.ok(original.immutable_rendered_at)}
  first=await automatic({actorUserId:actor,message:{...message,parsed_payload:{approvedSites:points.map(facilityId=>({facilityId}))}}})
  assert.equal(first.applied,true);assert.equal(first.status,'partially_approved');assert.equal(first.permissionId,pid)
  assert.equal(first.fullyApplied,true);assert.equal(first.reviewRequired,false)
  assert.equal(first.manifest.length,1);assert.deepEqual(first.manifest[0].object,seed.scopes[0]);assert.equal(first.manifest[0].status,'applied')
  assert.deepEqual((await sites()).map(site=>site.facility_id),[points[0]])
  committed=await effects();assert.equal(committed.length,1);assert.deepEqual(committed[0].objectScope,seed.scopes[0]);assert.equal(committed[0].sourcePayloadHash,rawHash);assert.match(committed[0].effectFactsHash,/^[a-f0-9]{64}$/)
  assert.match(committed[0].receiptId,/^[a-f0-9-]{36}$/);assert.equal(committed[0].canonicalAssessmentId,seed.facet.assessmentId);assert.equal(committed[0].effectKind,'metering_permission')
  assert.deepEqual((await sites())[0].metadata,{source:'inbound_prodat_z14',edielMessageId:sid,permissionId:'PERM-SC016-A',mode:'S17',product:'8716867000030'})
  assert.deepEqual(await grants(),[]);assert.deepEqual(await registry(),originalRegistry);assert.deepEqual(await originals(),originalBytes)
 })
 await check(async()=>{
  const replay=await permissionConsumers.applyPermissionMarketSource({actorUserId:actor,message})
  assert.equal(replay.idempotent,true);assert.deepEqual(replay.manifest,first.manifest)
  const selected=await manual({companyId:company,actorUserId:actor,permissionId:pid,sourceMessageId:sid,approvedSites:[{facilityId:points[1]},{facilityId:points[2]}],approvedEndDate:'2099-01-01'})
  assert.equal(selected.status,'partially_approved');assert.deepEqual((await sites()).map(site=>site.facility_id),[points[0]])
  assert.deepEqual(await effects(),committed);assert.deepEqual(await originals(),originalBytes)
  assert.equal(events[0].payload.sourcePayloadHash,rawHash)
  for(const call of rpcCalls.filter(call=>call.name==='ediel_apply_permission_source_v1'))assert.deepEqual(Object.keys(call.input).sort(),['p_actor_user_id','p_company_id','p_expected_permission_id','p_source_message_id'])
 })
 await check(async()=>{
  const foreign=await permissionConsumers.applyPermissionMarketSource({actorUserId:id(98),message})
  assert.equal(foreign.applied,false);assert.equal(foreign.reason,'permission_execution_actor_unqualified')
  await assert.rejects(manual({companyId:company,actorUserId:actor,permissionId:pid,sourceMessageId:id(999999),approvedSites:[{facilityId:points[1]}]}),/z14_received_source_required/)
  await db.exec('BEGIN');try{await db.query("UPDATE user_profiles SET user_status='inactive' WHERE id=$1",[actor]);const held=await automatic({actorUserId:actor,message});assert.equal(held.applied,false);assert.equal(held.reason,'permission_execution_actor_unqualified')}finally{await db.exec('ROLLBACK')}
  assert.deepEqual((await sites()).map(site=>site.facility_id),[points[0]]);assert.deepEqual(await effects(),committed);assert.deepEqual(await grants(),[])
 })
 await check(async()=>{assert.equal((await execute('SELECT public.ediel_permission_source_is_current_v1($1,$2,$3) current',[company,pid,sid])).rows[0].current,true)})

 const site=(await sites())[0],start=new Date(site.start_at).toISOString(),end=new Date(site.end_at).toISOString()
 const assignment=uid(1000),link=uid(1001),beneficiary=uid(1002),provider=uid(1003),dso=uid(1004),profile=uid(1005)
 await db.query('INSERT INTO companies VALUES($1)',[beneficiary])
 await db.query('INSERT INTO platform_market_actors VALUES($1),($2)',[provider,dso])
 await db.query("INSERT INTO tenant_ediel_profiles VALUES($1,$2,'test')",[profile,company])
 await db.query("INSERT INTO tenant_actor_identifiers VALUES($1,$2,$3,'test','EdielId','12345','2000-01-01',NULL)",[uid(1006),company,provider])
 await db.query("INSERT INTO platform_actor_identifiers VALUES($1,$2,'EdielId','54321',true,'2000-01-01',NULL)",[uid(1007),dso])
 // Public assignment ownership is a synthetic existing administrative scope;
 // its separate legal approval is the named dependency port, initially held.
 await db.query("INSERT INTO ediel_service_assignments(id,company_id,beneficiary_company_id,provider_actor_id,actor_profile_id,customer_id,dso_actor_id,environment,mode,purpose,object_ids,product_ids,field_sets,data_start,data_end,valid_from,status,scope_basis_version) VALUES($1,$2,$3,$4,$5,$6,$7,'test','V','SC016 finite analysis',$8,ARRAY['8716867000030'],ARRAY['quantity'],$9,$10,'2000-01-01','active',1)",[assignment,company,beneficiary,provider,profile,customer,dso,points,start,end])
 await db.query('INSERT INTO ediel_assignment_permission_links(id,company_id,assignment_id,permission_id) VALUES($1,$2,$3,$4)',[link,company,assignment,pid])
 await db.query('INSERT INTO declared_sc016_assignment_approval VALUES($1,$2,1,false)',[company,assignment])
 let commandNumber=1100
 const command=input=>administration({companyId:company,actorUserId:actor,command:{commandId:uid(commandNumber++),assignmentId:assignment,expectedVersion:1,...input}})
 const create=objects=>command({action:'create_grant',fields:{permission_link_id:link,object_ids:objects,product_ids:['8716867000030'],fields:['quantity'],data_start:start,data_end:end,valid_from:'2000-01-01T00:00:00Z',valid_to:null}})
 const publish=grant=>command({action:'publish_grant',grantId:grant.grantId,expectedGrantVersion:1})
 const a=await create([points[0]])
 await check(async()=>{assert.equal(a.status,'held');assert.equal(a.accessGranted,false);const held=await publish(a);assert.equal(held.status,'held');assert.deepEqual(held.missing,['DECLARED_SEPARATE_ASSIGNMENT_APPROVAL_REQUIRED']);assert.equal((await grants()).filter(grant=>grant.status==='active').length,0)})
 await db.exec('UPDATE declared_sc016_assignment_approval SET allowed=true')
 let approved
 await check(async()=>{approved=await publish(a);assert.equal(approved.status,'active');assert.equal(approved.accessGranted,true);assert.equal(approved.grantVersion,2);assert.deepEqual((await grants()).filter(grant=>grant.status==='active').map(grant=>grant.object_ids),[[points[0]]])})
 const refused=[]
 for(const objects of [[points[1]],[points[2]],points])await check(async()=>{
  const draft=await create(objects);assert.equal(draft.accessGranted,false);const held=await publish(draft)
  assert.equal(held.status,'held');assert.notEqual(held.accessGranted,true);assert.deepEqual(held.missing,['explicit_approved_object_product_period'])
  const row=(await grants()).find(grant=>grant.id===draft.grantId);assert.equal(row.status,'held');assert.equal(Number(row.version),1)
  refused.push({objects,status:held.status,missing:held.missing,accessGranted:held.accessGranted===true})
 })
 await check(async()=>{
  const count=rpcCalls.length
  await assert.rejects(administration({companyId:company,actorUserId:id(98),command:{action:'publish_grant',commandId:uid(1200),assignmentId:assignment,expectedVersion:1,grantId:a.grantId,expectedGrantVersion:2}}),/ediel_tenant_actor_forbidden/)
  assert.equal(rpcCalls.slice(count).filter(call=>call.name==='ediel_service_administration_command_v1').length,0)
  assert.deepEqual((await grants()).filter(grant=>grant.status==='active').map(grant=>grant.object_ids),[[points[0]]])
  assert.deepEqual(await effects(),committed);assert.deepEqual(await registry(),originalRegistry);assert.deepEqual(await originals(),originalBytes)
  assert.deepEqual((await sites()).map(row=>row.facility_id),[points[0]])
 })

 const owners=[]
 for(const [file,name,signature] of [
  [sourceFile,'public.ediel_apply_permission_source_v1','public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid)'],
  [sourceFile,'public.ediel_permission_source_is_current_v1','public.ediel_permission_source_is_current_v1(uuid,uuid,uuid)'],
  [grantFile,'public.ediel_service_administration_command_v1','public.ediel_service_administration_command_v1(uuid,uuid,jsonb)'],
  [matchesFile,'gridex_service_administration.permission_matches_assignment_v1','gridex_service_administration.permission_matches_assignment_v1(public.ediel_service_assignments,public.metering_permissions)'],
 ]){
  const original=definition(file,name),body=original.slice(original.indexOf('$$')+2,original.lastIndexOf('$$'))
  const installed=(await db.query('SELECT prosrc FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0].prosrc
  assert.equal(installed,body,'the installed complete owner body equals the exact migration body')
  const pattern=new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${name.replaceAll('.','\\.')}\\(`,'i')
  const definitions=readdirSync(resolve(root,'supabase/migrations')).filter(file=>file.endsWith('.sql')).sort().filter(file=>pattern.test(read(`supabase/migrations/${file}`)))
  assert.equal(definitions.at(-1),file.split('/').at(-1),'latest explicit definition in this checkout')
  owners.push({signature,migration:file,lastExplicitDefinition:definitions.at(-1),definitionSha256:hash(original),installedBodySha256:hash(installed),exactBody:true})
 }
 console.log(`SC016 approved-object current SQL: ${checks} PASS; actual source/grant/caller consumers, finite declared upstream ports; NOT native/authentic acceptance`)
 console.log('SC016_RESULT '+JSON.stringify({checks,scope:'finite synthetic upstream ports; actual TypeScript/SQL consumers; NOT native/authentic acceptance',source:{sourceId:sid,permissionId:pid,status:first.status,manifestObjects:first.manifest.map(entry=>entry.object.objectId),sites:(await sites()).map(row=>row.facility_id),committedEffects:committed.length,sourceHash:rawHash,registryUnchanged:true,rawAndSealUnchanged:true,idempotentReplay:true,noAutomaticGrant:true},callers:{automatic:true,sdk:true,manual:true,hostileManualSitesIgnored:true,foreignAndInactiveHeld:true,sourceOnlyRpc:true,reads},grant:{activeObjects:(await grants()).filter(grant=>grant.status==='active').flatMap(grant=>grant.object_ids),separateApprovalRequired:true,refused},owners}))
}

if(process.argv[1]&&resolve(process.argv[1])===self){
 const base=read('scripts/ediel-partial-permission-source-sql-regression.mjs')
 const marker=' if(process.env.EDIEL_PERMISSION_PROBE_MODULE)'
 assert.equal(base.split(marker).length,2,'one unchanged existing permission probe boundary')
 const insertion=` await (await import(${JSON.stringify(import.meta.url)})).default({db,id,incoming,permission});\n`
 const source=base.replace(marker,()=>insertion+marker)
 const env={...process.env,EDIEL_PGLITE_MODULE:process.env.EDIEL_PGLITE_MODULE??require.resolve('@electric-sql/pglite')}
 delete env.EDIEL_PERMISSION_PROBE_MODULE
 // Eval has a scripts/[eval1] module URL, retaining every original migration
 // URL and helper body. No existing file or temporary repository file changes.
 const result=spawnSync(process.execPath,['--input-type=module','--eval',source],{cwd:resolve(root,'scripts'),env,stdio:'inherit',timeout:60000})
 if(result.error)throw result.error
 process.exitCode=result.status??1
}
