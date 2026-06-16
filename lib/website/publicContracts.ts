import { createHmac } from 'crypto'
import { supabaseService } from '@/lib/supabase/service'
import { assessPublicOfferReadiness } from '@/lib/website/publicOfferReadiness'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'

export type PublicLegalTextVersion = {
  id: string
  type: string
  version: string
  title: string
  published_at: string | null
}

export type PublicContractOffer = {
  id: string
  company_id: string
  price_plan_id: string | null
  price_plan_version_id: string | null
  campaign_version_id: string | null
  legal_bundle_id?: string | null
  price_book_id?: string | null
  offer_code?: string | null
  product_code: string
  public_name: string
  public_description: string | null
  contract_type: string
  billing_model: string | null
  customer_type: 'private' | 'business' | 'both'
  monthly_fee_sek: number | null
  invoice_fee_sek: number | null
  markup_ore_per_kwh: number | null
  spot_markup_ore_per_kwh: number | null
  variable_fee_ore_per_kwh: number | null
  fixed_price_ore_per_kwh: number | null
  green_fee_mode: string | null
  green_fee_value: number | null
  terms_version: string | null
  terms_url?: string | null
  public_price_text?: string | null
  binding_months?: number | null
  notice_months?: number | null
  website_cta_enabled?: boolean
  spot_weight_percent?: number | null
  portfolio_weight_percent?: number | null
  fixed_weight_percent?: number | null
  valid_from: string | null
  valid_to: string | null
  sort_order: number
  legal_versions?: PublicLegalTextVersion[]
  metadata: Record<string, unknown>
}

type PricePlanRow = {
  id: string
  company_id: string
  name: string
  pricing_model: string | null
  status: string | null
  description: string | null
}

type PricePlanVersionRow = {
  id: string
  company_id: string
  price_plan_id: string
  version_label: string | null
  status: string | null
  valid_from: string | null
  valid_to: string | null
  snapshot_json: Record<string, unknown> | null
  price_plans?: PricePlanRow | PricePlanRow[] | null
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST200', 'PGRST201', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist|relationship/i.test(message)
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(numeric) ? numeric : null
}

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function offerReferenceSecret() {
  return clean(process.env.WEBSITE_OFFER_REFERENCE_SECRET)
    ?? clean(process.env.NEXTAUTH_SECRET)
    ?? clean(process.env.SUPABASE_SERVICE_ROLE_KEY)
    ?? 'gridex-public-offer-reference-v1'
}

function base64Url(value: Buffer) {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function publicOfferReference(offer: Pick<PublicContractOffer, 'company_id' | 'id' | 'price_plan_id' | 'price_plan_version_id' | 'product_code'>) {
  const payload = [offer.company_id, offer.id, offer.price_plan_id ?? '', offer.price_plan_version_id ?? '', offer.product_code ?? ''].join('|')
  const digest = createHmac('sha256', offerReferenceSecret()).update(payload).digest()
  return `offer_${base64Url(digest).slice(0, 32)}`
}

function firstPlan(row: PricePlanVersionRow): PricePlanRow | null {
  if (Array.isArray(row.price_plans)) return row.price_plans[0] ?? null
  return row.price_plans ?? null
}

function isCurrentlyValid(row: Pick<PublicContractOffer, 'valid_from' | 'valid_to'>): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return (!row.valid_from || row.valid_from <= today) && (!row.valid_to || row.valid_to >= today)
}

function customerTypeAllowed(offer: PublicContractOffer, customerType?: string | null): boolean {
  if (!customerType || offer.customer_type === 'both') return true
  if (customerType === 'business') return offer.customer_type === 'business'
  return offer.customer_type === 'private'
}

function offerFromSnapshot(row: PricePlanVersionRow): PublicContractOffer | null {
  const plan = firstPlan(row)
  if (!plan || plan.company_id !== row.company_id) return null
  const snapshot = objectValue(row.snapshot_json)
  const isPublic = bool(snapshot.is_public) || bool(snapshot.public) || bool(snapshot.website_visible)
  const planStatus = clean(plan.status) ?? 'draft'
  const versionStatus = clean(row.status) ?? 'draft'

  if (!isPublic && !['published', 'active'].includes(versionStatus)) return null
  if (!['active', 'published', 'approved'].includes(planStatus) && !['active', 'published'].includes(versionStatus)) return null

  const pricingModel = clean(snapshot.pricing_model) ?? clean(snapshot.contract_type) ?? clean(plan.pricing_model) ?? 'spot'
  const offer: PublicContractOffer = {
    id: `${row.id}`,
    offer_code: clean(snapshot.offer_code),
    company_id: row.company_id,
    price_plan_id: row.price_plan_id,
    price_plan_version_id: row.id,
    campaign_version_id: clean(snapshot.campaign_version_id),
    legal_bundle_id: clean(snapshot.legal_bundle_id),
    price_book_id: clean(snapshot.price_book_id),
    product_code: clean(snapshot.product_code) ?? pricingModel,
    public_name: clean(snapshot.public_name) ?? clean(snapshot.name) ?? plan.name,
    public_description: clean(snapshot.public_description) ?? clean(snapshot.description) ?? plan.description,
    contract_type: clean(snapshot.contract_type) ?? pricingModel,
    billing_model: clean(snapshot.billing_model) ?? pricingModel,
    customer_type: (clean(snapshot.customer_type) === 'business' ? 'business' : clean(snapshot.customer_type) === 'private' ? 'private' : 'both'),
    monthly_fee_sek: numberOrNull(snapshot.monthly_fee_sek),
    invoice_fee_sek: numberOrNull(snapshot.invoice_fee_sek),
    markup_ore_per_kwh: numberOrNull(snapshot.markup_ore_per_kwh),
    spot_markup_ore_per_kwh: numberOrNull(snapshot.spot_markup_ore_per_kwh ?? snapshot.markup_ore_per_kwh),
    variable_fee_ore_per_kwh: numberOrNull(snapshot.variable_fee_ore_per_kwh),
    fixed_price_ore_per_kwh: numberOrNull(snapshot.fixed_price_ore_per_kwh),
    green_fee_mode: clean(snapshot.green_fee_mode),
    green_fee_value: numberOrNull(snapshot.green_fee_value),
    terms_version: clean(snapshot.terms_version) ?? clean(row.version_label),
    terms_url: clean(snapshot.terms_url),
    public_price_text: clean(snapshot.public_price_text),
    binding_months: numberOrNull(snapshot.binding_months),
    notice_months: numberOrNull(snapshot.notice_months),
    website_cta_enabled: bool(snapshot.website_cta_enabled) || snapshot.website_cta_enabled === undefined,
    spot_weight_percent: numberOrNull(snapshot.spot_weight_percent),
    portfolio_weight_percent: numberOrNull(snapshot.portfolio_weight_percent),
    fixed_weight_percent: numberOrNull(snapshot.fixed_weight_percent),
    valid_from: row.valid_from,
    valid_to: row.valid_to,
    sort_order: numberOrNull(snapshot.sort_order) ?? 100,
    metadata: {
      source: 'price_plan_versions.snapshot_json',
      price_plan_status: planStatus,
      price_plan_version_status: versionStatus,
      snapshot,
    },
  }

  return isCurrentlyValid(offer) ? offer : null
}

function mapOfferRow(row: Record<string, unknown>): PublicContractOffer {
  return {
    id: String(row.id),
    offer_code: clean(row.offer_code),
    company_id: String(row.company_id),
    price_plan_id: clean(row.price_plan_id),
    price_plan_version_id: clean(row.price_plan_version_id),
    campaign_version_id: clean(row.campaign_version_id),
    legal_bundle_id: clean(row.legal_bundle_id),
    price_book_id: clean(row.price_book_id),
    product_code: clean(row.product_code) ?? 'electricity',
    public_name: clean(row.public_name) ?? clean(row.name) ?? 'Elavtal',
    public_description: clean(row.public_description) ?? clean(row.description),
    contract_type: clean(row.contract_type) ?? 'spot',
    billing_model: clean(row.billing_model),
    customer_type: clean(row.customer_type) === 'business' ? 'business' : clean(row.customer_type) === 'private' ? 'private' : 'both',
    monthly_fee_sek: numberOrNull(row.monthly_fee_sek),
    invoice_fee_sek: numberOrNull(row.invoice_fee_sek),
    markup_ore_per_kwh: numberOrNull(row.markup_ore_per_kwh),
    spot_markup_ore_per_kwh: numberOrNull(row.spot_markup_ore_per_kwh ?? row.markup_ore_per_kwh),
    variable_fee_ore_per_kwh: numberOrNull(row.variable_fee_ore_per_kwh),
    fixed_price_ore_per_kwh: numberOrNull(row.fixed_price_ore_per_kwh),
    green_fee_mode: clean(row.green_fee_mode),
    green_fee_value: numberOrNull(row.green_fee_value),
    terms_version: clean(row.terms_version),
    terms_url: clean(row.terms_url),
    public_price_text: clean(row.public_price_text),
    binding_months: numberOrNull(row.binding_months),
    notice_months: numberOrNull(row.notice_months),
    website_cta_enabled: row.website_cta_enabled !== false,
    spot_weight_percent: numberOrNull(row.spot_weight_percent),
    portfolio_weight_percent: numberOrNull(row.portfolio_weight_percent),
    fixed_weight_percent: numberOrNull(row.fixed_weight_percent),
    valid_from: clean(row.valid_from),
    valid_to: clean(row.valid_to),
    sort_order: numberOrNull(row.sort_order) ?? 100,
    metadata: objectValue(row.metadata),
  }
}

export function publicContractResponse(offer: PublicContractOffer) {
  const offerReference = publicOfferReference(offer)
  const withdrawalVersion = typeof offer.metadata?.withdrawal_version === 'string'
    ? offer.metadata.withdrawal_version
    : typeof offer.metadata?.withdrawal_terms_version === 'string'
      ? offer.metadata.withdrawal_terms_version
      : offer.terms_version
  const legalVersions = offer.legal_versions ?? []
  const legalVersionByType = new Map(legalVersions.map((version) => [version.type, version.version]))
  const monthlyFee = offer.monthly_fee_sek === null ? null : { amount: offer.monthly_fee_sek, currency: 'SEK', unit: 'month' }
  const invoiceFee = offer.invoice_fee_sek === null ? null : { amount: offer.invoice_fee_sek, currency: 'SEK', unit: 'invoice' }
  const markup = (offer.spot_markup_ore_per_kwh ?? offer.markup_ore_per_kwh) === null
    ? null
    : { amount: offer.spot_markup_ore_per_kwh ?? offer.markup_ore_per_kwh, unit: 'ore_per_kwh' }
  const fixedPrice = offer.fixed_price_ore_per_kwh === null ? null : { amount: offer.fixed_price_ore_per_kwh, unit: 'ore_per_kwh' }

  return {
    id: offerReference,
    offer_reference: offerReference,
    contract_offer_id: offerReference,
    offer_code: offer.offer_code ?? null,
    code: offer.offer_code ?? offer.product_code,
    product_code: offer.product_code,
    name: offer.public_name,
    public_name: offer.public_name,
    description: offer.public_description,
    public_description: offer.public_description,
    contract_type: offer.contract_type,
    type: offer.contract_type,
    billing_model: offer.billing_model,
    customer_type: offer.customer_type,
    pricing: {
      monthly_fee: monthlyFee,
      invoice_fee: invoiceFee,
      markup,
      spot_markup: markup,
      variable_fee: offer.variable_fee_ore_per_kwh === null ? null : { amount: offer.variable_fee_ore_per_kwh, unit: 'ore_per_kwh' },
      fixed_price: fixedPrice,
      green_fee: offer.green_fee_value === null ? null : { amount: offer.green_fee_value, mode: offer.green_fee_mode },
      spot_share: offer.spot_weight_percent,
      portfolio_share: offer.portfolio_weight_percent,
      fixed_share: offer.fixed_weight_percent,
      public_price_text: offer.public_price_text ?? null,
    },
    legal: {
      terms_version: legalVersionByType.get('terms') ?? offer.terms_version,
      privacy_policy_version: legalVersionByType.get('privacy_policy') ?? null,
      withdrawal_version: legalVersionByType.get('withdrawal') ?? withdrawalVersion,
      power_of_attorney_version: legalVersionByType.get('power_of_attorney') ?? null,
      price_terms_version: legalVersionByType.get('price_terms') ?? null,
      power_of_attorney_required: legalVersions.some((version) => version.type === 'power_of_attorney'),
    },
    monthly_fee_sek: offer.monthly_fee_sek,
    invoice_fee_sek: offer.invoice_fee_sek,
    markup_ore_per_kwh: offer.markup_ore_per_kwh,
    spot_markup_ore_per_kwh: offer.spot_markup_ore_per_kwh,
    variable_fee_ore_per_kwh: offer.variable_fee_ore_per_kwh,
    fixed_price_ore_per_kwh: offer.fixed_price_ore_per_kwh,
    green_fee_mode: offer.green_fee_mode,
    green_fee_value: offer.green_fee_value,
    terms_version: offer.terms_version,
    terms_url: offer.terms_url ?? null,
    public_price_text: offer.public_price_text ?? null,
    binding_months: offer.binding_months ?? null,
    notice_months: offer.notice_months ?? null,
    website_cta_enabled: offer.website_cta_enabled !== false,
    mix: {
      spot_weight_percent: offer.spot_weight_percent ?? null,
      portfolio_weight_percent: offer.portfolio_weight_percent ?? null,
      fixed_weight_percent: offer.fixed_weight_percent ?? null,
    },
    withdrawal_version: withdrawalVersion,
    legal_versions: legalVersions,
    valid_from: offer.valid_from,
    valid_to: offer.valid_to,
    is_public: true,
    is_active: true,
    sort_order: offer.sort_order,
  }
}


const REQUIRED_PUBLIC_LEGAL_TYPES = ['terms', 'privacy_policy', 'withdrawal', 'power_of_attorney', 'price_terms'] as const

function hasAllRequiredLegalVersions(legalVersions: PublicLegalTextVersion[] | null): boolean {
  if (legalVersions === null) return true
  const required = new Set<string>(REQUIRED_PUBLIC_LEGAL_TYPES)
  for (const row of legalVersions) required.delete(row.type)
  return required.size === 0
}

async function listPublishedLegalVersions(companyId: string): Promise<PublicLegalTextVersion[] | null> {
  const { data, error } = await supabaseService
    .from('legal_text_versions')
    .select('id,type,version,title,published_at')
    .eq('company_id', companyId)
    .eq('status', 'published')
    .in('type', [...REQUIRED_PUBLIC_LEGAL_TYPES])
    .order('type', { ascending: true })

  if (error) {
    if (missingSchema(error)) return null
    throw error
  }

  return (data ?? []) as PublicLegalTextVersion[]
}

async function listBundleLegalVersions(input: {
  companyId: string
  legalBundleId: string | null | undefined
  companyFallback: PublicLegalTextVersion[] | null
}): Promise<PublicLegalTextVersion[] | null> {
  if (!input.legalBundleId) return input.companyFallback

  const items = await supabaseService
    .from('legal_bundle_items')
    .select('legal_text_version_id,type,sort_order')
    .eq('legal_bundle_id', input.legalBundleId)
    .order('sort_order', { ascending: true })

  if (items.error) {
    if (missingSchema(items.error)) return input.companyFallback
    throw items.error
  }

  const itemRows = (items.data ?? []) as Array<{ legal_text_version_id?: string | null }>
  const ids = Array.from(new Set(itemRows.map((row) => clean(row.legal_text_version_id)).filter(Boolean))) as string[]
  if (ids.length === 0) return input.companyFallback

  const versions = await supabaseService
    .from('legal_text_versions')
    .select('id,type,version,title,published_at')
    .eq('company_id', input.companyId)
    .eq('status', 'published')
    .in('id', ids)

  if (versions.error) {
    if (missingSchema(versions.error)) return input.companyFallback
    throw versions.error
  }

  const versionRows = (versions.data ?? []) as PublicLegalTextVersion[]
  if (hasAllRequiredLegalVersions(versionRows)) return versionRows
  return input.companyFallback
}

async function offerWithLegalVersions(input: {
  offer: PublicContractOffer
  companyLegalVersions: PublicLegalTextVersion[] | null
}): Promise<PublicContractOffer | null> {
  const legalVersions = await listBundleLegalVersions({
    companyId: input.offer.company_id,
    legalBundleId: input.offer.legal_bundle_id,
    companyFallback: input.companyLegalVersions,
  })
  if (!hasAllRequiredLegalVersions(legalVersions)) return null
  return {
    ...input.offer,
    legal_versions: legalVersions ?? undefined,
    metadata: {
      ...input.offer.metadata,
      legal_versions: legalVersions ?? undefined,
    },
  }
}

function isWebsitePublishedRow(row: Record<string, unknown>): boolean {
  const status = clean(row.publication_status)
  const hasStatusColumn = status !== null
  const archived = row.is_archived === true || status === 'archived'
  const websiteEnabled = row.website_enabled !== false

  if (archived || !websiteEnabled) return false
  if (hasStatusColumn) return status === 'published'
  return row.is_public === true
}

async function appendReadyOffer(input: {
  result: PublicContractOffer[]
  offer: PublicContractOffer
  companyLegalVersions: PublicLegalTextVersion[] | null
  customerType?: string | null
}) {
  if (!isCurrentlyValid(input.offer) || !customerTypeAllowed(input.offer, input.customerType)) return

  const readiness = await assessPublicOfferReadiness({
    companyId: input.offer.company_id,
    offer: input.offer as unknown as { legal_bundle_id?: string | null; price_book_id?: string | null },
  })
  if (!readiness.isReady) return

  const withLegal = await offerWithLegalVersions({ offer: input.offer, companyLegalVersions: input.companyLegalVersions })
  if (!withLegal) return

  withLegal.metadata = { ...withLegal.metadata, readiness_status: 'ready', readiness_blockers: [] }
  input.result.push(withLegal)
}

export async function listPublicContractOffers(input: {
  client: IntegrationApiClient
  customerType?: string | null
}): Promise<PublicContractOffer[]> {
  const companyLegalVersions = await listPublishedLegalVersions(input.client.company_id)
  const primary = await supabaseService
    .from('public_contract_offers')
    .select('*')
    .eq('company_id', input.client.company_id)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true })
    .order('public_name', { ascending: true })

  if (!primary.error) {
    const result: PublicContractOffer[] = []
    const offers = ((primary.data ?? []) as Array<Record<string, unknown>>)
      .filter(isWebsitePublishedRow)
      .map(mapOfferRow)

    for (const offer of offers) {
      await appendReadyOffer({ result, offer, companyLegalVersions, customerType: input.customerType })
    }
    return result
  }

  if (!missingSchema(primary.error)) throw primary.error

  const fallback = await supabaseService
    .from('price_plan_versions')
    .select('id,company_id,price_plan_id,version_label,status,valid_from,valid_to,snapshot_json,price_plans(id,company_id,name,pricing_model,status,description)')
    .eq('company_id', input.client.company_id)
    .in('status', ['active', 'published'])
    .order('valid_from', { ascending: false, nullsFirst: false })

  if (fallback.error) {
    if (missingSchema(fallback.error)) return []
    throw fallback.error
  }

  const result: PublicContractOffer[] = []
  const offers = ((fallback.data ?? []) as PricePlanVersionRow[])
    .map(offerFromSnapshot)
    .filter((offer): offer is PublicContractOffer => Boolean(offer))

  for (const offer of offers) {
    await appendReadyOffer({ result, offer, companyLegalVersions, customerType: input.customerType })
  }
  return result.sort((a, b) => a.sort_order - b.sort_order || a.public_name.localeCompare(b.public_name, 'sv'))
}

export async function resolvePublicContractOffer(input: {
  client: IntegrationApiClient
  offerReference?: string | null
  pricePlanVersionId?: string | null
  pricePlanId?: string | null
  contractOfferId?: string | null
  productCode?: string | null
  customerType?: string | null
}): Promise<PublicContractOffer | null> {
  const offers = await listPublicContractOffers({ client: input.client, customerType: input.customerType })
  return offers.find((offer) => {
    if (input.offerReference && publicOfferReference(offer) === input.offerReference) return true
    if (input.contractOfferId && publicOfferReference(offer) === input.contractOfferId) return true
    if (input.contractOfferId && offer.id === input.contractOfferId) return true
    if (input.pricePlanVersionId && offer.price_plan_version_id === input.pricePlanVersionId) return true
    if (input.pricePlanId && offer.price_plan_id === input.pricePlanId) return true
    if (input.productCode && offer.product_code === input.productCode) return true
    return false
  }) ?? null
}
