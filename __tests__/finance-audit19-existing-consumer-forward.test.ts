import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {describe,it,expect} from 'vitest'

// Real source bodies in a structural PostgreSQL fixture. The complete retention
// predicate is intentionally not qualified here: missing audit triggers remain a
// rejection after the finite consumer binding has been checked successfully.
const read=(file:string)=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')
function definition(file:string,name:string){
 const sql=read(file),start=sql.search(new RegExp('create (?:or replace )?function '+name.replaceAll('.','\\.')+'\\(','i'))
 if(start<0)throw Error('Missing original routine: '+name)
 const tail=sql.slice(start),tag=/\bas\s+(\$[a-z_]*\$)/i.exec(tail)
 if(!tag)throw Error('Missing original dollar quote: '+name)
 const end=tail.indexOf(tag[1]+';',tag.index+tag[0].length)
 if(end<0)throw Error('Missing original terminator: '+name)
 return tail.slice(0,end+tag[1].length+1)
}
const fileName='public.gridex_create_invoice_export_file_v1',contractName='gridex_ediel_retention.audit19_source_contract_v1'
const websiteName='private.gridex_complete_tenant_website_receipt_on_launch_ready_v1'
const fileSignature=fileName+'(uuid,text,text,uuid,jsonb,text)',contractSignature=contractName+'(text)',websiteSignature=websiteName+'()'
const fileSQL=definition('20261010100000_nordfin_invoice_file_provider.sql',fileName)
const contractSQL=definition('20261019180400_db05_qualified_audit19_cleanup.sql',contractName)
const websiteSQL=definition('20260815233411_tenant_website_installation_completion_trigger_v1.sql',websiteName)
const paired=()=>read('20261028220418_finance_invoice_file_reference_qualified.sql')
const forward=()=>read('20261028222913_finance_qualify_existing_website_audit_consumer.sql')
const fileHash='fea8868580739ba44f0595fe720e6d7727d107472e6e81497f19cbbf591978f8'
const oldContractHash='c29d375c9a5b0c25aa5655f3444457f1b33e47d93b7be895268b4c7322b10783'
const newContractHash='935084153f171daa9fecd0b03487aaf36cbf99e01857d95c4028668946b10734'
const websiteHash='38666eee982dfe87a8ee40cc5f56077289c947fae631f950cf21f0d5dff35180'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
async function make(){
 const db=new PGlite()
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE ROLE file_owner NOLOGIN;CREATE ROLE contract_owner NOLOGIN;CREATE ROLE website_owner NOLOGIN;CREATE ROLE retention_reader NOLOGIN;
 GRANT USAGE,CREATE ON SCHEMA public TO file_owner;
 CREATE SCHEMA private AUTHORIZATION website_owner;
 CREATE SCHEMA gridex_ediel_retention AUTHORIZATION contract_owner;
 CREATE SCHEMA extensions;
 CREATE TABLE public.companies(id uuid PRIMARY KEY,status text);
 CREATE TABLE public.tenant_website_installation_receipts(id uuid PRIMARY KEY);
 CREATE TABLE public.audit_logs(id bigint PRIMARY KEY,action text);
 CREATE TABLE gridex_ediel_retention.audit19_approvals_v1(id uuid PRIMARY KEY);
 CREATE TABLE public.integration_api_clients(id uuid PRIMARY KEY,company_id uuid,profile_key text,status text,launch_ready boolean,launch_blockers jsonb,metadata jsonb,deleted_at timestamptz,revoked_at timestamptz);
 -- Unattached fixture trigger routines let the unchanged predicate reach its
 -- actual trigger-profile check. They do not qualify the full retention setup.
 CREATE FUNCTION public.gridex_normalize_audit_context_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;
 CREATE FUNCTION public.gridex_guard_history_truncate_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL;END$$;
 CREATE FUNCTION gridex_ediel_retention.audit19_guard_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;
 SET check_function_bodies=off;`)
 await db.exec(fileSQL+'\n'+contractSQL+'\n'+websiteSQL)
 await db.exec(`SET check_function_bodies=on;
 ALTER FUNCTION ${fileSignature} OWNER TO file_owner;
 ALTER FUNCTION ${contractSignature} OWNER TO contract_owner;
 ALTER FUNCTION ${websiteSignature} OWNER TO website_owner;
 REVOKE ALL ON FUNCTION ${fileSignature} FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION ${fileSignature} TO service_role;
 REVOKE ALL ON FUNCTION ${contractSignature} FROM PUBLIC,anon,authenticated,service_role;
 GRANT USAGE ON SCHEMA gridex_ediel_retention TO retention_reader;
 GRANT EXECUTE ON FUNCTION ${contractSignature} TO retention_reader;
 REVOKE ALL ON FUNCTION ${websiteSignature} FROM PUBLIC,anon,authenticated,service_role;
 CREATE TRIGGER integration_api_clients_tenant_website_receipt_completion
 AFTER UPDATE OF launch_ready,launch_blockers,metadata,status ON public.integration_api_clients FOR EACH ROW
 WHEN(new.profile_key='tenant_website' AND new.status='active' AND new.launch_ready IS TRUE)
 EXECUTE FUNCTION ${websiteSignature};`)
 await db.exec(paired())
 return db
}
async function body(db:PGlite,signature:string){const value=(await db.query<{v:string}>('SELECT prosrc v FROM pg_proc WHERE oid=to_regprocedure($1)',[signature])).rows[0]?.v;if(typeof value!=='string')throw Error('Missing exact routine: '+signature);return value}
async function catalog(db:PGlite){return (await db.query<{v:unknown}>(`SELECT jsonb_build_object(
 'procedures',(SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private','gridex_ediel_retention')),
 'roles',(SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r),
 'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','private','gridex_ediel_retention','extensions')),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE tgrelid='public.integration_api_clients'::regclass)) v`)).rows[0].v}
async function allBodies(db:PGlite){return (await db.query<{v:unknown}>(`SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'source',p.prosrc) ORDER BY p.oid) v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private','gridex_ediel_retention')`)).rows[0].v}
async function state(db:PGlite){return (await db.query<{v:unknown}>(`SELECT jsonb_build_object('companies',(SELECT count(*) FROM public.companies),'receipts',(SELECT count(*) FROM public.tenant_website_installation_receipts),'audit',(SELECT count(*) FROM public.audit_logs),'clients',(SELECT count(*) FROM public.integration_api_clients),'approvals',(SELECT count(*) FROM gridex_ediel_retention.audit19_approvals_v1)) v`)).rows[0].v}
async function install(db:PGlite){try{await db.exec(forward())}catch(e){await db.exec('ROLLBACK;SET SESSION AUTHORIZATION postgres;RESET ROLE');throw e}}
async function withDB(run:(db:PGlite)=>Promise<void>){const db=await make();try{await run(db)}finally{await db.close()}}
async function assertFailureUnchanged(db:PGlite,code='42501'){const before=await allBodies(db),metadata=await catalog(db),rows=await state(db);await expect(install(db)).rejects.toMatchObject({code});expect(await allBodies(db)).toEqual(before);expect(await catalog(db)).toEqual(metadata);expect(await state(db)).toEqual(rows)}
async function predicateAsReader(db:PGlite){await db.exec('SET ROLE retention_reader');try{return await db.query(`SELECT ${contractName}('ediel.retention.decision_original_submitted')`)}finally{await db.exec('RESET ROLE')}}

describe('finite binding of the already installed website audit producer',()=>{
 it('qualifies exactly the known producer while preserving every existing pin and remaining predicate',async()=>withDB(async db=>{
  expect(hash(await body(db,fileSignature))).toBe(fileHash)
  expect(hash(await body(db,websiteSignature))).toBe(websiteHash)
  const before=await body(db,contractSignature),website=await body(db,websiteSignature),file=await body(db,fileSignature),metadata=await catalog(db),rows=await state(db)
  expect(hash(before)).toBe(oldContractHash)
  expect((await db.query<{v:boolean}>("SELECT has_schema_privilege('retention_reader','private','USAGE') v")).rows[0].v).toBe(false)
  expect((await db.query<{v:boolean}>("SELECT rolsuper v FROM pg_roles WHERE rolname='retention_reader'")).rows[0].v).toBe(false)
  const predicate=()=>predicateAsReader(db)
  await expect(predicate()).rejects.toMatchObject({code:'42501',message:'audit19_unowned_or_changed_semantic_consumer'})
  await install(db)
  const after=await body(db,contractSignature)
  expect(hash(after)).toBe(newContractHash)
  const oldMap=JSON.parse(before.split('$contracts$')[1]),nextMap=JSON.parse(after.split('$contracts$')[1])
  expect(Object.keys(oldMap)).toHaveLength(91);expect(Object.keys(nextMap)).toHaveLength(92)
  expect(nextMap[websiteName]).toBe(websiteHash);delete nextMap[websiteName];expect(nextMap).toEqual(oldMap)
  const oldSignatures=JSON.parse(before.split('$signatures$')[1]),nextSignatures=JSON.parse(after.split('$signatures$')[1])
  expect(nextSignatures[websiteName]).toBe(websiteSignature);delete nextSignatures[websiteName];expect(nextSignatures).toEqual(oldSignatures)
  const priorIdentity=after.replace(/f\.oid IS DISTINCT FROM \(CASE WHEN f\.name='private\.gridex_complete_tenant_website_receipt_on_launch_ready_v1' THEN \([\s\S]*?\) ELSE to_regprocedure\(signatures->>f\.name\)::oid END\)/,'f.oid IS DISTINCT FROM to_regprocedure(signatures->>f.name)::oid')
  expect(priorIdentity.replace(/\$contracts\$[\s\S]*?\$contracts\$/,'$contracts$MAP$contracts$').replace(/\$signatures\$[\s\S]*?\$signatures\$/,'$signatures$SIGNATURES$signatures$')).toBe(before.replace(/\$contracts\$[\s\S]*?\$contracts\$/,'$contracts$MAP$contracts$').replace(/\$signatures\$[\s\S]*?\$signatures\$/,'$signatures$SIGNATURES$signatures$'))
  // The actual predicate now passes consumer binding and reaches an unchanged
  // fail-closed trigger check absent from this deliberately partial fixture.
  await expect(predicate()).rejects.toMatchObject({code:'42501',message:'audit19_unowned_or_changed_trigger_unsupported'})
  expect(await body(db,websiteSignature)).toBe(website);expect(await body(db,fileSignature)).toBe(file)
  expect(await catalog(db)).toEqual(metadata);expect(await state(db)).toEqual(rows)
  await install(db)
  expect(await body(db,contractSignature)).toBe(after);expect(await catalog(db)).toEqual(metadata);expect(await state(db)).toEqual(rows)
 }),30000)

 it('refuses a changed website producer body instead of attesting arbitrary code',async()=>withDB(async db=>{
  await db.exec('SET check_function_bodies=off;'+websiteSQL.replace('declare\n','declare\n -- changed producer\n')+';SET check_function_bodies=on')
  await assertFailureUnchanged(db)
 }),30000)

 it('refuses a different producer function identity even when the original body survives',async()=>withDB(async db=>{
  await db.exec(`ALTER FUNCTION ${websiteSignature} RENAME TO gridex_complete_tenant_website_receipt_different_v1`)
  await assertFailureUnchanged(db,'42883')
 }),30000)

 it('refuses unexpected producer execute access rather than changing ACLs',async()=>withDB(async db=>{
  await db.exec(`GRANT EXECUTE ON FUNCTION ${websiteSignature} TO service_role`)
  await assertFailureUnchanged(db)
 }),30000)

 it('refuses changed producer security metadata even if its original body is intact',async()=>withDB(async db=>{
  await db.exec(`ALTER FUNCTION ${websiteSignature} SECURITY INVOKER`)
  expect(hash(await body(db,websiteSignature))).toBe(websiteHash)
  await assertFailureUnchanged(db)
 }),30000)

 it('does not exempt another signature with the same private producer name',async()=>withDB(async db=>{
  await install(db)
  await db.exec(`CREATE FUNCTION ${websiteName}(integer) RETURNS text LANGUAGE sql AS $$SELECT 'audit_logs'::text$$`)
  expect((await db.query<{v:boolean}>("SELECT has_schema_privilege('retention_reader','private','USAGE') v")).rows[0].v).toBe(false)
  await expect(predicateAsReader(db)).rejects.toMatchObject({code:'42501',message:'audit19_unowned_or_changed_semantic_consumer'})
 }),30000)

 it('continues to reject producer security drift after its exact body has been qualified',async()=>withDB(async db=>{
  await install(db)
  await db.exec(`ALTER FUNCTION ${websiteSignature} SECURITY INVOKER`)
  expect(hash(await body(db,websiteSignature))).toBe(websiteHash)
  await expect(predicateAsReader(db)).rejects.toMatchObject({code:'42501',message:'audit19_unowned_or_changed_semantic_consumer'})
 }),30000)

 it('refuses an unknown file exporter preimage although the consumer itself is unchanged',async()=>withDB(async db=>{
  await db.exec(fileSQL.replace('DECLARE\n','DECLARE\n -- unqualified exporter\n'))
  await assertFailureUnchanged(db)
 }),30000)

 it('refuses an unknown source-contract body without replacing its catalog',async()=>withDB(async db=>{
  const changed=await body(db,contractSignature)
  const ddl=(await db.query<{v:string}>('SELECT pg_get_functiondef($1::regprocedure) v',[contractSignature])).rows[0].v
  await db.exec(ddl.replace(changed,changed+'\n-- unrelated predicate change\n'))
  await assertFailureUnchanged(db)
 }),30000)

 it.each(['anon','authenticated','service_role'])('denies registration to %s without changing producer or source metadata',async role=>withDB(async db=>{
  const before=await allBodies(db),metadata=await catalog(db),rows=await state(db)
  await db.exec(`SET SESSION AUTHORIZATION ${role}`)
  await expect(install(db)).rejects.toMatchObject({code:'42501'})
  await db.exec('SET SESSION AUTHORIZATION postgres;RESET ROLE')
  expect(await allBodies(db)).toEqual(before);expect(await catalog(db)).toEqual(metadata);expect(await state(db)).toEqual(rows)
 }),30000)
})
