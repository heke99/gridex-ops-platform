import 'server-only'
import {createHash} from 'node:crypto'
import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {readRetentionJson,retentionHeaders,retentionHttp} from './retentionHttp'
import {purgeBlobRetention,reviewBlobRetention,revokeBlobRetention,submitBlobRetention} from './blobLifecycleRetention'

const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/)
const kind=z.enum(['received_ediel_message_content','transport_raw_mime_bytes'])
const classPermission={received_ediel_message_content:'ediel.retention.original_bytes',transport_raw_mime_bytes:'ediel.retention.mime_bytes'}
const submit=z.object({retentionClass:kind,targetId:uuid,documentBase64:z.string().min(4).max(1398104).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),issuerReceipt:z.record(z.string(),z.unknown()).nullable()}).strict()
const reason=z.string().trim().min(1).max(4000)
const review=z.object({outcome:z.enum(['approve','hold','reject']),reason}).strict()
const empty=z.object({}).strict()
const metadata=z.object({companyId:uuid,decisionId:uuid,retentionClass:kind,targetId:uuid,messageId:uuid,sourceHash:hash,targetHash:hash,documentHash:hash,documentByteLength:z.number().int().positive(),submittedBy:uuid,createdAt:z.string(),issuerQualified:z.boolean(),currentQualified:z.boolean(),revoked:z.boolean(),reviews:z.array(z.object({reviewId:uuid,actorUserId:uuid,outcome:z.enum(['approved','held','rejected']),reason:z.string(),createdAt:z.string()})),purge:z.object({createdAt:z.string(),byteLength:z.number().int().positive(),physicalBytesRemoved:z.boolean()}).nullable(),documentBase64:z.string().nullable()})
export type BlobRetentionDecision=z.infer<typeof metadata>
const respond=(data:unknown)=>NextResponse.json(data,{headers:retentionHeaders})
type Scope=Parameters<Parameters<typeof retentionHttp>[1]>[0]
async function readDecision(scope:Scope,decisionId:string,includeDocument=false){
 uuid.parse(decisionId)
 const {data,error}=await scope.client.rpc('ediel_read_blob_retention_decision_v1',{p_company_id:scope.companyId,p_actor_user_id:scope.userId,p_decision_id:decisionId,p_include_document:includeDocument})
 if(error)throw error
 const result=metadata.parse(data)
 if(result.companyId!==scope.companyId||result.decisionId!==decisionId||!scope.permissions.includes(classPermission[result.retentionClass])||(!includeDocument&&result.documentBase64!==null))throw Error('blob_retention_read_scope_mismatch')
 return result
}
export function messageRetentionSubmit(request:NextRequest){return retentionHttp(['ediel.retention.submit'],async scope=>{
 const input=submit.parse(await readRetentionJson(request,1450000))
 if(!scope.permissions.includes(classPermission[input.retentionClass]))throw Error('blob_retention_class_grant_required')
 const document=Buffer.from(input.documentBase64,'base64')
 if(document.length<1||document.length>1048576||document.toString('base64')!==input.documentBase64)throw new SyntaxError('invalid_document_bytes')
 return respond(await submitBlobRetention({companyId:scope.companyId,retentionClass:input.retentionClass,targetId:input.targetId,document,issuerReceipt:input.issuerReceipt}))
})}
export function messageRetentionRead(decisionId:string){return retentionHttp([],async scope=>respond(await readDecision(scope,decisionId)))}
export function messageRetentionDocument(decisionId:string){return retentionHttp(['ediel.retention.review'],async scope=>{
 const record=await readDecision(scope,decisionId,true)
 if(!record.documentBase64)throw Error('blob_retention_document_unavailable')
 const bytes=Buffer.from(record.documentBase64,'base64')
 if(bytes.length!==record.documentByteLength||createHash('sha256').update(bytes).digest('hex')!==record.documentHash)throw Error('blob_retention_document_read_hash_mismatch')
 return new NextResponse(new Uint8Array(bytes),{headers:{...retentionHeaders,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="retention-${decisionId}.bin"`,'X-Content-Type-Options':'nosniff'}})
})}
export function messageRetentionReview(request:NextRequest,decisionId:string){return retentionHttp(['ediel.retention.review'],async scope=>{
 const input=review.parse(await readRetentionJson(request,20000))
 await readDecision(scope,decisionId)
 return respond(await reviewBlobRetention({companyId:scope.companyId,decisionId,...input}))
})}
export function messageRetentionRevoke(request:NextRequest,decisionId:string){return retentionHttp(['ediel.retention.review'],async scope=>{
 const input=z.object({reason}).strict().parse(await readRetentionJson(request,20000))
 await readDecision(scope,decisionId)
 await revokeBlobRetention({companyId:scope.companyId,decisionId,reason:input.reason})
 return respond({status:'revoked',decisionId})
})}
export function messageRetentionPurge(request:NextRequest,decisionId:string){return retentionHttp(['ediel.retention.purge'],async scope=>{
 empty.parse(await readRetentionJson(request,1000))
 await readDecision(scope,decisionId)
 // Domain consumer preserves begin -> actual JWT Storage delete -> exact
 // readback -> native finish. No metadata-only physical completion is inferred.
 return respond(await purgeBlobRetention({companyId:scope.companyId,decisionId}))
})}
