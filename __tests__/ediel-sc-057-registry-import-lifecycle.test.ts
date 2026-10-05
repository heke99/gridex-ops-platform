// masterplan: SC-057
// Actual admin/parser/importer -> current installed SQL, using the unchanged
// retained PGlite harness. Source/admin/audit/graph/readiness ports are finite;
// this is neither native replay nor authentic registry/production activation.
import {createHash,randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {beforeAll,describe,expect,it,vi} from 'vitest'

const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),admin:vi.fn(),audit:vi.fn(),revalidate:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
vi.mock('@/lib/admin/guards',()=>({requirePlatformAdminActionAccess:io.admin}))
vi.mock('@/lib/audit/actionLogger',()=>({logAdminActionAndUsage:io.audit,logUsageEvent:vi.fn()}))
vi.mock('next/cache',()=>({revalidatePath:io.revalidate}))
vi.mock('@/lib/ediel/security/expisoftCertificateDirectory',()=>({fetchReceiverCertificatesFromExpisoft:()=>{throw Error('SC057 external certificate I/O forbidden')}}))
import {importPlatformActorsAction} from '@/app/admin/ediel/actors/actions'

type Row=Record<string,unknown>
type Db={query:(sql:string,args?:unknown[])=>Promise<{rows:Row[]}>;exec:(sql:string)=>Promise<unknown>}
const actorUserId='00000000-0000-4000-8000-000000000001',ids=['71801','71802','71803']
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex')
const fileName='sc057-synthetic.xml'
const route=(id:string,family:string,address:string)=>`<EDIFACTDetails Type="${family}"><ApplicationReference>${family}</ApplicationReference><SubAddress>${family==='PRODAT'?'literal-p':''}</SubAddress><PartyId>${id}</PartyId><InterchangePartyId>${id}</InterchangePartyId><CommunicationAddress Type="SMTP">${address}</CommunicationAddress></EDIFACTDetails>`
function xml(revision:number,gas:boolean){return `<Registry><Market Code="EL" Country="SE">${ids.map((id,index)=>`<Company><Name>Synthetic SC057 ${id}</Name><Key Type="EdielId">${id}</Key><Role>Netowner</Role><Role>ESCO</Role>${route(id,'PRODAT',`p${index}-${revision}@example.invalid`)}${route(id,'UTILTS',`u${index}@example.invalid`)}</Company>`).join('')}</Market>${gas?`<Market Code="GAS" Country="SE"><Company><Name>Synthetic SC057 ${ids[0]}</Name><Key Type="EdielId">${ids[0]}</Key><Role>Netowner</Role>${route(ids[0],'PRODAT','gas-retained@example.invalid')}</Company></Market>`:''}</Registry>`}
function form(source:string,mode:'preview'|'apply',confirmation='IMPORTERA'){const data=new FormData();data.set('actorImportFile',new File([source],fileName,{type:'application/xml'}));data.set('importMode',mode);data.set('confirmApply',confirmation);return data}
const proof:Row={}

async function probe({db}: {db:Db}){
 const one=async(sql:string,args:unknown[]=[])=>{const result=await db.query(sql,args);expect(result.rows).toHaveLength(1);return result.rows[0]}
 const service=async(sql:string,args:unknown[]=[])=>{await db.exec('SET ROLE service_role');try{return await one(sql,args)}finally{await db.exec('RESET ROLE')}}
 const calls:Array<{name:string;args:Row}>=[],audits:Row[]=[]
 io.admin.mockResolvedValue({userId:actorUserId})
 io.audit.mockImplementation(async(row:Row)=>{audits.push(row)})
 io.rpc.mockImplementation(async(name:string,args:Row)=>{
  calls.push({name,args})
  try{
   let query:string,parameters:unknown[]
   if(name==='ediel_read_registry_preview_snapshot_v1'){query='SELECT public.ediel_read_registry_preview_snapshot_v1($1,$2::text[]) data';parameters=[args.p_actor_user_id,args.p_ediel_ids]}
   else if(name==='ediel_read_actor_registry_batch_v1'){query='SELECT public.ediel_read_actor_registry_batch_v1($1,$2,$3,$4) data';parameters=[args.p_actor_user_id,args.p_source_base64,args.p_source_sha256,args.p_source_kind]}
   else if(name==='ediel_apply_actor_registry_v1'){query='SELECT public.ediel_apply_actor_registry_v1($1,$2,$3,$4,$5,$6::jsonb) data';parameters=[args.p_actor_user_id,args.p_source_base64,args.p_source_sha256,args.p_source_kind,args.p_source_filename,JSON.stringify(args.p_records)]}
   else throw Error(`unprovided SC057 RPC:${name}`)
   return {data:(await service(query,parameters)).data,error:null}
  }catch(error){return {data:null,error}}
 })
 // Preview/audit storage and front-door admin are finite ports. The actual
 // preview writer's values are persisted in its retained real table schema;
 // every source/read/apply RPC executes as service_role in the actual owner.
 io.from.mockImplementation((table:string)=>{
  expect(['platform_actor_import_runs','platform_actor_import_issues']).toContain(table)
  let row:Row|undefined,pending:Promise<{data:Row|null;error:unknown}>|undefined
  const execute=()=>pending??=(async()=>{expect(row).toBeDefined();const fields=Object.keys(row!);for(const field of fields)expect(field).toMatch(/^[a-z_]+$/);try{const result=await db.query(`INSERT INTO public.${table}(${fields.join(',')}) VALUES(${fields.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,fields.map(field=>typeof row![field]==='object'&&row![field]!==null?JSON.stringify(row![field]):row![field]));return{data:result.rows[0],error:null}}catch(error){return{data:null,error}}})()
  const query={insert(value:Row){row=value;return query},select(){return query},single:execute,then(onFulfilled:(value:unknown)=>unknown,onRejected:(error:unknown)=>unknown){return execute().then(onFulfilled,onRejected)}}
  return query
 })
 const tables=['platform_market_actors','platform_actor_identifiers','platform_actor_aliases','platform_actor_roles','platform_actor_routes','platform_actor_certificates','actor_registry_import_runs','actor_registry_import_items','platform_actor_import_runs','platform_actor_import_issues','gridex_registry_import.batches','gridex_registry_import.normalized_batches','gridex_registry_import.market_records','gridex_registry_import.market_current','gridex_registry_import.route_market_sources','gridex_registry_import.route_market_current','gridex_registry_import.route_versions']
 const snapshot=async(excludePreview=false)=>Object.fromEntries(await Promise.all(tables.filter(table=>!excludePreview||!['platform_actor_import_runs','platform_actor_import_issues'].includes(table)).map(async table=>[table,(await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(row=>row.row)])))
 const preview=async()=>one("SELECT * FROM platform_actor_import_runs WHERE source=$1 AND metadata->>'mode'='preview' ORDER BY started_at DESC,id DESC LIMIT 1",[fileName])
 const source1=xml(1,true),source2=xml(2,false),hash1=sha(source1),hash2=sha(source2)
 const untouched=await snapshot(true)
 await importPlatformActorsAction(form(source1,'preview'))
 const initialPreview=await preview()
 expect(await snapshot(true)).toEqual(untouched)
 proof.initialPreview={status:initialPreview.status,upserted:initialPreview.records_upserted,preview:(initialPreview.metadata as Row).preview,masterdataUnchanged:true}
 await importPlatformActorsAction(form(source1,'apply'))
 const first=(await one('SELECT result FROM gridex_registry_import.batches WHERE source_sha256=$1',[hash1])).result as Row
 const stable=await snapshot()
 const applyCallCount=calls.filter(call=>call.name==='ediel_apply_actor_registry_v1').length
 await importPlatformActorsAction(form(source1,'apply'))
 expect(await snapshot()).toEqual(stable)
 expect(calls.filter(call=>call.name==='ediel_apply_actor_registry_v1')).toHaveLength(applyCallCount)
 expect(audits.at(-1)).toMatchObject({action:'actor_import.reused',entityId:first.uiRunId,billable:false})
 proof.replay={samePrivateRun:true,all17RelationsUnchanged:true,noAdditionalApplyRpc:true,sourceBytes:(await one('SELECT encode(source_bytes,\'base64\') bytes FROM gridex_registry_import.batches WHERE source_sha256=$1',[hash1])).bytes}
 const actorIds=(await db.query("SELECT actor_id FROM platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=ANY($1::text[]) ORDER BY identifier_value",[ids])).rows.map(row=>row.actor_id)
 const rolesBefore=(await db.query('SELECT actor_id,actor_role,is_active,metadata FROM platform_actor_roles WHERE actor_id=ANY($1::uuid[]) ORDER BY actor_id,actor_role',[actorIds])).rows
 // Existing actual verification qualifies EL source, while true autosend here
 // is a declared prior readiness input, never an import/certificate result.
 for(const actorId of actorIds)await service('SELECT public.ediel_verify_registry_el_actor_v1($1,$2,NULL) data',[actorUserId,actorId])
 await db.query("UPDATE platform_actor_routes SET auto_send_allowed=true WHERE actor_id=ANY($1::uuid[]) AND registry_market='EL'",[actorIds])
 const beforeRoutes=(await db.query('SELECT * FROM platform_actor_routes WHERE actor_id=ANY($1::uuid[]) ORDER BY id',[actorIds])).rows
 const gasBefore=beforeRoutes.filter(row=>row.registry_market==='GAS')
 const beforePreview=await snapshot(true)
 await importPlatformActorsAction(form(source2,'preview'))
 expect(await snapshot(true)).toEqual(beforePreview)
 const laterPreview=await preview(),previewBody=(laterPreview.metadata as Row).preview as Row
 proof.laterPreview=previewBody
 await importPlatformActorsAction(form(source2,'apply'))
 const second=(await one('SELECT result FROM gridex_registry_import.batches WHERE source_sha256=$1',[hash2])).result as Row
 const afterRoutes=(await db.query('SELECT * FROM platform_actor_routes WHERE actor_id=ANY($1::uuid[]) ORDER BY id',[actorIds])).rows
 expect(afterRoutes.filter(row=>row.registry_market==='GAS')).toEqual(gasBefore)
 const changedOld=beforeRoutes.filter(row=>row.registry_market==='EL'&&row.message_family==='PRODAT')
 const oldNow=afterRoutes.filter(row=>changedOld.some(old=>old.id===row.id))
 const changedNew=afterRoutes.filter(row=>row.registry_market==='EL'&&row.message_family==='PRODAT'&&String(row.communication_address).includes('-2@'))
 const held=(rows:Row[])=>rows.every(row=>row.status==='needs_review'&&!row.is_verified&&!row.auto_send_allowed)
 const unchangedU=afterRoutes.filter(row=>row.registry_market==='EL'&&row.message_family==='UTILTS')
 expect(unchangedU).toEqual(beforeRoutes.filter(row=>row.registry_market==='EL'&&row.message_family==='UTILTS'))
 const versions=(await db.query("SELECT route_id,snapshot,snapshot_hash FROM gridex_registry_import.route_versions WHERE route_id=ANY($1::uuid[]) ORDER BY route_id,revision",[changedOld.map(row=>row.id)])).rows
 for(const old of changedOld)expect(versions).toContainEqual(expect.objectContaining({route_id:old.id,snapshot:expect.objectContaining({communication_address:old.communication_address,is_verified:true,auto_send_allowed:true})}))
 for(const version of versions)expect(version.snapshot_hash).toMatch(/^[a-f0-9]{64}$/)
 const rolesAfter=(await db.query('SELECT actor_id,actor_role,is_active,metadata FROM platform_actor_roles WHERE actor_id=ANY($1::uuid[]) ORDER BY actor_id,actor_role',[actorIds])).rows
 expect(rolesAfter.map(row=>[row.actor_id,row.actor_role,row.is_active])).toEqual(rolesBefore.map(row=>[row.actor_id,row.actor_role,row.is_active]))
 const marketRows=(await db.query("SELECT market,record->'roles' roles,record->'raw' raw FROM gridex_registry_import.market_records WHERE actor_id=ANY($1::uuid[]) ORDER BY actor_id,market,source_sha256",[actorIds])).rows
 const run=await one('SELECT status,finished_at FROM actor_registry_import_runs WHERE id=$1',[second.importRunId])
 const uiRun=await one('SELECT status,completed_at,metadata FROM platform_actor_import_runs WHERE id=$1',[second.uiRunId])
 expect((await one("SELECT count(*)::int n FROM actor_registry_import_runs WHERE source_filename=$1 AND status='running'",[fileName])).n).toBe(0)
 expect((await one("SELECT count(*)::int n FROM platform_actor_import_runs WHERE source=$1 AND status='running'",[fileName])).n).toBe(0)
 proof.conflicts={old:oldNow.length,new:changedNew.length,bothHeld:held(oldNow)&&held(changedNew),retainedRoutes:afterRoutes.length,unchangedUtilts:true,unchangedGas:true,marketRows,rolesPreserved:true,run:run.status,uiRun:uiRun.status,completed:run.finished_at!==null&&uiRun.completed_at!==null,activation:second.activation,historyPreserved:true}
 const frozenBatch=await one("SELECT source_bytes=$1::bytea same,source_sha256=encode(sha256(source_bytes),'hex') hash FROM gridex_registry_import.batches WHERE source_sha256=$2",[Buffer.from(source1),hash1])
 expect(frozenBatch).toEqual({same:true,hash:true})
 proof.firstSourceRetained=true
 const zero='<Market Code="EL" Country="SE"><Company><Name>Synthetic zero SC057</Name><Key Type="EdielId">71809</Key><Role>ESCO</Role></Company></Market>'
 const beforeZero=await snapshot(true),beforeZeroApply=calls.filter(call=>call.name==='ediel_apply_actor_registry_v1').length
 await importPlatformActorsAction(form(zero,'preview'))
 const zeroPreview=await preview()
 await expect(importPlatformActorsAction(form(zero,'apply'))).rejects.toThrow('ediel_registry_zero_routes_source_held')
 expect(await snapshot(true)).toEqual(beforeZero)
 expect(calls.filter(call=>call.name==='ediel_apply_actor_registry_v1')).toHaveLength(beforeZeroApply)
 expect(zeroPreview.error_log).toContainEqual(expect.objectContaining({issueType:'ediel_registry_zero_routes_source_held',severity:'blocking'}))
 proof.zero={status:zeroPreview.status,safe:zeroPreview.safe,upserted:zeroPreview.records_upserted,noApplyRpc:true,noSourceOrMasterdataEffects:true}
 // Qualified local fault input: fail after the real owner has inserted both
 // transient running rows and earlier candidates, still in the same SQL TX.
 const fault=xml(3,false).replaceAll('71801','71804').replaceAll('71802','71805').replaceAll('71803','71806')
 await db.exec("CREATE FUNCTION public.sc057_owned_abort() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.party_id='71805' THEN IF (SELECT count(*) FROM public.actor_registry_import_runs WHERE source_filename='sc057-synthetic.xml' AND status='running')<>1 OR (SELECT count(*) FROM public.platform_actor_import_runs WHERE source='sc057-synthetic.xml' AND status='running')<>1 THEN RAISE EXCEPTION 'sc057_fault_not_inside_running_owner';END IF;IF NOT EXISTS(SELECT FROM public.platform_actor_routes WHERE party_id='71804') THEN RAISE EXCEPTION 'sc057_fault_before_prior_candidate';END IF;RAISE EXCEPTION 'sc057_declared_abort_after_transient_running';END IF;RETURN NEW;END$$;CREATE TRIGGER sc057_owned_abort BEFORE INSERT ON public.platform_actor_routes FOR EACH ROW EXECUTE FUNCTION public.sc057_owned_abort();")
 const beforeFault=await snapshot(),auditCount=audits.length
 await expect(importPlatformActorsAction(form(fault,'apply'))).rejects.toThrow('sc057_declared_abort_after_transient_running')
 expect(await snapshot()).toEqual(beforeFault)
 expect(audits).toHaveLength(auditCount)
 await db.exec('DROP TRIGGER sc057_owned_abort ON public.platform_actor_routes;DROP FUNCTION public.sc057_owned_abort()')
 proof.interruption={reachedActualTransientRunningAndPriorMutation:true,all17RelationsRolledBack:true,noDurableUnattendedRunning:true,noCompletionAudit:true}
 const beforeUnauthorized=await snapshot(),rpcCount=calls.length
 io.admin.mockRejectedValueOnce(Error('platform_admin_required'))
 await expect(importPlatformActorsAction(form(source1,'apply'))).rejects.toThrow('platform_admin_required')
 expect(calls).toHaveLength(rpcCount);expect(await snapshot()).toEqual(beforeUnauthorized)
 proof.unauthorized={noRpc:true,noWrites:true}
 const beforeUnconfirmed=await snapshot(),beforeConfirmRpc=calls.length
 await expect(importPlatformActorsAction(form(source2,'apply','unreviewed'))).rejects.toThrow('Skriv IMPORTERA')
 expect(calls).toHaveLength(beforeConfirmRpc);expect(await snapshot()).toEqual(beforeUnconfirmed)
 proof.controlled={explicitConfirmationRequired:true,noUnconfirmedRpc:true,noUnconfirmedMutation:true}
 const schema=readFileSync(resolve('supabase/schema.sql'),'utf8'),owners=[]
 for(const signature of ['public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)','public.ediel_read_actor_registry_batch_v1(uuid,text,text,text)','public.ediel_read_registry_preview_snapshot_v1(uuid,text[])','gridex_registry_import.capture_route_version_v1()']){
  const name=signature.slice(0,signature.indexOf('(')),start=schema.indexOf(`CREATE FUNCTION ${name}(`),as=schema.indexOf('AS $$',start),end=schema.indexOf('$$;',as+5)
  expect(start).toBeGreaterThan(-1);expect(end).toBeGreaterThan(as)
  const expected=schema.slice(as+5,end),installed=(await one('SELECT prosrc FROM pg_proc WHERE oid=$1::regprocedure',[signature])).prosrc
  expect(installed).toBe(expected)
  owners.push({signature,installedBodySha256:sha(String(installed)),capturedBodySha256:sha(expected),exactBody:true})
 }
 proof.owners=owners
 console.log('SC057_RESULT '+JSON.stringify(proof))
}

beforeAll(async()=>{
 const key='__sc057RegistryProbe',global=globalThis as unknown as Record<string,unknown>,prior=global[key]
 const temporary=resolve('scripts',`.sc057-owned-${randomUUID()}.mjs`)
 const envKeys=['EDIEL_PGLITE_MODULE','EDIEL_REGISTRY_RECORDED_TXT_UPGRADE','EDIEL_REGISTRY_PREREQUISITE_CONTROL','EDIEL_REGISTRY_LEGACY_CONTROL'],old=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]))
 const file=readFileSync(resolve('scripts/ediel-registry-current-actor-source-sql-regression.mjs'),'utf8'),marker=' console.log(`PASS ${count} bounded actual registry'
 expect(file.split(marker)).toHaveLength(2)
 global[key]=probe
 process.env.EDIEL_PGLITE_MODULE=createRequire(import.meta.url).resolve('@electric-sql/pglite')
 for(const key of envKeys.slice(1))delete process.env[key]
 // The unchanged retained harness gets only this hook before its final report.
 // No owner/helper/schema file is modified or replaced; cleanup is guaranteed.
 writeFileSync(temporary,file.replace(marker,` await globalThis.${key}({db});\n`+marker))
 try{await import(/* @vite-ignore */pathToFileURL(temporary).href)}finally{unlinkSync(temporary);if(prior===undefined)delete global[key];else global[key]=prior;for(const key of envKeys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key]}}
},60000)

describe('SC057 complete literal registry lifecycle with declared finite ports',()=>{
 it('previews the actual XML without changing actor/role/market/route/source state',()=>expect(proof.initialPreview).toMatchObject({status:'completed',upserted:0,masterdataUnchanged:true,preview:{recordsSeen:4,routesSeen:7}}))
 it('imports identical bytes twice without duplicating any of17 public/private relations',()=>{expect(proof.replay).toMatchObject({samePrivateRun:true,all17RelationsUnchanged:true,noAdditionalApplyRpc:true});expect(Buffer.from(String((proof.replay as Row).sourceBytes),'base64')).toEqual(Buffer.from(xml(1,true)))})
 it('previews all three later contradictory PRODAT addresses as explicit route changes',()=>expect(proof.laterPreview).toMatchObject({changedActors:3,changes:ids.map(edielId=>expect.objectContaining({edielId,fields:['routes']}))}))
 it('keeps all old/new routes and history, markets and roles, holding both sides of each contradiction',()=>{expect(proof.conflicts).toMatchObject({old:3,new:3,bothHeld:true,retainedRoutes:10,unchangedUtilts:true,unchangedGas:true,rolesPreserved:true,historyPreserved:true});const rows=(proof.conflicts as Row).marketRows as Row[];expect(rows.map(row=>row.market).filter(value=>value==='GAS')).toHaveLength(1);expect(rows.filter(row=>row.market==='EL').every(row=>JSON.stringify(row.roles)==='["grid_owner","energy_service_company"]')).toBe(true);expect(proof.firstSourceRetained).toBe(true)})
 it('ends the actual controlled apply with terminal status and held readiness',()=>expect(proof.conflicts).toMatchObject({run:'completed',uiRun:'completed',completed:true,activation:'held_pending_current_source_readiness'}))
 it('records blocking terminal zero-route preview and denies apply without source or masterdata effects',()=>expect(proof.zero).toEqual({status:'completed_with_warnings',safe:false,upserted:0,noApplyRpc:true,noSourceOrMasterdataEffects:true}))
 it('rolls back an interrupted real owner after transient running and earlier mutations, leaving no unattended run',()=>expect(proof.interruption).toEqual({reachedActualTransientRunningAndPriorMutation:true,all17RelationsRolledBack:true,noDurableUnattendedRunning:true,noCompletionAudit:true}))
 it('requires explicit controlled-apply confirmation before any RPC or mutation',()=>expect(proof.controlled).toEqual({explicitConfirmationRequired:true,noUnconfirmedRpc:true,noUnconfirmedMutation:true}))
 it('denies unauthorized apply and executes four exact current captured owner bodies',()=>{expect(proof.unauthorized).toEqual({noRpc:true,noWrites:true});const owners=proof.owners as Row[];expect(owners).toHaveLength(4);for(const owner of owners){expect(owner.exactBody).toBe(true);expect(owner.installedBodySha256).toBe(owner.capturedBodySha256)}})
})
