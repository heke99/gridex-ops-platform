import { supabaseService } from '@/lib/supabase/service'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { ProdatDateEventValidationContext } from '@/lib/ediel/prodat/prodatDateEventAuthority'
import type { ProdatDateEventObject, ProductionContractDateEventSource } from '@/lib/ediel/prodat/prodatDateEvents'

export type ProductionContractBasis = {
  status: 'authorized'; companyId: string; environment: 'test' | 'production'; eventId: string; eventKind: 'signed' | 'ceased';
  sourceDigest: string; sourceVersion: string; sourceReference: string; legalActorId: string; legalSenderId: string; legalReceiverId: string;
  contractId: string; customerId: string; siteId: string; meteringPointId: string; pointId: string; identityAgency: '9' | '89'; gridArea: string;
  contractReference: string; contractRevision: string; boundaryAt: string;
}
export type ProductionContractHeld = { status: 'held'; missing: string[] }
export async function readProductionContractSource(input: { companyId: string; eventId: string; actorUserId: string }): Promise<ProductionContractBasis | ProductionContractHeld> {
  const { data, error } = await supabaseService.rpc('ediel_production_contract_source_v1', { p_company_id: input.companyId, p_event_id: input.eventId, p_actor_user_id: input.actorUserId })
  if (error) throw error
  if (!data || !['authorized', 'held'].includes(data.status)) throw new Error('production_contract_source_result_invalid')
  return data
}
export async function reserveProductionContractSource(input: { companyId: string; eventId: string; actorUserId: string; intentId: string; outboundRequestId: string }): Promise<{ status: 'reserved'; messageId: string | null; outboundRequestId: string } | ProductionContractHeld> {
  const { data, error } = await supabaseService.rpc('ediel_reserve_production_contract_origin_v1', { p_company_id: input.companyId, p_event_id: input.eventId, p_actor_user_id: input.actorUserId, p_intent_id: input.intentId, p_outbound_request_id: input.outboundRequestId })
  if (error) throw error
  if (!data || !['reserved', 'held'].includes(data.status)) throw new Error('production_contract_reservation_result_invalid')
  return data
}
/** Only a fresh source RPC result plus the current canonical route can build
 * the separately supplied authority context. Stored payload facts cannot. */
export function productionContractDateContext(basis: ProductionContractBasis, route: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>): ProdatDateEventValidationContext {
  if (route.companyId !== basis.companyId || route.environment !== basis.environment || route.actor.tenantIdentity?.legalActorId !== basis.legalActorId
    || route.actor.legalActorEdielId !== basis.legalSenderId || route.receiverEdielId !== basis.legalReceiverId || !route.actor.marketRoles.includes('electricity_supplier')) throw new Error('production_contract_canonical_supplier_scope_mismatch')
  const source: ProductionContractDateEventSource = { kind: 'production_contract', companyId: basis.companyId, environment: basis.environment, code: 'Z09', eventId: basis.eventId,
    sourceDigest: basis.sourceDigest, sourceVersion: basis.sourceVersion, actorId: basis.legalActorId, reference: basis.sourceReference,
    route: { actorSettingId: route.actor.actor.id, routeProfileId: route.routeRuntime?.route_profile_id ?? null, communicationRouteId: route.route.id,
      legalSender: { id: basis.legalSenderId, qualifier: '160', agency: 'SVK' }, legalRecipient: { id: basis.legalReceiverId, qualifier: '160', agency: 'SVK' },
      senderId: route.senderEdielId, receiverId: route.receiverEdielId, senderQualifier: 'ZZ', receiverQualifier: 'ZZ', senderSubaddress: route.senderSubAddress,
      receiverSubaddress: route.receiverMessageSubAddress ?? route.receiverSubAddress, transportType: 'smtp', mailbox: route.mailbox,
      receiverEmail: route.receiverEmail, applicationReference: route.applicationReference ?? '', suppliers: [] } }
  const object: ProdatDateEventObject = { kind: 'production_contract', direction: 'production', meteringPointId: basis.pointId, identityAgency: basis.identityAgency,
    contract: { reference: basis.contractReference, revision: basis.contractRevision }, event: { kind: basis.eventKind, reference: basis.sourceReference, revision: basis.sourceVersion }, supplyBoundaryAt: basis.boundaryAt }
  return { source, objects: [object] }
}
