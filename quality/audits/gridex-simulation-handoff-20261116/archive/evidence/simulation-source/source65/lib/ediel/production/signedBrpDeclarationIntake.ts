import {createHash} from 'node:crypto'
import {z} from 'zod'
import {createSupabaseServerClient} from '@/lib/supabase/server'

export const SIGNED_BRP_ORIGINAL_MAX_BYTES=10*1024*1024
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),text=(max:number)=>z.string().trim().min(1).max(max)
export const signedBrpSelector=z.object({environment:z.enum(['test','production']),contractId:uuid,registryGroundId:uuid,identityAgency:z.enum(['9','89']),agreementHash:hash}).strict()
export const signedBrpSubmission=signedBrpSelector.omit({agreementHash:true}).extend({agreementBase64:z.string().min(1).max(Math.ceil(SIGNED_BRP_ORIGINAL_MAX_BYTES/3)*4),sourceBase64:z.string().min(1).max(Math.ceil(SIGNED_BRP_ORIGINAL_MAX_BYTES/3)*4),sourceReference:text(2000),sourceVersion:text(200),issuerReceipt:z.object({keyId:uuid,representationId:uuid,payloadBase64:text(90000),signatureHex:hash}).strict().optional()}).strict()
export const signedBrpReview=z.object({agreementHash:hash,sourceHash:hash,claimsHash:hash,decision:z.enum(['approve','hold','reject']),reason:text(4000),clause:z.object({locator:text(1000),quote:text(10000)}).strict().optional(),previousDeclarationId:uuid.optional()}).strict()
const archive=z.object({status:z.literal('archived'),artifactId:uuid,agreementHash:hash,sourceHash:hash,claimsHash:hash,issuerQualified:z.boolean(),authority:z.literal('none')})
const review=z.discriminatedUnion('status',[
 z.object({status:z.literal('authorized'),artifactId:uuid,declarationId:uuid,replay:z.boolean()}),
 z.object({status:z.enum(['held','rejected']),artifactId:uuid,missing:z.array(z.string())}),
])
const artifact=z.object({artifactId:uuid,companyId:uuid,environment:z.enum(['test','production']),contractId:uuid,claims:z.record(z.string(),z.unknown()),claimsHash:hash,agreementHash:hash,sourceHash:hash,sourceReference:z.string(),sourceVersion:z.string(),agreementByteLength:z.number().int().positive().nullable(),sourceByteLength:z.number().int().positive().nullable(),bytesAvailable:z.boolean(),issuerQualified:z.boolean(),status:z.enum(['authorized','held','rejected']),declarationId:uuid.nullable(),missing:z.array(z.string()),authority:z.literal('none'),agreementBase64:z.string().optional(),sourceBase64:z.string().optional()})
export type SignedBrpArtifact=z.infer<typeof artifact>
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
async function call(name:string,companyId:string,args:Record<string,unknown>){
 uuid.parse(companyId)
 const client=await createSupabaseServerClient(),auth=await client.auth.getUser()
 if(auth.error||!auth.data.user||auth.data.user.user_metadata?.must_change_password===true)throw Error('signed_brp_authenticated_actor_required')
 const rpc=client.rpc.bind(client) as unknown as Rpc
 const {data,error}=await rpc(name,{p_company_id:companyId,p_actor_user_id:uuid.parse(auth.data.user.id),...args})
 if(error)throw error
 return data
}
function bytes(value:string){
 const raw=Buffer.from(value,'base64')
 if(!raw.length||raw.length>SIGNED_BRP_ORIGINAL_MAX_BYTES||raw.toString('base64')!==value)throw Error('signed_brp_original_bytes_invalid')
 return raw
}
const digest=(raw:Uint8Array)=>createHash('sha256').update(raw).digest('hex')
/** The native owner derives protected contract/point/registry claims. Client
 * selectors and this read preview confer no source or transport authority. */
export async function previewSignedBrpDeclaration(companyId:string,selector:z.infer<typeof signedBrpSelector>){
 signedBrpSelector.parse(selector)
 const result=z.discriminatedUnion('status',[
  z.object({status:z.literal('scope_available'),claims:z.record(z.string(),z.unknown()),claimsHash:hash,authority:z.literal('none')}),
  z.object({status:z.literal('held'),missing:z.array(z.string()),authority:z.literal('none')}),
 ]).parse(await call('ediel_signed_brp_declaration_scope_v1',companyId,{p_selector:selector}))
 if(result.status==='scope_available'&&(result.claims.companyId!==companyId||result.claims.environment!==selector.environment||result.claims.contractId!==selector.contractId||result.claims.agreementHash!==selector.agreementHash))throw Error('signed_brp_preview_scope_mismatch')
 return result
}
export async function archiveSignedBrpDeclaration(companyId:string,submission:z.infer<typeof signedBrpSubmission>){
 const own=signedBrpSubmission.parse(submission),agreement=bytes(own.agreementBase64),source=bytes(own.sourceBase64)
 if(agreement.subarray(0,5).toString('ascii')!=='%PDF-')throw Error('signed_brp_signed_pdf_required')
 const result=archive.parse(await call('ediel_archive_signed_brp_declaration_v1',companyId,{p_submission:own}))
 if(result.agreementHash!==digest(agreement)||result.sourceHash!==digest(source))throw Error('signed_brp_archive_hash_mismatch')
 return result
}
export async function readSignedBrpDeclaration(companyId:string,artifactId:string,includeBytes=false){
 uuid.parse(artifactId)
 const result=artifact.parse(await call('ediel_read_signed_brp_declaration_v1',companyId,{p_artifact_id:artifactId,p_include_bytes:includeBytes}))
 if(result.companyId!==companyId||result.artifactId!==artifactId||result.claims.companyId!==companyId||result.claims.contractId!==result.contractId||result.claims.environment!==result.environment||result.claims.agreementHash!==result.agreementHash)throw Error('signed_brp_read_scope_mismatch')
 if(!includeBytes&&(result.agreementBase64!==undefined||result.sourceBase64!==undefined))throw Error('signed_brp_unrequested_original_bytes')
 if(includeBytes){
  if(!result.bytesAvailable||!result.agreementBase64||!result.sourceBase64)throw Error('signed_brp_original_unavailable')
  const agreement=bytes(result.agreementBase64),source=bytes(result.sourceBase64)
  if(agreement.length!==result.agreementByteLength||source.length!==result.sourceByteLength||digest(agreement)!==result.agreementHash||digest(source)!==result.sourceHash)throw Error('signed_brp_read_hash_mismatch')
 }
 return result
}
/** Separate current reviewer, source competence, immutable originals, custody
 * and the native declaration+origin transaction are rechecked inside the RPC. */
export async function reviewSignedBrpDeclaration(companyId:string,artifactId:string,command:z.infer<typeof signedBrpReview>){
 uuid.parse(artifactId)
 const result=review.parse(await call('ediel_review_signed_brp_declaration_v1',companyId,{p_artifact_id:artifactId,p_review:signedBrpReview.parse(command)}))
 if(result.artifactId!==artifactId)throw Error('signed_brp_review_scope_mismatch')
 return result
}
export async function revokeSignedBrpDeclaration(companyId:string,artifactId:string,reason:string){
 uuid.parse(artifactId);text(4000).parse(reason)
 const result=review.parse(await call('ediel_revoke_signed_brp_declaration_v1',companyId,{p_artifact_id:artifactId,p_reason:reason}))
 if(result.status!=='held'||result.artifactId!==artifactId)throw Error('signed_brp_revoke_scope_mismatch')
 return result
}
