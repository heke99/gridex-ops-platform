import { supabaseService } from '@/lib/supabase/service'

const VIEW_LIMIT = 100
const ARCHIVE_HOLD_REASON = 'ediel_reconciliation_archive_binding_not_qualified'
const RECONCILIATION_FIELDS = 'id,current_send_attempt_id,ediel_message_id,status,blocked_reason,message_family,message_code,ack_outcome,environment,attempts,updated_at'
export const DELIVERY_UNCERTAIN_OUTBOX_SECTION = 'avstamningsbehov'

export function isEdielOutboxArchiveHeld(row: Partial<Record<'status' | 'blocked_reason', unknown>> | null | undefined) {
  return row?.status === 'sending' && row.blocked_reason === ARCHIVE_HOLD_REASON
}

function exactCount(value: number | null) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export async function readDeliveryUncertainOutboxCount(companyId: string | null): Promise<number | null> {
  try {
    let query = supabaseService.from('ediel_outbox').select('id', { count: 'exact', head: true })
      .eq('status', 'delivery_uncertain')
    if (companyId) query = query.eq('company_id', companyId)
    const { count, error } = await query
    return error ? null : exactCount(count)
  } catch {
    return null
  }
}

export async function readEdielOutboxReconciliation(companyId: string | null) {
  try {
    let query = supabaseService.from('ediel_outbox').select(RECONCILIATION_FIELDS, { count: 'exact' })
      .or(`status.eq.delivery_uncertain,and(status.eq.sending,blocked_reason.eq.${ARCHIVE_HOLD_REASON})`)
    if (companyId) query = query.eq('company_id', companyId)
    const { data, error, count } = await query
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(VIEW_LIMIT + 1)
    if (error || !Array.isArray(data) || data.some(row => row?.status !== 'delivery_uncertain' && !isEdielOutboxArchiveHeld(row))) return null
    const total = exactCount(count)
    const consistentTotal = total !== null && total >= data.length ? total : null
    return {
      rows: data.slice(0, VIEW_LIMIT),
      truncated: data.length > VIEW_LIMIT || (consistentTotal !== null && consistentTotal > data.length),
      count: consistentTotal,
    }
  } catch {
    return null
  }
}
