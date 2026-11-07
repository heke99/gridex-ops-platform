// local180: existing platform profile cards resolve their persisted company.
// Real action and governance lifecycle; isolated auth/SDK ports, not browser/SQL acceptance.
import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({
  guard:vi.fn(),getUser:vi.fn(),operational:vi.fn(),rpc:vi.fn(),revalidate:vi.fn(),authFrom:vi.fn(),serviceFrom:vi.fn(),profileVisible:true,
  profiles:[] as Record<string,unknown>[],companies:[] as Record<string,unknown>[],
  profileError:null as Error|null,companyError:null as Error|null,
  reads:[] as {table:string;filters:[string,unknown][]}[],events:[] as string[],
}))
vi.mock('next/cache',()=>({revalidatePath:io.revalidate}))
vi.mock('@/lib/admin/guards',()=>({requirePlatformAdminActionAccess:io.guard}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:io.getUser},from:io.authFrom})}))
vi.mock('@/lib/tenant/scope',()=>({requireOperationalCompanyId:io.operational}))
vi.mock('@/lib/ediel/specRegistry',()=>({getEdielInstructionSpec:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.serviceFrom}}))
// SDK I/O fidelity: authenticated rows may be hidden/denied by RLS, whereas
// service-role profile reads must not be used as a fallback. This does not mock
// SQL policy execution; actual own-clone grants/policies are separately bound.
function query(table:string,client:'authenticated'|'service'){
  if(client==='authenticated'&&table!=='ediel_actor_settings')throw Error('unexpected_authenticated_table:'+table)
  if(client==='service'&&table!=='companies')throw Error('service_profile_read_forbidden')
  const read={table,filters:[] as [string,unknown][]};io.reads.push(read);io.events.push('read:'+table)
  const q={select:()=>q,eq:(key:string,value:unknown)=>{read.filters.push([key,value]);return q},maybeSingle:async()=>{
    const error=table==='companies'?io.companyError:io.profileError
    if(error)return {data:null,error}
    const allowed=table!=='ediel_actor_settings'||io.profileVisible
    const rows=allowed?(table==='companies'?io.companies:io.profiles).filter(row=>read.filters.every(([key,value])=>row[key]===value)):[]
    if(rows.length>1)return {data:null,error:new Error('PGRST116_multiple_rows')}
    return {data:rows[0]??null,error:null}
  }};return q
}
import {saveEdielActorSettingsAction} from '@/app/admin/ediel/settings/actions'
const A='00000000-0000-4000-8000-000000000180',B='00000000-0000-4000-8000-000000000181'
const P='00000000-0000-4000-8000-000000000182',U='00000000-0000-4000-8000-000000000183'
function form(existing=true){const f=new FormData();for(const [k,v] of Object.entries({environment:'test',actor_role:'energy_service_company',actor_name:'Synthetic ESCO',actor_ediel_id:'97001',is_active:'true',mailbox:'synthetic@example.invalid',sender_sub_address:'ESCO',default_application_reference:'23-DGI-UTILTS'}))f.set(k,v);if(existing)f.set('id',P);return f}
function noWrite(){expect(io.rpc).not.toHaveBeenCalled();expect(io.revalidate).not.toHaveBeenCalled()}
beforeEach(()=>{
 vi.clearAllMocks();io.profiles=[{id:P,company_id:A,environment:'test'}];io.companies=[{id:A,status:'onboarding'},{id:B,status:'suspended'}];io.profileError=null;io.companyError=null;io.reads=[];io.events=[];io.profileVisible=true
 io.authFrom.mockImplementation((table:string)=>query(table,'authenticated'));io.serviceFrom.mockImplementation((table:string)=>query(table,'service'))
 io.guard.mockImplementation(async()=>{io.events.push('platform_guard');return {userId:U,isPlatformAdmin:true}})
 io.getUser.mockResolvedValue({data:{user:{id:U}},error:null})
 io.operational.mockRejectedValue(new Error('no_operational_company'))
 io.rpc.mockImplementation(async()=>{io.events.push('canonical_rpc');return {data:{},error:null}})
})
it('saves an existing card for its persisted company with a genuine platform actor lacking tenant membership',async()=>{
 await saveEdielActorSettingsAction(form())
 expect(io.operational).not.toHaveBeenCalled();expect(io.events[0]).toBe('platform_guard')
 expect(io.reads).toEqual([{table:'ediel_actor_settings',filters:[['id',P]]},{table:'companies',filters:[['id',A]]}])
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('canonical_save_ediel_actor_profile',{p_command:expect.objectContaining({company_id:A,actor_user_id:U,actor_role:'energy_service_company',test_profile_id:P,test_ediel_id:'97001',test_is_active:true,test_mailbox:'synthetic@example.invalid',test_sender_sub_address:'ESCO',test_application_reference:'23-DGI-UTILTS',idempotency_key:expect.stringMatching(/^ediel-settings-profile:/)})})
 expect(io.revalidate).toHaveBeenCalled()
})
it('ignores posted company and actor identities rather than trusting the client or selected membership',async()=>{
 io.operational.mockResolvedValue(B);const f=form();f.set('company_id',B);f.set('actor_user_id',B);await saveEdielActorSettingsAction(f)
 expect(io.operational).not.toHaveBeenCalled();expect(io.rpc).toHaveBeenCalledWith('canonical_save_ediel_actor_profile',{p_command:expect.objectContaining({company_id:A,actor_user_id:U})})
})
it('denies nonplatform callers before profile reads or canonical writes',async()=>{
 io.guard.mockRejectedValue(new Error('platform_only'));await expect(saveEdielActorSettingsAction(form())).rejects.toThrow('platform_only');expect(io.reads).toEqual([]);expect(io.getUser).not.toHaveBeenCalled();noWrite()
})
it('denies missing current authentication before persisted profile reads',async()=>{
 io.getUser.mockResolvedValue({data:{user:null},error:null});await expect(saveEdielActorSettingsAction(form())).rejects.toThrow('Unauthorized');expect(io.reads).toEqual([]);noWrite()
})
it('denies a missing or foreign unknown profile without falling back to operational context',async()=>{
 io.profiles=[];io.operational.mockResolvedValue(B);await expect(saveEdielActorSettingsAction(form())).rejects.toThrow();expect(io.operational).not.toHaveBeenCalled();noWrite()
})
it('propagates profile read errors rather than changing context',async()=>{
 io.profileError=new Error('profile_read_denied');await expect(saveEdielActorSettingsAction(form())).rejects.toThrow('profile_read_denied');expect(io.operational).not.toHaveBeenCalled();noWrite()
})
it('denies ambiguous profile results',async()=>{
 io.profiles.push({...io.profiles[0],company_id:B});await expect(saveEdielActorSettingsAction(form())).rejects.toThrow();noWrite()
})
it('denies a persisted profile without a company',async()=>{
 io.profiles[0].company_id=null;await expect(saveEdielActorSettingsAction(form())).rejects.toThrow();noWrite()
})
it('denies a submitted environment different from the existing profile',async()=>{
 const f=form();f.set('environment','production');f.set('actor_ediel_id','97003');await expect(saveEdielActorSettingsAction(f)).rejects.toThrow();noWrite()
})
it.each(['active','onboarding'])('allows the existing canonical company lifecycle %s',async status=>{
 io.companies[0].status=status;await saveEdielActorSettingsAction(form());expect(io.rpc).toHaveBeenCalledOnce()
})
it.each(['paused','suspended','closed','archived','pending_deletion','deleted_test_only'])('preserves the real governance denial for %s',async status=>{
 io.companies[0].status=status;await expect(saveEdielActorSettingsAction(form())).rejects.toThrow('blockerad');noWrite()
})
it('denies missing company rows through the real governance helper',async()=>{
 io.companies=[];await expect(saveEdielActorSettingsAction(form())).rejects.toThrow('Bolaget hittades inte');noWrite()
})
it('propagates company read failure before any canonical write',async()=>{
 io.companyError=new Error('company_read_failed');await expect(saveEdielActorSettingsAction(form())).rejects.toThrow('company_read_failed');noWrite()
})
it('preserves the canonical RPC denial and never revalidates as success',async()=>{
 io.rpc.mockResolvedValue({data:null,error:new Error('actor_not_authorized_for_ediel_profile')});await expect(saveEdielActorSettingsAction(form())).rejects.toThrow('actor_not_authorized_for_ediel_profile');expect(io.rpc).toHaveBeenCalledOnce();expect(io.revalidate).not.toHaveBeenCalled()
})
it('retains supported production profile configuration without creating a test command',async()=>{
 io.profiles[0].environment='production';const f=form();f.set('environment','production');f.set('actor_ediel_id','97003');await saveEdielActorSettingsAction(f)
 const cmd=io.rpc.mock.calls[0][1].p_command;expect(cmd).toMatchObject({company_id:A,production_profile_id:P,production_ediel_id:'97003',actor_user_id:U});expect(cmd).not.toHaveProperty('test_profile_id')
})
it('retains prohibited test IDs in production guard',async()=>{
 io.profiles[0].environment='production';const f=form();f.set('environment','production');f.set('actor_ediel_id','91100');await expect(saveEdielActorSettingsAction(f)).rejects.toThrow('test-/systemtest-ID');noWrite()
})
it('retains required field validation',async()=>{
 const f=form();f.set('actor_name','');await expect(saveEdielActorSettingsAction(f)).rejects.toThrow('måste fyllas');noWrite()
})
it('preserves new-card membership context instead of accepting a posted arbitrary company',async()=>{
 io.operational.mockResolvedValue(A);const f=form(false);f.set('company_id',B);await saveEdielActorSettingsAction(f);expect(io.operational).toHaveBeenCalledWith(U);expect(io.reads).toEqual([{table:'companies',filters:[['id',A]]}]);expect(io.rpc).toHaveBeenCalledWith('canonical_save_ediel_actor_profile',{p_command:expect.objectContaining({company_id:A,test_profile_id:null})})
})
it('preserves new-card no-context denial without reading or writing a global company',async()=>{
 await expect(saveEdielActorSettingsAction(form(false))).rejects.toThrow('no_operational_company');expect(io.reads).toEqual([]);noWrite()
})

it('uses authenticated RLS profile SELECT and never falls back to service-role profile reads',async()=>{
 await saveEdielActorSettingsAction(form());expect(io.authFrom).toHaveBeenCalledExactlyOnceWith('ediel_actor_settings');expect(io.serviceFrom).toHaveBeenCalledExactlyOnceWith('companies')
})
it('denies an RLS-hidden foreign or revoked profile without service-role fallback',async()=>{
 io.profileVisible=false;io.operational.mockResolvedValue(B);await expect(saveEdielActorSettingsAction(form())).rejects.toThrow();expect(io.authFrom).toHaveBeenCalledExactlyOnceWith('ediel_actor_settings');expect(io.serviceFrom).not.toHaveBeenCalled();expect(io.operational).not.toHaveBeenCalled();noWrite()
})
