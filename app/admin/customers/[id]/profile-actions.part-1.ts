// Extracted from profile-actions.ts; keep public imports on the facade module.
import { revalidatePath } from "next/cache"

import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireAdminActionAccess } from "@/lib/admin/guards"
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions"
import { currentSupportSession } from "@/lib/customer-operations/supportSession"
import { changeCustomerLegalProfile, LegalProfileCommandError } from "@/lib/customer-operations/legalProfileCommand"
import { closeCustomerLifecycle, CustomerLifecycleCommandError } from "@/lib/customer-operations/lifecycleCommand"
import { PlatformSchemaNotReadyError } from "@/lib/platform/schemaReadiness"
import { supabaseService } from "@/lib/supabase/service"
import { assertUserCanOperateCompany } from "@/lib/tenant/scope"
import { logAdminActionAndUsage } from "@/lib/audit/actionLogger"
import type { CustomerActionState } from "./customer-action-state"

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

    console.error("[customer-card-action] Unexpected error", { code: 'unexpected' });
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

export async function runBestEffortCustomerArchiveStep(
  step: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (!isDatabaseShapeError(error)) {
      console.warn(`[customer-archive] ${step} failed`, error);
      return;
    }

    console.warn(`[customer-archive] ${step} skipped because schema differs`, error);
  }
}

export async function getBestEffortArchiveIds(
  step: string,
  fn: () => Promise<string[]>,
): Promise<string[]> {
  try {
    return await fn();
  } catch (error) {
    console.warn(`[customer-archive] ${step} lookup failed`, error);
    return [];
  }
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
  const guard = await requireAdminActionAccess(['customers.write']);
  const actorUserId = guard.userId;
  if (formData.has("email") || formData.has("phone")) {
    throw new CustomerActionError("contact_command_required", "E-post och telefon ändras under Kontakter med sparad kontaktrevision.");
  }
  const allowed = new Set(["customer_id", "customer_type", "first_name", "last_name", "company_name", "personal_number", "org_number", "apartment_number", "status", "expected_legal_profile_revision", "idempotency_key"]);
  if (Array.from(formData.keys()).some(key => !allowed.has(key) && !key.startsWith("$ACTION_"))) {
    throw new CustomerActionError("invalid_legal_profile_command", "Formuläret innehåller uppgifter som inte kan ändras med den juridiska kundprofilen.");
  }
  const customerId = getString(formData, "customer_id");
  const revisionText = getString(formData, "expected_legal_profile_revision");
  const expectedRevision = Number(revisionText);
  const idempotencyKey = getString(formData, "idempotency_key");
  if (!customerId || !/^[0-9]{1,16}$/.test(revisionText) || !Number.isSafeInteger(expectedRevision) ||
      !/^[A-Za-z0-9._:+~-]{8,200}$/.test(idempotencyKey)) {
    throw new CustomerActionError("invalid_legal_profile_command", "Sparad juridisk profilrevision och försöksnyckel krävs. Läs om kundkortet före ett nytt försök.");
  }
  const customerType = getString(formData, "customer_type");
  if (!["private", "business", "association"].includes(customerType)) {
    throw new CustomerActionError("invalid_legal_profile_command", "Välj en giltig kundtyp.");
  }
  const { data: before, error: beforeError } = await supabaseService
    .from("customers").select("id,company_id,status,legal_profile_revision").eq("id", customerId).single();
  if (beforeError) throw beforeError;
  if (!before || ((!guard.isPlatformAdmin || guard.companyId) && guard.companyId !== before.company_id)) {
    throw new CustomerActionError('forbidden', 'Kunden tillhör inte den aktuella arbetsytan.');
  }
  if (!before || before.status === "archived") {
    throw new CustomerActionError("customer_archived_profile_locked", "Arkiverad kund kan inte ändras via vanlig profil.");
  }
  if (formData.has("status") && getString(formData, "status") !== before.status) {
    throw new CustomerActionError("legal_lifecycle_command_required", "Kundstatus ändras genom en separat livscykelåtgärd, med kontroll av avtal och anläggningar.");
  }
  const companyId = await assertUserCanOperateCompany(actorUserId, typeof before.company_id === "string" ? before.company_id : null);
  try {
    const session = await currentSupportSession('ops', actorUserId);
    const result = await changeCustomerLegalProfile({
      companyId, customerId,
      actor: { kind: 'ops', userId: session.userId, sessionId: session.sessionId, reason: 'OPS legal customer profile' },
      expectedRevision, idempotencyKey,
      changes: {
        customer_type: customerType as 'private' | 'business' | 'association',
        first_name: getNullableString(formData, "first_name"), last_name: getNullableString(formData, "last_name"),
        company_name: getNullableString(formData, "company_name"), personal_number: getNullableString(formData, "personal_number"),
        org_number: getNullableString(formData, "org_number"), apartment_number: getNullableString(formData, "apartment_number"),
      },
    });
    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath(`/admin/customers/${customerId}/profile`);
    revalidatePath("/admin/customers");
    revalidatePath("/admin/customers/segments");
    return { status: "success", message: result.changed ? "Den juridiska kundprofilen har sparats." : "Den juridiska kundprofilen är redan sparad.", ...result };
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    if (error instanceof LegalProfileCommandError) {
      const message = error.status === 409
        ? "Kundprofilen eller försöket har ändrats. Ditt utkast är kvar. Läs om och jämför aktuell revision före ett nytt försök."
        : error.status === 403 ? "Du saknar aktuell behörighet att ändra kundens juridiska profil."
        : "Kontrollera kundtyp, namn och juridiska uppgifter. Ändringen kunde inte bekräftas.";
      throw new CustomerActionError(error.code, message);
    }
    if (error instanceof PlatformSchemaNotReadyError) {
      throw new CustomerActionError(error.code, "Juridisk profiländring är tillfälligt blockerad av databasversionen. Ditt utkast är kvar.");
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'support_session_revoked') {
      throw new CustomerActionError('legal_profile_actor_forbidden', "Din aktuella session kan inte verkställa ändringen. Logga in igen och jämför sparade uppgifter.");
    }
    // A canonical command error rolls back. Never expose raw SQL/identity details.
    throw new CustomerActionError('legal_profile_command_failed', "Ändringen kunde inte bekräftas. Ditt utkast och försöksnyckel är kvar. Kontrollera sparade uppgifter före ett nytt försök.");
  }

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
  const guard = await requireAdminActionAccess(['customers.write']);
  const actorUserId = guard.userId;
  const allowed = new Set(['customer_id', 'confirm_close', 'lifecycle_mode', 'move_out_date', 'reason',
    'create_follow_up_task', 'expected_lifecycle_revision', 'idempotency_key']);
  if (Array.from(formData.keys()).some(key => !allowed.has(key) && !key.startsWith('$ACTION_'))) {
    throw new CustomerActionError('invalid_lifecycle_command', 'Formuläret innehåller otillåtna livscykelfält.');
  }
  const customerId = getString(formData, 'customer_id');
  const revisionText = getString(formData, 'expected_lifecycle_revision');
  const expectedRevision = Number(revisionText);
  const idempotencyKey = getString(formData, 'idempotency_key');
  const mode = getString(formData, 'lifecycle_mode');
  const moveOutDate = getString(formData, 'move_out_date');
  const reason = getString(formData, 'reason');
  const date = new Date(`${moveOutDate}T00:00:00.000Z`);
  if (!customerId || !/^[0-9]{1,16}$/.test(revisionText) || !Number.isSafeInteger(expectedRevision) ||
      !/^[A-Za-z0-9._:+~-]{8,200}$/.test(idempotencyKey) || !['move_out', 'terminate'].includes(mode) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(moveOutDate) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== moveOutDate || !reason || reason.length > 200 ||
      (formData.has('create_follow_up_task') && getString(formData, 'create_follow_up_task') !== 'on')) {
    throw new CustomerActionError('invalid_lifecycle_command', 'Sparad livscykelrevision, försöksnyckel, giltigt datum och orsak krävs.');
  }
  if (getString(formData, 'confirm_close') !== 'AVSLUTA') {
    throw new CustomerActionError('confirm_mismatch', 'Skriv AVSLUTA för att bekräfta mjukt avslut/flytt av kunden.');
  }
  const { data: customer, error } = await supabaseService.from('customers')
    .select('id,company_id,status,lifecycle_revision').eq('id', customerId).single();
  if (error) throw error;
  if (!customer || ((!guard.isPlatformAdmin || guard.companyId) && guard.companyId !== customer.company_id)) {
    throw new CustomerActionError('forbidden', 'Kunden tillhör inte den aktuella arbetsytan.');
  }
  const companyId = await assertUserCanOperateCompany(actorUserId,
    typeof customer.company_id === 'string' ? customer.company_id : null);
  try {
    const session = await currentSupportSession('ops', actorUserId);
    const result = await closeCustomerLifecycle({
      companyId, customerId, actor: { kind: 'ops', userId: session.userId, sessionId: session.sessionId },
      expectedRevision, idempotencyKey, mode: mode as 'move_out' | 'terminate', moveOutDate, reason,
      createFollowUpTask: getString(formData, 'create_follow_up_task') === 'on',
    });
    // The RPC owns local effects, canonical audit and the pending confirmation
    // intent. A replay never sends mail or re-executes separate domain writers.
    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath(`/admin/customers/${customerId}/profile`);
    revalidatePath('/admin/customers');
    revalidatePath('/admin/customers/segments');
    revalidatePath('/admin/operations');
    revalidatePath('/admin/controltower');
    return { status: 'success', message: result.replayed
      ? 'Det tidigare avslutet har återlästs. Historiken sparas.'
      : mode === 'terminate' ? 'Kundrelationen har avslutats. Historiken sparas.'
      : 'Flytt/avslut har registrerats. Historiken sparas.', ...result };
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    if (error instanceof CustomerLifecycleCommandError) {
      throw new CustomerActionError(error.code, error.status === 409
        ? 'Kundens livscykel eller försöket har ändrats. Ditt utkast är kvar. Läs om och jämför aktuell revision.'
        : error.status === 403 ? 'Du saknar aktuell behörighet att avsluta kundrelationen.'
        : 'Avslutet kunde inte bekräftas. Kontrollera datum, orsak och sparade uppgifter före ett nytt försök.');
    }
    if (error instanceof PlatformSchemaNotReadyError) {
      throw new CustomerActionError(error.code, 'Livscykelåtgärden är tillfälligt blockerad av databasversionen. Ditt utkast är kvar.');
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'support_session_revoked') {
      throw new CustomerActionError('lifecycle_actor_forbidden', 'Din aktuella session kan inte verkställa ändringen. Logga in igen och jämför sparade uppgifter.');
    }
    throw new CustomerActionError('lifecycle_command_failed', 'Avslutet kunde inte bekräftas. Ditt utkast och försöksnyckel är kvar. Kontrollera sparade uppgifter före ett nytt försök.');
  }
}

export async function selectIds(
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

export async function selectIdsByCustomerId(
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

export async function deleteByIds(table: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabaseService.from(table).delete().in("id", ids);
  if (error) throw error;
}

export async function deleteByColumn(
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

export async function deleteByCustomerId(
  table: string,
  customerId: string,
): Promise<void> {
  const { error } = await supabaseService
    .from(table)
    .delete()
    .eq("customer_id", customerId);
  if (error) throw error;
}

export const MISSING_SCHEMA_CODES = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "PGRST204", // column not found in schema cache
  "PGRST205", // table not found in schema cache
]);

export function isMissingSchemaError(
  error: { code?: string | null } | null | undefined,
): boolean {
  return Boolean(error?.code && MISSING_SCHEMA_CODES.has(error.code));
}

export async function selectRowsByColumnSafe(
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

export function uniqueCleanStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  );
}

export async function selectIdsByColumnSafe(
  table: string,
  column: string,
  values: string[],
): Promise<string[]> {
  const rows = await selectRowsByColumnSafe(table, "id", column, values);
  return uniqueCleanStrings(rows.map((row) => row.id));
}

export async function selectIdsByCustomerIdSafe(
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

export async function deleteByIdsSafe(table: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabaseService.from(table).delete().in("id", ids);
  if (error && !isMissingSchemaError(error)) throw error;
}

export async function deleteByColumnSafe(
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

export async function deleteByCustomerIdSafe(
  table: string,
  customerId: string,
): Promise<void> {
  const { error } = await supabaseService
    .from(table)
    .delete()
    .eq("customer_id", customerId);
  if (error && !isMissingSchemaError(error)) throw error;
}

export async function collectManualFlowDeleteGraph(
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

  const customerDocumentIds: string[] = [];
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
