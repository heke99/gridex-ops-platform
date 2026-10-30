import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  hasPermissionRequirement,
  type PermissionRequirement,
} from '@/lib/admin/accessModel'
import { type GuardResult } from '@/lib/admin/guards'
import { ADMIN_SELECTED_COMPANY_COOKIE } from '@/lib/admin/navigationPreferences'
import { normalizeRoleKey, resolveRoleKey } from '@/lib/rbac/roleKeys'
import { assertTenantUserCanReadCompany, assertUserCanOperateCompany, requireOperationalCompanyId } from '@/lib/tenant/scope'

type UserRoleRpcRow = string | {
  role_id?: string | null
  role_key?: string | null
  key?: string | null
  code?: string | null
  name?: string | null
}

type CanonicalTenantContext = {
  authorized?: boolean
  reason_code?: string | null
  user_id?: string | null
  user_email?: string | null
  is_platform_admin?: boolean
  selected_company_id?: string | null
  roles?: unknown[]
  permissions?: unknown[]
  active_permission_keys?: unknown[]
  denied_permissions?: unknown[]
}

type ApiGuardResult =
  | { guard: GuardResult; response?: never }
  | { guard?: never; response: NextResponse }

const API_GUARD_SOURCE = Symbol('admin-api-permission-source')
const apiPermissionContexts = new WeakMap<GuardResult, {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  requirement: PermissionRequirement
}>()

function permissionKeys(context: CanonicalTenantContext, requirement: PermissionRequirement): string[] | null {
  if (!(requirement.anyOf?.length || requirement.allOf?.length)) return []
  const active = context.active_permission_keys
  const denied = context.denied_permissions
  if (!Array.isArray(active) || !Array.isArray(denied) ||
    !active.every((key) => typeof key === 'string') || !denied.every((key) => typeof key === 'string')) return null
  const available = new Set(active)
  const blocked = new Set(denied)
  const granted = context.is_platform_admin === true ? active : (Array.isArray(context.permissions) ? context.permissions : [])
  return granted.filter((key): key is string => typeof key === 'string' && available.has(key) && !blocked.has(key))
}

/** Recheck an API requirement for the actual entity company; page guards retain their policy. */
export async function assertAdminApiCompanyPermissions(guard: Pick<GuardResult, 'userId'>, companyId: string): Promise<void> {
  const source = (guard as GuardResult & { [API_GUARD_SOURCE]?: GuardResult })[API_GUARD_SOURCE]
  if (!source) return
  const state = apiPermissionContexts.get(source)
  if (!state || guard.userId !== source.userId) throw new Error('Kunde inte verifiera behörighet')
  const { data, error } = await state.supabase.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: companyId })
  if (error) throw new Error('Kunde inte verifiera behörighet')
  const context = (data ?? {}) as CanonicalTenantContext
  if (!context.authorized || context.user_id !== guard.userId || context.selected_company_id !== companyId) {
    throw new Error('Ej behörig för valt bolag')
  }
  const current = permissionKeys(context, state.requirement)
  if (current === null) throw new Error('Kunde inte verifiera behörighet')
  if (!hasPermissionRequirement(current, state.requirement)) throw new Error('Saknar behörighet')
}

/** Keep operational writes in the company for which permissions were resolved. */
export async function requireAdminOperationalCompany(guard: GuardResult): Promise<string> {
  if (!guard.companyId && !guard.isPlatformAdmin) {
    throw new Error('Bolaget för behörighetskontrollen saknas.')
  }
  const companyId = await assertUserCanOperateCompany(guard.userId, guard.companyId)
  await assertAdminApiCompanyPermissions(guard, companyId)
  return companyId
}

/** Allow paused history reads while retaining normal company visibility limits. */
export async function requireAdminReadableCompany(guard: GuardResult): Promise<string> {
  const companyId = guard.isPlatformAdmin
    ? guard.companyId ?? await requireOperationalCompanyId(guard.userId)
    : await assertTenantUserCanReadCompany(guard.userId, guard.companyId)
  await assertAdminApiCompanyPermissions(guard, companyId)
  return companyId
}

function roleFromRpcRow(row: UserRoleRpcRow): string | null {
  if (typeof row === 'string') return normalizeRoleKey(row)
  if (!row || typeof row !== 'object') return null
  return resolveRoleKey(row)
}

function normalizeRequirement(
  input: string[] | PermissionRequirement
): PermissionRequirement {
  return Array.isArray(input) ? { anyOf: input } : input
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export function apiErrorResponse(error: unknown, fallbackStatus = 500) {
  const message = error instanceof Error ? error.message : 'Internt serverfel'
  const status =
    /behörighet|forbidden|åtkomst/i.test(message) ? 403 :
    /hittades inte|not found/i.test(message) ? 404 :
    fallbackStatus

  return jsonError(message, status)
}

export async function requireAdminApiAccess(
  requiredPermissions: string[] | PermissionRequirement = [],
  options: { companyId?: string | null } = {},
): Promise<ApiGuardResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { response: jsonError('Ej inloggad', 401) }
  }

  // F-1/F-7: one permission engine. This used to resolve permissions from the
  // company-blind getUserPermissions and re-derive platform-admin status from role
  // names, which is the same defect the page guards had. Both now come from the
  // canonical, company-scoped tenant context.
  const cookieStore = await cookies()
  const requestedCompanyId = options.companyId?.trim() || null
  const selectedCompanyId =
    requestedCompanyId ?? (cookieStore.get(ADMIN_SELECTED_COMPANY_COOKIE)?.value?.trim() || null)

  const { data: contextData, error: contextError } = await supabase.rpc(
    'canonical_authenticated_tenant_context',
    { p_selected_company_id: selectedCompanyId },
  )

  if (contextError) {
    console.warn('[admin-api] Canonical tenant context failed', contextError)
    return { response: jsonError('Kunde inte verifiera behörighet', 503) }
  }

  const context = (contextData ?? {}) as CanonicalTenantContext

  if (!context.authorized || context.user_id !== user.id) {
    return { response: jsonError('Ej behörig', 403) }
  }

  // An explicit target must resolve to that exact company; neither a fallback
  // selection nor permissions from the cookie company authorize its effects.
  if (requestedCompanyId && context.selected_company_id !== requestedCompanyId) {
    return { response: jsonError('Ej behörig för valt bolag', 403) }
  }

  const permissions = (Array.isArray(context.permissions) ? context.permissions : [])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  const roles = (Array.isArray(context.roles) ? context.roles : [])
    .map((row) => roleFromRpcRow(row as UserRoleRpcRow))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  // Same policy as the page guards: the flag counts only as a server-validated
  // boolean, and a customer-only identity is never an admin.
  const isPlatformAdmin = context.is_platform_admin === true
  const guard: GuardResult = {
    userId: user.id,
    email: context.user_email ?? user.email ?? null,
    permissions,
    roles,
    isAdmin:
      (isPlatformAdmin || permissions.length > 0 || roles.some((role) => role === 'super_admin' || role === 'platform_admin')) &&
      !(roles.length === 1 && roles[0] === 'customer'),
    isPlatformAdmin,
    companyId:
      typeof context.selected_company_id === 'string' && context.selected_company_id
        ? context.selected_company_id
        : null,
  }

  if (!guard.isAdmin) {
    return { response: jsonError('Ej behörig', 403) }
  }

  const requirement = normalizeRequirement(requiredPermissions)
  const currentPermissions = permissionKeys(context, requirement)
  if (currentPermissions === null) {
    return { response: jsonError('Kunde inte verifiera behörighet', 503) }
  }
  if (!hasPermissionRequirement(currentPermissions, requirement)) {
    return { response: jsonError('Saknar behörighet', 403) }
  }

  apiPermissionContexts.set(guard, { supabase, requirement })
  // Enumerable symbols survive object spread while staying outside JSON responses.
  Object.defineProperty(guard, API_GUARD_SOURCE, { value: guard, enumerable: true })

  return { guard }
}
