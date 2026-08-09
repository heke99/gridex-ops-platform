// Internal module extracted from customerApplications.ts to keep handwritten production files bounded.
import { supabaseService } from "@/lib/supabase/service";
import { customerIntakeStatusForReadiness, type WebsiteApplicationReadiness } from "@/lib/website/applicationReview";
import { EnergyResolutionBindingError } from "@/lib/energy/resolutionBinding";
import { mapFacilityBusinessError, type FacilityBusinessErrorCode } from "@/lib/energy/facilityDataErrors";

export type CustomerRow = {
  id: string;
  customer_number: string | null;
  email: string | null;
  full_name: string | null;
  company_name: string | null;
};

export type ErrorStage =
  | "validation"
  | "idempotency"
  | "customer_lookup"
  | "customer_create"
  | "customer_number_create"
  | "portal_identity_create"
  | "portal_user_link"
  | "site_create"
  | "site_canonical_patch"
  | "metering_point_create"
  | "contract_create"
  | "contract_snapshot_create"
  | "public_contract_lookup"
  | "quote_validation"
  | "quote_consume"
  | "legal_acceptance"
  | "application_record_create"
  | "application_workflow"
  | "application_workflow_committed"
  | "application_workflow_transition"
  | "customer_data_automation"
  | "supplier_switch_orchestration"
  | "customer_intake_orchestrator"
  | "manual_information_request_summary"
  | "communication_trigger"
  | "domain_event_create"
  | "webhook_queue"
  | "customer_intake_update"
  | "energy_resolution"
  | "grid_owner_information_request"
  | "manual_information_request"
  | "manual_review"
  | "power_of_attorney"
  | "facility_information_lookup"
  | "email_dispatch";

export class WebsiteApplicationError extends Error {
  status: number;
  code: string;
  field?: string;
  hint?: string;
  stage: ErrorStage;
  details?: unknown;
  action?: string;

  constructor(input: {
    message: string;
    status?: number;
    code?: string;
    field?: string;
    hint?: string;
    stage?: ErrorStage;
    details?: unknown;
    action?: string;
  }) {
    super(input.message);
    this.name = "WebsiteApplicationError";
    this.status = input.status ?? 500;
    this.code = input.code ?? "website_application_error";
    this.field = input.field;
    this.hint = input.hint;
    this.stage = input.stage ?? "validation";
    this.details = input.details;
    this.action = input.action;
  }
}

export function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// Like clean(), but only returns values safe to write into uuid columns.
// Non-UUID inputs (e.g. human-readable version names) are dropped instead of
// crashing the insert with `invalid input syntax for type uuid`.
export function cleanUuid(value: unknown): string | null {
  const cleaned = clean(value);
  return isUuid(cleaned) ? cleaned : null;
}

export function duplicateIdempotencyKey(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  const details = (error as { details?: string } | null)?.details ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return (
    code === "23505" &&
    /website_customer_applications_company_idempotency_uidx|company_id, idempotency_key/i.test(
      `${details} ${message}`,
    )
  );
}

export function duplicateBusinessKey(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  const details = (error as { details?: string } | null)?.details ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return (
    code === "23505" &&
    /website_customer_applications_company_business_event_uidx|company_id, business_key_hash/i.test(
      `${details} ${message}`,
    )
  );
}

export function normalizedEmail(value: unknown): string | null {
  return clean(value)?.toLowerCase() ?? null;
}

export function digits(value: unknown): string | null {
  const output = clean(value)?.replace(/\D/g, "") ?? "";
  return output || null;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const parts = [
      record.message,
      record.details,
      record.hint,
      record.code,
    ].filter(
      (part): part is string =>
        typeof part === "string" && part.trim().length > 0,
    );
    if (parts.length > 0) return parts.join(" · ");
  }
  return "Kundansökan kunde inte behandlas.";
}

export function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return (
    ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(code) ||
    /schema cache|does not exist|column .* does not exist|could not find the function/i.test(
      message,
    )
  );
}

export function schemaRepairStatus(error: unknown): "pending_review" | null {
  return missingSchema(error) ? "pending_review" : null;
}

// Builds a non-sensitive diagnostic detail from a database error. Only the
// Postgres/PostgREST error code and a truncated message are surfaced — never
// row data, identity numbers or payloads.
export function schemaErrorDetail(error: unknown): {
  db_code: string | null;
  db_message: string | null;
} {
  const code = (error as { code?: string } | null)?.code ?? null;
  const rawMessage = (error as { message?: string } | null)?.message ?? null;
  const message = rawMessage ? rawMessage.slice(0, 300) : null;
  return { db_code: code, db_message: message };
}

export const WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE = "website_application";
export const WEBSITE_APPLICATION_CONTRACT_CHANNEL = "external_website";
export const WEBSITE_APPLICATION_READY_CONTRACT_STATUS = "pending_signature";
export const WEBSITE_APPLICATION_SIGNED_CONTRACT_STATUS = "signed";
export const WEBSITE_PORTAL_PROVIDER = "gridex_website";

export type RequestAuditMetadata = {
  ipAddress?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  traceId?: string | null;
};

export function timelineEvent(
  type: string,
  label: string,
  metadata: Record<string, unknown> = {},
) {
  return {
    type,
    label,
    metadata,
    occurred_at: new Date().toISOString(),
  };
}

export function reviewAuditEvent(
  action: string,
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown>,
  actor: string | null = null,
) {
  return {
    action,
    actor_user_id: actor,
    old_values: oldValues ?? {},
    new_values: newValues,
    created_at: new Date().toISOString(),
  };
}

export async function updateCustomerIntakeStatus(
  companyId: string,
  customerId: string,
  readiness: WebsiteApplicationReadiness,
) {
  const { error } = await supabaseService
    .from("customers")
    .update({
      intake_status: customerIntakeStatusForReadiness(readiness),
      intake_missing_fields: readiness.missingFields,
      intake_quality_score: readiness.qualityScore,
      intake_warnings: readiness.warnings,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("id", customerId);

  if (error && !missingSchema(error)) throw error;
}

function addBusinessDays(date: Date, days: number): Date {
  const output = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  let remaining = days;
  while (remaining > 0) {
    output.setUTCDate(output.getUTCDate() + 1);
    const day = output.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return output;
}

export function calculatedEarliestStartDate(): string {
  // MVP-policy: produktion räknar datum server-side, inte i UI. Detta kan senare ersättas med tenant-/nätägarregler.
  return addBusinessDays(new Date(), 14).toISOString().slice(0, 10);
}

export function operationalErrorMessage(error: unknown): string {
  const message =
    error instanceof WebsiteApplicationError
      ? error.message
      : errorMessage(error);
  if (/customers_intake_status_check/i.test(message)) {
    return "Kundens intagsstatus stöds inte av databasen. Kör senaste kundansökningsmigration och försök igen.";
  }
  if (/customer_contracts_status_check/i.test(message)) {
    return "Avtal kunde inte skapas eftersom kundavtalets status inte stöds av databasen. Koden ska använda draft/pending_signature och senaste avtalsmigration måste vara körd.";
  }
  if (/customer_contracts_source_type_check/i.test(message)) {
    return "Avtal kunde inte skapas eftersom kundavtalets source_type inte stöds av databasen. Kör senaste avtalsmigration och kontrollera ansökan igen.";
  }
  if (
    /customer_contracts.*metadata|metadata.*customer_contracts|PGRST204/i.test(
      message,
    )
  ) {
    return "Kundavtalets schema saknar en kolumn som koden behöver. Kör senaste migration och uppdatera schema cache.";
  }
  if (/metering_point_create/i.test(message)) {
    return "Mätpunktsflödet stoppades. Ansökan behöver ligga kvar i arbetskön tills anläggningsuppgifter är kompletta.";
  }
  if (/violates check constraint/i.test(message)) {
    return "Databasen stoppade åtgärden på grund av en constraint. Kör senaste migration eller kontakta teknisk admin.";
  }
  if (message.length > 360) return `${message.slice(0, 360)}…`;
  return message;
}

export function technicalBlockingReason(error: WebsiteApplicationError) {
  return {
    field: "system",
    label: "Tekniskt fel kräver åtgärd",
    severity: "blocking" as const,
    message: operationalErrorMessage(error),
    action: "Kör senaste migration/schema-fix och kontrollera ansökan igen.",
  };
}

const CONTROLLED_BUSINESS_ERROR_CODES = new Set<string>([
  "facility_data_invalid",
  "customer_information_mismatch",
  "grid_owner_rejected_request",
  "negative_aperak_received",
  "z02_rejected",
  "needs_customer_correction",
  "needs_grid_owner_followup",
  "duplicate_facility_id",
  "cross_tenant_facility_conflict",
  "protected_identity",
  "timeout",
]);

export function isControlledBusinessError(error: WebsiteApplicationError): boolean {
  return CONTROLLED_BUSINESS_ERROR_CODES.has(error.code);
}

export function controlledBusinessErrorCode(
  error: WebsiteApplicationError,
): FacilityBusinessErrorCode {
  if (CONTROLLED_BUSINESS_ERROR_CODES.has(error.code))
    return error.code as FacilityBusinessErrorCode;
  return "needs_customer_correction";
}

export function controlledBusinessStatus(error: WebsiteApplicationError): string {
  return mapFacilityBusinessError(controlledBusinessErrorCode(error)).status;
}

export function controlledBusinessNextStep(error: WebsiteApplicationError): string {
  return mapFacilityBusinessError(controlledBusinessErrorCode(error))
    .recommendedAction;
}

export function controlledBusinessBlockingReason(error: WebsiteApplicationError) {
  const mapped = mapFacilityBusinessError(controlledBusinessErrorCode(error), {
    message: operationalErrorMessage(error),
  });
  return {
    field: mapped.issueType,
    label: mapped.title,
    severity: "blocking" as const,
    message: mapped.message,
    action: mapped.recommendedAction,
  };
}

export function validationError(message: string, field: string, hint?: string) {
  return new WebsiteApplicationError({
    message,
    status: 422,
    code: "validation_error",
    field,
    hint,
    stage: "validation",
  });
}

export async function stage<T>(
  stageName: ErrorStage,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof WebsiteApplicationError) throw error;
    if (error instanceof EnergyResolutionBindingError) {
      throw new WebsiteApplicationError({
        message: error.message,
        status: error.status,
        code: error.code,
        field: error.field,
        stage: stageName,
        hint: "Lös kundens elområde på nytt genom OPS och använd den nya resolution_id i både quote och kundansökan.",
      });
    }
    const coded = error as { code?: unknown; details?: unknown; status?: unknown; field?: unknown };
    throw new WebsiteApplicationError({
      message: errorMessage(error),
      status: typeof coded?.status === "number" ? coded.status : 500,
      code:
        typeof coded?.code === "string" && coded.code
          ? coded.code
          : "internal_error",
      field: typeof coded?.field === "string" ? coded.field : undefined,
      stage: stageName,
      details:
        typeof coded?.details === "object" && coded.details !== null
          ? {
              ...(coded.details as Record<string, unknown>),
              raw_error: errorMessage(error),
            }
          : { raw_error: errorMessage(error) },
    });
  }
}