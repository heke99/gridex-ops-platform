'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

type OptionalColumnError = { code?: string | null; message?: string | null }

const COMPANY_STATUSES = new Set(['active', 'onboarding', 'paused', 'suspended', 'archived'])

function text(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim()
}

function nullableText(value: FormDataEntryValue | null): string | null {
  const normalized = text(value)
  return normalized.length > 0 ? normalized : null
}

function normalizeEmail(value: FormDataEntryValue | null): string | null {
  const normalized = text(value).toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function normalizeCustomerNumberPrefix(value: FormDataEntryValue | null): string | null {
  const prefix = text(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!prefix) return null
  if (!/^[A-Z0-9]{2,12}$/.test(prefix)) {
    throw new Error('Kundnummerprefix måste vara 2–12 tecken och bara innehålla A–Z eller 0–9.')
  }
  return prefix
}

function normalizeWebsite(value: FormDataEntryValue | null): string | null {
  const normalized = text(value)
  if (!normalized) return null
  if (/^https?:\/\//i.test(normalized)) return normalized
  return `https://${normalized}`
}

function missingColumnName(error: OptionalColumnError | null | undefined): string | null {
  if (!error || !['42703', 'PGRST204'].includes(error.code ?? '')) return null
  const message = error.message ?? ''
  return (
    message.match(/column\s+"([^"]+)"\s+does not exist/i)?.[1] ??
    message.match(/'([^']+)'\s+column/i)?.[1] ??
    message.match(/column\s+([^\s]+)\s+does not exist/i)?.[1] ??
    null
  )
}

async function safeUpdateCompany(companyId: string, payload: Record<string, unknown>) {
  const requiredColumns = new Set(['name', 'updated_at'])

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data, error } = await supabaseService
      .from('companies')
      .update(payload)
      .eq('id', companyId)
      .select('id,name')
      .maybeSingle()

    if (!error) {
      if (!data) throw new Error('Bolaget hittades inte.')
      return data as { id: string; name: string }
    }

    const missing = missingColumnName(error)
    if (missing && missing in payload && !requiredColumns.has(missing)) {
      delete payload[missing]
      continue
    }

    throw error
  }

  throw new Error('Bolagsuppgifterna kunde inte sparas efter schemaanpassning.')
}

export async function saveCompanyProfileAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  let redirectMessage = 'Bolagsuppgifterna sparades.'

  try {
    if (!companyId) throw new Error('Bolag saknas.')
    const name = text(formData.get('name'))
    if (!name) throw new Error('Bolagsnamn krävs.')

    const status = text(formData.get('status')) || 'onboarding'
    if (!COMPANY_STATUSES.has(status)) throw new Error('Ogiltig bolagsstatus.')

    const payload: Record<string, unknown> = {
      name,
      org_number: nullableText(formData.get('org_number')),
      customer_number_prefix: normalizeCustomerNumberPrefix(formData.get('customer_number_prefix')),
      primary_contact_name: nullableText(formData.get('primary_contact_name')),
      primary_contact_email: normalizeEmail(formData.get('primary_contact_email')),
      support_email: normalizeEmail(formData.get('support_email')),
      phone: nullableText(formData.get('phone')),
      website: normalizeWebsite(formData.get('website')),
      status,
      status_reason: nullableText(formData.get('status_reason')),
      updated_at: new Date().toISOString(),
      updated_by: admin.userId,
    }

    const previous = await supabaseService
      .from('companies')
      .select('id,name,org_number,customer_number_prefix,primary_contact_name,primary_contact_email,support_email,phone,website,status,status_reason')
      .eq('id', companyId)
      .maybeSingle()
      .then((result) => result.error ? null : result.data)

    const saved = await safeUpdateCompany(companyId, payload)

    await supabaseService.from('audit_logs').insert({
      company_id: companyId,
      actor_user_id: admin.userId,
      entity_type: 'company',
      entity_id: companyId,
      action: 'SUPERADMIN_COMPANY_PROFILE_UPDATED',
      old_values: previous,
      new_values: payload,
      metadata: {
        ui_source: 'company_card_profile_editor',
        company_name: saved.name,
      },
    }).then(() => null)
  } catch (error) {
    redirectMessage = error instanceof Error ? error.message : 'Bolagsuppgifterna kunde inte sparas.'
    redirect(`/admin/companies/${companyId || ''}?error=${encodeURIComponent(redirectMessage)}#company-profile`)
  }

  revalidatePath(`/admin/companies/${companyId}`)
  revalidatePath('/admin/companies')
  redirect(`/admin/companies/${companyId}?success=${encodeURIComponent(redirectMessage)}#company-profile`)
}
