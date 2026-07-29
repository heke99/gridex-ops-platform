"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRequestClient, supabaseService } from "@/lib/supabase/service";
import { assertUserCanOperateCompany } from "@/lib/tenant/scope";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import { normalizeContractPricing } from "@/lib/pricing/contractPricingVersioning";
import { commonFixedPriceOrePerKwh } from "@/lib/pricing/fixedAreaPricing";
import { buildCanonicalContractPricingCommand } from "@/lib/pricing/canonicalInvoiceFee";
import { toSafeContractErrorPersisted } from "@/lib/errors/safeActionErrors";
import { parseAdminContractForm } from "@/lib/contracts/adminContractSchema";
import { requireContractPermissionAction } from "@/lib/contracts/permissions";
import { contractLifecycleError, type ContractLifecycleRpcResult } from "@/lib/contracts/lifecycleErrors";
import { archiveContractProduct, deleteContractProduct } from "@/lib/contracts/adminMutations";
import { contractChannelLabel } from "@/lib/contracts/lifecycle";
import {
  publishContractChannel,
  setContractChannelPermission,
  unpublishContractChannel,
} from "@/lib/contracts/channelPublication";
import type { ContractPublicationChannel } from "@/lib/customer-contracts/types";

function contractMutationServiceClient() {
  const requestId = randomUUID();
  return createSupabaseServiceRequestClient({
    requestId,
    correlationId: requestId,
  });
}

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function contractChannel(value: string): ContractPublicationChannel {
  if (value === "internal" || value === "website" || value === "api") {
    return value;
  }
  throw new Error("Ogiltig avtalskanal.");
}

function redirectBack(params: {
  companyId?: string | null;
  offerId?: string | null;
  surface?: "contracts" | "company";
  success?: string;
  error?: string;
}): never {
  const search = new URLSearchParams();
  if (params.success) search.set("success", params.success);
  if (params.error) search.set("error", params.error);
  if (params.surface === "company" && params.companyId) {
    redirect(
      `/admin/companies/${params.companyId}${search.size ? `?${search.toString()}` : ""}#tenant-internal-contracts`,
    );
  }
  if (params.companyId) search.set("company_id", params.companyId);
  if (params.offerId) search.set("edit_offer", params.offerId);
  redirect(`/admin/contracts?${search.toString()}`);
}

function actionSurface(formData: FormData): "contracts" | "company" {
  return getString(formData, "return_surface") === "company"
    ? "company"
    : "contracts";
}

async function errorMessage(
  error: unknown,
  context: {
    action: string;
    companyId?: string | null;
    userId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  let userId = context.userId ?? null;
  if (!userId) {
    try {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      // Error persistence must never mask the original action error.
    }
  }
  return toSafeContractErrorPersisted(error, { ...context, userId });
}

function contractLifecycleFailure(result: ContractLifecycleRpcResult | null, fallback: string): Error {
  return contractLifecycleError(result, fallback);
}

function revalidateContractSurfaces(companyId: string): void {
  revalidatePath("/admin/contracts");
  revalidatePath("/admin/companies");
  revalidatePath(`/admin/companies/${companyId}`);
  revalidatePath("/admin/customers/intake");
  revalidatePath("/admin/customers");
  revalidatePath("/api/v1/website/public-contracts");
  revalidatePath("/api/v1/website/public-contracts/diagnostics");
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
  let result: { success: string; offerId: string };
  try {
    result = await saveContractOfferActionImpl(formData);
  } catch (error) {
    redirectBack({
      companyId,
      error: await errorMessage(error, {
        action: "save_contract_offer",
        companyId,
        metadata: { offerId: getString(formData, "id") || null },
      }),
    });
  }
  redirectBack({ companyId, offerId: result.offerId, success: result.success });
}

async function saveContractOfferActionImpl(
  formData: FormData,
): Promise<{ success: string; offerId: string }> {
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
    if (previousLifecycle === "closed") {
      throw new Error(
        "Ett stängt avtal är terminalt och får inte redigeras eller versioneras. Arkivera avtalet för historisk förvaring.",
      );
    }
    if (previousLifecycle === "archived") {
      throw new Error(
        "Ett arkiverat avtal är terminalt. Skapa en separat efterföljande produkt i stället för att återaktivera den arkiverade serien.",
      );
    }
    if (["published", "paused", "expired", "superseded"].includes(previousLifecycle)) {
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
    energy_direction: normalizedPricing.snapshot.energy_direction,
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
      // Draft/ready saves never publish. Channel activation is a separate,
      // readiness-gated lifecycle command.
      internal: "paused",
      website: "paused",
      api: "paused",
    },
  };

  const { data: commandData, error: commandError } = await contractMutationServiceClient().rpc(
    "gridex_upsert_internal_contract_offer_v2",
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

  const lifecycleResult = commandData as ContractLifecycleRpcResult;
  if (lifecycleResult.ok === false) {
    throw contractLifecycleFailure(
      lifecycleResult,
      "Avtalsutkastet kunde inte sparas.",
    );
  }

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
    tenant_contract_assignment_id?: string;
    company_id?: string;
    created_new_version?: boolean;
  };
  if (
    !command.offer?.id ||
    !command.pricing?.price_plan_id ||
    !command.pricing.price_plan_version_id ||
    !command.pricing.price_book_id ||
    !command.pricing.version_label ||
    !command.contract_product_id ||
    !command.contract_product_version_id ||
    !command.tenant_contract_assignment_id ||
    command.company_id !== companyId ||
    command.offer.company_id !== companyId
  ) {
    throw new Error(
      "Avtalskommandot returnerade ofullständiga canonical versionsreferenser.",
    );
  }

  // gridex_upsert_internal_contract_offer writes the canonical audit row atomically.
  // Do not write a second best-effort audit row outside the RPC transaction.

  revalidateContractSurfaces(companyId);

  return {
    offerId: String(command.offer.id),
    success: command.created_new_version
      ? `Ny immutable avtalsversion skapades i samma produktserie. Prisversion ${command.pricing.version_label}.`
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
      error: await errorMessage(error, {
        action: "archive_contract_offer",
        companyId,
        metadata: { offerId: getString(formData, "id") || null },
      }),
    });
  }
  redirectBack({ companyId, success });
}

export async function copyContractOfferAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  const sourceOfferId = getString(formData, "id");
  let newOfferId: string;
  try {
    if (!companyId || !sourceOfferId) {
      throw new Error("Bolag och källavtal krävs för att skapa en kopia.");
    }
    const actor = await requireContractPermissionAction("contracts.create");
    const scopedCompanyId = await assertUserCanOperateCompany(
      actor.userId,
      companyId,
    );
    await requireCompanyOperationalForWrites(scopedCompanyId);

    const { data, error } = await contractMutationServiceClient().rpc(
      "gridex_copy_contract_offer_v1",
      {
        p_company_id: scopedCompanyId,
        p_source_offer_id: sourceOfferId,
        p_actor_user_id: actor.userId,
      },
    );
    if (error) throw error;
    const result = data as ContractLifecycleRpcResult & {
      new_contract_offer_id?: string;
    };
    if (result?.ok === false) {
      throw contractLifecycleFailure(
        result,
        "Avtalskopian kunde inte skapas.",
      );
    }
    newOfferId = String(result?.new_contract_offer_id ?? "");
    if (!newOfferId) {
      throw new Error(
        "Kopieringskommandot returnerade inte det nya avtalsutkastet.",
      );
    }
    revalidateContractSurfaces(scopedCompanyId);
  } catch (error) {
    redirectBack({
      companyId,
      error: await errorMessage(error, {
        action: "copy_contract_offer",
        companyId,
        metadata: { sourceOfferId: sourceOfferId || null },
      }),
    });
  }
  redirectBack({
    companyId,
    offerId: newOfferId,
    success:
      "Ett nytt opublicerat avtalsutkast skapades. Kundavtal, offerter, signaturer, fullmakter och publiceringar kopierades inte.",
  });
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

  const result = await archiveContractProduct({
    companyId,
    offerId: id,
    actorUserId: actor.userId,
  });
  if (!result?.ok || result.mode !== "archived") {
    throw contractLifecycleFailure(result, "Avtalet kunde inte arkiveras säkert.");
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
      error: await errorMessage(error, {
        action: "delete_contract_offer",
        companyId,
        metadata: { offerId: getString(formData, "id") || null },
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

  const result = await deleteContractProduct({
    companyId,
    offerId: id,
    actorUserId: actor.userId,
    expectedPreviewToken:
      getString(formData, "expected_preview_token") || null,
  });
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

    const { data, error } = await contractMutationServiceClient().rpc(
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
      "Avtalet stängdes för ny försäljning och kan nu arkiveras. Historiska kundavtal och snapshots bevarades.";
  } catch (error) {
    redirectBack({
      companyId,
      error: await errorMessage(error, {
        action: "close_contract_offer",
        companyId,
        metadata: { offerId: getString(formData, "id") || null },
      }),
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
      error: await errorMessage(error, {
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
  const canonicalChannel = contractChannel(channel);
  if (!["active", "paused", "ended"].includes(status)) {
    throw new Error("Ogiltig kanalstatus.");
  }

  const requiredPermission =
    status === "active"
      ? `contracts.publish.${canonicalChannel}`
      : "contracts.pause";
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
    .select(
      "id,company_id,contract_product_version_id,website_publication_allowed,internal_sales_allowed,api_publication_allowed",
    )
    .eq("id", assignmentId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (assignmentError) throw assignmentError;
  if (!assignment) throw new Error("Avtalstilldelningen hittades inte.");
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
  if (!(["published", "paused"] as const).includes(offer.lifecycle_status as "published" | "paused") && status === "active") {
    throw new Error("Endast en publicerad eller pausad avtalsversion kan aktiveras i en kanal.");
  }

  if (status === "active") {
    await publishContractChannel({
      companyId,
      offerId: offer.id,
      channel: canonicalChannel,
      actorUserId: actor.userId,
    });
  } else if (status === "paused") {
    await unpublishContractChannel({
      companyId,
      offerId: offer.id,
      channel: canonicalChannel,
      actorUserId: actor.userId,
    });
  } else {
    const { data, error } = await contractMutationServiceClient().rpc(
      "gridex_end_contract_channel",
      {
        p_company_id: companyId,
        p_offer_id: offer.id,
        p_channel: canonicalChannel,
        p_actor_user_id: actor.userId,
      },
    );
    if (error) throw error;
    const result = data as ContractLifecycleRpcResult | null;
    if (!result?.ok) {
      throw contractLifecycleFailure(
        result,
        "Kanalen kunde inte avslutas atomärt.",
      );
    }
  }

  revalidateContractSurfaces(companyId);
  return status === "active"
    ? "Försäljningskanalen publicerades från samma canonical avtalsversion."
    : status === "ended"
      ? "Försäljningskanalen avslutades utan att ändra signerad historik."
      : "Försäljningskanalen pausades utan att ändra signerad historik.";
}


export async function pauseContractOfferAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  try {
    const actor = await requireContractPermissionAction("contracts.pause");
    if (!companyId) throw new Error("Bolag saknas.");
    await assertUserCanOperateCompany(actor.userId, companyId);
    const offerId = getString(formData, "id");
    if (!offerId) throw new Error("Avtal saknas.");
    const { data, error } = await contractMutationServiceClient().rpc("gridex_pause_contract_channels", {
      p_company_id: companyId,
      p_offer_id: offerId,
      p_actor_user_id: actor.userId,
    });
    if (error) throw error;
    const result = data as ContractLifecycleRpcResult | null;
    if (!result?.ok) throw contractLifecycleFailure(result, "Avtalet kunde inte pausas.");
    revalidateContractSurfaces(companyId);
  } catch (error) {
    redirectBack({
      companyId,
      error: await errorMessage(error, {
        action: "pause_contract_offer",
        companyId,
        metadata: { offerId: getString(formData, "id") || null },
      }),
    });
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

    const { data, error } = await contractMutationServiceClient().rpc(
      "gridex_publish_internal_contract_version",
      {
        p_company_id: companyId,
        p_offer_id: offerId,
        p_actor_user_id: actor.userId,
      },
    );
    if (error) throw error;
    const result = data as ContractLifecycleRpcResult | null;
    if (!result?.ok) {
      throw contractLifecycleFailure(
        result,
        "Avtalsversionen kunde inte publiceras.",
      );
    }
    revalidateContractSurfaces(companyId);
  } catch (error) {
    redirectBack({
      companyId,
      error: await errorMessage(error, {
        action: "publish_contract_version",
        companyId,
        metadata: { offerId: getString(formData, "id") || null },
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
  const channelInput = getString(formData, "channel") || "website";
  const surface = actionSurface(formData);
  let channel: ContractPublicationChannel;
  try {
    channel = contractChannel(channelInput);
    const actor = await requireContractPermissionAction(
      `contracts.publish.${channel}`,
    );
    await requireContractPermissionAction("pricing.publish");
    if (!companyId) throw new Error("Bolag saknas.");
    await assertUserCanOperateCompany(actor.userId, companyId);
    await requireCompanyOperationalForWrites(companyId);
    const offerId = getString(formData, "id");
    if (!offerId) throw new Error("Avtal saknas.");
    await publishContractChannel({
      companyId,
      offerId,
      channel,
      actorUserId: actor.userId,
    });
    revalidateContractSurfaces(companyId);
  } catch (error) {
    redirectBack({
      companyId,
      surface,
      error: await errorMessage(error, {
        action: "contract_channel_publish_failed",
        companyId,
        metadata: {
          offerId: getString(formData, "id") || null,
          channel: channelInput,
        },
      }),
    });
  }
  redirectBack({
    companyId,
    surface,
    success: `${contractChannelLabel(channel)} publicerades från samma canonical avtalsversion.`,
  });
}

export async function unpublishContractChannelAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  const channelInput = getString(formData, "channel") || "website";
  const surface = actionSurface(formData);
  let channel: ContractPublicationChannel;
  try {
    channel = contractChannel(channelInput);
    const actor = await requireContractPermissionAction("contracts.pause");
    if (!companyId) throw new Error("Bolag saknas.");
    await assertUserCanOperateCompany(actor.userId, companyId);
    const offerId = getString(formData, "id");
    if (!offerId) throw new Error("Avtal saknas.");
    await unpublishContractChannel({
      companyId,
      offerId,
      channel,
      actorUserId: actor.userId,
    });
    revalidateContractSurfaces(companyId);
  } catch (error) {
    redirectBack({
      companyId,
      surface,
      error: await errorMessage(error, {
        action: "unpublish_contract_channel",
        companyId,
        metadata: {
          offerId: getString(formData, "id") || null,
          channel: channelInput,
        },
      }),
    });
  }
  redirectBack({
    companyId,
    surface,
    success: `${contractChannelLabel(channel)} avpublicerades. Publiceringsbehörigheten finns kvar.`,
  });
}

export async function setContractChannelPermissionAction(formData: FormData) {
  const companyId = getString(formData, "company_id") || null;
  const channelInput = getString(formData, "channel");
  const allowed = getString(formData, "allowed") === "true";
  const surface = actionSurface(formData);
  let channel: ContractPublicationChannel;
  try {
    channel = contractChannel(channelInput);
    const actor = await requireContractPermissionAction(
      "contracts.permissions.manage",
    );
    if (!companyId) throw new Error("Bolag saknas.");
    const scopedCompanyId = await assertUserCanOperateCompany(
      actor.userId,
      companyId,
    );
    const assignmentId = getString(formData, "assignment_id");
    if (!assignmentId) throw new Error("Avtalstilldelning saknas.");
    await setContractChannelPermission({
      companyId: scopedCompanyId,
      assignmentId,
      channel,
      allowed,
      actorUserId: actor.userId,
      reason: getString(formData, "reason") || null,
    });
    revalidateContractSurfaces(scopedCompanyId);
  } catch (error) {
    redirectBack({
      companyId,
      surface,
      error: await errorMessage(error, {
        action: "set_contract_channel_permission",
        companyId,
        metadata: {
          assignmentId: getString(formData, "assignment_id") || null,
          channel: channelInput,
          allowed,
        },
      }),
    });
  }
  redirectBack({
    companyId,
    surface,
    success: allowed
      ? `${contractChannelLabel(channel)} fick publiceringsbehörighet. Publicera kanalen som ett separat steg.`
      : `${contractChannelLabel(channel)} förlorade publiceringsbehörigheten. Kanalstatus ändrades inte.`,
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
    const { data, error } = await contractMutationServiceClient().rpc("gridex_cleanup_unused_contract_drafts", {
      p_company_id: companyId,
      p_actor_user_id: actor.userId,
      p_apply: apply,
    });
    if (error) throw error;
    const result = data as {
      ok?: boolean;
      scanned_count?: number;
      deletable_count?: number;
      deleted_count?: number;
      blocked_count?: number;
      error_count?: number;
      items?: Array<{
        action?: string;
        name?: string;
        reference?: string;
        reason_codes?: string[];
      }>;
    } | null;
    if (!result?.ok) throw new Error("Rensningsanalysen misslyckades.");
    revalidateContractSurfaces(companyId);
    const blockedExamples = (result.items ?? [])
      .filter((item) => item.action === "blocked" || item.action === "error")
      .slice(0, 3)
      .map((item) => {
        const reason = item.reference
          ? `referens ${item.reference}`
          : item.reason_codes?.join(", ") || "okänd blockerare";
        return `${item.name ?? "Namnlöst avtal"}: ${reason}`;
      })
      .join(" · ");
    success = apply
      ? `${result.deleted_count ?? 0} av ${result.deletable_count ?? 0} raderbara utkast raderades. ${result.blocked_count ?? 0} blockerades och ${result.error_count ?? 0} fick tekniska fel.${blockedExamples ? ` Exempel: ${blockedExamples}` : ""}`
      : `Dry-run klar: ${result.scanned_count ?? 0} utkast analyserades, ${result.deletable_count ?? 0} kan raderas och ${result.blocked_count ?? 0} är blockerade.${blockedExamples ? ` Exempel: ${blockedExamples}` : ""}`;
  } catch (error) {
    redirectBack({
      companyId,
      error: await errorMessage(error, {
        action: "cleanup_unused_contract_drafts",
        companyId,
      }),
    });
  }
  redirectBack({ companyId, success });
}
