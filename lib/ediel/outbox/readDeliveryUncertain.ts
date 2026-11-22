import { supabaseService } from '@/lib/supabase/service'

const VIEW_LIMIT = 100

export async function readDeliveryUncertainOutbox(companyId: string | null) {
  try {
    let query = supabaseService.from('ediel_outbox')
      .select('id,ediel_message_id,status,message_family,message_code,ack_outcome,environment,attempts,updated_at')
      .eq('status', 'delivery_uncertain')
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(VIEW_LIMIT + 1)
    if (companyId) query = query.eq('company_id', companyId)

    const { data, error } = await query
    if (error || !Array.isArray(data) || data.some(row => row?.status !== 'delivery_uncertain')) return null
    return { rows: data.slice(0, VIEW_LIMIT), truncated: data.length > VIEW_LIMIT }
  } catch {
    return null
  }
}
