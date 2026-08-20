// Extracted from publicContracts.ts; keep public imports on the facade module.
import { supabaseService } from "@/lib/supabase/service"
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth"
import { assessCanonicalInvoiceFee, type CanonicalInvoiceFeeReadiness } from "@/lib/pricing/canonicalInvoiceFee"
import { loadCompanySlugById } from "@/lib/legal/publicLegalDocuments"




import { type PublicContractPriceOption, type PublicContractPriceOptionAreaPrice } from "@/lib/external-contracts/publicContractModel"
import { canonicalSwedishPriceArea } from "@/lib/pricing/types"
import type { PublicContractOffer } from './publicContracts.part-1'
import { clean, customerTypeAllowed, mapOfferRow, numberOrNull, objectValue, publicOfferReference } from './publicContracts.part-1'
import type { PortfolioPricingRows, PublicPriceOptionDiagnostic, PublishedPriceOptions } from './publicContracts.part-2'
import { dateIsActive, hasExactCanonicalLegalVersions, isWebsitePublishedRow, loadLegalVersionsByBundle, loadPublicationReadinessByVersion, stockholmDate } from './publicContracts.part-2'

export async function loadPublishedPriceOptions(
  companyId: string,
  offers: PublicContractOffer[],
): Promise<Map<string, PublishedPriceOptions>> {
  const publicationIds = Array.from(
    new Set(
      offers
        .map((offer) => clean(offer.contract_publication_version_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (publicationIds.length === 0) return new Map();

  const optionQuery = await supabaseService
    .from("contract_price_options")
    .select(
      "id,company_id,contract_product_version_id,price_plan_version_id,contract_publication_version_id,option_reference,option_code,customer_name,contract_type,customer_type,binding_months,notice_months,auto_renew_enabled,renewal_term_months,is_default,selection_required,valid_from,valid_to,earliest_start_date,latest_start_date,status,sort_order,metadata",
    )
    .eq("company_id", companyId)
    .in("contract_publication_version_id", publicationIds)
    .order("sort_order", { ascending: true })
    .order("option_reference", { ascending: true });
  if (optionQuery.error) throw optionQuery.error;

  const optionRows = (optionQuery.data ?? []) as Array<Record<string, unknown>>;
  const optionIds = optionRows.map((row) => String(row.id));
  const areaRows =
    optionIds.length === 0
      ? []
      : await (async () => {
          const result = await supabaseService
            .from("contract_price_option_area_prices")
            .select(
              "contract_price_option_id,price_row_reference,price_area,amount,unit,valid_from,valid_to,status",
            )
            .eq("company_id", companyId)
            .in("contract_price_option_id", optionIds)
            .order("price_area", { ascending: true });
          if (result.error) throw result.error;
          return (result.data ?? []) as Array<Record<string, unknown>>;
        })();

  const areasByOption = new Map<string, Array<Record<string, unknown>>>();
  for (const row of areaRows) {
    const optionId = String(row.contract_price_option_id);
    areasByOption.set(optionId, [...(areasByOption.get(optionId) ?? []), row]);
  }

  const today = stockholmDate();
  const byPublication = new Map<string, PublishedPriceOptions>();
  for (const offer of offers) {
    const publicationId = clean(offer.contract_publication_version_id);
    if (!publicationId) continue;
    const offerReference = publicOfferReference(offer);
    const diagnostics: PublicPriceOptionDiagnostic[] = [];
    const validOptions: PublicContractPriceOption[] = [];
    const rows = optionRows.filter(
      (row) => String(row.contract_publication_version_id) === publicationId,
    );

    if (rows.length === 0) {
      diagnostics.push({
        code: "price_option_missing",
        severity: "blocker",
        offer_reference: offerReference,
        price_option_reference: null,
        price_area: null,
      });
    }

    const seenReferences = new Set<string>();
    for (const row of rows) {
      const optionReference = clean(row.option_reference);
      const code = (issue: string, priceArea: string | null = null) =>
        diagnostics.push({
          code: issue,
          severity: "blocker",
          offer_reference: offerReference,
          price_option_reference: optionReference,
          price_area: priceArea,
        });
      if (!optionReference) {
        code("price_option_reference_missing");
        continue;
      }
      if (seenReferences.has(optionReference)) {
        code("price_option_reference_duplicate");
        continue;
      }
      seenReferences.add(optionReference);
      if (clean(row.status) !== "active") {
        code(
          clean(row.status) === "paused"
            ? "price_option_paused"
            : "price_option_inactive",
        );
        continue;
      }
      const validFrom = clean(row.valid_from);
      const validTo = clean(row.valid_to);
      if (validFrom && validFrom > today) {
        code("price_option_not_yet_valid");
        continue;
      }
      if (validTo && validTo < today) {
        code("price_option_expired");
        continue;
      }
      if (
        clean(row.contract_product_version_id) !==
        clean(offer.contract_product_version_id)
      ) {
        code("price_option_offer_mismatch");
        continue;
      }
      if (
        clean(row.price_plan_version_id) !==
        clean(offer.price_plan_version_id)
      ) {
        code("price_option_publication_mismatch");
        continue;
      }
      const customerType = clean(row.customer_type);
      if (
        !customerType ||
        !["private", "business", "both"].includes(customerType) ||
        (offer.customer_type !== "both" &&
          customerType !== "both" &&
          customerType !== offer.customer_type)
      ) {
        code("price_option_customer_type_mismatch");
        continue;
      }
      if (clean(row.contract_type) !== offer.contract_type) {
        code("price_option_contract_type_mismatch");
        continue;
      }

      const publicAreas: PublicContractPriceOptionAreaPrice[] = [];
      const seenAreas = new Set<string>();
      for (const areaRow of areasByOption.get(String(row.id)) ?? []) {
        const priceArea = canonicalSwedishPriceArea(areaRow.price_area);
        if (!priceArea) {
          code("price_area_price_unit_invalid", clean(areaRow.price_area));
          continue;
        }
        if (seenAreas.has(priceArea)) {
          code("price_area_price_duplicate", priceArea);
          continue;
        }
        seenAreas.add(priceArea);
        if (clean(areaRow.status) !== "active") {
          code("price_area_price_inactive", priceArea);
          continue;
        }
        const areaValidFrom = clean(areaRow.valid_from);
        const areaValidTo = clean(areaRow.valid_to);
        if (!dateIsActive(today, areaValidFrom, areaValidTo)) {
          code("price_area_price_expired", priceArea);
          continue;
        }
        const amount = numberOrNull(areaRow.amount);
        const unit = clean(areaRow.unit);
        if (amount === null || amount <= 0 || !["ore_per_kwh", "sek_per_kwh"].includes(unit ?? "")) {
          code("price_area_price_unit_invalid", priceArea);
          continue;
        }
        const areaReference = clean(areaRow.price_row_reference);
        if (!areaReference) {
          code("price_area_price_missing", priceArea);
          continue;
        }
        publicAreas.push({
          area_price_reference: areaReference,
          price_area: priceArea,
          energy_price_ore_per_kwh:
            unit === "sek_per_kwh" ? amount * 100 : amount,
          unit: "ore_per_kwh",
          valid_from: areaValidFrom,
          valid_to: areaValidTo,
        });
      }
      if (offer.contract_type === "fixed") {
        const requiredAreas =
          offer.price_areas && offer.price_areas.length > 0
            ? offer.price_areas
                .map((area) => canonicalSwedishPriceArea(area))
                .filter((area): area is NonNullable<typeof area> => Boolean(area))
            : ["SE1", "SE2", "SE3", "SE4"];
        const missingAreas = requiredAreas.filter(
          (area) => !publicAreas.some((row) => row.price_area === area),
        );
        for (const area of missingAreas) code("price_area_price_missing", area);
        if (missingAreas.length > 0) continue;
      }

      const optionMetadata = objectValue(row.metadata);
      const contractType = offer.contract_type as PublicContractPriceOption["contract_type"];
      if (
        ![
          "fixed",
          "variable_monthly",
          "variable_hourly",
          "variable_quarterly",
          "portfolio",
          "mixed",
        ].includes(contractType)
      ) {
        code("price_option_contract_type_invalid", offer.contract_type);
        continue;
      }
      const rawResolution =
        clean(optionMetadata.resolution) ??
        (contractType === "variable_hourly"
          ? "hourly"
          : contractType === "variable_quarterly"
            ? "quarterly"
            : "monthly");
      if (!["monthly", "hourly", "quarterly"].includes(rawResolution)) {
        code("price_option_resolution_invalid", rawResolution);
        continue;
      }
      const resolution = rawResolution as PublicContractPriceOption["resolution"];
      validOptions.push({
        price_option_reference: optionReference,
        option_code: clean(row.option_code) ?? optionReference,
        customer_name: clean(row.customer_name) ?? optionReference,
        price_type: contractType,
        contract_type: contractType,
        customer_type: customerType as PublicContractPriceOption["customer_type"],
        resolution,
        currency: "SEK",
        unit: "ore_per_kwh",
        fixed_price: numberOrNull(optionMetadata.fixed_price),
        markup: numberOrNull(optionMetadata.markup),
        monthly_fee: numberOrNull(optionMetadata.monthly_fee),
        binding_months: numberOrNull(row.binding_months) ?? 0,
        notice_months: numberOrNull(row.notice_months) ?? 0,
        auto_renew_enabled: row.auto_renew_enabled === true,
        renewal_term_months: numberOrNull(row.renewal_term_months),
        is_default: row.is_default === true,
        default: row.is_default === true,
        selection_required: row.selection_required === true,
        valid_from: validFrom,
        valid_to: validTo,
        earliest_start_date: clean(row.earliest_start_date),
        latest_start_date: clean(row.latest_start_date),
        area_prices: publicAreas,
      });
    }

    if (validOptions.length > 0) {
      const defaults = validOptions.filter((option) => option.is_default);
      if (defaults.length === 0) {
        diagnostics.push({
          code: "price_option_default_missing",
          severity: "blocker",
          offer_reference: offerReference,
          price_option_reference: null,
          price_area: null,
        });
      } else if (defaults.length > 1) {
        diagnostics.push({
          code: "price_option_default_duplicate",
          severity: "blocker",
          offer_reference: offerReference,
          price_option_reference: null,
          price_area: null,
        });
      }
      if (
        new Set(validOptions.map((option) => option.selection_required)).size >
        1
      ) {
        diagnostics.push({
          code: "price_option_selection_policy_inconsistent",
          severity: "blocker",
          offer_reference: offerReference,
          price_option_reference: null,
          price_area: null,
        });
      }
    }
    const globalBlocker = diagnostics.some(
      (item) =>
        [
          "price_option_default_missing",
          "price_option_default_duplicate",
          "price_option_selection_policy_inconsistent",
        ].includes(item.code),
    );
    byPublication.set(publicationId, {
      options: globalBlocker ? [] : validOptions,
      diagnostics,
    });
  }
  return byPublication;
}

export function portfolioPricingKey(portfolioId: string, pricePlanVersionId: string) {
  return `${portfolioId}:${pricePlanVersionId}`;
}

export async function loadPortfolioPricingByOffer(
  companyId: string,
  offers: PublicContractOffer[],
): Promise<Map<string, PortfolioPricingRows>> {
  const targets = offers.flatMap((offer) => {
    if (
      !offer.price_plan_version_id ||
      !["portfolio", "mixed"].includes(offer.contract_type)
    )
      return [];
    const portfolioId = clean(
      objectValue(offer.pricing_snapshot?.portfolio_method).portfolio_id,
    );
    return portfolioId
      ? [{ portfolioId, pricePlanVersionId: offer.price_plan_version_id }]
      : [];
  });
  const portfolioIds = Array.from(
    new Set(targets.map((target) => target.portfolioId)),
  );
  const versionIds = Array.from(
    new Set(targets.map((target) => target.pricePlanVersionId)),
  );
  if (portfolioIds.length === 0 || versionIds.length === 0) return new Map();

  const settlements = await supabaseService
    .from("portfolio_monthly_settlements")
    .select(
      "portfolio_id,price_plan_version_id,delivery_month,price_area_code,portfolio_price_ore_per_kwh,status",
    )
    .eq("company_id", companyId)
    .in("portfolio_id", portfolioIds)
    .in("price_plan_version_id", versionIds)
    .eq("is_current", true)
    .in("status", ["final", "locked"])
    .order("delivery_month", { ascending: false })
    .order("price_area_code", { ascending: true });
  if (settlements.error) throw settlements.error;

  const result = new Map<string, PortfolioPricingRows>();
  for (const target of targets) {
    result.set(
      portfolioPricingKey(target.portfolioId, target.pricePlanVersionId),
      { settlements: [] },
    );
  }
  for (const row of (settlements.data ?? []) as Array<
    Record<string, unknown>
  >) {
    const key = portfolioPricingKey(
      String(row.portfolio_id),
      String(row.price_plan_version_id),
    );
    const current = result.get(key);
    if (current && current.settlements.length < 48)
      current.settlements.push(row);
  }
  return result;
}

export function portfolioPricingForOffer(
  offer: PublicContractOffer,
  pricingByKey: Map<string, PortfolioPricingRows>,
): { historicalFinal: Record<string, unknown>[] } {
  if (
    !offer.price_plan_version_id ||
    !["portfolio", "mixed"].includes(offer.contract_type)
  )
    return { historicalFinal: [] };
  const method = objectValue(offer.pricing_snapshot?.portfolio_method);
  const portfolioId = clean(method.portfolio_id);
  if (!portfolioId) return { historicalFinal: [] };
  const rows = pricingByKey.get(
    portfolioPricingKey(portfolioId, offer.price_plan_version_id),
  ) ?? { settlements: [] };
  const displayRules = objectValue(method.display_rules);
  const showHistorical = displayRules.show_historical_final !== false;
  return {
    historicalFinal: showHistorical
      ? rows.settlements.map((row) => ({
          period_month: row.delivery_month,
          price_area_code: row.price_area_code,
          amount: row.portfolio_price_ore_per_kwh,
          unit: "ore_per_kwh",
          vat_included: false,
          status: row.status,
        }))
      : [],
  };
}

export type CanonicalPublicContractDeliveryReadiness = {
  public_offer_id: string | null
  offer_reference: string | null
  publication_version_id: string | null
  customer_type: string | null
  visible: boolean
  blockers: unknown
  canonical_graph_consistent: boolean
  forward_publication_link_valid: boolean
  reverse_legacy_link_valid: boolean
  company_chain_valid: boolean
  tenant_assignment_valid: boolean
  channel_graph_valid: boolean
  product_version_valid: boolean
  source_offer_consistent: boolean
  snapshot_hash_valid: boolean
  energy_direction_valid: boolean
  contract_type_valid: boolean
  successor_chain_valid: boolean
}

export type PublicationGraphIntegrity = {
  public_contract_offer_id: string;
  canonical_graph_consistent: boolean;
  forward_publication_link_valid: boolean;
  reverse_legacy_link_valid: boolean;
  company_chain_valid: boolean;
  tenant_assignment_valid: boolean;
  channel_valid: boolean;
  product_version_valid: boolean;
  source_offer_consistent: boolean;
  publication_active: boolean;
  snapshot_hash_valid: boolean;
  energy_direction_valid: boolean;
  contract_type_valid: boolean;
  successor_chain_valid: boolean;
};

export function canonicalGraphStructurallyConsistent(
  graph:
    | PublicationGraphIntegrity
    | CanonicalPublicContractDeliveryReadiness
    | null
    | undefined,
): boolean {
  const channelValid =
    "channel_graph_valid" in (graph ?? {})
      ? (graph as CanonicalPublicContractDeliveryReadiness)
          .channel_graph_valid
      : (graph as PublicationGraphIntegrity | null | undefined)?.channel_valid;
  return Boolean(
    graph?.canonical_graph_consistent === true &&
      graph.forward_publication_link_valid &&
      graph.reverse_legacy_link_valid &&
      graph.company_chain_valid &&
      graph.tenant_assignment_valid &&
      channelValid &&
      graph.product_version_valid &&
      graph.source_offer_consistent &&
      graph.snapshot_hash_valid &&
      graph.energy_direction_valid &&
      graph.contract_type_valid &&
      graph.successor_chain_valid,
  );
}

export type PublicContractFeedConsistencyIssue = {
  canonical_offer_reference: string
  publication_version_id: string | null
  diagnostic_code: string
}

export class PublicContractFeedConsistencyError extends Error {
  readonly code = "PUBLIC_CONTRACT_FEED_INCONSISTENT"
  readonly issues: PublicContractFeedConsistencyIssue[]

  constructor(issues: PublicContractFeedConsistencyIssue[]) {
    super("One or more canonical visible public contracts could not be constructed safely")
    this.name = "PublicContractFeedConsistencyError"
    this.issues = issues
  }
}

export const CANONICAL_DELIVERY_READINESS_SELECT = [
  'company_id','source_contract_offer_id','name','product_code','customer_type','contract_type','channel',
  'supported_areas_valid','invoice_fee_sek','pricing_snapshot','external_tenant_reference','company_status',
  'assignment_id','assignment_status','website_publication_allowed','api_publication_allowed','channel_id',
  'channel_status','publication_id','publication_status','publication_version_id','offer_reference',
  'publication_version_status','locked_at','valid_from','valid_to','content_sha256','publication_snapshot',
  'snapshot_source_contract_offer_id','public_offer_id','website_enabled','website_cta_enabled','is_public',
  'website_publication_status','invoice_fee_component_count','invoice_fee_canonical_count',
  'invoice_fee_component_amount','invoice_fee_ready','price_option_count','default_count',
  'required_selection_count','invalid_option_count','duplicate_option_count','legal_ready','missing_area_count',
  'channel_state','blockers','forward_publication_link_valid','reverse_legacy_link_valid','company_chain_valid',
  'tenant_assignment_valid','channel_graph_valid','product_version_valid','source_offer_consistent',
  'snapshot_hash_valid','energy_direction_valid','contract_type_valid','successor_chain_valid',
  'canonical_graph_consistent','tenant_ready','assignment_ready','channel_ready','publication_ready',
  'publication_version_ready','canonical_invoice_fee_ready','price_options_ready','canonical_legal_ready',
  'date_window_valid','public_offer_ready','visible',
].join(',')

export const CANONICAL_VISIBLE_CONTRACT_SELECT = [
  'id','company_id','price_plan_id','price_plan_version_id','campaign_version_id','product_code','public_name',
  'public_description','contract_type','billing_model','customer_type','monthly_fee_sek','invoice_fee_sek',
  'markup_ore_per_kwh','spot_markup_ore_per_kwh','variable_fee_ore_per_kwh','fixed_price_ore_per_kwh',
  'green_fee_mode','green_fee_value','terms_version','valid_from','valid_to','is_public','is_archived','sort_order',
  'metadata','created_at','updated_at','offer_code','publication_status','website_enabled','website_cta_enabled',
  'public_price_text','terms_url','binding_months','notice_months','spot_weight_percent',
  'portfolio_weight_percent','fixed_weight_percent','price_area','published_at','archived_at','readiness_issues',
  'publication_notes','legal_bundle_id','price_book_id','readiness_status','readiness_blockers',
  'electricity_certificate_ore_per_kwh','start_fee_sek','administration_fee_sek','break_fee_sek',
  'portfolio_management_fee_ore_per_kwh','discount_value','discount_unit','discount_months','vat_rate',
  'price_areas','automatic_renewal','power_of_attorney_required','version_series_id','version_number',
  'supersedes_offer_id','contract_product_id','contract_product_version_id','legal_bundle_version_id',
  'contract_publication_version_id','canonical_offer_reference','publication_locked_at',
  'publication_content_sha256','canonical_pricing_snapshot','canonical_metadata','source_contract_offer_id',
  'lifecycle_status','closed_at','close_reason','energy_direction','website_publication_allowed','website_available_now',
].join(',')

export async function loadCanonicalDeliveryReadiness(
  companyId: string,
  channel: "website" | "api",
): Promise<CanonicalPublicContractDeliveryReadiness[]> {
  const query = await supabaseService
    .from("canonical_public_contract_delivery_readiness_v")
    .select(CANONICAL_DELIVERY_READINESS_SELECT)
    .eq("company_id", companyId)
    .eq("channel", channel);
  if (query.error) throw query.error;
  return (query.data ?? []) as unknown as CanonicalPublicContractDeliveryReadiness[];
}

export async function listPublicContractOffers(input: {
  client: IntegrationApiClient;
  customerType?: string | null;
}): Promise<PublicContractOffer[]> {
  const tenantSlug = await loadCompanySlugById(input.client.company_id);
  const deliveryReadiness = await loadCanonicalDeliveryReadiness(
    input.client.company_id,
    "website",
  );
  const primary = await supabaseService
    .from("canonical_visible_public_contracts_v")
    .select(CANONICAL_VISIBLE_CONTRACT_SELECT)
    .eq("company_id", input.client.company_id)
    .eq("is_archived", false)
    .order("sort_order", { ascending: true })
    .order("public_name", { ascending: true });

  if (primary.error) throw primary.error;
  const offers = ((primary.data ?? []) as unknown as Array<Record<string, unknown>>)
    .filter(isWebsitePublishedRow)
    .map(mapOfferRow);
  const readinessForRequest = deliveryReadiness.filter((row) => {
    const customerType = clean(row.customer_type);
    return (
      !input.customerType ||
      customerType === "both" ||
      customerType === input.customerType
    );
  });
  const canonicalVisibleById = new Map(
    readinessForRequest
      .filter((row) => row.visible === true && clean(row.public_offer_id))
      .map((row) => [clean(row.public_offer_id) as string, row]),
  );
  const primaryById = new Map(offers.map((offer) => [offer.id, offer]));
  const sourceIssues: PublicContractFeedConsistencyIssue[] = [];
  for (const [publicOfferId, readiness] of canonicalVisibleById) {
    if (!primaryById.has(publicOfferId)) {
      sourceIssues.push({
        canonical_offer_reference:
          clean(readiness.offer_reference) ?? publicOfferId,
        publication_version_id:
          clean(readiness.publication_version_id) ?? null,
        diagnostic_code: "CANONICAL_VISIBLE_ROW_MISSING_FROM_FEED_SOURCE",
      });
    }
  }
  for (const offer of offers) {
    if (
      customerTypeAllowed(offer, input.customerType) &&
      !canonicalVisibleById.has(offer.id)
    ) {
      sourceIssues.push({
        canonical_offer_reference:
          clean(offer.canonical_offer_reference) ?? offer.id,
        publication_version_id:
          clean(offer.contract_publication_version_id) ?? null,
        diagnostic_code: "FEED_ROW_NOT_CANONICALLY_VISIBLE",
      });
    }
  }
  if (sourceIssues.length > 0) {
    throw new PublicContractFeedConsistencyError(sourceIssues);
  }
  const graphIntegrity = new Map(
    readinessForRequest
      .filter((row) => clean(row.public_offer_id))
      .map((row) => [clean(row.public_offer_id) as string, row]),
  );
  const [
    readinessByVersion,
    legalByBundle,
    portfolioByOffer,
    priceOptionsByPublication,
  ] = await Promise.all([
    loadPublicationReadinessByVersion(input.client.company_id, offers),
    loadLegalVersionsByBundle(input.client.company_id, offers),
    loadPortfolioPricingByOffer(input.client.company_id, offers),
    loadPublishedPriceOptions(input.client.company_id, offers),
  ]);

  const result: PublicContractOffer[] = [];
  const consistencyIssues: PublicContractFeedConsistencyIssue[] = [];
  const reject = (
    offer: PublicContractOffer,
    diagnosticCode: string,
  ) => {
    consistencyIssues.push({
      canonical_offer_reference:
        publicOfferReference(offer) ?? offer.offer_code ?? offer.id,
      publication_version_id:
        clean(offer.contract_publication_version_id) ?? null,
      diagnostic_code: diagnosticCode,
    });
  };

  for (const offer of offers) {
    if (!customerTypeAllowed(offer, input.customerType)) continue;

    if (!canonicalGraphStructurallyConsistent(graphIntegrity.get(offer.id))) {
      reject(offer, "PUBLICATION_GRAPH_INCONSISTENT");
      continue;
    }
    const publicationVersionId = clean(offer.contract_publication_version_id);
    if (!publicationVersionId) {
      reject(offer, "PUBLICATION_VERSION_MISSING");
      continue;
    }
    if (readinessByVersion.get(publicationVersionId)?.isReady !== true) {
      reject(offer, "PUBLICATION_READINESS_INCONSISTENT");
      continue;
    }
    const publishedOptions = priceOptionsByPublication.get(publicationVersionId);
    if (!publishedOptions || publishedOptions.options.length === 0) {
      reject(offer, "PUBLICATION_PRICE_OPTIONS_INCONSISTENT");
      continue;
    }
    const invoiceFeeReadiness = assessCanonicalInvoiceFee({
      rowAmount: offer.invoice_fee_sek,
      snapshot: offer.pricing_snapshot,
    });
    if (invoiceFeeReadiness.status !== "ready") {
      reject(offer, "INVOICE_FEE_CONFIGURATION_INCONSISTENT");
      continue;
    }
    const legalBundleVersionId = clean(offer.legal_bundle_version_id);
    const legalVersions = legalBundleVersionId
      ? legalByBundle.get(legalBundleVersionId) ?? null
      : null;
    if (!hasExactCanonicalLegalVersions(legalVersions)) {
      reject(offer, "PUBLICATION_LEGAL_BUNDLE_INCONSISTENT");
      continue;
    }
    const portfolioPricing = portfolioPricingForOffer(offer, portfolioByOffer);
    result.push({
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
        readiness_status: "ready",
        readiness_blockers: [],
      },
    });
  }

  if (consistencyIssues.length > 0) {
    throw new PublicContractFeedConsistencyError(consistencyIssues);
  }
  return result;
}

export async function resolvePublicContractOffer(input: {
  client: IntegrationApiClient;
  offerReference?: string | null;
  pricePlanVersionId?: string | null;
  pricePlanId?: string | null;
  contractOfferId?: string | null;
  productCode?: string | null;
  customerType?: string | null;
  allowLegacyLookup?: boolean;
}): Promise<PublicContractOffer | null> {
  const offers = await listPublicContractOffers({
    client: input.client,
    customerType: input.customerType,
  });
  const offerReference = clean(input.offerReference);
  if (offerReference) {
    return (
      offers.find((offer) => publicOfferReference(offer) === offerReference) ??
      null
    );
  }

  if (!input.allowLegacyLookup) return null;

  return (
    offers.find((offer) => {
      if (input.contractOfferId && offer.id === input.contractOfferId)
        return true;
      if (
        input.pricePlanVersionId &&
        offer.price_plan_version_id === input.pricePlanVersionId
      )
        return true;
      if (input.pricePlanId && offer.price_plan_id === input.pricePlanId)
        return true;
      if (input.productCode && offer.product_code === input.productCode)
        return true;
      return false;
    }) ?? null
  );
}

export type PublicContractOfferDiagnostic = {
  id: string | null;
  name: string;
  product_code: string;
  publication_status: string | null;
  channel_state: string;
  website_enabled: boolean;
  valid_from: string | null;
  valid_to: string | null;
  customer_type: string;
  visible: boolean;
  blockers: string[];
  offer_reference: string | null;
  graph: Omit<PublicationGraphIntegrity, "public_contract_offer_id"> | null;
  pricing_readiness: {
    invoice_fee: CanonicalInvoiceFeeReadiness;
    price_options: {
      ready: boolean;
      diagnostics: PublicPriceOptionDiagnostic[];
    };
  };
  readiness: {
    canonical_graph_consistent: boolean;
    forward_publication_link_valid: boolean;
    reverse_legacy_link_valid: boolean;
    company_chain_valid: boolean;
    tenant_assignment_valid: boolean;
    channel_valid: boolean;
    source_offer_consistent: boolean;
    snapshot_hash_valid: boolean;
    energy_direction_valid: boolean;
    contract_type_valid: boolean;
    successor_chain_valid: boolean;
    pricing_ready: boolean;
    legal_ready: boolean;
    invoice_fee_ready: boolean;
    publication_active: boolean;
    application_acceptance_ready: boolean;
    tenant_ready: boolean;
    assignment_ready: boolean;
    channel_ready: boolean;
    publication_ready: boolean;
    publication_version_ready: boolean;
    date_window_valid: boolean;
    public_offer_ready: boolean;
    price_options_ready: boolean;
  };
};

export async function diagnosePublicContractOffers(input: {
  client: IntegrationApiClient;
  customerType?: string | null;
  channel?: "website" | "api";
}): Promise<{
  total: number;
  visible: number;
  hidden: number;
  offers: PublicContractOfferDiagnostic[];
}> {
  const channel = input.channel ?? "website";
  const query = await supabaseService
    .from("canonical_public_contract_delivery_readiness_v")
    .select(CANONICAL_DELIVERY_READINESS_SELECT)
    .eq("company_id", input.client.company_id)
    .eq("channel", channel)
    .order("name", { ascending: true });
  if (query.error) throw query.error;

  const rows = ((query.data ?? []) as unknown as Array<Record<string, unknown>>).filter(
    (row) => {
      if (!input.customerType) return true;
      const customerType = clean(row.customer_type);
      return customerType === "both" || customerType === input.customerType;
    },
  );
  const diagnostics: PublicContractOfferDiagnostic[] = rows.map((row) => {
    const blockers = Array.isArray(row.blockers)
      ? row.blockers.map(clean).filter((value): value is string => Boolean(value))
      : [];
    const visible = row.visible === true && blockers.length === 0;
    const publicationVersionExists = Boolean(clean(row.publication_version_id));
    const tenantReady = clean(row.company_status) === "active";
    const assignmentValid =
      Boolean(clean(row.assignment_id)) &&
      clean(row.assignment_status) === "active";
    const channelValid =
      Boolean(clean(row.channel_id)) && clean(row.channel_status) === "active";
    const publicationReady =
      clean(row.publication_status) === "published";
    const publicationVersionReady =
      publicationVersionExists &&
      clean(row.publication_version_status) === "published" &&
      Boolean(clean(row.locked_at));
    const dateWindowValid =
      !blockers.includes("PUBLICATION_NOT_YET_VALID") &&
      !blockers.includes("PUBLICATION_EXPIRED");
    const priceOptionsReady =
      Number(row.price_option_count ?? 0) > 0 &&
      !blockers.some(
        (blocker) =>
          blocker.startsWith("PUBLICATION_PRICE_OPTION") ||
          blocker === "PUBLICATION_AREA_PRICES_MISSING",
      );
    const legalReady = row.legal_ready === true;
    const invoiceFeeReadiness = assessCanonicalInvoiceFee({
      rowAmount: row.invoice_fee_sek,
      snapshot: objectValue(row.pricing_snapshot),
    });
    const pricingDiagnostics: PublicPriceOptionDiagnostic[] = blockers
      .filter(
        (blocker) =>
          blocker.includes("PRICE_OPTION") || blocker.includes("AREA_PRICES"),
      )
      .map((code) => ({
        code,
        severity: "blocker" as const,
        offer_reference:
          clean(row.offer_reference) ?? "missing_offer_reference",
        price_option_reference: null,
        price_area: null,
      }));
    const publicationVersionId = clean(row.publication_version_id);
    const graph = publicationVersionId
      ? {
          canonical_graph_consistent:
            row.canonical_graph_consistent === true,
          forward_publication_link_valid:
            row.forward_publication_link_valid === true,
          reverse_legacy_link_valid:
            row.reverse_legacy_link_valid === true,
          company_chain_valid: row.company_chain_valid === true,
          tenant_assignment_valid: row.tenant_assignment_valid === true,
          channel_valid: row.channel_graph_valid === true,
          product_version_valid: row.product_version_valid === true,
          source_offer_consistent: row.source_offer_consistent === true,
          publication_active: publicationReady && publicationVersionReady,
          snapshot_hash_valid: row.snapshot_hash_valid === true,
          energy_direction_valid: row.energy_direction_valid === true,
          contract_type_valid: row.contract_type_valid === true,
          successor_chain_valid: row.successor_chain_valid === true,
        }
      : null;
    return {
      id: clean(row.offer_reference),
      name: clean(row.name) ?? "Elavtal",
      product_code: clean(row.product_code) ?? "electricity",
      publication_status: clean(row.publication_version_status),
      channel_state: clean(row.channel_state) ?? "error",
      website_enabled: channel === "api" || row.website_enabled === true,
      valid_from: clean(row.valid_from),
      valid_to: clean(row.valid_to),
      customer_type: clean(row.customer_type) ?? "both",
      visible,
      blockers: Array.from(new Set(blockers)),
      offer_reference: clean(row.offer_reference),
      graph,
      pricing_readiness: {
        invoice_fee: invoiceFeeReadiness,
        price_options: {
          ready: priceOptionsReady,
          diagnostics: pricingDiagnostics,
        },
      },
      readiness: {
        canonical_graph_consistent:
          graph?.canonical_graph_consistent ?? false,
        forward_publication_link_valid:
          graph?.forward_publication_link_valid ?? false,
        reverse_legacy_link_valid:
          graph?.reverse_legacy_link_valid ?? false,
        company_chain_valid: graph?.company_chain_valid ?? false,
        tenant_assignment_valid:
          graph?.tenant_assignment_valid ?? assignmentValid,
        channel_valid: graph?.channel_valid ?? channelValid,
        source_offer_consistent: graph?.source_offer_consistent ?? false,
        snapshot_hash_valid: graph?.snapshot_hash_valid ?? false,
        energy_direction_valid: graph?.energy_direction_valid ?? false,
        contract_type_valid: graph?.contract_type_valid ?? false,
        successor_chain_valid: graph?.successor_chain_valid ?? false,
        publication_active: graph?.publication_active ?? publicationReady,
        tenant_ready: tenantReady,
        assignment_ready: assignmentValid,
        channel_ready: channelValid,
        publication_ready: publicationReady,
        publication_version_ready: publicationVersionReady,
        date_window_valid: dateWindowValid,
        public_offer_ready:
          channel === "api" ||
          (Boolean(clean(row.public_offer_id)) && row.website_enabled === true),
        pricing_ready:
          priceOptionsReady && invoiceFeeReadiness.status === "ready",
        price_options_ready: priceOptionsReady,
        legal_ready: legalReady,
        invoice_fee_ready: invoiceFeeReadiness.status === "ready",
        application_acceptance_ready: legalReady,
      },
    };
  });
  const visible = diagnostics.filter((item) => item.visible).length;
  return {
    total: diagnostics.length,
    visible,
    hidden: diagnostics.length - visible,
    offers: diagnostics,
  };
}
