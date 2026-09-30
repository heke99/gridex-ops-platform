import {beforeEach,expect,it,vi} from 'vitest'
import {prepareAiBiInboundReconciliation} from '@/lib/ediel/aiBiInboundReconciliation'
const io=vi.hoisted(()=>({storage:vi.fn()}))
vi.mock('@/lib/ediel/aiBiPersonalDataStorage',()=>({requireAiBiPersonalDataStorage:io.storage}))
vi.mock('@/lib/ediel/aiBiImportEngine',()=>({importAiBiListCsv:vi.fn()}))
const rawPayload='AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;12345;;;;;;;199001011234;Person;;;'
const input={companyId:'00000000-0000-4000-8000-000000000001',actorUserId:'00000000-0000-4000-8000-000000000002',environment:'production' as const,rawPayload}
beforeEach(()=>vi.clearAllMocks())
it('consumes the same first-storage tenant/header/network authority with the actual environment',async()=>{
 io.storage.mockRejectedValue(new Error('ai_bi_network_registry_version_unqualified'))
 await expect(prepareAiBiInboundReconciliation(input)).rejects.toThrow('ai_bi_network_registry_version_unqualified')
 expect(io.storage).toHaveBeenCalledWith({companyId:input.companyId,actorUserId:input.actorUserId,environment:'production',candidates:[rawPayload]})
})
it('does not substitute a null storage scope or different physical source after parsing',async()=>{
 for(const storage of [null,{listType:'AI',canonicalPayload:rawPayload+'\n',processingDecision:{id:'synthetic'}},{listType:'BI',canonicalPayload:rawPayload,processingDecision:{id:'synthetic'}}]){
  io.storage.mockResolvedValue(storage)
  await expect(prepareAiBiInboundReconciliation(input)).rejects.toThrow('ai_bi_personal_storage_scope_invalid')
 }
})
it('rejects malformed physical files before any storage authority call',async()=>{
 await expect(prepareAiBiInboundReconciliation({...input,rawPayload:'AI;invalid'})).rejects.toThrow('ai_list_header_invalid')
 expect(io.storage).not.toHaveBeenCalled()
})
