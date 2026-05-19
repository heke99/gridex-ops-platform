'use server'

import { revalidatePath } from 'next/cache'
import { supabaseService } from '@/lib/supabase/service'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { COMPANY_USER_ROLE_OPTIONS, canInviteIntoCompany, userIsPlatformAdmin } from '@/lib/tenant/companies'

type ActionState = {
  ok: boolean
  message: string
}

function normalizeText(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function normalizeEmail(value: FormDataEntryValue | null) {
  return normalizeText(value).toLowerCase()
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function getBaseAppUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    'http://localhost:3000'
  )
}

function assertAllowedRole(roleKey: string) {
  const allowed = new Set(COMPANY_USER_ROLE_OPTIONS.map((role) => role.value))
  if (!allowed.has(roleKey)) {
    throw new Error('Rollen kan inte tilldelas via bolagsinbjudan.')
  }
}

async function resolveRoleIdByKey(roleKey: string) {
  const { data, error } = await supabaseService
    .from('roles')
    .select('id,key')
    .eq('key', roleKey)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) {
    throw new Error(`Rollen saknas i databasen: ${roleKey}`)
  }

  return data.id as string
}

async function resolveUserByEmail(email: string) {
  const { data, error } = await supabaseService.auth.admin.listUsers()
  if (error) throw error

  return (data.users ?? []).find(
    (user) => (user.email ?? '').trim().toLowerCase() === email
  )
}

async function inviteOrLoadUser(input: {
  email: string
  fullName: string | null
  companyId: string
}) {
  const redirectTo = `${getBaseAppUrl()}/login`

  const { data, error } = await supabaseService.auth.admin.inviteUserByEmail(input.email, {
    redirectTo,
    data: {
      full_name: input.fullName ?? undefined,
      company_id: input.companyId,
    },
  })

  if (!error && data.user?.id) return data.user

  const existingUser = await resolveUserByEmail(input.email)
  if (existingUser?.id) return existingUser

  if (error) throw error
  throw new Error('Kunde inte skapa eller hitta användaren.')
}

async function upsertUserProfile(input: {
  userId: string
  email: string
  fullName: string | null
  companyId: string | null
}) {
  const { error } = await supabaseService.from('user_profiles').upsert(
    {
      id: input.userId,
      email: input.email,
      full_name: input.fullName,
      active_company_id: input.companyId,
    },
    { onConflict: 'id' }
  )

  if (error) {
    const fallback = await supabaseService.from('user_profiles').upsert(
      {
        id: input.userId,
        email: input.email,
        full_name: input.fullName,
      },
      { onConflict: 'id' }
    )

    if (fallback.error) throw fallback.error
  }
}

async function assignGlobalRole(input: { userId: string; roleKey: string }) {
  const roleId = await resolveRoleIdByKey(input.roleKey)

  const { error: existingError, data: existing } = await supabaseService
    .from('user_roles')
    .select('id')
    .eq('user_id', input.userId)
    .eq('role_id', roleId)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing?.id) return

  const { error } = await supabaseService.from('user_roles').insert({
    user_id: input.userId,
    role_id: roleId,
    status: 'active',
    is_active: true,
  })

  if (error) {
    const fallback = await supabaseService.from('user_roles').insert({
      user_id: input.userId,
      role_id: roleId,
      status: 'active',
    })
    if (fallback.error) throw fallback.error
  }
}

async function upsertCompanyMembership(input: {
  companyId: string
  userId: string
  email: string
  membershipRole: string
  invitedBy: string
}) {
  const { error } = await supabaseService.from('company_memberships').upsert(
    {
      company_id: input.companyId,
      user_id: input.userId,
      invited_email: input.email,
      membership_role: input.membershipRole,
      status: 'active',
      invited_by: input.invitedBy,
      invited_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
    },
    { onConflict: 'company_id,user_id' }
  )

  if (error) throw error
}

async function logInvitation(input: {
  companyId: string
  email: string
  fullName: string | null
  membershipRole: string
  roleKey: string
  invitedBy: string
  invitedUserId: string
  status: 'pending' | 'accepted'
}) {
  const { error } = await supabaseService.from('company_invitations').insert({
    company_id: input.companyId,
    email: input.email,
    full_name: input.fullName,
    membership_role: input.membershipRole,
    role_key: input.roleKey,
    invited_by: input.invitedBy,
    invited_user_id: input.invitedUserId,
    status: input.status,
    accepted_at: input.status === 'accepted' ? new Date().toISOString() : null,
  })

  if (error) throw error
}

export async function createCompanyAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const admin = await requireAdminActionAccess({ anyOf: ['tenants.write'] })

    const name = normalizeText(formData.get('name'))
    const orgNumber = normalizeText(formData.get('org_number')) || null
    const primaryContactName = normalizeText(formData.get('primary_contact_name')) || null
    const primaryContactEmail = normalizeEmail(formData.get('primary_contact_email'))
    const phone = normalizeText(formData.get('phone')) || null
    const website = normalizeText(formData.get('website')) || null

    if (!name) return { ok: false, message: 'Företagsnamn saknas.' }
    if (!primaryContactEmail) return { ok: false, message: 'E-post till bolagsansvarig saknas.' }

    const slugBase = slugify(name) || `company-${Date.now()}`
    const slug = `${slugBase}-${Date.now().toString(36)}`

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
        created_by: admin.userId,
      })
      .select('id')
      .single()

    if (companyError) throw companyError
    if (!company?.id) throw new Error('Företaget skapades inte korrekt.')

    const user = await inviteOrLoadUser({
      email: primaryContactEmail,
      fullName: primaryContactName,
      companyId: company.id as string,
    })

    await upsertUserProfile({
      userId: user.id,
      email: primaryContactEmail,
      fullName: primaryContactName,
      companyId: company.id as string,
    })

    await assignGlobalRole({ userId: user.id, roleKey: 'company_admin' })
    await upsertCompanyMembership({
      companyId: company.id as string,
      userId: user.id,
      email: primaryContactEmail,
      membershipRole: 'company_admin',
      invitedBy: admin.userId,
    })
    await logInvitation({
      companyId: company.id as string,
      email: primaryContactEmail,
      fullName: primaryContactName,
      membershipRole: 'company_admin',
      roleKey: 'company_admin',
      invitedBy: admin.userId,
      invitedUserId: user.id,
      status: user.last_sign_in_at ? 'accepted' : 'pending',
    })

    revalidatePath('/admin')
    revalidatePath('/admin/companies')
    revalidatePath('/admin/users')

    return { ok: true, message: 'Företaget skapades och bolagsansvarig bjöds in.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte skapa företaget.',
    }
  }
}

export async function inviteCompanyUserAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const admin = await requireAdminActionAccess({ anyOf: ['tenants.invite'] })

    const companyId = normalizeText(formData.get('company_id'))
    const email = normalizeEmail(formData.get('email'))
    const fullName = normalizeText(formData.get('full_name')) || null
    const roleKey = normalizeText(formData.get('role_key')) || 'customer_service_agent'

    if (!companyId) return { ok: false, message: 'Företag saknas.' }
    if (!email) return { ok: false, message: 'E-post saknas.' }

    assertAllowedRole(roleKey)

    const allowed = await canInviteIntoCompany({
      userId: admin.userId,
      roles: admin.roles,
      permissions: admin.permissions,
      companyId,
    })

    if (!allowed) {
      return { ok: false, message: 'Du kan bara bjuda in användare till bolag du administrerar.' }
    }

    const membershipRole = roleKey === 'company_admin' ? 'company_admin' : 'member'
    const user = await inviteOrLoadUser({ email, fullName, companyId })

    await upsertUserProfile({ userId: user.id, email, fullName, companyId })
    await assignGlobalRole({ userId: user.id, roleKey })
    await upsertCompanyMembership({
      companyId,
      userId: user.id,
      email,
      membershipRole,
      invitedBy: admin.userId,
    })
    await logInvitation({
      companyId,
      email,
      fullName,
      membershipRole,
      roleKey,
      invitedBy: admin.userId,
      invitedUserId: user.id,
      status: user.last_sign_in_at ? 'accepted' : 'pending',
    })

    revalidatePath('/admin/companies')
    revalidatePath('/admin/users')

    return { ok: true, message: 'Användaren bjöds in och kopplades till företaget.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte bjuda in användaren.',
    }
  }
}

export async function updateCompanyStatusAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const admin = await requireAdminActionAccess({ anyOf: ['tenants.write'] })
    const companyId = normalizeText(formData.get('company_id'))
    const status = normalizeText(formData.get('status'))

    if (!companyId) return { ok: false, message: 'Företag saknas.' }
    if (!['active', 'onboarding', 'suspended'].includes(status)) {
      return { ok: false, message: 'Statusen är inte giltig.' }
    }

    if (!userIsPlatformAdmin(admin.roles, admin.permissions)) {
      return { ok: false, message: 'Endast plattformsansvarig kan ändra bolagsstatus.' }
    }

    const { error } = await supabaseService
      .from('companies')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', companyId)

    if (error) throw error

    revalidatePath('/admin/companies')
    return { ok: true, message: 'Företagsstatus uppdaterades.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Kunde inte uppdatera företaget.',
    }
  }
}
