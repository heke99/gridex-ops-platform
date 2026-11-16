import { supabaseService } from "@/lib/supabase/service";
import { calculatePricingPreviewForUnderlay } from "@/lib/pricing/engine";

/**
 * Adapter that lets billing/export flows consume the Pricing Core
 * (lib/pricing/engine.ts) through the payload shape that the legacy
 * lib/billing/pricingEngine.ts used. This keeps billing_export_run_items
 * payload snapshots, the partner adapter and export files stable while making
 * the Pricing Core the only calculation path.
 */

export type UnderlayCorePricingLine = {
  componentRuleId: string;
  componentCode: string;
  componentLabel: string;
  componentType: string;
  calculationUnit: string;
  valueAmount: number | null;
  quantity: number | null;
  amountSekExVat: number;
  currency: string;
  appliesTo: string;
  vatRate: number;
  vatAmount: number;
  amountIncVat: number;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

export type UnderlayCoreIntervalEvidence = {
  id: string;
  billingUnderlayItemId: string | null;
  meteringIntervalStart: string;
  meteringIntervalEnd: string;
  resolution: string;
  consumptionKwh: number;
  priceSekPerKwh: number;
  amountExVat: number;
  priceSourceId: string | null;
  priceArea: string | null;
  evidenceSha256: string | null;
};

export type UnderlayCorePricingResult = {
  engine: "pricing_core_v1";
  status: "success" | "failed" | "needs_review";
  pricingRunId: string | null;
  underlayId: string;
  subtotalSekExVat: number;
  vatSek: number;
  totalSekIncVat: number;
  lines: UnderlayCorePricingLine[];
  warnings: string[];
  errors: string[];
  locked: boolean;
  energyDirection: "consumption" | "production" | "consumption_correction";
  settlementType: "invoice" | "credit_invoice" | "self_billing";
  intervalEvidence: UnderlayCoreIntervalEvidence[];
};

async function loadUnderlayEnergyFlow(input: {
  companyId: string;
  billingUnderlayId: string;
}): Promise<{
  energyDirection: "consumption" | "production" | "consumption_correction";
  settlementType: "invoice" | "credit_invoice" | "self_billing";
}> {
  const { data, error } = await supabaseService
    .from("billing_underlays")
    .select("energy_direction,settlement_type")
    .eq("company_id", input.companyId)
    .eq("id", input.billingUnderlayId)
    .single();
  if (error) throw error;
  const energyDirection =
    data.energy_direction === "production" ||
    data.energy_direction === "consumption_correction"
      ? data.energy_direction
      : "consumption";
  const settlementType =
    data.settlement_type === "credit_invoice" ||
    data.settlement_type === "self_billing"
      ? data.settlement_type
      : "invoice";
  return { energyDirection, settlementType };
}

export async function calculateUnderlayPricingWithCore(input: {
  companyId: string;
  billingUnderlayId: string;
  /**
   * Persist a pricing_run + preview lines and update underlay readiness.
   * Export/billing flows should persist so preview and billing always share
   * the same stored calculation.
   */
  persist?: boolean;
}): Promise<UnderlayCorePricingResult> {
  try {
    const [result, flow] = await Promise.all([
      calculatePricingPreviewForUnderlay({
        companyId: input.companyId,
        billingUnderlayId: input.billingUnderlayId,
        persist: input.persist ?? true,
      }),
      loadUnderlayEnergyFlow(input),
    ]);

    return {
      engine: "pricing_core_v1",
      status: result.status,
      pricingRunId: result.pricingRunId ?? null,
      underlayId: input.billingUnderlayId,
      subtotalSekExVat: result.totalExVat,
      vatSek: result.vatAmount,
      totalSekIncVat: result.totalIncVat,
      lines: result.lines.map((line, index) => ({
        componentRuleId: `pricing_core:${input.billingUnderlayId}:${line.sortOrder ?? index}`,
        componentCode: line.lineType,
        componentLabel: line.description,
        componentType: line.lineType,
        calculationUnit: line.unit,
        valueAmount: line.unitPriceExVat,
        quantity: line.quantity,
        amountSekExVat: line.amountExVat,
        currency: "SEK",
        appliesTo: "contract",
        vatRate: line.vatRate,
        vatAmount: line.vatAmount,
        amountIncVat: line.amountIncVat,
        sortOrder: line.sortOrder,
        metadata: line.metadata ?? {},
      })),
      warnings: result.warnings,
      errors: result.errors,
      locked: false,
      energyDirection: flow.energyDirection,
      settlementType: flow.settlementType,
      intervalEvidence: [],
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Prisberäkning misslyckades.";
    return {
      engine: "pricing_core_v1",
      status: "failed",
      pricingRunId: null,
      underlayId: input.billingUnderlayId,
      subtotalSekExVat: 0,
      vatSek: 0,
      totalSekIncVat: 0,
      lines: [],
      warnings: [],
      errors: [message],
      locked: false,
      energyDirection: "consumption",
      settlementType: "invoice",
      intervalEvidence: [],
    };
  }
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function loadLockedUnderlayPricingWithCore(input: {
  companyId: string;
  billingUnderlayId: string;
}): Promise<UnderlayCorePricingResult | null> {
  const { data: run, error: runError } = await supabaseService
    .from("pricing_runs")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("billing_underlay_id", input.billingUnderlayId)
    .eq("status", "locked")
    .order("locked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError && runError.code !== "PGRST116") throw runError;
  if (!run) return null;

  const [
    { data: lines, error: lineError },
    { data: evidence, error: evidenceError },
    { data: underlay, error: underlayError },
  ] = await Promise.all([
    supabaseService
      .from("pricing_preview_lines")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("pricing_run_id", run.id)
      .order("sort_order", { ascending: true }),
    supabaseService
      .from("pricing_interval_evidence")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("pricing_run_id", run.id)
      .order("metering_interval_start", { ascending: true }),
    supabaseService
      .from("billing_underlays")
      .select("energy_direction,settlement_type")
      .eq("company_id", input.companyId)
      .eq("id", input.billingUnderlayId)
      .single(),
  ]);
  if (lineError) throw lineError;
  if (evidenceError) throw evidenceError;
  if (underlayError) throw underlayError;

  const warnings = Array.isArray(run.warnings) ? run.warnings.map(String) : [];
  const errors = Array.isArray(run.errors) ? run.errors.map(String) : [];
  return {
    engine: "pricing_core_v1",
    status: "success",
    pricingRunId: String(run.id),
    underlayId: input.billingUnderlayId,
    subtotalSekExVat: numberValue(run.total_ex_vat) ?? 0,
    vatSek: numberValue(run.vat_amount) ?? 0,
    totalSekIncVat: numberValue(run.total_inc_vat) ?? 0,
    lines: ((lines ?? []) as Record<string, unknown>[]).map((line, index) => ({
      componentRuleId: `pricing_core:${input.billingUnderlayId}:${String(line.id ?? index)}`,
      componentCode: String(line.line_type ?? "unknown"),
      componentLabel: String(line.description ?? "Prisrad"),
      componentType: String(line.line_type ?? "unknown"),
      calculationUnit: String(line.unit ?? "st"),
      valueAmount: numberValue(line.unit_price_ex_vat),
      quantity: numberValue(line.quantity),
      amountSekExVat: numberValue(line.amount_ex_vat) ?? 0,
      currency: "SEK",
      appliesTo: "contract",
      vatRate: numberValue(line.vat_rate) ?? 0,
      vatAmount: numberValue(line.vat_amount) ?? 0,
      amountIncVat: numberValue(line.amount_inc_vat) ?? 0,
      sortOrder: numberValue(line.sort_order) ?? index * 10,
      metadata:
        line.metadata &&
        typeof line.metadata === "object" &&
        !Array.isArray(line.metadata)
          ? (line.metadata as Record<string, unknown>)
          : {},
    })),
    warnings,
    errors,
    locked: true,
    energyDirection:
      underlay.energy_direction === "production" ||
      underlay.energy_direction === "consumption_correction"
        ? underlay.energy_direction
        : "consumption",
    settlementType:
      underlay.settlement_type === "credit_invoice" ||
      underlay.settlement_type === "self_billing"
        ? underlay.settlement_type
        : "invoice",
    intervalEvidence: ((evidence ?? []) as Record<string, unknown>[]).map(
      (row) => ({
        id: String(row.id),
        billingUnderlayItemId: row.billing_underlay_item_id
          ? String(row.billing_underlay_item_id)
          : null,
        meteringIntervalStart: String(row.metering_interval_start),
        meteringIntervalEnd: String(row.metering_interval_end),
        resolution: String(row.resolution ?? "unknown"),
        consumptionKwh: numberValue(row.consumption_kwh) ?? 0,
        priceSekPerKwh: numberValue(row.price_sek_per_kwh) ?? 0,
        amountExVat: numberValue(row.amount_ex_vat) ?? 0,
        priceSourceId: row.price_source_id ? String(row.price_source_id) : null,
        priceArea: row.price_area ? String(row.price_area) : null,
        evidenceSha256: row.evidence_sha256
          ? String(row.evidence_sha256)
          : null,
      }),
    ),
  };
}
