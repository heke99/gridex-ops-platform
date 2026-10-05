import { isIP } from 'node:net'
import { createClient } from '@supabase/supabase-js'
import { ApiInputError } from '@/lib/api/strictRequest'
import type { StaffInvitationClient } from '@/lib/auth/staffInvitationRouting'
import { SUPABASE_SERVICE_URL } from '@/lib/supabase/service'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type RegisteredStaffTenantAuth = { url: string; publicKey: string; projectRef: string; authIssuer: string; origin: string }
export type StaffTenantAuthIdentity = { id: string; email?: string | null; email_confirmed_at?: string | null }

function invalid(): never {
  throw new ApiInputError('The independent staff Auth registration is unavailable.', 'staff_tenant_auth_registration_invalid', 403)
}

function lifecycleTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value)
  if (!parts) return null
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
  const milliseconds = Date.parse(value)
  return day >= 1 && day <= days && hour <= 23 && minute <= 59 && second <= 59 && Number.isFinite(milliseconds) ? milliseconds : null
}

function publicAuthKey(value: unknown, projectRef: string): string {
  if (typeof value !== 'string' || value.length > 8192 || /\s/.test(value)) return invalid()
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(value)) return value
  try {
    const parts = value.split('.')
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return invalid()
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown; ref?: unknown }
    if (claims.role !== 'anon' || (claims.ref !== undefined && claims.ref !== projectRef)) return invalid()
    return value
  } catch { return invalid() }
}

/** Operator-owned current registration. No browser URL, OPS service Auth, or email linking. */
export function registeredStaffTenantAuth(client: StaffInvitationClient | null, companyId: string, clientId: string, requiredScope: string): RegisteredStaffTenantAuth {
  if (!client || !UUID.test(companyId) || !UUID.test(clientId) || client.id !== clientId || client.company_id !== companyId
    || client.status !== 'active' || client.revoked_at != null || client.deleted_at != null
    || !/^staff_(users|customers|cases)\.(read|write)$/.test(requiredScope) || !client.scopes?.includes(requiredScope)
    || (client.expires_at !== null && (!Number.isFinite(Date.parse(client.expires_at)) || Date.parse(client.expires_at) <= Date.now()))) return invalid()
  const origin = client.metadata?.staff_onboarding_origin
  if (typeof origin !== 'string' || origin.length > 512 || !client.allowed_origins?.includes(origin)) return invalid()
  let originUrl: URL
  try { originUrl = new URL(origin) } catch { return invalid() }
  if (originUrl.protocol !== 'https:' || originUrl.origin !== origin || originUrl.port || originUrl.username || originUrl.password
    || originUrl.pathname !== '/' || originUrl.search || originUrl.hash || isIP(originUrl.hostname) || !originUrl.hostname.includes('.')
    || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(originUrl.hostname)) return invalid()
  const auth = client.metadata?.staff_tenant_auth
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return invalid()
  const { url, public_key: key } = auth as Record<string, unknown>
  if (typeof url !== 'string' || url.length > 512) return invalid()
  const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(url)
  if (!match) return invalid()
  // Gridex is an ordinary external tenant; its local Auth is never the central OPS Auth.
  let centralOrigin: string
  try { centralOrigin = new URL(SUPABASE_SERVICE_URL).origin } catch { return invalid() }
  if (url === centralOrigin) return invalid()
  return { url, publicKey: publicAuthKey(key, match[1]), projectRef: match[1], authIssuer: `${url}/auth/v1`, origin }
}

/** Public-key tenant SDK performs remote getUser; no session hint confers authority. */
export async function getRegisteredStaffTenantAuthUser(registration: RegisteredStaffTenantAuth, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<StaffTenantAuthIdentity | null> {
  if (!accessToken || accessToken.length > 16_384 || /\s/.test(accessToken)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const client = createClient(registration.url, registration.publicKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetchImpl(input, { ...init, redirect: 'error', signal: controller.signal }) },
    })
    const { data, error } = await client.auth.getUser(accessToken)
    const user = data.user
    // A previously issued bearer does not revive a deleted, banned or anonymous employee.
    if (error || !user || user.deleted_at != null || user.is_anonymous === true) return null
    if (user.banned_until != null) {
      const bannedUntil = lifecycleTimestamp(user.banned_until)
      if (bannedUntil === null || bannedUntil > Date.now()) return null
    }
    return user
  } catch { return null } finally { clearTimeout(timer) }
}
