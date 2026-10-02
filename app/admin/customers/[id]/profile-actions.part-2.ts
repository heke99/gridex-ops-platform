// Extracted from profile-actions.ts; keep public imports on the facade module.
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requirePlatformAdminActionAccess } from "@/lib/admin/guards"

import { supabaseService } from "@/lib/supabase/service"
import { assertUserCanOperateCompany } from "@/lib/tenant/scope"

import { logUsageEvent } from "@/lib/audit/actionLogger"
import type { CustomerActionState } from "./customer-action-state"
import { CustomerActionError, getActorUserId, getNullableString, getString, insertAuditLog, runCustomerCardAction } from './profile-actions.part-1'

export async function deleteStorageObjectsForCustomer(
  customerId: string,
): Promise<{ deleted: number; failed: number }> {
  const { data: documents, error } = await supabaseService
    .from("customer_authorization_documents")
    .select("storage_bucket,file_path")
    .eq("customer_id", customerId);

  if (error) throw error;

  const byBucket = new Map<string, string[]>();

  for (const documentRow of documents ?? []) {
    const bucket =
      typeof documentRow.storage_bucket === "string"
        ? documentRow.storage_bucket.trim()
        : "";
    const filePath =
      typeof documentRow.file_path === "string"
        ? documentRow.file_path.trim()
        : "";
    if (!bucket || !filePath) continue;
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), filePath]);
  }

  let deleted = 0;
  let failed = 0;

  for (const [bucket, paths] of byBucket.entries()) {
    const uniquePaths = Array.from(new Set(paths));
    if (uniquePaths.length === 0) continue;

    const { data: removedRows, error: removeError } =
      await supabaseService.storage.from(bucket).remove(uniquePaths);

    if (removeError) {
      failed += uniquePaths.length;
      continue;
    }

    deleted += removedRows?.length ?? uniquePaths.length;
  }

  return { deleted, failed };
}

export async function markCustomerAsTestDataAction(
  _prevState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  return runCustomerCardAction(() => markCustomerAsTestDataImpl(formData));
}

export async function markCustomerAsTestDataImpl(
  formData: FormData,
): Promise<CustomerActionState> {
  const actorUserId = await getActorUserId();
  const customerId = getString(formData, "customer_id");
  const reason = getNullableString(formData, "reason") ?? "Markerad som testdata från kundkortet.";

  if (!customerId) {
    throw new CustomerActionError("missing_customer", "Kund-id saknas.");
  }

  const { data: customerBefore, error: customerError } = await supabaseService
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .single();

  if (customerError) throw customerError;

  const companyId = await assertUserCanOperateCompany(
    actorUserId,
    typeof customerBefore.company_id === "string" ? customerBefore.company_id : null,
  );

  const nowIso = new Date().toISOString();
  const { data: customerAfter, error: updateError } = await supabaseService
    .from("customers")
    .update({
      is_test_data: true,
      data_retention_note: reason,
      updated_at: nowIso,
    })
    .eq("id", customerId)
    .eq("company_id", companyId)
    .select("*")
    .single();

  if (updateError) throw updateError;

  const { error: sitesError } = await supabaseService
    .from("customer_sites")
    .update({ is_test_data: true, updated_by: actorUserId })
    .eq("company_id", companyId)
    .eq("customer_id", customerId);

  if (sitesError) throw sitesError;

  const { data: siteRows, error: siteLookupError } = await supabaseService
    .from("customer_sites")
    .select("id")
    .eq("company_id", companyId)
    .eq("customer_id", customerId);

  if (siteLookupError) throw siteLookupError;
  const siteIds = (siteRows ?? []).map((row: { id: string }) => row.id).filter(Boolean);

  if (siteIds.length > 0) {
    const { error: pointsError } = await supabaseService
      .from("metering_points")
      .update({ is_test_data: true, updated_by: actorUserId })
      .eq("company_id", companyId)
      .in("site_id", siteIds);

    if (pointsError) throw pointsError;
  }

  await insertAuditLog({
    actorUserId,
    entityType: "customer",
    entityId: customerId,
    action: "customer.marked_as_test_data",
    label: "Markerade kund som testdata",
    companyId,
    oldValues: customerBefore,
    newValues: customerAfter,
    metadata: { reason, cascadedToSitesAndMeteringPoints: true },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/platform/data-cleanup");

  return { status: "success", message: "Kunden har markerats som testdata." };
}

export async function archiveCustomerAction(
  _prevState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  return runCustomerCardAction(() => archiveCustomerImpl(formData));
}

type ArchiveCustomerRpcResult = {
  already_archived?: boolean;
  failed_switch_request_ids?: string[];
};

export async function archiveCustomerImpl(
  formData: FormData,
): Promise<CustomerActionState> {
  const actorUserId = await getActorUserId();
  const customerId = getString(formData, "customer_id");
  const reason = getNullableString(formData, "archive_reason");
  const confirmText = getString(formData, "confirm_archive");

  if (!customerId) {
    throw new CustomerActionError("missing_customer", "Kund-id saknas.");
  }
  if (confirmText !== "ARKIVERA") {
    throw new CustomerActionError(
      "confirm_mismatch",
      "Skriv ARKIVERA för att bekräfta arkivering.",
    );
  }

  const { data: customerBefore, error: customerError } = await supabaseService
    .from("customers")
    .select("company_id")
    .eq("id", customerId)
    .single();

  if (customerError) throw customerError;

  const companyId = await assertUserCanOperateCompany(
    actorUserId,
    typeof customerBefore.company_id === "string" ? customerBefore.company_id : null,
  );

  const archiveReason = reason ?? "Arkiverad via kundkort.";

  // Customer, sites, metering points, contracts, switch requests and the
  // audit row are written in one transaction; any failure rolls back all.
  const { data, error } = await supabaseService.rpc("gridex_archive_customer_v1", {
    p_company_id: companyId,
    p_customer_id: customerId,
    p_actor_user_id: actorUserId,
    p_reason: archiveReason,
  });

  if (error) throw error;

  const result = (data ?? {}) as ArchiveCustomerRpcResult;
  const switchIds = result.failed_switch_request_ids ?? [];

  if (!result.already_archived && switchIds.length > 0) {
    await logUsageEvent({
      companyId,
      actorUserId,
      customerId,
      entityType: "supplier_switch_request",
      entityId: customerId,
      eventKey: "switch.cancelled",
      actionLabel: "Leverantörsbyte stoppat vid arkivering",
      source: "customer_archive",
      billable: true,
      billableQuantity: switchIds.length,
      billingUnit: "switch_request",
      metadata: { reason: archiveReason, switchIds },
    });
  }

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/platform/data-cleanup");

  return {
    status: "success",
    message: result.already_archived
      ? "Kunden var redan arkiverad."
      : "Kunden har arkiverats. Historiken sparas för spårbarhet.",
  };
}

export const PROTECTED_DELETE_MESSAGE =
  "Kunden kunde inte raderas. Kunden har historik och ska arkiveras i stället.";


export async function deleteCustomerForRecreateAction(
  _prevState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  return runCustomerCardAction(() => deleteCustomerForRecreateImpl(formData));
}

export async function deleteCustomerForRecreateImpl(
  formData: FormData,
): Promise<CustomerActionState> {
  const platformGuard = await requirePlatformAdminActionAccess();
  const actorUserId = platformGuard.userId;
  const customerId = getString(formData, "customer_id");
  const confirmText = getString(formData, "confirm_delete");

  if (!customerId) {
    throw new CustomerActionError("missing_customer", "Kund-id saknas.");
  }
  if (confirmText !== "RADERA") {
    throw new CustomerActionError(
      "confirm_mismatch",
      "Skriv RADERA för att bekräfta permanent radering av kunden.",
    );
  }

  const { data: customerRow, error: customerError } = await supabaseService
    .from("customers")
    .select("company_id")
    .eq("id", customerId)
    .single();
  if (customerError) throw customerError;
  const companyId =
    typeof customerRow.company_id === "string" ? customerRow.company_id : null;
  if (!companyId) {
    throw new CustomerActionError("missing_company", "Kunden saknar bolagskoppling.");
  }

  // Test-data rule, protected-history rule and the whole delete run in one
  // transaction. Storage is only cleaned after the database delete committed.
  const { error: deleteError } = await supabaseService.rpc("gridex_delete_test_customer_v1", {
    p_company_id: companyId,
    p_customer_id: customerId,
    p_actor_user_id: actorUserId,
  });

  if (deleteError) {
    if (deleteError.message === "customer_delete_requires_test_data") {
      throw new CustomerActionError(
        "not_test_data",
        "Permanent radering är endast tillåten för markerad testdata. Arkivera verkliga kunder i stället.",
      );
    }
    if (deleteError.message === "customer_delete_protected_history") {
      throw new CustomerActionError("protected_history", PROTECTED_DELETE_MESSAGE);
    }
    throw deleteError;
  }

  await deleteStorageObjectsForCustomer(customerId);

  revalidatePath("/admin/customers");
  revalidatePath("/admin/customers/segments");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/outbound");
  revalidatePath("/admin/platform/data-cleanup");

  const returnTo = getNullableString(formData, "return_to");
  redirect(returnTo?.startsWith("/admin/") ? returnTo : "/admin/customers");
}
