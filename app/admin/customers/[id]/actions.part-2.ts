// Extracted from actions.ts; keep public imports on the facade module.
import { revalidatePath } from "next/cache"
import { randomUUID } from "node:crypto"
import { after } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireAdminActionAccess } from "@/lib/admin/guards"
import { assertCustomerSiteTenant, assertMeteringPointTenant } from "@/lib/tenant/entityGuards"
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions"


import { supabaseService } from "@/lib/supabase/service"

import { createSupplierSwitchRequest, findCustomerSiteById, findOpenSupplierSwitchRequestForSite, listMeteringPointsForSite, listPowersOfAttorneyByCustomerId, saveCustomerAuthorizationDocument, savePowerOfAttorney, syncCustomerOperationsForCustomer, syncCustomerOperationsForSite, syncOperationTasksFromReadiness } from "@/lib/operations/db"
import { evaluateSiteSwitchReadiness } from "@/lib/operations/readiness"



import { createCustomerInfoRequest, queueCustomerInfoRequestForDispatch } from "@/lib/onboarding/infoRequests"

import { routeDecisionPayload } from "@/lib/routes/routeDecisionEngine"


import { actionPreflight } from "@/lib/operations/businessActions/actionPreflight"
import { startSupplierSwitch } from "@/lib/operations/businessActions/startSupplierSwitch"

import { blockerText } from "@/lib/customers/customerOperationEvents"
import { prepareLegalPayloadForGridOwner } from "@/lib/legal/gridOwnerLegalPayload"

import { enqueueCustomerDataRequestAutomation, enqueueSupplierSwitchAutomation, processCustomerOperationJobs } from "@/lib/customer-operations/automation"

import { normalizeUuidOrNull, UuidValidationError } from "@/lib/validation/uuid"
import { customerBlockerStatusLabel } from "@/lib/customer-operations/blockers"

import { auditRouteDecisionForCustomerAction, buildCustomerDocumentPath, formValue, insertAuditLog, messageCodeForBusinessProcess, normalizeDateOrNull, normalizeSwitchRequestType, reconcileSupplierSwitchesForCustomerSites, recordCustomerActionResult, toBoolean } from './actions.part-1'
import { requireCustomerMutationContext } from './actions.part-4'

export async function uploadCustomerAuthorizationDocumentAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();
  const customerId = formValue(formData, "customer_id") ?? "";
  const siteId = formValue(formData, "site_id") || null;
  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  await assertCustomerSiteTenant({ companyId, customerId, siteId });
  const documentType =
    (formValue(formData, "document_type") as
      | "power_of_attorney"
      | "complete_agreement"
      | null) ?? "power_of_attorney";
  const title = formValue(formData, "title") || null;
  const reference = formValue(formData, "reference") || null;
  const notes = formValue(formData, "notes") || null;
  const validFrom = normalizeDateOrNull(formValue(formData, "valid_from"));
  const validTo = normalizeDateOrNull(formValue(formData, "valid_to"));
  const markAsSigned = toBoolean(formData, "mark_as_signed");
  const syncToPowerOfAttorney = toBoolean(
    formData,
    "sync_to_power_of_attorney",
  );
  // Manual-intake evidence so an uploaded signed PDF can be used for external
  // grid-owner communication (signer + method + snapshot).
  const signerName = formValue(formData, "signer_name") || null;
  const signerIdentityNumber = formValue(formData, "signer_identity_number") || null;
  const signedDate = normalizeDateOrNull(formValue(formData, "signed_date"));
  const selectedScopes = formData
    .getAll("poa_scope")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const poaScopes = selectedScopes.length > 0 ? selectedScopes : ["supplier_switch", "facility_information_lookup"];
  const fileValue = formData.get("document_file");

  if (!customerId) {
    throw new Error("Customer ID saknas");
  }

  if (!(fileValue instanceof File) || fileValue.size === 0) {
    throw new Error("Du måste välja en fil att ladda upp");
  }

  const bucket = "customer-documents";
  const filePath = buildCustomerDocumentPath({
    customerId,
    siteId,
    documentType,
    fileName: fileValue.name || "document.pdf",
  });

  const uploadResult = await supabaseService.storage
    .from(bucket)
    .upload(filePath, fileValue, {
      contentType: fileValue.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadResult.error) throw uploadResult.error;

  let savedPowerOfAttorneyId: string | null = null;

  if (syncToPowerOfAttorney || documentType === "power_of_attorney") {
    const signedAtIso = markAsSigned ? (signedDate ?? new Date().toISOString()) : null;
    const savedPowerOfAttorney = await savePowerOfAttorney(supabase, {
      customer_id: customerId,
      site_id: siteId,
      scope: "supplier_switch",
      status: markAsSigned ? "signed" : "sent",
      signed_at: signedAtIso,
      accepted_at: signedAtIso,
      accepted_source: "admin_manual",
      method: "pdf_upload",
      signer_name: signerName,
      signer_identity_number: signerIdentityNumber,
      scopeSummary: {
        scopes: poaScopes,
        supplier_switch: poaScopes.includes("supplier_switch"),
        facility_information_lookup: poaScopes.includes("facility_information_lookup"),
        source: "manual_pdf_upload",
      },
      valid_from: validFrom,
      valid_to: validTo,
      document_path: filePath,
      reference,
      notes,
      companyId,
    });

    savedPowerOfAttorneyId = savedPowerOfAttorney.id;
  }

  const savedDocument = await saveCustomerAuthorizationDocument(supabase, {
    companyId,
    customer_id: customerId,
    site_id: siteId,
    power_of_attorney_id: savedPowerOfAttorneyId,
    document_type: documentType,
    status: "active",
    title,
    file_name: fileValue.name || null,
    mime_type: fileValue.type || null,
    file_size_bytes: fileValue.size || null,
    storage_bucket: bucket,
    file_path: filePath,
    reference,
    notes,
  });

  const syncSummary = siteId
    ? await syncCustomerOperationsForSite(supabase, {
        customerId,
        siteId,
      })
    : await syncCustomerOperationsForCustomer(supabase, customerId);
  const supplierSwitchReconcile = savedPowerOfAttorneyId && markAsSigned
    ? await reconcileSupplierSwitchesForCustomerSites({
        companyId,
        customerId,
        siteId,
        actorUserId: actor.id,
        source: "power_of_attorney_document_signed",
      })
    : [];

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "customer_authorization_document",
    entityId: savedDocument.id,
    action: "customer_authorization_document_uploaded",
    newValues: savedDocument,
    metadata: {
      customerId,
      siteId,
      documentType,
      linkedPowerOfAttorneyId: savedPowerOfAttorneyId,
      syncSummary,
      supplierSwitchReconcile,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/tasks");
}

export async function runSwitchReadinessAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();
  const customerId = formValue(formData, "customer_id") ?? "";
  const siteId = formValue(formData, "site_id") ?? "";

  if (!customerId || !siteId) {
    throw new Error("Customer ID eller site ID saknas");
  }

  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  await assertCustomerSiteTenant({ companyId, customerId, siteId });
  const site = await findCustomerSiteById(supabase, siteId);

  if (
    !site ||
    site.company_id !== companyId ||
    site.customer_id !== customerId
  ) {
    throw new Error("Anläggningen kunde inte hittas");
  }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabase, siteId),
    listPowersOfAttorneyByCustomerId(supabase, customerId),
  ]);

  const readiness = evaluateSiteSwitchReadiness({
    site,
    meteringPoints,
    powersOfAttorney,
  });

  await syncOperationTasksFromReadiness(supabase, readiness);

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "customer_site",
    entityId: siteId,
    action: "switch_readiness_run",
    metadata: {
      customerId,
      siteId,
      readiness,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/tasks");
}

export async function createSupplierSwitchRequestAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();
  const customerId = formValue(formData, "customer_id") ?? "";
  const siteId = formValue(formData, "site_id") ?? "";
  const requestType = normalizeSwitchRequestType(
    formValue(formData, "request_type"),
  );
  const requestedStartDate = normalizeDateOrNull(
    formValue(formData, "requested_start_date"),
  );

  if (!customerId || !siteId) {
    throw new Error("Customer ID eller site ID saknas");
  }

  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  await assertCustomerSiteTenant({ companyId, customerId, siteId });
  const site = await findCustomerSiteById(supabase, siteId);

  if (
    !site ||
    site.company_id !== companyId ||
    site.customer_id !== customerId
  ) {
    throw new Error("Anläggningen kunde inte hittas");
  }

  const existingOpenRequest = await findOpenSupplierSwitchRequestForSite(
    supabase,
    {
      customerId,
      siteId,
      companyId,
    },
  );

  if (existingOpenRequest) {
    await recordCustomerActionResult({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      eventType: "supplier_switch.already_open",
      title: "Leverantörsbyte finns redan",
      message:
        "Det finns redan ett öppet leverantörsbyte för kunden. Öppna ärendet i stället för att skapa ett nytt.",
      payload: { supplier_switch_request_id: existingOpenRequest.id },
      idempotencyKey: `supplier_switch.already_open:${existingOpenRequest.id}`,
    });
    revalidatePath(`/admin/customers/${customerId}`);
    return;
  }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabase, siteId),
    listPowersOfAttorneyByCustomerId(supabase, customerId),
  ]);

  const readiness = evaluateSiteSwitchReadiness({
    site,
    meteringPoints,
    powersOfAttorney,
  });

  await syncOperationTasksFromReadiness(supabase, readiness);

  if (!readiness.isReady || !readiness.candidateMeteringPointId) {
    const issues = (readiness.issues ?? [])
      .map((item) => item.title || item.description || item.code)
      .filter(Boolean);
    await recordCustomerActionResult({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      eventType: "supplier_switch.blocked",
      title: "Leverantörsbyte kan inte startas ännu",
      message: `Komplettera först: ${blockerText(issues.length ? issues : ["mätpunkt", "nätägare", "anläggnings-ID"])}`,
      payload: { readiness },
      idempotencyKey: `supplier_switch.blocked:${customerId}:${siteId}:readiness`,
    });
    await insertAuditLog({
      actorUserId: actor.id,
      entityType: "customer_site",
      entityId: siteId,
      action: "switch_request_blocked",
      metadata: {
        customerId,
        siteId,
        readiness,
      },
    });

    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/operations");
    revalidatePath("/admin/operations/tasks");
    return;
  }

  const meteringPoint =
    meteringPoints.find(
      (point) => point.id === readiness.candidateMeteringPointId,
    ) ?? null;

  if (!meteringPoint) {
    throw new Error("Kunde inte hitta kandidat-mätpunkt för switchärendet");
  }

  const preflight = await actionPreflight({
    actorUserId: actor.id,
    customerId,
    siteId,
    meteringPointId: meteringPoint.id,
  });

  if (!preflight.ok) {
    const issues = preflight.issues
      .map((issue) => issue.label || issue.code)
      .filter(Boolean);
    await recordCustomerActionResult({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      eventType: "supplier_switch.blocked",
      title: "Leverantörsbyte stoppades",
      message: blockerText(issues),
      payload: { issues: preflight.issues },
      idempotencyKey: `supplier_switch.blocked:${customerId}:${siteId}:preflight`,
    });
    await insertAuditLog({
      actorUserId: actor.id,
      entityType: "customer_site",
      entityId: siteId,
      action: "supplier_switch_business_preflight_blocked",
      metadata: {
        customerId,
        siteId,
        meteringPointId: meteringPoint.id,
        issues: preflight.issues,
      },
    });

    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/operations");
    revalidatePath("/admin/operations/tasks");
    return;
  }

  const routeDecision = await auditRouteDecisionForCustomerAction({
    actorUserId: actor.id,
    companyId,
    customerId,
    siteId,
    meteringPointId: meteringPoint.id,
    gridOwnerId: meteringPoint.grid_owner_id ?? site.grid_owner_id ?? null,
    currentSupplierId: site.current_supplier_id ?? null,
    businessProcess: "supplier_switch",
    requestedAction: "start_supplier_switch",
    messageCode: messageCodeForBusinessProcess("supplier_switch"),
    payload: {
      requestType,
      requestedStartDate,
      move_in: requestType === "move_in" || requestType === "move_out_takeover",
      customer_change:
        requestType === "move_in" || requestType === "move_out_takeover",
    },
  });

  if (routeDecision.decisionStatus === "blocked") {
    await recordCustomerActionResult({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      eventType: "supplier_switch.blocked",
      title: "Kontaktväg till nätägare saknas",
      message:
        "Leverantörsbyte kan inte skickas förrän nätägare och kontaktväg är verifierade.",
      payload: { decision: routeDecisionPayload(routeDecision) },
      idempotencyKey: `supplier_switch.blocked:${customerId}:${siteId}:route`,
    });
    await insertAuditLog({
      actorUserId: actor.id,
      entityType: "customer_site",
      entityId: siteId,
      action: "supplier_switch_route_blocked",
      metadata: {
        customerId,
        siteId,
        meteringPointId: meteringPoint.id,
        decision: routeDecisionPayload(routeDecision),
      },
    });

    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/operations");
    revalidatePath("/admin/operations/tasks");
    return;
  }

  const legalPayload = await prepareLegalPayloadForGridOwner({
    companyId,
    customerId,
    siteId,
  });
  if (!legalPayload.ok) {
    await recordCustomerActionResult({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      eventType: "legal_documents.missing",
      title: "Juridiskt underlag saknas",
      message: `Leverantörsbyte kan inte skickas förrän detta finns: ${legalPayload.missing.join(", ")}.`,
      payload: { missing: legalPayload.missing },
      idempotencyKey: `legal_documents.missing:${customerId}:${siteId}:supplier_switch`,
    });
    revalidatePath(`/admin/customers/${customerId}`);
    return;
  }

  await recordCustomerActionResult({
    actorUserId: actor.id,
    companyId,
    customerId,
    siteId,
    eventType: "legal_documents.attached_to_request",
    title: "Juridiskt underlag klart",
    message:
      "Fullmakt och juridiska godkännanden kopplas till leverantörsbytet.",
    payload: { legal: legalPayload },
    idempotencyKey: `legal_documents.ready:${customerId}:${siteId}:supplier_switch`,
  });

  const savedRequest = await createSupplierSwitchRequest(supabase, {
    readiness,
    site,
    meteringPoint,
    requestType,
    requestedStartDate,
  });

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "supplier_switch_request",
    entityId: savedRequest.id,
    action: "supplier_switch_request_created",
    newValues: savedRequest,
    metadata: {
      customerId,
      siteId,
    },
  });

  await startSupplierSwitch({
    actorUserId: actor.id,
    customerId,
    switchRequestId: savedRequest.id,
    siteId,
    meteringPointId: meteringPoint.id,
    idempotencyKey: `start_supplier_switch:${customerId}:${siteId}:${meteringPoint.id}:${savedRequest.id}`,
  });

  await recordCustomerActionResult({
    actorUserId: actor.id,
    companyId,
    customerId,
    siteId,
    eventType: "supplier_switch.requested",
    title: "Leverantörsbyte begärt",
    message: "Leverantörsbyte har skapats och teknisk sändning startas.",
    payload: {
      supplier_switch_request_id: savedRequest.id,
      metering_point_id: meteringPoint.id,
    },
    idempotencyKey: `supplier_switch.requested:${savedRequest.id}`,
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/switches");
  revalidatePath("/admin/outbound");
  revalidatePath("/admin/ediel");
}

export type CustomerOperationActionState = {
  ok: boolean;
  status: "idle" | "started" | "blocked" | "warning" | "error";
  title: string;
  message: string;
  jobId?: string;
  actionUrl?: string;
};

export function customerOperationActionError(error: unknown, fallback: string): CustomerOperationActionState {
  const message = error instanceof Error ? error.message.trim() : "";
  const code = (error as { code?: string } | null)?.code ?? "";
  const authorizationError = /^(unauthorized|forbidden)$/i.test(message);
  const traceId = randomUUID();
  console.error("[customer-operation] customer card action failed", { traceId, code, error });

  if (authorizationError) {
    return {
      ok: false,
      status: "blocked",
      title: "Du saknar behörighet för åtgärden",
      message: "Din roll behöver behörighet att hantera kund- och anläggningsuppgifter. Kontakta bolagsadministratören eller kontrollera rollens behörigheter.",
    };
  }
  if (code === "23505" || /duplicate key|kundautomation kör redan/i.test(message)) {
    return {
      ok: false,
      status: "warning",
      title: "En uppgiftsbegäran behandlas redan",
      message: "Systemet har redan ett aktivt jobb för anläggningen. Öppna arbetskön för att se status eller invänta nästa uppdatering.",
    };
  }
  if (error instanceof UuidValidationError || /ogiltigt UUID-format/i.test(message)) {
    return {
      ok: false,
      status: "blocked",
      title: "Åtgärden innehåller ogiltiga referenser",
      message: `${message || "En referens från formuläret har ogiltigt format."} Uppdatera sidan och försök igen. Referens: ${traceId}`,
    };
  }
  if (/automationstabellen|schema cache|column .* does not exist|relation .* does not exist/i.test(message)) {
    return {
      ok: false,
      status: "error",
      title: "Kundautomation behöver en systemuppdatering",
      message: `Databasschemat för kundautomation saknas eller är inte uppdaterat. Kör den senaste OPS-migrationen. Referens: ${traceId}`,
    };
  }
  if (/nätägare|nätområde|papilite|address|adress/i.test(message)) {
    return {
      ok: false,
      status: "blocked",
      title: "Nätägaren kunde inte verifieras ännu",
      message: "Systemet behöver en verifierbar adress- och nätområdesmatchning innan det kan skapa en säker uppgiftsbegäran.",
    };
  }

  return {
    ok: false,
    status: "error",
    title: "Åtgärden kunde inte startas",
    message: `${fallback} Referens: ${traceId}`,
  };
}

export function customerDataRequestActionState(job: Awaited<ReturnType<typeof enqueueCustomerDataRequestAutomation>>, customerId: string): CustomerOperationActionState {
  if (job.redirectedToManualFacilityRequest) {
    const decision = job.intakeDecision;
    const waiting = decision?.nextAction === "wait_for_grid_owner";
    return {
      ok: waiting,
      status: waiting ? "started" : "warning",
      title: waiting
        ? "Anläggningsuppgifter begärs från nätägaren"
        : "Anläggningsuppgifter saknas",
      message: decision?.adminMessage
        ?? "Anläggnings-ID saknas. Uppgifter begärs från nätägaren via e-post innan uppgiftsbegäran kan skickas.",
      jobId: typeof job.id === "string" ? job.id : undefined,
      actionUrl: `/admin/customers/${customerId}?tab=sites`,
    };
  }
  if (!job.duplicate) {
    return {
      ok: true,
      status: "started",
      title: "Uppgiftsbegäran startad",
      message: "Systemet analyserar anläggningsadressen och söker nätägare i bakgrunden.",
      jobId: job.id,
      actionUrl: `/admin/customers/${customerId}?tab=data-requests`,
    };
  }

  const result = job.result ?? {};
  const blockerCode =
    typeof result.reason_code === "string"
      ? result.reason_code
      : typeof result.blocker_code === "string"
        ? result.blocker_code
        : null;
  const nextAction =
    typeof result.next_required_action === "string"
      ? result.next_required_action
      : null;
  const reason =
    typeof result.blocker_reason === "string"
      ? result.blocker_reason
      : typeof result.reason === "string"
        ? result.reason
        : job.lastError;

  if (job.status === "queued") {
    return {
      ok: true,
      status: "started",
      title: "Uppgiftsbegäran ligger i kö",
      message: "Systemet har redan köat uppgiftsbegäran och fortsätter automatiskt.",
      jobId: job.id,
      actionUrl: `/admin/customers/${customerId}?tab=data-requests`,
    };
  }
  if (job.status === "running") {
    return {
      ok: true,
      status: "started",
      title: "Uppgiftsbegäran körs",
      message: "Systemet arbetar med uppgiftsbegäran just nu.",
      jobId: job.id,
      actionUrl: `/admin/customers/${customerId}?tab=data-requests`,
    };
  }
  if (job.status === "waiting_response") {
    return {
      ok: true,
      status: "started",
      title: "Svar inväntas",
      message: "Begäran är förberedd eller skickad och systemet väntar på kvittens eller svar från nätägaren.",
      jobId: job.id,
      actionUrl: `/admin/customers/${customerId}?tab=data-requests`,
    };
  }

  return {
    ok: false,
    status: "warning",
    title: customerBlockerStatusLabel(blockerCode),
    message: [
      reason ? `Stopporsak: ${reason}.` : null,
      blockerCode ? `Blockerarkod: ${blockerCode}.` : null,
      nextAction ? `Nästa åtgärd: ${nextAction}` : null,
    ].filter(Boolean).join(" ") || "Uppgiftsbegäran behöver granskas innan den kan fortsätta.",
    jobId: job.id,
    actionUrl: `/admin/customers/${customerId}?tab=data-requests`,
  };
}

export async function startAutomaticOnboardingAction(
  _previousState: CustomerOperationActionState,
  formData: FormData,
): Promise<CustomerOperationActionState> {
  try {
    const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
    const customerId = normalizeUuidOrNull(formValue(formData, "customer_id"), "customer_id");
    const siteId = normalizeUuidOrNull(formValue(formData, "site_id"), "customer_site_id");
    const meteringPointId = normalizeUuidOrNull(
      formValue(formData, "metering_point_id"),
      "metering_point_id",
    );

    if (!customerId || !siteId) {
      return {
        ok: false,
        status: "blocked",
        title: "Uppgiftsbegäran kan inte startas ännu",
        message: "Välj först en kund och en anläggning.",
      };
    }

    const { companyId } = await requireCustomerMutationContext(customerId, guard);
    await assertCustomerSiteTenant({ companyId, customerId, siteId });
    if (meteringPointId) {
      await assertMeteringPointTenant({ companyId, customerId, siteId, meteringPointId });
    }

    const job = await enqueueCustomerDataRequestAutomation({
      companyId,
      customerId,
      siteId,
      meteringPointId,
      actorUserId: guard.userId,
    });

    // Cron fortsätter idempotent om den omedelbara körningen inte hinner slutföra steget.
    // Vid redirect till manuell nätägarbegäran finns inget jobb att processa.
    if (!job.redirectedToManualFacilityRequest) {
      after(() =>
        processCustomerOperationJobs({
          workerId: `customer-card:${job.id}`,
          limit: 1,
        }).catch((error) => console.error("[customer-operation] background start failed", error)),
      );
    }

    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/events");
    revalidatePath("/admin/work-queue");
    revalidatePath("/admin/customer-info-requests");

    return customerDataRequestActionState(job, customerId);
  } catch (error) {
    return customerOperationActionError(error, "Kontrollera kundens anläggningsuppgifter och försök igen.");
  }
}

export async function requestSupplierSwitchAutomationAction(
  _previousState: CustomerOperationActionState,
  formData: FormData,
): Promise<CustomerOperationActionState> {
  try {
    const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
    const customerId = normalizeUuidOrNull(formValue(formData, "customer_id"), "customer_id");
    const siteId = normalizeUuidOrNull(formValue(formData, "site_id"), "customer_site_id");
    const meteringPointId = normalizeUuidOrNull(
      formValue(formData, "metering_point_id"),
      "metering_point_id",
    );

    if (!customerId || !siteId) {
      return {
        ok: false,
        status: "blocked",
        title: "Leverantörsbyte kan inte startas ännu",
        message: "Välj först en kund och en anläggning.",
      };
    }

    const { companyId } = await requireCustomerMutationContext(customerId, guard);
    await assertCustomerSiteTenant({ companyId, customerId, siteId });
    if (meteringPointId) {
      await assertMeteringPointTenant({ companyId, customerId, siteId, meteringPointId });
    }

    const job = await enqueueSupplierSwitchAutomation({
      companyId,
      customerId,
      siteId,
      meteringPointId,
      actorUserId: guard.userId,
    });

    if (!job.redirectedToManualFacilityRequest) {
      after(() =>
        processCustomerOperationJobs({
          workerId: `customer-switch:${job.id}`,
          limit: 1,
        }).catch((error) => console.error("[customer-operation] switch background start failed", error)),
      );
    }

    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/events");
    revalidatePath("/admin/work-queue");
    revalidatePath("/admin/operations/switches");

    if (job.redirectedToManualFacilityRequest) {
      return {
        ok: false,
        status: "blocked",
        title: "Leverantörsbyte kan inte starta ännu",
        message:
          job.intakeDecision?.adminMessage ??
          "Leverantörsbyte kan inte starta förrän anläggningsuppgifter finns. Uppgifter begärs från nätägaren.",
        jobId: typeof job.id === "string" ? job.id : undefined,
        actionUrl: `/admin/customers/${customerId}?tab=sites`,
      };
    }

    return {
      ok: true,
      status: "started",
      title: job.duplicate ? "Leverantörsbyte kontrolleras redan" : "Kontroll av leverantörsbyte startad",
      message: job.duplicate
        ? "Systemet fortsätter den befintliga kontrollen för anläggningen."
        : "Systemet kontrollerar mätpunkt, nätägare, fullmakt och avtal i bakgrunden.",
      jobId: job.id,
      actionUrl: `/admin/customers/${customerId}?tab=supplier-switch`,
    };
  } catch (error) {
    return customerOperationActionError(error, "Kontrollera anläggning, mätpunkt och fullmakt innan du försöker igen.");
  }
}

export async function updateOperationTaskStatusAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const customerId = formValue(formData, "customer_id") ?? "";
  const taskId = formValue(formData, "task_id") ?? "";
  const status = formValue(formData, "status") ?? "open";

  if (!customerId || !taskId) {
    throw new Error("Kund eller uppgift saknas.");
  }

  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  const { data: task, error: taskError } = await supabaseService
    .from("customer_operation_tasks")
    .select("id, company_id, customer_id")
    .eq("id", taskId)
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .maybeSingle();

  if (taskError) throw taskError;
  if (!task) throw new Error("Uppgiften tillhör inte kunden eller bolaget.");

  const payload: Record<string, unknown> = {
    status,
    updated_by: actor.id,
  };

  if (status === "done") {
    payload.resolved_at = new Date().toISOString();
  } else {
    payload.resolved_at = null;
  }

  const { data, error } = await supabaseService
    .from("customer_operation_tasks")
    .update(payload)
    .eq("id", taskId)
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .select("*")
    .single();

  if (error) throw error;

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "customer_operation_task",
    entityId: taskId,
    action: "customer_operation_task_status_updated",
    newValues: data,
    metadata: {
      customerId,
      taskId,
      status,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/tasks");
}

export async function createAndQueueCustomerMasterdataZ01(params: {
  actorUserId: string;
  companyId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string | null;
  gridOwnerId: string | null;
  externalReference: string | null;
  notes: string | null;
}) {
  const legalPayload = await prepareLegalPayloadForGridOwner({
    companyId: params.companyId,
    customerId: params.customerId,
    siteId: params.siteId,
  });

  const infoRequest = await createCustomerInfoRequest({
    companyId: params.companyId,
    actorUserId: params.actorUserId,
    customerId: params.customerId,
    siteId: params.siteId,
    meteringPointId: params.meteringPointId,
    gridOwnerId: params.gridOwnerId,
    requestType: "z01_customer_masterdata",
    targetPartyType: "grid_owner",
    targetPartyName: null,
    currentSupplierName: null,
    externalReference: params.externalReference,
    requestedDataCategories: [
      "facility_id",
      "grid_area",
      "annual_consumption",
      "network_contract",
      "customer_masterdata",
    ],
    notes: params.notes,
  });

  await recordCustomerActionResult({
    actorUserId: params.actorUserId,
    companyId: params.companyId,
    customerId: params.customerId,
    siteId: params.siteId,
    eventType: legalPayload.ok
      ? "legal_documents.attached_to_request"
      : "legal_documents.missing",
    title: legalPayload.ok
      ? "Juridiskt underlag kopplat"
      : "Juridiskt underlag saknas",
    message: legalPayload.ok
      ? "Fullmakt och juridiska godkännanden kopplas till uppgiftsbegäran."
      : `Uppgiftsbegäran skapades men saknar: ${legalPayload.missing.join(", ")}.`,
    payload: { request_id: infoRequest.id, legal: legalPayload },
    idempotencyKey: `legal_documents.grid_owner_request:${infoRequest.id}`,
  });

  return queueCustomerInfoRequestForDispatch({
    companyId: infoRequest.company_id,
    actorUserId: params.actorUserId,
    requestId: infoRequest.id,
  });
}
