"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdminAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function actorId() {
  return (await requireAdminAccess()).userId;
}

function refresh() {
  revalidatePath("/admin/pricing/portfolio-settlements");
  revalidatePath("/admin/pricing");
}

export async function createPortfolioAction(formData: FormData) {
  const actor = await actorId();
  const { error } = await supabaseService.rpc("gridex_create_portfolio", {
    p_actor_user_id: actor,
    p_company_id: uuid(formData, "company_id"),
    p_code: value(formData, "code"),
    p_name: value(formData, "name"),
    p_description: value(formData, "description") || null,
  });
  if (error) throw new Error(error.message);
  refresh();
}

export async function saveSettlementDraftAction(formData: FormData) {
  const actor = await actorId();
  const month = value(formData, "delivery_month");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Månad måste vara YYYY-MM.");
  const { error } = await supabaseService.rpc(
    "gridex_save_portfolio_settlement_draft",
    {
      p_actor_user_id: actor,
      p_company_id: uuid(formData, "company_id"),
      p_portfolio_id: uuid(formData, "portfolio_id"),
      p_price_area_code: value(formData, "price_area_code").toUpperCase(),
      p_delivery_month: `${month}-01`,
      p_price_plan_version_id: uuid(formData, "price_plan_version_id"),
      p_gross_energy_cost_sek: optionalNumber(
        formData,
        "gross_energy_cost_sek",
      ),
      p_hedging_result_sek:
        optionalNumber(formData, "hedging_result_sek") ?? 0,
      p_balancing_cost_sek:
        optionalNumber(formData, "balancing_cost_sek") ?? 0,
      p_other_allowed_cost_sek:
        optionalNumber(formData, "other_allowed_cost_sek") ?? 0,
      p_energy_volume_kwh: optionalNumber(
        formData,
        "energy_volume_kwh",
      ),
      p_portfolio_price_ore_per_kwh: optionalNumber(
        formData,
        "portfolio_price_ore_per_kwh",
      ),
      p_management_fee_ore_per_kwh:
        optionalNumber(formData, "management_fee_ore_per_kwh") ?? 0,
      p_source: value(formData, "source") === "import" ? "import" : "manual",
      p_idempotency_key:
        value(formData, "idempotency_key") || randomUUID(),
    },
  );
  if (error) throw new Error(error.message);
  refresh();
}

export async function transitionSettlementAction(formData: FormData) {
  const actor = await actorId();
  const { error } = await supabaseService.rpc(
    "gridex_transition_portfolio_settlement",
    {
      p_actor_user_id: actor,
      p_settlement_id: uuid(formData, "settlement_id"),
      p_action: value(formData, "transition"),
      p_reason: value(formData, "reason") || null,
    },
  );
  if (error) throw new Error(error.message);
  refresh();
}

export async function correctSettlementAction(formData: FormData) {
  const actor = await actorId();
  const { error } = await supabaseService.rpc(
    "gridex_create_portfolio_settlement_correction",
    {
      p_actor_user_id: actor,
      p_settlement_id: uuid(formData, "settlement_id"),
      p_reason: value(formData, "reason"),
      p_idempotency_key:
        value(formData, "idempotency_key") || randomUUID(),
    },
  );
  if (error) throw new Error(error.message);
  refresh();
}

export async function generatePortfolioEstimateAction(formData: FormData) {
  const actor = await actorId();
  const month = value(formData, "estimate_month");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Månad måste vara YYYY-MM.");
  const source = value(formData, "estimate_source");
  if (!["latest_final", "rolling_3", "forecast", "manual"].includes(source)) {
    throw new Error("Ogiltig estimatkälla.");
  }
  const { error } = await supabaseService.rpc(
    "gridex_generate_portfolio_price_estimate",
    {
      p_actor_user_id: actor,
      p_company_id: uuid(formData, "company_id"),
      p_portfolio_id: uuid(formData, "portfolio_id"),
      p_price_plan_version_id: uuid(formData, "price_plan_version_id"),
      p_price_area_code: value(formData, "price_area_code").toUpperCase(),
      p_estimate_month: `${month}-01`,
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

export async function grantSettlementPermissionAction(formData: FormData) {
  const actor = await actorId();
  const { error } = await supabaseService.rpc(
    "gridex_grant_portfolio_settlement_permission",
    {
      p_actor_user_id: actor,
      p_user_id: uuid(formData, "user_id"),
      p_permission: value(formData, "permission"),
      p_company_id: uuid(formData, "company_id"),
      p_portfolio_id: value(formData, "portfolio_id")
        ? uuid(formData, "portfolio_id")
        : null,
      p_expires_at: value(formData, "expires_at") || null,
      p_reason: value(formData, "reason"),
    },
  );
  if (error) throw new Error(error.message);
  refresh();
}

export async function grantSettlementRoleAction(formData: FormData) {
  const actor = await actorId();
  const { error } = await supabaseService.rpc(
    "gridex_grant_portfolio_settlement_role",
    {
      p_actor_user_id: actor,
      p_user_id: uuid(formData, "user_id"),
      p_role_key: value(formData, "role_key"),
      p_company_id: uuid(formData, "company_id"),
      p_portfolio_id: value(formData, "portfolio_id")
        ? uuid(formData, "portfolio_id")
        : null,
      p_expires_at: value(formData, "expires_at") || null,
      p_reason: value(formData, "reason"),
    },
  );
  if (error) throw new Error(error.message);
  refresh();
}

export async function revokeSettlementPermissionAction(formData: FormData) {
  const actor = await actorId();
  const { error } = await supabaseService.rpc(
    "gridex_revoke_portfolio_settlement_permission",
    {
      p_actor_user_id: actor,
      p_grant_id: uuid(formData, "grant_id"),
      p_reason: value(formData, "reason"),
    },
  );
  if (error) throw new Error(error.message);
  refresh();
}
