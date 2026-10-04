import type { DecisionBackedOutboundContext } from '@/lib/ediel/flows/routeDecisionContext'

/** The selected current tenant legal identity and the actual network record
 * select the expected dated source tuple. Neither UNB endpoint is authority.
 * requireDataRequestStructure subsequently compares both with its own immutable
 * received source; the resulting source pair supplies message-level NAD. */
export function dataRequestLegalParties(input: {
  companyId: string; environment: 'test' | 'production';
  route: DecisionBackedOutboundContext; networkEdielId: string | null | undefined;
}): { legalSupplier: string; legalNetwork: string } {
  const identity = input.route.actor.tenantIdentity
  if (input.route.companyId !== input.companyId || input.route.environment !== input.environment ||
    !identity || identity.companyId !== input.companyId || identity.environment !== input.environment ||
    identity.legalEdielId !== input.route.actor.legalActorEdielId || !/^\d{5}$/.test(identity.legalEdielId) ||
    typeof input.networkEdielId !== 'string' || !/^\d{5}$/.test(input.networkEdielId)) {
    throw new Error('utilts_data_request_legal_source_scope_required')
  }
  return { legalSupplier: identity.legalEdielId, legalNetwork: input.networkEdielId }
}
