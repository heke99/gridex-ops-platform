import { supabaseService } from "@/lib/supabase/service";
import { assessPublicOfferReadiness } from "@/lib/website/publicOfferReadiness";
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth";
import {
  assessCanonicalInvoiceFee,
  type CanonicalInvoiceFeeReadiness,
} from "@/lib/pricing/canonicalInvoiceFee";
import {
  buildPublicLegalUrl,
  loadCompanySlugById,
} from "@/lib/legal/publicLegalDocuments";
import { normalizeCustomerType } from "@/lib/customers/normalizeCustomerType";

export type PublicLegalTextVersion = {
  id: string;
  type: string;
  version: string;
  title: string;
  published_at: string | null;
  content_sha256?: string | null;
  legal_bundle_version_id?: string | null;
  origin?: string | null;
};

export type PublicContractOffer = {
  id: string;
  company_id: string;
  price_plan_id: string | null;
  price_plan_version_id: string | null;
  campaign_version_id: string | null;
  legal_bundle_id?: string | null;
  price_book_id?: string | null;
  offer_code?: string | null;
  product_code: string;
  public_name: string;
  public_description: string | null;
  contract_type: string;
  billing_model: string | null;
  customer_type: "private" | "business" | "both";
  monthly_fee_sek: number | null;
  invoice_fee_sek: number | null;
  markup_ore_per_kwh: number | null;
  spot_markup_ore_per_kwh: number | null;
  variable_fee_ore_per_kwh: number | null;
  fixed_price_ore_per_kwh: number | null;
  green_fee_mode: string | null;
  green_fee_value: number | null;
  terms_version: string | null;
  terms_url?: string | null;
  public_price_text?: string | null;
  binding_months?: number | null;
  notice_months?: number | null;
  website_cta_enabled?: boolean;
  spot_weight_percent?: number | null;
  portfolio_weight_percent?: number | null;
  fixed_weight_percent?: number | null;
  valid_from: string | null;
  valid_to: string | null;
  sort_order: number;
  legal_versions?: PublicLegalTextVersion[];
  tenant_slug?: string | null;
  metadata: Record<string, unknown>;
  canonical_offer_reference?: string | null;
  contract_product_id?: string | null;
  contract_product_version_id?: string | null;
  contract_publication_version_id?: string | null;
  legal_bundle_version_id?: string | null;
  pricing_snapshot?: Record<string, unknown>;
  electricity_certificate_ore_per_kwh?: number | null;
  start_fee_sek?: number | null;
  administration_fee_sek?: number | null;
  break_fee_sek?: number | null;
  portfolio_management_fee_ore_per_kwh?: number | null;
  discount_value?: number | null;
  discount_unit?: string | null;
  discount_months?: number | null;
  vat_rate?: number | null;
  price_areas?: string[];
  automatic_renewal?: boolean;
  power_of_attorney_required?: boolean;
};

// Builds the extended legal block exposed to tenant websites. OPS is the source
// of truth: per type it returns whether acceptance is required, the published
// version label, the version id, and a public OPS-hosted document URL. Existing
// keys are preserved for backward compatibility.
export type LegacyLegalAcceptanceType =
  | "terms"
  | "privacy_policy"
  | "withdrawal"
  | "power_of_attorney"
  | "price_terms";

const LEGAL_ACCEPTANCE_MODULE_PRIORITY: Record<
  LegacyLegalAcceptanceType,
  string[]
> = {
  terms: [
    "general_consumer_terms",
    "general_business_terms",
    "agreement_confirmation",
  ],
  privacy_policy: ["privacy_policy"],
  withdrawal: [
    "withdrawal_right",
    "distance_contract_information",
    "pre_contract_information",
    "withdrawal_form",
  ],
  power_of_attorney: ["power_of_attorney"],
  price_terms: [
    "price_terms",
    "variable_price_terms",
    "hourly_price_terms",
    "quarterly_price_terms",
    "fixed_price_terms",
    "mixed_price_terms",
    "portfolio_terms",
  ],
};

/**
 * Maps every canonical bundle module to the customer consent that covers it.
 * The five values are API compatibility categories only; evidence is always
 * persisted against every exact legal_bundle_version_documents.id.
 */
export function legalAcceptanceTypeForModule(
  moduleKey: string,
): LegacyLegalAcceptanceType {
  const normalized = moduleKey.trim().toLowerCase();
  for (const [type, moduleKeys] of Object.entries(
    LEGAL_ACCEPTANCE_MODULE_PRIORITY,
  ) as Array<[LegacyLegalAcceptanceType, string[]]>) {
    if (type === normalized || moduleKeys.includes(normalized)) return type;
  }
  // Modules such as supplier information, contact details and complaints are
  // part of the agreement package and are covered by the explicit terms
  // consent. They still receive their own immutable acceptance row.
  return "terms";
}

export function selectLegalVersionForAcceptance(
  versions: PublicLegalTextVersion[],
  type: LegacyLegalAcceptanceType,
): PublicLegalTextVersion | null {
  const exactLegacy = versions.find((version) => version.type === type);
  if (exactLegacy) return exactLegacy;
  for (const moduleKey of LEGAL_ACCEPTANCE_MODULE_PRIORITY[type]) {
    const match = versions.find((version) => version.type === moduleKey);
    if (match) return match;
  }
  return null;
}

// Builds the complete immutable legal package exposed to tenant websites. All
// module_versions point to exact legal_bundle_version_documents ids. The five
// historical keys are retained as aliases for older website clients.
export function buildPublicLegalBlock(input: {
  legalVersions: PublicLegalTextVersion[];
  termsVersionFallback?: string | null;
  withdrawalVersionFallback?: string | null;
  tenantSlug?: string | null;
}): Record<string, unknown> {
  const slug = input.tenantSlug ?? null;
  const byAcceptanceType = new Map<
    LegacyLegalAcceptanceType,
    PublicLegalTextVersion | null
  >(
    (
      [
        "terms",
        "privacy_policy",
        "withdrawal",
        "power_of_attorney",
        "price_terms",
      ] as LegacyLegalAcceptanceType[]
    ).map((type) => [
      type,
      selectLegalVersionForAcceptance(input.legalVersions, type),
    ]),
  );

  const versionLabel = (
    type: LegacyLegalAcceptanceType,
    fallback?: string | null,
  ) => byAcceptanceType.get(type)?.version ?? fallback ?? null;
  const versionId = (type: LegacyLegalAcceptanceType) =>
    byAcceptanceType.get(type)?.id ?? null;
  const required = (type: LegacyLegalAcceptanceType) =>
    Boolean(byAcceptanceType.get(type));
  const urlForVersion = (version: PublicLegalTextVersion | null | undefined) =>
    slug && version
      ? buildPublicLegalUrl(slug, version.type, version.id)
      : null;
  const url = (type: LegacyLegalAcceptanceType) =>
    urlForVersion(byAcceptanceType.get(type));

  const moduleVersions = input.legalVersions.map((version) => ({
    id: version.id,
    module_key: version.type,
    version: version.version,
    title: version.title,
    published_at: version.published_at,
    content_sha256: version.content_sha256 ?? null,
    origin: version.origin ?? "canonical_bundle_document",
    legal_bundle_version_id: version.legal_bundle_version_id ?? null,
    url: urlForVersion(version),
  }));

  return {
    terms_version: versionLabel("terms", input.termsVersionFallback),
    privacy_policy_version: versionLabel("privacy_policy"),
    withdrawal_version: versionLabel(
      "withdrawal",
      input.withdrawalVersionFallback,
    ),
    power_of_attorney_version: versionLabel("power_of_attorney"),
    price_terms_version: versionLabel("price_terms"),
    terms_required: required("terms"),
    privacy_policy_required: required("privacy_policy"),
    withdrawal_required: required("withdrawal"),
    price_terms_required: required("price_terms"),
    power_of_attorney_required: required("power_of_attorney"),
    terms_version_id: versionId("terms"),
    privacy_policy_version_id: versionId("privacy_policy"),
    withdrawal_version_id: versionId("withdrawal"),
    price_terms_version_id: versionId("price_terms"),
    power_of_attorney_version_id: versionId("power_of_attorney"),
    terms_url: url("terms"),
    privacy_policy_url: url("privacy_policy"),
    withdrawal_url: url("withdrawal"),
    price_terms_url: url("price_terms"),
    power_of_attorney_url: url("power_of_attorney"),
    required_modules: moduleVersions.map((version) => version.module_key),
    module_versions: moduleVersions,
    legal_bundle_version_id:
      input.legalVersions.find((version) => version.legal_bundle_version_id)
        ?.legal_bundle_version_id ?? null,
    immutable: moduleVersions.length > 0,
  };
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return (
    ["42P01", "42703", "PGRST200", "PGRST201", "PGRST204", "PGRST205"].includes(
      code,
    ) ||
    /schema cache|does not exist|column .* does not exist|relationship/i.test(
      message,
    )
  );
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const PUBLIC_PRICING_VISIBILITY_KEYS = [
  "fixed_price",
  "spot_markup",
  "variable_fee",
  "monthly_fee",
  "invoice_fee",
  "green_energy_fee",
  "electricity_certificate",
  "start_fee",
  "administration_fee",
  "break_fee",
  "portfolio_price",
  "portfolio_management_fee",
  "campaign_discount",
  "optional_fees",
  "production_compensation",
] as const;

type PublicPricingVisibilityKey =
  (typeof PUBLIC_PRICING_VISIBILITY_KEYS)[number];

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return null;
}

function pricingComponents(
  offer: PublicContractOffer,
): Record<string, unknown>[] {
  return Array.isArray(offer.pricing_snapshot?.price_components)
    ? offer.pricing_snapshot.price_components.filter(
        (value): value is Record<string, unknown> =>
          Boolean(value) && typeof value === "object" && !Array.isArray(value),
      )
    : [];
}

function componentCode(component: Record<string, unknown>): string {
  return (
    clean(component.component_code) ??
    clean(component.component_type) ??
    clean(objectValue(component.metadata).component_code) ??
    ""
  );
}

function componentMatchesVisibilityKey(
  component: Record<string, unknown>,
  key: PublicPricingVisibilityKey,
): boolean {
  const code = componentCode(component);
  if (key === "optional_fees") return code.startsWith("optional_");
  return code === key;
}

function explicitComponentWebsiteVisibility(
  component: Record<string, unknown>,
): boolean | null {
  const direct = booleanOrNull(component.website_card_visible);
  if (direct !== null) return direct;
  const metadata = objectValue(component.metadata);
  const visibility = objectValue(metadata.visibility);
  return booleanOrNull(visibility.website_card);
}

function pricingWebsiteVisibility(
  offer: PublicContractOffer,
): Record<PublicPricingVisibilityKey, boolean> {
  const snapshot = offer.pricing_snapshot ?? {};
  const schemaVersion = numberOrNull(snapshot.schema_version) ?? 0;
  const configured = objectValue(snapshot.website_visibility);
  const components = pricingComponents(offer);

  return Object.fromEntries(
    PUBLIC_PRICING_VISIBILITY_KEYS.map((key) => {
      const configuredValue = booleanOrNull(configured[key]);
      if (configuredValue !== null) return [key, configuredValue];

      const matching = components.filter((component) =>
        componentMatchesVisibilityKey(component, key),
      );
      const explicitValues = matching
        .map(explicitComponentWebsiteVisibility)
        .filter((value): value is boolean => value !== null);
      if (explicitValues.length > 0)
        return [key, explicitValues.some((value) => value)];

      // Snapshots created before schema v3 had no separate website visibility.
      // Preserve their historic public behavior until a new immutable version is created.
      return [key, schemaVersion < 3];
    }),
  ) as Record<PublicPricingVisibilityKey, boolean>;
}

function publicPricingComponents(
  offer: PublicContractOffer,
  visibility: Record<PublicPricingVisibilityKey, boolean>,
): Record<string, unknown>[] {
  const schemaVersion =
    numberOrNull(offer.pricing_snapshot?.schema_version) ?? 0;
  return pricingComponents(offer).filter((component) => {
    const explicit = explicitComponentWebsiteVisibility(component);
    if (explicit !== null) return explicit;
    const code = componentCode(component);
    const key = PUBLIC_PRICING_VISIBILITY_KEYS.find((candidate) =>
      componentMatchesVisibilityKey(component, candidate),
    );
    if (key) return visibility[key];
    return schemaVersion < 3 || !code;
  });
}

function visibleComponentByCode(
  components: Record<string, unknown>[],
  code: string,
): Record<string, unknown> | null {
  return (
    components.find((component) => componentCode(component) === code) ?? null
  );
}

function publicPortfolioMonthlyPrices(
  offer: PublicContractOffer,
  visible: boolean,
): Record<string, unknown>[] {
  if (
    !visible ||
    !Array.isArray(offer.pricing_snapshot?.portfolio_monthly_prices)
  )
    return [];
  return offer.pricing_snapshot.portfolio_monthly_prices
    .filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value),
    )
    .map((row) => ({
      period_month: clean(row.period_month) ?? clean(row.delivery_month),
      price_area_code: clean(row.price_area_code) ?? clean(row.price_area),
      amount: numberOrNull(row.amount_ore_per_kwh ?? row.amount),
      unit: clean(row.unit) ?? "ore_per_kwh",
      vat_included: booleanOrNull(row.vat_included) ?? false,
      status: clean(row.status) ?? "published",
    }))
    .filter(
      (row) =>
        Boolean(row.period_month) &&
        Boolean(row.price_area_code) &&
        row.amount !== null,
    )
    .sort(
      (a, b) =>
        String(a.period_month).localeCompare(String(b.period_month)) ||
        String(a.price_area_code).localeCompare(String(b.price_area_code)),
    );
}

function currentPortfolioPriceBlock(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return null;
  const monthParts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = monthParts.find((part) => part.type === "year")?.value ?? null;
  const month = monthParts.find((part) => part.type === "month")?.value ?? null;
  const normalizedMonth = year && month ? `${year}-${month}-01` : null;
  const months = Array.from(
    new Set(
      rows
        .map((row) => clean(row.period_month))
        .filter((month): month is string => Boolean(month)),
    ),
  ).sort();
  const selectedMonth =
    (normalizedMonth && months.includes(normalizedMonth)
      ? normalizedMonth
      : months.find((month) => normalizedMonth && month >= normalizedMonth)) ??
    null;
  if (!selectedMonth) return null;
  const selected = rows.filter((row) => row.period_month === selectedMonth);
  return {
    period_month: selectedMonth,
    unit: "ore_per_kwh",
    vat_included: false,
    price_kind: "historical_final_settlement",
    binding_scope: "historical_delivery_month_only",
    prices_by_area: Object.fromEntries(
      selected.map((row) => [row.price_area_code, row.amount]),
    ),
  };
}
function publicBaseComponents(
  offer: PublicContractOffer,
  visibility: Record<PublicPricingVisibilityKey, boolean>,
): unknown[] {
  if (!Array.isArray(offer.pricing_snapshot?.base_components)) return [];
  return offer.pricing_snapshot.base_components.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const row = value as Record<string, unknown>;
    if (clean(row.source_type) !== "fixed" || visibility.fixed_price)
      return row;
    return { ...row, fixed_price_sek_per_kwh: null };
  });
}

export function publicOfferReference(
  offer: Pick<PublicContractOffer, "canonical_offer_reference">,
): string {
  const reference = clean(offer.canonical_offer_reference);
  if (!reference)
    throw new Error("Kanonisk offer_reference saknas för publicerat avtal.");
  return reference;
}

function isCurrentlyValid(
  row: Pick<PublicContractOffer, "valid_from" | "valid_to">,
): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return (
    (!row.valid_from || row.valid_from <= today) &&
    (!row.valid_to || row.valid_to >= today)
  );
}

function customerTypeAllowed(
  offer: PublicContractOffer,
  customerType?: string | null,
): boolean {
  // Normalize the inbound customer_type so aliases (company/organisation/consumer
  // …) filter correctly instead of any non-'business' value collapsing to a
  // private filter. 'both'/unknown/empty means "do not filter by customer type".
  const normalized = normalizeCustomerType(customerType);
  if (!normalized || normalized === "both" || offer.customer_type === "both")
    return true;
  if (normalized === "business") return offer.customer_type === "business";
  if (normalized === "private") return offer.customer_type === "private";
  return true;
}

function mapOfferRow(row: Record<string, unknown>): PublicContractOffer {
  const pricingSnapshot = objectValue(row.canonical_pricing_snapshot);
  return {
    id: String(row.id),
    offer_code: clean(row.offer_code),
    company_id: String(row.company_id),
    price_plan_id: clean(row.price_plan_id),
    price_plan_version_id: clean(row.price_plan_version_id),
    campaign_version_id: clean(row.campaign_version_id),
    legal_bundle_id: clean(row.legal_bundle_id),
    price_book_id: clean(row.price_book_id),
    product_code: clean(row.product_code) ?? "electricity",
    public_name: clean(row.public_name) ?? clean(row.name) ?? "Elavtal",
    public_description: clean(row.public_description) ?? clean(row.description),
    contract_type: clean(row.contract_type) ?? "spot",
    billing_model: clean(row.billing_model),
    customer_type:
      clean(row.customer_type) === "business"
        ? "business"
        : clean(row.customer_type) === "private"
          ? "private"
          : "both",
    monthly_fee_sek: numberOrNull(row.monthly_fee_sek),
    invoice_fee_sek: numberOrNull(row.invoice_fee_sek),
    markup_ore_per_kwh: numberOrNull(row.markup_ore_per_kwh),
    spot_markup_ore_per_kwh: numberOrNull(
      row.spot_markup_ore_per_kwh ?? row.markup_ore_per_kwh,
    ),
    variable_fee_ore_per_kwh: numberOrNull(row.variable_fee_ore_per_kwh),
    fixed_price_ore_per_kwh: numberOrNull(row.fixed_price_ore_per_kwh),
    green_fee_mode: clean(row.green_fee_mode),
    green_fee_value: numberOrNull(row.green_fee_value),
    terms_version: clean(row.terms_version),
    terms_url: clean(row.terms_url),
    public_price_text:
      clean(pricingSnapshot.public_price_text) ?? clean(row.public_price_text),
    binding_months: numberOrNull(row.binding_months),
    notice_months: numberOrNull(row.notice_months),
    website_cta_enabled: row.website_cta_enabled !== false,
    spot_weight_percent: numberOrNull(row.spot_weight_percent),
    portfolio_weight_percent: numberOrNull(row.portfolio_weight_percent),
    fixed_weight_percent: numberOrNull(row.fixed_weight_percent),
    valid_from: clean(row.valid_from),
    valid_to: clean(row.valid_to),
    sort_order: numberOrNull(row.sort_order) ?? 100,
    metadata: objectValue(row.canonical_metadata ?? row.metadata),
    canonical_offer_reference: clean(row.canonical_offer_reference),
    contract_product_id: clean(row.contract_product_id),
    contract_product_version_id: clean(row.contract_product_version_id),
    contract_publication_version_id: clean(row.contract_publication_version_id),
    legal_bundle_version_id: clean(row.legal_bundle_version_id),
    pricing_snapshot: pricingSnapshot,
    electricity_certificate_ore_per_kwh: numberOrNull(
      row.electricity_certificate_ore_per_kwh,
    ),
    start_fee_sek: numberOrNull(row.start_fee_sek),
    administration_fee_sek: numberOrNull(row.administration_fee_sek),
    break_fee_sek: numberOrNull(row.break_fee_sek),
    portfolio_management_fee_ore_per_kwh: numberOrNull(
      row.portfolio_management_fee_ore_per_kwh,
    ),
    discount_value: numberOrNull(row.discount_value),
    discount_unit: clean(row.discount_unit),
    discount_months: numberOrNull(row.discount_months),
    vat_rate: numberOrNull(row.vat_rate),
    price_areas: Array.isArray(row.price_areas)
      ? row.price_areas.map(String)
      : [],
    automatic_renewal: row.automatic_renewal === true,
    power_of_attorney_required: row.power_of_attorney_required !== false,
  };
}

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
  const visibleComponents = publicPricingComponents(offer, websiteVisibility);
  const visibleBaseComponents = publicBaseComponents(offer, websiteVisibility);
  const portfolioManagementComponent = visibleComponentByCode(
    visibleComponents,
    "portfolio_management_fee",
  );
  const portfolioMonthlyPrices = publicPortfolioMonthlyPrices(
    offer,
    websiteVisibility.portfolio_price,
  );
  const portfolioPrice = currentPortfolioPriceBlock(portfolioMonthlyPrices);
  const publicPriceText =
    clean(offer.pricing_snapshot?.public_price_text) ??
    offer.public_price_text ??
    null;
  const customerTypes =
    offer.customer_type === "both"
      ? ["private", "business"]
      : [offer.customer_type];
  const legalBlock = buildPublicLegalBlock({
    legalVersions,
    termsVersionFallback: offer.terms_version,
    withdrawalVersionFallback: withdrawalVersion,
    tenantSlug: offer.tenant_slug ?? null,
  });
  const monthlyFee =
    !websiteVisibility.monthly_fee || offer.monthly_fee_sek === null
      ? null
      : { amount: offer.monthly_fee_sek, currency: "SEK", unit: "month" };
  const invoiceFee =
    !websiteVisibility.invoice_fee || offer.invoice_fee_sek === null
      ? null
      : { amount: offer.invoice_fee_sek, currency: "SEK", unit: "invoice" };
  const markup =
    !websiteVisibility.spot_markup ||
    (offer.spot_markup_ore_per_kwh ?? offer.markup_ore_per_kwh) === null
      ? null
      : {
          amount: offer.spot_markup_ore_per_kwh ?? offer.markup_ore_per_kwh,
          unit: "ore_per_kwh",
        };
  const fixedPrice =
    !websiteVisibility.fixed_price || offer.fixed_price_ore_per_kwh === null
      ? null
      : { amount: offer.fixed_price_ore_per_kwh, unit: "ore_per_kwh" };

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
    type: offer.contract_type,
    billing_model: offer.billing_model,
    customer_type: offer.customer_type,
    customer_types: customerTypes,
    pricing: {
      monthly_fee: monthlyFee,
      invoice_fee: invoiceFee,
      markup,
      spot_markup: markup,
      variable_fee:
        !websiteVisibility.variable_fee ||
        offer.variable_fee_ore_per_kwh === null
          ? null
          : { amount: offer.variable_fee_ore_per_kwh, unit: "ore_per_kwh" },
      fixed_price: fixedPrice,
      green_fee:
        !websiteVisibility.green_energy_fee || offer.green_fee_value === null
          ? null
          : { amount: offer.green_fee_value, mode: offer.green_fee_mode },
      spot_share: offer.spot_weight_percent,
      portfolio_share: offer.portfolio_weight_percent,
      fixed_share: offer.fixed_weight_percent,
      public_price_text: publicPriceText,
      visibility: websiteVisibility,
      price_areas: offer.price_areas ?? [],
      vat_rate:
        numberOrNull(offer.pricing_snapshot?.vat_rate) ??
        (offer.vat_rate === null || offer.vat_rate === undefined
          ? null
          : offer.vat_rate > 1
            ? offer.vat_rate / 100
            : offer.vat_rate),
      interval_resolution: clean(offer.pricing_snapshot?.interval_resolution),
      base_components: visibleBaseComponents,
      components: visibleComponents,
      electricity_certificate:
        !websiteVisibility.electricity_certificate ||
        offer.electricity_certificate_ore_per_kwh == null
          ? null
          : {
              amount: offer.electricity_certificate_ore_per_kwh,
              unit: "ore_per_kwh",
            },
      start_fee:
        !websiteVisibility.start_fee || offer.start_fee_sek == null
          ? null
          : {
              amount: offer.start_fee_sek,
              currency: "SEK",
              lifecycle: "once_per_contract",
            },
      administration_fee:
        !websiteVisibility.administration_fee ||
        offer.administration_fee_sek == null
          ? null
          : {
              amount: offer.administration_fee_sek,
              currency: "SEK",
              lifecycle: "once_per_contract",
            },
      break_fee:
        !websiteVisibility.break_fee || offer.break_fee_sek == null
          ? null
          : {
              amount: offer.break_fee_sek,
              currency: "SEK",
              event: "early_termination",
            },
      portfolio_price: portfolioPrice,
      portfolio_monthly_prices: portfolioMonthlyPrices,
      portfolio_method: objectValue(offer.pricing_snapshot?.portfolio_method),
      portfolio_indications: Array.isArray(
        offer.pricing_snapshot?.portfolio_indications,
      )
        ? offer.pricing_snapshot.portfolio_indications
        : [],
      portfolio_management_fee: !websiteVisibility.portfolio_management_fee
        ? null
        : portfolioManagementComponent
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
            }
          : offer.portfolio_management_fee_ore_per_kwh == null
            ? null
            : {
                amount: offer.portfolio_management_fee_ore_per_kwh,
                unit: "ore_per_kwh",
                calculation_base: null,
              },
      discount:
        !websiteVisibility.campaign_discount || offer.discount_value == null
          ? null
          : {
              amount: offer.discount_value,
              unit: offer.discount_unit,
              duration_months: offer.discount_months,
            },
    },
    pricing_snapshot: {
      ...(offer.pricing_snapshot ?? {}),
      base_components: visibleBaseComponents,
      price_components: visibleComponents,
      website_visibility: websiteVisibility,
      portfolio_monthly_prices: portfolioMonthlyPrices,
      public_price_text: publicPriceText,
    },
    // Compatibility field intentionally stays null. Historical final rows and
    // non-binding indications must never masquerade as a future contract price.
    portfolio_price_ore_per_kwh: null,
    portfolio_management_fee: !websiteVisibility.portfolio_management_fee
      ? null
      : portfolioManagementComponent
        ? {
            amount: numberOrNull(portfolioManagementComponent.amount),
            unit: clean(portfolioManagementComponent.unit),
            calculation_base:
              clean(portfolioManagementComponent.calculation_base) ??
              clean(
                objectValue(portfolioManagementComponent.metadata)
                  .calculation_base,
              ),
          }
        : null,
    legal: legalBlock,
    monthly_fee_sek: websiteVisibility.monthly_fee
      ? offer.monthly_fee_sek
      : null,
    invoice_fee_sek: websiteVisibility.invoice_fee
      ? offer.invoice_fee_sek
      : null,
    markup_ore_per_kwh: websiteVisibility.spot_markup
      ? offer.markup_ore_per_kwh
      : null,
    spot_markup_ore_per_kwh: websiteVisibility.spot_markup
      ? offer.spot_markup_ore_per_kwh
      : null,
    variable_fee_ore_per_kwh: websiteVisibility.variable_fee
      ? offer.variable_fee_ore_per_kwh
      : null,
    fixed_price_ore_per_kwh: websiteVisibility.fixed_price
      ? offer.fixed_price_ore_per_kwh
      : null,
    green_fee_mode: websiteVisibility.green_energy_fee
      ? offer.green_fee_mode
      : null,
    green_fee_value: websiteVisibility.green_energy_fee
      ? offer.green_fee_value
      : null,
    terms_version: offer.terms_version,
    terms_url: offer.terms_url ?? null,
    public_price_text: publicPriceText,
    binding_months: offer.binding_months ?? null,
    notice_months: offer.notice_months ?? null,
    website_cta_enabled: offer.website_cta_enabled !== false,
    price_areas: offer.price_areas ?? [],
    automatic_renewal: offer.automatic_renewal === true,
    power_of_attorney_required: offer.power_of_attorney_required !== false,
    vat_rate: numberOrNull(offer.pricing_snapshot?.vat_rate) ?? null,
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
  tenant: {
    id: string;
    name: string | null;
    org_number: string | null;
    brand_name: string | null;
    slug: string | null;
  };
  legal: Record<string, unknown>;
  complete: boolean;
  missing_types: string[];
};

// Builds the standalone tenant legal bundle for the website API. Source of truth
// is OPS: published, tenant-scoped legal versions + the tenant identity. Used by
// GET /api/v1/website/legal-bundle.
export async function buildWebsiteLegalBundle(
  client: IntegrationApiClient,
): Promise<WebsiteLegalBundle> {
  const companyLegalVersions = await listPublishedLegalVersions(
    client.company_id,
  );
  const tenantSlug = await loadCompanySlugById(client.company_id);
  const versions = companyLegalVersions ?? [];
  const legal = buildPublicLegalBlock({ legalVersions: versions, tenantSlug });

  const { data } = await supabaseService
    .from("companies")
    .select("id,name,org_number,branding,metadata")
    .eq("id", client.company_id)
    .maybeSingle();
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
    tenant: {
      id: client.company_id,
      name: (row.name as string | null) ?? null,
      org_number: (row.org_number as string | null) ?? null,
      brand_name: brandName,
      slug: tenantSlug,
    },
    legal,
    // Legal completeness is offer-specific and is enforced by the exact
    // canonical publication readiness. This endpoint only reports whether the
    // tenant has any published legal material available.
    complete: companyLegalVersions !== null && versions.length > 0,
    missing_types: [],
  };
}

function hasExactCanonicalLegalVersions(
  legalVersions: PublicLegalTextVersion[] | null,
): boolean {
  // The canonical readiness view already validates the module set for the
  // exact publication version. The API only needs to fail closed when that
  // immutable document set cannot be materialized.
  if (!legalVersions || legalVersions.length === 0) return false;
  return legalVersions.every((version) =>
    Boolean(version.id && version.type && version.version),
  );
}

async function listPublishedLegalVersions(
  companyId: string,
): Promise<PublicLegalTextVersion[] | null> {
  const latestPublication = await supabaseService
    .from("canonical_public_contract_offers_v")
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

async function listBundleLegalVersions(input: {
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
  const exact = (documents.data ?? [])
    .filter(
      (row) =>
        Array.isArray(row.unresolved_variables) &&
        row.unresolved_variables.length === 0,
    )
    .map((row) => ({
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

async function offerWithLegalVersions(input: {
  offer: PublicContractOffer;
  companyLegalVersions: PublicLegalTextVersion[] | null;
}): Promise<PublicContractOffer | null> {
  const legalVersions = await listBundleLegalVersions({
    companyId: input.offer.company_id,
    legalBundleVersionId: input.offer.legal_bundle_version_id,
  });
  if (!hasExactCanonicalLegalVersions(legalVersions)) return null;
  return {
    ...input.offer,
    legal_versions: legalVersions ?? undefined,
    metadata: {
      ...input.offer.metadata,
      legal_versions: legalVersions ?? undefined,
    },
  };
}

function isWebsitePublishedRow(row: Record<string, unknown>): boolean {
  const status = clean(row.publication_status);
  const hasStatusColumn = status !== null;
  const archived = row.is_archived === true || status === "archived";
  const websiteEnabled = row.website_enabled !== false;

  if (archived || !websiteEnabled) return false;
  if (hasStatusColumn) return status === "published";
  return row.is_public === true;
}

async function exactPortfolioMonthlyPrices(
  offer: PublicContractOffer,
): Promise<{
  historicalFinal: Record<string, unknown>[];
  indications: Record<string, unknown>[];
}> {
  if (
    !offer.price_plan_version_id ||
    !["portfolio", "mixed"].includes(offer.contract_type)
  )
    return { historicalFinal: [], indications: [] };
  const method = objectValue(offer.pricing_snapshot?.portfolio_method);
  const portfolioId = clean(method.portfolio_id);
  if (!portfolioId) return { historicalFinal: [], indications: [] };
  const displayRules = objectValue(method.display_rules);
  const showHistorical = displayRules.show_historical_final !== false;
  const showIndication = displayRules.show_indication === true;
  const [settlements, estimates] = await Promise.all([
    supabaseService
      .from("portfolio_monthly_settlements")
      .select(
        "id,portfolio_id,price_plan_version_id,delivery_month,price_area_code,portfolio_price_ore_per_kwh,status,source,revision_no,approved_at,locked_at",
      )
      .eq("company_id", offer.company_id)
      .eq("portfolio_id", portfolioId)
      .eq("price_plan_version_id", offer.price_plan_version_id)
      .eq("is_current", true)
      .in("status", ["final", "locked"])
      .order("delivery_month", { ascending: false })
      .order("price_area_code", { ascending: true })
      .limit(48),
    supabaseService
      .from("portfolio_price_estimates")
      .select(
        "id,portfolio_id,price_plan_version_id,estimate_month,price_area_code,estimate_price_ore_per_kwh,estimate_source,confidence,non_binding,reason,expires_at,estimate_generated_at",
      )
      .eq("company_id", offer.company_id)
      .eq("portfolio_id", portfolioId)
      .eq("price_plan_version_id", offer.price_plan_version_id)
      .eq("is_current", true)
      .order("estimate_month", { ascending: true })
      .limit(16),
  ]);
  if (settlements.error) throw settlements.error;
  if (estimates.error) throw estimates.error;
  return {
    historicalFinal: showHistorical
      ? (settlements.data ?? []).map((row) => ({
          id: row.id,
          portfolio_id: row.portfolio_id,
          price_plan_version_id: row.price_plan_version_id,
          period_month: row.delivery_month,
          price_area_code: row.price_area_code,
          amount: row.portfolio_price_ore_per_kwh,
          unit: "ore_per_kwh",
          vat_included: false,
          status: row.status,
          source: row.source,
          revision_no: row.revision_no,
          final_at: row.locked_at ?? row.approved_at,
          historical: true,
        }))
      : [],
    indications: showIndication
      ? (estimates.data ?? [])
          .filter(
            (row) => !row.expires_at || Date.parse(row.expires_at) > Date.now(),
          )
          .map((row) => ({
            ...row,
            amount_ore_per_kwh: Number(row.estimate_price_ore_per_kwh),
            unit: "ore_per_kwh",
            non_binding: true,
            label: "Uppskattning – ej bindande",
          }))
      : [],
  };
}

async function appendReadyOffer(input: {
  result: PublicContractOffer[];
  offer: PublicContractOffer;
  companyLegalVersions: PublicLegalTextVersion[] | null;
  customerType?: string | null;
  tenantSlug?: string | null;
}) {
  if (
    !isCurrentlyValid(input.offer) ||
    !customerTypeAllowed(input.offer, input.customerType)
  )
    return;

  const readiness = await assessPublicOfferReadiness({
    companyId: input.offer.company_id,
    offer: input.offer,
  });
  if (!readiness.isReady) return;

  const invoiceFeeReadiness = assessCanonicalInvoiceFee({
    rowAmount: input.offer.invoice_fee_sek,
    snapshot: input.offer.pricing_snapshot,
  });
  if (invoiceFeeReadiness.status !== "ready") return;

  const withLegal = await offerWithLegalVersions({
    offer: input.offer,
    companyLegalVersions: input.companyLegalVersions,
  });
  if (!withLegal) return;

  const portfolioPricing = await exactPortfolioMonthlyPrices(withLegal);
  withLegal.pricing_snapshot = {
    ...(withLegal.pricing_snapshot ?? {}),
    portfolio_monthly_prices: portfolioPricing.historicalFinal,
    portfolio_indications: portfolioPricing.indications,
  };
  withLegal.tenant_slug = input.tenantSlug ?? null;
  withLegal.metadata = {
    ...withLegal.metadata,
    readiness_status: "ready",
    readiness_blockers: [],
  };
  input.result.push(withLegal);
}

export async function listPublicContractOffers(input: {
  client: IntegrationApiClient;
  customerType?: string | null;
}): Promise<PublicContractOffer[]> {
  const companyLegalVersions = await listPublishedLegalVersions(
    input.client.company_id,
  );
  const tenantSlug = await loadCompanySlugById(input.client.company_id);
  const primary = await supabaseService
    .from("canonical_public_contract_offers_v")
    .select("*")
    .eq("company_id", input.client.company_id)
    .eq("is_archived", false)
    .order("sort_order", { ascending: true })
    .order("public_name", { ascending: true });

  if (!primary.error) {
    const result: PublicContractOffer[] = [];
    const offers = ((primary.data ?? []) as Array<Record<string, unknown>>)
      .filter(isWebsitePublishedRow)
      .map(mapOfferRow);

    for (const offer of offers) {
      await appendReadyOffer({
        result,
        offer,
        companyLegalVersions,
        customerType: input.customerType,
        tenantSlug,
      });
    }
    return result;
  }

  throw primary.error;
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
  id: string;
  name: string;
  product_code: string;
  publication_status: string | null;
  website_enabled: boolean;
  valid_from: string | null;
  valid_to: string | null;
  customer_type: string;
  visible: boolean;
  blockers: string[];
  offer_reference: string | null;
  pricing_readiness: {
    invoice_fee: CanonicalInvoiceFeeReadiness;
  };
};

export async function diagnosePublicContractOffers(input: {
  client: IntegrationApiClient;
  customerType?: string | null;
}): Promise<{
  total: number;
  visible: number;
  hidden: number;
  offers: PublicContractOfferDiagnostic[];
}> {
  const query = await supabaseService
    .from("canonical_public_contract_offers_v")
    .select("*")
    .eq("company_id", input.client.company_id)
    .order("sort_order", { ascending: true })
    .order("public_name", { ascending: true });

  if (query.error) throw query.error;

  const rows = (query.data ?? []) as Array<Record<string, unknown>>;
  const diagnostics: PublicContractOfferDiagnostic[] = [];
  for (const row of rows) {
    const offer = mapOfferRow(row);
    const blockers: string[] = [];
    const publicationStatus = clean(row.publication_status);
    if (row.is_archived === true || publicationStatus === "archived")
      blockers.push("Erbjudandet är arkiverat");
    if (row.website_enabled === false)
      blockers.push("Visning på hemsidan är avstängd");
    if (
      publicationStatus
        ? publicationStatus !== "published"
        : row.is_public !== true
    )
      blockers.push("Erbjudandet är inte publicerat");
    if (!isCurrentlyValid(offer))
      blockers.push("Erbjudandet ligger utanför sin giltighetsperiod");
    if (!customerTypeAllowed(offer, input.customerType))
      blockers.push("Erbjudandet matchar inte vald kundtyp");

    const readiness = await assessPublicOfferReadiness({
      companyId: offer.company_id,
      offer,
    });
    blockers.push(
      ...readiness.blockers.filter((blocker) => !blockers.includes(blocker)),
    );
    const invoiceFeeReadiness = assessCanonicalInvoiceFee({
      rowAmount: offer.invoice_fee_sek,
      snapshot: offer.pricing_snapshot,
    });
    if (invoiceFeeReadiness.status === "blocked") {
      blockers.push(invoiceFeeReadiness.code);
    }

    const strictLegal =
      blockers.length === 0
        ? await offerWithLegalVersions({ offer, companyLegalVersions: null })
        : null;
    if (blockers.length === 0 && !strictLegal)
      blockers.push("Erbjudandets exakta juridikpaket kunde inte verifieras");

    const visible = blockers.length === 0;
    diagnostics.push({
      id: offer.id,
      name: offer.public_name,
      product_code: offer.product_code,
      publication_status: publicationStatus,
      website_enabled: row.website_enabled !== false,
      valid_from: offer.valid_from,
      valid_to: offer.valid_to,
      customer_type: offer.customer_type,
      visible,
      blockers: Array.from(new Set(blockers)),
      offer_reference: visible ? publicOfferReference(offer) : null,
      pricing_readiness: { invoice_fee: invoiceFeeReadiness },
    });
  }

  const visible = diagnostics.filter((item) => item.visible).length;
  return {
    total: diagnostics.length,
    visible,
    hidden: diagnostics.length - visible,
    offers: diagnostics,
  };
}
