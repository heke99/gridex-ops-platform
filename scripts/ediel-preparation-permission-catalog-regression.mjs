// Isolated embedded SQL mechanics. Declared underlying positive grant resolver;
// this is not native authorization or authentic market-source evidence.
import fs from 'node:fs'
import assert from 'node:assert/strict'
if (!process.env.PGLITE_MODULE_URL) throw Error('PGLITE_MODULE_URL required')
const { PGlite } = await import(process.env.PGLITE_MODULE_URL)
const db = new PGlite()
const actor = '10000000-0000-4000-8000-000000000001'
const company = '20000000-0000-4000-8000-000000000001'
await db.exec(`CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz);
CREATE TABLE public.permissions(id uuid DEFAULT gen_random_uuid(),key text UNIQUE,name text,description text,category text,is_active boolean DEFAULT true);
CREATE TABLE public.role_permissions(role_id uuid,permission_id uuid);
CREATE TABLE public.roles(id uuid,key text,name text);
CREATE TABLE public.admin_users(user_id uuid,is_active boolean,role text);
CREATE TABLE public.user_roles(user_id uuid,company_id uuid,role_id uuid,role text,status text,is_active boolean);
CREATE TABLE public.company_memberships(user_id uuid,company_id uuid,status text,is_active boolean);
CREATE TABLE public.companies(id uuid,is_active boolean,status text);
CREATE TABLE public.user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
CREATE TABLE public.user_permission_overrides(user_id uuid,company_id uuid,is_active boolean,effect text,permission_key text,valid_from timestamptz,valid_to timestamptz);
CREATE TABLE public.declared_positive_grants(actor uuid,company uuid,permission text);
CREATE FUNCTION public.gridex_get_user_permissions_in_company(a uuid,c uuid) RETURNS text[] LANGUAGE sql AS $$SELECT coalesce(array_agg(permission),ARRAY[]::text[]) FROM public.declared_positive_grants WHERE actor=a AND company=c$$;
INSERT INTO auth.users VALUES('${actor}',NULL,NULL);
INSERT INTO public.companies VALUES('${company}',true,'active');
INSERT INTO public.company_memberships VALUES('${actor}','${company}','active',true);
INSERT INTO public.declared_positive_grants VALUES('${actor}','${company}','communication.send');`)
const current = fs.readFileSync('supabase/migrations/20261001004953_ediel_current_company_permission_denies.sql','utf8')
const definition = current.match(/create or replace function public\.gridex_actor_has_company_permission\([\s\S]*?\$function\$;/i)?.[0]
assert.ok(definition)
await db.exec(definition)
const migration = fs.readFileSync('supabase/migrations/20261001103735_ediel_canonical_preparation_permission_catalog.sql','utf8')
const allowed = async permission => (await db.query('SELECT public.gridex_actor_has_company_permission($1::uuid,$2::uuid,$3) AS allowed',[actor,company,permission])).rows[0].allowed
await db.exec(migration)
assert.equal(await allowed('communication.send'),true)
assert.equal(await allowed('communication.write'),false,'send grant must not authorize preparation')
assert.equal((await db.query('SELECT count(*)::int n FROM public.role_permissions')).rows[0].n,0)
assert.equal((await db.query('SELECT count(*)::int n FROM public.user_permissions')).rows[0].n,0)
await db.exec(`INSERT INTO public.declared_positive_grants VALUES('${actor}','${company}','communication.write')`)
assert.equal(await allowed('communication.write'),true)
await db.exec(`INSERT INTO public.user_permission_overrides VALUES('${actor}','${company}',true,'deny','communication.write',now()-interval '1 hour',NULL)`)
assert.equal(await allowed('communication.write'),false,'current own deny must revoke preparation')
assert.equal(await allowed('communication.send'),true,'prepare revoke is separate from send')
await db.exec(`UPDATE public.permissions SET is_active=false WHERE key='communication.write'`)
await db.exec(migration)
assert.equal((await db.query("SELECT is_active FROM public.permissions WHERE key='communication.write'")).rows[0].is_active,false,'repeat migration must preserve disabled permission')
await db.close()
console.log('PASS 8 isolated preparation-catalog mechanics; native/authentic proof pending')
