import {supabaseService} from '@/lib/supabase/service'
import {isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant as instant} from '@/lib/ediel/utilts/receivedSourceInventory'

type CaptureInput={companyId:string;environment:'test'|'production';sourceMessageId:string;actorUserId:string;documentId?:string}
type CaptureReceipt={version:1;captureId:string;companyId:string;environment:'test'|'production';sourceMessageId:string;
  contentHash:string;factsHash:string;capturedAt:string;disposition:'unreviewed'}
export type CorrectionCaptureResult=
  |({status:'recorded';witnessId:string;availableAt:string}&CaptureReceipt)
  |{status:'unconfirmed';disposition:'unreviewed'}
  |{status:'unavailable';reason:'document_context_retention_unresolved'|'invalid_capture_input';disposition:'unreviewed'}
const unconfirmed=():CorrectionCaptureResult=>({status:'unconfirmed',disposition:'unreviewed'})
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
function receipt(v:unknown,input:CaptureInput):v is CaptureReceipt&Record<string,unknown>{
  return isEvidenceRecord(v)&&v.version===1&&isEvidenceUuid(v.captureId)&&v.companyId===input.companyId
    &&v.environment===input.environment&&v.sourceMessageId===input.sourceMessageId&&hash(v.contentHash)&&hash(v.factsHash)
    &&typeof v.capturedAt==='string'&&instant(v.capturedAt)!==null&&v.disposition==='unreviewed'
}
/** IDs only. The database rereads the sealed original and computes both hashes
 * and observations. Neither this service nor a capture receipt approves C. */
export async function captureCorrectionContext(input:CaptureInput):Promise<CorrectionCaptureResult>{
  if(input.documentId!==undefined)return {status:'unavailable',reason:'document_context_retention_unresolved',disposition:'unreviewed'}
  if(![input.companyId,input.sourceMessageId,input.actorUserId].every(isEvidenceUuid)||!['test','production'].includes(input.environment)
    ||Object.keys(input).some(key=>!['companyId','environment','sourceMessageId','actorUserId'].includes(key)))
    return {status:'unavailable',reason:'invalid_capture_input',disposition:'unreviewed'}
  try{
    const {data,error}=await supabaseService.rpc('gridex_capture_correction_concern_v1',{
      p_company_id:input.companyId,p_environment:input.environment,p_source_message_id:input.sourceMessageId,p_actor_user_id:input.actorUserId,
    }).abortSignal(AbortSignal.timeout(5000))
    if(error||!receipt(data,input))return unconfirmed()
    const {data:witness,error:witnessError}=await supabaseService.rpc('gridex_witness_correction_concern_v1',{
      p_company_id:input.companyId,p_environment:input.environment,p_capture_id:data.captureId,p_facts_hash:data.factsHash,
    }).abortSignal(AbortSignal.timeout(5000))
    if(witnessError||!receipt(witness,input)||!isEvidenceRecord(witness)||!isEvidenceUuid(witness.witnessId)
      ||typeof witness.availableAt!=='string'||(['captureId','contentHash','factsHash','capturedAt'] as const).some(key=>witness[key]!==data[key]))return unconfirmed()
    const available=instant(witness.availableAt),captured=instant(data.capturedAt)!
    if(available===null||available<captured||available>=(BigInt(Date.now())+BigInt(1))*BigInt(1000))return unconfirmed()
    // Copy the allowlisted contract, never pass through extra alleged authority.
    return {status:'recorded',version:1,captureId:data.captureId,companyId:data.companyId,environment:data.environment,
      sourceMessageId:data.sourceMessageId,contentHash:data.contentHash,factsHash:data.factsHash,capturedAt:data.capturedAt,
      disposition:'unreviewed',witnessId:witness.witnessId,availableAt:witness.availableAt}
  }catch{return unconfirmed()}
}
