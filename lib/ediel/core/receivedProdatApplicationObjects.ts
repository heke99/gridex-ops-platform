import {supabaseService} from '@/lib/supabase/service'
import {bindReceivedProdatApplicationObjects,type ReceivedProdatApplicationObjectValidation} from '@/lib/ediel/prodat/prodatApplicationObjectValidation'
import {isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

/** Service read of an existing immutable canonical owner. The caller's raw
 * source must be exact; this read neither validates again nor approves effects. */
export async function readReceivedProdatApplicationObjects(input:{companyId:string;sourceMessageId:string;rawPayload:string}):Promise<(ReceivedProdatApplicationObjectValidation&{assessmentId:string})|null>{
  if(!isEvidenceUuid(input.companyId)||!isEvidenceUuid(input.sourceMessageId))return null
  const {data,error}=await supabaseService.rpc('ediel_read_prodat_application_objects_v1',{
    p_company_id:input.companyId,p_source_message_id:input.sourceMessageId,
  }).abortSignal(AbortSignal.timeout(2000))
  if(error||!isEvidenceRecord(data)||!isEvidenceUuid(data.assessmentId))return null
  const {assessmentId,...candidate}=data,facet=bindReceivedProdatApplicationObjects(candidate,input.rawPayload)
  return facet?{...facet,assessmentId}:null
}
