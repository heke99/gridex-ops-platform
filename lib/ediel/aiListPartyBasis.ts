import {isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

export type AiListPartyBasis=Readonly<{status:'source_qualified';companyId:string;environment:'test'|'production';intentId:string;communicationRouteId:string;routeProfileId:string;
 legalSupplier:string;legalSupplierName:string;legalNetwork:string;legalNetworkName:string;technicalSender:string;technicalReceiver:string;sourceBasis:Record<string,unknown>}>
const qualified=new WeakSet<object>()
/** The selector is a real validated technical intent. Neither its caller JSON
 * nor the route's technical party IDs supply legal CSV-header identities. */
export async function readAiListPartyBasis(input:{companyId:string;actorUserId:string;intentId:string}):Promise<AiListPartyBasis>{
 if(![input.companyId,input.actorUserId,input.intentId].every(isEvidenceUuid))throw Error('ai_list_party_intent_scope_required')
 const {supabaseService}=await import('@/lib/supabase/service')
 const{data,error}=await supabaseService.rpc('ediel_ai_outbound_party_basis_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_intent_id:input.intentId}).abortSignal(AbortSignal.timeout(2000))
 if(error)throw error
 if(!isEvidenceRecord(data)||data.status!=='source_qualified'||data.companyId!==input.companyId||data.intentId!==input.intentId
  ||!['test','production'].includes(String(data.environment))||![data.communicationRouteId,data.routeProfileId].every(isEvidenceUuid)
  ||![data.legalSupplier,data.legalNetwork].every(v=>typeof v==='string'&&/^\d{5}$/.test(v))
  ||![data.legalSupplierName,data.legalNetworkName].every(v=>typeof v==='string'&&v.trim()&&!/[;\r\n\x00-\x1f\x7f]/.test(v))
  ||![data.technicalSender,data.technicalReceiver].every(v=>typeof v==='string'&&v.length>0&&v.length<=35&&v===v.trim()&&!/[\x00-\x20\x7f]/.test(v))
  ||!isEvidenceRecord(data.sourceBasis))throw Error('ai_list_party_basis_unconfirmed')
 const result=Object.freeze(structuredClone(data)) as AiListPartyBasis
 qualified.add(result);return result
}
/** Only the actual native read's object may render a fresh live draft. The
 * native original/current owner requalifies it before persistence/transport. */
export function requireAiListPartyBasis(value:AiListPartyBasis,scope:{companyId?:string|null;environment?:string|null;sender:string;receiver:string;communicationRouteId?:string|null}):AiListPartyBasis{
 if(!qualified.has(value)||value.companyId!==scope.companyId||value.environment!==scope.environment||value.technicalSender!==scope.sender
  ||value.technicalReceiver!==scope.receiver||value.communicationRouteId!==scope.communicationRouteId)throw Error('ai_list_party_basis_scope_mismatch')
 return value
}
