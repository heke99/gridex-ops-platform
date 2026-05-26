"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  requireAdminActionAccess,
  requirePlatformAdminActionAccess,
} from "@/lib/admin/guards";
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions";
import { supabaseService } from "@/lib/supabase/service";
import { assertUserCanOperateCompany } from "@/lib/tenant/scope";
import { addCustomerContractEvent } from "@/lib/customer-contracts/db";

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function getNullableString(formData: FormData, key: string): string | null {
  const value = getString(formData, key);
  return value || null;
}

function normalizeCustomerType(
  value: string | null | undefined,
): "private" | "business" | "association" {
  if (value === "business") return "business";
  if (value === "association") return "association";
  return "private";
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function requireValue(value: string | null | undefined, message: string) {
  if (!normalizeOptionalString(value)) {
    throw new Error(message);
  }
}

async function getActorUserId(): Promise<string> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  return user.id;
}

async function insertAuditLog(params: {
  actorUserId: string;
  entityType: string;
  entityId: string;
  action: string;
  companyId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: unknown;
}) {
  const { error } = await supabaseService.from("audit_logs").insert({
    actor_user_id: params.actorUserId,
    company_id: params.companyId ?? null,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    old_values: params.oldValues ?? null,
    new_values: params.newValues ?? null,
    metadata: params.metadata ?? null,
  });

  if (error) throw error;
}

export async function saveCustomerProfileAction(
  formData: FormData,
): Promise<void> {
  const actorUserId = await getActorUserId();

  const customerId = getString(formData, "customer_id");
  if (!customerId) {
    throw new Error("customer_id saknas");
  }

  const customerType = normalizeCustomerType(
    getNullableString(formData, "customer_type"),
  );
  const firstName = normalizeOptionalString(
    getNullableString(formData, "first_name"),
  );
  const lastName = normalizeOptionalString(
    getNullableString(formData, "last_name"),
  );
  const companyNameInput = normalizeOptionalString(
    getNullableString(formData, "company_name"),
  );
  const personalNumberInput = normalizeOptionalString(
    getNullableString(formData, "personal_number"),
  );
  const orgNumberInput = normalizeOptionalString(
    getNullableString(formData, "org_number"),
  );
  const email = normalizeOptionalString(getNullableString(formData, "email"));
  const phone = normalizeOptionalString(getNullableString(formData, "phone"));
  const apartmentNumber = normalizeOptionalString(
    getNullableString(formData, "apartment_number"),
  );
  const status = getNullableString(formData, "status") ?? "draft";

  requireValue(
    firstName,
    customerType === "private"
      ? "Privatkund kräver förnamn"
      : "Företag eller förening kräver kontaktperson förnamn",
  );
  requireValue(
    lastName,
    customerType === "private"
      ? "Privatkund kräver efternamn"
      : "Företag eller förening kräver kontaktperson efternamn",
  );

  const companyName = customerType === "private" ? null : companyNameInput;
  const personalNumber =
    customerType === "private" ? personalNumberInput : null;
  const orgNumber = customerType === "private" ? null : orgNumberInput;

  if (customerType !== "private") {
    requireValue(companyName, "Företag eller förening kräver namn");
    requireValue(
      orgNumber,
      "Företag eller förening kräver organisationsnummer",
    );
  }

  const fullName =
    customerType === "private"
      ? [firstName, lastName].filter(Boolean).join(" ").trim() || null
      : companyName ||
        [firstName, lastName].filter(Boolean).join(" ").trim() ||
        null;

  const { data: before, error: beforeError } = await supabaseService
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .single();

  if (beforeError) throw beforeError;

  const companyId = await assertUserCanOperateCompany(
    actorUserId,
    typeof before.company_id === "string" ? before.company_id : null,
  );

  const { data: updated, error: updateError } = await supabaseService
    .from("customers")
    .update({
      customer_type: customerType,
      status,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      company_name: companyName,
      personal_number: personalNumber,
      org_number: orgNumber,
      email,
      phone,
      apartment_number: apartmentNumber,
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerId)
    .eq("company_id", companyId)
    .select("*")
    .single();

  if (updateError) throw updateError;

  const { data: existingPrimaryContact, error: contactLookupError } =
    await supabaseService
      .from("customer_contacts")
      .select("*")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .eq("is_primary", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

  if (contactLookupError) throw contactLookupError;

  const primaryContactName =
    customerType === "private"
      ? [firstName, lastName].filter(Boolean).join(" ").trim() || null
      : [firstName, lastName].filter(Boolean).join(" ").trim() ||
        companyName ||
        null;

  if (existingPrimaryContact) {
    const { error: contactUpdateError } = await supabaseService
      .from("customer_contacts")
      .update({
        name: primaryContactName,
        email,
        phone,
      })
      .eq("id", existingPrimaryContact.id)
      .eq("company_id", companyId);

    if (contactUpdateError) throw contactUpdateError;
  } else if (primaryContactName || email || phone) {
    const { error: contactInsertError } = await supabaseService
      .from("customer_contacts")
      .insert({
        company_id: companyId,
        customer_id: customerId,
        type: "primary",
        name: primaryContactName,
        email,
        phone,
        title: null,
        is_primary: true,
      });

    if (contactInsertError) throw contactInsertError;
  }

  await insertAuditLog({
    actorUserId,
    entityType: "customer",
    entityId: customerId,
    action: "customer_profile_updated",
    companyId,
    oldValues: before,
    newValues: updated,
    metadata: {
      companyId,
      syncedPrimaryContact: true,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath(`/admin/customers/${customerId}/profile`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/customers/segments");
}

function normalizeLifecycleMode(
  value: string | null | undefined,
): "move_out" | "terminate" {
  return value === "terminate" ? "terminate" : "move_out";
}

function normalizeIsoDateOrToday(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return new Date().toISOString().slice(0, 10);
}

function buildMoveOutNote(params: {
  moveOutDate: string;
  reason: string | null;
  mode: "move_out" | "terminate";
}): string {
  const label = params.mode === "terminate" ? "Avslut" : "Utflytt";
  const reason = params.reason?.trim();
  return [
    `${label} registrerat ${new Date().toISOString()}.`,
    `Avsluts-/utflyttsdatum: ${params.moveOutDate}.`,
    reason ? `Orsak/notering: ${reason}.` : null,
    "Kunden och kopplade anläggningar/mätpunkter är mjukt avslutade. Historik, Ediel, fullmakter, mätvärden och faktureringsunderlag sparas för spårbarhet.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function closeCustomerLifecycleAction(
  formData: FormData,
): Promise<void> {
  const actorUserId = await getActorUserId();
  const customerId = getString(formData, "customer_id");
  const confirmText = getString(formData, "confirm_close");
  const mode = normalizeLifecycleMode(
    getNullableString(formData, "lifecycle_mode"),
  );
  const moveOutDate = normalizeIsoDateOrToday(
    getNullableString(formData, "move_out_date"),
  );
  const reason = getNullableString(formData, "reason");
  const createFollowUpTask =
    getString(formData, "create_follow_up_task") === "on";

  if (!customerId) throw new Error("customer_id saknas");
  if (confirmText !== "AVSLUTA") {
    throw new Error(
      "Skriv AVSLUTA för att bekräfta mjukt avslut/flytt av kunden.",
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
    typeof customerBefore.company_id === "string"
      ? customerBefore.company_id
      : null,
  );

  const { data: sitesBefore, error: sitesError } = await supabaseService
    .from("customer_sites")
    .select("*")
    .eq("company_id", companyId)
    .eq("customer_id", customerId);

  if (sitesError) throw sitesError;

  const siteIds = (sitesBefore ?? [])
    .map((row: { id?: string }) => row.id)
    .filter((value): value is string => Boolean(value));

  const { data: meteringPointsBefore, error: pointsError } =
    siteIds.length > 0
      ? await supabaseService
          .from("metering_points")
          .select("*")
          .eq("company_id", companyId)
          .in("site_id", siteIds)
      : { data: [], error: null };

  if (pointsError) throw pointsError;

  const { data: contractsBefore, error: contractsError } = await supabaseService
    .from("customer_contracts")
    .select("*")
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .in("status", ["draft", "pending_signature", "signed", "active"]);

  if (contractsError) throw contractsError;

  const { data: switchRequestsBefore, error: switchError } =
    await supabaseService
      .from("supplier_switch_requests")
      .select("*")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .in("status", ["draft", "queued", "submitted", "accepted"]);

  if (switchError) throw switchError;

  const nowIso = new Date().toISOString();
  const customerStatus = mode === "terminate" ? "terminated" : "moved";
  const note = buildMoveOutNote({ moveOutDate, reason, mode });
  const lifecycleMetadata = {
    mode,
    moveOutDate,
    reason,
    source: "admin_customer_card",
    legalHandling:
      "Soft close only. Customer records are retained for Ediel, metering, billing, audit and support traceability.",
  };

  const { data: customerAfter, error: updateCustomerError } =
    await supabaseService
      .from("customers")
      .update({
        status: customerStatus,
        moved_out_at: moveOutDate,
        lifecycle_closed_at: nowIso,
        lifecycle_closed_by: actorUserId,
        lifecycle_status_reason: reason,
        updated_at: nowIso,
      })
      .eq("id", customerId)
      .eq("company_id", companyId)
      .select("*")
      .single();

  if (updateCustomerError) throw updateCustomerError;

  if (siteIds.length > 0) {
    const { error: updateSitesError } = await supabaseService
      .from("customer_sites")
      .update({
        status: "closed",
        move_out_date: moveOutDate,
        closed_at: nowIso,
        closed_reason:
          reason ??
          (mode === "terminate" ? "Kund avslutad." : "Kunden har flyttat."),
        updated_by: actorUserId,
      })
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .in("id", siteIds);

    if (updateSitesError) throw updateSitesError;

    const { error: updatePointsError } = await supabaseService
      .from("metering_points")
      .update({
        status: "closed",
        end_date: moveOutDate,
        closed_at: nowIso,
        closed_reason:
          reason ??
          (mode === "terminate" ? "Kund avslutad." : "Kunden har flyttat."),
        updated_by: actorUserId,
      })
      .eq("company_id", companyId)
      .in("site_id", siteIds);

    if (updatePointsError) throw updatePointsError;
  }

  const contracts = (contractsBefore ?? []) as Array<{
    id: string;
    company_id?: string | null;
    customer_id: string;
    status?: string | null;
  }>;

  for (const contract of contracts) {
    const { error: contractUpdateError } = await supabaseService
      .from("customer_contracts")
      .update({
        status: "terminated",
        ends_at: moveOutDate,
        termination_notice_date: nowIso,
        termination_reason: "move_out",
        updated_by: actorUserId,
      })
      .eq("id", contract.id)
      .eq("company_id", companyId)
      .eq("customer_id", customerId);

    if (contractUpdateError) throw contractUpdateError;

    await addCustomerContractEvent({
      companyId: contract.company_id ?? companyId,
      customerContractId: contract.id,
      customerId,
      eventType: "terminated",
      happenedAt: nowIso,
      note:
        mode === "terminate"
          ? "Avtalet avslutades via kundens livscykelåtgärd."
          : "Avtalet avslutades eftersom kunden registrerades som utflyttad.",
      metadata: lifecycleMetadata,
      actorUserId,
    });
  }

  const activeSwitchIds = (
    (switchRequestsBefore ?? []) as Array<{ id: string }>
  ).map((row) => row.id);
  if (activeSwitchIds.length > 0) {
    const { error: switchUpdateError } = await supabaseService
      .from("supplier_switch_requests")
      .update({
        status: "failed",
        failed_at: nowIso,
        failure_reason:
          mode === "terminate"
            ? "Kunden avslutades innan switchen slutfördes."
            : "Kunden registrerades som utflyttad innan switchen slutfördes.",
        updated_by: actorUserId,
      })
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .in("id", activeSwitchIds);

    if (switchUpdateError) throw switchUpdateError;
  }

  const { error: taskCancelError } = await supabaseService
    .from("customer_operation_tasks")
    .update({
      status: "cancelled",
      resolved_at: nowIso,
      updated_by: actorUserId,
    })
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .in("status", ["open", "in_progress", "blocked"]);

  if (taskCancelError) throw taskCancelError;

  if (createFollowUpTask) {
    const { error: followUpError } = await supabaseService
      .from("customer_operation_tasks")
      .insert({
        company_id: companyId,
        customer_id: customerId,
        site_id: siteIds[0] ?? null,
        metering_point_id: null,
        task_type: "move_out_confirmation_pending",
        status: "open",
        priority: "high",
        title: "Följ upp utflytt och slutunderlag",
        description:
          "Bekräfta att nätägaren har registrerat utflytt/avslut, invänta Z05LK vid relevant flöde och säkerställ slutliga mätvärden/faktureringsunderlag.",
        metadata: lifecycleMetadata,
        created_by: actorUserId,
        updated_by: actorUserId,
      });

    if (followUpError) throw followUpError;
  }

  const { error: noteError } = await supabaseService
    .from("customer_internal_notes")
    .insert({
      company_id: companyId,
      customer_id: customerId,
      body: note,
      created_by: actorUserId,
      updated_by: actorUserId,
    });

  if (noteError) throw noteError;

  const { error: lifecycleEventError } = await supabaseService
    .from("customer_lifecycle_events")
    .insert({
      company_id: companyId,
      customer_id: customerId,
      event_type: mode,
      event_status: "completed",
      effective_date: moveOutDate,
      reason,
      payload: {
        ...lifecycleMetadata,
        affectedSites: siteIds.length,
        affectedMeteringPoints: (meteringPointsBefore ?? []).length,
        terminatedContracts: contracts.length,
        cancelledSwitchRequests: activeSwitchIds.length,
        followUpTaskCreated: createFollowUpTask,
      },
      created_by: actorUserId,
    });

  if (lifecycleEventError) throw lifecycleEventError;

  await insertAuditLog({
    actorUserId,
    entityType: "customer",
    entityId: customerId,
    action:
      mode === "terminate"
        ? "customer_soft_terminated"
        : "customer_move_out_registered",
    companyId,
    oldValues: {
      customer: customerBefore,
      sites: sitesBefore ?? [],
      meteringPoints: meteringPointsBefore ?? [],
      contracts: contractsBefore ?? [],
      switchRequests: switchRequestsBefore ?? [],
    },
    newValues: {
      customer: customerAfter,
      lifecycle: lifecycleMetadata,
    },
    metadata: {
      companyId,
      retainedData: true,
      hardDelete: false,
      note: "Kunden har inte raderats permanent. Historik sparas för spårbarhet, fakturering, mätvärden och Ediel-kedjor.",
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/customers/segments");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/controltower");
}

async function selectIds(
  table: string,
  column: string,
  values: string[],
): Promise<string[]> {
  if (values.length === 0) return [];
  const { data, error } = await supabaseService
    .from(table)
    .select("id")
    .in(column, values);
  if (error) throw error;
  return (data ?? []).map((row: { id: string }) => row.id).filter(Boolean);
}

async function selectIdsByCustomerId(
  table: string,
  customerId: string,
): Promise<string[]> {
  const { data, error } = await supabaseService
    .from(table)
    .select("id")
    .eq("customer_id", customerId);
  if (error) throw error;
  return (data ?? []).map((row: { id: string }) => row.id).filter(Boolean);
}

async function deleteByIds(table: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabaseService.from(table).delete().in("id", ids);
  if (error) throw error;
}

async function deleteByColumn(
  table: string,
  column: string,
  values: string[],
): Promise<void> {
  if (values.length === 0) return;
  const { error } = await supabaseService
    .from(table)
    .delete()
    .in(column, values);
  if (error) throw error;
}

async function deleteByCustomerId(
  table: string,
  customerId: string,
): Promise<void> {
  const { error } = await supabaseService
    .from(table)
    .delete()
    .eq("customer_id", customerId);
  if (error) throw error;
}

async function deleteStorageObjectsForCustomer(
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

async function collectCustomerDeleteGraph(customerId: string) {
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
  };
}

export async function deleteCustomerForRecreateAction(
  formData: FormData,
): Promise<void> {
  const platformGuard = await requirePlatformAdminActionAccess();
  const actorUserId = platformGuard.userId;
  const customerId = getString(formData, "customer_id");
  const confirmText = getString(formData, "confirm_delete");

  if (!customerId) throw new Error("customer_id saknas");
  if (confirmText !== "RADERA") {
    throw new Error(
      "Skriv RADERA för att bekräfta permanent radering av kunden.",
    );
  }

  const graph = await collectCustomerDeleteGraph(customerId);
  const companyId =
    typeof graph.customer.company_id === "string"
      ? graph.customer.company_id
      : null;
  const storageSummary = await deleteStorageObjectsForCustomer(customerId);

  await insertAuditLog({
    actorUserId,
    entityType: "customer",
    entityId: customerId,
    action: "customer_hard_delete_started",
    companyId,
    oldValues: graph.customer,
    metadata: {
      companyId,
      warning: "Permanent hard delete requested from customer card.",
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
  redirect("/admin/customers");
}
