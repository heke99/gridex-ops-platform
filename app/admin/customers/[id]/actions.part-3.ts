// Extracted from actions.ts; keep public imports on the facade module.
import { revalidatePath } from "next/cache"


import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireAdminActionAccess } from "@/lib/admin/guards"
import { assertCustomerSiteTenant, assertMeteringPointTenant, assertPowerOfAttorneyTenant } from "@/lib/tenant/entityGuards"
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions"


import { supabaseService } from "@/lib/supabase/service"

import { findCustomerSiteById, listCustomerAuthorizationDocumentsByCustomerId, listMeteringPointsForSite, syncCustomerOperationsForCustomer, syncCustomerOperationsForSite } from "@/lib/operations/db"


import { createGridOwnerDataRequest, createOutboundRequest, findOpenOutboundBySource, updateGridOwnerDataRequestStatus } from "@/lib/cis/db"

import { createCustomerInfoRequest, queueCustomerInfoRequestForDispatch } from "@/lib/onboarding/infoRequests"
import { createMissingPowerOfAttorneyBlocker, ensureAuthorizationScopeFromPowerOfAttorney, getLatestSignedPowerOfAttorneyForCustomer, getSignedPowerOfAttorneyCoverage, resolveCustomerBlockersAfterSignedPowerOfAttorney } from "@/lib/operations/powerOfAttorneyWorkflow"
import { routeDecisionPayload } from "@/lib/routes/routeDecisionEngine"








import { resolveCustomerSiteGridOwner } from "@/lib/customer-operations/automation"
import { reconcileSupplierSwitchAfterCustomerDataChange } from "@/lib/customer-operations/supplierSwitchOrchestration"
import { normalizeUuidOrNull } from "@/lib/validation/uuid"


import type { JsonObject } from './actions.part-1'
import { auditRouteDecisionForCustomerAction, createCustomerActionTask, customerHasMeterValuesAccess, formValue, formatDocumentReference, insertAuditLog, mapGridOwnerRequestScopeToOutboundType, messageCodeForBusinessProcess, normalizeDataRequestTarget, normalizeDateOrNull, normalizeGridOwnerRequestScope, normalizeNumberOrNull, normalizeSimpleRequestStatus, normalizeSupplierResponseStatus, objectValue, recordCustomerActionResult, resolveActionGridOwnerId, toBoolean, validateHistoricalMeteringPeriod } from './actions.part-1'
import { createAndQueueCustomerMasterdataZ01 } from './actions.part-2'
import { requireCustomerMutationContext } from './actions.part-4'

export async function createGridOwnerDataRequestAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();
  const customerId = normalizeUuidOrNull(formValue(formData, "customer_id"), "customer_id");

  if (!customerId) {
    throw new Error("Customer ID saknas");
  }

  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  const siteId = normalizeUuidOrNull(formValue(formData, "site_id"), "customer_site_id");
  const meteringPointId = normalizeUuidOrNull(
    formValue(formData, "metering_point_id"),
    "metering_point_id",
  );
  await assertCustomerSiteTenant({ companyId, customerId, siteId });
  await assertMeteringPointTenant({
    companyId,
    customerId,
    siteId,
    meteringPointId,
  });
  const rawGridOwnerId = normalizeUuidOrNull(formValue(formData, "grid_owner_id"), "grid_owner_id");
  const requestScope = normalizeGridOwnerRequestScope(
    formValue(formData, "request_scope"),
  );
  const gridOwnerId = await resolveActionGridOwnerId({
    companyId,
    customerId,
    siteId,
    meteringPointId,
    explicitGridOwnerId: rawGridOwnerId,
  });
  const requestedPeriodStart = normalizeDateOrNull(
    formValue(formData, "requested_period_start"),
  );
  const requestedPeriodEnd = normalizeDateOrNull(
    formValue(formData, "requested_period_end"),
  );
  const externalReference = formValue(formData, "external_reference") || null;
  const notes = formValue(formData, "notes") || null;
  const requestedAction =
    formValue(formData, "business_action") ||
    (requestScope === "customer_masterdata"
      ? "request_customer_masterdata"
      : `request_${requestScope}`);
  validateHistoricalMeteringPeriod({
    requestedAction,
    startDate: requestedPeriodStart,
    endDate: requestedPeriodEnd,
  });

  const routeDecision = await auditRouteDecisionForCustomerAction({
    actorUserId: actor.id,
    companyId,
    customerId,
    siteId,
    meteringPointId,
    gridOwnerId,
    businessProcess: requestScope,
    requestedAction,
    messageCode: messageCodeForBusinessProcess(requestScope, requestedAction),
    payload: {
      requestedPeriodStart,
      requestedPeriodEnd,
      externalReference,
      notes,
    },
  });

  if (routeDecision.decisionStatus === "blocked") {
    await recordCustomerActionResult({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      eventType: "customer_data.needs_review",
      title: "Nätägare behöver granskas",
      message:
        "Uppgifter kan inte skickas automatiskt förrän nätägare och kontaktväg är verifierade.",
      payload: { decision: routeDecisionPayload(routeDecision) },
      idempotencyKey: `customer_data.needs_review:${customerId}:${siteId}:route`,
    });
    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/operations");
    revalidatePath("/admin/operations/tasks");
    return;
  }

  if (requestScope === "meter_values") {
    const access = await customerHasMeterValuesAccess({
      companyId,
      customerId,
      siteId,
      meteringPointId,
    });
    if (!access.ok) {
      await createCustomerActionTask({
        actorUserId: actor.id,
        companyId,
        customerId,
        siteId,
        meteringPointId,
        taskType: "meter_values_access_missing",
        title: "Saknar godkänd mätvärdesåtkomst",
        description:
          access.reason ??
          "Mätvärden kan inte hämtas utan aktiv leveransrelation eller godkänd mätvärdesåtkomst.",
        metadata: {
          requestScope,
          requestedAction,
          routeDecision: routeDecisionPayload(routeDecision),
        },
      });
      await insertAuditLog({
        actorUserId: actor.id,
        entityType: "customer",
        entityId: customerId,
        action: "meter_values_request_blocked_missing_access",
        metadata: {
          customerId,
          siteId,
          meteringPointId,
          gridOwnerId,
          reason: access.reason,
        },
      });
      revalidatePath(`/admin/customers/${customerId}`);
      revalidatePath("/admin/operations");
      revalidatePath("/admin/operations/tasks");
      return;
    }
  }

  if (requestScope === "customer_masterdata") {
    await createAndQueueCustomerMasterdataZ01({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      meteringPointId,
      gridOwnerId,
      externalReference,
      notes,
    });

    const syncSummary = await syncCustomerOperationsForCustomer(
      supabase,
      customerId,
    );
    await insertAuditLog({
      actorUserId: actor.id,
      entityType: "customer_info_request",
      entityId: customerId,
      action: "customer_masterdata_z01_prepared",
      newValues: {
        customerId,
        siteId,
        meteringPointId,
        gridOwnerId,
        externalReference,
      },
      metadata: { syncSummary },
    });

    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/customer-info-requests");
    revalidatePath("/admin/operations");
    revalidatePath("/admin/operations/tasks");
    revalidatePath("/admin/outbound");
    revalidatePath("/admin/outbound/unresolved");
    revalidatePath("/admin/ediel");
    return;
  }

  const saved = await createGridOwnerDataRequest({
    actorUserId: actor.id,
    customerId,
    siteId,
    meteringPointId,
    gridOwnerId,
    requestScope,
    requestedPeriodStart,
    requestedPeriodEnd,
    externalReference,
    notes,
  });

  const existingOutbound = await findOpenOutboundBySource({
    sourceType: "grid_owner_data_request",
    sourceId: saved.id,
    requestType: mapGridOwnerRequestScopeToOutboundType(
      saved.request_scope,
      requestedAction,
    ),
  });

  let outbound = existingOutbound;

  if (!outbound) {
    outbound = await createOutboundRequest({
      actorUserId: actor.id,
      customerId,
      siteId: saved.site_id,
      meteringPointId: saved.metering_point_id,
      gridOwnerId: saved.grid_owner_id,
      requestType: mapGridOwnerRequestScopeToOutboundType(
        saved.request_scope,
        requestedAction,
      ),
      sourceType: "grid_owner_data_request",
      sourceId: saved.id,
      payload: {
        queuedFrom: "customer_data_request_create",
        requestScope: saved.request_scope,
        requestId: saved.id,
        requestedPeriodStart: saved.requested_period_start,
        requestedPeriodEnd: saved.requested_period_end,
        notes: saved.notes ?? null,
      },
      periodStart: saved.requested_period_start ?? null,
      periodEnd: saved.requested_period_end ?? null,
      externalReference: saved.external_reference ?? null,
    });
  }

  const syncSummary = await syncCustomerOperationsForCustomer(
    supabase,
    customerId,
  );

  await updateGridOwnerDataRequestStatus({
    actorUserId: actor.id,
    requestId: saved.id,
    status: outbound.status === "sent" ? "sent" : "pending",
    externalReference:
      saved.external_reference ?? outbound.external_reference ?? null,
    responsePayload: {
      outboundRequestId: outbound.id,
      outboundStatus: outbound.status,
      outboundChannelType: outbound.channel_type,
      communicationRouteId: outbound.communication_route_id,
      queuedAutomatically: true,
    },
    notes: saved.notes ?? null,
  });

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "grid_owner_data_request",
    entityId: saved.id,
    action: "grid_owner_data_request_created",
    newValues: saved,
    metadata: {
      customerId,
      siteId: saved.site_id,
      meteringPointId: saved.metering_point_id,
      requestScope: saved.request_scope,
      outboundRequestId: outbound.id,
      syncSummary,
    },
  });

  await recordCustomerActionResult({
    actorUserId: actor.id,
    companyId,
    customerId,
    siteId: saved.site_id,
    eventType: "customer_data.request_sent",
    title: "Uppgifter begärda",
    message:
      "Systemet har skapat en uppgiftsbegäran och skickar den när kontaktvägen är redo.",
    payload: {
      grid_owner_data_request_id: saved.id,
      outbound_request_id: outbound.id,
      request_scope: saved.request_scope,
    },
    idempotencyKey: `customer_data.request_sent:${saved.id}`,
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/metering");
  revalidatePath("/admin/billing");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/tasks");
  revalidatePath("/admin/outbound");
  revalidatePath("/admin/outbound/unresolved");
  revalidatePath("/admin/ediel");
}

export async function createAuthorizationRequestPackageAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();
  const customerId = formValue(formData, "customer_id") ?? "";
  const siteId = formValue(formData, "site_id") || null;
  const selectedDocumentId =
    formValue(formData, "authorization_document_id") || null;

  if (!customerId || !siteId) {
    throw new Error("Customer eller anläggning saknas för request-paketet");
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

  const [documents, meteringPoints] = await Promise.all([
    listCustomerAuthorizationDocumentsByCustomerId(supabase, customerId, {
      companyId,
    }),
    listMeteringPointsForSite(supabase, siteId),
  ]);

  const authorizationDocument =
    documents.find(
      (row) => row.id === selectedDocumentId && row.site_id === siteId,
    ) ??
    documents.find(
      (row) => row.id === selectedDocumentId && row.site_id === null,
    ) ??
    documents.find((row) => row.site_id === siteId) ??
    documents.find((row) => row.site_id === null) ??
    null;

  if (!authorizationDocument) {
    throw new Error(
      "Ingen uppladdad fullmakt eller avtal hittades att skicka med",
    );
  }

  const preferredMeteringPoint =
    meteringPoints.find((row) => row.status === "active") ??
    meteringPoints.find((row) => row.status === "pending_validation") ??
    meteringPoints[0] ??
    null;

  const requestNotes = formValue(formData, "notes") || null;
  const requestReference = formValue(formData, "external_reference") || null;
  const requestedPeriodStart = normalizeDateOrNull(
    formValue(formData, "requested_period_start"),
  );
  const requestedPeriodEnd = normalizeDateOrNull(
    formValue(formData, "requested_period_end"),
  );

  const requestPayload = {
    authorizationDocument: formatDocumentReference(authorizationDocument),
    customerId,
    siteId,
    siteName: site.site_name,
    facilityId: site.facility_id,
    meterPointId: preferredMeteringPoint?.meter_point_id ?? null,
    currentSupplierName: site.current_supplier_name,
    currentSupplierOrgNumber: site.current_supplier_org_number,
    requestIntent: "authorization_document_request_package",
    notes: requestNotes,
  };

  const createdGridOwnerRequests: string[] = [];

  const maybeCreateGridOwnerRequest = async (
    scope: "customer_masterdata" | "meter_values" | "billing_underlay",
    enabled: boolean,
  ) => {
    if (!enabled) return;

    if (scope === "customer_masterdata") {
      const result = await createAndQueueCustomerMasterdataZ01({
        actorUserId: actor.id,
        companyId,
        customerId,
        siteId,
        meteringPointId: preferredMeteringPoint?.id ?? null,
        gridOwnerId:
          preferredMeteringPoint?.grid_owner_id ?? site.grid_owner_id ?? null,
        externalReference: requestReference,
        notes: requestNotes
          ? `${requestNotes}\n\nBilaga: ${authorizationDocument.file_path}`
          : `Bilaga: ${authorizationDocument.file_path}`,
      });
      if (result.gridOwnerDataRequestId)
        createdGridOwnerRequests.push(result.gridOwnerDataRequestId);
      return;
    }

    const saved = await createGridOwnerDataRequest({
      actorUserId: actor.id,
      customerId,
      siteId,
      meteringPointId: preferredMeteringPoint?.id ?? null,
      gridOwnerId:
        preferredMeteringPoint?.grid_owner_id ?? site.grid_owner_id ?? null,
      requestScope: scope,
      requestedPeriodStart,
      requestedPeriodEnd,
      externalReference: requestReference,
      notes: requestNotes
        ? `${requestNotes}\n\nBilaga: ${authorizationDocument.file_path}`
        : `Bilaga: ${authorizationDocument.file_path}`,
    });

    const outbound = await createOutboundRequest({
      actorUserId: actor.id,
      customerId,
      siteId: saved.site_id,
      meteringPointId: saved.metering_point_id,
      gridOwnerId: saved.grid_owner_id,
      requestType: mapGridOwnerRequestScopeToOutboundType(
        saved.request_scope,
        null,
      ),
      sourceType: "grid_owner_data_request",
      sourceId: saved.id,
      payload: {
        ...requestPayload,
        requestScope: saved.request_scope,
        gridOwnerDataRequestId: saved.id,
      },
      periodStart: saved.requested_period_start ?? null,
      periodEnd: saved.requested_period_end ?? null,
      externalReference: saved.external_reference ?? null,
    });

    await updateGridOwnerDataRequestStatus({
      actorUserId: actor.id,
      requestId: saved.id,
      status: outbound.status === "sent" ? "sent" : "pending",
      externalReference:
        saved.external_reference ?? outbound.external_reference ?? null,
      responsePayload: {
        outboundRequestId: outbound.id,
        authorizationDocumentId: authorizationDocument.id,
        queuedAutomatically: true,
      },
      notes: saved.notes ?? null,
    });

    createdGridOwnerRequests.push(saved.id);
  };

  await maybeCreateGridOwnerRequest(
    "customer_masterdata",
    toBoolean(formData, "include_customer_masterdata"),
  );
  await maybeCreateGridOwnerRequest(
    "meter_values",
    toBoolean(formData, "include_meter_values"),
  );
  await maybeCreateGridOwnerRequest(
    "billing_underlay",
    toBoolean(formData, "include_billing_underlay"),
  );

  let currentSupplierOutboundId: string | null = null;

  if (toBoolean(formData, "include_current_supplier_request")) {
    const outbound = await createOutboundRequest({
      actorUserId: actor.id,
      customerId,
      siteId,
      meteringPointId: preferredMeteringPoint?.id ?? null,
      gridOwnerId:
        preferredMeteringPoint?.grid_owner_id ?? site.grid_owner_id ?? null,
      requestType: "current_supplier_contract_information_request",
      sourceType: "manual",
      payload: {
        ...requestPayload,
        requestScope: "current_supplier_information_request",
        supplierName: site.current_supplier_name,
        supplierOrgNumber: site.current_supplier_org_number,
        authorizationDocumentId: authorizationDocument.id,
      },
      externalReference: requestReference,
    });

    currentSupplierOutboundId = outbound.id;
  }

  const syncSummary = await syncCustomerOperationsForSite(supabase, {
    customerId,
    siteId,
  });

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "customer_authorization_document",
    entityId: authorizationDocument.id,
    action: "authorization_request_package_created",
    metadata: {
      customerId,
      siteId,
      authorizationDocumentId: authorizationDocument.id,
      gridOwnerRequestIds: createdGridOwnerRequests,
      currentSupplierOutboundId,
      syncSummary,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/tasks");
  revalidatePath("/admin/outbound");
  revalidatePath("/admin/outbound/unresolved");
}

export async function createCustomerDataRequestPackageAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const customerId = normalizeUuidOrNull(formValue(formData, "customer_id"), "customer_id");

  if (!customerId) {
    throw new Error("Kund saknas.");
  }

  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  const target = normalizeDataRequestTarget(
    formValue(formData, "request_target"),
  );
  const siteId = normalizeUuidOrNull(formValue(formData, "site_id"), "customer_site_id");
  const meteringPointId = normalizeUuidOrNull(
    formValue(formData, "metering_point_id"),
    "metering_point_id",
  );
  let gridOwnerId = normalizeUuidOrNull(formValue(formData, "grid_owner_id"), "grid_owner_id");
  const externalReference = formValue(formData, "external_reference") || null;
  const notes = formValue(formData, "notes") || null;
  const selectedPowerOfAttorneyId =
    normalizeUuidOrNull(formValue(formData, "power_of_attorney_id"), "power_of_attorney_id");
  await assertCustomerSiteTenant({ companyId, customerId, siteId });
  await assertMeteringPointTenant({
    companyId,
    customerId,
    siteId,
    meteringPointId,
  });
  await assertPowerOfAttorneyTenant({
    companyId,
    customerId,
    powerOfAttorneyId: selectedPowerOfAttorneyId,
  });

  if (!gridOwnerId && siteId) {
    const site = await findCustomerSiteById(supabaseService, siteId);
    if (
      site &&
      site.company_id === companyId &&
      site.customer_id === customerId
    ) {
      const resolution = await resolveCustomerSiteGridOwner({
        companyId,
        customerId,
        siteId,
        actorUserId: actor.id,
      });
      gridOwnerId = resolution.state === "verified" ? resolution.result.gridOwnerId : null;
    }
  }

  const signedPowerOfAttorney = selectedPowerOfAttorneyId
    ? await supabaseService
        .from("powers_of_attorney")
        .select("*")
        .eq("id", selectedPowerOfAttorneyId)
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .eq("status", "signed")
        .maybeSingle()
        .then((result: { data: unknown; error: unknown }) => {
          if (result.error) throw result.error;
          return result.data;
        })
    : await getLatestSignedPowerOfAttorneyForCustomer({
        companyId,
        customerId,
        siteId,
      });

  if (!signedPowerOfAttorney) {
    await recordCustomerActionResult({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      eventType: "customer_data.blocked",
      title: "Fullmakt saknas",
      message: "Begäran stoppas tills signerad fullmakt finns.",
      payload: { target },
      idempotencyKey: `customer_data.blocked:${customerId}:${siteId ?? "customer"}:poa`,
    });
    const blockerId = await createMissingPowerOfAttorneyBlocker({
      companyId,
      actorUserId: actor.id,
      customerId,
      siteId,
      meteringPointId,
      title: "Saknar signerad fullmakt",
      description:
        "Begäran är stoppad. Ladda upp eller verifiera signerad fullmakt innan uppgifter begärs från nätägare eller nuvarande leverantör.",
      metadata: {
        requestedTarget: target,
        requestedAt: new Date().toISOString(),
      },
    });

    await insertAuditLog({
      actorUserId: actor.id,
      entityType: "customer_info_request",
      entityId: customerId,
      action: "customer_data_request_blocked_missing_power_of_attorney",
      metadata: {
        customerId,
        companyId,
        siteId,
        meteringPointId,
        target,
        blockerId,
      },
    });

    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/customer-info-requests");
    return;
  }

  const signedPowerOfAttorneyRecord = signedPowerOfAttorney as Record<string, unknown>;
  const signedPowerOfAttorneyId = String(signedPowerOfAttorneyRecord.id ?? "");

  if (!signedPowerOfAttorneyId) {
    await recordCustomerActionResult({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      eventType: "customer_data.blocked",
      title: "Fullmakt saknar referens",
      message: "Begäran stoppas eftersom den signerade fullmakten saknar teknisk referens.",
      payload: { target },
    });

    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/customer-info-requests");
    return;
  }

  const signedCoverage = await getSignedPowerOfAttorneyCoverage({
    companyId,
    customerId,
    powerOfAttorneyId: signedPowerOfAttorneyId,
  });
  if (!signedCoverage) {
    await recordCustomerActionResult({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      eventType: "customer_data.blocked",
      title: "Fullmaktens omfattning saknas",
      message: "Begäran stoppas eftersom signerad fullmaktsscope inte kan verifieras.",
      payload: { target, powerOfAttorneyId: signedPowerOfAttorneyId },
    });
    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/customer-info-requests");
    return;
  }

  const requiredGridOwnerData = target === "grid_owner" || target === "both";
  const requiredCurrentSupplierContract =
    target === "current_supplier" || target === "both";
  if (
    (requiredGridOwnerData && !signedCoverage.coverage.coversGridOwnerData) ||
    (requiredCurrentSupplierContract &&
      !signedCoverage.coverage.coversCurrentSupplierContract)
  ) {
    await recordCustomerActionResult({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      eventType: "customer_data.blocked",
      title: "Fullmakten täcker inte begäran",
      message: "Begäran stoppas eftersom den ligger utanför kundens signerade fullmakt.",
      payload: { target, signedScopes: signedCoverage.signedScopes },
    });
    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/customer-info-requests");
    return;
  }

  const authorizationScopeId =
    await ensureAuthorizationScopeFromPowerOfAttorney({
      companyId,
      actorUserId: actor.id,
      customerId,
      powerOfAttorneyId: signedPowerOfAttorneyId,
      authorizationDocumentId: null,
      coverage: signedCoverage.coverage,
      signedScopes: signedCoverage.signedScopes,
      validFrom:
        (signedPowerOfAttorneyRecord.valid_from as string | null | undefined) ??
        null,
      validTo:
        (signedPowerOfAttorneyRecord.valid_to as string | null | undefined) ??
        null,
      evidenceNote:
        "Signerad fullmakt användes för uppgiftsbegäran från kundkortet.",
    });

  const blockerResult = await resolveCustomerBlockersAfterSignedPowerOfAttorney(
    {
      companyId,
      actorUserId: actor.id,
      customerId,
      siteId,
      powerOfAttorneyId: signedPowerOfAttorneyId,
    },
  );

  const createdRequestIds: string[] = [];
  const dispatchResults: Array<{
    requestId: string;
    status: string;
    blockerReason: string | null;
  }> = [];

  if (requiredGridOwnerData) {
    const request = await createCustomerInfoRequest({
      companyId,
      actorUserId: actor.id,
      customerId,
      siteId,
      meteringPointId,
      gridOwnerId,
      requestType: "z01_customer_masterdata",
      targetPartyType: "grid_owner",
      requestedDataCategories: [
        "facility_id",
        "grid_area",
        "annual_consumption",
        "network_contract",
        "customer_masterdata",
      ],
      externalReference,
      notes:
        notes ??
        "Begäran om kund- och anläggningsuppgifter. Systemet hanterar teknisk sändning när kontaktväg finns.",
    });

    createdRequestIds.push(request.id);
    const dispatch = await queueCustomerInfoRequestForDispatch({
      companyId,
      actorUserId: actor.id,
      requestId: request.id,
    });
    dispatchResults.push({
      requestId: request.id,
      status: normalizeSimpleRequestStatus(dispatch.status),
      blockerReason: dispatch.blockerReason,
    });
  }

  if (requiredCurrentSupplierContract) {
    const request = await createCustomerInfoRequest({
      companyId,
      actorUserId: actor.id,
      customerId,
      siteId,
      meteringPointId,
      gridOwnerId,
      requestType: "current_supplier_contract_info",
      targetPartyType: "current_supplier",
      targetPartyName: formValue(formData, "current_supplier_name") || null,
      currentSupplierName: formValue(formData, "current_supplier_name") || null,
      requestedDataCategories: [
        "current_supplier",
        "binding_period",
        "termination_notice",
        "contract_end_date",
        "break_fee",
      ],
      externalReference,
      notes:
        notes ??
        "Manuell begäran till nuvarande leverantör. Fullmakt ska bifogas vid kontakt.",
    });

    createdRequestIds.push(request.id);
    const dispatch = await queueCustomerInfoRequestForDispatch({
      companyId,
      actorUserId: actor.id,
      requestId: request.id,
    });
    dispatchResults.push({
      requestId: request.id,
      status: normalizeSimpleRequestStatus(dispatch.status),
      blockerReason: dispatch.blockerReason,
    });
  }

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "customer_info_request",
    entityId: customerId,
    action: "customer_data_request_package_created",
    newValues: {
      target,
      requestIds: createdRequestIds,
      dispatchResults,
    },
    metadata: {
      companyId,
      customerId,
      siteId,
      meteringPointId,
      gridOwnerId,
      authorizationScopeId,
      powerOfAttorneyId: signedPowerOfAttorneyId,
      resolvedPowerOfAttorneyBlockers: blockerResult.resolved,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customer-info-requests");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/outbound");
  revalidatePath("/admin/ediel");
}

export async function registerCurrentSupplierResponseAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const customerId = normalizeUuidOrNull(formValue(formData, "customer_id"), "customer_id");
  const siteId = normalizeUuidOrNull(formValue(formData, "site_id"), "customer_site_id");
  const requestId = normalizeUuidOrNull(
    formValue(formData, "customer_info_request_id"),
    "customer_info_request_id",
  );

  if (!customerId || !siteId) {
    throw new Error("Kund och anläggning krävs för leverantörssvar.");
  }

  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  await assertCustomerSiteTenant({ companyId, customerId, siteId });

  const responseStatus = normalizeSupplierResponseStatus(
    formValue(formData, "response_status"),
  );
  const contractEndDate = normalizeDateOrNull(
    formValue(formData, "contract_end_date"),
  );
  const noticePeriod = formValue(formData, "notice_period") || null;
  const terminationFee = normalizeNumberOrNull(
    formValue(formData, "termination_fee"),
  );
  const recommendedSwitchDate = normalizeDateOrNull(
    formValue(formData, "recommended_switch_date"),
  );
  const responseNotes = formValue(formData, "response_notes") || null;

  const updatePayload: Record<string, unknown> = {
    current_supplier_response_status: responseStatus,
    current_supplier_contract_status: responseStatus,
    current_supplier_contract_end_date: contractEndDate,
    current_supplier_notice_period: noticePeriod,
    current_supplier_termination_fee: terminationFee,
    updated_by: actor.id,
    updated_at: new Date().toISOString(),
  };

  const { data: site, error: siteError } = await supabaseService
    .from("customer_sites")
    .update(updatePayload)
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .eq("id", siteId)
    .select("*")
    .single();

  if (siteError) throw siteError;

  const responsePayload = {
    responseStatus,
    contractEndDate,
    noticePeriod,
    terminationFee,
    recommendedSwitchDate,
    responseNotes,
    registeredAt: new Date().toISOString(),
    registeredBy: actor.id,
  };

  if (requestId) {
    const { data: request, error: requestError } = await supabaseService
      .from("customer_info_requests")
      .select("id, verified_payload, target_party_type, request_type")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .eq("id", requestId)
      .maybeSingle();

    if (requestError) throw requestError;
    if (!request)
      throw new Error("Uppgiftsbegäran tillhör inte kunden eller bolaget.");

    const requestPayload = objectValue(
      (request as JsonObject).verified_payload,
    );
    const nextStatus =
      responseStatus === "waiting_response"
        ? "manual_review_required"
        : "completed";
    const blockerReason =
      responseStatus === "blocked"
        ? "Nuvarande leverantör har svarat att bytet kräver manuell kontroll."
        : responseStatus === "binding_period"
          ? "Bindningstid finns. Kontrollera bytesdatum innan leverantörsbyte begärs."
          : responseStatus === "termination_fee"
            ? "Brytavgift finns. Informera kund och kontrollera beslut innan leverantörsbyte begärs."
            : null;

    const { error: updateRequestError } = await supabaseService
      .from("customer_info_requests")
      .update({
        status: nextStatus,
        received_at: new Date().toISOString(),
        blocker_reason: blockerReason,
        verified_payload: {
          ...requestPayload,
          currentSupplierResponse: responsePayload,
        },
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("id", requestId);

    if (updateRequestError) throw updateRequestError;

    await supabaseService.from("customer_info_request_events").insert({
      company_id: companyId,
      customer_info_request_id: requestId,
      customer_id: customerId,
      event_type: "current_supplier_response_registered",
      message:
        "Svar från nuvarande leverantör registrerades och preflight uppdaterades.",
      payload: responsePayload,
      created_by: actor.id,
    });
  }

  const syncSummary = await syncCustomerOperationsForSite(supabaseService, {
    customerId,
    siteId,
  });
  const supplierSwitchReconcile = await reconcileSupplierSwitchAfterCustomerDataChange({
    companyId,
    customerId,
    siteId,
    actorUserId: actor.id,
    source: "current_supplier_response_registered",
  }).catch((error) => {
    console.warn("Supplier switch reconcile after supplier response failed", error);
    return null;
  });

  if (
    ["binding_period", "termination_fee", "blocked"].includes(responseStatus)
  ) {
    await createCustomerActionTask({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      meteringPointId: null,
      taskType: "current_supplier_contract_risk",
      title: "Kontrollera nuvarande leverantör före byte",
      description:
        responseStatus === "blocked"
          ? "Nuvarande leverantör har markerat att bytet kräver manuell kontroll."
          : responseStatus === "termination_fee"
            ? "Brytavgift finns. Säkerställ kundens godkännande innan leverantörsbyte skickas."
            : "Bindningstid finns. Kontrollera bytesdatum innan leverantörsbyte skickas.",
      metadata: responsePayload,
    });
  }

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "customer_site",
    entityId: siteId,
    action: "current_supplier_response_registered",
    newValues: site,
    metadata: {
      customerId,
      companyId,
      requestId,
      response: responsePayload,
      syncSummary,
      supplierSwitchReconcile,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customer-info-requests");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/tasks");
}
