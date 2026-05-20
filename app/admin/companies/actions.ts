'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { provisionDirectTemporaryPasswordUser } from '@/lib/auth/directAccountProvisioning'
import {
  getCompanyById,
  getCompanyDeleteBlockers,
  logTenantGovernanceEvent,
  normalizeCompanyStatus,
  requireCompanyOperationalForWrites,
  type CompanyOperationalStatus,
  type GovernanceEventAction,
} from '@/lib/tenant/governance'

export type CompanyActionState = {
  ok: boolean
  message: string
}

const ACTIVE_COMPANY_STATUSES: CompanyOperationalStatus[] = ['active', 'onboarding']
const GOVERNANCE_COMPANY_STATUSES: CompanyOperationalStatus[] = [
  'active',
  'paused',
  'suspended',
  'archived',
  'pending_deletion',
]

function normalizeText(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim()
}

function normalizeEmail(value: FormDataEntryValue | null): string {
  return normalizeText(value).toLowerCase()
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = record.message ?? record.error_description ?? record.error
    const code = record.code ? ` · kod: ${String(record.code)}` : ''
    if (typeof message === 'string') return `${message}${code}`
  }
  return fallback
}

function normalizeTemporaryPassword(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim()
}

function assertTemporaryPasswordForUser(email: string, password: string): string | null {
  if (!email) return null
  if (!password) return 'Temporärt lösenord krävs när en bolagsansvarig/användare ska skapas.'
  if (password.length < 8) return 'Temporärt lösenord måste vara minst 8 tecken.'
  return null
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
}

async function getCurrentUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Inloggning krävs.')
  return user.id
}

async function resolveRoleIdByKey(roleKey: string): Promise<string> {
  const { data, error } = await supabaseService
    .from('roles')
    .select('id,key')
    .eq('key', roleKey)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) throw new Error(`Rollen hittades inte: ${roleKey}`)
  return data.id as string
}

async function insertActiveUserRole(input: { userId: string; roleId: string }) {
  const first = await supabaseService.from('user_roles').upsert(
    {
      user_id: input.userId,
      role_id: input.roleId,
      status: 'active',
    },
    { onConflict: 'user_id,role_id' }
  )

  if (!first.error) return

  if (first.error.code === '42703' || /status/i.test(first.error.message ?? '')) {
    const second = await supabaseService.from('user_roles').upsert(
      {
        user_id: input.userId,
        role_id: input.roleId,
        is_active: true,
      },
      { onConflict: 'user_id,role_id' }
    )

    if (!second.error) return

    if (second.error.code === '42703' || /is_active/i.test(second.error.message ?? '')) {
      const third = await supabaseService.from('user_roles').upsert(
        {
          user_id: input.userId,
          role_id: input.roleId,
        },
        { onConflict: 'user_id,role_id' }
      )
      if (third.error) throw third.error
      return
    }

    throw second.error
  }

  throw first.error
}

function parseCompanyStatus(value: string): CompanyOperationalStatus {
  const normalized = normalizeCompanyStatus(value)
  if (!GOVERNANCE_COMPANY_STATUSES.includes(normalized)) {
    throw new Error('Ogiltig bolagsstatus.')
  }
  return normalized
}

function governanceActionForStatus(status: CompanyOperationalStatus): GovernanceEventAction {
  if (status === 'active') return 'SUPERADMIN_COMPANY_REACTIVATED'
  if (status === 'paused') return 'SUPERADMIN_COMPANY_PAUSED'
  if (status === 'suspended') return 'SUPERADMIN_COMPANY_SUSPENDED'
  if (status === 'archived') return 'SUPERADMIN_COMPANY_ARCHIVED'
  return 'SUPERADMIN_COMPANY_DELETION_REQUESTED'
}

function statusUpdatePayload(status: CompanyOperationalStatus, actorUserId: string, reason: string | null) {
  const now = new Date().toISOString()
  const base: Record<string, unknown> = {
    status,
    status_reason: reason,
    updated_at: now,
  }

  if (status === 'active') {
    return {
      ...base,
      reactivated_at: now,
      reactivated_by: actorUserId,
      paused_at: null,
      paused_by: null,
      suspended_at: null,
      suspended_by: null,
      archived_at: null,
      archived_by: null,
      deletion_requested_at: null,
      deletion_requested_by: null,
    }
  }

  if (status === 'paused') {
    return { ...base, paused_at: now, paused_by: actorUserId }
  }

  if (status === 'suspended') {
    return { ...base, suspended_at: now, suspended_by: actorUserId }
  }

  if (status === 'archived') {
    return { ...base, archived_at: now, archived_by: actorUserId }
  }

  return { ...base, deletion_requested_at: now, deletion_requested_by: actorUserId }
}

async function setCompanyStatus(input: {
  companyId: string
  status: CompanyOperationalStatus
  actorUserId: string
  reason: string | null
}) {
  const payload = statusUpdatePayload(input.status, input.actorUserId, input.reason)

  const { data, error } = await supabaseService
    .from('companies')
    .update(payload)
    .eq('id', input.companyId)
    .select('id, name, status')
    .single()

  if (error) throw error
  return data as { id: string; name: string; status: string }
}

export async function createCompanyAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  let createdCompanyId: string | null = null

  try {
    await requireAdminActionAccess({ anyOf: ['tenants.write', 'users.write'] })
    const actorUserId = await getCurrentUserId()

    const name = normalizeText(formData.get('name'))
    const orgNumber = normalizeText(formData.get('org_number')) || null
    const primaryContactEmail = normalizeEmail(formData.get('primary_contact_email')) || null
    const primaryContactName = normalizeText(formData.get('primary_contact_name')) || null
    const phone = normalizeText(formData.get('phone')) || null
    const website = normalizeText(formData.get('website')) || null
    const initialAdminEmail = normalizeEmail(formData.get('admin_email'))
    const initialAdminName = normalizeText(formData.get('admin_name')) || primaryContactName
    const temporaryPassword = normalizeTemporaryPassword(formData.get('temporary_password'))

    if (!name) return { ok: false, message: 'Bolagsnamn krävs.' }

    const temporaryPasswordError = assertTemporaryPasswordForUser(initialAdminEmail, temporaryPassword)
    if (temporaryPasswordError) return { ok: false, message: temporaryPasswordError }

    const slug = slugify(normalizeText(formData.get('slug')) || name)

    const { data: company, error: companyError } = await supabaseService
      .from('companies')
      .insert({
        name,
        slug,
        org_number: orgNumber,
        status: 'active',
        primary_contact_email: primaryContactEmail,
        primary_contact_name: primaryContactName,
        phone,
        website,
        industry: 'electricity_supplier',
        metadata: {},
        created_by: actorUserId,
      })
      .select('*')
      .single()

    if (companyError) throw companyError
    createdCompanyId = company.id as string

    if (initialAdminEmail) {
      const provisioned = await provisionDirectTemporaryPasswordUser({
        email: initialAdminEmail,
        fullName: initialAdminName || null,
        temporaryPassword,
        companyId: company.id,
        companyName: name,
        actorUserId,
      })

      const roleId = await resolveRoleIdByKey('company_admin')
      await insertActiveUserRole({ userId: provisioned.userId, roleId })

      const now = new Date().toISOString()
      const { error: membershipError } = await supabaseService.from('company_memberships').upsert(
        {
          company_id: company.id,
          user_id: provisioned.userId,
          membership_role: 'owner',
          status: 'active',
          invited_email: initialAdminEmail,
          invited_by: actorUserId,
          invited_at: now,
          accepted_at: now,
          disabled_at: null,
          disabled_by: null,
          removed_at: null,
          removed_by: null,
          status_reason: null,
          metadata: {
            account_flow: 'direct_temporary_password',
            password_verified: provisioned.passwordVerified,
            created_auth_user: provisioned.createdAuthUser,
          },
        },
        { onConflict: 'company_id,user_id' }
      )

      if (membershipError) throw membershipError

      const inviteInsert = await supabaseService.from('company_invitations').insert({
        company_id: company.id,
        email: initialAdminEmail,
        full_name: initialAdminName || null,
        membership_role: 'owner',
        role_key: 'company_admin',
        status: 'accepted',
        invited_by: actorUserId,
        invited_user_id: provisioned.userId,
        expires_at: null,
        accepted_at: now,
        metadata: {
          account_flow: 'direct_temporary_password',
          password_verified: provisioned.passwordVerified,
        },
      })

      if (inviteInsert.error && !['42P01', 'PGRST205'].includes(inviteInsert.error.code ?? '')) {
        throw inviteInsert.error
      }
    }

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_COMPANY_REACTIVATED',
      actorUserId,
      companyId: company.id,
      reason: 'Bolag skapades',
      metadata: {
        name,
        orgNumber,
        accountFlow: initialAdminEmail ? 'direct_temporary_password' : 'company_without_initial_admin',
      },
    })

    revalidatePath('/admin/companies')
    revalidatePath('/admin/users')

    return {
      ok: true,
      message: initialAdminEmail
        ? 'Elhandelsbolaget skapades och bolagsansvarig kan logga in med det temporära lösenordet.'
        : 'Elhandelsbolaget skapades.',
    }
  } catch (error) {
    if (createdCompanyId) {
      await supabaseService.from('company_invitations').delete().eq('company_id', createdCompanyId)
      await supabaseService.from('company_memberships').delete().eq('company_id', createdCompanyId)
      await supabaseService.from('companies').delete().eq('id', createdCompanyId)
    }

    return { ok: false, message: errorMessage(error, 'Bolaget kunde inte skapas.') }
  }
}

export async function inviteCompanyUserAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['tenants.invite', 'users.write'] })
    const actorUserId = await getCurrentUserId()
    const companyId = normalizeText(formData.get('company_id'))
    const email = normalizeEmail(formData.get('email'))
    const fullName = normalizeText(formData.get('full_name')) || null
    const temporaryPassword = normalizeTemporaryPassword(formData.get('temporary_password'))
    const membershipRole = normalizeText(formData.get('membership_role')) || 'member'
    const roleKey = normalizeText(formData.get('role_key')) || 'company_admin'

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    if (!email) return { ok: false, message: 'E-post saknas.' }

    const temporaryPasswordError = assertTemporaryPasswordForUser(email, temporaryPassword)
    if (temporaryPasswordError) return { ok: false, message: temporaryPasswordError }

    await requireCompanyOperationalForWrites(companyId)
    const company = await getCompanyById(companyId)
    if (!company) return { ok: false, message: 'Bolaget hittades inte.' }

    const provisioned = await provisionDirectTemporaryPasswordUser({
      email,
      fullName,
      temporaryPassword,
      companyId,
      companyName: company.name,
      actorUserId,
    })

    await insertActiveUserRole({ userId: provisioned.userId, roleId: await resolveRoleIdByKey(roleKey) })

    const now = new Date().toISOString()
    const { error: membershipError } = await supabaseService.from('company_memberships').upsert(
      {
        company_id: companyId,
        user_id: provisioned.userId,
        membership_role: membershipRole,
        status: 'active',
        invited_email: email,
        invited_by: actorUserId,
        invited_at: now,
        accepted_at: now,
        disabled_at: null,
        disabled_by: null,
        removed_at: null,
        removed_by: null,
        status_reason: null,
        metadata: {
          account_flow: 'direct_temporary_password',
          password_verified: provisioned.passwordVerified,
          created_auth_user: provisioned.createdAuthUser,
        },
      },
      { onConflict: 'company_id,user_id' }
    )

    if (membershipError) throw membershipError

    const inviteInsert = await supabaseService.from('company_invitations').insert({
      company_id: companyId,
      email,
      full_name: fullName,
      membership_role: membershipRole,
      role_key: roleKey,
      status: 'accepted',
      invited_by: actorUserId,
      invited_user_id: provisioned.userId,
      expires_at: null,
      accepted_at: now,
      metadata: {
        account_flow: 'direct_temporary_password',
        password_verified: provisioned.passwordVerified,
      },
    })

    if (inviteInsert.error && !['42P01', 'PGRST205'].includes(inviteInsert.error.code ?? '')) {
      throw inviteInsert.error
    }

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_ROLE_CHANGED',
      actorUserId,
      companyId,
      targetUserId: provisioned.userId,
      reason: 'Användare skapades/kopplades med temporärt lösenord',
      metadata: { membershipRole, roleKey, email, accountFlow: 'direct_temporary_password' },
    })

    revalidatePath('/admin/companies')
    revalidatePath(`/admin/companies/${companyId}/users`)
    revalidatePath('/admin/users')

    return { ok: true, message: 'Användaren skapades/kopplades och kan logga in med det temporära lösenordet.' }
  } catch (error) {
    return { ok: false, message: errorMessage(error, 'Användaren kunde inte skapas eller kopplas till bolaget.') }
  }
}

export async function setCompanyOperationalStatusAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['tenants.write'] })
    const actorUserId = await getCurrentUserId()
    const companyId = normalizeText(formData.get('company_id'))
    const nextStatus = parseCompanyStatus(normalizeText(formData.get('next_status')))
    const reason = normalizeText(formData.get('reason')) || null

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    if (!ACTIVE_COMPANY_STATUSES.includes(nextStatus) && !reason) {
      return { ok: false, message: 'Ange anledning för styrningsåtgärden.' }
    }

    const company = await getCompanyById(companyId)
    if (!company) return { ok: false, message: 'Bolaget hittades inte.' }

    const updated = await setCompanyStatus({ companyId, status: nextStatus, actorUserId, reason })

    await logTenantGovernanceEvent({
      action: governanceActionForStatus(nextStatus),
      actorUserId,
      companyId,
      reason,
      metadata: {
        previousStatus: company.status,
        nextStatus: updated.status,
        companyName: company.name,
      },
    })

    revalidatePath('/admin/companies')
    revalidatePath(`/admin/companies/${companyId}/users`)
    revalidatePath('/admin/controltower')
    revalidatePath('/admin/ediel/control-tower')

    return { ok: true, message: `${updated.name} uppdaterades till ${nextStatus}.` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Bolagsstatus kunde inte uppdateras.' }
  }
}

export async function requestCompanyDeletionAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  const cloned = new FormData()
  cloned.set('company_id', normalizeText(formData.get('company_id')))
  cloned.set('next_status', 'pending_deletion')
  cloned.set('reason', normalizeText(formData.get('reason')) || 'Radering begärd av superadmin')
  return setCompanyOperationalStatusAction(_prevState, cloned)
}

export async function deleteTestCompanyAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['tenants.write'] })
    const actorUserId = await getCurrentUserId()
    const companyId = normalizeText(formData.get('company_id'))
    const reason = normalizeText(formData.get('reason')) || null

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }

    const company = await getCompanyById(companyId)
    if (!company) return { ok: false, message: 'Bolaget hittades inte.' }

    const blockers = await getCompanyDeleteBlockers(companyId)
    if (blockers.length > 0) {
      await logTenantGovernanceEvent({
        action: 'SUPERADMIN_DELETE_BLOCKED_DUE_TO_HISTORY',
        actorUserId,
        companyId,
        reason,
        metadata: { blockers, companyName: company.name },
      })

      return {
        ok: false,
        message: `Hård radering nekades. Bolaget har historik: ${blockers
          .map((blocker) => `${blocker.label} (${blocker.count})`)
          .join(', ')}. Arkivera eller pausa bolaget i stället.`,
      }
    }

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_COMPANY_DELETED_TEST_ONLY',
      actorUserId,
      companyId,
      reason,
      metadata: { companyName: company.name },
    })

    await supabaseService.from('company_invitations').delete().eq('company_id', companyId)
    await supabaseService.from('company_memberships').delete().eq('company_id', companyId)

    const { error } = await supabaseService.from('companies').delete().eq('id', companyId)
    if (error) throw error

    revalidatePath('/admin/companies')
    return { ok: true, message: 'Testbolaget raderades eftersom det saknade historik.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Bolaget kunde inte raderas.' }
  }
}

export async function removeUserFromCompanyAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['tenants.write', 'users.write'] })
    const actorUserId = await getCurrentUserId()
    const companyId = normalizeText(formData.get('company_id'))
    const userId = normalizeText(formData.get('user_id'))
    const reason = normalizeText(formData.get('reason')) || null

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    if (!userId) return { ok: false, message: 'Användare saknas.' }

    const { error } = await supabaseService
      .from('company_memberships')
      .update({
        status: 'removed_from_company',
        removed_at: new Date().toISOString(),
        removed_by: actorUserId,
        status_reason: reason,
      })
      .eq('company_id', companyId)
      .eq('user_id', userId)

    if (error) throw error

    await supabaseService
      .from('company_invitations')
      .update({ status: 'invitation_revoked', revoked_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('invited_user_id', userId)
      .eq('status', 'pending')

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_USER_REMOVED_FROM_COMPANY',
      actorUserId,
      companyId,
      targetUserId: userId,
      reason,
    })

    revalidatePath('/admin/companies')
    revalidatePath(`/admin/companies/${companyId}/users`)
    revalidatePath('/admin/users')

    return { ok: true, message: 'Användaren togs bort från bolaget utan att historik raderades.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Användaren kunde inte tas bort från bolaget.' }
  }
}

export async function setCompanyUserRoleAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['tenants.write', 'users.write'] })
    const actorUserId = await getCurrentUserId()
    const companyId = normalizeText(formData.get('company_id'))
    const userId = normalizeText(formData.get('user_id'))
    const membershipRole = normalizeText(formData.get('membership_role')) || 'member'
    const roleKey = normalizeText(formData.get('role_key')) || 'company_admin'

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    if (!userId) return { ok: false, message: 'Användare saknas.' }

    const { error } = await supabaseService
      .from('company_memberships')
      .update({ membership_role: membershipRole, status: 'active', status_reason: null })
      .eq('company_id', companyId)
      .eq('user_id', userId)

    if (error) throw error

    await insertActiveUserRole({ userId, roleId: await resolveRoleIdByKey(roleKey) })

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_ROLE_CHANGED',
      actorUserId,
      companyId,
      targetUserId: userId,
      reason: 'Bolagsroll ändrades av superadmin',
      metadata: { membershipRole, roleKey },
    })

    revalidatePath('/admin/users')
    revalidatePath(`/admin/companies/${companyId}/users`)

    return { ok: true, message: 'Användarens bolagsroll uppdaterades.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Bolagsrollen kunde inte uppdateras.' }
  }
}
