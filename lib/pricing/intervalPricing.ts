import { createHash } from "node:crypto";
import { supabaseService } from "@/lib/supabase/service";
import { loadMarketPriceSourcePolicies } from "@/lib/pricing/marketPriceSources";
import type { PriceArea } from "@/lib/pricing/types";

export type IntervalPriceEvidence = {
  billing_underlay_item_id: string;
  metering_interval_start: string;
  metering_interval_end: string;
  resolution: "hour" | "quarter";
  consumption_kwh: number;
  price_sek_per_kwh: number;
  amount_ex_vat: number;
  price_source_id: string;
  price_area: PriceArea;
  evidence_sha256: string;
};

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numeric(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.replace(",", "."))
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function quantityKwh(row: Row): number | null {
  const quantity = numeric(row.quantity_kwh) ?? numeric(row.quantity);
  if (quantity === null) return null;
  const unit = (text(row.unit) ?? "kWh").toLowerCase();
  if (unit === "kwh") return quantity;
  if (unit === "wh") return quantity / 1_000;
  if (unit === "mwh") return quantity * 1_000;
  return null;
}

function intervalResolution(milliseconds: number): "hour" | "quarter" | null {
  if (milliseconds === 60 * 60 * 1_000) return "hour";
  if (milliseconds === 15 * 60 * 1_000) return "quarter";
  return null;
}

export function spotPriceResolutionMatches(
  requiredResolution: "hourly" | "quarterly",
  sourceResolution: unknown,
): boolean {
  return requiredResolution === "quarterly"
    ? text(sourceResolution) === "quarter_hour"
    : text(sourceResolution) === "hourly";
}

export async function resolveIntervalSpotPricing(input: {
  companyId: string;
  billingUnderlayId: string;
  priceArea: PriceArea;
  periodStart: string;
  periodEnd: string;
  requiredResolution: "hourly" | "quarterly";
  spotWeightPercent: number;
}): Promise<{
  weightedAverageSekPerKwh: number | null;
  evidence: IntervalPriceEvidence[];
  errors: string[];
}> {
  const policies = await loadMarketPriceSourcePolicies(input.companyId);
  const requiredPolicyResolution = input.requiredResolution === 'quarterly' ? 'quarterly' : 'hourly';
  const eligiblePolicies = policies.filter((policy) =>
    policy.supportedResolutions.includes(requiredPolicyResolution),
  );
  if (eligiblePolicies.length === 0) {
    return {
      weightedAverageSekPerKwh: null,
      evidence: [],
      errors: [`Ingen aktiverad marknadsdatakälla stöder ${requiredPolicyResolution}.`],
    };
  }
  const sourcePriority = new Map(eligiblePolicies.map((policy) => [policy.sourceKey, policy.priority]));
  const [itemsResponse, pricesResponse] = await Promise.all([
    supabaseService
      .from("billing_underlay_items")
      .select("id,period_start,period_end,quantity_kwh,quantity,unit,status")
      .eq("company_id", input.companyId)
      .eq("billing_underlay_id", input.billingUnderlayId)
      .order("period_start", { ascending: true }),
    supabaseService
      .from("spot_price_intervals")
      .select("id,source,time_start,time_end,sek_per_kwh,resolution,updated_at")
      .in("source", eligiblePolicies.map((policy) => policy.sourceKey))
      .eq("price_area", input.priceArea)
      .lt("time_start", input.periodEnd)
      .gt("time_end", input.periodStart)
      .order("time_start", { ascending: true }),
  ]);

  if (itemsResponse.error) throw itemsResponse.error;
  if (pricesResponse.error) throw pricesResponse.error;

  const items = (itemsResponse.data ?? []) as Row[];
  const prices = (pricesResponse.data ?? []) as Row[];
  const errors: string[] = [];
  const evidence: IntervalPriceEvidence[] = [];
  let totalQuantity = 0;
  let totalRawSpotAmount = 0;

  if (items.length === 0) {
    return {
      weightedAverageSekPerKwh: null,
      evidence,
      errors: ["Intervallbaserat avtal saknar faktureringsbara mätintervall."],
    };
  }

  for (const item of items) {
    const itemId = text(item.id);
    const start = text(item.period_start);
    const end = text(item.period_end);
    const quantity = quantityKwh(item);
    const startMs = start ? Date.parse(start) : Number.NaN;
    const endMs = end ? Date.parse(end) : Number.NaN;
    const duration = endMs - startMs;
    const resolution = intervalResolution(duration);

    if (!itemId || !start || !end || quantity === null || quantity < 0) {
      errors.push("Ett mätintervall saknar giltigt ID, tid eller kWh.");
      continue;
    }
    if (!resolution) {
      errors.push(
        `Mätintervallet ${itemId} har en upplösning som inte är 15 eller 60 minuter.`,
      );
      continue;
    }
    if (input.requiredResolution === "quarterly" && resolution !== "quarter") {
      errors.push(
        `Kvartspris kräver kvartsmätning; intervallet ${itemId} är inte 15 minuter.`,
      );
      continue;
    }

    const candidates = prices.filter((price) => {
      const priceStart = Date.parse(String(price.time_start));
      const priceEnd = Date.parse(String(price.time_end));
      if (!spotPriceResolutionMatches(input.requiredResolution, price.resolution))
        return false;
      return priceStart <= startMs && priceEnd >= endMs;
    }).sort((a, b) =>
      (sourcePriority.get(String(a.source)) ?? Number.MAX_SAFE_INTEGER) -
      (sourcePriority.get(String(b.source)) ?? Number.MAX_SAFE_INTEGER)
    );
    if (candidates.length === 0) {
      errors.push(`Spotpris saknas för mätintervallet ${start}–${end}.`);
      continue;
    }

    const price = candidates[0];
    const priceValue = numeric(price.sek_per_kwh);
    const priceId = text(price.id);
    if (priceValue === null || !priceId) {
      errors.push(`Spotpriskällan är ogiltig för intervallet ${start}–${end}.`);
      continue;
    }

    const rawAmount = quantity * priceValue;
    const contractualAmount = rawAmount * (input.spotWeightPercent / 100);
    totalQuantity += quantity;
    totalRawSpotAmount += rawAmount;
    const evidenceCore = {
      billing_underlay_item_id: itemId,
      metering_interval_start: start,
      metering_interval_end: end,
      resolution,
      consumption_kwh: quantity,
      price_sek_per_kwh: priceValue,
      amount_ex_vat: Math.round(contractualAmount * 100) / 100,
      price_source_id: priceId,
      price_area: input.priceArea,
    };
    evidence.push({
      ...evidenceCore,
      evidence_sha256: createHash("sha256")
        .update(JSON.stringify(evidenceCore))
        .digest("hex"),
    });
  }

  if (
    errors.length > 0 ||
    evidence.length !== items.length ||
    totalQuantity <= 0
  ) {
    return { weightedAverageSekPerKwh: null, evidence, errors };
  }

  return {
    weightedAverageSekPerKwh: totalRawSpotAmount / totalQuantity,
    evidence,
    errors,
  };
}
