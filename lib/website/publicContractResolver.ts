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
