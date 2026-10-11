import {beforeEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const io=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),set:vi.fn(),refresh:vi.fn()}))
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>undefined,set:io.set})}))
vi.mock('next/cache',()=>({revalidatePath:io.refresh}))
vi.mock('next/navigation',()=>({redirect:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:io.getUser},rpc:io.rpc})}))
import {selectRetentionCompany} from '@/app/retention/actions'
import {requireRetentionCompanies,RETENTION_SELECTED_COMPANY_COOKIE} from '@/lib/ediel/retention/retentionHttp'
const actor='00000000-0000-4000-8000-000000000001',company='00000000-0000-4000-8000-000000000002',foreign='00000000-0000-4000-8000-000000000003',rights=['ediel.retention.review','ediel.retention.legal_history']
beforeEach(()=>{vi.resetAllMocks();io.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});io.rpc.mockResolvedValue({error:null,data:{companyId:company,actorUserId:actor,permissions:rights}})})
const form=(id=company)=>{const f=new FormData();f.set('company_id',id);return f}
it('archived own company choice is independently admitted by current native retention scope before one dedicated HttpOnly cookie is set',async()=>{
 expect(await selectRetentionCompany({message:''},form())).toMatchObject({selectedCompanyId:company});expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_current_retention_session_v1',{p_company_id:company,p_actor_user_id:actor});expect(io.set).toHaveBeenCalledExactlyOnceWith(RETENTION_SELECTED_COMPANY_COOKIE,company,expect.objectContaining({httpOnly:true,sameSite:'lax',path:'/',maxAge:3600}));expect(io.refresh).toHaveBeenCalledExactlyOnceWith('/retention','layout')
})
it('a caller foreign company without current native permission cannot write a selection cookie',async()=>{
 io.rpc.mockResolvedValue({data:null,error:Error('retention_current_explicit_session_required')});expect((await selectRetentionCompany({message:''},form(foreign))).selectedCompanyId).toBeUndefined();expect(io.set).not.toHaveBeenCalled()
})
it('a foreign actor/company native response never establishes the server selector',async()=>{
 for(const wrong of [{companyId:foreign,actorUserId:actor},{companyId:company,actorUserId:foreign}]){io.rpc.mockResolvedValue({data:{...wrong,permissions:rights},error:null});expect((await selectRetentionCompany({message:''},form())).selectedCompanyId).toBeUndefined()};expect(io.set).not.toHaveBeenCalled()
})
it('unauthenticated GoTrue, duplicate selector and body actor authority cannot invoke native selection or set a cookie',async()=>{
 const duplicate=form();duplicate.append('company_id',foreign);const authority=form();authority.set('actor_user_id',actor)
 for(const bad of [duplicate,authority,form('not-uuid')])await selectRetentionCompany({message:''},bad)
 io.getUser.mockResolvedValue({data:{user:null},error:null});await selectRetentionCompany({message:''},form());expect(io.rpc).not.toHaveBeenCalled();expect(io.set).not.toHaveBeenCalled()
})
it('the company list is an actual authenticated native read and accepts only own native class-qualified statuses',async()=>{
 io.rpc.mockResolvedValue({data:[{companyId:company,name:'Own archived fixture',status:'archived',permissions:rights}],error:null});expect((await requireRetentionCompanies()).companies).toEqual([{companyId:company,name:'Own archived fixture',status:'archived',permissions:rights}]);expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_current_retention_companies_v1',{})
 io.rpc.mockResolvedValue({data:[{companyId:foreign,name:'Hostile',status:'deleted',permissions:rights}],error:null});await expect(requireRetentionCompanies()).rejects.toBeDefined()
})
it('a native closed company does not prevent listing an active company in the same authenticated workspace',async()=>{
 io.rpc.mockResolvedValue({data:[
  {companyId:company,name:'Own active fixture',status:'active',permissions:rights},
  {companyId:foreign,name:'Own closed fixture',status:'closed',permissions:['ediel.retention.read','ediel.retention.legal_history']},
 ],error:null})
 const result=await requireRetentionCompanies()
 expect(result.userId).toBe(actor)
 expect(result.companies).toEqual([
  {companyId:company,name:'Own active fixture',status:'active',permissions:['ediel.retention.review','ediel.retention.legal_history']},
  {companyId:foreign,name:'Own closed fixture',status:'closed',permissions:['ediel.retention.read','ediel.retention.legal_history']},
 ])
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_current_retention_companies_v1',{})
 expect(io.set).not.toHaveBeenCalled()
})
it('allowing native closed companies still rejects an unknown company status',async()=>{
 io.rpc.mockResolvedValue({data:[{companyId:company,name:'Invalid status fixture',status:'deleted_test_only',permissions:rights}],error:null})
 await expect(requireRetentionCompanies()).rejects.toBeDefined()
 expect(io.set).not.toHaveBeenCalled()
})
