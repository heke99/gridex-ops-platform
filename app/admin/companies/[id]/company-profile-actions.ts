'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { normalizeCountryCode, normalizeEmail, normalizeUrl } from '@/lib/legal/tenantLegalProfile'
import { supabaseService } from '@/lib/supabase/service'
import {
  rebuildCompanyLegalProfile,
  updateCompanyAndRebuildLegalProfile,
} from '@/lib/tenant/companyLegalProfile'

const COMPANY_STATUSES = new Set(['active', 'onboarding', 'paused', 'suspended', 'archived'])

function text(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim()
}

function optionalText(value: FormDataEntryValue | null): string | null {
  const normalized = text(value)
  return normalized || null
}

function optionalEmail(value: FormDataEntryValue | null, label: string): string | null {
  return normalizeEmail(text(value), label) || null
}

function optionalWebsite(value: FormDataEntryValue | null): string | null {
  return normalizeUrl(text(value), 'Webbplats') || null
}

function normalizeCustomerNumberPrefix(value: FormDataEntryValue | null): string | null {
  const prefix = text(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!prefix) return null
  if (!/^[A-Z0-9]{2,12}$/.test(prefix)) {
    throw new Error('Kundnummerprefix måste vara 2–12 tecken och bara innehålla A–Z eller 0–9.')
  }
  return prefix
}

function revalidateCompanyProfile(companyId: string) {
  revalidatePath(`/admin/companies/${companyId}`)
  revalidatePath('/admin/companies')
  revalidatePath('/admin/contracts')
  revalidatePath(`/admin/platform/go-live/${companyId}`)
  revalidatePath('/api/v1/website/public-contracts')
}

function redirectBack(companyId: string, kind: 'success' | 'error', message: string): never {
  redirect(`/admin/companies/${companyId}?${kind}=${encodeURIComponent(message)}#company-profile`)
}

async function assertCustomerPrefixCanChange(companyId: string, nextPrefix: string | null) {
  const { data: company, error: companyError } = await supabaseService
    .from('companies')
    .select('customer_number_prefix')
    .eq('id', companyId)
    .maybeSingle()
  if (companyError) throw companyError
  if (!company) throw new Error('Bolaget hittades inte.')

  const currentPrefix = typeof company.customer_number_prefix === 'string'
    ? company.customer_number_prefix.trim().toUpperCase()
    : null
  if (currentPrefix === nextPrefix) return

  const { count, error: customerError } = await supabaseService
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
  if (customerError) throw customerError
  if ((count ?? 0) > 0) {
    throw new Error('Kundnummerprefix kan inte ändras efter att bolaget har fått kunder.')
  }
}

export async function saveCompanyProfileAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  if (!companyId) redirectBack('', 'error', 'Bolag saknas.')

  try {
    const name = text(formData.get('name'))
    if (!name) throw new Error('Bolagsnamn krävs.')

    const status = text(formData.get('status')) || 'onboarding'
    if (!COMPANY_STATUSES.has(status)) throw new Error('Ogiltig bolagsstatus.')

    const customerNumberPrefix = normalizeCustomerNumberPrefix(formData.get('customer_number_prefix'))
    await assertCustomerPrefixCanChange(companyId, customerNumberPrefix)

    const result = await updateCompanyAndRebuildLegalProfile({
      companyId,
      actorUserId: admin.userId,
      markReviewed: true,
      values: {
        name,
        legal_name: optionalText(formData.get('legal_name')),
        org_number: optionalText(formData.get('org_number')),
        vat_number: optionalText(formData.get('vat_number')),
        website: optionalWebsite(formData.get('website')),
        customer_number_prefix: customerNumberPrefix,
        primary_contact_name: optionalText(formData.get('primary_contact_name')),
        primary_contact_email: optionalEmail(formData.get('primary_contact_email'), 'Primär kontakt: e-post'),
        support_email: optionalEmail(formData.get('support_email'), 'Kundservice: e-post'),
        phone: optionalText(formData.get('phone')),
        customer_service_hours: optionalText(formData.get('customer_service_hours')),
        address_line_1: optionalText(formData.get('address_line_1')),
        address_line_2: optionalText(formData.get('address_line_2')),
        postal_code: optionalText(formData.get('postal_code')),
        city: optionalText(formData.get('city')),
        country_code: normalizeCountryCode(text(formData.get('country_code'))),
        complaints_contact_name: optionalText(formData.get('complaints_contact_name')),
        complaints_email: optionalEmail(formData.get('complaints_email'), 'Klagomål: e-post'),
        complaints_phone: optionalText(formData.get('complaints_phone')),
        complaints_address_line_1: optionalText(formData.get('complaints_address_line_1')),
        complaints_address_line_2: optionalText(formData.get('complaints_address_line_2')),
        complaints_postal_code: optionalText(formData.get('complaints_postal_code')),
        complaints_city: optionalText(formData.get('complaints_city')),
        complaints_country_code: normalizeCountryCode(text(formData.get('complaints_country_code'))),
        complaints_description: optionalText(formData.get('complaints_description')),
        data_protection_contact_name: optionalText(formData.get('data_protection_contact_name')),
        data_protection_email: optionalEmail(formData.get('data_protection_email'), 'Dataskydd: e-post'),
        data_protection_phone: optionalText(formData.get('data_protection_phone')),
        data_protection_address_line_1: optionalText(formData.get('data_protection_address_line_1')),
        data_protection_address_line_2: optionalText(formData.get('data_protection_address_line_2')),
        data_protection_postal_code: optionalText(formData.get('data_protection_postal_code')),
        data_protection_city: optionalText(formData.get('data_protection_city')),
        data_protection_country_code: normalizeCountryCode(text(formData.get('data_protection_country_code'))),
        billing_contact_email: optionalEmail(formData.get('billing_contact_email'), 'Fakturering: e-post'),
        billing_contact_phone: optionalText(formData.get('billing_contact_phone')),
        billing_address_line_1: optionalText(formData.get('billing_address_line_1')),
        billing_address_line_2: optionalText(formData.get('billing_address_line_2')),
        billing_postal_code: optionalText(formData.get('billing_postal_code')),
        billing_city: optionalText(formData.get('billing_city')),
        billing_country_code: normalizeCountryCode(text(formData.get('billing_country_code'))),
        billing_terms_summary: optionalText(formData.get('billing_terms_summary')),
        status,
        status_reason: optionalText(formData.get('status_reason')),
      },
    })

    revalidateCompanyProfile(companyId)
    const missing = result.missing_field_details.map((item) => item.label).join(', ')
    const message = missing
      ? `Bolagsuppgifterna sparades. Juridikprofilen saknar fortfarande: ${missing}.`
      : result.review_required
        ? 'Bolagsuppgifterna sparades. Juridikprofilen är komplett men behöver granskas.'
        : 'Bolagsuppgifterna och juridikprofilen sparades och synkroniserades.'
    redirectBack(companyId, 'success', message)
  } catch (error) {
    redirectBack(companyId, 'error', error instanceof Error ? error.message : 'Bolagsuppgifterna kunde inte sparas.')
  }
}

export async function reviewCompanyLegalProfileAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  if (!companyId) redirectBack('', 'error', 'Bolag saknas.')

  try {
    const result = await rebuildCompanyLegalProfile({
      companyId,
      actorUserId: admin.userId,
      markReviewed: true,
    })
    if (result.missing_field_details.length > 0) {
      throw new Error(`Juridikprofilen kan inte granskas som komplett. Komplettera: ${result.missing_field_details.map((item) => item.label).join(', ')}.`)
    }
    revalidateCompanyProfile(companyId)
    redirectBack(companyId, 'success', 'Juridikprofilen granskades och readiness uppdaterades.')
  } catch (error) {
    redirectBack(companyId, 'error', error instanceof Error ? error.message : 'Juridikprofilen kunde inte granskas.')
  }
}
