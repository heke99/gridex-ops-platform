// Extracted from profile-actions.ts; keep public imports on the facade module.
import { revalidatePath } from "next/cache"

import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireAdminActionAccess } from "@/lib/admin/guards"
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions"
import { supabaseService } from "@/lib/supabase/service"
import { ContactChangeTransactionError, applyCustomerContactChange } from "@/lib/customer-service/contactChangeTransaction"
import { assertUserCanOperateCompany } from "@/lib/tenant/scope"
import { queueTenantTemplateEmail } from "@/lib/tenant/emailTemplates"
import { logAdminActionAndUsage, logUsageEvent } from "@/lib/audit/actionLogger"
import type { CustomerActionState } from "./customer-action-state"
import {
  CustomerContactChangeError,
  assertProfileEditableStatus,
  normalizeContactEmail,
  normalizeContactPhone,
  planPrimaryContactSync,
} from "@/lib/customer-service/contactChange"
import { identityNumbersEqual } from "@/lib/customer-service/identityChange"

export class CustomerActionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CustomerActionError";
    this.code = code;
  }
}

export function isNextControlFlowError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

export async function runCustomerCardAction(
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

export function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export function getNullableString(formData: FormData, key: string): string | null {
  const value = getString(formData, key);
  return value || null;
}

export function isDatabaseShapeError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null;
  return Boolean(
    maybe &&
      (maybe.code === "42P01" ||
        maybe.code === "42703" ||
        maybe.code === "PGRST204" ||
        maybe.code === "PGRST205" ||
        /does not exist|schema cache|relation .* does not exist|column .* does not exist/i.test(
          maybe.message ?? "",
        )),
  );
}

export function normalizeCustomerType(
  value: string | null | undefined,
): "private" | "business" | "association" {
  if (value === "business") return "business";
  if (value === "association") return "association";
  return "private";
}

export function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function requireValue(value: string | null | undefined, message: string) {
  if (!normalizeOptionalString(value)) {
    throw new CustomerActionError("validation", message);
  }
}

export async function getActorUserId(): Promise<string> {
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

export async function insertAuditLog(params: {
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

export async function saveCustomerProfileImpl(
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
  // The OPS form always posts these fields, so an empty value is an explicit clear. Values are
  // validated only when they change, so legacy stored formats never block unrelated edits.
  const rawEmail = normalizeOptionalString(getNullableString(formData, "email")) ?? null;
  const rawPhone = normalizeOptionalString(getNullableString(formData, "phone")) ?? null;
  const rawStatus = getNullableString(formData, "status");
  const expectedUpdatedAt = normalizeOptionalString(
    getNullableString(formData, "expected_updated_at"),
  );
  const apartmentNumber = normalizeOptionalString(
    getNullableString(formData, "apartment_number"),
  );

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

  if (
    expectedUpdatedAt &&
    String((before as Record<string, unknown>).updated_at ?? "") !== expectedUpdatedAt
  ) {
    throw new CustomerActionError(
      "version_conflict",
      "Kunden har ändrats av någon annan sedan du öppnade formuläret. Ladda om och gör ändringen igen.",
    );
  }

  if (String((before as Record<string, unknown>).status ?? '').toLowerCase() === "archived") {
    throw new CustomerActionError(
      "customer_archived_profile_locked",
      "Arkiverad kund kan inte återaktiveras eller ändras via vanlig profil. Öppna arkivläget eller använd en separat återställningsåtgärd.",
    );
  }

  const stored = before as Record<string, unknown>;
  // F12: personal and organization numbers are never changed by the ordinary profile save. They
  // go through the audited identity-change flow (customer approval when there are contracts).
  if (
    !identityNumbersEqual(personalNumber, typeof stored.personal_number === "string" ? stored.personal_number : null) ||
    !identityNumbersEqual(orgNumber, typeof stored.org_number === "string" ? stored.org_number : null)
  ) {
    throw new CustomerActionError(
      "identity_change_requires_flow",
      "Personnummer och organisationsnummer ändras via \"Ändra personnummer/organisationsnummer\" på kundkortet. Ändringen loggas och kräver kundens godkännande om kunden har avtal.",
    );
  }
  let email: string | null;
  let phone: string | null;
  let status: string;
  try {
    email = rawEmail === (stored.email ?? null) ? rawEmail : normalizeContactEmail(rawEmail ?? "") ?? null;
    phone = rawPhone === (stored.phone ?? null) ? rawPhone : normalizeContactPhone(rawPhone ?? "") ?? null;
    status = rawStatus && rawStatus === stored.status
      ? rawStatus
      : assertProfileEditableStatus(rawStatus, "draft");
  } catch (error) {
    if (error instanceof CustomerContactChangeError) {
      throw new CustomerActionError(error.code, error.message);
    }
    throw error;
  }

  const companyId = await assertUserCanOperateCompany(
    actorUserId,
    typeof before.company_id === "string" ? before.company_id : null,
  );

  const primaryContactName =
    customerType === "private"
      ? [firstName, lastName].filter(Boolean).join(" ").trim() || null
      : [firstName, lastName].filter(Boolean).join(" ").trim() ||
        companyName ||
        null;

  const contactPatch = planPrimaryContactSync({
    customerType,
    contactName: primaryContactName,
    email,
    phone,
  });

  // One transaction (tenantservice P2b): version lock, customer, primary contact, audit and
  // outbox. Without a form version the version read above is the lock, so a concurrent save
  // between read and write is still rejected.
  try {
    await applyCustomerContactChange({
      companyId,
      customerId,
      actor: { kind: "staff", userId: actorUserId },
      channel: "ops",
      expectedUpdatedAt: expectedUpdatedAt ?? (typeof stored.updated_at === "string" ? stored.updated_at : null),
      customerPatch: {
        customer_type: customerType,
        status,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        company_name: companyName,
        personal_number: (stored.personal_number as string | null) ?? null,
        org_number: (stored.org_number as string | null) ?? null,
        email,
        phone,
        apartment_number: apartmentNumber,
      },
      contactPatch,
    });
  } catch (error) {
    if (error instanceof ContactChangeTransactionError) {
      throw new CustomerActionError(
        error.code === "customer_archived" ? "customer_archived_profile_locked" : error.code === "not_authorized" ? "forbidden" : error.code,
        error.code === "version_conflict"
          ? "Kunden har ändrats av någon annan samtidigt. Ladda om och gör ändringen igen."
          : error.message,
      );
    }
    throw error;
  }

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath(`/admin/customers/${customerId}/profile`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/customers/segments");

  return { status: "success", message: "Kundprofilen har sparats." };
}

export function normalizeLifecycleMode(
  value: string | null | undefined,
): "move_out" | "terminate" {
  return value === "terminate" ? "terminate" : "move_out";
}

export function normalizeIsoDateOrToday(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return new Date().toISOString().slice(0, 10);
}

export function buildMoveOutNote(params: {
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

export async function closeCustomerLifecycleImpl(
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

  const note = buildMoveOutNote({ moveOutDate, reason, mode });

  // Customer, sites, metering points, contracts, switch requests, tasks, the
  // internal note and the lifecycle event are written in one transaction.
  const { data: closeData, error: closeError } = await supabaseService.rpc(
    "gridex_close_customer_lifecycle_v1",
    {
      p_company_id: companyId,
      p_customer_id: customerId,
      p_actor_user_id: actorUserId,
      p_mode: mode,
      p_move_out_date: moveOutDate,
      p_reason: reason,
      p_note: note,
      p_create_follow_up_task: createFollowUpTask,
    },
  );

  if (closeError) {
    if (closeError.message === "customer_lifecycle_already_closed") {
      throw new CustomerActionError(
        "already_closed",
        "Kunden är redan avslutad, flyttad eller arkiverad.",
      );
    }
    throw closeError;
  }

  const closed = (closeData ?? {}) as {
    customer?: Record<string, unknown>;
    failed_switch_request_ids?: string[];
    lifecycle?: Record<string, unknown>;
  };
  const customerAfter = closed.customer ?? {};
  const lifecycleMetadata = closed.lifecycle ?? { mode, moveOutDate, reason };
  const activeSwitchIds = closed.failed_switch_request_ids ?? [];

  if (activeSwitchIds.length > 0) {
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

  await insertAuditLog({
    actorUserId,
    entityType: "customer",
    entityId: customerId,
    action:
      mode === "terminate"
        ? "customer_soft_terminated"
        : "customer_move_out_registered",
    companyId,
    oldValues: { customer: customerBefore },
    newValues: {
      customer: customerAfter,
      lifecycle: lifecycleMetadata,
    },
    metadata: {
      companyId,
      retainedData: true,
      hardDelete: false,
      closedSites: (closeData as Record<string, unknown> | null)?.closed_sites ?? 0,
      closedMeteringPoints: (closeData as Record<string, unknown> | null)?.closed_metering_points ?? 0,
      closedContracts: (closeData as Record<string, unknown> | null)?.closed_contracts ?? 0,
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
