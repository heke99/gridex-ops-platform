import {createHash,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const storage=vi.hoisted(()=>({download:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{storage:{from:()=>storage}}}))
import * as documents from '@/lib/customer-contracts/documents'
const row=(bytes:Uint8Array)=>({id:randomUUID(),company_id:randomUUID(),customer_contract_id:randomUUID(),document_type:'signed_contract_pdf',storage_bucket:'customer-contract-documents',storage_path:'synthetic.pdf',mime_type:'application/pdf',document_sha256:createHash('sha256').update(bytes).digest('hex'),generation_snapshot:{schema:'synthetic'},generated_at:'2026-01-01',archived_at:null,verified_at:null,created_at:'2026-01-01'})
const read=(document:documents.CustomerContractDocumentRow)=>documents.downloadAndVerifyCustomerContractDocumentBounded(document)
beforeEach(()=>vi.resetAllMocks());afterEach(()=>vi.useRealTimers())
function serve(bytes:Uint8Array,chunk=65536){
 let offset=0
 storage.download.mockImplementation((_path,_options,fetchOptions)=>({asStream:async()=>({error:null,data:new ReadableStream<Uint8Array>({pull(controller){if(fetchOptions.signal.aborted){controller.error(Error('aborted'));return}if(offset===bytes.length){controller.close();return}controller.enqueue(bytes.subarray(offset,offset+=Math.min(chunk,bytes.length-offset)))}})})}))
}
it('hashes exact binary bytes through EOF at 2 MiB without retaining PDF bytes',async()=>{
 const bytes=Buffer.alloc(2097152,173);serve(bytes)
 expect(await read(row(bytes))).toMatchObject({status:'verified_at_observation',byteCount:2097152,sha256:createHash('sha256').update(bytes).digest('hex')})
 expect(storage.download.mock.calls[0][2]).toMatchObject({cache:'no-store',signal:expect.any(AbortSignal)})
})
it.each([2097153,10485760])('aborts capture-ineligible %i actual bytes',async size=>{
 const bytes=Buffer.alloc(size);serve(bytes)
 expect(await read(row(bytes))).toMatchObject({status:'unavailable',reason:'oversize'})
 expect(storage.download.mock.calls[0][2].signal.aborted).toBe(true)
})
it('rejects hash mismatch',async()=>{serve(Buffer.from('wrong'));expect(await read(row(Buffer.from('expected')))).toMatchObject({status:'unavailable',reason:'hash_mismatch'})})
it.each(['fetch','body'])('deadline releases a stalled %s despite ignored cancellation',async phase=>{
 vi.useFakeTimers()
 storage.download.mockReturnValue({asStream:()=>phase==='fetch'?new Promise(()=>{}):Promise.resolve({error:null,data:new ReadableStream({pull(){return new Promise(()=>{})},cancel(){return new Promise(()=>{})}})})})
 const result=read(row(Buffer.from('pdf')));await vi.advanceTimersByTimeAsync(10000)
 expect(await result).toMatchObject({status:'unavailable',reason:'timeout'})
 expect(storage.download.mock.calls[0][2].signal.aborted).toBe(true)
})
it('rejects null path before any storage access',async()=>{expect(await read({...row(Buffer.from('pdf')),storage_path:null})).toMatchObject({status:'unavailable',reason:'ineligible_document'});expect(storage.download).not.toHaveBeenCalled()})
it('stream errors leave unavailable observation',async()=>{storage.download.mockReturnValue({asStream:async()=>({error:null,data:new ReadableStream({start(c){c.error(Error('truncated'))}})})});expect(await read(row(Buffer.from('pdf')))).toMatchObject({status:'unavailable',reason:'storage_error'})})
it('discards a response arriving after the deadline and cancels its body',async()=>{
 vi.useFakeTimers();let deliver!:(value:unknown)=>void;let cancelled=false
 storage.download.mockReturnValue({asStream:()=>new Promise(resolve=>{deliver=resolve})})
 const result=read(row(Buffer.from('pdf')));await vi.advanceTimersByTimeAsync(10000)
 expect(await result).toMatchObject({status:'unavailable',reason:'timeout'})
 deliver({error:null,data:new ReadableStream({cancel(){cancelled=true}})});await vi.advanceTimersByTimeAsync(1)
 expect(cancelled).toBe(true)
})
it('large first chunk is rejected before hashing, recording the observed overshoot',async()=>{
 const bytes=Buffer.alloc(10485760);serve(bytes,bytes.length)
 expect(await read(row(bytes))).toMatchObject({status:'unavailable',reason:'oversize',byteCount:10485760})
})
