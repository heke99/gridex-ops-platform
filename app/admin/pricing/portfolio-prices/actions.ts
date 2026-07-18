"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";
import {
  isPriceArea,
  type BasePriceComponent,
  type BillingUnderlayInput,
  type PriceComponent,
} from "@/lib/pricing/types";
import { buildCanonicalContractSnapshot } from "@/lib/pricing/contractSnapshot";
import { calculateBasePrice } from "@/lib/pricing/basePriceCalculator";
import { calculatePriceComponents } from "@/lib/pricing/priceComponentCalculator";
import { finalizePricingPreview } from "@/lib/pricing/pricePreviewBuilder";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function uuid(value: string, label: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`${label} är ogiltigt.`);
  }
  return value;
}

function month(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value))
    throw new Error("Månad måste anges som YYYY-MM.");
  const monthNumber = Number(value.slice(5, 7));
  if (monthNumber < 1 || monthNumber > 12) throw new Error("Ogiltig månad.");
  return value;
}

function priceOre(value: string): number {
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < -100000 || parsed > 100000) {
    throw new Error(
      "Portföljpriset måste vara ett giltigt tal i öre/kWh exklusive moms.",
    );
  }
  return parsed;
}

async function assertCompany(companyId: string) {
  const { data, error } = await supabaseService
    .from("companies")
    .select("id,name")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Tenantbolaget hittades inte.");
  return data;
}

async function assertPortfolioPricePlanVersion(
  companyId: string,
  pricePlanVersionId: string,
) {
  const { data: version, error } = await supabaseService
    .from("price_plan_versions")
    .select("id,company_id,price_plan_id,version_label,status,locked_at")
    .eq("id", pricePlanVersionId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!version)
    throw new Error("Prisplansversionen hittades inte för valt tenantbolag.");
  const { data: plan, error: planError } = await supabaseService
    .from("price_plans")
    .select("id,pricing_model,name")
    .eq("id", version.price_plan_id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan || !["portfolio", "mixed"].includes(String(plan.pricing_model))) {
    throw new Error(
      "Månadspriser kan bara kopplas till portfölj- eller mixprisplaner.",
    );
  }
  return { version, plan };
}

async function audit(input: {
  companyId: string;
  actorUserId: string;
  entityId: string;
  action: string;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabaseService.from("audit_logs").insert({
    company_id: input.companyId,
    actor_user_id: input.actorUserId,
    entity_type: "portfolio_monthly_price",
    entity_id: input.entityId,
    action: input.action,
    old_values: input.oldValues ?? null,
    new_values: input.newValues ?? null,
    metadata: input.metadata ?? {},
  });
  if (
    error &&
    !["42P01", "42703", "PGRST205"].includes(
      String((error as { code?: string }).code ?? ""),
    )
  )
    throw error;
}

function revalidate() {
  revalidatePath("/admin/pricing");
  revalidatePath("/admin/pricing/portfolio-prices");
}

export async function savePortfolioPriceAction(formData: FormData) {
  const actor = await requirePlatformAdminActionAccess();
  const companyId = uuid(text(formData, "company_id"), "Tenant");
  const pricePlanVersionId = uuid(
    text(formData, "price_plan_version_id"),
    "Prisplansversion",
  );
  const priceArea = text(formData, "price_area").toUpperCase();
  if (!isPriceArea(priceArea)) throw new Error("Elområde måste vara SE1–SE4.");
  const billingMonth = month(text(formData, "billing_month"));
  const priceOreValue = priceOre(text(formData, "price_ore_per_kwh"));
  const priceExVat = priceOreValue / 100;
  const notes = text(formData, "notes") || null;
  const requestedStatus =
    text(formData, "status") === "confirmed" ? "confirmed" : "draft";
  await assertCompany(companyId);
  const { version } = await assertPortfolioPricePlanVersion(
    companyId,
    pricePlanVersionId,
  );

  const { data: existing, error: existingError } = await supabaseService
    .from("portfolio_monthly_prices")
    .select("*")
    .eq("company_id", companyId)
    .eq("price_area", priceArea)
    .eq("billing_month", billingMonth)
    .eq("price_plan_version_id", pricePlanVersionId)
    .is("superseded_at", null)
    .neq("status", "superseded")
    .maybeSingle();
  if (
    existingError &&
    !["42703", "PGRST204"].includes(
      String((existingError as { code?: string }).code ?? ""),
    )
  )
    throw existingError;

  const now = new Date().toISOString();
  if (existing) {
    if (["locked", "published"].includes(String(existing.status)))
      throw new Error(
        "Priset är låst. Skapa en ny prisplansversion för att korrigera ett publicerat månadspris.",
      );
    const payload = {
      price_ex_vat_sek_per_kwh: priceExVat,
      notes,
      status: requestedStatus,
      approved_by: requestedStatus === "confirmed" ? actor.userId : null,
      approved_at: requestedStatus === "confirmed" ? now : null,
      confirmed_at: requestedStatus === "confirmed" ? now : null,
      updated_by: actor.userId,
      updated_at: now,
    };
    const { data, error } = await supabaseService
      .from("portfolio_monthly_prices")
      .update(payload)
      .eq("id", existing.id)
      .eq("company_id", companyId)
      .select("*")
      .single();
    if (error) throw error;
    await audit({
      companyId,
      actorUserId: actor.userId,
      entityId: String(existing.id),
      action: "portfolio_price_updated",
      oldValues: existing,
      newValues: data,
    });
  } else {
    const payload = {
      company_id: companyId,
      price_plan_id: version.price_plan_id,
      price_plan_version_id: pricePlanVersionId,
      price_area: priceArea,
      billing_month: billingMonth,
      price_ex_vat_sek_per_kwh: priceExVat,
      currency: "SEK",
      status: requestedStatus,
      source: "contract_price_version",
      notes,
      version_number: 1,
      created_by: actor.userId,
      updated_by: actor.userId,
      approved_by: requestedStatus === "confirmed" ? actor.userId : null,
      approved_at: requestedStatus === "confirmed" ? now : null,
      confirmed_at: requestedStatus === "confirmed" ? now : null,
    };
    const { data, error } = await supabaseService
      .from("portfolio_monthly_prices")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    await audit({
      companyId,
      actorUserId: actor.userId,
      entityId: String(data.id),
      action: "portfolio_price_created",
      newValues: data,
    });
  }
  revalidate();
}

export async function transitionPortfolioPriceAction(formData: FormData) {
  const actor = await requirePlatformAdminActionAccess();
  const id = uuid(text(formData, "id"), "Prisrad");
  const companyId = uuid(text(formData, "company_id"), "Tenant");
  const transition = text(formData, "transition");
  if (!["confirm", "lock"].includes(transition))
    throw new Error("Ogiltig prisövergång.");

  const { data: current, error: readError } = await supabaseService
    .from("portfolio_monthly_prices")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .is("superseded_at", null)
    .single();
  if (readError) throw readError;
  if (current.status === "locked") throw new Error("Priset är redan låst.");
  if (transition === "lock" && current.status !== "confirmed")
    throw new Error("Priset måste bekräftas innan det kan låsas.");

  const now = new Date().toISOString();
  const payload =
    transition === "confirm"
      ? {
          status: "confirmed",
          confirmed_at: now,
          approved_at: now,
          approved_by: actor.userId,
          updated_by: actor.userId,
          updated_at: now,
        }
      : {
          status: "locked",
          locked_at: now,
          updated_by: actor.userId,
          updated_at: now,
        };
  const { data, error } = await supabaseService
    .from("portfolio_monthly_prices")
    .update(payload)
    .eq("id", id)
    .eq("company_id", companyId)
    .select("*")
    .single();
  if (error) throw error;
  await audit({
    companyId,
    actorUserId: actor.userId,
    entityId: id,
    action:
      transition === "confirm"
        ? "portfolio_price_confirmed"
        : "portfolio_price_locked",
    oldValues: current,
    newValues: data,
  });
  revalidate();
}

export async function createPortfolioPriceRevisionAction(formData: FormData) {
  const actor = await requirePlatformAdminActionAccess();
  const id = uuid(text(formData, "id"), "Prisrad");
  const companyId = uuid(text(formData, "company_id"), "Tenant");
  const { data: current, error: readError } = await supabaseService
    .from("portfolio_monthly_prices")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .is("superseded_at", null)
    .single();
  if (readError) throw readError;
  if (!["confirmed", "locked"].includes(String(current.status)))
    throw new Error(
      "Endast bekräftade eller låsta priser behöver en ny korrigeringsversion.",
    );
  if (current.price_plan_version_id)
    throw new Error(
      "Versionskopplade månadspriser korrigeras genom att skapa och publicera en ny prisplansversion.",
    );

  const now = new Date().toISOString();
  const { error: supersedeError } = await supabaseService
    .from("portfolio_monthly_prices")
    .update({
      status: "superseded",
      superseded_at: now,
      updated_by: actor.userId,
      updated_at: now,
    })
    .eq("id", id)
    .eq("company_id", companyId);
  if (supersedeError) throw supersedeError;

  const { data: revision, error: insertError } = await supabaseService
    .from("portfolio_monthly_prices")
    .insert({
      company_id: companyId,
      price_area: current.price_area,
      billing_month: current.billing_month,
      price_ex_vat_sek_per_kwh: current.price_ex_vat_sek_per_kwh,
      currency: current.currency ?? "SEK",
      status: "draft",
      source: "manual",
      notes:
        `Korrigering av version ${current.version_number ?? 1}. ${current.notes ?? ""}`.trim(),
      version_number: Number(current.version_number ?? 1) + 1,
      supersedes_id: current.id,
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .select("*")
    .single();
  if (insertError) {
    await supabaseService
      .from("portfolio_monthly_prices")
      .update({
        status: current.status,
        superseded_at: null,
        updated_by: actor.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", companyId);
    throw insertError;
  }
  await audit({
    companyId,
    actorUserId: actor.userId,
    entityId: String(revision.id),
    action: "portfolio_price_revision_created",
    oldValues: current,
    newValues: revision,
    metadata: { supersedes_id: current.id },
  });
  revalidate();
}

export async function importPortfolioPricesAction(formData: FormData) {
  const actor = await requirePlatformAdminActionAccess();
  const companyId = uuid(text(formData, "company_id"), "Tenant");
  const pricePlanVersionId = uuid(
    text(formData, "price_plan_version_id"),
    "Prisplansversion",
  );
  await assertCompany(companyId);
  await assertPortfolioPricePlanVersion(companyId, pricePlanVersionId);
  const raw = text(formData, "rows");
  if (!raw) throw new Error("Klistra in minst en prisrad.");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 100)
    throw new Error("Max 100 rader kan importeras åt gången.");

  for (const [index, line] of lines.entries()) {
    const parts = line.split(/[;\t]/).map((part) => part.trim());
    const [billingMonthRaw, priceAreaRaw, priceRaw, notesRaw] = parts;
    const data = new FormData();
    data.set("company_id", companyId);
    data.set("price_plan_version_id", pricePlanVersionId);
    data.set("billing_month", billingMonthRaw ?? "");
    data.set("price_area", priceAreaRaw ?? "");
    data.set("price_ore_per_kwh", priceRaw ?? "");
    data.set("notes", notesRaw ?? `Importerad rad ${index + 1}`);
    data.set("status", "draft");
    await savePortfolioPriceAction(data);
  }
  await audit({
    companyId,
    actorUserId: actor.userId,
    entityId: companyId,
    action: "portfolio_prices_imported",
    metadata: { row_count: lines.length },
  });
  revalidate();
}

export type PortfolioPricePreviewState = {
  status: "idle" | "success" | "error";
  message?: string;
  monthlyKwh?: number;
  monthlyExVat?: number;
  monthlyVat?: number;
  monthlyIncVat?: number;
  annualIncVat?: number;
  lines?: Array<{
    description: string;
    amountExVat: number;
    amountIncVat: number;
  }>;
};

export async function previewPortfolioPriceAction(
  _previousState: PortfolioPricePreviewState,
  formData: FormData,
): Promise<PortfolioPricePreviewState> {
  await requirePlatformAdminActionAccess();
  try {
    const annualKwh = Number(text(formData, "annual_kwh").replace(",", "."));
    const portfolioPrice = Number(
      text(formData, "portfolio_price").replace(",", "."),
    );
    if (
      !Number.isFinite(portfolioPrice) ||
      portfolioPrice <= 0 ||
      portfolioPrice > 1000
    )
      throw new Error("Portföljpriset i förhandskalkylen är ogiltigt.");
    const markupOre = Number(
      text(formData, "markup_ore").replace(",", ".") || "0",
    );
    const monthlyFee = Number(
      text(formData, "monthly_fee").replace(",", ".") || "0",
    );
    if (
      !Number.isFinite(annualKwh) ||
      annualKwh <= 0 ||
      annualKwh > 10_000_000
    ) {
      throw new Error(
        "Årsförbrukningen måste vara större än 0 och högst 10 000 000 kWh.",
      );
    }
    if (!Number.isFinite(markupOre) || markupOre < 0 || markupOre > 10_000)
      throw new Error("Påslaget är ogiltigt.");
    if (
      !Number.isFinite(monthlyFee) ||
      monthlyFee < 0 ||
      monthlyFee > 1_000_000
    )
      throw new Error("Månadsavgiften är ogiltig.");

    const snapshot = buildCanonicalContractSnapshot({
      contractType: "portfolio",
      monthlyFeeSek: monthlyFee,
      spotMarkupOrePerKwh: markupOre,
    });
    const underlay: BillingUnderlayInput = {
      companyId: "preview",
      customerId: null,
      meteringPointId: null,
      priceArea: "SE4",
      quantityKwh: annualKwh / 12,
      periodStart: "2026-01-01",
      periodEnd: "2026-02-01",
    };
    const baseComponents = snapshot.basePriceComponents.map((row) => ({
      sourceType: String(row.source_type) as BasePriceComponent["sourceType"],
      weightPercent: Number(row.weight_percent),
      fixedPriceSekPerKwh:
        typeof row.fixed_price_sek_per_kwh === "number"
          ? row.fixed_price_sek_per_kwh
          : null,
      label: typeof row.label === "string" ? row.label : null,
    }));
    const priceComponents = snapshot.priceComponents.map(
      (row) =>
        ({
          componentType: String(row.component_type),
          name: String(row.name),
          calculationType: String(row.calculation_type),
          amount: Number(row.amount),
          unit: typeof row.unit === "string" ? row.unit : null,
          vatApplicable: row.vat_applicable !== false,
          invoiceLineVisible: row.invoice_line_visible !== false,
          periodizationMode:
            typeof row.periodization_mode === "string"
              ? row.periodization_mode
              : "none",
        }) satisfies PriceComponent,
    );
    const base = calculateBasePrice({
      underlay,
      components: baseComponents,
      sourceValues: { portfolioSekPerKwh: portfolioPrice },
    });
    const components = calculatePriceComponents({
      underlay,
      components: priceComponents,
      baseAmountExVat: base.lines.reduce(
        (sum, line) => sum + line.amountExVat,
        0,
      ),
      spotAmountExVat: null,
      vatRate: snapshot.vatRate,
    });
    const preview = finalizePricingPreview({
      lines: [...base.lines, ...components.lines],
      warnings: [...base.warnings, ...components.warnings],
      errors: [...base.errors, ...components.errors],
      vatRate: snapshot.vatRate,
    });
    if (preview.status === "failed")
      throw new Error(
        preview.errors.join(" ") || "Prisberäkningen misslyckades.",
      );
    return {
      status: "success",
      monthlyKwh: annualKwh / 12,
      monthlyExVat: preview.totalExVat,
      monthlyVat: preview.vatAmount,
      monthlyIncVat: preview.totalIncVat,
      annualIncVat: Math.round(preview.totalIncVat * 12 * 100) / 100,
      lines: preview.lines.map((line) => ({
        description: line.description,
        amountExVat: line.amountExVat,
        amountIncVat: line.amountIncVat,
      })),
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Prisberäkningen misslyckades.",
    };
  }
}
