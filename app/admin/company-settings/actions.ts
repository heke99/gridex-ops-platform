'use server'

import { revalidatePath } from 'next/cache'
import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyScopedActionAccess } from '@/lib/admin/guards'

export type CompanySettingsActionState = {
  ok: boolean
  message: string
}

function normalizeText(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function normalizeEmail(value: FormDataEntryValue | null) {
  return normalizeText(value).toLowerCase()
}

function normalizeUpper(value: FormDataEntryValue | null) {
  const text = normalizeText(value)
  return text ? text.toUpperCase() : null
}

function normalizeEnvironment(value: FormDataEntryValue | null) {
  const text = normalizeText(value)
  return text === 'production' ? 'production' : 'test'
}

const COMPANY_ASSIGNABLE_ROLE_KEYS = new Set([
  'company_admin',
  'operations_manager',
  'operations_agent',
  'customer_service_manager',
  'customer_service_agent',
  'finance_readonly',
  'executive_readonly',
])

const COMPANY_ASSIGNABLE_MEMBERSHIP_ROLES = new Set([
  'owner',
  'admin',
  'company_admin',
  'operations',
  'support',
  'viewer',
])

async function assertCanManageCompany(companyId: string) {
  return requireCompanyScopedActionAccess(companyId, { anyOf: ['tenants.invite', 'users.write'] })
}

async function resolveRoleIdByKey(roleKey: string): Promise<string | null> {
  const { data, error } = await supabaseService
    .from('roles')
    .select('id,key')
    .eq('key', roleKey)
    .maybeSingle()

  if (error) throw error
  return data?.id ? String(data.id) : null
}

export async function updateCompanySettingsAction(
  _prevState: CompanySettingsActionState,
  formData: FormData
): Promise<CompanySettingsActionState> {
  try {
    const companyId = normalizeText(formData.get('company_id'))
    if (!companyId) return { ok: false, message: 'Bolag saknas.' }

    await assertCanManageCompany(companyId)

    const name = normalizeText(formData.get('name'))
    const orgNumber = normalizeText(formData.get('org_number')) || null
    const primaryContactName = normalizeText(formData.get('primary_contact_name')) || null
    const primaryContactEmail = normalizeEmail(formData.get('primary_contact_email')) || null
    const phone = normalizeText(formData.get('phone')) || null
    const website = normalizeText(formData.get('website')) || null
    const billingContactEmail = normalizeEmail(formData.get('billing_contact_email')) || null
    const supportEmail = normalizeEmail(formData.get('support_email')) || null
    const addressLine1 = normalizeText(formData.get('address_line_1')) || null
    const addressLine2 = normalizeText(formData.get('address_line_2')) || null
    const postalCode = normalizeText(formData.get('postal_code')) || null
    const city = normalizeText(formData.get('city')) || null
    const countryCode = normalizeUpper(formData.get('country_code')) || 'SE'
    const edielId = normalizeUpper(formData.get('ediel_id'))
    const actorRole = normalizeUpper(formData.get('actor_role'))
    const senderSubAddress = normalizeUpper(formData.get('sender_sub_address'))
    const edielMailbox = normalizeText(formData.get('ediel_mailbox')) || null
    const operatingEnvironment = normalizeEnvironment(formData.get('operating_environment'))

    if (!name) return { ok: false, message: 'Bolagsnamn krävs.' }

    const { error } = await supabaseService
      .from('companies')
      .update({
        name,
        org_number: orgNumber,
        primary_contact_name: primaryContactName,
        primary_contact_email: primaryContactEmail,
        phone,
        website,
        billing_contact_email: billingContactEmail,
        support_email: supportEmail,
        address_line_1: addressLine1,
        address_line_2: addressLine2,
        postal_code: postalCode,
        city,
        country_code: countryCode,
        ediel_id: edielId,
        actor_role: actorRole,
        sender_sub_address: senderSubAddress,
        ediel_mailbox: edielMailbox,
        operating_environment: operatingEnvironment,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId)

    if (error) throw error

    revalidatePath('/admin/company-settings')
    revalidatePath('/admin/companies')
    return { ok: true, message: 'Bolagsinställningar sparades.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Bolagsinställningar kunde inte sparas.' }
  }
}

export async function updateCompanyResponsibleUserAction(
  _prevState: CompanySettingsActionState,
  formData: FormData
): Promise<CompanySettingsActionState> {
  try {
    const companyId = normalizeText(formData.get('company_id'))
    const userId = normalizeText(formData.get('user_id'))
    const email = normalizeEmail(formData.get('email'))
    const fullName = normalizeText(formData.get('full_name')) || null
    const phone = normalizeText(formData.get('phone')) || null
    const membershipRole = normalizeText(formData.get('membership_role')) || 'admin'
    const roleKey = normalizeText(formData.get('role_key')) || 'company_admin'

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    if (!userId) return { ok: false, message: 'Användare saknas.' }
    if (!email) return { ok: false, message: 'E-post krävs.' }
    if (!COMPANY_ASSIGNABLE_MEMBERSHIP_ROLES.has(membershipRole)) {
      return { ok: false, message: 'Bolagsrollen är inte tillåten på bolagsnivå.' }
    }
    if (!COMPANY_ASSIGNABLE_ROLE_KEYS.has(roleKey)) {
      return { ok: false, message: 'Systemrollen är inte tillåten på bolagsnivå.' }
    }

    await assertCanManageCompany(companyId)

    const { data: membership, error: membershipLookupError } = await supabaseService
      .from('company_memberships')
      .select('id, company_id, user_id')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle()

    if (membershipLookupError) throw membershipLookupError
    if (!membership) return { ok: false, message: 'Användaren är inte kopplad till bolaget.' }

    const { data: authUser, error: authLookupError } = await supabaseService.auth.admin.getUserById(userId)
    if (authLookupError) throw authLookupError

    const updatePayload: Parameters<typeof supabaseService.auth.admin.updateUserById>[1] = {
      user_metadata: {
        ...(authUser.user?.user_metadata ?? {}),
        full_name: fullName,
        phone,
      },
    }

    if ((authUser.user?.email ?? '').toLowerCase() !== email) {
      updatePayload.email = email
      updatePayload.email_confirm = false
    }

    const { error: authUpdateError } = await supabaseService.auth.admin.updateUserById(userId, updatePayload)
    if (authUpdateError) throw authUpdateError

    const { error: profileError } = await supabaseService.from('user_profiles').upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        phone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )

    if (profileError && !['42P01', '42703', 'PGRST205'].includes(profileError.code ?? '')) throw profileError

    const { error: membershipError } = await supabaseService
      .from('company_memberships')
      .update({
        membership_role: membershipRole,
        status: 'active',
        invited_email: email,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)
      .eq('user_id', userId)

    if (membershipError) throw membershipError

    const roleId = await resolveRoleIdByKey(roleKey)
    if (roleId) {
      const { error: roleError } = await supabaseService.from('user_roles').upsert(
        {
          user_id: userId,
          role_id: roleId,
          status: 'active',
          is_active: true,
        },
        { onConflict: 'user_id,role_id' }
      )
      if (roleError && roleError.code !== '42703') throw roleError
    }

    revalidatePath('/admin/company-settings')
    revalidatePath(`/admin/companies/${companyId}/users`)
    revalidatePath('/admin/users')

    return { ok: true, message: 'Bolagsansvarig/användaruppgifter uppdaterades.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Användaren kunde inte uppdateras.' }
  }
}
