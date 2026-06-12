'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { supabaseService } from '@/lib/supabase/service'

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function numberValue(formData: FormData, key: string, fallback: number | null = null): number | null {
  const raw = text(formData, key).replace(',', '.')
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function intValue(formData: FormData, key: string, fallback: number | null = null): number | null {
  const raw = text(formData, key)
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function dateValue(formData: FormData, key: string): string | null {
  const value = text(formData, key)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function boolValue(formData: FormData, key: string): boolean {
  return formData.get(key) === 'on' || formData.get(key) === 'true'
}

function cleanCode(value: string): string | null {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 80)
  return cleaned || null
}

function contractType(value: string): string {
  if (['spot', 'variable_monthly', 'variable_hourly', 'fixed', 'portfolio', 'mixed'].includes(value)) return value
  return 'spot'
}

function customerType(value: string): 'private' | 'business' | 'both' {
  if (value === 'private' || value === 'business') return value
  return 'both'
}

async function assertSameTenantReference(table: string, id: string | null, companyId: string, label: string) {
  if (!id) return
  const { data, error } = await supabaseService
    .from(table)
    .select('id,company_id')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error(`${label} hittades inte.`)
  if (data.company_id !== companyId) throw new Error(`${label} tillhör ett annat bolag och kan inte kopplas.`)
}

async function assertVersionBelongsToPlan(pricePlanId: string | null, pricePlanVersionId: string | null) {
  if (!pricePlanId || !pricePlanVersionId) return
  const { data, error } = await supabaseService
    .from('price_plan_versions')
    .select('id,price_plan_id')
    .eq('id', pricePlanVersionId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Prisversionen hittades inte.')
  if (data.price_plan_id !== pricePlanId) throw new Error('Prisversionen hör inte till vald prisplan.')
}

function publicationIssues(input: {
  publicationStatus: string
  websiteEnabled: boolean
  pricePlanId: string | null
  pricePlanVersionId: string | null
  termsVersion: string | null
  publicPriceText: string | null
  type: string
  spotWeight: number
  portfolioWeight: number
  fixedWeight: number
  validFrom: string | null
  validTo: string | null
}) {
  const issues: string[] = []
  if (input.pricePlanId === null) issues.push('Prisplan saknas')
  if (input.pricePlanVersionId === null) issues.push('Prisversion saknas')
  if (!input.termsVersion) issues.push('Villkorsversion saknas')
  if (!input.publicPriceText) issues.push('Publik pristext saknas')
  if (['portfolio', 'mixed'].includes(input.type)) {
    const sum = input.spotWeight + input.portfolioWeight + input.fixedWeight
    if (Math.round(sum * 1000000) / 1000000 !== 100) issues.push('Fördelningen måste bli 100%')
  }
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) issues.push('Giltighetsdatum är fel')
  if (input.publicationStatus === 'published' && !input.websiteEnabled) issues.push('Publicerat avtal måste vara markerat för hemsida om det ska visas publikt')
  return issues
}

export async function saveTenantPublicContractOfferAction(formData: FormData) {
  const actor = await requirePlatformAdminActionAccess()
  const companyId = text(formData, 'company_id')
  const id = text(formData, 'id') || null
  const publicName = text(formData, 'public_name')
  const type = contractType(text(formData, 'contract_type'))
  const pricePlanId = text(formData, 'price_plan_id') || null
  const pricePlanVersionId = text(formData, 'price_plan_version_id') || null
  const publicationStatus = text(formData, 'publication_status') || 'draft'
  const websiteEnabled = boolValue(formData, 'website_enabled')
  const websiteCtaEnabled = boolValue(formData, 'website_cta_enabled')
  const termsVersion = text(formData, 'terms_version') || null
  const publicPriceText = text(formData, 'public_price_text') || null
  const spotWeight = numberValue(formData, 'spot_weight_percent', type === 'mixed' ? 50 : type === 'portfolio' ? 0 : 100) ?? 100
  const portfolioWeight = numberValue(formData, 'portfolio_weight_percent', type === 'mixed' ? 50 : type === 'portfolio' ? 100 : 0) ?? 0
  const fixedWeight = numberValue(formData, 'fixed_weight_percent', 0) ?? 0

  if (!companyId) throw new Error('Bolag saknas.')
  if (!publicName) throw new Error('Avtalsnamn krävs.')
  if (!['draft', 'review', 'published', 'unpublished', 'archived', 'expired'].includes(publicationStatus)) throw new Error('Ogiltig publiceringsstatus.')

  const { data: company, error: companyError } = await supabaseService
    .from('companies')
    .select('id,name')
    .eq('id', companyId)
    .maybeSingle()
  if (companyError) throw companyError
  if (!company) throw new Error('Bolaget hittades inte.')

  await assertSameTenantReference('price_plans', pricePlanId, companyId, 'Prisplan')
  await assertSameTenantReference('price_plan_versions', pricePlanVersionId, companyId, 'Prisversion')
  await assertVersionBelongsToPlan(pricePlanId, pricePlanVersionId)

  const issues = publicationIssues({
    publicationStatus,
    websiteEnabled,
    pricePlanId,
    pricePlanVersionId,
    termsVersion,
    publicPriceText,
    type,
    spotWeight,
    portfolioWeight,
    fixedWeight,
    validFrom: dateValue(formData, 'valid_from'),
    validTo: dateValue(formData, 'valid_to'),
  })
  if (publicationStatus === 'published' && issues.length > 0) {
    throw new Error(`Avtalet kan inte publiceras: ${issues.join(', ')}.`)
  }

  let previous: Record<string, unknown> | null = null
  if (id) {
    const { data, error } = await supabaseService
      .from('public_contract_offers')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Avtalet hittades inte för valt bolag.')
    previous = data as Record<string, unknown>
  }

  const isArchived = publicationStatus === 'archived'
  const isPublic = publicationStatus === 'published' && websiteEnabled && issues.length === 0
  const payload = {
    company_id: companyId,
    offer_code: cleanCode(text(formData, 'offer_code')),
    public_name: publicName,
    public_description: text(formData, 'public_description') || null,
    product_code: text(formData, 'product_code') || 'electricity',
    contract_type: type,
    billing_model: text(formData, 'billing_model') || type,
    customer_type: customerType(text(formData, 'customer_type')),
    price_plan_id: pricePlanId,
    price_plan_version_id: pricePlanVersionId,
    campaign_version_id: text(formData, 'campaign_version_id') || null,
    monthly_fee_sek: numberValue(formData, 'monthly_fee_sek'),
    invoice_fee_sek: numberValue(formData, 'invoice_fee_sek'),
    markup_ore_per_kwh: numberValue(formData, 'markup_ore_per_kwh'),
    spot_markup_ore_per_kwh: numberValue(formData, 'spot_markup_ore_per_kwh'),
    variable_fee_ore_per_kwh: numberValue(formData, 'variable_fee_ore_per_kwh'),
    fixed_price_ore_per_kwh: numberValue(formData, 'fixed_price_ore_per_kwh'),
    terms_version: termsVersion,
    terms_url: text(formData, 'terms_url') || null,
    public_price_text: publicPriceText,
    binding_months: intValue(formData, 'binding_months'),
    notice_months: intValue(formData, 'notice_months'),
    spot_weight_percent: spotWeight,
    portfolio_weight_percent: portfolioWeight,
    fixed_weight_percent: fixedWeight,
    price_area: text(formData, 'price_area') || null,
    valid_from: dateValue(formData, 'valid_from'),
    valid_to: dateValue(formData, 'valid_to'),
    publication_status: publicationStatus,
    website_enabled: websiteEnabled,
    website_cta_enabled: websiteCtaEnabled,
    is_public: isPublic,
    is_archived: isArchived,
    sort_order: intValue(formData, 'sort_order', 100) ?? 100,
    readiness_issues: issues,
    publication_notes: text(formData, 'publication_notes') || null,
    published_at: isPublic ? new Date().toISOString() : null,
    archived_at: isArchived ? new Date().toISOString() : null,
    updated_by: actor.userId,
    metadata: {
      ui_source: 'company_card_contracts_tab',
      company_name: company.name,
      public_price_text: publicPriceText,
      terms_url: text(formData, 'terms_url') || null,
      mix: { spot_weight_percent: spotWeight, portfolio_weight_percent: portfolioWeight, fixed_weight_percent: fixedWeight },
    },
  }

  const query = id
    ? supabaseService.from('public_contract_offers').update(payload).eq('id', id).eq('company_id', companyId)
    : supabaseService.from('public_contract_offers').insert({ ...payload, created_by: actor.userId })

  const { data: saved, error } = await query.select('*').single()
  if (error) throw error

  const action = publicationStatus === 'published'
    ? 'contract_plan.published'
    : publicationStatus === 'archived'
      ? 'contract_plan.archived'
      : id
        ? 'contract_plan.updated'
        : 'contract_plan.created'

  await logAdminActionAndUsage({
    companyId,
    actorUserId: actor.userId,
    entityType: 'public_contract_offer',
    entityId: String(saved.id),
    action,
    label: id ? 'Avtal uppdaterat' : 'Avtal skapat',
    oldValues: previous,
    newValues: saved,
    source: 'company_card_contracts_tab',
    billable: false,
    metadata: { publicationStatus, websiteEnabled, issues, pricePlanId, pricePlanVersionId },
  })

  revalidatePath(`/admin/companies/${companyId}`)
  revalidatePath('/admin/contracts')
}
