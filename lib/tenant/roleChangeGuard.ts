import { supabaseService } from '@/lib/supabase/service'

export const COMPANY_ADMIN_MEMBERSHIP_ROLES = ['owner', 'admin', 'company_admin'] as const

export function isCompanyAdminMembershipRole(role: string | null | undefined): boolean {
  return (COMPANY_ADMIN_MEMBERSHIP_ROLES as readonly string[]).includes(role ?? '')
}

/**
 * Rules for changing a member's company role:
 * - tenant users cannot change their own role (no self-escalation or lock-out);
 * - the last active company administrator cannot be demoted.
 * Platform admins may change their own company role but the last-admin rule
 * still applies so a tenant is never left without an administrator.
 */
export function evaluateCompanyRoleChange(input: {
  actorUserId: string
  actorIsPlatformAdmin: boolean
  targetUserId: string
  currentMembershipRole: string | null
  nextMembershipRole: string
  otherActiveAdminCount: number
}): string | null {
  if (!input.actorIsPlatformAdmin && input.actorUserId === input.targetUserId) {
    return 'Du kan inte ändra din egen roll. Be en annan administratör eller Gridex support.'
  }
  const demotesAdmin =
    isCompanyAdminMembershipRole(input.currentMembershipRole) &&
    !isCompanyAdminMembershipRole(input.nextMembershipRole)
  if (demotesAdmin && input.otherActiveAdminCount === 0) {
    return 'Bolaget måste ha minst en aktiv administratör. Utse en ny administratör först.'
  }
  return null
}

export async function assertCompanyRoleChangeAllowed(input: {
  companyId: string
  actorUserId: string
  actorIsPlatformAdmin: boolean
  targetUserId: string
  nextMembershipRole: string
}): Promise<void> {
  const { data, error } = await supabaseService
    .from('company_memberships')
    .select('user_id, membership_role')
    .eq('company_id', input.companyId)
    .eq('status', 'active')
    .eq('is_active', true)
  if (error) throw error
  const rows = (data ?? []) as Array<{ user_id: string; membership_role: string | null }>
  const target = rows.find((row) => row.user_id === input.targetUserId)
  const otherActiveAdminCount = rows.filter(
    (row) => row.user_id !== input.targetUserId && isCompanyAdminMembershipRole(row.membership_role),
  ).length
  const blocked = evaluateCompanyRoleChange({
    actorUserId: input.actorUserId,
    actorIsPlatformAdmin: input.actorIsPlatformAdmin,
    targetUserId: input.targetUserId,
    currentMembershipRole: target?.membership_role ?? null,
    nextMembershipRole: input.nextMembershipRole,
    otherActiveAdminCount,
  })
  if (blocked) throw new Error(blocked)
}
