'use server'

import { revalidatePath } from 'next/cache'
import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { getCompanyById } from '@/lib/tenant/governance'
import { grantCompanyUserAccess } from '@/lib/auth/companyUserAccess'
import {
  COMPANY_ASSIGNABLE_MEMBERSHIP_ROLES,
  COMPANY_ASSIGNABLE_ROLE_KEYS,
} from '@/lib/tenant/companyUserRoles'

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

function normalizeHexColor(value: FormDataEntryValue | null) {
  const text = normalizeText(value)
  if (!text) return null
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : text
}

async function assertCanManageCompany(companyId: string) {
  return requireCompanyScopedActionAccess(companyId, { anyOf: ['tenants.invite', 'users.write'] })
}

export async function updateCompanySettingsAction(
  _prevState: CompanySettingsActionState,
  formData: FormData
): Promise<CompanySettingsActionState> {
  try {
    const companyId = normalizeText(formData.get('company_id'))
    if (!companyId) return { ok: false, message: 'Bolag saknas.' }

    await assertCanManageCompany(companyId)
    const currentCompany = await getCompanyById(companyId)
    if (!currentCompany) return { ok: false, message: 'Bolaget hittades inte.' }

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
    const requestedOperatingEnvironment = normalizeEnvironment(formData.get('operating_environment'))
    const isLiveApproved = Boolean(
      currentCompany.live_ediel_enabled === true &&
      currentCompany.production_status === 'live' &&
      currentCompany.live_approved_at
    )
    if (requestedOperatingEnvironment === 'production' && !isLiveApproved) {
      return { ok: false, message: 'Produktion kan bara aktiveras via superadmin go-live efter godkända tester, production route och live-godkännande.' }
    }
    const operatingEnvironment = isLiveApproved ? requestedOperatingEnvironment : 'test' 
    const branding = {
      display_name: normalizeText(formData.get('branding_display_name')) || null,
      logo_url: normalizeText(formData.get('branding_logo_url')) || null,
      primary_color: normalizeHexColor(formData.get('branding_primary_color')) || null,
      support_email: supportEmail,
      billing_email: billingContactEmail,
      sender_email: normalizeEmail(formData.get('branding_sender_email')) || null,
      customer_portal_name: normalizeText(formData.get('branding_customer_portal_name')) || null,
    }

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
        branding,
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

    await grantCompanyUserAccess({
      companyId,
      userId,
      email,
      fullName,
      membershipRole,
      roleKey,
      source: 'company_settings_responsible_user_update',
    })

    revalidatePath('/admin/company-settings')
    revalidatePath(`/admin/companies/${companyId}/users`)
    revalidatePath('/admin/users')
    revalidatePath('/admin')

    return { ok: true, message: 'Bolagsansvarig/användaruppgifter uppdaterades.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Användaren kunde inte uppdateras.' }
  }
}
