import { describe,expect,it,vi } from 'vitest'
vi.mock('server-only',()=>({}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{}}))
vi.mock('@/lib/customer-contracts/onlineSigning',()=>({sendOnlineContractSignatureRequest:vi.fn()}))
import { autoSendSigningLinkAfterCreate,type AutoSendSigningLinkDeps } from '@/lib/customer-contracts/autoSendSigningLink'
const input={companyId:'company-a',customerId:'customer-a',contractId:'contract-a',actorUserId:'staff-a',actorCanWriteContracts:true}
describe('automatic OPS signing-link delivery reports actual durable state',()=>{
  it.each(['sent','queued','processing','delivery_uncertain','cancelled','blocked_tenant_state','unknown'])('preserves %s without inventing provider success',async state=>{
    const send=vi.fn(async()=>({deliveryStatus:state})) as unknown as AutoSendSigningLinkDeps['send']
    const result=await autoSendSigningLinkAfterCreate(input,{
      loadContract:async()=>({status:'pending_signature',signed_at:null}),loadCustomerEmail:async()=> 'signer@example.invalid',
      hasActiveSignatureRequest:async()=>false,hasValidSigningSite:async()=>true,send,logError:()=>undefined,
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(result.status).toBe(state==='sent'?'sent':['queued','processing'].includes(state)?'queued':'needs_review')
    if(state!=='sent')expect(result.message).not.toContain('Signeringslänk skickad')
    if(['delivery_uncertain','unknown'].includes(state))expect(result.message).toMatch(/gransk|okänt/)
  })
})
