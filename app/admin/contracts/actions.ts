"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { assertUserCanOperateCompany } from "@/lib/tenant/scope";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import { normalizeContractPricing } from "@/lib/pricing/contractPricingVersioning";
import { commonFixedPriceOrePerKwh } from "@/lib/pricing/fixedAreaPricing";
import { buildCanonicalContractPricingCommand } from "@/lib/pricing/canonicalInvoiceFee";
import { toSafeContractError } from "@/lib/errors/safeActionErrors";
import { parseAdminContractForm } from "@/lib/contracts/adminContractSchema";
import { requireContractPermissionAction } from "@/lib/contracts/permissions";
import { contractLifecycleError, type ContractLifecycleRpcResult } from "@/lib/contracts/lifecycleErrors";

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function redirectBack(params: {
  companyId?: string | null;
  success?: string;
  error?: string;
}): never {
  const search = new URLSearchParams();
  if (params.companyId) search.set("company_id", params.companyId);
  if (params.success) search.set("success", params.success);
  if (params.error) search.set("error", params.error);
  redirect(`/admin/contracts?${search.toString()}`);
}

function errorMessage(
  error: unknown,
  context: {
    action: string;
    companyId?: string | null;
    userId?: string | null;
  },
): string {
  return toSafeContractError(error, context);
}

function contractLifecycleFailure(result: ContractLifecycleRpcResult | null, fallback: string): Error {
  return contractLifecycleError(result, fallback);
}

function revalidateContractSurfaces(companyId: string): void {
  revalidatePath("/admin/contracts");
  revalidatePath("/admin/customers/intake");
  revalidatePath("/admin/customers");
  revalidatePath("/api/v1/public/contracts");
  revalidatePath("/api/v1/website/public-contracts");
  for (const tag of [
    `tenant-contracts:${companyId}`,
    `public-contracts:${companyId}`,
    `quote-contracts:${companyId}`,
    `website-contracts:${companyId}`,
  ]) {
    revalidateTag(tag, "max");
  }
}

export async function saveContractOfferAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  let success: string;
  try {
    success = (await saveContractOfferActionImpl(formData)).success;
  } catch (error) {
    redirectBack({
      companyId,
      error: errorMessage(error, { action: "save_contract_offer", companyId }),
    });
  }
  redirectBack({ companyId, success });
}

async function saveContractOfferActionImpl(
  formData: FormData,
): Promise<{ success: string }> {
  const input = parseAdminContractForm(formData);
  if (!["draft", "ready"].includes(input.lifecycleStatus)) {
    throw new Error(
      "Avtalsformuläret sparar endast utkast. Använd det separata publiceringskommandot efter readiness-kontroll.",
    );
  }
  const actor = await requireContractPermissionAction(
    input.id ? "contracts.edit_draft" : "contracts.create",
  );
  await requireContractPermissionAction("pricing.write");

  const companyId = await assertUserCanOperateCompany(
    actor.userId,
    input.companyId,
  );
  await requireCompanyOperationalForWrites(companyId);

  let previous: Record<string, unknown> | null = null;
  if (input.id) {
    const { data: oldOffer, error: oldOfferError } = await supabaseService
      .from("contract_offers")
      .select("*")
      .eq("id", input.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (oldOfferError) throw oldOfferError;
    previous = (oldOffer as Record<string, unknown> | null) ?? null;
    if (!previous) throw new Error("Avtalet hittades inte för valt bolag.");

    const previousLifecycle = String(
      previous.lifecycle_status ??
        (previous.archived_at
          ? "archived"
          : previous.status === "active" && previous.is_active
            ? "published"
            : previous.status === "draft"
              ? "draft"
              : "paused"),
    );
    if (["published", "paused", "expired", "archived"].includes(previousLifecycle)) {
      await requireContractPermissionAction("contracts.create_version");
    }
  }

  const normalizedPricing = normalizeContractPricing({
    name: input.name,
    contractType: input.contractType,
    customerType: input.customerType,
    fixedPriceOrePerKwh: input.fixedPriceOrePerKwh,
    fixedPricesByArea: input.fixedPricesByArea,
    spotMarkupOrePerKwh: input.spotMarkupOrePerKwh,
    variableFeeOrePerKwh: input.variableFeeOrePerKwh,
    monthlyFeeSek: input.monthlyFeeSek,
    invoiceFeeSek: input.invoiceFeeSek,
    electricityCertificateOrePerKwh: getString(
      formData,
      "electricity_certificate_ore_per_kwh",
    ),
    portfolioManagementFeeAmount: input.portfolioManagementFeeAmount,
    portfolioManagementFeeUnit: input.portfolioManagementFeeUnit,
    portfolioManagementFeeCalculationBase:
      input.portfolioManagementFeeCalculationBase,
    portfolioId: input.portfolioId,
    portfolioSettlementTiming: input.portfolioSettlementTiming,
    portfolioEstimateRule: input.portfolioEstimateRule,
    portfolioShowHistoricalFinal: input.portfolioShowHistoricalFinal,
    portfolioShowIndication: input.portfolioShowIndication,
    greenFeeMode: input.greenFeeMode,
    greenFeeValue: input.greenFeeValue,
    startFeeSek: input.startFeeSek,
    administrationFeeSek: input.adminFeeSek,
    breakFeeSek: input.breakFeeSek,
    discountValue: input.discountValue,
    discountUnit: input.discountUnit,
    discountCalculationBase: input.discountCalculationBase,
    discountMonths: input.discountMonths,
    vatRate: input.vatRate,
    spotWeightPercent: input.spotWeightPercent,
    portfolioWeightPercent: input.portfolioWeightPercent,
    fixedWeightPercent: input.fixedWeightPercent,
    spotIntervalResolution: input.spotIntervalResolution,
    priceAreas: input.priceAreas,
    validFrom: input.validFrom,
    validTo: input.validTo,
    bindingMonths: input.bindingMonths,
    noticeMonths: input.noticeMonths,
    automaticRenewal: input.automaticRenewal,
    powerOfAttorneyRequired: input.powerOfAttorneyRequired,
    optionalFeeLines: input.optionalFees,
    productionEnabled: input.productionEnabled,
    productionCompensationOrePerKwh:
      input.productionCompensationOrePerKwh,
    productionVatRate: input.productionVatRate,
    productionSettlementMode: input.productionSettlementMode,
    websiteCardVisibility: {
      fixed_price: input.visibility.fixed_price,
      spot_markup: input.visibility.spot_markup,
      variable_fee: input.visibility.variable_fee,
      monthly_fee: input.visibility.monthly_fee,
      invoice_fee: input.visibility.invoice_fee,
      green_energy_fee: input.visibility.green_fee,
      electricity_certificate: input.visibility.electricity_certificate,
      start_fee: input.visibility.start_fee,
      administration_fee: input.visibility.admin_fee,
      break_fee: input.visibility.break_fee,
      portfolio_price: input.visibility.portfolio_price,
      portfolio_management_fee: input.visibility.portfolio_management_fee,
      campaign_discount: input.visibility.discount,
      optional_fees: input.visibility.optional_fees,
      production_compensation: input.visibility.production_compensation,
    },
  });

  const legacyCommonFixedPriceOrePerKwh = commonFixedPriceOrePerKwh(
    normalizedPricing.snapshot,
    input.fixedPriceOrePerKwh,
    normalizedPricing.snapshot.price_areas,
  );

  const canonicalPricingCommand = buildCanonicalContractPricingCommand({
    pricingModel: normalizedPricing.pricingModel,
    pricingSnapshot: {
      ...normalizedPricing.snapshot,
      power_of_attorney_mode: input.powerOfAttorneyMode,
      automatic_renewal_term_months: input.automaticRenewalTermMonths,
      discount_starts_on_mode: input.discountStartsOnMode,
      max_customers: input.maxCustomers,
    },
    invoiceFeeSek: input.invoiceFeeSek,
  });

  const payload = {
    name: input.name,
    slug: input.slug,
    status: input.legacyStatus,
    lifecycle_status: input.lifecycleStatus,
    contract_type: input.contractType,
    customer_type: input.customerType,
    pricing_model: canonicalPricingCommand.pricing_model,
    campaign_name: input.campaignName,
    campaign_code: input.campaignCode,
    campaign_version: input.campaignVersion,
    terms_version: input.termsVersion,
    max_customers: input.maxCustomers,
    discount_value: input.discountValue,
    discount_unit: input.discountUnit,
    discount_calculation_base: input.discountCalculationBase,
    discount_months: input.discountMonths,
    discount_starts_on_mode: input.discountStartsOnMode,
    start_fee_sek: input.startFeeSek,
    admin_fee_sek: input.adminFeeSek,
    break_fee_sek: input.breakFeeSek,
    vat_rate: input.vatRate,
    description: input.description,
    // Legacy scalar is retained only when all area rows share one value.
    // Different SE prices live canonically in the immutable base components.
    fixed_price_ore_per_kwh: legacyCommonFixedPriceOrePerKwh,
    spot_markup_ore_per_kwh: input.spotMarkupOrePerKwh,
    variable_fee_ore_per_kwh: input.variableFeeOrePerKwh,
    monthly_fee_sek: input.monthlyFeeSek,
    invoice_fee_sek: canonicalPricingCommand.invoice_fee_sek,
    green_fee_mode: input.greenFeeMode,
    green_fee_value: input.greenFeeValue,
    default_binding_months: input.bindingMonths,
    default_notice_months: input.noticeMonths,
    optional_fee_lines: input.optionalFees,
    automatic_renewal: input.automaticRenewal,
    automatic_renewal_term_months: input.automaticRenewalTermMonths,
    power_of_attorney_mode: input.powerOfAttorneyMode,
    power_of_attorney_required: input.powerOfAttorneyRequired,
    is_active: input.isActive,
    valid_from: input.validFrom,
    valid_to: input.validTo,
    channels: {
      internal: input.lifecycleStatus === "published" ? "active" : "paused",
      website: "paused",
      api: "paused",
    },
  };

  const { data: commandData, error: commandError } = await supabaseService.rpc(
    "gridex_upsert_internal_contract_offer",
    {
      p_company_id: companyId,
      p_offer_id: input.id,
      p_payload: payload,
      p_pricing_snapshot: canonicalPricingCommand.pricing_snapshot,
      p_actor_user_id: actor.userId,
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
    contract_product_id?: string;
    contract_product_version_id?: string;
    created_new_version?: boolean;
  };
  if (
    !command.offer?.id ||
    !command.pricing?.price_plan_id ||
    !command.pricing.price_plan_version_id ||
    !command.pricing.price_book_id ||
    !command.pricing.version_label ||
    !command.contract_product_id ||
    !command.contract_product_version_id
  ) {
    throw new Error(
      "Avtalskommandot returnerade ofullständiga canonical versionsreferenser.",
    );
  }

  await supabaseService.from("audit_logs").insert({
    actor_user_id: actor.userId,
    entity_type: "contract_offer",
    entity_id: String(command.offer.id),
    company_id: companyId,
    action: input.id
      ? command.created_new_version
        ? "contract.version.created"
        : "contract.draft.updated"
      : "contract.draft.created",
    old_values: previous,
    new_values: command.offer,
    metadata: {
      lifecycle_status: input.lifecycleStatus,
      contract_product_id: command.contract_product_id,
      contract_product_version_id: command.contract_product_version_id,
      price_plan_id: command.pricing.price_plan_id,
      price_plan_version_id: command.pricing.price_plan_version_id,
      price_book_id: command.pricing.price_book_id,
      price_version: command.pricing.version_label,
      price_version_reused: command.pricing.reused === true,
      canonical_command: "gridex_upsert_internal_contract_offer",
    },
  });

  revalidateContractSurfaces(companyId);

  return {
    success: command.created_new_version
      ? `Ny immutable avtalsversion skapades i samma produktserie. Prisversion ${command.pricing.version_label}.`
      : input.lifecycleStatus === "published"
        ? `Avtalsversionen publicerades för intern försäljning. Prisversion ${command.pricing.version_label}.`
        : `Avtalsutkastet sparades. Prisversion ${command.pricing.version_label}.`,
  };
}

export async function archiveContractOfferAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  let success: string;
  try {
    success = (await archiveContractOfferActionImpl(formData)).success;
  } catch (error) {
    redirectBack({
      companyId,
      error: errorMessage(error, {
        action: "archive_contract_offer",
        companyId,
      }),
    });
  }
  redirectBack({ companyId, success });
}

async function archiveContractOfferActionImpl(
  formData: FormData,
): Promise<{ success: string }> {
  const actor = await requireContractPermissionAction("contracts.archive");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const companyId = await assertUserCanOperateCompany(
    user.id,
    getString(formData, "company_id"),
  );
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

  revalidateContractSurfaces(companyId);
  return {
    success:
      "Avtalet arkiverades och är dolt från kundintaget. Historiska kundavtal påverkas inte.",
  };
}

export async function deleteContractOfferAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  let success: string;
  try {
    success = (await deleteContractOfferActionImpl(formData)).success;
  } catch (error) {
    redirectBack({
      companyId,
      error: errorMessage(error, {
        action: "delete_contract_offer",
        companyId,
      }),
    });
  }
  redirectBack({ companyId, success });
}

async function deleteContractOfferActionImpl(
  formData: FormData,
): Promise<{ success: string }> {
  const actor = await requireContractPermissionAction("contracts.delete_unused");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const companyId = await assertUserCanOperateCompany(
    user.id,
    getString(formData, "company_id"),
  );
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
  const result = data as ContractLifecycleRpcResult | null;
  if (!result?.ok || result.mode !== "deleted") {
    throw contractLifecycleFailure(result, "Avtalet kunde inte tas bort säkert.");
  }

  revalidateContractSurfaces(companyId);
  return {
    success:
      "Oanvänt avtalsutkast raderades. Signerade kundavtal raderas aldrig automatiskt.",
  };
}

export async function closeContractOfferAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  let success: string;
  try {
    const actor = await requireContractPermissionAction("contracts.close");
    if (!companyId) throw new Error("Bolag saknas.");
    await assertUserCanOperateCompany(actor.userId, companyId);
    const offerId = getString(formData, "id");
    const reason = getString(formData, "reason");
    if (!offerId) throw new Error("Avtal saknas.");
    if (!reason) throw new Error("Ange varför avtalet ska stängas.");

    const { data, error } = await supabaseService.rpc(
      "gridex_close_contract_product",
      {
        p_company_id: companyId,
        p_offer_id: offerId,
        p_actor_user_id: actor.userId,
        p_reason: reason,
      },
    );
    if (error) throw error;
    const result = data as ContractLifecycleRpcResult | null;
    if (!result?.ok) {
      throw contractLifecycleFailure(result, "Avtalet kunde inte stängas.");
    }
    revalidateContractSurfaces(companyId);
    success =
      "Avtalet stängdes terminalt för nyförsäljning. Historiska kundavtal och snapshots bevarades.";
  } catch (error) {
    redirectBack({
      companyId,
      error: errorMessage(error, { action: "close_contract_offer", companyId }),
    });
  }
  redirectBack({ companyId, success });
}

export async function updateTenantContractChannelAction(formData: FormData) {
  let success: string;
  try {
    success = await updateTenantContractChannelActionImpl(formData);
  } catch (error) {
    redirectBack({
      companyId: getString(formData, "company_id") || null,
      error: errorMessage(error, {
        action: "update_contract_channel",
        companyId: getString(formData, "company_id") || null,
      }),
    });
  }
  redirectBack({
    companyId: getString(formData, "company_id") || null,
    success,
  });
}

async function updateTenantContractChannelActionImpl(
  formData: FormData,
): Promise<string> {
  const companyId = getString(formData, "company_id");
  const assignmentId = getString(formData, "assignment_id");
  const channel = getString(formData, "channel") || "website";
  const status = getString(formData, "status") || "paused";
  if (!companyId || !assignmentId) {
    throw new Error("Bolag eller avtalstilldelning saknas.");
  }
  if (!["internal", "website", "api", "partner", "phone"].includes(channel)) {
    throw new Error("Ogiltig försäljningskanal.");
  }
  if (!["active", "paused", "ended"].includes(status)) {
    throw new Error("Ogiltig kanalstatus.");
  }

  const requiredPermission = status === "active" ? "contracts.publish" : "contracts.pause";
  const actor = await requireContractPermissionAction(requiredPermission);
  if (status === "active") {
    await requireContractPermissionAction("pricing.publish");
  }
  await assertUserCanOperateCompany(actor.userId, companyId);
  if (status === "active") {
    await requireCompanyOperationalForWrites(companyId);
  }

  const { data: assignment, error: assignmentError } = await supabaseService
    .from("tenant_contract_assignments")
    .select("id,company_id,contract_product_version_id,website_publication_allowed,internal_sales_allowed")
    .eq("id", assignmentId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (assignmentError) throw assignmentError;
  if (!assignment) throw new Error("Avtalstilldelningen hittades inte.");
  if (channel === "website" && !assignment.website_publication_allowed && status === "active") {
    throw new Error("Superadmin har inte tillåtit hemsidepublicering för avtalet.");
  }
  if (channel === "internal" && !assignment.internal_sales_allowed && status === "active") {
    throw new Error("Superadmin har inte tillåtit intern försäljning för avtalet.");
  }

  const { data: offer, error: offerError } = await supabaseService
    .from("contract_offers")
    .select("id,lifecycle_status")
    .eq("company_id", companyId)
    .eq("contract_product_version_id", assignment.contract_product_version_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (offerError) throw offerError;
  if (!offer) throw new Error("Canonical avtalsversion saknas för tilldelningen.");
  if (offer.lifecycle_status !== "published" && status === "active") {
    throw new Error("Endast en readiness-publicerad avtalsversion kan aktiveras i en kanal.");
  }

  const command = status === "active"
    ? "gridex_publish_contract_channel"
    : "gridex_unpublish_contract_channel";
  const { data, error } = await supabaseService.rpc(command, {
    p_company_id: companyId,
    p_offer_id: offer.id,
    p_channel: channel,
    p_actor_user_id: actor.userId,
  });
  if (error) throw error;
  const result = data as ContractLifecycleRpcResult | null;
  if (!result?.ok) {
    throw contractLifecycleFailure(result, "Kanaländringen kunde inte genomföras atomärt.");
  }
  if (result.changed === false && !result.already_unpublished) {
    throw contractLifecycleFailure(result, "Kanaländringen påverkade inga rader.");
  }

  revalidateContractSurfaces(companyId);
  return status === "active"
    ? "Försäljningskanalen publicerades från samma canonical avtalsversion."
    : "Försäljningskanalen avpublicerades utan att ändra signerad historik.";
}


export async function pauseContractOfferAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  try {
    const actor = await requireContractPermissionAction("contracts.pause");
    if (!companyId) throw new Error("Bolag saknas.");
    await assertUserCanOperateCompany(actor.userId, companyId);
    const offerId = getString(formData, "id");
    if (!offerId) throw new Error("Avtal saknas.");
    const { data, error } = await supabaseService.rpc("gridex_pause_contract_channels", {
      p_company_id: companyId,
      p_offer_id: offerId,
      p_actor_user_id: actor.userId,
    });
    if (error) throw error;
    const result = data as ContractLifecycleRpcResult | null;
    if (!result?.ok) throw contractLifecycleFailure(result, "Avtalet kunde inte pausas.");
    if (result.changed === false) throw new Error("Avtalet hade inga aktiva försäljningskanaler att pausa.");
    revalidateContractSurfaces(companyId);
  } catch (error) {
    redirectBack({ companyId, error: errorMessage(error, { action: "pause_contract_offer", companyId }) });
  }
  redirectBack({ companyId, success: "Avtalet pausades i samtliga aktiva försäljningskanaler." });
}

export async function publishContractVersionAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  try {
    const actor = await requireContractPermissionAction("contracts.publish");
    await requireContractPermissionAction("pricing.publish");
    if (!companyId) throw new Error("Bolag saknas.");
    await assertUserCanOperateCompany(actor.userId, companyId);
    await requireCompanyOperationalForWrites(companyId);
    const offerId = getString(formData, "id");
    if (!offerId) throw new Error("Avtal saknas.");

    const { data, error } = await supabaseService.rpc(
      "gridex_publish_internal_contract_version",
      {
        p_company_id: companyId,
        p_offer_id: offerId,
        p_actor_user_id: actor.userId,
      },
    );
    if (error) throw error;
    if (!(data as { ok?: boolean } | null)?.ok) {
      throw new Error("Avtalsversionen kunde inte publiceras.");
    }
    revalidateContractSurfaces(companyId);
  } catch (error) {
    redirectBack({
      companyId,
      error: errorMessage(error, {
        action: "publish_contract_version",
        companyId,
      }),
    });
  }
  redirectBack({
    companyId,
    success:
      "Avtalsversionen readiness-kontrollerades och publicerades internt med samma låsta pris- och produktidentitet.",
  });
}


export async function publishContractChannelAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  const channel = getString(formData, "channel") || "website";
  try {
    const actor = await requireContractPermissionAction("contracts.publish");
    await requireContractPermissionAction("pricing.publish");
    if (!companyId) throw new Error("Bolag saknas.");
    await assertUserCanOperateCompany(actor.userId, companyId);
    await requireCompanyOperationalForWrites(companyId);
    const offerId = getString(formData, "id");
    if (!offerId) throw new Error("Avtal saknas.");
    const { data, error } = await supabaseService.rpc("gridex_publish_contract_channel", {
      p_company_id: companyId,
      p_offer_id: offerId,
      p_channel: channel,
      p_actor_user_id: actor.userId,
    });
    if (error) throw error;
    const result = data as ContractLifecycleRpcResult | null;
    if (!result?.ok) throw contractLifecycleFailure(result, "Kanalen kunde inte publiceras.");
    if (result.changed === false) throw new Error("Kanalen var redan publicerad och inga rader ändrades.");
    revalidateContractSurfaces(companyId);
  } catch (error) {
    redirectBack({ companyId, error: errorMessage(error, { action: "publish_contract_channel", companyId }) });
  }
  redirectBack({ companyId, success: `${channel === "website" ? "Hemsidan" : "API-kanalen"} publicerades från samma canonical avtalsversion.` });
}

export async function unpublishContractChannelAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  const channel = getString(formData, "channel") || "website";
  try {
    const actor = await requireContractPermissionAction("contracts.pause");
    if (!companyId) throw new Error("Bolag saknas.");
    await assertUserCanOperateCompany(actor.userId, companyId);
    const offerId = getString(formData, "id");
    if (!offerId) throw new Error("Avtal saknas.");
    const { data, error } = await supabaseService.rpc("gridex_unpublish_contract_channel", {
      p_company_id: companyId,
      p_offer_id: offerId,
      p_channel: channel,
      p_actor_user_id: actor.userId,
    });
    if (error) throw error;
    const result = data as ContractLifecycleRpcResult | null;
    if (!result?.ok) throw contractLifecycleFailure(result, "Kanalen kunde inte avpubliceras.");
    if (result.changed === false && !result.already_unpublished) {
      throw contractLifecycleFailure(result, "Avpubliceringen påverkade inga rader.");
    }
    revalidateContractSurfaces(companyId);
  } catch (error) {
    redirectBack({ companyId, error: errorMessage(error, { action: "unpublish_contract_channel", companyId }) });
  }
  redirectBack({
    companyId,
    success: `${channel === "website" ? "Hemsidan" : channel === "api" ? "API-kanalen" : "Den interna kanalen"} avpublicerades. Publiceringsbehörigheten finns kvar.`,
  });
}

export async function cleanupUnusedContractDraftsAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  const apply = getString(formData, "apply") === "true";
  let success: string;
  try {
    const actor = await requireContractPermissionAction("contracts.delete_unused");
    if (!companyId) throw new Error("Bolag saknas.");
    await assertUserCanOperateCompany(actor.userId, companyId);
    const { data, error } = await supabaseService.rpc("gridex_cleanup_unused_contract_drafts", {
      p_company_id: companyId,
      p_actor_user_id: actor.userId,
      p_apply: apply,
    });
    if (error) throw error;
    const result = data as { ok?: boolean; deleted_count?: number; archive_only_count?: number } | null;
    if (!result?.ok) throw new Error("Rensningsanalysen misslyckades.");
    revalidateContractSurfaces(companyId);
    success = apply
      ? `${result.deleted_count ?? 0} oanvända avtalsutkast raderades. ${result.archive_only_count ?? 0} avtal med historik lämnades kvar.`
      : "Dry-run klar. Raderbara och arkiveringspliktiga avtal har analyserats utan ändringar.";
  } catch (error) {
    redirectBack({ companyId, error: errorMessage(error, { action: "cleanup_unused_contract_drafts", companyId }) });
  }
  redirectBack({ companyId, success });
}
