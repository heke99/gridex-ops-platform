// masterplan: AI-05, AT-AI-05, SC-067, AI-04, AT-AI-04, SC-066
import {beforeEach,expect,it,vi} from 'vitest'
import {approveAiBiDiscrepancy} from '@/lib/ediel/aiBiReconciliation'
import {importAiBiListCsv} from '@/lib/ediel/aiBiImportEngine'
import {requireAiBiProcessingDecision} from '@/lib/ediel/aiBiProcessingDecision'
import {projectAiBiStoredRawColumns} from '@/lib/ediel/aiBiImportParser'

const io=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),actor:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
const companyId='00000000-0000-4000-8000-000000000001',actorUserId='00000000-0000-4000-8000-000000000002'
const scope={companyId,actorUserId,listType:'AI' as const}
const sourceMessageId='00000000-0000-4000-8000-000000000004'
// Synthetic positional protocol sample only, never a mandate/retention decision.
const csv='AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;12345;;;;;;;199001011234;Person;;;\n'
beforeEach(()=>{vi.clearAllMocks();io.actor.mockResolvedValue(undefined);io.from.mockImplementation(()=>{throw Error('unexpected persistence')})})
it.each(['ai_bi_processing_decision_missing','ai_bi_processing_decision_owner_registry_unqualified','ai_bi_processing_decision_ambiguous'])('holds %s before raw, row, discrepancy or masterdata writes',async blocker=>{
 io.rpc.mockResolvedValue({data:{status:'held',blocker},error:null})
 await expect(importAiBiListCsv({...scope,rawCsv:csv,sourceMessageId})).rejects.toThrow(blocker)
 expect(io.from).not.toHaveBeenCalled()
 expect(io.rpc).toHaveBeenCalledWith('gridex_ai_bi_reconcile_source_v1',expect.objectContaining({p_company_id:companyId,p_actor_user_id:actorUserId,p_source_message_id:sourceMessageId}))
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
it.each(['accepted','rejected','accepted_manual_apply'] as const)('records an explicit %s investigation decision in its own tenant with audit, without applying masterdata',async decision=>{
 const discrepancyId='00000000-0000-4000-8000-000000000003',update=vi.fn(),filters:unknown[][]=[]
 const query={update:(value:unknown)=>{update(value);return query},eq:(...args:unknown[])=>{filters.push(args);return filters.length===2?Promise.resolve({error:null}):query}}
 io.from.mockReturnValue(query)
 expect(await approveAiBiDiscrepancy({companyId,actorUserId,discrepancyId,decision,note:'Declared operator investigation'})).toEqual({ok:true,discrepancyId,decision})
 expect(io.actor).toHaveBeenCalledWith({companyId,actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']})
 expect(io.from.mock.calls).toEqual([['ai_list_discrepancies']])
 expect(filters).toEqual([['company_id',companyId],['id',discrepancyId]])
 expect(update).toHaveBeenCalledWith({status:decision==='rejected'?'rejected':'resolved',resolution:decision,resolution_note:'Declared operator investigation',resolved_by:actorUserId,resolved_at:expect.any(String)})
 expect(Number.isFinite(Date.parse(update.mock.calls[0][0].resolved_at))).toBe(true)
 expect(io.rpc).not.toHaveBeenCalled()
})
it('uses only a sealed source/hash atomic RPC without caller matching, filename or retention authority',async()=>{
 const importId='00000000-0000-4000-8000-000000000005'
 io.rpc.mockResolvedValue({data:{status:'applied',importId,rowCount:1,discrepancyCount:1},error:null})
 await expect(importAiBiListCsv({...scope,sourceMessageId,rawCsv:csv,filename:'fake',gridOwnerId:'fake'})).resolves.toEqual({importId,rowCount:1,discrepancyCount:1})
 expect(io.rpc).toHaveBeenCalledTimes(1)
 expect(Object.keys(io.rpc.mock.calls[0][1]).sort()).toEqual(['p_actor_user_id','p_company_id','p_source_message_id','p_source_payload_hash'])
 expect(io.from).not.toHaveBeenCalled()
})
it('rejects missing sealed source and invalid native whole-source outcomes',async()=>{
 await expect(importAiBiListCsv({...scope,rawCsv:csv})).rejects.toThrow('ai_bi_reconciliation_sealed_source_required')
 expect(io.rpc).not.toHaveBeenCalled()
 io.rpc.mockResolvedValue({data:{status:'applied',importId:sourceMessageId,rowCount:2,discrepancyCount:0},error:null})
 await expect(importAiBiListCsv({...scope,sourceMessageId,rawCsv:csv})).rejects.toThrow('ai_bi_reconciliation_result_invalid')
})
it('names native physical columns through the shared positional adapter',()=>{
 const columns=['NET','735123456789012345','9','','','','','Street','12345','Town','12345','','','','','','','199001011234','Person','','']
 expect(projectAiBiStoredRawColumns({physical_columns:columns})).toMatchObject({grid_area:'NET',customer_identity:'199001011234',customer_name:'Person'})
 expect(()=>projectAiBiStoredRawColumns({physical_columns:columns.slice(1)})).toThrow('ai_bi_stored_columns_invalid')
})

it('uses the exact protected environment decision port and rejects a foreign environment receipt',async()=>{
 io.rpc.mockResolvedValue({data:{status:'authorized',decision:{id:sourceMessageId,companyId,listType:'AI',environment:'production',purpose:'ediel_list_reconciliation',revision:1,gdprBasis:'SYNTHETIC',retentionDays:30,retentionUntil:'2026-11-01',sourceReference:'SYNTHETIC',sourceSha256:'a'.repeat(64),ownerRegistryId:sourceMessageId,ownerRegistryVersion:'SYNTHETIC'}},error:null})
 await expect(requireAiBiProcessingDecision({...scope,environment:'test'})).rejects.toThrow('ai_bi_processing_decision_invalid')
 expect(io.rpc).toHaveBeenCalledWith('ediel_ai_bi_processing_decision_v2',{p_company_id:companyId,p_actor_user_id:actorUserId,p_list_type:'AI',p_environment:'test'})
})
