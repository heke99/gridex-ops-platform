import 'server-only'
import {supabaseService} from '@/lib/supabase/service'
import {downloadAndVerifyCustomerContractDocumentBounded,type CustomerContractDocumentRow} from '@/lib/customer-contracts/documents'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
export type DocumentReferenceInput={companyId:string;environment:'test'|'production';sourceMessageId:string;documentId:string;actorUserId:string}
export type DocumentReferenceResult={kind:'context_document_reference_v1';coverage:'incomplete';authority:'none'}&(
 |{status:'recorded';attemptId:string;outcomeId:string;witnessId:string;observation:'verified_at_observation'|'unavailable'}
 |{status:'unconfirmed';attemptId?:string}
 |{status:'unavailable';reason:'invalid_capture_input'})
const common={kind:'context_document_reference_v1',coverage:'incomplete',authority:'none'} as const
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const rpc=async(name:string,args:Record<string,unknown>)=>{
 const {data,error}=await supabaseService.rpc(name,args).abortSignal(AbortSignal.timeout(5000))
 if(error||!isEvidenceRecord(data))throw Error('document_reference_unavailable')
 return data
}
/** Every invocation appends a new attempt and rereads bytes; no availability cache. */
export async function captureDocumentReference(input:DocumentReferenceInput):Promise<DocumentReferenceResult>{
 if(![input.companyId,input.sourceMessageId,input.documentId,input.actorUserId].every(isEvidenceUuid)
 ||!['test','production'].includes(input.environment)||Object.keys(input).some(k=>!['companyId','environment','sourceMessageId','documentId','actorUserId'].includes(k)))
 return {...common,status:'unavailable',reason:'invalid_capture_input'}
 let attemptId:string|undefined
 try{
  const args={p_company_id:input.companyId,p_environment:input.environment,p_source_message_id:input.sourceMessageId,p_document_id:input.documentId,p_actor_user_id:input.actorUserId}
  const attempt=await rpc('gridex_begin_document_reference_v1',args)
  if(attempt.kind!==common.kind||!isEvidenceUuid(attempt.attemptId)||!hash(attempt.factsHash)
   ||typeof attempt.recordedAt!=='string'||parseSourceReceiptInstant(attempt.recordedAt)===null
   ||Object.entries(input).some(([k,v])=>attempt[k]!==v))throw Error('invalid_attempt')
  attemptId=attempt.attemptId
  const doc=attempt.document
  if(!isEvidenceRecord(doc)||doc.id!==input.documentId||doc.company_id!==input.companyId||!isEvidenceUuid(doc.customer_contract_id))throw Error('invalid_document')
  const observation=attempt.eligible===true
   ?await downloadAndVerifyCustomerContractDocumentBounded(doc as CustomerContractDocumentRow)
   :{status:'unavailable',reason:'unresolved_link',startedAt:null,completedAt:null,byteCount:0}
  const outcome=await rpc('gridex_observe_document_reference_v1',{p_attempt_id:attemptId,p_actor_user_id:input.actorUserId,p_company_id:input.companyId,p_environment:input.environment,p_observation:observation})
  if(outcome.attemptId!==attemptId||!isEvidenceUuid(outcome.outcomeId)||!hash(outcome.factsHash)
   ||(observation.status==='unavailable'&&outcome.status==='verified_at_observation')
   ||!['verified_at_observation','unavailable'].includes(String(outcome.status)))throw Error('invalid_outcome')
  const witness=await rpc('gridex_witness_document_reference_v1',{p_company_id:input.companyId,p_environment:input.environment,p_outcome_id:outcome.outcomeId,p_facts_hash:outcome.factsHash})
  if(witness.attemptId!==attemptId||witness.outcomeId!==outcome.outcomeId||witness.factsHash!==outcome.factsHash||!isEvidenceUuid(witness.witnessId)
   ||typeof witness.availableAt!=='string'||parseSourceReceiptInstant(witness.availableAt)===null
   ||parseSourceReceiptInstant(witness.availableAt)!<parseSourceReceiptInstant(attempt.recordedAt)!
   ||parseSourceReceiptInstant(witness.availableAt)!>=(BigInt(Date.now())+BigInt(1))*BigInt(1000))throw Error('invalid_witness')
  return {...common,status:'recorded',attemptId,outcomeId:outcome.outcomeId,witnessId:witness.witnessId,observation:outcome.status as 'verified_at_observation'|'unavailable'}
 }catch{return {...common,status:'unconfirmed',...(attemptId?{attemptId}:{})}}
}

/** Saved cutoff facts remain separate from fresh observations. Unknown history
 * applies to this actual sealed candidate, never to unrelated ordinary supplies. */
export async function readDocumentReferenceContext(input:Omit<DocumentReferenceInput,'documentId'>&{cutoff:string}){
 const saved=await rpc('gridex_read_document_reference_context_v1',{
  p_company_id:input.companyId,p_environment:input.environment,p_source_message_id:input.sourceMessageId,p_actor_user_id:input.actorUserId,p_cutoff:input.cutoff,
 })
 if(saved.kind!==common.kind||saved.companyId!==input.companyId||saved.environment!==input.environment||saved.sourceMessageId!==input.sourceMessageId
 ||saved.coverage!=='incomplete'||saved.authority!=='none'||!Array.isArray(saved.attempts)||saved.attempts.length>1000)throw Error('invalid_reference_readset')
 const documents=[...new Set(saved.attempts.map(a=>isEvidenceRecord(a)&&isEvidenceUuid(a.documentId)?a.documentId:null))]
 if(documents.includes(null))throw Error('invalid_reference_readset')
 // Bound one request's work. A larger set cannot accidentally become complete.
 const revalidation:DocumentReferenceResult[]=[]
 for(const documentId of documents.slice(0,10))revalidation.push(await captureDocumentReference({companyId:input.companyId,environment:input.environment,sourceMessageId:input.sourceMessageId,actorUserId:input.actorUserId,documentId:documentId!}))
 const contentVerified=documents.length>0&&documents.length<=10&&saved.truncated===false
  &&saved.attempts.every(a=>isEvidenceRecord(a)&&isEvidenceRecord(a.outcome)&&isEvidenceRecord(a.witness))
  &&revalidation.every(r=>r.status==='recorded'&&r.observation==='verified_at_observation')
 return {saved,revalidation,coverage:'incomplete' as const,authority:'none' as const,revalidationTruncated:documents.length>10,
  contentStatus:contentVerified?'verified_at_observation' as const:'document_reference_unavailable' as const}
}
