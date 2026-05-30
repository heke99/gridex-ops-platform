import { getSupabasePublicEnv } from '@/lib/env/supabasePublic'

function readRequiredServerEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return `build-time-placeholder-${key.toLowerCase()}`
    }
    throw new Error(`Missing required server environment variable: ${key}`)
  }
  return value
}

export function getSupabaseServiceEnv() {
  return {
    ...getSupabasePublicEnv(),
    serviceRoleKey: readRequiredServerEnv('SUPABASE_SERVICE_ROLE_KEY'),
  }
}
