import { supabaseService } from "@/lib/supabase/service";
import type {
  CompanyEmailSettings,
  EffectiveSender,
} from "@/lib/email/companyEmailSettings";
import type { CompanyEmailDnsRecord } from "@/lib/email/dnsRecords";
import type { CompanyEmailTemplate } from "@/lib/email/emailTemplates";
import type { EmailEventRule } from "@/lib/email/emailEvents";
import type { WebsiteApplicationWorkMetadata } from "@/lib/website/applicationState";

type QueryResult<T> = Promise<T[]>;

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return (
    ["42P01", "42703", "PGRST205"].includes(code) ||
    /schema cache|does not exist|column .* does not exist/i.test(message)
  );
}

export type WebsiteApplicationAdminRow = WebsiteApplicationWorkMetadata & {
  id: string;
  company_id: string;
  api_client_id: string | null;
  customer_id: string | null;
  customer_site_id: string | null;
  metering_point_id: string | null;
  contract_id: string | null;
  external_customer_id: string;
  external_account_id: string | null;
  customer_number: string | null;
  source: string | null;
  source_table?: "website_customer_applications" | "external_contract_intakes";
  origin_label?: string | null;
  linked_external_intake_id?: string | null;
  linked_website_application_id?: string | null;
  external_intake_status?: string | null;
  status: string;
  idempotency_key: string | null;
  payload: Record<string, unknown> | null;
  raw_payload?: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  warnings: unknown[] | null;
  missing_fields?: unknown[] | null;
  blocking_reasons?: unknown[] | null;
  next_step?: string | null;
  requested_start_date?: string | null;
  confirmed_start_date?: string | null;
  actual_start_date?: string | null;
  requested_start_mode?: string | null;
  calculated_earliest_start_date?: string | null;
  resolution_id?: string | null;
  grid_owner_information_request_id?: string | null;
  customer_info_request_id?: string | null;
  customer_match_review_case_id?: string | null;
  customer_operation_task_id?: string | null;
  reference_resolution_issues?: string[];
  grid_area_code?: string | null;
  grid_owner_id?: string | null;
  price_area_code?: string | null;
  resolution_status?: string | null;
  resolution_confidence?: number | null;
  facility_data_verified_at?: string | null;
  timeline?: unknown[] | null;
  audit_log?: unknown[] | null;
  assigned_to?: string | null;
  admin_note?: string | null;
  error_stage?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  processed_at?: string | null;
  created_at: string;
  updated_at: string | null;
  companies?: { name?: string | null } | null;
  customers?: {
    full_name?: string | null;
    company_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  integration_api_clients?: {
    name?: string | null;
    key_prefix?: string | null;
  } | null;
};

export type WebhookDeliveryAdminRow = {
  id: string;
  company_id: string;
  webhook_subscription_id: string;
  domain_event_id: string;
  event_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  response_status: number | null;
  response_body: string | null;
  failure_reason: string | null;
  payload: Record<string, unknown> | null;
  target_url?: string | null;
  locked_at?: string | null;
  locked_by?: string | null;
  created_at: string;
  webhook_subscriptions?: {
    endpoint_url?: string | null;
    name?: string | null;
    api_client_id?: string | null;
  } | null;
};

export type WebhookSubscriptionAdminRow = {
  id: string;
  company_id: string;
  api_client_id: string | null;
  name: string;
  endpoint_url: string;
  event_types: string[] | null;
  status: string;
  signing_secret_ref: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count?: number | null;
  created_at: string;
  updated_at: string | null;
  companies?: { name?: string | null } | null;
  integration_api_clients?: {
    name?: string | null;
    key_prefix?: string | null;
  } | null;
};

export type BillingPartnerCustomerSummary = {
  id: string;
  company_id: string;
  customer_id: string;
  customer_number: string | null;
  provider: string;
  provider_customer_id: string | null;
  provider_debtor_id: string | null;
  provider_status: string | null;
  dispute_count?: number | null;
  last_synced_at?: string | null;
  created_at: string;
  updated_at: string | null;
};

export type TenantReadiness = {
  websiteApi: boolean;
  apiClient: boolean;
  webhook: boolean;
  emailSender: boolean;
  domainVerification: boolean;
  templates: boolean;
  billingMapping: boolean;
  invoiceProvider: boolean;
  notes: string[];
};

function normalizeExternalIntakeStatus(
  status: string | null | undefined,
): string {
  if (status === "created") return "customer_created";
  if (status === "partially_created") return "pending_review";
  if (status === "duplicate_ignored") return "duplicate_facility_id";
  return status ?? "received";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapWebsiteCustomerApplicationRow(
  row: Record<string, unknown>,
): WebsiteApplicationAdminRow {
  const responsePayload = asRecord(row.response_payload);
  return {
    ...(row as unknown as WebsiteApplicationAdminRow),
    source_table: "website_customer_applications",
    origin_label: "Website application",
    linked_external_intake_id:
      typeof responsePayload.linked_external_intake_id === "string"
        ? responsePayload.linked_external_intake_id
        : null,
    linked_website_application_id: String(row.id),
    response_payload: {
      ...responsePayload,
      source_table:
        responsePayload.source_table ?? "website_customer_applications",
    },
  };
}

function mergeExternalMirrorIntoWebsiteRow(
  websiteRow: WebsiteApplicationAdminRow,
  externalRow: WebsiteApplicationAdminRow,
): WebsiteApplicationAdminRow {
  const websiteResponse = asRecord(websiteRow.response_payload);
  const externalResponse = asRecord(externalRow.response_payload);
  const externalMirror = {
    id: externalRow.id,
    status: externalRow.status,
    customer_id: externalRow.customer_id,
    customer_site_id: externalRow.customer_site_id,
    metering_point_id: externalRow.metering_point_id,
    contract_id: externalRow.contract_id,
    grid_owner_information_request_id:
      externalRow.grid_owner_information_request_id,
    issues: externalRow.warnings ?? [],
    response_payload: externalResponse,
  };

  const merged = {
    ...websiteRow,
    customer_id: websiteRow.customer_id ?? externalRow.customer_id,
    customer_site_id:
      websiteRow.customer_site_id ?? externalRow.customer_site_id,
    metering_point_id:
      websiteRow.metering_point_id ?? externalRow.metering_point_id,
    contract_id: websiteRow.contract_id ?? externalRow.contract_id,
    grid_owner_information_request_id:
      websiteRow.grid_owner_information_request_id ??
      externalRow.grid_owner_information_request_id,
    customer_info_request_id: websiteRow.customer_info_request_id ?? externalRow.customer_info_request_id ?? null,
    customer_match_review_case_id: websiteRow.customer_match_review_case_id ?? externalRow.customer_match_review_case_id ?? null,
    customer_operation_task_id: websiteRow.customer_operation_task_id ?? externalRow.customer_operation_task_id ?? null,
    warnings: websiteRow.warnings ?? externalRow.warnings,
    missing_fields: websiteRow.missing_fields ?? externalRow.missing_fields,
    blocking_reasons:
      websiteRow.blocking_reasons ?? externalRow.blocking_reasons,
    next_step: websiteRow.next_step ?? externalRow.next_step,
    external_intake_status: externalRow.status,
    linked_external_intake_id: externalRow.id,
    response_payload: {
      ...websiteResponse,
      source_table: "website_customer_applications",
      linked_external_intake_id: externalRow.id,
      external_contract_intake: externalMirror,
    },
  };
  return addReferenceIssues(merged, externalRow.reference_resolution_issues ?? []);
}

function mapExternalContractIntakeRow(
  row: Record<string, unknown>,
): WebsiteApplicationAdminRow {
  const issues = Array.isArray(row.issues) ? row.issues : [];
  const payload = (
    row.payload && typeof row.payload === "object" ? row.payload : {}
  ) as Record<string, unknown>;
  const fullName = [row.first_name, row.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    api_client_id: null,
    customer_id: (row.created_customer_id as string | null) ?? null,
    customer_site_id: (row.created_site_id as string | null) ?? null,
    metering_point_id: (row.created_metering_point_id as string | null) ?? null,
    contract_id: (row.created_contract_id as string | null) ?? null,
    external_customer_id: String(
      row.external_customer_id ?? row.idempotency_key ?? row.id,
    ),
    external_account_id: null,
    customer_number: (row.customer_number as string | null) ?? null,
    source: String(row.source_channel ?? "external_contract_intake"),
    source_table: "external_contract_intakes",
    origin_label: "External contract intake",
    linked_external_intake_id: String(row.id),
    linked_website_application_id: null,
    external_intake_status: String(row.status ?? "received"),
    status: normalizeExternalIntakeStatus(String(row.status ?? "received")),
    idempotency_key: (row.idempotency_key as string | null) ?? null,
    payload: {
      ...payload,
      customer: {
        full_name: fullName || row.company_name || row.email || null,
        company_name: row.company_name ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
      },
      site: {
        facility_id: row.facility_id ?? null,
        street: row.street ?? null,
        postal_code: row.postal_code ?? null,
        city: row.city ?? null,
        price_area_code: row.price_area_code ?? null,
      },
      metering_point: {
        metering_point_id: row.meter_point_id ?? null,
      },
    },
    raw_payload: payload,
    response_payload: {
      source_table: "external_contract_intakes",
      linked_external_intake_id: row.id ?? null,
      created_customer_id: row.created_customer_id ?? null,
      created_site_id: row.created_site_id ?? null,
      created_metering_point_id: row.created_metering_point_id ?? null,
      created_contract_id: row.created_contract_id ?? null,
      created_case_id: row.created_case_id ?? null,
      created_info_request_id: row.created_info_request_id ?? null,
      issues,
    },
    warnings: issues,
    missing_fields: issues,
    blocking_reasons: issues.map((issue) => ({
      field: "intake",
      label: String(issue),
      action: "Granska och komplettera webbansökan.",
    })),
    next_step:
      issues.length > 0
        ? "Granska och komplettera webbansökan innan switch eller fakturering."
        : "Granska skapad kundkedja och starta nästa operativa steg.",
    requested_start_date: (row.requested_start_date as string | null) ?? null,
    confirmed_start_date: null,
    actual_start_date: null,
    requested_start_mode: "earliest_possible",
    calculated_earliest_start_date: null,
    resolution_id: null,
    grid_owner_information_request_id:
      null,
    customer_info_request_id: null,
    customer_match_review_case_id: null,
    customer_operation_task_id: null,
    grid_area_code: null,
    grid_owner_id: null,
    price_area_code: (row.price_area_code as string | null) ?? null,
    resolution_status: null,
    resolution_confidence: null,
    facility_data_verified_at: null,
    timeline: [],
    audit_log: [],
    assigned_to: null,
    admin_note: null,
    error_stage: row.status === "failed" ? "external_contract_intake" : null,
    error_code: row.status === "failed" ? "intake_failed" : null,
    error_message: issues.length > 0 ? issues.map(String).join(" · ") : null,
    processed_at: row.updated_at as string | null,
    created_at: String(row.created_at),
    updated_at: (row.updated_at as string | null) ?? null,
    companies: row.companies as { name?: string | null } | null | undefined,
    customers: {
      full_name: fullName || null,
      company_name: (row.company_name as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
    },
    integration_api_clients: null,
  };
}

function addReferenceIssues(row: WebsiteApplicationAdminRow, issues: string[]): WebsiteApplicationAdminRow {
  if (!issues.length) return row;
  const combined = [...new Set([...(row.reference_resolution_issues ?? []), ...issues])];
  const terminal = row.work_state === "completed" || row.work_state === "closed";
  const existingBlocks = (row.blocking_reasons ?? []).filter((reason) => {
    const record = asRecord(reason);
    return record.field !== "reference" || !combined.includes(String(record.label ?? ""));
  });
  return {
    ...row,
    reference_resolution_issues: combined,
    warnings: [...(row.warnings ?? []), ...combined.filter((issue) => !(row.warnings ?? []).includes(issue))],
    blocking_reasons: terminal ? existingBlocks : [...existingBlocks, ...combined.map((label) => ({ field: "reference", label, action: "Granska kopplingen manuellt." }))],
    next_step: terminal
      ? "Historisk koppling kunde inte verifieras. Ansökans avslutade status är oförändrad."
      : "Granska ansökans kopplingar manuellt innan driftflödet fortsätter.",
  };
}

// Legacy info/case columns contain IDs from two different tables. Resolve only
// a unique company-owned target; unknown or ambiguous IDs remain visible for review.
async function resolveExternalIntakeReferences(rows: WebsiteApplicationAdminRow[]): Promise<WebsiteApplicationAdminRow[]> {
  const infoIds = [...new Set(rows.map((row) => row.response_payload?.created_info_request_id).filter((id): id is string => typeof id === "string" && Boolean(id)))];
  const caseIds = [...new Set(rows.map((row) => row.response_payload?.created_case_id).filter((id): id is string => typeof id === "string" && Boolean(id)))];
  if (!infoIds.length && !caseIds.length) return rows;
  const companies = [...new Set(rows.map((row) => row.company_id))];
  const targets = [
    ["grid_owner_information_requests", infoIds, "grid_owner_information_request_id"],
    ["customer_info_requests", infoIds, "customer_info_request_id"],
    ["customer_match_review_cases", caseIds, "customer_match_review_case_id"],
    ["customer_operation_tasks", caseIds, "customer_operation_task_id"],
  ] as const;
  const owned = await Promise.all(targets.map(async ([table, ids]) => {
    if (!ids.length) return new Set<string>();
    const { data, error } = await supabaseService.from(table).select("id,company_id")
      .in("id", ids).in("company_id", companies).limit(ids.length);
    if (error) throw error;
    return new Set(((data ?? []) as Array<{ id: string; company_id: string }>).map((row) => `${row.company_id}:${row.id}`));
  }));
  return rows.map((row) => {
    const resolved = { ...row };
    const issues: string[] = [];
    for (const [key, indexes, label] of [
      ["created_info_request_id", [0, 1], "uppgiftsbegäran"],
      ["created_case_id", [2, 3], "granskningsärende eller driftuppgift"],
    ] as const) {
      const id = row.response_payload?.[key];
      if (typeof id !== "string" || !id) continue;
      const matches = indexes.filter((index) => owned[index].has(`${row.company_id}:${id}`));
      if (matches.length === 1) resolved[targets[matches[0]][2]] = id;
      else issues.push(`Kopplad ${label} kunde inte verifieras entydigt för bolaget.`);
    }
    return addReferenceIssues(resolved, issues);
  });
}

async function listExternalContractIntakes(
  input: {
    companyId?: string | null;
    status?: string | null;
    limit?: number;
    ids?: string[];
  } = {},
): QueryResult<WebsiteApplicationAdminRow> {
  let query = supabaseService
    .from("external_contract_intakes")
    .select("*,companies(name)")
    .order("created_at", { ascending: false })
    .limit(input.ids ? Math.max(input.ids.length, 1) : Math.min(Math.max(input.limit ?? 100, 1), 200));

  if (input.companyId) query = query.eq("company_id", input.companyId);
  if (input.status) query = query.eq("status", input.status);
  if (input.ids) query = query.in("id", input.ids);

  const { data, error } = await query;
  if (error) {
    if (missingSchema(error)) return [];
    throw error;
  }
  return resolveExternalIntakeReferences(((data ?? []) as Array<Record<string, unknown>>).map(mapExternalContractIntakeRow));
}

async function listLegacyWebsiteApplications(
  input: {
    companyId?: string | null;
    status?: string | null;
    limit?: number;
    ids?: string[];
  } = {},
): QueryResult<WebsiteApplicationAdminRow> {
  let query = supabaseService
    .from("website_customer_applications")
    .select(
      "*,companies(name),customers!website_customer_applications_company_customer_fkey(full_name,company_name,email,phone),integration_api_clients!website_customer_applications_company_api_client_fkey(name,key_prefix)",
    )
    .order("created_at", { ascending: false })
    .limit(input.ids ? Math.max(input.ids.length, 1) : Math.min(Math.max(input.limit ?? 100, 1), 200));

  if (input.companyId) query = query.eq("company_id", input.companyId);
  if (input.status) query = query.eq("status", input.status);
  if (input.ids) query = query.in("id", input.ids);

  const { data, error } = await query;
  if (error) {
    if (missingSchema(error)) return [];
    throw error;
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map(
    mapWebsiteCustomerApplicationRow,
  );
}

type WebsiteApplicationWorkRow = WebsiteApplicationWorkMetadata & {
  application_id: string; company_id: string; status: string;
  source_table: "website_customer_applications" | "external_contract_intakes";
  linked_external_intake_id: string | null;
};
const WORK_ITEM_FIELDS = "application_id,company_id,source_table,status,work_state,is_pending,linked_external_intake_id";

function applyWorkMetadata(row: WebsiteApplicationAdminRow, state: WebsiteApplicationWorkRow): WebsiteApplicationAdminRow {
  const result = { ...row, status: state.status, work_state: state.work_state, is_pending: state.is_pending };
  return addReferenceIssues(result, result.reference_resolution_issues ?? []);
}

async function hydrateApplicationWorkRows(work: WebsiteApplicationWorkRow[], companyId?: string | null): QueryResult<WebsiteApplicationAdminRow> {
  if (!work.length) return [];
  const websiteIds = work.filter(r => r.source_table === "website_customer_applications").map(r => r.application_id);
  const externalIds = [...new Set(work.flatMap(r => r.linked_external_intake_id ? [r.linked_external_intake_id] : []))];
  const [website, external] = await Promise.all([
    websiteIds.length ? listLegacyWebsiteApplications({ companyId, ids: websiteIds }) : Promise.resolve([]),
    externalIds.length ? listExternalContractIntakes({ companyId, ids: externalIds }) : Promise.resolve([]),
  ]);
  const byWebsiteId = new Map(website.map(row => [row.id,row]));
  const byExternalId = new Map(external.map(row => [row.id,row]));
  return work.map(state => {
    const primary = state.source_table === "website_customer_applications"
      ? byWebsiteId.get(state.application_id) : byExternalId.get(state.application_id);
    if (!primary || primary.company_id !== state.company_id) {
      throw new Error("Ansökningslistan ändrades under hämtningen. Uppdatera sidan.");
    }
    const mirror = state.linked_external_intake_id ? byExternalId.get(state.linked_external_intake_id) : undefined;
    if (mirror && mirror.company_id !== state.company_id) {
      throw new Error("Ansökans bolagskoppling kunde inte verifieras.");
    }
    const row = state.source_table === "website_customer_applications" && mirror
      ? mergeExternalMirrorIntoWebsiteRow(primary,mirror) : primary;
    const resolved = state.source_table === "website_customer_applications" && state.linked_external_intake_id && !mirror
      ? addReferenceIssues(row, ["Kopplad extern ansökan kunde inte verifieras."]) : row;
    return applyWorkMetadata(resolved, state);
  });
}

export async function listWebsiteApplications(
  input: { companyId?: string | null; status?: string | null; limit?: number } = {},
): QueryResult<WebsiteApplicationAdminRow> {
  // Resolve canonical identity before state filtering and the page limit.
  let query = supabaseService.from("gridex_website_application_work_items_v")
    .select(WORK_ITEM_FIELDS)
    .order("created_at", { ascending: false }).order("application_id", { ascending: false })
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 200));
  if (input.companyId) query = query.eq("company_id", input.companyId);
  if (input.status) query = query.eq("status", input.status);
  const { data, error } = await query;
  if (error) throw error; // A missing shared read model is not an empty queue.
  return hydrateApplicationWorkRows((data ?? []) as WebsiteApplicationWorkRow[], input.companyId);
}

export async function listWebsiteApplicationsForCustomer(
  companyId: string,
  customerId: string,
): QueryResult<WebsiteApplicationAdminRow> {
  const external = await supabaseService
    .from("external_contract_intakes")
    .select("*,companies(name)")
    .eq("company_id", companyId)
    .eq("created_customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(10);

  const legacy = await supabaseService
    .from("website_customer_applications")
    .select("*,integration_api_clients!website_customer_applications_company_api_client_fkey(name,key_prefix)")
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (external.error && !missingSchema(external.error)) throw external.error;
  if (legacy.error && !missingSchema(legacy.error)) throw legacy.error;

  const externalRows = external.error
    ? []
    : await resolveExternalIntakeReferences(((external.data ?? []) as Array<Record<string, unknown>>).map(mapExternalContractIntakeRow));
  const legacyRows = legacy.error
    ? []
    : ((legacy.data ?? []) as Array<Record<string, unknown>>).map(
        mapWebsiteCustomerApplicationRow,
      );
  return [...legacyRows, ...externalRows]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 10);
}

export async function getWebsiteApplicationAdminRow(
  applicationId: string,
  options: { companyId?: string | null; sourceTable?: string | null } = {},
): Promise<WebsiteApplicationAdminRow | null> {
  const sourceTable = options.sourceTable ?? null;
  const loadWebsite = sourceTable !== "external_contract_intakes";
  const loadExternal = sourceTable !== "website_customer_applications";

  if (loadWebsite) {
    let query = supabaseService.from("gridex_website_application_work_items_v")
      .select(WORK_ITEM_FIELDS).eq("application_id", applicationId).eq("source_table", "website_customer_applications");
    if (options.companyId) query = query.eq("company_id", options.companyId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (data) {
      return (await hydrateApplicationWorkRows([data as WebsiteApplicationWorkRow], options.companyId))[0] ?? null;
    }
  }

  if (loadExternal) {
    let query = supabaseService
      .from("external_contract_intakes")
      .select("*,companies(name)")
      .eq("id", applicationId);
    if (options.companyId) query = query.eq("company_id", options.companyId);

    const { data, error } = await query.maybeSingle();
    if (error && !missingSchema(error)) throw error;
    if (data) {
      const row = (await resolveExternalIntakeReferences([mapExternalContractIntakeRow(data as Record<string, unknown>)]))[0];
      const { data: workData, error: workError } = await supabaseService.from("gridex_website_application_work_items_v")
        .select(WORK_ITEM_FIELDS).eq("application_id", applicationId).eq("company_id", row.company_id).eq("source_table", "external_contract_intakes").maybeSingle();
      if (workError) throw workError;
      if (workData) {
        const state = workData as WebsiteApplicationWorkRow;
        return applyWorkMetadata(row, state);
      }
      // A legacy direct URL may refer to a mirror suppressed from the main list.
      // Preserve its readable source record without guessing a canonical owner.
      return addReferenceIssues(row, ["Ansökan är en sekundär eller ändrad post; huvudkopplingen är inte verifierad."]);
    }
  }

  return null;
}

export async function listWebhookSubscriptions(
  input: { companyId?: string | null; limit?: number } = {},
): QueryResult<WebhookSubscriptionAdminRow> {
  let query = supabaseService
    .from("webhook_subscriptions")
    .select(
      "id, company_id, api_client_id, name, endpoint_url, event_types, status, signing_secret_ref, last_success_at, last_failure_at, failure_count, created_at, updated_at, companies(name), integration_api_clients(name,key_prefix)",
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 200));

  if (input.companyId) query = query.eq("company_id", input.companyId);

  const { data, error } = await query;
  if (error) {
    if (missingSchema(error)) return [];
    throw error;
  }
  return (data ?? []) as WebhookSubscriptionAdminRow[];
}

export async function listWebhookDeliveries(
  input: {
    companyId?: string | null;
    status?: string | null;
    limit?: number;
  } = {},
): QueryResult<WebhookDeliveryAdminRow> {
  let query = supabaseService
    .from("webhook_deliveries")
    .select(
      "id, company_id, webhook_subscription_id, domain_event_id, event_type, status, attempts, max_attempts, next_attempt_at, last_attempt_at, delivered_at, failed_at, response_status, response_body, failure_reason, payload, target_url, locked_at, locked_by, created_at, webhook_subscriptions(name,endpoint_url,api_client_id)",
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 200));

  if (input.companyId) query = query.eq("company_id", input.companyId);
  if (input.status) query = query.eq("status", input.status);

  const { data, error } = await query;
  if (error) {
    if (missingSchema(error)) return [];
    throw error;
  }
  return (data ?? []) as WebhookDeliveryAdminRow[];
}

export async function listBillingPartnerCustomersForCustomer(
  companyId: string,
  customerId: string,
): QueryResult<BillingPartnerCustomerSummary> {
  const { data, error } = await supabaseService
    .from("billing_partner_customers")
    .select(
      "id, company_id, customer_id, customer_number, provider, provider_customer_id, provider_debtor_id, provider_status, dispute_count, last_synced_at, created_at, updated_at",
    )
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    if (missingSchema(error)) return [];
    throw error;
  }
  return (data ?? []) as BillingPartnerCustomerSummary[];
}

export function computeTenantReadiness(input: {
  apiClients: Array<{ status?: string | null; scopes?: string[] | null }>;
  webhooks: Array<{ status?: string | null }>;
  emailSettings: CompanyEmailSettings | null;
  dnsRecords: CompanyEmailDnsRecord[];
  templates: CompanyEmailTemplate[];
  eventRules: EmailEventRule[];
  effectiveSender: EffectiveSender;
  billingPartnerCount?: number;
  invoiceProvider?: { selected: string | null; dispatchEnabled: boolean | null } | null;
}): TenantReadiness {
  const notes: string[] = [];
  const apiClient = input.apiClients.some(
    (client) =>
      client.status === "active" &&
      (client.scopes ?? []).includes("website_applications.write"),
  );
  const webhook = input.webhooks.some((webhook) => webhook.status === "active");
  const domainVerification =
    input.emailSettings?.verification_status === "verified";
  const emailSender =
    domainVerification || input.effectiveSender.mode === "fallback";
  const requiredTemplates = [
    "contract.application_received",
    "switch.started",
    "switch.confirmed",
    "switch.action_required",
    "customer.welcome_active",
  ];
  const templateKeys = new Set(
    input.templates
      .filter((template) => template.is_active)
      .map((template) => template.template_key),
  );
  const templates =
    requiredTemplates.every((key) => templateKeys.has(key)) &&
    input.eventRules.some(
      (rule) =>
        rule.event_key === "contract.application_received" && rule.enabled,
    );
  const billingMapping = Number(input.billingPartnerCount ?? 0) > 0;
  const invoiceProvider = Boolean(input.invoiceProvider?.selected) && input.invoiceProvider?.dispatchEnabled === true;

  if (!apiClient)
    notes.push("Saknar aktiv API-client med website_applications.write.");
  if (!webhook) notes.push("Saknar aktiv webhook subscription.");
  if (!domainVerification && input.effectiveSender.mode === "fallback")
    notes.push(
      "E-post skickas via fallback eftersom domänen inte är verifierad.",
    );
  if (!templates)
    notes.push(
      "Standardmallar eller event rules saknas för kundmail/switch-flöde.",
    );
  if (!billingMapping)
    notes.push("Capway/billing partner mapping saknas ännu.");
  if (!invoiceProvider)
    notes.push(
      input.invoiceProvider?.selected
        ? "Fakturaleverantör är vald men utskick är inte aktiverat."
        : "Ingen fakturaleverantör är vald (Fakturering → Integrationer).",
    );
  if (
    input.emailSettings?.verification_status === "disabled" ||
    input.emailSettings?.sender_mode === "disabled"
  )
    notes.push("E-postavsändaren är avstängd.");
  if (input.dnsRecords.some((record) => record.status === "failed"))
    notes.push("Minst en DNS-post har felstatus.");

  return {
    websiteApi: apiClient,
    apiClient,
    webhook,
    emailSender,
    domainVerification,
    templates,
    billingMapping,
    invoiceProvider,
    notes,
  };
}
