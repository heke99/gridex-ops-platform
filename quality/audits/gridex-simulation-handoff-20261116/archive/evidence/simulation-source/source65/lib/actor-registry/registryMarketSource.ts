import {supabaseService} from '@/lib/supabase/service'

export type SourceQualifiedRegistryRoute=Readonly<{status:'source_qualified';routeId:string;actorId:string;market:'EL'|'GAS';sourceSha256:string;sourceRecordSha256:string;countryCode:string;legalEdielId:string;legalName?:string;roles:readonly string[];
 wire:Readonly<{actorId:string;market:'EL'|'GAS';family:string;environment:'test'|'production';subaddress:string|null;applicationReference:string|null;address:string;transport:string;partyId:string;interchangePartyId:string}>}>
export type RegistryRouteSourceHeld=Readonly<{status:'held';routeId:string;reason:string}>
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
/** A route ID selects an actual immutable source. Public metadata/market flags
 * cannot create this qualification or reconstruct a historical NULL market. */
export async function readRegistryRouteSource(routeId:string):Promise<SourceQualifiedRegistryRoute|RegistryRouteSourceHeld>{
 if(!uuid(routeId))throw Error('ediel_registry_route_id_required')
 const{data,error}=await supabaseService.rpc('ediel_registry_route_source_v1',{p_route_id:routeId})
 if(error)throw error
 if(data?.status==='held'&&data.routeId===routeId&&typeof data.reason==='string')return data
 if(data?.status!=='source_qualified'||data.routeId!==routeId||!uuid(data.actorId)||!['EL','GAS'].includes(data.market)||!['sourceSha256','sourceRecordSha256'].every(k=>typeof data[k]==='string'&&/^[a-f0-9]{64}$/.test(data[k]))
  ||typeof data.legalEdielId!=='string'||!data.legalEdielId||data.legalEdielId!==data.wire?.partyId||typeof data.countryCode!=='string'||!data.countryCode||!Array.isArray(data.roles)||!data.roles.every((v:unknown)=>typeof v==='string')||!data.wire||data.wire.actorId!==data.actorId||data.wire.market!==data.market||!['test','production'].includes(data.wire.environment)
  ||!['family','address','transport','partyId','interchangePartyId'].every(k=>typeof data.wire[k]==='string'&&data.wire[k])||!['subaddress','applicationReference'].every(k=>data.wire[k]===null||typeof data.wire[k]==='string'))throw Error('ediel_registry_route_source_result_invalid')
 return data
}
export async function requireElRegistryRouteSource(routeId:string):Promise<SourceQualifiedRegistryRoute>{
 const source=await readRegistryRouteSource(routeId)
 if(source.status!=='source_qualified'||source.market!=='EL')throw Error('ediel_registry_current_el_route_source_required')
 return source
}
export async function verifyElRegistryActor(input:{actorUserId:string;actorId:string;routeId?:string|null}):Promise<{actorId:string;routeIds:string[];market:'EL';autoSendAllowed:false}>{
 if(!uuid(input.actorUserId)||!uuid(input.actorId)||input.routeId&&!uuid(input.routeId))throw Error('ediel_registry_actual_actor_required')
 const{data,error}=await supabaseService.rpc('ediel_verify_registry_el_actor_v1',{p_actor_user_id:input.actorUserId,p_actor_id:input.actorId,p_route_id:input.routeId??null})
 if(error)throw error
 if(data?.actorId!==input.actorId||data.market!=='EL'||data.autoSendAllowed!==false||!Array.isArray(data.routeIds)||!data.routeIds.length||!data.routeIds.every(uuid)||input.routeId&&(data.routeIds.length!==1||data.routeIds[0]!==input.routeId))throw Error('ediel_registry_verify_source_result_invalid')
 return data
}

export type RegistryDispatchScope=Readonly<{companyId:string;communicationRouteId:string;routeProfileId:string;environment:'test'|'production';messageFamily:string;applicationReference:string|null}>
export type SourceQualifiedRegistryDispatch=SourceQualifiedRegistryRoute&Readonly<{companyId:string;communicationRouteId:string;routeProfileId:string;selectedApplicationReference:string|null;canonicalFamily?:'AI'}>
/** Actual profile/communication tuple, private current source, legal actor and
 * technical receiver are checked independently by the same native authority. */
export async function readRegistryDispatchSource(scope:RegistryDispatchScope):Promise<SourceQualifiedRegistryDispatch|null>{
 if(![scope.companyId,scope.communicationRouteId,scope.routeProfileId].every(uuid)||!['test','production'].includes(scope.environment)||!scope.messageFamily)throw Error('ediel_registry_dispatch_scope_required')
 if(scope.messageFamily==='AI_LIST'&&scope.applicationReference!==null)throw Error('ediel_registry_ai_list_application_forbidden')
 const{data,error}=await supabaseService.rpc('ediel_registry_dispatch_source_v1',{p_company_id:scope.companyId,p_communication_route_id:scope.communicationRouteId,p_route_profile_id:scope.routeProfileId,p_environment:scope.environment,p_message_family:scope.messageFamily,p_application_reference:scope.applicationReference})
 if(error)throw error
 if(data===null)return null
 // Reuse the exact route DTO validation; no public selector or JSON market
 // can substitute for the immutable native binding.
 if(!uuid(data?.routeId))throw Error('ediel_registry_dispatch_result_invalid')
 const source=await readRegistryRouteSource(data.routeId)
 const sourceFamily=scope.messageFamily==='AI_LIST'?'AI':scope.messageFamily
 if(source.status!=='source_qualified'||source.market!=='EL'||data.companyId!==scope.companyId||data.communicationRouteId!==scope.communicationRouteId||data.routeProfileId!==scope.routeProfileId||data.selectedApplicationReference!==scope.applicationReference||data.wire?.environment!==scope.environment||data.wire?.family!==sourceFamily||data.sourceSha256!==source.sourceSha256||data.sourceRecordSha256!==source.sourceRecordSha256||data.legalEdielId!==source.legalEdielId||JSON.stringify(data.wire)!==JSON.stringify(source.wire)
  ||scope.messageFamily==='AI_LIST'&&(data.canonicalFamily!=='AI'||typeof source.legalName!=='string'||!source.legalName||data.legalName!==source.legalName||source.wire.applicationReference!==null))throw Error('ediel_registry_dispatch_result_invalid')
 return data
}
export async function requireRegistryDispatchSource(scope:RegistryDispatchScope):Promise<SourceQualifiedRegistryDispatch>{
 const source=await readRegistryDispatchSource(scope)
 if(!source)throw Error('ediel_registry_current_el_dispatch_source_required')
 return source
}
