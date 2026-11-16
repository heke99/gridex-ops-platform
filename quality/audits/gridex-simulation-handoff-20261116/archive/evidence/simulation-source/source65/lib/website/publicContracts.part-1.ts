// Extracted from publicContracts.ts; keep public imports on the facade module.



import { buildPublicLegalUrl } from "@/lib/legal/publicLegalDocuments"
import { normalizeCustomerType } from "@/lib/customers/normalizeCustomerType"

import { publicReference } from "@/lib/integrations/publicReferences"
import { buildCustomerLegalDocuments, customerLegalAcceptanceCategoryForModule, type CustomerLegalModuleVersion } from "@/lib/legal/customerDocumentPackage"
import { PUBLIC_CONTRACT_ERROR_CODES, PublicContractSerializationError, type PublicContractPriceOption } from "@/lib/external-contracts/publicContractModel"
import { canonicalSwedishPriceArea } from "@/lib/pricing/types"

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
  price_options?: PublicContractPriceOption[];
};

export type LegacyLegalAcceptanceType =
  | "terms"
  | "privacy_policy"
  | "withdrawal"
  | "power_of_attorney"
  | "price_terms";

export const LEGAL_ACCEPTANCE_MODULE_PRIORITY: Record<
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

export function legalAcceptanceTypeForModule(
  moduleKey: string,
): LegacyLegalAcceptanceType {
  return customerLegalAcceptanceCategoryForModule(moduleKey);
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

export function buildPublicLegalBlock(input: {
  companyId: string;
  legalVersions: PublicLegalTextVersion[];
  termsVersionFallback?: string | null;
  withdrawalVersionFallback?: string | null;
  tenantSlug?: string | null;
  allowHistoricalNull?: boolean;
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
  const documentReference = (type: LegacyLegalAcceptanceType) => {
    const id = byAcceptanceType.get(type)?.id;
    return id ? publicReference("legal_document", input.companyId, id) : null;
  };
  const required = (type: LegacyLegalAcceptanceType) =>
    Boolean(byAcceptanceType.get(type));
  const urlForVersion = (version: PublicLegalTextVersion | null | undefined) =>
    slug && version
      ? buildPublicLegalUrl(slug, version.type, version.id)
      : null;
  const url = (type: LegacyLegalAcceptanceType) =>
    urlForVersion(byAcceptanceType.get(type));

  const bundleIds = new Set(
    input.legalVersions
      .map((version) => version.legal_bundle_version_id ?? null)
      .filter((value): value is string => Boolean(value)),
  );
  const hasMissingBundleId = input.legalVersions.some(
    (version) => !version.legal_bundle_version_id,
  );
  if (input.legalVersions.length === 0 || (hasMissingBundleId && !input.allowHistoricalNull)) {
    throw new PublicContractSerializationError(
      PUBLIC_CONTRACT_ERROR_CODES.legalBundleVersionMissing,
      "legal.legal_bundle_version_id",
    );
  }
  if (bundleIds.size > 1) {
    throw new PublicContractSerializationError(
      PUBLIC_CONTRACT_ERROR_CODES.legalModuleBundleMismatch,
      "legal.module_versions",
    );
  }
  const legalBundleVersionId = bundleIds.values().next().value ?? null;
  const seenModuleKeys = new Set<string>();
  const moduleVersions = input.legalVersions.map((version, index) => {
    if (seenModuleKeys.has(version.type)) {
      throw new PublicContractSerializationError(
        PUBLIC_CONTRACT_ERROR_CODES.legalModuleVersionInvalid,
        `legal.module_versions[${index}].module_key`,
      );
    }
    seenModuleKeys.add(version.type);
    if ((version.legal_bundle_version_id ?? null) !== legalBundleVersionId) {
      throw new PublicContractSerializationError(
        PUBLIC_CONTRACT_ERROR_CODES.legalModuleBundleMismatch,
        `legal.module_versions[${index}].legal_bundle_version_id`,
      );
    }
    return {
      id: version.id,
      document_reference: publicReference("legal_document", input.companyId, version.id),
      module_key: version.type,
      version: version.version,
      title: version.title,
      published_at: version.published_at,
      content_sha256: version.content_sha256 ?? null,
      origin: version.origin ?? "canonical_bundle_document",
      legal_bundle_version_id: legalBundleVersionId,
      url: urlForVersion(version),
    };
  });
  const customerDocuments = legalBundleVersionId
    ? buildCustomerLegalDocuments({
        companyId: input.companyId,
        legalBundleVersionId,
        modules: moduleVersions as CustomerLegalModuleVersion[],
        urlForKind: (kind) =>
          slug
            ? buildPublicLegalUrl(slug, kind, legalBundleVersionId)
            : null,
      })
    : [];

  return {
    terms_version: versionLabel("terms", input.termsVersionFallback),
    privacy_policy_version: versionLabel("privacy_policy"),
    withdrawal_version: versionLabel(
      "withdrawal",
      input.withdrawalVersionFallback,
    ),
    power_of_attorney_version: versionLabel("power_of_attorney"),
    power_of_attorney_version_id:
      byAcceptanceType.get("power_of_attorney")?.id ?? null,
    price_terms_version: versionLabel("price_terms"),
    terms_required: required("terms"),
    privacy_policy_required: required("privacy_policy"),
    withdrawal_required: required("withdrawal"),
    price_terms_required: required("price_terms"),
    power_of_attorney_required: required("power_of_attorney"),
    terms_document_reference: documentReference("terms"),
    privacy_policy_document_reference: documentReference("privacy_policy"),
    withdrawal_document_reference: documentReference("withdrawal"),
    price_terms_document_reference: documentReference("price_terms"),
    power_of_attorney_document_reference: documentReference("power_of_attorney"),
    terms_url: url("terms"),
    privacy_policy_url: url("privacy_policy"),
    withdrawal_url: url("withdrawal"),
    price_terms_url: url("price_terms"),
    power_of_attorney_url: url("power_of_attorney"),
    required_modules: moduleVersions.map((version) => version.module_key),
    module_versions: moduleVersions,
    customer_documents: customerDocuments,
    legal_bundle_reference: legalBundleVersionId
      ? publicReference("legal_bundle", input.companyId, legalBundleVersionId)
      : null,
    legal_bundle_version_id: legalBundleVersionId,
    immutable: moduleVersions.length > 0,
  };
}

export function missingSchema(error: unknown): boolean {
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

export function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function numberOrNull(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const PUBLIC_PRICING_VISIBILITY_KEYS = [
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

export type PublicPricingVisibilityKey =
  (typeof PUBLIC_PRICING_VISIBILITY_KEYS)[number];

export function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return null;
}

export function pricingComponents(
  offer: PublicContractOffer,
): Record<string, unknown>[] {
  return Array.isArray(offer.pricing_snapshot?.price_components)
    ? offer.pricing_snapshot.price_components.filter(
        (value): value is Record<string, unknown> =>
          Boolean(value) && typeof value === "object" && !Array.isArray(value),
      )
    : [];
}

export function componentCode(component: Record<string, unknown>): string {
  return (
    clean(component.component_code) ??
    clean(component.component_type) ??
    clean(objectValue(component.metadata).component_code) ??
    ""
  );
}

export function componentMatchesVisibilityKey(
  component: Record<string, unknown>,
  key: PublicPricingVisibilityKey,
): boolean {
  const code = componentCode(component);
  if (key === "optional_fees") return code.startsWith("optional_");
  return code === key;
}

export function explicitComponentWebsiteVisibility(
  component: Record<string, unknown>,
): boolean | null {
  const direct = booleanOrNull(component.website_card_visible);
  if (direct !== null) return direct;
  const metadata = objectValue(component.metadata);
  const visibility = objectValue(metadata.visibility);
  return booleanOrNull(visibility.website_card);
}

export function pricingWebsiteVisibility(
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

export type WebsiteVisibilityMode = "visible" | "hidden" | "summary_only";

export type CalculationInclusion = "included" | "excluded" | "conditional";

export function componentWebsiteVisibilityMode(
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

export function componentCalculationInclusion(
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

export function publicComponentMetadata(
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

export function normalizeCalculationComponent(
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

export function syntheticComponent(input: {
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

export function calculationPricingComponents(
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

export function websiteDisplayPricingComponents(
  components: Record<string, unknown>[],
): Record<string, unknown>[] {
  return components.filter(
    (component) => componentWebsiteVisibilityMode(component) === "visible",
  );
}

export function websiteSummaryPricingComponents(
  components: Record<string, unknown>[],
): Record<string, unknown>[] {
  return components.filter(
    (component) => componentWebsiteVisibilityMode(component) !== "hidden",
  );
}

export function componentByCode(
  components: Record<string, unknown>[],
  code: string,
): Record<string, unknown> | null {
  return (
    components.find((component) => componentCode(component) === code) ?? null
  );
}

export function publicPortfolioMonthlyPrices(
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
      price_area_code:
        canonicalSwedishPriceArea(row.price_area_code) ??
        canonicalSwedishPriceArea(row.price_area),
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

export function currentPortfolioPriceBlock(rows: Record<string, unknown>[]) {
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
  const selectedMonth = normalizedMonth
    ? [...months].reverse().find((month) => month <= normalizedMonth) ?? null
    : months.at(-1) ?? null;
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

export function calculationBaseComponents(
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

export function publicPortfolioMethod(offer: PublicContractOffer) {
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

export function publicEnergyDirection(offer: Pick<PublicContractOffer, "energy_direction" | "pricing_snapshot">): "consumption" | "production" {
  const explicit = clean(offer.pricing_snapshot?.energy_direction) ?? offer.energy_direction;
  if (explicit === "production") return "production";
  if (explicit === "consumption") return "consumption";
  const production = objectValue(offer.pricing_snapshot?.production);
  return production.enabled === true ? "production" : "consumption";
}

export function normalizePublicResolution(value: unknown): "monthly" | "hourly" | "quarterly" | null {
  const resolution = clean(value);
  if (resolution === "quarter_hour" || resolution === "quarterly") return "quarterly";
  if (resolution === "hourly" || resolution === "monthly") return resolution;
  return null;
}

export function publicProductionTerms(offer: PublicContractOffer) {
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

export function customerTypeAllowed(
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

export function mapOfferRow(row: Record<string, unknown>): PublicContractOffer {
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
      ? row.price_areas
          .map((area) => canonicalSwedishPriceArea(area))
          .filter((area): area is NonNullable<typeof area> => Boolean(area))
      : [],
    automatic_renewal: row.automatic_renewal === true,
    power_of_attorney_required: row.power_of_attorney_required !== false,
  };
}
