// masterplan: DB-05, AT-DB-05
// Actual combined forward with exact installed SQL bodies for issuer HMAC and
// current auth/permission owners. Identity, registry rows and lock-only world
// relations are declared synthetic; no native/concurrent/job admission.
import {createHash,createHmac} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {beforeAll,beforeEach,afterEach,afterAll,it,expect,vi} from 'vitest'
const httpTransport=vi.hoisted(()=>({rpc:vi.fn(),auth:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('next/headers',()=>({cookies:async()=>({get:(key:string)=>key==='gridex_retention_company'?{value:'11111111-1111-4111-8111-111111111111'}:undefined})}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:httpTransport.auth},rpc:httpTransport.rpc})}))
import {NextRequest} from 'next/server'
import {decisionEvidenceReview as httpReview,decisionEvidencePurge as httpPurge,decisionEvidenceRead as httpRead,decisionEvidenceOriginal as httpOriginal} from '@/lib/ediel/retention/decisionEvidenceRetentionHttp'
import {db05PredecessorSchema} from './helpers/db05PredecessorSchema'
const schema=db05PredecessorSchema(readFileSync('supabase/schema.sql','utf8'))
const source6=readFileSync('supabase/migrations/20261019180000_db05_completed_decision_review_reason_retention.sql','utf8')
const c='11111111-1111-4111-8111-111111111111',worker='22222222-2222-4222-8222-222222222222',source='33333333-3333-4333-8333-333333333333',selected='44444444-4444-4444-8444-444444444444',policy='55555555-5555-4555-8555-555555555555',ownReview='66666666-6666-4666-8666-666666666666',reviewer='77777777-7777-4777-8777-777777777777',target='88888888-8888-4888-8888-888888888888',issuer='99999999-9999-4999-8999-999999999999'
const kind='completed_decision_review_reason',key=Buffer.from('ab'.repeat(32),'hex'),hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex')
const fields=['approved_at','company_id','expires_at','policy_id','receipt','receipt_hash','reviewer_user_id','source_commitment','stage']
let db:PGlite
function fn(sql:string,name:string){const start=sql.indexOf('CREATE FUNCTION '+name+'(');if(start<0)throw Error(name);const tail=sql.slice(start),match=/AS (\$[^$]*\$)([\s\S]*?)\1;/.exec(tail)!;return tail.slice(0,match.index+match[0].length)}
const forwardPath='supabase/migrations/20261019180200_db05_completed_witness_field_disposition.sql'
function patched(name:string){
 const text=fn(schema,name),m=/AS (\$[^$]*\$)([\s\S]*?)\1;/.exec(text)!;let body=m[2]
 const spec=JSON.parse(/\$specs\$([\s\S]*?)\$specs\$/.exec(source6)![1]).find((x:{name:string})=>x.name===name)
 if(!spec)return text
 expect(hash(body)).toBe(spec.before)
 for(const change of spec.changes){expect(body.split(change.old)).toHaveLength(change.count+1);body=body.replaceAll(change.old,change.new)}
 expect(hash(body)).toBe(spec.after);return text.replace(m[2],()=>body)
}
// Explicit privileged fixture setup/seed/observation remains separate from
// every full migration transaction, which runs as the genuine NOSUPER installer.
const fixtureAuthoritySQL=`SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r),'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m),'namespaces',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention'))) v`
async function fixtureInstallerIdentity(d:PGlite){
 expect((await d.query(`SELECT current_user c,session_user s,rolsuper,rolinherit,rolcreaterole,rolbypassrls,pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') inherited,pg_has_role('postgres','gridex_ediel_retention_owner','SET') can_set FROM pg_roles WHERE rolname=current_user`)).rows[0]).toEqual({c:'postgres',s:'postgres',rolsuper:false,rolinherit:true,rolcreaterole:true,rolbypassrls:true,inherited:false,can_set:true})
 expect((await d.query<{v:unknown}>(`SELECT jsonb_agg(jsonb_build_array(g.rolname,m.admin_option,m.inherit_option,m.set_option) ORDER BY g.rolname COLLATE "C") v FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE roleid='gridex_ediel_retention_owner'::regrole AND member='postgres'::regrole`)).rows[0].v).toEqual([['postgres',false,false,true],['supabase_admin',true,false,false]])
 expect((await d.query<{v:boolean}>(`SELECT nspowner='gridex_ediel_retention_owner'::regrole::oid v FROM pg_namespace WHERE nspname='gridex_ediel_retention'`)).rows[0].v).toBe(true)
}
async function qualifyFixtureInstaller(d:PGlite){
 // Baseline DDL is a declared projection. Assign its real public/private owners
 // before invoking the installer; this does not grant application capabilities.
 await d.exec(`DO $$DECLARE r record;target name;BEGIN
 FOR r IN SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN('information_schema','auth','public','gridex_ediel_retention') LOOP EXECUTE format('ALTER SCHEMA %I OWNER TO postgres',r.nspname);END LOOP;
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN('information_schema','auth') AND c.relkind IN('r','p','S') LOOP target:=CASE WHEN r.nspname='gridex_ediel_retention' THEN 'gridex_ediel_retention_owner' ELSE 'postgres' END;EXECUTE format('ALTER %s %I.%I OWNER TO %I',CASE WHEN (SELECT relkind FROM pg_class WHERE oid=format('%I.%I',r.nspname,r.relname)::regclass)='S' THEN 'SEQUENCE' ELSE 'TABLE' END,r.nspname,r.relname,target);END LOOP;
 FOR r IN SELECT p.oid::regprocedure signature,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN('information_schema','auth') LOOP target:=CASE WHEN r.nspname='gridex_ediel_retention' OR r.nspname='public' AND r.proname LIKE 'ediel_%' AND r.proname NOT IN('ediel_retention_session_actor_v1','ediel_retention_lock_auth_actor_v1') THEN 'gridex_ediel_retention_owner' ELSE 'postgres' END;EXECUTE format('ALTER FUNCTION %s OWNER TO %I',r.signature,target);END LOOP;
 IF EXISTS(SELECT FROM pg_namespace WHERE nspname='auth') THEN GRANT USAGE ON SCHEMA auth TO postgres;GRANT SELECT,UPDATE,REFERENCES ON ALL TABLES IN SCHEMA auth TO postgres;END IF;
 END$$;
 GRANT USAGE ON SCHEMA gridex_ediel_retention TO postgres;
 GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
 SET SESSION AUTHORIZATION postgres;GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;`)
 await fixtureInstallerIdentity(d)
 await d.exec('SET SESSION AUTHORIZATION supabase_admin')
}
async function installFixtureSQL(d:PGlite,sql:string){
 await d.exec('SET SESSION AUTHORIZATION postgres');await fixtureInstallerIdentity(d)
 const before=(await d.query<{v:unknown}>(fixtureAuthoritySQL)).rows[0].v
 try{await d.exec(sql);await fixtureInstallerIdentity(d);expect((await d.query<{v:unknown}>(fixtureAuthoritySQL)).rows[0].v).toEqual(before);expect((await d.query<{v:string|null}>("SELECT to_regclass('pg_temp.gridex_db05_install_scope') v")).rows[0].v).toBeNull()}
 catch(error){await d.exec('ROLLBACK;SET SESSION AUTHORIZATION supabase_admin');throw error}
 await d.exec('SET SESSION AUTHORIZATION supabase_admin')
}

beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`CREATE ROLE fixture_setup_admin LOGIN SUPERUSER;SET SESSION AUTHORIZATION fixture_setup_admin;ALTER ROLE postgres RENAME TO supabase_admin;SET SESSION AUTHORIZATION supabase_admin;CREATE ROLE postgres LOGIN NOSUPERUSER INHERIT CREATEROLE BYPASSRLS;ALTER DATABASE postgres OWNER TO postgres;ALTER SCHEMA public OWNER TO postgres;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE ROLE gridex_ediel_retention_owner NOLOGIN NOINHERIT BYPASSRLS;CREATE SCHEMA auth;CREATE SCHEMA gridex_requested_changes;CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA gridex_ediel_retention AUTHORIZATION gridex_ediel_retention_owner;CREATE SCHEMA gridex_received_sources;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('fixture.actor',true),'')::uuid$$;
 CREATE TABLE public.companies(id uuid PRIMARY KEY,status text,is_active boolean);
 CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text);
 CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz,PRIMARY KEY(company_id,user_id));
 CREATE TABLE public.permissions(id uuid PRIMARY KEY,key text,name text,is_active boolean);
 CREATE TABLE public.roles(id uuid,key text,name text,is_active boolean);
 CREATE TABLE public.role_permissions(id uuid,role_id uuid,permission_id uuid,permission_key text,effect text);
 CREATE TABLE public.user_roles(id uuid,user_id uuid,company_id uuid,role_id uuid,role text,is_active boolean,status text);
 CREATE TABLE public.user_permissions(id uuid,user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
 CREATE TABLE public.user_permission_overrides(id uuid,user_id uuid,company_id uuid,permission_key text,is_active boolean,effect text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.admin_users(user_id uuid,is_active boolean,role text);
 CREATE TABLE public.customers(id uuid PRIMARY KEY,company_id uuid,legal_hold boolean NOT NULL);CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,customer_id uuid);CREATE TABLE public.ediel_message_payloads(id uuid PRIMARY KEY,company_id uuid,ediel_message_id uuid);`)
 // Actual graphlock body, with remaining lock-only relations explicitly empty.
 const graph=fn(schema,'gridex_ediel_ack_replay.lock_current_graph_v2')
 const list=/LOCK TABLE ([\s\S]*?) IN SHARE MODE;/.exec(graph)![1]
 for(const relation of list.replace(/\s/g,'').split(',')){
  const ns=relation.split('.')[0];await db.exec(`CREATE SCHEMA IF NOT EXISTS ${ns};CREATE TABLE IF NOT EXISTS ${relation}(id uuid)`)
 }
 for(const table of ['decision_evidence_catalog','decision_evidence_policies','decision_evidence_reviews','decision_evidence_revocations','decision_evidence_tombstones','issuers','issuer_revocations','blob_decisions','classification_copy_revocations','contract_copy_revocations','protected_copy_revocations','protected_copy_specs','record_class_catalog']){
  const start=schema.indexOf('CREATE TABLE gridex_ediel_retention.'+table+' ('),end=schema.indexOf('\n);',start)+3;await db.exec(schema.slice(start,end)+`;ALTER TABLE gridex_ediel_retention.${table} OWNER TO gridex_ediel_retention_owner;`)
 }
 await db.exec(source6.slice(source6.indexOf('ALTER TABLE gridex_ediel_retention.decision_evidence_catalog'),source6.indexOf('INSERT INTO gridex_ediel_retention.decision_evidence_catalog')))
 await db.exec('ALTER TABLE gridex_ediel_retention.issuers ADD PRIMARY KEY(id);ALTER TABLE gridex_ediel_retention.issuer_revocations ADD PRIMARY KEY(issuer_id);ALTER TABLE gridex_ediel_retention.issuer_revocations ADD FOREIGN KEY(issuer_id) REFERENCES gridex_ediel_retention.issuers(id);')
 const originalPermission=fn(schema,'gridex_ediel_retention.permission_v1'),permissionAnchor="'ediel.retention.finance_decision_evidence'];",permissionReplacement="'ediel.retention.finance_decision_evidence','ediel.retention.completed_review_reason'];"
 expect(originalPermission.split(permissionAnchor)).toHaveLength(2)
 for(const name of ['gridex_ediel_ack_replay.lock_current_graph_v2','gridex_requested_changes.receipt_hmac_sha256_v1','public.gridex_normalize_platform_role','public.gridex_get_user_permissions_in_company','public.gridex_actor_has_company_permission','gridex_requested_changes.scoped_permission_v1','public.ediel_retention_session_actor_v1','public.ediel_retention_lock_auth_actor_v1','gridex_ediel_retention.permission_v1','gridex_ediel_retention.actor_v1','gridex_ediel_retention.decision_evidence_actor_v1','gridex_ediel_retention.decision_evidence_lock_reviewer_v1','gridex_ediel_retention.decision_evidence_lock_v1','gridex_ediel_retention.revocation_lock_v1'])await db.exec(fn(schema,name))
 const metadataBefore=(await db.query<{v:unknown}>("SELECT to_jsonb(p)-'prosrc' v FROM pg_proc p WHERE oid='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure")).rows[0].v
 const originalBody=/AS (\$[^$]*\$)([\s\S]*?)\1;/.exec(originalPermission)![2]
 const source6Spec=JSON.parse(/\$specs\$([\s\S]*?)\$specs\$/.exec(source6)![1]).find((x:{name:string})=>x.name==='gridex_ediel_retention.permission_v1')
 expect(hash(originalBody)).toBe(source6Spec.before);expect(source6Spec.changes).toEqual([{old:permissionAnchor,new:permissionReplacement,count:1}])
 const patchedPermission=originalPermission.replace(permissionAnchor,permissionReplacement)
 expect(hash(originalBody.replace(permissionAnchor,permissionReplacement))).toBe(source6Spec.after)
 await db.exec(patchedPermission.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 expect((await db.query<{v:unknown}>("SELECT to_jsonb(p)-'prosrc' v FROM pg_proc p WHERE oid='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure")).rows[0].v).toEqual(metadataBefore)
 await db.exec(fn(source6,'gridex_ediel_retention.completed_review_reason_scope_v1'))
 await db.exec('CREATE TRIGGER retention_issuer_revocation_lock BEFORE INSERT ON gridex_ediel_retention.issuer_revocations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.revocation_lock_v1()')
 await db.exec(`CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'received_source_evidence_is_append_only' USING ERRCODE='23514';END$$;`)
 for(const name of ['gridex_ediel_retention.decision_evidence_transition_v1','gridex_ediel_retention.decision_evidence_policies_original_guard_v1','gridex_ediel_retention.record_permission_v1','gridex_ediel_retention.decision_evidence_receipt_v1','gridex_ediel_retention.decision_evidence_policy_current_v1','gridex_ediel_retention.decision_evidence_read_actor_v1','public.ediel_purge_decision_evidence_retention_v1','public.ediel_read_decision_evidence_policy_v1','public.ediel_read_retention_decision_original_v1']){if(!(process.env.DB05_READER_FIXTURE_BASELINE==='1'&&name==='gridex_ediel_retention.record_permission_v1'))await db.exec(patched(name))}
 for(const name of ['basis','terms','transition','guard','read','retire'])await db.exec(fn(source6,'gridex_ediel_retention.completed_review_reason_'+name+'_v1'))
 for(const tab of ['decision_evidence_policies','decision_evidence_reviews','decision_evidence_revocations','decision_evidence_tombstones']){
  const guard=tab==='decision_evidence_policies'?'gridex_ediel_retention.decision_evidence_policies_original_guard_v1':tab==='decision_evidence_reviews'?'gridex_ediel_retention.completed_review_reason_guard_v1':'gridex_received_sources.reject_mutation'
  await db.exec(`CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON gridex_ediel_retention.${tab} FOR EACH ROW EXECUTE FUNCTION ${guard}();`)
 }
 // Actual PK/FK graph for all four leaves and the three typed-copy consumers.
 for(const tab of ['decision_evidence_policies','decision_evidence_reviews'])await db.exec(`ALTER TABLE gridex_ediel_retention.${tab} ADD PRIMARY KEY(id)`)
 await db.exec('ALTER TABLE gridex_ediel_retention.decision_evidence_catalog ADD PRIMARY KEY(retention_class);ALTER TABLE gridex_ediel_retention.decision_evidence_revocations ADD PRIMARY KEY(policy_id);ALTER TABLE gridex_ediel_retention.decision_evidence_tombstones ADD PRIMARY KEY(retention_class,target_id);')
 for(const tab of ['decision_evidence_reviews','decision_evidence_revocations','decision_evidence_tombstones','classification_copy_revocations','contract_copy_revocations','protected_copy_revocations'])await db.exec(`ALTER TABLE gridex_ediel_retention.${tab} ADD FOREIGN KEY(policy_id) REFERENCES gridex_ediel_retention.decision_evidence_policies(id)`)
 for(const tab of ['decision_evidence_tombstones','classification_copy_revocations','contract_copy_revocations','protected_copy_revocations'])await db.exec(`ALTER TABLE gridex_ediel_retention.${tab} ADD FOREIGN KEY(review_id) REFERENCES gridex_ediel_retention.decision_evidence_reviews(id)`)
 for(const tab of ['classification_copy_revocations','contract_copy_revocations','protected_copy_revocations']){
  for(const match of schema.matchAll(new RegExp('ALTER TABLE ONLY gridex_ediel_retention\\.'+tab+'\\n([\\s\\S]*?);','g'))){
   const ddl=match[0];if(/PRIMARY KEY|FOREIGN KEY \(actor_user_id\)|FOREIGN KEY \(retention_class\)/.test(ddl))await db.exec(ddl)
  }
 }
 // Contract/protected copy rows have their complete actual PK+actor/class/
 // policy/review FK shape. Classification's external business-parent fixture
 // remains an explicitly partial identity projection, never native acceptance.
 expect((await db.query<{n:number}>("SELECT count(*)::integer n FROM pg_constraint WHERE contype='p' AND conrelid=ANY(ARRAY['gridex_ediel_retention.classification_copy_revocations'::regclass,'gridex_ediel_retention.contract_copy_revocations'::regclass,'gridex_ediel_retention.protected_copy_revocations'::regclass])")).rows[0].n).toBe(3)
 expect((await db.query<{n:number}>("SELECT count(*)::integer n FROM pg_constraint WHERE contype='f' AND confrelid=ANY(ARRAY['auth.users'::regclass,'gridex_ediel_retention.decision_evidence_catalog'::regclass]) AND conrelid=ANY(ARRAY['gridex_ediel_retention.classification_copy_revocations'::regclass,'gridex_ediel_retention.contract_copy_revocations'::regclass,'gridex_ediel_retention.protected_copy_revocations'::regclass])")).rows[0].n).toBe(6)
 await db.exec('GRANT USAGE ON SCHEMA auth,gridex_ediel_retention,gridex_ediel_ack_replay,gridex_requested_changes,gridex_received_sources TO gridex_ediel_retention_owner;GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public,auth,gridex_ediel_retention TO gridex_ediel_retention_owner;')
 await db.exec("INSERT INTO gridex_ediel_retention.decision_evidence_catalog(retention_class,source_table,permission_key) VALUES('completed_decision_review_reason','decision_evidence_reviews','ediel.retention.completed_review_reason')")
  await qualifyFixtureInstaller(db)
 await installFixtureSQL(db,readFileSync('supabase/migrations/20261019180100_db05_completed_review_witness_consumer_freeze.sql','utf8'))
 if(process.env.DB05_DISPOSITION_BASELINE!=='1')await installFixtureSQL(db,readFileSync(forwardPath,'utf8'))
 if(process.env.DB05_WORKER_DISCOVERY_BASELINE==='1'){
  const installed=(await db.query<{d:string}>("SELECT pg_get_functiondef('public.ediel_advance_completed_witness_disposition_v1(uuid,integer)'::regprocedure) d")).rows[0].d
  const oldPrefix=installed.replace(/ FOR a IN\n  SELECT q\.company_id[\s\S]*? LIMIT p_limit LOOP/,' FOR a IN SELECT company_id,policy_id FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 ORDER BY company_id,policy_id LIMIT p_limit LOOP')
  expect(oldPrefix).not.toBe(installed);await db.exec(oldPrefix)
 }
 if(process.env.DB05_TYPED_REFERENCE_BASELINE==='1'){
  // Deliberately reproduce the old component's policy-only copy exemption.
  const current=(await db.query<{d:string}>("SELECT pg_get_functiondef('gridex_ediel_retention.completed_witness_references_v1(uuid,uuid,uuid)'::regprocedure) d")).rows[0].d
  await db.exec(current.replace("EXECUTE format('SELECT EXISTS(SELECT FROM %s WHERE %I=ANY($1))',f.conrelid::regclass,col) INTO found_reference USING ids;", "EXECUTE format('SELECT EXISTS(SELECT FROM %s WHERE %I=ANY($1) AND NOT(review_id=$2 AND policy_id=$3))',f.conrelid::regclass,col) INTO found_reference USING ids,source_review,parent.id;"))
 }

},30000)
async function many(sql:string,args:unknown[]){for(const statement of sql.split(';').filter(x=>x.trim())){const ids=[...new Set([...statement.matchAll(/\$(\d+)/g)].map(x=>Number(x[1])))];await db.query(statement.replace(/\$(\d+)/g,(_,id)=>'$'+(ids.indexOf(Number(id))+1)),ids.map(id=>args[id-1]))}}
beforeEach(async context=>{
 await db.exec('BEGIN');await db.query(`INSERT INTO public.ediel_messages VALUES($1,$2,NULL)`,[target,c]);await db.query(`INSERT INTO gridex_ediel_retention.blob_decisions(id,company_id,retention_class,target_id,message_id,source_hash,target_hash,document_bytes,document_hash,submitted_by) VALUES($1,$2,'received_ediel_message_content',$1,$1,repeat('a',64),repeat('b',64),convert_to('SYNTHETIC routing underlay','UTF8'),$3,$4)`,[target,c,hash('SYNTHETIC routing underlay'),worker])
 await many(`INSERT INTO public.companies VALUES($1,'active',true);INSERT INTO auth.users VALUES($2,NULL,NULL,clock_timestamp()),($3,NULL,NULL,clock_timestamp());INSERT INTO public.user_profiles VALUES($2,'active'),($3,'active');INSERT INTO public.company_memberships VALUES($1,$2,'active',true,clock_timestamp()),($1,$3,'active',true,clock_timestamp());`,[c,worker,reviewer])
 await db.query(`INSERT INTO public.permissions SELECT gen_random_uuid(),x,x,true FROM unnest($1::text[])x`,[['ediel.retention.purge','ediel.retention.review','ediel.retention.completed_review_reason']])
 for(const actor of [worker,reviewer])await db.query(`INSERT INTO public.user_permissions SELECT gen_random_uuid(),$1,$2,id,key,true,'active','allow' FROM public.permissions`,[actor,c])
 await db.exec(`INSERT INTO gridex_ediel_retention.decision_evidence_catalog(retention_class,source_table,permission_key,revocation_table,revocation_id_column,receipt_function) VALUES('decision_evidence_policy_original_bytes','decision_evidence_policies','ediel.retention.decision_policy_evidence','synthetic','synthetic','synthetic')`);await many(`INSERT INTO public.customers VALUES($1,$2,false);SELECT $3::text`,[target,c,kind])
 await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_policies(id,company_id,retention_class,target_id,source_hash,target_metadata_hash,document_bytes,document_hash,document_byte_length,document_purged_at,submitted_by) VALUES($1,$2,'blob_retention_decision_original_bytes',$3,repeat('a',64),repeat('b',64),NULL,repeat('c',64),20,clock_timestamp(),$4)`,[source,c,target,worker])
 await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_reviews(id,policy_id,actor_user_id,outcome,reason) VALUES($1,$2,$3,'approved','[Retired retention review reason]')`,[selected,source,reviewer])
 await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_tombstones(retention_class,target_id,company_id,policy_id,review_id,source_hash,target_metadata_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference) VALUES('blob_retention_decision_original_bytes',$1,$2,$3,$4,repeat('a',64),repeat('b',64),20,$5,clock_timestamp()-interval '1 day','SYNTHETIC source purpose')`,[target,c,source,selected,worker])
 await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_policies(id,company_id,retention_class,target_id,source_hash,target_metadata_hash,document_bytes,document_hash,submitted_by) SELECT $1,$2,$3,$4,repeat('d',64),gridex_ediel_retention.completed_review_reason_scope_v1($2,$4)->>'targetMetadataHash',convert_to('SYNTHETIC owner underlay','UTF8'),$5,$6`,[policy,c,kind,selected,hash('SYNTHETIC owner underlay'),worker])
 await many(`INSERT INTO gridex_ediel_retention.decision_evidence_reviews(id,policy_id,actor_user_id,outcome,reason) VALUES($1,$2,$3,'approved','SYNTHETIC owner separate review');INSERT INTO gridex_ediel_retention.decision_evidence_revocations(policy_id,actor_user_id,reason) VALUES($2,$4,'SYNTHETIC consumed metadata policy')`,[ownReview,policy,reviewer,worker])
 await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_tombstones(retention_class,target_id,company_id,policy_id,review_id,source_hash,target_metadata_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference) SELECT retention_class,target_id,company_id,id,$1,source_hash,target_metadata_hash,20,$2,clock_timestamp()+$4::interval,'SYNTHETIC finite owner witness' FROM gridex_ediel_retention.decision_evidence_policies WHERE id=$3`,[ownReview,worker,policy,context.task.name.includes('prospective')?'200 milliseconds':'-1 second'])
 await many(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to) VALUES($1,$2,'SYNTHETIC issuer competence',convert_to('SYNTHETIC issuer evidence','UTF8'),$3,$4,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '2 hours');SELECT set_config('fixture.actor',$5,true)`,[issuer,c,hash('SYNTHETIC issuer evidence'),key,reviewer])
})
afterEach(async()=>{await db.exec('ROLLBACK')});afterAll(async()=>{await db.close()})
async function attempt(action:()=>Promise<unknown>){await db.exec('SAVEPOINT owner_attempt');try{const value=await action();await db.exec('RELEASE SAVEPOINT owner_attempt');return{value,error:undefined}}catch(error){await db.exec('ROLLBACK TO SAVEPOINT owner_attempt;RELEASE SAVEPOINT owner_attempt');return{value:undefined,error:error as Error&{code?:string}}}}
async function envelope(change:(p:Record<string,unknown>)=>void=()=>{},short=false){
 const h=(await db.query<{h:string}>('SELECT gridex_ediel_retention.completed_witness_graph_v1($1,$2) h',[c,policy])).rows[0].h,holds=(await db.query<{h:string}>('SELECT gridex_ediel_retention.completed_witness_holds_v1($1) h',[c])).rows[0].h
 const until=new Date(Date.now()+(short?250:300000)).toISOString(),p:Record<string,unknown>={format:'ediel_completed_witness_disposition_bundle_v1',replayScope:'committed_leaf_disposition_only',companyId:c,policyId:policy,sourceCommitment:h,customerScopeHash:holds,issuerLegalReference:'SYNTHETIC issuer competence',issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),approvalUntil:until,executionMode:'delegated_worker',executionActorId:worker,reviewerId:reviewer,W:(await db.query<{w:string}>("SELECT journal_retain_until::text w FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=$1",[policy])).rows[0].w,R:new Date(Date.now()+60000).toISOString(),fields:(await db.query<{f:string[]}>("SELECT gridex_ediel_retention.completed_witness_fields_v1($1,$2) f",[c,policy])).rows[0].f.map(field=>({field,purposeReference:'SYNTHETIC reviewed leaf scope',basisReference:'SYNTHETIC given lawful scope',min:new Date(Date.now()-60000).toISOString(),max:'',reviewBy:until,action:'erase'})),replayFields:[],terminalFields:[],approvalFields:fields.map(field=>({field:'approval.'+field,purposeReference:'SYNTHETIC bounded phase command',basisReference:'SYNTHETIC separately qualified operational scope',min:new Date(Date.now()-1000).toISOString(),max:until,reviewBy:until,action:'consume_or_expire'}))};const W=p.W as string,R=p.R as string;(p.fields as {max:string}[]).forEach(f=>f.max=W);const replay=['replay.company_id','replay.policy_id','replay.replay_until','replay.source_commitment'];p.replayFields=replay.map(field=>({field,purposeReference:'SYNTHETIC finite committed effect reply',basisReference:'SYNTHETIC qualified replay scope',min:new Date(Date.now()-60000).toISOString(),max:R,reviewBy:until,action:'retain_until_R'}));p.terminalFields=replay.map(field=>({field,purposeReference:'SYNTHETIC terminal erase',basisReference:'SYNTHETIC approved terminal scope',min:W,max:R,reviewBy:until,action:'erase'}));change(p)
 const bytes=Buffer.from(JSON.stringify(p));return{issuerId:issuer,payloadBase64:bytes.toString('base64'),signatureHex:createHmac('sha256',key).update(bytes).digest('hex')}
}
async function approve(e:unknown){return(await db.query<{v:unknown}>("SELECT public.ediel_review_completed_witness_disposition_v1($1,$2,$3,'approve',$4) v",[c,reviewer,policy,JSON.stringify(e)])).rows[0].v}
async function purge(){return(await db.query<{v:Record<string,unknown>}>('SELECT public.ediel_purge_decision_evidence_retention_v1($1,$2,$3) v',[c,worker,policy])).rows[0].v}
async function runWorker(){return(await db.query<{v:Record<string,unknown>}>('SELECT public.ediel_advance_completed_witness_disposition_v1($1,20) v',[worker])).rows[0].v}
async function originalSnapshot(){return(await db.query<{v:unknown}>(`SELECT jsonb_build_object('p',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM gridex_ediel_retention.decision_evidence_policies x),'r',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM gridex_ediel_retention.decision_evidence_reviews x),'v',(SELECT jsonb_agg(to_jsonb(x)) FROM gridex_ediel_retention.decision_evidence_revocations x),'t',(SELECT jsonb_agg(to_jsonb(x) ORDER BY policy_id) FROM gridex_ediel_retention.decision_evidence_tombstones x)) v`)).rows[0].v}
async function status(){return(await db.query<{v:unknown}>('SELECT gridex_ediel_retention.completed_witness_status_v1($1,$2,$3) v',[c,worker,policy])).rows[0].v}
async function actor(id=worker){await db.query("SELECT set_config('fixture.actor',$1,true)",[id])}

it('combined actual owner and field forward physically disposes the exact36 fields and creates only committed finite replay',async()=>{
 expect((await db.query<{f:string[]}>('SELECT gridex_ediel_retention.completed_witness_fields_v1($1,$2) f',[c,policy])).rows[0].f).toHaveLength(36)
 const old=await db.query<{h:string}>("SELECT gridex_ediel_retention.completed_review_reason_scope_v1($1,$2)->>'targetMetadataHash' h",[c,selected])
 const e=await envelope(p=>p.executionMode='interactive');expect(await approve(e)).toEqual({status:'approved',authority:'none'});await actor()
 expect(await purge()).toEqual({status:'disposed',replay:false,authority:'none'})
 expect(await purge()).toEqual({status:'disposed',replay:true,authority:'none'})
 expect((await db.query<{reason:string}>('SELECT reason FROM gridex_ediel_retention.decision_evidence_reviews WHERE id=$1',[selected])).rows[0].reason).toBe('')
 expect((await db.query<{n:number}>('SELECT count(*)::integer n FROM gridex_ediel_retention.decision_evidence_policies WHERE id=$1',[policy])).rows[0].n).toBe(0)
 expect((await db.query<{h:string}>("SELECT gridex_ediel_retention.completed_review_reason_scope_v1($1,$2)->>'targetMetadataHash' h",[c,selected])).rows[0].h).toBe(old.rows[0].h)
 expect((await db.query<{n:number}>('SELECT count(*)::integer n FROM gridex_ediel_retention.completed_witness_phase_permits_v1')).rows[0].n).toBe(0)
})

it.each(['signature','domain','company','commitment','customer scope','issuer revoked','issuer expired','current reviewer','same actor','scope36','approval9','terminal4','replay4','finite R','undeclared payload','undeclared envelope'] as const)('actual combined approval refuses %s before authority or physical effect',async control=>{
 const before=await originalSnapshot(),e=await envelope(p=>{
  if(control==='domain')p.format='ediel_retention_decision_original_policy_v1';if(control==='company')p.companyId=target;if(control==='commitment')p.sourceCommitment='f'.repeat(64);if(control==='customer scope')p.customerScopeHash='f'.repeat(64);if(control==='same actor')p.executionActorId=reviewer;
  if(control==='scope36')(p.fields as unknown[]).pop();if(control==='approval9')(p.approvalFields as unknown[]).pop();if(control==='terminal4')(p.terminalFields as unknown[]).pop();if(control==='replay4')(p.replayFields as unknown[]).pop();if(control==='finite R')p.R='infinity';if(control==='undeclared payload')p.reason='not an authority field';
 });if(control==='signature')e.signatureHex='0'.repeat(64);if(control==='undeclared envelope')Object.assign(e,{unneededIdentifier:worker})
 if(control==='issuer revoked')await db.query("INSERT INTO gridex_ediel_retention.issuer_revocations VALUES($1,'SYNTHETIC revocation',clock_timestamp())",[issuer])
 if(control==='issuer expired')await db.exec("UPDATE gridex_ediel_retention.issuers SET valid_to=clock_timestamp()-interval '1 millisecond'")
 if(control==='current reviewer')await db.query('DELETE FROM public.user_permissions WHERE user_id=$1 AND permission_key=$2',[reviewer,'ediel.retention.review'])
 expect((await attempt(()=>approve(e))).error).toBeDefined();expect(await originalSnapshot()).toEqual(before)
 expect((await db.query<{n:number}>('SELECT count(*)::integer n FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1')).rows[0].n).toBe(0)
})
it.each(['purger grant','reviewer grant','issuer revoke','late customer','legal hold','banned actor','membership revoked'] as const)('actual current execution rechecks %s after separate approval and preserves all physical fields',async control=>{
 await approve(await envelope(p=>p.executionMode='interactive'));await actor();const before=await originalSnapshot()
 if(control==='purger grant'||control==='reviewer grant')await db.query('DELETE FROM public.user_permissions WHERE user_id=$1 AND permission_key=$2',[control==='purger grant'?worker:reviewer,control==='purger grant'?'ediel.retention.purge':'ediel.retention.review'])
 if(control==='issuer revoke')await db.query("INSERT INTO gridex_ediel_retention.issuer_revocations VALUES($1,'SYNTHETIC later revoke',clock_timestamp())",[issuer])
 if(control==='late customer')await db.query('INSERT INTO public.customers VALUES(gen_random_uuid(),$1,false)',[c])
 if(control==='legal hold')await db.exec('UPDATE public.customers SET legal_hold=true')
 if(control==='banned actor')await db.query("UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 day' WHERE id=$1",[worker])
 if(control==='membership revoked')await db.query("UPDATE public.company_memberships SET is_active=false WHERE user_id=$1",[worker])
 const result=await attempt(purge);expect(result.error||result.value).toBeDefined();if(!result.error)expect(result.value).toMatchObject({status:'held'})
 expect(await originalSnapshot()).toEqual(before)
 expect((await db.query<{n:number}>('SELECT count(*)::integer n FROM gridex_ediel_retention.completed_witness_replays_v1')).rows[0].n).toBe(0)
})
it.each(['archived','pending_deletion'])('Source6 installed permission remains NO-OP and current explicit retention grants allow %s execution',async companyStatus=>{
 await db.query('UPDATE public.companies SET status=$1,is_active=false',[companyStatus]);await approve(await envelope(p=>p.executionMode='interactive'));await actor();expect(await purge()).toEqual({status:'disposed',replay:false,authority:'none'})
 expect((await db.query<{h:string}>("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') h FROM pg_proc WHERE oid='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure")).rows[0].h).toBe('6bedde3f4c01c504eae815ba0895b0872603dd2f6d8adace45669b640db689c7')
})
it.each(['classification_copy_revocations','contract_copy_revocations','protected_copy_revocations'])('typed mismatch source-q consumer in %s cannot borrow the valid source-parent policy',async table=>{
 await approve(await envelope(p=>p.executionMode='interactive'))
 const classId=table==='classification_copy_revocations'?'classification_id':'target_id',message=table==='classification_copy_revocations'?',source_message_id':'',value=table==='classification_copy_revocations'?',$8':''
 await db.query(`INSERT INTO gridex_ediel_retention.${table}(retention_class,${classId},company_id,policy_id,review_id,source_hash,actor_user_id${message}) VALUES('decision_evidence_policy_original_bytes',$1,$2,$3,$4,repeat('a',64),$5${value.replace('$8','$6')})`,table==='classification_copy_revocations'?[target,c,source,selected,worker,target]:[target,c,source,selected,worker])
 const before=await originalSnapshot();await actor();expect(await purge()).toMatchObject({status:'held'});expect(await originalSnapshot()).toEqual(before)
})
it.each(['M target','Rm target','q target','extra completion q','unknown FK'])('all incoming reference types deny physical effects: %s',async reference=>{
 await approve(await envelope(p=>p.executionMode='interactive'))
 if(reference.endsWith('target')){
  const id=reference==='M target'?policy:reference==='Rm target'?ownReview:selected
  await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_policies(company_id,retention_class,target_id,source_hash,target_metadata_hash,document_bytes,document_hash,submitted_by) VALUES($1,$2,$3,repeat('a',64),repeat('b',64),convert_to('SYNTHETIC consumer','UTF8'),$4,$5)`,[c,kind,id,hash('SYNTHETIC consumer'),worker])
 }else if(reference==='extra completion q')await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_tombstones(retention_class,target_id,company_id,policy_id,review_id,source_hash,target_metadata_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference) VALUES('decision_evidence_policy_original_bytes',gen_random_uuid(),$1,$2,$3,repeat('a',64),repeat('b',64),1,$4,clock_timestamp()+interval '1 hour','SYNTHETIC incompatible completion')`,[c,source,selected,worker])
 else {await db.exec('CREATE TABLE public.synthetic_extra_consumer(review_id uuid REFERENCES gridex_ediel_retention.decision_evidence_reviews(id));GRANT SELECT,UPDATE ON public.synthetic_extra_consumer TO gridex_ediel_retention_owner');await db.query('INSERT INTO public.synthetic_extra_consumer VALUES($1)',[selected])}
 await actor();const before=await originalSnapshot();expect(await purge()).toMatchObject({status:'held'});expect(await originalSnapshot()).toEqual(before)
})
it('real delegated worker commits without auth.uid fabrication and application ACL excludes worker and authority DML',async()=>{
 await approve(await envelope());await actor('');expect(await runWorker()).toMatchObject({scanned:1,disposed:1,expired:0,held:0});expect((await db.query<{u:string|null}>('SELECT auth.uid()::text u')).rows[0].u).toBeNull()
 const acl=(await db.query<{v:unknown}>(`SELECT jsonb_build_object('appWorker',has_function_privilege('authenticated','public.ediel_advance_completed_witness_disposition_v1(uuid,integer)','EXECUTE'),'serviceReview',has_function_privilege('service_role','public.ediel_review_completed_witness_disposition_v1(uuid,uuid,uuid,text,jsonb)','EXECUTE'),'serviceWorker',has_function_privilege('service_role','public.ediel_advance_completed_witness_disposition_v1(uuid,integer)','EXECUTE'),'appRows',has_table_privilege('authenticated','gridex_ediel_retention.completed_witness_phase_authorizations_v1','SELECT'),'serviceWrite',has_table_privilege('service_role','gridex_ediel_retention.completed_witness_phase_permits_v1','INSERT')) v`)).rows[0].v
 expect(acl).toEqual({appWorker:false,serviceReview:false,serviceWorker:true,appRows:false,serviceWrite:false})
})
it('approved then held command expires and operational GC creates no physical effect or disposed receipt',async()=>{
 const e=await envelope(p=>{p.R=new Date(Date.now()+40).toISOString();for(const field of p.replayFields as {max:string}[])field.max=p.R as string;for(const field of p.terminalFields as {max:string}[])field.max=p.R as string},true)
 await approve(e);const before=await originalSnapshot();await db.exec('UPDATE public.customers SET legal_hold=true');await actor('');expect(await runWorker()).toMatchObject({scanned:0,held:0,disposed:0});await db.exec('SELECT pg_sleep(0.3)');expect(await runWorker()).toMatchObject({clearedApprovals:1,disposed:0});expect(await originalSnapshot()).toEqual(before)
 await actor();expect(await purge()).toEqual({status:'purged',replay:true,authority:'none'});expect((await db.query<{n:number}>('SELECT count(*)::integer n FROM gridex_ediel_retention.completed_witness_replays_v1')).rows[0].n).toBe(0)
})
it('physical commit then R-hold denies replay across all read/native/status ports, cleanup never resurrects it',async()=>{
 await approve(await envelope(p=>{p.executionMode='interactive';p.R=new Date(Date.now()+150).toISOString();for(const f of p.replayFields as {max:string}[])f.max=p.R as string;for(const f of p.terminalFields as {max:string}[])f.max=p.R as string}));await actor();expect(await purge()).toMatchObject({status:'disposed',replay:false});await db.exec('UPDATE public.customers SET legal_hold=true;SELECT pg_sleep(0.2)');expect(await purge()).toEqual({status:'unavailable',authority:'none'});expect(await status()).toEqual({status:'unavailable',authority:'none'})
 for(const sql of ['SELECT gridex_ediel_retention.completed_review_reason_basis_v1($1,$2)','SELECT gridex_ediel_retention.completed_review_reason_read_v1($1,$2,false)'])expect((await attempt(()=>db.query(sql,[c,selected]))).error?.code).toBe('42501')
 for(const sql of ['SELECT public.ediel_read_decision_evidence_policy_v1($1,$2,$3,false)','SELECT public.ediel_read_retention_decision_original_v1($1,$2,\'decision_evidence_policy_original_bytes\',$3,false)'])expect((await attempt(()=>db.query(sql,[c,worker,policy]))).error).toBeDefined()
 await db.exec('UPDATE public.customers SET legal_hold=false');expect(await purge()).toEqual({status:'expired',authority:'none'});expect(await purge()).toEqual({status:'unavailable',authority:'none'});expect(await status()).toEqual({status:'unavailable',authority:'none'})
})
it('a late actual delete-trigger failure rolls back source-zero, four-row erasure, projection and approval-stage atomically',async()=>{
 await approve(await envelope(p=>p.executionMode='interactive'));await actor();const before=await originalSnapshot()
 await db.exec(`CREATE FUNCTION public.synthetic_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic late native failure';END$$;CREATE TRIGGER synthetic_late_failure AFTER DELETE ON gridex_ediel_retention.decision_evidence_policies FOR EACH ROW EXECUTE FUNCTION public.synthetic_late_failure()`)
 expect((await attempt(purge)).error?.message).toContain('synthetic late native failure');expect(await originalSnapshot()).toEqual(before)
 expect((await db.query<{n:number}>('SELECT count(*)::integer n FROM gridex_ediel_retention.completed_witness_replays_v1')).rows[0].n).toBe(0);expect((await db.query<{stage:string}>('SELECT stage FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1')).rows[0].stage).toBe('dispose')
})
it.each(['x','[Retired retention review reason]','x'.repeat(4000),'å'.repeat(4000)])('legitimate original intake reason stays intact while zero intake and ordinary updates refuse: length%s',async reason=>{
 const id=(await db.query<{id:string}>(`INSERT INTO gridex_ediel_retention.decision_evidence_reviews(policy_id,actor_user_id,outcome,reason) VALUES($1,$2,'held',$3) RETURNING id`,[source,reviewer,reason])).rows[0].id
 expect((await db.query<{reason:string}>('SELECT reason FROM gridex_ediel_retention.decision_evidence_reviews WHERE id=$1',[id])).rows[0].reason).toBe(reason)
 const original=(await db.query<{v:{documentBase64:string;bytesAvailable:boolean}}>('SELECT gridex_ediel_retention.completed_review_reason_read_v1($1,$2,true) v',[c,id])).rows[0].v;expect(original.bytesAvailable).toBe(true);expect(Buffer.from(original.documentBase64,'base64').toString('utf8')).toBe(reason)
 expect((await attempt(()=>db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_reviews(policy_id,actor_user_id,outcome,reason) VALUES($1,$2,'held','')`,[source,reviewer]))).error?.code).toBe('23514')
 expect((await attempt(()=>db.query("UPDATE gridex_ediel_retention.decision_evidence_reviews SET reason='' WHERE id=$1",[id]))).error?.code).toBe('23514')
})

async function terminalEnvelope(change:(p:Record<string,unknown>)=>void=()=>{}){
 const r=(await db.query<{source_commitment:string;replay_until:string}>('SELECT source_commitment,replay_until::text FROM gridex_ediel_retention.completed_witness_replays_v1 WHERE company_id=$1 AND policy_id=$2',[c,policy])).rows[0],until=new Date(Date.now()+300000).toISOString()
 const p:Record<string,unknown>={format:'ediel_completed_witness_disposition_bundle_v1',replayScope:'committed_leaf_disposition_only',companyId:c,policyId:policy,sourceCommitment:r.source_commitment,customerScopeHash:(await db.query<{h:string}>('SELECT gridex_ediel_retention.completed_witness_holds_v1($1) h',[c])).rows[0].h,issuerLegalReference:'SYNTHETIC issuer competence',issuedAt:new Date(Date.now()-100).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),approvalUntil:until,executionMode:'interactive',executionActorId:worker,reviewerId:reviewer,W:r.replay_until,R:r.replay_until,fields:[],replayFields:[],terminalFields:['replay.company_id','replay.policy_id','replay.replay_until','replay.source_commitment'].map(field=>({field,purposeReference:'SYNTHETIC explicit overdue terminal cleanup',basisReference:'SYNTHETIC given terminal qualification',min:r.replay_until,max:r.replay_until,reviewBy:until,action:'erase'})),approvalFields:fields.map(field=>({field:'approval.'+field,purposeReference:'SYNTHETIC finite recovery command',basisReference:'SYNTHETIC given qualification',min:new Date(Date.now()-1000).toISOString(),max:until,reviewBy:until,action:'consume_or_expire'}))};change(p);const bytes=Buffer.from(JSON.stringify(p));return{issuerId:issuer,payloadBase64:bytes.toString('base64'),signatureHex:createHmac('sha256',key).update(bytes).digest('hex')}
}
async function overdueCommitted(){
 await approve(await envelope(p=>{p.executionMode='interactive';p.R=new Date(Date.now()+60).toISOString();for(const f of p.replayFields as {max:string}[])f.max=p.R as string;for(const f of p.terminalFields as {max:string}[])f.max=p.R as string},true));await actor();expect(await purge()).toMatchObject({status:'disposed',replay:false});await db.exec('UPDATE public.customers SET legal_hold=true;SELECT pg_sleep(0.3)');await actor('');expect(await runWorker()).toMatchObject({clearedApprovals:1,disposed:0,expired:0});await actor();expect(await purge()).toEqual({status:'unavailable',authority:'none'});expect((await db.query<{n:number}>('SELECT count(*)::integer n FROM gridex_ediel_retention.completed_witness_replays_v1')).rows[0].n).toBe(1)
}
it('expired terminal approval GC preserves logical refusal, explicit fresh terminal review cleans only surviving four fields',async()=>{
 await overdueCommitted();await db.exec('UPDATE public.customers SET legal_hold=false');const e=await terminalEnvelope();await actor(reviewer);expect(await approve(e)).toEqual({status:'approved',authority:'none'});await actor();expect(await purge()).toEqual({status:'expired',authority:'none'});expect(await purge()).toEqual({status:'unavailable',authority:'none'});expect((await attempt(()=>approve(e))).error).toBeDefined()
})
it.each(['stale commitment','foreign tenant','new replay','revoked issuer','missing terminal field','held','revoked approval'])('fresh overdue terminal admission refuses %s and cannot recreate replay authority',async control=>{
 await overdueCommitted();await db.exec('UPDATE public.customers SET legal_hold=false');const e=await terminalEnvelope(p=>{if(control==='stale commitment')p.sourceCommitment='0'.repeat(64);if(control==='foreign tenant')p.companyId=target;if(control==='new replay')p.replayFields=[{field:'replay.policy_id'}];if(control==='missing terminal field')(p.terminalFields as unknown[]).pop()});await actor(reviewer)
 if(control==='revoked issuer')await db.query("INSERT INTO gridex_ediel_retention.issuer_revocations VALUES($1,'SYNTHETIC terminal revoke',clock_timestamp())",[issuer]);if(control==='held')await db.exec('UPDATE public.customers SET legal_hold=true')
 if(control==='revoked approval'){await approve(e);await db.query("SELECT public.ediel_review_completed_witness_disposition_v1($1,$2,$3,'revoke',NULL)",[c,reviewer,policy])}else expect((await attempt(()=>approve(e))).error).toBeDefined()
 await actor();expect(await purge()).toEqual({status:'unavailable',authority:'none'});expect((await db.query<{n:number}>('SELECT count(*)::integer n FROM gridex_ediel_retention.completed_witness_replays_v1')).rows[0].n).toBe(1)
})
it('terminal late failure rolls back the four-field erasure and its finite approval without restoring replay',async()=>{
 await overdueCommitted();await db.exec('UPDATE public.customers SET legal_hold=false');await actor(reviewer);await approve(await terminalEnvelope());await actor();await db.exec(`CREATE FUNCTION public.synthetic_terminal_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic terminal failure';END$$;CREATE TRIGGER synthetic_terminal_failure AFTER DELETE ON gridex_ediel_retention.completed_witness_replays_v1 FOR EACH ROW EXECUTE FUNCTION public.synthetic_terminal_failure()`)
 expect((await attempt(purge)).error?.message).toContain('synthetic terminal failure');expect(await status()).toEqual({status:'unavailable',authority:'none'});expect((await db.query<{n:number}>('SELECT count(*)::integer n FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1')).rows[0].n).toBe(1)
})
it('unknown or already terminally removed identifiers cannot receive an approval or a disposed result',async()=>{
 await db.query("SELECT set_config('fixture.actor',$1,true)",[worker]);expect((await db.query<{v:unknown}>('SELECT public.ediel_purge_decision_evidence_retention_v1($1,$2,$3) v',[c,worker,issuer])).rows[0].v).toEqual({status:'unavailable',authority:'none'})
 await actor(reviewer);const e=await envelope(p=>p.policyId=issuer);expect((await attempt(()=>db.query("SELECT public.ediel_review_completed_witness_disposition_v1($1,$2,$3,'approve',$4)",[c,reviewer,issuer,JSON.stringify(e)]))).error).toBeDefined()
})

it('prospective signed W refuses before, then the first actual PG observation at-or-after W permits only the new scoped effect',async()=>{
 await approve(await envelope(p=>p.executionMode='interactive'));await actor();const before=await originalSnapshot();expect(await purge()).toMatchObject({status:'held'});expect(await originalSnapshot()).toEqual(before)
 await db.exec("SELECT pg_sleep(greatest(0,extract(epoch FROM (journal_retain_until-clock_timestamp())))::double precision) FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id='55555555-5555-4555-8555-555555555555'")
 expect((await db.query<{due:boolean}>('SELECT clock_timestamp()>=journal_retain_until due FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=$1',[policy])).rows[0].due).toBe(true);expect(await purge()).toEqual({status:'disposed',replay:false,authority:'none'})
})
it('R equals W creates no projection or remaining operational authority and cannot replay after commit',async()=>{
 await approve(await envelope(p=>{p.executionMode='interactive';p.R=p.W;p.replayFields=[];p.terminalFields=[]}));await actor();expect(await purge()).toEqual({status:'disposed',replay:false,authority:'none'});expect(await purge()).toEqual({status:'unavailable',authority:'none'});expect((await db.query<{n:number}>('SELECT (SELECT count(*) FROM gridex_ediel_retention.completed_witness_replays_v1)+(SELECT count(*) FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1) n')).rows[0].n).toBe(0)
})
it('declared actual forward specs bind exact installed prosrc and keep W disclosure and permission predecessors unchanged',async()=>{
 const specs=JSON.parse(/\$specs\$([\s\S]*?)\$specs\$/.exec(readFileSync(forwardPath,'utf8'))![1])
 expect(specs).toHaveLength(3);for(const spec of specs){const row=(await db.query<{s:string}>('SELECT prosrc s FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=$2',spec.name.split('.'))).rows[0];expect(hash(row.s)).toBe(spec.after)}
 expect((await db.query<{s:string}>("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') s FROM pg_proc WHERE oid='public.ediel_read_decision_evidence_policy_v1(uuid,uuid,uuid,boolean)'::regprocedure")).rows[0].s).toBe('289988176a5b14a5bbc23445e518b32def1edce2b85300733d841c54cf6724cc')
})

it.each([null,0,101])('native worker cannot turn %s limit into an unbounded scan',async limit=>{expect((await attempt(()=>db.query('SELECT public.ediel_advance_completed_witness_disposition_v1($1,$2)',[worker,limit]))).error?.message).toContain('bounded_worker_required')})
it('native approval requires an explicit outcome even for an otherwise valid current signed bundle',async()=>{const e=await envelope();expect((await attempt(()=>db.query('SELECT public.ediel_review_completed_witness_disposition_v1($1,$2,$3,NULL,$4)',[c,reviewer,policy,JSON.stringify(e)]))).error?.code).toBe('42501')})
it('actual current blob routing is rechecked after approval and cannot migrate into another tenant',async()=>{await approve(await envelope(p=>p.executionMode='interactive'));await db.query('UPDATE public.ediel_messages SET company_id=$1 WHERE id=$2',[issuer,target]);await actor();const before=await originalSnapshot();expect((await attempt(purge)).error).toBeDefined();expect(await originalSnapshot()).toEqual(before)})

it('actual HTTP/domain call the actual combined SQL owner through declared identity transport, with W and R refusal before and after terminal deletion',async()=>{
 // Only GoTrue/cookie/RPC wire adapters are synthetic. Session permissions and
 // every policy/disposition/read/terminal operation execute the actual SQL.
 const extra=['ediel.retention.read','ediel.retention.decision_policy_evidence'];await db.query('INSERT INTO public.permissions SELECT gen_random_uuid(),x,x,true FROM unnest($1::text[])x',[extra]);for(const who of [worker,reviewer])await db.query(`INSERT INTO public.user_permissions SELECT gen_random_uuid(),$1,$2,id,key,true,'active','allow' FROM public.permissions WHERE key=ANY($3::text[])`,[who,c,extra])
 async function httpActor(who:string){await actor(who);httpTransport.auth.mockResolvedValue({data:{user:{id:who}},error:null})}
 httpTransport.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='ediel_current_retention_session_v1'){
   const permissions=(await db.query<{key:string}>(`SELECT key FROM public.permissions WHERE gridex_ediel_retention.permission_v1($1,$2,key)`,[args.p_company_id,args.p_actor_user_id])).rows.map(x=>x.key);return{data:{companyId:args.p_company_id,actorUserId:args.p_actor_user_id,permissions},error:null}
  }
  const ports:Record<string,{sql:string;params:unknown[]}>= {
   ediel_review_completed_witness_disposition_v1:{sql:'SELECT public.ediel_review_completed_witness_disposition_v1($1,$2,$3,$4,$5) v',params:[args.p_company_id,args.p_actor_user_id,args.p_policy_id,args.p_outcome,args.p_receipt]},
   ediel_purge_decision_evidence_retention_v1:{sql:'SELECT public.ediel_purge_decision_evidence_retention_v1($1,$2,$3) v',params:[args.p_company_id,args.p_actor_user_id,args.p_policy_id]},
   ediel_read_decision_evidence_policy_v1:{sql:'SELECT public.ediel_read_decision_evidence_policy_v1($1,$2,$3,$4) v',params:[args.p_company_id,args.p_actor_user_id,args.p_policy_id,args.p_include_document]},
   ediel_read_retention_decision_original_v1:{sql:'SELECT public.ediel_read_retention_decision_original_v1($1,$2,$3,$4,$5) v',params:[args.p_company_id,args.p_actor_user_id,args.p_retention_class,args.p_target_id,args.p_include_document]},
  };const port=ports[name];if(!port)throw Error('undeclared test transport');const result=await attempt(async()=>(await db.query<{v:unknown}>(port.sql,port.params)).rows[0].v);return{data:result.value??null,error:result.error?{code:result.error.code,message:result.error.message}:null}
 })
 const post=(body:unknown)=>new NextRequest('https://ops.example/api/ediel/decision-evidence-retention',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
 const e=await envelope(p=>{p.executionMode='interactive';p.R=new Date(Date.now()+300).toISOString();for(const f of p.replayFields as {max:string}[])f.max=p.R as string;for(const f of p.terminalFields as {max:string}[])f.max=p.R as string});await httpActor(reviewer);expect((await httpReview(post({phase:'completed-witness-disposition',outcome:'approve',issuerReceipt:e}),policy)).status).toBe(200);await httpActor(worker)
 for(const response of [await httpRead(policy),await httpOriginal('decision_evidence_policy_original_bytes',policy)]){expect(response.status).toBe(403);expect(JSON.stringify(await response.json())).not.toContain('SYNTHETIC')}
 const effect=await httpPurge(post({}),policy);expect(effect.status).toBe(200);expect(await effect.json()).toEqual({status:'disposed',replay:false,authority:'none'});expect(await (await httpPurge(post({}),policy)).json()).toEqual({status:'disposed',replay:true,authority:'none'})
 await db.exec('SELECT pg_sleep(0.35)');expect(await (await httpPurge(post({}),policy)).json()).toEqual({status:'expired',authority:'none'});expect(await (await httpPurge(post({}),policy)).json()).toEqual({status:'unavailable',authority:'none'});expect((await httpOriginal(kind,selected)).status).toBe(403)
})

it('terminal effect rechecks the signed current tenant-population scope and requires explicit renewed review when it changed',async()=>{
 await approve(await envelope(p=>{p.executionMode='interactive';p.R=new Date(Date.now()+50).toISOString();for(const f of p.replayFields as {max:string}[])f.max=p.R as string;for(const f of p.terminalFields as {max:string}[])f.max=p.R as string}));await actor();expect(await purge()).toMatchObject({status:'disposed',replay:false});await db.query('INSERT INTO public.customers VALUES(gen_random_uuid(),$1,false)',[c]);await db.exec('SELECT pg_sleep(0.1)');expect(await purge()).toEqual({status:'unavailable',authority:'none'});await actor(reviewer);await db.query("SELECT public.ediel_review_completed_witness_disposition_v1($1,$2,$3,'revoke',NULL)",[c,reviewer,policy]);await approve(await terminalEnvelope());await actor();expect(await purge()).toEqual({status:'expired',authority:'none'})
})

async function cloneWorkerApprovedScope(companyId:string,mode:'short'|'due'|'future'='short',untilOverride?:string){
  const ids=(await db.query<{blob:string;source:string;selected:string;policy:string;review:string;issuer:string}>('SELECT gen_random_uuid()::text blob,gen_random_uuid()::text source,gen_random_uuid()::text selected,gen_random_uuid()::text policy,gen_random_uuid()::text review,gen_random_uuid()::text issuer')).rows[0]
  await db.query("INSERT INTO public.companies VALUES($1,'active',true)",[companyId]);await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,clock_timestamp()),($1,$3,'active',true,clock_timestamp())",[companyId,worker,reviewer]);for(const who of [worker,reviewer])await db.query("INSERT INTO public.user_permissions SELECT gen_random_uuid(),$1,$2,id,key,true,'active','allow' FROM public.permissions",[who,companyId])
  await db.query('INSERT INTO public.ediel_messages VALUES($1,$2,NULL)',[ids.blob,companyId])
  await db.query(`INSERT INTO gridex_ediel_retention.blob_decisions SELECT (jsonb_populate_record(NULL::gridex_ediel_retention.blob_decisions,to_jsonb(x)||jsonb_build_object('id',$1::text,'company_id',$2::text,'target_id',$1::text,'message_id',$1::text))).* FROM gridex_ediel_retention.blob_decisions x WHERE id=$3`,[ids.blob,companyId,target])
  await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_policies SELECT (jsonb_populate_record(NULL::gridex_ediel_retention.decision_evidence_policies,to_jsonb(x)||jsonb_build_object('id',$1::text,'company_id',$2::text,'target_id',$3::text))).* FROM gridex_ediel_retention.decision_evidence_policies x WHERE id=$4`,[ids.source,companyId,ids.blob,source])
  await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_reviews SELECT (jsonb_populate_record(NULL::gridex_ediel_retention.decision_evidence_reviews,to_jsonb(x)||jsonb_build_object('id',$1::text,'policy_id',$2::text))).* FROM gridex_ediel_retention.decision_evidence_reviews x WHERE id=$3`,[ids.selected,ids.source,selected])
  await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_tombstones SELECT (jsonb_populate_record(NULL::gridex_ediel_retention.decision_evidence_tombstones,to_jsonb(x)||jsonb_build_object('company_id',$1::text,'policy_id',$2::text,'review_id',$3::text,'target_id',$4::text))).* FROM gridex_ediel_retention.decision_evidence_tombstones x WHERE policy_id=$5`,[companyId,ids.source,ids.selected,ids.blob,source])
  await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_policies SELECT (jsonb_populate_record(NULL::gridex_ediel_retention.decision_evidence_policies,to_jsonb(x)||jsonb_build_object('id',$1::text,'company_id',$2::text,'target_id',$3::text,'target_metadata_hash',gridex_ediel_retention.completed_review_reason_scope_v1($2::uuid,$3::uuid)->>'targetMetadataHash'))).* FROM gridex_ediel_retention.decision_evidence_policies x WHERE id=$4`,[ids.policy,companyId,ids.selected,policy])
  await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_reviews SELECT (jsonb_populate_record(NULL::gridex_ediel_retention.decision_evidence_reviews,to_jsonb(x)||jsonb_build_object('id',$1::text,'policy_id',$2::text))).* FROM gridex_ediel_retention.decision_evidence_reviews x WHERE id=$3`,[ids.review,ids.policy,ownReview])
  await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_revocations SELECT (jsonb_populate_record(NULL::gridex_ediel_retention.decision_evidence_revocations,to_jsonb(x)||jsonb_build_object('policy_id',$1::text))).* FROM gridex_ediel_retention.decision_evidence_revocations x WHERE policy_id=$2`,[ids.policy,policy])
  await db.query(`INSERT INTO gridex_ediel_retention.decision_evidence_tombstones SELECT (jsonb_populate_record(NULL::gridex_ediel_retention.decision_evidence_tombstones,to_jsonb(x)||jsonb_build_object('company_id',$1::text,'policy_id',$2::text,'review_id',$3::text,'target_id',$4::text,'target_metadata_hash',(SELECT target_metadata_hash FROM gridex_ediel_retention.decision_evidence_policies WHERE id=$2::uuid),'journal_retain_until',CASE WHEN $6::boolean THEN clock_timestamp()+interval '1 hour' ELSE x.journal_retain_until END))).* FROM gridex_ediel_retention.decision_evidence_tombstones x WHERE policy_id=$5`,[companyId,ids.policy,ids.review,ids.selected,policy,mode==='future'])
  await db.query(`INSERT INTO gridex_ediel_retention.issuers SELECT (jsonb_populate_record(NULL::gridex_ediel_retention.issuers,to_jsonb(x)||jsonb_build_object('id',$1::text,'company_id',$2::text))).* FROM gridex_ediel_retention.issuers x WHERE id=$3`,[ids.issuer,companyId,issuer])
  const old=await envelope(p=>{p.R=p.W;p.replayFields=[];p.terminalFields=[]},mode==='short'),p=JSON.parse(Buffer.from(old.payloadBase64,'base64').toString('utf8')) as Record<string,unknown>;p.companyId=companyId;p.policyId=ids.policy;p.sourceCommitment=(await db.query<{h:string}>('SELECT gridex_ediel_retention.completed_witness_graph_v1($1,$2) h',[companyId,ids.policy])).rows[0].h;p.customerScopeHash=(await db.query<{h:string}>('SELECT gridex_ediel_retention.completed_witness_holds_v1($1) h',[companyId])).rows[0].h
  if(mode==='future'){
   p.W=(await db.query<{w:string}>('SELECT journal_retain_until::text w FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=$1',[ids.policy])).rows[0].w;p.R=p.W;const A=new Date(Date.now()+3900000).toISOString();p.approvalUntil=A;p.expiresAt=new Date(Date.now()+4000000).toISOString();for(const field of p.fields as {max:string;reviewBy:string}[]){field.max=p.W as string;field.reviewBy=A}for(const field of p.approvalFields as {max:string;reviewBy:string}[]){field.max=A;field.reviewBy=A}
  }
  if(untilOverride){p.approvalUntil=untilOverride;for(const field of p.fields as {reviewBy:string}[])field.reviewBy=untilOverride;for(const field of p.approvalFields as {max:string;reviewBy:string}[]){field.max=untilOverride;field.reviewBy=untilOverride}}
  const bytes=Buffer.from(JSON.stringify(p)),e={issuerId:ids.issuer,payloadBase64:bytes.toString('base64'),signatureHex:createHmac('sha256',key).update(bytes).digest('hex')};expect((await db.query<{v:unknown}>("SELECT public.ediel_review_completed_witness_disposition_v1($1,$2,$3,'approve',$4) v",[companyId,reviewer,ids.policy,JSON.stringify(e)])).rows[0].v).toEqual({status:'approved',authority:'none'})
 }
it('bounded worker selects company order and skips a contended scope before the blocking owner helper while continuing to the next scope',async()=>{
 // PGlite has one connection. Only the advisory-contention/trace ports below
 // are synthetic. Three separate phase approvals use the actual combined
 // issuer, reviewer, routing, field and company owners before this port swap.
 const makeShort=(p:Record<string,unknown>)=>{p.R=p.W;p.replayFields=[];p.terminalFields=[]}

 const busy='21111111-1111-4111-8111-111111111111',tail='31111111-1111-4111-8111-111111111111'
 // Reverse admission order makes the required discovery ORDER BY observable.
 const sameA=new Date(Date.now()+1000).toISOString();await cloneWorkerApprovedScope(tail,'short',sameA);await cloneWorkerApprovedScope(busy,'short',sameA);await approve(await envelope(p=>{makeShort(p);p.approvalUntil=sameA;for(const field of p.fields as {reviewBy:string}[])field.reviewBy=sameA;for(const field of p.approvalFields as {max:string;reviewBy:string}[]){field.max=sameA;field.reviewBy=sameA}},true));await db.exec('SELECT pg_sleep(1.1)');await actor('')
 await db.exec(`CREATE TABLE public.synthetic_scope_trace(seq bigint GENERATED ALWAYS AS IDENTITY,kind text,key bigint);GRANT INSERT,SELECT ON public.synthetic_scope_trace TO gridex_ediel_retention_owner;GRANT USAGE,SELECT ON SEQUENCE public.synthetic_scope_trace_seq_seq TO gridex_ediel_retention_owner;CREATE FUNCTION public.synthetic_try_scope(k bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN INSERT INTO public.synthetic_scope_trace(kind,key) VALUES('try',k);IF k=hashtextextended('gridex:retention:decision-original:${busy}',0) THEN RETURN false;END IF;RETURN pg_try_advisory_xact_lock(k);END$$;
 CREATE OR REPLACE FUNCTION gridex_ediel_retention.decision_evidence_lock_v1(c uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN INSERT INTO public.synthetic_scope_trace(kind,key) VALUES('blocking',hashtextextended('gridex:retention:decision-original:'||c::text,0));IF c='${busy}'::uuid THEN RAISE EXCEPTION 'synthetic_blocking_scope_wait';END IF;PERFORM pg_advisory_xact_lock(hashtextextended('gridex:retention:decision-original:'||c::text,0));END$$;`)
 const installed=(await db.query<{d:string}>("SELECT pg_get_functiondef('public.ediel_advance_completed_witness_disposition_v1(uuid,integer)'::regprocedure) d")).rows[0].d
 let routed=installed.replace('pg_try_advisory_xact_lock(','public.synthetic_try_scope(')
 expect(routed).not.toBe(installed)
 if(process.env.DB05_WORKER_LOCK_BASELINE==='1')routed=routed.replace("IF public.synthetic_try_scope(hashtextextended('gridex:retention:decision-original:'||a.company_id::text,0)) IS NOT TRUE THEN held:=held+1;CONTINUE;END IF;",'')
 await db.exec(routed)
 const run=await attempt(async()=>(await db.query<{v:unknown}>('SELECT public.ediel_advance_completed_witness_disposition_v1($1,2) v',[worker])).rows[0].v);expect(run.error).toBeUndefined();expect(run.value).toMatchObject({scanned:2,clearedApprovals:1,held:1,disposed:0})
 expect((await db.query<{company_id:string}>('SELECT company_id::text FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 ORDER BY company_id')).rows.map(x=>x.company_id)).toEqual([busy,tail])
 expect(await runWorker()).toMatchObject({scanned:2,clearedApprovals:1,held:1,disposed:0})
 const expected=[['try',c],['blocking',c],['try',busy],['try',busy],['try',tail],['blocking',tail]]
 for(const [i,row]of (await db.query<{kind:string;key:string}>('SELECT kind,key::text FROM public.synthetic_scope_trace ORDER BY seq')).rows.entries()){
  expect(row.kind).toBe(expected[i][0]);expect(row.key).toBe((await db.query<{key:string}>("SELECT hashtextextended('gridex:retention:decision-original:'||$1::text,0)::text key",[expected[i][1]])).rows[0].key)
 }
 expect((await db.query<{n:number}>('SELECT count(*)::integer n FROM public.synthetic_scope_trace')).rows[0].n).toBe(6)
})

it('prospective real reader owners return pre-W originals then refuse both ports with the actual post-W42501 disclosure message',async()=>{
 await db.query("INSERT INTO public.permissions VALUES(gen_random_uuid(),'ediel.retention.decision_policy_evidence','Synthetic alternate class',true)")
 await db.query("INSERT INTO public.user_permissions SELECT gen_random_uuid(),$1,$2,id,key,true,'active','allow' FROM public.permissions WHERE key='ediel.retention.decision_policy_evidence'",[reviewer,c])
 const ports=[{name:'policy',sql:'SELECT public.ediel_read_decision_evidence_policy_v1($1,$2,$3,true) v'},{name:'alternate',sql:"SELECT public.ediel_read_retention_decision_original_v1($1,$2,'decision_evidence_policy_original_bytes',$3,true) v"}]
 for(const port of ports){const actual=(await db.query<{v:{documentBase64:string}}>(port.sql,[c,reviewer,policy])).rows[0].v;expect(Buffer.from(actual.documentBase64,'base64').toString('utf8')).toBe('SYNTHETIC owner underlay')}
 const before=await originalSnapshot();await db.query('SELECT pg_sleep(greatest(0,extract(epoch FROM (journal_retain_until-clock_timestamp())))::double precision) FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=$1',[policy])
 for(const port of ports){const refusal=await attempt(()=>db.query(port.sql,[c,reviewer,policy]));expect(refusal.error?.code,port.name).toBe('42501');expect(refusal.error?.message,port.name).toContain('completed_review_witness_disclosure_ended')}
 expect(await originalSnapshot()).toEqual(before)
 expect((await db.query<{h:string}>("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') h FROM pg_proc WHERE oid='gridex_ediel_retention.decision_evidence_receipt_v1(gridex_ediel_retention.decision_evidence_policies)'::regprocedure")).rows[0].h).toBe('74cfc4fe0c4b35b1638764be4168c1d992da179cc915ab2a6b6dfa768f3e977a')
})

it('future and held prefix cannot starve a later actually due physical phase at worker limit one',async()=>{
 const future='21111111-1111-4111-8111-111111111111',due='31111111-1111-4111-8111-111111111111';await cloneWorkerApprovedScope(future,'future');await cloneWorkerApprovedScope(due,'due');await approve(await envelope(p=>{p.R=p.W;p.replayFields=[];p.terminalFields=[];const A=new Date(Date.now()+60000).toISOString();p.approvalUntil=A;for(const field of p.fields as {reviewBy:string}[])field.reviewBy=A;for(const field of p.approvalFields as {max:string;reviewBy:string}[]){field.max=A;field.reviewBy=A}}));await db.exec('UPDATE public.customers SET legal_hold=true');await actor('')
 const result=(await db.query<{v:Record<string,unknown>}>('SELECT public.ediel_advance_completed_witness_disposition_v1($1,1) v',[worker])).rows[0].v;expect(result).toMatchObject({disposed:1,expired:0,clearedApprovals:0})
 expect((await db.query<{company_id:string}>('SELECT company_id::text FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 ORDER BY company_id')).rows.map(x=>x.company_id)).toEqual([c,future])
 expect((await db.query<{reason:string}>('SELECT reason FROM gridex_ediel_retention.decision_evidence_reviews WHERE id=$1',[selected])).rows[0].reason).toBe('[Retired retention review reason]')
})
