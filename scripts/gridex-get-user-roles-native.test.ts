// Findings 20261029-3f1a8ab1/claude-track5/005 and /007: gridex_get_user_roles
// was missing from the canonical schema (proxy.ts answered 503 for every
// /admin/platform path) and its legacy definitions let anon read any user's
// roles. Real local GoTrue/PostgREST/SQL; synthetic users only.
import {execFileSync} from 'node:child_process'
import {randomBytes,randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {beforeAll,afterAll,expect,it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'"
function sql(input:string):string{
 if(url!=='http://127.0.0.1:54321')throw Error('user_roles_owned_local_only')
 return execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{
  input,encoding:'utf8',timeout:20000,
 }).trim()
}
type User={id:string;email:string;password:string}
async function user(label:string):Promise<User>{
 const email=`roles-${label}-${randomUUID().slice(0,8)}@example.invalid`,password=`Sim-${randomBytes(12).toString('hex')}!`
 const {data,error}=await supabaseService.auth.admin.createUser({email,password,email_confirm:true})
 if(error||!data.user)throw error??Error('create_user_failed')
 sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(data.user.id)},${literal(email)},'Synthetic roles user','active') ON CONFLICT(id) DO NOTHING;`)
 return {id:data.user.id,email,password}
}
async function session(u:User){
 const client=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
 const {error}=await client.auth.signInWithPassword({email:u.email,password:u.password})
 if(error)throw error
 return client
}
const keys=(rows:unknown)=>((rows??[]) as {role_key:string}[]).map(r=>r.role_key).sort()

let member:User,platform:User,other:User,scoped:User,company='',company2=''
const roleKey=`native_roles_${randomUUID().slice(0,8)}`
beforeAll(async()=>{
 member=await user('member');platform=await user('platform');other=await user('other');scoped=await user('scoped')
 company=randomUUID();company2=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'Synthetic roles company','active');
  INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,is_active,accepted_at,joined_at,role,role_key)
   VALUES(${literal(company)},${literal(member.id)},'company_admin','active',true,now(),now(),'company_admin','company_admin');
  WITH r AS (INSERT INTO public.roles(id,key,name,scope) VALUES(gen_random_uuid(),${literal(roleKey)},'Synthetic role','company') RETURNING id)
  INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) SELECT ${literal(member.id)},${literal(company)},id,${literal(roleKey)},'active',true FROM r;
  INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${literal(platform.id)},'superadmin',true);
  -- A platform-like key that is not a platform grant (free-text membership role;
  -- company-scoped platform user_roles rows are refused by a trigger), plus an inactive role.
  INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,is_active,accepted_at,joined_at,role,role_key)
   VALUES(${literal(company)},${literal(scoped.id)},'company_admin','active',true,now(),now(),'platform_admin','platform_admin');
  INSERT INTO public.user_roles(user_id,company_id,role,status,is_active) VALUES(${literal(scoped.id)},${literal(company)},'billing','active',true);
  WITH r AS (INSERT INTO public.roles(id,key,name,scope,is_active) VALUES(gen_random_uuid(),${literal(`${roleKey}_off`)},'Inactive role','company',false) RETURNING id)
  INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) SELECT ${literal(scoped.id)},${literal(company2)},id,${literal(`${roleKey}_off`)},'active',true FROM r;`)
})
afterAll(async()=>{for(const u of [member,platform,other,scoped])await supabaseService.auth.admin.deleteUser(u.id).catch(()=>undefined)})

it('returns the calling user\'s own roles, including platform admin_users roles',async()=>{
 const own=await (await session(member)).rpc('gridex_get_user_roles',{p_user_id:member.id})
 expect(own.error).toBeNull()
 expect(keys(own.data)).toEqual(['company_admin',roleKey].sort())
 const admin=await (await session(platform)).rpc('gridex_get_user_roles',{p_user_id:platform.id})
 expect(admin.error).toBeNull()
 expect(keys(admin.data)).toEqual(['super_admin'])
})

it('returns no platform role from membership text, and skips inactive roles',async()=>{
 const own=await (await session(scoped)).rpc('gridex_get_user_roles',{p_user_id:scoped.id})
 expect(own.error).toBeNull()
 expect(keys(own.data)).toEqual(['billing'])
 const viaService=await supabaseService.rpc('gridex_get_user_roles',{p_user_id:scoped.id})
 expect(keys(viaService.data)).toEqual(['billing'])
})

it('replaces the legacy function even where the legacy debug view depends on it',()=>{
 sql(`CREATE OR REPLACE VIEW public.gridex_debug_batch2_rbac_v AS SELECT * FROM public.gridex_get_user_roles(NULL::uuid);`)
 execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1','-f',
  'supabase/migrations/20261030130300_gridex_get_user_roles_self_scoped.sql'],{encoding:'utf8',timeout:20000})
 expect(sql(`SELECT to_regclass('public.gridex_debug_batch2_rbac_v') IS NULL`)).toBe('t')
 expect(sql(`SELECT to_regprocedure('public.gridex_get_user_roles(uuid)') IS NOT NULL`)).toBe('t')
})

it('returns no rows for another user\'s id',async()=>{
 const client=await session(other)
 for(const target of [member.id,platform.id]){
  const res=await client.rpc('gridex_get_user_roles',{p_user_id:target})
  expect(res.error).toBeNull()
  expect(res.data).toEqual([])
 }
})

it('denies anon, also through PUBLIC, and grants only authenticated and service_role',async()=>{
 const anon=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
 const res=await anon.rpc('gridex_get_user_roles',{p_user_id:member.id})
 expect(res.data??null).toBeNull()
 expect(res.error?.code).toBe('42501')
 const grants=JSON.parse(sql(`SELECT json_object_agg(r, has_function_privilege(r,'public.gridex_get_user_roles(uuid)','EXECUTE'))
  FROM unnest(ARRAY['anon','authenticated','service_role']) r`)) as Record<string,boolean>
 expect(grants).toEqual({anon:false,authenticated:true,service_role:true})
 expect(sql(`SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid='public.gridex_get_user_roles(uuid)'::regprocedure AND a.grantee=0`)).toBe('0')
 expect(sql(`SELECT prosecdef::text||':'||array_to_string(proconfig,',') FROM pg_proc WHERE oid='public.gridex_get_user_roles(uuid)'::regprocedure`)).toBe('true:search_path=""')
})

it('answers any user for service_role server-side owners',async()=>{
 const res=await supabaseService.rpc('gridex_get_user_roles',{p_user_id:member.id})
 expect(res.error).toBeNull()
 expect(keys(res.data)).toEqual(['company_admin',roleKey].sort())
 const none=await supabaseService.rpc('gridex_get_user_roles',{p_user_id:null})
 expect(none.error).toBeNull()
 expect(none.data).toEqual([])
})
