import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const io=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),cookie:vi.fn(),submit:vi.fn(),review:vi.fn(),purge:vi.fn(),revoke:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('next/headers',()=>({cookies:async()=>({get:io.cookie})}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:io.auth},rpc:io.rpc})}))
vi.mock('@/lib/ediel/retention/blobLifecycleRetention',()=>({submitBlobRetention:io.submit,reviewBlobRetention:io.review,purgeBlobRetention:io.purge,revokeBlobRetention:io.revoke}))
import {messageRetentionDocument,messageRetentionPurge,messageRetentionRead,messageRetentionReview,messageRetentionRevoke,messageRetentionSubmit} from '@/lib/ediel/retention/blobRetentionHttp'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,company=id(1),actor=id(2),decision=id(3),target=id(4),bytes=Buffer.from('SYNTHETIC legal decision, unit HTTP boundary only')
const permissions=['ediel.retention.submit','ediel.retention.review','ediel.retention.purge','ediel.retention.original_bytes','ediel.retention.mime_bytes']
const row=()=>({companyId:company,decisionId:decision,retentionClass:'transport_raw_mime_bytes',targetId:target,messageId:id(5),sourceHash:'a'.repeat(64),targetHash:'b'.repeat(64),documentHash:createHash('sha256').update(bytes).digest('hex'),documentByteLength:bytes.length,submittedBy:actor,createdAt:'2026-10-01T00:00:00Z',issuerQualified:false,currentQualified:false,revoked:false,reviews:[],purge:null,documentBase64:null})
const req=(body:unknown)=>new NextRequest('http://localhost/api/ediel/message-content-retention',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const submission=()=>({retentionClass:'transport_raw_mime_bytes',targetId:target,documentBase64:bytes.toString('base64'),issuerReceipt:null})
beforeEach(()=>{vi.clearAllMocks();io.auth.mockResolvedValue({data:{user:{id:actor}},error:null});io.cookie.mockReturnValue({value:company});io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
 if(name==='ediel_current_retention_session_v1'){expect(args).toEqual({p_company_id:company,p_actor_user_id:actor});return{data:{companyId:company,actorUserId:actor,permissions},error:null}}
 if(name==='ediel_read_blob_retention_decision_v1'){expect(args).toEqual({p_company_id:company,p_actor_user_id:actor,p_decision_id:decision,p_include_document:args.p_include_document});return{data:{...row(),documentBase64:args.p_include_document?bytes.toString('base64'):null},error:null}}
 throw Error('unexpected_native_rpc:'+name)
});io.submit.mockResolvedValue({status:'submitted',decisionId:decision,issuerQualified:false});io.review.mockResolvedValue({status:'held',decisionId:decision});io.purge.mockResolvedValue({status:'storage_purge_pending',targetId:target});io.revoke.mockResolvedValue(undefined)})
// Finite HTTP/native-read boundary only. No fixture establishes issuer/legal
// authority or proves physical deletion. Domain/native suites own those facts.
it('selects actual GoTrue actor/company cookie and forwards unchanged archived decision bytes',async()=>{
 const response=await messageRetentionSubmit(req(submission()));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store')
 expect(io.submit).toHaveBeenCalledExactlyOnceWith({companyId:company,retentionClass:'transport_raw_mime_bytes',targetId:target,document:bytes,issuerReceipt:null});expect(await response.json()).toMatchObject({issuerQualified:false})
})
it.each(['companyId','actorUserId'])('rejects caller authority field %s before archive',async(key)=>{expect((await messageRetentionSubmit(req({...submission(),[key]:id(99)}))).status).toBe(400);expect(io.submit).not.toHaveBeenCalled()})
it.each(['not authenticated','wrong company session','class deny'])('holds current session failure %s without any lifecycle effect',async(kind)=>{
 if(kind==='not authenticated')io.auth.mockResolvedValue({data:{user:null},error:null})
 else io.rpc.mockResolvedValue({data:{companyId:kind==='wrong company session'?id(99):company,actorUserId:actor,permissions:kind==='class deny'?['ediel.retention.submit']:permissions},error:null})
 expect((await messageRetentionSubmit(req(submission()))).status).toBe(403);expect(io.submit).not.toHaveBeenCalled();expect(io.purge).not.toHaveBeenCalled()
})
it.each(['invalid','oversize'])('rejects %s document bytes without archive',async(kind)=>{const body={...submission(),documentBase64:kind==='invalid'?'QQ===':Buffer.alloc(1048577).toString('base64')};expect((await messageRetentionSubmit(req(body))).status).toBe(400);expect(io.submit).not.toHaveBeenCalled()})
it('reads metadata without exporting decision bytes or inventing approval',async()=>{const response=await messageRetentionRead(decision);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({currentQualified:false,issuerQualified:false,documentBase64:null});expect(io.submit).not.toHaveBeenCalled()})
it('reviewer reads actual hashed document as private download',async()=>{const response=await messageRetentionDocument(decision);expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);expect(response.headers.get('x-content-type-options')).toBe('nosniff')})
it.each(['company','class','document hash'])('rejects inconsistent native %s before review or byte export',async(kind)=>{
 io.rpc.mockImplementation(async(name:string)=>name==='ediel_current_retention_session_v1'?{data:{companyId:company,actorUserId:actor,permissions},error:null}:{data:{...row(),companyId:kind==='company'?id(99):company,retentionClass:kind==='class'?'unregistered_class':'transport_raw_mime_bytes',documentBase64:bytes.toString('base64'),documentHash:kind==='document hash'?'0'.repeat(64):row().documentHash},error:null})
 expect((await messageRetentionDocument(decision)).status).toBeGreaterThanOrEqual(400);expect(io.review).not.toHaveBeenCalled()
})
it('preserves a held native separate review and source-specific storage-pending receipt',async()=>{
 const response=await messageRetentionReview(req({outcome:'approve',reason:'SYNTHETIC review'}),decision);expect(await response.json()).toMatchObject({status:'held'})
 expect(io.review).toHaveBeenCalledExactlyOnceWith({companyId:company,decisionId:decision,outcome:'approve',reason:'SYNTHETIC review'})
 const purge=await messageRetentionPurge(req({}),decision);expect(await purge.json()).toMatchObject({status:'storage_purge_pending'});expect(io.purge).toHaveBeenCalledExactlyOnceWith({companyId:company,decisionId:decision})
})
it('rejects caller physical completion claims before the actual two-phase consumer',async()=>{expect((await messageRetentionPurge(req({physicalBytesRemoved:true}),decision)).status).toBe(400);expect(io.purge).not.toHaveBeenCalled()})

it('explicit read-only class session receives metadata while document and all mutations hold before lifecycle effects',async()=>{
 const read=io.rpc.getMockImplementation()!;io.rpc.mockImplementation(async(name,args)=>name==='ediel_current_retention_session_v1'?{data:{companyId:company,actorUserId:actor,permissions:['ediel.retention.read','ediel.retention.mime_bytes']},error:null}:read(name,args))
 const metadata=await messageRetentionRead(decision);expect(metadata.status).toBe(200);expect(await metadata.json()).toMatchObject({documentBase64:null,currentQualified:false})
 expect((await messageRetentionDocument(decision)).status).toBe(403);expect((await messageRetentionSubmit(req(submission()))).status).toBe(403);expect((await messageRetentionReview(req({outcome:'approve',reason:'forbidden'}),decision)).status).toBe(403);expect((await messageRetentionRevoke(req({reason:'forbidden'}),decision)).status).toBe(403);expect((await messageRetentionPurge(req({}),decision)).status).toBe(403)
 expect(io.submit).not.toHaveBeenCalled();expect(io.review).not.toHaveBeenCalled();expect(io.revoke).not.toHaveBeenCalled();expect(io.purge).not.toHaveBeenCalled()
})
