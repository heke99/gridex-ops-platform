import { createClient, type Session, type User } from '@supabase/supabase-js'
import { getSupabasePublicEnv } from '@/lib/env/supabasePublic'
import { normalizeRoleKey, resolveRoleKey } from '@/lib/rbac/roleKeys'
import { StaffApiError } from '@/lib/staff-api/errors'
import { staffRpc, type NativeFactor, type StaffSessionPayload, type StaffSessionRow } from '@/lib/staff-api/sessionStore'

export function nativeStaffClient(accessToken?: string) {
  const { url, anonKey } = getSupabasePublicEnv()
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}) })
}
export function nativeAuthFailure(error: unknown, credentials = false): never {
  const status = (error as { status?: number })?.status
  if (status && status >= 400 && status < 500 && status !== 429) throw new StaffApiError(401, credentials ? 'staff_credentials_invalid' : 'staff_session_invalid', 'Staff authentication is required.')
  if (status === 429) throw new StaffApiError(429, 'staff_auth_rate_limited', 'Too many staff authentication attempts.', true, [], 60)
  throw new StaffApiError(503, 'staff_auth_provider_unavailable', 'Staff authentication provider is unavailable.', true)
}
export function nativeSessionClaims(token: string): { sessionId: string; aal: 'aal1' | 'aal2' } {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.session_id) || !['aal1', 'aal2'].includes(p.aal)) throw new Error()
    return { sessionId: p.session_id, aal: p.aal }
  } catch { throw new StaffApiError(401, 'staff_session_invalid', 'Staff authentication is required.') }
}

export type VerifiedNativeStaff = {
  user: User; sessionId: string; aal: 'aal1' | 'aal2'; payload: StaffSessionPayload
  permissions: string[]; roles: string[]; isPlatformAdmin: boolean
}
export async function verifyNativeStaff(payload: StaffSessionPayload, companyId: string, expected?: Pick<StaffSessionRow, 'user_id' | 'native_session_id'>): Promise<VerifiedNativeStaff> {
  const native = nativeStaffClient(payload.accessToken)
  let user: User
  try {
    const result = await native.auth.getUser(payload.accessToken)
    if (result.error || !result.data.user) nativeAuthFailure(result.error)
    user = result.data.user
  } catch (error) { if (error instanceof StaffApiError) throw error; nativeAuthFailure(error) }
  const claims = nativeSessionClaims(payload.accessToken)
  if (expected && (user.id !== expected.user_id || claims.sessionId !== expected.native_session_id)) throw new StaffApiError(401, 'staff_session_invalid', 'Staff authentication is required.')
  const state = await staffRpc<{ eligible: boolean; reason?: string; password_change_required: boolean; aal: string; factors: NativeFactor[] }>('staff_api_native_account_state', { p_user_id: user.id, p_native_session_id: claims.sessionId })
  if (state?.eligible !== true || state.aal !== claims.aal || !Array.isArray(state.factors)) throw new StaffApiError(401, 'staff_account_ineligible', 'Staff authentication is required.')
  const [allowed, resolved] = await Promise.all([
    native.rpc('gridex_is_current_session_allowed'),
    native.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: companyId }),
  ])
  if (allowed.error || resolved.error) throw new StaffApiError(503, 'staff_authorization_unavailable', 'Staff authorization could not be verified.', true)
  const context = resolved.data as { authorized?: boolean; user_id?: string; selected_company_id?: string; permissions?: unknown[]; roles?: unknown[]; is_platform_admin?: boolean }
  if (allowed.data !== true || context?.authorized !== true || context.user_id !== user.id || context.selected_company_id !== companyId) throw new StaffApiError(401, 'staff_account_ineligible', 'Staff authentication is required.')
  const permissionState = await staffRpc<unknown>('staff_api_current_permissions', { p_user_id: user.id, p_company_id: companyId })
  if (!Array.isArray(permissionState) || !permissionState.every((p) => typeof p === 'string')) throw new StaffApiError(503, 'staff_authorization_unavailable', 'Staff authorization could not be verified.', true)
  const permissions = permissionState as string[]
  const roles = Array.isArray(context.roles) ? context.roles.map((r) => typeof r === 'string' ? normalizeRoleKey(r) : resolveRoleKey(r as Record<string, unknown>)).filter((r): r is string => typeof r === 'string' && !!r) : []
  const isPlatformAdmin = context.is_platform_admin === true && await staffRpc<boolean>('staff_api_is_platform_admin', { p_user_id: user.id }) === true
  if (!isPlatformAdmin && (permissions.length === 0 || !roles.some((r) => r !== 'customer') || await staffRpc<boolean>('staff_api_is_tenant_staff', { p_user_id: user.id, p_company_id: companyId }) !== true)) throw new StaffApiError(401, 'staff_account_ineligible', 'Staff authentication is required.')
  if (state.factors.some((f) => f.method !== 'totp')) throw new StaffApiError(403, 'staff_mfa_method_unsupported', 'This account requires an unsupported MFA method.', false, [{ code: 'staff_mfa_method_unsupported', message: 'Staff API v1 supports native TOTP factors only.', recommended_action: 'Use the native OPS sign-in and configure a supported factor.' }])
  const stage = state.factors.length && claims.aal !== 'aal2' ? 'mfa_required' : state.password_change_required || payload.recovery ? 'password_change_required' : 'authenticated'
  return { user, sessionId: claims.sessionId, aal: claims.aal, payload: { ...payload, stage, factors: state.factors }, permissions, roles, isPlatformAdmin }
}

export async function refreshNativeStaff(payload: StaffSessionPayload, row: StaffSessionRow) {
  const native = nativeStaffClient()
  let session: Session
  try {
    const result = await native.auth.refreshSession({ refresh_token: payload.refreshToken })
    if (result.error || !result.data.session) nativeAuthFailure(result.error)
    session = result.data.session
  } catch (error) { if (error instanceof StaffApiError) throw error; nativeAuthFailure(error) }
  return verifyNativeStaff({ ...payload, accessToken: session.access_token, refreshToken: session.refresh_token }, row.company_id, row)
}
