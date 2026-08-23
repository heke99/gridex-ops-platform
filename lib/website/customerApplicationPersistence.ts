// Internal module extracted from customerApplications.ts to keep handwritten production files bounded.
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth";
import { supabaseService } from "@/lib/supabase/service";
import { ensureCustomerPortalUserLink } from "@/lib/customer-portal/customerResolver";
import { commitApplicationProvisioning } from "@/lib/website/provisioningSaga";
import { upsertPortalIdentity } from "./customerApplicationCommunication";
import { BUSINESS_CONFLICT_STATUSES, COMMITTED_CONTRACT_REQUIRED_STATUSES, COMMITTED_METERING_REQUIRED_STATUSES, COMMITTED_SITE_REQUIRED_STATUSES, REPLAYABLE_COMMITTED_STATUSES, applicationBusinessKeyHash, applicationPayloadHash } from "./customerApplicationSchemas";
import type { ApplicationInput } from "./customerApplicationSchemas";
import { WebsiteApplicationError, calculatedEarliestStartDate, clean, cleanUuid, digits, duplicateBusinessKey, duplicateIdempotencyKey, errorMessage, isObject, missingSchema, normalizedEmail, operationalErrorMessage, stage } from "./customerApplicationShared";
import type { CustomerRow, ErrorStage } from "./customerApplicationShared";

type CreateApplicationRowInput = {
  client: IntegrationApiClient;
  externalCustomerId: string;
  externalAccountId?: string | null;
  customer?: CustomerRow | null;
  customerSiteId?: string | null;
  meteringPointId?: string | null;
  contractId?: string | null;
  contractNumber?: string | null;
  applicationNumber?: string | null;
  pricePlanId?: string | null;
  pricePlanVersionId?: string | null;
  contractPriceSnapshotId?: string | null;
  publicContractOfferId?: string | null;
  contractProductId?: string | null;
  contractProductVersionId?: string | null;
  contractPublicationVersionId?: string | null;
  priceBookId?: string | null;
  legalBundleVersionId?: string | null;
  energyDirection?: "consumption" | "production" | null;
  offerReference?: string | null;
  quoteReference?: string | null;
  payload: ApplicationInput | Record<string, unknown>;
  rawPayload?: unknown;
  responsePayload: Record<string, unknown>;
  idempotencyKey?: string | null;
  payloadHash?: string | null;
  businessKeyHash?: string | null;
  applicationId?: string | null;
  status: string;
  warnings?: unknown[];
  errorStage?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  missingFields?: string[];
  blockingReasons?: unknown[];
  nextStep?: string | null;
  requestedStartDate?: string | null;
  confirmedStartDate?: string | null;
  actualStartDate?: string | null;
  requestedStartMode?: string | null;
  calculatedEarliestStartDate?: string | null;
  resolutionId?: string | null;
  gridOwnerInformationRequestId?: string | null;
  gridAreaCode?: string | null;
  gridOwnerId?: string | null;
  priceAreaCode?: string | null;
  resolutionStatus?: string | null;
  resolutionConfidence?: number | null;
  timeline?: unknown[];
  auditLog?: unknown[];
};

function externalIntakeStatusFromWebsiteStatus(
  status: string,
):
  | "received"
  | "processing"
  | "needs_review"
  | "created"
  | "partially_created"
  | "failed"
  | "duplicate_ignored"
  | "cancelled" {
  if (["failed", "rejected", "switch_rejected"].includes(status))
    return "failed";
  if (status === "cancelled") return "cancelled";
  if (
    [
      "needs_information",
      "pending_review",
      "manual_review",
      "pending_validation",
      "needs_facility_data",
      "information_request_ready",
      "information_request_sent",
      "waiting_grid_owner_response",
    ].includes(status)
  )
    return "needs_review";
  if (
    [
      "ready_for_switch",
      "customer_created",
      "customer_matched",
      "contract_created",
      "confirmation_pending",
      "confirmation_sent",
      "completed",
      "active",
      "switch_confirmed",
    ].includes(status)
  )
    return "created";
  return "received";
}

async function syncExternalContractIntakeRow(
  input: CreateApplicationRowInput & { applicationId: string },
) {
  const payload = input.payload as ApplicationInput & Record<string, unknown>;
  const customer: Record<string, unknown> = isObject(payload.customer)
    ? payload.customer
    : {};
  const site: Record<string, unknown> = isObject(payload.site)
    ? payload.site
    : {};
  const meteringPoint: Record<string, unknown> = isObject(
    payload.metering_point,
  )
    ? payload.metering_point
    : {};
  const contract: Record<string, unknown> = isObject(payload.contract)
    ? payload.contract
    : {};
  const issues = [
    ...(input.missingFields ?? []).map((field) => `Saknad uppgift: ${field}`),
    ...(input.blockingReasons ?? []).map((reason) =>
      typeof reason === "string" ? reason : JSON.stringify(reason),
    ),
    ...(input.errorMessage ? [input.errorMessage] : []),
  ].filter(Boolean);

  const externalStatus = externalIntakeStatusFromWebsiteStatus(input.status);
  const intakePayload = {
    company_id: input.client.company_id,
    status: externalStatus,
    source_channel: "external_website_api",
    idempotency_key:
      input.idempotencyKey ?? `website-application:${input.applicationId}`,
    customer_type:
      clean(customer.customer_type) ??
      clean(payload.customer_type) ??
      "private",
    first_name: clean(customer.first_name),
    last_name: clean(customer.last_name),
    company_name: clean(customer.company_name),
    email: normalizedEmail(customer.email),
    phone: clean(customer.phone),
    personal_number: digits(customer.personal_number),
    org_number: digits(customer.org_number),
    facility_id: clean(site.facility_id) ?? clean(payload.facility_id),
    meter_point_id:
      clean(meteringPoint.metering_point_id) ??
      clean(meteringPoint.meter_point_id) ??
      clean(payload.metering_point_id),
    street: clean(site.street),
    postal_code: clean(site.postal_code),
    city: clean(site.city),
    move_in_date: clean(site.move_in_date) ?? null,
    price_area_code:
      input.priceAreaCode ??
      clean(site.price_area_code) ??
      clean(payload.price_area_code),
    // Keep each identifier in its canonical column. contract_offer_id is
    // reserved for an internal OPS offer and must never contain a price-plan UUID.
    contract_offer_id:
      cleanUuid(payload.contract_offer_id) ??
      cleanUuid(contract.contract_offer_id),
    public_contract_offer_id: input.publicContractOfferId ?? null,
    offer_reference: input.offerReference ?? null,
    quote_reference: clean(
      (input.payload as { quote_reference?: unknown }).quote_reference,
    ),
    price_plan_id: cleanUuid(input.pricePlanId),
    price_plan_version_id: cleanUuid(input.pricePlanVersionId),
    requested_start_date:
      input.requestedStartDate ??
      clean(contract.requested_start_date) ??
      clean(payload.requested_start_date),
    created_customer_id: input.customer?.id ?? null,
    created_site_id: input.customerSiteId ?? null,
    created_metering_point_id: input.meteringPointId ?? null,
    created_contract_id: input.contractId ?? null,
    contract_number: input.contractNumber ?? null,
    application_number: input.applicationNumber ?? null,
    created_info_request_id: input.gridOwnerInformationRequestId ?? null,
    payload: {
      ...payload,
      source_table: "website_customer_applications",
      website_application_id: input.applicationId,
      external_customer_id: input.externalCustomerId,
      external_account_id: input.externalAccountId ?? null,
      response_payload: input.responsePayload,
    },
    issues,
    updated_at: new Date().toISOString(),
  };

  const result = await supabaseService
    .from("external_contract_intakes")
    .upsert(intakePayload, { onConflict: "company_id,idempotency_key" })
    .select("id")
    .maybeSingle();

  if (result.error && !missingSchema(result.error)) {
    throw result.error;
  }
}

export async function createApplicationRow(input: CreateApplicationRowInput) {
  const row = {
    company_id: input.client.company_id,
    api_client_id: input.client.id,
    customer_id: input.customer?.id ?? null,
    customer_site_id: input.customerSiteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    contract_id: input.contractId ?? null,
    contract_number: input.contractNumber ?? null,
    application_number: input.applicationNumber ?? null,
    price_plan_id: input.pricePlanId ?? null,
    price_plan_version_id: input.pricePlanVersionId ?? null,
    contract_price_snapshot_id: input.contractPriceSnapshotId ?? null,
    public_contract_offer_id: input.publicContractOfferId ?? null,
    contract_product_id: input.contractProductId ?? null,
    contract_product_version_id: input.contractProductVersionId ?? null,
    contract_publication_version_id: input.contractPublicationVersionId ?? null,
    price_book_id: input.priceBookId ?? null,
    legal_bundle_version_id: input.legalBundleVersionId ?? null,
    energy_direction: input.energyDirection ?? null,
    offer_reference: input.offerReference ?? null,
    quote_reference: input.quoteReference ?? null,
    external_customer_id: input.externalCustomerId,
    external_account_id: input.externalAccountId ?? null,
    customer_number: input.customer?.customer_number ?? null,
    source:
      clean((input.payload as { source?: unknown }).source) ??
      "external_website",
    portal_identity_required: true,
    status: input.status,
    idempotency_key: input.idempotencyKey ?? null,
    payload_hash: input.payloadHash ?? applicationPayloadHash(input.payload),
    business_key_hash: input.businessKeyHash ?? null,
    payload: input.payload,
    raw_payload: input.rawPayload ?? input.payload,
    response_payload: input.responsePayload,
    warnings: input.warnings ?? [],
    error_stage: input.errorStage ?? null,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    missing_fields: input.missingFields ?? [],
    blocking_reasons: input.blockingReasons ?? [],
    next_step: input.nextStep ?? null,
    requested_start_date: input.requestedStartDate ?? null,
    confirmed_start_date: input.confirmedStartDate ?? null,
    actual_start_date: input.actualStartDate ?? null,
    requested_start_mode: input.requestedStartMode ?? "earliest_possible",
    calculated_earliest_start_date: input.calculatedEarliestStartDate ?? null,
    resolution_id: input.resolutionId ?? null,
    grid_owner_information_request_id:
      input.gridOwnerInformationRequestId ?? null,
    grid_area_code: input.gridAreaCode ?? null,
    grid_owner_id: input.gridOwnerId ?? null,
    price_area_code: input.priceAreaCode ?? null,
    resolution_status: input.resolutionStatus ?? null,
    resolution_confidence: input.resolutionConfidence ?? null,
    timeline: input.timeline ?? [],
    audit_log: input.auditLog ?? [],
    processed_at: input.status === "failed" ? null : new Date().toISOString(),
  };

  if (input.applicationId) {
    const { data: updated, error: updateError } = await supabaseService
      .from("website_customer_applications")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", input.applicationId)
      .eq("company_id", input.client.company_id)
      .eq("idempotency_key", input.idempotencyKey ?? "")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated?.id)
      throw new WebsiteApplicationError({
        message: "Den reserverade idempotensraden kunde inte slutföras.",
        status: 409,
        code: "idempotency_reservation_lost",
        stage: "idempotency",
      });
    const completed = updated as { id: string };
    await syncExternalContractIntakeRow({
      ...input,
      applicationId: completed.id,
    });
    return completed;
  }

  const { data, error } = await supabaseService
    .from("website_customer_applications")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (duplicateIdempotencyKey(error) && input.idempotencyKey) {
      const winner = await loadIdempotentApplication(
        input.client.company_id,
        input.idempotencyKey,
      );
      if (winner) {
        const expectedHash =
          input.payloadHash ?? applicationPayloadHash(input.payload);
        const winnerPayloadHash = storedApplicationPayloadHash(winner);
        if (winnerPayloadHash && winnerPayloadHash !== expectedHash)
          throw idempotencyPayloadMismatchError(winner, expectedHash);
        return { id: winner.id };
      }
    }
    if (missingSchema(error)) {
      throw new WebsiteApplicationError({
        message:
          "Kundansökan kunde inte loggas eftersom website_customer_applications-schemat inte matchar koden. Kör den senaste canonical migrationen innan webbintaget aktiveras.",
        status: 503,
        code: "website_application_schema_mismatch",
        stage: "application_record_create",
        details: error,
      });
    }
    throw error;
  }
  if (!data?.id) {
    throw new WebsiteApplicationError({
      message: "Kundansökan sparades inte trots att databasen inte rapporterade ett fel.",
      status: 500,
      code: "website_application_record_missing",
      stage: "application_record_create",
    });
  }

  const created = data as { id: string };
  await syncExternalContractIntakeRow({ ...input, applicationId: created.id });
  return created;
}

// Marks an already-created application row as failed/partial. Used when a
// failure happens after the application row exists, so we update in place
// instead of inserting a duplicate that would collide on the unique
// (company_id, idempotency_key) index.
export async function markApplicationFailed(input: {
  applicationId: string;
  companyId: string;
  status: string;
  responsePayload: Record<string, unknown>;
  errorStage: ErrorStage;
  errorCode: string;
  errorMessage: string;
  missingFields?: unknown[];
  blockingReasons?: unknown[];
  nextStep?: string | null;
  warnings?: string[];
}): Promise<{ id: string }> {
  const { error } = await supabaseService
    .from("website_customer_applications")
    .update({
      status: input.status,
      response_payload: input.responsePayload,
      error_stage: input.errorStage,
      error_code: input.errorCode,
      error_message: input.errorMessage,
      missing_fields: input.missingFields ?? [],
      blocking_reasons: input.blockingReasons ?? [],
      next_step: input.nextStep ?? null,
      warnings: input.warnings ?? [],
      processed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.applicationId)
    .eq("company_id", input.companyId);
  if (error && !missingSchema(error)) throw error;
  return { id: input.applicationId };
}

type LoadedIdempotentApplication = {
  id: string;
  idempotency_key?: string | null;
  payload_hash?: string | null;
  business_key_hash?: string | null;
  response_payload: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  status: string;
  customer_id: string | null;
  customer_number: string | null;
  external_customer_id: string | null;
  customer_site_id?: string | null;
  metering_point_id?: string | null;
  contract_id?: string | null;
  warnings?: string[] | null;
  error_stage?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function hasCanonicalCommittedApplicationEvidence(
  value: Record<string, unknown> | null | undefined,
): boolean {
  if (!value) return false;
  const communication = isObject(value.communication) ? value.communication : null;
  return Boolean(
    clean(value.workflow_state) === "canonical_data_committed" &&
      clean(value.application_number) &&
      clean(value.customer_number) &&
      clean(communication?.source_of_truth) === "communication_logs",
  );
}

function hasAcceptedCanonicalReplay(
  value: Record<string, unknown> | null | undefined,
): boolean {
  return clean(value?.status) === "accepted" && hasCanonicalCommittedApplicationEvidence(value);
}

export async function loadIdempotentApplication(
  companyId: string,
  idempotencyKey: string | null,
) {
  if (!idempotencyKey) return null;
  const { data, error } = await supabaseService
    .from("website_customer_applications")
    .select(
      "id,idempotency_key,payload_hash,business_key_hash,response_payload,payload,status,customer_id,customer_number,external_customer_id,customer_site_id,metering_point_id,contract_id,error_stage,error_code,error_message,warnings,created_at,updated_at",
    )
    .eq("company_id", companyId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  const row = data as LoadedIdempotentApplication | null;
  if (!row) return null;

  // The durable continuation hand-off intentionally stores the internal row as
  // processing while the public POST contract has already been accepted. A
  // same-key replay must not be mistaken for an in-flight reservation after
  // canonical_data_committed has been persisted. Project it to a replayable
  // committed business state for the idempotency decision only; the database
  // row itself remains unchanged.
  if (
    row.status === "processing" &&
    hasAcceptedCanonicalReplay(row.response_payload)
  ) {
    return { ...row, status: "contract_created" };
  }

  return row;
}

export function storedApplicationPayloadHash(
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>,
): string | null {
  return (
    existing.payload_hash ??
    (existing.payload ? applicationPayloadHash(existing.payload) : null)
  );
}

export function expectsSiteOrMetering(
  input: ApplicationInput | Record<string, unknown> | null | undefined,
): boolean {
  if (!input || typeof input !== "object") return false;
  const record = input as Record<string, unknown>;
  const site = isObject(record.site) ? record.site : null;
  const metering = isObject(record.metering_point)
    ? record.metering_point
    : null;

  return Boolean(
    clean(site?.facility_id) ||
    clean(site?.street) ||
    clean(site?.city) ||
    clean(metering?.metering_point_id) ||
    clean(metering?.meter_point_id) ||
    clean(metering?.ediel_metering_point_id) ||
    clean(metering?.anlage_id) ||
    clean(record.facility_id) ||
    clean(record.site_facility_id) ||
    clean(record.metering_point_id) ||
    clean(record.meter_point_id) ||
    clean(record.ediel_metering_point_id) ||
    clean(record.anlage_id),
  );
}

export function hasCompleteSiteAndMetering(
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>,
) {
  const response = existing.response_payload ?? {};
  return Boolean(
    (existing.customer_site_id ?? clean(response.customer_site_id)) &&
    (existing.metering_point_id ?? clean(response.metering_point_id)),
  );
}

export function idempotentFailure(
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>,
  externalCustomerId: string,
  reason?: string,
) {
  const response = existing.response_payload ?? {};
  const errorStage =
    existing.error_stage ?? clean(response.error_stage) ?? "idempotency";
  const errorCode =
    reason ?? existing.error_code ?? clean(response.code) ?? "internal_error";
  const errorMessage =
    existing.error_message ??
    clean(response.error) ??
    (reason === "incomplete_application"
      ? "Tidigare idempotent request blev ofullständig."
      : "Tidigare idempotent request misslyckades.");

  return failureResponse(
    new WebsiteApplicationError({
      message: "Tidigare idempotent request misslyckades.",
      status: 409,
      code: "idempotent_failed",
      stage: "idempotency",
      hint: "Använd ny Idempotency-Key efter att felet är åtgärdat, eller kör retry via admin.",
      details: {
        application_id: existing.id,
        external_customer_id:
          existing.external_customer_id ?? externalCustomerId,
        previous_status: existing.status,
        previous_error_stage: errorStage,
        previous_error_code: errorCode,
        previous_error_message: errorMessage,
      },
    }),
  );
}

export function isFailedIdempotentApplication(
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>,
  currentInput?: ApplicationInput,
) {
  const response = existing.response_payload ?? {};
  const responseCode = clean(response.code);
  const hasCustomer = Boolean(
    existing.customer_id &&
    (existing.customer_number ?? clean(response.customer_number)),
  );
  const hasSite = Boolean(
    existing.customer_site_id ?? clean(response.customer_site_id),
  );
  const hasMetering = Boolean(
    existing.metering_point_id ?? clean(response.metering_point_id),
  );
  const hasContract = Boolean(
    existing.contract_id ?? clean(response.contract_id),
  );

  if (REPLAYABLE_COMMITTED_STATUSES.has(existing.status)) {
    // A committed business status is replayable only when the durable resources
    // expected for that exact state still exist. needs_facility_data deliberately
    // requires a site but not a metering point; ready/switch/active states require
    // the complete customer/site/metering/contract chain.
    if (!hasCustomer) return true;
    if (COMMITTED_SITE_REQUIRED_STATUSES.has(existing.status) && !hasSite)
      return true;
    if (
      COMMITTED_METERING_REQUIRED_STATUSES.has(existing.status) &&
      !hasMetering
    )
      return true;
    if (
      COMMITTED_CONTRACT_REQUIRED_STATUSES.has(existing.status) &&
      !hasContract
    )
      return true;
    return false;
  }

  const requiresSiteAndMetering =
    expectsSiteOrMetering(currentInput) ||
    expectsSiteOrMetering(existing.payload);
  return (
    existing.status === "failed" ||
    Boolean(
      existing.error_stage || existing.error_code || existing.error_message,
    ) ||
    responseCode === "internal_error" ||
    (requiresSiteAndMetering && !hasCompleteSiteAndMetering(existing)) ||
    (!hasCustomer &&
      ["failed", "rejected", "cancelled"].includes(existing.status))
  );
}

export function isRetryableFailedSiteProvisioningApplication(
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>,
  externalCustomerId: string,
) {
  const response = existing.response_payload ?? {};
  const previousStage = existing.error_stage ?? clean(response.error_stage);
  const previousCode = existing.error_code ?? clean(response.code);
  const previousMessage = [
    existing.error_message,
    clean(response.error),
    clean(response.previous_error_message),
    clean(response.next_step),
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .join(" · ");

  const sameExternalCustomer =
    (existing.external_customer_id ?? externalCustomerId) ===
    externalCustomerId;
  const failedBeforeDurableResources =
    !existing.customer_site_id &&
    !existing.metering_point_id &&
    !existing.contract_id;
  const failedAtSiteCreate = previousStage === "site_create";
  const provisioningError =
    /site_provisioning|anläggningsprovisionering|customer_sites|schema cache|migration|atomisk/i.test(
      previousMessage,
    ) ||
    [
      "site_provisioning_function_unavailable",
      "customer_site_schema_mismatch",
      "incomplete_application",
      "internal_error",
    ].includes(previousCode ?? "");

  return Boolean(
    sameExternalCustomer &&
    failedBeforeDurableResources &&
    failedAtSiteCreate &&
    provisioningError &&
    ["failed", "pending_review", "partial"].includes(existing.status),
  );
}

export async function releaseRetryableFailedIdempotency(input: {
  companyId: string;
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>;
  idempotencyKey: string;
}) {
  const releasedKey = `${input.idempotencyKey}:failed:${input.existing.id}`;
  const responsePayload = {
    ...(input.existing.response_payload ?? {}),
    superseded_by_retry: true,
    superseded_at: new Date().toISOString(),
    original_idempotency_key: input.idempotencyKey,
  };
  const warnings = Array.from(
    new Set([
      ...(input.existing.warnings ?? []),
      "idempotency_released_for_site_provisioning_retry",
    ]),
  );
  const { error } = await supabaseService
    .from("website_customer_applications")
    .update({
      idempotency_key: releasedKey,
      response_payload: responsePayload,
      warnings,
      next_step:
        "Tidigare misslyckat site_create-försök har frigjorts för ny idempotent retry.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.existing.id)
    .eq("company_id", input.companyId)
    .eq("idempotency_key", input.idempotencyKey);

  if (error) throw error;
  return releasedKey;
}

export async function resumeCommittedIdempotentApplication(input: {
  client: IntegrationApiClient;
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>;
  body: ApplicationInput;
  externalCustomerId: string;
}) {
  const response = input.existing.response_payload ?? {};
  const customerId = input.existing.customer_id ?? clean(response.customer_id);
  const customerNumber = input.existing.customer_number ?? clean(response.customer_number);
  const siteId = input.existing.customer_site_id ?? clean(response.customer_site_id);
  const meteringPointId = input.existing.metering_point_id ?? clean(response.metering_point_id);
  const contractId = input.existing.contract_id ?? clean(response.contract_id);
  const portalUserId = clean(input.body.customer_portal_user_id) ?? clean(input.body.auth_user_id);
  if (!customerId || !customerNumber || !contractId) return null;
  if (expectsSiteOrMetering(input.body) && !siteId) return null;

  let portalIdentityId = clean(response.portal_identity_id);
  if (portalUserId) {
    const identity = await upsertPortalIdentity({
      client: input.client,
      customerId,
      externalCustomerId: input.externalCustomerId,
      externalAccountId: portalUserId,
      authUserId: portalUserId,
      customerPortalUserId: portalUserId,
      customerNumber,
      email: normalizedEmail(input.body.customer.email),
      applicationId: input.existing.id,
    });
    const portalLink = await ensureCustomerPortalUserLink({
      client: input.client,
      customerId,
      userId: portalUserId,
      email: normalizedEmail(input.body.customer.email),
      externalCustomerId: input.externalCustomerId,
      customerNumber,
      identityId: identity.id,
      matchMethod: "website_application_idempotent_resume",
    });
    if (!portalLink?.accountId || !portalLink.identityId) {
      throw new Error("customer_portal_link_not_ready_for_resume");
    }
    portalIdentityId = portalLink.identityId;
  } else if (!portalIdentityId) {
    const identity = await upsertPortalIdentity({
      client: input.client,
      customerId,
      externalCustomerId: input.externalCustomerId,
      customerNumber,
      email: normalizedEmail(input.body.customer.email),
      applicationId: input.existing.id,
    });
    portalIdentityId = identity.id;
  }
  if (!portalIdentityId) {
    throw new Error("customer_portal_identity_not_ready_for_resume");
  }

  const workflow = await commitApplicationProvisioning({
    companyId: input.client.company_id,
    applicationId: input.existing.id,
    customerId,
    siteId,
    meteringPointId,
    contractId,
    powerOfAttorneyId: clean(response.power_of_attorney_id),
    desiredState:
      response.can_start_switch === true
        ? "ready_for_switch"
        : siteId
          ? "pending_customer_data"
          : "pending_review",
    snapshot: {
      resumed_from_failed_or_partial: true,
      resumed_at: new Date().toISOString(),
      external_customer_id: input.externalCustomerId,
      customer_number: customerNumber,
      previous_error_stage: input.existing.error_stage ?? null,
      previous_error_code: input.existing.error_code ?? null,
      previous_response_payload: response,
    },
  });
  if (!workflow.continuationJobId) {
    throw new Error("customer_application_continuation_not_created_on_resume");
  }

  const resumedPayload = {
    ...response,
    application_id: input.existing.id,
    customer_id: customerId,
    customer_number: customerNumber,
    customer_site_id: siteId,
    metering_point_id: meteringPointId,
    contract_id: contractId,
    portal_identity_id: portalIdentityId,
    portal_identity_status: portalUserId ? "linked" : "pending_auth",
    workflow_id: workflow.workflowId,
    continuation_job_id: workflow.continuationJobId,
    workflow_state: "canonical_data_committed",
    status: "accepted",
    next_step: "automatic_processing",
    idempotent: true,
    resumed: true,
    communication: {
      triggered: [],
      queued: [],
      sent: [],
      failed: [],
      pending: true,
      source_of_truth: "communication_logs",
    },
  };
  const { error } = await supabaseService
    .from("website_customer_applications")
    .update({
      status: "processing",
      response_payload: resumedPayload,
      error_stage: null,
      error_code: null,
      error_message: null,
      next_step: "automatic_processing",
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.existing.id)
    .eq("company_id", input.client.company_id);
  if (error) throw error;
  return resumedPayload;
}

export function idempotencyPayloadMismatchError(
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>,
  incomingPayloadHash: string,
) {
  return new WebsiteApplicationError({
    message: "Samma Idempotency-Key har redan använts med en annan payload.",
    status: 409,
    code: "idempotency_key_payload_mismatch",
    field: "Idempotency-Key",
    stage: "idempotency",
    hint: "Återanvänd nyckeln endast för exakt samma normaliserade ansökan. Använd en ny nyckel för en ny affärshändelse.",
    details: {
      application_id: existing.id,
      previous_status: existing.status,
      stored_payload_hash: storedApplicationPayloadHash(existing),
      incoming_payload_hash: incomingPayloadHash,
    },
  });
}

export async function loadEquivalentCommittedApplication(input: {
  companyId: string;
  externalCustomerId: string;
  payloadHash: string;
  idempotencyKey: string;
}) {
  const { data, error } = await supabaseService
    .from("website_customer_applications")
    .select(
      "id,idempotency_key,status,customer_id,customer_number,customer_site_id,metering_point_id,contract_id,created_at",
    )
    .eq("company_id", input.companyId)
    .eq("external_customer_id", input.externalCustomerId)
    .eq("payload_hash", input.payloadHash)
    .neq("idempotency_key", input.idempotencyKey)
    .in("status", Array.from(REPLAYABLE_COMMITTED_STATUSES))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as {
    id: string;
    idempotency_key: string | null;
    status: string;
    customer_id: string | null;
    customer_number: string | null;
    customer_site_id: string | null;
    metering_point_id: string | null;
    contract_id: string | null;
    created_at: string;
  } | null;
}

export function duplicateApplicationError(
  existing: NonNullable<
    Awaited<ReturnType<typeof loadEquivalentCommittedApplication>>
  >,
) {
  return new WebsiteApplicationError({
    message:
      "En identisk kundansökan finns redan under en annan Idempotency-Key.",
    status: 409,
    code: "duplicate_application",
    field: "Idempotency-Key",
    stage: "idempotency",
    hint: "Återanvänd den ursprungliga Idempotency-Key för replay. Skicka en ny affärsmässigt ändrad payload endast när en ny ansökan verkligen ska skapas.",
    details: {
      application_id: existing.id,
      previous_status: existing.status,
      previous_idempotency_key: existing.idempotency_key,
      customer_id: existing.customer_id,
      customer_number: existing.customer_number,
      customer_site_id: existing.customer_site_id,
      metering_point_id: existing.metering_point_id,
      contract_id: existing.contract_id,
      created_at: existing.created_at,
    },
  });
}

export async function loadConflictingBusinessApplication(input: {
  companyId: string;
  externalCustomerId: string;
  businessKeyHash: string;
  idempotencyKey: string;
}) {
  const { data, error } = await supabaseService
    .from("website_customer_applications")
    .select(
      "id,idempotency_key,payload_hash,status,customer_id,customer_number,customer_site_id,metering_point_id,contract_id,created_at",
    )
    .eq("company_id", input.companyId)
    .eq("business_key_hash", input.businessKeyHash)
    .neq("idempotency_key", input.idempotencyKey)
    .in("status", Array.from(BUSINESS_CONFLICT_STATUSES))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const direct = data as {
    id: string;
    idempotency_key: string | null;
    payload_hash: string | null;
    status: string;
    customer_id: string | null;
    customer_number: string | null;
    customer_site_id: string | null;
    metering_point_id: string | null;
    contract_id: string | null;
    created_at: string;
  } | null;
  if (direct) return direct;

  // Compatibility for rows committed before business_key_hash was introduced.
  // Compare a bounded set of prior normalized payloads and opportunistically
  // backfill the hash when the same business event is found.
  const legacy = await supabaseService
    .from("website_customer_applications")
    .select(
      "id,idempotency_key,payload_hash,payload,status,customer_id,customer_number,customer_site_id,metering_point_id,contract_id,created_at",
    )
    .eq("company_id", input.companyId)
    .eq("external_customer_id", input.externalCustomerId)
    .neq("idempotency_key", input.idempotencyKey)
    .in("status", Array.from(REPLAYABLE_COMMITTED_STATUSES))
    .order("created_at", { ascending: false })
    .limit(25);
  if (legacy.error) throw legacy.error;

  for (const row of legacy.data ?? []) {
    if (
      !row.payload ||
      typeof row.payload !== "object" ||
      Array.isArray(row.payload)
    )
      continue;
    const rowBusinessKeyHash = applicationBusinessKeyHash(
      row.payload as ApplicationInput,
      input.externalCustomerId,
    );
    if (rowBusinessKeyHash !== input.businessKeyHash) continue;
    await supabaseService
      .from("website_customer_applications")
      .update({
        business_key_hash: rowBusinessKeyHash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("company_id", input.companyId)
      .then(
        () => undefined,
        () => undefined,
      );
    return row as unknown as NonNullable<typeof direct>;
  }
  return null;
}

export function applicationBusinessConflictError(
  existing: NonNullable<
    Awaited<ReturnType<typeof loadConflictingBusinessApplication>>
  >,
) {
  const processing = existing.status === "processing";
  return new WebsiteApplicationError({
    message: processing
      ? "En ansökan för samma kund, anläggning, erbjudande och startdatum behandlas redan."
      : "En aktiv eller committed ansökan finns redan för samma kund, anläggning, erbjudande och startdatum.",
    status: 409,
    code: processing
      ? "application_business_in_progress"
      : "application_business_conflict",
    field: "Idempotency-Key",
    stage: "idempotency",
    action: processing
      ? "retry_original_application"
      : "resume_or_update_existing_application",
    hint: processing
      ? "Vänta tills den första requesten är slutförd och gör replay med dess ursprungliga Idempotency-Key."
      : "Komplettera eller reparera den befintliga ansökan i stället för att skapa en parallell site/contract/POA/switch-kedja.",
    details: {
      application_id: existing.id,
      previous_status: existing.status,
      previous_idempotency_key: existing.idempotency_key,
      customer_id: existing.customer_id,
      customer_number: existing.customer_number,
      customer_site_id: existing.customer_site_id,
      metering_point_id: existing.metering_point_id,
      contract_id: existing.contract_id,
      created_at: existing.created_at,
    },
  });
}

export async function reserveWebsiteApplicationIdempotency(input: {
  client: IntegrationApiClient;
  externalCustomerId: string;
  idempotencyKey: string;
  payloadHash: string;
  businessKeyHash: string | null;
  payload: ApplicationInput;
  rawPayload: unknown;
}): Promise<
  | {
      acquired: true;
      application: NonNullable<
        Awaited<ReturnType<typeof loadIdempotentApplication>>
      >;
    }
  | {
      acquired: false;
      application: NonNullable<
        Awaited<ReturnType<typeof loadIdempotentApplication>>
      >;
    }
  | {
      acquired: false;
      businessConflict: NonNullable<
        Awaited<ReturnType<typeof loadConflictingBusinessApplication>>
      >;
    }
> {
  const { data, error } = await supabaseService
    .from("website_customer_applications")
    .insert({
      company_id: input.client.company_id,
      api_client_id: input.client.id,
      external_customer_id: input.externalCustomerId,
      source: clean(input.payload.source) ?? "external_website",
      portal_identity_required: true,
      status: "processing",
      idempotency_key: input.idempotencyKey,
      payload_hash: input.payloadHash,
      business_key_hash: input.businessKeyHash,
      payload: input.payload,
      raw_payload: input.rawPayload,
      response_payload: { status: "processing", idempotent: false },
      warnings: [],
      processed_at: null,
    })
    .select(
      "id,idempotency_key,payload_hash,business_key_hash,response_payload,payload,status,customer_id,customer_number,external_customer_id,customer_site_id,metering_point_id,contract_id,error_stage,error_code,error_message,warnings,created_at,updated_at",
    )
    .single();

  if (!error && data)
    return {
      acquired: true,
      application: data as NonNullable<
        Awaited<ReturnType<typeof loadIdempotentApplication>>
      >,
    };
  if (duplicateIdempotencyKey(error)) {
    const winner = await loadIdempotentApplication(
      input.client.company_id,
      input.idempotencyKey,
    );
    if (!winner) throw error;
    return { acquired: false, application: winner };
  }
  if (input.businessKeyHash && duplicateBusinessKey(error)) {
    const conflict = await loadConflictingBusinessApplication({
      companyId: input.client.company_id,
      externalCustomerId: input.externalCustomerId,
      businessKeyHash: input.businessKeyHash,
      idempotencyKey: input.idempotencyKey,
    });
    if (!conflict) throw error;
    return { acquired: false, businessConflict: conflict };
  }
  throw error;
}

export function successResponse(
  data: Record<string, unknown>,
  warnings: string[] = [],
) {
  const publicData = hasCanonicalCommittedApplicationEvidence(data)
    ? { ...data, status: "accepted" }
    : data;
  return {
    ok: true as const,
    status: 200,
    body: {
      data: {
        ...publicData,
        warnings,
      },
    },
  };
}

export function failureResponse(error: WebsiteApplicationError) {
  return {
    ok: false as const,
    status: error.status,
    body: {
      error: operationalErrorMessage(error),
      code: error.code,
      field: error.field ?? null,
      hint: error.hint ?? null,
      error_stage: error.stage,
      action: error.action ?? null,
      details: error.details ?? null,
    },
  };
}