"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { saveContractOffer } from "@/lib/customer-contracts/db";
import type {
  ContractType,
  GreenFeeMode,
} from "@/lib/customer-contracts/types";
import { supabaseService } from "@/lib/supabase/service";
import { requireOperationalCompanyId } from "@/lib/tenant/scope";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import { normalizeContractPricing } from "@/lib/pricing/contractPricingVersioning";

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function getNullableNumber(formData: FormData, key: string): number | null {
  const raw = getString(formData, key);
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function getNullableInt(formData: FormData, key: string): number | null {
  const raw = getString(formData, key);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseContractType(value: string): ContractType {
  switch (value) {
    case "fixed":
    case "variable_monthly":
    case "variable_hourly":
    case "portfolio":
    case "mixed":
      return value;
    default:
      return "variable_hourly";
  }
}

function parseGreenFeeMode(value: string): GreenFeeMode {
  switch (value) {
    case "sek_month":
    case "ore_per_kwh":
      return value;
    default:
      return "none";
  }
}

function parseOptionalFeeLines(value: string): Array<Record<string, unknown>> {
  const trimmed = value.trim();
  if (!trimmed) return [];

  return trimmed
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [label, amountRaw, unitRaw] = row
        .split("|")
        .map((part) => part.trim());
      const amount = amountRaw ? Number(amountRaw.replace(",", ".")) : null;

      return {
        label: label || "",
        amount: Number.isFinite(amount ?? NaN) ? amount : null,
        unit: unitRaw || "sek",
      };
    });
}

function redirectBack(params: { success?: string; error?: string }): never {
  const search = new URLSearchParams();
  if (params.success) search.set("success", params.success);
  if (params.error) search.set("error", params.error);
  redirect(`/admin/contracts?${search.toString()}`);
  throw new Error("Kunde inte navigera tillbaka efter åtgärden.");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === "object" &&
    error &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  )
    return (error as { message: string }).message;
  return "Avtalsmallen kunde inte sparas.";
}

function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return ["42P01", "42703", "PGRST200", "PGRST201", "PGRST204", "PGRST205"].includes(code) || /schema cache|does not exist|column .* does not exist|relationship/i.test(message);
}

async function countRows(table: string, filters: Record<string, string>): Promise<number> {
  let query = supabaseService.from(table).select("id", { count: "exact", head: true });
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  const { count, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) return 0;
    throw error;
  }
  return count ?? 0;
}

export async function saveContractOfferAction(formData: FormData) {
  let success: string;
  try {
    success = (await saveContractOfferActionImpl(formData)).success;
  } catch (error) {
    redirectBack({ error: errorMessage(error) });
  }
  redirectBack({ success });
}

async function saveContractOfferActionImpl(
  formData: FormData,
): Promise<{ success: string }> {
  await requirePlatformAdminActionAccess();

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  const companyId = await requireOperationalCompanyId(user.id);
  await requireCompanyOperationalForWrites(companyId);
  const id = getString(formData, "id") || undefined;
  const name = getString(formData, "name");

  let previous: Record<string, unknown> | null = null;
  if (id) {
    const { data: oldOffer, error: oldOfferError } = await supabaseService
      .from("contract_offers")
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (oldOfferError) throw oldOfferError;
    previous = (oldOffer as Record<string, unknown> | null) ?? null;
  }

  if (!name) {
    throw new Error("Avtalsnamn krävs");
  }

  const contractType = parseContractType(getString(formData, "contract_type"));
  const status = (getString(formData, "status") || "active") as "draft" | "active" | "inactive";
  const isActive = getString(formData, "is_active") === "on";
  const validFrom = getString(formData, "valid_from") || null;
  const validTo = getString(formData, "valid_to") || null;
  const normalizedPricing = normalizeContractPricing({
    name,
    contractType,
    customerType: "both",
    fixedPriceOrePerKwh: getString(formData, "fixed_price_ore_per_kwh"),
    spotMarkupOrePerKwh: getString(formData, "spot_markup_ore_per_kwh"),
    variableFeeOrePerKwh: getString(formData, "variable_fee_ore_per_kwh"),
    monthlyFeeSek: getString(formData, "monthly_fee_sek"),
    greenFeeMode: getString(formData, "green_fee_mode"),
    greenFeeValue: getString(formData, "green_fee_value"),
    startFeeSek: getString(formData, "start_fee_sek"),
    administrationFeeSek: getString(formData, "admin_fee_sek"),
    breakFeeSek: getString(formData, "break_fee_sek"),
    discountValue: getString(formData, "discount_value"),
    discountUnit: getString(formData, "discount_unit"),
    discountMonths: getString(formData, "discount_months"),
    vatRate: getString(formData, "vat_rate"),
    spotWeightPercent: getString(formData, "spot_weight_percent"),
    portfolioWeightPercent: getString(formData, "portfolio_weight_percent"),
    fixedWeightPercent: getString(formData, "fixed_weight_percent"),
    priceAreas: getString(formData, "price_areas") || getString(formData, "price_area"),
    validFrom,
    validTo,
    bindingMonths: getString(formData, "default_binding_months"),
    noticeMonths: getString(formData, "default_notice_months"),
    automaticRenewal: getString(formData, "automatic_renewal") === "on",
    powerOfAttorneyRequired: getString(formData, "power_of_attorney_required") !== "off",
    optionalFeeLines: getString(formData, "optional_fee_lines"),
  });

  const { data: pricingData, error: pricingError } = await supabaseService.rpc("gridex_create_or_version_contract_pricing", {
    p_company_id: companyId,
    p_plan_name: normalizedPricing.planName,
    p_contract_type: normalizedPricing.contractType,
    p_pricing_model: normalizedPricing.pricingModel,
    p_customer_type: normalizedPricing.customerType,
    p_snapshot: normalizedPricing.snapshot,
    p_valid_from: validFrom,
    p_valid_to: validTo,
    p_publish: status === "active" && isActive,
    p_actor_user_id: user.id,
  });
  if (pricingError) throw pricingError;
  const pricing = pricingData as unknown as {
    price_plan_id?: string;
    price_plan_version_id?: string;
    price_book_id?: string;
    version_label?: string;
    reused?: boolean;
  };
  if (!pricing?.price_plan_id || !pricing.price_plan_version_id || !pricing.price_book_id || !pricing.version_label) {
    throw new Error("Den automatiska prisversioneringen returnerade ofullständiga referenser.");
  }
  const priceVersion = pricing.version_label;

  const saved = await saveContractOffer({
    id,
    companyId,
    name,
    slug: getString(formData, "slug") || null,
    status,
    contractType,
    campaignName: getString(formData, "campaign_name") || null,
    campaignCode: getString(formData, "campaign_code") || null,
    campaignVersion: getString(formData, "campaign_version") || null,
    priceVersion,
    termsVersion: getString(formData, "terms_version") || null,
    maxCustomers: getNullableInt(formData, "max_customers"),
    discountValue: getNullableNumber(formData, "discount_value"),
    discountUnit: getString(formData, "discount_unit") || null,
    startFeeSek: getNullableNumber(formData, "start_fee_sek"),
    adminFeeSek: getNullableNumber(formData, "admin_fee_sek"),
    breakFeeSek: getNullableNumber(formData, "break_fee_sek"),
    vatRate: getNullableNumber(formData, "vat_rate"),
    description: getString(formData, "description") || null,
    fixedPriceOrePerKwh: getNullableNumber(formData, "fixed_price_ore_per_kwh"),
    spotMarkupOrePerKwh: getNullableNumber(formData, "spot_markup_ore_per_kwh"),
    variableFeeOrePerKwh: getNullableNumber(
      formData,
      "variable_fee_ore_per_kwh",
    ),
    monthlyFeeSek: getNullableNumber(formData, "monthly_fee_sek"),
    greenFeeMode: parseGreenFeeMode(getString(formData, "green_fee_mode")),
    greenFeeValue: getNullableNumber(formData, "green_fee_value"),
    defaultBindingMonths: getNullableInt(formData, "default_binding_months"),
    defaultNoticeMonths: getNullableInt(formData, "default_notice_months"),
    optionalFeeLines: parseOptionalFeeLines(
      getString(formData, "optional_fee_lines"),
    ),
    isActive,
    validFrom,
    validTo,
    actorUserId: user.id,
  });

  const { data: canonicalSaved, error: canonicalSaveError } = await supabaseService
    .from("contract_offers")
    .update({
      price_plan_id: pricing.price_plan_id,
      price_plan_version_id: pricing.price_plan_version_id,
      price_book_id: pricing.price_book_id,
      price_version: priceVersion,
      commercial_snapshot: normalizedPricing.snapshot,
      last_price_change_at: pricing.reused ? (previous?.last_price_change_at ?? new Date().toISOString()) : new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", saved.id)
    .eq("company_id", companyId)
    .select("*")
    .single();
  if (canonicalSaveError) throw canonicalSaveError;

  await supabaseService.from("audit_logs").insert({
    actor_user_id: user.id,
    entity_type: "contract_offer",
    entity_id: saved.id,
    company_id: companyId,
    action: id
      ? "contract_offer_updated_platform_admin_only"
      : "contract_offer_created_platform_admin_only",
    old_values: previous,
    new_values: canonicalSaved,
    metadata: {
      price_plan_id: pricing.price_plan_id,
      price_plan_version_id: pricing.price_plan_version_id,
      price_book_id: pricing.price_book_id,
      price_version_reused: pricing.reused === true,
      campaign_code: (canonicalSaved as Record<string, unknown>).campaign_code ?? null,
      campaign_version:
        (canonicalSaved as Record<string, unknown>).campaign_version ?? null,
      price_version:
        (canonicalSaved as Record<string, unknown>).price_version ?? priceVersion,
      terms_version: (canonicalSaved as Record<string, unknown>).terms_version ?? null,
    },
  });

  revalidatePath("/admin/contracts");
  revalidatePath("/admin/customers/intake");
  revalidatePath("/admin/customers");
  return {
    success: id
      ? "Avtalet uppdaterades och ny prisversion/snapshot sparades."
      : "Avtalet skapades med första prisversionen. Det kan användas internt utan hemsida/API när det är aktivt.",
  };
}


export async function archiveContractOfferAction(formData: FormData) {
  let success: string;
  try {
    success = (await archiveContractOfferActionImpl(formData)).success;
  } catch (error) {
    redirectBack({ error: errorMessage(error) });
  }
  redirectBack({ success });
}

async function archiveContractOfferActionImpl(formData: FormData): Promise<{ success: string }> {
  const actor = await requirePlatformAdminActionAccess();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const companyId = await requireOperationalCompanyId(user.id);
  const id = getString(formData, "id");
  if (!id) throw new Error("Avtal saknas.");

  const { data: previous, error } = await supabaseService
    .from("contract_offers")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!previous) throw new Error("Avtalet hittades inte för valt bolag.");

  const { data: archived, error: archiveError } = await supabaseService
    .from("contract_offers")
    .update({
      status: "inactive",
      is_active: false,
      archived_at: new Date().toISOString(),
      updated_by: actor.userId,
    })
    .eq("id", id)
    .eq("company_id", companyId)
    .select("*")
    .single();
  if (archiveError) throw archiveError;

  await supabaseService.from("audit_logs").insert({
    actor_user_id: actor.userId,
    entity_type: "contract_offer",
    entity_id: id,
    company_id: companyId,
    action: "contract_offer_archived_platform_admin_only",
    old_values: previous,
    new_values: archived,
    metadata: { source: "admin_contracts", history_preserved: true },
  });

  revalidatePath("/admin/contracts");
  revalidatePath("/admin/customers/intake");
  revalidatePath("/admin/customers");
  return { success: "Avtalet arkiverades och är dolt från kundintaget. Historiska kundavtal påverkas inte." };
}

export async function deleteContractOfferAction(formData: FormData) {
  let success: string;
  try {
    success = (await deleteContractOfferActionImpl(formData)).success;
  } catch (error) {
    redirectBack({ error: errorMessage(error) });
  }
  redirectBack({ success });
}

async function deleteContractOfferActionImpl(formData: FormData): Promise<{ success: string }> {
  const actor = await requirePlatformAdminActionAccess();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const companyId = await requireOperationalCompanyId(user.id);
  const id = getString(formData, "id");
  if (!id) throw new Error("Avtal saknas.");

  const { data: previous, error } = await supabaseService
    .from("contract_offers")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!previous) throw new Error("Avtalet hittades inte för valt bolag.");

  const customerContractCount = await countRows("customer_contracts", { company_id: companyId, contract_offer_id: id });
  if (customerContractCount > 0) {
    const { error: archiveError } = await supabaseService
      .from("contract_offers")
      .update({
        status: "inactive",
        is_active: false,
        archived_at: new Date().toISOString(),
        updated_by: actor.userId,
      })
      .eq("id", id)
      .eq("company_id", companyId);
    if (archiveError) throw archiveError;

    await supabaseService.from("audit_logs").insert({
      actor_user_id: actor.userId,
      entity_type: "contract_offer",
      entity_id: id,
      company_id: companyId,
      action: "contract_offer_archive_instead_of_delete_history_locked",
      old_values: previous,
      new_values: { ...(previous as Record<string, unknown>), status: "inactive", is_active: false },
      metadata: { source: "admin_contracts", customerContractCount },
    });

    revalidatePath("/admin/contracts");
    revalidatePath("/admin/customers/intake");
    revalidatePath("/admin/customers");
    return { success: "Avtalet används av kundhistorik och arkiverades därför istället för att raderas." };
  }

  const { error: deleteError } = await supabaseService
    .from("contract_offers")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId);
  if (deleteError) throw deleteError;

  await supabaseService.from("audit_logs").insert({
    actor_user_id: actor.userId,
    entity_type: "contract_offer",
    entity_id: id,
    company_id: companyId,
    action: "contract_offer_deleted_unused_platform_admin_only",
    old_values: previous,
    new_values: null,
    metadata: { source: "admin_contracts", customerContractCount },
  });

  revalidatePath("/admin/contracts");
  revalidatePath("/admin/customers/intake");
  revalidatePath("/admin/customers");
  return { success: "Oanvänt avtal raderades. Signerade kundavtal raderas aldrig automatiskt." };
}

export async function updateTenantContractChannelAction(formData: FormData) {
  const companyId = getString(formData, 'company_id')
  const assignmentId = getString(formData, 'assignment_id')
  const channel = getString(formData, 'channel') || 'website'
  const status = getString(formData, 'status') || 'paused'
  if (!companyId || !assignmentId) redirectBack({ error: 'Bolag eller avtalstilldelning saknas.' })

  try {
    const { requireCompanyScopedActionAccess } = await import('@/lib/admin/guards')
    const actor = await requireCompanyScopedActionAccess(companyId, { anyOf: ['contracts.write', 'contracts.manage'] })
    await requireCompanyOperationalForWrites(companyId)

    const { data: assignment, error: assignmentError } = await supabaseService
      .from('tenant_contract_assignments')
      .select('id,company_id,website_publication_allowed,internal_sales_allowed')
      .eq('id', assignmentId)
      .eq('company_id', companyId)
      .maybeSingle()
    if (assignmentError) throw assignmentError
    if (!assignment) throw new Error('Avtalstilldelningen hittades inte.')
    if (channel === 'website' && !assignment.website_publication_allowed) throw new Error('Superadmin har inte tillåtit hemsidepublicering för avtalet.')
    if (channel === 'internal' && !assignment.internal_sales_allowed) throw new Error('Superadmin har inte tillåtit intern försäljning för avtalet.')

    const validFrom = getString(formData, 'valid_from') || null
    const validTo = getString(formData, 'valid_to') || null
    const marketingText = getString(formData, 'marketing_text')
    const { error } = await supabaseService.from('tenant_contract_channels').upsert({
      assignment_id: assignmentId,
      channel,
      status,
      valid_from: validFrom,
      valid_to: validTo,
      marketing_content: marketingText ? { text: marketingText } : {},
      updated_by: actor.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'assignment_id,channel' })
    if (error) throw error
    revalidatePath('/admin/contracts')
    redirectBack({ success: status === 'active' ? 'Försäljningskanalen aktiverades.' : 'Försäljningskanalen pausades.' })
  } catch (error) {
    redirectBack({ error: errorMessage(error) })
  }
}

export async function saveTenantLegalProfileAction(formData: FormData) {
  const companyId = getString(formData, 'company_id')
  if (!companyId) redirectBack({ error: 'Bolag saknas.' })
  try {
    const { requireCompanyScopedActionAccess } = await import('@/lib/admin/guards')
    const actor = await requireCompanyScopedActionAccess(companyId, { anyOf: ['contracts.write', 'contracts.manage'] })
    const jsonObject = (key: string) => {
      const value = getString(formData, key)
      return value ? { text: value } : {}
    }
    const { error } = await supabaseService.from('tenant_legal_profiles').upsert({
      company_id: companyId,
      legal_name: getString(formData, 'legal_name') || null,
      organization_number: getString(formData, 'organization_number') || null,
      customer_service_email: getString(formData, 'customer_service_email') || null,
      phone: getString(formData, 'phone') || null,
      website: getString(formData, 'website') || null,
      postal_address: jsonObject('postal_address'),
      customer_service_address: jsonObject('customer_service_address'),
      complaints_contact: jsonObject('complaints_contact'),
      data_protection_contact: jsonObject('data_protection_contact'),
      billing_information: jsonObject('billing_information'),
      dispute_resolution_information: jsonObject('dispute_resolution_information'),
      verified_by: null,
      verified_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' })
    if (error) throw error
    await supabaseService.from('audit_logs').insert({
      actor_user_id: actor.userId, company_id: companyId, entity_type: 'tenant_legal_profile', entity_id: companyId,
      action: 'tenant_legal_profile_updated', new_values: { company_id: companyId }, metadata: {},
    })
    revalidatePath('/admin/contracts')
    redirectBack({ success: 'Juridikprofilen sparades. Publicering blockeras automatiskt tills alla obligatoriska uppgifter är kompletta.' })
  } catch (error) {
    redirectBack({ error: errorMessage(error) })
  }
}
