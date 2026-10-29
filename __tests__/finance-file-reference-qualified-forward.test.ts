import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {describe,it,expect} from 'vitest'

// Actual PostgreSQL routines and forward migration in structural PGlite fixtures.
// No source/financial triggers or complete audit19 consumer catalog are installed;
// this tests atomic migration and file batching, not full retention qualification.
const read=(name:string)=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')
const migration=()=>read('20261028220418_finance_invoice_file_reference_qualified.sql')
function definition(file:string,name:string){
 const sql=read(file),start=sql.search(new RegExp('CREATE (?:OR REPLACE )?FUNCTION '+name.replaceAll('.','\\.')+'\\('))
 if(start<0)throw Error('Required original function missing: '+name)
 const end=sql.indexOf('$$;',sql.indexOf('AS $$',start))
 if(end<0)throw Error('Original function terminator missing: '+name)
 return sql.slice(start,end+3)
}
const fileSQL=definition('20261010100000_nordfin_invoice_file_provider.sql','public.gridex_create_invoice_export_file_v1')
const contractSQL=definition('20261019180400_db05_qualified_audit19_cleanup.sql','gridex_ediel_retention.audit19_source_contract_v1')
const fileSignature='public.gridex_create_invoice_export_file_v1(uuid,text,text,uuid,jsonb,text)'
const contractSignature='gridex_ediel_retention.audit19_source_contract_v1(text)'
const oldFile='26ea8f9fd128c2253d9e3e7a71b7fbd729a1798fe42819f96b0033a37b44b48b'
const newFile='fea8868580739ba44f0595fe720e6d7727d107472e6e81497f19cbbf591978f8'
const oldContract='3125b10daf69038fe4d4c5bd25ba26b34a9fdaeae4c5cbc5d5a0693e1fe0bf3b'
const newContract='c29d375c9a5b0c25aa5655f3444457f1b33e47d93b7be895268b4c7322b10783'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const company='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222'
const itemIds=['33333333-3333-4333-8333-333333333331','33333333-3333-4333-8333-333333333332']
const runIds=['44444444-4444-4444-8444-444444444441','44444444-4444-4444-8444-444444444442']
const invoiceIds=['55555555-5555-4555-8555-555555555551','55555555-5555-4555-8555-555555555552']
const amounts=[{net:'33.74',vat:'8.44',gross:'42.18'},{net:'65.86',vat:'16.47',gross:'82.33'}]
const rows=itemIds.map((id,i)=>({invoice_export_item_id:id,amount_inc_vat:amounts[i].gross,invoice_date:'2026-10-28',due_date:'2026-11-27'}))
async function make(){
 const db=new PGlite()
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE ROLE file_owner NOLOGIN;CREATE ROLE contract_owner NOLOGIN;
 GRANT USAGE,CREATE ON SCHEMA public TO file_owner;
 CREATE SCHEMA gridex_ediel_retention AUTHORIZATION contract_owner;
 CREATE TABLE companies(id uuid PRIMARY KEY,invoice_export_target_system text,billing_provider_environment text,invoice_export_enabled boolean);
 CREATE TABLE invoice_export_runs(id uuid PRIMARY KEY,company_id uuid,provider text,environment text,billing_month text,status text,sent_items integer,finished_at timestamptz,updated_at timestamptz);
 CREATE TABLE invoice_export_items(id uuid PRIMARY KEY,company_id uuid,export_run_id uuid,status text,export_file_id uuid,metadata jsonb,provider_status text,sent_at timestamptz,next_retry_at timestamptz,error_code text,updated_at timestamptz,provider_invoice_guid text);
 CREATE TABLE customer_invoices(id uuid PRIMARY KEY,company_id uuid,invoice_export_item_id uuid,status text,issued_at date,due_date date,partner_invoice_reference text,updated_at timestamptz,invoice_number text,calculation_snapshot jsonb,calculation_snapshot_sha256 text,amount_ex_vat numeric,vat_amount numeric,amount_inc_vat numeric,CONSTRAINT customer_invoices_company_partner_reference_key UNIQUE(company_id,partner_invoice_reference));
 CREATE TABLE invoice_export_files(id uuid PRIMARY KEY,company_id uuid,billing_month text,environment text,provider text,row_count integer,total_inc_vat numeric,rows jsonb,rows_sha256 text,created_by uuid);
 CREATE TABLE audit_logs(id bigserial PRIMARY KEY,company_id uuid,actor_user_id uuid,actor_type text,entity_type text,entity_id text,action text,new_values jsonb,metadata jsonb,resource_type text,resource_id text);
 GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO file_owner;
 GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO file_owner;
 INSERT INTO companies VALUES('${company}','nordfin','test',true);`)
 for(let i=0;i<2;i++){
  await db.query("INSERT INTO invoice_export_runs(id,company_id,provider,environment,billing_month,status,sent_items) VALUES($1,$2,'nordfin','test','2026-09','pending',0)",[runIds[i],company])
  await db.query("INSERT INTO invoice_export_items(id,company_id,export_run_id,status,metadata,provider_invoice_guid) VALUES($1,$2,$3,'pending',$4::jsonb,$5)",[itemIds[i],company,runIds[i],JSON.stringify({approval:{status:'approved',actor:actor,at:'2026-10-28T20:00:00Z'}}),'provider-'+i])
  const snapshot={frozen:true,kwh:i===0?24:48,net:amounts[i].net,vat:amounts[i].vat,gross:amounts[i].gross}
  await db.query("INSERT INTO customer_invoices(id,company_id,invoice_export_item_id,status,invoice_number,calculation_snapshot,calculation_snapshot_sha256,amount_ex_vat,vat_amount,amount_inc_vat) VALUES($1,$2,$3,'draft',$4,$5::jsonb,$6,$7,$8,$9)",[invoiceIds[i],company,itemIds[i],'LEGAL-'+i,JSON.stringify(snapshot),hash(JSON.stringify(snapshot)),amounts[i].net,amounts[i].vat,amounts[i].gross])
 }
 await db.exec(fileSQL+'\n'+contractSQL)
 await db.exec(`ALTER FUNCTION ${fileSignature} OWNER TO file_owner;
 ALTER FUNCTION ${contractSignature} OWNER TO contract_owner;
 REVOKE ALL ON FUNCTION ${fileSignature} FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION ${fileSignature} TO service_role;
 REVOKE ALL ON FUNCTION ${contractSignature} FROM PUBLIC,anon,authenticated,service_role;`)
 return db
}
async function bodies(db:PGlite){return (await db.query<{name:string;body:string}>(`SELECT p.oid::regprocedure::text name,prosrc body FROM pg_proc p WHERE oid IN('${fileSignature}'::regprocedure,'${contractSignature}'::regprocedure) ORDER BY p.oid`)).rows}
async function catalog(db:PGlite){return (await db.query<{v:unknown}>(`SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) FROM pg_proc p WHERE oid IN('${fileSignature}'::regprocedure,'${contractSignature}'::regprocedure)),
 'roles',(SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r),
 'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention'))) v`)).rows[0].v}
async function state(db:PGlite){const out:Record<string,unknown>={};for(const table of ['companies','customer_invoices','invoice_export_items','invoice_export_runs','invoice_export_files','audit_logs'])out[table]=(await db.query<{row:unknown}>(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY id`)).rows.map(x=>x.row);return out}
async function invoke(db:PGlite){return (await db.query<{id:string}>('SELECT public.gridex_create_invoice_export_file_v1($1,$2,$3,$4,$5::jsonb,$6) id',[company,'2026-09','test',actor,JSON.stringify(rows),hash(JSON.stringify(rows))])).rows[0].id}
async function install(db:PGlite){try{await db.exec(migration())}catch(e){await db.exec('ROLLBACK;RESET ROLE;RESET SESSION AUTHORIZATION');throw e}}
async function withDB(run:(db:PGlite)=>Promise<void>){const db=await make();try{await run(db)}finally{await db.close()}}

describe('qualified per-invoice file reference forward migration',()=>{
 it('reproduces original two-invoice rollback then exports one batch after the real paired migration',async()=>withDB(async db=>{
  const before=await state(db),metadata=await catalog(db),old=await bodies(db)
  expect(old.map(v=>hash(v.body))).toEqual([oldFile,oldContract])
  await expect(invoke(db)).rejects.toMatchObject({code:'23505',constraint:'customer_invoices_company_partner_reference_key'})
  expect(await state(db)).toEqual(before)
  await install(db)
  const file=await invoke(db),after=await state(db) as Record<string,Array<Record<string,unknown>>>
  expect(after.invoice_export_files).toHaveLength(1)
  expect(after.invoice_export_files[0]).toMatchObject({id:file,row_count:2,total_inc_vat:124.51,rows})
  expect(after.audit_logs).toHaveLength(1)
  const prior=before.customer_invoices as Array<Record<string,unknown>>
  for(const inv of after.customer_invoices){
   const original=prior.find(x=>x.id===inv.id)!
   expect(inv.partner_invoice_reference).toBe(`file:${file}:item:${inv.invoice_export_item_id}`)
   expect(inv.status).toBe('sent')
   for(const key of ['invoice_number','calculation_snapshot','calculation_snapshot_sha256','amount_ex_vat','vat_amount','amount_inc_vat'])expect(inv[key]).toEqual(original[key])
  }
  expect(new Set(after.customer_invoices.map(v=>v.partner_invoice_reference)).size).toBe(2)
  for(const item of after.invoice_export_items)expect(item).toMatchObject({export_file_id:file,status:'sent',provider_invoice_guid:'provider-'+itemIds.indexOf(item.id as string)})
  expect(await catalog(db)).toEqual(metadata)
  await expect(invoke(db)).rejects.toMatchObject({code:'40001',message:'invoice_file_items_changed'})
  expect(await state(db)).toEqual(after)
 }),30000)

 it('updates exactly the file body and one of91 real consumer pins without changing signatures or other predicates',async()=>withDB(async db=>{
  const before=await bodies(db),metadata=await catalog(db),financial=await state(db)
  await install(db)
  const after=await bodies(db)
  expect(after.map(v=>hash(v.body))).toEqual([newFile,newContract])
  const oldMap=JSON.parse(before[1].body.split('$contracts$')[1]),nextMap=JSON.parse(after[1].body.split('$contracts$')[1])
  expect(Object.keys(nextMap)).toHaveLength(91)
  expect(nextMap['public.gridex_create_invoice_export_file_v1']).toBe(newFile)
  delete oldMap['public.gridex_create_invoice_export_file_v1'];delete nextMap['public.gridex_create_invoice_export_file_v1']
  expect(Object.keys(nextMap)).toHaveLength(90);expect(nextMap).toEqual(oldMap)
  expect(after[1].body.replace(newFile,oldFile)).toBe(before[1].body)
  expect(after[1].body.split('$signatures$')[1]).toBe(before[1].body.split('$signatures$')[1])
  expect(await catalog(db)).toEqual(metadata);expect(await state(db)).toEqual(financial)
  await install(db)
  expect(await bodies(db)).toEqual(after);expect(await catalog(db)).toEqual(metadata);expect(await state(db)).toEqual(financial)
 }),30000)

 it('rejects an unknown file preimage without changing either function or any row',async()=>withDB(async db=>{
  await db.exec(fileSQL.replace('DECLARE\n','DECLARE\n -- unrelated changed consumer\n'))
  const before=await bodies(db),metadata=await catalog(db),financial=await state(db)
  await expect(install(db)).rejects.toMatchObject({code:'42501',message:'finance_file_migration_exact_paired_preimages_required'})
  expect(await bodies(db)).toEqual(before);expect(await catalog(db)).toEqual(metadata);expect(await state(db)).toEqual(financial)
 }),30000)

 it('rejects mixed old file/new pin without silently qualifying a partial installation',async()=>withDB(async db=>{
  await db.exec(contractSQL.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace(oldFile,newFile))
  const before=await bodies(db),metadata=await catalog(db),financial=await state(db)
  await expect(install(db)).rejects.toMatchObject({code:'42501',message:'finance_file_migration_exact_paired_preimages_required'})
  expect(await bodies(db)).toEqual(before);expect(await catalog(db)).toEqual(metadata);expect(await state(db)).toEqual(financial)
 }),30000)

 it.each(['anon','authenticated','service_role'])('refuses installation as %s and leaves existing execute boundary unchanged',async role=>withDB(async db=>{
  const before=await bodies(db),metadata=await catalog(db),financial=await state(db)
  await db.exec(`SET SESSION AUTHORIZATION ${role}`)
  await expect(install(db)).rejects.toMatchObject({code:'42501'})
  // The authenticated test connection is postgres. Restore it explicitly before
  // inspecting private-schema metadata after the denied application session.
  await db.exec('SET SESSION AUTHORIZATION postgres;RESET ROLE')
  expect((await db.query<{actor:string;session:string}>('SELECT current_user actor,session_user session')).rows[0]).toEqual({actor:'postgres',session:'postgres'})
  expect(await bodies(db)).toEqual(before);expect(await catalog(db)).toEqual(metadata);expect(await state(db)).toEqual(financial)
  expect((await db.query<{v:unknown}>(`SELECT jsonb_build_object('anonFile',has_function_privilege('anon','${fileSignature}','EXECUTE'),'authenticatedFile',has_function_privilege('authenticated','${fileSignature}','EXECUTE'),'serviceFile',has_function_privilege('service_role','${fileSignature}','EXECUTE'),'serviceContract',has_function_privilege('service_role','${contractSignature}','EXECUTE')) v`)).rows[0].v).toEqual({anonFile:false,authenticatedFile:false,serviceFile:true,serviceContract:false})
 }),30000)

 it('rejects an unexpected public execute grant rather than repairing permissions implicitly',async()=>withDB(async db=>{
  await db.exec(`GRANT EXECUTE ON FUNCTION ${fileSignature} TO anon`)
  const before=await bodies(db),metadata=await catalog(db),financial=await state(db)
  await expect(install(db)).rejects.toMatchObject({code:'42501',message:'finance_file_migration_exact_port_security_profile_required'})
  expect(await bodies(db)).toEqual(before);expect(await catalog(db)).toEqual(metadata);expect(await state(db)).toEqual(financial)
 }),30000)

 it('rolls back the first replacement when the second function DDL fails',async()=>withDB(async db=>{
  // Declared fault injection in this isolated database, not a production hook.
  await db.exec(`CREATE FUNCTION public.fail_second_finance_ddl() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
   BEGIN IF EXISTS(SELECT FROM pg_event_trigger_ddl_commands() WHERE objid='${contractSignature}'::regprocedure)
   THEN RAISE EXCEPTION 'synthetic_second_function_ddl_failure'; END IF;END$$;
   CREATE EVENT TRIGGER fail_second_finance_ddl ON ddl_command_end WHEN TAG IN('CREATE FUNCTION') EXECUTE FUNCTION public.fail_second_finance_ddl();`)
  const before=await bodies(db),metadata=await catalog(db),financial=await state(db)
  await expect(install(db)).rejects.toMatchObject({message:'synthetic_second_function_ddl_failure'})
  expect(await bodies(db)).toEqual(before);expect(await catalog(db)).toEqual(metadata);expect(await state(db)).toEqual(financial)
 }),30000)
})
