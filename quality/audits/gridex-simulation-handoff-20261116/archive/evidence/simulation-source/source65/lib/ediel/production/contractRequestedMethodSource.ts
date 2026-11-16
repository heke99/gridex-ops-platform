import {supabaseService} from '@/lib/supabase/service'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {canonicalProdatMethodChangeTuple} from '@/lib/ediel/rulebook/canonicalEdielFacade'
export type ContractRequestedMethodBasis=Readonly<{status:'authorized';declarationId:string;companyId:string;environment:'test'|'production';contractId:string;contractRevision:string;protectedContractHash:string;agreementSha256:string;customerId:string;siteId:string;meteringPointId:string;pointId:string;identityAgency:'9'|'89';legalActorId:string;legalSenderId:string;legalReceiverId:string;gridArea:string;requestedMethod:string;sourceReference:string;sourceVersion:string;sourceDigest:string}>
export type ContractRequestedMethodHeld={status:'held';missing:string[]}
/** Selectors do not declare contract terms. This port reads the sole private
 * source owner; missing authentic new-agreement declarations remain held. */
export async function readContractRequestedMethodSource(input:{companyId:string;contractId:string;actorUserId:string;environment:'test'|'production'}):Promise<ContractRequestedMethodBasis|ContractRequestedMethodHeld>{
 const{data,error}=await supabaseService.rpc('ediel_contract_metering_request_source_v1',{p_company_id:input.companyId,p_contract_id:input.contractId,p_actor_user_id:input.actorUserId,p_environment:input.environment})
 if(error)throw error
 if(!data||!['authorized','held'].includes(data.status))throw Error('contract_requested_method_source_result_invalid')
 if(data.status==='held'){if(!Array.isArray(data.missing)||data.missing.length===0||!data.missing.every((value:unknown)=>typeof value==='string'&&value.length>0))throw Error('contract_requested_method_source_result_invalid');return data}
 if(data.companyId!==input.companyId||data.contractId!==input.contractId||data.environment!==input.environment||![data.declarationId,data.contractId,data.customerId,data.siteId,data.meteringPointId,data.legalActorId].every(isEvidenceUuid)||!['9','89'].includes(data.identityAgency)||!['F','G'].some(subtype=>canonicalProdatMethodChangeTuple(subtype as 'F'|'G').method===data.requestedMethod))throw Error('contract_requested_method_source_scope_invalid')
 return data
}
export function assertContractRequestedMethodSelection(b:ContractRequestedMethodBasis,selection:{companyId:string;contractId:string;customerId:string;siteId:string;meteringPointId:string;environment:'test'|'production'}){
 if(b.companyId!==selection.companyId||b.contractId!==selection.contractId||b.customerId!==selection.customerId||b.siteId!==selection.siteId||b.meteringPointId!==selection.meteringPointId||b.environment!==selection.environment)throw Error('contract_requested_method_selected_scope_mismatch')
}
