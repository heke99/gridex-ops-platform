import {supabaseService} from '@/lib/supabase/service'
import {readQualifiedCustomerStructure} from '@/lib/ediel/sources/qualifiedCustomerStructure'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

export type BrpFieldScope={companyId:string;contractId:string|null;actorUserId:string;environment:'test'|'production';customerId:string;siteId:string;meteringPointId:string;at:string;supplyPeriodId:string|null}
export type BrpFieldBasis={status:'authorized';sourceKind:'accepted_supply_brp'|'signed_contract_brp_declaration';companyId:string;environment:'test'|'production';contractId?:string;customerId:string;siteId:string;meteringPointId:string;at:string;supplyPeriodId:string|null;brpEdielId:string;pointId:string;identityAgency:'9'|'89';legalActorId:string;legalSenderId:string;legalReceiverId:string;gridArea:string;sourceMessageId?:string;sourcePayloadHash?:string;declarationId?:string}
export type BrpFieldHeld={status:'held';missing:string[]}
function checked(data:unknown,input:BrpFieldScope):BrpFieldBasis|BrpFieldHeld {
 if(!data||typeof data!=='object'||!('status'in data))throw Error('brp_field_source_result_invalid')
 const value=data as BrpFieldBasis|BrpFieldHeld
 if(value.status==='held'){if(!Array.isArray(value.missing)||!value.missing.length||!value.missing.every(item=>typeof item==='string'&&item))throw Error('brp_field_source_result_invalid');return value}
 if(value.status!=='authorized'||!['accepted_supply_brp','signed_contract_brp_declaration'].includes(value.sourceKind)||value.companyId!==input.companyId||value.environment!==input.environment||value.customerId!==input.customerId||value.siteId!==input.siteId||value.meteringPointId!==input.meteringPointId||value.supplyPeriodId!==input.supplyPeriodId||new Date(value.at).getTime()!==new Date(input.at).getTime()||!['9','89'].includes(value.identityAgency)||![value.customerId,value.siteId,value.meteringPointId,value.legalActorId].every(isEvidenceUuid)||!value.brpEdielId||value.brpEdielId!==value.brpEdielId.trim()||value.brpEdielId.length>35||/[\x00-\x1f\x7f]/.test(value.brpEdielId))throw Error('brp_field_source_scope_invalid')
 if(input.supplyPeriodId?(value.sourceKind!=='accepted_supply_brp'||!isEvidenceUuid(value.sourceMessageId)||!value.sourcePayloadHash||!/^[a-f0-9]{64}$/.test(value.sourcePayloadHash)):(value.sourceKind!=='signed_contract_brp_declaration'||value.contractId!==input.contractId||!isEvidenceUuid(value.declarationId)))throw Error('brp_field_source_scope_invalid')
 return value
}
const args=(input:BrpFieldScope)=>({p_company_id:input.companyId,p_contract_id:input.contractId,p_actor_user_id:input.actorUserId,p_environment:input.environment,p_customer_id:input.customerId,p_site_id:input.siteId,p_point_id:input.meteringPointId,p_at:input.at,p_period_id:input.supplyPeriodId})
/** The existing structural owner selects the dated source. The native port
 * independently fences that candidate against its complete protected universe;
 * neither an outgoing intent nor a B desired-change receipt supplies current262. */
export async function prepareQualifiedBrpSource(input:BrpFieldScope):Promise<BrpFieldBasis|BrpFieldHeld>{
 const read=async()=>{const{data,error}=await supabaseService.rpc('ediel_brp_field_source_v1',args(input));if(error)throw error;return checked(data,input)}
 const current=await read()
 if(current.status==='authorized'||!input.supplyPeriodId||!current.missing.includes('same_dated_structural_owner_brp_candidate'))return current
 const structure=await readQualifiedCustomerStructure({...input,periodStart:input.at,periodEnd:input.at})
 if(structure.status!=='selected'||structure.selection.coverage.supplyPeriodId!==input.supplyPeriodId||structure.selection.states.length!==1)return {status:'held',missing:['same_dated_structural_owner_brp_candidate']}
 const state=structure.selection.states[0],field=state.measurements?.balanceResponsibleId
 if(!field?.sourceMessageId||!field.value)return {status:'held',missing:['own_dated_source_field262']}
 const{data,error}=await supabaseService.rpc('ediel_qualify_brp_source_candidate_v1',{...args(input),p_snapshot_id:structure.snapshotId,p_readset_hash:structure.readsetHash,p_source_message_id:field.sourceMessageId})
 if(error)throw error
 const prepared=checked(data,input)
 return prepared.status==='held'?prepared:read()
}
