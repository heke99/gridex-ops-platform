import { supabaseService } from '@/lib/supabase/service'

export type SupabaseAdminHealth = {
  ok: true
  projectRef: string | null
  urlHost: string | null
}

type JwtPayload = {
  role?: string
  ref?: string
  iss?: string
  [key: string]: unknown
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf8')
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    return JSON.parse(decodeBase64Url(payload)) as JwtPayload
  } catch {
    return null
  }
}

export function getSupabaseProjectRefFromUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const host = new URL(value).host
    const [first] = host.split('.')
    return first || null
  } catch {
    return null
  }
}

export function getSupabaseUrlHost(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).host
  } catch {
    return null
  }
}

export async function assertSupabaseAdminHealth(): Promise<SupabaseAdminHealth> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL saknas i serverns environment. Appen kan inte skapa riktiga Auth-användare.')
  }

  if (!anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY saknas i serverns environment. Appen kan inte verifiera inloggning.')
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY saknas i serverns environment. Vercel måste ha service-role key för Production, annars skapas inga Supabase Auth-users.')
  }

  if (serviceRoleKey === anonKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY är samma som anon key. Du måste lägga in riktig service_role key från samma Supabase-projekt.')
  }

  const urlProjectRef = getSupabaseProjectRefFromUrl(supabaseUrl)
  const payload = decodeJwtPayload(serviceRoleKey)

  if (!payload) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY ser inte ut som en giltig Supabase JWT. Kontrollera Vercel environment.')
  }

  if (payload.role !== 'service_role') {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY är inte en service_role key. JWT-role är "${String(payload.role ?? 'saknas')}".`)
  }

  if (urlProjectRef && payload.ref && payload.ref !== urlProjectRef) {
    throw new Error(
      `Supabase ENV mismatch: NEXT_PUBLIC_SUPABASE_URL pekar på projekt "${urlProjectRef}", men SUPABASE_SERVICE_ROLE_KEY tillhör projekt "${payload.ref}". Då skapas/läses Auth-users i fel projekt eller inte alls.`
    )
  }

  const { error } = await supabaseService.auth.admin.listUsers({ page: 1, perPage: 1 })
  if (error) {
    throw new Error(`Supabase Auth-admin kunde inte användas med nuvarande service-role key: ${error.message}`)
  }

  return {
    ok: true,
    projectRef: urlProjectRef ?? payload.ref ?? null,
    urlHost: getSupabaseUrlHost(supabaseUrl),
  }
}
