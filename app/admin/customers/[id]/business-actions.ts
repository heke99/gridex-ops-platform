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
import {
  finalizeStuckZ01GridOwnerDataRequest,
  dryRunZ01Finalizer,
  insertZ01RepairTerminalEvent,
} from "@/lib/customer-operations/z01Finalizer";
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

function safeActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [record.code, record.message, record.details, record.hint]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());
    if (parts.length > 0) return parts.join(" · ").slice(0, 600);
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Okänt tekniskt fel.";
}

async function findLatestZ01OutboundForRepair(params: {
  gridOwnerDataRequestId: string | null;
  customerInfoRequestGridOwnerDataRequestId?: string | null;
}): Promise<{
  id: string;
  ediel_route_profile_id: string | null;
  route_decision_payload: Record<string, unknown> | null;
} | null> {
  const sourceId =
    params.gridOwnerDataRequestId ??
    params.customerInfoRequestGridOwnerDataRequestId ??
    null;
  if (!sourceId) return null;

  const { data, error } = await supabaseService
    .from("outbound_requests")
    .select("id, ediel_route_profile_id, route_decision_payload")
    .eq("source_type", "grid_owner_data_request")
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return (data as {
    id: string;
    ediel_route_profile_id: string | null;
    route_decision_payload: Record<string, unknown> | null;
  } | null) ?? null;
}

async function writeSafeZ01RepairFailedEventFromAction(params: {
  companyId: string;
  actorUserId: string;
  customerInfoRequestId: string | null;
  customerId: string | null;
  gridOwnerDataRequestId: string | null;
  environment: string | null;
  error: unknown;
}) {
  if (!params.customerInfoRequestId) return;

  const { data: cir } = await supabaseService
    .from("customer_info_requests")
    .select("id, company_id, customer_id, grid_owner_data_request_id")
    .eq("id", params.customerInfoRequestId)
    .maybeSingle();

  const resolvedCustomerId =
    params.customerId ??
    ((cir as { customer_id?: string | null } | null)?.customer_id ?? null);
  if (!resolvedCustomerId) return;

  const outbound = await findLatestZ01OutboundForRepair({
    gridOwnerDataRequestId: params.gridOwnerDataRequestId,
    customerInfoRequestGridOwnerDataRequestId:
      (cir as { grid_owner_data_request_id?: string | null } | null)
        ?.grid_owner_data_request_id ?? null,
  });
  const routeDecisionPayload =
    outbound?.route_decision_payload && typeof outbound.route_decision_payload === "object"
      ? outbound.route_decision_payload
      : null;
  const environment =
    params.environment ??
    (typeof routeDecisionPayload?.environment === "string"
      ? routeDecisionPayload.environment
      : null);

  await insertZ01RepairTerminalEvent({
    companyId: params.companyId,
    customerInfoRequestId: params.customerInfoRequestId,
    customerId: resolvedCustomerId,
    actorUserId: params.actorUserId,
    outcome: "failed",
    blockerCode: "technical_error",
    blockerReason:
      "Z01-reparationen stoppades av ett tekniskt fel innan status kunde sparas säkert.",
    outboundRequestId: outbound?.id ?? null,
    edielRouteProfileId: outbound?.ediel_route_profile_id ?? null,
    edielMessageId: null,
    environment,
    nextRequiredAction: `Granska Vercel-loggen för reparationsåtgärden och kör om när felet är åtgärdat. Teknisk orsak: ${safeActionErrorMessage(params.error)}`,
  });
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

  try {
    await finalizeStuckZ01GridOwnerDataRequest({
      companyId,
      actorUserId: guard.userId,
      gridOwnerDataRequestId,
      customerInfoRequestId,
      environment,
      dryRun: false,
    });
  } catch (error) {
    console.error("[z01 repair] real repair failed", {
      companyId,
      customerId,
      customerInfoRequestId,
      gridOwnerDataRequestId,
      environment,
      message: safeActionErrorMessage(error),
    });

    try {
      await writeSafeZ01RepairFailedEventFromAction({
        companyId,
        actorUserId: guard.userId,
        customerInfoRequestId,
        customerId,
        gridOwnerDataRequestId,
        environment,
        error,
      });
    } catch (eventError) {
      console.error("[z01 repair] failed to write terminal failure event", {
        companyId,
        customerId,
        customerInfoRequestId,
        gridOwnerDataRequestId,
        message: safeActionErrorMessage(eventError),
      });
    }
  }

  // Revalidate all affected views. Do not throw from this action for controlled
  // or failed repairs; the customer card must render the terminal event/status.
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
