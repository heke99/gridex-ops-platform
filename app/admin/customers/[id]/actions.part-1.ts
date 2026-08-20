// Extracted from actions.ts; keep public imports on the facade module.
import { revalidatePath } from "next/cache"


import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireAdminActionAccess } from "@/lib/admin/guards"
import { assertCustomerSiteTenant, assertPowerOfAttorneyTenant } from "@/lib/tenant/entityGuards"
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions"
import { getCustomerSiteById, getMeteringPointById, saveCustomerSite, saveMeteringPoint } from "@/lib/masterdata/db"
import { customerSiteInputSchema, meteringPointInputSchema, parseCheckbox } from "@/lib/masterdata/validators"
import { supabaseService } from "@/lib/supabase/service"

import { savePowerOfAttorney, syncCustomerOperationsForCustomer, syncCustomerOperationsForSite } from "@/lib/operations/db"

import type { CustomerAuthorizationDocumentRow, SupplierSwitchRequestType } from "@/lib/operations/types"

import type { OutboundRequestType } from "@/lib/cis/types"


import { decideCommunicationRoute, routeDecisionPayload } from "@/lib/routes/routeDecisionEngine"
import { createMissingCustomerDataTasks } from "@/lib/customers/dataTasks"
import type { BusinessProcess } from "@/lib/routes/routeDecisionTypes"


import { logAdminActionAndUsage } from "@/lib/audit/actionLogger"
import { emitCustomerOperationEvent } from "@/lib/customers/customerOperationEvents"

import { applyCustomerSiteAddressCandidate } from "@/lib/customer-sites/addressIntake"
import { enqueueCustomerDataRequestAutomation } from "@/lib/customer-operations/automation"
import { reconcileSupplierSwitchAfterCustomerDataChange } from "@/lib/customer-operations/supplierSwitchOrchestration"
import { normalizeUuidOrNull } from "@/lib/validation/uuid"


import { requireCustomerMutationContext } from './actions.part-4'

export function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  return value;
}

export function normalizePriceAreaOrNull(
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

export function normalizeDateOrNull(value: string | null): string | null {
  if (!value) return null;
  return value;
}

export async function reconcileSupplierSwitchesForCustomerSites(params: {
  companyId: string;
  customerId: string;
  siteId?: string | null;
  actorUserId: string;
  source: string;
}) {
  let siteIds = params.siteId ? [params.siteId] : [];
  if (siteIds.length === 0) {
    const { data, error } = await supabaseService
      .from("customer_sites")
      .select("id")
      .eq("company_id", params.companyId)
      .eq("customer_id", params.customerId);
    if (error) throw error;
    siteIds = (data ?? [])
      .map((row) => (typeof row.id === "string" ? row.id : null))
      .filter((id): id is string => Boolean(id));
  }

  const results = [];
  for (const siteId of siteIds) {
    const result = await reconcileSupplierSwitchAfterCustomerDataChange({
      companyId: params.companyId,
      customerId: params.customerId,
      siteId,
      actorUserId: params.actorUserId,
      source: params.source,
    }).catch((error) => {
      console.warn("Supplier switch reconcile after customer legal data change failed", {
        customerId: params.customerId,
        siteId,
        error,
      });
      return null;
    });
    results.push({ siteId, result });
  }
  return results;
}

export function validateHistoricalMeteringPeriod(params: {
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

export function normalizeNumberOrNull(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeSupplierResponseStatus(value: string | null): string {
  if (value === "free_to_switch") return "free_to_switch";
  if (value === "binding_period") return "binding_period";
  if (value === "termination_fee") return "termination_fee";
  if (value === "blocked") return "blocked";
  if (value === "waiting_response") return "waiting_response";
  return "manual_review";
}

export function normalizeSwitchRequestType(
  value: string | null,
): SupplierSwitchRequestType {
  if (value === "move_in") return "move_in";
  if (value === "move_out_takeover") return "move_out_takeover";
  return "switch";
}

export function normalizeGridOwnerRequestScope(value: string | null): BusinessProcess {
  if (value === "billing_underlay") return "billing_underlay";
  if (value === "customer_masterdata") return "customer_masterdata";
  if (value === "metering_access") return "metering_access";
  if (value === "supplier_switch") return "supplier_switch";
  if (value === "partner_export") return "partner_export";
  return "meter_values";
}

export function normalizeDataRequestTarget(
  value: string | null,
): "grid_owner" | "current_supplier" | "both" {
  if (value === "current_supplier") return "current_supplier";
  if (value === "both") return "both";
  return "grid_owner";
}

export function normalizeSimpleRequestStatus(value: string): string {
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

export function normalizePartnerExportKind(
  value: string | null,
): "billing_underlay" | "meter_values" | "customer_snapshot" {
  if (value === "meter_values") return "meter_values";
  if (value === "customer_snapshot") return "customer_snapshot";
  return "billing_underlay";
}

export async function resolveActionGridOwnerId(params: {
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

export function messageCodeForBusinessProcess(
  process: BusinessProcess,
  action?: string | null,
): string | null {
  if (process === "customer_masterdata") return "Z01";
  if (process === "supplier_switch") return "Z03";
  if (process === "metering_access")
    return action === "terminate_metering_access" ? "Z18" : "Z13";
  return null;
}

export async function auditRouteDecisionForCustomerAction(params: {
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

export type JsonObject = Record<string, unknown>;

export function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function normalizeEdielMeteringMethod(
  value: string | null,
): "Z01" | "Z02" | "Z03" | "Z04" | null {
  if (value === "Z01" || value === "Z02" || value === "Z03" || value === "Z04")
    return value;
  return null;
}

export async function applyEdielMeteringMethodToSwitchSnapshots(params: {
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

export function mapGridOwnerRequestScopeToOutboundType(
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

export async function customerHasMeterValuesAccess(params: {
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

export async function createCustomerActionTask(params: {
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

export function sanitizeFileName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
}

export function buildCustomerDocumentPath(params: {
  customerId: string;
  siteId: string | null;
  documentType: "power_of_attorney" | "complete_agreement";
  fileName: string;
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const scope = params.siteId ? `site-${params.siteId}` : "customer";
  return `${params.customerId}/${scope}/${params.documentType}/${stamp}_${sanitizeFileName(params.fileName)}`;
}

export function toBoolean(formData: FormData, key: string): boolean {
  return parseCheckbox(formData.get(key));
}

export function formatDocumentReference(
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

export async function insertAuditLog(params: {
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

export async function recordCustomerActionResult(params: {
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

export function isBillableCustomerAction(action: string): boolean {
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

  const selectedGridOwnerId = normalizeUuidOrNull(
    formValue(formData, "grid_owner_id"),
  );
  const newGridOwnerName = (
    formValue(formData, "new_grid_owner_name") ?? ""
  ).trim();
  if (newGridOwnerName) {
    throw new Error(
      "Nätägarregister kan bara ändras av plattformsadministratör i aktörsregistret. Kundkortet använder den angivna nätägaren som ett förslag och systemet verifierar automatiskt innan något skickas.",
    );
  }

  const parsed = customerSiteInputSchema.parse({
    id: siteId,
    company_id: companyId,
    customer_id: customerId,
    site_name: formValue(formData, "site_name") ?? "",
    facility_id: formValue(formData, "facility_id") || undefined,
    site_type: formValue(formData, "site_type") ?? "consumption",
    status: formValue(formData, "status") ?? "draft",
    // Kundkortets manuella värden är kandidater. Resolver eller nätägarsvar får sätta operativ nätägare/elområde.
    grid_owner_id: null,
    price_area_code: null,
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

  const addressResult = await applyCustomerSiteAddressCandidate({
    companyId,
    customerId,
    siteId: savedSite.id,
    address: {
      street,
      postalCode,
      city,
      country: formValue(formData, "country") || "SE",
      careOf: formValue(formData, "care_of"),
      source: "manual_intake",
      sourceReference: savedSite.id,
      actorUserId: actor.id,
      claimedGridOwnerId: selectedGridOwnerId,
      metadata: {
        manual_price_area_hint: normalizePriceAreaOrNull(formValue(formData, "price_area_code")),
        source: "customer_site_form",
      },
    },
  });

  if (addressResult.status === "updated" || addressResult.status === "unchanged") {
    await enqueueCustomerDataRequestAutomation({
      companyId,
      customerId,
      siteId: savedSite.id,
      actorUserId: actor.id,
    });
  }

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
  const supplierSwitchReconcile = await reconcileSupplierSwitchAfterCustomerDataChange({
    companyId,
    customerId,
    siteId: savedSite.id,
    actorUserId: actor.id,
    source: "customer_site_saved",
  }).catch((error) => {
    console.warn("Supplier switch reconcile after site save failed", error);
    return null;
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
      addressResult,
      readiness,
      supplierSwitchReconcile,
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
  const supplierSwitchReconcile = await reconcileSupplierSwitchAfterCustomerDataChange({
    companyId,
    customerId,
    siteId: savedMeteringPoint.site_id,
    meteringPointId: savedMeteringPoint.id,
    actorUserId: actor.id,
    source: "metering_point_saved",
  }).catch((error) => {
    console.warn("Supplier switch reconcile after metering point save failed", error);
    return null;
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
      supplierSwitchReconcile,
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
  const supplierSwitchReconcile = saved.status === "signed"
    ? await reconcileSupplierSwitchesForCustomerSites({
        companyId,
        customerId,
        siteId: saved.site_id,
        actorUserId: actor.id,
        source: "power_of_attorney_signed",
      })
    : [];

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
      supplierSwitchReconcile,
    },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/operations");
  revalidatePath("/admin/operations/tasks");
}
