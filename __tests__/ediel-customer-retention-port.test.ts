import {beforeEach,expect,it,vi} from 'vitest'
const port=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:port.getUser},rpc:port.rpc})}))
import {pseudonymiseCustomerRetention,reviewCustomerRetention,submitCustomerRetention} from '@/lib/ediel/retention/customerLifecycleRetention'
const companyId='00000000-0000-4000-8000-000000000001',customerId='00000000-0000-4000-8000-000000000002',decisionId='00000000-0000-4000-8000-000000000003',actor='00000000-0000-4000-8000-000000000004'
beforeEach(()=>{vi.clearAllMocks();port.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});port.rpc.mockResolvedValue({data:{status:'held',missing:['operative_customer_closed_and_no_active_supply']},error:null})})
it('an operative customer closure hold is preserved without pretending a requested deletion was completed',async()=>{
 expect(await pseudonymiseCustomerRetention({companyId,decisionId})).toEqual({status:'held',missing:['operative_customer_closed_and_no_active_supply']})
 expect(port.rpc).toHaveBeenCalledExactlyOnceWith('ediel_pseudonymise_customer_retention_v1',{p_company_id:companyId,p_actor_user_id:actor,p_decision_id:decisionId})
})
it('uses real session actor for class-specific native submission and sends actual decision document bytes',async()=>{
 const document=Buffer.from('SYNTHETIC personal-field policy'),data={status:'submitted',decisionId,sourceHash:'a'.repeat(64),documentHash:'b'.repeat(64),retentionClass:'customer_canonical_personal_fields',issuerQualified:false};port.rpc.mockResolvedValue({data,error:null})
 expect(await submitCustomerRetention({companyId,customerId,document,issuerReceipt:null})).toEqual(data)
 expect(port.rpc).toHaveBeenCalledExactlyOnceWith('ediel_submit_customer_retention_v1',{p_company_id:companyId,p_actor_user_id:actor,p_customer_id:customerId,p_document_base64:document.toString('base64'),p_issuer_receipt:null})
})
it('a native review cannot be upgraded by the caller asking to approve',async()=>{
 port.rpc.mockResolvedValue({data:{status:'held',decisionId},error:null})
 expect((await reviewCustomerRetention({companyId,decisionId,outcome:'approve',reason:'SYNTHETIC review'})).status).toBe('held')
})
it('requires current authentication before entering the native lifecycle consumer',async()=>{
 port.getUser.mockResolvedValue({data:{user:null},error:null});await expect(pseudonymiseCustomerRetention({companyId,decisionId})).rejects.toThrow('authenticated_actor_required');expect(port.rpc).not.toHaveBeenCalled()
})
it('returns only an actual native immutable source-hash tombstone and rejects fabricated deletion flags',async()=>{
 port.rpc.mockResolvedValue({data:{status:'pseudonymised',customerId,sourceHash:'invalid',pseudonymisedAt:'2026-10-01T01:00:00Z',replay:true},error:null});await expect(pseudonymiseCustomerRetention({companyId,decisionId})).rejects.toThrow()
})
