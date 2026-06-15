'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { assessPublicOfferReadiness } from '@/lib/website/publicOfferReadiness'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { supabaseService } from '@/lib/supabase/service'
import { seedGridexDefaultLegalPackage } from '@/lib/tenant/legalDefaults'

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


const REQUIRED_PUBLIC_LEGAL_TYPES = ['terms', 'privacy_policy', 'withdrawal', 'power_of_attorney', 'price_terms'] as const

type CanonicalReferenceResult = {
  id: string | null
  blockers: string[]
  created: boolean
}

function redirectBack(companyId: string | null, params: { success?: string; error?: string }): never {
  const search = new URLSearchParams()
  if (params.success) search.set('success', params.success)
  if (params.error) search.set('error', params.error)
  const target = companyId ? `/admin/companies/${companyId}?${search.toString()}#tenant-avtal` : `/admin/companies?${search.toString()}`
  redirect(target)
  throw new Error('Kunde inte navigera tillbaka efter åtgärden.')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'object' && error && 'message' in error && typeof (error as { message?: unknown }).message === 'string') return (error as { message: string }).message
  return 'Åtgärden kunde inte genomföras.'
}

function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST200', 'PGRST201', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist|relationship/i.test(message)
}

async function getActiveLegalBundle(companyId: string): Promise<string | null> {
  const { data, error } = await supabaseService
    .from('legal_bundles')
    .select('id')
    .eq('company_id', companyId)
    .in('status', ['published', 'active'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (isMissingSchemaError(error)) return null
    throw error
  }
  return data?.id ?? null
}

async function ensurePublishedLegalBundle(companyId: string, publicName: string): Promise<CanonicalReferenceResult> {
  const existing = await getActiveLegalBundle(companyId)
  if (existing) return { id: existing, blockers: [], created: false }

  const { data: versions, error } = await supabaseService
    .from('legal_text_versions')
    .select('id,type,version,published_at,created_at')
    .eq('company_id', companyId)
    .eq('status', 'published')
    .in('type', [...REQUIRED_PUBLIC_LEGAL_TYPES])
    .order('type', { ascending: true })
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    if (isMissingSchemaError(error)) return { id: null, blockers: ['Juridiska texter eller juridiska paket saknas i databasen.'], created: false }
    throw error
  }

  const latestByType = new Map<string, { id: string; type: string }>()
  for (const row of versions ?? []) {
    if (!latestByType.has(row.type)) latestByType.set(row.type, row as { id: string; type: string })
  }

  let missing = REQUIRED_PUBLIC_LEGAL_TYPES.filter((type) => !latestByType.has(type))
  if (missing.length > 0) {
    const seeded = await seedGridexDefaultLegalPackage(companyId, null)
    if (seeded.missingTypes.length > 0) {
      return {
        id: null,
        blockers: seeded.missingTypes.map((type) => `Gridex standardjuridik saknar mall: ${type}`),
        created: false,
      }
    }

    const { data: seededVersions, error: seededError } = await supabaseService
      .from('legal_text_versions')
      .select('id,type,version,published_at,created_at')
      .eq('company_id', companyId)
      .eq('status', 'published')
      .in('type', [...REQUIRED_PUBLIC_LEGAL_TYPES])
      .order('type', { ascending: true })
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (seededError) throw seededError
    latestByType.clear()
    for (const row of seededVersions ?? []) {
      if (!latestByType.has(row.type)) latestByType.set(row.type, row as { id: string; type: string })
    }
    missing = REQUIRED_PUBLIC_LEGAL_TYPES.filter((type) => !latestByType.has(type))
    if (missing.length > 0) {
      return {
        id: null,
        blockers: missing.map((type) => `Publicerad juridisk text saknas: ${type}`),
        created: false,
      }
    }
  }

  const { data: bundle, error: bundleError } = await supabaseService
    .from('legal_bundles')
    .insert({
      company_id: companyId,
      name: `Standard juridik · ${publicName}`.slice(0, 180),
      status: 'published',
    })
    .select('id')
    .single()

  if (bundleError) {
    if (isMissingSchemaError(bundleError)) return { id: null, blockers: ['Tabellen för juridiska paket saknas.'], created: false }
    throw bundleError
  }

  const items = REQUIRED_PUBLIC_LEGAL_TYPES.map((type, index) => ({
    legal_bundle_id: bundle.id,
    legal_text_version_id: latestByType.get(type)!.id,
    type,
    sort_order: (index + 1) * 10,
  }))
  const { error: itemsError } = await supabaseService.from('legal_bundle_items').insert(items)
  if (itemsError) throw itemsError

  return { id: bundle.id, blockers: [], created: true }
}

async function getActivePriceBook(companyId: string): Promise<string | null> {
  const { data, error } = await supabaseService
    .from('price_books')
    .select('id')
    .eq('company_id', companyId)
    .in('status', ['published', 'active'])
    .order('valid_from', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (isMissingSchemaError(error)) return null
    throw error
  }
  return data?.id ?? null
}

async function ensurePublishedPriceBook(input: {
  companyId: string
  publicName: string
  pricePlanId: string | null
  pricePlanVersionId: string | null
  publicPriceText: string | null
  monthlyFeeSek: number | null
  invoiceFeeSek: number | null
  markupOrePerKwh: number | null
  spotMarkupOrePerKwh: number | null
  variableFeeOrePerKwh: number | null
  fixedPriceOrePerKwh: number | null
  validFrom: string | null
  validTo: string | null
}): Promise<CanonicalReferenceResult> {
  const existing = await getActivePriceBook(input.companyId)
  if (existing) return { id: existing, blockers: [], created: false }
  if (!input.pricePlanId || !input.pricePlanVersionId) {
    return { id: null, blockers: ['Prisplan och prisversion krävs innan prislista kan skapas.'], created: false }
  }

  const { data: version, error: versionError } = await supabaseService
    .from('price_plan_versions')
    .select('id,price_plan_id,company_id,version_label,status,valid_from,valid_to')
    .eq('id', input.pricePlanVersionId)
    .maybeSingle()
  if (versionError) throw versionError
  if (!version || version.company_id !== input.companyId || version.price_plan_id !== input.pricePlanId) {
    return { id: null, blockers: ['Prisversionen kan inte användas för valt bolag/prisplan.'], created: false }
  }

  const { data: book, error: bookError } = await supabaseService
    .from('price_books')
    .insert({
      company_id: input.companyId,
      name: `Prislista · ${input.publicName}`.slice(0, 180),
      status: 'published',
      valid_from: input.validFrom ?? version.valid_from ?? new Date().toISOString().slice(0, 10),
      valid_to: input.validTo ?? version.valid_to ?? null,
    })
    .select('id')
    .single()

  if (bookError) {
    if (isMissingSchemaError(bookError)) return { id: null, blockers: ['Tabellen för prislista saknas.'], created: false }
    throw bookError
  }

  const lines = [
    { component_key: 'price_plan_version', value: null, unit: 'reference', metadata: { price_plan_id: input.pricePlanId, price_plan_version_id: input.pricePlanVersionId, version_label: version.version_label, status: version.status } },
    { component_key: 'monthly_fee_sek', value: input.monthlyFeeSek, unit: 'sek_month', metadata: {} },
    { component_key: 'invoice_fee_sek', value: input.invoiceFeeSek, unit: 'sek_invoice', metadata: {} },
    { component_key: 'markup_ore_per_kwh', value: input.markupOrePerKwh, unit: 'ore_per_kwh', metadata: {} },
    { component_key: 'spot_markup_ore_per_kwh', value: input.spotMarkupOrePerKwh, unit: 'ore_per_kwh', metadata: {} },
    { component_key: 'variable_fee_ore_per_kwh', value: input.variableFeeOrePerKwh, unit: 'ore_per_kwh', metadata: {} },
    { component_key: 'fixed_price_ore_per_kwh', value: input.fixedPriceOrePerKwh, unit: 'ore_per_kwh', metadata: {} },
    { component_key: 'public_price_text', value: null, unit: 'text', metadata: { text: input.publicPriceText } },
  ].map((line, index) => ({ price_book_id: book.id, sort_order: (index + 1) * 10, ...line }))

  const { error: lineError } = await supabaseService.from('price_book_lines').insert(lines)
  if (lineError) throw lineError

  return { id: book.id, blockers: [], created: true }
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
  const companyId = text(formData, 'company_id') || null
  let success: string
  try {
    success = (await saveTenantPublicContractOfferActionImpl(formData)).success
  } catch (error) {
    redirectBack(companyId, { error: errorMessage(error) })
  }
  redirectBack(companyId, { success })
}

async function saveTenantPublicContractOfferActionImpl(formData: FormData): Promise<{ success: string }> {
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
  const submittedLegalBundleId = text(formData, 'legal_bundle_id') || null
  const submittedPriceBookId = text(formData, 'price_book_id') || null

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
  await assertSameTenantReference('legal_bundles', submittedLegalBundleId, companyId, 'Juridiskt paket')
  await assertSameTenantReference('price_books', submittedPriceBookId, companyId, 'Prislista')

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

  let legalBundleId = submittedLegalBundleId ?? ((previous as any)?.legal_bundle_id ?? null)
  let priceBookId = submittedPriceBookId ?? ((previous as any)?.price_book_id ?? null)

  let readinessStatus: string | null = null
  let readinessBlockers: string[] = []
  const autoCreatedReferences: string[] = []

  // Perform readiness check against tenant launch state and required references.
  // If the UI has not submitted canonical legal/price references, build safe defaults
  // from already published legal texts and the selected price plan version.
  if (publicationStatus === 'published') {
    if (!legalBundleId) {
      const legal = await ensurePublishedLegalBundle(companyId, publicName)
      legalBundleId = legal.id
      readinessBlockers.push(...legal.blockers)
      if (legal.created) autoCreatedReferences.push('juridiskt paket')
    }
    if (!priceBookId) {
      const priceBook = await ensurePublishedPriceBook({
        companyId,
        publicName,
        pricePlanId,
        pricePlanVersionId,
        publicPriceText,
        monthlyFeeSek: numberValue(formData, 'monthly_fee_sek'),
        invoiceFeeSek: numberValue(formData, 'invoice_fee_sek'),
        markupOrePerKwh: numberValue(formData, 'markup_ore_per_kwh'),
        spotMarkupOrePerKwh: numberValue(formData, 'spot_markup_ore_per_kwh'),
        variableFeeOrePerKwh: numberValue(formData, 'variable_fee_ore_per_kwh'),
        fixedPriceOrePerKwh: numberValue(formData, 'fixed_price_ore_per_kwh'),
        validFrom: dateValue(formData, 'valid_from'),
        validTo: dateValue(formData, 'valid_to'),
      })
      priceBookId = priceBook.id
      readinessBlockers.push(...priceBook.blockers)
      if (priceBook.created) autoCreatedReferences.push('prislista')
    }

    const readiness = await assessPublicOfferReadiness({
      companyId,
      offer: { legal_bundle_id: legalBundleId, price_book_id: priceBookId },
    })
    readinessStatus = readiness.isReady && readinessBlockers.length === 0 ? 'ready' : 'blocked'
    readinessBlockers = [...readinessBlockers, ...readiness.blockers]
    if (readinessBlockers.length > 0 || !readiness.isReady) {
      throw new Error(`Avtalet kan inte publiceras: ${readinessBlockers.join(', ')}.`)
    }
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
    legal_bundle_id: legalBundleId,
    price_book_id: priceBookId,
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
    readiness_status: readinessStatus,
    readiness_blockers: readinessBlockers,
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
    metadata: { publicationStatus, websiteEnabled, issues, readinessStatus, readinessBlockers, pricePlanId, pricePlanVersionId, legalBundleId, priceBookId, autoCreatedReferences },
  })

  revalidatePath(`/admin/companies/${companyId}`)
  revalidatePath('/admin/contracts')
  const suffix = autoCreatedReferences.length > 0 ? ` Auto-skapade: ${autoCreatedReferences.join(', ')}.` : ''
  return { success: `${id ? 'Avtalet uppdaterades' : 'Avtalet skapades'}.${publicationStatus === 'published' ? ' Publicerat och redo för hemsidan.' : ''}${suffix}` }
}
