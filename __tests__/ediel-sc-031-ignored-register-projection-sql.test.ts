// masterplan: SC-031
// Actual captured SQL comparator, tokenizer and raw-segment helper in PGlite.
// Canonical-owner output and storage are explicit finite synthetic ports.
// This proves comparator mechanics/catalog preservation, not native authority,
// outgoing-profile acceptance, tenant RBAC, concurrency or GEN capture.
import {afterAll,beforeAll,describe,expect,it} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'

const target='gridex_prodat_object_batch.require_wire_projection_v1(text,jsonb,jsonb,text,uuid)'
const predecessor='6d5e21a429db0d8d1a0e07a08bf391f0ae643118b20ac19d2059490feaf2f500'
const successor='4c9dd19aaa1c28efccd3faa17b04d68272891879859e3212b3746fa71b0ba43a'
const migrationPath=new URL('../supabase/migrations/20261018172327_ediel_sc031_inbound_ignored_register_projection.sql',import.meta.url)
const hash=(v:string)=>createHash('sha256').update(v).digest('hex')
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const COMPANY=id(1),SOURCE=id(2),ACTOR=id(3),ASSESSMENT=id(4)
const POINTS=['735123456789012345','735123456789012346']
// Deliberately malformed SQL/JSON fixture shapes are checked by the real owner.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json=Record<string,any>
type Fixture={raw:string;objects:Json[];registers:Json[][];occurrences:Json[][];values:{qty:string|null;frequency:string|null;product:string|null}[]}
let db:PGlite

function actual(schema:string,name:string){
 const start=schema.indexOf(`CREATE FUNCTION ${name}(`)
 if(start<0)throw Error(`captured_function_missing:${name}`)
 const tail=schema.slice(start),d=/\bAS (\$[A-Za-z_]*\$)/.exec(tail)
 if(!d)throw Error(`captured_body_missing:${name}`)
 const bodyStart=d.index+d[0].length,end=tail.indexOf(d[1]+';',bodyStart)
 if(end<0)throw Error(`captured_body_end_missing:${name}`)
 return{definition:tail.slice(0,end+d[1].length+1),body:tail.slice(bodyStart,end)}
}
async function catalog(){
 const r=await db.query<{metadata:Json;body:string;definition:string;comment:string}>(
  "SELECT to_jsonb(p)-'prosrc' metadata,prosrc body,pg_get_functiondef(p.oid) definition,obj_description(p.oid,'pg_proc') comment FROM pg_proc p WHERE p.oid=$1::regprocedure",[target])
 return r.rows[0]
}
async function state(){
 return(await db.query<{v:Json}>(`SELECT jsonb_build_object(
 'messages',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.ediel_messages x),
 'sources',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY source_message_id),'[]') FROM gridex_received_sources.sources x),
 'facets',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY canonical_assessment_id),'[]') FROM gridex_received_sources.prodat_ignored_field_facets x),
 'canonical_port',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY source_id),'[]') FROM public.application_owner_fixture x)) v`)).rows[0].v
}
async function fixture(fields:string[]=[],later=false):Promise<Fixture>{
 const body=['BGM+Z05+DOC+9']
 let line=0
 const add=(point:string,number:number,extra:string[])=>{
  body.push(`LIN+${++line}++${point}:::9+:R${line}`,`RFF+LI:OWN-LI-${number+1}`,'RFF+Z05:TES')
  if(extra.includes('213'))body.push('QTY+31:777')
  if(extra.includes('222'))body.push('CCI++Z12','CAV+:::D')
  if(extra.includes('242'))body.push('CCI++Z14','CAV+:::L641Q')
  body.push('NAD+UD+5566778899:SE1:260++Synthetic Customer+Street+Town++12345+SE')
 }
 add(POINTS[0],0,fields);if(later)add(POINTS[0],0,fields);add(POINTS[1],1,fields)
 const raw=["UNB+UNOC:3+54321:14+12345:14+261018:1200+I++23-DDQ-PRODAT",'UNH+M+PRODAT:D:97A:UN:E2SE6A',...body,`UNT+${body.length+2}+M`,'UNZ+1+I'].join("'")+"'"
 const {tokens,parts}=(await db.query<{tokens:Json[];parts:string[]}>(
  'SELECT gridex_received_sources.closure_wire_tokens_v2($1) tokens,gridex_prodat_object_batch.raw_segments_v1($1) parts',[raw])).rows[0]
 expect(tokens).not.toBeNull();expect(parts).not.toBeNull()
 const lines=tokens.filter(t=>t.tag==='LIN'),objects:Json[]=[],registers:Json[][]=[],occurrences:Json[][]=[]
 for(let objectIndex=0;objectIndex<2;objectIndex++){
  const ownLines=lines.filter(t=>t.elements[3][0]===POINTS[objectIndex])
  const descriptors=ownLines.map((t,i)=>({segmentIndex:t.index,lineIndex:lines.indexOf(t),lineNumber:t.elements[1][0],registerPosition:i+1,registerIndex:t.elements[4][1]}))
  const own={objectId:POINTS[objectIndex],identityAgency:'9',messageReference:'M',registers:descriptors}
  objects.push(own)
  registers.push(ownLines.map((t,i)=>{
   const end=tokens.find(x=>x.index>t.index&&['LIN','UNT'].includes(x.tag))!.index
   const qty=tokens.find(x=>x.index>t.index&&x.index<end&&x.tag==='QTY'&&x.elements[1][0]==='31')
   return{meteringPointId:own.objectId,identityAgency:'9',lineSequenceNumber:t.elements[1][0],sourceOrder:descriptors[i].lineIndex,registerIndex:t.elements[4][1],annualConsumption:qty?.elements[1][1]??null,rawSegments:parts.slice(t.index,end)}
  }))
  occurrences.push(descriptors.map(r=>({scope:'register',messageReference:'M',lineIndex:r.lineIndex,lineNumber:r.lineNumber,registerPosition:r.registerPosition,objectId:own.objectId,identityAgency:'9',lineItemReference:`OWN-LI-${objectIndex+1}`,ownReferences:{objectId:{kind:'present',value:own.objectId},lineItemReference:{kind:'present',value:`OWN-LI-${objectIndex+1}`},customerId:{kind:'present',value:'5566778899'}}})))
 }
 return{raw,objects,registers,occurrences,values:objects.map(()=>({qty:fields.includes('213')?'777':null,frequency:fields.includes('222')?'D':null,product:fields.includes('242')?'L641Q':null}))}
}
const decisions=(f:Fixture,fields:string[],objectIndex=0,registerIndex=0)=>fields.map(fieldNumber=>({fieldNumber,sourceRule:'PRODAT26A:P119',occurrence:f.occurrences[objectIndex][registerIndex]}))
async function setup(f:Fixture,fields:Json[]=[]){
 await db.exec('DELETE FROM public.application_owner_fixture;DELETE FROM gridex_received_sources.prodat_ignored_field_facets;DELETE FROM gridex_received_sources.sources;DELETE FROM public.ediel_messages')
 const digest=hash(f.raw),app={assessmentId:ASSESSMENT,sourcePayloadHash:digest,objects:f.objects}
 await db.query("INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound','edifact','PRODAT','Z05',$3)",[SOURCE,COMPANY,f.raw])
 await db.query("INSERT INTO gridex_received_sources.sources VALUES($1,$2,'test',$3,$4,'Z05')",[SOURCE,COMPANY,f.raw,digest])
 await db.query('INSERT INTO public.application_owner_fixture VALUES($1,$2,$3,$4)',[COMPANY,SOURCE,digest,app])
 const text=JSON.stringify(fields)
 await db.query("INSERT INTO gridex_received_sources.prodat_ignored_field_facets VALUES($1,$2,'test',$3,$4,$5,$6)",[ASSESSMENT,COMPANY,SOURCE,digest,text,hash(text)])
}
function command(f:Fixture,masked:string[]=[],objectIndex=0):Json{
 const v=f.values[objectIndex],production=!masked.includes('242')&&v.product==='L641Q'
 return{company_id:COMPANY,customer:{full_name:'Synthetic Customer'},site:{facility_id:POINTS[objectIndex],annual_consumption_kwh:masked.includes('213')?null:v.qty===null?null:Number(v.qty),site_type:production?'production':'consumption'},
  metering_point:{meter_point_id:POINTS[objectIndex],measurement_type:production?'production':'consumption',reading_frequency:!masked.includes('222')&&v.frequency==='D'?'daily':'hourly'},
  application:{payload_snapshot:{edielMessageId:SOURCE,prodatRegisters:f.registers[objectIndex]}}}
}
async function invoke(f:Fixture,c=command(f),own=f.objects[0],mode='create_new_customer'){
 const before=await state(),saved=structuredClone(c)
 try{return await db.query('SELECT gridex_prodat_object_batch.require_wire_projection_v1($1,$2,$3,$4,$5)',[f.raw,own,c,mode,ACTOR])}
 finally{expect(c).toEqual(saved);expect(await state()).toEqual(before)}
}
async function updateDecisions(fields:Json[]){const text=JSON.stringify(fields);await db.query('UPDATE gridex_received_sources.prodat_ignored_field_facets SET fields_text=$1,fields_hash=$2',[text,hash(text)])}

beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`CREATE ROLE service_role;CREATE ROLE wire_projection_owner;
 CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_prodat_object_batch;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text);
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,raw_payload text,payload_hash text,message_code text);
 CREATE TABLE gridex_received_sources.prodat_ignored_field_facets(canonical_assessment_id uuid PRIMARY KEY,company_id uuid,environment text,source_message_id uuid,source_payload_hash text,fields_text text,fields_hash text);
 CREATE TABLE public.application_owner_fixture(company_id uuid,source_id uuid,raw_hash text,facet jsonb);
 CREATE TABLE public.grid_owners(id uuid PRIMARY KEY,company_id uuid,owner_code text);
 -- Explicit protected canonical-owner OUTPUT port, not canonical acceptance.
 CREATE FUNCTION gridex_received_sources.require_prodat_application_objects_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE j jsonb;BEGIN
 SELECT a.facet INTO j FROM public.application_owner_fixture a JOIN public.ediel_messages m ON m.id=a.source_id AND m.company_id=a.company_id WHERE a.company_id=$1 AND a.source_id=$2 AND a.raw_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 IF j IS NULL THEN RAISE EXCEPTION 'declared_canonical_owner_output_missing';END IF;RETURN j;END$$;`)
 const schema=readFileSync(process.env.EDIEL_SC031_SCHEMA_FILE??new URL('../supabase/schema.sql',import.meta.url),'utf8')
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_prodat_object_batch.raw_segments_v1'])await db.exec(actual(schema,name).definition)
 const captured=actual(schema,'gridex_prodat_object_batch.require_wire_projection_v1')
 expect([predecessor,successor]).toContain(hash(captured.body))
 // A future ordinary capture contains the postimage. Reconstruct ONLY the
 // authenticated predecessor for RED control; behaviour assertions use SQL.
 let definition=captured.definition
 if(hash(captured.body)===successor){
  let old=captured.body
  for(const line of [" IF '213'=ANY(own_fields) THEN qty:=NULL;END IF;\n"," IF '222'=ANY(own_fields) THEN frequency:=NULL;END IF;\n"," IF '242'=ANY(own_fields) THEN product:=NULL;END IF;\n"])old=old.replace(line,'')
  expect(hash(old)).toBe(predecessor);definition=definition.replace(captured.body,()=>old)
 }
 await db.exec(definition)
 await db.exec(`ALTER FUNCTION ${target} OWNER TO wire_projection_owner;REVOKE ALL ON FUNCTION ${target} FROM PUBLIC;GRANT EXECUTE ON FUNCTION ${target} TO service_role;COMMENT ON FUNCTION ${target} IS 'finite catalog preservation witness';`)
 const before=await catalog();expect(hash(before.body)).toBe(predecessor)
 if(process.env.SC031_IGNORED_PROJECTION_BASELINE!=='1'){
  await db.exec(readFileSync(migrationPath,'utf8'))
  const after=await catalog();expect(hash(after.body)).toBe(successor);expect(after.metadata).toEqual(before.metadata);expect(after.comment).toBe(before.comment)
 }
})
afterAll(async()=>{await db?.close()})

describe.sequential('SC-031 source-owned ignored register SQL projection',()=>{
 it('accepts the clean baseline without changing source bytes, facets or register snapshots',async()=>{const f=await fixture();await setup(f);await invoke(f)})
 it('keeps applicable raw values when no canonical decision ignores them',async()=>{const f=await fixture(['213','222','242']);await setup(f);await invoke(f)})
 it.each(['213','222','242'])('ignores own canonical field %s only in business projection, preserving raw evidence',async field=>{
  const f=await fixture([field]);await setup(f,decisions(f,[field]));await invoke(f,command(f,[field]))
 })
 it('ignores all three own canonical fields together without changing either object or raw register evidence',async()=>{
  const f=await fixture(['213','222','242']);await setup(f,[...decisions(f,['213','222','242']),...decisions(f,['213','222','242'],1)])
  await invoke(f,command(f,['213','222','242']));await invoke(f,command(f,['213','222','242'],1),f.objects[1])
 })
 it.each(['213','222','242'])('refuses business data polluted by ignored field %s',async field=>{
  const f=await fixture([field]);await setup(f,decisions(f,[field]));await expect(invoke(f)).rejects.toThrow(field==='222'?'prodat_object_batch_wire_meter_required':'prodat_object_batch_wire_site_required')
 })
 it.each(['213','222','242'])('does not mask applicable field %s without a canonical decision',async field=>{
  const f=await fixture([field]);await setup(f);await expect(invoke(f,command(f,[field]))).rejects.toThrow(field==='222'?'prodat_object_batch_wire_meter_required':'prodat_object_batch_wire_site_required')
 })
 it('does not interpret an unknown canonical field as a mask',async()=>{
  const f=await fixture(['213','222','242']);await setup(f,decisions(f,['D_UNKNOWN']));await invoke(f)
  await expect(invoke(f,command(f,['213','222','242']))).rejects.toThrow('prodat_object_batch_wire_site_required')
 })
 it('valid other-object decisions never mask the own first register',async()=>{
  const f=await fixture(['213','222','242']);await setup(f,decisions(f,['213','222','242'],1));await invoke(f)
  await expect(invoke(f,command(f,['213','222','242']))).rejects.toThrow('prodat_object_batch_wire_site_required')
 })
 it('valid later-register decisions never mask the own first register',async()=>{
  const f=await fixture(['213','222','242'],true);await setup(f,decisions(f,['213','222','242'],0,1));await invoke(f)
  await expect(invoke(f,command(f,['213','222','242']))).rejects.toThrow('prodat_object_batch_wire_site_required')
 })
 it('own first-register decisions retain every later raw register',async()=>{
  const f=await fixture(['213','222','242'],true);await setup(f,decisions(f,['213','222','242']));await invoke(f,command(f,['213','222','242']))
 })
 it('a valid header decision is nonmatching',async()=>{
  const f=await fixture(['213']);const occurrence={scope:'header',messageReference:'M',lineIndex:null,lineNumber:null,registerPosition:null,objectId:null,identityAgency:null,lineItemReference:null,ownReferences:{objectId:{kind:'unavailable'},lineItemReference:{kind:'unavailable'},customerId:{kind:'unavailable'}}}
  await setup(f,[{fieldNumber:'213',sourceRule:'PRODAT26A:P119',occurrence}]);await invoke(f)
  await expect(invoke(f,command(f,['213']))).rejects.toThrow('prodat_object_batch_wire_site_required')
 })
 it.each(['canonical_assessment_id','company_id','environment','source_message_id','source_payload_hash','fields_hash'])('refuses a detached or corrupted ignored facet %s',async key=>{
  const f=await fixture(['213']);await setup(f,decisions(f,['213']))
  const value=key==='environment'?'production':key.endsWith('hash')?'f'.repeat(64):id(99)
  await db.query(`UPDATE gridex_received_sources.prodat_ignored_field_facets SET ${key}=$1`,[value])
  await expect(invoke(f,command(f,['213']))).rejects.toThrow('prodat_object_batch_ignored_canonical_facet_required')
 })
 it.each(['lineIndex','lineNumber','registerPosition','objectId','identityAgency','messageReference','lineItemReference','ownReferences'])('refuses forged occurrence correlation %s before masking',async key=>{
  const f=await fixture(['213']);const d=decisions(f,['213']);d[0]=structuredClone(d[0])
  d[0].occurrence[key]=['lineIndex','registerPosition'].includes(key)?99:key==='ownReferences'?{objectId:{kind:'present',value:'FOREIGN'}}:'FOREIGN'
  await setup(f,d);await expect(invoke(f,command(f,['213']))).rejects.toThrow(/prodat_object_batch_ignored_field_(physical_)?scope_invalid/)
 })
 it('refuses a forged source-rule or duplicate decision',async()=>{
  const f=await fixture(['213']),d=decisions(f,['213']);await setup(f,[{...d[0],sourceRule:'FORGED'}])
  await expect(invoke(f,command(f,['213']))).rejects.toThrow('prodat_object_batch_ignored_field_scope_invalid')
  await updateDecisions([d[0],d[0]]);await expect(invoke(f,command(f,['213']))).rejects.toThrow('prodat_object_batch_ignored_field_scope_invalid')
 })
 it.each(['sourcePayloadHash','objects'])('refuses detached canonical application %s',async key=>{
  const f=await fixture(['213']);await setup(f,decisions(f,['213']))
  const app={assessmentId:ASSESSMENT,sourcePayloadHash:key==='sourcePayloadHash'?'f'.repeat(64):hash(f.raw),objects:key==='objects'?[{...f.objects[0],objectId:'FOREIGN'}]:f.objects}
  await db.query('UPDATE public.application_owner_fixture SET facet=$1',[app]);await expect(invoke(f,command(f,['213']))).rejects.toThrow('prodat_object_batch_ignored_same_application_required')
 })
 it.each(['direction','company_id','raw_payload'])('refuses changed source message %s',async key=>{
  const f=await fixture(['213']);await setup(f,decisions(f,['213']))
  await db.query(`UPDATE public.ediel_messages SET ${key}=$1`,[key==='direction'?'outbound':key==='company_id'?id(99):f.raw+' '])
  await expect(invoke(f,command(f,['213']))).rejects.toThrow('prodat_object_batch_ignored_same_source_required')
 })
 it.each(['payload_hash','raw_payload','environment'])('refuses changed original source %s',async key=>{
  const f=await fixture(['213']);await setup(f,decisions(f,['213']))
  await db.query(`UPDATE gridex_received_sources.sources SET ${key}=$1`,[key==='payload_hash'?'f'.repeat(64):key==='environment'?'production':f.raw+' '])
  await expect(invoke(f,command(f,['213']))).rejects.toThrow('prodat_object_batch_ignored_same_source_required')
 })
 it.each(['rawSegments','annualConsumption','identityAgency','sourceOrder','registerIndex'])('retains the physical register guard for %s',async key=>{
  const f=await fixture(['213']);await setup(f,decisions(f,['213']));const c=command(f,['213']);c.application.payload_snapshot.prodatRegisters=structuredClone(f.registers[0])
  c.application.payload_snapshot.prodatRegisters[0][key]=key==='rawSegments'?[]:key==='sourceOrder'?99:'FORGED'
  await expect(invoke(f,c)).rejects.toThrow('prodat_object_batch_physical_register_required')
 })
 it('retains command actor binding after ignoring raw fields',async()=>{
  const f=await fixture(['213']);await setup(f,decisions(f,['213']));const c=command(f,['213']);c.customer.created_by=id(99)
  await expect(invoke(f,c)).rejects.toThrow('prodat_object_batch_actor_required')
 })
 it('preserves identity-only linking and refuses a mutation request',async()=>{
  const f=await fixture(['213']);await setup(f);await db.exec('DELETE FROM gridex_received_sources.prodat_ignored_field_facets')
  const c={...command(f),customer:{},site:{facility_id:POINTS[0]},metering_point:{meter_point_id:POINTS[0]},update_existing:false}
  await invoke(f,c,f.objects[0],'link_existing_only');c.update_existing=true
  await expect(invoke(f,c,f.objects[0],'link_existing_only')).rejects.toThrow('prodat_object_batch_link_identity_only_required')
 })
 it('the guarded forward preserves complete pg_proc metadata, OID, owner, ACL and comment on first/repeated execution',async()=>{
  const before=await catalog();await db.exec('BEGIN')
  try{
   await db.exec(readFileSync(migrationPath,'utf8'));const first=await catalog();expect(hash(first.body)).toBe(successor);expect(first.metadata).toEqual(before.metadata);expect(first.comment).toBe(before.comment)
   await db.exec(readFileSync(migrationPath,'utf8'));expect(await catalog()).toEqual(first)
  }finally{await db.exec('ROLLBACK')}
 })
 it('an unknown predecessor refuses before changing body or any metadata',async()=>{
  const before=await catalog(),unknown=before.body+'\n-- declared unknown predecessor control\n'
  await db.exec(before.definition.replace(before.body,()=>unknown))
  try{
   const poisoned=await catalog();await expect(db.exec(readFileSync(migrationPath,'utf8'))).rejects.toThrow('sc031_ignored_projection_unknown_predecessor')
   expect(await catalog()).toEqual(poisoned)
  }finally{await db.exec(before.definition)}
  expect(await catalog()).toEqual(before)
 })
})
