import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiInputError } from '@/lib/api/strictRequest'
import { getRoleProfilePermissions } from '@/lib/admin/accessModel'
import { provisionCompanyInvitation } from '@/lib/auth/companyInvitationFlow'
import { supabaseService } from '@/lib/supabase/service'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { COMPANY_USER_ROLE_OPTIONS, resolveCanonicalCompanyAccessRole } from '@/lib/tenant/companyUserRoles'
import { logTenantGovernanceEvent, requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { assertCompanyRoleChangeAllowed } from '@/lib/tenant/roleChangeGuard'

/** Explicit actor supplied by a trusted OPS or staff-API adapter; no session fallback. */
export type StaffCommandContext = {
  companyId: string
  actorUserId: string
  permissions: readonly string[]
  apiClientId?: string | null
  channel: 'ops' | 'staff_api'
  actorIsPlatformAdmin?: boolean
}

export class StaffCommandError extends ApiInputError {
  constructor(code: string, status: number, message: string) {
    super(message, code, status)
    this.name = 'StaffCommandError'
  }
}

export type StaffUser = {
  user_id: string
  email: string | null
  full_name: string | null
  role_key: string
  membership_role: string
  status: string
  invited_at: string | null
  accepted_at: string | null
  disabled_at: string | null
}
export type StaffMutationResult = Pick<StaffUser, 'user_id' | 'role_key' | 'membership_role' | 'status'>

function requirePermission(context: StaffCommandContext, permission: string) {
  if (!context.companyId || !context.actorUserId || (context.channel === 'staff_api' && !context.apiClientId)) {
    throw new StaffCommandError('staff_permission_denied', 403, 'Verifierad personalidentitet krävs.')
  }
  if (!context.permissions.includes(permission)) {
    throw new StaffCommandError('staff_permission_denied', 403, 'Du saknar behörighet för personaladministration.')
  }
}

function roleWithinCeiling(context: StaffCommandContext, roleKey: string): boolean {
  const current = new Set(context.permissions)
  return getRoleProfilePermissions(roleKey).every(permission => current.has(permission))
}

function requireAssignableRole(context: StaffCommandContext, requestedRoleKey: string) {
  let role: ReturnType<typeof resolveCanonicalCompanyAccessRole>
  try {
    role = resolveCanonicalCompanyAccessRole(requestedRoleKey)
  } catch {
    throw new StaffCommandError('staff_role_not_assignable', 422, 'Rollen kan inte tilldelas personal i bolaget.')
  }
  if (!roleWithinCeiling(context, role.roleKey)) {
    throw new StaffCommandError('staff_role_ceiling_exceeded', 403, 'Du kan inte ge fler rättigheter än du själv har.')
  }
  return role
}

/** OPS adapters validate before unrelated Auth/profile edits; native guard rechecks under lock. */
export function validateStaffRoleAssignment(context: StaffCommandContext, roleKey: string) {
  requirePermission(context, 'users.write')
  return requireAssignableRole(context, roleKey)
}

function normalizeUserId(value: string): string {
  const parsed = z.string().uuid().safeParse(value)
  if (!parsed.success) throw new StaffCommandError('staff_user_not_found', 404, 'Personal hittades inte.')
  return parsed.data
}

function commandError(error: unknown): Error {
  const record = error as { message?: string } | null
  let code = record?.message ?? ''
  if (code === 'Bolaget måste ha minst en aktiv administratör. Utse en ny administratör först.') code = 'staff_last_admin_required'
  if (code === 'Du kan inte ändra din egen roll. Be en annan administratör eller Gridex support.') code = 'staff_self_role_change_forbidden'
  if (code.includes('ny drift är blockerad för bolaget.')) code = 'staff_company_not_operational'
  const statuses: Record<string, number> = {
    staff_permission_denied: 403, staff_role_ceiling_exceeded: 403,
    staff_self_disable_forbidden: 409, staff_last_admin_required: 409,
    staff_user_not_found: 404, staff_invalid_user_state: 409,
    staff_role_not_assignable: 422, staff_self_role_change_forbidden: 409, staff_company_not_operational: 409,
    last_active_admin_cannot_be_removed_or_downgraded: 409,
    last_functioning_admin_cannot_be_removed_or_downgraded: 409,
    last_active_owner_cannot_be_removed_or_downgraded: 409,
    last_functioning_owner_cannot_be_removed_or_downgraded: 409,
  }
  if (code in statuses) {
    const normalized = code.startsWith('last_') ? 'staff_last_admin_required' : code
    return new StaffCommandError(normalized, statuses[code], 'Personaländringen nekades av bolagets behörighets- eller administratörsregler.')
  }
  return error instanceof Error ? error : new Error('Personaländringen kunde inte genomföras.')
}

export function listStaffRoles(context: StaffCommandContext) {
  requirePermission(context, 'users.read')
  return { data: COMPANY_USER_ROLE_OPTIONS.map(role => ({
    key: role.value, label: role.label, description: role.description,
    permissions: getRoleProfilePermissions(role.value),
    assignable: context.permissions.includes('users.write') && roleWithinCeiling(context, role.value),
  })) }
}

export async function inviteStaff(context: StaffCommandContext, input: {
  email: string; fullName?: string | null; roleKey: string; idempotencyKey?: string
}) {
  requirePermission(context, 'users.write')
  const role = requireAssignableRole(context, input.roleKey)
  const email = input.email.trim().toLowerCase()
  if (!z.string().email().max(320).safeParse(email).success) {
    throw new StaffCommandError('staff_invalid_email', 422, 'Ange en giltig e-postadress.')
  }
  try {
    const company = await requireCompanyOperationalForWrites(context.companyId)
    const invitation = await provisionCompanyInvitation({
      companyId: context.companyId, companyName: company.name, email,
      fullName: input.fullName?.trim() || null,
      membershipRole: role.membershipRole, roleKey: role.roleKey,
      actorUserId: context.actorUserId, source: 'staff_commands', sendEmail: true,
      idempotencyKey: input.idempotencyKey, staffOperation: 'invite',
      channel: context.channel, apiClientId: context.apiClientId ?? null,
    })
    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_ROLE_CHANGED', actorUserId: context.actorUserId,
      companyId: context.companyId, targetUserId: invitation.userId,
      reason: 'Verifierad Auth-inbjudan köades för leverans.',
      metadata: { ...role, channel: context.channel, api_client_id: context.apiClientId ?? null, staff_operation: 'invite' },
    })
  } catch (error) { throw commandError(error) }
  return { email, role_key: role.roleKey, membership_role: role.membershipRole, status: 'pending' as const }
}

async function changeAccess(context: StaffCommandContext, input: {
  userId: string; operation: 'change_role' | 'disable' | 'enable';
  roleKey?: string; reason?: string | null; idempotencyKey?: string
}): Promise<StaffMutationResult> {
  requirePermission(context, 'users.write')
  const userId = normalizeUserId(input.userId)
  if (input.operation === 'disable' && userId === context.actorUserId) {
    throw new StaffCommandError('staff_self_disable_forbidden', 409, 'Du kan inte stänga av dig själv.')
  }
  const role = input.operation === 'change_role' ? requireAssignableRole(context, input.roleKey ?? '') : null
  if (role && userId === context.actorUserId && !(context.channel === 'ops' && context.actorIsPlatformAdmin)) {
    throw new StaffCommandError('staff_self_role_change_forbidden', 409, 'Du kan inte ändra din egen roll.')
  }
  try {
    if (role) {
      await assertCompanyRoleChangeAllowed({
        companyId: context.companyId, actorUserId: context.actorUserId,
        actorIsPlatformAdmin: context.channel === 'ops' && Boolean(context.actorIsPlatformAdmin),
        targetUserId: userId, nextMembershipRole: role.membershipRole,
      })
    }
    const { data, error } = await supabaseService.rpc('canonical_change_tenant_user_access', {
      p_command: {
        company_id: context.companyId, actor_user_id: context.actorUserId, user_id: userId,
        action: input.operation === 'disable' ? 'disable' : 'upsert',
        ...(role ? { role_key: role.roleKey, membership_role: role.membershipRole } : {}),
        staff_operation: input.operation, channel: context.channel,
        api_client_id: context.apiClientId ?? null,
        reason: input.reason?.trim() || `staff_${input.operation}`,
        idempotency_key: input.idempotencyKey || `staff:${context.companyId}:${userId}:${randomUUID()}`,
      },
    })
    if (error) throw error
    const result = data as Record<string, unknown> | null
    if (!result?.user_id || !result.role_key || !result.membership_role || !result.status) {
      throw new Error('Personaländringen saknar ett verifierat resultat.')
    }
    await logTenantGovernanceEvent({
      action: input.operation === 'disable' ? 'SUPERADMIN_USER_REMOVED_FROM_COMPANY' : 'SUPERADMIN_ROLE_CHANGED',
      actorUserId: context.actorUserId, companyId: context.companyId, targetUserId: userId,
      reason: input.reason ?? null,
      metadata: { channel: context.channel, api_client_id: context.apiClientId ?? null, staff_operation: input.operation },
    })
    return { user_id: String(result.user_id), role_key: String(result.role_key), membership_role: String(result.membership_role), status: String(result.status) }
  } catch (error) { throw commandError(error) }
}

export async function changeStaffRole(context: StaffCommandContext, input: { userId: string; roleKey: string; idempotencyKey?: string }) {
  return changeAccess(context, { ...input, operation: 'change_role' })
}
export async function disableStaff(context: StaffCommandContext, input: { userId: string; reason?: string | null; idempotencyKey?: string }) {
  return changeAccess(context, { ...input, operation: 'disable' })
}
export async function reactivateStaff(context: StaffCommandContext, input: { userId: string; idempotencyKey?: string }) {
  return changeAccess(context, { ...input, operation: 'enable' })
}

export async function listStaff(context: StaffCommandContext, input: { page?: number; pageSize?: number; status?: string } = {}) {
  requirePermission(context, 'users.read')
  const page = Math.max(1, Math.trunc(input.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 25)))
  let query = tenantSelect(context.companyId, 'company_memberships',
    'user_id,role_key,membership_role,status,invited_email,invited_at,accepted_at,disabled_at', { count: 'exact' })
  if (input.status) query = query.eq('status', input.status)
  const { data, error, count } = await query.order('created_at', { ascending: false }).order('id').range((page - 1) * pageSize, page * pageSize - 1)
  if (error) throw error
  const memberships = (data ?? []) as unknown as Array<{
    user_id: string; role_key: string | null; membership_role: string | null; status: string;
    invited_email: string | null; invited_at: string | null; accepted_at: string | null; disabled_at: string | null
  }>
  const userIds = memberships.map(row => row.user_id)
  const profiles = new Map<string, { email: string | null; full_name: string | null }>()
  if (userIds.length) {
    const { data: profileRows, error: profileError } = await tenantDb(context.companyId).unscoped().from('user_profiles').select('id,email,full_name').in('id', userIds)
    if (profileError) throw profileError
    for (const profile of profileRows ?? []) profiles.set(profile.id, profile)
  }
  return {
    data: memberships.map(row => ({
      user_id: row.user_id, email: profiles.get(row.user_id)?.email ?? row.invited_email ?? null,
      full_name: profiles.get(row.user_id)?.full_name ?? null,
      role_key: row.role_key ?? '', membership_role: row.membership_role ?? '', status: row.status,
      invited_at: row.invited_at ?? null, accepted_at: row.accepted_at ?? null, disabled_at: row.disabled_at ?? null,
    })),
    pagination: { page, page_size: pageSize, total: count ?? 0, has_more: page * pageSize < (count ?? 0) },
  }
}
