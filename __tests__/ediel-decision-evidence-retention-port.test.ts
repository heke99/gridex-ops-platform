import {beforeEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:io.auth},rpc:io.rpc})}))
import {submitDecisionEvidenceRetention,reviewDecisionEvidenceRetention,purgeDecisionEvidenceRetention,readRetentionDecisionOriginal} from '@/lib/ediel/retention/decisionEvidenceRetention'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',target='00000000-0000-4000-8000-000000000003',policy='00000000-0000-4000-8000-000000000004',document=Buffer.from('SYNTHETIC legal original; no competence claim')
const input={companyId:company,retentionClass:'blob_retention_decision_original_bytes' as const,targetId:target,document,issuerReceipt:null}
const documentHash=createHash('sha256').update(document).digest('hex')
beforeEach(()=>{vi.resetAllMocks();io.auth.mockResolvedValue({data:{user:{id:actor}},error:null});io.rpc.mockResolvedValue({data:{status:'submitted',policyId:policy,retentionClass:input.retentionClass,targetId:target,documentHash,sourceHash:'b'.repeat(64),issuerQualified:false},error:null})})
// Finite actual session/RPC-port mechanics only. Native functions own all legal,
// separate reviewer, source-hash, deadline and immutable-transition authority.
it('archives exact document bytes with actual session actor and source selectors, never caller qualification',async()=>{
 expect(await submitDecisionEvidenceRetention(input)).toMatchObject({issuerQualified:false})
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_submit_decision_evidence_retention_v1',{p_company_id:company,p_actor_user_id:actor,p_retention_class:input.retentionClass,p_target_id:target,p_document_base64:document.toString('base64'),p_issuer_receipt:null})
})
it.each(['artifact_retention_decision_original_bytes','blob_retention_decision_original_bytes','record_retention_decision_original_bytes','process_retention_decision_original_bytes','decision_evidence_policy_original_bytes','finance_retention_decision_original_bytes','invoice_file_retention_decision_original_bytes','customer_retention_decision_original_bytes','life_event_classification_source_original_bytes','life_event_classification_receipt_original_bytes','life_event_classification_revocation_original_bytes'] as const)('keeps independent original namespace %s',async retentionClass=>{
 io.rpc.mockResolvedValue({data:{status:'submitted',policyId:policy,retentionClass,targetId:target,documentHash,sourceHash:'b'.repeat(64),issuerQualified:false},error:null})
 await submitDecisionEvidenceRetention({...input,retentionClass});expect(io.rpc.mock.calls[0][1].p_retention_class).toBe(retentionClass)
})
it('denies missing current GoTrue actor before any mutation',async()=>{io.auth.mockResolvedValue({data:{user:null},error:null});await expect(submitDecisionEvidenceRetention(input)).rejects.toThrow('authenticated');expect(io.rpc).not.toHaveBeenCalled()})
it('rejects oversize document before archive or source read',async()=>{await expect(submitDecisionEvidenceRetention({...input,document:Buffer.alloc(1048577)})).rejects.toThrow('document');expect(io.rpc).not.toHaveBeenCalled()})
it('rejects inconsistent returned archive hash without treating a receipt as source authority',async()=>{io.rpc.mockResolvedValue({data:{status:'submitted',policyId:policy,retentionClass:input.retentionClass,targetId:target,documentHash:'a'.repeat(64),sourceHash:'b'.repeat(64),issuerQualified:false},error:null});await expect(submitDecisionEvidenceRetention(input)).rejects.toThrow('scope')})
it('preserves native held separate review without synthesizing approval',async()=>{io.rpc.mockResolvedValue({data:{status:'held',policyId:policy,reviewId:target},error:null});expect(await reviewDecisionEvidenceRetention({companyId:company,policyId:policy,outcome:'approve',reason:'Synthetic request'})).toMatchObject({status:'held'});expect(io.rpc.mock.calls[0][1].p_actor_user_id).toBe(actor)})
it('preserves a retained hash tombstone with unavailable bytes and no fresh authority',async()=>{
 io.rpc.mockResolvedValue({data:{companyId:company,retentionClass:input.retentionClass,targetId:target,targetMetadataHash:'c'.repeat(64),documentHash:'b'.repeat(64),documentByteLength:document.length,bytesAvailable:false,documentBase64:null,purgedAt:'2026-10-01T00:00:00Z',authority:'none'},error:null})
 expect(await readRetentionDecisionOriginal({companyId:company,retentionClass:input.retentionClass,targetId:target})).toMatchObject({bytesAvailable:false,documentBase64:null,authority:'none'})
 expect(io.rpc.mock.calls[0][1].p_include_document).toBe(false)
})
it('rejects foreign original scope without returning bytes',async()=>{io.rpc.mockResolvedValue({data:{companyId:target,retentionClass:input.retentionClass,targetId:target,targetMetadataHash:'c'.repeat(64),documentHash:'b'.repeat(64),documentByteLength:document.length,bytesAvailable:false,documentBase64:null,purgedAt:'2026-10-01T00:00:00Z',authority:'none'},error:null});await expect(readRetentionDecisionOriginal({companyId:company,retentionClass:input.retentionClass,targetId:target})).rejects.toThrow('scope')})
it('returns actual native completed replay without treating old policy as fresh approval',async()=>{io.rpc.mockResolvedValue({data:{status:'purged',retentionClass:input.retentionClass,targetId:target,sourceHash:'b'.repeat(64),byteLength:document.length,bytesAvailable:false,authority:'none',replay:true},error:null});expect(await purgeDecisionEvidenceRetention({companyId:company,policyId:policy})).toMatchObject({status:'purged',bytesAvailable:false,replay:true,authority:'none'});expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_purge_decision_evidence_retention_v1',{p_company_id:company,p_actor_user_id:actor,p_policy_id:policy})})
