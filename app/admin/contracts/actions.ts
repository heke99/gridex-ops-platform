"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import type {
  ContractType,
  GreenFeeMode,
} from "@/lib/customer-contracts/types";
import { supabaseService } from "@/lib/supabase/service";
import { requireOperationalCompanyId } from "@/lib/tenant/scope";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import { normalizeContractPricing } from "@/lib/pricing/contractPricingVersioning";
import {
  buildBillingInformation,
  buildDisputeResolutionInformation,
  buildStructuredAddress,
  buildStructuredContact,
  formText,
  normalizeEmail,
  normalizeUrl,
} from "@/lib/legal/tenantLegalProfile";

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function getNullableNumber(formData: FormData, key: string): number | null {
  const raw = getString(formData, key);
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed))
    throw new Error(`${key} måste vara ett giltigt tal.`);
  return parsed;
}

function getNullableInt(formData: FormData, key: string): number | null {
  const raw = getString(formData, key);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed))
    throw new Error(`${key} måste vara ett giltigt heltal.`);
  return parsed;
}

function parseContractType(value: string): ContractType {
  switch (value) {
    case "fixed":
    case "variable_monthly":
    case "variable_hourly":
    case "variable_quarterly":
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
      if (!label) throw new Error("Övrig avgift saknar namn.");
      const amount = amountRaw ? Number(amountRaw.replace(",", ".")) : NaN;
      if (!Number.isFinite(amount) || amount < 0)
        throw new Error(`Övrig avgift ${label} har ogiltigt belopp.`);
      const unit = unitRaw || "sek_contract";
      if (
        ![
          "sek_once",
          "sek_contract",
          "sek_invoice",
          "sek_month",
          "ore_per_kwh",
        ].includes(unit)
      ) {
        throw new Error(`Övrig avgift ${label} har ogiltig enhet.`);
      }
      return { label, amount, unit };
    });
}

function redirectBack(params: { success?: string; error?: string }): never {
  const search = new URLSearchParams();
  if (params.success) search.set("success", params.success);
  if (params.error) search.set("error", params.error);
  redirect(`/admin/contracts?${search.toString()}`);
  throw new Error("Kunde inte navigera tillbaka efter åtgärden.");
}

function redirectLegalProfileBack(
  companyId: string,
  formData: FormData,
  params: { success?: string; error?: string },
): never {
  const requested = getString(formData, "return_to");
  const companyPage = `/admin/companies/${companyId}`;
  const contractPage = `/admin/contracts?company_id=${companyId}`;
  const base = requested === companyPage || requested === contractPage
    ? requested
    : contractPage;
  const search = new URLSearchParams();
  if (params.success) search.set("success", params.success);
  if (params.error) search.set("error", params.error);
  const separator = base.includes("?") ? "&" : "?";
  redirect(`${base}${separator}${search.toString()}#tenant-legal-profile`);
  throw new Error("Kunde inte navigera tillbaka till juridikprofilen.");
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
  const customerType = (
    ["private", "business", "both"].includes(
      getString(formData, "customer_type"),
    )
      ? getString(formData, "customer_type")
      : "both"
  ) as "private" | "business" | "both";
  const status = (getString(formData, "status") || "active") as
    "draft" | "active" | "inactive";
  const isActive = getString(formData, "is_active") === "on";
  const validFrom = getString(formData, "valid_from") || null;
  const validTo = getString(formData, "valid_to") || null;
  const normalizedPricing = normalizeContractPricing({
    name,
    contractType,
    customerType,
    fixedPriceOrePerKwh: getString(formData, "fixed_price_ore_per_kwh"),
    fixedPricesByArea: getString(formData, "fixed_prices_by_area"),
    spotMarkupOrePerKwh: getString(formData, "spot_markup_ore_per_kwh"),
    variableFeeOrePerKwh: getString(formData, "variable_fee_ore_per_kwh"),
    monthlyFeeSek: getString(formData, "monthly_fee_sek"),
    invoiceFeeSek: getString(formData, "invoice_fee_sek"),
    electricityCertificateOrePerKwh: getString(
      formData,
      "electricity_certificate_ore_per_kwh",
    ),
    portfolioManagementFeeOrePerKwh: getString(
      formData,
      "portfolio_management_fee_ore_per_kwh",
    ),
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
    spotIntervalResolution: getString(formData, "spot_interval_resolution"),
    priceAreas:
      getString(formData, "price_areas") || getString(formData, "price_area"),
    validFrom,
    validTo,
    bindingMonths: getString(formData, "default_binding_months"),
    noticeMonths: getString(formData, "default_notice_months"),
    automaticRenewal: getString(formData, "automatic_renewal") === "on",
    powerOfAttorneyRequired:
      getString(formData, "power_of_attorney_required") !== "off",
    optionalFeeLines: getString(formData, "optional_fee_lines"),
    productionEnabled: getString(formData, "production_enabled") === "on",
    productionCompensationOrePerKwh: getString(
      formData,
      "production_compensation_ore_per_kwh",
    ),
    productionVatRate: getString(formData, "production_vat_rate"),
    productionSettlementMode: getString(formData, "production_settlement_mode"),
  });

  const payload = {
    name,
    slug: getString(formData, "slug") || null,
    status,
    contract_type: contractType,
    customer_type: customerType,
    pricing_model: normalizedPricing.pricingModel,
    campaign_name: getString(formData, "campaign_name") || null,
    campaign_code: getString(formData, "campaign_code") || null,
    campaign_version: getString(formData, "campaign_version") || null,
    terms_version: getString(formData, "terms_version") || null,
    legal_bundle_id: getString(formData, "legal_bundle_id") || null,
    max_customers: getNullableInt(formData, "max_customers"),
    discount_value: getNullableNumber(formData, "discount_value"),
    discount_unit: getString(formData, "discount_unit") || null,
    start_fee_sek: getNullableNumber(formData, "start_fee_sek"),
    admin_fee_sek: getNullableNumber(formData, "admin_fee_sek"),
    break_fee_sek: getNullableNumber(formData, "break_fee_sek"),
    vat_rate: getNullableNumber(formData, "vat_rate") ?? 25,
    description: getString(formData, "description") || null,
    fixed_price_ore_per_kwh: getNullableNumber(
      formData,
      "fixed_price_ore_per_kwh",
    ),
    spot_markup_ore_per_kwh: getNullableNumber(
      formData,
      "spot_markup_ore_per_kwh",
    ),
    variable_fee_ore_per_kwh: getNullableNumber(
      formData,
      "variable_fee_ore_per_kwh",
    ),
    monthly_fee_sek: getNullableNumber(formData, "monthly_fee_sek"),
    green_fee_mode: parseGreenFeeMode(getString(formData, "green_fee_mode")),
    green_fee_value: getNullableNumber(formData, "green_fee_value"),
    default_binding_months: getNullableInt(formData, "default_binding_months"),
    default_notice_months: getNullableInt(formData, "default_notice_months"),
    optional_fee_lines: parseOptionalFeeLines(
      getString(formData, "optional_fee_lines"),
    ),
    automatic_renewal: getString(formData, "automatic_renewal") === "on",
    power_of_attorney_required:
      getString(formData, "power_of_attorney_required") !== "off",
    is_active: isActive,
    valid_from: validFrom,
    valid_to: validTo,
  };
  const pricingSnapshot = {
    ...normalizedPricing.snapshot,
    pricing_model: normalizedPricing.pricingModel,
  };
  const { data: commandData, error: commandError } = await supabaseService.rpc(
    "gridex_upsert_internal_contract_offer",
    {
      p_company_id: companyId,
      p_offer_id: id ?? null,
      p_payload: payload,
      p_pricing_snapshot: pricingSnapshot,
      p_actor_user_id: user.id,
    },
  );
  if (commandError) throw commandError;
  if (!commandData || typeof commandData !== "object")
    throw new Error("Avtalskommandot returnerade inget resultat.");
  const command = commandData as unknown as {
    offer?: Record<string, unknown>;
    pricing?: {
      price_plan_id?: string;
      price_plan_version_id?: string;
      price_book_id?: string;
      version_label?: string;
      reused?: boolean;
    };
    created_new_version?: boolean;
  };
  if (
    !command.offer?.id ||
    !command.pricing?.price_plan_id ||
    !command.pricing.price_plan_version_id ||
    !command.pricing.price_book_id ||
    !command.pricing.version_label
  ) {
    throw new Error(
      "Avtalskommandot returnerade ofullständiga versionsreferenser.",
    );
  }
  const saved = command.offer;
  const canonicalSaved = command.offer;
  const pricing = command.pricing;
  const priceVersion = command.pricing.version_label;

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
      campaign_code:
        (canonicalSaved as Record<string, unknown>).campaign_code ?? null,
      campaign_version:
        (canonicalSaved as Record<string, unknown>).campaign_version ?? null,
      price_version:
        (canonicalSaved as Record<string, unknown>).price_version ??
        priceVersion,
      terms_version:
        (canonicalSaved as Record<string, unknown>).terms_version ?? null,
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

async function archiveContractOfferActionImpl(
  formData: FormData,
): Promise<{ success: string }> {
  const actor = await requirePlatformAdminActionAccess();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const companyId = await requireOperationalCompanyId(user.id);
  const id = getString(formData, "id");
  if (!id) throw new Error("Avtal saknas.");

  const { data, error } = await supabaseService.rpc(
    "gridex_remove_internal_contract_offer",
    {
      p_company_id: companyId,
      p_offer_id: id,
      p_mode: "archive",
      p_actor_user_id: actor.userId,
    },
  );
  if (error) throw error;
  const result = data as {
    ok?: boolean;
    mode?: string;
    customer_contract_count?: number;
  } | null;
  if (!result?.ok || result.mode !== "archived") {
    throw new Error("Avtalet kunde inte arkiveras säkert.");
  }

  revalidatePath("/admin/contracts");
  revalidatePath("/admin/customers/intake");
  revalidatePath("/admin/customers");
  return {
    success:
      "Avtalet arkiverades och är dolt från kundintaget. Historiska kundavtal påverkas inte.",
  };
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

async function deleteContractOfferActionImpl(
  formData: FormData,
): Promise<{ success: string }> {
  const actor = await requirePlatformAdminActionAccess();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const companyId = await requireOperationalCompanyId(user.id);
  const id = getString(formData, "id");
  if (!id) throw new Error("Avtal saknas.");

  const { data, error } = await supabaseService.rpc(
    "gridex_remove_internal_contract_offer",
    {
      p_company_id: companyId,
      p_offer_id: id,
      p_mode: "safe_delete",
      p_actor_user_id: actor.userId,
    },
  );
  if (error) throw error;
  const result = data as {
    ok?: boolean;
    mode?: string;
    customer_contract_count?: number;
  } | null;
  if (!result?.ok) {
    throw new Error("Avtalet kunde inte tas bort säkert.");
  }

  revalidatePath("/admin/contracts");
  revalidatePath("/admin/customers/intake");
  revalidatePath("/admin/customers");
  return result.mode === "archived"
    ? {
        success:
          "Avtalet används av kundhistorik eller en aktiv version och arkiverades därför istället för att raderas.",
      }
    : {
        success:
          "Oanvänt avtalsutkast raderades. Signerade kundavtal raderas aldrig automatiskt.",
      };
}

export async function updateTenantContractChannelAction(formData: FormData) {
  const companyId = getString(formData, "company_id");
  const assignmentId = getString(formData, "assignment_id");
  const channel = getString(formData, "channel") || "website";
  const status = getString(formData, "status") || "paused";
  if (!companyId || !assignmentId)
    redirectBack({ error: "Bolag eller avtalstilldelning saknas." });

  try {
    const { requireCompanyScopedActionAccess } =
      await import("@/lib/admin/guards");
    const actor = await requireCompanyScopedActionAccess(companyId, {
      anyOf: ["contracts.write", "contracts.manage"],
    });
    await requireCompanyOperationalForWrites(companyId);

    const { data: assignment, error: assignmentError } = await supabaseService
      .from("tenant_contract_assignments")
      .select(
        "id,company_id,website_publication_allowed,internal_sales_allowed",
      )
      .eq("id", assignmentId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment) throw new Error("Avtalstilldelningen hittades inte.");
    if (channel === "website" && !assignment.website_publication_allowed)
      throw new Error(
        "Superadmin har inte tillåtit hemsidepublicering för avtalet.",
      );
    if (channel === "internal" && !assignment.internal_sales_allowed)
      throw new Error(
        "Superadmin har inte tillåtit intern försäljning för avtalet.",
      );

    const validFrom = getString(formData, "valid_from") || null;
    const validTo = getString(formData, "valid_to") || null;
    const marketingText = getString(formData, "marketing_text");
    const { error } = await supabaseService
      .from("tenant_contract_channels")
      .upsert(
        {
          assignment_id: assignmentId,
          channel,
          status,
          valid_from: validFrom,
          valid_to: validTo,
          marketing_content: marketingText ? { text: marketingText } : {},
          updated_by: actor.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "assignment_id,channel" },
      );
    if (error) throw error;
    revalidatePath("/admin/contracts");
    redirectBack({
      success:
        status === "active"
          ? "Försäljningskanalen aktiverades."
          : "Försäljningskanalen pausades.",
    });
  } catch (error) {
    redirectBack({ error: errorMessage(error) });
  }
}

export async function saveTenantLegalProfileAction(formData: FormData) {
  const companyId = getString(formData, "company_id");
  if (!companyId) redirectBack({ error: "Bolag saknas." });

  let successMessage = "Juridikprofilen sparades.";
  try {
    const { requireCompanyScopedActionAccess } =
      await import("@/lib/admin/guards");
    const actor = await requireCompanyScopedActionAccess(companyId, {
      anyOf: ["contracts.write", "contracts.manage"],
    });

    const legalName = formText(formData, "legal_name") || null;
    const organizationNumber = formText(formData, "organization_number") || null;
    const customerServiceEmail = normalizeEmail(
      formText(formData, "customer_service_email"),
      "Kundservice e-post",
    ) || null;
    const phone = formText(formData, "phone") || null;
    const website = normalizeUrl(formText(formData, "website"), "Webbplats") || null;
    const postalAddress = buildStructuredAddress(formData, "postal_address");
    const customerServiceAddressInput = buildStructuredAddress(
      formData,
      "customer_service_address",
    );
    const customerServiceAddress = Object.keys(customerServiceAddressInput).length > 0
      ? customerServiceAddressInput
      : postalAddress;

    const { error: defaultsError } = await supabaseService.rpc(
      "gridex_upsert_company_legal_profile_defaults",
      { p_company_id: companyId },
    );
    if (defaultsError && !["42883", "PGRST202"].includes(defaultsError.code ?? "")) {
      throw defaultsError;
    }

    const now = new Date().toISOString();
    const { data: savedProfile, error } = await supabaseService
      .from("tenant_legal_profiles")
      .upsert(
        {
          company_id: companyId,
          legal_name: legalName,
          organization_number: organizationNumber,
          customer_service_email: customerServiceEmail,
          phone,
          website,
          postal_address: postalAddress,
          customer_service_address: customerServiceAddress,
          complaints_contact: buildStructuredContact(
            formData,
            "complaints",
            "Klagomålskontakt",
          ),
          data_protection_contact: buildStructuredContact(
            formData,
            "data_protection",
            "Dataskyddskontakt",
          ),
          billing_information: buildBillingInformation(formData),
          dispute_resolution_information:
            buildDisputeResolutionInformation(formData),
          review_required: false,
          verified_by: null,
          verified_at: null,
          updated_at: now,
        },
        { onConflict: "company_id" },
      )
      .select("company_id,completeness_status,missing_fields,review_required")
      .single();
    if (error) throw error;

    const missingFields = Array.isArray(savedProfile.missing_fields)
      ? savedProfile.missing_fields.filter((value): value is string => typeof value === "string")
      : [];
    let finalStatus = String(savedProfile.completeness_status ?? "incomplete");

    if (missingFields.length === 0) {
      const { data: verifiedProfile, error: verifyError } = await supabaseService
        .from("tenant_legal_profiles")
        .update({
          review_required: false,
          verified_by: actor.userId,
          verified_at: now,
          updated_at: now,
        })
        .eq("company_id", companyId)
        .select("completeness_status")
        .single();
      if (verifyError) throw verifyError;
      finalStatus = String(verifiedProfile.completeness_status ?? "verified");
    }

    await supabaseService.from("audit_logs").insert({
      actor_user_id: actor.userId,
      company_id: companyId,
      entity_type: "tenant_legal_profile",
      entity_id: companyId,
      action: "tenant_legal_profile_updated",
      new_values: {
        company_id: companyId,
        completeness_status: finalStatus,
        missing_fields: missingFields,
        structured_profile: true,
      },
      metadata: { ui_source: getString(formData, "return_to") || "/admin/contracts" },
    });

    revalidatePath("/admin/contracts");
    revalidatePath(`/admin/companies/${companyId}`);
    revalidatePath(`/admin/platform/go-live/${companyId}`);

    successMessage = missingFields.length === 0
      ? "Juridikprofilen sparades och verifierades."
      : `Juridikprofilen sparades. Saknas fortfarande: ${missingFields.join(", ")}.`;
  } catch (error) {
    redirectLegalProfileBack(companyId, formData, { error: errorMessage(error) });
  }

  redirectLegalProfileBack(companyId, formData, { success: successMessage });
}
