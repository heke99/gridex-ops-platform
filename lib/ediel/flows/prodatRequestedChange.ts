import {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import {readRequestedChangeSource,originateRequestedChange} from '@/lib/ediel/production/requestedChangeSource'
import {renderAndQueueRequestedChange} from '@/lib/ediel/intent/lifeEventGateway'
import {selectTenantUsableGridOwners} from '@/lib/grid-owners/platformGridOwnerResolver'
/** The active grid owner usable by the tenant for the exact legal receiver: its own row, else a shared
 * registry row, never another tenant's (FINDINGS F101); ambiguity or absence selects none. */
async function receiverGridOwner(companyId:string,legalReceiverId:string){
 const data=await selectTenantUsableGridOwners<{id:string;name:string|null;ediel_id:string|null}>({companyId,select:'id,name,ediel_id',match:{ediel_id:legalReceiverId,is_active:true}})
 return data.length===1?{id:data[0].id,name:data[0].name,ediel_id:data[0].ediel_id}:null
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
