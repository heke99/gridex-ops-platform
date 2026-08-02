import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { normalizeRoleKey } from '@/lib/rbac/roleKeys'
import { resolveCanonicalCompanyAccessRole } from '@/lib/tenant/companyUserRoles'

export type GrantCompanyUserAccessInput = {
  companyId: string
  userId: string
  email?: string | null
  fullName?: string | null
  membershipRole: string
  roleKey: string
  actorUserId?: string | null
  source: string
  passwordVerified?: boolean
  createdAuthUser?: boolean
  invitationId?: string | null
  idempotencyKey?: string | null
}

type ActiveMembership = {
  id: string
  membership_role?: string | null
  role_key?: string | null
}

type ActiveUserRole = {
  id: string
  role_id?: string | null
  role?: string | null
}

function required(value: string | null | undefined, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${field} saknas.`)
  return normalized
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized || null
}

async function getAuthEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabaseService.auth.admin.getUserById(userId)
  if (error) throw new Error(`Auth-användaren kunde inte läsas: ${error.message}`)
  return normalizeEmail(data.user?.email)
}

async function readActiveMembership(companyId: string, userId: string): Promise<ActiveMembership | null> {
  const { data, error } = await supabaseService
    .from('company_memberships')
    .select('id,membership_role,role_key,status,is_active')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('is_active', true)
    .limit(2)

  if (error) throw error
  if ((data ?? []).length > 1) throw new Error('Flera aktiva bolagskopplingar hittades för samma användare och tenant.')
  return ((data ?? [])[0] as ActiveMembership | undefined) ?? null
}

async function readActiveRole(companyId: string, userId: string, roleKey: string): Promise<ActiveUserRole | null> {
  const { data, error } = await supabaseService
    .from('user_roles')
    .select('id,role_id,role,status,is_active,roles:role_id(id,key,name)')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('is_active', true)
    .limit(10)

  if (error) throw error
  const matching = ((data ?? []) as Array<ActiveUserRole & {
    roles?: { id?: string | null; key?: string | null; name?: string | null } | null
  }>).filter((row) => {
    const resolved = normalizeRoleKey(row.role ?? row.roles?.key ?? row.roles?.name)
    return resolved === roleKey
  })
  if (matching.length > 1) throw new Error('Flera aktiva systemroller med samma canonical roll hittades.')
  return matching[0] ?? null
}

async function verifyAuthIdentity(userId: string, expectedEmail: string | null): Promise<void> {
  const { data, error } = await supabaseService.auth.admin.getUserById(userId)
  if (error || !data.user?.id) throw new Error('Verifiering misslyckades: Auth-användaren finns inte.')
  if (expectedEmail && normalizeEmail(data.user.email) !== expectedEmail) {
    throw new Error('Verifiering misslyckades: Auth-användarens e-post matchar inte accesskommandot.')
  }
}

export async function verifyCompanyUserAccess(input: {
  companyId: string
  userId: string
  email: string | null
  roleKey: string
  membershipRole?: string | null
}) {
  await verifyAuthIdentity(input.userId, input.email)
  const membership = await readActiveMembership(input.companyId, input.userId)
  if (!membership) throw new Error('Verifiering misslyckades: aktiv bolagskoppling saknas.')
  if (input.membershipRole && membership.membership_role !== input.membershipRole) {
    throw new Error('Verifiering misslyckades: membershiprollen matchar inte canonical rollmappning.')
  }
  if (membership.role_key && normalizeRoleKey(membership.role_key) !== input.roleKey) {
    throw new Error('Verifiering misslyckades: membershipens role_key matchar inte systemrollen.')
  }

  const role = await readActiveRole(input.companyId, input.userId, input.roleKey)
  if (!role) throw new Error('Verifiering misslyckades: aktiv canonical systemroll saknas.')
  return { membershipId: membership.id, roleRowId: role.id, roleId: role.role_id ?? null }
}

/**
 * Canonical tenant access command. Membership and system role are changed in
 * the same PostgreSQL transaction; application-side compensating writes are
 * deliberately not used.
 */
export async function grantCompanyUserAccess(input: GrantCompanyUserAccessInput) {
  const companyId = required(input.companyId, 'Bolag')
  const userId = required(input.userId, 'Användare')
  const actorUserId = required(input.actorUserId, 'Aktör')
  const roleKey = normalizeRoleKey(input.roleKey)
  if (!roleKey) throw new Error('Systemrollen saknas.')

  const mapped = resolveCanonicalCompanyAccessRole(roleKey)
  if (mapped.membershipRole !== input.membershipRole) {
    throw new Error('Membershiprollen matchar inte vald canonical systemroll.')
  }

  const email = normalizeEmail(input.email) ?? await getAuthEmail(userId)
  const idempotencyKey = input.idempotencyKey?.trim()
    || `tenant-user-access:${companyId}:${userId}:${roleKey}:${randomUUID()}`

  const { data, error } = await supabaseService.rpc('canonical_change_tenant_user_access', {
    p_command: {
      company_id: companyId,
      user_id: userId,
      actor_user_id: actorUserId,
      action: 'upsert',
      membership_role: mapped.membershipRole,
      role_key: mapped.roleKey,
      reason: input.source,
      idempotency_key: idempotencyKey,
      metadata: {
        account_flow: input.source,
        password_verified: Boolean(input.passwordVerified),
        created_auth_user: Boolean(input.createdAuthUser),
        invitation_id: input.invitationId ?? null,
      },
    },
  })
  if (error) throw error
  if (!data) throw new Error('Canonical tenant access returnerade inget resultat.')

  const verified = await verifyCompanyUserAccess({
    companyId,
    userId,
    email,
    roleKey: mapped.roleKey,
    membershipRole: mapped.membershipRole,
  })
  return { ...verified, invitationId: input.invitationId ?? null }
}

export async function deactivateCompanyUserAccess(input: {
  companyId: string
  userId: string
  actorUserId?: string | null
  reason?: string | null
  idempotencyKey?: string | null
}) {
  const companyId = required(input.companyId, 'Bolag')
  const userId = required(input.userId, 'Användare')
  const actorUserId = required(input.actorUserId, 'Aktör')
  const idempotencyKey = input.idempotencyKey?.trim()
    || `tenant-user-access-remove:${companyId}:${userId}:${randomUUID()}`

  const { data, error } = await supabaseService.rpc('canonical_change_tenant_user_access', {
    p_command: {
      company_id: companyId,
      user_id: userId,
      actor_user_id: actorUserId,
      action: 'remove',
      reason: input.reason ?? 'Användaren togs bort från bolaget.',
      idempotency_key: idempotencyKey,
    },
  })
  if (error) throw error
  if (!data) throw new Error('Canonical tenant access removal returnerade inget resultat.')

  const membership = await readActiveMembership(companyId, userId)
  if (membership) throw new Error('Verifiering misslyckades: medlemskapet är fortfarande aktivt efter borttagning.')
  return data
}

export async function acceptCompanyInvitationAccess(input: {
  companyId: string
  invitationId: string
  userId: string
  email: string
  idempotencyKey?: string | null
}) {
  const companyId = required(input.companyId, 'Bolag')
  const invitationId = required(input.invitationId, 'Inbjudan')
  const userId = required(input.userId, 'Användare')
  const email = normalizeEmail(input.email)
  if (!email) throw new Error('Verifierad e-post saknas.')
  const idempotencyKey = input.idempotencyKey?.trim()
    || `tenant-invitation-accept:${companyId}:${invitationId}:${userId}`

  const { data, error } = await supabaseService.rpc('canonical_accept_tenant_invitation', {
    p_command: {
      company_id: companyId,
      invitation_id: invitationId,
      user_id: userId,
      actor_user_id: userId,
      idempotency_key: idempotencyKey,
    },
  })
  if (error) throw error
  const result = data as { role_key?: string | null; membership_role?: string | null } | null
  if (!result) throw new Error('Canonical invitation acceptance returnerade inget resultat.')

  const roleKey = normalizeRoleKey(result.role_key)
  if (!roleKey) throw new Error('Canonical invitation acceptance saknar systemroll.')
  return verifyCompanyUserAccess({
    companyId,
    userId,
    email,
    roleKey,
    membershipRole: result.membership_role ?? null,
  })
}
