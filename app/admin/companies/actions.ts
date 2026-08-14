'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPlatformAdminContext, requireAdminActionAccess, requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { listOperationalCompaniesForUser } from '@/lib/tenant/scope'
import {
  deactivateCompanyUserAccess,
  grantCompanyUserAccess,
} from '@/lib/auth/companyUserAccess'
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
import { canTransitionCompanyStatus } from '@/lib/tenant/lifecycle'
import { seedDefaultCompanyEmailConfiguration } from '@/lib/email/bootstrap'
import { seedCompanyOnboardingTasks } from '@/lib/onboarding/companyReadiness'
import {
  parseCompanyAssignableRoleKey,
  resolveCanonicalCompanyAccessRole,
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
  'closed',
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

function normalizeCustomerNumberPrefix(value: FormDataEntryValue | null): string | null {
  const prefix = normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!prefix) return null
  if (!/^[A-Z0-9]{2,12}$/.test(prefix)) {
    throw new Error('Kundnummerprefix måste vara 2–12 tecken och bara innehålla A–Z eller 0–9.')
  }
  return prefix
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
  if (status === 'closed') return 'SUPERADMIN_COMPANY_CLOSED'
  if (status === 'archived') return 'SUPERADMIN_COMPANY_ARCHIVED'
  return 'SUPERADMIN_COMPANY_DELETION_REQUESTED'
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

type TenantLifecycleTransitionResult = {
  ok?: boolean
  changed?: boolean
  code?: string
  status?: string
  state_version?: number
  blocking_reasons?: Array<{ code?: string; message?: string; task_key?: string }>
}

function tenantLifecycleTransitionAccepted(
  result: TenantLifecycleTransitionResult | null,
  requestedStatus: CompanyOperationalStatus,
): boolean {
  if (!result) return false
  if (result.ok === true || result.changed === true) return true
  if (result.changed === false && result.status === requestedStatus) {
    return !result.code || result.code === 'tenant_lifecycle_unchanged'
  }
  return false
}

async function setCompanyStatus(input: {
  companyId: string
  status: CompanyOperationalStatus
  actorUserId: string
  reason: string | null
}) {
  const { data: observed, error: observedError } = await supabaseService
    .from('companies')
    .select('lifecycle_state_version')
    .eq('id', input.companyId)
    .single()
  if (observedError) throw observedError
  const expectedStateVersion = Number(observed.lifecycle_state_version)
  if (!Number.isSafeInteger(expectedStateVersion) || expectedStateVersion < 0) {
    throw new Error('Bolagets lifecycle-version kunde inte verifieras.')
  }
  const idempotencyKey =
    `tenant-lifecycle:${input.companyId}:${input.status}:v${expectedStateVersion}`

  const { data: transition, error: transitionError } = await supabaseService
    .rpc('canonical_transition_tenant_lifecycle', {
      p_company_id: input.companyId,
      p_target_status: input.status,
      p_expected_state_version: expectedStateVersion,
      p_reason: input.reason,
      p_actor_user_id: input.actorUserId,
      p_idempotency_key: idempotencyKey,
    })
  if (transitionError) throw transitionError
  const result = transition as TenantLifecycleTransitionResult | null
  if (!tenantLifecycleTransitionAccepted(result, input.status)) {
    const blockers = (result?.blocking_reasons ?? [])
      .map((item) => item.message ?? item.code)
      .filter(Boolean)
    const error = new Error(
      blockers.length > 0
        ? `Bolagsåtgärden är blockerad: ${blockers.join(' ')}`
        : `Bolagsåtgärden blockerades (${result?.code ?? 'tenant_lifecycle_conflict'}).`,
    ) as Error & { code?: string; blockingReasons?: typeof blockers }
    error.code = result?.code ?? 'tenant_lifecycle_conflict'
    error.blockingReasons = blockers
    throw error
  }

  const { data, error } = await supabaseService
    .from('companies')
    .select('id,name,status')
    .eq('id', input.companyId)
    .single()
  if (error) throw error
  return data as { id: string; name: string; status: string }
}

function revalidateCompanyLifecycleViews(companyId: string) {
  revalidatePath('/admin/companies')
  revalidatePath(`/admin/companies/${companyId}`)
  revalidatePath(`/admin/companies/${companyId}/users`)
  revalidatePath('/admin/controltower')
  revalidatePath('/admin/ediel/control-tower')
  revalidatePath('/admin/platform/go-live')
  revalidatePath(`/admin/platform/go-live/${companyId}`)
  revalidatePath('/admin/platform/api-clients')
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

export async function createCompanyAction(
  _prevState: CompanyActionState,
  formData: FormData
): Promise<CompanyActionState> {
  let createdCompanyId: string | null = null
  let provisioningActorUserId: string | null = null

  try {
    await requirePlatformAdminActionAccess()
    const actorUserId = await getCurrentUserId()
    provisioningActorUserId = actorUserId

    const name = normalizeText(formData.get('name'))
    const orgNumber = normalizeText(formData.get('org_number')) || null
    const customerNumberPrefix = normalizeCustomerNumberPrefix(formData.get('customer_number_prefix'))
    const primaryContactEmail = normalizeEmail(formData.get('primary_contact_email')) || null
    const primaryContactName = normalizeText(formData.get('primary_contact_name')) || null
    const phone = normalizeText(formData.get('phone')) || null
    const website = normalizeText(formData.get('website')) || null
    const initialAdminEmail = normalizeEmail(formData.get('admin_email'))
    const initialAdminName = normalizeText(formData.get('admin_name')) || primaryContactName

    if (!name) return { ok: false, message: 'Bolagsnamn krävs.' }

    const slug = slugify(normalizeText(formData.get('slug')) || name)
    const idempotencyKey = `tenant-provision:${randomUUID()}`
    const { data: provisionedCompany, error: companyError } = await supabaseService.rpc('canonical_provision_company', {
      p_command: {
        name,
        slug,
        organization_number: orgNumber,
        customer_number_prefix: customerNumberPrefix,
        primary_contact_email: primaryContactEmail,
        primary_contact_name: primaryContactName,
        phone,
        website,
        industry: 'electricity_supplier',
        metadata: {},
        actor_user_id: actorUserId,
        idempotency_key: idempotencyKey,
      },
    })
    if (companyError) throw companyError
    const provisionedResult = provisionedCompany as { company_id?: string | null } | null
    createdCompanyId = provisionedResult?.company_id ?? null
    if (!createdCompanyId) throw new Error('Canonical provisioning returnerade inget company_id.')
    await verifyCompanyCreated(createdCompanyId)
    await seedDefaultCompanyEmailConfiguration(createdCompanyId)
    await seedCompanyOnboardingTasks(createdCompanyId).catch((error) =>
      console.warn('Company onboarding checklist could not be seeded', error),
    )

    if (initialAdminEmail) {
      await provisionCompanyInvitation({
        companyId: createdCompanyId,
        companyName: name,
        email: initialAdminEmail,
        fullName: initialAdminName || null,
        membershipRole: 'company_admin',
        roleKey: 'company_admin',
        actorUserId,
        source: 'create_company_initial_admin',
        sendEmail: true,
      })
    }

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_COMPANY_CREATED',
      actorUserId,
      companyId: createdCompanyId,
      reason: 'Bolag skapades',
      metadata: {
        name,
        orgNumber,
        customerNumberPrefix,
        accountFlow: initialAdminEmail ? 'verified_auth_invitation_link' : 'company_without_initial_admin',
        canonicalProvisioningIdempotencyKey: idempotencyKey,
      },
    })

    revalidateCompanyLifecycleViews(createdCompanyId)
    revalidatePath('/admin/users')

    return {
      ok: true,
      message: initialAdminEmail
        ? 'Elhandelsbolaget skapades via canonical provisioning. Bolagsansvarig får åtkomst först efter verifierad Auth-inbjudan.'
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

      if (!provisioningActorUserId) {
        throw new Error('Canonical provisioning compensation saknar verifierad aktör.')
      }
      await supabaseService.rpc('canonical_transition_tenant_lifecycle', {
        p_company_id: createdCompanyId,
        p_target_status: 'archived',
        p_expected_state_version: null,
        p_reason: 'Bolagsskapande avbröts innan flödet blev komplett.',
        p_actor_user_id: provisioningActorUserId,
        p_idempotency_key: `tenant-provision-compensation:${createdCompanyId}`,
      })
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
    const requestedRoleKey = parseCompanyAssignableRoleKey(
      normalizeText(formData.get('role_key')) || 'company_admin',
    )
    const { membershipRole, roleKey } = resolveCanonicalCompanyAccessRole(requestedRoleKey)

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    await assertCanManageCompanyUsers(companyId)
    if (!email) return { ok: false, message: 'E-post saknas.' }

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
      source: 'company_users_dashboard',
      sendEmail: true,
    })

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_ROLE_CHANGED',
      actorUserId,
      companyId,
      targetUserId: invitation.userId,
      reason: 'Verifierad Auth-inbjudan köades för leased provider delivery',
      metadata: { membershipRole, roleKey, email, accountFlow: 'verified_auth_invitation_link' },
    })

    revalidatePath('/admin/companies')
    revalidatePath(`/admin/companies/${companyId}/users`)
    revalidatePath('/admin/users')
    revalidatePath('/admin/company-settings')

    return {
      ok: true,
      message: 'Inbjudan köades för säker leverans. Åtkomst skapas först när rätt Auth-användare har verifierat och accepterat länken.',
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
    const currentStatus = normalizeCompanyStatus(company.status)
    if (!canTransitionCompanyStatus(currentStatus, nextStatus)) {
      return {
        ok: false,
        message: `Ogiltig lifecycle-övergång: ${currentStatus} → ${nextStatus}. Välj en åtgärd som är tillåten för bolagets nuvarande status.`,
      }
    }

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

    revalidateCompanyLifecycleViews(companyId)

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
    const reason = normalizeText(formData.get('reason')) || 'Radering av test-/felregistrerat bolag'

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }

    const company = await getCompanyById(companyId)
    if (!company) return { ok: false, message: 'Bolaget hittades inte.' }

    const currentStatus = normalizeCompanyStatus(company.status)
    if (currentStatus === 'closed' || currentStatus === 'deleted_test_only') {
      return { ok: false, message: 'Bolaget är redan i ett terminalt lifecycle-läge.' }
    }

    const blockers = await getCompanyDeleteBlockers(companyId)
    if (blockers.length > 0) {
      await logTenantGovernanceEvent({
        action: 'SUPERADMIN_DELETE_BLOCKED_DUE_TO_HISTORY',
        actorUserId,
        companyId,
        reason,
        metadata: { blockers, companyName: company.name, deletionMode: 'test_only_tombstone' },
      })
      return {
        ok: false,
        message: `Testbolaget kan inte raderas eftersom historik finns: ${blockers.map((blocker) => `${blocker.label} ${blocker.count}`).join(' · ')}. Arkivera eller använd ordinarie raderingsflöde i stället.`,
      }
    }

    if (currentStatus !== 'pending_deletion') {
      if (!canTransitionCompanyStatus(currentStatus, 'pending_deletion')) {
        return { ok: false, message: `Bolaget kan inte gå från ${currentStatus} till raderingsläge.` }
      }
      await setCompanyStatus({
        companyId,
        status: 'pending_deletion',
        actorUserId,
        reason,
      })
    }

    await setCompanyStatus({
      companyId,
      status: 'deleted_test_only',
      actorUserId,
      reason,
    })

    await logTenantGovernanceEvent({
      action: 'SUPERADMIN_COMPANY_DELETED_TEST_ONLY',
      actorUserId,
      companyId,
      reason,
      metadata: {
        blockers: [],
        companyName: company.name,
        deletionMode: 'terminal_tombstone',
        hardDeletePerformed: false,
      },
    })

    revalidateCompanyLifecycleViews(companyId)

    return {
      ok: true,
      message: 'Test-/felregistrerat bolag markerades som raderat och togs ur all normal drift. Ingen operativ historik raderades fysiskt.',
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Testbolaget kunde inte raderas säkert.' }
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
    const requestedRoleKey = parseCompanyAssignableRoleKey(
      normalizeText(formData.get('role_key')) || 'company_admin',
    )
    const { membershipRole, roleKey } = resolveCanonicalCompanyAccessRole(requestedRoleKey)

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
