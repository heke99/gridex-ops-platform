import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceEnv } from '@/lib/env/supabaseServer'

const { url, serviceRoleKey } = getSupabaseServiceEnv()
// Public project URL captured from the exact settings used by this service client.
export const SUPABASE_SERVICE_URL = url

export const supabaseService = createClient(url, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})


export function createSupabaseServiceRequestClient(input: {
  requestId: string
  correlationId?: string | null
}) {
  const correlationId = input.correlationId?.trim() || input.requestId
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        'x-request-id': input.requestId,
        'x-correlation-id': correlationId,
      },
    },
  })
}
