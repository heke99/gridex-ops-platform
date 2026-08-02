'use server'

import { revalidatePath } from 'next/cache'
import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { getCompanyById } from '@/lib/tenant/governance'
import { grantCompanyUserAccess } from '@/lib/auth/companyUserAccess'
import { resolveCanonicalCompanyAccessRole } from '@/lib/tenant/companyUserRoles'
import {
  normalizeCountryCode,
  normalizeEmail as normalizeLegalEmail,
  normalizePostalCode,
  normalizeSwedishOrganizationNumber,
  normalizeUrl,
} from '@/lib/legal/tenantLegalProfile'
import { updateCompanyAndRebuildLegalProfile } from '@/lib/tenant/companyLegalProfile'
import { toSafeCompanyProfileError } from '@/lib/errors/safeActionErrors'

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

function optionalText(value: FormDataEntryValue | null): string | null {
  return normalizeText(value) || null
}

function optionalLegalEmail(value: FormDataEntryValue | null, label: string): string | null {
  return normalizeLegalEmail(normalizeText(value), label) || null
}


function optionalCountryCode(
  value: FormDataEntryValue | null,
): string | null {
  const raw = normalizeText(value)
  return raw ? normalizeCountryCode(raw) : null
}

function optionalPostalCode(
  value: FormDataEntryValue | null,
  countryCode: string,
  label: string,
): string | null {
  return normalizePostalCode(normalizeText(value), countryCode, label) || null
}

function normalizeUpper(value: FormDataEntryValue | null) {
  const text = normalizeText(value)
  return text ? text.toUpperCase() : null
}

function normalizeCustomerNumberPrefix(value: FormDataEntryValue | null): string | null {
  const prefix = normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!prefix) return null
  if (!/^[A-Z0-9]{2,12}$/.test(prefix)) {
    throw new Error('Kundnummerprefix måste vara 2–12 tecken och bara innehålla A–Z eller 0–9.')
  }
  return prefix
}

function normalizeEnvironment(value: FormDataEntryValue | null) {
  return normalizeText(value) === 'production' ? 'production' : 'test'
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
  const companyId = normalizeText(formData.get('company_id'))
  try {
    if (!companyId) return { ok: false, message: 'Bolag saknas.' }

    const admin = await assertCanManageCompany(companyId)
    const currentCompany = await getCompanyById(companyId)
    if (!currentCompany) return { ok: false, message: 'Bolaget hittades inte.' }

    const name = normalizeText(formData.get('name'))
    if (!name) return { ok: false, message: 'Bolagsnamn krävs.' }

    const customerNumberPrefix = normalizeCustomerNumberPrefix(formData.get('customer_number_prefix'))
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

    if (customerNumberPrefix !== (currentCompany.customer_number_prefix ?? null)) {
      const { count, error: customerCountError } = await supabaseService
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .not('customer_number', 'is', null)
      if (customerCountError) throw customerCountError
      if ((count ?? 0) > 0) {
        return { ok: false, message: 'Kundnummerprefix kan inte ändras efter att bolaget har fått kundnummer. Skapa ett nytt prefix bara innan första kunden.' }
      }
    }

    const countryCode = normalizeCountryCode(normalizeText(formData.get('country_code')))
    const complaintsCountryCode = optionalCountryCode(formData.get('complaints_country_code'))
    const dataProtectionCountryCode = optionalCountryCode(formData.get('data_protection_country_code'))
    const billingCountryCode = optionalCountryCode(formData.get('billing_country_code'))
    const supportEmail = optionalLegalEmail(formData.get('support_email'), 'Kundservice: e-post')
    const billingContactEmail = optionalLegalEmail(formData.get('billing_contact_email'), 'Fakturering: e-post')
    const branding = {
      display_name: optionalText(formData.get('branding_display_name')),
      logo_url: optionalText(formData.get('branding_logo_url')),
      primary_color: normalizeHexColor(formData.get('branding_primary_color')),
      support_email: supportEmail,
      billing_email: billingContactEmail,
      sender_email: optionalLegalEmail(formData.get('branding_sender_email'), 'Avsändare: e-post'),
      customer_portal_name: optionalText(formData.get('branding_customer_portal_name')),
    }

    const result = await updateCompanyAndRebuildLegalProfile({
      companyId,
      actorUserId: admin.userId,
      values: {
        name,
        legal_name: optionalText(formData.get('legal_name')),
        org_number: normalizeSwedishOrganizationNumber(normalizeText(formData.get('org_number'))) || null,
        vat_number: optionalText(formData.get('vat_number')),
        customer_number_prefix: customerNumberPrefix,
        primary_contact_name: optionalText(formData.get('primary_contact_name')),
        primary_contact_email: optionalLegalEmail(formData.get('primary_contact_email'), 'Primär kontakt: e-post'),
        phone: optionalText(formData.get('phone')),
        website: normalizeUrl(normalizeText(formData.get('website')), 'Webbplats') || null,
        support_email: supportEmail,
        customer_service_hours: optionalText(formData.get('customer_service_hours')),
        address_line_1: optionalText(formData.get('address_line_1')),
        address_line_2: optionalText(formData.get('address_line_2')),
        postal_code: optionalPostalCode(formData.get('postal_code'), countryCode, 'Postnummer'),
        city: optionalText(formData.get('city')),
        country_code: countryCode,
        complaints_contact_name: optionalText(formData.get('complaints_contact_name')),
        complaints_email: optionalLegalEmail(formData.get('complaints_email'), 'Klagomål: e-post'),
        complaints_phone: optionalText(formData.get('complaints_phone')),
        complaints_address_line_1: optionalText(formData.get('complaints_address_line_1')),
        complaints_address_line_2: optionalText(formData.get('complaints_address_line_2')),
        complaints_postal_code: optionalPostalCode(formData.get('complaints_postal_code'), complaintsCountryCode ?? countryCode, 'Klagomål: postnummer'),
        complaints_city: optionalText(formData.get('complaints_city')),
        complaints_country_code: complaintsCountryCode,
        complaints_description: optionalText(formData.get('complaints_description')),
        data_protection_contact_name: optionalText(formData.get('data_protection_contact_name')),
        data_protection_email: optionalLegalEmail(formData.get('data_protection_email'), 'Dataskydd: e-post'),
        data_protection_phone: optionalText(formData.get('data_protection_phone')),
        data_protection_address_line_1: optionalText(formData.get('data_protection_address_line_1')),
        data_protection_address_line_2: optionalText(formData.get('data_protection_address_line_2')),
        data_protection_postal_code: optionalPostalCode(formData.get('data_protection_postal_code'), dataProtectionCountryCode ?? countryCode, 'Dataskydd: postnummer'),
        data_protection_city: optionalText(formData.get('data_protection_city')),
        data_protection_country_code: dataProtectionCountryCode,
        billing_contact_email: billingContactEmail,
        billing_contact_phone: optionalText(formData.get('billing_contact_phone')),
        billing_address_line_1: optionalText(formData.get('billing_address_line_1')),
        billing_address_line_2: optionalText(formData.get('billing_address_line_2')),
        billing_postal_code: optionalPostalCode(formData.get('billing_postal_code'), billingCountryCode ?? countryCode, 'Fakturering: postnummer'),
        billing_city: optionalText(formData.get('billing_city')),
        billing_country_code: billingCountryCode,
        billing_terms_summary: optionalText(formData.get('billing_terms_summary')),
        ediel_id: normalizeUpper(formData.get('ediel_id')),
        actor_role: normalizeUpper(formData.get('actor_role')),
        sender_sub_address: normalizeUpper(formData.get('sender_sub_address')),
        ediel_mailbox: optionalText(formData.get('ediel_mailbox')),
        operating_environment: operatingEnvironment,
        branding,
      },
    })

    await logAdminActionAndUsage({
      companyId,
      actorUserId: admin.userId,
      entityType: 'company',
      entityId: companyId,
      action: 'company_settings_updated',
      label: 'Bolagsinställningar och juridikprofil synkroniserade',
      oldValues: {
        name: currentCompany.name,
        org_number: currentCompany.org_number ?? null,
        customer_number_prefix: currentCompany.customer_number_prefix ?? null,
        operating_environment: currentCompany.operating_environment ?? null,
      },
      newValues: {
        name,
        customer_number_prefix: customerNumberPrefix,
        operating_environment: operatingEnvironment,
        legal_profile_status: result.completeness_status,
        legal_profile_missing_fields: result.missing_fields,
      },
      source: 'company_settings',
    }).catch(() => undefined)

    revalidatePath('/admin/company-settings')
    revalidatePath('/admin/companies')
    revalidatePath(`/admin/companies/${companyId}`)
    revalidatePath('/admin/contracts')
    revalidatePath('/api/v1/website/public-contracts')

    const missing = result.missing_field_details.map((item) => item.label).join(', ')
    return {
      ok: true,
      message: missing
        ? `Bolagsinställningarna sparades. Juridikprofilen saknar fortfarande: ${missing}.`
        : 'Bolagsinställningarna sparades och juridikprofilen synkroniserades.',
    }
  } catch (error) {
    return {
      ok: false,
      message: toSafeCompanyProfileError(error, { action: 'update_company_settings', companyId: companyId || null }),
    }
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
    const { membershipRole, roleKey } = resolveCanonicalCompanyAccessRole(
      normalizeText(formData.get('role_key')) || 'company_admin',
    )

    if (!companyId) return { ok: false, message: 'Bolag saknas.' }
    if (!userId) return { ok: false, message: 'Användare saknas.' }
    if (!email) return { ok: false, message: 'E-post krävs.' }
    const admin = await assertCanManageCompany(companyId)

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
      actorUserId: admin.userId,
      source: 'company_settings_responsible_user_update',
    })

    revalidatePath('/admin/company-settings')
    revalidatePath(`/admin/companies/${companyId}/users`)
    revalidatePath('/admin/users')

    return { ok: true, message: 'Bolagsansvarig/användaruppgifter uppdaterades.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Användaren kunde inte uppdateras.' }
  }
}
