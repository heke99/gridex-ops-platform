import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { loadTgtDateEventValidationContext } from '@/lib/ediel/testing/tgtDateEventContext'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { ProdatDateEventValidationContext } from '@/lib/ediel/prodat/prodatDateEventAuthority'
import { productionContractDateContext, type ProductionContractBasis } from './contractSource'

/** Private origin binding owns source selection; a parsed source.kind and a
 * caller-supplied event identifier never select or qualify a live source. */
export async function loadProdatDateEventValidationContext(message: EdielMessageRow, actorUserId: string): Promise<ProdatDateEventValidationContext | undefined> {
  if (message.direction !== 'outbound' || message.message_family !== 'PRODAT') return undefined
  if (message.message_code === 'Z09' && message.company_id) {
    const { data, error } = await supabaseService.rpc('ediel_production_contract_message_basis_v1', { p_company_id: message.company_id, p_message_id: message.id, p_actor_user_id: actorUserId })
    if (error) throw error
    if (data?.status === 'held') throw new Error('production_contract_current_source_held')
    if (data) {
      if (data.basis?.status !== 'authorized' || data.intentId !== message.intent_id) throw new Error('production_contract_message_basis_invalid')
      const basis: ProductionContractBasis = data.basis
      const route = await resolveCanonicalOutboundContext({ companyId: basis.companyId, environment: basis.environment, requestType: 'customer_masterdata',
        receiverEdielId: basis.legalReceiverId, preferredRouteId: message.communication_route_id, applicationReference: message.application_reference })
      return productionContractDateContext(basis, route)
    }
  }
  return loadTgtDateEventValidationContext(message)
}
