// Finite PGlite component: execute the published before views and the real
// forward migration, preserving aggregate results and raw-ledger privacy.
// Synthetic ledger/receipt rows establish no production history or effect claim.
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {PGlite} from '@electric-sql/pglite'
import {afterEach,describe,expect,it} from 'vitest'

const read=(p:string)=>readFileSync(resolve(p),'utf8')
const governance=read('supabase/migrations/20260803093200_gridex_migration_governance_v3.sql')
const source=read('supabase/migrations/20261013084535_ops_api_staff_deny_and_migration_provenance.sql')
const forward=read('supabase/migrations/20261015183000_ops_migration_provenance_tenant_boundary.sql')
const gate=read('scripts/sql/tenant-isolation-invariants.sql')
const ownerViews=['gridex_migration_governance_v3','ops_migration_provenance_summary_v1']
const helpers=['ops_migration_governance_projection_v1','ops_migration_provenance_projection_v1']
const inputs="array['synthetic reviewed input']::text[]"
let db:PGlite|undefined
afterEach(async()=>{await db?.close();db=undefined})

async function fixture(){
 db=new PGlite()
 await db.exec(`CREATE ROLE fixture_root SUPERUSER;
 SET SESSION AUTHORIZATION fixture_root;
 -- PGlite's bootstrap role must remain a superuser. Rename it before making
 -- the ordinary postgres owner; do not mistake its built-in privilege for proof.
 ALTER ROLE postgres RENAME TO pglite_bootstrap;
 CREATE ROLE postgres NOSUPERUSER NOINHERIT BYPASSRLS;
 CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;
 CREATE ROLE service_role NOLOGIN BYPASSRLS;
 GRANT USAGE,CREATE ON SCHEMA public TO postgres;
 CREATE SCHEMA extensions AUTHORIZATION postgres;
 CREATE SCHEMA supabase_migrations AUTHORIZATION postgres;
 SET ROLE postgres;
 -- Supabase also gives client roles explicit function default grants. The
 -- forward must remove those entries as well as the inherited PUBLIC grant.
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
 -- Canonical postgres TABLE defaults give service ALL on the original
 -- governance view; its immutable donor never revokes that existing grant.
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres,service_role;
 REVOKE ALL ON SCHEMA supabase_migrations FROM PUBLIC,anon,authenticated,service_role;
 -- The finite crypto port delegates only SHA256 to PostgreSQL's native SHA256.
 CREATE FUNCTION extensions.digest(b bytea,algorithm text) RETURNS bytea
 LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS
 $$SELECT CASE WHEN algorithm='sha256' THEN sha256(b) ELSE NULL END$$;
 CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
 REVOKE ALL ON supabase_migrations.schema_migrations FROM PUBLIC,anon,authenticated,service_role;
 CREATE TABLE public.canonical_migration_manifest(version text,filename text,checksum text,
  verified_at timestamptz,effect_verified boolean,verification_kind text,
  applied_ledger_version text,applied_ledger_name text,PRIMARY KEY(version,filename));
 CREATE TABLE public.user_permission_overrides(id uuid);
 CREATE TABLE public.platform_table_classification(table_name text PRIMARY KEY,
  kind text NOT NULL,rationale text NOT NULL,classified_by text NOT NULL);
 INSERT INTO public.platform_table_classification
 SELECT v,'system','Synthetic infrastructure fixture','unit'
 FROM unnest(ARRAY['canonical_migration_manifest','user_permission_overrides','platform_table_classification'])v;
 GRANT SELECT ON public.canonical_migration_manifest TO service_role;`)
 await db.exec(governance)
 await db.exec('BEGIN;'+source.slice(source.indexOf('-- Portable OPS provenance schema.'))+'COMMIT;')
 // Run as the ordinary, NOINHERIT object owner, without PostgreSQL superuser
 // privilege hiding an accidental grant dependency. Root is only the harness.
 await db.exec('SET ROLE postgres')
 return db
}
async function role<T>(name:string,sql:string){
 if(!db)throw Error('fixture missing')
 await db.exec('BEGIN;SET LOCAL ROLE '+name)
 try{return (await db.query<T>(sql)).rows}finally{await db.exec('ROLLBACK')}
}
async function rows(){
 if(!db)throw Error('fixture missing')
 return Promise.all(ownerViews.map(async v=>(await db!.query(`SELECT * FROM public.${v}`)).rows))
}
async function viewMetadata(){
 return (await db!.query(`SELECT c.oid,c.relname,c.relowner,c.relacl,
 a.attnum,a.attname,a.atttypid,a.atttypmod,a.attacl
 FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
 WHERE c.oid IN('public.gridex_migration_governance_v3'::regclass,'public.ops_migration_provenance_summary_v1'::regclass)
 AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.oid,a.attnum`)).rows
}
async function tableState(){
 return (await db!.query(`SELECT to_jsonb(c)relation,
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid=c.oid)policies,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid=c.oid)triggers
 FROM pg_class c WHERE c.oid='public.ops_migration_provenance_receipts'::regclass`)).rows
}
async function surroundings(){
 return Promise.all([
  "SELECT to_jsonb(r)row FROM pg_roles r ORDER BY oid",
  "SELECT to_jsonb(m)row FROM pg_auth_members m ORDER BY oid",
  "SELECT to_jsonb(n)row FROM pg_namespace n WHERE nspname !~ '^pg_(temp|toast_temp)_' ORDER BY oid",
  "SELECT to_jsonb(r)row FROM supabase_migrations.schema_migrations r ORDER BY version",
  "SELECT to_jsonb(r)row FROM public.canonical_migration_manifest r ORDER BY version,filename",
  "SELECT to_jsonb(r)row FROM public.ops_migration_provenance_receipts r ORDER BY receipt_id",
 ].map(async sql=>(await db!.query(sql)).rows))
}
async function seed(kind='exact_input',valid=true){
 await db!.exec(`INSERT INTO supabase_migrations.schema_migrations VALUES('20260101000000','synthetic',${inputs});
 INSERT INTO public.canonical_migration_manifest VALUES('20260101000000','synthetic.sql',repeat('a',64),
 '2026-01-01T00:00:00Z',true,'ledger','20260101000000','synthetic');
 INSERT INTO public.ops_migration_provenance_receipts(receipt_id,project_ref,applied_ledger_version,applied_ledger_name,
 canonical_filename,source_file_sha256,recorded_input_md5,recorded_input_sha256,receipt_kind,
 source_file_git_commit,source_observation_head,current_source_sha256,current_source_git_commit,
 observed_at,effect_scope,effect_verified,effect_evidence)
 SELECT 'synthetic','piidsfebjqjmnepdpnas',version,name,'synthetic.sql',
 ${kind==='exact_input'?(valid?"encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex')":"repeat('b',64)"):"repeat('c',64)"},
 ${valid?"md5(array_to_string(statements,E'\\n'))":"repeat('b',32)"},
 ${valid?"encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex')":"repeat('b',64)"},
 '${kind}',${kind==='exact_input'?'NULL':"repeat('d',40)"},repeat('a',40),
 ${kind==='exact_input'?'NULL':"repeat('e',64)"},${kind==='exact_input'?'NULL':"repeat('f',40)"},
 '2026-01-01T00:00:00Z','${kind==='exact_input'?'input_only':'historical_lineage_only'}',false,'{}'
 FROM supabase_migrations.schema_migrations;`)
}
async function unchangedProjection(){
 const before=await rows(),metadata=await viewMetadata(),receipts=await tableState(),around=await surroundings()
 await db!.exec(forward)
 expect(await rows()).toEqual(before)
 expect(await role('service_role','SELECT * FROM public.gridex_migration_governance_v3')).toEqual(before[0])
 expect(await role('service_role','SELECT * FROM public.ops_migration_provenance_summary_v1')).toEqual(before[1])
 expect(await viewMetadata()).toEqual(metadata)
 expect(await tableState()).toEqual(receipts)
 expect(await surroundings()).toEqual(around)
 return before
}

describe('migration provenance tenant boundary',()=>{
 it('reproduces the three current gate breaches and proves flag-only conversion loses service reads',async()=>{
  await fixture()
  const f6=gate.match(/for v_row in\s+(select c\.relname[\s\S]*?)\s+loop/)?.[1]
  const f13=gate.slice(gate.indexOf('-- F-13:')).match(/for v_row in\s+([\s\S]*?)\s+loop/)?.[1]
  expect(f6).toBeTruthy();expect(f13).toBeTruthy()
  expect((await db!.query(f6!)).rows).toEqual([{relname:'ops_migration_provenance_receipts'}])
  expect((await db!.query<{relname:string}>(f13!)).rows.map((r)=>r.relname).sort()).toEqual([...ownerViews].sort())
  expect((await role('service_role','SELECT * FROM public.gridex_migration_governance_v3')).length).toBe(1)
  await db!.exec('ALTER VIEW public.gridex_migration_governance_v3 SET(security_invoker=true)')
  await expect(role('service_role','SELECT * FROM public.gridex_migration_governance_v3')).rejects.toMatchObject({code:'42501'})
 })

 it('models the authentic distinct governance ALL and summary/receipt SELECT ACLs before and after the forward',async()=>{
  await fixture()
  const profile=async()=>(await db!.query(`SELECT c.relname,
   c.relacl=acldefault('r',c.relowner)||ARRAY[replace((acldefault('r',c.relowner))[1]::text,'postgres=','service_role=')::aclitem]service_all,
   c.relacl=acldefault('r',c.relowner)||ARRAY['service_role=r/postgres'::aclitem]service_select_only
   FROM pg_class c WHERE c.oid IN('public.gridex_migration_governance_v3'::regclass,
    'public.ops_migration_provenance_summary_v1'::regclass,'public.ops_migration_provenance_receipts'::regclass)
   ORDER BY c.relname`)).rows
  const expected=[{relname:'gridex_migration_governance_v3',service_all:true,service_select_only:false},
   {relname:'ops_migration_provenance_receipts',service_all:false,service_select_only:true},
   {relname:'ops_migration_provenance_summary_v1',service_all:false,service_select_only:true}]
  expect(await profile()).toEqual(expected)
  await unchangedProjection()
  expect(await profile()).toEqual(expected)
 })

 it('preserves empty projections and clears the unchanged classification and invoker gate queries',async()=>{
  await fixture();await unchangedProjection()
  const f6=gate.match(/for v_row in\s+(select c\.relname[\s\S]*?)\s+loop/)![1]
  const f13=gate.slice(gate.indexOf('-- F-13:')).match(/for v_row in\s+([\s\S]*?)\s+loop/)![1]
  expect((await db!.query(f6)).rows).toEqual([])
  expect((await db!.query(f13)).rows).toEqual([])
  expect((await db!.query("SELECT kind FROM public.platform_table_classification WHERE table_name='ops_migration_provenance_receipts'")).rows).toEqual([{kind:'system'}])
  expect((await db!.query('SELECT rolsuper,rolinherit FROM pg_roles WHERE rolname=current_user')).rows).toEqual([{rolsuper:false,rolinherit:false}])
  expect((await db!.query(`SELECT pg_get_userbyid(proowner)owner,prosecdef,provolatile,proconfig,proacl
   FROM pg_proc WHERE proname IN('ops_migration_governance_projection_v1','ops_migration_provenance_projection_v1') ORDER BY proname`)).rows).toEqual(helpers.map(()=>({owner:'postgres',prosecdef:true,provolatile:'s',
    proconfig:['search_path=pg_catalog, public, pg_temp'],proacl:['postgres=X/postgres','service_role=X/postgres']})))
  expect((await db!.query(`SELECT has_schema_privilege('anon','public','CREATE')anon,
   has_schema_privilege('authenticated','public','CREATE')authenticated,
   has_schema_privilege('service_role','public','CREATE')service_role`)).rows).toEqual([{anon:false,authenticated:false,service_role:false}])
 })

 it.each([{kind:'exact_input',valid:true},{kind:'exact_input',valid:false},{kind:'historical_source_lineage',valid:true}])('preserves $kind input-match=$valid evidence and readiness',async({kind,valid})=>{
  await fixture();await seed(kind,valid);const before=await unchangedProjection()
  expect(before[0][0]).toMatchObject({is_ready:true,blockers:[]})
  expect(before[1][0]).toMatchObject({receipt_count:1,effect_not_assessed_receipt_count:1,
   exact_input_receipt_count:kind==='exact_input'&&valid?1:0,lineage_receipt_count:kind==='historical_source_lineage'?1:0,
   ledger_versions_without_exact_input_receipt:kind==='exact_input'&&valid?0:1,
   current_bounded_schema_receipt_count:0,full_history_and_effect_qualification_claimed:false})
 })

 it('preserves readiness blockers for unverified, invalid and duplicate ledger mappings',async()=>{
  await fixture();await seed()
  await db!.exec(`UPDATE public.canonical_migration_manifest SET verified_at=NULL,effect_verified=false,checksum='invalid';
   INSERT INTO public.canonical_migration_manifest SELECT version,'synthetic-duplicate.sql',checksum,
    verified_at,effect_verified,verification_kind,applied_ledger_version,applied_ledger_name FROM public.canonical_migration_manifest;
   INSERT INTO supabase_migrations.schema_migrations VALUES('20260102000000','unmapped',ARRAY['other']);`)
  const before=await unchangedProjection()
  expect(before[0][0]).toMatchObject({is_ready:false,blockers:expect.arrayContaining([
   'MIGRATIONS_NOT_FULLY_VERIFIED','MIGRATION_EFFECTS_NOT_FULLY_VERIFIED','MIGRATION_CHECKSUM_INVALID',
   'MIGRATION_LEDGER_UNMAPPED_VERSION','MIGRATION_LEDGER_DUPLICATE_MAPPING'])})
  expect(before[1][0]).toMatchObject({canonical_governance_is_ready:false,full_history_and_effect_qualification_claimed:false})
 })

 it('keeps bounded function evidence sensitive to actual schema changes',async()=>{
  await fixture();await seed()
  for(let i=1;i<=3;i++)await db!.exec(`CREATE FUNCTION public.synthetic_evidence_${i}() RETURNS integer LANGUAGE sql AS $$SELECT ${i}$$`)
  await db!.exec(`ALTER TABLE public.ops_migration_provenance_receipts DISABLE TRIGGER ops_migration_provenance_no_update_delete;
   UPDATE public.ops_migration_provenance_receipts SET effect_scope='current_native_schema',effect_verified=true,
   effect_evidence=jsonb_build_object('native_snapshot',jsonb_build_object('functions',(
    SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'name',p.proname,'oid',p.oid::text,
     'owner',pg_get_userbyid(p.proowner),'arguments',pg_get_function_identity_arguments(p.oid),
     'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
     'volatility',p.provolatile::text,'security_definer',p.prosecdef,'parallel',p.proparallel::text,
     'config',to_jsonb(p.proconfig),'acl',to_jsonb(p.proacl))) FROM pg_proc p WHERE proname LIKE 'synthetic_evidence_%')));
   ALTER TABLE public.ops_migration_provenance_receipts ENABLE TRIGGER ops_migration_provenance_no_update_delete;`)
  const before=await unchangedProjection()
  expect(before[1][0]).toMatchObject({current_bounded_schema_receipt_count:1,changed_bounded_schema_receipt_count:0,full_history_and_effect_qualification_claimed:false})
  await db!.exec('CREATE OR REPLACE FUNCTION public.synthetic_evidence_1() RETURNS integer LANGUAGE sql AS $$SELECT 999$$')
  expect((await rows())[1][0]).toMatchObject({current_bounded_schema_receipt_count:0,changed_bounded_schema_receipt_count:1,full_history_and_effect_qualification_claimed:false})
 })

 it.each(['anon','authenticated'])('denies %s both views, helper RPCs and raw ledger/receipt reads',async name=>{
  await fixture();await db!.exec(forward)
  for(const view of ownerViews)await expect(role(name,`SELECT * FROM public.${view}`)).rejects.toMatchObject({code:'42501'})
  for(const helper of helpers)await expect(role(name,`SELECT * FROM public.${helper}()`)).rejects.toMatchObject({code:'42501'})
  await expect(role(name,'SELECT * FROM supabase_migrations.schema_migrations')).rejects.toMatchObject({code:'42501'})
  await expect(role(name,'SELECT * FROM public.ops_migration_provenance_receipts')).rejects.toMatchObject({code:'42501'})
 })

 it('allows only the prior service aggregate/receipt reads; raw migration SQL and writes remain denied',async()=>{
  await fixture();await seed();await db!.exec(forward)
  await expect(role('service_role','SELECT * FROM supabase_migrations.schema_migrations')).rejects.toMatchObject({code:'42501'})
  expect((await role('service_role','SELECT * FROM public.ops_migration_provenance_receipts')).length).toBe(1)
  for(const helper of helpers)expect((await role('service_role',`SELECT * FROM public.${helper}()`)).length).toBe(1)
  await expect(role('service_role',"DELETE FROM public.ops_migration_provenance_receipts")).rejects.toMatchObject({code:'42501'})
  await expect(db!.exec("DELETE FROM public.ops_migration_provenance_receipts")).rejects.toMatchObject({code:'55000'})
 })

 it.each([
  ['foreign view body',"CREATE OR REPLACE VIEW public.gridex_migration_governance_v3 AS SELECT * FROM public.gridex_migration_governance_v3"],
  ['anonymous view ACL','GRANT SELECT ON public.ops_migration_provenance_summary_v1 TO anon'],
  ['SELECT-only governance ACL','REVOKE ALL ON public.gridex_migration_governance_v3 FROM service_role;GRANT SELECT ON public.gridex_migration_governance_v3 TO service_role'],
  ['receipt client ACL','GRANT SELECT ON public.ops_migration_provenance_receipts TO authenticated'],
  ['wrong classification',"INSERT INTO public.platform_table_classification VALUES('ops_migration_provenance_receipts','tenant','wrong','unit')"],
  ['existing helper',"CREATE FUNCTION public.ops_migration_governance_projection_v1() RETURNS integer LANGUAGE sql AS $$SELECT 1$$"],
 ])('refuses an unknown %s before any permanent effect',async(_name,mutation)=>{
  await fixture();await db!.exec(mutation)
  const snapshot=async()=>({around:await surroundings(),
   classification:(await db!.query('SELECT * FROM public.platform_table_classification ORDER BY table_name')).rows,
   relations:(await db!.query("SELECT to_jsonb(c)row FROM pg_class c WHERE relnamespace='public'::regnamespace ORDER BY oid")).rows,
   functions:(await db!.query("SELECT to_jsonb(p)row FROM pg_proc p WHERE pronamespace='public'::regnamespace ORDER BY oid")).rows})
  const before=await snapshot()
  await expect(db!.exec(forward)).rejects.toThrow('ops_provenance_boundary_')
  await db!.exec('ROLLBACK')
  expect(await snapshot()).toEqual(before)
 })
})
