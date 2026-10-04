import {writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'

// Self-contained (no app/server-only imports): every browser pre-phase config can load it.
const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'"
function sql(query:string){
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
 execFileSync('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:10000})
}

/** The admin UI resolves a tenant user's permissions from role assignments
 * (canonical_authenticated_tenant_context), while the native owners also read
 * explicit user_permissions. Before a browser fixture is published, each member
 * of the fixture's companies gets a disposable own role mirroring exactly its
 * own active direct grants (never another user's), so the browser sees the same
 * authority the native phase established. Native phases are unaffected. */
export function mirrorBrowserRolePermissions(companyIds:readonly string[]){
 for(const company of [...new Set(companyIds)].filter(id=>/^[0-9a-f-]{36}$/.test(id))){
  sql(`DO $mirror$DECLARE member record;role uuid;role_key text;BEGIN
   FOR member IN SELECT DISTINCT cm.user_id FROM public.company_memberships cm WHERE cm.company_id=${literal(company)} AND cm.status='active' AND coalesce(cm.is_active,true) LOOP
    role:=NULL;role_key:=NULL;
    SELECT ur.role_id,r.key INTO role,role_key FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
     WHERE ur.user_id=member.user_id AND ur.company_id=${literal(company)} AND ur.status='active' AND ur.is_active LIMIT 1;
    -- A real shared/system role is the user's actual authority; never extend it.
    IF role IS NOT NULL AND role_key NOT LIKE 'native_actor_%' THEN CONTINUE;END IF;
    IF role IS NULL THEN
     role:=gen_random_uuid();
     INSERT INTO public.roles(id,key,name,scope) VALUES(role,'native_actor_'||role,'Disposable native browser role','company');
     INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) VALUES(member.user_id,${literal(company)},role,'native_actor_'||role,'active',true);
    END IF;
    INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
     SELECT role,'native_actor_'||role,up.permission_id,up.permission_key,up.effect FROM public.user_permissions up
     WHERE up.user_id=member.user_id AND up.company_id=${literal(company)} AND up.is_active AND up.permission_id IS NOT NULL
      AND NOT EXISTS(SELECT FROM public.role_permissions rp WHERE rp.role_id=role AND rp.permission_id=up.permission_id);
   END LOOP;
  END$mirror$;`)
 }
}

/** Mirror browser authority for every company the fixture names, then publish it. */
export function writeBrowserFixture(path:string,fixture:Record<string,unknown>,options?:Parameters<typeof writeFileSync>[2]){
 mirrorBrowserRolePermissions(Object.entries(fixture).filter(([key,value])=>/company(id)?$/i.test(key)&&typeof value==='string').map(([,value])=>value as string))
 writeFileSync(path,JSON.stringify(fixture),options)
}
