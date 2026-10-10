import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { loadCompanySlugById } from '@/lib/legal/publicLegalDocuments'
import { assessCanonicalInvoiceFee } from '@/lib/pricing/canonicalInvoiceFee'
import { supabaseService } from '@/lib/supabase/service'

import type { PublicContractOffer } from './publicContracts.part-1'
import {
  clean,
  customerTypeAllowed,
  mapOfferRow,
  publicOfferReference,
} from './publicContracts.part-1'
import {
  hasExactCanonicalLegalVersions,
  isWebsitePublishedRow,
  loadLegalVersionsByBundle,
  loadPublicationReadinessByVersion,
} from './publicContracts.part-2'
import {
  CANONICAL_DELIVERY_READINESS_SELECT,
  CANONICAL_VISIBLE_CONTRACT_SELECT,
  PublicContractFeedConsistencyError,
  canonicalGraphStructurallyConsistent,
  listPublicContractOffers,
  loadPortfolioPricingByOffer,
  loadPublishedPriceOptions,
  portfolioPricingForOffer,
  type CanonicalPublicContractDeliveryReadiness,
} from './publicContracts.part-3'

type ResolvePublicContractOfferInput = {
  client: IntegrationApiClient
  offerReference?: string | null
  pricePlanVersionId?: string | null
  pricePlanId?: string | null
  contractOfferId?: string | null
  productCode?: string | null
  customerType?: string | null
  allowLegacyLookup?: boolean
  /**
   * Publication channel the caller sells through. Defaults to `website`.
   * `api` resolves only canonical API-channel publications (Partner API).
   */
  channel?: 'website' | 'api'
}

function consistencyError(
  offerReference: string,
  publicationVersionId: string | null,
  diagnosticCode: string,
): PublicContractFeedConsistencyError {
  return new PublicContractFeedConsistencyError([
    {
      canonical_offer_reference: offerReference,
      publication_version_id: publicationVersionId,
      diagnostic_code: diagnosticCode,
    },
  ])
}

async function legacyLookup(input: ResolvePublicContractOfferInput): Promise<PublicContractOffer | null> {
  const offers = await listPublicContractOffers({
    client: input.client,
    customerType: input.customerType,
  })
  const offerReference = clean(input.offerReference)
  if (offerReference) {
    return offers.find((offer) => publicOfferReference(offer) === offerReference) ?? null
  }
  if (!input.allowLegacyLookup) return null

  return (
    offers.find((offer) => {
      if (input.contractOfferId && offer.id === input.contractOfferId) return true
      if (input.pricePlanVersionId && offer.price_plan_version_id === input.pricePlanVersionId) return true
      if (input.pricePlanId && offer.price_plan_id === input.pricePlanId) return true
      if (input.productCode && offer.product_code === input.productCode) return true
      return false
    }) ?? null
  )
}

/**
 * Exact offer_reference fast path used by website quote/application flows.
 * It evaluates the same canonical publication, legal, pricing and graph guards
 * as the full public feed, but only loads the requested publication instead of
 * constructing every visible offer for the tenant.
 */
export async function resolvePublicContractOffer(
  input: ResolvePublicContractOfferInput,
): Promise<PublicContractOffer | null> {
  if (input.channel === 'api') return resolveApiChannelContractOffer(input)
  const offerReference = clean(input.offerReference)
  if (!offerReference) return legacyLookup(input)

  const companyId = input.client.company_id
  const [tenantSlug, readinessResponse, primaryResponse] = await Promise.all([
    loadCompanySlugById(companyId),
    supabaseService
      .from('canonical_public_contract_delivery_readiness_v')
      .select(CANONICAL_DELIVERY_READINESS_SELECT)
      .eq('company_id', companyId)
      .eq('channel', 'website')
      .eq('offer_reference', offerReference)
      .limit(2),
    supabaseService
      .from('canonical_visible_public_contracts_v')
      .select(CANONICAL_VISIBLE_CONTRACT_SELECT)
      .eq('company_id', companyId)
      .eq('is_archived', false)
      .eq('canonical_offer_reference', offerReference)
      .limit(2),
  ])

  if (readinessResponse.error) throw readinessResponse.error
  if (primaryResponse.error) throw primaryResponse.error

  const readinessRows = (readinessResponse.data ?? []) as unknown as CanonicalPublicContractDeliveryReadiness[]
  const sourceRows = (primaryResponse.data ?? []) as unknown as Array<Record<string, unknown>>

  // Historical publications can predate canonical_offer_reference. Preserve
  // compatibility for those rare rows while keeping canonical traffic fast.
  if (readinessRows.length === 0 && sourceRows.length === 0) return legacyLookup(input)

  if (readinessRows.length > 1 || sourceRows.length > 1) {
    throw consistencyError(offerReference, null, 'TARGET_OFFER_REFERENCE_DUPLICATE')
  }

  const readiness = readinessRows.find((row) => {
    const customerType = clean(row.customer_type)
    return (
      !input.customerType ||
      customerType === 'both' ||
      customerType === input.customerType
    )
  }) ?? null

  const offer = sourceRows
    .filter(isWebsitePublishedRow)
    .map(mapOfferRow)
    .find((candidate) => customerTypeAllowed(candidate, input.customerType)) ?? null

  const publicationVersionId = clean(offer?.contract_publication_version_id) ?? clean(readiness?.publication_version_id)

  if (!offer && readiness?.visible === true) {
    throw consistencyError(
      offerReference,
      publicationVersionId,
      'CANONICAL_VISIBLE_ROW_MISSING_FROM_FEED_SOURCE',
    )
  }
  if (offer && (!readiness || readiness.visible !== true || clean(readiness.public_offer_id) !== offer.id)) {
    throw consistencyError(
      offerReference,
      publicationVersionId,
      'FEED_ROW_NOT_CANONICALLY_VISIBLE',
    )
  }
  if (!offer || !readiness) return null

  if (!canonicalGraphStructurallyConsistent(readiness)) {
    throw consistencyError(offerReference, publicationVersionId, 'PUBLICATION_GRAPH_INCONSISTENT')
  }
  if (!publicationVersionId) {
    throw consistencyError(offerReference, null, 'PUBLICATION_VERSION_MISSING')
  }

  const [readinessByVersion, legalByBundle, portfolioByOffer, priceOptionsByPublication] =
    await Promise.all([
      loadPublicationReadinessByVersion(companyId, [offer]),
      loadLegalVersionsByBundle(companyId, [offer]),
      loadPortfolioPricingByOffer(companyId, [offer]),
      loadPublishedPriceOptions(companyId, [offer]),
    ])

  if (readinessByVersion.get(publicationVersionId)?.isReady !== true) {
    throw consistencyError(offerReference, publicationVersionId, 'PUBLICATION_READINESS_INCONSISTENT')
  }

  const publishedOptions = priceOptionsByPublication.get(publicationVersionId)
  if (!publishedOptions || publishedOptions.options.length === 0) {
    throw consistencyError(offerReference, publicationVersionId, 'PUBLICATION_PRICE_OPTIONS_INCONSISTENT')
  }

  const invoiceFeeReadiness = assessCanonicalInvoiceFee({
    rowAmount: offer.invoice_fee_sek,
    snapshot: offer.pricing_snapshot,
  })
  if (invoiceFeeReadiness.status !== 'ready') {
    throw consistencyError(offerReference, publicationVersionId, 'INVOICE_FEE_CONFIGURATION_INCONSISTENT')
  }

  const legalBundleVersionId = clean(offer.legal_bundle_version_id)
  const legalVersions = legalBundleVersionId
    ? legalByBundle.get(legalBundleVersionId) ?? null
    : null
  if (!hasExactCanonicalLegalVersions(legalVersions)) {
    throw consistencyError(offerReference, publicationVersionId, 'PUBLICATION_LEGAL_BUNDLE_INCONSISTENT')
  }

  const portfolioPricing = portfolioPricingForOffer(offer, portfolioByOffer)
  return {
    ...offer,
    tenant_slug: tenantSlug ?? null,
    legal_versions: legalVersions ?? undefined,
    price_options: publishedOptions.options,
    pricing_snapshot: {
      ...(offer.pricing_snapshot ?? {}),
      portfolio_monthly_prices: portfolioPricing.historicalFinal,
      portfolio_indications: [],
    },
    metadata: {
      ...offer.metadata,
      legal_versions: legalVersions ?? undefined,
      readiness_status: 'ready',
      readiness_blockers: [],
    },
  }
}

/**
 * API-channel resolution (OPS API review F23). API publications have no legacy
 * public_contract_offers row, so the website feed views can never return them.
 * The canonical API delivery-readiness row is the visibility gate (tenant,
 * assignment, channel, legal, pricing and validity), and the locked
 * publication version, price plan version, product version and source offer
 * provide the commercial content. Website-only publications have no API
 * readiness row and are therefore never resolved here.
 */
async function resolveApiChannelContractOffer(
  input: ResolvePublicContractOfferInput,
): Promise<PublicContractOffer | null> {
  const offerReference = clean(input.offerReference)
  if (!offerReference) return null
  const companyId = input.client.company_id

  const readinessResponse = await supabaseService
    .from('canonical_public_contract_delivery_readiness_v')
    .select(CANONICAL_DELIVERY_READINESS_SELECT)
    .eq('company_id', companyId)
    .eq('channel', 'api')
    .eq('offer_reference', offerReference)
    .limit(2)
  if (readinessResponse.error) throw readinessResponse.error
  const readinessRows = (readinessResponse.data ?? []) as unknown as CanonicalPublicContractDeliveryReadiness[]
  if (readinessRows.length > 1) throw consistencyError(offerReference, null, 'TARGET_OFFER_REFERENCE_DUPLICATE')
  const readiness = readinessRows[0]
  if (!readiness || readiness.visible !== true) return null
  const readinessCustomerType = clean(readiness.customer_type)
  if (input.customerType && readinessCustomerType !== 'both' && readinessCustomerType !== input.customerType) return null

  const publicationVersionId = clean(readiness.publication_version_id)
  if (!publicationVersionId) throw consistencyError(offerReference, null, 'PUBLICATION_VERSION_MISSING')
  if (!canonicalGraphStructurallyConsistent(readiness)) {
    throw consistencyError(offerReference, publicationVersionId, 'PUBLICATION_GRAPH_INCONSISTENT')
  }
  const sourceOfferId = clean((readiness as unknown as Record<string, unknown>).source_contract_offer_id)

  const [tenantSlug, versionResponse, sourceResponse] = await Promise.all([
    loadCompanySlugById(companyId),
    supabaseService
      .from('contract_publication_versions')
      .select('id,channel,status,locked_at,offer_reference,customer_type,valid_from,valid_to,price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,contract_product_version_id,energy_direction')
      .eq('id', publicationVersionId)
      .maybeSingle(),
    sourceOfferId
      ? supabaseService
          .from('contract_offers')
          .select('id,company_id,name,description,contract_type,customer_type,monthly_fee_sek,invoice_fee_sek,spot_markup_ore_per_kwh,variable_fee_ore_per_kwh,fixed_price_ore_per_kwh,green_fee_mode,green_fee_value,terms_version,default_binding_months,default_notice_months,start_fee_sek,admin_fee_sek,break_fee_sek,discount_value,discount_unit,discount_months,vat_rate,automatic_renewal,power_of_attorney_required,version_series_id,contract_product_id,legal_bundle_id,energy_direction')
          .eq('id', sourceOfferId)
          .eq('company_id', companyId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (versionResponse.error) throw versionResponse.error
  if (sourceResponse.error) throw sourceResponse.error
  const version = versionResponse.data as Record<string, unknown> | null
  const source = sourceResponse.data as Record<string, unknown> | null
  if (
    !version ||
    clean(version.channel) !== 'api' ||
    clean(version.status) !== 'published' ||
    !clean(version.locked_at) ||
    clean(version.offer_reference) !== offerReference ||
    !source
  ) {
    throw consistencyError(offerReference, publicationVersionId, 'API_PUBLICATION_SOURCE_INCONSISTENT')
  }

  const pricePlanVersionId = clean(version.price_plan_version_id)
  const productVersionId = clean(version.contract_product_version_id)
  const [planResponse, productResponse] = await Promise.all([
    pricePlanVersionId
      ? supabaseService
          .from('price_plan_versions')
          .select('id,snapshot_json,locked_at')
          .eq('id', pricePlanVersionId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    productVersionId
      ? supabaseService
          .from('contract_product_versions')
          .select('id,contract_type,price_areas')
          .eq('id', productVersionId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (planResponse.error) throw planResponse.error
  if (productResponse.error) throw productResponse.error
  const plan = planResponse.data as Record<string, unknown> | null
  const product = productResponse.data as Record<string, unknown> | null
  if (!plan || !clean(plan.locked_at) || !product) {
    throw consistencyError(offerReference, publicationVersionId, 'API_PUBLICATION_SOURCE_INCONSISTENT')
  }

  const offer = mapOfferRow({
    ...source,
    id: publicationVersionId,
    company_id: companyId,
    public_name: source.name,
    public_description: source.description,
    customer_type: clean(version.customer_type) ?? source.customer_type,
    contract_type: clean(product.contract_type) ?? source.contract_type,
    markup_ore_per_kwh: source.spot_markup_ore_per_kwh,
    binding_months: source.default_binding_months,
    notice_months: source.default_notice_months,
    administration_fee_sek: source.admin_fee_sek,
    price_areas: product.price_areas,
    price_plan_id: version.price_plan_id,
    price_plan_version_id: pricePlanVersionId,
    price_book_id: version.price_book_id,
    legal_bundle_version_id: version.legal_bundle_version_id,
    contract_product_version_id: productVersionId,
    contract_publication_version_id: publicationVersionId,
    canonical_offer_reference: offerReference,
    canonical_pricing_snapshot: plan.snapshot_json,
    canonical_metadata: { canonical_offer_reference: offerReference, source_of_truth: 'contract_publication_versions', channel: 'api' },
    valid_from: version.valid_from,
    valid_to: version.valid_to,
    website_cta_enabled: false,
  })

  const [readinessByVersion, legalByBundle, portfolioByOffer, priceOptionsByPublication] = await Promise.all([
    loadPublicationReadinessByVersion(companyId, [offer]),
    loadLegalVersionsByBundle(companyId, [offer]),
    loadPortfolioPricingByOffer(companyId, [offer]),
    loadPublishedPriceOptions(companyId, [offer]),
  ])
  if (readinessByVersion.get(publicationVersionId)?.isReady !== true) {
    throw consistencyError(offerReference, publicationVersionId, 'PUBLICATION_READINESS_INCONSISTENT')
  }
  const publishedOptions = priceOptionsByPublication.get(publicationVersionId)
  if (!publishedOptions || publishedOptions.options.length === 0) {
    throw consistencyError(offerReference, publicationVersionId, 'PUBLICATION_PRICE_OPTIONS_INCONSISTENT')
  }
  const invoiceFeeReadiness = assessCanonicalInvoiceFee({ rowAmount: offer.invoice_fee_sek, snapshot: offer.pricing_snapshot })
  if (invoiceFeeReadiness.status !== 'ready') {
    throw consistencyError(offerReference, publicationVersionId, 'INVOICE_FEE_CONFIGURATION_INCONSISTENT')
  }
  const legalBundleVersionId = clean(offer.legal_bundle_version_id)
  const legalVersions = legalBundleVersionId ? legalByBundle.get(legalBundleVersionId) ?? null : null
  if (!hasExactCanonicalLegalVersions(legalVersions)) {
    throw consistencyError(offerReference, publicationVersionId, 'PUBLICATION_LEGAL_BUNDLE_INCONSISTENT')
  }

  return {
    ...offer,
    tenant_slug: tenantSlug ?? null,
    legal_versions: legalVersions ?? undefined,
    price_options: publishedOptions.options,
    pricing_snapshot: {
      ...(offer.pricing_snapshot ?? {}),
      portfolio_monthly_prices: portfolioPricingForOffer(offer, portfolioByOffer).historicalFinal,
      portfolio_indications: [],
    },
    metadata: {
      ...offer.metadata,
      legal_versions: legalVersions ?? undefined,
      readiness_status: 'ready',
      readiness_blockers: [],
    },
  }
}
