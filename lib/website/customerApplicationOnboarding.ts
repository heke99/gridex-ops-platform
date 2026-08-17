// Internal module extracted from customerApplications.ts to keep handwritten production files bounded.
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth";
import { supabaseService } from "@/lib/supabase/service";
import { customerIntakeStatusForReadiness, type WebsiteApplicationReadiness } from "@/lib/website/applicationReview";
import { publicOfferReference, type PublicContractOffer } from "@/lib/website/publicContracts";
import { normalizeFacilityId } from "@/lib/energy/facilityDataErrors";
import { assertCanonicalSnapshot, buildCanonicalContractSnapshot } from "@/lib/pricing/contractSnapshot";
import { canonicalIdempotencyKey, onboardCustomerGraph } from "@/lib/customers/canonicalOnboarding";
import { createTenantContext } from "@/lib/tenant/context";
import { type WebsiteQuoteRecord } from "@/lib/pricing/websiteQuotes";
import { selectBaseComponentsForPriceArea } from "@/lib/pricing/fixedAreaPricing";
import { fullName, selectedOfferFields, websiteLegalVersionsSnapshot } from "./customerApplicationCommunication";
import type { WebsiteContractCreateResult } from "./customerApplicationCommunication";
import { explicitMeteringGridAreaCode, explicitMeteringGridOwnerId, explicitMeteringPriceAreaCode, requestedAnnualConsumption, requestedSiteMoveInDate, websiteSiteCanonicalFields } from "./customerApplicationCore";
import type { WebsiteLegalAcceptanceVersion } from "./customerApplicationLegal";
import type { ApplicationInput, NormalizedStructuredPoa } from "./customerApplicationSchemas";
import { WEBSITE_APPLICATION_CONTRACT_CHANNEL, WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE, WEBSITE_APPLICATION_READY_CONTRACT_STATUS, WebsiteApplicationError, clean, digits, isUuid, normalizedEmail, stage } from "./customerApplicationShared";
import type { CustomerRow, RequestAuditMetadata } from "./customerApplicationShared";

export async function onboardCanonicalWebsiteCustomerGraph(input: {
  client: IntegrationApiClient;
  body: ApplicationInput;
  rawBody: unknown;
  existingCustomerId?: string | null;
  externalCustomerId: string;
  applicationRowId: string;
  applicationNumber: string;
  publicOffer: PublicContractOffer;
  offerReference: string;
  websiteQuote: WebsiteQuoteRecord | null;
  readiness: WebsiteApplicationReadiness;
  legalVersions: WebsiteLegalAcceptanceVersion[];
  structuredPoa: NormalizedStructuredPoa | null;
  agreementAcceptedAt: string;
  idempotencyKey: string;
  requestAudit?: RequestAuditMetadata;
}) {
  const companyId = input.client.company_id;
  const customer = input.body.customer;
  const selectedQuoteOptionReference =
    input.websiteQuote?.price_option_reference ?? null;
  const selected = selectedOfferFields(
    input.publicOffer,
    input.body.contract,
    input.readiness.priceArea,
    selectedQuoteOptionReference,
  );
  if (
    selectedQuoteOptionReference &&
    selected.priceOptionReference !== selectedQuoteOptionReference
  ) {
    throw new WebsiteApplicationError({
      message: "Offertens prisalternativ finns inte i den låsta publiceringen.",
      status: 409,
      code: "quote_price_option_publication_mismatch",
      field: "quote_reference",
      stage: "contract_create",
    });
  }
  if (!isUuid(selected.pricePlanId) || !isUuid(selected.pricePlanVersionId)) {
    throw new WebsiteApplicationError({
      message: "Det publicerade avtalet saknar verifierad prisplanskoppling.",
      status: 422,
      code: "public_offer_price_plan_mapping_invalid",
      field: "offer_reference",
      stage: "contract_create",
      details: {
        price_plan_id: selected.pricePlanId,
        price_plan_version_id: selected.pricePlanVersionId,
      },
    });
  }

  if (input.existingCustomerId) {
    const existing = await supabaseService
      .from("customers")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", input.existingCustomerId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data?.id) {
      throw new WebsiteApplicationError({
        message: "Befintlig portalidentitet pekar på en kund som inte finns i aktuell tenant.",
        status: 409,
        code: "portal_identity_customer_invalid",
        stage: "customer_lookup",
      });
    }
  }

  const exactSignedScopes = input.structuredPoa?.accepted
    ? [...new Set(input.structuredPoa.scope.map((scope) => clean(scope)?.toLowerCase()).filter((scope): scope is string => Boolean(scope)))]
    : [];
  if (input.structuredPoa?.accepted && exactSignedScopes.length === 0) {
    throw new WebsiteApplicationError({
      message: "Signerad fullmakt saknar exakt scope och kan därför inte sparas.",
      status: 422,
      code: "power_of_attorney_scope_missing",
      field: "powerOfAttorney.scope",
      stage: "power_of_attorney",
    });
  }

  const compatibilitySnapshot = buildCanonicalContractSnapshot({
    contractType: selected.contractType,
    billingModel: selected.billingModel,
    productCode: selected.productCode,
    monthlyFeeSek: selected.monthlyFeeSek,
    invoiceFeeSek: selected.invoiceFeeSek,
    markupOrePerKwh: selected.markupOrePerKwh,
    spotMarkupOrePerKwh: selected.spotMarkupOrePerKwh,
    variableFeeOrePerKwh: selected.variableFeeOrePerKwh,
    fixedPriceOrePerKwh: selected.fixedPriceOrePerKwh,
    greenFeeMode: selected.greenFeeMode,
    greenFeeValue: selected.greenFeeValue,
    spotWeightPercent: input.publicOffer.spot_weight_percent ?? null,
    portfolioWeightPercent: input.publicOffer.portfolio_weight_percent ?? null,
    fixedWeightPercent: input.publicOffer.fixed_weight_percent ?? null,
    validFrom: input.readiness.requestedStartDate ?? input.publicOffer.valid_from ?? null,
    validTo: input.publicOffer.valid_to ?? null,
  });
  assertCanonicalSnapshot(compatibilitySnapshot);
  const exactPricing = input.publicOffer.pricing_snapshot ?? {};
  const quoteIsSelectionSnapshot =
    input.websiteQuote?.pricing_snapshot_schema_version ===
      "gridex_contract_pricing_v6_selection" ||
    input.websiteQuote?.quote_snapshot?.snapshot_schema ===
      "gridex_contract_pricing_v6_selection";
  if (
    quoteIsSelectionSnapshot &&
    (!input.websiteQuote?.price_option_reference ||
      !input.websiteQuote.invoice_delivery_method ||
      !Array.isArray(input.websiteQuote.resolved_base_components) ||
      !Array.isArray(input.websiteQuote.resolved_price_components) ||
      (selected.contractType === "fixed" &&
        !input.websiteQuote.area_price_reference))
  ) {
    throw new WebsiteApplicationError({
      message:
        "Offerten saknar exakt prisalternativ, områdesrad, faktureringssätt eller lösta komponenter.",
      status: 409,
      code: "quote_commercial_selection_incomplete",
      field: "quote_reference",
      stage: "contract_create",
    });
  }
  const selectedAreaBaseComponents = selectBaseComponentsForPriceArea(
    exactPricing,
    input.readiness.priceArea,
  );
  const frozenBaseComponents = quoteIsSelectionSnapshot
    ? input.websiteQuote!.resolved_base_components
    : selectedAreaBaseComponents.length > 0
      ? selectedAreaBaseComponents
      : compatibilitySnapshot.basePriceComponents;
  const exactCatalogPriceComponents = Array.isArray(
    exactPricing.price_components,
  )
    ? exactPricing.price_components
    : Array.isArray(exactPricing.price_components_snapshot)
      ? exactPricing.price_components_snapshot
      : null;
  const frozenPriceComponents = quoteIsSelectionSnapshot
    ? input.websiteQuote!.resolved_price_components
    : exactCatalogPriceComponents ?? compatibilitySnapshot.priceComponents;
  const quoteSnapshot = input.websiteQuote?.quote_snapshot ?? null;
  const legalSnapshot = websiteLegalVersionsSnapshot(input.legalVersions);
  const poaLegal = input.legalVersions.find((version) => version.type === "power_of_attorney") ?? null;
  const siteInput = input.body.site;
  const meterInput = input.body.metering_point;
  const normalizedFacilityId = normalizeFacilityId(siteInput?.facility_id);
  const canonicalMeteringPointId =
    clean(meterInput?.metering_point_id) ??
    clean(meterInput?.meter_point_id) ??
    clean(meterInput?.ediel_metering_point_id) ??
    clean(meterInput?.anlage_id) ??
    null;
  const requestedStartDate =
    input.readiness.requestedStartDate ??
    clean(input.body.contract?.requested_start_date) ??
    clean(input.body.contract?.starts_at) ??
    clean(siteInput?.move_in_date);
  const contractStatus = WEBSITE_APPLICATION_READY_CONTRACT_STATUS;
  const now = new Date().toISOString();

  const tenantContext = createTenantContext({
    companyId,
    actorType: "integration",
    actorId: input.client.id,
    scopes: input.client.scopes ?? [],
    sourceChannel: "public_website",
  });

  const result = await onboardCustomerGraph({
    company_id: companyId,
    channel: "website",
    idempotency_key: canonicalIdempotencyKey({
      channel: "website",
      companyId,
      sourceId: input.applicationRowId,
    }),
    matching_policy: input.existingCustomerId ? "link_selected" : "link_unique",
    existing_customer_id: input.existingCustomerId ?? null,
    update_existing: true,
    customer: {
      customer_type: customer.customer_type,
      status: "active",
      intake_status: customerIntakeStatusForReadiness(input.readiness),
      external_customer_id: input.externalCustomerId,
      first_name: clean(customer.first_name),
      last_name: clean(customer.last_name),
      full_name: fullName(customer),
      company_name: clean(customer.company_name),
      personal_number: digits(customer.personal_number),
      org_number: digits(customer.org_number),
      email: normalizedEmail(customer.email),
      phone: clean(customer.phone),
      invoice_email: normalizedEmail(customer.invoice_email) ?? normalizedEmail(customer.email),
      billing_street: clean(customer.billing_street),
      billing_postal_code: clean(customer.billing_postal_code),
      billing_city: clean(customer.billing_city),
      billing_country: clean(customer.billing_country) ?? "SE",
      source: "external_website",
      metadata: {
        source: "website_customer_applications",
        api_client_id: input.client.id,
        application_id: input.applicationRowId,
      },
    },
    contact: normalizedEmail(customer.email) || clean(customer.phone)
      ? {
          type: "primary",
          name: fullName(customer),
          email: normalizedEmail(customer.email),
          phone: clean(customer.phone),
          is_primary: true,
        }
      : null,
    address: clean(customer.billing_street) || clean(customer.billing_postal_code) || clean(customer.billing_city)
      ? {
          type: "billing",
          street_1: clean(customer.billing_street),
          postal_code: clean(customer.billing_postal_code),
          city: clean(customer.billing_city),
          country: clean(customer.billing_country) ?? "SE",
          is_active: true,
        }
      : null,
    site: input.readiness.canCreateSite && siteInput
      ? {
          ...websiteSiteCanonicalFields(input.body, { facilityId: normalizedFacilityId, status: "active" }),
          site_name: clean(siteInput.site_name) ?? "Anläggning",
          facility_id: normalizedFacilityId,
          site_type: selected.energyDirection,
          status: "active",
          street: clean(siteInput.street),
          postal_code: clean(siteInput.postal_code),
          city: clean(siteInput.city),
          country: clean(siteInput.country) ?? "SE",
          metadata: {
            source: "website_customer_applications",
            energy_resolution: input.body.metadata?.energy_resolution ?? null,
          },
        }
      : null,
    metering_point: input.readiness.canCreateMeteringPoint && canonicalMeteringPointId
      ? {
          meter_point_id: canonicalMeteringPointId,
          metering_point_id: canonicalMeteringPointId,
          ediel_metering_point_id: canonicalMeteringPointId,
          anlage_id: clean(meterInput?.anlage_id) ?? normalizedFacilityId,
          site_facility_id: clean(meterInput?.site_facility_id) ?? normalizedFacilityId,
          status: "active",
          metering_type: selected.energyDirection,
          measurement_type: clean(meterInput?.measurement_type) ?? selected.energyDirection,
          reading_frequency: clean(meterInput?.reading_frequency) ?? "monthly",
          grid_area_code: explicitMeteringGridAreaCode(input.body),
          price_area_code: explicitMeteringPriceAreaCode(input.body),
          bidding_zone_code: explicitMeteringPriceAreaCode(input.body),
          grid_owner_id: explicitMeteringGridOwnerId(input.body),
          start_date: clean(meterInput?.start_date) ?? clean(meterInput?.installation_date) ?? requestedSiteMoveInDate(input.body),
          installation_date: clean(meterInput?.installation_date) ?? clean(meterInput?.start_date) ?? requestedSiteMoveInDate(input.body),
          is_settlement_relevant: true,
          data_quality_status: "incomplete",
          verification_status: "pending",
          onboarding_status: "application_received",
          estimated_annual_consumption_kwh: requestedAnnualConsumption(input.body),
          metadata: { source: "website_customer_applications" },
        }
      : null,
    contract: {
      source_type: WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE,
      status: contractStatus,
      contract_name: selected.contractName,
      contract_type: selected.contractType,
      energy_direction: selected.energyDirection,
      contract_product_id: input.publicOffer.contract_product_id ?? null,
      contract_product_version_id: input.publicOffer.contract_product_version_id ?? null,
      contract_publication_version_id: input.publicOffer.contract_publication_version_id ?? null,
      price_book_id: input.publicOffer.price_book_id ?? null,
      legal_bundle_version_id: input.publicOffer.legal_bundle_version_id ?? null,
      price_plan_id: selected.pricePlanId,
      price_plan_version_id: selected.pricePlanVersionId,
      contract_offer_id: selected.internalContractOfferId,
      public_contract_offer_id: selected.publicContractOfferId,
      offer_reference: publicOfferReference(input.publicOffer),
      quote_reference: input.websiteQuote?.quote_reference ?? null,
      price_option_reference:
        input.websiteQuote?.price_option_reference ?? null,
      area_price_reference:
        input.websiteQuote?.area_price_reference ?? null,
      invoice_delivery_method:
        input.websiteQuote?.invoice_delivery_method ?? null,
      selected_component_references:
        input.websiteQuote?.selected_component_references ?? [],
      site_count: input.websiteQuote?.site_count ?? 1,
      legal_versions_snapshot: legalSnapshot,
      signature_snapshot: {},
      is_distance_agreement: true,
      starts_at: requestedStartDate,
      expected_start_at: requestedStartDate,
      requested_start_date: requestedStartDate,
      requested_start_mode: input.readiness.requestedStartMode,
      calculated_earliest_start_date: input.readiness.calculatedEarliestStartDate,
      price_area_used: input.readiness.priceArea,
      grid_area_code_used: input.readiness.gridAreaCode,
      resolution_status: input.readiness.resolutionStatus,
      // Browser supplied signed_at is deliberately ignored; the signing RPC sets server time.
      signed_at: null,
      monthly_fee_sek: selected.monthlyFeeSek,
      invoice_fee_sek: selected.invoiceFeeSek,
      markup_ore_per_kwh: selected.markupOrePerKwh,
      spot_markup_ore_per_kwh: selected.spotMarkupOrePerKwh,
      variable_fee_ore_per_kwh: selected.variableFeeOrePerKwh,
      fixed_price_ore_per_kwh: selected.fixedPriceOrePerKwh,
      green_fee_mode: selected.greenFeeMode,
      green_fee_value: selected.greenFeeValue,
      // Commercial terms are derived server-side from the exact published
      // price option bound to the immutable quote. Browser values are never
      // authoritative for signed contract lifecycle terms.
      binding_months: selected.bindingMonths,
      notice_months: selected.noticeMonths,
      auto_renew_enabled: selected.autoRenewEnabled,
      auto_renew_term_months: selected.autoRenewTermMonths,
      terms_version: selected.termsVersion,
      agreement_channel: WEBSITE_APPLICATION_CONTRACT_CHANNEL,
      metadata: {
        source: "website_customer_applications",
        website_application_id: input.applicationRowId,
        application_number: input.applicationNumber,
        offer_reference: input.offerReference,
        quote_reference: input.websiteQuote?.quote_reference ?? null,
        quote_hash: input.websiteQuote?.quote_hash ?? null,
        quote_valid_until: input.websiteQuote?.valid_until ?? null,
        energy_resolution_id: input.websiteQuote?.energy_resolution_id ?? null,
        resolver_version: input.websiteQuote?.resolver_version ?? null,
        geodata_version: input.websiteQuote?.geodata_version ?? null,
        market_reference: input.websiteQuote?.market_reference ?? {},
        selected_area_price_ore_per_kwh: selected.fixedPriceOrePerKwh,
        selected_price_area: input.readiness.priceArea,
        price_option_reference:
          input.websiteQuote?.price_option_reference ?? null,
        binding_months: selected.bindingMonths,
        notice_months: selected.noticeMonths,
        auto_renew_enabled: selected.autoRenewEnabled,
        auto_renew_term_months: selected.autoRenewTermMonths,
        area_price_reference:
          input.websiteQuote?.area_price_reference ?? null,
        invoice_delivery_method:
          input.websiteQuote?.invoice_delivery_method ?? null,
        selected_component_references:
          input.websiteQuote?.selected_component_references ?? [],
        site_count: input.websiteQuote?.site_count ?? 1,
        energy_direction: selected.energyDirection,
        production_pricing: selected.energyDirection === "production"
          ? (input.publicOffer.pricing_snapshot?.production ?? null)
          : null,
        missing_fields: input.readiness.missingFields,
        blocking_reasons: input.readiness.blockingReasons,
      },
      updated_at: now,
    },
    price_snapshot: {
      public_contract_offer_id: input.publicOffer.id,
      energy_direction: selected.energyDirection,
      public_price_text: input.publicOffer.public_price_text ?? null,
      terms_url: input.publicOffer.terms_url ?? null,
      spot_weight_percent: input.publicOffer.spot_weight_percent ?? null,
      portfolio_weight_percent: input.publicOffer.portfolio_weight_percent ?? null,
      fixed_weight_percent: input.publicOffer.fixed_weight_percent ?? null,
      source: "website_customer_applications",
      price_plan_version_id: selected.pricePlanVersionId,
      campaign_version_id: selected.campaignVersionId,
      pricing_model: compatibilitySnapshot.pricingModel,
      base_price_components_snapshot: frozenBaseComponents,
      price_components_snapshot: frozenPriceComponents,
      snapshot_json: {
        ...exactPricing,
        source: "website_customer_applications",
        contract_type: selected.contractType,
        energy_direction: selected.energyDirection,
        production: selected.energyDirection === "production"
          ? (input.publicOffer.pricing_snapshot?.production ?? { enabled: true })
          : { enabled: false },
        price_plan_id: selected.pricePlanId,
        price_plan_version_id: selected.pricePlanVersionId,
        public_contract_offer_id: selected.publicContractOfferId,
        pricing_model: compatibilitySnapshot.pricingModel,
        base_price_components_snapshot: frozenBaseComponents,
        price_components_snapshot: frozenPriceComponents,
        snapshot_schema: quoteIsSelectionSnapshot
          ? "gridex_contract_pricing_v6_selection"
          : (exactPricing.snapshot_schema ??
            exactPricing.schema_version ??
            "gridex_contract_pricing_v5"),
        price_option_reference:
          input.websiteQuote?.price_option_reference ?? null,
        area_price_reference:
          input.websiteQuote?.area_price_reference ?? null,
        invoice_delivery_method:
          input.websiteQuote?.invoice_delivery_method ?? null,
        selected_component_references:
          input.websiteQuote?.selected_component_references ?? [],
        mandatory_component_references:
          input.websiteQuote?.mandatory_component_references ?? [],
        conditional_component_references:
          input.websiteQuote?.conditional_component_references ?? [],
        site_count: input.websiteQuote?.site_count ?? 1,
        requested_start_date: requestedStartDate,
        quote_reference: input.websiteQuote?.quote_reference ?? null,
        quote_hash: input.websiteQuote?.quote_hash ?? null,
        quote_valid_until: input.websiteQuote?.valid_until ?? null,
        energy_resolution_id: input.websiteQuote?.energy_resolution_id ?? null,
        resolution_snapshot: input.websiteQuote?.resolution_snapshot ?? {},
        resolver_version: input.websiteQuote?.resolver_version ?? null,
        geodata_version: input.websiteQuote?.geodata_version ?? null,
        market_reference: input.websiteQuote?.market_reference ?? {},
        quote_market_data_timestamp: input.websiteQuote?.market_data_timestamp ?? null,
        quote_market_sources: input.websiteQuote?.market_sources ?? [],
        quote_assumptions: input.websiteQuote?.assumptions ?? [],
        quote_pricing_snapshot_schema_version:
          input.websiteQuote?.pricing_snapshot_schema_version ?? null,
        quote_snapshot: quoteSnapshot,
        selected_area_price_ore_per_kwh: selected.fixedPriceOrePerKwh,
        annual_consumption_kwh: requestedAnnualConsumption(input.body),
        price_area: input.readiness.priceArea,
        grid_area_code: input.readiness.gridAreaCode,
        postal_code: clean(siteInput?.postal_code),
      },
      valid_from: requestedStartDate,
      valid_to: input.publicOffer.valid_to ?? null,
    },
    legal: {
      legal_bundle_version_id: input.publicOffer.legal_bundle_version_id,
      terms_version: input.legalVersions.find((v) => v.type === "terms")?.version ?? selected.termsVersion,
      privacy_version: input.legalVersions.find((v) => v.type === "privacy")?.version ?? null,
      cooling_off_version: input.legalVersions.find((v) => v.type === "cooling_off")?.version ?? null,
      signed_scopes: exactSignedScopes,
      accepted_at: input.agreementAcceptedAt,
      acceptance_snapshot: {
        legal_versions: legalSnapshot,
        consents: input.body.consents ?? {},
        offer_reference: input.offerReference,
        quote_reference: input.websiteQuote?.quote_reference ?? null,
        quote_hash: input.websiteQuote?.quote_hash ?? null,
        energy_resolution_id: input.websiteQuote?.energy_resolution_id ?? null,
        request_audit: input.requestAudit ?? null,
      },
    },
    quote: input.websiteQuote
      ? {
          quote_reference: input.websiteQuote.quote_reference,
          quote_hash: input.websiteQuote.quote_hash,
          quote_hash_version: input.websiteQuote.quote_hash_version,
          application_id: input.applicationRowId,
          offer_reference: input.offerReference,
          price_option_reference:
            input.websiteQuote.price_option_reference,
          area_price_reference:
            input.websiteQuote.area_price_reference,
          invoice_delivery_method:
            input.websiteQuote.invoice_delivery_method,
          selected_component_references:
            input.websiteQuote.selected_component_references,
          site_count: input.websiteQuote.site_count,
        }
      : null,
    power_of_attorney: input.structuredPoa?.accepted
      ? {
          signed_scopes: exactSignedScopes,
          scope: exactSignedScopes.includes("supplier_switch") ? "supplier_switch" : exactSignedScopes[0],
          status: "signed",
          signed_at: input.structuredPoa.acceptedAt ?? now,
          accepted_at: input.structuredPoa.acceptedAt ?? now,
          valid_from: (input.structuredPoa.acceptedAt ?? now).slice(0, 10),
          legal_text_version_id: input.structuredPoa.textVersionId ?? poaLegal?.id ?? null,
          signer_name: input.structuredPoa.signerName,
          signer_identity_number: input.structuredPoa.signerIdentityNumber,
          method: input.structuredPoa.method,
          evidence_payload: {
            accepted: true,
            scopes: exactSignedScopes,
            ip_address: input.structuredPoa.ipAddress ?? input.requestAudit?.ipAddress ?? null,
            user_agent: input.structuredPoa.userAgent ?? input.requestAudit?.userAgent ?? null,
            externally_sendable_at_capture: true,
          },
          source: "website_api",
          accepted_ip: input.structuredPoa.ipAddress ?? input.requestAudit?.ipAddress ?? null,
          accepted_ip_hash: input.requestAudit?.ipHash ?? null,
          accepted_user_agent: input.structuredPoa.userAgent ?? input.requestAudit?.userAgent ?? null,
          accepted_source: "website",
          reference: `POA-${input.applicationRowId}`,
          metadata: { source: "website_customer_applications", application_id: input.applicationRowId },
        }
      : null,
    authorization_document: input.structuredPoa?.accepted
      ? {
          status: "active",
          title: `Signerad fullmakt POA-${input.applicationRowId}`,
          reference: `POA-${input.applicationRowId}`,
          notes: "Immutable website POA evidence created in canonical onboarding transaction.",
          metadata: {
            source: "website_customer_applications",
            application_id: input.applicationRowId,
            signed_scopes: exactSignedScopes,
          },
        }
      : null,
    application: {
      source_record_type: "website_customer_application",
      source_record_id: input.applicationRowId,
      status: input.readiness.status,
      payload_snapshot: input.body,
    },
    task: input.readiness.blockingReasons.length > 0 || input.readiness.missingFields.length > 0
      ? {
          task_type: "customer_data_review",
          status: "open",
          priority: "high",
          title: "Granska webbansökan",
          description: [...input.readiness.blockingReasons, ...input.readiness.missingFields].join("; "),
          metadata: { website_application_id: input.applicationRowId },
        }
      : null,
    info_request: input.readiness.missingFields.length > 0
      ? {
          request_type: "website_customer_onboarding",
          target_party_type: "customer",
          status: "draft",
          requested_data_categories: input.readiness.missingFields,
          verified_payload: {},
          notes: "Skapad atomiskt från webbansökan.",
          automation_origin: "website_customer_application",
          automation_key: `website-customer-application:${input.applicationRowId}`,
        }
      : null,
  }, tenantContext);

  if (!result.ok) {
    throw new WebsiteApplicationError({
      message: "Flera möjliga kunder hittades. Ansökan har blockerats för manuell identitetsgranskning.",
      status: 409,
      code: "ambiguous_customer_match",
      stage: "customer_lookup",
      action: "manual_review_required",
      details: {
        correlation_id: result.correlation_id,
      },
    });
  }

  const customerRow = await supabaseService
    .from("customers")
    .select("id,customer_number,email,full_name,company_name")
    .eq("company_id", companyId)
    .eq("id", result.customer_id)
    .single();
  if (customerRow.error || !customerRow.data?.customer_number) {
    throw customerRow.error ?? new Error("canonical_customer_number_missing");
  }
  const siteRow = result.site_id
    ? await supabaseService.from("customer_sites").select("id,facility_id").eq("company_id", companyId).eq("id", result.site_id).single()
    : null;
  if (siteRow?.error) throw siteRow.error;
  const meterRow = result.metering_point_id
    ? await supabaseService.from("metering_points").select("id,metering_point_id,meter_point_id,ediel_metering_point_id").eq("company_id", companyId).eq("id", result.metering_point_id).single()
    : null;
  if (meterRow?.error) throw meterRow.error;
  const contractRow = result.contract_id
    ? await supabaseService
        .from("customer_contracts")
        .select("id,contract_name,starts_at,status,signed_at,withdrawal_deadline_at,public_contract_offer_id,offer_reference,quote_reference,price_option_reference,binding_months,notice_months,auto_renew_enabled,auto_renew_term_months,signature_snapshot_sha256,contract_number,price_plan_id,price_plan_version_id,contract_price_snapshot_id")
        .eq("company_id", companyId)
        .eq("id", result.contract_id)
        .single()
    : null;
  if (contractRow?.error) throw contractRow.error;

  const meterData = meterRow?.data as Record<string, unknown> | undefined;
  return {
    result,
    customerResult: {
      customer: customerRow.data as CustomerRow,
      created: result.created_new_customer,
      customerNumberAssigned: result.created_new_customer,
    },
    site: siteRow?.data
      ? { id: String(siteRow.data.id), facility_id: clean(siteRow.data.facility_id) }
      : null,
    meteringPoint: meterData
      ? {
          id: String(meterData.id),
          metering_point_id:
            clean(meterData.metering_point_id) ??
            clean(meterData.meter_point_id) ??
            clean(meterData.ediel_metering_point_id),
        }
      : null,
    contract: contractRow?.data
      ? ({ ...contractRow.data, contract_price_snapshot_id: result.price_snapshot_id } as WebsiteContractCreateResult)
      : null,
  };
}