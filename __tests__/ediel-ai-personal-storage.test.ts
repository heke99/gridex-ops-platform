import {beforeEach,expect,it,vi} from 'vitest'
import {requireAiBiPersonalDataStorage} from '@/lib/ediel/aiBiPersonalDataStorage'
const io=vi.hoisted(()=>({decision:vi.fn(),tenant:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/aiBiProcessingDecision',()=>({requireAiBiProcessingDecision:io.decision}))
vi.mock('@/lib/ediel/tenant/tenantEdielIdentity',()=>({resolveCanonicalTenantEdielIdentityWithEvidence:io.tenant}))
const companyId='00000000-0000-4000-8000-000000000001',actorUserId='00000000-0000-4000-8000-000000000002',decisionId='00000000-0000-4000-8000-000000000003'
const csv='AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;12345;;;;;;;199001011234;Person;;;'
const input={companyId,actorUserId,environment:'test',candidates:[csv]}
beforeEach(()=>{vi.clearAllMocks();io.decision.mockRejectedValue(new Error('ai_bi_processing_decision_missing'))})
it('leaves unrelated actual EDIFACT storage outside the AI decision path',async()=>{
 await expect(requireAiBiPersonalDataStorage({...input,candidates:["UNB+UNOC:3'",'AI in subject prose']})).resolves.toBeNull()
 expect(io.decision).not.toHaveBeenCalled();expect(io.tenant).not.toHaveBeenCalled();expect(io.rpc).not.toHaveBeenCalled()
})
it.each([{companyId:null},{actorUserId:null},{actorUserId:'system'},{environment:null}])('holds unqualified actual tenant/actor before any decision or persistence',async override=>{
 await expect(requireAiBiPersonalDataStorage({...input,...override})).rejects.toThrow('ai_bi_personal_storage_tenant_actor_required')
 expect(io.decision).not.toHaveBeenCalled();expect(io.tenant).not.toHaveBeenCalled()
})
it('holds the decoded personal source before any tenant data read when the legal owner is absent',async()=>{
 await expect(requireAiBiPersonalDataStorage(input)).rejects.toThrow('ai_bi_processing_decision_missing')
 expect(io.tenant).not.toHaveBeenCalled();expect(io.rpc).not.toHaveBeenCalled()
})
it('never fixes padded headers, malformed full records or mixed AI/BI containers into accepted storage',async()=>{
 await expect(requireAiBiPersonalDataStorage({...input,candidates:[' '+csv]})).rejects.toThrow('ai_bi_personal_storage_header_invalid')
 await expect(requireAiBiPersonalDataStorage({...input,candidates:[csv+';BAD']})).rejects.toThrow('ai_bi_personal_storage_technical_source_invalid')
 await expect(requireAiBiPersonalDataStorage({...input,candidates:[csv,'BI;54321;Network;12345;Supplier;202610011200;20261001;;;Ver20140401']})).rejects.toThrow('ai_bi_personal_storage_mixed_types')
 expect(io.decision).not.toHaveBeenCalled()
})
it('requires actual canonical supplier identity rather than mailbox company or transport hints',async()=>{
 io.decision.mockResolvedValue({id:decisionId});io.tenant.mockResolvedValue({identity:{legalEdielId:'99999',roleCodes:['electricity_supplier']}})
 await expect(requireAiBiPersonalDataStorage(input)).rejects.toThrow('ai_bi_header_supplier_tenant_mismatch')
 expect(io.rpc).not.toHaveBeenCalled()
})
it('keeps missing authenticated network-register version held even after a synthetic legal-decision mock',async()=>{
 io.decision.mockResolvedValue({id:decisionId});io.tenant.mockResolvedValue({identity:{legalEdielId:'12345',roleCodes:['electricity_supplier']}})
 io.rpc.mockResolvedValue({data:{status:'held',blocker:'ai_bi_network_registry_version_unqualified'},error:null})
 await expect(requireAiBiPersonalDataStorage(input)).rejects.toThrow('ai_bi_network_registry_version_unqualified')
 expect(io.rpc).toHaveBeenCalledWith('gridex_ai_bi_personal_storage_scope_v1',{p_company_id:companyId,p_actor_user_id:actorUserId,p_environment:'test',p_header_line:csv.split('\n')[0]})
})
