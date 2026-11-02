import {beforeEach,describe,expect,it,vi} from 'vitest'
import {parseAmendmentProposal} from '@/lib/customer-contracts/amendmentInput'

const predecessor='10000000-0000-4000-8000-000000000001'
const successor='10000000-0000-4000-8000-000000000002'
function form(patch:Record<string,string>={}) {
  const f=new FormData()
  for(const [key,value] of Object.entries({customer_id:'10000000-0000-4000-8000-000000000003',
    predecessor_contract_id:predecessor,successor_contract_id:successor,
    request_id:'10000000-0000-4000-8000-000000000004',effective_from:'2028-02-29',
    reason:'Kunden har begärt nya villkor',acknowledge_new_signature:'on',...patch})) f.set(key,value)
  return f
}
describe('signed amendment proposal input is shape validation, not acceptance authority',()=>{
  it('normalizes IDs and reason while preserving the explicit effective day',()=>{
    const result=parseAmendmentProposal(form({successor_contract_id:successor.toUpperCase(),reason:'  Nya villkor  '}))
    expect(result).toEqual({ok:true,value:{customerId:'10000000-0000-4000-8000-000000000003',predecessorContractId:predecessor,
      successorContractId:successor,requestId:'10000000-0000-4000-8000-000000000004',effectiveFrom:'2028-02-29',reason:'Nya villkor',acknowledgeNewSignature:true}})
    expect(result).not.toHaveProperty('signedAt')
    expect(result).not.toHaveProperty('companyId')
  })
  it.each(['2027-02-29','2028-02-30','2028-04-31','0000-01-01','2028-13-01','2028-00-01','2028-01-00','2028-01-32','2028-2-01','2028-01-01T00:00:00Z'])('rejects malformed Gregorian day %s',effective_from=>{
    expect(parseAmendmentProposal(form({effective_from}))).toMatchObject({ok:false,field:'effective_from'})
  })
  it.each(['2000-02-29','1900-02-28','0001-01-01','9999-12-31'])('accepts Gregorian date shape %s without asserting future policy',effective_from=>{
    expect(parseAmendmentProposal(form({effective_from}))).toMatchObject({ok:true,value:{effectiveFrom:effective_from}})
  })
  it('refuses identical versions even when case differs',()=>{
    expect(parseAmendmentProposal(form({successor_contract_id:predecessor.toUpperCase()}))).toMatchObject({ok:false,field:'successor_contract_id'})
  })
  it.each(['customer_id','predecessor_contract_id','successor_contract_id','request_id'])('requires a real canonical UUID in %s',field=>{
    for(const value of ['','not-a-uuid','00000000-0000-0000-0000-000000000000']) expect(parseAmendmentProposal(form({[field]:value}))).toMatchObject({ok:false,field})
  })
  it.each(['','true','1','off'])('requires the explicit staff acknowledgement: %s',acknowledge_new_signature=>{
    expect(parseAmendmentProposal(form({acknowledge_new_signature}))).toMatchObject({ok:false,field:'acknowledge_new_signature'})
  })
  it('rejects duplicate fields and caller-supplied authority fields',()=>{
    const duplicate=form();duplicate.append('effective_from','2029-01-01')
    expect(parseAmendmentProposal(duplicate)).toMatchObject({ok:false,field:'effective_from'})
    for(const field of ['actor_user_id','company_id','signed_at','state']) {
      const input=form();input.set(field,'CALLER_VALUE')
      expect(parseAmendmentProposal(input)).toMatchObject({ok:false,field})
    }
  })
  it('rejects binary values, missing fields and unbounded reasons',()=>{
    const binary=form();binary.set('reason',new Blob(['value']),'reason.txt')
    expect(parseAmendmentProposal(binary)).toMatchObject({ok:false,field:'reason'})
    const missing=form();missing.delete('request_id')
    expect(parseAmendmentProposal(missing)).toMatchObject({ok:false,field:'request_id'})
    for(const reason of ['   ','x'.repeat(1001),'a\u0000b']) expect(parseAmendmentProposal(form({reason}))).toMatchObject({ok:false,field:'reason'})
  })
  it('ignores framework transport metadata without treating it as domain data',()=>{
    const input=form();input.set('$ACTION_REF_0','transport-only')
    expect(parseAmendmentProposal(input)).toMatchObject({ok:true})
    expect(parseAmendmentProposal(input)).not.toHaveProperty('value.$ACTION_REF_0')
  })
})

const ports=vi.hoisted(()=>({guard:vi.fn(),context:vi.fn(),contract:vi.fn(),rpc:vi.fn(),revalidate:vi.fn()}))
vi.mock('@/lib/admin/guards',()=>({requireAdminActionAccess:ports.guard}))
vi.mock('@/lib/tenant/entityGuards',()=>({loadCustomerTenantContext:ports.context,assertContractTenant:ports.contract}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:ports.rpc}}))
vi.mock('next/cache',()=>({revalidatePath:ports.revalidate}))
describe('ordinary amendment server action proposes only within authenticated tenant authority',()=>{
 beforeEach(()=>{
  vi.clearAllMocks()
  ports.guard.mockResolvedValue({userId:'ACTUAL_SESSION_USER',companyId:'SESSION_COMPANY'})
  ports.context.mockResolvedValue({companyId:'ACTUAL_SCOPED_COMPANY'})
  ports.contract.mockResolvedValue(undefined)
  ports.rpc.mockResolvedValue({data:{state:'PROPOSED_NOT_ACCEPTED',proposalId:'10000000-0000-4000-8000-000000000004',
   predecessorContractId:predecessor,successorContractId:successor,effectiveFrom:'2028-02-29',proposalSHA256:'a'.repeat(64)},error:null})
 })
 it('uses server-derived actor/company and verifies both contracts before its single native proposal',async()=>{
  const {proposeSignedContractAmendmentAction}=await import('@/app/admin/customers/[id]/contracts/[contractId]/amend/actions')
  const result=await proposeSignedContractAmendmentAction(form())
  expect(ports.guard).toHaveBeenCalledWith({allOf:['contracts.write','contracts.create']})
  expect(ports.contract.mock.calls.map(call=>call[0])).toEqual([
   {companyId:'ACTUAL_SCOPED_COMPANY',customerId:'10000000-0000-4000-8000-000000000003',contractId:predecessor},
   {companyId:'ACTUAL_SCOPED_COMPANY',customerId:'10000000-0000-4000-8000-000000000003',contractId:successor}])
  expect(ports.rpc).toHaveBeenCalledExactlyOnceWith('gridex_propose_signed_contract_amendment_v1',{
   p_company_id:'ACTUAL_SCOPED_COMPANY',p_customer_id:'10000000-0000-4000-8000-000000000003',p_predecessor_id:predecessor,p_successor_id:successor,
   p_effective_from:'2028-02-29',p_actor_user_id:'ACTUAL_SESSION_USER',p_request_id:'10000000-0000-4000-8000-000000000004',p_reason:'Kunden har begärt nya villkor',p_acknowledge_new_signature:true})
  expect(result).toMatchObject({status:'proposed',receipt:{state:'PROPOSED_NOT_ACCEPTED',predecessorContractId:predecessor,successorContractId:successor}})
  expect(result).not.toHaveProperty('signedAt')
 })
 it('rejects missing authentication or either tenant check before writing',async()=>{
  const {proposeSignedContractAmendmentAction}=await import('@/app/admin/customers/[id]/contracts/[contractId]/amend/actions')
  ports.guard.mockRejectedValueOnce(new Error('unauthorized'))
  await expect(proposeSignedContractAmendmentAction(form())).rejects.toThrow('unauthorized')
  expect(ports.rpc).not.toHaveBeenCalled()
  ports.contract.mockRejectedValueOnce(new Error('foreign contract'))
  await expect(proposeSignedContractAmendmentAction(form())).rejects.toThrow('foreign contract')
  expect(ports.rpc).not.toHaveBeenCalled()
 })
 it('reports expected native refusals as unsaved proposals and never retries unknown outcomes',async()=>{
  const {proposeSignedContractAmendmentAction}=await import('@/app/admin/customers/[id]/contracts/[contractId]/amend/actions')
  ports.rpc.mockResolvedValueOnce({data:null,error:{code:'23514',message:'signed_amendment_future_boundary_required'}})
  expect(await proposeSignedContractAmendmentAction(form())).toMatchObject({status:'invalid',field:'effective_from'})
  expect(ports.revalidate).not.toHaveBeenCalled()
  ports.rpc.mockRejectedValueOnce(new Error('unknown transport outcome'))
  await expect(proposeSignedContractAmendmentAction(form())).rejects.toThrow('unknown transport outcome')
  expect(ports.rpc).toHaveBeenCalledTimes(2)
 })
 it('rejects a mismatched receipt or false acceptance state without displaying success',async()=>{
  const {proposeSignedContractAmendmentAction}=await import('@/app/admin/customers/[id]/contracts/[contractId]/amend/actions')
  for(const patch of [{successorContractId:predecessor},{effectiveFrom:'2099-01-01'},{state:'ACCEPTED'}]) {
   const original=ports.rpc.getMockImplementation()!()
   const value=await original
   ports.rpc.mockResolvedValueOnce({...value,data:{...value.data,...patch}})
   await expect(proposeSignedContractAmendmentAction(form())).rejects.toThrow('amendment_proposal_receipt_mismatch')
  }
  expect(ports.revalidate).not.toHaveBeenCalled()
 })
})
