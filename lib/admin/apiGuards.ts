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
}

type ApiGuardResult =
  | { guard: GuardResult; response?: never }
  | { guard?: never; response: NextResponse }

/** Keep operational writes in the company for which permissions were resolved. */
export async function requireAdminOperationalCompany(guard: GuardResult): Promise<string> {
  if (!guard.companyId && !guard.isPlatformAdmin) {
    throw new Error('Bolaget för behörighetskontrollen saknas.')
  }
  return assertUserCanOperateCompany(guard.userId, guard.companyId)
}

/** Allow paused history reads while retaining normal company visibility limits. */
export async function requireAdminReadableCompany(guard: GuardResult): Promise<string> {
  if (guard.isPlatformAdmin) return guard.companyId ?? requireOperationalCompanyId(guard.userId)
  return assertTenantUserCanReadCompany(guard.userId, guard.companyId)
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

  const guard: GuardResult = {
    userId: user.id,
    email: context.user_email ?? user.email ?? null,
    permissions,
    roles,
    isAdmin:
      (permissions.length > 0 || roles.some((role) => role === 'super_admin' || role === 'platform_admin')) &&
      !(roles.length === 1 && roles[0] === 'customer'),
    isPlatformAdmin: Boolean(context.is_platform_admin),
    companyId:
      typeof context.selected_company_id === 'string' && context.selected_company_id
        ? context.selected_company_id
        : null,
  }

  if (!guard.isAdmin) {
    return { response: jsonError('Ej behörig', 403) }
  }

  if (!guard.isPlatformAdmin) {
    const requirement = normalizeRequirement(requiredPermissions)
    if (!hasPermissionRequirement(guard.permissions, requirement)) {
      return { response: jsonError('Saknar behörighet', 403) }
    }
  }

  return { guard }
}
