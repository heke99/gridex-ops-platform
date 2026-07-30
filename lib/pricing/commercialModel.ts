import { z } from "zod";

import type { PriceArea, PriceComponent } from "@/lib/pricing/types";

export const CONTRACT_TYPES = [
  "fixed",
  "variable_monthly",
  "variable_hourly",
  "variable_quarterly",
  "portfolio",
  "mixed",
] as const;

export type CanonicalContractType = (typeof CONTRACT_TYPES)[number];

export const COMPONENT_SELECTION_POLICIES = [
  "mandatory",
  "customer_optional",
  "admin_optional",
  "conditional",
] as const;

export type ComponentSelectionPolicy =
  (typeof COMPONENT_SELECTION_POLICIES)[number];

export const COMPONENT_UNITS = [
  "ore_per_kwh",
  "sek_per_kwh",
  "sek_month",
  "sek_site_month",
  "sek_invoice",
  "sek_year",
  "sek_contract",
  "sek_once",
  "sek_event",
  "percent",
] as const;

export type CommercialComponentUnit = (typeof COMPONENT_UNITS)[number];

export const COMPONENT_LIFECYCLES = [
  "recurring",
  "per_invoice",
  "per_site",
  "once_per_contract",
  "once_per_site",
  "annual",
  "consumption_based",
  "event_only",
] as const;

export type CommercialComponentLifecycle =
  (typeof COMPONENT_LIFECYCLES)[number];

export const INVOICE_DELIVERY_METHODS = [
  "email",
  "e_invoice",
  "paper",
  "direct_debit",
] as const;

export type InvoiceDeliveryMethod =
  (typeof INVOICE_DELIVERY_METHODS)[number];

const stableReference = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "Datumet finns inte i kalendern.");

const nullableDate = z.union([dateOnly, z.null()]);
const priceAreaSchema = z.enum(["SE1", "SE2", "SE3", "SE4"]);

export const priceOptionAreaPriceSchema = z
  .object({
    price_row_reference: stableReference,
    price_area: priceAreaSchema,
    amount: z.number().finite().positive(),
    unit: z.enum(["ore_per_kwh", "sek_per_kwh"]),
    vat_treatment: z.enum(["standard", "exempt"]).default("standard"),
    valid_from: nullableDate.default(null),
    valid_to: nullableDate.default(null),
    metadata: z.record(z.unknown()).default({}),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.valid_from && row.valid_to && row.valid_to < row.valid_from) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valid_to"],
        message: "Områdesprisets slutdatum ligger före startdatumet.",
      });
    }
  });

export const priceOptionSchema = z
  .object({
    price_option_reference: stableReference,
    option_code: stableReference,
    customer_name: z.string().trim().min(1).max(160),
    internal_description: z.string().trim().max(1_000).nullable().default(null),
    contract_type: z.enum(CONTRACT_TYPES),
    customer_type: z
      .enum(["private", "business", "both"])
      .default("both"),
    binding_months: z.number().int().min(0).max(240),
    notice_months: z.number().int().min(0).max(36),
    auto_renew_enabled: z.boolean(),
    renewal_term_months: z.number().int().min(1).max(120).nullable(),
    default: z.boolean().default(false),
    selection_required: z.boolean().default(false),
    valid_from: nullableDate.default(null),
    valid_to: nullableDate.default(null),
    earliest_start_date: nullableDate.default(null),
    latest_start_date: nullableDate.default(null),
    status: z.enum(["draft", "active", "paused", "archived"]).default("draft"),
    sort_order: z.number().int().min(0).max(100_000),
    version_number: z.number().int().min(1).default(1),
    area_prices: z.array(priceOptionAreaPriceSchema).max(4),
    metadata: z.record(z.unknown()).default({}),
  })
  .strict()
  .superRefine((option, context) => {
    if (
      option.auto_renew_enabled &&
      option.renewal_term_months === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["renewal_term_months"],
        message:
          "Automatisk förlängning kräver en förlängningsperiod.",
      });
    }
    if (option.contract_type === "fixed" && option.area_prices.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["area_prices"],
        message: "Fastprisalternativ kräver minst ett områdespris.",
      });
    }
    if (
      !option.auto_renew_enabled &&
      option.renewal_term_months !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["renewal_term_months"],
        message:
          "Förlängningsperiod får bara anges när automatisk förlängning är vald.",
      });
    }
    if (
      option.valid_from &&
      option.valid_to &&
      option.valid_to < option.valid_from
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valid_to"],
        message: "Prisalternativets slutdatum ligger före startdatumet.",
      });
    }
    if (
      option.earliest_start_date &&
      option.latest_start_date &&
      option.latest_start_date < option.earliest_start_date
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latest_start_date"],
        message: "Senaste startdatum ligger före tidigaste startdatum.",
      });
    }
    const areas = option.area_prices.map((row) => row.price_area);
    if (new Set(areas).size !== areas.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["area_prices"],
        message: "Ett prisalternativ får bara ha en rad per elområde.",
      });
    }
    const rowReferences = option.area_prices.map(
      (row) => row.price_row_reference,
    );
    if (new Set(rowReferences).size !== rowReferences.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["area_prices"],
        message: "Områdesprisernas referenser måste vara unika.",
      });
    }
  });

const componentConditionsSchema = z
  .object({
    contract_types: z.array(z.enum(CONTRACT_TYPES)).default([]),
    price_option_references: z.array(stableReference).default([]),
    price_areas: z.array(priceAreaSchema).default([]),
    customer_types: z
      .array(z.enum(["private", "business"]))
      .default([]),
    invoice_delivery_methods: z
      .array(z.enum(INVOICE_DELIVERY_METHODS))
      .default([]),
    sales_channels: z
      .array(z.enum(["internal", "website", "api", "phone", "partner"]))
      .default([]),
    minimum_site_count: z.number().int().min(1).nullable().default(null),
    maximum_site_count: z.number().int().min(1).nullable().default(null),
    minimum_annual_consumption_kwh: z
      .number()
      .min(0)
      .nullable()
      .default(null),
    maximum_annual_consumption_kwh: z
      .number()
      .min(0)
      .nullable()
      .default(null),
    valid_from: nullableDate.default(null),
    valid_to: nullableDate.default(null),
  })
  .strict();

export const commercialComponentSchema = z
  .object({
    component_reference: stableReference,
    component_code: stableReference,
    internal_name: z.string().trim().min(1).max(160),
    customer_name: z.string().trim().min(1).max(160),
    internal_description: z.string().trim().max(1_000).nullable().default(null),
    customer_description: z.string().trim().max(1_000).nullable().default(null),
    component_type: stableReference,
    amount: z.number().finite(),
    unit: z.enum(COMPONENT_UNITS),
    calculation_type: z.enum([
      "per_kwh",
      "per_month",
      "per_site_month",
      "per_invoice",
      "per_year",
      "fixed_once",
      "percentage",
      "event_only",
    ]),
    calculation_base: z
      .enum([
        "energy_cost_ex_vat",
        "energy_cost_inc_vat",
        "spot_cost",
        "portfolio_cost",
        "total_variable_cost",
        "invoice_subtotal",
        "monthly_fixed_amount",
      ])
      .nullable()
      .default(null),
    vat_treatment: z.enum(["standard", "exempt"]),
    selection_policy: z.enum(COMPONENT_SELECTION_POLICIES),
    default_selected: z.boolean(),
    customer_can_deselect: z.boolean(),
    admin_must_select: z.boolean(),
    informational_only: z.boolean().default(false),
    lifecycle: z.enum(COMPONENT_LIFECYCLES),
    periodization_rule: z.enum([
      "none",
      "active_days",
      "full_month",
      "anniversary",
    ]),
    invoice_line_name: z.string().trim().min(1).max(160),
    accounting_classification: z.string().trim().min(1).max(100),
    sort_order: z.number().int().min(0).max(100_000),
    valid_from: nullableDate.default(null),
    valid_to: nullableDate.default(null),
    conditions: componentConditionsSchema.default({}),
    website_published: z.boolean().default(true),
    metadata: z.record(z.unknown()).default({}),
  })
  .strict()
  .superRefine((component, context) => {
    if (component.amount < 0 && !component.component_type.includes("discount")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "Negativa belopp tillåts endast för rabattkomponenter.",
      });
    }
    if (component.unit === "percent" && !component.calculation_base) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["calculation_base"],
        message: "En procentkomponent kräver beräkningsbas.",
      });
    }
    if (
      component.selection_policy === "mandatory" &&
      (!component.default_selected || component.customer_can_deselect)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selection_policy"],
        message:
          "En obligatorisk komponent ska vara vald och får inte kunna väljas bort.",
      });
    }
    if (
      component.selection_policy === "customer_optional" &&
      !component.website_published
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["website_published"],
        message:
          "En kundvalbar komponent måste vara publicerad för kunden.",
      });
    }
    if (
      component.selection_policy === "admin_optional" &&
      !component.admin_must_select
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["admin_must_select"],
        message:
          "En administratörsvalbar komponent måste kräva ett uttryckligt adminval.",
      });
    }
    if (
      component.conditions.minimum_site_count !== null &&
      component.conditions.maximum_site_count !== null &&
      component.conditions.maximum_site_count <
        component.conditions.minimum_site_count
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conditions", "maximum_site_count"],
        message: "Max antal anläggningar ligger under minsta antal.",
      });
    }
    if (
      component.valid_from &&
      component.valid_to &&
      component.valid_to < component.valid_from
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valid_to"],
        message: "Komponentens slutdatum ligger före startdatumet.",
      });
    }
  });

export type ContractPriceOption = z.infer<typeof priceOptionSchema>;
export type CommercialPriceComponent = z.infer<
  typeof commercialComponentSchema
>;

export const commercialModelSchema = z
  .object({
    schema_version: z.literal("gridex_contract_pricing_v6_selection"),
    price_options: z.array(priceOptionSchema).min(1).max(40),
    components: z.array(commercialComponentSchema).max(200),
    invoice_delivery_methods: z
      .array(z.enum(INVOICE_DELIVERY_METHODS))
      .min(1),
  })
  .strict()
  .superRefine((model, context) => {
    const optionReferences = model.price_options.map(
      (option) => option.price_option_reference,
    );
    if (new Set(optionReferences).size !== optionReferences.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_options"],
        message: "Prisalternativens referenser måste vara unika.",
      });
    }
    const optionCodes = model.price_options.map((option) => option.option_code);
    if (new Set(optionCodes).size !== optionCodes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_options"],
        message: "Prisalternativens koder måste vara unika.",
      });
    }
    const defaultOptions = model.price_options.filter((option) => option.default);
    if (defaultOptions.length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_options"],
        message: "Exakt ett prisalternativ måste vara standardalternativ.",
      });
    }
    if (
      new Set(
        model.price_options.map((option) => option.selection_required),
      ).size !== 1
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_options"],
        message:
          "Alla prisalternativ i erbjudandet måste ha samma valpolicy.",
      });
    }
    const componentReferences = model.components.map(
      (component) => component.component_reference,
    );
    if (new Set(componentReferences).size !== componentReferences.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["components"],
        message: "Komponentreferenser måste vara unika.",
      });
    }
    const componentCodes = model.components.map(
      (component) => component.component_code,
    );
    if (new Set(componentCodes).size !== componentCodes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["components"],
        message: "Komponentkoder måste vara unika.",
      });
    }
  });

export type CanonicalCommercialModel = z.infer<typeof commercialModelSchema>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function commercialModelFromSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
): CanonicalCommercialModel | null {
  const rawOptions = Array.isArray(snapshot?.price_options)
    ? snapshot.price_options
    : [];
  const defaultReference =
    typeof snapshot?.default_price_option_reference === "string"
      ? snapshot.default_price_option_reference
      : null;
  const normalizedOptions = rawOptions.map((value) => {
    const option = asRecord(value);
    const metadata = asRecord(option.metadata);
    const reference =
      typeof option.price_option_reference === "string"
        ? option.price_option_reference
        : "";
    return {
      ...option,
      customer_type:
        option.customer_type ?? snapshot?.customer_type ?? "both",
      default:
        option.default ??
        metadata.is_default ??
        (defaultReference
          ? reference === defaultReference
          : rawOptions.length === 1),
      selection_required:
        option.selection_required ??
        metadata.selection_required ??
        rawOptions.length > 1,
    };
  });
  const parsed = commercialModelSchema.safeParse({
    schema_version:
      snapshot?.snapshot_schema ?? snapshot?.schema_version ?? "",
    price_options: normalizedOptions,
    components:
      snapshot?.commercial_components ??
      snapshot?.price_components ??
      snapshot?.price_components_snapshot ??
      [],
    invoice_delivery_methods:
      snapshot?.invoice_delivery_methods ?? ["email", "e_invoice", "paper"],
  });
  return parsed.success ? parsed.data : null;
}

function dateInRange(
  date: string,
  validFrom: string | null,
  validTo: string | null,
): boolean {
  return (!validFrom || validFrom <= date) && (!validTo || validTo >= date);
}

function includesOrAll<T>(allowed: T[], value: T): boolean {
  return allowed.length === 0 || allowed.includes(value);
}

function isComponentEligible(
  component: CommercialPriceComponent,
  input: {
    contractType: CanonicalContractType;
    priceOptionReference: string;
    priceArea: PriceArea;
    customerType: "private" | "business";
    invoiceDeliveryMethod: InvoiceDeliveryMethod;
    salesChannel: "internal" | "website" | "api" | "phone" | "partner";
    annualConsumptionKwh: number;
    siteCount: number;
    startDate: string;
  },
): boolean {
  const conditions = component.conditions;
  if (!dateInRange(input.startDate, component.valid_from, component.valid_to))
    return false;
  if (!dateInRange(input.startDate, conditions.valid_from, conditions.valid_to))
    return false;
  if (!includesOrAll(conditions.contract_types, input.contractType))
    return false;
  if (
    !includesOrAll(
      conditions.price_option_references,
      input.priceOptionReference,
    )
  )
    return false;
  if (!includesOrAll(conditions.price_areas, input.priceArea)) return false;
  if (!includesOrAll(conditions.customer_types, input.customerType))
    return false;
  if (
    !includesOrAll(
      conditions.invoice_delivery_methods,
      input.invoiceDeliveryMethod,
    )
  )
    return false;
  if (!includesOrAll(conditions.sales_channels, input.salesChannel))
    return false;
  if (
    conditions.minimum_site_count !== null &&
    input.siteCount < conditions.minimum_site_count
  )
    return false;
  if (
    conditions.maximum_site_count !== null &&
    input.siteCount > conditions.maximum_site_count
  )
    return false;
  if (
    conditions.minimum_annual_consumption_kwh !== null &&
    input.annualConsumptionKwh <
      conditions.minimum_annual_consumption_kwh
  )
    return false;
  if (
    conditions.maximum_annual_consumption_kwh !== null &&
    input.annualConsumptionKwh >
      conditions.maximum_annual_consumption_kwh
  )
    return false;
  return true;
}

function calculationType(
  component: CommercialPriceComponent,
): PriceComponent["calculationType"] {
  if (component.unit === "ore_per_kwh") return "ore_per_kwh";
  if (component.unit === "sek_per_kwh") return "per_kwh";
  if (
    component.unit === "sek_month" ||
    component.unit === "sek_site_month"
  )
    return "fixed_monthly";
  if (component.unit === "percent") return "percentage";
  if (component.unit === "sek_event") return "event_only";
  if (component.unit === "sek_invoice") return "per_invoice";
  return "fixed_once";
}

export function commercialComponentAsPriceComponent(
  component: CommercialPriceComponent,
  input: {
    selected: boolean;
    selectionSource:
      | "mandatory"
      | "customer"
      | "admin"
      | "condition"
      | "default";
    eligible: boolean;
    siteCount: number;
    invoiceDeliveryMethod: InvoiceDeliveryMethod;
  },
): PriceComponent {
  return {
    componentReference: component.component_reference,
    componentCode: component.component_code,
    componentType: component.component_type,
    name: component.invoice_line_name || component.customer_name,
    description: component.customer_description,
    calculationType: calculationType(component),
    calculationBase: component.calculation_base,
    amount: component.amount,
    unit: component.unit,
    vatApplicable: component.vat_treatment !== "exempt",
    invoiceLineVisible: !component.informational_only,
    periodizationMode:
      component.periodization_rule === "active_days"
        ? "active_days"
        : component.periodization_rule === "full_month"
          ? "full_month"
          : "none",
    priority: component.sort_order,
    validFrom: component.valid_from,
    validTo: component.valid_to,
    selectionPolicy: component.selection_policy,
    calculationInclusion: component.informational_only
      ? "excluded"
      : "included",
    selected: input.selected,
    selectionSource: input.selectionSource,
    eligible: input.eligible,
    lifecycle: component.lifecycle,
    periodizationRule: component.periodization_rule,
    invoiceDeliveryMethod: input.invoiceDeliveryMethod,
    metadata: {
      ...asRecord(component.metadata),
      component_reference: component.component_reference,
      component_code: component.component_code,
      component_key: component.component_reference,
      selection_policy: component.selection_policy,
      calculation_inclusion: component.informational_only
        ? "excluded"
        : "included",
      selected: input.selected,
      selection_source: input.selectionSource,
      eligibility: input.eligible ? "eligible" : "ineligible",
      lifecycle: component.lifecycle,
      periodization_rule: component.periodization_rule,
      calculation_base: component.calculation_base,
      invoice_delivery_method: input.invoiceDeliveryMethod,
      site_count: input.siteCount,
      accounting_classification: component.accounting_classification,
      invoice_line_name: component.invoice_line_name,
    },
  };
}

export class CommercialSelectionError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(message: string, code: string, field: string) {
    super(message);
    this.name = "CommercialSelectionError";
    this.code = code;
    this.field = field;
  }
}

export function resolveCommercialSelection(input: {
  model: CanonicalCommercialModel;
  contractType: CanonicalContractType;
  priceOptionReference: string | null;
  priceArea: PriceArea;
  customerType: "private" | "business";
  invoiceDeliveryMethod: InvoiceDeliveryMethod;
  selectedComponentReferences: string[];
  adminSelectedComponentReferences?: string[];
  annualConsumptionKwh: number;
  siteCount: number;
  startDate: string;
  salesChannel: "internal" | "website" | "api" | "phone" | "partner";
}): {
  priceOption: ContractPriceOption;
  areaPrice: ContractPriceOption["area_prices"][number] | null;
  components: PriceComponent[];
  selectedComponentReferences: string[];
  mandatoryComponentReferences: string[];
  conditionalComponentReferences: string[];
} {
  const explicitlySelected = input.priceOptionReference !== null;
  const option = explicitlySelected
    ? input.model.price_options.find(
        (candidate) =>
          candidate.price_option_reference === input.priceOptionReference,
      ) ?? null
    : input.model.price_options.length === 1 &&
        input.model.price_options[0].selection_required === false
      ? input.model.price_options[0]
      : null;
  if (!option) {
    throw new CommercialSelectionError(
      input.priceOptionReference === null
        ? "Ett prisalternativ måste väljas uttryckligen."
        : "Prisalternativet saknas eller tillhör inte erbjudandet.",
      input.priceOptionReference === null
        ? "price_option_required"
        : "price_option_not_found",
      "price_option_reference",
    );
  }
  if (
    option.customer_type !== "both" &&
    option.customer_type !== input.customerType
  ) {
    throw new CommercialSelectionError(
      "Prisalternativet stödjer inte vald kundtyp.",
      "price_option_customer_type_mismatch",
      "price_option_reference",
    );
  }
  if (
    option.contract_type !== input.contractType ||
    option.status !== "active" ||
    !dateInRange(input.startDate, option.valid_from, option.valid_to) ||
    (option.earliest_start_date &&
      input.startDate < option.earliest_start_date) ||
    (option.latest_start_date && input.startDate > option.latest_start_date)
  ) {
    throw new CommercialSelectionError(
      "Prisalternativet är inte aktivt eller giltigt för vald avtalsstart.",
      "price_option_not_available",
      "price_option_reference",
    );
  }
  const areaPrice = option.area_prices.find(
    (row) =>
      row.price_area === input.priceArea &&
      dateInRange(input.startDate, row.valid_from, row.valid_to),
  ) ?? null;
  if (input.contractType === "fixed" && !areaPrice) {
    throw new CommercialSelectionError(
      `Prisalternativet saknar ett giltigt pris för ${input.priceArea}.`,
      "price_option_area_price_missing",
      "price_option_reference",
    );
  }

  const requested = input.selectedComponentReferences;
  if (new Set(requested).size !== requested.length) {
    throw new CommercialSelectionError(
      "Samma tillägg får inte väljas flera gånger.",
      "duplicate_component_reference",
      "selected_component_references",
    );
  }
  const knownReferences = new Set(
    input.model.components.map((component) => component.component_reference),
  );
  const unknown = requested.find((reference) => !knownReferences.has(reference));
  if (unknown) {
    throw new CommercialSelectionError(
      `Komponenten ${unknown} tillhör inte erbjudandet.`,
      "component_reference_not_found",
      "selected_component_references",
    );
  }

  const adminSelected = new Set(
    input.adminSelectedComponentReferences ?? [],
  );
  const requestedSet = new Set(requested);
  const resolved: PriceComponent[] = [];
  const mandatory: string[] = [];
  const conditional: string[] = [];

  for (const component of input.model.components) {
    const eligible = isComponentEligible(component, {
      contractType: input.contractType,
      priceOptionReference: option.price_option_reference,
      priceArea: input.priceArea,
      customerType: input.customerType,
      invoiceDeliveryMethod: input.invoiceDeliveryMethod,
      salesChannel: input.salesChannel,
      annualConsumptionKwh: input.annualConsumptionKwh,
      siteCount: input.siteCount,
      startDate: input.startDate,
    });
    const requestedByCustomer = requestedSet.has(component.component_reference);
    let selected = false;
    let source: Parameters<typeof commercialComponentAsPriceComponent>[1]["selectionSource"] =
      "default";

    if (component.selection_policy === "mandatory") {
      selected = eligible;
      source = "mandatory";
      if (selected) mandatory.push(component.component_reference);
    } else if (component.selection_policy === "conditional") {
      selected = eligible;
      source = "condition";
      if (selected) conditional.push(component.component_reference);
    } else if (component.selection_policy === "customer_optional") {
      if (requestedByCustomer && !eligible) {
        throw new CommercialSelectionError(
          `Komponenten ${component.component_reference} är inte tillåten för kundens val.`,
          "component_not_eligible",
          "selected_component_references",
        );
      }
      selected = eligible && requestedByCustomer;
      source = requestedByCustomer ? "customer" : "default";
    } else {
      if (requestedByCustomer) {
        throw new CommercialSelectionError(
          `Komponenten ${component.component_reference} får bara väljas internt.`,
          "admin_component_customer_selection_forbidden",
          "selected_component_references",
        );
      }
      selected = eligible && adminSelected.has(component.component_reference);
      source = "admin";
    }

    if (selected && !component.informational_only) {
      resolved.push(
        commercialComponentAsPriceComponent(component, {
          selected,
          selectionSource: source,
          eligible,
          siteCount: input.siteCount,
          invoiceDeliveryMethod: input.invoiceDeliveryMethod,
        }),
      );
    }
  }

  return {
    priceOption: option,
    areaPrice,
    components: resolved,
    selectedComponentReferences: resolved.map(
      (component) => component.componentReference ?? "",
    ),
    mandatoryComponentReferences: mandatory,
    conditionalComponentReferences: conditional,
  };
}
