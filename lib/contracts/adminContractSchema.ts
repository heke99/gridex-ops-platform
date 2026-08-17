import { z } from "zod";

import { slugifyContract } from "@/lib/contracts/slug";
import {
  commercialComponentSchema,
  commercialModelSchema,
  isReservedStandardComponentCode,
  priceOptionSchema,
  type CommercialPriceComponent,
  type ContractPriceOption,
  type InvoiceDeliveryMethod,
} from "@/lib/pricing/commercialModel";

export const CONTRACT_LIFECYCLE_STATUSES = [
  "draft",
  "ready",
  "published",
  "paused",
  "expired",
  "closed",
  "archived",
] as const;

export type ContractLifecycleStatus =
  (typeof CONTRACT_LIFECYCLE_STATUSES)[number];

export const CONTRACT_EDITABLE_LIFECYCLE_STATUSES = ["draft", "ready"] as const;
export type ContractEditableLifecycleStatus =
  (typeof CONTRACT_EDITABLE_LIFECYCLE_STATUSES)[number];

export const POWER_OF_ATTORNEY_MODES = [
  "always_required",
  "required_when_information_missing",
  "not_required",
] as const;

export type PowerOfAttorneyMode = (typeof POWER_OF_ATTORNEY_MODES)[number];

export const OPTIONAL_FEE_UNITS = [
  "sek_once",
  "sek_contract",
  "sek_invoice",
  "sek_month",
  "ore_per_kwh",
] as const;

export type OptionalFeeUnit = (typeof OPTIONAL_FEE_UNITS)[number];

export type StructuredOptionalFee = {
  id: string;
  label: string;
  amount: number;
  unit: OptionalFeeUnit;
  calculation_base: string | null;
  billing_frequency: "once" | "per_invoice" | "monthly" | "per_kwh";
  lifecycle: "once_per_contract" | "per_invoice" | "recurring";
  website_visibility: boolean;
  vat_treatment: "standard" | "exempt";
  sort_order: number;
};

const contractTypeSchema = z.enum([
  "fixed",
  "variable_monthly",
  "variable_hourly",
  "variable_quarterly",
  "portfolio",
  "mixed",
]);

const customerTypeSchema = z.enum(["private", "business", "both"]);
const lifecycleStatusSchema = z.enum(CONTRACT_EDITABLE_LIFECYCLE_STATUSES);
const powerOfAttorneyModeSchema = z.enum(POWER_OF_ATTORNEY_MODES);

function raw(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullableNumber(value: string, label: string): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed)) throw new Error(`${label} måste vara ett giltigt tal.`);
  return parsed;
}

function nonNegativeNullableNumber(value: string, label: string): number | null {
  const parsed = nullableNumber(value, label);
  if (parsed !== null && parsed < 0) {
    throw new Error(`${label} får inte vara negativ.`);
  }
  return parsed;
}

function resolveCanonicalAmount(input: {
  direct: number | null;
  component: number | null;
  label: string;
}): number | null {
  if (input.component !== null && input.component < 0) {
    throw new Error(`${input.label} får inte vara negativ.`);
  }
  if (
    input.direct !== null &&
    input.component !== null &&
    Math.abs(input.direct - input.component) > 1e-9
  ) {
    throw new Error(
      `${input.label} skiljer sig mellan avtalsfältet och en äldre priskomponent. Korrigera beloppet så att avtalet har en enda källa.`,
    );
  }
  return input.component ?? input.direct;
}

function nullableInteger(value: string, label: string): number | null {
  if (!value) return null;
  if (!/^-?\d+$/.test(value)) throw new Error(`${label} måste vara ett heltal.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} är för stort.`);
  return parsed;
}

function booleanValue(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}

function nullableCalendarDate(value: string, label: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`${label} måste anges som YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} finns inte i kalendern.`);
  }
  return value;
}

function booleanToken(value: string, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["ja", "yes", "true", "1", "synlig"].includes(normalized)) return true;
  if (["nej", "no", "false", "0", "dold"].includes(normalized)) return false;
  throw new Error(`Synlighet måste vara ja eller nej, inte "${value}".`);
}

function feeLifecycle(unit: OptionalFeeUnit): StructuredOptionalFee["lifecycle"] {
  if (unit === "sek_invoice") return "per_invoice";
  if (unit === "sek_once" || unit === "sek_contract") return "once_per_contract";
  return "recurring";
}

function feeFrequency(unit: OptionalFeeUnit): StructuredOptionalFee["billing_frequency"] {
  if (unit === "sek_invoice") return "per_invoice";
  if (unit === "sek_month") return "monthly";
  if (unit === "ore_per_kwh") return "per_kwh";
  return "once";
}

export function parseStructuredOptionalFees(
  value: string,
  defaultWebsiteVisibility: boolean,
): StructuredOptionalFee[] {
  if (!value.trim()) return [];

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [
        label,
        amountText,
        unitText,
        visibleText,
        calculationBaseText,
        vatText,
        sortOrderText,
      ] = line.split("|").map((part) => part.trim());

      if (!label) throw new Error(`Övrig avgift på rad ${index + 1} saknar namn.`);
      const amount = nullableNumber(amountText, `Övrig avgift ${label}`);
      if (amount === null || amount < 0)
        throw new Error(`Övrig avgift ${label} måste ha ett belopp på minst 0.`);

      const parsedUnit = z.enum(OPTIONAL_FEE_UNITS).safeParse(unitText || "sek_contract");
      if (!parsedUnit.success)
        throw new Error(`Övrig avgift ${label} har en ogiltig enhet.`);
      const unit = parsedUnit.data;

      const sortOrder = nullableInteger(sortOrderText, `Sortering för ${label}`) ?? 900 + index;
      if (sortOrder < 0) throw new Error(`Sortering för ${label} får inte vara negativ.`);

      const vatNormalized = (vatText || "standard").toLowerCase();
      if (!["standard", "exempt", "momsfri"].includes(vatNormalized))
        throw new Error(`Momshantering för ${label} måste vara standard eller exempt.`);

      return {
        id: `optional_${index + 1}`,
        label,
        amount,
        unit,
        calculation_base: calculationBaseText || null,
        billing_frequency: feeFrequency(unit),
        lifecycle: feeLifecycle(unit),
        website_visibility: booleanToken(visibleText, defaultWebsiteVisibility),
        vat_treatment: vatNormalized === "standard" ? "standard" : "exempt",
        sort_order: sortOrder,
      };
    });
}

export type ParsedAdminContractForm = {
  id: string | null;
  companyId: string;
  name: string;
  slug: string | null;
  lifecycleStatus: ContractLifecycleStatus;
  legacyStatus: "draft" | "active" | "inactive";
  isActive: boolean;
  contractType: z.infer<typeof contractTypeSchema>;
  customerType: z.infer<typeof customerTypeSchema>;
  campaignName: string | null;
  campaignCode: string | null;
  campaignVersion: string | null;
  termsVersion: string | null;
  description: string | null;
  maxCustomers: number | null;
  discountValue: number | null;
  discountUnit: string | null;
  discountCalculationBase: string | null;
  discountMonths: number | null;
  discountStartsOnMode: "contract_start" | "calendar_month";
  startFeeSek: number | null;
  adminFeeSek: number | null;
  breakFeeSek: number | null;
  vatRate: number;
  fixedPriceOrePerKwh: number | null;
  fixedPricesByArea: string;
  spotMarkupOrePerKwh: number | null;
  variableFeeOrePerKwh: number | null;
  monthlyFeeSek: number | null;
  invoiceFeeSek: number | null;
  greenFeeMode: "none" | "sek_month" | "ore_per_kwh";
  greenFeeValue: number | null;
  bindingMonths: number | null;
  noticeMonths: number | null;
  automaticRenewal: boolean;
  automaticRenewalTermMonths: number | null;
  powerOfAttorneyMode: PowerOfAttorneyMode;
  powerOfAttorneyRequired: boolean;
  validFrom: string | null;
  validTo: string | null;
  optionalFees: StructuredOptionalFee[];
  rawOptionalFeeLines: string;
  priceOptions: ContractPriceOption[];
  commercialComponents: CommercialPriceComponent[];
  invoiceDeliveryMethods: InvoiceDeliveryMethod[];
  priceAreas: string;
  portfolioId: string;
  portfolioSettlementTiming: string;
  portfolioEstimateRule: string;
  portfolioShowHistoricalFinal: boolean;
  portfolioShowIndication: boolean;
  portfolioManagementFeeAmount: string;
  portfolioManagementFeeUnit: string;
  portfolioManagementFeeCalculationBase: string;
  spotWeightPercent: number;
  portfolioWeightPercent: number;
  fixedWeightPercent: number;
  spotIntervalResolution: string;
  productionEnabled: boolean;
  productionCompensationOrePerKwh: string;
  productionVatRate: string;
  productionSettlementMode: string;
  visibility: Record<string, boolean>;
};

function parseJsonArray(
  value: string,
  label: string,
): unknown[] {
  if (!value) throw new Error(`${label} saknas.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} innehåller ogiltig JSON.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} måste vara en lista.`);
  return parsed;
}

function firstComponent(
  components: CommercialPriceComponent[],
  codes: readonly string[],
): CommercialPriceComponent | null {
  const normalizedCodes = new Set(codes.map((code) => code.toLowerCase()));
  return (
    components.find((component) =>
      normalizedCodes.has(component.component_code.trim().toLowerCase()),
    ) ?? null
  );
}

function firstComponentAmount(
  components: CommercialPriceComponent[],
  codes: readonly string[],
): number | null {
  return firstComponent(components, codes)?.amount ?? null;
}

export function parseAdminContractForm(formData: FormData): ParsedAdminContractForm {
  const companyId = raw(formData, "company_id");
  const name = raw(formData, "name");
  if (!companyId) throw new Error("Bolag krävs.");
  if (!name) throw new Error("Avtalsnamn krävs.");

  const lifecycleStatus = lifecycleStatusSchema.parse(raw(formData, "lifecycle_status") || "draft");
  const contractType = contractTypeSchema.parse(raw(formData, "contract_type") || "variable_hourly");
  const customerType = customerTypeSchema.parse(raw(formData, "customer_type") || "both");
  const powerOfAttorneyMode = powerOfAttorneyModeSchema.parse(
    raw(formData, "power_of_attorney_mode") || "required_when_information_missing",
  );

  const legacyStatus = "draft" as const;
  const isActive = false;

  const maxCustomers = nullableInteger(raw(formData, "max_customers"), "Max antal kunder");
  if (maxCustomers !== null && maxCustomers < 1)
    throw new Error("Max antal kunder måste vara minst 1.");

  const discountValue = nullableNumber(raw(formData, "discount_value"), "Rabatt");
  const discountMonths = nullableInteger(raw(formData, "discount_months"), "Rabattperiod");
  if (discountValue !== null && discountValue < 0) throw new Error("Rabatt får inte vara negativ.");
  if (discountValue !== null && (discountMonths === null || discountMonths < 1))
    throw new Error("Rabatt kräver en rabattperiod på minst en månad.");

  const bindingMonths = nullableInteger(raw(formData, "default_binding_months"), "Bindningstid");
  const noticeMonths = nullableInteger(raw(formData, "default_notice_months"), "Uppsägningstid");
  if ((bindingMonths ?? 0) < 0 || (noticeMonths ?? 0) < 0)
    throw new Error("Bindnings- och uppsägningstid får inte vara negativa.");

  const automaticRenewal = booleanValue(formData, "automatic_renewal");
  const automaticRenewalTermMonths = nullableInteger(
    raw(formData, "automatic_renewal_term_months"),
    "Förlängningsperiod",
  );
  if (automaticRenewal && (automaticRenewalTermMonths === null || automaticRenewalTermMonths < 1))
    throw new Error("Automatisk förlängning kräver en förlängningsperiod på minst en månad.");

  const validFrom = nullableCalendarDate(
    raw(formData, "valid_from"),
    "Giltig från",
  );
  const validTo = nullableCalendarDate(
    raw(formData, "valid_to"),
    "Giltig till",
  );
  if (validFrom && validTo && validTo < validFrom)
    throw new Error("Slutdatum får inte ligga före startdatum.");

  const defaultWeights = contractType === "portfolio"
    ? { spot: 0, portfolio: 100, fixed: 0 }
    : contractType === "mixed"
      ? { spot: 50, portfolio: 50, fixed: 0 }
      : contractType === "fixed"
        ? { spot: 0, portfolio: 0, fixed: 100 }
        : { spot: 100, portfolio: 0, fixed: 0 };
  const spotWeightPercent = nullableNumber(raw(formData, "spot_weight_percent"), "Rörlig andel") ?? defaultWeights.spot;
  const portfolioWeightPercent = nullableNumber(raw(formData, "portfolio_weight_percent"), "Portföljandel") ?? defaultWeights.portfolio;
  const fixedWeightPercent = nullableNumber(raw(formData, "fixed_weight_percent"), "Fast andel") ?? defaultWeights.fixed;
  if (Math.round((spotWeightPercent + portfolioWeightPercent + fixedWeightPercent) * 1000) / 1000 !== 100)
    throw new Error("Prisandelarna måste tillsammans bli exakt 100 procent.");
  if (
    contractType === "portfolio" &&
    (spotWeightPercent !== 0 || portfolioWeightPercent !== 100 || fixedWeightPercent !== 0)
  ) {
    throw new Error(
      "Ett portföljavtal måste vara 100 procent portfölj. Använd mixavtal för flera prisdelar.",
    );
  }
  if (
    contractType === "mixed" &&
    [spotWeightPercent, portfolioWeightPercent, fixedWeightPercent].filter(
      (weight) => weight > 0,
    ).length < 2
  ) {
    throw new Error("Ett mixavtal måste innehålla minst två positiva prisandelar.");
  }

  const defaultOptionalFeeVisibility = booleanValue(formData, "show_optional_fees_on_website");
  const rawOptionalFeeLines = raw(formData, "optional_fee_lines");

  const visibilityKeys = [
    "fixed_price",
    "spot_markup",
    "variable_fee",
    "monthly_fee",
    "invoice_fee",
    "green_fee",
    "electricity_certificate",
    "start_fee",
    "admin_fee",
    "break_fee",
    "portfolio_price",
    "portfolio_management_fee",
    "discount",
    "optional_fees",
    "production_compensation",
  ];
  const visibility = Object.fromEntries(
    visibilityKeys.map((key) => [key, booleanValue(formData, `show_${key}_on_website`)]),
  );

  const greenFeeModeRaw = raw(formData, "green_fee_mode") || "none";
  if (!["none", "sek_month", "ore_per_kwh"].includes(greenFeeModeRaw))
    throw new Error("Miljöavgiften har en ogiltig enhet.");

  const directMonthlyFeeSek = nonNegativeNullableNumber(
    raw(formData, "monthly_fee_sek"),
    "Månadsavgift",
  );
  const directInvoiceFeeSek = nonNegativeNullableNumber(
    raw(formData, "invoice_fee_sek"),
    "Fakturaavgift",
  );
  const directGreenFeeValue = nonNegativeNullableNumber(
    raw(formData, "green_fee_value"),
    "Miljöavgift",
  );
  const directStartFeeSek = nonNegativeNullableNumber(
    raw(formData, "start_fee_sek"),
    "Startavgift",
  );
  const directAdminFeeSek = nonNegativeNullableNumber(
    raw(formData, "admin_fee_sek"),
    "Administrativ avgift",
  );
  const directBreakFeeSek = nonNegativeNullableNumber(
    raw(formData, "break_fee_sek"),
    "Brytavgift",
  );

  const vatRate = nullableNumber(raw(formData, "vat_rate"), "Moms") ?? 25;
  if (vatRate < 0 || vatRate > 100) throw new Error("Moms måste vara mellan 0 och 100 procent.");

  const priceOptions = z
    .array(priceOptionSchema)
    .min(1, "Minst ett prisalternativ krävs.")
    .max(40)
    .parse(parseJsonArray(raw(formData, "price_options_json"), "Prisalternativ"));
  const commercialComponents = z
    .array(commercialComponentSchema)
    .max(200)
    .parse(
      parseJsonArray(
        raw(formData, "commercial_components_json"),
        "Priskomponenter",
      ),
    );
  const invoiceDeliveryMethods = z
    .array(z.enum(["email", "e_invoice", "paper", "direct_debit"]))
    .min(1, "Minst ett faktureringssätt krävs.")
    .parse(
      parseJsonArray(
        raw(formData, "invoice_delivery_methods_json"),
        "Faktureringssätt",
      ),
    );
  commercialModelSchema.parse({
    schema_version: "gridex_contract_pricing_v6_selection",
    price_options: priceOptions,
    components: commercialComponents,
    invoice_delivery_methods: invoiceDeliveryMethods,
  });

  // Publication-level contract terms describe the default customer choice.
  // Keep them identical to the explicit default price option so the website,
  // quote engine, signed contract row and agreement evidence cannot disagree.
  const defaultPriceOption = priceOptions.find((option) => option.default);
  if (!defaultPriceOption) {
    throw new Error("Standardprisalternativ saknas.");
  }
  const canonicalBindingMonths = bindingMonths ?? 0;
  const canonicalNoticeMonths = noticeMonths ?? 0;
  const canonicalRenewalTermMonths = automaticRenewal
    ? automaticRenewalTermMonths
    : null;
  if (
    defaultPriceOption.binding_months !== canonicalBindingMonths ||
    defaultPriceOption.notice_months !== canonicalNoticeMonths ||
    defaultPriceOption.auto_renew_enabled !== automaticRenewal ||
    defaultPriceOption.renewal_term_months !== canonicalRenewalTermMonths
  ) {
    throw new Error(
      "Standardprisalternativets bindnings-, uppsägnings- och förlängningsvillkor måste matcha avtalets standardvillkor.",
    );
  }

  const selectableCommercialComponents = commercialComponents.filter(
    (component) =>
      !isReservedStandardComponentCode(component.component_code),
  );
  const componentMonthlyFee = firstComponentAmount(commercialComponents, [
    "monthly_fee",
  ]);
  const componentInvoiceFee = firstComponentAmount(commercialComponents, [
    "invoice_fee",
    "invoice_administration_fee",
  ]);
  const componentGreenFee = firstComponent(commercialComponents, [
    "green_energy_fee",
    "green_fee",
  ]);
  const componentStartFee = firstComponentAmount(commercialComponents, [
    "start_fee",
  ]);
  const componentAdminFee = firstComponentAmount(commercialComponents, [
    "administration_fee",
    "admin_fee",
  ]);
  const componentBreakFee = firstComponentAmount(commercialComponents, [
    "break_fee",
  ]);

  const monthlyFeeSek = resolveCanonicalAmount({
    direct: directMonthlyFeeSek,
    component: componentMonthlyFee,
    label: "Månadsavgiften",
  });
  const invoiceFeeSek = resolveCanonicalAmount({
    direct: directInvoiceFeeSek,
    component: componentInvoiceFee,
    label: "Fakturaavgiften",
  });
  if (invoiceFeeSek === null) {
    throw new Error(
      "Fakturaavgift måste anges för avtalet. Ange 0 kr om avtalet är avgiftsfritt.",
    );
  }

  const componentGreenFeeMode =
    componentGreenFee?.unit === "sek_month"
      ? "sek_month"
      : componentGreenFee?.unit === "ore_per_kwh"
        ? "ore_per_kwh"
        : null;
  if (componentGreenFee && componentGreenFeeMode === null) {
    throw new Error(
      "En äldre miljöavgiftskomponent har en ogiltig enhet. Använd kr/månad eller öre/kWh.",
    );
  }
  if (
    componentGreenFeeMode &&
    greenFeeModeRaw !== "none" &&
    componentGreenFeeMode !== greenFeeModeRaw
  ) {
    throw new Error(
      "Miljöavgiftens enhet skiljer sig mellan avtalsfältet och en äldre priskomponent.",
    );
  }
  const greenFeeMode = (
    componentGreenFeeMode ?? greenFeeModeRaw
  ) as "none" | "sek_month" | "ore_per_kwh";
  const greenFeeValue = resolveCanonicalAmount({
    direct: directGreenFeeValue,
    component: componentGreenFee?.amount ?? null,
    label: "Miljöavgiften",
  });
  if (greenFeeMode === "none" && greenFeeValue !== null) {
    throw new Error(
      "Miljöavgiften har ett belopp men saknar avgiftsmodell. Välj kr/månad eller öre/kWh.",
    );
  }
  if (greenFeeMode !== "none" && greenFeeValue === null) {
    throw new Error("Vald miljöavgiftsmodell kräver ett belopp.");
  }

  const startFeeSek = resolveCanonicalAmount({
    direct: directStartFeeSek,
    component: componentStartFee,
    label: "Startavgiften",
  });
  const adminFeeSek = resolveCanonicalAmount({
    direct: directAdminFeeSek,
    component: componentAdminFee,
    label: "Administrationsavgiften",
  });
  const breakFeeSek = resolveCanonicalAmount({
    direct: directBreakFeeSek,
    component: componentBreakFee,
    label: "Brytavgiften",
  });
  if (priceOptions.some((option) => option.contract_type !== contractType)) {
    throw new Error(
      "Alla prisalternativ måste tillhöra den valda avtalstypen.",
    );
  }
  const requiresFixedAreaPrices =
    contractType === "fixed" ||
    (contractType === "mixed" && fixedWeightPercent > 0);
  if (
    !requiresFixedAreaPrices &&
    priceOptions.some((option) => option.area_prices.length > 0)
  ) {
    throw new Error(
      "Fasta områdespriser får bara anges för fastpris eller en fast andel i ett mixavtal.",
    );
  }
  const priceAreas = Array.from(
    new Set(
      (raw(formData, "price_areas") || raw(formData, "price_area"))
        .split(/[\s,;|]+/)
        .map((area) => area.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  const invalidPriceArea = priceAreas.find(
    (area) => !["SE1", "SE2", "SE3", "SE4"].includes(area),
  );
  if (invalidPriceArea) {
    throw new Error(`Ogiltigt elområde: ${invalidPriceArea}.`);
  }
  if (priceAreas.length === 0) {
    throw new Error("Avtalet måste gälla i minst ett elområde.");
  }
  if (requiresFixedAreaPrices) {
    const expectedAreas = [...priceAreas].sort().join(",");
    for (const option of priceOptions) {
      const optionAreas = option.area_prices
        .map((row) => row.price_area)
        .sort()
        .join(",");
      if (optionAreas !== expectedAreas) {
        throw new Error(
          `Prisalternativet ${option.customer_name} måste ha exakt en fastprisruta för varje valt elområde när avtalet innehåller en fast prisandel.`,
        );
      }
    }
  }
  const optionReferences = new Set(
    priceOptions.map((option) => option.price_option_reference),
  );
  for (const component of commercialComponents) {
    const invalidOption = component.conditions.price_option_references.find(
      (reference) => !optionReferences.has(reference),
    );
    if (invalidOption) {
      throw new Error(
        `Komponenten ${component.component_reference} hänvisar till ett prisalternativ som inte finns.`,
      );
    }
  }
  return {
    id: raw(formData, "id") || null,
    companyId,
    name,
    slug: slugifyContract(raw(formData, "slug") || name) || null,
    lifecycleStatus,
    legacyStatus,
    isActive,
    contractType,
    customerType,
    campaignName: raw(formData, "campaign_name") || null,
    campaignCode: raw(formData, "campaign_code") || null,
    campaignVersion: raw(formData, "campaign_version") || null,
    termsVersion: raw(formData, "terms_version") || null,
    description: raw(formData, "description") || null,
    maxCustomers,
    discountValue,
    discountUnit: raw(formData, "discount_unit") || null,
    discountCalculationBase: raw(formData, "discount_calculation_base") || null,
    discountMonths,
    discountStartsOnMode: raw(formData, "discount_starts_on_mode") === "calendar_month" ? "calendar_month" : "contract_start",
    startFeeSek,
    adminFeeSek,
    breakFeeSek,
    vatRate,
    fixedPriceOrePerKwh:
      requiresFixedAreaPrices &&
      priceOptions[0]?.area_prices.length === 1
        ? priceOptions[0].area_prices[0].amount
        : null,
    fixedPricesByArea:
      requiresFixedAreaPrices
        ? priceOptions[0].area_prices
            .map((row) => `${row.price_area} | ${row.amount}`)
            .join("\n")
        : "",
    spotMarkupOrePerKwh: nullableNumber(raw(formData, "spot_markup_ore_per_kwh"), "Spotpåslag"),
    variableFeeOrePerKwh: nullableNumber(raw(formData, "variable_fee_ore_per_kwh"), "Rörlig avgift"),
    monthlyFeeSek,
    invoiceFeeSek,
    greenFeeMode,
    greenFeeValue,
    bindingMonths,
    noticeMonths,
    automaticRenewal,
    automaticRenewalTermMonths,
    powerOfAttorneyMode,
    powerOfAttorneyRequired: powerOfAttorneyMode !== "not_required",
    validFrom,
    validTo,
    optionalFees: parseStructuredOptionalFees(rawOptionalFeeLines, defaultOptionalFeeVisibility),
    rawOptionalFeeLines,
    priceOptions,
    commercialComponents: selectableCommercialComponents,
    invoiceDeliveryMethods,
    priceAreas: priceAreas.join(","),
    portfolioId: raw(formData, "portfolio_id"),
    portfolioSettlementTiming: raw(formData, "portfolio_settlement_timing") || "after_month_close",
    portfolioEstimateRule: raw(formData, "portfolio_estimate_rule") || "none",
    portfolioShowHistoricalFinal: booleanValue(formData, "portfolio_show_historical_final"),
    portfolioShowIndication: booleanValue(formData, "portfolio_show_indication"),
    portfolioManagementFeeAmount: raw(formData, "portfolio_management_fee_amount"),
    portfolioManagementFeeUnit: raw(formData, "portfolio_management_fee_unit") || "ore_per_kwh",
    portfolioManagementFeeCalculationBase: raw(formData, "portfolio_management_fee_calculation_base"),
    spotWeightPercent,
    portfolioWeightPercent,
    fixedWeightPercent,
    spotIntervalResolution: raw(formData, "spot_interval_resolution") || "monthly",
    productionEnabled: booleanValue(formData, "production_enabled"),
    productionCompensationOrePerKwh: raw(formData, "production_compensation_ore_per_kwh"),
    productionVatRate: raw(formData, "production_vat_rate"),
    productionSettlementMode: raw(formData, "production_settlement_mode") || "credit_invoice",
    visibility,
  };
}
