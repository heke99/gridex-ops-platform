// masterplan: SC-008
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'

const boundary=vi.hoisted(()=>({
  actor:'',selectedCompany:null as string|null,platform:false,roles:[] as string[],permissions:[] as string[],
  contextActor:'',row:{} as Record<string,unknown>,from:vi.fn(),rpc:vi.fn(),
  reads:[] as Array<Array<[string,unknown]>>,
}))
// Declared authentication context and database-query ports only. The actual
// server guards, tenant scope and message reader remain production functions.
// No canonical acceptance, source contract, permission link or native custody
// is inferred from this raw-read fixture; those have separate asserting tests.
vi.mock('react',()=>({cache:<T>(fn:T)=>fn}))
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>boundary.selectedCompany?{value:boundary.selectedCompany}:undefined})}))
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw Error('redirect:'+path)}}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({
  auth:{getUser:async()=>({data:{user:{id:boundary.actor,email:'synthetic-reader@example.invalid'}},error:null})},rpc:boundary.rpc,
})}))
vi.mock('@/lib/tenant/scope',()=>({
  listOperationalCompaniesForUser:async()=>boundary.selectedCompany?[{companyId:boundary.selectedCompany,companyStatus:'active'}]:[],
  getOperationalCompanyScope:async()=>({companyId:boundary.selectedCompany,companyName:'Synthetic selected company'}),
}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:boundary.from}}))
import {requireAdminPageKeyAccess,requirePlatformAdminAccess,isPlatformAdminContext} from '@/lib/admin/guards'
import {resolveAdminTenantReadScope,tenantReadCompanyId} from '@/lib/tenant/adminScope'
import {getEdielMessageById} from '@/lib/ediel/db'
import {utiltsErrGatewayFixture} from './helpers/utiltsErrGatewayFixture'

const owner='11111111-1111-4111-8111-111111111111',beneficiary='22222222-2222-4222-8222-222222222222'
const actor='33333333-3333-4333-8333-333333333333',messageId='44444444-4444-4444-8444-444444444444'
const ownPoint='735999260731000007',foreignPoint='735999260731000014'
const original=utiltsErrGatewayFixture({company:owner,transactions:[{reference:'SC008-OWN',outcome:'accepted'},{reference:'SC008-FOREIGN',outcome:'accepted'}]})
const foreignStart=original.raw_payload!.indexOf('IDE+24+SC008-FOREIGN')
const raw=original.raw_payload!.slice(0,foreignStart)+original.raw_payload!.slice(foreignStart).replaceAll(ownPoint,foreignPoint)

// Same guard/scope/reader chain used by /admin/messages/[id]. A beneficiary
// capability does not replace that selected tenant with the raw source owner.
async function taskMessageRead(){
  const access=await requireAdminPageKeyAccess('operations.tasks')
  const scope=await resolveAdminTenantReadScope(access)
  return getEdielMessageById(messageId,{companyId:scope.companyId??undefined})
}
async function platformRawRead(){
  const access=await requirePlatformAdminAccess()
  return getEdielMessageById(messageId,{companyId:tenantReadCompanyId(isPlatformAdminContext(access),boundary.selectedCompany)})
}

describe('SC008 incoming mixed original server disclosure boundary',()=>{
  afterEach(()=>{expect(boundary.row).toEqual({...original,id:messageId,company_id:owner,raw_payload:raw})})
  beforeEach(()=>{
    vi.clearAllMocks();boundary.reads=[];boundary.actor=actor;boundary.contextActor=actor
    boundary.selectedCompany=beneficiary;boundary.platform=false;boundary.roles=['operations'];boundary.permissions=['metering.read']
    boundary.row={...original,id:messageId,company_id:owner,raw_payload:raw}
    boundary.rpc.mockImplementation(async(name:string)=>{
      expect(name).toBe('canonical_authenticated_tenant_context')
      return{data:{authorized:true,user_id:boundary.contextActor,user_email:'synthetic-reader@example.invalid',
        selected_company_id:boundary.selectedCompany,is_platform_admin:boundary.platform,roles:boundary.roles,permissions:boundary.permissions},error:null}
    })
    boundary.from.mockImplementation((table:string)=>{
      expect(table).toBe('ediel_messages')
      const filters:Array<[string,unknown]>=[]
      const query={select:vi.fn().mockReturnThis(),eq:vi.fn((key:string,value:unknown)=>{filters.push([key,value]);return query}),
        maybeSingle:async()=>{boundary.reads.push([...filters]);return{data:filters.every(([key,value])=>boundary.row[key]===value)?boundary.row:null,error:null}}}
      return query
    })
  })
  it('keeps a beneficiary with one scoped mission from reading the owner mixed original through a known message ID',async()=>{
    expect(foreignStart).toBeGreaterThan(0);expect(raw).toContain(ownPoint);expect(raw).toContain(foreignPoint)
    const result=await taskMessageRead()
    expect(result).toBeNull();expect(JSON.stringify(result)).not.toContain(foreignPoint)
    expect(boundary.reads).toEqual([[['id',messageId],['company_id',beneficiary]]])
    expect(boundary.rpc).toHaveBeenCalledWith('canonical_authenticated_tenant_context',{p_selected_company_id:beneficiary})
    await expect(platformRawRead()).rejects.toThrow('redirect:/admin/company-settings')
    expect(boundary.reads).toHaveLength(1)
  })
  it('returns the intact original only through the owner-scoped operator read or an authorized platform operator',async()=>{
    boundary.selectedCompany=owner
    expect((await taskMessageRead())?.raw_payload).toBe(raw)
    expect(boundary.reads[0]).toEqual([['id',messageId],['company_id',owner]])
    boundary.selectedCompany=beneficiary;boundary.platform=true;boundary.roles=['platform_admin']
    expect((await platformRawRead())?.raw_payload).toBe(raw)
    expect(boundary.reads[1]).toEqual([['id',messageId]])
  })
  it('holds a missing operational company before any unfiltered original query',async()=>{
    boundary.selectedCompany=null
    await expect(taskMessageRead()).rejects.toThrow()
    expect(boundary.from).not.toHaveBeenCalled()
  })
  it('holds a mismatched authenticated actor before reading any original',async()=>{
    boundary.contextActor=messageId
    await expect(taskMessageRead()).rejects.toThrow('Behörighetskontrollen nekades')
    expect(boundary.from).not.toHaveBeenCalled()
  })
  it('holds an owner-company member without operator read authority before fetching raw contents',async()=>{
    boundary.selectedCompany=owner;boundary.permissions=[]
    await expect(taskMessageRead()).rejects.toThrow('redirect:/login')
    expect(boundary.from).not.toHaveBeenCalled()
  })
  it('does not turn a tenant role name into platform authority to disclose the raw file',async()=>{
    boundary.roles=['platform_admin'];boundary.platform=false
    await expect(platformRawRead()).rejects.toThrow('redirect:/admin/company-settings')
    expect(boundary.from).not.toHaveBeenCalled()
  })
})
