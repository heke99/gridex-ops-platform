import type {CanonicalRouteContext} from '@/lib/ediel/core/routeRegistry'

/** Message-level parties are juridical actors. The same current canonical
 * tenant identity owns the legal sender and its distinct UNB transport agent;
 * absent or inconsistent identity never falls back to the transport ID. */
export function requireZ01LegalSender(route:CanonicalRouteContext,companyId:string):string{
 const identity=route.actor?.tenantIdentity,legal=route.actor?.legalActorEdielId
 if(route.companyId!==companyId||!identity||identity.companyId!==companyId||identity.environment!==route.environment||typeof legal!=='string'||!legal||legal!==legal.trim()||identity.legalEdielId!==legal||identity.transportEdielId!==route.senderEdielId||route.actor.senderEdielId!==route.senderEdielId)throw Error('z01_verified_legal_sender_required')
 return legal
}
