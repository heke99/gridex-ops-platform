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
import { queueTenantTemplateEmail } from "@/lib/tenant/emailTemplates";
import { logAdminActionAndUsage, logUsageEvent } from "@/lib/audit/actionLogger";
import type { CustomerActionState } from "./customer-action-state";

/**
 * Expected business blocker raised by a customer-card action. These are turned
 * into a controlled, Swedish action state instead of crashing the admin page
 * through the Server Component error boundary.
 */
class CustomerActionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CustomerActionError";
    this.code = code;
  }
}

/**
 * Next.js uses thrown errors with a `digest` for control flow (redirect /
 * notFound). Those must always be re-thrown so navigation works.
 */
function isNextControlFlowError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

/**
 * Wraps a customer-card mutation so expected business blockers and unexpected
 * failures return a controlled Swedish action state. Redirects (successful
 * delete) are re-thrown so Next can navigate away from the customer page.
 */
async function runCustomerCardAction(
  impl: () => Promise<CustomerActionState>,
): Promise<CustomerActionState> {
  try {
    return await impl();
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;

    if (error instanceof CustomerActionError) {
      return { status: "error", code: error.code, message: error.message };
    }

    const rawMessage = error instanceof Error ? error.message : "";
    if (rawMessage === "Endast platform admin kan utföra den här åtgärden.") {
      return {
        status: "error",
        code: "forbidden",
        message:
          "Du saknar behörighet för permanent radering. Endast plattformsadmin kan radera kunder.",
      };
    }
    if (
      rawMessage === "Unauthorized" ||
      rawMessage === "Forbidden" ||
      rawMessage.startsWith("Du saknar behörighet")
    ) {
      return {
        status: "error",
        code: "forbidden",
        message: "Du saknar behörighet för den här åtgärden.",
      };
    }

    console.error("[customer-card-action] Unexpected error", error);
    return {
      status: "error",
      code: "unexpected",
      message:
        "Åtgärden kunde inte slutföras just nu. Försök igen eller kontakta support om felet kvarstår.",
    };
  }
}

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
    throw new CustomerActionError("validation", message);
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
  label?: string | null;
  billable?: boolean;
}) {
  await logAdminActionAndUsage({
    actorUserId: params.actorUserId,
    companyId: params.companyId ?? null,
    entityType: params.entityType,
    entityId: params.entityId,
    customerId: params.entityType === "customer" ? params.entityId : null,
    action: params.action,
    label: params.label ?? null,
    oldValues: params.oldValues,
    newValues: params.newValues,
    metadata: typeof params.metadata === "object" && params.metadata !== null ? (params.metadata as Record<string, unknown>) : { value: params.metadata ?? null },
    billable: params.billable ?? false,
    billingUnit: params.billable ? "admin_action" : "audit_only",
    source: "customer_card",
  });
}

export async function saveCustomerProfileAction(
  _prevState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  return runCustomerCardAction(() => saveCustomerProfileImpl(formData));
}

async function saveCustomerProfileImpl(
  formData: FormData,
): Promise<CustomerActionState> {
  const actorUserId = await getActorUserId();

  const customerId = getString(formData, "customer_id");
  if (!customerId) {
    throw new CustomerActionError("missing_customer", "Kund-id saknas.");
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

  return { status: "success", message: "Kundprofilen har sparats." };
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
  _prevState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  return runCustomerCardAction(() => closeCustomerLifecycleImpl(formData));
}

async function closeCustomerLifecycleImpl(
  formData: FormData,
): Promise<CustomerActionState> {
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

  if (!customerId) {
    throw new CustomerActionError("missing_customer", "Kund-id saknas.");
  }
  if (confirmText !== "AVSLUTA") {
    throw new CustomerActionError(
      "confirm_mismatch",
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
      "Soft close only. Customer records are retained for Ediel, metering, billing and audit traceability.",
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

    await supabaseService.from("customer_operation_tasks").insert({
      company_id: companyId,
      customer_id: customerId,
      site_id: siteIds[0] ?? null,
      metering_point_id: null,
      task_type: "supplier_switch_stopped_followup",
      status: "open",
      priority: "high",
      title:
        mode === "terminate"
          ? "Följ upp stoppat leverantörsbyte vid avslut"
          : "Följ upp stoppat leverantörsbyte vid flytt",
      description:
        reason ??
        (mode === "terminate"
          ? "Kunden avslutades innan leverantörsbytet slutfördes."
          : "Kunden flyttade innan leverantörsbytet slutfördes."),
      metadata: { lifecycleMetadata, activeSwitchIds },
      created_by: actorUserId,
      updated_by: actorUserId,
    }).then(({ error }) => {
      if (error) throw error;
    });

    await logUsageEvent({
      companyId,
      actorUserId,
      customerId,
      entityType: "supplier_switch_request",
      entityId: customerId,
      eventKey: "switch.cancelled",
      actionLabel: "Leverantörsbyte stoppat vid kundavslut",
      source: "customer_lifecycle_close",
      billable: true,
      billableQuantity: activeSwitchIds.length,
      billingUnit: "switch_request",
      metadata: { lifecycleMetadata, activeSwitchIds },
    });
  }

  const customerEmail =
    typeof customerAfter.email === "string" && customerAfter.email.trim()
      ? customerAfter.email.trim()
      : null;
  await queueTenantTemplateEmail("move_out_confirmation", {
    companyId,
    customerId,
    customerEmail,
    customerName:
      typeof customerAfter.full_name === "string"
        ? customerAfter.full_name
        : typeof customerAfter.company_name === "string"
          ? customerAfter.company_name
          : null,
    nextAction:
      mode === "terminate"
        ? "Vi har registrerat avslutet och säkerställer slutunderlag."
        : "Vi har registrerat flytten och säkerställer slutunderlag.",
    actorUserId,
  }).catch(() => null);

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

  return {
    status: "success",
    message:
      mode === "terminate"
        ? "Kundrelationen har avslutats. Historiken sparas."
        : "Flytt/avslut har registrerats. Historiken sparas.",
  };
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

// Newer manual-flow tables (manual_email_outbox, grid_owner_information_requests,
// power_of_attorney_events, ...) may not exist in every environment yet. The
// tolerant helpers below treat missing schema as "no rows" but surface any real
// error as a controlled admin message instead of crashing the page.
const MISSING_SCHEMA_CODES = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "PGRST204", // column not found in schema cache
  "PGRST205", // table not found in schema cache
]);

function isMissingSchemaError(
  error: { code?: string | null } | null | undefined,
): boolean {
  return Boolean(error?.code && MISSING_SCHEMA_CODES.has(error.code));
}

async function selectRowsByColumnSafe(
  table: string,
  select: string,
  column: string,
  values: string[],
): Promise<Array<Record<string, unknown>>> {
  if (values.length === 0) return [];
  const { data, error } = await supabaseService
    .from(table)
    .select(select)
    .in(column, values);
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

function uniqueCleanStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  );
}

async function selectIdsByColumnSafe(
  table: string,
  column: string,
  values: string[],
): Promise<string[]> {
  const rows = await selectRowsByColumnSafe(table, "id", column, values);
  return uniqueCleanStrings(rows.map((row) => row.id));
}

async function selectIdsByCustomerIdSafe(
  table: string,
  customerId: string,
): Promise<string[]> {
  const { data, error } = await supabaseService
    .from(table)
    .select("id")
    .eq("customer_id", customerId);
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
  return (data ?? []).map((row: { id: string }) => row.id).filter(Boolean);
}

async function deleteByIdsSafe(table: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabaseService.from(table).delete().in("id", ids);
  if (error && !isMissingSchemaError(error)) throw error;
}

async function deleteByColumnSafe(
  table: string,
  column: string,
  values: string[],
): Promise<void> {
  if (values.length === 0) return;
  const { error } = await supabaseService
    .from(table)
    .delete()
    .in(column, values);
  if (error && !isMissingSchemaError(error)) throw error;
}

async function deleteByCustomerIdSafe(
  table: string,
  customerId: string,
): Promise<void> {
  const { error } = await supabaseService
    .from(table)
    .delete()
    .eq("customer_id", customerId);
  if (error && !isMissingSchemaError(error)) throw error;
}

/**
 * Collects manual grid-owner / POA operational rows that live in tables added
 * after the original delete flow. These are treated as protected history and
 * block permanent delete (archive instead), but are also removed in FK-safe
 * order for genuine test-only cleanup.
 */
async function collectManualFlowDeleteGraph(
  customerId: string,
  siteIds: string[],
  meteringPointIds: string[],
) {
  const gridOwnerInformationRequestOrFilters = [
    `customer_id.eq.${customerId}`,
    ...siteIds.map((id) => `customer_site_id.eq.${id}`),
  ];

  let gridOwnerInformationRequestIds: string[] = [];
  const { data: gridOwnerInformationRequestRows, error: gorError } =
    await supabaseService
      .from("grid_owner_information_requests")
      .select("id")
      .or(gridOwnerInformationRequestOrFilters.join(","));
  if (gorError) {
    if (!isMissingSchemaError(gorError)) throw gorError;
  } else {
    gridOwnerInformationRequestIds = (gridOwnerInformationRequestRows ?? [])
      .map((row: { id: string }) => row.id)
      .filter(Boolean);
  }

  const manualEmailOutboxRows = await selectRowsByColumnSafe(
    "manual_email_outbox",
    "id,provider_message_id",
    "request_id",
    gridOwnerInformationRequestIds,
  );
  const manualEmailOutboxIds = uniqueCleanStrings(
    manualEmailOutboxRows.map((row) => row.id),
  );
  const manualEmailProviderMessageIds = uniqueCleanStrings(
    manualEmailOutboxRows.map((row) => row.provider_message_id),
  );
  const manualInboundMessageIds = await selectIdsByColumnSafe(
    "manual_inbound_messages",
    "request_id",
    gridOwnerInformationRequestIds,
  );

  const powerOfAttorneyIds = await selectIdsByCustomerIdSafe(
    "powers_of_attorney",
    customerId,
  );
  const powerOfAttorneyEventIds = await selectIdsByColumnSafe(
    "power_of_attorney_events",
    "power_of_attorney_id",
    powerOfAttorneyIds,
  );

  let customerDocumentIds: string[] = [];
  let poaDocumentCount = 0;
  const { data: customerDocumentRows, error: documentError } =
    await supabaseService
      .from("customer_documents")
      .select("id,document_type,mime_type")
      .eq("customer_id", customerId);
  if (documentError) {
    if (!isMissingSchemaError(documentError)) throw documentError;
  } else {
    for (const row of customerDocumentRows ?? []) {
      if (!row?.id) continue;
      customerDocumentIds.push(row.id);
      const documentType = String(row.document_type ?? "").toLowerCase();
      const mimeType = String(row.mime_type ?? "").toLowerCase();
      if (
        documentType === "power_of_attorney" ||
        mimeType === "application/pdf"
      ) {
        poaDocumentCount += 1;
      }
    }
  }

  const customerOperationEventIds = await selectIdsByCustomerIdSafe(
    "customer_operation_events",
    customerId,
  );
  const customerBlockerIds = await selectIdsByCustomerIdSafe(
    "customer_blockers",
    customerId,
  );

  const communicationLogRows = [
    ...(await selectRowsByColumnSafe("communication_logs", "id,provider_message_id", "customer_id", [customerId])),
    ...(await selectRowsByColumnSafe("communication_logs", "id,provider_message_id", "site_id", siteIds)),
    ...(await selectRowsByColumnSafe("communication_logs", "id,provider_message_id", "metering_point_id", meteringPointIds)),
    ...(await selectRowsByColumnSafe("communication_logs", "id,provider_message_id", "provider_message_id", manualEmailProviderMessageIds)),
  ];
  const communicationLogIds = uniqueCleanStrings(
    communicationLogRows.map((row) => row.id),
  );
  const communicationProviderMessageIds = uniqueCleanStrings([
    ...manualEmailProviderMessageIds,
    ...communicationLogRows.map((row) => row.provider_message_id),
  ]);
  const communicationLogEventRows = [
    ...(await selectRowsByColumnSafe("communication_log_events", "id", "communication_log_id", communicationLogIds)),
    ...(await selectRowsByColumnSafe("communication_log_events", "id", "provider_message_id", communicationProviderMessageIds)),
  ];
  const communicationLogEventIds = uniqueCleanStrings(
    communicationLogEventRows.map((row) => row.id),
  );

  return {
    gridOwnerInformationRequestIds,
    manualEmailOutboxIds,
    manualInboundMessageIds,
    powerOfAttorneyIds,
    powerOfAttorneyEventIds,
    customerDocumentIds,
    poaDocumentCount,
    customerOperationEventIds,
    customerBlockerIds,
    communicationLogIds,
    communicationLogEventIds,
  };
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

async function markCustomerAsTestDataImpl(
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

export async function archiveCustomerAction(
  _prevState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  return runCustomerCardAction(() => archiveCustomerImpl(formData));
}

async function archiveCustomerImpl(
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

  const { data: customerAfter, error: updateError } = await supabaseService
    .from("customers")
    .update({
      status: "archived",
      archived_at: nowIso,
      archived_by: actorUserId,
      archive_reason: archiveReason,
      updated_at: nowIso,
    })
    .eq("id", customerId)
    .eq("company_id", companyId)
    .select("*")
    .single();

  if (updateError) throw updateError;

  const { error: sitesError } = await supabaseService
    .from("customer_sites")
    .update({
      status: "closed",
      closed_at: nowIso,
      closed_reason: archiveReason,
      updated_by: actorUserId,
    })
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
      .update({
        status: "closed",
        closed_at: nowIso,
        closed_reason: archiveReason,
        updated_by: actorUserId,
      })
      .eq("company_id", companyId)
      .in("site_id", siteIds);

    if (pointsError) throw pointsError;
  }

  const { data: contractsToClose, error: contractsLookupError } = await supabaseService
    .from("customer_contracts")
    .select("id")
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .in("status", ["draft", "pending_signature", "signed", "active"]);
  if (contractsLookupError) throw contractsLookupError;
  const contractIds = (contractsToClose ?? []).map((row: { id: string }) => row.id).filter(Boolean);
  if (contractIds.length > 0) {
    const { error: contractsUpdateError } = await supabaseService
      .from("customer_contracts")
      .update({
        status: "cancelled",
        ends_at: nowIso,
        termination_reason: "other",
        rejected_reason: archiveReason,
        updated_by: actorUserId,
      })
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .in("id", contractIds);
    if (contractsUpdateError) throw contractsUpdateError;
  }

  const { data: switchRows, error: switchLookupError } = await supabaseService
    .from("supplier_switch_requests")
    .select("id")
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .in("status", ["draft", "queued", "submitted", "accepted", "cancellation_requested", "cancellation_sent", "manual_followup_required"]);
  if (switchLookupError) throw switchLookupError;
  const switchIds = (switchRows ?? []).map((row: { id: string }) => row.id).filter(Boolean);
  if (switchIds.length > 0) {
    const { error: switchUpdateError } = await supabaseService
      .from("supplier_switch_requests")
      .update({
        status: "failed",
        failed_at: nowIso,
        failure_reason: archiveReason,
        updated_by: actorUserId,
      })
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .in("id", switchIds);
    if (switchUpdateError) throw switchUpdateError;
  }

  if (switchIds.length > 0) {
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
  }

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

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/platform/data-cleanup");

  return {
    status: "success",
    message: "Kunden har arkiverats. Historiken sparas för spårbarhet.",
  };
}

const PROTECTED_DELETE_MESSAGE =
  "Kunden kunde inte raderas. Kunden har historik och ska arkiveras i stället.";

/**
 * Returns a controlled Swedish blocker message when the customer has protected
 * operational history (contracts, invoices, switches, Ediel, partner export,
 * or any manual grid-owner / POA / communication-log history), otherwise null. Manual grid-owner
 * data (information requests, manual email outbox, manual inbound, POA events /
 * documents, customer operation history, blockers and communication logs/events) blocks permanent delete and routes the user to archive.
 */
function describeProtectedDeleteData(
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

async function deleteCustomerForRecreateImpl(
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
