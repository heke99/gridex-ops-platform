import 'server-only'
import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {decisionEvidenceClasses,decisionEvidencePermission,purgeDecisionEvidenceRetention,readDecisionEvidencePolicy,readRetentionDecisionOriginal,reviewDecisionEvidenceRetention,revokeDecisionEvidenceRetention,submitDecisionEvidenceRetention} from './decisionEvidenceRetention'
import {readRetentionJson,retentionHeaders,retentionHttp} from './retentionHttp'

const uuid=z.string().uuid(),kind=z.enum(decisionEvidenceClasses),reason=z.string().trim().min(1).max(4000)
const submit=z.object({retentionClass:kind,targetId:uuid,documentBase64:z.string().min(4).max(1398104).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),issuerReceipt:z.record(z.string(),z.unknown()).nullable()}).strict()
type Scope=Parameters<Parameters<typeof retentionHttp>[1]>[0]
const respond=(data:unknown)=>NextResponse.json(data,{headers:retentionHeaders})
function requireClass(scope:Scope,retentionClass:typeof decisionEvidenceClasses[number]){if(!scope.permissions.includes(decisionEvidencePermission[retentionClass]))throw Error('decision_evidence_http_current_class_required')}
async function readPolicy(scope:Scope,policyId:string,includeDocument=false){
 const record=await readDecisionEvidencePolicy({companyId:scope.companyId,policyId:uuid.parse(policyId),includeDocument})
 requireClass(scope,record.retentionClass);return record
}
function download(record:{bytesAvailable:boolean;documentBase64:string|null},id:string){
 if(!record.bytesAvailable||!record.documentBase64)throw Error('decision_evidence_original_unavailable')
 // Domain read verified canonical base64, native source hash and byte length.
 return new NextResponse(new Uint8Array(Buffer.from(record.documentBase64,'base64')),{headers:{...retentionHeaders,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="decision-original-${id}.bin"`,'X-Content-Type-Options':'nosniff'}})
}
export function decisionEvidenceSubmit(request:NextRequest){return retentionHttp(['ediel.retention.submit'],async scope=>{
 const input=submit.parse(await readRetentionJson(request,1450000));requireClass(scope,input.retentionClass)
 const document=Buffer.from(input.documentBase64,'base64')
 if(document.length<1||document.length>1048576||document.toString('base64')!==input.documentBase64)throw new SyntaxError('decision_evidence_document_bytes_invalid')
 return respond(await submitDecisionEvidenceRetention({companyId:scope.companyId,retentionClass:input.retentionClass,targetId:input.targetId,document,issuerReceipt:input.issuerReceipt}))
})}
export function decisionEvidenceOriginal(retentionClass:string,targetId:string,includeDocument=false){return retentionHttp(includeDocument?['ediel.retention.review']:[],async scope=>{
 const selected=kind.parse(retentionClass);requireClass(scope,selected)
 const record=await readRetentionDecisionOriginal({companyId:scope.companyId,retentionClass:selected,targetId:uuid.parse(targetId),includeDocument})
 return includeDocument?download(record,targetId):respond(record)
})}
export function decisionEvidenceRead(policyId:string){return retentionHttp([],async scope=>respond(await readPolicy(scope,policyId)))}
export function decisionEvidenceDocument(policyId:string){return retentionHttp(['ediel.retention.review'],async scope=>download(await readPolicy(scope,policyId,true),policyId))}
export function decisionEvidenceReview(request:NextRequest,policyId:string){return retentionHttp(['ediel.retention.review'],async scope=>{
 const input=z.object({outcome:z.enum(['approve','hold','reject']),reason}).strict().parse(await readRetentionJson(request,20000));await readPolicy(scope,policyId)
 return respond(await reviewDecisionEvidenceRetention({companyId:scope.companyId,policyId,...input}))
})}
export function decisionEvidenceRevoke(request:NextRequest,policyId:string){return retentionHttp(['ediel.retention.review'],async scope=>{
 const input=z.object({reason}).strict().parse(await readRetentionJson(request,20000));await readPolicy(scope,policyId)
 await revokeDecisionEvidenceRetention({companyId:scope.companyId,policyId,reason:input.reason});return respond({status:'revoked',policyId})
})}
export function decisionEvidencePurge(request:NextRequest,policyId:string){return retentionHttp(['ediel.retention.purge'],async scope=>{
 z.object({}).strict().parse(await readRetentionJson(request,1000));const record=await readPolicy(scope,policyId)
 const result=await purgeDecisionEvidenceRetention({companyId:scope.companyId,policyId})
 if(result.status==='purged'&&(result.retentionClass!==record.retentionClass||result.targetId!==record.targetId||result.sourceHash!==record.sourceHash))throw Error('decision_evidence_http_purge_scope_mismatch')
 return respond(result)
})}
