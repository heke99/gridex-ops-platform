import {beforeEach,expect,it,vi} from 'vitest'
import {approveAiBiDiscrepancy} from '@/lib/ediel/aiBiReconciliation'
import {importAiBiListCsv} from '@/lib/ediel/aiBiImportEngine'
import {requireAiBiProcessingDecision} from '@/lib/ediel/aiBiProcessingDecision'

const io=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),actor:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
const companyId='00000000-0000-4000-8000-000000000001',actorUserId='00000000-0000-4000-8000-000000000002'
const scope={companyId,actorUserId,listType:'AI' as const}
// Synthetic positional protocol sample only, never a mandate/retention decision.
const csv='AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;12345;;;;;;;199001011234;Person;;;\n'
beforeEach(()=>{vi.clearAllMocks();io.actor.mockResolvedValue(undefined);io.from.mockImplementation(()=>{throw Error('unexpected persistence')})})
it.each(['ai_bi_processing_decision_missing','ai_bi_processing_decision_owner_registry_unqualified','ai_bi_processing_decision_ambiguous'])('holds %s before raw, row, discrepancy or masterdata writes',async blocker=>{
 io.rpc.mockResolvedValue({data:{status:'held',blocker},error:null})
 await expect(importAiBiListCsv({...scope,rawCsv:csv})).rejects.toThrow(blocker)
 expect(io.from).not.toHaveBeenCalled()
 expect(io.rpc).toHaveBeenCalledWith('gridex_ai_bi_processing_decision_v1',{p_company_id:companyId,p_actor_user_id:actorUserId,p_list_type:'AI'})
})
it('checks the current tenant actor before decision or data reads',async()=>{
 io.actor.mockRejectedValue(new Error('ediel_tenant_actor_forbidden'))
 await expect(requireAiBiProcessingDecision(scope)).rejects.toThrow('ediel_tenant_actor_forbidden')
 expect(io.rpc).not.toHaveBeenCalled();expect(io.from).not.toHaveBeenCalled()
})
it('rejects malformed alleged authorized scope instead of borrowing a basis/365-day default',async()=>{
 io.rpc.mockResolvedValue({data:{status:'authorized',decision:{companyId:'other'}},error:null})
 await expect(requireAiBiProcessingDecision(scope)).rejects.toThrow('ai_bi_processing_decision_invalid')
 expect(io.from).not.toHaveBeenCalled()
})

it('denies discrepancy decisions from an unaccepted actor before any write',async()=>{
 io.actor.mockRejectedValue(new Error('ediel_tenant_actor_forbidden'))
 await expect(approveAiBiDiscrepancy({companyId,actorUserId,discrepancyId:'00000000-0000-4000-8000-000000000003',decision:'accepted'})).rejects.toThrow('ediel_tenant_actor_forbidden')
 expect(io.from).not.toHaveBeenCalled()
})
