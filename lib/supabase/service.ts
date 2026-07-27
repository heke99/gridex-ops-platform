import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceEnv } from '@/lib/env/supabaseServer'

const { url, serviceRoleKey } = getSupabaseServiceEnv()

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
