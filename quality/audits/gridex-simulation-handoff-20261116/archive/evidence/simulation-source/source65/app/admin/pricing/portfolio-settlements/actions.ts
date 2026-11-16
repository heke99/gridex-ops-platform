"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRICE_AREAS = ["SE1", "SE2", "SE3", "SE4"] as const;

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function uuid(formData: FormData, key: string): string {
  const result = value(formData, key);
  if (!UUID.test(result)) throw new Error(`${key} är ogiltigt.`);
  return result;
}

function optionalNumber(formData: FormData, key: string): number | null {
  const raw = value(formData, key).replace(",", ".");
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${key} måste vara ett tal.`);
  return parsed;
}

async function superadminActorId(): Promise<string> {
  const actor = await requirePlatformAdminActionAccess();
  const { data, error } = await supabaseService.rpc(
    "gridex_portfolio_actor_is_superadmin",
    { p_actor_user_id: actor.userId },
  );
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Endast superadmin kan hantera portföljer.");
  return actor.userId;
}

function monthValue(formData: FormData, key: string): string {
  const month = value(formData, key);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Månad måste vara YYYY-MM.");
  return `${month}-01`;
}

function refresh() {
  revalidatePath("/admin/pricing/portfolio-settlements");
  revalidatePath("/admin/pricing/portfolio-prices");
  revalidatePath("/admin/pricing");
  revalidatePath("/admin/contracts");
}

export async function createPortfolioAction(formData: FormData) {
  const actor = await superadminActorId();
  const code = value(formData, "code");
  const name = value(formData, "name");
  if (!code || !name) throw new Error("Portföljkod och namn krävs.");

  const { error } = await supabaseService.rpc("gridex_create_portfolio", {
    p_actor_user_id: actor,
    p_company_id: uuid(formData, "company_id"),
    p_code: code,
    p_name: name,
    p_description: value(formData, "description") || null,
  });
  if (error) throw new Error(error.message);
  refresh();
}

export async function saveSettlementAreaDraftsAction(formData: FormData) {
  const actor = await superadminActorId();
  const areaPrices: Record<string, number> = {};

  for (const area of PRICE_AREAS) {
    const price = optionalNumber(formData, `portfolio_price_${area.toLowerCase()}`);
    if (price === null) continue;
    if (price <= 0) throw new Error(`${area}-priset måste vara större än 0.`);
    areaPrices[area] = price;
  }
  if (Object.keys(areaPrices).length === 0) {
    throw new Error("Ange pris för minst ett elområde.");
  }

  const managementFee = optionalNumber(
    formData,
    "management_fee_ore_per_kwh",
  ) ?? 0;
  if (managementFee < 0) {
    throw new Error("Förvaltningsavgiften kan inte vara negativ.");
  }

  const { error } = await supabaseService.rpc(
    "gridex_save_portfolio_area_price_drafts",
    {
      p_actor_user_id: actor,
      p_company_id: uuid(formData, "company_id"),
      p_portfolio_id: uuid(formData, "portfolio_id"),
      p_delivery_month: monthValue(formData, "delivery_month"),
      p_price_plan_version_id: uuid(formData, "price_plan_version_id"),
      p_area_prices: areaPrices,
      p_management_fee_ore_per_kwh: managementFee,
      p_source: value(formData, "source") === "import" ? "import" : "manual",
      p_idempotency_key: value(formData, "idempotency_key") || randomUUID(),
    },
  );
  if (error) throw new Error(error.message);
  refresh();
}

export async function transitionSettlementAction(formData: FormData) {
  const actor = await superadminActorId();
  const transition = value(formData, "transition");
  if (!["calculate", "review", "approve", "lock"].includes(transition)) {
    throw new Error("Ogiltig statusövergång.");
  }
  const { error } = await supabaseService.rpc(
    "gridex_transition_portfolio_settlement",
    {
      p_actor_user_id: actor,
      p_settlement_id: uuid(formData, "settlement_id"),
      p_action: transition,
      p_reason: value(formData, "reason") || null,
    },
  );
  if (error) throw new Error(error.message);
  refresh();
}

export async function correctSettlementAction(formData: FormData) {
  const actor = await superadminActorId();
  const reason = value(formData, "reason");
  if (!reason) throw new Error("Korrigeringsorsak krävs.");
  const { error } = await supabaseService.rpc(
    "gridex_create_portfolio_settlement_correction",
    {
      p_actor_user_id: actor,
      p_settlement_id: uuid(formData, "settlement_id"),
      p_reason: reason,
      p_idempotency_key: value(formData, "idempotency_key") || randomUUID(),
    },
  );
  if (error) throw new Error(error.message);
  refresh();
}

export async function generatePortfolioEstimateAction(formData: FormData) {
  const actor = await superadminActorId();
  const source = value(formData, "estimate_source");
  if (!["latest_final", "rolling_3", "forecast", "manual"].includes(source)) {
    throw new Error("Ogiltig estimatkälla.");
  }
  const area = value(formData, "price_area_code").toUpperCase();
  if (!PRICE_AREAS.includes(area as (typeof PRICE_AREAS)[number])) {
    throw new Error("Ogiltigt elområde.");
  }

  const { error } = await supabaseService.rpc(
    "gridex_generate_portfolio_price_estimate",
    {
      p_actor_user_id: actor,
      p_company_id: uuid(formData, "company_id"),
      p_portfolio_id: uuid(formData, "portfolio_id"),
      p_price_plan_version_id: uuid(formData, "price_plan_version_id"),
      p_price_area_code: area,
      p_estimate_month: monthValue(formData, "estimate_month"),
      p_estimate_source: source,
      p_manual_or_forecast_price_ore_per_kwh: optionalNumber(
        formData,
        "manual_or_forecast_price_ore_per_kwh",
      ),
      p_confidence: value(formData, "confidence") || null,
      p_reason: value(formData, "reason"),
    },
  );
  if (error) throw new Error(error.message);
  refresh();
}
