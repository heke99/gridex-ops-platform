// Extracted from publicContracts.ts; keep public imports on the facade module.
import { supabaseService } from "@/lib/supabase/service"
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth"

import { loadCompanySlugById } from "@/lib/legal/publicLegalDocuments"

import { commonFixedPriceOrePerKwh, fixedAreaPricesFromSnapshot } from "@/lib/pricing/fixedAreaPricing"
import { publicReference } from "@/lib/integrations/publicReferences"

import { type PublicContractPriceOption } from "@/lib/external-contracts/publicContractModel"

import type { PublicContractOffer, PublicLegalTextVersion, WebsiteVisibilityMode } from './publicContracts.part-1'
import { buildPublicLegalBlock, calculationBaseComponents, calculationPricingComponents, clean, componentByCode, componentCalculationInclusion, componentWebsiteVisibilityMode, currentPortfolioPriceBlock, missingSchema, numberOrNull, objectValue, pricingWebsiteVisibility, publicEnergyDirection, publicOfferReference, publicPortfolioMethod, publicPortfolioMonthlyPrices, publicProductionTerms, websiteDisplayPricingComponents, websiteSummaryPricingComponents } from './publicContracts.part-1'
import { resolvePublicContractOffer } from './publicContracts.part-3'

export function publicContractResponse(offer: PublicContractOffer) {
  const offerReference = publicOfferReference(offer);
  const withdrawalVersion =
    typeof offer.metadata?.withdrawal_version === "string"
      ? offer.metadata.withdrawal_version
      : typeof offer.metadata?.withdrawal_terms_version === "string"
        ? offer.metadata.withdrawal_terms_version
        : offer.terms_version;
  const legalVersions = offer.legal_versions ?? [];
  const websiteVisibility = pricingWebsiteVisibility(offer);
  const calculationComponents = calculationPricingComponents(offer, websiteVisibility);
  const displayComponents = websiteDisplayPricingComponents(calculationComponents);
  const summaryComponents = websiteSummaryPricingComponents(calculationComponents);
  const baseComponents = calculationBaseComponents(offer);
  const portfolioManagementComponent = componentByCode(
    calculationComponents,
    "portfolio_management_fee",
  );
  const visibilityMode = (
    code: string,
    fallbackVisible: boolean,
  ): WebsiteVisibilityMode => {
    const component = componentByCode(calculationComponents, code);
    return component
      ? componentWebsiteVisibilityMode(component)
      : fallbackVisible
        ? "visible"
        : "hidden";
  };
  const portfolioMonthlyPrices = publicPortfolioMonthlyPrices(offer);
  const portfolioPrice = currentPortfolioPriceBlock(portfolioMonthlyPrices);
  const portfolioMethod = publicPortfolioMethod(offer);
  const energyDirection = publicEnergyDirection(offer);
  const productionTerms = publicProductionTerms(offer);
  const publicPriceText =
    clean(offer.pricing_snapshot?.public_price_text) ??
    offer.public_price_text ??
    null;
  const customerTypes =
    offer.customer_type === "both"
      ? ["private", "business"]
      : [offer.customer_type];
  const legalBlock = buildPublicLegalBlock({
    companyId: offer.company_id,
    legalVersions,
    termsVersionFallback: offer.terms_version,
    withdrawalVersionFallback: withdrawalVersion,
    tenantSlug: offer.tenant_slug ?? null,
  });
  const vatRate =
    numberOrNull(offer.pricing_snapshot?.vat_rate) ??
    (offer.vat_rate === null || offer.vat_rate === undefined
      ? null
      : offer.vat_rate > 1
        ? offer.vat_rate / 100
        : offer.vat_rate);
  const monthlyFee =
    offer.monthly_fee_sek === null
      ? null
      : { amount: offer.monthly_fee_sek, currency: "SEK", unit: "month", vat_included: false, vat_rate: vatRate, website_visibility: visibilityMode("monthly_fee", websiteVisibility.monthly_fee), calculation_inclusion: "included" };
  const invoiceFee =
    offer.invoice_fee_sek === null
      ? null
      : { amount: offer.invoice_fee_sek, currency: "SEK", unit: "invoice", vat_included: false, vat_rate: vatRate, website_visibility: visibilityMode("invoice_fee", websiteVisibility.invoice_fee), calculation_inclusion: "included" };
  const markup =
    (offer.spot_markup_ore_per_kwh ?? offer.markup_ore_per_kwh) === null
      ? null
      : {
          amount: offer.spot_markup_ore_per_kwh ?? offer.markup_ore_per_kwh,
          unit: "ore_per_kwh",
          vat_included: false,
          vat_rate: vatRate,
          website_visibility: visibilityMode("spot_markup", websiteVisibility.spot_markup),
          calculation_inclusion: "included",
        };
  const areaPricing = fixedAreaPricesFromSnapshot(
    offer.pricing_snapshot,
    offer.fixed_price_ore_per_kwh,
    offer.price_areas ?? [],
  ).map((row) => ({
    price_area: row.price_area,
    energy_price_ore_per_kwh: row.energy_price_ore_per_kwh,
    unit: "ore_per_kwh",
    vat_included: false,
    vat_rate: vatRate,
  }));
  const commonFixedPrice = commonFixedPriceOrePerKwh(
    offer.pricing_snapshot,
    offer.fixed_price_ore_per_kwh,
    offer.price_areas ?? [],
  );
  const fixedPrice =
    commonFixedPrice === null
      ? null
      : {
          amount: commonFixedPrice,
          unit: "ore_per_kwh",
          vat_included: false,
          vat_rate: vatRate,
          website_visibility: visibilityMode("fixed_price", websiteVisibility.fixed_price),
          calculation_inclusion: "included",
        };

  return {
    id: offerReference,
    offer_reference: offerReference,
    contract_offer_id: offerReference,
    publication_reference: offerReference,
    offer_code: offer.offer_code ?? null,
    code: offer.offer_code ?? offer.product_code,
    product_code: offer.product_code,
    name: offer.public_name,
    public_name: offer.public_name,
    description: offer.public_description,
    public_description: offer.public_description,
    contract_type: offer.contract_type,
    energy_direction: energyDirection,
    type: offer.contract_type,
    billing_model: offer.billing_model,
    area_pricing: areaPricing,
    price_options: offer.price_options ?? [],
    customer_type: offer.customer_type,
    customer_types: customerTypes,
    pricing: {
      monthly_fee: monthlyFee,
      invoice_fee: invoiceFee,
      markup,
      spot_markup: markup,
      variable_fee:
        offer.variable_fee_ore_per_kwh === null
          ? null
          : { amount: offer.variable_fee_ore_per_kwh, unit: "ore_per_kwh", vat_included: false, vat_rate: vatRate, website_visibility: visibilityMode("variable_fee", websiteVisibility.variable_fee), calculation_inclusion: "included" },
      fixed_price: fixedPrice,
      area_pricing: areaPricing,
      green_fee:
        offer.green_fee_value === null
          ? null
          : { amount: offer.green_fee_value, mode: offer.green_fee_mode, vat_included: false, vat_rate: vatRate, website_visibility: visibilityMode("green_energy_fee", websiteVisibility.green_energy_fee), calculation_inclusion: "included" },
      spot_share: offer.spot_weight_percent,
      portfolio_share: offer.portfolio_weight_percent,
      fixed_share: offer.fixed_weight_percent,
      public_price_text: publicPriceText,
      visibility: websiteVisibility,
      price_areas: offer.price_areas ?? [],
      vat_rate: vatRate,
      market_price_responsibility: offer.contract_type === "fixed" ? "not_applicable" : "gridex_quote",
      calculation_contract: {
        includes_all_applicable_components: true,
        hidden_components_must_be_calculated: true,
        market_price_supplied_by_gridex: offer.contract_type !== "fixed",
      },
      interval_resolution: clean(offer.pricing_snapshot?.interval_resolution),
      energy_direction: energyDirection,
      production_pricing: productionTerms,
      base_components: baseComponents,
      calculation_components: calculationComponents,
      components: calculationComponents,
      display_components: displayComponents,
      summary_components: summaryComponents,
      electricity_certificate:
        offer.electricity_certificate_ore_per_kwh == null
          ? null
          : {
              amount: offer.electricity_certificate_ore_per_kwh,
              unit: "ore_per_kwh",
              website_visibility: visibilityMode("electricity_certificate", websiteVisibility.electricity_certificate),
              calculation_inclusion: "included",
            },
      start_fee:
        offer.start_fee_sek == null
          ? null
          : {
              amount: offer.start_fee_sek,
              currency: "SEK",
              lifecycle: "once_per_contract",
              website_visibility: visibilityMode("start_fee", websiteVisibility.start_fee),
              calculation_inclusion: "included",
            },
      administration_fee:
        offer.administration_fee_sek == null
          ? null
          : {
              amount: offer.administration_fee_sek,
              currency: "SEK",
              lifecycle: "once_per_contract",
              website_visibility: visibilityMode("administration_fee", websiteVisibility.administration_fee),
              calculation_inclusion: "included",
            },
      break_fee:
        offer.break_fee_sek == null
          ? null
          : {
              amount: offer.break_fee_sek,
              currency: "SEK",
              event: "early_termination",
              website_visibility: visibilityMode("break_fee", websiteVisibility.break_fee),
              calculation_inclusion: "conditional",
            },
      portfolio_price: portfolioPrice,
      portfolio_monthly_prices: portfolioMonthlyPrices,
      portfolio_method: portfolioMethod,
      // Gridex does not expose internal market indications through the public contract feed.
      // Customer-facing calculators use the documented Gridex market-price and quote endpoints.
      portfolio_indications: [],
      portfolio_management_fee: portfolioManagementComponent
          ? {
              amount: numberOrNull(portfolioManagementComponent.amount),
              unit:
                clean(portfolioManagementComponent.unit) ??
                clean(portfolioManagementComponent.calculation_type),
              calculation_base:
                clean(portfolioManagementComponent.calculation_base) ??
                clean(
                  objectValue(portfolioManagementComponent.metadata)
                    .calculation_base,
                ),
              calculation_inclusion: componentCalculationInclusion(
                portfolioManagementComponent,
              ),
              website_visibility: componentWebsiteVisibilityMode(
                portfolioManagementComponent,
              ),
            }
          : offer.portfolio_management_fee_ore_per_kwh == null
            ? null
            : {
                amount: offer.portfolio_management_fee_ore_per_kwh,
                unit: "ore_per_kwh",
                calculation_base: null,
                calculation_inclusion: "included",
                website_visibility: visibilityMode(
                  "portfolio_management_fee",
                  websiteVisibility.portfolio_management_fee,
                ),
              },
      discount:
        offer.discount_value == null
          ? null
          : {
              amount: offer.discount_value,
              unit: offer.discount_unit,
              duration_months: offer.discount_months,
              calculation_inclusion: "included",
              website_visibility: visibilityMode(
                "campaign_discount",
                websiteVisibility.campaign_discount,
              ),
            },
    },
    pricing_snapshot: {
      schema_version: numberOrNull(offer.pricing_snapshot?.schema_version) ?? 5,
      contract_type: offer.contract_type,
      energy_direction: energyDirection,
      customer_type: offer.customer_type,
      price_areas: offer.price_areas ?? [],
      valid_from: offer.valid_from,
      valid_to: offer.valid_to,
      binding_months: offer.binding_months ?? null,
      notice_months: offer.notice_months ?? null,
      automatic_renewal: offer.automatic_renewal === true,
      power_of_attorney_required: offer.power_of_attorney_required !== false,
      base_components: baseComponents,
      price_components: calculationComponents,
      display_price_components: displayComponents,
      summary_price_components: summaryComponents,
      website_visibility: websiteVisibility,
      market_price_responsibility:
        offer.contract_type === "fixed" ? "not_applicable" : "gridex_quote",
      calculation_contract: {
        includes_all_applicable_components: true,
        hidden_components_must_be_calculated: true,
        market_price_supplied_by_gridex: offer.contract_type !== "fixed",
      },
      portfolio_method: portfolioMethod,
      portfolio_monthly_prices: portfolioMonthlyPrices,
      public_price_text: publicPriceText,
      vat_rate: vatRate,
      vat_rate_percent: vatRate === null ? null : vatRate * 100,
      interval_resolution: clean(offer.pricing_snapshot?.interval_resolution),
      production: productionTerms,
    },
    production_pricing: productionTerms,
    // Compatibility field intentionally stays null. Historical final rows and
    // non-binding indications must never masquerade as a future contract price.
    portfolio_price_ore_per_kwh: null,
    portfolio_management_fee: portfolioManagementComponent
        ? {
            amount: numberOrNull(portfolioManagementComponent.amount),
            unit: clean(portfolioManagementComponent.unit),
            calculation_base:
              clean(portfolioManagementComponent.calculation_base) ??
              clean(
                objectValue(portfolioManagementComponent.metadata)
                  .calculation_base,
              ),
            calculation_inclusion: componentCalculationInclusion(
              portfolioManagementComponent,
            ),
            website_visibility: componentWebsiteVisibilityMode(
              portfolioManagementComponent,
            ),
          }
        : null,
    legal: legalBlock,
    monthly_fee_sek: offer.monthly_fee_sek,
    invoice_fee_sek: offer.invoice_fee_sek,
    markup_ore_per_kwh: offer.markup_ore_per_kwh,
    spot_markup_ore_per_kwh: offer.spot_markup_ore_per_kwh,
    variable_fee_ore_per_kwh: offer.variable_fee_ore_per_kwh,
    // Legacy scalar remains populated only when every published SE row has
    // the same value. Area-dependent fixed contracts use area_pricing.
    fixed_price_ore_per_kwh: commonFixedPrice,
    green_fee_mode: offer.green_fee_mode,
    green_fee_value: offer.green_fee_value,
    terms_version: offer.terms_version,
    terms_url: offer.terms_url ?? null,
    public_price_text: publicPriceText,
    binding_months: offer.binding_months ?? null,
    notice_months: offer.notice_months ?? null,
    website_cta_enabled: offer.website_cta_enabled !== false,
    price_areas: offer.price_areas ?? [],
    automatic_renewal: offer.automatic_renewal === true,
    power_of_attorney_required: offer.power_of_attorney_required !== false,
    vat_rate: vatRate,
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
  };
}

export type WebsiteLegalBundle = {
  offer_reference: string;
  bundle_version: string;
  required_types: string[];
  present_types: string[];
  requirements: Array<{
    requirement_code: string;
    document_type: string;
    title: string;
    description: string;
    required: true;
    acceptance_mode: "accept" | "acknowledge";
    document_reference: string;
    document_version: string;
    document_hash: string;
    document_url: string;
    legal_bundle_version_id: string;
    module_keys: string[];
    source_document_ids: string[];
    primary_document_id: string | null;
    sort_order: number;
  }>;
  tenant: {
    name: string | null;
    org_number: string | null;
    brand_name: string | null;
    slug: string | null;
  };
  legal: Record<string, unknown>;
  complete: boolean;
  missing_types: string[];
};

export class WebsiteLegalBundleError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WebsiteLegalBundleError";
    this.status = status;
    this.code = code;
  }
}

export async function buildWebsiteLegalBundle(
  client: IntegrationApiClient,
  offerReference: string,
): Promise<WebsiteLegalBundle> {
  const offer = await resolvePublicContractOffer({
    client,
    offerReference,
    allowLegacyLookup: false,
  });
  if (!offer) {
    throw new WebsiteLegalBundleError(
      404,
      "offer_reference_not_found",
      "Det publicerade avtalet hittades inte.",
    );
  }
  if (
    !offer.contract_product_version_id ||
    !offer.legal_bundle_version_id
  ) {
    throw new WebsiteLegalBundleError(
      422,
      "legal_bundle_not_ready",
      "Avtalet saknar en låst canonical juridikversion.",
    );
  }
  const bundleVersionReference = publicReference(
    "legal_bundle",
    client.company_id,
    offer.legal_bundle_version_id,
  );
  if (!bundleVersionReference) {
    throw new WebsiteLegalBundleError(
      500,
      "legal_bundle_reference_invalid",
      "Juridikversionens externa referens kunde inte skapas.",
    );
  }

  const [companyLegalVersions, productVersion] = await Promise.all([
    listBundleLegalVersions({
      companyId: client.company_id,
      legalBundleVersionId: offer.legal_bundle_version_id,
    }),
    supabaseService
      .from("contract_product_versions")
      .select("id,required_legal_modules")
      .eq("id", offer.contract_product_version_id)
      .maybeSingle(),
  ]);
  if (productVersion.error) throw productVersion.error;
  if (!productVersion.data) {
    throw new WebsiteLegalBundleError(
      422,
      "contract_product_version_not_found",
      "Avtalets canonical produktversion kunde inte verifieras.",
    );
  }
  const tenantSlug = await loadCompanySlugById(client.company_id);
  const versions: PublicLegalTextVersion[] = companyLegalVersions ?? [];
  const legal = buildPublicLegalBlock({
    companyId: client.company_id,
    legalVersions: versions,
    tenantSlug,
  });
  const requiredTypes: string[] = Array.isArray(
    productVersion.data.required_legal_modules,
  )
    ? (productVersion.data.required_legal_modules as unknown[]).map(String)
    : [];
  const presentTypes: string[] = Array.from(
    new Set<string>(versions.map((version) => version.type)),
  ).sort();
  const missingTypes = requiredTypes.filter(
    (type) => !presentTypes.includes(type),
  );
  const customerDocuments = Array.isArray(legal.customer_documents)
    ? legal.customer_documents as Array<Record<string, unknown>>
    : [];
  const requirements = customerDocuments.flatMap((document) => {
    const requirementCode = clean(document.requirement_code);
    const documentType = clean(document.document_type);
    const title = clean(document.title);
    const description = clean(document.description);
    const acceptanceMode = clean(document.acceptance_mode);
    const documentReference = clean(document.document_reference);
    const documentVersion = clean(document.document_version);
    const documentHash = clean(document.document_hash);
    const documentUrl = clean(document.document_url);
    const bundleId = clean(document.legal_bundle_version_id);
    const moduleKeys = Array.isArray(document.module_keys)
      ? document.module_keys.map(String)
      : [];
    const sourceDocumentIds = Array.isArray(document.source_document_ids)
      ? document.source_document_ids.map(String)
      : [];
    const primaryDocumentId = clean(document.primary_document_id);
    const sortOrder = numberOrNull(document.sort_order);
    if (
      !requirementCode ||
      !documentType ||
      !title ||
      !description ||
      !["accept", "acknowledge"].includes(acceptanceMode ?? "") ||
      !documentReference ||
      !documentVersion ||
      !documentHash ||
      !documentUrl ||
      !bundleId ||
      moduleKeys.length === 0 ||
      sourceDocumentIds.length === 0 ||
      sortOrder === null
    ) {
      return [];
    }
    return [{
      requirement_code: requirementCode,
      document_type: documentType,
      title,
      description,
      required: true as const,
      acceptance_mode: acceptanceMode as "accept" | "acknowledge",
      document_reference: documentReference,
      document_version: documentVersion,
      document_hash: documentHash,
      document_url: documentUrl,
      legal_bundle_version_id: bundleId,
      module_keys: moduleKeys,
      source_document_ids: sourceDocumentIds,
      primary_document_id: primaryDocumentId,
      sort_order: sortOrder,
    }];
  });

  const { data, error: companyError } = await supabaseService
    .from("companies")
    .select("id,name,org_number,branding,metadata")
    .eq("id", client.company_id)
    .maybeSingle();
  if (companyError) throw companyError;
  if (!data) {
    throw new WebsiteLegalBundleError(
      404,
      "tenant_not_found",
      "Tenantidentiteten kunde inte verifieras.",
    );
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const branding = (row.branding as Record<string, unknown> | null) ?? null;
  const metadata = (row.metadata as Record<string, unknown> | null) ?? null;
  const brandName =
    [
      branding?.brand_name,
      branding?.display_name,
      branding?.name,
      metadata?.brand_name,
    ].find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    ) ?? null;

  return {
    offer_reference: offerReference,
    bundle_version: bundleVersionReference,
    required_types: requiredTypes,
    present_types: presentTypes,
    requirements,
    tenant: {
      name: (row.name as string | null) ?? null,
      org_number: (row.org_number as string | null) ?? null,
      brand_name: brandName,
      slug: tenantSlug,
    },
    legal,
    complete:
      companyLegalVersions !== null &&
      versions.length > 0 &&
      missingTypes.length === 0 &&
      requirements.length > 0 &&
      requirements.flatMap((requirement) => requirement.module_keys).length ===
        requiredTypes.length,
    missing_types: missingTypes,
  };
}

export function hasExactCanonicalLegalVersions(
  legalVersions: PublicLegalTextVersion[] | null,
): boolean {
  if (!legalVersions || legalVersions.length === 0) return false;
  const bundleIds = new Set<string>();
  const moduleKeys = new Set<string>();
  for (const version of legalVersions) {
    if (
      !version.id ||
      !version.type ||
      !version.version ||
      !version.legal_bundle_version_id ||
      moduleKeys.has(version.type)
    ) {
      return false;
    }
    moduleKeys.add(version.type);
    bundleIds.add(version.legal_bundle_version_id);
  }
  return bundleIds.size === 1;
}

export async function listPublishedLegalVersions(
  companyId: string,
): Promise<PublicLegalTextVersion[] | null> {
  const latestPublication = await supabaseService
    .from("canonical_visible_public_contracts_v")
    .select("legal_bundle_version_id")
    .eq("company_id", companyId)
    .eq("is_archived", false)
    .eq("publication_status", "published")
    .not("legal_bundle_version_id", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    !latestPublication.error &&
    latestPublication.data?.legal_bundle_version_id
  ) {
    return listBundleLegalVersions({
      companyId,
      legalBundleVersionId: String(
        latestPublication.data.legal_bundle_version_id,
      ),
    });
  }
  if (latestPublication.error && !missingSchema(latestPublication.error)) {
    throw latestPublication.error;
  }

  const overrides = await supabaseService
    .from("canonical_tenant_legal_overrides_v")
    .select("id,type,version,title,published_at,metadata")
    .eq("company_id", companyId)
    .eq("status", "published")
    .order("type", { ascending: true });

  if (overrides.error) {
    if (missingSchema(overrides.error)) return null;
    throw overrides.error;
  }

  return (overrides.data ?? []).map((row) => ({
    id: String(row.id),
    type: String(row.type),
    version: String(row.version),
    title: String(row.title),
    published_at: clean(row.published_at),
    content_sha256: clean(objectValue(row.metadata).content_sha256),
    origin: "tenant_override",
  }));
}

export async function listBundleLegalVersions(input: {
  companyId: string;
  legalBundleVersionId: string | null | undefined;
}): Promise<PublicLegalTextVersion[] | null> {
  if (!input.legalBundleVersionId) return null;

  const bundle = await supabaseService
    .from("legal_bundle_versions")
    .select("id,company_id,status,published_at,locked_at")
    .eq("id", input.legalBundleVersionId)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (bundle.error) throw bundle.error;
  if (
    !bundle.data ||
    !bundle.data.locked_at ||
    !["published", "replaced", "archived"].includes(String(bundle.data.status))
  ) {
    return null;
  }

  const documents = await supabaseService
    .from("legal_bundle_version_documents")
    .select(
      "id,legal_bundle_version_id,module_key,title,template_version,content_sha256,origin,created_at,sort_order,unresolved_variables",
    )
    .eq("legal_bundle_version_id", input.legalBundleVersionId)
    .order("sort_order", { ascending: true });

  if (documents.error) throw documents.error;
  const publishedAt = clean(bundle.data.published_at);
  const documentRows = (documents.data ?? []) as Array<
    Record<string, unknown>
  >;
  const exact = documentRows
    .filter(
      (row) =>
        Array.isArray(row.unresolved_variables) &&
        row.unresolved_variables.length === 0,
    )
    .map((row): PublicLegalTextVersion => ({
      id: String(row.id),
      type: String(row.module_key),
      version:
        clean(row.template_version) ??
        publishedAt ??
        clean(row.created_at) ??
        String(row.id),
      title: String(row.title),
      published_at: publishedAt ?? clean(row.created_at),
      content_sha256: clean(row.content_sha256),
      legal_bundle_version_id: String(row.legal_bundle_version_id),
      origin: clean(row.origin) ?? "canonical_bundle_document",
    }));
  return exact.length > 0 ? exact : null;
}

export function isWebsitePublishedRow(row: Record<string, unknown>): boolean {
  const status = clean(row.publication_status);
  const hasStatusColumn = status !== null;
  const archived = row.is_archived === true || status === "archived";
  const websiteEnabled = row.website_enabled !== false;

  if (archived || !websiteEnabled) return false;
  if (hasStatusColumn) return status === "published";
  return row.is_public === true;
}

export type BulkPublicationReadiness = {
  isReady: boolean;
  blockers: string[];
};

export async function loadPublicationReadinessByVersion(
  companyId: string,
  offers: PublicContractOffer[],
): Promise<Map<string, BulkPublicationReadiness>> {
  const ids = Array.from(
    new Set(
      offers
        .map((offer) => clean(offer.contract_publication_version_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (ids.length === 0) return new Map();
  const query = await supabaseService
    .from("contract_publication_readiness_v")
    .select("contract_publication_version_id,company_id,status,locked_at,blockers")
    .eq("company_id", companyId)
    .in("contract_publication_version_id", ids);
  if (query.error) throw query.error;
  return new Map(
    ((query.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const blockers = Array.isArray(row.blockers)
        ? row.blockers.map(clean).filter((value): value is string => Boolean(value))
        : [];
      if (clean(row.status) !== "published")
        blockers.push("Publiceringsversionen är inte publicerad");
      if (!clean(row.locked_at))
        blockers.push("Publiceringsversionen är inte låst");
      return [
        String(row.contract_publication_version_id),
        { isReady: blockers.length === 0, blockers: Array.from(new Set(blockers)) },
      ];
    }),
  );
}

export async function loadLegalVersionsByBundle(
  companyId: string,
  offers: PublicContractOffer[],
): Promise<Map<string, PublicLegalTextVersion[]>> {
  const bundleIds = Array.from(
    new Set(
      offers
        .map((offer) => clean(offer.legal_bundle_version_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (bundleIds.length === 0) return new Map();
  const [bundles, documents] = await Promise.all([
    supabaseService
      .from("legal_bundle_versions")
      .select("id,status,published_at,locked_at")
      .eq("company_id", companyId)
      .in("id", bundleIds),
    supabaseService
      .from("legal_bundle_version_documents")
      .select(
        "id,legal_bundle_version_id,module_key,title,template_version,content_sha256,origin,created_at,sort_order,unresolved_variables",
      )
      .in("legal_bundle_version_id", bundleIds)
      .order("sort_order", { ascending: true }),
  ]);
  if (bundles.error) throw bundles.error;
  if (documents.error) throw documents.error;
  const validBundles = new Map(
    ((bundles.data ?? []) as Array<Record<string, unknown>>)
      .filter(
        (row) =>
          Boolean(clean(row.locked_at)) &&
          ["published", "replaced", "archived"].includes(clean(row.status) ?? ""),
      )
      .map((row) => [String(row.id), clean(row.published_at)]),
  );
  const result = new Map<string, PublicLegalTextVersion[]>();
  for (const row of (documents.data ?? []) as Array<Record<string, unknown>>) {
    const bundleId = String(row.legal_bundle_version_id);
    if (!validBundles.has(bundleId)) continue;
    if (
      !Array.isArray(row.unresolved_variables) ||
      row.unresolved_variables.length > 0
    ) continue;
    const publishedAt = validBundles.get(bundleId) ?? null;
    const version: PublicLegalTextVersion = {
      id: String(row.id),
      type: String(row.module_key),
      version:
        clean(row.template_version) ??
        publishedAt ??
        clean(row.created_at) ??
        String(row.id),
      title: String(row.title),
      published_at: publishedAt ?? clean(row.created_at),
      content_sha256: clean(row.content_sha256),
      legal_bundle_version_id: bundleId,
      origin: clean(row.origin) ?? "canonical_bundle_document",
    };
    result.set(bundleId, [...(result.get(bundleId) ?? []), version]);
  }
  return result;
}

export type PortfolioPricingRows = {
  settlements: Array<Record<string, unknown>>;
};

export type PublicPriceOptionDiagnostic = {
  code: string;
  severity: "blocker" | "warning";
  offer_reference: string;
  price_option_reference: string | null;
  price_area: string | null;
};

export type PublishedPriceOptions = {
  options: PublicContractPriceOption[];
  diagnostics: PublicPriceOptionDiagnostic[];
};

export function stockholmDate(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function dateIsActive(
  today: string,
  validFrom: string | null,
  validTo: string | null,
): boolean {
  return (!validFrom || validFrom <= today) && (!validTo || validTo >= today);
}
