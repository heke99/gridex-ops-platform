import { supabaseService } from "@/lib/supabase/service";
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
import {
  commonFixedPriceOrePerKwh,
  fixedAreaPricesFromSnapshot,
} from "@/lib/pricing/fixedAreaPricing";

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
  energy_direction: "consumption" | "production";
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
      if (
        key === "fixed_price" &&
        offer.contract_type === "fixed" &&
        offer.fixed_price_ore_per_kwh !== null
      )
        return [key, true];
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

type WebsiteVisibilityMode = "visible" | "hidden" | "summary_only";
type CalculationInclusion = "included" | "excluded" | "conditional";

function componentWebsiteVisibilityMode(
  component: Record<string, unknown>,
): WebsiteVisibilityMode {
  const direct = clean(component.website_visibility);
  if (direct === "visible" || direct === "hidden" || direct === "summary_only")
    return direct;
  const metadata = objectValue(component.metadata);
  const visibility = objectValue(metadata.visibility);
  const configured = clean(visibility.website);
  if (
    configured === "visible" ||
    configured === "hidden" ||
    configured === "summary_only"
  )
    return configured;
  const cardVisible = explicitComponentWebsiteVisibility(component);
  const summaryVisible =
    booleanOrNull(component.website_summary_visible) ??
    booleanOrNull(visibility.summary);
  if (cardVisible === true) return "visible";
  if (cardVisible === false) {
    return summaryVisible === false ? "hidden" : "summary_only";
  }
  return summaryVisible === true ? "summary_only" : "visible";
}

function componentCalculationInclusion(
  component: Record<string, unknown>,
): CalculationInclusion {
  const direct = clean(component.calculation_inclusion);
  if (direct === "included" || direct === "excluded" || direct === "conditional")
    return direct;
  const metadata = objectValue(component.metadata);
  const configured = clean(metadata.calculation_inclusion);
  if (
    configured === "included" ||
    configured === "excluded" ||
    configured === "conditional"
  )
    return configured;
  const lifecycle = clean(metadata.lifecycle);
  return lifecycle === "early_termination" || lifecycle === "conditional"
    ? "conditional"
    : "included";
}

function publicComponentMetadata(
  component: Record<string, unknown>,
): Record<string, unknown> {
  const metadata = objectValue(component.metadata);
  const result: Record<string, unknown> = {};

  for (const key of [
    "lifecycle",
    "event",
    "billing_frequency",
    "vat_treatment",
    "calculation_base",
    "percentage_representation",
    "starts_on",
    "mode",
  ]) {
    const value = clean(metadata[key]);
    if (value !== null) result[key] = value;
  }

  const durationMonths = numberOrNull(metadata.duration_months);
  if (durationMonths !== null) result.duration_months = durationMonths;
  const replacesLegacyMarkup = booleanOrNull(metadata.replaces_legacy_markup);
  if (replacesLegacyMarkup !== null)
    result.replaces_legacy_markup = replacesLegacyMarkup;

  const sourceVisibility = objectValue(metadata.visibility);
  const visibility: Record<string, unknown> = {};
  const cardVisible = booleanOrNull(sourceVisibility.website_card);
  const summaryVisible = booleanOrNull(sourceVisibility.summary);
  const checkoutVisible = booleanOrNull(sourceVisibility.checkout);
  const contractDocumentVisible = booleanOrNull(
    sourceVisibility.contract_document,
  );
  const invoiceVisible = booleanOrNull(sourceVisibility.invoice);
  const websiteMode = clean(sourceVisibility.website);
  if (cardVisible !== null) visibility.website_card = cardVisible;
  if (summaryVisible !== null) visibility.summary = summaryVisible;
  if (checkoutVisible !== null) visibility.checkout = checkoutVisible;
  if (contractDocumentVisible !== null)
    visibility.contract_document = contractDocumentVisible;
  if (invoiceVisible !== null) visibility.invoice = invoiceVisible;
  if (
    websiteMode === "visible" ||
    websiteMode === "summary_only" ||
    websiteMode === "hidden"
  ) {
    visibility.website = websiteMode;
  }
  if (Object.keys(visibility).length > 0) result.visibility = visibility;

  return result;
}

function normalizeCalculationComponent(
  component: Record<string, unknown>,
): Record<string, unknown> {
  const websiteVisibility = componentWebsiteVisibilityMode(component);
  const metadata = publicComponentMetadata(component);
  const code = componentCode(component) || null;
  const componentType = clean(component.component_type) ?? code;
  const calculationBase =
    clean(component.calculation_base) ?? clean(metadata.calculation_base);
  return {
    component_code: code,
    component_type: componentType,
    name:
      clean(component.name) ??
      clean(component.label) ??
      componentType ??
      code,
    amount: numberOrNull(component.amount),
    unit: clean(component.unit),
    calculation_type: clean(component.calculation_type),
    calculation_base: calculationBase,
    vat_applicable: booleanOrNull(component.vat_applicable) ?? true,
    invoice_line_visible:
      booleanOrNull(component.invoice_line_visible) ?? true,
    priority: numberOrNull(component.priority),
    calculation_inclusion: componentCalculationInclusion(component),
    website_visibility: websiteVisibility,
    website_card_visible: websiteVisibility === "visible",
    website_summary_visible: websiteVisibility !== "hidden",
    metadata,
  };
}

function syntheticComponent(input: {
  code: string;
  name: string;
  amount: number | null;
  unit: string;
  calculationType: string;
  visible: boolean;
  conditional?: boolean;
  vatApplicable?: boolean;
}): Record<string, unknown> | null {
  if (input.amount === null) return null;
  return normalizeCalculationComponent({
    component_code: input.code,
    component_type: input.code,
    name: input.name,
    amount: input.amount,
    unit: input.unit,
    calculation_type: input.calculationType,
    vat_applicable: input.vatApplicable !== false,
    invoice_line_visible: true,
    website_card_visible: input.visible,
    website_summary_visible: true,
    calculation_inclusion: input.conditional ? "conditional" : "included",
    metadata: {
      visibility: {
        website_card: input.visible,
        website: input.visible ? "visible" : "summary_only",
        summary: true,
        quote_breakdown: true,
        checkout: true,
        contract_document: true,
        invoice: true,
      },
    },
  });
}

function calculationPricingComponents(
  offer: PublicContractOffer,
  visibility: Record<PublicPricingVisibilityKey, boolean>,
): Record<string, unknown>[] {
  const existing = pricingComponents(offer).map((component) => {
    const normalized = normalizeCalculationComponent(component);
    if (
      offer.contract_type !== "fixed" ||
      componentCode(normalized) !== "fixed_price"
    )
      return normalized;
    const metadata = objectValue(normalized.metadata);
    const metadataVisibility = objectValue(metadata.visibility);
    return {
      ...normalized,
      amount: offer.fixed_price_ore_per_kwh,
      unit: "ore_per_kwh",
      calculation_type: "per_kwh",
      website_visibility: "visible",
      website_card_visible: true,
      website_summary_visible: true,
      metadata: {
        ...metadata,
        visibility: {
          ...metadataVisibility,
          website_card: true,
          website: "visible",
          summary: true,
        },
      },
    };
  });
  const seen = new Set(existing.map(componentCode));
  const candidates = [
    syntheticComponent({ code: "fixed_price", name: "Fast elpris", amount: offer.fixed_price_ore_per_kwh, unit: "ore_per_kwh", calculationType: "per_kwh", visible: visibility.fixed_price }),
    syntheticComponent({ code: "monthly_fee", name: "Månadsavgift", amount: offer.monthly_fee_sek, unit: "sek_month", calculationType: "per_month", visible: visibility.monthly_fee }),
    syntheticComponent({ code: "invoice_fee", name: "Fakturaavgift", amount: offer.invoice_fee_sek, unit: "sek_invoice", calculationType: "per_invoice", visible: visibility.invoice_fee }),
    syntheticComponent({ code: "spot_markup", name: "Påslag", amount: offer.spot_markup_ore_per_kwh ?? offer.markup_ore_per_kwh, unit: "ore_per_kwh", calculationType: "per_kwh", visible: visibility.spot_markup }),
    syntheticComponent({ code: "variable_fee", name: "Rörlig avgift", amount: offer.variable_fee_ore_per_kwh, unit: "ore_per_kwh", calculationType: "per_kwh", visible: visibility.variable_fee }),
    syntheticComponent({ code: "green_energy_fee", name: "Miljöavgift", amount: offer.green_fee_value, unit: offer.green_fee_mode ?? "ore_per_kwh", calculationType: offer.green_fee_mode ?? "per_kwh", visible: visibility.green_energy_fee }),
    syntheticComponent({ code: "electricity_certificate", name: "Elcertifikat", amount: offer.electricity_certificate_ore_per_kwh ?? null, unit: "ore_per_kwh", calculationType: "per_kwh", visible: visibility.electricity_certificate }),
    syntheticComponent({ code: "start_fee", name: "Startavgift", amount: offer.start_fee_sek ?? null, unit: "sek_contract", calculationType: "fixed_once", visible: visibility.start_fee }),
    syntheticComponent({ code: "administration_fee", name: "Administrationsavgift", amount: offer.administration_fee_sek ?? null, unit: "sek_contract", calculationType: "fixed_once", visible: visibility.administration_fee }),
    syntheticComponent({ code: "break_fee", name: "Brytavgift", amount: offer.break_fee_sek ?? null, unit: "sek_event", calculationType: "conditional", visible: visibility.break_fee, conditional: true }),
    syntheticComponent({ code: "portfolio_management_fee", name: "Förvaltningsavgift", amount: offer.portfolio_management_fee_ore_per_kwh ?? null, unit: "ore_per_kwh", calculationType: "per_kwh", visible: visibility.portfolio_management_fee }),
    syntheticComponent({ code: "campaign_discount", name: "Rabatt", amount: offer.discount_value ?? null, unit: offer.discount_unit ?? "sek_month", calculationType: offer.discount_unit === "percent" ? "percentage" : "discount", visible: visibility.campaign_discount, vatApplicable: false }),
  ].filter((component): component is Record<string, unknown> => Boolean(component));

  for (const component of candidates) {
    const code = componentCode(component);
    if (!seen.has(code)) {
      existing.push(component);
      seen.add(code);
    }
  }
  return existing.sort(
    (a, b) =>
      (numberOrNull(a.priority) ?? 999) - (numberOrNull(b.priority) ?? 999) ||
      componentCode(a).localeCompare(componentCode(b)),
  );
}

function websiteDisplayPricingComponents(
  components: Record<string, unknown>[],
): Record<string, unknown>[] {
  return components.filter(
    (component) => componentWebsiteVisibilityMode(component) === "visible",
  );
}

function websiteSummaryPricingComponents(
  components: Record<string, unknown>[],
): Record<string, unknown>[] {
  return components.filter(
    (component) => componentWebsiteVisibilityMode(component) !== "hidden",
  );
}

function componentByCode(
  components: Record<string, unknown>[],
  code: string,
): Record<string, unknown> | null {
  return (
    components.find((component) => componentCode(component) === code) ?? null
  );
}

function publicPortfolioMonthlyPrices(
  offer: PublicContractOffer,
): Record<string, unknown>[] {
  if (!Array.isArray(offer.pricing_snapshot?.portfolio_monthly_prices))
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

function calculationBaseComponents(
  offer: PublicContractOffer,
): Record<string, unknown>[] {
  if (!Array.isArray(offer.pricing_snapshot?.base_components)) return [];
  const websiteVisibility = pricingWebsiteVisibility(offer);
  return offer.pricing_snapshot.base_components
    .filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value),
    )
    .map((row) => {
      const sourceType = clean(row.source_type);
      const mode: WebsiteVisibilityMode =
        sourceType === "fixed"
          ? websiteVisibility.fixed_price
            ? "visible"
            : "summary_only"
          : "summary_only";
      return {
        source_type: sourceType,
        label: clean(row.label),
        weight_percent: numberOrNull(row.weight_percent),
        fixed_price_sek_per_kwh: numberOrNull(
          row.fixed_price_sek_per_kwh,
        ),
        price_area: clean(row.price_area),
        calculation_inclusion: "included",
        website_visibility: mode,
      };
    });
}

function publicPortfolioMethod(offer: PublicContractOffer) {
  const method = objectValue(offer.pricing_snapshot?.portfolio_method);
  if (Object.keys(method).length === 0) return null;
  const mixShares = objectValue(method.mix_shares);
  const managementFee = objectValue(method.management_fee);
  const displayRules = objectValue(method.display_rules);
  return {
    pricing_model: clean(method.pricing_model),
    mix_shares: {
      spot_weight_percent: numberOrNull(mixShares.spot_weight_percent),
      portfolio_weight_percent: numberOrNull(
        mixShares.portfolio_weight_percent,
      ),
      fixed_weight_percent: numberOrNull(mixShares.fixed_weight_percent),
    },
    management_fee: {
      amount: numberOrNull(managementFee.amount),
      unit: clean(managementFee.unit),
      calculation_base: clean(managementFee.calculation_base),
    },
    calculation_base: clean(method.calculation_base),
    vat_rate: numberOrNull(method.vat_rate),
    settlement_timing: clean(method.settlement_timing),
    estimate_rule: clean(method.estimate_rule),
    display_rules: {
      show_historical_final:
        booleanOrNull(displayRules.show_historical_final) ?? false,
      show_indication: false,
      indication_non_binding: true,
    },
    final_billing_requires: clean(method.final_billing_requires),
  };
}

function publicEnergyDirection(offer: Pick<PublicContractOffer, "energy_direction" | "pricing_snapshot">): "consumption" | "production" {
  const explicit = clean(offer.pricing_snapshot?.energy_direction) ?? offer.energy_direction;
  if (explicit === "production") return "production";
  if (explicit === "consumption") return "consumption";
  const production = objectValue(offer.pricing_snapshot?.production);
  return production.enabled === true ? "production" : "consumption";
}

function normalizePublicResolution(value: unknown): "monthly" | "hourly" | "quarterly" | null {
  const resolution = clean(value);
  if (resolution === "quarter_hour" || resolution === "quarterly") return "quarterly";
  if (resolution === "hourly" || resolution === "monthly") return resolution;
  return null;
}

function publicProductionTerms(offer: PublicContractOffer) {
  if (publicEnergyDirection(offer) !== "production") return null;
  const production = objectValue(offer.pricing_snapshot?.production);
  const fixedCompensationOre = numberOrNull(
    production.fixed_compensation_ore_per_kwh ?? production.compensation_ore_per_kwh,
  );
  const compensationModel = clean(production.compensation_model) ??
    (numberOrNull(production.deduction_ore_per_kwh) !== null
      ? "spot_minus_deduction"
      : numberOrNull(production.premium_ore_per_kwh) !== null
        ? "spot_plus_premium"
        : fixedCompensationOre !== null
          ? "fixed_compensation"
          : "custom");
  return {
    enabled: true,
    compensation_model: compensationModel,
    resolution: normalizePublicResolution(
      production.resolution ?? offer.pricing_snapshot?.interval_resolution,
    ),
    deduction_ore_per_kwh: numberOrNull(production.deduction_ore_per_kwh),
    premium_ore_per_kwh: numberOrNull(production.premium_ore_per_kwh),
    fixed_compensation_ore_per_kwh: fixedCompensationOre,
    compensation_ore_per_kwh: fixedCompensationOre,
    compensation_sek_per_kwh:
      numberOrNull(production.compensation_sek_per_kwh) ??
      (fixedCompensationOre === null ? null : fixedCompensationOre / 100),
    vat_rate: numberOrNull(production.vat_rate),
    vat_rate_percent: numberOrNull(production.vat_rate_percent),
    vat_treatment: clean(production.vat_treatment) ?? "configured_on_contract",
    settlement_mode: clean(production.settlement_mode),
    billing_direction:
      clean(production.settlement_mode) === "self_billing"
        ? "self_billing"
        : "credit_invoice",
    metering_point_role: clean(production.metering_point_role) ?? "production",
  };
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
    energy_direction:
      clean(pricingSnapshot.energy_direction) === "production" ||
      objectValue(pricingSnapshot.production).enabled === true
        ? "production"
        : "consumption",
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
      market_price_responsibility: offer.contract_type === "fixed" ? "not_applicable" : "ops_quote",
      calculation_contract: {
        includes_all_applicable_components: true,
        hidden_components_must_be_calculated: true,
        market_price_supplied_by_ops: offer.contract_type !== "fixed",
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
      // OPS does not expose internally sourced market indications to tenant
      // websites. Tenants source the public market value used by calculators.
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
        offer.contract_type === "fixed" ? "not_applicable" : "ops_quote",
      calculation_contract: {
        includes_all_applicable_components: true,
        hidden_components_must_be_calculated: true,
        market_price_supplied_by_ops: offer.contract_type !== "fixed",
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

function isWebsitePublishedRow(row: Record<string, unknown>): boolean {
  const status = clean(row.publication_status);
  const hasStatusColumn = status !== null;
  const archived = row.is_archived === true || status === "archived";
  const websiteEnabled = row.website_enabled !== false;

  if (archived || !websiteEnabled) return false;
  if (hasStatusColumn) return status === "published";
  return row.is_public === true;
}

type BulkPublicationReadiness = {
  isReady: boolean;
  blockers: string[];
};

async function loadPublicationReadinessByVersion(
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

async function loadLegalVersionsByBundle(
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

type PortfolioPricingRows = {
  settlements: Array<Record<string, unknown>>;
};

function portfolioPricingKey(portfolioId: string, pricePlanVersionId: string) {
  return `${portfolioId}:${pricePlanVersionId}`;
}

async function loadPortfolioPricingByOffer(
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

function portfolioPricingForOffer(
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

type PublicationGraphIntegrity = {
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
};

async function loadPublicationGraphIntegrity(
  companyId: string,
  publicOfferIds: string[],
): Promise<Map<string, PublicationGraphIntegrity>> {
  if (publicOfferIds.length === 0) return new Map();
  const query = await supabaseService
    .from("contract_publication_graph_integrity_v")
    .select(
      "public_contract_offer_id,canonical_graph_consistent,forward_publication_link_valid,reverse_legacy_link_valid,company_chain_valid,tenant_assignment_valid,channel_valid,product_version_valid,source_offer_consistent,publication_active",
    )
    .eq("company_id", companyId)
    .in("public_contract_offer_id", publicOfferIds);
  if (query.error) throw query.error;
  return new Map(
    ((query.data ?? []) as PublicationGraphIntegrity[]).map((row) => [
      row.public_contract_offer_id,
      row,
    ]),
  );
}

export async function listPublicContractOffers(input: {
  client: IntegrationApiClient;
  customerType?: string | null;
}): Promise<PublicContractOffer[]> {
  const tenantSlug = await loadCompanySlugById(input.client.company_id);
  const primary = await supabaseService
    .from("canonical_public_contract_offers_v")
    .select("*")
    .eq("company_id", input.client.company_id)
    .eq("is_archived", false)
    .order("sort_order", { ascending: true })
    .order("public_name", { ascending: true });

  if (primary.error) throw primary.error;
  const offers = ((primary.data ?? []) as Array<Record<string, unknown>>)
    .filter(isWebsitePublishedRow)
    .map(mapOfferRow);
  const [graphIntegrity, readinessByVersion, legalByBundle, portfolioByOffer] =
    await Promise.all([
      loadPublicationGraphIntegrity(
        input.client.company_id,
        offers.map((offer) => offer.id),
      ),
      loadPublicationReadinessByVersion(input.client.company_id, offers),
      loadLegalVersionsByBundle(input.client.company_id, offers),
      loadPortfolioPricingByOffer(input.client.company_id, offers),
    ]);

  const result: PublicContractOffer[] = [];
  for (const offer of offers) {
    if (graphIntegrity.get(offer.id)?.canonical_graph_consistent !== true)
      continue;
    if (!isCurrentlyValid(offer) || !customerTypeAllowed(offer, input.customerType))
      continue;
    const publicationVersionId = clean(offer.contract_publication_version_id);
    if (!publicationVersionId || readinessByVersion.get(publicationVersionId)?.isReady !== true)
      continue;
    const invoiceFeeReadiness = assessCanonicalInvoiceFee({
      rowAmount: offer.invoice_fee_sek,
      snapshot: offer.pricing_snapshot,
    });
    if (invoiceFeeReadiness.status !== "ready") continue;
    const legalBundleVersionId = clean(offer.legal_bundle_version_id);
    const legalVersions = legalBundleVersionId
      ? legalByBundle.get(legalBundleVersionId) ?? null
      : null;
    if (!hasExactCanonicalLegalVersions(legalVersions)) continue;
    const portfolioPricing = portfolioPricingForOffer(offer, portfolioByOffer);
    result.push({
      ...offer,
      tenant_slug: tenantSlug ?? null,
      legal_versions: legalVersions ?? undefined,
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
  };
  readiness: {
    canonical_graph_consistent: boolean;
    forward_publication_link_valid: boolean;
    reverse_legacy_link_valid: boolean;
    company_chain_valid: boolean;
    tenant_assignment_valid: boolean;
    channel_valid: boolean;
    source_offer_consistent: boolean;
    pricing_ready: boolean;
    legal_ready: boolean;
    invoice_fee_ready: boolean;
    publication_active: boolean;
    application_acceptance_ready: boolean;
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
  const offers = rows.map(mapOfferRow);
  const [graphIntegrity, readinessByVersion, legalByBundle] = await Promise.all([
    loadPublicationGraphIntegrity(
      input.client.company_id,
      offers.map((offer) => offer.id),
    ),
    loadPublicationReadinessByVersion(input.client.company_id, offers),
    loadLegalVersionsByBundle(input.client.company_id, offers),
  ]);
  const diagnostics: PublicContractOfferDiagnostic[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const offer = offers[index];
    const blockers: string[] = [];
    const graph = graphIntegrity.get(offer.id) ?? null;
    if (graph?.canonical_graph_consistent !== true)
      blockers.push("PUBLICATION_GRAPH_INCONSISTENT");
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

    const publicationVersionId = clean(offer.contract_publication_version_id);
    const readiness = publicationVersionId
      ? readinessByVersion.get(publicationVersionId) ?? {
          isReady: false,
          blockers: ["Publiceringsversionen hittades inte för bolaget"],
        }
      : {
          isReady: false,
          blockers: ["Kanonisk publiceringsversion saknas"],
        };
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

    const legalBundleVersionId = clean(offer.legal_bundle_version_id);
    const strictLegal = legalBundleVersionId
      ? legalByBundle.get(legalBundleVersionId) ?? null
      : null;
    if (blockers.length === 0 && !hasExactCanonicalLegalVersions(strictLegal))
      blockers.push("Erbjudandets exakta juridikpaket kunde inte verifieras");

    const legalReady = hasExactCanonicalLegalVersions(strictLegal);
    const invoiceFeeReady = invoiceFeeReadiness.status === "ready";
    const pricingReady = readiness.isReady && invoiceFeeReady;
    const applicationAcceptanceReady =
      legalReady &&
      (!offer.power_of_attorney_required ||
        Boolean(strictLegal?.some((version) => version.type === "power_of_attorney")));
    const visible = blockers.length === 0;
    diagnostics.push({
      id: offer.canonical_offer_reference ?? null,
      name: offer.public_name,
      product_code: offer.product_code,
      publication_status: publicationStatus,
      website_enabled: row.website_enabled !== false,
      valid_from: offer.valid_from,
      valid_to: offer.valid_to,
      customer_type: offer.customer_type,
      visible,
      blockers: Array.from(new Set(blockers)),
      offer_reference: offer.canonical_offer_reference ?? null,
      graph: graph
        ? {
            canonical_graph_consistent: graph.canonical_graph_consistent,
            forward_publication_link_valid:
              graph.forward_publication_link_valid,
            reverse_legacy_link_valid: graph.reverse_legacy_link_valid,
            company_chain_valid: graph.company_chain_valid,
            tenant_assignment_valid: graph.tenant_assignment_valid,
            channel_valid: graph.channel_valid,
            product_version_valid: graph.product_version_valid,
            source_offer_consistent: graph.source_offer_consistent,
            publication_active: graph.publication_active,
          }
        : null,
      pricing_readiness: { invoice_fee: invoiceFeeReadiness },
      readiness: {
        canonical_graph_consistent: graph?.canonical_graph_consistent === true,
        forward_publication_link_valid:
          graph?.forward_publication_link_valid === true,
        reverse_legacy_link_valid: graph?.reverse_legacy_link_valid === true,
        company_chain_valid: graph?.company_chain_valid === true,
        tenant_assignment_valid: graph?.tenant_assignment_valid === true,
        channel_valid: graph?.channel_valid === true,
        source_offer_consistent: graph?.source_offer_consistent === true,
        pricing_ready: pricingReady,
        legal_ready: legalReady,
        invoice_fee_ready: invoiceFeeReady,
        publication_active: graph?.publication_active === true,
        application_acceptance_ready: applicationAcceptanceReady,
      },
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
