// Finite PostgreSQL guards from actual checked-in source. The original rows and
// tombstones are declared inputs; no native, legal, storage or issuer approval.
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {expect,it} from 'vitest'

const schema=fs.readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8')
const migration=fs.readFileSync(new URL('../supabase/migrations/20261013001000_ediel_registered_guard_priority.sql',import.meta.url),'utf8')
const names=['public.gridex_validate_ediel_message_contract','gridex_ediel_inbound_receptions.guard_original_v1',
 'public.ediel_is_qualified_retention_transition_v1','gridex_ediel_retention.public_content_v1','gridex_ediel_inbound_context.immutable']
function definition(name:string){
 const start=schema.indexOf('CREATE FUNCTION '+name+'('),dollar=schema.indexOf('AS $$',start),end=schema.indexOf('$$;',dollar+5)
 if(start<0||dollar<start||end<dollar)throw Error('actual_guard_definition_required:'+name)
 return schema.slice(start,end+3)
}
const definitions=names.map(definition),registeredId='00000000-0000-4000-8000-000000000001',unregisteredId='00000000-0000-4000-8000-000000000002'
const general=definitions[0],registered=definitions[1]
const fields=[...new Set([...general.matchAll(/\b(?:NEW|OLD)\.([a-z_]+)/gi),...registered.matchAll(/\b(?:NEW|OLD)\.([a-z_]+)/gi)].map(x=>x[1]))]
for(const field of ['parsed_payload','validation_report','metadata','updated_at','status','rule_profile_key'])if(!fields.includes(field))fields.push(field)
const jsonFields=new Set(['execution_context_snapshot','rule_pack_snapshot','parsed_payload','validation_report','metadata'])
const uuidFields=new Set(['id','company_id','canonical_rule_pack_id','rule_profile_version_id','mailbox_message_id'])
const timeFields=new Set(['message_received_at','immutable_rendered_at','created_at','updated_at'])
type Row=Record<string,unknown>
type FixtureOptions={code?:string;subtype?:string;registered?:boolean;basis?:Record<string,unknown>|null;birth?:Record<string,unknown>}
async function fixture(options:FixtureOptions={}){
 const db=new PGlite(),code=options.code??'Z05',subtype=options.subtype??'H'
 const columns=fields.map(f=>f+' '+(jsonFields.has(f)?'jsonb':uuidFields.has(f)?'uuid':timeFields.has(f)?'timestamptz':'text'))
 await db.exec(`CREATE SCHEMA gridex_ediel_inbound_receptions;CREATE SCHEMA gridex_ediel_inbound_context;CREATE SCHEMA gridex_ediel_retention;CREATE SCHEMA extensions;
  CREATE TABLE public.ediel_messages(${columns.join(',')});
  CREATE TABLE gridex_ediel_inbound_receptions.receptions(source_message_id uuid,company_id uuid,environment text,canonical_payload_hash text);
  CREATE TABLE gridex_ediel_inbound_context.receipts(source_message_id uuid,company_id uuid,environment text,direction text,payload_sha256 text,source_received_at timestamptz,status text,context jsonb);
  CREATE TABLE gridex_ediel_retention.blob_tombstones(retention_class text,target_id uuid,company_id uuid,source_hash text,public_content_hash text);
  CREATE ROLE service_role;CREATE ROLE anon;CREATE ROLE authenticated;`)
 await db.exec(definitions[3]+'\n'+definitions[2]+'\n'+general+'\n'+registered+'\n'+definitions[4])
 const company='00000000-0000-4000-8000-000000000003',received='2026-10-12T12:00:00Z',raw='DECLARED_ORIGINAL',hash=createHash('sha256').update(raw).digest('hex')
 for(const id of [registeredId,unregisteredId]){
  const born={version:1,contextOrigin:'database_insert',sourceMessageId:id,companyId:company,environment:'test',messageCode:code,payloadHash:hash,sourceReceivedAt:received,capturedAt:received,...options.birth}
  await db.query(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,immutable_payload_hash,execution_context_snapshot,message_received_at,parsed_payload,validation_report,metadata,status,rule_profile_key)
   VALUES($1,$2,'test','inbound','edifact','PRODAT',$3,$4,$5,$6,$7,'{"original":"declared"}','{"original":"declared"}','{"original":"declared"}','received',$8)`,[id,company,code,raw,hash,{receivedProdatContext:born},received,`PRODAT:${code}:${subtype}:26.A:r3`])
 }
 if(options.registered!==false)await db.query('INSERT INTO gridex_ediel_inbound_receptions.receptions VALUES($1,$2,\'test\',$3)',[registeredId,company,hash])
 if(options.basis!==null){
  const basis={source_message_id:registeredId,company_id:company,environment:'test',direction:'inbound',payload_sha256:hash,source_received_at:received,status:'ready',context:{basisKind:'observed_source_persistence',companyId:company,environment:'test',direction:'inbound',family:'PRODAT',code,subtype},...options.basis}
  await db.query('INSERT INTO gridex_ediel_inbound_context.receipts VALUES($1,$2,$3,$4,$5,$6,$7,$8)',Object.values(basis))
 }
 await db.exec(`CREATE TRIGGER ediel_messages_canonical_contract_biu BEFORE INSERT OR UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION public.gridex_validate_ediel_message_contract();
  CREATE TRIGGER registered_reception_original_immutable BEFORE DELETE OR UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_inbound_receptions.guard_original_v1();
  CREATE TRIGGER immutable_receipts BEFORE DELETE OR UPDATE ON gridex_ediel_inbound_context.receipts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_inbound_context.immutable();
  CREATE ROLE declared_guard_reader;GRANT EXECUTE ON FUNCTION gridex_ediel_inbound_receptions.guard_original_v1() TO declared_guard_reader;
  REVOKE ALL ON SCHEMA gridex_ediel_inbound_context FROM PUBLIC;REVOKE ALL ON SCHEMA gridex_ediel_inbound_receptions FROM PUBLIC;
  GRANT SELECT,UPDATE,DELETE ON public.ediel_messages TO service_role;`)
 return db
}

async function rows(db:PGlite){return(await db.query<{row:Row}>('SELECT to_jsonb(m) AS row FROM public.ediel_messages m ORDER BY id')).rows.map(x=>x.row)}
async function functions(db:PGlite){return(await db.query<{oid:string;metadata:Row}>(`SELECT p.oid::text,to_jsonb(p) AS metadata FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname,p.proname) IN(('public','gridex_validate_ediel_message_contract'),('gridex_ediel_inbound_receptions','guard_original_v1'),('public','ediel_is_qualified_retention_transition_v1'),('gridex_ediel_retention','public_content_v1'),('gridex_ediel_inbound_context','immutable')) ORDER BY p.oid`)).rows}
async function triggers(db:PGlite){return(await db.query<{metadata:Row}>(`SELECT to_jsonb(t) AS metadata FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.ediel_messages'::regclass ORDER BY t.tgname`)).rows}
async function refusal(db:PGlite,statement:string,message='ediel_registered_reception_original_immutable',code='P0001'){
 const before=await rows(db)
 await expect(db.exec(statement)).rejects.toMatchObject({message,code})
 expect(await rows(db)).toEqual(before)
}
const target=`WHERE id='${registeredId}'`
const rawMutation=`UPDATE public.ediel_messages SET raw_payload=raw_payload||'X' ${target}`
const contentRemoval=`UPDATE public.ediel_messages SET raw_payload=NULL,parsed_payload='{}',validation_report='{}',metadata='{}' ${target}`
async function tombstone(db:PGlite,override:Record<string,string>={}){
 await db.exec(`INSERT INTO gridex_ediel_retention.blob_tombstones SELECT 'received_ediel_message_content',id,company_id,
  encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),encode(sha256(convert_to(gridex_ediel_retention.public_content_v1(m)::text,'UTF8')),'hex') FROM public.ediel_messages m ${target}`)
 for(const [key,value] of Object.entries(override))await db.query('UPDATE gridex_ediel_retention.blob_tombstones SET '+key+'=$1',[value])
}

it('gives only qualified H05 raw/direction the registered refusal, keeps every other old tuple/delete refusal and preserves all function/OID/ACL metadata',async()=>{
 const db=await fixture()
 try{
  await refusal(db,rawMutation,'immutable_ediel_payload_cannot_change','23514')
  const before=await rows(db),metadata=await functions(db),old=await triggers(db)
  await db.exec(migration)
  await refusal(db,rawMutation)
  expect(await functions(db)).toEqual(metadata);expect(await rows(db)).toEqual(before)
  const after=await triggers(db)
  expect(after.filter(x=>(x.metadata as Row).tgname!=='ediel_00_registered_h05_original_immutable')).toEqual(old)
  expect(after).toHaveLength(old.length+1)
  for(const set of ["raw_payload=raw_payload||'X'","company_id='00000000-0000-4000-8000-000000000004'","environment='production'","direction='outbound'","message_standard='xml'","message_family='UTILTS'","message_code='Z04'","sender_ediel_id='FOREIGN'","receiver_ediel_id='FOREIGN'","application_reference='FOREIGN'","interchange_reference='FOREIGN'","message_received_at=message_received_at+interval '1 second'","mailbox_message_id='00000000-0000-4000-8000-000000000004'"])
   await refusal(db,'UPDATE public.ediel_messages SET '+set+' '+target, /^(message_standard|message_family|message_code)=/.test(set)?'immutable_ediel_received_context_cannot_change':set.startsWith('message_received_at=')?'immutable_ediel_receipt_time_cannot_change':'ediel_registered_reception_original_immutable', /^(message_standard|message_family|message_code|message_received_at)=/.test(set)?'23514':'P0001')
  await refusal(db,'DELETE FROM public.ediel_messages '+target)
  await refusal(db,`UPDATE public.ediel_messages SET execution_context_snapshot='{"receivedProdatContext":{"changed":true}}' ${target}`,'immutable_ediel_received_context_cannot_change','23514')
  await refusal(db,`UPDATE public.ediel_messages SET raw_payload=raw_payload||'X' WHERE id='${unregisteredId}'`,'immutable_ediel_payload_cannot_change','23514')
  expect(await functions(db)).toEqual(metadata)
 }finally{await db.close()}
},15000)

it('retains actual source-bound tombstone qualification and allows only exact content removal',async()=>{
 const db=await fixture()
 try{
  await db.exec(migration)
  const before=await rows(db),metadata=await functions(db)
  await refusal(db,contentRemoval,'immutable_ediel_payload_cannot_change','23514')
  const mismatches:Record<string,string>[]=[{retention_class:'different_class'},{target_id:unregisteredId},{company_id:'00000000-0000-4000-8000-000000000004'},{source_hash:'f'.repeat(64)},{public_content_hash:'f'.repeat(64)}]
  for(const override of mismatches){
   await tombstone(db,override);await refusal(db,contentRemoval,'immutable_ediel_payload_cannot_change','23514');await db.exec('DELETE FROM gridex_ediel_retention.blob_tombstones')
  }
  await tombstone(db)
  await refusal(db,contentRemoval.replace(' '+target,",direction='outbound' "+target),'immutable_ediel_payload_cannot_change','23514')
  await refusal(db,contentRemoval.replace(' '+target,",immutable_payload_hash='CHANGED' "+target),'immutable_ediel_payload_cannot_change','23514')
  await db.exec('BEGIN');await db.exec(contentRemoval)
  const after=await rows(db),withoutContent=(x:Row)=>Object.fromEntries(Object.entries(x).filter(([key])=>!['raw_payload','parsed_payload','validation_report','metadata','updated_at'].includes(key)))
  expect(after[0]).toMatchObject({raw_payload:null,parsed_payload:{},validation_report:{},metadata:{}})
  expect(withoutContent(after[0])).toEqual(withoutContent(before[0]));expect(after[1]).toEqual(before[1])
  await db.exec('ROLLBACK');expect(await rows(db)).toEqual(before);expect(await functions(db)).toEqual(metadata)
 }finally{await db.close()}
},15000)

for(const mismatch of ['missing_trigger','other_function','disabled_trigger','new_name_collision','different_guard_body','different_guard_search_path','different_general_body'] as const)it('fails closed without changing rows or metadata for '+mismatch,async()=>{
 const db=await fixture()
 try{
  if(mismatch==='missing_trigger')await db.exec('DROP TRIGGER registered_reception_original_immutable ON public.ediel_messages')
  if(mismatch==='other_function')await db.exec('DROP TRIGGER registered_reception_original_immutable ON public.ediel_messages;CREATE TRIGGER registered_reception_original_immutable BEFORE DELETE OR UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION public.gridex_validate_ediel_message_contract()')
  if(mismatch==='disabled_trigger')await db.exec('ALTER TABLE public.ediel_messages DISABLE TRIGGER registered_reception_original_immutable')
  if(mismatch==='new_name_collision')await db.exec('CREATE TRIGGER ediel_00_registered_h05_original_immutable BEFORE DELETE OR UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_inbound_receptions.guard_original_v1()')
  if(mismatch==='different_guard_body')await db.exec(registered.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('BEGIN IF','BEGIN /* declared different body */ IF'))
  if(mismatch==='different_guard_search_path')await db.exec('ALTER FUNCTION gridex_ediel_inbound_receptions.guard_original_v1() SET search_path=public')
  if(mismatch==='different_general_body')await db.exec(general.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('BEGIN IF','BEGIN /* declared different body */ IF'))
  const before=await rows(db),metadata=await functions(db),triggerMetadata=await triggers(db)
  await expect(db.exec(migration)).rejects.toThrow('ediel_registered_guard_priority_preimage_required')
  await db.exec('ROLLBACK');expect(await rows(db)).toEqual(before);expect(await functions(db)).toEqual(metadata);expect(await triggers(db)).toEqual(triggerMetadata)
 }finally{await db.close()}
},15000)

it('rolls both added classifier and early trigger back if a later statement in the same forward transaction fails',async()=>{
 const db=await fixture()
 try{
  const before=await rows(db),metadata=await functions(db),triggerMetadata=await triggers(db)
  const failing=migration.replace(/COMMIT;\s*$/,()=>"DO $$BEGIN RAISE EXCEPTION 'declared_final_failure';END$$;\nCOMMIT;\n")
  await expect(db.exec(failing)).rejects.toThrow('declared_final_failure')
  await db.exec('ROLLBACK');expect(await rows(db)).toEqual(before);expect(await functions(db)).toEqual(metadata);expect(await triggers(db)).toEqual(triggerMetadata)
  expect((await db.query<{classifier:string|null;wrapper:string|null}>("SELECT to_regprocedure('public.ediel_is_received_h05_original_v1(public.ediel_messages)') AS classifier,to_regprocedure('public.ediel_guard_received_h05_original_v1()') AS wrapper")).rows[0]).toEqual({classifier:null,wrapper:null})
 }finally{await db.close()}
},15000)

// The old mandatory native D/H04/L/LK assertions stay unchanged. These finite
// cases execute their exact typed refusals against the corrected source guard.
for(const [label,code,subtype] of [['D','Z04','D'],['H04','Z04','H'],['L','Z05','L'],['LK','Z05','LK']] as const)
 for(const field of ['raw_payload','direction','message_received_at'] as const)it('preserves old '+label+' exact '+field+' refusal under actual service role',async()=>{
  const db=await fixture({code,subtype})
  try{
   const changes={raw_payload:"raw_payload=raw_payload||' '",direction:"direction='outbound'",message_received_at:"message_received_at=message_received_at+interval '1 minute'"}
   const message=field==='raw_payload'?'immutable_ediel_payload_cannot_change':field==='direction'?'immutable_ediel_received_context_cannot_change':'immutable_ediel_receipt_time_cannot_change'
   await refusal(db,'UPDATE public.ediel_messages SET '+changes[field]+' '+target,message,'23514')
   const catalog=await functions(db),oldTriggers=await triggers(db)
   await db.exec(migration);await db.exec('SET ROLE service_role')
   await refusal(db,'UPDATE public.ediel_messages SET '+changes[field]+' '+target,message,'23514')
   await db.exec('RESET ROLE');expect(await functions(db)).toEqual(catalog)
   expect((await triggers(db)).filter(x=>x.metadata.tgname!=='ediel_00_registered_h05_original_immutable')).toEqual(oldTriggers)
  }finally{await db.close()}
 },15000)

it('preserves H04 environment registered refusal and outbound Z08 raw23514 instead of selecting all H or all Z05/Z08',async()=>{
 for(const code of ['Z04','Z08']){
  const db=await fixture({code,subtype:'H',registered:code!=='Z08'})
  try{
   if(code==='Z08')await db.exec('DROP TRIGGER ediel_messages_canonical_contract_biu ON public.ediel_messages;UPDATE public.ediel_messages SET direction=\'outbound\';CREATE TRIGGER ediel_messages_canonical_contract_biu BEFORE INSERT OR UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION public.gridex_validate_ediel_message_contract()')
   await db.exec(migration);await db.exec('SET ROLE service_role')
   await refusal(db,code==='Z04'?"UPDATE public.ediel_messages SET environment='production' "+target:rawMutation,code==='Z04'?'ediel_registered_reception_original_immutable':'immutable_ediel_payload_cannot_change',code==='Z04'?'P0001':'23514')
  }finally{await db.close()}
 }
},15000)

for(const [name,options] of [
 ['missing',{basis:null}],['held',{basis:{status:'held'}}],['copied source',{basis:{source_message_id:unregisteredId}}],
 ['foreign company',{basis:{company_id:'00000000-0000-4000-8000-000000000004'}}],['foreign environment',{basis:{environment:'production'}}],
 ['foreign direction',{basis:{direction:'outbound'}}],['different hash',{basis:{payload_sha256:'f'.repeat(64)}}],
 ['different receipt time',{basis:{source_received_at:'2026-10-12T13:00:00Z'}}],['copied born context',{birth:{sourceMessageId:unregisteredId}}],
 ['no registration',{registered:false}],
] satisfies [string,FixtureOptions][])it('falls back to original23514, without a method claim, for '+name,async()=>{
 const db=await fixture(options)
 try{
  await db.exec(migration);await db.exec('SET ROLE service_role')
  expect((await db.query<{classified:boolean}>('SELECT public.ediel_is_received_h05_original_v1(m) AS classified FROM public.ediel_messages m '+target)).rows[0].classified).toBe(false)
  await refusal(db,rawMutation,'immutable_ediel_payload_cannot_change','23514')
  await refusal(db,"UPDATE public.ediel_messages SET direction='outbound' "+target,'immutable_ediel_received_context_cannot_change','23514')
  await db.exec("UPDATE public.ediel_messages SET status='held' "+target)
  expect((await rows(db))[0].status).toBe('held')
  await db.exec('RESET ROLE');await tombstone(db)
  await db.exec('SET ROLE service_role');await db.exec(contentRemoval)
  expect((await rows(db))[0]).toMatchObject({raw_payload:null,parsed_payload:{},validation_report:{},metadata:{}})
 }finally{await db.close()}
},15000)

it('ignores mutable/caller H flags and refuses changed/copied composite source arguments; new EXECUTE is service_role only',async()=>{
 const db=await fixture({subtype:'L'})
 try{
  await db.exec(migration)
  await db.exec(`UPDATE public.ediel_messages SET status='accepted',rule_profile_key='PRODAT:Z05:H:26.A:r3',parsed_payload='{"subtype":"H"}',validation_report='{"subtype":"H"}',metadata='{"subtype":"H"}',execution_context_snapshot=execution_context_snapshot||'{"subtype":"H","legalContext":{"subtype":"H"}}' ${target}`)
  await db.exec('SET ROLE service_role')
  expect((await db.query<{classified:boolean}>('SELECT public.ediel_is_received_h05_original_v1(m) AS classified FROM public.ediel_messages m '+target)).rows[0].classified).toBe(false)
  await refusal(db,rawMutation,'immutable_ediel_payload_cannot_change','23514')
  await expect(db.query('SELECT * FROM gridex_ediel_inbound_context.receipts')).rejects.toMatchObject({code:'42501'})
  await db.exec('RESET ROLE')
  for(const role of ['anon','authenticated']){
   expect((await db.query<{allowed:boolean}>("SELECT has_function_privilege($1,'public.ediel_is_received_h05_original_v1(public.ediel_messages)','EXECUTE') AS allowed",[role])).rows[0].allowed).toBe(false)
   await db.exec('GRANT SELECT,UPDATE ON public.ediel_messages TO '+role) // Declared table access exercises unchanged legacy guards without granting the new classifier.
   await db.exec('SET ROLE '+role);await expect(db.query("SELECT public.ediel_is_received_h05_original_v1(NULL::public.ediel_messages)")).rejects.toMatchObject({code:'42501'})
   await refusal(db,rawMutation,'immutable_ediel_payload_cannot_change','23514');await db.exec('RESET ROLE')
  }
 }finally{await db.close()}
 const owned=await fixture()
 try{
  await owned.exec(migration);await owned.exec('SET ROLE service_role')
  expect((await owned.query<{classified:boolean}>('SELECT public.ediel_is_received_h05_original_v1(m) AS classified FROM public.ediel_messages m '+target)).rows[0].classified).toBe(true)
  for(const patch of [{id:unregisteredId},{raw_payload:'COPIED_ORIGINAL'},{sender_ediel_id:'FORGED'},{company_id:unregisteredId},{execution_context_snapshot:{receivedProdatContext:{subtype:'H'}}}])
   expect((await owned.query<{classified:boolean}>('SELECT public.ediel_is_received_h05_original_v1(jsonb_populate_record(NULL::public.ediel_messages,to_jsonb(m)||$1::jsonb)) AS classified FROM public.ediel_messages m '+target,[patch])).rows[0].classified).toBe(false)
  await refusal(owned,rawMutation);await refusal(owned,"UPDATE public.ediel_messages SET direction='outbound' "+target)
 }finally{await owned.close()}
},15000)
