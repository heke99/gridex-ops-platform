"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdminActionAccess } from "@/lib/admin/guards";
import {
  assertBillingUnderlayTenant,
  assertContractTenant,
  assertCustomerSiteTenant,
  assertMeteringPointTenant,
  assertPowerOfAttorneyTenant,
  loadCustomerTenantContext,
} from "@/lib/tenant/entityGuards";
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions";
import {
  getCustomerSiteById,
  getMeteringPointById,
  saveCustomerSite,
  saveMeteringPoint,
} from "@/lib/masterdata/db";
import {
  customerSiteInputSchema,
  meteringPointInputSchema,
  parseCheckbox,
} from "@/lib/masterdata/validators";
import { supabaseService } from "@/lib/supabase/service";
import {
  createSupplierSwitchRequest,
  findCustomerSiteById,
  findOpenSupplierSwitchRequestForSite,
  listCustomerAuthorizationDocumentsByCustomerId,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  saveCustomerAuthorizationDocument,
  savePowerOfAttorney,
  syncCustomerOperationsForCustomer,
  syncCustomerOperationsForSite,
  syncOperationTasksFromReadiness,
} from "@/lib/operations/db";
import { evaluateSiteSwitchReadiness } from "@/lib/operations/readiness";
import type {
  CustomerAuthorizationDocumentRow,
  SupplierSwitchRequestType,
} from "@/lib/operations/types";
import {
  createGridOwnerDataRequest,
  createPartnerExport,
  createOutboundRequest,
  findOpenOutboundBySource,
  updateGridOwnerDataRequestStatus,
} from "@/lib/cis/db";
import type { OutboundRequestType } from "@/lib/cis/types";
import {
  createCustomerInfoRequest,
  queueCustomerInfoRequestForDispatch,
} from "@/lib/onboarding/infoRequests";
import {
  createMissingPowerOfAttorneyBlocker,
  ensureAuthorizationScopeFromPowerOfAttorney,
  getLatestSignedPowerOfAttorneyForCustomer,
  resolveCustomerBlockersAfterSignedPowerOfAttorney,
} from "@/lib/operations/powerOfAttorneyWorkflow";
import {
  decideCommunicationRoute,
  routeDecisionPayload,
} from "@/lib/routes/routeDecisionEngine";
import { createMissingCustomerDataTasks } from "@/lib/customers/dataTasks";
import type { BusinessProcess } from "@/lib/routes/routeDecisionTypes";
import { actionPreflight } from "@/lib/operations/businessActions/actionPreflight";
import { startSupplierSwitch } from "@/lib/operations/businessActions/startSupplierSwitch";
import {
  logAdminActionAndUsage,
  logUsageEvent,
} from "@/lib/audit/actionLogger";
import {
  emitCustomerOperationEvent,
  blockerText,
} from "@/lib/customers/customerOperationEvents";
import { prepareLegalPayloadForGridOwner } from "@/lib/legal/gridOwnerLegalPayload";

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  return value;
}

function normalizeUuidOrNull(value: string | null): string | null {
  if (!value) return null;
  return value;
}

function normalizePriceAreaOrNull(
  value: string | null,
): "SE1" | "SE2" | "SE3" | "SE4" | null {
  if (!value) return null;
  if (
    value === "SE1" ||
    value === "SE2" ||
    value === "SE3" ||
    value === "SE4"
  ) {
    return value;
  }
  return null;
}

function normalizeDateOrNull(value: string | null): string | null {
  if (!value) return null;
  return value;
}

function validateHistoricalMeteringPeriod(params: {
  requestedAction: string;
  startDate: string | null;
  endDate: string | null;
}) {
  if (params.requestedAction !== "request_historical_metering_access") return;
  if (!params.startDate || !params.endDate) {
    throw new Error("Historisk begäran kräver både startdatum och slutdatum.");
  }

  const start = new Date(`${params.startDate.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${params.endDate.slice(0, 10)}T00:00:00.000Z`);
  const yesterday = new Date();
  yesterday.setUTCHours(0, 0, 0, 0);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const oldest = new Date(yesterday);
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 3);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Historisk period har ogiltigt datumformat.");
  }
  if (start > yesterday || end > yesterday) {
    throw new Error("Historisk period måste sluta senast igår.");
  }
  if (end < start) {
    throw new Error(
      "Slutdatum måste vara samma dag eller senare än startdatum.",
    );
  }
  if (start < oldest) {
    throw new Error("Historisk period får vara högst tre år bakåt.");
  }
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function tryAutoResolveGridOwnerForSite(params: {
  companyId: string;
  customerId: string;
  site: Record<string, unknown>;
  actorUserId: string;
}): Promise<string | null> {
  if (params.site.grid_owner_id) return String(params.site.grid_owner_id);

  const city = textOf(params.site.city);
  const postalCode = textOf(params.site.postal_code).replace(/\s+/g, "");
  const priceAreaCode = textOf(params.site.price_area_code).toUpperCase();
  if (!city && !postalCode && !priceAreaCode) return null;

  const { data, error } = await supabaseService
    .from("platform_grid_areas")
    .select("*")
    .limit(2000);

  if (error || !Array.isArray(data)) return null;

  const rows = data as Array<Record<string, unknown>>;
  const match = rows.find((row) => {
    const rowPriceArea = textOf(
      row.price_area_code ?? row.bidding_zone ?? row.elomrade,
    ).toUpperCase();
    const rowCity = textOf(
      row.city ?? row.municipality ?? row.municipality_name ?? row.locality,
    );
    const rowPostal = textOf(
      row.postal_code ?? row.postal_code_prefix ?? row.zip_code,
    ).replace(/\s+/g, "");
    const priceOk =
      !priceAreaCode || !rowPriceArea || rowPriceArea === priceAreaCode;
    const cityOk = city && rowCity ? rowCity === city : false;
    const postalOk =
      postalCode && rowPostal
        ? postalCode.startsWith(rowPostal) || rowPostal.startsWith(postalCode)
        : false;
    return priceOk && (cityOk || postalOk);
  });

  const gridOwnerId =
    match?.grid_owner_id ??
    match?.owner_id ??
    match?.market_actor_id ??
    match?.actor_id ??
    null;
  if (!gridOwnerId) return null;

  const resolvedGridOwnerId = String(gridOwnerId);
  const { error: updateError } = await supabaseService
    .from("customer_sites")
    .update({
      grid_owner_id: resolvedGridOwnerId,
      resolution_status: "grid_owner_suggested",
      data_quality_status: "needs_review",
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(params.site.id))
    .eq("company_id", params.companyId)
    .eq("customer_id", params.customerId);

  if (updateError) return resolvedGridOwnerId;

  await recordCustomerActionResult({
    actorUserId: params.actorUserId,
    companyId: params.companyId,
    customerId: params.customerId,
    siteId: String(params.site.id),
    eventType: "facility.grid_owner_suggested",
    title: "Nätägare föreslagen automatiskt",
    message:
      "Systemet hittade en möjlig nätägare baserat på adress, postnummer, ort och elområde. Granska förslaget innan leverantörsbyte startas.",
    payload: {
      grid_owner_id: resolvedGridOwnerId,
      source: "customer_card_auto_resolver",
    },
    idempotencyKey: `facility.grid_owner_suggested:${params.customerId}:${String(params.site.id)}:${resolvedGridOwnerId}`,
  });

  return resolvedGridOwnerId;
}

function normalizeNumberOrNull(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSupplierResponseStatus(value: string | null): string {
  if (value === "free_to_switch") return "free_to_switch";
  if (value === "binding_period") return "binding_period";
  if (value === "termination_fee") return "termination_fee";
  if (value === "blocked") return "blocked";
  if (value === "waiting_response") return "waiting_response";
  return "manual_review";
}

function normalizeSwitchRequestType(
  value: string | null,
): SupplierSwitchRequestType {
  if (value === "move_in") return "move_in";
  if (value === "move_out_takeover") return "move_out_takeover";
  return "switch";
}

function normalizeGridOwnerRequestScope(value: string | null): BusinessProcess {
  if (value === "billing_underlay") return "billing_underlay";
  if (value === "customer_masterdata") return "customer_masterdata";
  if (value === "metering_access") return "metering_access";
  if (value === "supplier_switch") return "supplier_switch";
  if (value === "partner_export") return "partner_export";
  return "meter_values";
}

function normalizeDataRequestTarget(
  value: string | null,
): "grid_owner" | "current_supplier" | "both" {
  if (value === "current_supplier") return "current_supplier";
  if (value === "both") return "both";
  return "grid_owner";
}

function normalizeSimpleRequestStatus(value: string): string {
  switch (value) {
    case "z01_prepared":
    case "ready_to_send":
      return "ready_to_send";
    case "sent_to_grid_owner":
    case "sent":
      return "sent";
    case "waiting_for_contrl":
    case "waiting_for_aperak":
    case "waiting_for_z02":
    case "manual_review_required":
      return "waiting_response";
    case "z02_received":
    case "completed":
      return "received";
    case "negative_aperak":
    case "rejected":
      return "rejected";
    case "route_missing":
    case "blocked":
    case "missing_authorization":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "draft";
  }
}

function normalizePartnerExportKind(
  value: string | null,
): "billing_underlay" | "meter_values" | "customer_snapshot" {
  if (value === "meter_values") return "meter_values";
  if (value === "customer_snapshot") return "customer_snapshot";
  return "billing_underlay";
}

async function resolveActionGridOwnerId(params: {
  companyId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string | null;
  explicitGridOwnerId: string | null;
}): Promise<string | null> {
  if (params.explicitGridOwnerId) return params.explicitGridOwnerId;

  if (params.meteringPointId) {
    const point = await getMeteringPointById(
      supabaseService,
      params.meteringPointId,
      {
        companyId: params.companyId,
      },
    );
    if (point?.grid_owner_id) return point.grid_owner_id;
  }

  if (params.siteId) {
    const site = await getCustomerSiteById(supabaseService, params.siteId, {
      companyId: params.companyId,
    });
    if (site?.grid_owner_id) return site.grid_owner_id;
  }

  return null;
}

function messageCodeForBusinessProcess(
  process: BusinessProcess,
  action?: string | null,
): string | null {
  if (process === "customer_masterdata") return "Z01";
  if (process === "supplier_switch") return "Z03";
  if (process === "metering_access")
    return action === "terminate_metering_access" ? "Z18" : "Z13";
  return null;
}

async function auditRouteDecisionForCustomerAction(params: {
  actorUserId: string;
  companyId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string | null;
  gridOwnerId: string | null;
  currentSupplierId?: string | null;
  businessProcess: BusinessProcess;
  requestedAction: string;
  messageCode?: string | null;
  payload?: Record<string, unknown>;
}) {
  const decision = await decideCommunicationRoute({
    companyId: params.companyId,
    customerId: params.customerId,
    siteId: params.siteId,
    meteringPointId: params.meteringPointId,
    gridOwnerId: params.gridOwnerId,
    currentSupplierId: params.currentSupplierId ?? null,
    businessProcess: params.businessProcess,
    requestedAction: params.requestedAction,
    messageFamily:
      params.businessProcess === "meter_values" ||
      params.businessProcess === "billing_underlay"
        ? "UTILTS"
        : "PRODAT",
    messageCode:
      params.messageCode ??
      messageCodeForBusinessProcess(
        params.businessProcess,
        params.requestedAction,
      ),
    environment: "test",
    payload: params.payload ?? {},
    actorUserId: params.actorUserId,
  });

  await insertAuditLog({
    actorUserId: params.actorUserId,
    entityType: "customer",
    entityId: params.customerId,
    action: "customer_business_route_decision",
    newValues: routeDecisionPayload(decision),
    metadata: {
      customerId: params.customerId,
      companyId: params.companyId,
      siteId: params.siteId,
      meteringPointId: params.meteringPointId,
      gridOwnerId: params.gridOwnerId,
      currentSupplierId: params.currentSupplierId ?? null,
      requestedAction: params.requestedAction,
      businessProcess: params.businessProcess,
    },
  });

  return decision;
}

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function normalizeEdielMeteringMethod(
  value: string | null,
): "Z01" | "Z02" | "Z03" | "Z04" | null {
  if (value === "Z01" || value === "Z02" || value === "Z03" || value === "Z04")
    return value;
  return null;
}

async function applyEdielMeteringMethodToSwitchSnapshots(params: {
  actorUserId: string;
  companyId: string;
  customerId: string;
  siteId: string;
  meteringPointId: string;
  edielMeteringMethod: "Z01" | "Z02" | "Z03" | "Z04" | null;
}): Promise<{ updated: number }> {
  if (!params.edielMeteringMethod) return { updated: 0 };

  const { data: requests, error } = await supabaseService
    .from("supplier_switch_requests")
    .select("id,validation_snapshot")
    .eq("company_id", params.companyId)
    .eq("customer_id", params.customerId)
    .eq("site_id", params.siteId)
    .eq("metering_point_id", params.meteringPointId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) throw error;

  let updated = 0;

  for (const request of requests ?? []) {
    const snapshot = objectValue((request as JsonObject).validation_snapshot);
    const portalData = objectValue(snapshot.portalData);
    const testCaseOverrides = objectValue(portalData.testCaseOverrides);
    const nextSnapshot = {
      ...snapshot,
      portalData: {
        ...portalData,
        meteringMethod: params.edielMeteringMethod,
        testCaseOverrides: {
          ...testCaseOverrides,
          meteringMethod: params.edielMeteringMethod,
        },
      },
      edielMeteringMethodOverride: {
        value: params.edielMeteringMethod,
        source: "customer_metering_point_form",
        updatedAt: new Date().toISOString(),
        updatedBy: params.actorUserId,
      },
    };

    const { error: updateError } = await supabaseService
      .from("supplier_switch_requests")
      .update({
        validation_snapshot: nextSnapshot,
        updated_by: params.actorUserId,
      })
      .eq("id", String((request as JsonObject).id));

    if (updateError) throw updateError;
    updated += 1;
  }

  return { updated };
}

function mapGridOwnerRequestScopeToOutboundType(
  value: string | null | undefined,
  action?: string | null,
): OutboundRequestType {
  if (value === "billing_underlay") return "billing_underlay";
  if (value === "customer_masterdata") return "customer_masterdata";
  if (value === "metering_access") {
    return action === "terminate_metering_access"
      ? "metering_access_termination"
      : "metering_access_request";
  }
  if (value === "supplier_switch") return "switch_information_request";
  if (value === "partner_export") return "partner_export";
  if (value === "ediel_ack") return "ediel_ack";
  return "meter_values_request";
}

async function customerHasMeterValuesAccess(params: {
  companyId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string | null;
}): Promise<{ ok: boolean; reason: string | null }> {
  const switchQuery = supabaseService
    .from("supplier_switch_requests")
    .select("id,status")
    .eq("company_id", params.companyId)
    .eq("customer_id", params.customerId)
    .in("status", ["accepted", "completed"])
    .limit(1);

  if (params.siteId) switchQuery.eq("site_id", params.siteId);
  if (params.meteringPointId)
    switchQuery.eq("metering_point_id", params.meteringPointId);

  const { data: switchRows, error: switchError } = await switchQuery;
  if (
    switchError &&
    !["42P01", "42703", "PGRST205"].includes(
      String((switchError as { code?: string }).code ?? ""),
    )
  )
    throw switchError;
  if ((switchRows ?? []).length > 0) return { ok: true, reason: null };

  const permissionQuery = supabaseService
    .from("metering_permissions")
    .select("id,status")
    .eq("company_id", params.companyId)
    .eq("customer_id", params.customerId)
    .in("status", ["approved", "active", "partially_approved", "z14_received"])
    .limit(1);

  if (params.siteId) permissionQuery.eq("site_id", params.siteId);
  if (params.meteringPointId)
    permissionQuery.eq("metering_point_id", params.meteringPointId);

  const { data: permissionRows, error: permissionError } =
    await permissionQuery;
  if (
    permissionError &&
    !["42P01", "42703", "PGRST205"].includes(
      String((permissionError as { code?: string }).code ?? ""),
    )
  )
    throw permissionError;
  if ((permissionRows ?? []).length > 0) return { ok: true, reason: null };

  return {
    ok: false,
    reason: "Saknar godkänd mätvärdesåtkomst eller aktiv leveransrelation.",
  };
}

async function createCustomerActionTask(params: {
  actorUserId: string;
  companyId: string;
  customerId: string;
  siteId: string | null;
  meteringPointId: string | null;
  taskType: string;
  title: string;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabaseService
    .from("customer_operation_tasks")
    .insert({
      company_id: params.companyId,
      customer_id: params.customerId,
      site_id: params.siteId,
      metering_point_id: params.meteringPointId,
      task_type: params.taskType,
      status: "open",
      priority: "high",
      title: params.title,
      description: params.description,
      metadata: params.metadata ?? {},
      created_by: params.actorUserId,
      updated_by: params.actorUserId,
    });

  if (
    error &&
    !["42P01", "42703", "PGRST205"].includes(
      String((error as { code?: string }).code ?? ""),
    )
  )
    throw error;
}

function sanitizeFileName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
}

function buildCustomerDocumentPath(params: {
  customerId: string;
  siteId: string | null;
  documentType: "power_of_attorney" | "complete_agreement";
  fileName: string;
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const scope = params.siteId ? `site-${params.siteId}` : "customer";
  return `${params.customerId}/${scope}/${params.documentType}/${stamp}_${sanitizeFileName(params.fileName)}`;
}

function toBoolean(formData: FormData, key: string): boolean {
  return parseCheckbox(formData.get(key));
}

function formatDocumentReference(
  doc: CustomerAuthorizationDocumentRow,
): Record<string, unknown> {
  return {
    id: doc.id,
    type: doc.document_type,
    title: doc.title,
    filePath: doc.file_path,
    storageBucket: doc.storage_bucket,
    reference: doc.reference,
    uploadedAt: doc.uploaded_at,
  };
}

async function insertAuditLog(params: {
  actorUserId: string;
  entityType: string;
  entityId: string;
  action: string;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: unknown;
  companyId?: string | null;
  customerId?: string | null;
  billable?: boolean;
}) {
  const metadata =
    params.metadata &&
    typeof params.metadata === "object" &&
    !Array.isArray(params.metadata)
      ? (params.metadata as Record<string, unknown>)
      : { value: params.metadata ?? null };
  const companyId =
    params.companyId ??
    (typeof metadata.companyId === "string" ? metadata.companyId : null);
  const customerId =
    params.customerId ??
    (typeof metadata.customerId === "string"
      ? metadata.customerId
      : params.entityType === "customer"
        ? params.entityId
        : null);

  await logAdminActionAndUsage({
    actorUserId: params.actorUserId,
    companyId,
    customerId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    oldValues: params.oldValues,
    newValues: params.newValues,
    metadata,
    billable: params.billable ?? isBillableCustomerAction(params.action),
    billingUnit: isBillableCustomerAction(params.action)
      ? "admin_action"
      : "audit_only",
    source: "customer_card",
  });
}

async function recordCustomerActionResult(params: {
  actorUserId: string;
  companyId: string;
  customerId: string;
  siteId?: string | null;
  eventType: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
}) {
  await emitCustomerOperationEvent({
    companyId: params.companyId,
    customerId: params.customerId,
    actorUserId: params.actorUserId,
    eventType: params.eventType,
    title: params.title,
    message: params.message,
    aggregateType: params.siteId ? "customer_site" : "customer",
    aggregateId: params.siteId ?? params.customerId,
    source: "customer_card",
    payload: params.payload ?? {},
    idempotencyKey: params.idempotencyKey ?? null,
  });
}

function isBillableCustomerAction(action: string): boolean {
  return new Set([
    "customer_site_created",
    "customer_site_updated",
    "metering_point_created",
    "metering_point_updated",
    "supplier_switch_request_created",
    "grid_owner_data_request_created",
    "partner_export_created",
    "power_of_attorney_scope_created",
    "customer_withdrawal_registered",
    "customer_rejection_registered",
  ]).has(action);
}

export async function saveCustomerSiteAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess({
    anyOf: ["sites.write", "customers.write"],
  });
  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();
  const customerId = formValue(formData, "customer_id") ?? "";
  const siteId = formValue(formData, "id") || undefined;
  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  const siteFlowType = normalizeSwitchRequestType(
    formValue(formData, "site_flow_type"),
  );

  const before = siteId
    ? await getCustomerSiteById(supabase, siteId, { companyId })
    : null;
  if (siteId && (!before || before.customer_id !== customerId)) {
    throw new Error("Anläggningen tillhör inte kunden eller bolaget.");
  }

  const moveInDate = normalizeDateOrNull(formValue(formData, "move_in_date"));
  const street = formValue(formData, "street") || undefined;
  const postalCode = formValue(formData, "postal_code") || undefined;
  const city = formValue(formData, "city") || undefined;

  let movedFromStreet = formValue(formData, "moved_from_street") || undefined;
  let movedFromPostalCode =
    formValue(formData, "moved_from_postal_code") || undefined;
  let movedFromCity = formValue(formData, "moved_from_city") || undefined;
  let movedFromSupplierName =
    formValue(formData, "moved_from_supplier_name") || undefined;

  if (siteFlowType === "move_in" || siteFlowType === "move_out_takeover") {
    if (!moveInDate) {
      throw new Error("Inflytt eller övertag kräver datum");
    }

    if (!street) {
      throw new Error("Inflytt eller övertag kräver gatuadress");
    }

    if (!postalCode) {
      throw new Error("Inflytt eller övertag kräver postnummer");
    }

    if (!city) {
      throw new Error("Inflytt eller övertag kräver stad");
    }
  } else {
    movedFromStreet = undefined;
    movedFromPostalCode = undefined;
    movedFromCity = undefined;
    movedFromSupplierName = undefined;
  }

  let selectedGridOwnerId = normalizeUuidOrNull(
    formValue(formData, "grid_owner_id"),
  );
  const newGridOwnerName = (
    formValue(formData, "new_grid_owner_name") ?? ""
  ).trim();
  const newGridOwnerEdielId =
    (formValue(formData, "new_grid_owner_ediel_id") ?? "").trim() || null;
  const newGridOwnerOrgNumber =
    (formValue(formData, "new_grid_owner_org_number") ?? "").trim() || null;

  if (!selectedGridOwnerId && newGridOwnerName) {
    let existingGridOwner: { id: string } | null = null;

    if (newGridOwnerEdielId) {
      const { data, error } = await supabaseService
        .from("grid_owners")
        .select("id")
        .eq("ediel_id", newGridOwnerEdielId)
        .limit(1)
        .maybeSingle();
      if (
        error &&
        !["42P01", "42703", "PGRST205"].includes(
          String((error as { code?: string }).code ?? ""),
        )
      )
        throw error;
      existingGridOwner = (data as { id: string } | null) ?? null;
    }

    if (!existingGridOwner && newGridOwnerOrgNumber) {
      const { data, error } = await supabaseService
        .from("grid_owners")
        .select("id")
        .eq("org_number", newGridOwnerOrgNumber)
        .limit(1)
        .maybeSingle();
      if (
        error &&
        !["42P01", "42703", "PGRST205"].includes(
          String((error as { code?: string }).code ?? ""),
        )
      )
        throw error;
      existingGridOwner = (data as { id: string } | null) ?? null;
    }

    if (!existingGridOwner) {
      const { data, error } = await supabaseService
        .from("grid_owners")
        .insert({
          company_id: companyId,
          name: newGridOwnerName,
          owner_code: newGridOwnerEdielId ?? `NY-${Date.now()}`,
          org_number: newGridOwnerOrgNumber,
          ediel_id: newGridOwnerEdielId,
          email: formValue(formData, "new_grid_owner_email") || null,
          phone: formValue(formData, "new_grid_owner_phone") || null,
          notes:
            formValue(formData, "new_grid_owner_notes") ||
            "Skapad från kundkort/anläggning.",
          is_active: true,
          created_by: actor.id,
          updated_by: actor.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      existingGridOwner = data as { id: string };
    }

    selectedGridOwnerId = existingGridOwner.id;
  }

  const parsed = customerSiteInputSchema.parse({
    id: siteId,
    company_id: companyId,
    customer_id: customerId,
    site_name: formValue(formData, "site_name") ?? "",
    facility_id: formValue(formData, "facility_id") || undefined,
    site_type: formValue(formData, "site_type") ?? "consumption",
    status: formValue(formData, "status") ?? "draft",
    grid_owner_id: selectedGridOwnerId,
    price_area_code: normalizePriceAreaOrNull(
      formValue(formData, "price_area_code"),
    ),
    move_in_date: moveInDate || undefined,
    annual_consumption_kwh: formValue(formData, "annual_consumption_kwh"),
    current_supplier_name:
      formValue(formData, "current_supplier_name") || undefined,
    current_supplier_org_number:
      formValue(formData, "current_supplier_org_number") || undefined,
    street,
    care_of: formValue(formData, "care_of") || undefined,
    postal_code: postalCode,
    city,
    country: formValue(formData, "country") || "SE",
    moved_from_street: movedFromStreet,
    moved_from_postal_code: movedFromPostalCode,
    moved_from_city: movedFromCity,
    moved_from_supplier_name: movedFromSupplierName,
    internal_notes: formValue(formData, "internal_notes") || undefined,
  });

  const savedSite = await saveCustomerSite(supabase, parsed);

  await createMissingCustomerDataTasks({
    companyId,
    customerId,
    customerSiteId: savedSite.id,
    facilityId: savedSite.facility_id,
    gridOwnerId: savedSite.grid_owner_id,
    actorUserId: actor.id,
  });

  const readiness = await syncCustomerOperationsForSite(supabase, {
    customerId,
    siteId: savedSite.id,
  });

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "customer_site",
    entityId: savedSite.id,
    action: before ? "customer_site_updated" : "customer_site_created",
    oldValues: before,
    newValues: savedSite,
    metadata: {
      customerId,
      companyId,
      siteId: savedSite.id,
      siteFlowType,
      readiness,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/tasks");
}

export async function saveMeteringPointAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess({
    anyOf: ["metering_points.write", "metering.write", "customers.write"],
  });
  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();
  const customerId = formValue(formData, "customer_id") ?? "";
  const meteringPointRowId = formValue(formData, "id") || undefined;
  const { companyId } = await requireCustomerMutationContext(customerId, guard);

  const before = meteringPointRowId
    ? await getMeteringPointById(supabase, meteringPointRowId, { companyId })
    : null;
  if (meteringPointRowId && !before) {
    throw new Error("Mätpunkten tillhör inte kunden eller bolaget.");
  }

  const meterPointIdentifier =
    formValue(formData, "meter_point_id")?.trim() ||
    formValue(formData, "metering_point_id")?.trim() ||
    "";

  const siteId = formValue(formData, "site_id") || before?.site_id || "";
  const site = siteId
    ? await getCustomerSiteById(supabase, siteId, { companyId })
    : null;
  if (!site || site.customer_id !== customerId) {
    throw new Error("Vald anläggning tillhör inte kunden eller bolaget.");
  }
  if (before && before.site_id !== siteId) {
    throw new Error(
      "Mätpunkten kan inte flyttas till en annan anläggning via detta formulär.",
    );
  }

  const parsedResult = meteringPointInputSchema.safeParse({
    id: meteringPointRowId,
    company_id: companyId,
    customer_id: customerId,
    site_id: siteId,
    meter_point_id: meterPointIdentifier,
    site_facility_id: formValue(formData, "site_facility_id") || undefined,
    ediel_reference: formValue(formData, "ediel_reference") || undefined,
    status: formValue(formData, "status") ?? "draft",
    measurement_type: formValue(formData, "measurement_type") ?? "consumption",
    reading_frequency: formValue(formData, "reading_frequency") ?? "hourly",
    grid_owner_id: normalizeUuidOrNull(formValue(formData, "grid_owner_id")),
    price_area_code: normalizePriceAreaOrNull(
      formValue(formData, "price_area_code"),
    ),
    start_date: formValue(formData, "start_date") || undefined,
    end_date: formValue(formData, "end_date") || undefined,
    is_settlement_relevant: parseCheckbox(
      formData.get("is_settlement_relevant"),
    ),
  });

  if (!parsedResult.success) {
    const details = parsedResult.error.issues
      .map(
        (issue: { path: Array<string | number>; message: string }) =>
          `${issue.path.join(".") || "fält"}: ${issue.message}`,
      )
      .join("; ");
    throw new Error(
      `Kunde inte spara mätpunkten. Kontrollera formuläret. ${details}`,
    );
  }

  const parsed = parsedResult.data;

  const savedMeteringPoint = await saveMeteringPoint(supabase, parsed);

  await createMissingCustomerDataTasks({
    companyId,
    customerId,
    customerSiteId: savedMeteringPoint.site_id,
    meteringPointId: savedMeteringPoint.id,
    facilityId: savedMeteringPoint.site_facility_id,
    meterPointId: savedMeteringPoint.meter_point_id,
    gridOwnerId: savedMeteringPoint.grid_owner_id,
    actorUserId: actor.id,
  });

  const edielMeteringMethod = normalizeEdielMeteringMethod(
    formValue(formData, "ediel_metering_method"),
  );
  const edielMeteringMethodSync =
    await applyEdielMeteringMethodToSwitchSnapshots({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId: savedMeteringPoint.site_id,
      meteringPointId: savedMeteringPoint.id,
      edielMeteringMethod,
    });

  const readiness = await syncCustomerOperationsForSite(supabase, {
    customerId,
    siteId: savedMeteringPoint.site_id,
  });

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "metering_point",
    entityId: savedMeteringPoint.id,
    action: before ? "metering_point_updated" : "metering_point_created",
    oldValues: before,
    newValues: savedMeteringPoint,
    metadata: {
      customerId,
      companyId,
      siteId: savedMeteringPoint.site_id,
      meteringPointId: savedMeteringPoint.id,
      meterPointIdentifier,
      readiness,
      edielMeteringMethod,
      edielMeteringMethodSync,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/tasks");
}

export async function createCustomerInternalNoteAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const customerId = formValue(formData, "customer_id") ?? "";
  const body = (formValue(formData, "body") ?? "").trim();

  if (!customerId || !body) {
    throw new Error("Customer ID eller anteckning saknas");
  }

  const { companyId } = await requireCustomerMutationContext(customerId, guard);

  const { data, error } = await supabaseService
    .from("customer_internal_notes")
    .insert({
      company_id: companyId,
      customer_id: customerId,
      body,
      created_by: actor.id,
      updated_by: actor.id,
    })
    .select("*")
    .single();

  if (error) throw error;

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "customer_internal_note",
    entityId: data.id,
    action: "customer_internal_note_created",
    newValues: data,
    metadata: {
      customerId,
      companyId,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
}

export async function createPowerOfAttorneyAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();
  const customerId = formValue(formData, "customer_id") ?? "";
  const powerOfAttorneyId = formValue(formData, "id") || undefined;
  const siteId = formValue(formData, "site_id") || null;

  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  await assertCustomerSiteTenant({ companyId, customerId, siteId });
  await assertPowerOfAttorneyTenant({
    companyId,
    customerId,
    powerOfAttorneyId,
  });

  const saved = await savePowerOfAttorney(supabase, {
    id: powerOfAttorneyId,
    customer_id: customerId,
    site_id: siteId,
    scope:
      (formValue(formData, "scope") as
        | "supplier_switch"
        | "meter_data"
        | "billing_handoff") ?? "supplier_switch",
    status:
      (formValue(formData, "status") as
        | "draft"
        | "sent"
        | "signed"
        | "expired"
        | "revoked") ?? "draft",
    signed_at:
      formValue(formData, "status") === "signed"
        ? new Date().toISOString()
        : null,
    valid_from: normalizeDateOrNull(formValue(formData, "valid_from")),
    valid_to: normalizeDateOrNull(formValue(formData, "valid_to")),
    document_path: formValue(formData, "document_path") || null,
    reference: formValue(formData, "reference") || null,
    notes: formValue(formData, "notes") || null,
    companyId,
  });

  const syncSummary = saved.site_id
    ? await syncCustomerOperationsForSite(supabase, {
        customerId,
        siteId: saved.site_id,
      })
    : await syncCustomerOperationsForCustomer(supabase, customerId);

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "power_of_attorney",
    entityId: saved.id,
    action: "power_of_attorney_saved",
    newValues: saved,
    metadata: {
      customerId,
      siteId: saved.site_id,
      syncSummary,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/tasks");
}

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
    const savedPowerOfAttorney = await savePowerOfAttorney(supabase, {
      customer_id: customerId,
      site_id: siteId,
      scope: "supplier_switch",
      status: markAsSigned ? "signed" : "sent",
      signed_at: markAsSigned ? new Date().toISOString() : null,
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

export async function startAutomaticOnboardingAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();
  const customerId = formValue(formData, "customer_id") ?? "";
  const siteId = formValue(formData, "site_id") ?? "";

  if (!customerId || !siteId) {
    throw new Error("Kund eller anläggning saknas för automatisk onboarding.");
  }

  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  await assertCustomerSiteTenant({ companyId, customerId, siteId });
  const site = await findCustomerSiteById(supabase, siteId);

  if (
    !site ||
    site.company_id !== companyId ||
    site.customer_id !== customerId
  ) {
    throw new Error(
      "Anläggningen kunde inte hittas för automatisk onboarding.",
    );
  }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabase, siteId),
    listPowersOfAttorneyByCustomerId(supabase, customerId),
  ]);

  const candidateMeteringPoint =
    meteringPoints.find((point) => point.status === "active") ??
    meteringPoints.find((point) => point.status === "pending_validation") ??
    meteringPoints[0] ??
    null;

  const autoResolvedGridOwnerId =
    (candidateMeteringPoint?.grid_owner_id ?? site.grid_owner_id)
      ? null
      : await tryAutoResolveGridOwnerForSite({
          companyId,
          customerId,
          site: site as unknown as Record<string, unknown>,
          actorUserId: actor.id,
        });
  const effectiveGridOwnerId =
    candidateMeteringPoint?.grid_owner_id ??
    site.grid_owner_id ??
    autoResolvedGridOwnerId;

  const missingMasterdata =
    !site.facility_id?.trim() ||
    !candidateMeteringPoint?.meter_point_id?.trim() ||
    !effectiveGridOwnerId ||
    !(candidateMeteringPoint?.price_area_code ?? site.price_area_code);

  if (missingMasterdata) {
    const gridOwnerId = effectiveGridOwnerId ?? null;

    await createMissingCustomerDataTasks({
      companyId,
      customerId,
      customerSiteId: siteId,
      meteringPointId: candidateMeteringPoint?.id ?? null,
      facilityId: site.facility_id ?? null,
      meterPointId: candidateMeteringPoint?.meter_point_id ?? null,
      gridOwnerId,
      actorUserId: actor.id,
    });

    await recordCustomerActionResult({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      eventType: "customer_data.requested",
      title: "Uppgifter behöver kompletteras",
      message:
        "Systemet saknar anläggnings-ID, mätpunkt eller nätägare och skapar nästa uppgift automatiskt.",
      payload: {
        facility_id: site.facility_id ?? null,
        meter_point_id: candidateMeteringPoint?.meter_point_id ?? null,
        grid_owner_id: gridOwnerId,
      },
      idempotencyKey: `customer_data.requested:${customerId}:${siteId}`,
    });

    const decision = await auditRouteDecisionForCustomerAction({
      actorUserId: actor.id,
      companyId,
      customerId,
      siteId,
      meteringPointId: candidateMeteringPoint?.id ?? null,
      gridOwnerId,
      businessProcess: "customer_masterdata",
      requestedAction: "automatic_onboarding_customer_data_first",
      messageCode: messageCodeForBusinessProcess("customer_masterdata"),
      payload: {
        reason: "missing_masterdata_before_supplier_switch",
        facilityId: site.facility_id,
        meterPointId: candidateMeteringPoint?.meter_point_id ?? null,
      },
    });

    if (decision.decisionStatus !== "blocked") {
      await createAndQueueCustomerMasterdataZ01({
        actorUserId: actor.id,
        companyId,
        customerId,
        siteId,
        meteringPointId: candidateMeteringPoint?.id ?? null,
        gridOwnerId,
        externalReference: null,
        notes:
          "Systemet förberedde begäran om saknade kund- och anläggningsuppgifter.",
      });
    }

    await insertAuditLog({
      actorUserId: actor.id,
      entityType: "customer_site",
      entityId: siteId,
      action:
        decision.decisionStatus === "blocked"
          ? "automatic_onboarding_blocked"
          : "automatic_onboarding_z01_prepared",
      metadata: {
        customerId,
        siteId,
        meteringPointId: candidateMeteringPoint?.id ?? null,
        decision: routeDecisionPayload(decision),
      },
    });

    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/customer-info-requests");
    revalidatePath("/admin/operations");
    revalidatePath("/admin/operations/tasks");
    revalidatePath("/admin/outbound");
    return;
  }

  const readiness = evaluateSiteSwitchReadiness({
    site,
    meteringPoints,
    powersOfAttorney,
  });
  await syncOperationTasksFromReadiness(supabase, readiness);

  if (!readiness.isReady || !readiness.candidateMeteringPointId) {
    await insertAuditLog({
      actorUserId: actor.id,
      entityType: "customer_site",
      entityId: siteId,
      action: "automatic_onboarding_switch_blocked_by_readiness",
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
    throw new Error(
      "Kunde inte hitta kandidat-mätpunkt för automatisk onboarding.",
    );
  }

  const requestType: SupplierSwitchRequestType = site.move_in_date
    ? "move_in"
    : "switch";
  const decision = await auditRouteDecisionForCustomerAction({
    actorUserId: actor.id,
    companyId,
    customerId,
    siteId,
    meteringPointId: meteringPoint.id,
    gridOwnerId: meteringPoint.grid_owner_id ?? site.grid_owner_id ?? null,
    currentSupplierId: site.current_supplier_id ?? null,
    businessProcess: "supplier_switch",
    requestedAction: "automatic_onboarding_direct_z03",
    messageCode: messageCodeForBusinessProcess("supplier_switch"),
    payload: {
      requestType,
      requestedStartDate: site.move_in_date ?? null,
      move_in: requestType === "move_in",
      customer_change: requestType === "move_in",
    },
  });

  if (decision.decisionStatus === "blocked") {
    await insertAuditLog({
      actorUserId: actor.id,
      entityType: "customer_site",
      entityId: siteId,
      action: "automatic_onboarding_route_blocked",
      metadata: {
        customerId,
        siteId,
        meteringPointId: meteringPoint.id,
        decision: routeDecisionPayload(decision),
      },
    });
    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/operations");
    revalidatePath("/admin/operations/tasks");
    return;
  }

  const existingOpenRequest = await findOpenSupplierSwitchRequestForSite(
    supabase,
    {
      customerId,
      siteId,
      companyId,
    },
  );

  const switchRequest =
    existingOpenRequest ??
    (await createSupplierSwitchRequest(supabase, {
      readiness,
      site,
      meteringPoint,
      requestType,
      requestedStartDate: site.move_in_date ?? null,
      companyId,
      automationOrigin: "customer_card_automatic_onboarding",
      automationKey: `automatic-onboarding:${customerId}:${siteId}:${meteringPoint.id}`,
    }));

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "supplier_switch_request",
    entityId: switchRequest.id,
    action: existingOpenRequest
      ? "automatic_onboarding_z03_existing_request_reused"
      : "automatic_onboarding_z03_queued",
    newValues: switchRequest,
    metadata: {
      customerId,
      siteId,
      meteringPointId: meteringPoint.id,
      decision: routeDecisionPayload(decision),
    },
  });

  await startSupplierSwitch({
    actorUserId: actor.id,
    customerId,
    switchRequestId: switchRequest.id,
    siteId,
    meteringPointId: meteringPoint.id,
    idempotencyKey: `automatic_onboarding_start:${customerId}:${siteId}:${meteringPoint.id}:${switchRequest.id}`,
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/switches");
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

async function createAndQueueCustomerMasterdataZ01(params: {
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

export async function createGridOwnerDataRequestAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();
  const customerId = formValue(formData, "customer_id") ?? "";

  if (!customerId) {
    throw new Error("Customer ID saknas");
  }

  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  const siteId = formValue(formData, "site_id") || null;
  const meteringPointId = formValue(formData, "metering_point_id") || null;
  await assertCustomerSiteTenant({ companyId, customerId, siteId });
  await assertMeteringPointTenant({
    companyId,
    customerId,
    siteId,
    meteringPointId,
  });
  const rawGridOwnerId = formValue(formData, "grid_owner_id") || null;
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
  const customerId = formValue(formData, "customer_id") ?? "";

  if (!customerId) {
    throw new Error("Kund saknas.");
  }

  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  const target = normalizeDataRequestTarget(
    formValue(formData, "request_target"),
  );
  const siteId = formValue(formData, "site_id") || null;
  const meteringPointId = formValue(formData, "metering_point_id") || null;
  let gridOwnerId = formValue(formData, "grid_owner_id") || null;
  const externalReference = formValue(formData, "external_reference") || null;
  const notes = formValue(formData, "notes") || null;
  const selectedPowerOfAttorneyId =
    formValue(formData, "power_of_attorney_id") || null;
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
      gridOwnerId = await tryAutoResolveGridOwnerForSite({
        companyId,
        customerId,
        site: site as unknown as Record<string, unknown>,
        actorUserId: actor.id,
      });
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

  const coversGridOwnerData = target === "grid_owner" || target === "both";
  const coversCurrentSupplierContract =
    target === "current_supplier" || target === "both";

  const authorizationScopeId =
    await ensureAuthorizationScopeFromPowerOfAttorney({
      companyId,
      actorUserId: actor.id,
      customerId,
      powerOfAttorneyId: signedPowerOfAttorneyId,
      authorizationDocumentId: null,
      coverage: {
        coversGridOwnerData,
        coversCurrentSupplierContract,
        coversMeteringData: coversGridOwnerData,
      },
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

  if (coversGridOwnerData) {
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

  if (coversCurrentSupplierContract) {
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
  const customerId = formValue(formData, "customer_id") ?? "";
  const siteId = formValue(formData, "site_id") ?? "";
  const requestId = formValue(formData, "customer_info_request_id") || null;

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
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customer-info-requests");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/tasks");
}

export async function createPartnerExportAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const supabase = await createSupabaseServerClient();
  const customerId = formValue(formData, "customer_id") ?? "";

  if (!customerId) {
    throw new Error("Customer ID saknas");
  }

  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  const siteId = formValue(formData, "site_id") || null;
  const meteringPointId = formValue(formData, "metering_point_id") || null;
  const billingUnderlayId = formValue(formData, "billing_underlay_id") || null;
  await assertCustomerSiteTenant({ companyId, customerId, siteId });
  await assertMeteringPointTenant({
    companyId,
    customerId,
    siteId,
    meteringPointId,
  });
  await assertBillingUnderlayTenant({
    companyId,
    customerId,
    billingUnderlayId,
  });

  const saved = await createPartnerExport({
    actorUserId: actor.id,
    customerId,
    siteId,
    meteringPointId,
    billingUnderlayId,
    exportKind: normalizePartnerExportKind(formValue(formData, "export_kind")),
    targetSystem: formValue(formData, "target_system") || "billing_partner",
    externalReference: formValue(formData, "external_reference") || null,
    notes: formValue(formData, "notes") || null,
  });

  const syncSummary = await syncCustomerOperationsForCustomer(
    supabase,
    customerId,
  );

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "partner_export",
    entityId: saved.id,
    action: "partner_export_created",
    newValues: saved,
    metadata: {
      customerId,
      siteId: saved.site_id,
      meteringPointId: saved.metering_point_id,
      exportKind: saved.export_kind,
      syncSummary,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/billing");
  revalidatePath("/admin/partner-exports");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/tasks");
}
function isDatabaseShapeError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null;
  return Boolean(
    maybe &&
    (maybe.code === "42P01" ||
      maybe.code === "42703" ||
      maybe.code === "PGRST205" ||
      /does not exist|schema cache|relation .* does not exist/i.test(
        maybe.message ?? "",
      )),
  );
}

async function requireCustomerMutationContext(
  customerId: string,
  guard: Awaited<ReturnType<typeof requireAdminActionAccess>>,
): Promise<{
  customer: { id: string; company_id: string; status: string | null };
  companyId: string;
}> {
  return loadCustomerTenantContext(customerId, guard);
}

async function insertLifecycleFollowUpTask(params: {
  actorUserId: string;
  companyId: string | null;
  customerId: string;
  scopeType: string;
  scopeId: string | null;
  decisionType: "withdrawal" | "rejected";
  reason: string;
  billingBlocked: boolean;
}) {
  try {
    await supabaseService.from("customer_operation_tasks").insert({
      company_id: params.companyId,
      customer_id: params.customerId,
      site_id: params.scopeType === "site" ? params.scopeId : null,
      metering_point_id:
        params.scopeType === "metering_point" ? params.scopeId : null,
      task_type:
        params.decisionType === "withdrawal"
          ? "customer_withdrawal_followup"
          : "customer_rejected_followup",
      status: "open",
      priority: "high",
      title:
        params.decisionType === "withdrawal"
          ? "Följ upp ångrad kund"
          : "Följ upp avvisad kund",
      description:
        "Kontrollera att leverantörsbyte, fakturering och export är stoppade på rätt nivå.",
      metadata: {
        scopeType: params.scopeType,
        scopeId: params.scopeId,
        decisionType: params.decisionType,
        reason: params.reason,
        billingBlocked: params.billingBlocked,
      },
      created_by: params.actorUserId,
      updated_by: params.actorUserId,
    });
  } catch (error) {
    if (!isDatabaseShapeError(error)) throw error;
  }
}

async function cancelOpenSwitchRequestsForLifecycleDecision(params: {
  actorUserId: string;
  companyId: string | null;
  customerId: string;
  scopeType: string;
  scopeId: string | null;
  reason: string;
}) {
  const openStatuses = [
    "draft",
    "queued",
    "submitted",
    "accepted",
    "cancellation_requested",
    "cancellation_sent",
    "manual_followup_required",
  ];
  try {
    let selectQuery = supabaseService
      .from("supplier_switch_requests")
      .select("id")
      .eq("customer_id", params.customerId)
      .in("status", openStatuses);
    if (params.companyId)
      selectQuery = selectQuery.eq("company_id", params.companyId);
    if (params.scopeType === "site" && params.scopeId)
      selectQuery = selectQuery.eq("site_id", params.scopeId);
    if (params.scopeType === "metering_point" && params.scopeId)
      selectQuery = selectQuery.eq("metering_point_id", params.scopeId);

    const { data, error } = await selectQuery;
    if (error) throw error;
    const ids = (data ?? [])
      .map((row: { id: string }) => row.id)
      .filter(Boolean);
    if (ids.length === 0) return 0;

    let updateQuery = supabaseService
      .from("supplier_switch_requests")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        failure_reason: params.reason,
        updated_by: params.actorUserId,
      })
      .in("id", ids);
    if (params.companyId)
      updateQuery = updateQuery.eq("company_id", params.companyId);
    const { error: updateError } = await updateQuery;
    if (updateError) throw updateError;
    return ids.length;
  } catch (error) {
    if (!isDatabaseShapeError(error)) throw error;
    return 0;
  }
}

async function blockBillingForLifecycleDecision(params: {
  companyId: string | null;
  customerId: string;
  scopeType: string;
  scopeId: string | null;
  reason: string;
  actorUserId: string;
}) {
  const blocker = {
    code: "customer_lifecycle_blocked",
    reason: params.reason,
    scopeType: params.scopeType,
    scopeId: params.scopeId,
    blockedAt: new Date().toISOString(),
    blockedBy: params.actorUserId,
  };

  const scopedUpdates: Array<{ table: string; column: string; value: string }> =
    [];
  if (params.scopeType === "contract" && params.scopeId) {
    scopedUpdates.push({
      table: "customer_contracts",
      column: "id",
      value: params.scopeId,
    });
  }
  if (params.scopeType === "site" && params.scopeId) {
    scopedUpdates.push({
      table: "billing_underlays",
      column: "site_id",
      value: params.scopeId,
    });
  }
  if (params.scopeType === "metering_point" && params.scopeId) {
    scopedUpdates.push({
      table: "billing_underlays",
      column: "metering_point_id",
      value: params.scopeId,
    });
  }
  if (params.scopeType === "customer") {
    scopedUpdates.push({
      table: "billing_underlays",
      column: "customer_id",
      value: params.customerId,
    });
  }

  for (const update of scopedUpdates) {
    try {
      let query = supabaseService
        .from(update.table)
        .update({
          export_status: "blocked",
          status: update.table === "billing_underlays" ? "blocked" : undefined,
          blocker_reasons: [blocker],
          billing_blocker_reasons: [blocker],
          updated_by: params.actorUserId,
        })
        .eq(update.column, update.value);

      if (params.companyId) query = query.eq("company_id", params.companyId);
      const { error } = await query;
      if (error && !isDatabaseShapeError(error)) throw error;
    } catch (error) {
      if (!isDatabaseShapeError(error)) throw error;
    }
  }
}

export async function savePowerOfAttorneyScopeAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const customerId = formValue(formData, "customer_id") ?? "";
  const powerOfAttorneyId = formValue(formData, "power_of_attorney_id") ?? "";
  const siteId = formValue(formData, "site_id") || null;
  const meteringPointId = formValue(formData, "metering_point_id") || null;
  const contractId = formValue(formData, "contract_id") || null;
  const scopeType =
    formValue(formData, "scope_type") ||
    (meteringPointId
      ? "metering_point"
      : siteId
        ? "site"
        : contractId
          ? "contract"
          : "customer");
  const validFrom = normalizeDateOrNull(formValue(formData, "valid_from"));
  const validTo = normalizeDateOrNull(formValue(formData, "valid_to"));

  if (!customerId || !powerOfAttorneyId)
    throw new Error("Kund och fullmakt krävs.");
  const { companyId } = await requireCustomerMutationContext(customerId, guard);
  await assertPowerOfAttorneyTenant({
    companyId,
    customerId,
    powerOfAttorneyId,
  });
  await assertCustomerSiteTenant({ companyId, customerId, siteId });
  await assertMeteringPointTenant({
    companyId,
    customerId,
    siteId,
    meteringPointId,
  });
  await assertContractTenant({ companyId, customerId, contractId });

  const payload = {
    company_id: companyId,
    customer_id: customerId,
    power_of_attorney_id: powerOfAttorneyId,
    scope_type: scopeType,
    site_id: siteId,
    metering_point_id: meteringPointId,
    customer_contract_id: contractId,
    status: "active",
    valid_from: validFrom,
    valid_to: validTo,
    created_by: actor.id,
    updated_by: actor.id,
  };

  const { data, error } = await supabaseService
    .from("power_of_attorney_scopes")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "power_of_attorney_scope",
    entityId: data.id,
    action: "power_of_attorney_scope_created",
    newValues: data,
    metadata: {
      customerId,
      powerOfAttorneyId,
      scopeType,
      siteId,
      meteringPointId,
      contractId,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
}

export async function registerCustomerLifecycleDecisionAction(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE]);
  const actor = { id: guard.userId };
  const customerId = formValue(formData, "customer_id") ?? "";
  const decisionType =
    formValue(formData, "decision_type") === "rejected"
      ? "rejected"
      : "withdrawal";
  const scopeType = formValue(formData, "scope_type") || "customer";
  const scopeId = formValue(formData, "scope_id") || null;
  const reason =
    formValue(formData, "reason")?.trim() ||
    (decisionType === "withdrawal"
      ? "Kunden har ångrat flödet."
      : "Kunden är nekad/avvisad.");
  const blockBilling = toBoolean(formData, "block_billing");

  if (!customerId) throw new Error("Kund saknas.");
  const { customer, companyId } = await requireCustomerMutationContext(
    customerId,
    guard,
  );
  if (scopeType === "site") {
    await assertCustomerSiteTenant({ companyId, customerId, siteId: scopeId });
  } else if (scopeType === "metering_point") {
    await assertMeteringPointTenant({
      companyId,
      customerId,
      meteringPointId: scopeId,
    });
  } else if (scopeType === "contract") {
    await assertContractTenant({ companyId, customerId, contractId: scopeId });
  }
  const nextStatus = "archived";
  const now = new Date().toISOString();

  if (scopeType === "customer") {
    const { error } = await supabaseService
      .from("customers")
      .update({
        status: nextStatus,
        archived_at: now,
        archived_by: actor.id,
        archive_reason: reason,
        lifecycle_status_reason: reason,
        lifecycle_closed_at: now,
        updated_by: actor.id,
      })
      .eq("id", customerId)
      .eq("company_id", customer.company_id);
    if (error) throw error;
  } else if (scopeType === "contract" && scopeId) {
    const { error } = await supabaseService
      .from("customer_contracts")
      .update({
        status: "cancelled",
        rejected_reason: decisionType === "rejected" ? reason : null,
        termination_reason:
          decisionType === "withdrawal" ? "customer_request" : "other",
        ends_at: now,
        updated_by: actor.id,
      })
      .eq("id", scopeId)
      .eq("customer_id", customerId)
      .eq("company_id", customer.company_id);
    if (error && !isDatabaseShapeError(error)) throw error;
  } else if (scopeType === "site" && scopeId) {
    const { error } = await supabaseService
      .from("customer_sites")
      .update({
        status: "closed",
        closed_at: now,
        closed_reason: reason,
        updated_by: actor.id,
      })
      .eq("id", scopeId)
      .eq("customer_id", customerId)
      .eq("company_id", customer.company_id);
    if (error && !isDatabaseShapeError(error)) throw error;
  } else if (scopeType === "metering_point" && scopeId) {
    const { error } = await supabaseService
      .from("metering_points")
      .update({
        status: "closed",
        closed_at: now,
        closed_reason: reason,
        updated_by: actor.id,
      })
      .eq("id", scopeId)
      .eq("company_id", customer.company_id);
    if (error && !isDatabaseShapeError(error)) throw error;
  }

  const cancelledSwitchRequests =
    await cancelOpenSwitchRequestsForLifecycleDecision({
      companyId: customer.company_id,
      customerId,
      scopeType,
      scopeId,
      reason,
      actorUserId: actor.id,
    });

  if (blockBilling) {
    await blockBillingForLifecycleDecision({
      companyId: customer.company_id,
      customerId,
      scopeType,
      scopeId,
      reason,
      actorUserId: actor.id,
    });
  }

  await insertLifecycleFollowUpTask({
    actorUserId: actor.id,
    companyId: customer.company_id,
    customerId,
    scopeType,
    scopeId,
    decisionType,
    reason,
    billingBlocked: blockBilling,
  });

  await supabaseService
    .from("customer_lifecycle_decisions")
    .insert({
      company_id: customer.company_id,
      customer_id: customerId,
      decision_type: decisionType,
      scope_type: scopeType,
      scope_id: scopeId,
      reason,
      billing_blocked: blockBilling,
      created_by: actor.id,
    })
    .then((result: { error: unknown }) => {
      if (result.error && !isDatabaseShapeError(result.error))
        throw result.error;
    });

  const usageMetadata = {
    customerId,
    scopeType,
    scopeId,
    reason,
    decisionType,
    cancelledSwitchRequests,
  };
  await logUsageEvent({
    companyId: customer.company_id,
    actorUserId: actor.id,
    customerId,
    entityType: "customer",
    entityId: customerId,
    eventKey: "customer.archived",
    actionLabel:
      decisionType === "withdrawal"
        ? "Kund ångrad och arkiverad"
        : "Kund avvisad och arkiverad",
    source: "customer_lifecycle_decision",
    billable: true,
    billingUnit: "admin_action",
    metadata: usageMetadata,
  });
  if (decisionType === "withdrawal") {
    await logUsageEvent({
      companyId: customer.company_id,
      actorUserId: actor.id,
      customerId,
      entityType:
        scopeType === "contract" && scopeId ? "customer_contract" : "customer",
      entityId: scopeId ?? customerId,
      eventKey: "contract.withdrawn",
      actionLabel: "Avtal eller ansökan ångrad",
      source: "customer_lifecycle_decision",
      billable: true,
      billingUnit: "admin_action",
      metadata: usageMetadata,
    });
  }
  if (cancelledSwitchRequests > 0) {
    await logUsageEvent({
      companyId: customer.company_id,
      actorUserId: actor.id,
      customerId,
      entityType: "supplier_switch_request",
      entityId: customerId,
      eventKey: "switch.cancelled",
      actionLabel: "Leverantörsbyte stoppat",
      source: "customer_lifecycle_decision",
      billable: true,
      billableQuantity: cancelledSwitchRequests,
      billingUnit: "switch_request",
      metadata: usageMetadata,
    });
  }
  if (blockBilling) {
    await logUsageEvent({
      companyId: customer.company_id,
      actorUserId: actor.id,
      customerId,
      entityType: "customer",
      entityId: customerId,
      eventKey: "billing.blocked",
      actionLabel: "Fakturering spärrad",
      source: "customer_lifecycle_decision",
      billable: false,
      metadata: usageMetadata,
    });
  }

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "customer_lifecycle_decision",
    entityId: customerId,
    action:
      decisionType === "withdrawal"
        ? "customer_withdrawal_registered"
        : "customer_rejection_registered",
    oldValues: customer,
    newValues: { decisionType, scopeType, scopeId, reason, blockBilling },
    metadata: { customerId, scopeType, scopeId },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/billing/export-center");
}
