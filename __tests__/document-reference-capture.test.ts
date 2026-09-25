import {randomUUID} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const f=vi.hoisted(()=>({rpc:vi.fn(),read:vi.fn(),guard:vi.fn(),operational:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:f.rpc}}))
vi.mock('@/lib/customer-contracts/documents',()=>({downloadAndVerifyCustomerContractDocumentBounded:f.read}))
vi.mock('@/lib/admin/guards',()=>({requireCompanyScopedActionAccess:f.guard}))
vi.mock('@/lib/tenant/governance',()=>({requireCompanyOperationalForWrites:f.operational}))
import {captureDocumentReference,readDocumentReferenceContext} from '@/lib/ediel/sources/documentReferenceCapture'
import {captureDocumentReferenceAction} from '@/app/admin/ediel/document-reference-actions'
const input={companyId:randomUUID(),sourceMessageId:randomUUID(),documentId:randomUUID(),actorUserId:randomUUID(),environment:'test' as const}
const attemptId=randomUUID(),outcomeId=randomUUID(),witnessId=randomUUID(),digest='a'.repeat(64)
const document={id:input.documentId,company_id:input.companyId,customer_contract_id:randomUUID(),storage_bucket:'customer-contract-documents',storage_path:'synthetic.pdf',document_type:'signed_contract_pdf',mime_type:'application/pdf',document_sha256:digest,generation_snapshot:{schema:'synthetic'}}
const attempt={kind:'context_document_reference_v1',attemptId,...input,recordedAt:'2026-01-01T00:00:00Z',factsHash:digest,eligible:true,document}
beforeEach(()=>{vi.resetAllMocks();f.guard.mockResolvedValue({userId:input.actorUserId});f.rpc.mockImplementation((name)=>({abortSignal:async()=>({error:null,data:name.includes('begin')?attempt:name.includes('observe')?{attemptId,outcomeId,factsHash:digest,status:'verified_at_observation'}:{attemptId,outcomeId,witnessId,factsHash:digest,availableAt:'2026-01-01T00:00:02Z'}})}));f.read.mockResolvedValue({status:'verified_at_observation',startedAt:'2026-01-01T00:00:01Z',completedAt:'2026-01-01T00:00:01.1Z',byteCount:3,sha256:digest})})
it('commits attempt before storage and returns only non-authoritative witnessed identity',async()=>{f.read.mockImplementation(async()=>{expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(['gridex_begin_document_reference_v1']);return {status:'verified_at_observation',startedAt:'2026-01-01T00:00:01Z',completedAt:'2026-01-01T00:00:01.1Z',byteCount:3,sha256:digest}});expect(await captureDocumentReference(input)).toEqual({status:'recorded',kind:'context_document_reference_v1',attemptId,outcomeId,witnessId,observation:'verified_at_observation',coverage:'incomplete',authority:'none'})})
it('failed attempt performs no byte read and explicitly reports incomplete',async()=>{f.rpc.mockReturnValue({abortSignal:async()=>({error:{message:'failed'},data:null})});expect(await captureDocumentReference(input)).toMatchObject({status:'unconfirmed',coverage:'incomplete'});expect(f.read).not.toHaveBeenCalled()})
it('loss appends unavailable outcome to durable attempt',async()=>{f.read.mockResolvedValue({status:'unavailable',reason:'storage_error',startedAt:'2026-01-01T00:00:01Z',completedAt:'2026-01-01T00:00:02Z',byteCount:0});await captureDocumentReference(input);expect(f.rpc.mock.calls[1][1].p_observation.status).toBe('unavailable')})
it('failed witness cannot return recorded',async()=>{f.rpc.mockImplementation(name=>({abortSignal:async()=>({error:name.includes('witness')?{}:null,data:name.includes('begin')?attempt:{attemptId,outcomeId,factsHash:digest,status:'verified_at_observation'}})}));expect(await captureDocumentReference(input)).toMatchObject({status:'unconfirmed',attemptId,coverage:'incomplete'})})
it('action derives actor and checks exact allOf before capture',async()=>{const form=new FormData();for(const [key,value]of Object.entries(input))if(key!=='actorUserId')form.set(key,value);form.set('recordForReview','on');await captureDocumentReferenceAction(form);expect(f.guard).toHaveBeenCalledWith(input.companyId,{allOf:['communication.send','documents.read','customers.read']});expect(f.operational).toHaveBeenCalledWith(input.companyId);expect(f.rpc.mock.calls[0][1].p_actor_user_id).toBe(input.actorUserId)})
it('action rejects caller actor, duplicate fields and missing confirmation before guard',async()=>{const form=new FormData();for(const[key,value]of Object.entries(input))form.set(key,value);expect(await captureDocumentReferenceAction(form)).toMatchObject({status:'unavailable'});expect(f.guard).not.toHaveBeenCalled()})
it('same-tenant unresolved graph does not start storage',async()=>{f.rpc.mockImplementation(name=>({abortSignal:async()=>({error:null,data:name.includes('begin')?{...attempt,eligible:false}:name.includes('observe')?{attemptId,outcomeId,factsHash:digest,status:'unavailable'}:{attemptId,outcomeId,witnessId,factsHash:digest,availableAt:'2026-01-01T00:00:02Z'}})}));expect(await captureDocumentReference(input)).toMatchObject({status:'recorded',observation:'unavailable'});expect(f.read).not.toHaveBeenCalled()})
it('mismatched attempt tenant never reaches storage',async()=>{f.rpc.mockReturnValue({abortSignal:async()=>({error:null,data:{...attempt,companyId:randomUUID()}})});expect(await captureDocumentReference(input)).toMatchObject({status:'unconfirmed'});expect(f.read).not.toHaveBeenCalled()})
it('mismatched witness binding remains unconfirmed',async()=>{f.rpc.mockImplementation(name=>({abortSignal:async()=>({error:null,data:name.includes('begin')?attempt:name.includes('observe')?{attemptId,outcomeId,factsHash:digest,status:'verified_at_observation'}:{attemptId,outcomeId:randomUUID(),witnessId,factsHash:digest,availableAt:'2026-01-01T00:00:02Z'}})}));expect(await captureDocumentReference(input)).toMatchObject({status:'unconfirmed'})})
it.each(['duplicate','missing_confirmation'])('rejects %s form before authorization',async variation=>{
 const form=new FormData();for(const[key,value]of Object.entries(input))if(key!=='actorUserId')form.set(key,value)
 if(variation==='duplicate'){form.append('companyId',input.companyId);form.set('recordForReview','on')}
 expect(await captureDocumentReferenceAction(form)).toMatchObject({status:'unavailable'});expect(f.guard).not.toHaveBeenCalled()
})

it('fresh content-dependent read revalidates and keeps saved outcome separate from later loss',async()=>{
 const saved={kind:'context_document_reference_v1',companyId:input.companyId,environment:'test',sourceMessageId:input.sourceMessageId,coverage:'incomplete',authority:'none',attempts:[{documentId:input.documentId,document:{...document,storage_path:null,generation_snapshot:{schema:'original_unavailable'}},createdXid:'101',outcome:{createdXid:'102',observation:{status:'unavailable',reason:'unresolved_link'}},witness:{visibilitySnapshot:'103:103:'}}]}
 const before=JSON.stringify(saved)
 f.read.mockResolvedValue({status:'unavailable',reason:'storage_error',startedAt:'2026-01-01T00:00:01Z',completedAt:'2026-01-01T00:00:02Z',byteCount:0})
 f.rpc.mockImplementation(name=>({abortSignal:async()=>({error:null,data:name.includes('read_document')?saved:name.includes('begin')?attempt:name.includes('observe')?{attemptId,outcomeId,factsHash:digest,status:'unavailable'}:{attemptId,outcomeId,witnessId,factsHash:digest,availableAt:'2026-01-01T00:00:02Z'}})}))
 const result=await readDocumentReferenceContext({...input,cutoff:'2026-01-01T00:00:03Z'})
 expect(result.revalidation).toMatchObject([{status:'recorded',observation:'unavailable',authority:'none'}]);expect(JSON.stringify(result.saved)).toBe(before)
})
it('failed action authorization cannot call the service or storage',async()=>{
 f.guard.mockRejectedValue(Error('forbidden'));const form=new FormData();for(const[key,value]of Object.entries(input))if(key!=='actorUserId')form.set(key,value);form.set('recordForReview','on')
 await expect(captureDocumentReferenceAction(form)).rejects.toThrow('forbidden');expect(f.rpc).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled()
})
it('future availability witness is not a committed receipt',async()=>{f.rpc.mockImplementation(name=>({abortSignal:async()=>({error:null,data:name.includes('begin')?attempt:name.includes('observe')?{attemptId,outcomeId,factsHash:digest,status:'verified_at_observation'}:{attemptId,outcomeId,witnessId,factsHash:digest,availableAt:'2999-01-01T00:00:02Z'}})}));expect(await captureDocumentReference(input)).toMatchObject({status:'unconfirmed'})})
