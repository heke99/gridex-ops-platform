import {requireRegistryDispatchSource} from '@/lib/actor-registry/registryMarketSource'
import type {CanonicalRouteContext} from '@/lib/ediel/core/routeRegistry'

/** Message-level parties are juridical actors. The same current canonical
 * tenant identity owns the legal sender and its distinct UNB transport agent;
 * absent or inconsistent identity never falls back to the transport ID. */
export function requireZ01LegalSender(route:CanonicalRouteContext,companyId:string):string{
 const identity=route.actor?.tenantIdentity,legal=route.actor?.legalActorEdielId
 if(route.companyId!==companyId||!identity||identity.companyId!==companyId||identity.environment!==route.environment||typeof legal!=='string'||!legal||legal!==legal.trim()||identity.legalEdielId!==legal||identity.transportEdielId!==route.senderEdielId||route.actor.senderEdielId!==route.senderEdielId)throw Error('z01_verified_legal_sender_required')
 return legal
}

/** The technical recipient alone cannot establish NAD+DO. Consume the exact
 * current immutable EL original bound to the actual dispatch/profile tuple. */
export async function requireZ01LegalReceiver(route:CanonicalRouteContext,companyId:string,applicationReference:string):Promise<{legalEdielId:string;countryCode:string}>{
 const profileId=route.routeRuntime?.route_profile_id
 if(route.companyId!==companyId||!profileId)throw new Error('z01_verified_legal_receiver_required')
 const source=await requireRegistryDispatchSource({companyId,communicationRouteId:route.route.id,routeProfileId:profileId,environment:route.environment,messageFamily:'PRODAT',applicationReference})
 if(source.companyId!==companyId||source.communicationRouteId!==route.route.id||source.routeProfileId!==profileId||source.market!=='EL'||source.wire.family!=='PRODAT'||source.wire.environment!==route.environment
  ||source.wire.interchangePartyId!==route.receiverEdielId||source.wire.subaddress!==(route.receiverMessageSubAddress??route.receiverSubAddress??null)||source.selectedApplicationReference!==applicationReference||!source.legalEdielId||source.legalEdielId!==source.legalEdielId.trim()||!/^([A-Z]{2})$/.test(source.countryCode))throw new Error('z01_verified_legal_receiver_required')
 return {legalEdielId:source.legalEdielId,countryCode:source.countryCode}
}
