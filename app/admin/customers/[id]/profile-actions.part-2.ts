// Extracted from profile-actions.ts; keep public imports on the facade module.
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requirePlatformAdminActionAccess } from "@/lib/admin/guards"

import { supabaseService } from "@/lib/supabase/service"
import { assertUserCanOperateCompany } from "@/lib/tenant/scope"
import { addCustomerContractEvent } from "@/lib/customer-contracts/db"

import { logUsageEvent } from "@/lib/audit/actionLogger"
import type { CustomerActionState } from "./customer-action-state"
import { CustomerActionError, collectManualFlowDeleteGraph, deleteByColumn, deleteByColumnSafe, deleteByCustomerId, deleteByCustomerIdSafe, deleteByIds, deleteByIdsSafe, getActorUserId, getBestEffortArchiveIds, getNullableString, getString, insertAuditLog, isDatabaseShapeError, runBestEffortCustomerArchiveStep, runCustomerCardAction, selectIds, selectIdsByCustomerId } from './profile-actions.part-1'

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

export async function collectCustomerDeleteGraph(customerId: string) {
  const { data: customer, error: customerError } = await supabaseService
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .single();

  if (customerError) throw customerError;

  const { data: siteRows, error: siteError } = await supabaseService
    .from("customer_sites")
    .select("id")
    .eq("customer_id", customerId);
  if (siteError) throw siteError;
  const siteIds = (siteRows ?? [])
    .map((row: { id: string }) => row.id)
    .filter(Boolean);

  const meteringPointIds = await selectIds(
    "metering_points",
    "site_id",
    siteIds,
  );
  const switchRequestIds = await selectIdsByCustomerId(
    "supplier_switch_requests",
    customerId,
  );
  const gridOwnerDataRequestIds = await selectIdsByCustomerId(
    "grid_owner_data_requests",
    customerId,
  );
  const partnerExportIds = await selectIdsByCustomerId(
    "partner_exports",
    customerId,
  );
  const contractIds = await selectIdsByCustomerId(
    "customer_contracts",
    customerId,
  );
  const invoiceIds = await selectIdsByCustomerId(
    "customer_invoices",
    customerId,
  );

  const outboundIdsByCustomer = await selectIdsByCustomerId(
    "outbound_requests",
    customerId,
  );
  const outboundIdsBySwitch = await selectIds(
    "outbound_requests",
    "source_id",
    switchRequestIds,
  );
  const outboundIdsByGridOwnerRequest = await selectIds(
    "outbound_requests",
    "source_id",
    gridOwnerDataRequestIds,
  );
  const outboundIdsByPartnerExport = await selectIds(
    "outbound_requests",
    "source_id",
    partnerExportIds,
  );
  const outboundRequestIds = Array.from(
    new Set([
      ...outboundIdsByCustomer,
      ...outboundIdsBySwitch,
      ...outboundIdsByGridOwnerRequest,
      ...outboundIdsByPartnerExport,
    ]),
  );

  const edielMessageOrFilters = [
    `customer_id.eq.${customerId}`,
    ...siteIds.map((id) => `site_id.eq.${id}`),
    ...meteringPointIds.map((id) => `metering_point_id.eq.${id}`),
    ...switchRequestIds.map((id) => `switch_request_id.eq.${id}`),
    ...gridOwnerDataRequestIds.map(
      (id) => `grid_owner_data_request_id.eq.${id}`,
    ),
    ...outboundRequestIds.map((id) => `outbound_request_id.eq.${id}`),
    ...partnerExportIds.map((id) => `partner_export_id.eq.${id}`),
  ];

  const { data: edielMessages, error: edielMessageError } =
    await supabaseService
      .from("ediel_messages")
      .select("id")
      .or(edielMessageOrFilters.join(","));

  if (edielMessageError) throw edielMessageError;
  const edielMessageIds = (edielMessages ?? [])
    .map((row: { id: string }) => row.id)
    .filter(Boolean);

  const edielTestRunOrFilters = [
    `customer_id.eq.${customerId}`,
    ...siteIds.map((id) => `site_id.eq.${id}`),
    ...meteringPointIds.map((id) => `metering_point_id.eq.${id}`),
  ];

  const { data: edielTestRuns, error: edielTestRunError } =
    await supabaseService
      .from("ediel_test_runs")
      .select("id")
      .or(edielTestRunOrFilters.join(","));

  if (edielTestRunError) throw edielTestRunError;
  const edielTestRunIds = (edielTestRuns ?? [])
    .map((row: { id: string }) => row.id)
    .filter(Boolean);

  const manualFlow = await collectManualFlowDeleteGraph(customerId, siteIds, meteringPointIds);

  return {
    customer,
    siteIds,
    meteringPointIds,
    switchRequestIds,
    gridOwnerDataRequestIds,
    partnerExportIds,
    outboundRequestIds,
    contractIds,
    invoiceIds,
    edielMessageIds,
    edielTestRunIds,
    ...manualFlow,
  };
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

export async function updateCustomerArchiveRow(
  customerId: string,
  companyId: string,
  actorUserId: string,
  nowIso: string,
  archiveReason: string,
): Promise<Record<string, unknown>> {
  const fullPayload = {
    status: "archived",
    archived_at: nowIso,
    archived_by: actorUserId,
    archive_reason: archiveReason,
    updated_at: nowIso,
  };

  const fullUpdate = await supabaseService
    .from("customers")
    .update(fullPayload)
    .eq("id", customerId)
    .eq("company_id", companyId)
    .select("*")
    .single();

  if (!fullUpdate.error) {
    return (fullUpdate.data ?? fullPayload) as unknown as Record<string, unknown>;
  }

  if (!isDatabaseShapeError(fullUpdate.error)) {
    throw fullUpdate.error;
  }

  console.warn(
    "[customer-archive] archive.customers.full_payload_failed; retrying minimal customer archive payload",
    fullUpdate.error,
  );

  const minimalPayload = { status: "archived" };
  const minimalUpdate = await supabaseService
    .from("customers")
    .update(minimalPayload)
    .eq("id", customerId)
    .eq("company_id", companyId)
    .select("*")
    .single();

  if (minimalUpdate.error) {
    throw minimalUpdate.error;
  }

  return (minimalUpdate.data ?? minimalPayload) as unknown as Record<string, unknown>;
}

export async function archiveCustomerAction(
  _prevState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  return runCustomerCardAction(() => archiveCustomerImpl(formData));
}

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
    .select("*")
    .eq("id", customerId)
    .single();

  if (customerError) throw customerError;

  const companyId = await assertUserCanOperateCompany(
    actorUserId,
    typeof customerBefore.company_id === "string" ? customerBefore.company_id : null,
  );

  const nowIso = new Date().toISOString();
  const archiveReason = reason ?? "Arkiverad via kundkort.";

  // The customer row itself is the only mandatory write. Older/live databases
  // can lag optional audit columns such as archived_at/archived_by/archive_reason
  // or PostgREST can keep a stale schema cache. We first write the full archive
  // audit payload and fall back to the minimal guaranteed payload (status only)
  // on schema-shape errors. The action must only fail if the customer cannot be
  // marked archived at all.
  const customerAfter = await updateCustomerArchiveRow(
    customerId,
    companyId,
    actorUserId,
    nowIso,
    archiveReason,
  );

  await runBestEffortCustomerArchiveStep("archive.customer_sites.close_failed", async () => {
    const { error } = await supabaseService
      .from("customer_sites")
      .update({
        status: "closed",
        closed_at: nowIso,
        closed_reason: archiveReason,
        updated_at: nowIso,
      })
      .eq("company_id", companyId)
      .eq("customer_id", customerId);

    if (error) throw error;
  });

  const siteIds = await getBestEffortArchiveIds("customer_sites", async () => {
    const { data, error } = await supabaseService
      .from("customer_sites")
      .select("id")
      .eq("company_id", companyId)
      .eq("customer_id", customerId);

    if (error) throw error;
    return (data ?? []).map((row: { id: string }) => row.id).filter(Boolean);
  });

  if (siteIds.length > 0) {
    await runBestEffortCustomerArchiveStep("archive.metering_points.close_failed", async () => {
      const { error } = await supabaseService
        .from("metering_points")
        .update({
          status: "closed",
          closed_at: nowIso,
          closed_reason: archiveReason,
          updated_at: nowIso,
        })
        .eq("company_id", companyId)
        .in("site_id", siteIds);

      if (error) throw error;
    });
  }

  const contractIds = await getBestEffortArchiveIds("customer_contracts", async () => {
    const { data, error } = await supabaseService
      .from("customer_contracts")
      .select("id")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .in("status", ["draft", "pending_signature", "signature_failed", "signed", "active"]);

    if (error) throw error;
    return (data ?? []).map((row: { id: string }) => row.id).filter(Boolean);
  });

  if (contractIds.length > 0) {
    await runBestEffortCustomerArchiveStep("archive.contracts.cancel_failed", async () => {
      for (const contractId of contractIds) {
        await addCustomerContractEvent({
          companyId,
          customerContractId: contractId,
          customerId,
          eventType: "cancelled",
          happenedAt: nowIso,
          note: "Avtalet avslutades när kunden arkiverades.",
          metadata: {
            ends_at: nowIso.slice(0, 10),
            termination_reason: "other",
            rejected_reason: archiveReason,
          },
          actorUserId,
        });
      }
    });
  }

  const switchIds = await getBestEffortArchiveIds("supplier_switch_requests", async () => {
    const { data, error } = await supabaseService
      .from("supplier_switch_requests")
      .select("id")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .in("status", [
        "draft",
        "queued",
        "submitted",
        "accepted",
        "cancellation_requested",
        "cancellation_sent",
        "manual_followup_required",
      ]);

    if (error) throw error;
    return (data ?? []).map((row: { id: string }) => row.id).filter(Boolean);
  });

  if (switchIds.length > 0) {
    await runBestEffortCustomerArchiveStep("archive.switch_requests.fail_failed", async () => {
      const { error } = await supabaseService
        .from("supplier_switch_requests")
        .update({
          status: "failed",
          failed_at: nowIso,
          failure_reason: archiveReason,
          updated_at: nowIso,
        })
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .in("id", switchIds);

      if (error) throw error;
    });

    await runBestEffortCustomerArchiveStep("archive.usage_event_failed", async () => {
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
    });
  }

  await runBestEffortCustomerArchiveStep("archive.audit_log_failed", async () => {
    await insertAuditLog({
      actorUserId,
      entityType: "customer",
      entityId: customerId,
      action: "customer.archived",
      label: "Arkiverade kund",
      companyId,
      oldValues: customerBefore,
      newValues: customerAfter,
      metadata: {
        reason: archiveReason,
        retainedData: true,
        hardDelete: false,
        cascadedToSitesAndMeteringPoints: true,
      },
    });
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/platform/data-cleanup");

  return {
    status: "success",
    message: "Kunden har arkiverats. Historiken sparas för spårbarhet.",
  };
}

export const PROTECTED_DELETE_MESSAGE =
  "Kunden kunde inte raderas. Kunden har historik och ska arkiveras i stället.";

export function describeProtectedDeleteData(
  graph: Awaited<ReturnType<typeof collectCustomerDeleteGraph>>,
): string | null {
  const hasProtected =
    graph.contractIds.length > 0 ||
    graph.invoiceIds.length > 0 ||
    graph.switchRequestIds.length > 0 ||
    graph.edielMessageIds.length > 0 ||
    graph.partnerExportIds.length > 0 ||
    graph.gridOwnerInformationRequestIds.length > 0 ||
    graph.manualEmailOutboxIds.length > 0 ||
    graph.manualInboundMessageIds.length > 0 ||
    graph.powerOfAttorneyEventIds.length > 0 ||
    graph.powerOfAttorneyIds.length > 0 ||
    graph.customerDocumentIds.length > 0 ||
    graph.customerOperationEventIds.length > 0 ||
    graph.customerBlockerIds.length > 0 ||
    graph.communicationLogIds.length > 0 ||
    graph.communicationLogEventIds.length > 0 ||
    graph.poaDocumentCount > 0;

  return hasProtected ? PROTECTED_DELETE_MESSAGE : null;
}

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

  const graph = await collectCustomerDeleteGraph(customerId);
  const companyId =
    typeof graph.customer.company_id === "string"
      ? graph.customer.company_id
      : null;

  if (graph.customer.is_test_data !== true && String(graph.customer.source ?? "").toLowerCase().includes("test") === false) {
    throw new CustomerActionError(
      "not_test_data",
      "Permanent radering är endast tillåten för markerad testdata. Arkivera verkliga kunder i stället.",
    );
  }

  const protectedReason = describeProtectedDeleteData(graph);
  if (protectedReason) {
    throw new CustomerActionError("protected_history", protectedReason);
  }

  const storageSummary = await deleteStorageObjectsForCustomer(customerId);

  await insertAuditLog({
    actorUserId,
    entityType: "customer",
    entityId: customerId,
    action: "customer.deleted_test",
    label: "Raderade testkund säkert",
    companyId,
    oldValues: graph.customer,
    billable: true,
    metadata: {
      companyId,
      warning: "Safe test-customer delete requested from customer card before deletion.",
      deleteGraph: {
        sites: graph.siteIds.length,
        meteringPoints: graph.meteringPointIds.length,
        switchRequests: graph.switchRequestIds.length,
        gridOwnerDataRequests: graph.gridOwnerDataRequestIds.length,
        partnerExports: graph.partnerExportIds.length,
        outboundRequests: graph.outboundRequestIds.length,
        customerContracts: graph.contractIds.length,
        customerInvoices: graph.invoiceIds.length,
        edielMessages: graph.edielMessageIds.length,
        edielTestRuns: graph.edielTestRunIds.length,
        gridOwnerInformationRequests: graph.gridOwnerInformationRequestIds.length,
        manualEmailOutbox: graph.manualEmailOutboxIds.length,
        manualInboundMessages: graph.manualInboundMessageIds.length,
        powerOfAttorneys: graph.powerOfAttorneyIds.length,
        powerOfAttorneyEvents: graph.powerOfAttorneyEventIds.length,
        customerDocuments: graph.customerDocumentIds.length,
        customerOperationEvents: graph.customerOperationEventIds.length,
        customerBlockers: graph.customerBlockerIds.length,
        communicationLogs: graph.communicationLogIds.length,
        communicationLogEvents: graph.communicationLogEventIds.length,
      },
      storageSummary,
    },
  });

  await deleteByColumn(
    "ediel_test_run_messages",
    "ediel_message_id",
    graph.edielMessageIds,
  );
  await deleteByColumn(
    "ediel_test_run_messages",
    "test_run_id",
    graph.edielTestRunIds,
  );
  await deleteByIds("ediel_test_runs", graph.edielTestRunIds);
  await deleteByColumn(
    "ediel_message_events",
    "ediel_message_id",
    graph.edielMessageIds,
  );
  await deleteByIds("ediel_messages", graph.edielMessageIds);

  await deleteByColumn(
    "outbound_dispatch_events",
    "outbound_request_id",
    graph.outboundRequestIds,
  );
  await deleteByColumn(
    "supplier_switch_events",
    "switch_request_id",
    graph.switchRequestIds,
  );
  await deleteByColumn(
    "customer_contract_events",
    "customer_contract_id",
    graph.contractIds,
  );
  await deleteByCustomerId("customer_contract_events", customerId);
  await deleteByColumn(
    "customer_invoice_lines",
    "invoice_id",
    graph.invoiceIds,
  );
  await deleteByColumn(
    "customer_invoice_documents",
    "invoice_id",
    graph.invoiceIds,
  );

  await deleteByCustomerId("customer_portal_events", customerId);
  await deleteByCustomerId("metering_values", customerId);
  await deleteByCustomerId("billing_underlays", customerId);
  await deleteByCustomerId("partner_exports", customerId);
  await deleteByCustomerId("grid_owner_data_requests", customerId);
  await deleteByIds("outbound_requests", graph.outboundRequestIds);
  await deleteByCustomerId("outbound_requests", customerId);
  await deleteByCustomerId("supplier_switch_requests", customerId);

  // Manual grid-owner / POA flow tables (FK-safe order, tolerant of missing
  // schema). These also block hard delete above unless the row is genuine
  // test-only data that survived the protected-history check.
  await deleteByIdsSafe(
    "communication_log_events",
    graph.communicationLogEventIds,
  );
  await deleteByIdsSafe(
    "communication_logs",
    graph.communicationLogIds,
  );
  await deleteByColumnSafe(
    "manual_email_outbox",
    "request_id",
    graph.gridOwnerInformationRequestIds,
  );
  await deleteByColumnSafe(
    "manual_inbound_messages",
    "request_id",
    graph.gridOwnerInformationRequestIds,
  );
  await deleteByIdsSafe(
    "grid_owner_information_requests",
    graph.gridOwnerInformationRequestIds,
  );
  await deleteByColumnSafe(
    "power_of_attorney_events",
    "power_of_attorney_id",
    graph.powerOfAttorneyIds,
  );
  await deleteByCustomerIdSafe("customer_documents", customerId);
  await deleteByCustomerIdSafe("customer_operation_events", customerId);
  await deleteByCustomerIdSafe("customer_blockers", customerId);

  await deleteByCustomerId("customer_authorization_documents", customerId);
  await deleteByCustomerId("powers_of_attorney", customerId);
  await deleteByCustomerId("customer_operation_tasks", customerId);
  await deleteByCustomerId("customer_internal_notes", customerId);
  await deleteByCustomerId("customer_portal_claims", customerId);
  await deleteByCustomerId("customer_portal_accounts", customerId);
  await deleteByCustomerId("customer_invoices", customerId);
  await deleteByCustomerId("customer_contracts", customerId);
  await deleteByCustomerId("customer_addresses", customerId);
  await deleteByCustomerId("customer_contacts", customerId);

  await deleteByIds("metering_points", graph.meteringPointIds);
  await deleteByIds("customer_sites", graph.siteIds);

  const { error: deleteCustomerError } = await supabaseService
    .from("customers")
    .delete()
    .eq("id", customerId);

  if (deleteCustomerError) throw deleteCustomerError;

  revalidatePath("/admin/customers");
  revalidatePath("/admin/customers/segments");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/outbound");
  revalidatePath("/admin/platform/data-cleanup");

  const returnTo = getNullableString(formData, "return_to");
  redirect(returnTo?.startsWith("/admin/") ? returnTo : "/admin/customers");
}
