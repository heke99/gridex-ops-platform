import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { loadTgtDateEventValidationContext } from '@/lib/ediel/testing/tgtDateEventContext'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { ProdatDateEventValidationContext } from '@/lib/ediel/prodat/prodatDateEventAuthority'
import { productionContractDateContext, type ProductionContractBasis } from './contractSource'
import { readRecoveryOriginalBasis, type RecoverySourceBasis } from '@/lib/ediel/recovery/sourceContext'

export function recoveryDateEventScope(context: ProdatDateEventValidationContext | undefined, recovery: RecoverySourceBasis): ProdatDateEventValidationContext | undefined {
  if (!context) return undefined
  const objects = context.objects.filter(o => recovery.allowedObjects.some(allowed => allowed.point === o.meteringPointId && allowed.identityAgency === o.identityAgency))
  if (!objects.length || recovery.allowedObjects.some(allowed => !objects.some(o => allowed.point === o.meteringPointId && allowed.identityAgency === o.identityAgency))) throw new Error('prodat_recovery_date_scope_unqualified')
  return { source: context.source, objects }
}

/** Private origin binding owns source selection; a parsed source.kind and a
 * caller-supplied event identifier never select or qualify a live source. */
export async function loadProdatDateEventValidationContext(message: EdielMessageRow, actorUserId: string): Promise<ProdatDateEventValidationContext | undefined> {
  return loadDateContext(message, actorUserId, new Set())
}
async function loadDateContext(message: EdielMessageRow, actorUserId: string, seen: Set<string>): Promise<ProdatDateEventValidationContext | undefined> {
  if (!message.company_id || message.direction !== 'outbound' || message.message_family !== 'PRODAT') return undefined
  if (!['Z06','Z09','Z10'].includes(message.message_code)) return undefined
  if (seen.has(message.id)) throw new Error('prodat_recovery_source_cycle')
  seen.add(message.id)
  const recovery = await readRecoveryOriginalBasis({ companyId: message.company_id, messageId: message.id, actorUserId })
  if (recovery) {
    const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('company_id', message.company_id).eq('id', recovery.originalMessageId).maybeSingle()
    if (error) throw error
    if (!data || data.company_id !== message.company_id || data.environment !== message.environment || data.direction !== 'outbound' || data.message_code !== message.message_code) throw new Error('prodat_recovery_date_original_scope')
    return recoveryDateEventScope(await loadDateContext(data as EdielMessageRow, actorUserId, seen), recovery)
  }
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
