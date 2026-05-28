import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://missing-supabase-url.supabase.co'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'missing-service-role-key'

export const supabaseService = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})
