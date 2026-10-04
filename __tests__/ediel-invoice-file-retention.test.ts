import {createHash} from 'node:crypto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const port=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn(),serviceRpc:vi.fn(),download:vi.fn(),remove:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:port.getUser},rpc:port.rpc,storage:{from:()=>({remove:port.remove})}})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:port.serviceRpc,storage:{from:()=>({download:port.download})}}}))
import {boundedPdfBytes,registerInvoiceFileSource,purgeInvoiceFileRetention} from '@/lib/ediel/retention/invoiceFileRetention'
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const company=uid(1),actor=uid(2),target=uid(3),source=uid(4),decision=uid(5),object=uid(6),path=`companies/${company}/invoices/own.pdf`
const bytes=Buffer.from('%PDF-1.7\nSYNTHETIC stream fixture\n%%EOF'),hash=createHash('sha256').update(bytes).digest('hex')
const selector={companyId:company,retentionClass:'customer_invoice_document_pdf_bytes' as const,targetId:target}
const locator={...selector,targetHash:'a'.repeat(64),storageBucket:'billing-exports',storagePath:path,storageObjectId:object,storageByteLength:bytes.length}
const pending={status:'storage_purge_pending',sourceId:source,sourceHash:hash,byteLength:bytes.length,storageBucket:'billing-exports',storagePath:path,replay:false}
const done={status:'purged',sourceId:source,sourceHash:hash,byteLength:bytes.length,bytesAvailable:false,replay:false}
beforeEach(()=>{vi.resetAllMocks();port.getUser.mockResolvedValue({error:null,data:{user:{id:actor}}});port.rpc.mockResolvedValue({error:null,data:locator});port.serviceRpc.mockResolvedValue({error:null,data:{sourceId:source,sourceHash:hash,byteLength:bytes.length,retentionClass:selector.retentionClass,targetId:target,authority:'none'}});port.download.mockResolvedValue({error:null,data:new Blob([bytes])});port.remove.mockResolvedValue({error:null,data:[{name:path}]})})
describe('actual invoice-file server producer and Storage consumer ports',()=>{
 it('captures server-read exact bytes after authenticated native actual locator, never caller bucket/URL/hash',async()=>{
  const r=await registerInvoiceFileSource(selector);expect(r.sourceHash).toBe(hash)
  expect(port.rpc).toHaveBeenCalledWith('ediel_invoice_file_locator_v1',{p_company_id:company,p_actor_user_id:actor,p_retention_class:selector.retentionClass,p_target_id:target})
  expect(port.download).toHaveBeenCalledWith(path,{transform:undefined})
  expect(port.serviceRpc).toHaveBeenCalledWith('ediel_register_invoice_file_source_v1',expect.objectContaining({p_company_id:company,p_actor_user_id:actor,p_target_hash:'a'.repeat(64),p_storage_object_id:object,p_source_hash:hash,p_byte_length:bytes.length}))
  expect(port.rpc.mock.invocationCallOrder[0]).toBeLessThan(port.download.mock.invocationCallOrder[0]);expect(port.download.mock.invocationCallOrder[0]).toBeLessThan(port.serviceRpc.mock.invocationCallOrder[0])
 })
 it('wrong selector, remote/native locator or missing current GoTrue actor prevents capture I/O',async()=>{
  for(const bad of [{...locator,targetId:uid(99)},{...locator,storagePath:'https://remote.invalid/a.pdf'},{...locator,storageBucket:'public'}]){
   port.rpc.mockResolvedValue({error:null,data:bad});await expect(registerInvoiceFileSource(selector)).rejects.toThrow();expect(port.download).not.toHaveBeenCalled();expect(port.serviceRpc).not.toHaveBeenCalled()
  }
  port.getUser.mockResolvedValue({error:null,data:{user:null}});await expect(registerInvoiceFileSource(selector)).rejects.toThrow('authenticated_actor_required')
 })
 it('non-PDF, incomplete or oversized bytes cannot be registered as a source',async()=>{
  await expect(boundedPdfBytes(new Blob(['caller ready']))).rejects.toThrow('pdf_bytes_required')
  await expect(boundedPdfBytes(new Blob([new Uint8Array(20971521)]))).rejects.toThrow('size_limit')
  port.download.mockResolvedValue({error:{statusCode:404},data:null});await expect(registerInvoiceFileSource(selector)).rejects.toMatchObject({statusCode:404});expect(port.serviceRpc).not.toHaveBeenCalled()
 })
 it('actual native length mismatch and forged success response never produce a captured source success',async()=>{
  port.rpc.mockResolvedValue({error:null,data:{...locator,storageByteLength:bytes.length+1}})
  await expect(registerInvoiceFileSource(selector)).rejects.toThrow('native_storage_length_changed');expect(port.serviceRpc).not.toHaveBeenCalled()
  port.rpc.mockResolvedValue({error:null,data:locator});port.serviceRpc.mockResolvedValue({error:null,data:{sourceId:source,sourceHash:'b'.repeat(64),byteLength:bytes.length,retentionClass:selector.retentionClass,targetId:target,authority:'none'}})
  await expect(registerInvoiceFileSource(selector)).rejects.toThrow('native_capture_response_changed')
 })
 it('native source binding/current actor revocation error after reading propagates without a success claim',async()=>{
  port.serviceRpc.mockResolvedValue({error:new Error('current_actor_denied'),data:null});await expect(registerInvoiceFileSource(selector)).rejects.toThrow('current_actor_denied')
 })
 it('tombstone first, exact bytes second, actual session JWT remove, HTTP404 readback then native finish',async()=>{
  port.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='ediel_begin_invoice_file_purge_v1'?pending:done}))
  port.download.mockResolvedValueOnce({error:null,data:new Blob([bytes])}).mockResolvedValueOnce({error:{statusCode:404},data:null})
  expect(await purgeInvoiceFileRetention({companyId:company,decisionId:decision})).toEqual(done)
  expect(port.remove).toHaveBeenCalledWith([path]);expect(port.rpc.mock.calls.map(row=>row[0])).toEqual(['ediel_begin_invoice_file_purge_v1','ediel_finish_invoice_file_purge_v1'])
  expect(port.rpc.mock.invocationCallOrder[0]).toBeLessThan(port.download.mock.invocationCallOrder[0]);expect(port.download.mock.invocationCallOrder[1]).toBeLessThan(port.rpc.mock.invocationCallOrder[1])
 })
 it('wrong exact bytes, denied session DELETE and failed/ambiguous readback never finish physical receipt',async()=>{
  port.rpc.mockResolvedValue({error:null,data:pending});port.download.mockResolvedValue({error:null,data:new Blob(['%PDF-wrong'])})
  await expect(purgeInvoiceFileRetention({companyId:company,decisionId:decision})).rejects.toThrow('bytes_changed');expect(port.remove).not.toHaveBeenCalled()
  port.download.mockResolvedValue({error:null,data:new Blob([bytes])});port.remove.mockResolvedValue({error:new Error('current_delete_denied')})
  await expect(purgeInvoiceFileRetention({companyId:company,decisionId:decision})).rejects.toThrow('current_delete_denied')
  port.remove.mockResolvedValue({error:null});await expect(purgeInvoiceFileRetention({companyId:company,decisionId:decision})).rejects.toThrow('bytes_still_available')
  expect(port.rpc.mock.calls.every(row=>row[0]==='ediel_begin_invoice_file_purge_v1')).toBe(true)
 })
 it('native completion mismatch remains an error after delete, so no false success is shown',async()=>{
  port.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='ediel_begin_invoice_file_purge_v1'?pending:{...done,sourceHash:'b'.repeat(64)}}));port.download.mockResolvedValueOnce({error:null,data:new Blob([bytes])}).mockResolvedValueOnce({error:{statusCode:404},data:null})
  await expect(purgeInvoiceFileRetention({companyId:company,decisionId:decision})).rejects.toThrow('completion_mismatch')
 })
 it('immutable native completed replay needs current session but reads/deletes no old bytes',async()=>{
  port.rpc.mockResolvedValue({error:null,data:{...done,replay:true}});expect((await purgeInvoiceFileRetention({companyId:company,decisionId:decision})).replay).toBe(true);expect(port.download).not.toHaveBeenCalled();expect(port.remove).not.toHaveBeenCalled()
 })
})
