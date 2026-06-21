import { supabaseService } from '@/lib/supabase/service'
import { evaluateEdielRouteContract } from '@/lib/ediel/outbox/routeContract'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { getProductionSendApprovalBlocker } from '@/lib/ediel/productionSendApproval'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isMissingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function isProtectedOutboundFamily(message: EdielMessageRow): boolean {
  return message.direction === 'outbound' && (message.message_family === 'PRODAT' || message.message_family === 'UTILTS')
}

export async function getEdielOutboundReadinessBlocker(message: EdielMessageRow): Promise<string | null> {
  if (!isProtectedOutboundFamily(message)) return null

  const productionApprovalBlocker = await getProductionSendApprovalBlocker({
    companyId: message.company_id ?? null,
    environment: message.environment ?? null,
    senderEdielId: message.sender_ediel_id ?? message.unb_sender_id ?? null,
    messageFamily: message.message_family ?? null,
  })
  if (productionApprovalBlocker) return productionApprovalBlocker

  const routeContract = await evaluateEdielRouteContract(message)
  if (!routeContract.ok) return routeContract.blocker ?? 'route_contract_not_ready'

  const receiverEdielId = clean(message.receiver_ediel_id) ?? clean(message.unb_receiver_id) ?? routeContract.receiverEdielId
  if (!receiverEdielId) return 'receiver_ediel_id_missing'

  const { data, error } = await supabaseService
    .from('actor_readiness_status')
    .select('platform_market_actor_id,actor_name,ediel_id,can_use_for_prodat,can_use_for_utilts,can_start_supplier_switch,blocking_reasons')
    .eq('ediel_id', receiverEdielId)
    .limit(2)

  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }

  const rows = (data ?? []) as Array<{
    can_use_for_prodat?: boolean | null
    can_use_for_utilts?: boolean | null
    blocking_reasons?: string[] | null
  }>

  if (rows.length === 0) return 'receiver_actor_not_verified'
  if (rows.length > 1) return 'receiver_actor_duplicate_match'

  const row = rows[0]
  const ready = message.message_family === 'PRODAT' ? row.can_use_for_prodat === true : row.can_use_for_utilts === true
  if (ready) return null

  const reasons = Array.isArray(row.blocking_reasons) && row.blocking_reasons.length > 0
    ? row.blocking_reasons.join(',')
    : 'actor_readiness_not_ok'
  return `${message.message_family.toLowerCase()}_receiver_not_ready:${reasons}`
}
