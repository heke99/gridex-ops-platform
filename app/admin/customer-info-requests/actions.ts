"use server";

import type { PermissionRequirement } from "@/lib/admin/accessModel";
import { customerInfoRequestActionAccess } from "./actionAccess";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdminActionAccess } from "@/lib/admin/guards";
import { requireOperationalCompanyId } from "@/lib/tenant/scope";
import { parseManualServiceAssignmentSelection } from '@/lib/ediel/services/manualPermission';
import {
  createAuthorizationScope,
  createCustomerInfoRequest,
  createMeteringPermissionDraft,
  queueCustomerInfoRequestForDispatch,
  queueMeteringPermissionForZ13,
  applyZ14SnapshotToMeteringPermission,
  closeCustomerInfoRequest,
} from "@/lib/onboarding/infoRequests";
import { redirect } from "next/navigation";
import { isUuid } from "@/lib/validation/uuid";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullableText(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value || null;
}

function checkbox(formData: FormData, key: string): boolean {
  return formData.get(key) === "on";
}

function checkedValues(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((value) => String(value).trim())
    .filter(Boolean);
}

async function currentActor(requiredPermissions: string[] | PermissionRequirement) {
  const access = await requireAdminActionAccess(requiredPermissions);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Du måste vara inloggad.");

  const companyId = await requireOperationalCompanyId(user.id);
  if (access.userId !== user.id || access.companyId !== companyId) {
    throw new Error("Välj rätt bolag för åtgärden.");
  }
  return { userId: user.id, companyId };
}

export async function createCustomerInfoRequestAction(formData: FormData) {
  const actor = await currentActor(customerInfoRequestActionAccess.createRequest);
  const customerId = text(formData, "customer_id");

  if (!customerId) throw new Error("Välj kund innan uppgiftsbegäran skapas.");
  if (checkedValues(formData, "requested_data_categories").length === 0) {
    throw new Error("Välj minst en uppgift som ska begäras eller kontrolleras.");
  }

  const request = await createCustomerInfoRequest({
    companyId: actor.companyId,
    actorUserId: actor.userId,
    customerId,
    requestType: text(formData, "request_type") || "z01_customer_masterdata",
    targetPartyType: text(formData, "target_party_type") || "grid_owner",
    targetPartyName: nullableText(formData, "target_party_name"),
    gridOwnerId: nullableText(formData, "grid_owner_id"),
    currentSupplierName: nullableText(formData, "current_supplier_name"),
    siteId: nullableText(formData, "site_id"),
    meteringPointId: nullableText(formData, "metering_point_id"),
    requestedDataCategories: checkedValues(
      formData,
      "requested_data_categories",
    ),
    notes: nullableText(formData, "notes"),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "customer_info_request_not_created") return null;
    throw error;
  });

  revalidatePath("/admin/customer-info-requests");
  if (!request || !isUuid(request.id) || request.company_id !== actor.companyId.toLowerCase() ||
      request.customer_id !== customerId.toLowerCase()) {
    redirect("/admin/customer-info-requests?request_status=unconfirmed");
  }
  const requestId = request.id.toLowerCase();
  redirect(`/admin/customer-info-requests?request_id=${requestId}#info-request-${requestId}`);
}

export async function createAuthorizationScopeAction(formData: FormData) {
  const actor = await currentActor(customerInfoRequestActionAccess.createAuthorization);
  const customerId = text(formData, "customer_id");

  if (!customerId)
    throw new Error("Välj kund innan fullmaktens omfattning sparas.");

  await createAuthorizationScope({
    companyId: actor.companyId,
    actorUserId: actor.userId,
    customerId,
    scopeType: text(formData, "scope_type") || "customer_onboarding",
    coversGridOwnerData: checkbox(formData, "covers_grid_owner_data"),
    coversCurrentSupplierContract: checkbox(
      formData,
      "covers_current_supplier_contract",
    ),
    coversMeteringData: checkbox(formData, "covers_metering_data"),
    validFrom: nullableText(formData, "valid_from"),
    validTo: nullableText(formData, "valid_to"),
    evidenceNote: nullableText(formData, "evidence_note"),
  });

  revalidatePath("/admin/customer-info-requests");
}

export async function createMeteringPermissionDraftAction(formData: FormData) {
  const actor = await currentActor(customerInfoRequestActionAccess.createMeteringPermissionDraft);
  const customerId = text(formData, "customer_id");

  if (!customerId)
    throw new Error("Välj kund innan mätvärdestillstånd skapas.");

  const hasAuthorization = checkbox(formData, "authorization_confirmed");
  await createMeteringPermissionDraft({
    companyId: actor.companyId,
    actorUserId: actor.userId,
    customerId,
    siteId: nullableText(formData, "site_id"),
    meteringPointId: nullableText(formData, "metering_point_id"),
    gridOwnerId: nullableText(formData, "grid_owner_id"),
    requestedStartDate: nullableText(formData, "requested_start_date"),
    requestedEndDate: nullableText(formData, "requested_end_date"),
    caseReference: nullableText(formData, "case_reference"),
    lastBlocker: hasAuthorization
      ? null
      : "Fullmakt/avtal måste kontrolleras innan Z13 kan skickas.",
  });

  revalidatePath("/admin/customer-info-requests");
  revalidatePath("/admin/metering");
}

export async function queueCustomerInfoRequestAction(formData: FormData) {
  const actor = await currentActor(customerInfoRequestActionAccess.prepareRequest);
  const requestId = text(formData, "request_id");

  if (!requestId) throw new Error("Ärendet kunde inte identifieras. Ladda om sidan och försök igen.");

  await queueCustomerInfoRequestForDispatch({
    companyId: actor.companyId,
    actorUserId: actor.userId,
    requestId,
  });

  revalidatePath("/admin/customer-info-requests");
  revalidatePath("/admin/outbound");
  revalidatePath("/admin/operations");
}

export async function queueMeteringPermissionZ13Action(formData: FormData) {
  const actor = await currentActor(["metering.write", "communication.write"]);
  const permissionId = text(formData, "permission_id");

  if (!permissionId) throw new Error("Mätvärdesbehörigheten kunde inte identifieras. Ladda om sidan och försök igen.");

  await queueMeteringPermissionForZ13({
    companyId: actor.companyId,
    actorUserId: actor.userId,
    permissionId,
    ...parseManualServiceAssignmentSelection(nullableText(formData, 'service_assignment_selection')),
  });

  revalidatePath("/admin/customer-info-requests");
  revalidatePath("/admin/metering");
  revalidatePath("/admin/outbound");
}

export async function applyZ14SnapshotAction(formData: FormData) {
  const actor = await currentActor(["metering.write", "communication.send"]);
  const permissionId = text(formData, "permission_id");

  if (!permissionId) throw new Error("Mätvärdesbehörigheten kunde inte identifieras. Ladda om sidan och försök igen.");

  await applyZ14SnapshotToMeteringPermission({
    companyId: actor.companyId,
    actorUserId: actor.userId,
    permissionId,
    sourceMessageId: nullableText(formData, "source_message_id"),
  });

  revalidatePath("/admin/customer-info-requests");
  revalidatePath("/admin/metering");
}

export async function closeCustomerInfoRequestAction(formData: FormData) {
  const actor = await currentActor(customerInfoRequestActionAccess.closeRequest);
  const requestId = text(formData, "request_id");
  if (!requestId) throw new Error("Ärendet kunde inte identifieras. Ladda om sidan och försök igen.");

  let notice: string;
  try {
    const closed = await closeCustomerInfoRequest({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      requestId,
      targetStatus: text(formData, "target_status"),
      reason: text(formData, "reason"),
    });
    notice = `success=${encodeURIComponent(closed.status === "cancelled" ? "Ärendet avbröts." : "Ärendet markerades som slutfört.")}`;
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Ärendet kunde inte stängas.";
    notice = `error=${encodeURIComponent(message)}`;
  }

  revalidatePath("/admin/customer-info-requests");
  redirect(`/admin/customer-info-requests?${notice}`);
}
