type SupabasePublicEnvKey =
  | 'NEXT_PUBLIC_SUPABASE_URL'
  | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'

const BUILD_TIME_PUBLIC_FALLBACKS: Record<SupabasePublicEnvKey, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://build-time-placeholder.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'build-time-placeholder-anon-key',
}

function isNextProductionBuild() {
  return process.env.NEXT_PHASE === 'phase-production-build'
}

function readRequiredPublicEnv(key: SupabasePublicEnvKey): string {
  const value = process.env[key]
  if (!value) {
    if (isNextProductionBuild()) return BUILD_TIME_PUBLIC_FALLBACKS[key]
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

export function getSupabasePublicEnv() {
  return {
    url: readRequiredPublicEnv('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: readRequiredPublicEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  }
}
