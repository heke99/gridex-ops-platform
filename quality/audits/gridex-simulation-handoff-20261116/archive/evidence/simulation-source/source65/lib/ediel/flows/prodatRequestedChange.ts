import {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import {readRequestedChangeSource,originateRequestedChange} from '@/lib/ediel/production/requestedChangeSource'
import {renderAndQueueRequestedChange} from '@/lib/ediel/intent/lifeEventGateway'
import {supabaseService} from '@/lib/supabase/service'
/** The tenant's own active grid owner for the exact legal receiver; ambiguity or absence selects none. */
async function receiverGridOwner(companyId:string,legalReceiverId:string){
 const {data,error}=await supabaseService.from('grid_owners').select('id,name,ediel_id').eq('company_id',companyId).eq('ediel_id',legalReceiverId).eq('is_active',true).limit(2)
 if(error)throw error
 return data?.length===1?{id:data[0].id as string,name:data[0].name as string|null,ediel_id:data[0].ediel_id as string|null}:null
}
/** The selector is an approved immutable source event, never a switch, a typed
 * date/status, a preview or a customer UUID supplied as authorization. */
export async function prepareAndQueueProdatRequestedChange(input:{companyId:string;eventId:string;actorUserId:string;preferredRouteId?:string|null}){
 const b=await readRequestedChangeSource(input);if(b.status==='held')return b
 const gridOwner=input.preferredRouteId?null:await receiverGridOwner(b.companyId,b.legalReceiverId)
 const r=await resolveCanonicalOutboundContext({companyId:b.companyId,environment:b.environment,requestType:'customer_masterdata',gridOwner,receiverEdielId:b.legalReceiverId,preferredRouteId:input.preferredRouteId,applicationReference:'23-DDQ-PRODAT'})
 if(r.actor.tenantIdentity?.legalActorId!==b.legalActorId||r.actor.legalActorEdielId!==b.legalSenderId||!r.actor.marketRoles.includes('electricity_supplier'))throw Error('requested_change_canonical_supplier_required')
 const origin=await originateRequestedChange({...input,route:{routeProfileId:r.routeRuntime?.route_profile_id,communicationRouteId:r.route.id,senderEdielId:r.senderEdielId,receiverEdielId:r.receiverEdielId,senderSubaddress:r.senderSubAddress,receiverSubaddress:r.receiverMessageSubAddress??r.receiverSubAddress,applicationReference:'23-DDQ-PRODAT'}})
 if(origin.status==='held')return origin
 return renderAndQueueRequestedChange({...input,intentId:origin.intentId,outboundRequestId:origin.outboundRequestId,routeContext:r})
}
