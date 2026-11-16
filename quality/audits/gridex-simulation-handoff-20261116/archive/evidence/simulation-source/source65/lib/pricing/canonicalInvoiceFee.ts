export type InvoiceFeeReadinessCode =
  "invoice_fee_missing" | "invoice_fee_conflict" | "invoice_fee_ambiguous";

export type CanonicalInvoiceFeeReadiness =
  | {
      status: "ready";
      amount: number;
      unit: "sek_invoice";
      calculation_type: "per_invoice";
      website_card_visible: boolean;
      source: "price_plan_version";
    }
  | {
      status: "blocked";
      code: InvoiceFeeReadinessCode;
      amount?: number;
      unit?: "sek_invoice";
      calculation_type?: "per_invoice";
      website_card_visible?: boolean;
      source?: "price_plan_version";
    };

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return null;
}

export function parseCanonicalInvoiceFee(
  value: unknown,
  options: { required?: boolean } = {},
): number | null {
  const isBlank =
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "");

  if (isBlank) {
    if (options.required) {
      throw new Error(
        "Fakturaavgift måste anges. Ange 0 om avtalet saknar fakturaavgift.",
      );
    }
    return null;
  }

  const parsed = finiteNumber(value);
  if (parsed === null) {
    throw new Error("Fakturaavgift måste vara ett giltigt numeriskt värde.");
  }
  if (parsed < 0) {
    throw new Error("Fakturaavgift kan inte vara negativ.");
  }
  return parsed;
}

export function invoiceFeeComponents(
  snapshot: Record<string, unknown> | null | undefined,
): Record<string, unknown>[] {
  const values = Array.isArray(snapshot?.price_components)
    ? snapshot.price_components
    : Array.isArray(snapshot?.price_components_snapshot)
      ? snapshot.price_components_snapshot
      : [];

  return values.filter((value): value is Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const component = value as Record<string, unknown>;
    const metadata = objectValue(component.metadata);
    const code =
      clean(component.component_code) ||
      clean(component.component_type) ||
      clean(metadata.component_code);
    const status = clean(component.status) || "active";
    return code === "invoice_fee" && status === "active";
  });
}

function isCanonicalInvoiceFeeComponent(
  component: Record<string, unknown>,
): boolean {
  const amount = finiteNumber(component.amount);
  return (
    clean(component.unit) === "sek_invoice" &&
    clean(component.calculation_type) === "per_invoice" &&
    amount !== null &&
    amount >= 0
  );
}

function websiteCardVisible(component: Record<string, unknown>): boolean {
  const direct = booleanValue(component.website_card_visible);
  if (direct !== null) return direct;
  const metadata = objectValue(component.metadata);
  const visibility = objectValue(metadata.visibility);
  return booleanValue(visibility.website_card) ?? true;
}

export function canonicalInvoiceFeeFromSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
): number | null {
  const canonical = invoiceFeeComponents(snapshot).filter(
    isCanonicalInvoiceFeeComponent,
  );
  if (canonical.length !== 1) return null;
  return finiteNumber(canonical[0].amount);
}

export function assessCanonicalInvoiceFee(input: {
  rowAmount: unknown;
  snapshot: Record<string, unknown> | null | undefined;
}): CanonicalInvoiceFeeReadiness {
  const matching = invoiceFeeComponents(input.snapshot);
  if (matching.length > 1) {
    return { status: "blocked", code: "invoice_fee_ambiguous" };
  }

  const canonical = matching.filter(isCanonicalInvoiceFeeComponent);
  if (canonical.length !== 1) {
    return { status: "blocked", code: "invoice_fee_missing" };
  }

  const amount = finiteNumber(canonical[0].amount);
  const rowAmount = finiteNumber(input.rowAmount);
  if (amount === null || amount < 0) {
    return { status: "blocked", code: "invoice_fee_missing" };
  }
  if (
    rowAmount === null ||
    rowAmount < 0 ||
    Math.abs(rowAmount - amount) > 1e-9
  ) {
    return {
      status: "blocked",
      code: "invoice_fee_conflict",
      amount,
      unit: "sek_invoice",
      calculation_type: "per_invoice",
      website_card_visible: websiteCardVisible(canonical[0]),
      source: "price_plan_version",
    };
  }

  return {
    status: "ready",
    amount,
    unit: "sek_invoice",
    calculation_type: "per_invoice",
    website_card_visible: websiteCardVisible(canonical[0]),
    source: "price_plan_version",
  };
}

export function upsertCanonicalInvoiceFeeComponent(input: {
  snapshot: Record<string, unknown>;
  amount: number;
  websiteCardVisible: boolean;
}): Record<string, unknown> {
  const amount = parseCanonicalInvoiceFee(input.amount, { required: true });
  const source = Array.isArray(input.snapshot.price_components)
    ? input.snapshot.price_components
    : [];
  const retained = source.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return true;
    const component = value as Record<string, unknown>;
    const metadata = objectValue(component.metadata);
    const code =
      clean(component.component_code) ||
      clean(component.component_type) ||
      clean(metadata.component_code);
    return code !== "invoice_fee";
  });

  return {
    ...input.snapshot,
    price_components: [
      ...retained,
      {
        component_code: "invoice_fee",
        component_type: "invoice_fee",
        name: "Fakturaavgift",
        amount,
        calculation_type: "per_invoice",
        unit: "sek_invoice",
        priority: 110,
        status: "active",
        website_card_visible: input.websiteCardVisible,
        metadata: {
          lifecycle: "per_invoice",
          visibility: {
            website_card: input.websiteCardVisible,
            quote_breakdown: true,
            checkout: true,
            contract_document: true,
            invoice: true,
          },
        },
      },
    ],
  };
}

export function buildCanonicalContractPricingCommand(input: {
  pricingModel: string;
  pricingSnapshot: Record<string, unknown>;
  invoiceFeeSek: unknown;
}): {
  pricing_model: string;
  invoice_fee_sek: number | null;
  pricing_snapshot: Record<string, unknown>;
} {
  const invoiceFeeSek = parseCanonicalInvoiceFee(input.invoiceFeeSek);
  const pricingSnapshot = {
    ...input.pricingSnapshot,
    pricing_model: input.pricingModel,
  };

  const hasSnapshotInvoiceFee =
    invoiceFeeComponents(pricingSnapshot).length > 0;
  if (invoiceFeeSek !== null || hasSnapshotInvoiceFee) {
    const readiness = assessCanonicalInvoiceFee({
      rowAmount: invoiceFeeSek,
      snapshot: pricingSnapshot,
    });
    if (readiness.status !== "ready") {
      throw new Error(
        `Fakturaavgiften är inte synkroniserad med prisversionen (${readiness.code}).`,
      );
    }
  }

  return {
    pricing_model: input.pricingModel,
    invoice_fee_sek: invoiceFeeSek,
    pricing_snapshot: pricingSnapshot,
  };
}
