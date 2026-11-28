import type { SupabaseClient } from '@supabase/supabase-js'

type FacilityRequestDiagnostic = {
  request_id: string
  dispatch_error_message: string | null
  last_error_message: string | null
}

export async function readFacilityRequestDiagnostics(
  client: Pick<SupabaseClient, 'rpc'>,
  requestIds: string[],
): Promise<Map<string, FacilityRequestDiagnostic>> {
  const ids = [...new Set(requestIds)]
  if (ids.length === 0) return new Map()

  const { data, error } = await client.rpc('gridex_read_facility_request_diagnostics_v1', { p_request_ids: ids })
  if (error || !Array.isArray(data)) return new Map()

  return new Map((data as FacilityRequestDiagnostic[]).map(row => [row.request_id, row]))
}
