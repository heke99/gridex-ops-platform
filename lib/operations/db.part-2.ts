// Extracted from db.ts; keep public imports on the facade module.
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CustomerSiteRow, MeteringPointRow } from "@/lib/masterdata/types"
import { evaluateSiteSwitchReadiness } from "@/lib/operations/readiness"
import { resolveOwnElectricitySupplier } from "@/lib/masterdata/selfSupplier"
import { calculateEarliestSwitchStartDate } from "@/lib/operations/switchStartDate"
import { getSupplierSwitchActivationReadiness } from "@/lib/operations/supplierSwitchActivation"
import { loadSupplierSwitchPolicy } from "@/lib/operations/supplierSwitchScheduler"
import { resolveAuthorizationDocumentIdForPowerOfAttorney } from "@/lib/legal/authorizationChain"
import { assertNoActiveSwitchLifecycleBlock, OPEN_SUPPLIER_SWITCH_STATUSES } from "@/lib/operations/switchLifecycleBlocks"
import type { CustomerOperationTaskRow, CustomerOperationTaskStatus, SupplierSwitchEventRow, SupplierSwitchRequestRow, SupplierSwitchRequestStatus, SupplierSwitchRequestType, SwitchReadinessResult } from "@/lib/operations/types"
import { findPostgresErrorCode, getActorId, getSupplierSwitchRequestByAutomationKey, getSupplierSwitchRequestById, listPowersOfAttorneyByCustomerId } from './db.part-1'

export async function listAllSupplierSwitchRequests(
  supabase: SupabaseClient,
  options: {
    status?: string | null;
    requestType?: string | null;
    query?: string | null;
    companyId?: string | null;
    limit?: number;
  } = {},
): Promise<SupplierSwitchRequestRow[]> {
  let requestQuery = supabase
    .from("supplier_switch_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (options.status && options.status !== "all") {
    requestQuery = requestQuery.eq("status", options.status);
  }

  if (options.requestType && options.requestType !== "all") {
    requestQuery = requestQuery.eq("request_type", options.requestType);
  }

  if (options.companyId) {
    requestQuery = requestQuery.eq("company_id", options.companyId);
  }

  const { data, error } = await requestQuery.limit(options.limit ?? 200);

  if (error) throw error;

  let requests = (data ?? []) as SupplierSwitchRequestRow[];
  const normalizedQuery = (options.query ?? "").trim().toLowerCase();

  if (!normalizedQuery) {
    return requests;
  }

  requests = requests.filter((request) => {
    const haystack = [
      request.id,
      request.customer_id,
      request.site_id,
      request.metering_point_id,
      request.request_type,
      request.status,
      request.current_supplier_name,
      request.incoming_supplier_name,
      request.external_reference,
      request.failure_reason,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  return requests;
}

export async function listSupplierSwitchEventsByRequestIds(
  supabase: SupabaseClient,
  requestIds: string[],
  options: { companyId?: string | null; limit?: number } = {},
): Promise<SupplierSwitchEventRow[]> {
  if (requestIds.length === 0) return [];

  let query = supabase
    .from("supplier_switch_events")
    .select("*")
    .in("switch_request_id", requestIds)
    .is("archived_at", null);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (error) throw error;
  return (data ?? []) as SupplierSwitchEventRow[];
}

export async function listRecentSupplierSwitchEvents(
  supabase: SupabaseClient,
  limit = 50,
): Promise<SupplierSwitchEventRow[]> {
  const { data, error } = await supabase
    .from("supplier_switch_events")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as SupplierSwitchEventRow[];
}

export async function findExistingOpenTask(
  supabase: SupabaseClient,
  params: {
    customerId: string;
    siteId: string;
    taskType: string;
  },
): Promise<CustomerOperationTaskRow | null> {
  const { data, error } = await supabase
    .from("customer_operation_tasks")
    .select("*")
    .eq("customer_id", params.customerId)
    .eq("site_id", params.siteId)
    .eq("task_type", params.taskType)
    .in("status", ["open", "in_progress", "blocked"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as CustomerOperationTaskRow | null) ?? null;
}

export async function syncOperationTasksFromReadiness(
  supabase: SupabaseClient,
  readiness: SwitchReadinessResult,
): Promise<void> {
  const actorId = await getActorId(supabase);
  const activeTaskTypes = new Set<string>(
    readiness.issues.map((issue) => issue.taskType),
  );

  for (const issue of readiness.issues) {
    const existing = await findExistingOpenTask(supabase, {
      customerId: readiness.customerId,
      siteId: readiness.siteId,
      taskType: issue.taskType,
    });

    if (existing) {
      continue;
    }

    const { error } = await supabase.from("customer_operation_tasks").insert({
      customer_id: readiness.customerId,
      site_id: readiness.siteId,
      metering_point_id: readiness.candidateMeteringPointId,
      task_type: issue.taskType,
      status: issue.priority === "critical" ? "blocked" : "open",
      priority: issue.priority,
      title: issue.title,
      description: issue.description,
      metadata: {
        readinessCode: issue.code,
      },
      created_by: actorId,
      updated_by: actorId,
    });

    if (error) throw error;
  }

  const { data: existingOpenTasks, error: fetchOpenTasksError } = await supabase
    .from("customer_operation_tasks")
    .select("*")
    .eq("customer_id", readiness.customerId)
    .eq("site_id", readiness.siteId)
    .in("status", ["open", "in_progress", "blocked"]);

  if (fetchOpenTasksError) throw fetchOpenTasksError;

  const tasks = (existingOpenTasks ?? []) as CustomerOperationTaskRow[];

  for (const task of tasks) {
    if (activeTaskTypes.has(task.task_type)) {
      continue;
    }

    const { error } = await supabase
      .from("customer_operation_tasks")
      .update({
        status: "done",
        resolved_at: new Date().toISOString(),
        updated_by: actorId,
      })
      .eq("id", task.id);

    if (error) throw error;
  }
}

export async function syncCustomerOperationsForSite(
  supabase: SupabaseClient,
  params: {
    customerId: string;
    siteId: string;
  },
): Promise<SwitchReadinessResult> {
  const site = await findCustomerSiteById(supabase, params.siteId);

  if (!site || site.customer_id !== params.customerId) {
    throw new Error("Kunde inte hitta anläggningen för operations-sync");
  }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabase, params.siteId),
    listPowersOfAttorneyByCustomerId(supabase, params.customerId),
  ]);

  const readiness = evaluateSiteSwitchReadiness({
    site,
    meteringPoints,
    powersOfAttorney,
  });

  await syncOperationTasksFromReadiness(supabase, readiness);
  return readiness;
}

export async function syncCustomerOperationsForCustomer(
  supabase: SupabaseClient,
  customerId: string,
): Promise<{
  siteCount: number;
  readyCount: number;
  blockedCount: number;
  results: SwitchReadinessResult[];
}> {
  const { data, error } = await supabase
    .from("customer_sites")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const sites = (data ?? []) as CustomerSiteRow[];
  const results: SwitchReadinessResult[] = [];

  for (const site of sites) {
    const readiness = await syncCustomerOperationsForSite(supabase, {
      customerId,
      siteId: site.id,
    });

    results.push(readiness);
  }

  return {
    siteCount: sites.length,
    readyCount: results.filter((row) => row.isReady).length,
    blockedCount: results.filter((row) => !row.isReady).length,
    results,
  };
}

export async function updateOperationTaskStatus(
  supabase: SupabaseClient,
  params: {
    taskId: string;
    status: CustomerOperationTaskStatus;
  },
): Promise<CustomerOperationTaskRow> {
  const actorId = await getActorId(supabase);

  const updatePayload: {
    status: CustomerOperationTaskStatus;
    updated_by: string | null;
    resolved_at?: string | null;
  } = {
    status: params.status,
    updated_by: actorId,
  };

  if (params.status === "done") {
    updatePayload.resolved_at = new Date().toISOString();
  } else {
    updatePayload.resolved_at = null;
  }

  const { data, error } = await supabase
    .from("customer_operation_tasks")
    .update(updatePayload)
    .eq("id", params.taskId)
    .select("*")
    .single();

  if (error) throw error;
  return data as CustomerOperationTaskRow;
}

export async function findCustomerSiteById(
  supabase: SupabaseClient,
  siteId: string,
): Promise<CustomerSiteRow | null> {
  const { data, error } = await supabase
    .from("customer_sites")
    .select("*")
    .eq("id", siteId)
    .maybeSingle();

  if (error) throw error;
  return (data as CustomerSiteRow | null) ?? null;
}

export async function listMeteringPointsForSite(
  supabase: SupabaseClient,
  siteId: string,
): Promise<MeteringPointRow[]> {
  const { data, error } = await supabase
    .from("metering_points")
    .select("*")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as MeteringPointRow[];
}

export async function findOpenSupplierSwitchRequestForSite(
  supabase: SupabaseClient,
  params: {
    customerId: string;
    siteId: string;
    companyId?: string | null;
  },
): Promise<SupplierSwitchRequestRow | null> {
  let query = supabase
    .from("supplier_switch_requests")
    .select("*")
    .eq("customer_id", params.customerId)
    .eq("site_id", params.siteId)
    .in("status", OPEN_SUPPLIER_SWITCH_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);

  if (params.companyId) {
    query = query.eq("company_id", params.companyId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return (data as SupplierSwitchRequestRow | null) ?? null;
}

export async function createSupplierSwitchRequest(
  supabase: SupabaseClient,
  params: {
    readiness: SwitchReadinessResult;
    site: CustomerSiteRow;
    meteringPoint: MeteringPointRow;
    requestType: SupplierSwitchRequestType;
    requestedStartDate: string | null;
    authorizationDocumentId?: string | null;
    automationOrigin?: string | null;
    automationKey?: string | null;
    companyId?: string | null;
    contractId?: string | null;
    externalReference?: string | null;
    metadata?: Record<string, unknown> | null;
    initialStatus?: SupplierSwitchRequestStatus;
    businessBlockers?: Array<{ code: string; message: string }>;
    lifecycleBlocked?: boolean;
    lifecycleBlockSource?: string | null;
  },
): Promise<SupplierSwitchRequestRow> {
  const actorId = await getActorId(supabase);

  await assertNoActiveSwitchLifecycleBlock(supabase, {
    companyId:
      params.companyId ??
      params.site.company_id ??
      params.meteringPoint.company_id ??
      null,
    customerId: params.readiness.customerId,
    siteId: params.site.id,
    meteringPointId: params.meteringPoint.id,
  });

  const ownSupplierLookup = await resolveOwnElectricitySupplier(supabase);
  const ownSupplier = ownSupplierLookup.supplier;

  const incomingSupplierName = ownSupplier?.name ?? "Gridex";
  const incomingSupplierOrgNumber = ownSupplier?.org_number ?? null;

  // Compute the earliest legally/market-valid start date from notice period,
  // contract end and move-in date. We honor a provided requested date but fill
  // it in when missing, and always record the calculation for audit/review.
  const resolvedPolicyCompanyId = params.companyId ?? params.site.company_id ?? params.meteringPoint.company_id ?? null;
  if (!resolvedPolicyCompanyId) throw new Error("supplier_switch_company_missing");
  const switchPolicy = await loadSupplierSwitchPolicy(resolvedPolicyCompanyId, "production");
  const startDateCalculation = calculateEarliestSwitchStartDate({
    requestType: params.requestType,
    requestedStartDate: params.requestedStartDate,
    noticePeriod: params.site.current_supplier_notice_period ?? null,
    contractEndDate: params.site.current_supplier_contract_end_date ?? null,
    moveInDate: params.site.move_in_date ?? null,
    marketLeadDays: switchPolicy.marketLeadDays,
  });
  const effectiveRequestedStartDate = startDateCalculation.effectiveStartDate;

  // The authorization chain must not be dropped at switch creation: when the
  // caller does not pass an authorization document explicitly, resolve it from
  // the POA so supplier_switch_requests.authorization_document_id and the
  // downstream outbound/intent chain always carry the legal reference.
  const resolvedCompanyId =
    params.companyId ??
    params.site.company_id ??
    params.meteringPoint.company_id ??
    null;
  let authorizationDocumentId = params.authorizationDocumentId ?? null;
  if (!authorizationDocumentId && params.readiness.latestPowerOfAttorneyId && resolvedCompanyId) {
    authorizationDocumentId = await resolveAuthorizationDocumentIdForPowerOfAttorney({
      companyId: resolvedCompanyId,
      powerOfAttorneyId: params.readiness.latestPowerOfAttorneyId,
    }).catch(() => null);
  }

  const businessBlockers = params.businessBlockers ?? [];
  const primaryBusinessBlocker = businessBlockers[0] ?? null;
  const initialStatus: SupplierSwitchRequestStatus =
    params.initialStatus ?? (primaryBusinessBlocker ? "manual_followup_required" : "queued");

  const insertPayload = {
    customer_id: params.readiness.customerId,
    contract_id: params.contractId ?? null,
    customer_contract_id: params.contractId ?? null,
    site_id: params.site.id,
    // Keep the legacy alias column coherent: several read paths (e.g. the
    // customer intake orchestrator's open-switch detection) filter on
    // customer_site_id, which ediel_rules.sql backfilled from site_id.
    customer_site_id: params.site.id,
    metering_point_id: params.meteringPoint.id,
    power_of_attorney_id: params.readiness.latestPowerOfAttorneyId,
    authorization_document_id: authorizationDocumentId,
    request_type: params.requestType,
    status: initialStatus,
    requested_start_date: effectiveRequestedStartDate,
    current_supplier_id: params.site.current_supplier_id ?? null,
    current_supplier_name: params.site.current_supplier_name,
    current_supplier_org_number: params.site.current_supplier_org_number,
    current_supplier_ediel_id: params.site.current_supplier_ediel_id ?? null,
    current_supplier_unknown: Boolean(params.site.current_supplier_unknown),
    current_supplier_contract_status: params.site.current_supplier_contract_status ?? null,
    current_supplier_contract_end_date: params.site.current_supplier_contract_end_date ?? null,
    current_supplier_notice_period: params.site.current_supplier_notice_period ?? null,
    current_supplier_termination_fee: params.site.current_supplier_termination_fee ?? null,
    current_supplier_response_status: params.site.current_supplier_response_status ?? null,
    incoming_supplier_name: incomingSupplierName,
    incoming_supplier_org_number: incomingSupplierOrgNumber,
    grid_owner_id:
      params.meteringPoint.grid_owner_id ?? params.site.grid_owner_id ?? null,
    price_area_code:
      params.meteringPoint.price_area_code ??
      params.site.price_area_code ??
      null,
    validation_snapshot: {
      isReady: params.readiness.isReady,
      issues: params.readiness.issues,
      candidateMeteringPointId: params.readiness.candidateMeteringPointId,
      latestPowerOfAttorneyId: params.readiness.latestPowerOfAttorneyId,
      ownSupplierResolution: ownSupplierLookup.resolution,
      currentSupplier: {
        id: params.site.current_supplier_id ?? null,
        name: params.site.current_supplier_name ?? null,
        orgNumber: params.site.current_supplier_org_number ?? null,
        edielId: params.site.current_supplier_ediel_id ?? null,
        unknown: Boolean(params.site.current_supplier_unknown),
        contractStatus: params.site.current_supplier_contract_status ?? null,
        contractEndDate: params.site.current_supplier_contract_end_date ?? null,
        noticePeriod: params.site.current_supplier_notice_period ?? null,
        terminationFee: params.site.current_supplier_termination_fee ?? null,
        responseStatus: params.site.current_supplier_response_status ?? null,
      },
      startDateCalculation,
      businessBlockers,
    },
    lifecycle_blocked: params.lifecycleBlocked ?? Boolean(primaryBusinessBlocker),
    lifecycle_block_source: params.lifecycleBlockSource ?? primaryBusinessBlocker?.code ?? null,
    automation_origin: params.automationOrigin ?? null,
    automation_key: params.automationKey ?? null,
    external_reference: params.externalReference ?? null,
    metadata: {
      ...(params.metadata ?? {}),
      supplier_switch_blockers: businessBlockers,
      pending_review_reason: primaryBusinessBlocker?.code ?? null,
    },
    created_by: actorId,
    updated_by: actorId,
    company_id: params.companyId ?? null,
  };

  const { data, error } = await supabase
    .from("supplier_switch_requests")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    if (findPostgresErrorCode(error) === "23505" && params.automationKey) {
      const existing = await getSupplierSwitchRequestByAutomationKey(
        supabase,
        params.automationKey,
      );

      if (existing) {
        return existing;
      }
    }

    throw error;
  }

  const request = data as SupplierSwitchRequestRow;

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: request.id,
    eventType: "created",
    eventStatus: "success",
    message: primaryBusinessBlocker
      ? `Switchärende skapat men väntar på komplettering: ${primaryBusinessBlocker.message}.`
      : "Switchärende skapat och köat för vidare handläggning.",
    payload: {
      requestType: params.requestType,
      requestedStartDate: params.requestedStartDate,
      incomingSupplierName,
      incomingSupplierOrgNumber,
      ownSupplierResolution: ownSupplierLookup.resolution,
      businessBlockers,
    },
    companyId: params.companyId ?? null,
  });

  return request;
}

export async function updateSupplierSwitchValidationSnapshot(
  supabase: SupabaseClient,
  params: {
    requestId: string;
    validationSnapshot: Record<string, unknown>;
  },
): Promise<SupplierSwitchRequestRow> {
  const actorId = await getActorId(supabase);

  const { data, error } = await supabase
    .from("supplier_switch_requests")
    .update({
      validation_snapshot: params.validationSnapshot,
      updated_by: actorId,
    })
    .eq("id", params.requestId)
    .select("*")
    .single();

  if (error) throw error;

  return data as SupplierSwitchRequestRow;
}

export async function updateSupplierSwitchRequestStatus(
  supabase: SupabaseClient,
  params: {
    requestId: string;
    status: SupplierSwitchRequestStatus;
    failureReason?: string | null;
    externalReference?: string | null;
  },
): Promise<SupplierSwitchRequestRow> {
  const actorId = await getActorId(supabase);
  const nowIso = new Date().toISOString();

  const updatePayload: {
    status: SupplierSwitchRequestStatus;
    updated_by: string | null;
    submitted_at?: string | null;
    completed_at?: string | null;
    failed_at?: string | null;
    failure_reason?: string | null;
    external_reference?: string | null;
  } = {
    status: params.status,
    updated_by: actorId,
    failure_reason: params.failureReason ?? null,
    external_reference: params.externalReference ?? null,
  };

  if (params.status === "submitted") {
    updatePayload.submitted_at = nowIso;
  }

  if (params.status === "completed") {
    updatePayload.completed_at = nowIso;
  }

  if (params.status === "failed" || params.status === "rejected") {
    updatePayload.failed_at = nowIso;
  }

  const { data, error } = await supabase
    .from("supplier_switch_requests")
    .update(updatePayload)
    .eq("id", params.requestId)
    .select("*")
    .single();

  if (error) throw error;

  const saved = data as SupplierSwitchRequestRow;

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: saved.id,
    eventType: "status_updated",
    eventStatus: saved.status,
    message:
      saved.status === "failed" || saved.status === "rejected"
        ? (params.failureReason ?? "Status uppdaterad med felorsak.")
        : `Switchärende uppdaterat till status ${saved.status}.`,
    payload: {
      status: saved.status,
      externalReference: saved.external_reference,
      failureReason: saved.failure_reason,
    },
  });

  return saved;
}

export async function archiveSupplierSwitchEvent(
  supabase: SupabaseClient,
  params: {
    eventId: string;
    actorUserId: string;
    reason?: string | null;
  },
): Promise<SupplierSwitchEventRow> {
  const { data, error } = await supabase
    .from("supplier_switch_events")
    .update({
      archived_at: new Date().toISOString(),
      archived_by: params.actorUserId,
      archive_reason:
        params.reason?.trim() || "Arkiverad från operationsöversikten.",
    })
    .eq("id", params.eventId)
    .select("*")
    .single();

  if (error) throw error;
  return data as SupplierSwitchEventRow;
}

export async function createSupplierSwitchEvent(
  supabase: SupabaseClient,
  params: {
    switchRequestId: string;
    eventType: string;
    eventStatus: string;
    message?: string | null;
    payload?: Record<string, unknown>;
    companyId?: string | null;
  },
): Promise<SupplierSwitchEventRow> {
  const actorId = await getActorId(supabase);

  const { data, error } = await supabase
    .from("supplier_switch_events")
    .insert({
      switch_request_id: params.switchRequestId,
      event_type: params.eventType,
      event_status: params.eventStatus,
      message: params.message ?? null,
      payload: params.payload ?? {},
      company_id: params.companyId ?? null,
      created_by: actorId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as SupplierSwitchEventRow;
}

export async function finalizeSupplierSwitchExecution(
  supabase: SupabaseClient,
  params: {
    requestId: string;
    actorUserId: string;
    executionSource:
      | "manual_admin"
      | "automation_sweep"
      | "bulk_admin_ready_queue";
    executionNotes?: string | null;
  },
): Promise<{
  requestBefore: SupplierSwitchRequestRow;
  request: SupplierSwitchRequestRow;
  siteBefore: CustomerSiteRow;
  siteAfter: CustomerSiteRow;
  meteringPointBefore: MeteringPointRow | null;
  meteringPointAfter: MeteringPointRow | null;
}> {
  const requestBefore = await getSupplierSwitchRequestById(
    supabase,
    params.requestId,
  );

  if (!requestBefore) {
    throw new Error("Switchärendet hittades inte");
  }

  const siteBefore = await findCustomerSiteById(
    supabase,
    requestBefore.site_id,
  );

  if (!siteBefore) {
    throw new Error("Anläggningen för switchärendet hittades inte");
  }

  const pointQuery = requestBefore.metering_point_id
    ? await supabase
        .from("metering_points")
        .select("*")
        .eq("id", requestBefore.metering_point_id)
        .maybeSingle()
    : null;

  if (pointQuery?.error) {
    throw pointQuery.error;
  }

  const meteringPointBefore =
    (pointQuery?.data as MeteringPointRow | null | undefined) ?? null;

  if (requestBefore.status === "completed") {
    return {
      requestBefore,
      request: requestBefore,
      siteBefore,
      siteAfter: siteBefore,
      meteringPointBefore,
      meteringPointAfter: meteringPointBefore,
    };
  }

  if (requestBefore.status !== "accepted") {
    throw new Error(
      "Switchärendet måste vara accepted efter inbound PRODAT Z04 innan det kan slutföras",
    );
  }

  const activationReadiness = getSupplierSwitchActivationReadiness(requestBefore);
  if (!activationReadiness.ready) {
    throw new Error(`supplier_switch_activation_blocked:${activationReadiness.code}:${activationReadiness.reason}`);
  }

  const siteUpdatePayload = {
    current_supplier_name: requestBefore.incoming_supplier_name,
    current_supplier_org_number: requestBefore.incoming_supplier_org_number,
    status: siteBefore.status === "closed" ? "closed" : "active",
    grid_owner_id:
      siteBefore.grid_owner_id ?? requestBefore.grid_owner_id ?? null,
    price_area_code:
      siteBefore.price_area_code ?? requestBefore.price_area_code ?? null,
    updated_by: params.actorUserId,
  };

  const siteUpdate = await supabase
    .from("customer_sites")
    .update(siteUpdatePayload)
    .eq("id", siteBefore.id)
    .select("*")
    .single();

  if (siteUpdate.error) throw siteUpdate.error;
  const siteAfter = siteUpdate.data as CustomerSiteRow;

  let meteringPointAfter: MeteringPointRow | null = meteringPointBefore;

  if (meteringPointBefore) {
    const pointUpdate = await supabase
      .from("metering_points")
      .update({
        status: meteringPointBefore.status === "closed" ? "closed" : "active",
        grid_owner_id:
          meteringPointBefore.grid_owner_id ??
          requestBefore.grid_owner_id ??
          null,
        price_area_code:
          meteringPointBefore.price_area_code ??
          requestBefore.price_area_code ??
          null,
        updated_by: params.actorUserId,
      })
      .eq("id", meteringPointBefore.id)
      .select("*")
      .single();

    if (pointUpdate.error) throw pointUpdate.error;
    meteringPointAfter = pointUpdate.data as MeteringPointRow;
  }

  const request = await updateSupplierSwitchRequestStatus(supabase, {
    requestId: requestBefore.id,
    status: "completed",
    externalReference: requestBefore.external_reference,
  });

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: request.id,
    eventType: "execution_completed",
    eventStatus: "completed",
    message:
      params.executionSource === "automation_sweep"
        ? "Leveransen aktiverades automatiskt efter inbound PRODAT Z04 och uppnått startdatum."
        : params.executionSource === "bulk_admin_ready_queue"
          ? "Switchen slutfördes från bulk-kön för ready-to-execute."
          : "Switchen slutfördes manuellt från operations.",
    payload: {
      executionSource: params.executionSource,
      executionNotes: params.executionNotes ?? null,
      previousSupplierName: requestBefore.current_supplier_name,
      newSupplierName: request.incoming_supplier_name,
      siteStatusBefore: siteBefore.status,
      siteStatusAfter: siteAfter.status,
      meteringPointStatusBefore: meteringPointBefore?.status ?? null,
      meteringPointStatusAfter: meteringPointAfter?.status ?? null,
    },
  });

  return {
    requestBefore,
    request,
    siteBefore,
    siteAfter,
    meteringPointBefore,
    meteringPointAfter,
  };
}
