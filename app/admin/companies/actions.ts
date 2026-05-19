'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export type CompanyActionState = {
  ok: boolean
  message: string
}

function normalizeText(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim()
}

function normalizeEmail(value: FormDataEntryValue | null): string {
  return normalizeText(value).toLowerCase()
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

function getBaseAppUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'http://localhost:3000'
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

async function upsertOptionalUserProfile(input: { userId: string; email: string; fullName: string | null }) {
  const { error } = await supabaseService.from('user_profiles').upsert(
    {
      id: input.userId,
      email: input.email,
      full_name: input.fullName,
    },
    { onConflict: 'id' }
  )

  if (error && !['42P01', 'PGRST205'].includes(error.code ?? '')) {
    throw error
  }
}

async function resolveOrInviteUser(params: {
  email: string
  fullName: string | null
  sendInvite: boolean
}): Promise<string> {
  if (params.sendInvite) {
    const { data, error } = await supabaseService.auth.admin.inviteUserByEmail(params.email, {
      redirectTo: `${getBaseAppUrl()}/login`,
      data: params.fullName ? { full_name: params.fullName } : undefined,
    })

    if (!error && data.user?.id) return data.user.id

    if (error && !/already|registered|exists/i.test(error.message ?? '')) {
      throw error
    }
  }

  const { data, error } = await supabaseService.auth.admin.listUsers()
  if (error) throw error

  const user = (data.users ?? []).find((row) => (row.email ?? '').toLowerCase() === params.email)
  if (!user?.id) throw new Error(`Ingen användare hittades med e-post ${params.email}.`)
  return user.id
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
    const sendInvite = formData.get('send_invite') !== 'off'

    if (!name) return { ok: false, message: 'Bolagsnamn krävs.' }

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

    if (initialAdminEmail) {
      const userId = await resolveOrInviteUser({
        email: initialAdminEmail,
        fullName: initialAdminName || null,
        sendInvite,
      })

      await upsertOptionalUserProfile({
        userId,
        email: initialAdminEmail,
        fullName: initialAdminName || null,
      })

      const roleId = await resolveRoleIdByKey('company_admin')
      await insertActiveUserRole({ userId, roleId })

      const { error: membershipError } = await supabaseService.from('company_memberships').upsert(
        {
          company_id: company.id,
          user_id: userId,
          membership_role: 'owner',
          status: 'active',
          invited_email: initialAdminEmail,
          invited_by: actorUserId,
          invited_at: new Date().toISOString(),
          accepted_at: sendInvite ? null : new Date().toISOString(),
          metadata: {},
        },
        { onConflict: 'company_id,user_id' }
      )

      if (membershipError) throw membershipError

      await supabaseService.from('company_invitations').insert({
        company_id: company.id,
        email: initialAdminEmail,
        full_name: initialAdminName || null,
        membership_role: 'owner',
        role_key: 'company_admin',
        status: sendInvite ? 'pending' : 'accepted',
        invited_by: actorUserId,
        invited_user_id: userId,
        expires_at: sendInvite ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString() : null,
        accepted_at: sendInvite ? null : new Date().toISOString(),
        metadata: {},
      })
    }

    await supabaseService.from('audit_logs').insert({
      actor_user_id: actorUserId,
      entity_type: 'company',
      entity_id: company.id,
      action: 'company_created',
      company_id: company.id,
      new_values: company,
    })

    revalidatePath('/admin/companies')
    revalidatePath('/admin/users')

    return { ok: true, message: 'Elhandelsbolaget skapades.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Bolaget kunde inte skapas.' }
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

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    if (!email) return { ok: false, message: 'E-post saknas.' }

    const userId = await resolveOrInviteUser({ email, fullName, sendInvite: true })
    await upsertOptionalUserProfile({ userId, email, fullName })
    await insertActiveUserRole({ userId, roleId: await resolveRoleIdByKey(roleKey) })

    const { error: membershipError } = await supabaseService.from('company_memberships').upsert(
      {
        company_id: companyId,
        user_id: userId,
        membership_role: membershipRole,
        status: 'active',
        invited_email: email,
        invited_by: actorUserId,
        invited_at: new Date().toISOString(),
        accepted_at: null,
        metadata: {},
      },
      { onConflict: 'company_id,user_id' }
    )

    if (membershipError) throw membershipError

    await supabaseService.from('company_invitations').insert({
      company_id: companyId,
      email,
      full_name: fullName,
      membership_role: membershipRole,
      role_key: roleKey,
      status: 'pending',
      invited_by: actorUserId,
      invited_user_id: userId,
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
      metadata: {},
    })

    revalidatePath('/admin/companies')
    revalidatePath('/admin/users')

    return { ok: true, message: 'Inbjudan skapades och användaren kopplades till bolaget.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Inbjudan kunde inte skapas.' }
  }
}
