// local196: actual password action and existing staff-routing helper; mocked SDK/Auth ports only.
import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({update:vi.fn(),clear:vi.fn(),from:vi.fn(),rpc:vi.fn(),user:null as {id:string;user_metadata:Record<string,unknown>}|null,members:[] as {company_id:string}[],roles:[] as string[],readError:false}))
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw Error('REDIRECT:'+path)}}))
vi.mock('@/lib/auth/directAccountProvisioning',()=>({clearTemporaryPasswordFlags:io.clear}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:io.user},error:null}),updateUser:io.update}})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
import {updatePasswordAction} from '@/app/login/update-password/actions'
const U='00000000-0000-4000-8000-000000000196'
function form(next?:string){const f=new FormData();f.set('password','synthetic-password-196');f.set('confirmPassword','synthetic-password-196');if(next!==undefined)f.set('next',next);return f}
async function submit(f:FormData){try{await updatePasswordAction(f);throw Error('missing_redirect')}catch(e){const s=(e as Error).message;if(!s.startsWith('REDIRECT:'))throw e;return new URL(s.slice(9),'http://local')}}
beforeEach(()=>{
 vi.clearAllMocks();io.user={id:U,user_metadata:{}};io.members=[];io.roles=[];io.readError=false;io.update.mockResolvedValue({error:null});io.clear.mockResolvedValue(undefined)
 io.from.mockImplementation((table:string)=>{
  expect(table).toBe('company_memberships')
  return {select:(columns:string)=>{
   expect(columns).toBe('company_id')
   return {eq:(key:string,id:string)=>{
    expect(key).toBe('user_id');expect(id).toBe(U)
    return {limit:async(n:number)=>{
     expect(n).toBe(1)
     return {data:io.members,error:io.readError?{message:'synthetic_read_denied'}:null}
    }}
   }}
  }}
 })
 io.rpc.mockImplementation(async(name:string,args:unknown)=>{expect(name).toBe('gridex_get_user_roles');expect(args).toEqual({p_user_id:U});return {data:io.roles,error:null}})
})
it.each([undefined,'/dashboard'])('routes confirmed roleless customer default %s to portal after one normal password update',async(next)=>{
 const url=await submit(form(next));expect(url.pathname).toBe('/portal');expect(url.searchParams.has('message')).toBe(true);expect(io.update).toHaveBeenCalledOnce();expect(io.clear).toHaveBeenCalledExactlyOnceWith(U)
})
it('preserves staff dashboard for genuine membership',async()=>{io.members=[{company_id:'synthetic-company'}];expect((await submit(form())).pathname).toBe('/dashboard');expect(io.rpc).not.toHaveBeenCalled()})
it('preserves platform staff dashboard without membership',async()=>{io.roles=['super_admin'];expect((await submit(form())).pathname).toBe('/dashboard')})
it.each(['/portal','/auth/company-invite?token=synthetic-196','/admin?tab=one'])('preserves explicit safe continuation %s without staff lookup',async(next)=>{const result=await submit(form(next));const expected=new URL(next,'http://local');expect(result.pathname).toBe(expected.pathname);for(const [k,v] of expected.searchParams)expect(result.searchParams.get(k)).toBe(v);expect(io.from).not.toHaveBeenCalled();expect(io.rpc).not.toHaveBeenCalled()})
it('sanitizes external next before choosing roleless default',async()=>{expect((await submit(form('https://outside.invalid/path'))).pathname).toBe('/portal')})
it('retains existing routing-helper lookup-error semantics and backend gates',async()=>{io.readError=true;expect((await submit(form())).pathname).toBe('/dashboard')})
it('Auth failure retains normal form retry and does not run routing lookup',async()=>{io.update.mockResolvedValue({error:{message:'synthetic_auth_failure'}});const url=await submit(form());expect(url.pathname).toBe('/login/update-password');expect(url.searchParams.has('error')).toBe(true);expect(io.from).not.toHaveBeenCalled();expect(io.clear).not.toHaveBeenCalled()})
it('missing session never writes password or reads staff authority',async()=>{io.user=null;expect((await submit(form())).pathname).toBe('/login/update-password');expect(io.update).not.toHaveBeenCalled();expect(io.from).not.toHaveBeenCalled()})
it('mismatched confirmation never writes or reads staff authority',async()=>{const f=form();f.set('confirmPassword','different');expect((await submit(f)).pathname).toBe('/login/update-password');expect(io.update).not.toHaveBeenCalled();expect(io.from).not.toHaveBeenCalled()})
it('uses authenticated identity instead of posted actor or staff flags',async()=>{const f=form();f.set('user_id','foreign-user');f.set('hasStaffAccess','true');expect((await submit(f)).pathname).toBe('/portal');expect(io.update).toHaveBeenCalledOnce()})
