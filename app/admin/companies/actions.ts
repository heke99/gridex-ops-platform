'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { provisionCompanyInvitation } from '@/lib/auth/companyInvitationFlow'
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

function formatActionError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  try {
    return JSON.stringify(error)
  } catch {
    return fallback
  }
}

function normalizeTemporaryPassword(value: FormDataEntryValue | null): string {
  return normalizeText(value)
}

function validateTemporaryPassword(password: string) {
  if (password.length < 8) {
    throw new Error('Temporärt lösenord måste vara minst 8 tecken.')
  }
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

async function rollbackNewCompanyAfterInviteFailure(companyId: string, reason: string) {
  const { error } = await supabaseService.from('companies').delete().eq('id', companyId)
  if (!error) return

  await supabaseService
    .from('companies')
    .update({
      status: 'deleted_test_only',
      status_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', companyId)
}

export async function createCompanyAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
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
    const initialAdminTemporaryPassword = normalizeTemporaryPassword(formData.get('admin_temporary_password'))

    if (!name) return { ok: false, message: 'Bolagsnamn krävs.' }

    if (initialAdminEmail && !initialAdminTemporaryPassword) {
      return { ok: false, message: 'Ange ett temporärt lösenord för första bolagsansvarig.' }
    }

    if (initialAdminTemporaryPassword) validateTemporaryPassword(initialAdminTemporaryPassword)

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

    let ownerAccountMessage = ''

    if (initialAdminEmail) {
      try {
        const invitation = await provisionCompanyInvitation({
          companyId: company.id,
          companyName: name,
          email: initialAdminEmail,
          fullName: initialAdminName || null,
          membershipRole: 'owner',
          roleKey: 'company_admin',
          actorUserId,
          source: 'admin_companies_create_company_owner',
          issueTemporaryPassword: true,
          temporaryPassword: initialAdminTemporaryPassword,
          sendEmail: false,
        })

        ownerAccountMessage = invitation.wasCreated
          ? ' Bolagsansvarig skapades som nytt konto och kan logga in direkt med det temporära lösenordet.'
          : ' Bolagsansvarig var redan användare och har kopplats till bolaget. Det temporära lösenordet har uppdaterats och måste bytas vid nästa inloggning.'

        await logTenantGovernanceEvent({
          action: 'SUPERADMIN_ROLE_CHANGED',
          actorUserId,
          companyId: company.id,
          targetUserId: invitation.userId,
          reason: 'Första bolagsansvarig skapades med temporärt lösenord och bolagskoppling',
          metadata: { email: initialAdminEmail, membershipRole: 'owner', roleKey: 'company_admin' },
        })
      } catch (inviteError) {
        const inviteMessage = formatActionError(inviteError, 'Bolagsansvarig kunde inte skapas eller kopplas.')
        await rollbackNewCompanyAfterInviteFailure(
          company.id,
          `Bolaget rullades tillbaka eftersom bolagsansvarig inte kunde skapas eller kopplas: ${inviteMessage}`
        )
        revalidatePath('/admin/companies')
        revalidatePath('/admin/users')
        throw new Error(`Bolaget skapades inte eftersom bolagsansvarig inte kunde skapas eller kopplas. ${inviteMessage}`)
      }
    }

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_COMPANY_REACTIVATED',
      actorUserId,
      companyId: company.id,
      reason: 'Bolag skapades',
      metadata: { name, orgNumber },
    })

    revalidatePath('/admin/companies')
    revalidatePath('/admin/users')

    return { ok: true, message: initialAdminEmail ? `Elhandelsbolaget skapades. Bolagsansvarig kan logga in direkt med e-post och temporärt lösenord. Lösenordet måste bytas vid första inloggning.${ownerAccountMessage}` : 'Elhandelsbolaget skapades.' }
  } catch (error) {
    return { ok: false, message: formatActionError(error, 'Bolaget kunde inte skapas.') }
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
    const membershipRole = normalizeText(formData.get('membership_role')) || 'member'
    const roleKey = normalizeText(formData.get('role_key')) || 'company_admin'
    const temporaryPassword = normalizeTemporaryPassword(formData.get('temporary_password'))

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    if (!email) return { ok: false, message: 'E-post saknas.' }
    if (!temporaryPassword) return { ok: false, message: 'Ange ett temporärt lösenord för användaren.' }
    validateTemporaryPassword(temporaryPassword)

    await requireCompanyOperationalForWrites(companyId)

    const company = await getCompanyById(companyId)
    if (!company) return { ok: false, message: 'Bolaget hittades inte.' }

    const invitation = await provisionCompanyInvitation({
      companyId,
      companyName: company.name,
      email,
      fullName,
      membershipRole,
      roleKey,
      actorUserId,
      source: 'admin_companies_invite_user',
      issueTemporaryPassword: true,
      temporaryPassword,
      sendEmail: false,
    })

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_ROLE_CHANGED',
      actorUserId,
      companyId,
      targetUserId: invitation.userId,
      reason: 'Användare skapades/kopplades med temporärt lösenord',
      metadata: { membershipRole, roleKey, email },
    })

    revalidatePath('/admin/companies')
    revalidatePath(`/admin/companies/${companyId}/users`)
    revalidatePath('/admin/users')

    return { ok: true, message: invitation.wasCreated ? 'Användaren skapades och kan logga in direkt med det temporära lösenordet. Lösenordet måste bytas vid första inloggning.' : 'Användaren var redan skapad, har kopplats till bolaget och kan logga in med det temporära lösenordet. Lösenordet måste bytas vid nästa inloggning.' }
  } catch (error) {
    return { ok: false, message: formatActionError(error, 'Inbjudan kunde inte skapas.') }
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


const OPTIONAL_COMPANY_METADATA_TABLES = [
  'company_invitations',
  'company_memberships',
  'tenant_governance_events',
  'auth_email_events',
  'company_access_requests',
  'company_user_invites',
  'company_owner_invites',
  'audit_logs',
]

async function deleteOptionalCompanyRows(table: string, companyId: string) {
  const { error } = await supabaseService.from(table).delete().eq('company_id', companyId)
  if (!error) return

  const code = error.code ?? ''
  const message = error.message ?? ''
  if (['42P01', '42703', 'PGRST205'].includes(code) || /does not exist|schema cache|column .*company_id/i.test(message)) {
    return
  }

  throw error
}

async function markOptionalCompanyRowsDeleted(table: string, companyId: string) {
  const deletedAt = new Date().toISOString()
  const { error } = await supabaseService
    .from(table)
    .update({
      status: 'deleted_test_only',
      deleted_at: deletedAt,
    })
    .eq('company_id', companyId)

  if (!error) return

  const code = error.code ?? ''
  const message = error.message ?? ''
  if (['42P01', '42703', 'PGRST205'].includes(code) || /does not exist|schema cache|column .*company_id|status|deleted_at/i.test(message)) {
    return
  }

  throw error
}

export async function deleteTestCompanyAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['tenants.write'] })
    const actorUserId = await getCurrentUserId()
    const companyId = normalizeText(formData.get('company_id'))
    const reason = normalizeText(formData.get('reason')) || 'Radering av test-/felregistrerat bolag'

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }

    const company = await getCompanyById(companyId)
    if (!company) return { ok: true, message: 'Bolaget var redan raderat.' }

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
        message: `Hård radering nekades. Bolaget har operativ historik: ${blockers
          .map((blocker) => `${blocker.label} (${blocker.count})`)
          .join(', ')}. Arkivera, pausa eller begär kontrollerad radering i stället.`,
      }
    }

    // Log first without making the governance/audit metadata a hard-delete blocker.
    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_COMPANY_DELETED_TEST_ONLY',
      actorUserId,
      companyId,
      reason,
      metadata: { companyName: company.name, deletedAsTestOnly: true },
    })

    // Clean platform metadata and old invite/access rows. These are not business history.
    for (const table of OPTIONAL_COMPANY_METADATA_TABLES) {
      await deleteOptionalCompanyRows(table, companyId)
    }

    const { error } = await supabaseService.from('companies').delete().eq('id', companyId)

    if (error) {
      // Some older installs have FK constraints that are not on-delete cascade/set-null.
      // If the hard delete still fails, mark the tenant as deleted_test_only so it no longer
      // appears as an active operational company, and show a clear message instead of doing nothing.
      if ((error.code ?? '') === '23503' || /foreign key/i.test(error.message ?? '')) {
        for (const table of OPTIONAL_COMPANY_METADATA_TABLES) {
          await markOptionalCompanyRowsDeleted(table, companyId)
        }

        await supabaseService
          .from('companies')
          .update({
            status: 'deleted_test_only',
            status_reason: reason,
            updated_at: new Date().toISOString(),
          })
          .eq('id', companyId)

        revalidatePath('/admin/companies')
        revalidatePath('/admin/controltower')

        return {
          ok: true,
          message:
            'Bolaget markerades som raderat testbolag. Databasen har äldre externa kopplingar som hindrade fysisk delete, men bolaget är nu borttaget ur aktiv driftvy.',
        }
      }

      throw error
    }

    revalidatePath('/admin/companies')
    revalidatePath('/admin/controltower')
    return { ok: true, message: 'Testbolaget raderades och relaterad invite/governance-metadata rensades.' }
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

export async function transferCompanyOpenTasksAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['tenants.write', 'users.write'] })
    const actorUserId = await getCurrentUserId()
    const companyId = normalizeText(formData.get('company_id'))
    const fromUserId = normalizeText(formData.get('from_user_id'))
    const toUserId = normalizeText(formData.get('to_user_id'))
    const reason = normalizeText(formData.get('reason')) || null

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    if (!fromUserId) return { ok: false, message: 'Från-användare saknas.' }
    if (!toUserId) return { ok: false, message: 'Mottagande användare saknas.' }
    if (fromUserId === toUserId) return { ok: false, message: 'Välj en annan mottagare för öppna uppgifter.' }

    await requireCompanyOperationalForWrites(companyId)

    const { data, error } = await supabaseService
      .from('customer_operation_tasks')
      .update({
        assigned_to: toUserId,
        reassigned_at: new Date().toISOString(),
        reassigned_by: actorUserId,
        assignment_reason: reason,
        updated_by: actorUserId,
      })
      .eq('company_id', companyId)
      .eq('assigned_to', fromUserId)
      .in('status', ['open', 'in_progress', 'blocked'])
      .select('id')

    if (error) {
      if (['42P01', 'PGRST205', '42703'].includes(error.code ?? '')) {
        return {
          ok: false,
          message: 'Task-flytt kräver migrationen för assigned_to/reassigned_at på customer_operation_tasks.',
        }
      }
      throw error
    }

    const movedCount = (data ?? []).length

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_OPEN_TASKS_TRANSFERRED',
      actorUserId,
      companyId,
      targetUserId: fromUserId,
      reason,
      metadata: { fromUserId, toUserId, movedCount },
    })

    revalidatePath('/admin/companies')
    revalidatePath(`/admin/companies/${companyId}/users`)
    revalidatePath('/admin/controltower')
    revalidatePath('/admin/operations/tasks')

    return { ok: true, message: `${movedCount} öppna uppgifter flyttades.` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Öppna uppgifter kunde inte flyttas.' }
  }
}

export async function anonymizeCompanyContactDetailsAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['tenants.write'] })
    const actorUserId = await getCurrentUserId()
    const companyId = normalizeText(formData.get('company_id'))
    const reason = normalizeText(formData.get('reason')) || null

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    if (!reason) return { ok: false, message: 'Ange anledning för anonymisering.' }

    const company = await getCompanyById(companyId)
    if (!company) return { ok: false, message: 'Bolaget hittades inte.' }

    const anonymizedAt = new Date().toISOString()
    const { error } = await supabaseService
      .from('companies')
      .update({
        primary_contact_email: null,
        primary_contact_name: 'Anonymiserad kontakt',
        phone: null,
        website: null,
        status_reason: reason,
        updated_at: anonymizedAt,
        metadata: {
          anonymized_contact_details: true,
          anonymized_at: anonymizedAt,
          anonymized_by: actorUserId,
          anonymization_reason: reason,
        },
      })
      .eq('id', companyId)

    if (error) throw error

    await supabaseService
      .from('company_invitations')
      .update({ status: 'invitation_revoked', revoked_at: anonymizedAt })
      .eq('company_id', companyId)
      .eq('status', 'pending')

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_COMPANY_CONTACTS_ANONYMIZED',
      actorUserId,
      companyId,
      reason,
      metadata: {
        companyName: company.name,
        anonymizedFields: ['primary_contact_email', 'primary_contact_name', 'phone', 'website'],
        revokedPendingInvitations: true,
      },
    })

    revalidatePath('/admin/companies')
    revalidatePath(`/admin/companies/${companyId}/users`)
    revalidatePath('/admin/controltower')

    return { ok: true, message: 'Bolagets kontaktuppgifter anonymiserades och öppna inbjudningar återkallades.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Kontaktuppgifter kunde inte anonymiseras.' }
  }
}

