"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdminActionAccess } from "@/lib/admin/guards";
import { requireOperationalCompanyId } from "@/lib/tenant/scope";
import {
  createAuthorizationScope,
  createCustomerInfoRequest,
  createMeteringPermissionDraft,
  queueCustomerInfoRequestForDispatch,
  queueMeteringPermissionForZ13,
  applyZ14SnapshotToMeteringPermission,
} from "@/lib/onboarding/infoRequests";

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

async function currentActor() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Du måste vara inloggad.");

  return {
    userId: user.id,
    companyId: await requireOperationalCompanyId(user.id),
  };
}

export async function createCustomerInfoRequestAction(formData: FormData) {
  await requireAdminActionAccess(["customers.write"]);
  const actor = await currentActor();
  const customerId = text(formData, "customer_id");

  if (!customerId) throw new Error("Välj kund innan uppgiftsbegäran skapas.");

  await createCustomerInfoRequest({
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
  });

  revalidatePath("/admin/customer-info-requests");
}

export async function createAuthorizationScopeAction(formData: FormData) {
  await requireAdminActionAccess(["poa.write", "customers.write"]);
  const actor = await currentActor();
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
  await requireAdminActionAccess(["metering.write", "customers.write"]);
  const actor = await currentActor();
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
  await requireAdminActionAccess(["customers.write", "communication.send"]);
  const actor = await currentActor();
  const requestId = text(formData, "request_id");

  if (!requestId) throw new Error("request_id saknas.");

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
  await requireAdminActionAccess(["metering.write", "communication.send"]);
  const actor = await currentActor();
  const permissionId = text(formData, "permission_id");

  if (!permissionId) throw new Error("permission_id saknas.");

  await queueMeteringPermissionForZ13({
    companyId: actor.companyId,
    actorUserId: actor.userId,
    permissionId,
  });

  revalidatePath("/admin/customer-info-requests");
  revalidatePath("/admin/metering");
  revalidatePath("/admin/outbound");
}

export async function applyZ14SnapshotAction(formData: FormData) {
  await requireAdminActionAccess(["metering.write", "communication.send"]);
  const actor = await currentActor();
  const permissionId = text(formData, "permission_id");

  if (!permissionId) throw new Error("permission_id saknas.");

  await applyZ14SnapshotToMeteringPermission({
    companyId: actor.companyId,
    actorUserId: actor.userId,
    permissionId,
    permissionReference: nullableText(formData, "permission_reference"),
    approvedStartDate: nullableText(formData, "approved_start_date"),
    approvedEndDate: nullableText(formData, "approved_end_date"),
    resolutionCode: nullableText(formData, "resolution_code"),
    reportFrequency: nullableText(formData, "report_frequency"),
    approvedSites: [
      {
        siteId: nullableText(formData, "site_id"),
        meteringPointId: nullableText(formData, "metering_point_id"),
        facilityId: nullableText(formData, "facility_id"),
        gridAreaCode: nullableText(formData, "grid_area_code"),
        status: text(formData, "site_status") || "approved",
      },
    ],
  });

  revalidatePath("/admin/customer-info-requests");
  revalidatePath("/admin/metering");
}
