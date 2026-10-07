// masterplan: AT-Z14V-ESCO
// Actual permission lexer/executor/partition/ledgers on PostgreSQL in PGlite.
// The unchanged regression harness declares finite canonical/application,
// captured legal, actor-permission and accepted-original IO ports. This is
// mechanical correspondence proof, not native admission or market evidence.
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import type {PGlite} from '@electric-sql/pglite'
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest'

const migration=resolve('supabase/migrations/20261006234527_ediel_z14_original_purpose_correspondence.sql')
const signature='gridex_received_sources.apply_permission_group_v1(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb,boolean)'
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const company=id(1),actor=id(2),customer=id(3),point='735123456789012345',li='PURPOSE-TDD'
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex')
let db:PGlite,directory:string,execution:Promise<unknown>,release:()=>void
type ObjectInput={point?:string|null;li?:string;purpose?:string|null;status?:string;reason?:string;permissionEnd?:string;endReason?:string}
type Scope={messageIndex:number;messageReference:string;objectId:string|null;identityAgency:string|null;registers:{lineIndex:number;lineNumber:string;registerIndex:null;registerPosition:number;segmentIndex:number}[]}
function raw(code:string,objects:ObjectInput[]){
 const outbound=code==='Z13',sender=outbound?'12345':'54321',receiver=outbound?'54321':'12345'
 const segments=[`UNB+UNOC:3+${sender}:14+${receiver}:14+261001:1200+I++23-DGI-PRODAT`,'UNH+M+PRODAT:D:97A:UN:E2SE6A',`BGM+${code}+DOC+9`,`NAD+FR+${sender}:160:SVK`,`NAD+DO+${receiver}:160:SVK`,...objects.flatMap((o,i)=>[`LIN+${i+1}++${o.point===null?'':o.point??point}:::9`,`RFF+LI:${o.li??li}`,'RFF+Z05:TES','RFF+Z09:PERM-TDD','NAD+UD+PERSON-A:SE1:260','CCI++Z13',`CAV+${o.reason??'S17'}`,...(o.status?['CCI++Z23',`CAV+${o.status}`]:[]),'DTM+90:202601010000:203','DTM+91:202701010000:203',...(o.purpose!=null?['CCI++Z24',`CAV+${o.purpose}`]:[]),...(o.permissionEnd?[`DTM+164:${o.permissionEnd}:203`]:[]),...(o.endReason?['CCI++Z25',`CAV+${o.endReason}`]:[]),'CCI++Z14','CAV+::::8716867000030']),'UNT','UNZ+1+I']
 segments[segments.length-2]=`UNT+${segments.length-2}+M`
 return segments.join("'")+"'"
}
beforeAll(async()=>{
 directory=mkdtempSync(join(tmpdir(),'gridex-z14-purpose-'))
 const hook=join(directory,'probe.mjs'),symbol=Symbol.for('gridex.z14Purpose.sqlProbe')
 writeFileSync(hook,'export default context => globalThis[Symbol.for("gridex.z14Purpose.sqlProbe")](context)\n')
 let arrive!:(p:{db:PGlite})=>void
 const arrived=new Promise<{db:PGlite}>(done=>{arrive=done}),finished=new Promise<void>(done=>{release=done})
 Reflect.set(globalThis,symbol,async(p:{db:PGlite})=>{arrive(p);await finished})
 vi.stubEnv('EDIEL_PGLITE_MODULE',resolve('node_modules/@electric-sql/pglite/dist/index.js'))
 vi.stubEnv('EDIEL_PERMISSION_PROBE_MODULE',hook)
 execution=import(/* @vite-ignore */ pathToFileURL(resolve('scripts/ediel-partial-permission-source-sql-regression.mjs')).href)
 db=(await Promise.race([arrived,execution.then(()=>{throw Error('Existing SQL regression did not reach its unchanged probe hook')})])).db
 const metadata=(await db.query<{metadata:unknown;hash:string}>(`SELECT to_jsonb(p)-'prosrc' metadata,encode(sha256(convert_to(prosrc,'UTF8')),'hex') hash FROM pg_proc p WHERE oid=$1::regprocedure`,[signature])).rows[0]
 expect(metadata.hash).toBe('5d3cae0314213756668f612eb31aada1862b4421f6ad1ac377f5ebc22fa6f3e9')
 if(existsSync(migration)){
  await db.exec(readFileSync(migration,'utf8'))
  expect((await db.query<{metadata:unknown}>(`SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid=$1::regprocedure`,[signature])).rows[0].metadata).toEqual(metadata.metadata)
 }
},30_000)
afterAll(async()=>{release?.();try{await execution}finally{Reflect.deleteProperty(globalThis,Symbol.for('gridex.z14Purpose.sqlProbe'));vi.unstubAllEnvs();if(directory)rmSync(directory,{recursive:true,force:true})}})
beforeEach(async()=>{await db.exec('BEGIN')})
afterEach(async()=>{await db.exec('ROLLBACK;RESET ROLE')})

async function pending(originalObjects:ObjectInput[],incomingObjects:ObjectInput[],code='Z14'){
 const original=raw('Z13',originalObjects),incoming=raw(code,incomingObjects),originalId=id(25000),sourceId=id(25001),permission=id(25002),assessment=id(25003)
 await db.query(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status,customer_id,message_sent_at,immutable_rendered_at,immutable_payload_hash) VALUES($1,$2,'test','outbound','PRODAT','Z13',$3,'sent',$4,now(),now(),$5),($6,$2,'test','inbound','PRODAT',$7,$8,'received',$4,NULL,NULL,NULL)`,[originalId,company,original,customer,hash(original),sourceId,code,incoming])
 await db.query('INSERT INTO accepted_source_fixture VALUES($1,$2)',[originalId,hash(original)])
 await db.query(`INSERT INTO metering_permissions(id,company_id,customer_id,status,source_z13_message_id,outbound_z13_message_id,rff_li_reference,grid_owner_ediel_id,market_state_version,metadata) VALUES($1,$2,$3,'z13_sent',$4,$4,$5,'54321',0,'{}')`,[permission,company,customer,originalId,li])
 return installIncoming({incoming,sourceId,assessment,permission,code})
}
async function installIncoming({incoming,sourceId,assessment,permission,code}:{incoming:string;sourceId:string;assessment:string;permission:string;code:string}){
 const wire=(await db.query<{w:{objects:{firstLineIndex:number;point:string|null;identityAgency:string|null}[]}}>('SELECT gridex_received_sources.permission_partition_wire_v1($1) w',[incoming])).rows[0].w
 const scopes:Scope[]=wire.objects.map((o,i)=>({messageIndex:0,messageReference:'M',objectId:o.point,identityAgency:o.identityAgency,registers:[{lineIndex:i,lineNumber:String(i+1),registerIndex:null,registerPosition:0,segmentIndex:o.firstLineIndex}]}))
 const facts=JSON.stringify({syntaxDecision:'accepted',functionalDecision:'accepted',applicationDecision:'accepted',rulePackEvidence:{declared:'finite external original-owner fixture'},registerValidation:{owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:scopes.map(scope=>({...scope,disposition:'accepted',reasons:[]}))}})
 await db.query(`INSERT INTO gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text,facts_hash) VALUES($1,$2,$3,'test',$4,$5,$6)`,[assessment,sourceId,company,hash(incoming),facts,hash(facts)])
 await db.query('INSERT INTO application_fixture VALUES($1,$2)',[sourceId,{assessmentId:assessment,headerDecision:'accepted',objects:scopes.map(scope=>({...scope,applicationDecision:'accepted',reasonCodes:[]}))}])
 await db.query('INSERT INTO legal_fixture VALUES($1,$2)',[sourceId,{actorRole:'energy_service_company',legalEdielId:'12345',environment:'test',family:'PRODAT',code}])
 return {permission,sourceId,assessment,wire,scopes}
}
type Pending=Awaited<ReturnType<typeof pending>>
async function market(p:Pending){return(await db.query<{b:unknown}>('SELECT jsonb_build_object(\'permission\',(SELECT to_jsonb(m) FROM metering_permissions m WHERE id=$1),\'sites\',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),\'[]\') FROM metering_permission_sites s WHERE metering_permission_id=$1),\'receipts\',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),\'[]\') FROM gridex_received_sources.permission_effect_receipts r WHERE source_message_id=$2),\'source\',(SELECT to_jsonb(m) FROM ediel_messages m WHERE id=$2),\'original\',(SELECT to_jsonb(m) FROM ediel_messages m WHERE id=$3)) b',[p.permission,p.sourceId,id(25000)])).rows[0].b}
type Result={applied:boolean;idempotent?:boolean;status?:string;manifest:{status:string;reason?:string}[]}
async function apply(p:Pick<Pending,'permission'|'sourceId'>){await db.exec('SET ROLE service_role');try{return(await db.query<{b:Result}>('SELECT public.ediel_apply_permission_source_v1($1,$2,$3,$4) b',[company,p.sourceId,actor,p.permission])).rows[0].b}finally{await db.exec('RESET ROLE')}}
async function validate(p:Pending){return(await db.query<{b:{qualified?:boolean;applied?:boolean;reason?:string}}>(`SELECT ${signature.split('(')[0]}($1,$2,$3,$4,$5,$6,$7,true) b`,[company,p.sourceId,actor,p.permission,p.wire,p.assessment,p.scopes])).rows[0].b}

it.each(['B71',null])('fresh A74 purpose %s cannot replace independently sealed/sent B72',async purpose=>{
 const p=await pending([{purpose:'B72'}],[{purpose,status:'A74'}]),before=await market(p),result=await apply(p)
 expect(result.applied).toBe(false)
 expect(await market(p)).toEqual(before)
 expect(result.manifest).toEqual([expect.objectContaining({status:'held',reason:'permission_original_reporting_purpose_mismatch'})])
})
it('matching B72 still commits the real permission and exactly one effect receipt',async()=>{
 const p=await pending([{purpose:'B72'}],[{purpose:'B72',status:'A74'}]),result=await apply(p)
 expect(result.applied).toBe(true);expect(result.manifest.map(x=>x.status)).toEqual(['applied'])
 expect(await market(p)).toMatchObject({permission:{status:'active',market_state_version:1},receipts:[expect.objectContaining({qualified_original_message_id:id(25000)})]})
})
it('both purposes absent retain the existing optional correspondence behavior',async()=>{
 const p=await pending([{}],[{status:'A74'}])
 expect((await apply(p)).applied).toBe(true)
})
it.each([['B72',null],[null,'B72'],['B72','B71'],['B71','B72']] as const)('ambiguous same-LI original purposes %s/%s are held without arbitrary first-object selection',async(a,b)=>{
 const p=await pending([{purpose:a},{point:'735123456789012352',purpose:b}],[{purpose:'B72',status:'A74'}]),before=await market(p)
 expect(await validate(p)).toEqual({applied:false,reason:'permission_original_reporting_purpose_unqualified'})
 expect(await market(p)).toEqual(before)
 const result=await apply(p)
 expect(result.applied).toBe(false);expect(result.manifest).toEqual([expect.objectContaining({status:'held',reason:'permission_original_reporting_purpose_unqualified'})])
 expect(await market(p)).toEqual(before)
})
it.each(['B71',null,'B72'])('validate_only checks purpose %s before every permission/site/receipt write',async purpose=>{
 const p=await pending([{purpose:'B72'}],[{purpose,status:'A74'}]),before=await market(p)
 expect(await validate(p)).toEqual(purpose==='B72'?{qualified:true}:{applied:false,reason:'permission_original_reporting_purpose_mismatch'})
 expect(await market(p)).toEqual(before)
})
it('a bad own scope remains held while its same-LI valid sibling commits only its own site and receipt scope',async()=>{
 const second='735123456789012352',p=await pending([{purpose:'B72'},{point:second,purpose:'B72'}],[{purpose:'B71',status:'A74'},{point:second,purpose:'B72',status:'A74'}]),result=await apply(p)
 expect(result.applied).toBe(true);expect(result.status).toBe('partially_approved')
 expect(result.manifest).toEqual([expect.objectContaining({status:'held',reason:'permission_original_reporting_purpose_mismatch'}),expect.objectContaining({status:'applied'})])
 expect((await db.query('SELECT facility_id FROM metering_permission_sites WHERE metering_permission_id=$1',[p.permission])).rows).toEqual([{facility_id:second}])
 expect((await db.query('SELECT object_scopes FROM gridex_received_sources.permission_effect_receipts WHERE source_message_id=$1',[p.sourceId])).rows).toEqual([{object_scopes:[p.scopes[1]]}])
})
it('prescribed Z14N denial remains outside the fresh A74 purpose guard',async()=>{
 const p=await pending([{purpose:'B72'}],[{status:'A13',reason:'Z96'}]),result=await apply(p)
 expect(result).toMatchObject({applied:true,status:'rejected_active'})
 expect((await db.query<{n:number}>('SELECT count(*)::int n FROM metering_permission_sites WHERE metering_permission_id=$1',[p.permission])).rows[0].n).toBe(0)
})
it('fresh Z15 termination preserves its actual prior Z14 and has no new Z14-purpose requirement',async()=>{
 const p=await pending([{purpose:'B72'}],[{purpose:'B72',status:'A74'}]);expect((await apply(p)).applied).toBe(true)
 const sourceId=id(25004),assessment=id(25005),incoming=raw('Z15',[{status:'A74',permissionEnd:'202701010000',endReason:'B77'}])
 await db.query(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status,customer_id) VALUES($1,$2,'test','inbound','PRODAT','Z15',$3,'received',$4)`,[sourceId,company,incoming,customer])
 const z15=await installIncoming({incoming,sourceId,assessment,permission:p.permission,code:'Z15'})
 expect((await apply(z15)).applied).toBe(true)
 expect((await db.query('SELECT qualified_expected_message_code FROM gridex_received_sources.permission_effect_receipts WHERE source_message_id=$1',[sourceId])).rows).toEqual([{qualified_expected_message_code:'Z15'}])
})
it('existing fixed pre-forward result replays without re-evaluating today\'s purpose or legal ports',async()=>{
 const before=(await db.query<{b:unknown}>('SELECT to_jsonb(r) b FROM gridex_received_sources.permission_partition_receipts r WHERE source_message_id=$1',[id(30)])).rows[0].b
 await db.query('DELETE FROM application_fixture WHERE source=$1',[id(30)]);await db.query('DELETE FROM legal_fixture WHERE source=$1',[id(30)])
 expect((await apply({permission:id(10),sourceId:id(30)})).idempotent).toBe(true)
 expect((await db.query<{b:unknown}>('SELECT to_jsonb(r) b FROM gridex_received_sources.permission_partition_receipts r WHERE source_message_id=$1',[id(30)])).rows[0].b).toEqual(before)
})
it('forward replay preserves exact function OID, owner, ACL, configuration and every catalog field except body',async()=>{
 const metadata=async()=>(await db.query(`SELECT to_jsonb(p)-'prosrc' metadata,prosrc FROM pg_proc p WHERE oid=$1::regprocedure`,[signature])).rows[0]
 const before=await metadata();await db.exec(readFileSync(migration,'utf8'))
 expect(await metadata()).toEqual(before)
})
it('an unrecognized function body is refused without replacing it or its metadata',async()=>{
 const f=(await db.query<{body:string;definition:string}>(`SELECT prosrc body,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid=$1::regprocedure`,[signature])).rows[0]
 const altered=f.body+'\n-- independently changed predecessor\n'
 await db.exec(f.definition.replace(f.body,altered))
 const before=(await db.query<{b:unknown}>(`SELECT to_jsonb(p) b FROM pg_proc p WHERE oid=$1::regprocedure`,[signature])).rows[0].b
 await db.exec('SAVEPOINT unknown_body')
 await expect(db.exec(readFileSync(migration,'utf8'))).rejects.toThrow(/permission_original_purpose_predecessor_required/)
 await db.exec('ROLLBACK TO SAVEPOINT unknown_body')
 expect((await db.query<{b:unknown}>(`SELECT to_jsonb(p) b FROM pg_proc p WHERE oid=$1::regprocedure`,[signature])).rows[0].b).toEqual(before)
})
