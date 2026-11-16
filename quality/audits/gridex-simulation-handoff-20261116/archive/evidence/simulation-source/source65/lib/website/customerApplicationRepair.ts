// Internal module extracted from customerApplications.ts to keep handwritten production files bounded.
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth";
import { supabaseService } from "@/lib/supabase/service";
import { emitDomainEvent } from "@/lib/events/domainEvents";
import { triggerEmailEvent } from "@/lib/email/emailEvents";
import { processWebsiteApplicationIntake } from "@/lib/customer-operations/customerIntakeOrchestrator";
import { resolvePublicContractOffer, type PublicContractOffer } from "@/lib/website/publicContracts";
import { evaluateAndRunNextCustomerStep } from "@/lib/customer-operations/customerProcessNextStepEngine";
import { transitionCustomerApplicationWorkflow } from "@/lib/website/applicationWorkflow";
import { buildPublicLegalUrl, loadCompanySlugById } from "@/lib/legal/publicLegalDocuments";
import { communicationStatusSnapshot, companyEmailContext, dispatchInitialWebsiteApplicationEmails, eventVariables } from "./customerApplicationCommunication";
import type { WebsiteContractCreateResult } from "./customerApplicationCommunication";
import { normalizeRawApplication } from "./customerApplicationCore";
import { assertWebsiteLegalAcceptances, consentAccepted, emailTriggerSucceeded, ensureWebsitePowerOfAttorney, persistCustomerLegalAcceptances } from "./customerApplicationLegal";
import type { WebsiteLegalAcceptanceVersion } from "./customerApplicationLegal";
import { ApplicationSchema, normalizeStructuredPoa, structuredPoaIsExternallySendable } from "./customerApplicationSchemas";
import type { ApplicationInput, NormalizedStructuredPoa } from "./customerApplicationSchemas";
import { clean, missingSchema, normalizedEmail } from "./customerApplicationShared";
import type { CustomerRow, RequestAuditMetadata } from "./customerApplicationShared";

type MissingPoaInlineRepairResult = {
  ok: boolean;
  code?: string;
  message?: string;
  data: Record<string, unknown>;
  warnings: string[];
};

// Inline self-healing for idempotent replays where the original successful
// application row was missing its power_of_attorney_id. The public website API
// must not force normal customers into an admin-repair/idempotency loop when
// the retry payload already contains a complete accepted powerOfAttorney from
// OPS legal documents. This is deliberately narrow: it only creates the missing
// POA on the existing application and updates the stored response/payload.
export async function repairMissingPoaOnIdempotentApplication(input: {
  client: IntegrationApiClient;
  existingApplication: {
    id: string;
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
  };
  body: ApplicationInput;
  rawBody: unknown;
  structuredPoa: NormalizedStructuredPoa | null;
  externalCustomerId: string;
  requestAudit?: RequestAuditMetadata;
}): Promise<MissingPoaInlineRepairResult | null> {
  const existing = input.existingApplication;
  const responsePayload = (existing.response_payload ?? {}) as Record<
    string,
    unknown
  >;
  const existingPoaId = clean(responsePayload.power_of_attorney_id);
  const warnings = Array.isArray(existing.warnings)
    ? existing.warnings.map((warning) => String(warning))
    : [];

  if (existingPoaId) {
    return {
      ok: true,
      data: {
        ...responsePayload,
        idempotent: true,
        repaired: false,
        application_id: existing.id,
        customer_id:
          existing.customer_id ??
          (responsePayload.customer_id as string | undefined) ??
          null,
        customer_number:
          existing.customer_number ??
          (responsePayload.customer_number as string | undefined) ??
          null,
        external_customer_id:
          existing.external_customer_id ?? input.externalCustomerId,
        status: existing.status,
      },
      warnings,
    };
  }

  if (!existing.customer_id) {
    return {
      ok: false,
      code: "customer_missing",
      message: "Ansökan saknar kund och kan inte repareras automatiskt.",
      data: responsePayload,
      warnings,
    };
  }

  if (input.structuredPoa?.accepted !== true) {
    return {
      ok: false,
      code: "power_of_attorney_missing",
      message: "Retry-payloaden saknar accepterad strukturerad fullmakt.",
      data: responsePayload,
      warnings,
    };
  }

  const selectedOfferReference =
    clean(input.body.offer_reference) ??
    clean(input.body.offerReference) ??
    clean(input.body.contract?.offer_reference) ??
    clean(input.body.contract?.offerReference);
  const selectedPricePlanVersionId =
    clean(input.body.price_plan_version_id) ??
    clean(input.body.contract?.price_plan_version_id);
  const selectedPricePlanId =
    clean(input.body.price_plan_id) ??
    clean(input.body.contract?.price_plan_id);
  const selectedContractOfferId =
    clean(input.body.contract_offer_id) ??
    clean(input.body.contract?.contract_offer_id);
  const selectedProductCode =
    clean(input.body.product_code) ?? clean(input.body.contract?.product_code);

  const publicOffer = await resolvePublicContractOffer({
    client: input.client,
    offerReference: selectedOfferReference,
    pricePlanVersionId: selectedPricePlanVersionId,
    pricePlanId: selectedPricePlanId,
    contractOfferId: selectedContractOfferId,
    productCode: selectedProductCode,
    customerType: input.body.customer.customer_type,
    allowLegacyLookup: true,
  });

  if (!publicOffer) {
    return {
      ok: false,
      code: "public_contract_not_available",
      message:
        "Avtalet kunde inte verifieras mot publicerade OPS-avtal och fullmakten kan inte repareras automatiskt.",
      data: responsePayload,
      warnings,
    };
  }

  const legalVersions = await assertWebsiteLegalAcceptances({
    companyId: input.client.company_id,
    consents: input.body.consents,
    legalBundleVersion: clean(input.body.legal_bundle_version),
    legalAcceptances:
      input.body.legal_acceptances ?? input.body.legalAcceptances,
    publicOffer,
  });

  const { data: existingAcceptances, error: acceptanceLoadError } =
    await supabaseService
      .from("customer_legal_acceptances")
      .select("id")
      .eq("company_id", input.client.company_id)
      .eq("contract_application_id", existing.id)
      .limit(1);
  if (acceptanceLoadError && !missingSchema(acceptanceLoadError))
    throw acceptanceLoadError;

  if (
    (!existingAcceptances || existingAcceptances.length === 0) &&
    legalVersions.length > 0
  ) {
    await persistCustomerLegalAcceptances({
      companyId: input.client.company_id,
      customerId: existing.customer_id,
      contractId: existing.contract_id ?? null,
      applicationId: existing.id,
      publicOffer,
      legalVersions,
      consents: input.body.consents,
      rawPayload: input.rawBody,
      requestAudit: input.requestAudit,
      acceptedAt: new Date().toISOString(),
    });
  }

  const powerOfAttorneyId = await ensureWebsitePowerOfAttorney({
    companyId: input.client.company_id,
    customerId: existing.customer_id,
    contractId: existing.contract_id ?? null,
    customerSiteId: existing.customer_site_id ?? null,
    meteringPointId: existing.metering_point_id ?? null,
    applicationId: existing.id,
    publicOffer,
    legalVersions,
    consents: input.body.consents,
    requestAudit: input.requestAudit,
    rawPayload: input.rawBody,
    structuredPoa: input.structuredPoa,
  });

  if (!powerOfAttorneyId) {
    return {
      ok: false,
      code: "power_of_attorney_missing",
      message: "Fullmakten kunde inte skapas på den befintliga ansökan.",
      data: responsePayload,
      warnings,
    };
  }

  const poaExternallySendable = structuredPoaIsExternallySendable(
    input.structuredPoa,
  );
  const poaLegalVersionId =
    input.structuredPoa?.textVersionId ??
    legalVersions.find((version) => version.type === "power_of_attorney")?.id ??
    null;
  const tenantSlug = await loadCompanySlugById(input.client.company_id);
  const poaDocumentUrl =
    tenantSlug && poaLegalVersionId
      ? buildPublicLegalUrl(tenantSlug, "power_of_attorney", poaLegalVersionId)
      : null;

  const updatedResponsePayload: Record<string, unknown> = {
    ...responsePayload,
    power_of_attorney_id: powerOfAttorneyId,
    power_of_attorney: {
      status: "signed",
      scope: input.structuredPoa?.scope ?? [],
      method: input.structuredPoa?.method ?? null,
      externally_sendable: poaExternallySendable,
      requires_completion: !poaExternallySendable,
      text_version_id: poaLegalVersionId,
      document_url: poaDocumentUrl,
      repaired: true,
    },
    repaired_at: new Date().toISOString(),
    repaired_reason: "idempotent_missing_power_of_attorney",
  };

  const { error: updateError } = await supabaseService
    .from("website_customer_applications")
    .update({
      payload: input.body,
      raw_payload: input.rawBody,
      response_payload: updatedResponsePayload,
      error_stage: null,
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .eq("company_id", input.client.company_id);
  if (updateError && !missingSchema(updateError)) throw updateError;

  await emitDomainEvent({
    companyId: input.client.company_id,
    eventType: "website_application.repaired",
    aggregateType: "website_customer_application",
    aggregateId: existing.id,
    subjectCustomerId: existing.customer_id,
    source: "website_customer_applications_inline_repair",
    idempotencyKey: `website-application-inline-repair:${input.client.company_id}:${existing.id}:${powerOfAttorneyId}`,
    payload: {
      application_id: existing.id,
      power_of_attorney_id: powerOfAttorneyId,
      externally_sendable: poaExternallySendable,
      reason: "idempotent_missing_power_of_attorney",
    },
  }).catch((eventError) => {
    console.warn(
      "[website-applications] inline POA repair audit event failed",
      eventError,
    );
  });

  const repairedWarnings = poaExternallySendable
    ? warnings
    : [
        ...warnings,
        "Fullmakten är registrerad men måste kompletteras innan extern nätägarkommunikation.",
      ];

  return {
    ok: true,
    data: {
      ...updatedResponsePayload,
      idempotent: true,
      repaired: true,
      application_id: existing.id,
      customer_id: existing.customer_id,
      customer_number:
        existing.customer_number ??
        (responsePayload.customer_number as string | undefined) ??
        null,
      external_customer_id:
        existing.external_customer_id ?? input.externalCustomerId,
      status: existing.status,
    },
    warnings: repairedWarnings,
  };
}

export type RepairWebsiteCustomerApplicationResult = {
  ok: boolean;
  status: "repaired" | "completed" | "no_action" | "failed";
  code?: string;
  message: string;
  applicationId: string;
  powerOfAttorneyId?: string | null;
};


export type WebsiteCustomerApplicationContinuationOutcome = {
  status: "completed" | "needs_review" | "blocked";
  result: Record<string, unknown>;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function continuationStateForDecision(
  decision: Awaited<ReturnType<typeof evaluateAndRunNextCustomerStep>>["decision"],
): "switch_request_queued" | "waiting_for_customer_data_response" | "switch_blocked" | "manual_review" {
  if (decision === "prepare_supplier_switch") return "switch_request_queued";
  if (decision === "prepare_z01" || decision === "wait_for_ack") return "waiting_for_customer_data_response";
  if (decision === "manual_review") return "manual_review";
  return "switch_blocked";
}

/**
 * Durable post-commit continuation for website customer applications.
 *
 * This function is called only by the canonical customer-operation worker. It
 * may be executed repeatedly: document storage, email events, domain events,
 * facility lookup and switch creation all use stable idempotency identities.
 */
export async function continueWebsiteCustomerApplication(input: {
  companyId: string;
  applicationId: string;
  operationId: string;
  workflowId?: string | null;
  jobId?: string | null;
}): Promise<WebsiteCustomerApplicationContinuationOutcome> {
  const { data: appRow, error: appError } = await supabaseService
    .from("website_customer_applications")
    .select("*")
    .eq("id", input.applicationId)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (appError) throw appError;
  if (!appRow) {
    return {
      status: "needs_review",
      result: { reason_code: "customer_application_not_found", application_id: input.applicationId },
    };
  }

  const application = appRow as Record<string, unknown>;
  const customerId = clean(application.customer_id);
  if (!customerId) {
    return {
      status: "needs_review",
      result: { reason_code: "customer_missing", application_id: input.applicationId },
    };
  }

  const { data: workflowRow, error: workflowError } = await supabaseService
    .from("customer_application_workflows")
    .select("id,operation_id,state,snapshot,customer_site_id,metering_point_id,contract_id,workflow_version")
    .eq("company_id", input.companyId)
    .eq("customer_application_id", input.applicationId)
    .maybeSingle();
  if (workflowError) throw workflowError;
  if (!workflowRow) {
    return {
      status: "needs_review",
      result: { reason_code: "customer_application_workflow_not_found", application_id: input.applicationId },
    };
  }

  const workflow = workflowRow as Record<string, unknown>;
  const snapshot = recordValue(workflow.snapshot);
  const siteId = clean(workflow.customer_site_id) ?? clean(application.customer_site_id);
  const meteringPointId = clean(workflow.metering_point_id) ?? clean(application.metering_point_id);
  const contractId = clean(workflow.contract_id) ?? clean(application.contract_id);
  const operationId = clean(workflow.operation_id) ?? input.operationId;

  const storedPayload = recordValue(application.payload ?? application.raw_payload);
  const parsed = ApplicationSchema.safeParse(normalizeRawApplication(storedPayload));
  if (!parsed.success) {
    await transitionCustomerApplicationWorkflow({
      companyId: input.companyId,
      applicationId: input.applicationId,
      state: "manual_review",
      eventCode: "workflow.stored_payload_invalid",
      reasonCode: "stored_application_payload_invalid",
      idempotencyKey: `workflow.stored_payload_invalid:${input.applicationId}`,
      snapshotPatch: { next_action: "review_stored_payload" },
    });
    return {
      status: "needs_review",
      result: {
        reason_code: "stored_application_payload_invalid",
        application_id: input.applicationId,
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    };
  }
  const body = parsed.data;

  const [customerResult, siteResult, meteringResult, contractResult] = await Promise.all([
    supabaseService
      .from("customers")
      .select("id,customer_number,email,full_name,company_name")
      .eq("company_id", input.companyId)
      .eq("id", customerId)
      .maybeSingle(),
    siteId
      ? supabaseService.from("customer_sites").select("*").eq("company_id", input.companyId).eq("id", siteId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    meteringPointId
      ? supabaseService.from("metering_points").select("*").eq("company_id", input.companyId).eq("id", meteringPointId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contractId
      ? supabaseService.from("customer_contracts").select("*").eq("company_id", input.companyId).eq("id", contractId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [customerResult, siteResult, meteringResult, contractResult]) {
    if (result.error) throw result.error;
  }
  if (!customerResult.data) {
    return { status: "needs_review", result: { reason_code: "customer_missing", customer_id: customerId } };
  }

  const customer = customerResult.data as CustomerRow;
  const site = recordValue(siteResult.data);
  const meteringPoint = recordValue(meteringResult.data);
  const contract = contractResult.data ? (contractResult.data as WebsiteContractCreateResult) : null;
  const publicOffer = Object.keys(recordValue(snapshot.public_offer_snapshot)).length > 0
    ? (recordValue(snapshot.public_offer_snapshot) as unknown as PublicContractOffer)
    : null;
  const legalVersions = Array.isArray(snapshot.legal_versions)
    ? (snapshot.legal_versions as WebsiteLegalAcceptanceVersion[])
    : [];
  const legalAcceptanceIds = recordValue(snapshot.legal_acceptance_ids) as Record<string, string>;
  const responsePayload = recordValue(application.response_payload);
  const externalCustomerId =
    clean(snapshot.external_customer_id) ??
    clean(application.external_customer_id) ??
    customerId;
  const customerNumber =
    clean(snapshot.customer_number) ??
    clean(customer.customer_number) ??
    externalCustomerId;
  const offerReference = clean(snapshot.offer_reference) ?? clean(responsePayload.offer_reference);
  const startDate = clean(snapshot.requested_start_date) ?? clean(contract?.starts_at);

  await transitionCustomerApplicationWorkflow({
    companyId: input.companyId,
    applicationId: input.applicationId,
    state: "initial_notifications_pending",
    eventCode: "workflow.initial_notifications_pending",
    idempotencyKey: `workflow.initial_notifications_pending:${input.applicationId}`,
    snapshotPatch: { next_action: "queue_initial_notifications", continuation_job_id: input.jobId ?? null },
  });

  const communication = await dispatchInitialWebsiteApplicationEmails({
    companyId: input.companyId,
    applicationId: input.applicationId,
    customer,
    rawCustomer: body.customer,
    customerNumber,
    externalCustomerId,
    siteId,
    facilityId: clean(site.facility_id) ?? clean(body.site?.facility_id),
    meteringPointId,
    contract,
    publicOffer,
    offerReference,
    legalVersions,
    legalAcceptanceIds,
    startDate,
  });
  const failedCommunication = communication.results.filter((item) => !item.ok);
  if (failedCommunication.length > 0) {
    throw new Error(
      `initial_customer_communication_failed:${failedCommunication.map((item) => item.eventKey).join(",")}`,
    );
  }
  const communicationStatus = communicationStatusSnapshot(communication);

  await transitionCustomerApplicationWorkflow({
    companyId: input.companyId,
    applicationId: input.applicationId,
    state: "initial_notifications_queued",
    eventCode: "workflow.initial_notifications_queued",
    idempotencyKey: `workflow.initial_notifications_queued:${input.applicationId}`,
    snapshotPatch: {
      next_action: "facility_information_check",
      communication_events: communication.events,
    },
  });

  await emitDomainEvent({
    companyId: input.companyId,
    eventType: "customer_application.accepted",
    aggregateType: "website_customer_application",
    aggregateId: input.applicationId,
    subjectCustomerId: customerId,
    source: "customer_application_continuation",
    idempotencyKey: `customer-application-accepted:${input.companyId}:${input.applicationId}`,
    payload: {
      application_id: input.applicationId,
      customer_id: customerId,
      customer_number: customerNumber,
      site_id: siteId,
      metering_point_id: meteringPointId,
      contract_id: contractId,
      workflow_id: clean(workflow.id),
      operation_id: operationId,
    },
  });

  const poaExternallySendable = snapshot.poa_externally_sendable === true;
  const powerOfAttorneyId = clean(responsePayload.power_of_attorney_id) ?? clean(recordValue(responsePayload.power_of_attorney).id);
  if (!powerOfAttorneyId || !poaExternallySendable) {
    const email = normalizedEmail(body.customer.email) ?? normalizedEmail(customer.email);
    if (email) {
      const company = await companyEmailContext(input.companyId, contractId);
      const powerOfAttorneyDispatch = await triggerEmailEvent({
        companyId: input.companyId,
        customerId,
        siteId,
        meteringPointId,
        eventKey: "contract.power_of_attorney_required",
        to: email,
        adminTo: company.adminEmail,
        variables: eventVariables({
          companyName: company.name,
          customer,
          rawCustomer: body.customer,
          customerNumber,
          siteId,
          facilityId: clean(site.facility_id),
          meteringPointId,
          contractName: contract?.contract_name,
          contractNumber: contract?.contract_number,
          offerReference,
          startDate,
          supportEmail: company.supportEmail,
          portalUrl: company.portalUrl,
        }),
        idempotencyKey: `website_application:${input.applicationId}:contract.power_of_attorney_required`,
        metadata: { application_id: input.applicationId, contract_id: contractId, reason_code: "power_of_attorney_not_externally_sendable" },
      });
      if (!emailTriggerSucceeded(powerOfAttorneyDispatch)) {
        throw new Error("power_of_attorney_required_notification_not_queued");
      }
    }
    await transitionCustomerApplicationWorkflow({
      companyId: input.companyId,
      applicationId: input.applicationId,
      state: "facility_information_required",
      eventCode: "workflow.power_of_attorney_completion_required",
      reasonCode: powerOfAttorneyId ? "power_of_attorney_not_externally_sendable" : "power_of_attorney_missing",
      idempotencyKey: `workflow.power_of_attorney_completion_required:${input.applicationId}`,
      snapshotPatch: { next_action: "request_power_of_attorney_completion" },
    });
    const result = {
      reason_code: powerOfAttorneyId ? "power_of_attorney_not_externally_sendable" : "power_of_attorney_missing",
      application_id: input.applicationId,
      workflow_id: clean(workflow.id),
      communication_events: communication.events,
    };
    await supabaseService
      .from("website_customer_applications")
      .update({
        status: "needs_information",
        next_step: "complete_power_of_attorney",
        response_payload: { ...responsePayload, status: "needs_customer_information", workflow_state: "facility_information_required", next_step: "complete_power_of_attorney", communication: communicationStatus },
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.applicationId)
      .eq("company_id", input.companyId);
    await emitDomainEvent({
      companyId: input.companyId,
      eventType: "customer_application.needs_information",
      aggregateType: "website_customer_application",
      aggregateId: input.applicationId,
      subjectCustomerId: customerId,
      source: "customer_application_continuation",
      idempotencyKey: `customer-application-needs-poa:${input.companyId}:${input.applicationId}`,
      payload: result,
    });
    return { status: "needs_review", result };
  }

  await transitionCustomerApplicationWorkflow({
    companyId: input.companyId,
    applicationId: input.applicationId,
    state: "facility_information_check",
    eventCode: "workflow.facility_information_check",
    idempotencyKey: `workflow.facility_information_check:${input.applicationId}`,
    snapshotPatch: { next_action: "determine_next_customer_operation" },
  });

  const facilityId = clean(site.facility_id) ?? clean(site.normalized_facility_id);
  const meteringIdentity =
    clean(meteringPoint.metering_point_id) ??
    clean(meteringPoint.ediel_metering_point_id) ??
    clean(meteringPoint.meter_point_id);

  if (!siteId || (!facilityId && !meteringIdentity)) {
    const intakeDecision = await processWebsiteApplicationIntake({
      companyId: input.companyId,
      customerId,
      siteId,
      actorUserId: null,
    });
    const waiting = intakeDecision.state === "facility_lookup_waiting_response" || intakeDecision.nextAction === "wait_for_grid_owner";
    const state = waiting ? "waiting_for_facility_response" : intakeDecision.state === "needs_admin_review" ? "manual_review" : "facility_request_pending";
    await transitionCustomerApplicationWorkflow({
      companyId: input.companyId,
      applicationId: input.applicationId,
      state,
      eventCode: waiting ? "workflow.facility_request_sent" : "workflow.facility_request_evaluated",
      reasonCode: intakeDecision.blockers[0]?.code ?? null,
      idempotencyKey: `workflow.facility_information_lookup:${input.applicationId}:${state}`,
      snapshotPatch: {
        next_action: intakeDecision.nextAction,
        intake_decision: intakeDecision,
      },
    });
    const status = intakeDecision.state === "needs_admin_review" ? "needs_review" : "completed";
    const result = {
      application_id: input.applicationId,
      workflow_id: clean(workflow.id),
      workflow_state: state,
      next_action: intakeDecision.nextAction,
      blockers: intakeDecision.blockers,
      warnings: intakeDecision.warnings,
      references: intakeDecision.references,
      communication_events: communication.events,
    };
    await supabaseService
      .from("website_customer_applications")
      .update({
        status: status === "needs_review" ? "pending_review" : "processing",
        next_step: intakeDecision.nextAction,
        response_payload: { ...responsePayload, status: status === "needs_review" ? "needs_customer_information" : "processing", workflow_state: state, next_step: intakeDecision.nextAction, communication: communicationStatus },
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.applicationId)
      .eq("company_id", input.companyId);
    if (waiting) {
      await emitDomainEvent({
        companyId: input.companyId,
        eventType: "facility_information.requested",
        aggregateType: "website_customer_application",
        aggregateId: input.applicationId,
        subjectCustomerId: customerId,
        source: "customer_application_continuation",
        idempotencyKey: `facility-information-requested:${input.companyId}:${input.applicationId}`,
        payload: result,
      });
    }
    return { status, result };
  }

  await transitionCustomerApplicationWorkflow({
    companyId: input.companyId,
    applicationId: input.applicationId,
    state: "switch_readiness_check",
    eventCode: "workflow.switch_readiness_check",
    idempotencyKey: `workflow.switch_readiness_check:${input.applicationId}`,
    snapshotPatch: { next_action: "determine_z01_or_supplier_switch" },
  });

  const next = await evaluateAndRunNextCustomerStep({
    companyId: input.companyId,
    customerId,
    siteId,
    operationId,
    trigger: "supplier_switch_ready",
    actorUserId: null,
    source: "system",
  });
  const finalState = continuationStateForDecision(next.decision);
  await transitionCustomerApplicationWorkflow({
    companyId: input.companyId,
    applicationId: input.applicationId,
    state: finalState,
    eventCode: `workflow.${finalState}`,
    reasonCode: next.blockers[0]?.code ?? null,
    idempotencyKey: `workflow.next-operation:${input.applicationId}:${finalState}`,
    snapshotPatch: {
      next_action: next.actionTaken ?? next.decision,
      next_operation_decision: next,
    },
  });

  const terminalStatus = next.decision === "blocked" || next.decision === "manual_review" ? "needs_review" : "completed";
  const result = {
    application_id: input.applicationId,
    workflow_id: clean(workflow.id),
    workflow_state: finalState,
    decision: next.decision,
    action_taken: next.actionTaken,
    blockers: next.blockers,
    supplier_switch_request_id: next.supplierSwitchRequestId ?? null,
    z01: next.z01 ?? null,
    communication_events: communication.events,
  };
  await supabaseService
    .from("website_customer_applications")
    .update({
      status: terminalStatus === "needs_review" ? "pending_review" : "processing",
      next_step: next.actionTaken ?? next.decision,
      response_payload: { ...responsePayload, status: terminalStatus === "needs_review" ? "needs_customer_information" : "processing", workflow_state: finalState, next_step: next.actionTaken ?? next.decision, communication: communicationStatus, supplier_switch_request_id: next.supplierSwitchRequestId ?? null },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.applicationId)
    .eq("company_id", input.companyId);
  return { status: terminalStatus, result };
}

// Admin/platform-guarded repair for an application whose power of attorney was
// lost during a partial/failed run. It re-reads the stored payload, re-creates
// the missing power of attorney (and legal acceptances if absent), updates the
// response payload and status, and writes an audit event.
//
// This MUST only be invoked from a platform/admin-guarded server action — it is
// never exposed as a public endpoint and takes no caller-supplied tenant scope.
export async function repairWebsiteCustomerApplication(
  applicationId: string,
): Promise<RepairWebsiteCustomerApplicationResult> {
  const { data: appRow, error: loadError } = await supabaseService
    .from("website_customer_applications")
    .select(
      "id,company_id,api_client_id,customer_id,contract_id,customer_site_id,metering_point_id,status,payload,raw_payload,response_payload,external_customer_id",
    )
    .eq("id", applicationId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!appRow) {
    return {
      ok: false,
      status: "failed",
      code: "application_not_found",
      message: "Ansökan hittades inte.",
      applicationId,
    };
  }

  const companyId = String(appRow.company_id);
  const customerId = appRow.customer_id ? String(appRow.customer_id) : null;
  if (!customerId) {
    return {
      ok: false,
      status: "failed",
      code: "customer_missing",
      message: "Ansökan saknar kund och kan inte repareras automatiskt.",
      applicationId,
    };
  }

  const { data: customerRow, error: customerError } = await supabaseService
    .from("customers")
    .select("id")
    .eq("company_id", companyId)
    .eq("id", customerId)
    .maybeSingle();
  if (customerError) throw customerError;
  if (!customerRow) {
    return {
      ok: false,
      status: "failed",
      code: "customer_missing",
      message: "Kunden för ansökan finns inte längre.",
      applicationId,
    };
  }

  const responsePayload = (appRow.response_payload ?? {}) as Record<
    string,
    unknown
  >;
  const existingPoaId = clean(responsePayload.power_of_attorney_id);
  if (existingPoaId) {
    return {
      ok: true,
      status: "no_action",
      message: "Fullmakt finns redan registrerad på ansökan.",
      applicationId,
      powerOfAttorneyId: existingPoaId,
    };
  }

  const storedPayload = (appRow.payload ?? appRow.raw_payload ?? {}) as Record<
    string,
    unknown
  >;
  const normalizedRaw = normalizeRawApplication(storedPayload);
  const parsed = ApplicationSchema.safeParse(normalizedRaw);
  if (!parsed.success) {
    return {
      ok: false,
      status: "failed",
      code: "payload_invalid",
      message: "Sparad payload kunde inte tolkas för reparation.",
      applicationId,
    };
  }
  let body = parsed.data;
  const structuredPoa = normalizeStructuredPoa(body);
  if (structuredPoa?.accepted === true) {
    body = {
      ...body,
      consents: { ...(body.consents ?? {}), power_of_attorney: true },
    };
  }
  if (
    !consentAccepted(body.consents, [
      "power_of_attorney",
      "poa_accepted",
      "power_of_attorney_accepted",
    ])
  ) {
    return {
      ok: false,
      status: "no_action",
      code: "power_of_attorney_missing",
      message:
        "Den sparade ansökan innehåller ingen accepterad fullmakt att reparera.",
      applicationId,
    };
  }

  const minimalClient = {
    id: appRow.api_client_id ? String(appRow.api_client_id) : "repair",
    company_id: companyId,
    name: "repair",
    status: "active",
    key_prefix: "",
    secret_hash: "",
    scopes: ["*"],
    allowed_ips: [],
    rate_limit_per_minute: 0,
    expires_at: null,
  } as IntegrationApiClient;

  const selectedOfferReference =
    clean(body.offer_reference) ??
    clean(body.offerReference) ??
    clean(body.contract?.offer_reference) ??
    clean(body.contract?.offerReference);
  const selectedPricePlanVersionId =
    clean(body.price_plan_version_id) ??
    clean(body.contract?.price_plan_version_id);
  const selectedPricePlanId =
    clean(body.price_plan_id) ?? clean(body.contract?.price_plan_id);
  const selectedContractOfferId =
    clean(body.contract_offer_id) ?? clean(body.contract?.contract_offer_id);
  const selectedProductCode =
    clean(body.product_code) ?? clean(body.contract?.product_code);

  const publicOffer = await resolvePublicContractOffer({
    client: minimalClient,
    offerReference: selectedOfferReference,
    pricePlanVersionId: selectedPricePlanVersionId,
    pricePlanId: selectedPricePlanId,
    contractOfferId: selectedContractOfferId,
    productCode: selectedProductCode,
    customerType: body.customer.customer_type,
    allowLegacyLookup: true,
  });

  let legalVersions: WebsiteLegalAcceptanceVersion[] = [];
  if (publicOffer) {
    legalVersions = await assertWebsiteLegalAcceptances({
      companyId,
      consents: body.consents,
      legalBundleVersion: clean(body.legal_bundle_version),
      legalAcceptances: body.legal_acceptances ?? body.legalAcceptances,
      publicOffer,
    });
  }

  // Re-create legal acceptances only if none exist for this application yet.
  const { data: existingAcceptances } = await supabaseService
    .from("customer_legal_acceptances")
    .select("id")
    .eq("company_id", companyId)
    .eq("contract_application_id", applicationId)
    .limit(1);
  if (
    (!existingAcceptances || existingAcceptances.length === 0) &&
    legalVersions.length > 0
  ) {
    await persistCustomerLegalAcceptances({
      companyId,
      customerId,
      contractId: appRow.contract_id ? String(appRow.contract_id) : null,
      applicationId,
      publicOffer,
      legalVersions,
      consents: body.consents,
      rawPayload: storedPayload,
      acceptedAt: new Date().toISOString(),
    });
  }

  const powerOfAttorneyId = await ensureWebsitePowerOfAttorney({
    companyId,
    customerId,
    contractId: appRow.contract_id ? String(appRow.contract_id) : null,
    customerSiteId: appRow.customer_site_id
      ? String(appRow.customer_site_id)
      : null,
    meteringPointId: appRow.metering_point_id
      ? String(appRow.metering_point_id)
      : null,
    applicationId,
    publicOffer,
    legalVersions,
    consents: body.consents,
    rawPayload: storedPayload,
    structuredPoa,
  });

  if (!powerOfAttorneyId) {
    return {
      ok: false,
      status: "failed",
      code: "power_of_attorney_missing",
      message: "Fullmakten kunde inte skapas vid reparation.",
      applicationId,
    };
  }

  const poaExternallySendable =
    structuredPoaIsExternallySendable(structuredPoa);
  const nextStatus = poaExternallySendable ? "completed" : "repaired";
  const updatedResponsePayload: Record<string, unknown> = {
    ...responsePayload,
    power_of_attorney_id: powerOfAttorneyId,
    power_of_attorney: {
      status: "signed",
      externally_sendable: poaExternallySendable,
      requires_completion: !poaExternallySendable,
      repaired: true,
    },
    repaired_at: new Date().toISOString(),
  };

  const { error: updateError } = await supabaseService
    .from("website_customer_applications")
    .update({
      status: nextStatus,
      response_payload: updatedResponsePayload,
      error_stage: null,
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId)
    .eq("company_id", companyId);
  if (updateError && !missingSchema(updateError)) throw updateError;

  await emitDomainEvent({
    companyId,
    eventType: "website_application.repaired",
    aggregateType: "website_customer_application",
    aggregateId: applicationId,
    subjectCustomerId: customerId,
    source: "website_customer_applications_repair",
    idempotencyKey: `website-application-repair:${companyId}:${applicationId}:${powerOfAttorneyId}`,
    payload: {
      application_id: applicationId,
      power_of_attorney_id: powerOfAttorneyId,
      externally_sendable: poaExternallySendable,
      previous_status: appRow.status,
      new_status: nextStatus,
    },
  }).catch((eventError) => {
    console.warn(
      "[website-applications] repair audit event failed",
      eventError,
    );
  });

  return {
    ok: true,
    status: nextStatus,
    message: poaExternallySendable
      ? "Fullmakten skapades och ansökan markerades som klar."
      : "Fullmakten skapades men måste kompletteras för extern sändning.",
    applicationId,
    powerOfAttorneyId,
  };
}