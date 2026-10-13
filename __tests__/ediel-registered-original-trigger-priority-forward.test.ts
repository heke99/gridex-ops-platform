// Finite PostgreSQL guards from actual checked-in source. The original rows and
// tombstones are declared inputs; no native, legal, storage or issuer approval.
import fs from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {expect,it} from 'vitest'

const schema=fs.readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8')
const migration=fs.readFileSync(new URL('../supabase/migrations/20261013001000_ediel_registered_guard_priority.sql',import.meta.url),'utf8')
const names=['public.gridex_validate_ediel_message_contract','gridex_ediel_inbound_receptions.guard_original_v1',
 'public.ediel_is_qualified_retention_transition_v1','gridex_ediel_retention.public_content_v1']
function definition(name:string){
 const start=schema.indexOf('CREATE FUNCTION '+name+'('),dollar=schema.indexOf('AS $$',start),end=schema.indexOf('$$;',dollar+5)
 if(start<0||dollar<start||end<dollar)throw Error('actual_guard_definition_required:'+name)
 return schema.slice(start,end+3)
}
const definitions=names.map(definition),registeredId='00000000-0000-4000-8000-000000000001',unregisteredId='00000000-0000-4000-8000-000000000002'
const general=definitions[0],registered=definitions[1]
const fields=[...new Set([...general.matchAll(/\b(?:NEW|OLD)\.([a-z_]+)/gi),...registered.matchAll(/\b(?:NEW|OLD)\.([a-z_]+)/gi)].map(x=>x[1]))]
for(const field of ['parsed_payload','validation_report','metadata','updated_at'])if(!fields.includes(field))fields.push(field)
const jsonFields=new Set(['execution_context_snapshot','rule_pack_snapshot','parsed_payload','validation_report','metadata'])
const uuidFields=new Set(['id','company_id','canonical_rule_pack_id','rule_profile_version_id','mailbox_message_id'])
const timeFields=new Set(['message_received_at','immutable_rendered_at','created_at','updated_at'])
type Row=Record<string,unknown>
async function fixture(){
 const db=new PGlite()
 const columns=fields.map(f=>f+' '+(jsonFields.has(f)?'jsonb':uuidFields.has(f)?'uuid':timeFields.has(f)?'timestamptz':'text'))
 await db.exec(`CREATE SCHEMA gridex_ediel_inbound_receptions;CREATE SCHEMA gridex_ediel_retention;CREATE SCHEMA extensions;
  CREATE TABLE public.ediel_messages(${columns.join(',')});
  CREATE TABLE gridex_ediel_inbound_receptions.receptions(source_message_id uuid);
  CREATE TABLE gridex_ediel_retention.blob_tombstones(retention_class text,target_id uuid,company_id uuid,source_hash text,public_content_hash text);`)
 await db.exec(definitions[3]+'\n'+definitions[2]+'\n'+general+'\n'+registered)
 for(const id of [registeredId,unregisteredId])await db.query(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,immutable_payload_hash,execution_context_snapshot,message_received_at,parsed_payload,validation_report,metadata)
  VALUES($1,'00000000-0000-4000-8000-000000000003','test','inbound','edifact','PRODAT','Z05','DECLARED_ORIGINAL','DECLARED_HASH','{"receivedProdatContext":{"declared":true}}','2026-10-12T12:00:00Z','{"original":"declared"}','{"original":"declared"}','{"original":"declared"}')`,[id])
 await db.query('INSERT INTO gridex_ediel_inbound_receptions.receptions VALUES($1)',[registeredId])
 await db.exec(`CREATE TRIGGER ediel_messages_canonical_contract_biu BEFORE INSERT OR UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION public.gridex_validate_ediel_message_contract();
  CREATE TRIGGER registered_reception_original_immutable BEFORE DELETE OR UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_inbound_receptions.guard_original_v1();
  CREATE ROLE declared_guard_reader;GRANT EXECUTE ON FUNCTION gridex_ediel_inbound_receptions.guard_original_v1() TO declared_guard_reader;`)
 return db
}
async function rows(db:PGlite){return(await db.query<{row:Row}>('SELECT to_jsonb(m) AS row FROM public.ediel_messages m ORDER BY id')).rows.map(x=>x.row)}
async function functions(db:PGlite){return(await db.query<{oid:string;metadata:Row}>(`SELECT p.oid::text,to_jsonb(p) AS metadata FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname,p.proname) IN(('public','gridex_validate_ediel_message_contract'),('gridex_ediel_inbound_receptions','guard_original_v1'),('public','ediel_is_qualified_retention_transition_v1'),('gridex_ediel_retention','public_content_v1')) ORDER BY p.oid`)).rows}
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

it('gives the registered owner its unchanged raw/direction/delete refusals and preserves all function/OID/ACL metadata',async()=>{
 const db=await fixture()
 try{
  await refusal(db,rawMutation,'immutable_ediel_payload_cannot_change','23514')
  const before=await rows(db),metadata=await functions(db),old=await triggers(db)
  await db.exec(migration)
  await refusal(db,rawMutation)
  expect(await functions(db)).toEqual(metadata);expect(await rows(db)).toEqual(before)
  const after=await triggers(db)
  expect(after).toEqual(old.map(x=>({metadata:{...(x.metadata as Row),tgname:(x.metadata as Row).tgname==='registered_reception_original_immutable'?'ediel_00_registered_reception_original_immutable':(x.metadata as Row).tgname}})).sort((a,b)=>String(a.metadata.tgname).localeCompare(String(b.metadata.tgname))))
  for(const set of ["raw_payload=raw_payload||'X'","company_id='00000000-0000-4000-8000-000000000004'","environment='production'","direction='outbound'","message_standard='xml'","message_family='UTILTS'","message_code='Z04'","sender_ediel_id='FOREIGN'","receiver_ediel_id='FOREIGN'","application_reference='FOREIGN'","interchange_reference='FOREIGN'","message_received_at=message_received_at+interval '1 second'","mailbox_message_id='00000000-0000-4000-8000-000000000004'"])
   await refusal(db,'UPDATE public.ediel_messages SET '+set+' '+target)
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
  await refusal(db,contentRemoval)
  const mismatches:Record<string,string>[]=[{retention_class:'different_class'},{target_id:unregisteredId},{company_id:'00000000-0000-4000-8000-000000000004'},{source_hash:'f'.repeat(64)},{public_content_hash:'f'.repeat(64)}]
  for(const override of mismatches){
   await tombstone(db,override);await refusal(db,contentRemoval);await db.exec('DELETE FROM gridex_ediel_retention.blob_tombstones')
  }
  await tombstone(db)
  await refusal(db,contentRemoval.replace(' '+target,",direction='outbound' "+target))
  await refusal(db,contentRemoval.replace(' '+target,",immutable_payload_hash='CHANGED' "+target))
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
  if(mismatch==='new_name_collision')await db.exec('CREATE TRIGGER ediel_00_registered_reception_original_immutable BEFORE DELETE OR UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_inbound_receptions.guard_original_v1()')
  if(mismatch==='different_guard_body')await db.exec(registered.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('BEGIN IF','BEGIN /* declared different body */ IF'))
  if(mismatch==='different_guard_search_path')await db.exec('ALTER FUNCTION gridex_ediel_inbound_receptions.guard_original_v1() SET search_path=public')
  if(mismatch==='different_general_body')await db.exec(general.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('BEGIN IF','BEGIN /* declared different body */ IF'))
  const before=await rows(db),metadata=await functions(db),triggerMetadata=await triggers(db)
  await expect(db.exec(migration)).rejects.toThrow('ediel_registered_guard_priority_preimage_required')
  await db.exec('ROLLBACK');expect(await rows(db)).toEqual(before);expect(await functions(db)).toEqual(metadata);expect(await triggers(db)).toEqual(triggerMetadata)
 }finally{await db.close()}
},15000)

it('rolls the completed rename back if a later statement in the same forward transaction fails',async()=>{
 const db=await fixture()
 try{
  const before=await rows(db),metadata=await functions(db),triggerMetadata=await triggers(db)
  const failing=migration.replace(/COMMIT;\s*$/,()=>"DO $$BEGIN RAISE EXCEPTION 'declared_final_failure';END$$;\nCOMMIT;\n")
  await expect(db.exec(failing)).rejects.toThrow('declared_final_failure')
  await db.exec('ROLLBACK');expect(await rows(db)).toEqual(before);expect(await functions(db)).toEqual(metadata);expect(await triggers(db)).toEqual(triggerMetadata)
 }finally{await db.close()}
},15000)
