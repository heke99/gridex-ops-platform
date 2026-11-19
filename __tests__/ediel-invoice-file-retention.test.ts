import {createHash} from 'node:crypto'
import {createClient, type SupabaseClient} from '@supabase/supabase-js'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
const port=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn(),serviceRpc:vi.fn(),download:vi.fn(),remove:vi.fn(),storage:null as SupabaseClient['storage']|null}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:port.getUser},rpc:port.rpc,storage:{from:()=>({remove:port.remove})}})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:port.serviceRpc,get storage(){
 return port.storage ?? {from:()=>({download:(...args:unknown[])=>{
  const result=port.download(...args)
  return {asStream:async()=>{const {data,error}=await result;return {data:data?.stream()??null,error}}}
 }})}
}}}))
import {boundedPdfBytes,registerInvoiceFileSource,purgeInvoiceFileRetention} from '@/lib/ediel/retention/invoiceFileRetention'
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const company=uid(1),actor=uid(2),target=uid(3),source=uid(4),decision=uid(5),object=uid(6),path=`companies/${company}/invoices/own.pdf`
const bytes=Buffer.from('%PDF-1.7\nSYNTHETIC stream fixture\n%%EOF'),hash=createHash('sha256').update(bytes).digest('hex')
const selector={companyId:company,retentionClass:'customer_invoice_document_pdf_bytes' as const,targetId:target}
const locator={...selector,targetHash:'a'.repeat(64),storageBucket:'billing-exports',storagePath:path,storageObjectId:object,storageByteLength:bytes.length}
const pending={status:'storage_purge_pending',sourceId:source,sourceHash:hash,byteLength:bytes.length,storageBucket:'billing-exports',storagePath:path,replay:false}
const done={status:'purged',sourceId:source,sourceHash:hash,byteLength:bytes.length,bytesAvailable:false,replay:false}
const missing={status:404,statusCode:'404'}
beforeEach(()=>{vi.resetAllMocks();port.storage=null;port.getUser.mockResolvedValue({error:null,data:{user:{id:actor}}});port.rpc.mockResolvedValue({error:null,data:locator});port.serviceRpc.mockResolvedValue({error:null,data:{sourceId:source,sourceHash:hash,byteLength:bytes.length,retentionClass:selector.retentionClass,targetId:target,authority:'none'}});port.download.mockResolvedValue({error:null,data:new Blob([bytes])});port.remove.mockResolvedValue({error:null,data:[{name:path}]})})
afterEach(()=>vi.useRealTimers())
describe('actual invoice-file server producer and Storage consumer ports',()=>{
 it('captures server-read exact bytes after authenticated native actual locator, never caller bucket/URL/hash',async()=>{
  const r=await registerInvoiceFileSource(selector);expect(r.sourceHash).toBe(hash)
  expect(port.rpc).toHaveBeenCalledWith('ediel_invoice_file_locator_v1',{p_company_id:company,p_actor_user_id:actor,p_retention_class:selector.retentionClass,p_target_id:target})
  expect(port.download).toHaveBeenCalledWith(path,{}, {signal:expect.any(AbortSignal)})
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
  port.download.mockResolvedValue({error:missing,data:null});await expect(registerInvoiceFileSource(selector)).rejects.toMatchObject(missing);expect(port.serviceRpc).not.toHaveBeenCalled()
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
  port.download.mockResolvedValueOnce({error:null,data:new Blob([bytes])}).mockResolvedValueOnce({error:missing,data:null})
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
  port.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='ediel_begin_invoice_file_purge_v1'?pending:{...done,sourceHash:'b'.repeat(64)}}));port.download.mockResolvedValueOnce({error:null,data:new Blob([bytes])}).mockResolvedValueOnce({error:missing,data:null})
  await expect(purgeInvoiceFileRetention({companyId:company,decisionId:decision})).rejects.toThrow('completion_mismatch')
 })
 it('immutable native completed replay needs current session but reads/deletes no old bytes',async()=>{
  port.rpc.mockResolvedValue({error:null,data:{...done,replay:true}});expect((await purgeInvoiceFileRetention({companyId:company,decisionId:decision})).replay).toBe(true);expect(port.download).not.toHaveBeenCalled();expect(port.remove).not.toHaveBeenCalled()
 })
})

function mockStorageFetch(onFetch: (signal: AbortSignal) => Response | Promise<Response>) {
 port.storage = createClient('https://synthetic-storage.example.invalid', 'test', {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: async (input, init) => {
   expect(String(input)).toBe(`https://synthetic-storage.example.invalid/storage/v1/object/billing-exports/${path}`)
   expect(init?.method).toBe('GET')
   const signal = init?.signal
   if (!signal) throw new Error('missing_storage_signal')
   return onFetch(signal)
  } },
 }).storage
}

describe('installed Storage SDK with a synthetic HTTP transport', () => {
 it('captures exact split PDF bytes without buffering a Blob', async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
   start(controller) {
    controller.enqueue(bytes.subarray(0, 3))
    controller.enqueue(bytes.subarray(3))
    controller.close()
   },
  }))
  const blob = vi.spyOn(response, 'blob')
  mockStorageFetch(() => response)

  await expect(registerInvoiceFileSource(selector)).resolves.toMatchObject({ sourceHash: hash, byteLength: bytes.length })
  expect(blob).not.toHaveBeenCalled()
  expect(port.serviceRpc).toHaveBeenCalledWith('ediel_register_invoice_file_source_v1',
   expect.objectContaining({ p_source_hash: hash, p_byte_length: bytes.length }))
 })

 it('cancels HTTP body delivery as soon as the byte cap is exceeded', async () => {
  const chunk = new Uint8Array(1024 * 1024)
  chunk.set(bytes)
  const cancel = vi.fn()
  let chunks = 0
  port.rpc.mockResolvedValue({ error: null, data: { ...locator, storageByteLength: 20 * chunk.byteLength } })
  mockStorageFetch(() => new Response(new ReadableStream<Uint8Array>({
   pull(controller) {
    chunks++
    controller.enqueue(chunk)
   },
   cancel,
  }, { highWaterMark: 0 })))

  await expect(registerInvoiceFileSource(selector)).rejects.toThrow('invoice_file_storage_size_limit')
  expect(chunks).toBe(21)
  expect(cancel).toHaveBeenCalledOnce()
  expect(port.serviceRpc).not.toHaveBeenCalled()
 })

 it('starts the deadline before response headers and aborts the SDK request', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const onAbort = vi.fn()
  mockStorageFetch(signal => new Promise((_, reject) => {
   signal.addEventListener('abort', () => { onAbort(); reject(signal.reason) }, { once: true })
  }))
  const result = expect(registerInvoiceFileSource(selector)).rejects.toThrow('invoice_file_storage_timeout')
  await vi.advanceTimersByTimeAsync(10_000)
  await result
  expect(onAbort).toHaveBeenCalledOnce()
  expect(port.serviceRpc).not.toHaveBeenCalled()
 })

 it('cancels a body that sends all expected bytes without ever closing', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const cancel = vi.fn(() => new Promise<void>(() => {}))
  let signal: AbortSignal | undefined
  mockStorageFetch(requestSignal => {
   signal = requestSignal
   return new Response(new ReadableStream<Uint8Array>({ start: controller => controller.enqueue(bytes), cancel }))
  })
  const result = expect(registerInvoiceFileSource(selector)).rejects.toThrow('invoice_file_storage_timeout')
  await vi.advanceTimersByTimeAsync(10_000)
  await result
  expect(signal?.aborted).toBe(true)
  expect(cancel).toHaveBeenCalledOnce()
  expect(port.serviceRpc).not.toHaveBeenCalled()
 })

 it.each([
  [400, { statusCode: '404', code: 'NoSuchKey', error: 'not_found', message: 'Object not found' }],
  [404, { code: 'NoSuchKey', message: 'Object not found' }],
 ] as const)('accepts the HTTP %i Storage missing-object result after the authenticated remove', async (status, errorBody) => {
  port.rpc.mockResolvedValueOnce({ error: null, data: pending }).mockResolvedValueOnce({ error: null, data: done })
  let downloads = 0
  mockStorageFetch(() => {
   downloads++
   if (downloads === 1) return new Response(bytes)
   expect(port.remove).toHaveBeenCalledWith([path])
   return Response.json(errorBody, { status })
  })

  await expect(purgeInvoiceFileRetention({ companyId: company, decisionId: decision })).resolves.toEqual(done)
  expect(downloads).toBe(2)
  expect(port.rpc.mock.calls.map(row => row[0])).toEqual(['ediel_begin_invoice_file_purge_v1', 'ediel_finish_invoice_file_purge_v1'])
 })

 it('preserves the frozen hash check for an object with the expected length', async () => {
  port.rpc.mockResolvedValue({ error: null, data: pending })
  const changed = Buffer.from(bytes)
  changed[10] ^= 1
  mockStorageFetch(() => new Response(changed))

  await expect(purgeInvoiceFileRetention({ companyId: company, decisionId: decision }))
   .rejects.toThrow('invoice_file_exact_storage_bytes_changed')
  expect(port.remove).not.toHaveBeenCalled()
  expect(port.rpc.mock.calls.map(row => row[0])).toEqual(['ediel_begin_invoice_file_purge_v1'])
 })

 it('does not finish a purge on an HTTP failure or a still available body', async () => {
  port.rpc.mockResolvedValue({ error: null, data: pending })
  const cancel = vi.fn()
  const readback = [
   Response.json({ statusCode: '404', message: 'Storage temporarily unavailable' }, { status: 503 }),
   new Response(new ReadableStream<Uint8Array>({ cancel })),
  ]
  for (const response of readback) {
   let downloads = 0
   mockStorageFetch(() => ++downloads === 1 ? new Response(bytes) : response)
   await expect(purgeInvoiceFileRetention({ companyId: company, decisionId: decision }))
    .rejects.toThrow('invoice_file_storage_bytes_still_available')
   expect(downloads).toBe(2)
  }
  expect(port.remove).toHaveBeenCalledTimes(2)
  expect(cancel).toHaveBeenCalledOnce()
  expect(port.rpc.mock.calls.map(row => row[0])).toEqual(['ediel_begin_invoice_file_purge_v1', 'ediel_begin_invoice_file_purge_v1'])
 })
})
