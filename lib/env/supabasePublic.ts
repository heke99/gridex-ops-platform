type SupabasePublicEnvKey =
  | 'NEXT_PUBLIC_SUPABASE_URL'
  | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'

function readRequiredPublicEnv(key: SupabasePublicEnvKey): string {
  const value = process.env[key]
  if (!value) {
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
