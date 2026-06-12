'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPlatformAdminContext, requireAdminActionAccess, requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { listOperationalCompaniesForUser } from '@/lib/tenant/scope'
import {
  deactivateCompanyUserAccess,
  grantCompanyUserAccess,
  provisionCompanyUserWithTemporaryPassword,
} from '@/lib/auth/companyUserAccess'
import {
  getCompanyById,
  getCompanyDeleteBlockers,
  logTenantGovernanceEvent,
  normalizeCompanyStatus,
  requireCompanyOperationalForWrites,
  type CompanyOperationalStatus,
  type GovernanceEventAction,
} from '@/lib/tenant/governance'
import { getTenantEmailBranding, queueAndTrySendTenantEmail, renderTenantEmailLayout } from '@/lib/tenant/emailBranding'
import { seedDefaultCompanyEmailConfiguration } from '@/lib/email/bootstrap'
import {
  parseCompanyAssignableMembershipRole,
  parseCompanyAssignableRoleKey,
} from '@/lib/tenant/companyUserRoles'

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


type DbErrorLike = { code?: string | null; message?: string | null }

function missingColumnName(error: DbErrorLike | null | undefined): string | null {
  if (!error || !['42703', 'PGRST204'].includes(error.code ?? '')) return null
  const message = error.message ?? ''
  return (
    message.match(/column\s+"([^"]+)"\s+does not exist/i)?.[1] ??
    message.match(/'([^']+)'\s+column/i)?.[1] ??
    message.match(/column\s+([^\s]+)\s+does not exist/i)?.[1] ??
    null
  )
}

function dropMissingOptionalColumn(payload: Record<string, unknown>, error: DbErrorLike | null | undefined, requiredColumns: string[]) {
  const missing = missingColumnName(error)
  if (!missing || !(missing in payload)) return false
  if (requiredColumns.includes(missing)) {
    throw new Error(`Databasen saknar obligatoriska kolumnen ${missing}. Kör senaste användar-/tenant-migrationen innan åtgärden körs.`)
  }
  delete payload[missing]
  return true
}

async function markCompanyMembershipRemoved(input: {
  companyId: string
  userId: string
  actorUserId: string
  reason: string | null
}) {
  const payload: Record<string, unknown> = {
    status: 'removed_from_company',
    removed_at: new Date().toISOString(),
    removed_by: input.actorUserId,
    status_reason: input.reason,
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { error } = await supabaseService
      .from('company_memberships')
      .update(payload)
      .eq('company_id', input.companyId)
      .eq('user_id', input.userId)

    if (!error) return
    if (dropMissingOptionalColumn(payload, error, ['status'])) continue
    throw error
  }
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


async function assertCanManageCompanyUsers(companyId: string) {
  const context = await requireAdminActionAccess({ anyOf: ['tenants.invite', 'users.write'] })
  if (isPlatformAdminContext(context)) return context

  const memberships = await listOperationalCompaniesForUser(context.userId)
  const membership = memberships.find((row) => row.companyId === companyId)

  if (!membership || !['owner', 'admin', 'company_admin'].includes(membership.membershipRole)) {
    throw new Error('Du kan bara hantera användare i ditt eget elhandelsbolag.')
  }

  return context
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


async function verifyCompanyCreated(companyId: string) {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id,name,slug,status,org_number,primary_contact_email,created_by')
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw new Error(`Bolaget skapades men kunde inte verifieras i databasen: ${errorMessage(error, 'Okänt databasfel')}`)
  if (!data?.id) throw new Error('Bolaget skapades inte korrekt i databasen. Ingen companies-rad kunde verifieras efter insert.')
  return data
}

function escapeEmailHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;')
}

async function trySendTenantInviteEmail(input: {
  companyId: string
  email: string
  fullName?: string | null
  temporaryPassword?: string | null
  actorUserId?: string | null
}) {
  try {
    const branding = await getTenantEmailBranding(input.companyId)
    const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/login`
    const html = renderTenantEmailLayout({
      branding,
      title: `Välkommen till ${branding.displayName}`,
      intro: `Du har fått åtkomst till ${branding.displayName}s administrativa arbetsyta.`,
      body: `
        <p>Använd e-postadressen <strong>${escapeEmailHtml(input.email)}</strong> för att logga in.</p>
        ${input.temporaryPassword ? `<p>Ditt temporära lösenord är:</p><p style="font-size:18px;font-weight:700;background:#f1f5f9;padding:12px;border-radius:12px;">${escapeEmailHtml(input.temporaryPassword)}</p><p>Byt lösenord efter första inloggning.</p>` : ''}
        <p>Kontakta ${branding.supportEmail ?? branding.displayName} om något inte stämmer.</p>
      `,
      ctaLabel: 'Logga in',
      ctaUrl: loginUrl,
    })

    await queueAndTrySendTenantEmail({
      companyId: input.companyId,
      emailType: 'company_invite',
      toEmail: input.email,
      subject: `Din åtkomst till ${branding.displayName}`,
      htmlBody: html,
      textBody: `Du har fått åtkomst till ${branding.displayName}. Logga in: ${loginUrl}${input.temporaryPassword ? `\nTemporärt lösenord: ${input.temporaryPassword}` : ''}`,
      redirectUrl: loginUrl,
      actorUserId: input.actorUserId ?? null,
    })
  } catch (error) {
    console.warn('Tenant invite email could not be sent', error)
  }
}

export async function createCompanyAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  let createdCompanyId: string | null = null

  try {
    await requirePlatformAdminActionAccess()
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
        status: 'onboarding',
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
    await verifyCompanyCreated(createdCompanyId)
    await seedDefaultCompanyEmailConfiguration(createdCompanyId)

    let provisionedProjectRef: string | null = null

    if (initialAdminEmail) {
      const provisionedAdmin = await provisionCompanyUserWithTemporaryPassword({
        companyId: company.id,
        companyName: name,
        email: initialAdminEmail,
        fullName: initialAdminName || null,
        temporaryPassword,
        membershipRole: 'company_admin',
        roleKey: 'company_admin',
        actorUserId,
        source: 'create_company_initial_admin',
      })

      provisionedProjectRef = provisionedAdmin.supabaseProjectRef

      await trySendTenantInviteEmail({
        companyId: company.id,
        email: initialAdminEmail,
        fullName: initialAdminName || null,
        temporaryPassword: provisionedAdmin.createdAuthUser ? temporaryPassword : null,
        actorUserId,
      })
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
        ? `Elhandelsbolaget skapades i databasen och bolagsansvarig skapades/kopplades i Supabase Auth${provisionedProjectRef ? ` (${provisionedProjectRef})` : ''}.`
        : 'Elhandelsbolaget skapades i databasen och verifierades.',
    }
  } catch (error) {
    if (createdCompanyId) {
      await supabaseService
        .from('company_invitations')
        .update({
          status: 'invitation_revoked',
          revoked_at: new Date().toISOString(),
          metadata: { db3_create_company_rollback: true, reason: errorMessage(error, 'Bolaget kunde inte skapas.') },
        })
        .eq('company_id', createdCompanyId)

      await supabaseService
        .from('company_memberships')
        .update({
          status: 'removed_from_company',
          status_reason: 'Bolagsskapande avbröts innan flödet blev komplett.',
          removed_at: new Date().toISOString(),
        })
        .eq('company_id', createdCompanyId)

      await supabaseService
        .from('companies')
        .update({
          status: 'archived',
          is_active: false,
          is_paused: true,
          pause_reason: 'Bolagsskapande avbröts innan flödet blev komplett.',
          metadata: { db3_create_company_rollback: true },
          updated_at: new Date().toISOString(),
        })
        .eq('id', createdCompanyId)
    }

    return { ok: false, message: errorMessage(error, 'Bolaget kunde inte skapas.') }
  }
}

export async function inviteCompanyUserAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  try {
    const actorUserId = await getCurrentUserId()
    const companyId = normalizeText(formData.get('company_id'))
    const email = normalizeEmail(formData.get('email'))
    const fullName = normalizeText(formData.get('full_name')) || null
    const temporaryPassword = normalizeTemporaryPassword(formData.get('temporary_password'))
    const membershipRole = parseCompanyAssignableMembershipRole(normalizeText(formData.get('membership_role')) || 'member')
    const roleKey = parseCompanyAssignableRoleKey(normalizeText(formData.get('role_key')) || 'company_admin')

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    await assertCanManageCompanyUsers(companyId)
    if (!email) return { ok: false, message: 'E-post saknas.' }

    const temporaryPasswordError = assertTemporaryPasswordForUser(email, temporaryPassword)
    if (temporaryPasswordError) return { ok: false, message: temporaryPasswordError }

    await requireCompanyOperationalForWrites(companyId)
    const company = await getCompanyById(companyId)
    if (!company) return { ok: false, message: 'Bolaget hittades inte.' }

    const provisioned = await provisionCompanyUserWithTemporaryPassword({
      companyId,
      companyName: company.name,
      email,
      fullName,
      temporaryPassword,
      membershipRole,
      roleKey,
      actorUserId,
      source: 'company_users_dashboard',
    })

    await trySendTenantInviteEmail({
      companyId,
      email,
      fullName,
      temporaryPassword: provisioned.createdAuthUser ? temporaryPassword : null,
      actorUserId,
    })

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
    revalidatePath('/admin/company-settings')

    return {
      ok: true,
      message: `Användaren skapades/kopplades i Supabase Auth${provisioned.supabaseProjectRef ? ` (${provisioned.supabaseProjectRef})` : ''} och visas nu i bolagets användarlista.`,
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error, 'Användaren kunde inte skapas eller kopplas till bolaget.') }
  }
}

export async function setCompanyOperationalStatusAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  try {
    await requirePlatformAdminActionAccess()
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
    await requirePlatformAdminActionAccess()
    const actorUserId = await getCurrentUserId()
    const companyId = normalizeText(formData.get('company_id'))
    const reason = normalizeText(formData.get('reason')) || 'Arkiverad av superadmin'

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }

    const company = await getCompanyById(companyId)
    if (!company) return { ok: false, message: 'Bolaget hittades inte.' }

    const blockers = await getCompanyDeleteBlockers(companyId)

    await logTenantGovernanceEvent({
      action: blockers.length > 0 ? 'SUPERADMIN_DELETE_BLOCKED_DUE_TO_HISTORY' : 'SUPERADMIN_COMPANY_DELETION_REQUESTED',
      actorUserId,
      companyId,
      reason,
      metadata: { blockers, companyName: company.name, db3HardDeleteDisabled: true },
    })

    await setCompanyStatus({
      companyId,
      status: 'archived',
      actorUserId,
      reason,
    })

    revalidatePath('/admin/companies')
    revalidatePath(`/admin/companies/${companyId}/users`)

    return {
      ok: true,
      message: blockers.length > 0
        ? 'Hård radering är avstängd. Bolaget arkiverades och all historik behölls.'
        : 'Bolaget arkiverades säkert utan att radera historik.',
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Bolaget kunde inte arkiveras.' }
  }
}

export async function removeUserFromCompanyAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  try {
    const actorUserId = await getCurrentUserId()
    const companyId = normalizeText(formData.get('company_id'))
    const userId = normalizeText(formData.get('user_id'))
    const reason = normalizeText(formData.get('reason')) || null

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    await assertCanManageCompanyUsers(companyId)
    if (!userId) return { ok: false, message: 'Användare saknas.' }

    await markCompanyMembershipRemoved({ companyId, userId, actorUserId, reason })
    await deactivateCompanyUserAccess({ companyId, userId, actorUserId, reason })

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
    revalidatePath('/admin/company-settings')

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
    const actorUserId = await getCurrentUserId()
    const companyId = normalizeText(formData.get('company_id'))
    const userId = normalizeText(formData.get('user_id'))
    const membershipRole = parseCompanyAssignableMembershipRole(normalizeText(formData.get('membership_role')) || 'member')
    const roleKey = parseCompanyAssignableRoleKey(normalizeText(formData.get('role_key')) || 'company_admin')

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    await assertCanManageCompanyUsers(companyId)
    if (!userId) return { ok: false, message: 'Användare saknas.' }

    await grantCompanyUserAccess({
      companyId,
      userId,
      membershipRole,
      roleKey,
      actorUserId,
      source: 'company_user_role_update',
    })

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
