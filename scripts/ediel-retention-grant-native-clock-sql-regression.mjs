// Execute actual installed retention permission/auth/whitelist DDL over explicit
// synthetic Auth/RBAC schema. No source acceptance, issuer/legal policy or deletion
// approval is seeded. This is bounded PostgreSQL mechanics, NOT native Supabase CI.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0')
const migration=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')
const exactFunction=(text,name)=>{
 const starts=['CREATE FUNCTION '+name,'CREATE OR REPLACE FUNCTION '+name].map(s=>text.indexOf(s)).filter(n=>n>=0)
 assert.equal(starts.length,1,'one original function '+name)
 const a=starts[0],b=text.indexOf('$$;',a)
 assert.ok(b>a,'complete original body '+name)
 return text.slice(a,b+3)
}
const exactDo=(text,needle)=>{
 const a=text.indexOf(needle),b=text.indexOf('END$$;',a)
 assert.ok(a>=0&&b>a,'complete original DO '+needle)
 assert.equal(text.indexOf(needle,a+needle.length),-1,'one original DO '+needle)
 return text.slice(a,b+7)
}
const keys=['submit','review','purge','source_bytes','customer_fields','original_bytes','mime_bytes',
'artifact_decision_evidence','blob_decision_evidence','record_decision_evidence',
'process_decision_evidence','decision_policy_evidence','billing_source_evidence',
'invoice_copy_evidence','settlement_copy_evidence','finance_decision_evidence'].map(k=>'ediel.retention.'+k)
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const checks=[]
const checked=(name,value,expected)=>{assert.deepEqual(value,expected,name);checks.push(name)}
const permission=async(key,company=uid(1),actor=uid(2))=>(await db.query(
'SELECT gridex_ediel_retention.permission_v1($1,$2,$3) permitted',[company,actor,key])).rows[0].permitted
const proc=async()=>(await db.query("SELECT to_jsonb(p)-'prosrc' authority,p.prosrc body FROM pg_proc p WHERE p.oid='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure")).rows[0]
const override=(key,effect,from,to,company=uid(1))=>'INSERT INTO public.user_permission_overrides VALUES('+q(uid(2))+','+q(company)+','+q(key)+','+q(effect)+',true,'+from+','+to+')'
const clear=()=>db.exec('DELETE FROM public.user_permissions;DELETE FROM public.user_permission_overrides;DELETE FROM public.user_roles;DELETE FROM public.role_permissions')
const direct=key=>'INSERT INTO public.user_permissions VALUES('+q(uid(2))+','+q(uid(1))+',NULL,'+q(key)+",true,'active','allow')"
try{
 await db.exec("CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;CREATE ROLE authenticator NOLOGIN;CREATE ROLE bounded_auth_owner NOLOGIN;CREATE ROLE bounded_migrator NOLOGIN NOINHERIT NOSUPERUSER CREATEROLE BYPASSRLS;CREATE ROLE gridex_ediel_retention_owner NOLOGIN NOINHERIT BYPASSRLS;GRANT gridex_ediel_retention_owner TO bounded_migrator WITH INHERIT TRUE,SET TRUE;\
 CREATE SCHEMA auth AUTHORIZATION bounded_auth_owner;CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);ALTER TABLE auth.users OWNER TO bounded_auth_owner;\
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;ALTER FUNCTION auth.uid() OWNER TO bounded_auth_owner;\
 GRANT USAGE ON SCHEMA auth TO bounded_migrator;GRANT SELECT,UPDATE ON auth.users TO bounded_migrator;\
 CREATE SCHEMA gridex_ediel_retention AUTHORIZATION gridex_ediel_retention_owner;REVOKE ALL ON SCHEMA gridex_ediel_retention FROM PUBLIC,anon,authenticated,service_role,authenticator;CREATE SCHEMA gridex_requested_changes;\
 CREATE FUNCTION gridex_requested_changes.scoped_permission_v1(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;\
 CREATE TABLE public.companies(id uuid PRIMARY KEY,status text);CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text,disabled_at timestamptz);CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);\
 CREATE TABLE public.permissions(id uuid PRIMARY KEY,key text,is_active boolean);CREATE TABLE public.roles(id uuid PRIMARY KEY,is_active boolean);CREATE TABLE public.user_roles(user_id uuid,company_id uuid,role_id uuid,is_active boolean,status text);CREATE TABLE public.role_permissions(role_id uuid,permission_id uuid,permission_key text,effect text);\
 CREATE TABLE public.user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);CREATE TABLE public.user_permission_overrides(user_id uuid,company_id uuid,permission_key text,effect text,is_active boolean,valid_from timestamptz,valid_to timestamptz);\
 GRANT USAGE ON SCHEMA public,gridex_requested_changes TO gridex_ediel_retention_owner;GRANT CREATE ON SCHEMA public TO bounded_migrator;GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public TO bounded_migrator,gridex_ediel_retention_owner;")
 await db.exec(exactFunction(migration('20261001000710_ediel_archived_tenant_retention_class_authority.sql'),'gridex_ediel_retention.permission_v1'))
 await db.exec(exactFunction(migration('20261001012305_ediel_customer_record_class_retention.sql'),'public.ediel_current_retention_session_v1'))
 await db.exec(exactFunction(migration('20261001015940_ediel_retention_workspace_scope.sql'),'public.ediel_current_retention_companies_v1'))
 await db.exec('ALTER FUNCTION gridex_ediel_retention.permission_v1(uuid,uuid,text) OWNER TO gridex_ediel_retention_owner;ALTER FUNCTION public.ediel_current_retention_session_v1(uuid,uuid) OWNER TO gridex_ediel_retention_owner;ALTER FUNCTION public.ediel_current_retention_companies_v1() OWNER TO gridex_ediel_retention_owner;REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_retention FROM PUBLIC,anon,authenticated,service_role,authenticator;SET ROLE bounded_migrator')
 await db.exec(migration('20261001025642_ediel_retention_current_auth_owner_bridge.sql'))
 await db.exec('RESET ROLE')
 const whitelist645=migration('20261001064500_ediel_retention_decision_original_class_workflows.sql')
 await db.exec(exactDo(whitelist645,"DO $$DECLARE f record;body text;needle text:='''ediel.retention.legal_history'']'"))
 await db.exec(exactDo(migration('20261001070700_ediel_finance_retention_decision_original_class.sql'),"DO $$DECLARE f record;body text;needle text:='''ediel.retention.settlement_copy_evidence'']'"))
 await db.exec('ALTER FUNCTION gridex_ediel_retention.permission_v1(uuid,uuid,text) SET lock_timeout TO \'900ms\'')
 await db.exec('INSERT INTO public.companies VALUES('+q(uid(1))+",'archived'),("+q(uid(9))+",'active');INSERT INTO auth.users VALUES("+q(uid(2))+',NULL,NULL);INSERT INTO public.user_profiles VALUES('+q(uid(2))+",'active',NULL);INSERT INTO public.company_memberships VALUES("+q(uid(1))+','+q(uid(2))+",'active',true,clock_timestamp());INSERT INTO public.roles VALUES("+q(uid(8))+',true)')
 for(let i=0;i<keys.length;i++)await db.exec('INSERT INTO public.permissions VALUES('+q(uid(100+i))+','+q(keys[i])+',true)')
 const before=await proc(),signature=before.body.match(/retention_keys constant text\[\]:=ARRAY\[([^\]]+)\]/)
 checked('actual authentic033 exact installed function body SHA256',createHash('sha256').update(before.body,'utf8').digest('hex'),'24128f720357eb64a0d3b6ba306925716453cbbd7f241696b54ec8de4d53910f')
 checked('installed actual 7+9 class whitelist',signature[1].split(',').map(s=>s.slice(1,-1)),keys)
 const nonRetentionBefore=before.body.slice(before.body.indexOf(' IF wanted<>ALL(retention_keys) THEN'),before.body.indexOf(' IF NOT EXISTS(SELECT FROM public.companies'))
 const boundaryProof=async()=>{
  await clear();await db.exec('BEGIN');await db.exec(override(keys[1],'allow','now()-interval \'1 hour\'',"now()+interval '150 milliseconds'"))
  await db.exec('SELECT pg_sleep(0.3)')
  const times=(await db.query("SELECT now()<valid_to transaction_before_expiry,clock_timestamp()>=valid_to native_after_expiry FROM public.user_permission_overrides")).rows[0]
  checked('expired override: actual transaction/native clocks straddle own valid_to',times,{transaction_before_expiry:true,native_after_expiry:true})
  const result=await permission(keys[1]);await db.exec('ROLLBACK');return result
 }
 checked('RED installed old permission admits expired ALLOW after same-TX delay',await boundaryProof(),true)
 await db.exec('SET ROLE bounded_migrator')
 await db.exec(migration('20261001081731_ediel_retention_grant_native_clock.sql'))
 await db.exec('RESET ROLE')
 const after=await proc()
 checked('same complete pg_proc authority metadata, including OID/ACL/config/security/volatility',after.authority,before.authority)
 const expected=before.body.replace("BEGIN\n IF wanted<>ALL(retention_keys) THEN","retention_grant_observed_at timestamptz;\nBEGIN\n IF wanted<>ALL(retention_keys) THEN")
 .replace(' IF NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active)',' retention_grant_observed_at:=clock_timestamp();\n IF NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active)')
 .replaceAll('o.valid_from<=now()','o.valid_from<=retention_grant_observed_at').replaceAll('now()<o.valid_to','retention_grant_observed_at<o.valid_to')
 checked('exact only declaration/sampling/four window expression delta',after.body,expected)
 checked('unmodified non-retention delegation and its original deny behavior',after.body.slice(after.body.indexOf(' IF wanted<>ALL(retention_keys) THEN'),after.body.indexOf(' IF NOT EXISTS(SELECT FROM public.companies')),nonRetentionBefore)
 checked('GREEN same actual expiry proof now refuses expired ALLOW',await boundaryProof(),false)
 for(const key of keys){
  await clear();await db.exec(direct(key));checked(key+' current own direct ALLOW',await permission(key),true)
  checked(key+' foreign company has zero own authority',await permission(key,uid(9)),false)
  await clear();checked(key+' no grant remains refused',await permission(key),false)
  await db.exec(override(key,'allow',"clock_timestamp()-interval '1 hour'","clock_timestamp()+interval '1 hour'"));checked(key+' active timebounded own ALLOW',await permission(key),true)
  await clear();await db.exec(override(key,'allow',"clock_timestamp()+interval '1 hour'","clock_timestamp()+interval '2 hours'"));checked(key+' future ALLOW refused',await permission(key),false)
  await clear();await db.exec(override(key,'allow',"clock_timestamp()-interval '2 hours'","clock_timestamp()-interval '1 hour'"));checked(key+' expired ALLOW refused',await permission(key),false)
  await clear();await db.exec(direct(key));await db.exec(override(key,'deny',"clock_timestamp()-interval '1 hour'","clock_timestamp()+interval '1 hour'"));checked(key+' current DENY overrides own ALLOW',await permission(key),false)
  await clear();await db.exec(direct(key));await db.exec(override(key,'deny',"clock_timestamp()-interval '2 hours'","clock_timestamp()-interval '1 hour'"));checked(key+' expired DENY does not override current own ALLOW',await permission(key),true)
  await clear();await db.exec('INSERT INTO public.user_roles VALUES('+q(uid(2))+','+q(uid(1))+','+q(uid(8))+",true,'active');INSERT INTO public.role_permissions VALUES("+q(uid(8))+',NULL,'+q(key)+",'allow')");checked(key+' current own role ALLOW preserved',await permission(key),true)
 }
 await clear();await db.exec(direct(keys[1]))
 for(const [deny,restore] of [
 ['UPDATE auth.users SET deleted_at=clock_timestamp()','UPDATE auth.users SET deleted_at=NULL'],
 ["UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour'","UPDATE auth.users SET banned_until=NULL"],
 ['UPDATE public.user_profiles SET disabled_at=clock_timestamp()','UPDATE public.user_profiles SET disabled_at=NULL'],
 ["UPDATE public.user_profiles SET user_status='inactive'","UPDATE public.user_profiles SET user_status='active'"],
 ['UPDATE public.company_memberships SET accepted_at=NULL','UPDATE public.company_memberships SET accepted_at=clock_timestamp()'],
 ['UPDATE public.company_memberships SET is_active=false','UPDATE public.company_memberships SET is_active=true'],
 ["UPDATE public.company_memberships SET status='revoked'","UPDATE public.company_memberships SET status='active'"],
 ["UPDATE public.companies SET status='deleted'","UPDATE public.companies SET status='archived'"],
 ['UPDATE public.permissions SET is_active=false','UPDATE public.permissions SET is_active=true']
 ]){await db.exec(deny);checked('current gate '+deny,await permission(keys[1]),false);await db.exec(restore);checked('restored gate '+restore,await permission(keys[1]),true)}
 for(const role of ['anon','authenticated','service_role','authenticator']){
  checked(role+' no private owner membership',(await db.query("SELECT pg_has_role($1,'gridex_ediel_retention_owner','MEMBER') permitted",[role])).rows[0].permitted,false)
  await db.exec('SET ROLE '+role);await assert.rejects(()=>permission(keys[1]),/permission denied/);await db.exec('RESET ROLE');checks.push(role+' direct private permission invocation refused')
 }
 await clear();await db.exec('INSERT INTO auth.users VALUES('+q(uid(3))+',NULL,NULL);INSERT INTO public.user_profiles VALUES('+q(uid(3))+",'active',NULL);INSERT INTO public.company_memberships VALUES("+q(uid(1))+','+q(uid(3))+",'active',true,clock_timestamp());INSERT INTO public.user_permission_overrides VALUES("+q(uid(3))+','+q(uid(1))+','+q(keys[3])+",'allow',true,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour')")
 checked('separate own reviewer current class grant is qualified independently',await permission(keys[3],uid(1),uid(3)),true)
 checked('actor cannot borrow separate reviewer class grant',await permission(keys[3]),false)
 await db.exec('UPDATE public.user_permission_overrides SET valid_to=clock_timestamp()-interval \'1 second\' WHERE user_id='+q(uid(3)))
 checked('separate reviewer expired class grant is refused',await permission(keys[3],uid(1),uid(3)),false)
 await db.exec('BEGIN')
 const oldDefinition=exactFunction(migration('20261001000710_ediel_archived_tenant_retention_class_authority.sql'),'gridex_ediel_retention.permission_v1')
 const delimiter=oldDefinition.indexOf('$$')
 const rebuiltOldDefinition=oldDefinition.slice(0,delimiter+2)+before.body+'\n-- unexpected installed drift\n'+oldDefinition.slice(oldDefinition.lastIndexOf('$$'))
 await db.exec(rebuiltOldDefinition.replace('CREATE FUNCTION ','CREATE OR REPLACE FUNCTION '))
 await assert.rejects(()=>db.exec(migration('20261001081731_ediel_retention_grant_native_clock.sql')),/retention_grant_native_clock_original_review_required/)
 await db.exec('ROLLBACK');checks.push('different installed body is refused by exact authentic SHA guard')
 checked('failed body-drift forward rolls back complete installed authority and body',await proc(),after)
 console.log(JSON.stringify({status:'PASS',checks:checks.length,names:checks,evidenceKind:'BOUNDED_SYNTHETIC_POSTGRES_MECHANICS',native:false,wholeCriterionApproved:false},null,2))
}finally{await db.close()}
