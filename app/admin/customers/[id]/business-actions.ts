"use server";

import { revalidatePath } from "next/cache";
import { requireAdminActionAccess, requirePlatformAdminAccess } from "@/lib/admin/guards";
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions";
import { endAgreement } from "@/lib/operations/businessActions/endAgreement";
import { registerCancellation } from "@/lib/operations/businessActions/registerCancellation";
import { requestHistoricalMeteringAccess } from "@/lib/operations/businessActions/requestHistoricalMeteringAccess";
import { requestMeteringAccess } from "@/lib/operations/businessActions/requestMeteringAccess";
import { sendCustomerConfirmation } from "@/lib/operations/businessActions/sendCustomerConfirmation";
import { terminateMeteringAccess } from "@/lib/operations/businessActions/terminateMeteringAccess";
import { finalizeStuckZ01GridOwnerDataRequest, dryRunZ01Finalizer } from "@/lib/customer-operations/z01Finalizer";
import { supabaseService } from "@/lib/supabase/service";
import type { EdielEnvironment } from "@/lib/ediel/types";

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredFormValue(formData: FormData, key: string, label: string): string {
  const value = formValue(formData, key);
  if (!value) throw new Error(`${label} saknas.`);
  return value;
}

function commonBusinessActionInput(formData: FormData, actorUserId: string) {
  return {
    actorUserId,
    customerId: requiredFormValue(formData, "customer_id", "Kund"),
    switchRequestId: requiredFormValue(formData, "switch_request_id", "Affärsärende"),
    siteId: formValue(formData, "site_id"),
    meteringPointId: formValue(formData, "metering_point_id"),
    idempotencyKey: formValue(formData, "idempotency_key"),
  };
}

function revalidateCustomerBusinessPaths(customerId: string) {
  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/work-queue");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/outbound");
  revalidatePath("/admin/ediel");
}

export async function registerCancellationBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const input = commonBusinessActionInput(formData, guard.userId);

  await registerCancellation({
    ...input,
    reason: formValue(formData, "reason"),
  });

  revalidateCustomerBusinessPaths(input.customerId);
}

export async function endAgreementBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const input = commonBusinessActionInput(formData, guard.userId);

  await endAgreement(input);

  revalidateCustomerBusinessPaths(input.customerId);
}

export async function requestMeteringAccessBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const input = commonBusinessActionInput(formData, guard.userId);

  await requestMeteringAccess(input);

  revalidateCustomerBusinessPaths(input.customerId);
}

export async function requestHistoricalMeteringAccessBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const input = commonBusinessActionInput(formData, guard.userId);

  await requestHistoricalMeteringAccess({
    ...input,
    startDate: requiredFormValue(formData, "requested_period_start", "Startdatum"),
    endDate: requiredFormValue(formData, "requested_period_end", "Slutdatum"),
  });

  revalidateCustomerBusinessPaths(input.customerId);
}

export async function terminateMeteringAccessBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const input = commonBusinessActionInput(formData, guard.userId);

  await terminateMeteringAccess(input);

  revalidateCustomerBusinessPaths(input.customerId);
}

export async function sendCustomerConfirmationBusinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const customerId = formValue(formData, "customer_id");
  const event = formValue(formData, "event") ?? "switch.started";

  if (!customerId) throw new Error("Kund saknas.");

  await sendCustomerConfirmation({
    actorUserId: guard.userId,
    customerId,
    event,
    templateId: formValue(formData, "template_id"),
    idempotencyKey: formValue(formData, "idempotency_key"),
  });

  revalidateCustomerBusinessPaths(customerId);
}

/**
 * Platform-admin-only: finalize a stuck PRODAT Z01 grid_owner_data_request
 * that has no linked outbound_request or ediel_message.
 *
 * Validates tenant/company ownership before calling the TypeScript finalizer.
 * Does NOT send SMTP directly — delegates to the normal guarded send path.
 */
export async function repairZ01CustomerInfoRequestAction(
  formData: FormData,
): Promise<void> {
  const guard = await requirePlatformAdminAccess();

  const companyId = requiredFormValue(formData, "company_id", "Bolag");
  const gridOwnerDataRequestId = formValue(formData, "grid_owner_data_request_id");
  const customerInfoRequestId = formValue(formData, "customer_info_request_id");
  const customerId = formValue(formData, "customer_id");
  const environment = (formValue(formData, "environment") ?? "production") as EdielEnvironment;

  if (!gridOwnerDataRequestId && !customerInfoRequestId) {
    throw new Error("Ange grid_owner_data_request_id eller customer_info_request_id.");
  }

  // Server-side ownership verification: confirm the GODR belongs to this company
  if (gridOwnerDataRequestId) {
    const { data: godr, error: godrError } = await supabaseService
      .from("grid_owner_data_requests")
      .select("id, company_id, customer_id")
      .eq("id", gridOwnerDataRequestId)
      .maybeSingle();

    if (godrError || !godr) {
      throw new Error("Uppgiftsbegäran hittades inte.");
    }

    if (godr.company_id !== companyId) {
      throw new Error("Uppgiftsbegäran tillhör inte angivet bolag.");
    }

    if (customerId && godr.customer_id !== customerId) {
      throw new Error("Uppgiftsbegäran tillhör inte angiven kund.");
    }
  }

  if (customerInfoRequestId) {
    const { data: cir, error: cirError } = await supabaseService
      .from("customer_info_requests")
      .select("id, company_id")
      .eq("id", customerInfoRequestId)
      .maybeSingle();

    if (cirError || !cir) {
      throw new Error("Kundinformationsbegäran hittades inte.");
    }

    if (cir.company_id !== companyId) {
      throw new Error("Kundinformationsbegäran tillhör inte angivet bolag.");
    }
  }

  await finalizeStuckZ01GridOwnerDataRequest({
    companyId,
    actorUserId: guard.userId,
    gridOwnerDataRequestId,
    customerInfoRequestId,
    environment,
    dryRun: false,
  });

  // Revalidate all affected views
  if (customerId) {
    revalidatePath(`/admin/customers/${customerId}`);
  }
  revalidatePath("/admin/messages");
  revalidatePath("/admin/outbound");
  revalidatePath("/admin/customer-info-requests");
  revalidatePath("/admin/work-queue");
  revalidatePath("/admin/operations");
}

/**
 * Platform-admin-only: dry-run of the Z01 repair — simulates what would happen
 * without creating any rows or sending any SMTP.
 *
 * Result is written to customer_info_request_events so the platform admin
 * can inspect it in the customer operation timeline after the page revalidates.
 */
export async function dryRunZ01RepairAction(
  formData: FormData,
): Promise<void> {
  const guard = await requirePlatformAdminAccess();

  const companyId = requiredFormValue(formData, "company_id", "Bolag");
  const gridOwnerDataRequestId = formValue(formData, "grid_owner_data_request_id");
  const customerInfoRequestId = formValue(formData, "customer_info_request_id");
  const customerId = formValue(formData, "customer_id");
  const environment = (formValue(formData, "environment") ?? "production") as EdielEnvironment;

  if (!gridOwnerDataRequestId && !customerInfoRequestId) {
    throw new Error("Ange grid_owner_data_request_id eller customer_info_request_id.");
  }

  // Server-side ownership verification. We also derive the customer_id from the
  // verified row instead of trusting the form payload, since
  // customer_info_request_events.customer_id is NOT NULL.
  let resolvedCustomerId: string | null = customerId;

  if (gridOwnerDataRequestId) {
    const { data: godr, error: godrError } = await supabaseService
      .from("grid_owner_data_requests")
      .select("id, company_id, customer_id")
      .eq("id", gridOwnerDataRequestId)
      .maybeSingle();

    if (godrError || !godr) throw new Error("Uppgiftsbegäran hittades inte.");
    if (godr.company_id !== companyId) throw new Error("Uppgiftsbegäran tillhör inte angivet bolag.");
    resolvedCustomerId = resolvedCustomerId ?? (godr.customer_id as string | null) ?? null;
  }

  if (customerInfoRequestId) {
    const { data: cir, error: cirError } = await supabaseService
      .from("customer_info_requests")
      .select("id, company_id, customer_id")
      .eq("id", customerInfoRequestId)
      .maybeSingle();

    if (cirError || !cir) throw new Error("Kundinformationsbegäran hittades inte.");
    if (cir.company_id !== companyId) throw new Error("Kundinformationsbegäran tillhör inte angivet bolag.");
    resolvedCustomerId = resolvedCustomerId ?? (cir.customer_id as string | null) ?? null;
  }

  const result = await dryRunZ01Finalizer({
    companyId,
    actorUserId: guard.userId,
    gridOwnerDataRequestId,
    customerInfoRequestId,
    environment,
    dryRun: true,
  });

  // Record the dry-run result as an audit event so the admin can inspect it
  // in the customer operation timeline without raw SQL errors being shown.
  // customer_info_request_events requires customer_id (NOT NULL) and uses the
  // columns payload/created_by — matching addCustomerInfoRequestEvent and the
  // finalizer audit insert in z01Finalizer.ts.
  if (customerInfoRequestId && resolvedCustomerId) {
    const summary = [
      `wouldCreateOutbound: ${result.wouldCreateOutbound}`,
      `wouldPrepareEdielMessage: ${result.wouldPrepareEdielMessage}`,
      `wouldClearBlocker: ${result.wouldClearBlocker}`,
      ...(result.warnings.length > 0 ? result.warnings.map((w) => `warning: ${w.code} — ${w.message}`) : []),
    ].join(' | ');

    const { error: auditError } = await supabaseService
      .from("customer_info_request_events")
      .insert({
        customer_info_request_id: customerInfoRequestId,
        company_id: companyId,
        customer_id: resolvedCustomerId,
        event_type: "z01_dry_run_repair",
        message: `Torrkörning av Z01-reparation: ${summary}`,
        payload: {
          dryRun: true,
          wouldCreateOutbound: result.wouldCreateOutbound,
          wouldPrepareEdielMessage: result.wouldPrepareEdielMessage,
          wouldClearBlocker: result.wouldClearBlocker,
          warnings: result.warnings,
          environment,
        },
        created_by: guard.userId,
      });

    if (
      auditError &&
      !["42703", "PGRST204", "PGRST205"].includes(String((auditError as { code?: string }).code ?? ""))
    ) {
      throw new Error(`Kunde inte spara torrkörningens revisionshändelse: ${auditError.message}`);
    }
  }

  // Revalidate so the admin sees the new audit event
  if (customerId) {
    revalidatePath(`/admin/customers/${customerId}`);
  }
  revalidatePath("/admin/messages");
  revalidatePath("/admin/customer-info-requests");
}
