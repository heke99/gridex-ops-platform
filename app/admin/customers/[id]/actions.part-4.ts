// Extracted from actions.ts; keep public imports on the facade module.
import { revalidatePath } from "next/cache"


import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireAdminActionAccess } from "@/lib/admin/guards"
import { assertBillingUnderlayTenant, assertContractTenant, assertCustomerSiteTenant, assertMeteringPointTenant, assertPowerOfAttorneyTenant, loadCustomerTenantContext } from "@/lib/tenant/entityGuards"
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions"


import { supabaseService } from "@/lib/supabase/service"
import { addCustomerContractEvent } from "@/lib/customer-contracts/db"
import { syncCustomerOperationsForCustomer } from "@/lib/operations/db"


import { createPartnerExport } from "@/lib/cis/db"








import { logAdminActionAndUsage, logUsageEvent } from "@/lib/audit/actionLogger"
import { emitCustomerOperationEvent } from "@/lib/customers/customerOperationEvents"




import { normalizeUuidOrNull } from "@/lib/validation/uuid"

import { createCustomerCase } from "@/lib/customer-cases/db"
import { formValue, insertAuditLog, normalizeDateOrNull, normalizePartnerExportKind, normalizePriceAreaOrNull, toBoolean } from './actions.part-1'

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

export function isDatabaseShapeError(error: unknown): boolean {
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

export async function requireCustomerMutationContext(
  customerId: string,
  guard: Awaited<ReturnType<typeof requireAdminActionAccess>>,
): Promise<{
  customer: { id: string; company_id: string; status: string | null };
  companyId: string;
}> {
  return loadCustomerTenantContext(customerId, guard);
}

export async function insertLifecycleFollowUpTask(params: {
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

export async function cancelOpenSwitchRequestsForLifecycleDecision(params: {
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

export async function blockBillingForLifecycleDecision(params: {
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
  const requestedDecision = formValue(formData, "decision_type");
  const decisionType: "withdrawal" | "cancelled" | "rejected" =
    requestedDecision === "cancelled"
      ? "cancelled"
      : requestedDecision === "rejected"
        ? "rejected"
        : "withdrawal";
  const encodedTarget = formValue(formData, "scope_target");
  const [encodedScope, encodedScopeId] = encodedTarget?.split(":", 2) ?? [];
  const requestedScope = encodedScope || formValue(formData, "scope_type") || "customer";
  const scopeType = ["customer", "contract", "site", "metering_point"].includes(
    requestedScope,
  )
    ? requestedScope
    : "customer";
  const scopeId = (encodedScopeId || formValue(formData, "scope_id"))?.trim() || null;
  const receivedAt =
    normalizeDateOrNull(formValue(formData, "received_at")) ??
    new Date().toISOString();
  const requestedChannel = formValue(formData, "received_channel") ?? "other";
  const receivedChannel = ["phone", "email", "web_form", "letter", "other"].includes(
    requestedChannel,
  )
    ? requestedChannel
    : "other";
  const notes = formValue(formData, "notes")?.trim() || null;
  const defaultReason =
    decisionType === "withdrawal"
      ? "Kunden har använt sin ångerrätt."
      : decisionType === "cancelled"
        ? "Kundprocessen har avbrutits."
        : "Kunden eller ansökan har avvisats.";
  const reason = formValue(formData, "reason")?.trim() || defaultReason;
  const blockBilling = toBoolean(formData, "block_billing");

  if (!customerId) throw new Error("Kund saknas.");
  if (!toBoolean(formData, "confirmed")) {
    throw new Error("Bekräfta beslutet innan det registreras.");
  }
  if (scopeType !== "customer" && !scopeId) {
    throw new Error("Välj vilket avtal, vilken anläggning eller mätpunkt beslutet gäller.");
  }

  const { customer, companyId } = await requireCustomerMutationContext(
    customerId,
    guard,
  );

  let contractContext: Record<string, unknown> | null = null;
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
    const { data, error } = await supabaseService
      .from("customer_contracts")
      .select("*")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .eq("id", scopeId!)
      .maybeSingle();
    if (error && !isDatabaseShapeError(error)) throw error;
    contractContext = (data as Record<string, unknown> | null) ?? null;
  }

  let switchContext: Record<string, unknown> | null = null;
  try {
    let query = supabaseService
      .from("supplier_switch_requests")
      .select("*")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (scopeType === "site" && scopeId) query = query.eq("site_id", scopeId);
    if (scopeType === "metering_point" && scopeId) {
      query = query.eq("metering_point_id", scopeId);
    }
    const { data, error } = await query.maybeSingle();
    if (error && !isDatabaseShapeError(error)) throw error;
    switchContext = (data as Record<string, unknown> | null) ?? null;
  } catch (error) {
    if (!isDatabaseShapeError(error)) throw error;
  }

  const stringField = (row: Record<string, unknown> | null, ...keys: string[]) => {
    for (const key of keys) {
      const value = row?.[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return null;
  };
  const siteId =
    scopeType === "site"
      ? scopeId
      : stringField(contractContext, "site_id", "customer_site_id") ??
        stringField(switchContext, "site_id");
  const meteringPointId =
    scopeType === "metering_point"
      ? scopeId
      : stringField(contractContext, "metering_point_id") ??
        stringField(switchContext, "metering_point_id");
  const agreementChannel = stringField(
    contractContext,
    "agreement_channel",
    "source_type",
  );
  const agreementCreatedAt = stringField(
    contractContext,
    "signed_at",
    "created_at",
  );
  const deliveryStartAt = stringField(
    contractContext,
    "actual_start_date",
    "actual_start_at",
    "starts_at",
  );
  const prodatSentAt = stringField(
    switchContext,
    "submitted_at",
    "sent_at",
    "dispatched_at",
  );

  const caseType =
    decisionType === "withdrawal"
      ? "withdrawal"
      : decisionType === "cancelled"
        ? "onboarding_aborted"
        : "rejected_customer";
  const title =
    decisionType === "withdrawal"
      ? "Ånger registrerad"
      : decisionType === "cancelled"
        ? "Kundprocess avbruten"
        : "Kund eller ansökan avvisad";

  const customerCase = await createCustomerCase({
    companyId,
    customerId,
    siteId,
    meteringPointId,
    customerContractId: scopeType === "contract" ? scopeId : null,
    supplierSwitchRequestId: stringField(switchContext, "id"),
    caseType,
    priority: "high",
    title,
    description: reason,
    reasonCategory: decisionType,
    agreementChannel,
    isDistanceAgreement: Boolean(
      agreementChannel && /website|web|online|digital|distance/i.test(agreementChannel),
    ),
    agreementCreatedAt,
    withdrawalRequestedAt: decisionType === "withdrawal" ? receivedAt : null,
    deliveryStartAt,
    prodatSentAt,
    nextAction:
      decisionType === "withdrawal"
        ? "Bekräfta ångern och kontrollera att byte, utskick och fakturering har stoppats."
        : "Kontrollera att endast rätt kundprocess har stoppats och dokumentera eventuell återstart.",
    source: "customer_card_lifecycle_action",
    metadata: {
      scopeType,
      scopeId,
      decisionType,
      receivedAt,
      receivedChannel,
      notes,
      blockBilling,
    },
    actorUserId: actor.id,
  });

  const now = new Date().toISOString();
  if (scopeType === "customer") {
    const { error } = await supabaseService
      .from("customers")
      .update({
        status: "archived",
        archived_at: now,
        archived_by: actor.id,
        archive_reason: reason,
        lifecycle_status_reason: reason,
        lifecycle_closed_at: now,
      })
      .eq("id", customerId)
      .eq("company_id", companyId);
    if (error) throw error;
  } else if (scopeType === "contract" && scopeId) {
    await addCustomerContractEvent({
      companyId,
      customerContractId: scopeId,
      customerId,
      eventType: "cancelled",
      happenedAt: receivedAt,
      note: reason,
      metadata: {
        reason_code:
          decisionType === "withdrawal" ? "cancelled_by_customer" : decisionType,
        withdrawal_requested_at:
          decisionType === "withdrawal" ? receivedAt : null,
        rejected_reason: decisionType === "rejected" ? reason : null,
        termination_reason:
          decisionType === "withdrawal"
            ? "customer_withdrawal"
            : decisionType === "cancelled"
              ? "customer_request"
              : "other",
        ends_at: now.slice(0, 10),
      },
      actorUserId: actor.id,
    });
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
      .eq("company_id", companyId);
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
      .eq("company_id", companyId);
    if (error && !isDatabaseShapeError(error)) throw error;
  }

  const entityLabel =
    scopeType === "customer"
      ? "kund"
      : scopeType === "contract"
        ? "avtal"
        : scopeType === "site"
          ? "anläggning"
          : "mätpunkt";
  const usageMetadata = {
    customerId,
    customerCaseId: customerCase.id,
    scopeType,
    scopeId,
    reason,
    decisionType,
    receivedAt,
    receivedChannel,
  };
  await logUsageEvent({
    companyId,
    actorUserId: actor.id,
    customerId,
    entityType: scopeType === "contract" ? "customer_contract" : "customer",
    entityId: scopeId ?? customerId,
    eventKey:
      decisionType === "withdrawal"
        ? "contract.withdrawn"
        : decisionType === "cancelled"
          ? "customer_process.cancelled"
          : "customer.rejected",
    actionLabel:
      decisionType === "withdrawal"
        ? `Ånger registrerad för ${entityLabel}`
        : decisionType === "cancelled"
          ? `Process avbruten för ${entityLabel}`
          : `${entityLabel[0].toUpperCase()}${entityLabel.slice(1)} avvisad`,
    source: "customer_lifecycle_decision",
    billable: true,
    billingUnit: "admin_action",
    metadata: usageMetadata,
  });

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: "customer_lifecycle_decision",
    entityId: customerCase.id,
    action:
      decisionType === "withdrawal"
        ? "customer_withdrawal_registered"
        : decisionType === "cancelled"
          ? "customer_process_cancelled"
          : "customer_rejection_registered",
    oldValues: customer,
    newValues: {
      customerCaseId: customerCase.id,
      decisionType,
      scopeType,
      scopeId,
      reason,
      blockBilling,
      receivedAt,
      receivedChannel,
      notes,
    },
    metadata: { customerId, scopeType, scopeId },
  });

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath(`/admin/customers/${customerId}?tab=lifecycle-decisions`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/customer-cases");
  revalidatePath("/admin/billing/export-center");
}

export async function verifyCustomerSiteGridOwnerManually(formData: FormData) {
  const customerId = normalizeUuidOrNull(formData.get('customer_id'), 'customer_id')
  const companyId = normalizeUuidOrNull(formData.get('company_id'), 'company_id')
  const customerSiteId = normalizeUuidOrNull(formData.get('customer_site_id'), 'customer_site_id')
  const gridOwnerId = normalizeUuidOrNull(formData.get('grid_owner_id'), 'grid_owner_id')
  const gridAreaCode = String(formData.get('grid_area_code') ?? '').trim().toUpperCase() || null
  const priceAreaCode = normalizePriceAreaOrNull(String(formData.get('price_area_code') ?? '').trim() || null)
  const source = String(formData.get('source') ?? 'manual_admin_verification').trim()
  const confidence = Number(formData.get('confidence') ?? 1)

  if (!companyId || !customerId || !customerSiteId || !gridOwnerId || !gridAreaCode) {
    throw new Error('Kund, bolag, anläggning, nätägare och nätområdeskod krävs för verifiering.')
  }

  const access = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])
  await assertCustomerSiteTenant({ companyId, customerId, siteId: customerSiteId })

  const gridOwner = await supabaseService
    .from('grid_owners')
    .select('id,name,ediel_id,verification_status,route_status,certificate_status')
    .eq('id', gridOwnerId)
    .maybeSingle()
  if (gridOwner.error) throw gridOwner.error
  if (!gridOwner.data) throw new Error('Nätägaren kunde inte hittas.')

  const now = new Date().toISOString()
  const verificationPayload = {
    resolution_status: 'manual_verified',
    grid_owner_id: gridOwnerId,
    grid_area_code: gridAreaCode,
    price_area_code: priceAreaCode,
    resolution_confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 1,
    address_quality_warnings: [] as unknown[],
    onboarding_issues: [] as unknown[],
    updated_at: now,
  }

  const update = await supabaseService
    .from('customer_sites')
    .update(verificationPayload)
    .eq('id', customerSiteId)
    .eq('company_id', companyId)
  if (update.error) throw update.error

  await emitCustomerOperationEvent({
    companyId,
    customerId,
    actorUserId: access.userId,
    eventType: 'facility.grid_owner_manual_verified',
    title: 'Nätägare verifierad manuellt',
    message: `Nätområde ${gridAreaCode} verifierades manuellt mot ${String(gridOwner.data.name ?? 'vald nätägare')}.`,
    customerSiteId,
    payload: {
      source,
      confidence: verificationPayload.resolution_confidence,
      grid_owner_id: gridOwnerId,
      grid_owner_name: gridOwner.data.name,
      grid_owner_ediel_id: gridOwner.data.ediel_id,
      grid_area_code: gridAreaCode,
      price_area_code: priceAreaCode,
      verification_status: gridOwner.data.verification_status,
      route_status: gridOwner.data.route_status,
      certificate_status: gridOwner.data.certificate_status,
    },
    idempotencyKey: `manual-grid-owner-verify:${customerSiteId}:${gridOwnerId}:${gridAreaCode}`,
  })

  await logAdminActionAndUsage({
    actorUserId: access.userId,
    companyId,
    customerId,
    entityType: 'customer_site',
    entityId: customerSiteId,
    action: 'customer_site.manual_grid_owner_verify',
    label: 'Manuell verifiering av nätägare',
    metadata: {
      customer_id: customerId,
      grid_owner_id: gridOwnerId,
      grid_area_code: gridAreaCode,
      price_area_code: priceAreaCode,
      source,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  return { ok: true, status: 'manual_verified' }
}
