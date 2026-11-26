import type { SupabaseClient } from '@supabase/supabase-js'

type E66ImportProgress = {
  company_id: string
  request_id: string
  customer_id: string
  customer_label: string
  started_at: string
  environment: 'test' | 'production'
  retry_required: boolean
}

const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i

export async function readE66ImportProgress(supabase: SupabaseClient, companyId: string, requestId?: string): Promise<E66ImportProgress[]> {
  const { data, error } = await supabase.rpc('gridex_read_staff_e66_import_progress_v1', {
    p_company: companyId, ...(requestId === undefined ? {} : { p_request: requestId }),
  })
  if (error) throw error
  if (!Array.isArray(data) || data.length > (requestId === undefined ? 250 : 2) || data.some(row =>
    row?.company_id !== companyId || typeof row.request_id !== 'string' || !UUID.test(row.request_id) ||
    typeof row.customer_id !== 'string' || !UUID.test(row.customer_id) ||
    typeof row.customer_label !== 'string' || typeof row.started_at !== 'string' || !Number.isFinite(Date.parse(row.started_at)) ||
    typeof row.retry_required !== 'boolean' || (row.environment !== 'test' && row.environment !== 'production') ||
    (requestId !== undefined && row.request_id !== requestId)
  )) throw new Error('e66_staff_import_progress_invalid_response')
  return data
}

export function formatE66ImportProgress(row: E66ImportProgress): string {
  const description = row.retry_required
    ? 'Mätvärdesimporten behöver fortsätta efter ett avbrutet försök'
    : 'Mätvärdesimporten pågår eller väntar på fortsatt bearbetning'
  return description + (row.environment === 'test' ? ' (TEST)' : ' (PRODUKTION)')
}
