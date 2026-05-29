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
