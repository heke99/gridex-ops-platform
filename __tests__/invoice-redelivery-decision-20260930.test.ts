import { beforeEach, describe, expect, it, vi } from 'vitest'
const fixture=vi.hoisted(()=>({
  actor:'ed170000-0000-4000-8000-000000000003',session:'ed170000-0000-4000-8000-000000000005',
  company:'ed170000-0000-4000-8000-000000000001',customer:'ed170000-0000-4000-8000-000000000008',
  invoice:'ed170000-0000-4000-8000-000000000012',account:'ed170000-0000-4000-8000-000000000010',
  guard:vi.fn(),scope:vi.fn(),sessionRead:vi.fn(),rpc:vi.fn(),refresh:vi.fn(),
}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/admin/guards',()=>({requireAdminActionAccess:fixture.guard}))
vi.mock('@/lib/tenant/scope',()=>({assertUserCanOperateCompany:fixture.scope}))
vi.mock('@/lib/customer-operations/supportSession',()=>({currentSupportSession:fixture.sessionRead}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:fixture.rpc}}))
vi.mock('next/cache',()=>({revalidatePath:fixture.refresh}))
vi.mock('next/navigation',()=>({unstable_rethrow:()=>{}}))
import {recordInvoiceRedeliveryDecision,InvoiceRedeliveryDecisionError} from '@/lib/billing/invoiceRedeliveryDecision'
import {recordInvoiceRedeliveryDecisionAction} from '@/app/admin/billing/invoices/[id]/redelivery-actions'
function input(){return {companyId:fixture.company,customerId:fixture.customer,invoiceId:fixture.invoice,accountId:fixture.account,
  expectedRevision:3,expectedOverrideRevision:1,idempotencyKey:'redelivery-action-test-1',reason:'Explicit invoice copy decision'}}
function result(){return {companyId:fixture.company,customerId:fixture.customer,invoiceId:fixture.invoice,
  invoiceExportItemId:'ed170000-0000-4000-8000-000000000011',decisionId:'ed170000-0000-4000-8000-000000000020',destinationEmail:'verified@example.invalid',revision:3,contractOverrideRevision:1,
  status:'verified_delivery_decision',deliveryStatus:'blocked_provider_adapter',financialSnapshotSha256:'a'.repeat(64),documentReferencesSha256:'b'.repeat(64),replayed:false}}
beforeEach(()=>{
  fixture.guard.mockReset().mockResolvedValue({userId:fixture.actor,companyId:fixture.company,isPlatformAdmin:false})
  fixture.scope.mockReset().mockResolvedValue(undefined)
  fixture.sessionRead.mockReset().mockResolvedValue({kind:'ops',userId:fixture.actor,sessionId:fixture.session})
  fixture.rpc.mockReset().mockResolvedValue({data:result(),error:null});fixture.refresh.mockReset()
})
describe('separate invoice redelivery decision action',()=>{
  it('uses current verified actor/session and reports the persisted transport block explicitly',async()=>{
    const value=await recordInvoiceRedeliveryDecisionAction(input())
    expect(value).toMatchObject({status:'success',decisionStatus:'verified_delivery_decision',deliveryStatus:'blocked_provider_adapter'})
    expect(value.message).toMatch(/Beslutet.*sparat/);expect(value.message).toMatch(/leveransen.*ännu inte möjlig/i)
    expect(fixture.guard).toHaveBeenCalledWith(['billing_underlay.export'])
    expect(fixture.sessionRead).toHaveBeenCalledWith('ops',fixture.actor)
    expect(fixture.rpc).toHaveBeenCalledWith('gridex_record_invoice_redelivery_decision_v1',{p_command:{...input(),actorUserId:fixture.actor,sessionId:fixture.session}})
    expect(fixture.refresh).toHaveBeenCalledWith('/admin/billing/invoices/ed170000-0000-4000-8000-000000000011')
  })
  it('rejects a submitted verification flag or forged actor before service persistence',async()=>{
    expect((await recordInvoiceRedeliveryDecisionAction({...input(),verified:true,actorUserId:'forged'} as ReturnType<typeof input>)).status).toBe('error')
    expect(fixture.rpc).not.toHaveBeenCalled()
  })
  it('denies a changed selected tenant before resource/session/RPC work',async()=>{
    fixture.guard.mockResolvedValue({userId:fixture.actor,companyId:'ed170000-0000-4000-8000-000000000002',isPlatformAdmin:false})
    expect(await recordInvoiceRedeliveryDecisionAction(input())).toMatchObject({status:'error',code:'tenant_context_changed'})
    expect(fixture.scope).not.toHaveBeenCalled();expect(fixture.rpc).not.toHaveBeenCalled()
  })
  it('canonicalizes UUID case before current tenant checks and durable persistence',async()=>{
    const value=await recordInvoiceRedeliveryDecisionAction({...input(),companyId:fixture.company.toUpperCase(),customerId:fixture.customer.toUpperCase()})
    expect(value.status).toBe('success');expect(fixture.rpc.mock.calls[0][1]).toMatchObject({p_command:{companyId:fixture.company,customerId:fixture.customer}})
  })
  it.each(['guard','scope','sessionRead'] as const)('handles %s current authority failure safely before recording',async boundary=>{
    fixture[boundary].mockRejectedValue(new Error('SYNTHETIC PRIVATE SQL token=never-show'))
    const value=await recordInvoiceRedeliveryDecisionAction(input());expect(value.status).toBe('error')
    expect(value.message).not.toMatch(/PRIVATE|token=/);expect(fixture.rpc).not.toHaveBeenCalled()
  })
  it('preserves a confirmed decision when cache refresh fails',async()=>{
    fixture.refresh.mockImplementation(()=>{throw new Error('PRIVATE CACHE DETAIL')})
    expect(await recordInvoiceRedeliveryDecisionAction(input())).toMatchObject({status:'success',deliveryStatus:'blocked_provider_adapter'})
    expect(fixture.rpc).toHaveBeenCalledTimes(1)
  })
  it('validates returned resource/revision/hash and transport state instead of trusting a successful RPC',async()=>{
    for(const changes of [{companyId:'foreign'},{revision:4},{financialSnapshotSha256:'invalid'},{deliveryStatus:'sent'},{invoiceId:fixture.customer}]){
      fixture.rpc.mockResolvedValue({data:{...result(),...changes},error:null})
      await expect(recordInvoiceRedeliveryDecision({...input(),actor:{kind:'ops',userId:fixture.actor,sessionId:fixture.session}})).rejects.toMatchObject({code:'redelivery_result_invalid',status:503})
    }
  })
  it('maps only known database failures and discards raw provider/database details',async()=>{
    fixture.rpc.mockResolvedValue({data:null,error:{code:'XX000',message:'PRIVATE SQL secret=never-show'}})
    await expect(recordInvoiceRedeliveryDecision({...input(),actor:{kind:'ops',userId:fixture.actor,sessionId:fixture.session}})).rejects.toEqual(new InvoiceRedeliveryDecisionError('redelivery_unavailable',503))
    fixture.rpc.mockResolvedValue({data:null,error:{message:'redelivery_revision_conflict'}})
    expect(await recordInvoiceRedeliveryDecisionAction(input())).toMatchObject({status:'error',code:'redelivery_revision_conflict'})
  })
})
