import type { PriceComponent } from "@/lib/pricing/types";

// Shared unchanged billing normalization for accepted snapshot components.
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function legacyComponentShape(row: Record<string, unknown>): {
  componentType: string | null;
  calculationType: string | null;
  unit: string | null;
} {
  const code = (stringValue(row.code) ?? "").toLowerCase();
  const rawUnit = (stringValue(row.unit) ?? "").toLowerCase();
  if (code === "fixed_price")
    return { componentType: null, calculationType: null, unit: null };
  if (code === "monthly_fee")
    return {
      componentType: "fixed_monthly_fee",
      calculationType: "fixed_monthly",
      unit: "sek_month",
    };
  if (code === "invoice_fee")
    return {
      componentType: "invoice_fee",
      calculationType: "fixed_once",
      unit: "sek_invoice",
    };
  if (code === "spot_markup")
    return {
      componentType: "spot_markup",
      calculationType: "ore_per_kwh",
      unit: "ore_per_kwh",
    };
  if (code === "variable_fee")
    return {
      componentType: "variable_fee",
      calculationType: "ore_per_kwh",
      unit: "ore_per_kwh",
    };
  if (code === "green_fee") {
    if (rawUnit === "sek_month")
      return {
        componentType: "green_energy_fee",
        calculationType: "fixed_monthly",
        unit: "sek_month",
      };
    if (rawUnit === "ore_per_kwh" || rawUnit === "ore/kwh")
      return {
        componentType: "green_energy_fee",
        calculationType: "ore_per_kwh",
        unit: "ore_per_kwh",
      };
    return {
      componentType: "green_energy_fee",
      calculationType: "per_kwh",
      unit: rawUnit || "sek_per_kwh",
    };
  }
  return { componentType: null, calculationType: null, unit: null };
}

export function normalizePriceComponent(
  row: Record<string, unknown>,
): PriceComponent | null {
  const legacy = legacyComponentShape(row);
  const name =
    stringValue(row.name) ??
    stringValue(row.component_label) ??
    stringValue(row.label);
  const amount = numberValue(row.amount) ?? numberValue(row.value_amount);
  const calculationType =
    stringValue(row.calculation_type) ??
    stringValue(row.calculation_unit) ??
    legacy.calculationType;
  const componentType = stringValue(row.component_type) ?? legacy.componentType;
  if (!name || amount === null || !calculationType || !componentType)
    return null;
  const metadata = isObject(row.metadata) ? row.metadata : {};
  const selectionPolicy =
    stringValue(row.selection_policy) ??
    stringValue(metadata.selection_policy);
  const calculationInclusion =
    stringValue(row.calculation_inclusion) ??
    stringValue(metadata.calculation_inclusion);
  const lifecycle =
    stringValue(row.lifecycle) ?? stringValue(metadata.lifecycle);
  const selectionSource =
    stringValue(row.selection_source) ??
    stringValue(metadata.selection_source);
  return {
    componentReference:
      stringValue(row.component_reference) ??
      stringValue(metadata.component_reference) ??
      stringValue(metadata.component_key),
    componentCode:
      stringValue(row.component_code) ??
      stringValue(metadata.component_code),
    componentType,
    name,
    description: stringValue(row.description),
    calculationType,
    calculationBase:
      stringValue(row.calculation_base) ??
      stringValue(metadata.calculation_base),
    amount,
    unit: stringValue(row.unit) ?? legacy.unit ?? calculationType,
    vatApplicable:
      typeof row.vat_applicable === "boolean" ? row.vat_applicable : true,
    invoiceLineVisible:
      typeof row.invoice_line_visible === "boolean"
        ? row.invoice_line_visible
        : true,
    periodizationMode: stringValue(row.periodization_mode),
    priority: numberValue(row.priority),
    validFrom: stringValue(row.valid_from),
    validTo: stringValue(row.valid_to),
    selectionPolicy:
      selectionPolicy === "mandatory" ||
      selectionPolicy === "customer_optional" ||
      selectionPolicy === "admin_optional" ||
      selectionPolicy === "conditional"
        ? selectionPolicy
        : undefined,
    calculationInclusion:
      calculationInclusion === "included" ||
      calculationInclusion === "excluded" ||
      calculationInclusion === "conditional"
        ? calculationInclusion
        : undefined,
    selected:
      typeof row.selected === "boolean"
        ? row.selected
        : typeof metadata.selected === "boolean"
          ? metadata.selected
          : undefined,
    selectionSource:
      selectionSource === "mandatory" ||
      selectionSource === "customer" ||
      selectionSource === "admin" ||
      selectionSource === "condition" ||
      selectionSource === "default"
        ? selectionSource
        : undefined,
    eligible:
      typeof row.eligible === "boolean"
        ? row.eligible
        : metadata.eligibility === "eligible"
          ? true
          : metadata.eligibility === "ineligible"
            ? false
            : undefined,
    lifecycle:
      lifecycle === "recurring" ||
      lifecycle === "per_invoice" ||
      lifecycle === "per_site" ||
      lifecycle === "once_per_contract" ||
      lifecycle === "once_per_site" ||
      lifecycle === "annual" ||
      lifecycle === "consumption_based" ||
      lifecycle === "event_only"
        ? lifecycle
        : undefined,
    periodizationRule:
      stringValue(row.periodization_rule) === "active_days" ||
      stringValue(row.periodization_rule) === "full_month" ||
      stringValue(row.periodization_rule) === "anniversary"
        ? (stringValue(row.periodization_rule) as
            | "active_days"
            | "full_month"
            | "anniversary")
        : "none",
    invoiceDeliveryMethod:
      stringValue(row.invoice_delivery_method) === "email" ||
      stringValue(row.invoice_delivery_method) === "e_invoice" ||
      stringValue(row.invoice_delivery_method) === "paper" ||
      stringValue(row.invoice_delivery_method) === "direct_debit"
        ? (stringValue(row.invoice_delivery_method) as
            | "email"
            | "e_invoice"
            | "paper"
            | "direct_debit")
        : undefined,
    metadata: isObject(row.metadata) ? row.metadata : {},
  };
}
