// Internal module extracted from customerApplications.ts to keep handwritten production files bounded.
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth";
import { supabaseService } from "@/lib/supabase/service";
import { reserveApplicationNumber } from "@/lib/customer-numbers/customerNumbers";
import { assessWebsiteApplicationReadiness } from "@/lib/website/applicationReview";
import { patchMeteringPointEnergyContext } from "@/lib/energy/meteringPointContext";
import { recordCanonicalEnergyEvent } from "@/lib/energy/canonicalEnergyEvents";
import { publicOfferReference, resolvePublicContractOffer, type PublicContractOffer } from "@/lib/website/publicContracts";
import { mapFacilityBusinessError, normalizeFacilityId, recordFacilityDataIssue } from "@/lib/energy/facilityDataErrors";
import { ensureCustomerPortalUserLink } from "@/lib/customer-portal/customerResolver";
import { applyCustomerSiteAddressCandidate } from "@/lib/customer-sites/addressIntake";
import { ensureCustomerApplicationWorkflow, transitionCustomerApplicationWorkflow } from "@/lib/website/applicationWorkflow";
import { commitApplicationProvisioning, failApplicationProvisioning } from "@/lib/website/provisioningSaga";
import { buildPublicLegalUrl, loadCompanySlugById } from "@/lib/legal/publicLegalDocuments";
import { validateWebsiteQuote, WebsiteQuoteValidationError, type WebsiteQuoteRecord } from "@/lib/pricing/websiteQuotes";
import { websiteSettlementForContract, type WebsiteSettlement } from "@/lib/pricing/websiteSettlement";
import { finalizeWebsiteContractSignature, loadExistingIdentity, upsertPortalIdentity } from "./customerApplicationCommunication";
import type { WebsiteContractCreateResult } from "./customerApplicationCommunication";
import { normalizeRawApplication, patchWebsiteSiteCanonicalFields, requestedAnnualConsumption, runEnergyResolution } from "./customerApplicationCore";
import { assertWebsiteLegalAcceptances, contractLegalMailEvidenceReady, persistCustomerLegalAcceptances } from "./customerApplicationLegal";
import type { WebsiteLegalAcceptanceVersion } from "./customerApplicationLegal";
import { onboardCanonicalWebsiteCustomerGraph } from "./customerApplicationOnboarding";
import { applicationBusinessConflictError, createApplicationRow, duplicateApplicationError, expectsSiteOrMetering, failureResponse, hasCompleteSiteAndMetering, idempotencyPayloadMismatchError, idempotentFailure, isFailedIdempotentApplication, isRetryableFailedSiteProvisioningApplication, loadConflictingBusinessApplication, loadEquivalentCommittedApplication, loadIdempotentApplication, markApplicationFailed, releaseRetryableFailedIdempotency, reserveWebsiteApplicationIdempotency, resumeCommittedIdempotentApplication, storedApplicationPayloadHash, successResponse } from "./customerApplicationPersistence";
import { repairMissingPoaOnIdempotentApplication } from "./customerApplicationRepair";
import { ApplicationSchema, WebsiteQuoteSettlementSchema, applicationBusinessKeyHash, applicationPayloadHash, normalizeStructuredPoa, structuredPoaIsExternallySendable, validateApplicationDates, validateCanonicalApplicationReferencePlacement, validateIdempotencyKey, validateNestedPayloadFields, validateRequestedStartMode, validateStructuredPoaForExternalSendability } from "./customerApplicationSchemas";
import { WEBSITE_APPLICATION_SIGNED_CONTRACT_STATUS, WebsiteApplicationError, calculatedEarliestStartDate, clean, controlledBusinessBlockingReason, controlledBusinessErrorCode, controlledBusinessNextStep, controlledBusinessStatus, errorMessage, isControlledBusinessError, isUuid, missingSchema, normalizedEmail, operationalErrorMessage, reviewAuditEvent, schemaRepairStatus, stage, technicalBlockingReason, timelineEvent, updateCustomerIntakeStatus, validationError } from "./customerApplicationShared";
import type { CustomerRow, RequestAuditMetadata } from "./customerApplicationShared";

function canonicalQuoteSettlement(
  quote: WebsiteQuoteRecord,
  offer: PublicContractOffer,
): WebsiteSettlement {
  const parsed = WebsiteQuoteSettlementSchema.safeParse(quote.quote_snapshot?.settlement)
  if (parsed.success) return parsed.data
  const pricingInterval = typeof quote.quote_snapshot?.pricing_interval === 'string'
    ? quote.quote_snapshot.pricing_interval
    : null
  return websiteSettlementForContract({
    contractType: offer.contract_type,
    pricingInterval,
  })
}

function sameSettlement(left: WebsiteSettlement, right: WebsiteSettlement): boolean {
  return left.model === right.model
    && left.customer_accepts === right.customer_accepts
    && left.energy_price_locked_at_signup === right.energy_price_locked_at_signup
    && left.uses_actual_metered_consumption === right.uses_actual_metered_consumption
    && left.market_data_role === right.market_data_role
    && left.settlement_resolution === right.settlement_resolution
}

export async function processWebsiteCustomerApplication(input: {
  client: IntegrationApiClient;
  rawBody: unknown;
  idempotencyKey?: string | null;
  requestAudit?: RequestAuditMetadata;
  portalIdentitySubmissionMode?: "pre_auth_required" | "post_auth_allowed";
}) {
  const portalIdentitySubmissionMode =
    input.portalIdentitySubmissionMode === "post_auth_allowed"
      ? "post_auth_allowed"
      : "pre_auth_required";
  const idempotencyKey = input.idempotencyKey?.trim() ?? null;
  const idempotencyValidation = validateIdempotencyKey(idempotencyKey);
  if (idempotencyValidation) return failureResponse(idempotencyValidation);

  const nestedFieldValidation = validateNestedPayloadFields(input.rawBody);
  if (nestedFieldValidation) return failureResponse(nestedFieldValidation);
  const referencePlacementValidation = validateCanonicalApplicationReferencePlacement(input.rawBody);
  if (referencePlacementValidation) return failureResponse(referencePlacementValidation);

  const normalizedRaw = normalizeRawApplication(input.rawBody);
  const startModeValidation = validateRequestedStartMode(normalizedRaw);
  if (startModeValidation) return failureResponse(startModeValidation);
  const dateValidation = validateApplicationDates(normalizedRaw);
  if (dateValidation) return failureResponse(dateValidation);

  // Reject unmappable customer types with a precise code instead of a generic
  // Zod validation error. Empty values default to 'private' in normalization.
  const normalizedCustomerType = (
    normalizedRaw.customer as Record<string, unknown> | undefined
  )?.customer_type;
  if (
    typeof normalizedCustomerType === "string" &&
    !["private", "business"].includes(normalizedCustomerType)
  ) {
    return failureResponse(
      new WebsiteApplicationError({
        message: `Kundtypen "${normalizedCustomerType}" stöds inte. Använd private eller business.`,
        status: 400,
        code: "customer_type_invalid",
        field: "customer.customer_type",
        stage: "validation",
        hint: "Skicka customer.customer_type som private eller business. company accepteras tillfälligt som deprecated alias för business.",
      }),
    );
  }

  const parsed = ApplicationSchema.safeParse(normalizedRaw);
  if (!parsed.success) {
    return failureResponse(
      new WebsiteApplicationError({
        message: "Ogiltig kundansökan.",
        status: 422,
        code: "validation_error",
        stage: "validation",
        details: parsed.error.issues.map(
          (issue: { path: Array<string | number>; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          }),
        ),
      }),
    );
  }

  let body = parsed.data;
  if (!body.price_option_reference) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "price_option_reference krävs och måste vara samma stabila referens som i den accepterade quoten.",
        status: 422,
        code: "price_option_reference_required",
        field: "price_option_reference",
        stage: "validation",
      }),
    );
  }
  if (!body.invoice_delivery_method) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "invoice_delivery_method krävs och måste vara samma val som i den accepterade quoten.",
        status: 422,
        code: "invoice_delivery_method_required",
        field: "invoice_delivery_method",
        stage: "validation",
      }),
    );
  }
  if (!Array.isArray(body.selected_component_references)) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "selected_component_references krävs som en array, även när inga valfria komponenter har valts.",
        status: 422,
        code: "selected_component_references_required",
        field: "selected_component_references",
        stage: "validation",
      }),
    );
  }
  if (!body.site_count) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "site_count krävs och måste vara ett heltal större än noll.",
        status: 422,
        code: "site_count_required",
        field: "site_count",
        stage: "validation",
      }),
    );
  }
  const authUserId = clean(body.auth_user_id);
  const customerPortalUserId = clean(body.customer_portal_user_id);
  const hasAuthUserId = Boolean(authUserId);
  const hasCustomerPortalUserId = Boolean(customerPortalUserId);

  if (hasAuthUserId !== hasCustomerPortalUserId) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "auth_user_id och customer_portal_user_id måste skickas tillsammans eller utelämnas tillsammans.",
        status: 422,
        code: "portal_auth_identity_mismatch",
        field: "customer_portal_user_id",
        stage: "validation",
        hint:
          "Skicka båda från samma verifierade serversession, eller utelämna båda när tenantens checkout tillåter post-auth onboarding.",
      }),
    );
  }

  if (
    !authUserId &&
    !customerPortalUserId &&
    portalIdentitySubmissionMode === "pre_auth_required"
  ) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "Tenantens checkout-policy kräver verifierad portalidentitet före kundansökan.",
        status: 422,
        code: "portal_auth_identity_required",
        field: "customer_portal_user_id",
        stage: "validation",
        hint:
          "Skicka auth_user_id och customer_portal_user_id från samma verifierade serversession, eller aktivera post_auth_allowed för tenantens checkout-policy.",
      }),
    );
  }

  if (
    authUserId &&
    customerPortalUserId &&
    (authUserId !== customerPortalUserId ||
      !isUuid(authUserId) ||
      !isUuid(customerPortalUserId))
  ) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "auth_user_id och customer_portal_user_id måste vara samma giltiga UUID från den verifierade serversessionen.",
        status: 422,
        code: "portal_auth_identity_mismatch",
        field: "customer_portal_user_id",
        stage: "validation",
      }),
    );
  }
  const normalizedRequestedStartMode =
    (
      clean(body.requested_start_mode) ??
      clean(body.requestedStartMode) ??
      clean(body.contract?.requested_start_mode) ??
      clean(body.contract?.requestedStartMode)
    )?.toLowerCase() ?? null;
  if (normalizedRequestedStartMode) {
    body = {
      ...body,
      requested_start_mode: normalizedRequestedStartMode,
      contract: body.contract
        ? {
            ...body.contract,
            requested_start_mode: normalizedRequestedStartMode,
          }
        : body.contract,
    };
  }

  // A structured powerOfAttorney.accepted=true satisfies the POA legal consent so
  // the existing legal-acceptance gate and POA persistence run unchanged.
  const structuredPoa = normalizeStructuredPoa(body);
  // If a structured powerOfAttorney object is supplied it must be accepted.
  // (Legacy callers may instead send consents.power_of_attorney=true without the
  // structured object — that remains valid and is not affected here.)
  if (structuredPoa && structuredPoa.accepted !== true) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "powerOfAttorney.accepted måste vara true när en strukturerad fullmakt skickas med.",
        status: 422,
        code: "power_of_attorney_not_accepted",
        field: "powerOfAttorney.accepted",
        stage: "power_of_attorney",
        hint: "Sätt powerOfAttorney.accepted=true när kunden har godkänt fullmakten, annars utelämna powerOfAttorney-objektet.",
      }),
    );
  }
  const structuredPoaValidation =
    validateStructuredPoaForExternalSendability(structuredPoa);
  if (structuredPoaValidation) return failureResponse(structuredPoaValidation);
  if (structuredPoa?.accepted) {
    body = {
      ...body,
      consents: { ...(body.consents ?? {}), power_of_attorney: true },
    };
  }
  const payloadHash = applicationPayloadHash(body);

  const externalCustomerId =
    clean(body.external_customer_id) ??
    clean(body.customer_external_id) ??
    clean(body.external_customer_reference) ??
    clean(body.customer_reference);
  if (!externalCustomerId) {
    return failureResponse(
      validationError(
        "external_customer_id eller external_customer_reference krävs.",
        "external_customer_id",
        "Skicka tenantens stabila kundreferens som external_customer_id eller external_customer_reference.",
      ),
    );
  }
  if (!normalizedEmail(body.customer.email)) {
    return failureResponse(
      validationError(
        "customer.email krävs.",
        "customer.email",
        "Skicka email under customer.email eller som top-level email.",
      ),
    );
  }
  const businessKeyHash = applicationBusinessKeyHash(body, externalCustomerId);

  let readiness = assessWebsiteApplicationReadiness(body);
  let customerResult: {
    customer: CustomerRow;
    created: boolean;
    customerNumberAssigned: boolean;
  } | null = null;
  let site: { id: string; facility_id: string | null } | null = null;
  let meteringPoint: { id: string; metering_point_id: string | null } | null =
    null;
  let contract: WebsiteContractCreateResult | null = null;
  let publicOffer: PublicContractOffer | null = null;
  let websiteQuote: WebsiteQuoteRecord | null = null;
  let legalAcceptanceVersions: WebsiteLegalAcceptanceVersion[] = [];
  let applicationNumber: string | null = null;
  let existingIdentity: Awaited<ReturnType<typeof loadExistingIdentity>> = null;
  let canonicalPowerOfAttorneyId: string | null = null;
  const agreementAcceptedAt = new Date().toISOString();
  // Once the application row exists, any later failure (e.g. power of attorney)
  // must UPDATE this row to failed/partial — never INSERT a second row, which
  // would collide on the unique (company_id, idempotency_key) index and leave a
  // misleading success row behind.
  let applicationRowId: string | null = null;
  // Legal agreement confirmation eligibility is independent from facility and
  // supplier-switch readiness. It becomes true only after the server has
  // finalized the exact offer-bound legal acceptances.
  let agreementConfirmationEligible = false;

  try {
    const existingIdempotent = await stage("idempotency", () =>
      loadIdempotentApplication(input.client.company_id, idempotencyKey),
    );
    let releasedFailedIdempotencyForRetry = false;
    if (existingIdempotent) {
      const existingPayloadHash =
        storedApplicationPayloadHash(existingIdempotent);
      if (existingPayloadHash && existingPayloadHash !== payloadHash) {
        return failureResponse(
          idempotencyPayloadMismatchError(existingIdempotent, payloadHash),
        );
      }
      if (isFailedIdempotentApplication(existingIdempotent, body)) {
        applicationRowId = existingIdempotent.id;
        const resumed = await stage("application_workflow", () =>
          resumeCommittedIdempotentApplication({
            client: input.client,
            existing: existingIdempotent,
            body,
            externalCustomerId,
          }),
        );
        if (resumed) return successResponse(resumed, existingIdempotent.warnings ?? []);
      }
      if (existingIdempotent.status === "processing") {
        return failureResponse(
          new WebsiteApplicationError({
            message: "En ansökan med samma Idempotency-Key behandlas redan.",
            status: 409,
            code: "idempotency_in_progress",
            field: "Idempotency-Key",
            stage: "idempotency",
            hint: "Gör retry med samma nyckel efter att den pågående requesten har slutförts.",
            details: { application_id: existingIdempotent.id },
          }),
        );
      }
      if (isFailedIdempotentApplication(existingIdempotent, body)) {
        if (
          input.idempotencyKey &&
          isRetryableFailedSiteProvisioningApplication(
            existingIdempotent,
            externalCustomerId,
          )
        ) {
          await stage("idempotency", () =>
            releaseRetryableFailedIdempotency({
              companyId: input.client.company_id,
              existing: existingIdempotent,
              idempotencyKey: input.idempotencyKey as string,
            }),
          );
          console.warn(
            "[website-applications] released failed site_create idempotency for retry",
            {
              application_id: existingIdempotent.id,
              company_id: input.client.company_id,
            },
          );
          releasedFailedIdempotencyForRetry = true;
        } else {
          const incomplete =
            expectsSiteOrMetering(body) &&
            !hasCompleteSiteAndMetering(existingIdempotent);
          return idempotentFailure(
            existingIdempotent,
            externalCustomerId,
            incomplete ? "incomplete_application" : undefined,
          );
        }
      }

      if (!releasedFailedIdempotencyForRetry) {
        // The previous application for this Idempotency-Key was treated as a
        // success, but it produced no power of attorney. If the retry now carries
        // an accepted structured powerOfAttorney, repair the existing application
        // inline and return success instead of forcing the website/customer into a
        // 409 loop. Admin repair remains a fallback only when the incoming retry
        // still lacks the legal data needed to create the POA.
        const previousHasPoa = Boolean(
          existingIdempotent.response_payload?.power_of_attorney_id,
        );
        if (!previousHasPoa && structuredPoa?.accepted === true) {
          const repaired = await stage("power_of_attorney", () =>
            repairMissingPoaOnIdempotentApplication({
              client: input.client,
              existingApplication: existingIdempotent,
              body,
              rawBody: input.rawBody,
              structuredPoa,
              externalCustomerId,
              requestAudit: input.requestAudit,
            }),
          );
          if (repaired?.ok) {
            return successResponse(repaired.data, repaired.warnings);
          }
          return failureResponse(
            new WebsiteApplicationError({
              message:
                repaired?.message ??
                "Fullmakten kunde inte skapas på den befintliga ansökan.",
              status: 409,
              code: repaired?.code ?? "idempotent_application_missing_poa",
              field: "powerOfAttorney",
              stage: "power_of_attorney",
              action: "retry_with_new_idempotency_key_or_repair",
              hint: "Kontrollera att payloaden innehåller komplett powerOfAttorney med textVersionId från OPS publicerade juridik och kör sedan retry/admin-repair.",
              details: {
                application_id: existingIdempotent.id,
                external_customer_id:
                  existingIdempotent.external_customer_id ?? externalCustomerId,
                action: "retry_with_new_idempotency_key_or_repair",
              },
            }),
          );
        }

        return successResponse(
          {
            ...(existingIdempotent.response_payload ?? {}),
            idempotent: true,
            application_id: existingIdempotent.id,
            customer_id:
              existingIdempotent.customer_id ??
              (existingIdempotent.response_payload?.customer_id as
                string | undefined) ??
              null,
            customer_number:
              existingIdempotent.customer_number ??
              (existingIdempotent.response_payload?.customer_number as
                string | undefined) ??
              null,
            external_customer_id:
              existingIdempotent.external_customer_id ?? externalCustomerId,
            status: existingIdempotent.status,
          },
          existingIdempotent.warnings ?? [],
        );
      }
    }

    const equivalentCommittedApplication = await stage("idempotency", () =>
      loadEquivalentCommittedApplication({
        companyId: input.client.company_id,
        externalCustomerId,
        payloadHash,
        idempotencyKey: idempotencyKey as string,
      }),
    );
    if (equivalentCommittedApplication) {
      return failureResponse(
        duplicateApplicationError(equivalentCommittedApplication),
      );
    }

    if (businessKeyHash) {
      const conflictingBusinessApplication = await stage("idempotency", () =>
        loadConflictingBusinessApplication({
          companyId: input.client.company_id,
          externalCustomerId,
          businessKeyHash,
          idempotencyKey: idempotencyKey as string,
        }),
      );
      if (conflictingBusinessApplication) {
        return failureResponse(
          applicationBusinessConflictError(conflictingBusinessApplication),
        );
      }
    }

    const reservation = await stage("idempotency", () =>
      reserveWebsiteApplicationIdempotency({
        client: input.client,
        externalCustomerId,
        idempotencyKey: idempotencyKey as string,
        payloadHash,
        businessKeyHash,
        payload: body,
        rawPayload: input.rawBody,
      }),
    );
    if ("businessConflict" in reservation) {
      return failureResponse(
        applicationBusinessConflictError(reservation.businessConflict),
      );
    }
    if (!reservation.acquired) {
      const winnerPayloadHash = storedApplicationPayloadHash(
        reservation.application,
      );
      if (winnerPayloadHash && winnerPayloadHash !== payloadHash) {
        return failureResponse(
          idempotencyPayloadMismatchError(reservation.application, payloadHash),
        );
      }
      if (reservation.application.status === "processing") {
        return failureResponse(
          new WebsiteApplicationError({
            message: "En ansökan med samma Idempotency-Key behandlas redan.",
            status: 409,
            code: "idempotency_in_progress",
            field: "Idempotency-Key",
            stage: "idempotency",
            details: { application_id: reservation.application.id },
          }),
        );
      }
      if (isFailedIdempotentApplication(reservation.application, body)) {
        return idempotentFailure(reservation.application, externalCustomerId);
      }
      return successResponse(
        {
          ...(reservation.application.response_payload ?? {}),
          idempotent: true,
          application_id: reservation.application.id,
          customer_id: reservation.application.customer_id ?? null,
          customer_number: reservation.application.customer_number ?? null,
          external_customer_id:
            reservation.application.external_customer_id ?? externalCustomerId,
          status: reservation.application.status,
        },
        reservation.application.warnings ?? [],
      );
    }
    applicationRowId = reservation.application.id;

    existingIdentity = await stage("customer_lookup", () =>
      loadExistingIdentity(
        input.client.company_id,
        externalCustomerId,
        body.customer,
      ),
    );

    const selectedOfferReference =
      clean(body.offer_reference) ??
      clean(body.offerReference) ??
      clean(body.contract?.offer_reference) ??
      clean(body.contract?.offerReference);
    const selectedQuoteReference =
      clean(body.quote_reference) ??
      clean(body.quoteReference) ??
      clean(body.contract?.quote_reference) ??
      clean(body.contract?.quoteReference);
    const selectedPricePlanVersionId =
      clean(body.price_plan_version_id) ??
      clean(body.contract?.price_plan_version_id);
    const selectedPricePlanId =
      clean(body.price_plan_id) ?? clean(body.contract?.price_plan_id);
    const selectedContractOfferId =
      clean(body.contract_offer_id) ?? clean(body.contract?.contract_offer_id);
    const selectedProductCode =
      clean(body.product_code) ?? clean(body.contract?.product_code);
    const hasLegacyOfferSelector = Boolean(
      selectedPricePlanVersionId ||
      selectedPricePlanId ||
      selectedContractOfferId ||
      selectedProductCode,
    );
    if (!selectedOfferReference) {
      throw new WebsiteApplicationError({
        message: hasLegacyOfferSelector
          ? "Kundansökan använder en äldre avtalsidentifierare. Endast offer_reference från public-contracts får användas vid tecknande."
          : "Kundansökan måste referera till ett publicerat avtal från OPS.",
        status: 422,
        code: hasLegacyOfferSelector
          ? "offer_reference_required"
          : "public_contract_required",
        field: "offer_reference",
        stage: "public_contract_lookup",
        hint: "Hämta avtal via GET /api/v1/website/public-contracts och skicka exakt offer_reference från svaret. product_code, price_plan_id och interna UUID:n väljer inte längre juridiskt avtal.",
      });
    }

    publicOffer = await stage("public_contract_lookup", () =>
      resolvePublicContractOffer({
        client: input.client,
        offerReference: selectedOfferReference,
        customerType: body.customer.customer_type,
      }),
    );

    if (!publicOffer) {
      throw new WebsiteApplicationError({
        message:
          "Valt avtal är inte publicerat eller tillhör inte denna tenant.",
        status: 422,
        code: "public_contract_not_available",
        field: "offer_reference",
        stage: "public_contract_lookup",
        hint: "Hemsidan ska hämta avtal via GET /api/v1/website/public-contracts och skicka offer_reference från svaret.",
      });
    }

    // offer_reference is the only selector. Legacy fields may still be present
    // during rollout, but a conflicting value must never silently select or
    // describe another commercial agreement.
    const selectorMismatches = [
      selectedPricePlanVersionId &&
      selectedPricePlanVersionId !== publicOffer.price_plan_version_id
        ? "price_plan_version_id"
        : null,
      selectedPricePlanId && selectedPricePlanId !== publicOffer.price_plan_id
        ? "price_plan_id"
        : null,
      selectedProductCode && selectedProductCode !== publicOffer.product_code
        ? "product_code"
        : null,
      selectedContractOfferId &&
      ![publicOffer.id, selectedOfferReference].includes(
        selectedContractOfferId,
      )
        ? "contract_offer_id"
        : null,
    ].filter((value): value is string => Boolean(value));
    if (selectorMismatches.length > 0) {
      throw new WebsiteApplicationError({
        message:
          "Kundansökan innehåller avtalsfält som motsäger valt offer_reference.",
        status: 422,
        code: "offer_reference_mismatch",
        field: selectorMismatches[0],
        stage: "public_contract_lookup",
        hint: "Ta bort äldre avtalsidentifierare från POST-payloaden och använd uppgifterna som returneras för samma offer_reference.",
        details: { mismatched_fields: selectorMismatches, legacy_code: "offer_selector_mismatch" },
      });
    }

    if (publicOffer) {
      const selectedPublicOffer = publicOffer;
      legalAcceptanceVersions = await stage("legal_acceptance", () =>
        assertWebsiteLegalAcceptances({
          companyId: input.client.company_id,
          consents: body.consents,
          legalBundleVersion: clean(body.legal_bundle_version),
          legalAcceptances: body.legal_acceptances ?? body.legalAcceptances,
          publicOffer: selectedPublicOffer,
        }),
      );
      // The resolved public offer is the price-plan source of truth:
      // offer_reference -> price_plan_id UUID -> price_plan_version_id UUID.
      // Merge the resolved UUIDs into the application body BEFORE readiness is
      // assessed, so a valid offer never produces price_plan blockers or the
      // price_plan_id_not_verified_uuid warning.
      body = {
        ...body,
        price_plan_id: selectedPublicOffer.price_plan_id ?? body.price_plan_id,
        price_plan_version_id:
          selectedPublicOffer.price_plan_version_id ??
          body.price_plan_version_id,
        contract: body.contract
          ? {
              ...body.contract,
              price_plan_id:
                selectedPublicOffer.price_plan_id ??
                body.contract.price_plan_id,
              price_plan_version_id:
                selectedPublicOffer.price_plan_version_id ??
                body.contract.price_plan_version_id,
            }
          : body.contract,
      };
    }

    // When the resolved public contract publishes a power_of_attorney legal
    // version, fullmakt is required (legal.power_of_attorney_required = true).
    // A structured powerOfAttorney object accepted by the customer is then
    // mandatory — consents.power_of_attorney=true alone is not enough, because a
    // bare boolean can never carry the signer identity needed for external
    // grid-owner communication.
    const powerOfAttorneyRequired = legalAcceptanceVersions.some(
      (version) => version.type === "power_of_attorney",
    );
    if (powerOfAttorneyRequired && structuredPoa?.accepted !== true) {
      throw new WebsiteApplicationError({
        message:
          "Det valda avtalet kräver fullmakt. Skicka ett strukturerat powerOfAttorney-objekt med accepted=true.",
        status: 422,
        code: "power_of_attorney_missing",
        field: "powerOfAttorney",
        stage: "power_of_attorney",
        hint: "consents.power_of_attorney=true räcker inte. Skicka powerOfAttorney med accepted, signerName, signerIdentityNumber, method och exakt scope.",
      });
    }

    applicationNumber = await stage("application_record_create", () =>
      reserveApplicationNumber(input.client.company_id),
    );

    const energyResolution = await stage("energy_resolution", () =>
      runEnergyResolution({
        client: input.client,
        companyId: input.client.company_id,
        customerId: existingIdentity?.customer_id ?? null,
        customerSiteId: null,
        body,
      }),
    );
    body = energyResolution.body;
    readiness = assessWebsiteApplicationReadiness(body);
    if (publicOffer) {
      const allowedAreas = new Set(
        (publicOffer.price_areas ?? []).map((area) => area.toUpperCase()),
      );
      if (
        !readiness.priceArea ||
        !allowedAreas.has(readiness.priceArea.toUpperCase())
      ) {
        throw new WebsiteApplicationError({
          message: readiness.priceArea
            ? `Det valda avtalet gäller inte i prisområde ${readiness.priceArea}.`
            : "Prisområde måste vara verifierat innan avtalet kan tecknas.",
          status: 422,
          code: "public_contract_price_area_not_available",
          field: "site.priceAreaCode",
          stage: "energy_resolution",
          hint: "Välj ett publicerat avtal vars price_areas innehåller kundens verifierade prisområde.",
          details: {
            verified_price_area: readiness.priceArea,
            allowed_price_areas: [...allowedAreas],
            offer_reference: selectedOfferReference,
          },
        });
      }
    }

    if (selectedQuoteReference) {
      try {
        websiteQuote = await validateWebsiteQuote({
          client: input.client,
          quoteReference: selectedQuoteReference,
          offerReference: selectedOfferReference,
          publicOffer: publicOffer as PublicContractOffer,
          customerType: body.customer.customer_type,
          priceArea: readiness.priceArea,
          resolutionId: energyResolution.resolution.resolutionId ?? null,
          gridAreaCode: readiness.gridAreaCode,
          postalCode: clean(body.site?.postal_code),
          annualConsumptionKwh: requestedAnnualConsumption(body),
          startDate: readiness.requestedStartDate,
          priceOptionReference: body.price_option_reference,
          invoiceDeliveryMethod: body.invoice_delivery_method,
          selectedComponentReferences: body.selected_component_references,
          siteCount: body.site_count,
          applicationId: applicationRowId,
        });
        const expectedSettlement = canonicalQuoteSettlement(
          websiteQuote,
          publicOffer as PublicContractOffer,
        );
        if (!sameSettlement(body.settlement, expectedSettlement)) {
          throw new WebsiteApplicationError({
            message: 'settlement motsäger den accepterade canonical quoten.',
            status: 409,
            code: 'quote_settlement_mismatch',
            field: 'settlement',
            stage: 'quote_validation',
            hint: 'Skicka settlement exakt som den returnerades av samma quote_reference.',
            details: {
              expected_settlement: expectedSettlement,
              received_settlement: body.settlement,
              quote_reference: selectedQuoteReference,
            },
          });
        }
      } catch (error) {
        if (error instanceof WebsiteQuoteValidationError) {
          throw new WebsiteApplicationError({
            message: error.message,
            status: error.status,
            code: error.code,
            field: error.field,
            stage: "quote_validation",
            details: error.details,
            hint: "Skapa en ny quote från samma offer_reference, kundtyp, SE-område, förbrukning och startdatum och gör sedan retry med samma Idempotency-Key.",
          });
        }
        throw error;
      }
    } else {
      throw new WebsiteApplicationError({
        message: "quote_reference saknas. Skapa och acceptera en canonical OPS-quote innan kundansökan skickas.",
        status: 422,
        code: "quote_reference_required",
        field: "quote_reference",
        stage: "quote_validation",
        hint: "Anropa quote-endpointen med samma resolution_id, offer_reference, kundtyp, förbrukning och startdatum och skicka sedan quote_reference i kundansökan.",
      });
    }

    const canonicalGraph = await stage("customer_create", () =>
      onboardCanonicalWebsiteCustomerGraph({
        client: input.client,
        body,
        rawBody: input.rawBody,
        existingCustomerId: existingIdentity?.customer_id ?? null,
        externalCustomerId,
        applicationRowId: applicationRowId as string,
        applicationNumber: applicationNumber as string,
        publicOffer: publicOffer as PublicContractOffer,
        offerReference: selectedOfferReference as string,
        websiteQuote,
        readiness,
        legalVersions: legalAcceptanceVersions,
        structuredPoa,
        agreementAcceptedAt,
        idempotencyKey: idempotencyKey as string,
        requestAudit: input.requestAudit,
      }),
    );
    customerResult = canonicalGraph.customerResult;
    const resolvedCustomerResult = canonicalGraph.customerResult;
    const customerNumber = resolvedCustomerResult.customer.customer_number as string;
    site = canonicalGraph.site;
    meteringPoint = canonicalGraph.meteringPoint;
    contract = canonicalGraph.contract;
    canonicalPowerOfAttorneyId = canonicalGraph.result.power_of_attorney_id;

    if (contract?.id) {
      await recordCanonicalEnergyEvent({
        eventType: "contract.created",
        companyId: input.client.company_id,
        customerId: resolvedCustomerResult.customer.id,
        siteId: site?.id ?? null,
        meteringPointId: meteringPoint?.id ?? null,
        resolutionId: energyResolution.resolution.resolutionId ?? null,
        quoteId: websiteQuote?.id ?? null,
        contractId: contract.id,
        source: "website_customer_application",
        actorType: "api_client",
        actorId: input.client.id,
        payload: {
          application_id: applicationRowId,
          customer_number: customerNumber,
          quote_reference: websiteQuote?.quote_reference ?? null,
          quote_hash: websiteQuote?.quote_hash ?? null,
          price_plan_version_id: contract.price_plan_version_id ?? null,
          contract_price_snapshot_id: contract.contract_price_snapshot_id ?? null,
        },
      });
      await recordCanonicalEnergyEvent({
        eventType: "billing_price_snapshot.created",
        companyId: input.client.company_id,
        customerId: resolvedCustomerResult.customer.id,
        siteId: site?.id ?? null,
        meteringPointId: meteringPoint?.id ?? null,
        resolutionId: energyResolution.resolution.resolutionId ?? null,
        quoteId: websiteQuote?.id ?? null,
        contractId: contract.id,
        source: "website_customer_application",
        actorType: "api_client",
        actorId: input.client.id,
        payload: {
          contract_price_snapshot_id: contract.contract_price_snapshot_id ?? null,
          quote_reference: websiteQuote?.quote_reference ?? null,
          price_area: readiness.priceArea,
          market_reference: websiteQuote?.market_reference ?? {},
        },
      });
    }

    if (meteringPoint?.id && energyResolution.resolution.resolutionId) {
      const contextPatch = await stage("metering_point_create", () =>
        patchMeteringPointEnergyContext({
          companyId: input.client.company_id,
          meteringPointId: meteringPoint!.id,
          resolution: energyResolution.resolution,
        }),
      );
      if (contextPatch.needsReview) {
        const contextConflictIssue = {
          field: "metering_point.energy_context",
          label: "Mätpunktens områdeskontext",
          severity: "blocking" as const,
          message: `Mätpunktens sparade områdesdata motsäger OPS-resolutionen: ${contextPatch.conflicts.join(", ")}.`,
          action: "Granska nätområde, nätägare och prisområde innan leverantörsbyte fortsätter.",
        };
        readiness = {
          ...readiness,
          status: "manual_review",
          blockingReasons: [...readiness.blockingReasons, contextConflictIssue],
          warnings: Array.from(new Set([...readiness.warnings, ...contextPatch.conflicts.map((field) => `metering_point_conflict:${field}`)])),
          nextStep: "Granska mätpunktens nätområde innan leverantörsbyte fortsätter.",
          canStartSwitch: false,
          canActivateCustomer: false,
        };
        if (contract?.id) {
          await supabaseService
            .from("customer_contracts")
            .update({
              resolution_status: "needs_review",
              updated_at: new Date().toISOString(),
            })
            .eq("company_id", input.client.company_id)
            .eq("id", contract.id);
        }
      }
    }

    const siteAddress = body.site;
    if (
      site?.id &&
      siteAddress?.street &&
      siteAddress.postal_code &&
      siteAddress.city
    ) {
      const siteId = site.id;
      const addressResult = await stage("site_create", () =>
        applyCustomerSiteAddressCandidate({
          companyId: input.client.company_id,
          customerId: resolvedCustomerResult.customer.id,
          siteId,
          address: {
            street: siteAddress.street,
            postalCode: siteAddress.postal_code,
            city: siteAddress.city,
            country: siteAddress.country ?? "SE",
            source: "website",
            sourceReference: input.idempotencyKey ?? null,
            claimedGridOwnerId:
              clean(siteAddress.grid_owner_id) ??
              clean(siteAddress.gridOwnerId),
            claimedGridAreaCode:
              clean(siteAddress.grid_area_code) ??
              clean(siteAddress.gridAreaCode),
            claimedPriceAreaCode:
              clean(siteAddress.price_area_code) ??
              clean(siteAddress.price_area),
            metadata: { application_source: clean(body.source) ?? "website" },
          },
        }),
      );
      // Do not start external automation here. Contract, immutable legal
      // acceptances and the application record must exist first. The address RPC
      // is allowed to mark address resolution as needs_review, but it must not
      // erase explicit website grid/price/move-in values. Patch canonical site
      // fields back after the atomic address write for older deployed RPCs.
      void addressResult;
      const currentSiteForCanonicalPatch = site as {
        id: string;
        facility_id?: string | null;
      };
      const canonicalPatchFacilityId =
        normalizeFacilityId(currentSiteForCanonicalPatch.facility_id) ??
        normalizeFacilityId(body.site?.facility_id);
      await stage("site_canonical_patch", () =>
        patchWebsiteSiteCanonicalFields(
          input.client.company_id,
          resolvedCustomerResult.customer.id,
          siteId,
          body,
          canonicalPatchFacilityId,
        ),
      );
    }

    await stage("customer_intake_update", () =>
      updateCustomerIntakeStatus(
        input.client.company_id,
        resolvedCustomerResult.customer.id,
        readiness,
      ),
    );

    const identity = await stage("portal_identity_create", () =>
      upsertPortalIdentity({
        client: input.client,
        customerId: resolvedCustomerResult.customer.id,
        externalCustomerId,
        externalAccountId:
          clean(body.external_account_id) ??
          clean(body.customer_portal_user_id) ??
          clean(body.auth_user_id),
        authUserId:
          clean(body.auth_user_id) ?? clean(body.customer_portal_user_id),
        customerPortalUserId:
          clean(body.customer_portal_user_id) ?? clean(body.auth_user_id),
        customerNumber,
        email: normalizedEmail(body.customer.email),
        applicationId: applicationRowId,
      }),
    );

    // Only the verified portal/auth UUID pair may create direct portal access.
    // external_account_id is a business reference, never authentication proof.
    const portalUserId =
      clean(body.customer_portal_user_id) ?? clean(body.auth_user_id);

    const portalLink = portalUserId
      ? await stage("portal_user_link", () =>
          ensureCustomerPortalUserLink({
            client: input.client,
            customerId: resolvedCustomerResult.customer.id,
            userId: portalUserId,
            email: normalizedEmail(body.customer.email),
            externalCustomerId,
            customerNumber,
            identityId: identity.id,
            matchMethod: "website_application_auth_user",
          }),
        )
      : null;

    if (portalUserId && (!portalLink?.accountId || !portalLink.identityId)) {
      throw new WebsiteApplicationError({
        message: "Kundens Mina sidor-koppling kunde inte verifieras efter att kundgrafen skapades.",
        status: 503,
        code: "customer_portal_link_not_ready",
        stage: "portal_user_link",
        details: { retryable: true },
        hint: "Kontrollera customer_portal_accounts, customer_portal_identities och kör om fortsättningssteget.",
      });
    }

    if (!portalUserId && portalIdentitySubmissionMode === "pre_auth_required") {
      throw new WebsiteApplicationError({
        message: "Portalidentiteten saknas trots tenantens pre-auth-policy.",
        status: 500,
        code: "portal_auth_identity_missing_after_validation",
        stage: "portal_user_link",
        details: { retryable: false },
      });
    }

    const effectivePortalIdentityId = portalLink?.identityId ?? identity.id;

    const applicationStatus = readiness.status;

    const responsePayload: Record<string, unknown> = {
      customer_id: resolvedCustomerResult.customer.id,
      customer_number: customerNumber,
      application_number: applicationNumber,
      external_customer_id: externalCustomerId,
      external_customer_reference: externalCustomerId,
      portal_identity_id: effectivePortalIdentityId,
      portal_identity_submission_mode: portalIdentitySubmissionMode,
      customer_portal_linked: Boolean(portalLink?.accountId && portalLink.identityId),
      customer_portal_link_pending: !portalLink,
      customer_site_id: site?.id ?? null,
      site_id: site?.id ?? null,
      metering_point_id: meteringPoint?.id ?? null,
      contract_id: contract?.id ?? null,
      contract_number: contract?.contract_number ?? null,
      offer_reference: publicOffer ? selectedOfferReference : null,
      quote_reference: websiteQuote?.quote_reference ?? null,
      quote_valid_until: websiteQuote?.valid_until ?? null,
      quote_bound: Boolean(websiteQuote),
      price_option_reference:
        websiteQuote?.price_option_reference ?? body.price_option_reference,
      area_price_reference: websiteQuote?.area_price_reference ?? null,
      invoice_delivery_method:
        websiteQuote?.invoice_delivery_method ?? body.invoice_delivery_method,
      selected_component_references:
        websiteQuote?.selected_component_references ??
        body.selected_component_references,
      mandatory_component_references:
        websiteQuote?.mandatory_component_references ?? [],
      conditional_component_references:
        websiteQuote?.conditional_component_references ?? [],
      site_count: websiteQuote?.site_count ?? body.site_count,
      energy_direction: publicOffer?.energy_direction ?? null,
      price_plan_id:
        contract?.price_plan_id ??
        publicOffer?.price_plan_id ??
        clean(body.price_plan_id) ??
        clean(body.contract?.price_plan_id) ??
        null,
      price_plan_version_id:
        contract?.price_plan_version_id ??
        publicOffer?.price_plan_version_id ??
        clean(body.price_plan_version_id) ??
        clean(body.contract?.price_plan_version_id) ??
        null,
      contract_price_snapshot_id: contract?.contract_price_snapshot_id ?? null,
      status: applicationStatus,
      created_customer: resolvedCustomerResult.created,
      missing_fields: readiness.missingFields,
      blocking_reasons: readiness.blockingReasons,
      next_step: readiness.nextStep,
      requested_start_date: readiness.requestedStartDate,
      confirmed_start_date: readiness.confirmedStartDate,
      actual_start_date: readiness.actualStartDate,
      requested_start_mode: readiness.requestedStartMode,
      calculated_earliest_start_date: readiness.calculatedEarliestStartDate,
      grid_area_code: readiness.gridAreaCode,
      price_area_code: readiness.priceArea,
      resolution_id: energyResolution.resolution.resolutionId ?? null,
      resolution_status: energyResolution.resolution.resolutionStatus,
      resolution_confidence: energyResolution.resolution.confidence,
      grid_owner_verification_status:
        energyResolution.resolution.gridOwnerVerificationStatus ?? null,
      grid_owner_verification_issues:
        energyResolution.resolution.gridOwnerVerificationIssues ?? [],
      energy_resolution: energyResolution.resolution,
      can_request_grid_owner_information:
        readiness.canRequestGridOwnerInformation,
      can_start_switch: readiness.canStartSwitch,
      can_send_agreement_confirmation: readiness.canSendAgreementConfirmation,
      can_activate_customer: readiness.canActivateCustomer,
    };

    const initialTimeline = [
      timelineEvent(
        "application_received",
        "Ansökan mottagen från extern hemsida",
        {
          source: clean(body.source) ?? "external_website",
          external_customer_id: externalCustomerId,
        },
      ),
      ...(readiness.missingFields.length > 0
        ? [
            timelineEvent("needs_information", "Ansökan behöver kompletteras", {
              missing_fields: readiness.missingFields,
            }),
          ]
        : [
            timelineEvent(
              "ready_for_switch",
              "Ansökan är redo för intern kontroll",
              { next_step: readiness.nextStep },
            ),
          ]),
    ];

    const application = await stage("application_record_create", () =>
      createApplicationRow({
        client: input.client,
        externalCustomerId,
        externalAccountId: clean(body.external_account_id),
        customer: resolvedCustomerResult.customer,
        customerSiteId: site?.id ?? null,
        meteringPointId: meteringPoint?.id ?? null,
        contractId: contract?.id ?? null,
        contractNumber: contract?.contract_number ?? null,
        applicationNumber,
        pricePlanId:
          contract?.price_plan_id ??
          publicOffer?.price_plan_id ??
          clean(body.price_plan_id) ??
          clean(body.contract?.price_plan_id) ??
          null,
        pricePlanVersionId:
          contract?.price_plan_version_id ??
          publicOffer?.price_plan_version_id ??
          clean(body.price_plan_version_id) ??
          clean(body.contract?.price_plan_version_id) ??
          null,
        contractPriceSnapshotId: contract?.contract_price_snapshot_id ?? null,
        publicContractOfferId: publicOffer?.id ?? null,
        contractProductId: publicOffer?.contract_product_id ?? null,
        contractProductVersionId:
          publicOffer?.contract_product_version_id ?? null,
        contractPublicationVersionId:
          publicOffer?.contract_publication_version_id ?? null,
        priceBookId: publicOffer?.price_book_id ?? null,
        legalBundleVersionId: publicOffer?.legal_bundle_version_id ?? null,
        energyDirection: publicOffer?.energy_direction ?? null,
        offerReference: selectedOfferReference,
        quoteReference:
          websiteQuote?.quote_reference ?? selectedQuoteReference ?? null,
        payload: body,
        rawPayload: input.rawBody,
        responsePayload,
        idempotencyKey,
        payloadHash,
        businessKeyHash,
        applicationId: applicationRowId,
        status: applicationStatus,
        warnings: readiness.warnings,
        missingFields: readiness.missingFields,
        blockingReasons: readiness.blockingReasons,
        nextStep: readiness.nextStep,
        requestedStartDate: readiness.requestedStartDate,
        confirmedStartDate: readiness.confirmedStartDate,
        actualStartDate: readiness.actualStartDate,
        requestedStartMode: readiness.requestedStartMode,
        calculatedEarliestStartDate: readiness.calculatedEarliestStartDate,
        resolutionId: energyResolution.resolution.resolutionId ?? null,
        gridAreaCode: readiness.gridAreaCode,
        gridOwnerId: energyResolution.resolution.gridOwnerId ?? null,
        priceAreaCode: readiness.priceArea,
        resolutionStatus: energyResolution.resolution.resolutionStatus,
        resolutionConfidence: energyResolution.resolution.confidence,
        timeline: initialTimeline,
        auditLog: [
          reviewAuditEvent("application_received", null, responsePayload),
        ],
      }),
    );
    applicationRowId = application.id;

    const email = normalizedEmail(body.customer.email);

    let legalAcceptanceIds: Record<string, string> = {};

    if (contract && publicOffer && selectedOfferReference) {
      const signatureResult = await stage("legal_acceptance", () =>
        finalizeWebsiteContractSignature({
          companyId: input.client.company_id,
          customerId: resolvedCustomerResult.customer.id,
          contract: contract as WebsiteContractCreateResult,
          applicationId: application.id,
          publicOffer: publicOffer as PublicContractOffer,
          offerReference: selectedOfferReference,
          acceptedAt: agreementAcceptedAt,
          legalVersions: legalAcceptanceVersions,
          consents: body.consents,
          rawPayload: input.rawBody,
          requestAudit: input.requestAudit,
        }),
      );
      contract = signatureResult.contract;
      legalAcceptanceIds = signatureResult.acceptanceIds;
      responsePayload.contract_status = contract.status;
      responsePayload.signed_at = contract.signed_at ?? agreementAcceptedAt;
      responsePayload.withdrawal_deadline_at =
        contract.withdrawal_deadline_at ?? null;
      responsePayload.signature_snapshot_sha256 =
        contract.signature_snapshot_sha256 ?? null;
      responsePayload.public_contract_offer_id = publicOffer.id;
      responsePayload.offer_reference = selectedOfferReference;
    } else {
      legalAcceptanceIds = await stage("legal_acceptance", () =>
        persistCustomerLegalAcceptances({
          companyId: input.client.company_id,
          customerId: resolvedCustomerResult.customer.id,
          contractId: contract?.id ?? null,
          applicationId: application.id,
          publicOffer,
          legalVersions: legalAcceptanceVersions,
          consents: body.consents,
          rawPayload: input.rawBody,
          requestAudit: input.requestAudit,
          acceptedAt: agreementAcceptedAt,
        }),
      );
    }
    if (Object.keys(legalAcceptanceIds).length > 0) {
      responsePayload.legal_acceptances = legalAcceptanceIds;
    }

    agreementConfirmationEligible = Boolean(
      email &&
      contract?.status === WEBSITE_APPLICATION_SIGNED_CONTRACT_STATUS &&
      contract?.signed_at &&
      publicOffer &&
      selectedOfferReference &&
      contractLegalMailEvidenceReady({
        acceptanceIds: legalAcceptanceIds,
        legalVersions: legalAcceptanceVersions,
      }),
    );
    // This field describes legal agreement-mail eligibility. It must not be
    // coupled to facility lookup, confirmed delivery date or switch readiness.
    responsePayload.can_send_agreement_confirmation =
      agreementConfirmationEligible;

    // External effects are intentionally deferred until after the durable
    // provisioning commit. The canonical continuation job created by the RPC
    // is the source of truth for mail, grid-owner, Ediel, switch and webhook
    // orchestration; the API request lifetime is never relied upon.

    // Collected here and merged into the final response warnings later, because
    // the main `warnings` array is assembled further down.
    const poaWarnings: string[] = [];
    // Only a complete structured powerOfAttorney accepted by the customer is
    // externally sendable. Legacy consents.power_of_attorney=true remains an
    // internal legal acceptance and must never inherit customer identity/name.
    const poaExternallySendable =
      structuredPoaIsExternallySendable(structuredPoa);
    const effectiveSignerMethod = structuredPoa?.method ?? null;

    const powerOfAttorneyId = canonicalPowerOfAttorneyId;

    if (powerOfAttorneyId) {
      // The POA legal version id used: the customer-supplied textVersionId when
      // provided (already validated to belong to this tenant and be a published
      // power_of_attorney version), otherwise the published POA version.
      const poaLegalVersionId =
        structuredPoa?.textVersionId ??
        legalAcceptanceVersions.find(
          (version) => version.type === "power_of_attorney",
        )?.id ??
        null;
      const tenantSlug = await loadCompanySlugById(input.client.company_id);
      const poaDocumentUrl =
        tenantSlug && poaLegalVersionId
          ? buildPublicLegalUrl(
              tenantSlug,
              "power_of_attorney",
              poaLegalVersionId,
            )
          : null;
      responsePayload.power_of_attorney_id = powerOfAttorneyId;
      responsePayload.power_of_attorney = {
        status: "signed",
        scope: structuredPoa?.scope ?? [],
        method: effectiveSignerMethod,
        externally_sendable: poaExternallySendable,
        // When the POA cannot be sent externally, fullmakt must be completed
        // (signer identity/name) before automated grid-owner communication.
        requires_completion: !poaExternallySendable,
        text_version_id: poaLegalVersionId,
        document_url: poaDocumentUrl,
      };
      if (!poaExternallySendable) {
        poaWarnings.push(
          "Fullmakten är registrerad som juridisk accept men är inte externt sändbar. Automatisk nätägarkommunikation kräver strukturerad powerOfAttorney med signerName, signerIdentityNumber och method.",
        );
      }
      const applicationUpdateResult = await supabaseService
        .from("website_customer_applications")
        .update({
          response_payload: {
            ...responsePayload,
            power_of_attorney_id: powerOfAttorneyId,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", application.id);

      if (
        applicationUpdateResult.error &&
        !missingSchema(applicationUpdateResult.error)
      )
        throw applicationUpdateResult.error;
    }

    // This is the durable commit point. No external grid-owner or Ediel automation
    // is allowed before all internal references, legal state and workflow metadata
    // are atomically verified in PostgreSQL.
    const workflow = await stage("application_workflow", () =>
      commitApplicationProvisioning({
        companyId: input.client.company_id,
        applicationId: application.id,
        customerId: resolvedCustomerResult.customer.id,
        siteId: site?.id ?? null,
        meteringPointId: meteringPoint?.id ?? null,
        contractId: contract?.id ?? null,
        powerOfAttorneyId,
        desiredState: readiness.canStartSwitch
          ? "ready_for_switch"
          : site?.id && powerOfAttorneyId
            ? "pending_customer_data"
            : "pending_review",
        snapshot: {
          application_status: applicationStatus,
          resolver_status: energyResolution.resolution.resolutionStatus,
          grid_area_code: readiness.gridAreaCode,
          grid_owner_id: energyResolution.resolution.gridOwnerId ?? null,
          resolution_id: energyResolution.resolution.resolutionId ?? null,
          price_area: readiness.priceArea,
          legal_acceptance_complete: Boolean(powerOfAttorneyId),
          facility_verified: readiness.facilityVerified,
          poa_externally_sendable: poaExternallySendable,
          external_customer_id: externalCustomerId,
          customer_number: customerNumber,
          raw_customer: body.customer,
          offer_reference: selectedOfferReference,
          public_offer_snapshot: publicOffer,
          legal_versions: legalAcceptanceVersions,
          legal_acceptance_ids: legalAcceptanceIds,
          agreement_confirmation_eligible: agreementConfirmationEligible,
          portal_identity_submission_mode: portalIdentitySubmissionMode,
          portal_identity_id: effectivePortalIdentityId,
          customer_portal_linked: Boolean(portalLink?.accountId && portalLink.identityId),
          requested_start_date:
            readiness.requestedStartDate ??
            contract?.starts_at ??
            clean(body.contract?.starts_at) ??
            clean(body.site?.move_in_date),
        },
      }),
    );

    if (workflow.continuationJobId) {
      const queuedWarnings = [...readiness.warnings, ...poaWarnings];
      const processingResponsePayload: Record<string, unknown> = {
        ...responsePayload,
        application_id: application.id,
        workflow_id: workflow.workflowId,
        workflow_state: "canonical_data_committed",
        continuation_job_id: workflow.continuationJobId,
        status: "accepted",
        next_step: "automatic_processing",
        next_action: {
          code: "automatic_processing",
          message:
            "Ansökan är mottagen och OPS fortsätter automatiskt med utskick, anläggningsuppgifter och leverantörsbyte.",
        },
        communication: {
          triggered: [],
          queued: [],
          sent: [],
          failed: [],
          pending: true,
          source_of_truth: "communication_logs",
        },
      };

      await stage("application_workflow_committed", () =>
        transitionCustomerApplicationWorkflow({
          companyId: input.client.company_id,
          applicationId: application.id,
          state: "canonical_data_committed",
          eventCode: "workflow.canonical_data_committed",
          idempotencyKey: `workflow.canonical_data_committed:${application.id}`,
          snapshotPatch: {
            next_action: "customer_application_continuation",
            continuation_job_id: workflow.continuationJobId,
            initial_readiness_state: workflow.state,
          },
        }),
      );

      const { error: processingUpdateError } = await supabaseService
        .from("website_customer_applications")
        .update({
          status: "processing",
          next_step: "automatic_processing",
          response_payload: processingResponsePayload,
          warnings: queuedWarnings,
          updated_at: new Date().toISOString(),
        })
        .eq("id", application.id)
        .eq("company_id", input.client.company_id);
      if (processingUpdateError) throw processingUpdateError;

      return successResponse(processingResponsePayload, queuedWarnings);
    }

    throw new WebsiteApplicationError({
      message:
        "Kundansökan är committad men fortsättningsjobbet saknas. Kör migrationen för canonical customer_application_continuation innan API-kanalen används.",
      status: 503,
      code: "customer_application_continuation_not_ready",
      stage: "application_workflow_committed",
      details: {
        application_id: application.id,
        workflow_id: workflow.workflowId,
        operation_id: workflow.operationId,
      },
    });
  } catch (error) {
    const appError =
      error instanceof WebsiteApplicationError
        ? error
        : new WebsiteApplicationError({
            message: errorMessage(error),
            status: 500,
            code: "internal_error",
            stage: "application_record_create",
          });

    const safeErrorMessage = operationalErrorMessage(appError);
    const controlledBusinessError = isControlledBusinessError(appError);
    const schemaStatus =
      schemaRepairStatus(error) ?? schemaRepairStatus(appError);
    // If the application row already exists, the failure happened mid-pipeline
    // (e.g. power of attorney) after customer/site/contract were provisioned —
    // that is a partial success, not a clean failure.
    const genericFailureStatus = applicationRowId ? "partial" : "failed";
    const businessStatus =
      schemaStatus ??
      (controlledBusinessError
        ? controlledBusinessStatus(appError)
        : genericFailureStatus);
    const businessNextStep = schemaStatus
      ? "Teknisk admin behöver köra senaste migration/schema-fix och sedan reparera eller retrya ansökan från admin."
      : controlledBusinessError
        ? controlledBusinessNextStep(appError)
        : "Tekniskt fel kräver åtgärd innan ansökan kan fortsätta.";
    const failedBlockingReasons = [
      ...readiness.blockingReasons,
      controlledBusinessError
        ? controlledBusinessBlockingReason(appError)
        : technicalBlockingReason(appError),
    ];
    const failedResponsePayload: Record<string, unknown> = {
      error: safeErrorMessage,
      code: appError.code,
      error_stage: appError.stage,
      status: businessStatus,
      // Never leave a stale/implied power of attorney on a failed application —
      // a partial provisioning that lost the fullmakt must read as null.
      power_of_attorney_id: null,
      missing_fields: readiness.missingFields,
      blocking_reasons: failedBlockingReasons,
      next_step: businessNextStep,
      requested_start_date: readiness.requestedStartDate,
      confirmed_start_date: readiness.confirmedStartDate,
      actual_start_date: readiness.actualStartDate,
      can_start_switch: false,
      can_send_agreement_confirmation: agreementConfirmationEligible,
      can_activate_customer: false,
    };
    // When the application row already exists (mid-pipeline failure), update it
    // in place. Re-inserting would violate the unique idempotency index and the
    // original row would otherwise remain in a misleading success state.
    const failedApplication = applicationRowId
      ? await markApplicationFailed({
          applicationId: applicationRowId,
          companyId: input.client.company_id,
          status: businessStatus,
          responsePayload: failedResponsePayload,
          errorStage: appError.stage,
          errorCode: appError.code,
          errorMessage: safeErrorMessage,
          missingFields: readiness.missingFields,
          blockingReasons: failedBlockingReasons,
          nextStep: businessNextStep,
          warnings: readiness.warnings,
        }).catch((failedUpdateError) => {
          console.warn(
            "[website-applications] failed to mark application failed",
            failedUpdateError,
          );
          return null;
        })
      : await createApplicationRow({
          client: input.client,
          externalCustomerId,
          externalAccountId: clean(body.external_account_id),
          customer: customerResult?.customer ?? null,
          customerSiteId: site?.id ?? null,
          meteringPointId: meteringPoint?.id ?? null,
          contractId: contract?.id ?? null,
          contractNumber: contract?.contract_number ?? null,
          applicationNumber,
          pricePlanId:
            contract?.price_plan_id ??
            publicOffer?.price_plan_id ??
            clean(body.price_plan_id) ??
            clean(body.contract?.price_plan_id) ??
            null,
          pricePlanVersionId:
            contract?.price_plan_version_id ??
            publicOffer?.price_plan_version_id ??
            clean(body.price_plan_version_id) ??
            clean(body.contract?.price_plan_version_id) ??
            null,
          contractPriceSnapshotId: contract?.contract_price_snapshot_id ?? null,
          publicContractOfferId: publicOffer?.id ?? null,
          contractProductId: publicOffer?.contract_product_id ?? null,
          contractProductVersionId:
            publicOffer?.contract_product_version_id ?? null,
          contractPublicationVersionId:
            publicOffer?.contract_publication_version_id ?? null,
          priceBookId: publicOffer?.price_book_id ?? null,
          legalBundleVersionId: publicOffer?.legal_bundle_version_id ?? null,
          energyDirection: publicOffer?.energy_direction ?? null,
          offerReference:
            (publicOffer ? publicOfferReference(publicOffer) : null) ??
            clean(body.offer_reference) ??
            clean(body.contract?.offer_reference) ??
            null,
          quoteReference:
            websiteQuote?.quote_reference ??
            clean(body.quote_reference) ??
            clean(body.contract?.quote_reference) ??
            null,
          payload: body,
          rawPayload: input.rawBody,
          responsePayload: {
            error: safeErrorMessage,
            code: appError.code,
            error_stage: appError.stage,
            status: businessStatus,
            power_of_attorney_id: null,
            missing_fields: readiness.missingFields,
            blocking_reasons: failedBlockingReasons,
            next_step: businessNextStep,
            requested_start_date: readiness.requestedStartDate,
            confirmed_start_date: readiness.confirmedStartDate,
            actual_start_date: readiness.actualStartDate,
            can_start_switch: false,
            can_send_agreement_confirmation: agreementConfirmationEligible,
            can_activate_customer: false,
          },
          idempotencyKey,
          payloadHash,
          businessKeyHash,
          status: businessStatus,
          errorStage: appError.stage,
          errorCode: appError.code,
          errorMessage: safeErrorMessage,
          missingFields: readiness.missingFields,
          blockingReasons: failedBlockingReasons,
          nextStep: businessNextStep,
          requestedStartDate: readiness.requestedStartDate,
          confirmedStartDate: readiness.confirmedStartDate,
          actualStartDate: readiness.actualStartDate,
          timeline: [
            timelineEvent(
              "application_received",
              "Ansökan mottagen från extern hemsida",
              {
                source: clean(body.source) ?? "external_website",
                external_customer_id: externalCustomerId,
              },
            ),
            timelineEvent(
              controlledBusinessError ? businessStatus : "failed",
              safeErrorMessage,
              {
                error_stage: appError.stage,
                error_code: appError.code,
                next_step: businessNextStep,
              },
            ),
          ],
          auditLog: [
            reviewAuditEvent("application_failed", null, {
              error_stage: appError.stage,
              error_code: appError.code,
              error_message: safeErrorMessage,
            }),
          ],
          warnings: readiness.warnings,
        }).catch((failedInsertError) => {
          console.warn(
            "[website-applications] failed to log failed application",
            failedInsertError,
          );
          return null;
        });

    // A contract and its price snapshot are created in one database RPC. If a
    // later exact-legal/signature step fails, never leave a misleading
    // pending_signature row that downstream automation could mistake for a
    // viable agreement. Historical evidence is retained and explicitly failed.
    if (
      contract?.id &&
      contract.status !== WEBSITE_APPLICATION_SIGNED_CONTRACT_STATUS
    ) {
      const { error: contractFailureError } = await supabaseService.rpc(
        "gridex_fail_website_contract_signature",
        {
          p_company_id: input.client.company_id,
          p_contract_id: contract.id,
          p_application_id: applicationRowId,
          p_error_code: appError.code,
          p_error_stage: appError.stage,
        },
      );
      if (contractFailureError) {
        console.warn(
          "[website-applications] failed to close pending signature contract",
          contractFailureError,
        );
      }
    }

    if (failedApplication?.id && customerResult?.customer?.id) {
      await failApplicationProvisioning({
        companyId: input.client.company_id,
        applicationId: failedApplication.id,
        code: appError.code,
        detail: errorMessage(appError),
      });
      await ensureCustomerApplicationWorkflow({
        companyId: input.client.company_id,
        applicationId: failedApplication.id,
        customerId: customerResult.customer.id,
        customerSiteId: site?.id ?? null,
        meteringPointId: meteringPoint?.id ?? null,
        contractId: contract?.id ?? null,
        state: "failed",
        snapshot: {
          error_stage: appError.stage,
          error_code: appError.code,
          error_message: safeErrorMessage,
        },
      })
        .then((workflow) =>
          transitionCustomerApplicationWorkflow({
            companyId: input.client.company_id,
            applicationId: failedApplication.id,
            state: "failed",
            failureCode: appError.code,
            failureDetailInternal: errorMessage(appError),
            snapshotPatch: { workflow_operation_id: workflow.operationId },
          }),
        )
        .catch((workflowError) => {
          console.warn(
            "[website-applications] failed to persist failed workflow state",
            workflowError,
          );
        });
    }

    if (controlledBusinessError && failedApplication?.id) {
      const mapped = mapFacilityBusinessError(
        controlledBusinessErrorCode(appError),
        { message: safeErrorMessage },
      );
      await recordFacilityDataIssue({
        companyId: input.client.company_id,
        customerId: customerResult?.customer?.id ?? null,
        customerSiteId: site?.id ?? null,
        meteringPointRowId: meteringPoint?.id ?? null,
        customerApplicationId: failedApplication.id,
        facilityId: site?.facility_id ?? clean(body.site?.facility_id),
        meteringPointId:
          meteringPoint?.metering_point_id ??
          clean(body.metering_point?.metering_point_id),
        gridAreaCode: readiness.gridAreaCode,
        priceArea: readiness.priceArea,
        source: "website_customer_application",
        sourceErrorCode: appError.code,
        sourceErrorText: safeErrorMessage,
        error: mapped,
        metadata: {
          external_customer_id: externalCustomerId,
          error_stage: appError.stage,
          details: appError.details ?? null,
        },
      }).catch((issueError) => {
        console.warn(
          "[website-applications] failed to record facility data issue",
          issueError,
        );
      });

      return successResponse(
        {
          application_id: failedApplication.id,
          status: businessStatus,
          error: safeErrorMessage,
          code: appError.code,
          error_stage: appError.stage,
          next_step: businessNextStep,
          can_start_switch: false,
          requires_new_readiness_check: true,
        },
        [...readiness.warnings, appError.code],
      );
    }

    return failureResponse(appError);
  }
}