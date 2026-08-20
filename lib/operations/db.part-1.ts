// Extracted from db.ts; keep public imports on the facade module.
import type { SupabaseClient } from "@supabase/supabase-js"






import { OPEN_SUPPLIER_SWITCH_STATUSES } from "@/lib/operations/switchLifecycleBlocks"
import type { CustomerAuthorizationDocumentRow, CustomerBlockerRow, CustomerOperationTaskRow, PowerOfAttorneyRow, SupplierSwitchRequestRow } from "@/lib/operations/types"

export async function getActorId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

export async function resolveCustomerCompanyId(
  supabase: SupabaseClient,
  customerId: string,
  providedCompanyId?: string | null,
): Promise<string> {
  if (providedCompanyId) return providedCompanyId;

  const { data, error } = await supabase
    .from("customers")
    .select("company_id")
    .eq("id", customerId)
    .maybeSingle();

  if (error) throw error;
  const companyId = (data as { company_id?: string | null } | null)?.company_id ?? null;
  if (!companyId) {
    throw new Error("Kunden saknar bolagskoppling och kan därför inte ändras säkert.");
  }

  return companyId;
}

export function appendNote(
  existing: string | null | undefined,
  extra: string,
): string {
  const base = (existing ?? "").trim();
  if (!base) return extra;
  if (base.includes(extra)) return base;
  return `${base}\n\n${extra}`;
}

export const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export function buildDocumentUploadIdempotencyKey(params: {
  customerId: string;
  siteId?: string | null;
  documentType: "power_of_attorney" | "complete_agreement" | "grid_invoice_suggested";
  fileChecksum: string;
}): string {
  return `cust:${params.customerId}|site:${params.siteId ?? EMPTY_UUID}|type:${params.documentType}|sha:${params.fileChecksum}`;
}

export async function createAuditLogEntry(
  supabase: SupabaseClient,
  input: {
    actorUserId?: string | null;
    entityType: string;
    entityId: string;
    action: string;
    oldValues?: unknown;
    newValues?: unknown;
    metadata?: unknown;
  },
): Promise<void> {
  const actorId = input.actorUserId ?? (await getActorId(supabase));

  const { error } = await supabase.from("audit_logs").insert({
    actor_user_id: actorId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    old_values: input.oldValues ?? null,
    new_values: input.newValues ?? null,
    metadata: input.metadata ?? null,
  });

  if (error) throw error;
}

export async function findExistingCustomerAuthorizationDocumentByFingerprint(
  supabase: SupabaseClient,
  params: {
    customerId: string;
    siteId?: string | null;
    documentType: "power_of_attorney" | "complete_agreement" | "grid_invoice_suggested";
    fileChecksum: string;
  },
): Promise<CustomerAuthorizationDocumentRow | null> {
  let query = supabase
    .from("customer_authorization_documents")
    .select("*")
    .eq("customer_id", params.customerId)
    .eq("document_type", params.documentType)
    .eq("file_checksum", params.fileChecksum)
    .neq("status", "archived")
    .order("uploaded_at", { ascending: false })
    .limit(1);

  query = params.siteId
    ? query.eq("site_id", params.siteId)
    : query.is("site_id", null);

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return (data as CustomerAuthorizationDocumentRow | null) ?? null;
}

export async function listCustomerBlockersByCustomerId(
  supabase: SupabaseClient,
  customerId: string,
  options: { companyId?: string | null; includeResolved?: boolean; limit?: number } = {},
): Promise<CustomerBlockerRow[]> {
  let query = supabase
    .from("customer_blockers")
    .select("*")
    .eq("customer_id", customerId);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  if (!options.includeResolved) {
    query = query.in("status", ["open", "pending_review"]);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (error) {
    const code = findPostgresErrorCode(error);
    const message = (error as { message?: string }).message ?? "";
    if (code === "42P01" || code === "42703" || code === "PGRST205" || /schema cache|does not exist/i.test(message)) {
      return [];
    }
    throw error;
  }

  return (data ?? []) as CustomerBlockerRow[];
}

export async function listPowersOfAttorneyByCustomerId(
  supabase: SupabaseClient,
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {},
): Promise<PowerOfAttorneyRow[]> {
  let query = supabase
    .from("powers_of_attorney")
    .select("*")
    .eq("customer_id", customerId);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (error) throw error;
  return (data ?? []) as PowerOfAttorneyRow[];
}

export async function listPowersOfAttorneyByCustomerIds(
  supabase: SupabaseClient,
  customerIds: string[],
  options: { companyId?: string | null; limit?: number } = {},
): Promise<PowerOfAttorneyRow[]> {
  const uniqueCustomerIds = Array.from(new Set(customerIds.filter(Boolean)));
  if (uniqueCustomerIds.length === 0) return [];

  let query = supabase
    .from("powers_of_attorney")
    .select("*")
    .in("customer_id", uniqueCustomerIds);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 200);

  if (error) throw error;
  return (data ?? []) as PowerOfAttorneyRow[];
}

export async function getPowerOfAttorneyById(
  supabase: SupabaseClient,
  powerOfAttorneyId: string,
): Promise<PowerOfAttorneyRow | null> {
  const { data, error } = await supabase
    .from("powers_of_attorney")
    .select("*")
    .eq("id", powerOfAttorneyId)
    .maybeSingle();

  if (error) throw error;
  return (data as PowerOfAttorneyRow | null) ?? null;
}

export async function savePowerOfAttorney(
  supabase: SupabaseClient,
  input: {
    id?: string;
    customer_id: string;
    site_id?: string | null;
    scope: "supplier_switch" | "meter_data" | "billing_handoff";
    status: "draft" | "sent" | "signed" | "expired" | "revoked";
    signed_at?: string | null;
    valid_from?: string | null;
    valid_to?: string | null;
    document_path?: string | null;
    reference?: string | null;
    notes?: string | null;
    companyId?: string | null;
    // Optional evidence fields, primarily for manual PDF / admin-recorded
    // powers of attorney so they can be used for external grid-owner
    // communication (signer + method + snapshot). All optional and additive.
    method?: string | null;
    signer_name?: string | null;
    signer_identity_number?: string | null;
    accepted_at?: string | null;
    accepted_source?: string | null;
    scopeSummary?: Record<string, unknown> | null;
    signedScopes?: string[] | null;
  },
): Promise<PowerOfAttorneyRow> {
  const actorId = await getActorId(supabase);
  const companyId = await resolveCustomerCompanyId(supabase, input.customer_id, input.companyId);

  const payload: Record<string, unknown> = {
    customer_id: input.customer_id,
    site_id: input.site_id ?? null,
    scope: input.scope,
    status: input.status,
    signed_at: input.signed_at ?? null,
    valid_from: input.valid_from ?? null,
    valid_to: input.valid_to ?? null,
    document_path: input.document_path ?? null,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    updated_by: actorId,
    company_id: companyId,
  };
  // Only include evidence columns when provided so existing callers and schemas
  // are unaffected.
  if (input.method !== undefined) payload.method = input.method;
  if (input.signer_name !== undefined) payload.signer_name = input.signer_name;
  if (input.signer_identity_number !== undefined) payload.signer_identity_number = input.signer_identity_number;
  if (input.accepted_at !== undefined) payload.accepted_at = input.accepted_at;
  if (input.accepted_source !== undefined) payload.accepted_source = input.accepted_source;
  if (input.scopeSummary !== undefined) payload.scope_summary = input.scopeSummary;
  if (input.signedScopes !== undefined) payload.signed_scope_snapshot = input.signedScopes ?? [];

  if (input.id) {
    // Tenant guard: an update by id must stay inside the customer's company so
    // a mistaken/forged id can never mutate another tenant's power of attorney.
    let updateQuery = supabase
      .from("powers_of_attorney")
      .update(payload)
      .eq("id", input.id);
    if (companyId) updateQuery = updateQuery.eq("company_id", companyId);

    const { data, error } = await updateQuery.select("*").single();

    if (error) throw error;
    return data as PowerOfAttorneyRow;
  }

  const { data, error } = await supabase
    .from("powers_of_attorney")
    .insert({
      ...payload,
      created_by: actorId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as PowerOfAttorneyRow;
}

export async function revokePowerOfAttorney(
  supabase: SupabaseClient,
  params: {
    powerOfAttorneyId: string;
    reason?: string | null;
  },
): Promise<PowerOfAttorneyRow> {
  const actorId = await getActorId(supabase);
  const existing = await getPowerOfAttorneyById(
    supabase,
    params.powerOfAttorneyId,
  );

  if (!existing) {
    throw new Error("Fullmakten hittades inte");
  }

  const { data, error } = await supabase
    .from("powers_of_attorney")
    .update({
      status: "revoked",
      notes: params.reason
        ? appendNote(existing.notes, params.reason)
        : (existing.notes ?? null),
      updated_by: actorId,
    })
    .eq("id", params.powerOfAttorneyId)
    .select("*")
    .single();

  if (error) throw error;
  return data as PowerOfAttorneyRow;
}

export async function restorePowerOfAttorneyIfRevoked(
  supabase: SupabaseClient,
  params: {
    powerOfAttorneyId: string;
    note?: string | null;
  },
): Promise<PowerOfAttorneyRow> {
  const actorId = await getActorId(supabase);
  const existing = await getPowerOfAttorneyById(
    supabase,
    params.powerOfAttorneyId,
  );

  if (!existing) {
    throw new Error("Fullmakten hittades inte");
  }

  if (existing.status !== "revoked") {
    return existing;
  }

  const restoredStatus: PowerOfAttorneyRow["status"] = existing.signed_at
    ? "signed"
    : "sent";

  const { data, error } = await supabase
    .from("powers_of_attorney")
    .update({
      status: restoredStatus,
      notes: params.note
        ? appendNote(existing.notes, params.note)
        : (existing.notes ?? null),
      updated_by: actorId,
    })
    .eq("id", params.powerOfAttorneyId)
    .select("*")
    .single();

  if (error) throw error;
  return data as PowerOfAttorneyRow;
}

export async function listCustomerAuthorizationDocumentsByCustomerId(
  supabase: SupabaseClient,
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {},
): Promise<CustomerAuthorizationDocumentRow[]> {
  let query = supabase
    .from("customer_authorization_documents")
    .select("*")
    .eq("customer_id", customerId);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query
    .order("uploaded_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (error) throw error;
  return (data ?? []) as CustomerAuthorizationDocumentRow[];
}

export async function getCustomerAuthorizationDocumentById(
  supabase: SupabaseClient,
  documentId: string,
): Promise<CustomerAuthorizationDocumentRow | null> {
  const { data, error } = await supabase
    .from("customer_authorization_documents")
    .select("*")
    .eq("id", documentId)
    .maybeSingle();

  if (error) throw error;
  return (data as CustomerAuthorizationDocumentRow | null) ?? null;
}

export function findPostgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : null;
}

export function buildGridOwnerDataRequestAutomationKey(params: {
  documentId: string;
  requestScope: "meter_values" | "billing_underlay" | "customer_masterdata";
}): string {
  return `doc:${params.documentId}|gor_scope:${params.requestScope}`;
}

export function buildOutboundRequestAutomationKey(params: {
  documentId: string;
  requestType:
    | "supplier_switch"
    | "customer_masterdata"
    | "meter_values"
    | "billing_underlay";
  sourceType?:
    | "supplier_switch_request"
    | "grid_owner_data_request"
    | "bulk_generation"
    | "manual"
    | null;
}): string {
  return `doc:${params.documentId}|out_req:${params.requestType}|src:${params.sourceType ?? "none"}`;
}

export function buildSupplierSwitchRequestAutomationKey(
  documentId: string,
): string {
  return `doc:${documentId}|switch`;
}

export async function getSupplierSwitchRequestByAutomationKey(
  supabase: SupabaseClient,
  automationKey: string,
): Promise<SupplierSwitchRequestRow | null> {
  // Prefer the open request; a completed/cancelled historical row may share
  // the same automation key (uniqueness is enforced for open statuses only).
  const openResult = await supabase
    .from("supplier_switch_requests")
    .select("*")
    .eq("automation_key", automationKey)
    .in("status", OPEN_SUPPLIER_SWITCH_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openResult.error) throw openResult.error;
  if (openResult.data) return openResult.data as SupplierSwitchRequestRow;

  const { data, error } = await supabase
    .from("supplier_switch_requests")
    .select("*")
    .eq("automation_key", automationKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as SupplierSwitchRequestRow | null) ?? null;
}

export async function assignAuthorizationDocumentToGridOwnerRequest(
  supabase: SupabaseClient,
  params: {
    requestId: string;
    documentId: string;
  },
): Promise<void> {
  const actorId = await getActorId(supabase);
  const { data: existing, error: existingError } = await supabase
    .from("grid_owner_data_requests")
    .select("id, request_scope")
    .eq("id", params.requestId)
    .single();

  if (existingError) throw existingError;

  const { error } = await supabase
    .from("grid_owner_data_requests")
    .update({
      authorization_document_id: params.documentId,
      automation_origin: "document_upload",
      automation_key: buildGridOwnerDataRequestAutomationKey({
        documentId: params.documentId,
        requestScope: existing.request_scope,
      }),
      updated_by: actorId,
    })
    .eq("id", params.requestId);

  if (error) throw error;
}

export async function assignAuthorizationDocumentToOutboundRequest(
  supabase: SupabaseClient,
  params: {
    outboundRequestId: string;
    documentId: string;
  },
): Promise<void> {
  const actorId = await getActorId(supabase);
  const { data: existing, error: existingError } = await supabase
    .from("outbound_requests")
    .select("id, request_type, source_type")
    .eq("id", params.outboundRequestId)
    .single();

  if (existingError) throw existingError;

  const { error } = await supabase
    .from("outbound_requests")
    .update({
      authorization_document_id: params.documentId,
      automation_origin: "document_upload",
      automation_key: buildOutboundRequestAutomationKey({
        documentId: params.documentId,
        requestType: existing.request_type,
        sourceType: existing.source_type,
      }),
      updated_by: actorId,
    })
    .eq("id", params.outboundRequestId);

  if (error) throw error;
}

export async function assignAuthorizationDocumentToSwitchRequest(
  supabase: SupabaseClient,
  params: {
    requestId: string;
    documentId: string;
  },
): Promise<void> {
  const actorId = await getActorId(supabase);

  const { error } = await supabase
    .from("supplier_switch_requests")
    .update({
      authorization_document_id: params.documentId,
      automation_origin: "document_upload",
      automation_key: buildSupplierSwitchRequestAutomationKey(
        params.documentId,
      ),
      updated_by: actorId,
    })
    .eq("id", params.requestId);

  if (error) throw error;
}

export async function findOpenGridOwnerDataRequestByDocument(
  supabase: SupabaseClient,
  params: {
    customerId: string;
    siteId?: string | null;
    meteringPointId?: string | null;
    requestScope: "meter_values" | "billing_underlay" | "customer_masterdata";
    documentId: string;
  },
) {
  const automationKey = buildGridOwnerDataRequestAutomationKey({
    documentId: params.documentId,
    requestScope: params.requestScope,
  });

  const { data: automated, error: automatedError } = await supabase
    .from("grid_owner_data_requests")
    .select("*")
    .eq("automation_key", automationKey)
    .in("status", ["pending", "sent", "received"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (automatedError) throw automatedError;
  if (automated) return automated;

  let query = supabase
    .from("grid_owner_data_requests")
    .select("*")
    .eq("customer_id", params.customerId)
    .eq("request_scope", params.requestScope)
    .eq("authorization_document_id", params.documentId)
    .in("status", ["pending", "sent", "received"]);

  query = params.siteId
    ? query.eq("site_id", params.siteId)
    : query.is("site_id", null);
  query = params.meteringPointId
    ? query.eq("metering_point_id", params.meteringPointId)
    : query.is("metering_point_id", null);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function findOpenOutboundRequestByDocument(
  supabase: SupabaseClient,
  params: {
    customerId: string;
    siteId?: string | null;
    meteringPointId?: string | null;
    requestType:
      | "supplier_switch"
      | "customer_masterdata"
      | "meter_values"
      | "billing_underlay";
    documentId: string;
    sourceType?:
      | "supplier_switch_request"
      | "grid_owner_data_request"
      | "bulk_generation"
      | "manual"
      | null;
    sourceId?: string | null;
  },
) {
  const automationKey = buildOutboundRequestAutomationKey({
    documentId: params.documentId,
    requestType: params.requestType,
    sourceType: params.sourceType ?? null,
  });

  const { data: automated, error: automatedError } = await supabase
    .from("outbound_requests")
    .select("*")
    .eq("automation_key", automationKey)
    .in("status", ["queued", "prepared", "sent", "acknowledged"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (automatedError) throw automatedError;
  if (automated) return automated;

  let query = supabase
    .from("outbound_requests")
    .select("*")
    .eq("customer_id", params.customerId)
    .eq("request_type", params.requestType)
    .eq("authorization_document_id", params.documentId)
    .in("status", ["queued", "prepared", "sent", "acknowledged"]);

  query = params.siteId
    ? query.eq("site_id", params.siteId)
    : query.is("site_id", null);
  query = params.meteringPointId
    ? query.eq("metering_point_id", params.meteringPointId)
    : query.is("metering_point_id", null);

  if (params.sourceType) {
    query = query.eq("source_type", params.sourceType);
  }

  if (params.sourceId) {
    query = query.eq("source_id", params.sourceId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listActiveCustomerAuthorizationDocumentsByScope(
  supabase: SupabaseClient,
  params: {
    customerId: string;
    siteId?: string | null;
    documentType: "power_of_attorney" | "complete_agreement" | "grid_invoice_suggested";
    excludeDocumentId?: string | null;
  },
): Promise<CustomerAuthorizationDocumentRow[]> {
  let query = supabase
    .from("customer_authorization_documents")
    .select("*")
    .eq("customer_id", params.customerId)
    .eq("document_type", params.documentType)
    .eq("status", "active");

  query = params.siteId
    ? query.eq("site_id", params.siteId)
    : query.is("site_id", null);

  const { data, error } = await query.order("uploaded_at", {
    ascending: false,
  });

  if (error) throw error;

  const rows = (data ?? []) as CustomerAuthorizationDocumentRow[];
  const excludedId = params.excludeDocumentId ?? null;

  return excludedId ? rows.filter((row) => row.id !== excludedId) : rows;
}

export async function saveCustomerAuthorizationDocument(
  supabase: SupabaseClient,
  input: {
    id?: string;
    companyId?: string | null;
    customer_id: string;
    site_id?: string | null;
    metering_point_id?: string | null;
    customer_contract_id?: string | null;
    power_of_attorney_id?: string | null;
    document_type: "power_of_attorney" | "complete_agreement" | "grid_invoice_suggested";
    status?: "uploaded" | "active" | "archived" | "suggested";
    title?: string | null;
    file_name?: string | null;
    mime_type?: string | null;
    file_size_bytes?: number | null;
    storage_bucket?: string | null;
    file_path: string;
    file_checksum?: string | null;
    upload_idempotency_key?: string | null;
    reference?: string | null;
    notes?: string | null;
    metadata?: Record<string, unknown> | null;
    uploaded_at?: string | null;
  },
): Promise<CustomerAuthorizationDocumentRow> {
  const actorId = await getActorId(supabase);
  const companyId = await resolveCustomerCompanyId(supabase, input.customer_id, input.companyId);

  const payload = {
    company_id: companyId,
    customer_id: input.customer_id,
    site_id: input.site_id ?? null,
    metering_point_id: input.metering_point_id ?? null,
    customer_contract_id: input.customer_contract_id ?? null,
    power_of_attorney_id: input.power_of_attorney_id ?? null,
    document_type: input.document_type,
    status: input.status ?? "uploaded",
    title: input.title ?? null,
    file_name: input.file_name ?? null,
    mime_type: input.mime_type ?? null,
    file_size_bytes: input.file_size_bytes ?? null,
    storage_bucket: input.storage_bucket ?? null,
    file_path: input.file_path,
    file_checksum: input.file_checksum ?? null,
    upload_idempotency_key: input.upload_idempotency_key ?? null,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    metadata: input.metadata ?? {},
    uploaded_at: input.uploaded_at ?? new Date().toISOString(),
    updated_by: actorId,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("customer_authorization_documents")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();

    if (error) throw error;
    return data as CustomerAuthorizationDocumentRow;
  }

  const { data, error } = await supabase
    .from("customer_authorization_documents")
    .insert({
      ...payload,
      created_by: actorId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as CustomerAuthorizationDocumentRow;
}

export async function updateCustomerAuthorizationDocumentStatus(
  supabase: SupabaseClient,
  params: {
    documentId: string;
    status: "uploaded" | "active" | "archived";
    notesAppend?: string | null;
    archivedReason?: string | null;
    replacedDocumentId?: string | null;
  },
): Promise<CustomerAuthorizationDocumentRow> {
  const actorId = await getActorId(supabase);
  const existing = await getCustomerAuthorizationDocumentById(
    supabase,
    params.documentId,
  );

  if (!existing) {
    throw new Error("Dokumentet hittades inte");
  }

  const { data, error } = await supabase
    .from("customer_authorization_documents")
    .update({
      status: params.status,
      notes: params.notesAppend
        ? appendNote(existing.notes, params.notesAppend)
        : (existing.notes ?? null),
      archived_reason:
        params.status === "archived" ? (params.archivedReason ?? null) : null,
      replaced_document_id: params.replacedDocumentId ?? null,
      updated_by: actorId,
    })
    .eq("id", params.documentId)
    .select("*")
    .single();

  if (error) throw error;
  return data as CustomerAuthorizationDocumentRow;
}

export async function archiveCustomerAuthorizationDocument(
  supabase: SupabaseClient,
  params: {
    documentId: string;
    reason?: string | null;
    revokeLinkedPowerOfAttorney?: boolean;
    replacementDocumentId?: string | null;
  },
): Promise<{
  documentBefore: CustomerAuthorizationDocumentRow;
  documentAfter: CustomerAuthorizationDocumentRow;
  revokedPowerOfAttorney: PowerOfAttorneyRow | null;
}> {
  const documentBefore = await getCustomerAuthorizationDocumentById(
    supabase,
    params.documentId,
  );

  if (!documentBefore) {
    throw new Error("Dokumentet hittades inte");
  }

  const documentAfter = await updateCustomerAuthorizationDocumentStatus(
    supabase,
    {
      documentId: params.documentId,
      status: "archived",
      notesAppend: params.reason ?? "Dokumentet arkiverades.",
      archivedReason: params.reason ?? "Dokumentet arkiverades.",
      replacedDocumentId: params.replacementDocumentId ?? null,
    },
  );

  let revokedPowerOfAttorney: PowerOfAttorneyRow | null = null;

  if (
    params.revokeLinkedPowerOfAttorney !== false &&
    documentAfter.power_of_attorney_id
  ) {
    revokedPowerOfAttorney = await revokePowerOfAttorney(supabase, {
      powerOfAttorneyId: documentAfter.power_of_attorney_id,
      reason: params.reason
        ? `Fullmakten revokerades eftersom dokumentet arkiverades. Orsak: ${params.reason}`
        : "Fullmakten revokerades eftersom dokumentet arkiverades.",
    });
  }

  return {
    documentBefore,
    documentAfter,
    revokedPowerOfAttorney,
  };
}

export async function setCustomerAuthorizationDocumentAsActive(
  supabase: SupabaseClient,
  params: {
    documentId: string;
    archiveOtherActiveDocuments?: boolean;
  },
): Promise<{
  targetBefore: CustomerAuthorizationDocumentRow;
  targetAfter: CustomerAuthorizationDocumentRow;
  archivedDocuments: CustomerAuthorizationDocumentRow[];
  revokedPowerOfAttorneyIds: string[];
  restoredPowerOfAttorney: PowerOfAttorneyRow | null;
}> {
  const targetBefore = await getCustomerAuthorizationDocumentById(
    supabase,
    params.documentId,
  );

  if (!targetBefore) {
    throw new Error("Dokumentet hittades inte");
  }

  const archivedDocuments: CustomerAuthorizationDocumentRow[] = [];
  const revokedPowerOfAttorneyIds: string[] = [];

  if (params.archiveOtherActiveDocuments !== false) {
    const activeConflicts =
      await listActiveCustomerAuthorizationDocumentsByScope(supabase, {
        customerId: targetBefore.customer_id,
        siteId: targetBefore.site_id,
        documentType: targetBefore.document_type,
        excludeDocumentId: targetBefore.id,
      });

    for (const conflict of activeConflicts) {
      const archived = await archiveCustomerAuthorizationDocument(supabase, {
        documentId: conflict.id,
        reason: `Arkiverat automatiskt eftersom dokument ${targetBefore.id} sattes som aktivt standarddokument.`,
        revokeLinkedPowerOfAttorney: true,
      });

      archivedDocuments.push(archived.documentAfter);

      if (archived.revokedPowerOfAttorney?.id) {
        revokedPowerOfAttorneyIds.push(archived.revokedPowerOfAttorney.id);
      }
    }
  }

  const targetAfter = await updateCustomerAuthorizationDocumentStatus(
    supabase,
    {
      documentId: targetBefore.id,
      status: "active",
      notesAppend: "Satt som aktivt standarddokument.",
    },
  );

  let restoredPowerOfAttorney: PowerOfAttorneyRow | null = null;

  if (targetAfter.power_of_attorney_id) {
    restoredPowerOfAttorney = await restorePowerOfAttorneyIfRevoked(supabase, {
      powerOfAttorneyId: targetAfter.power_of_attorney_id,
      note: "Fullmakten återaktiverades eftersom dokumentet sattes som aktivt standarddokument.",
    });
  }

  return {
    targetBefore,
    targetAfter,
    archivedDocuments,
    revokedPowerOfAttorneyIds,
    restoredPowerOfAttorney,
  };
}

export async function listCustomerOperationTasks(
  supabase: SupabaseClient,
  customerId: string,
): Promise<CustomerOperationTaskRow[]> {
  const { data, error } = await supabase
    .from("customer_operation_tasks")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as CustomerOperationTaskRow[];
}

export async function listAllOperationTasks(
  supabase: SupabaseClient,
  options: {
    status?: string | null;
    priority?: string | null;
    query?: string | null;
    companyId?: string | null;
    limit?: number;
  } = {},
): Promise<CustomerOperationTaskRow[]> {
  let taskQuery = supabase
    .from("customer_operation_tasks")
    .select("*")
    .order("created_at", { ascending: false });

  if (options.status && options.status !== "all") {
    taskQuery = taskQuery.eq("status", options.status);
  }

  if (options.priority && options.priority !== "all") {
    taskQuery = taskQuery.eq("priority", options.priority);
  }

  if (options.companyId) {
    taskQuery = taskQuery.eq("company_id", options.companyId);
  }

  const { data, error } = await taskQuery.limit(options.limit ?? 200);

  if (error) throw error;

  let tasks = (data ?? []) as CustomerOperationTaskRow[];

  const normalizedQuery = (options.query ?? "").trim().toLowerCase();

  if (!normalizedQuery) {
    return tasks;
  }

  tasks = tasks.filter((task) => {
    const haystack = [
      task.title,
      task.description,
      task.task_type,
      task.status,
      task.priority,
      task.site_id,
      task.customer_id,
      task.metering_point_id,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  return tasks;
}

export async function listSupplierSwitchRequestsByCustomerId(
  supabase: SupabaseClient,
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {},
): Promise<SupplierSwitchRequestRow[]> {
  let query = supabase
    .from("supplier_switch_requests")
    .select("*")
    .eq("customer_id", customerId);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (error) throw error;
  return (data ?? []) as SupplierSwitchRequestRow[];
}

export async function getSupplierSwitchRequestById(
  supabase: SupabaseClient,
  requestId: string,
): Promise<SupplierSwitchRequestRow | null> {
  const { data, error } = await supabase
    .from("supplier_switch_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (error) throw error;
  return (data as SupplierSwitchRequestRow | null) ?? null;
}
