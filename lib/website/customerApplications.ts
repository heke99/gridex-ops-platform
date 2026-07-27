//lib/website/customerApplications.ts
import { createHash } from "node:crypto";
import { z } from "zod";
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth";
import { supabaseService } from "@/lib/supabase/service";
import {
  reserveApplicationNumber,
} from "@/lib/customer-numbers/customerNumbers";
import { emitDomainEvent } from "@/lib/events/domainEvents";
import {
  triggerEmailEvent,
} from "@/lib/email/emailEvents";
import {
  assessWebsiteApplicationReadiness,
  customerIntakeStatusForReadiness,
  type WebsiteApplicationReadiness,
} from "@/lib/website/applicationReview";
import { resolveEnergyContext } from "@/lib/energy/resolver";
import {
  EnergyResolutionBindingError,
  loadBoundEnergyResolution,
} from "@/lib/energy/resolutionBinding";
import { patchMeteringPointEnergyContext } from "@/lib/energy/meteringPointContext";
import { recordCanonicalEnergyEvent } from "@/lib/energy/canonicalEnergyEvents";
import { normalizeGridOwnerIdToOps } from "@/lib/grid-owners/platformGridOwnerResolver";
import { processWebsiteApplicationIntake } from "@/lib/customer-operations/customerIntakeOrchestrator";
import {
  publicOfferReference,
  legalAcceptanceTypeForModule,
  resolvePublicContractOffer,
  type LegacyLegalAcceptanceType,
  type PublicContractOffer,
} from "@/lib/website/publicContracts";
import type { EnergyResolverResult } from "@/lib/energy/types";
import {
  mapFacilityBusinessError,
  normalizeFacilityId,
  recordFacilityDataIssue,
  type FacilityBusinessErrorCode,
} from "@/lib/energy/facilityDataErrors";
import { getBaseAppUrl } from "@/lib/auth/urls";
import { ensureCustomerPortalUserLink } from "@/lib/customer-portal/customerResolver";
import {
  applyCustomerSiteAddressCandidate,
} from "@/lib/customer-sites/addressIntake";
import { evaluateAndRunNextCustomerStep } from "@/lib/customer-operations/customerProcessNextStepEngine";
import {
  ensureCustomerApplicationWorkflow,
  transitionCustomerApplicationWorkflow,
} from "@/lib/website/applicationWorkflow";
import {
  commitApplicationProvisioning,
  failApplicationProvisioning,
} from "@/lib/website/provisioningSaga";
import {
  buildPublicLegalUrl,
  loadCompanySlugById,
} from "@/lib/legal/publicLegalDocuments";
import { normalizeExternalCustomerType } from "@/lib/customers/externalCustomerType";
import {
  assertCanonicalSnapshot,
  buildCanonicalContractSnapshot,
} from "@/lib/pricing/contractSnapshot";
import { buildAgreementPdfAttachment } from "@/lib/customer-contracts/agreementPdf";
import { archiveSignedCustomerContractPdf } from "@/lib/customer-contracts/documents";
import { canonicalIdempotencyKey, onboardCustomerGraph } from "@/lib/customers/canonicalOnboarding";
import {
  validateWebsiteQuote,
  WebsiteQuoteValidationError,
  type WebsiteQuoteRecord,
} from "@/lib/pricing/websiteQuotes";
import {
  fixedPriceOreForArea,
  selectBaseComponentsForPriceArea,
} from "@/lib/pricing/fixedAreaPricing";

const OPTIONAL_TEXT = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined,
  z.string().optional(),
);

const OPTIONAL_BOOLEAN = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}, z.boolean().optional());

const CustomerSchema = z
  .object({
    customer_type: z.enum(["private", "business"]).default("private"),
    first_name: OPTIONAL_TEXT,
    last_name: OPTIONAL_TEXT,
    full_name: OPTIONAL_TEXT,
    company_name: OPTIONAL_TEXT,
    personal_number: OPTIONAL_TEXT,
    org_number: OPTIONAL_TEXT,
    email: OPTIONAL_TEXT,
    phone: OPTIONAL_TEXT,
    invoice_email: OPTIONAL_TEXT,
    billing_street: OPTIONAL_TEXT,
    billing_postal_code: OPTIONAL_TEXT,
    billing_city: OPTIONAL_TEXT,
    billing_country: OPTIONAL_TEXT,
  })
  .default({});

const SiteSchema = z
  .object({
    facility_id: OPTIONAL_TEXT,
    site_name: OPTIONAL_TEXT,
    site_type: z.enum(["consumption", "production", "combined"]).optional(),
    street: OPTIONAL_TEXT,
    postal_code: OPTIONAL_TEXT,
    city: OPTIONAL_TEXT,
    country: OPTIONAL_TEXT,
    price_area_code: OPTIONAL_TEXT,
    price_area: OPTIONAL_TEXT,
    grid_area_code: OPTIONAL_TEXT,
    gridAreaCode: OPTIONAL_TEXT,
    grid_owner_id: OPTIONAL_TEXT,
    gridOwnerId: OPTIONAL_TEXT,
    grid_owner_verification_status: OPTIONAL_TEXT,
    gridOwnerVerificationStatus: OPTIONAL_TEXT,
    bidding_zone_code: OPTIONAL_TEXT,
    biddingZoneCode: OPTIONAL_TEXT,
    current_supplier_id: OPTIONAL_TEXT,
    currentSupplierId: OPTIONAL_TEXT,
    current_supplier_name: OPTIONAL_TEXT,
    currentSupplierName: OPTIONAL_TEXT,
    current_supplier_org_number: OPTIONAL_TEXT,
    currentSupplierOrgNumber: OPTIONAL_TEXT,
    current_supplier_ediel_id: OPTIONAL_TEXT,
    currentSupplierEdielId: OPTIONAL_TEXT,
    current_supplier_unknown: OPTIONAL_BOOLEAN,
    currentSupplierUnknown: OPTIONAL_BOOLEAN,
    current_supplier_contract_status: OPTIONAL_TEXT,
    currentSupplierContractStatus: OPTIONAL_TEXT,
    current_supplier_contract_end_date: OPTIONAL_TEXT,
    currentSupplierContractEndDate: OPTIONAL_TEXT,
    current_supplier_notice_period: OPTIONAL_TEXT,
    currentSupplierNoticePeriod: OPTIONAL_TEXT,
    current_supplier_termination_fee: z.coerce.number().optional(),
    currentSupplierTerminationFee: z.coerce.number().optional(),
    current_supplier_response_status: OPTIONAL_TEXT,
    currentSupplierResponseStatus: OPTIONAL_TEXT,
    latitude: z.coerce.number().optional(),
    longitude: z.coerce.number().optional(),
    sweref99_x: z.coerce.number().optional(),
    sweref99_y: z.coerce.number().optional(),
    move_in_date: OPTIONAL_TEXT,
    annual_consumption_kwh: z.coerce.number().optional(),
  })
  .optional();

const MeteringPointSchema = z
  .object({
    metering_point_id: OPTIONAL_TEXT,
    meter_point_id: OPTIONAL_TEXT,
    ediel_metering_point_id: OPTIONAL_TEXT,
    anlage_id: OPTIONAL_TEXT,
    site_facility_id: OPTIONAL_TEXT,
    reading_frequency: OPTIONAL_TEXT,
    measurement_type: OPTIONAL_TEXT,
    price_area_code: OPTIONAL_TEXT,
    price_area: OPTIONAL_TEXT,
    grid_area_code: OPTIONAL_TEXT,
    gridAreaCode: OPTIONAL_TEXT,
    grid_owner_id: OPTIONAL_TEXT,
    gridOwnerId: OPTIONAL_TEXT,
    bidding_zone_code: OPTIONAL_TEXT,
    biddingZoneCode: OPTIONAL_TEXT,
    start_date: OPTIONAL_TEXT,
    installation_date: OPTIONAL_TEXT,
    estimated_annual_consumption_kwh: z.coerce.number().optional(),
  })
  .optional();

const ContractSchema = z
  .object({
    offer_reference: OPTIONAL_TEXT,
    offerReference: OPTIONAL_TEXT,
    quote_reference: OPTIONAL_TEXT,
    quoteReference: OPTIONAL_TEXT,
    resolution_id: OPTIONAL_TEXT,
    resolutionId: OPTIONAL_TEXT,
    contract_name: OPTIONAL_TEXT,
    contract_type: OPTIONAL_TEXT,
    contract_number: OPTIONAL_TEXT,
    price_plan_id: OPTIONAL_TEXT,
    price_plan_version_id: OPTIONAL_TEXT,
    contract_offer_id: OPTIONAL_TEXT,
    product_code: OPTIONAL_TEXT,
    starts_at: OPTIONAL_TEXT,
    expected_start_at: OPTIONAL_TEXT,
    requested_start_date: OPTIONAL_TEXT,
    requestedStartDate: OPTIONAL_TEXT,
    confirmed_start_date: OPTIONAL_TEXT,
    confirmedStartDate: OPTIONAL_TEXT,
    actual_start_date: OPTIONAL_TEXT,
    actualStartDate: OPTIONAL_TEXT,
    requested_start_mode: OPTIONAL_TEXT,
    requestedStartMode: OPTIONAL_TEXT,
    calculated_earliest_start_date: OPTIONAL_TEXT,
    calculatedEarliestStartDate: OPTIONAL_TEXT,
    signed_at: OPTIONAL_TEXT,
    monthly_fee_sek: z.coerce.number().optional(),
    invoice_fee_sek: z.coerce.number().optional(),
    markup_ore_per_kwh: z.coerce.number().optional(),
    spot_markup_ore_per_kwh: z.coerce.number().optional(),
    variable_fee_ore_per_kwh: z.coerce.number().optional(),
    fixed_price_ore_per_kwh: z.coerce.number().optional(),
    green_fee_mode: OPTIONAL_TEXT,
    green_fee_value: z.coerce.number().optional(),
    binding_months: z.coerce.number().int().optional(),
    notice_months: z.coerce.number().int().optional(),
    campaign_code: OPTIONAL_TEXT,
    price_version: OPTIONAL_TEXT,
    terms_version: OPTIONAL_TEXT,
  })
  .optional();

// Structured power of attorney object accepted by the website API. The API must
// NOT accept only `powerOfAttorney: true`; it accepts a structured object with
// signer/scope/method/evidence. The frontend-provided legal text is never
// trusted — the active legal/fullmakt text is loaded by textVersionId.
const PowerOfAttorneySchema = z
  .object({
    accepted: OPTIONAL_BOOLEAN,
    scope: z.array(z.string()).optional(),
    signerName: OPTIONAL_TEXT,
    signer_name: OPTIONAL_TEXT,
    signerIdentityNumber: OPTIONAL_TEXT,
    signer_identity_number: OPTIONAL_TEXT,
    method: OPTIONAL_TEXT,
    acceptedAt: OPTIONAL_TEXT,
    accepted_at: OPTIONAL_TEXT,
    textVersionId: OPTIONAL_TEXT,
    text_version_id: OPTIONAL_TEXT,
    ipAddress: OPTIONAL_TEXT,
    ip_address: OPTIONAL_TEXT,
    userAgent: OPTIONAL_TEXT,
    user_agent: OPTIONAL_TEXT,
  })
  .optional();

const ApplicationSchema = z.object({
  offer_reference: OPTIONAL_TEXT,
  offerReference: OPTIONAL_TEXT,
  external_customer_id: OPTIONAL_TEXT,
  customer_external_id: OPTIONAL_TEXT,
  external_customer_reference: OPTIONAL_TEXT,
  customer_reference: OPTIONAL_TEXT,
  external_account_id: OPTIONAL_TEXT,
  auth_user_id: OPTIONAL_TEXT,
  customer_portal_user_id: OPTIONAL_TEXT,
  web_auth_user_id: OPTIONAL_TEXT,
  source: OPTIONAL_TEXT,
  grid_owner_id: OPTIONAL_TEXT,
  network_owner_id: OPTIONAL_TEXT,
  electricity_supplier_id: OPTIONAL_TEXT,
  current_supplier_id: OPTIONAL_TEXT,
  currentSupplierId: OPTIONAL_TEXT,
  current_supplier_name: OPTIONAL_TEXT,
  currentSupplierName: OPTIONAL_TEXT,
  current_supplier_org_number: OPTIONAL_TEXT,
  currentSupplierOrgNumber: OPTIONAL_TEXT,
  current_supplier_ediel_id: OPTIONAL_TEXT,
  currentSupplierEdielId: OPTIONAL_TEXT,
  current_supplier_unknown: OPTIONAL_BOOLEAN,
  currentSupplierUnknown: OPTIONAL_BOOLEAN,
  current_supplier_contract_status: OPTIONAL_TEXT,
  currentSupplierContractStatus: OPTIONAL_TEXT,
  current_supplier_contract_end_date: OPTIONAL_TEXT,
  currentSupplierContractEndDate: OPTIONAL_TEXT,
  current_supplier_notice_period: OPTIONAL_TEXT,
  currentSupplierNoticePeriod: OPTIONAL_TEXT,
  current_supplier_termination_fee: z.coerce.number().optional(),
  currentSupplierTerminationFee: z.coerce.number().optional(),
  current_supplier_response_status: OPTIONAL_TEXT,
  currentSupplierResponseStatus: OPTIONAL_TEXT,
  price_plan_id: OPTIONAL_TEXT,
  price_plan_version_id: OPTIONAL_TEXT,
  quote_reference: OPTIONAL_TEXT,
  quoteReference: OPTIONAL_TEXT,
  resolution_id: OPTIONAL_TEXT,
  resolutionId: OPTIONAL_TEXT,
  contract_offer_id: OPTIONAL_TEXT,
  product_code: OPTIONAL_TEXT,
  requested_start_date: OPTIONAL_TEXT,
  confirmed_start_date: OPTIONAL_TEXT,
  actual_start_date: OPTIONAL_TEXT,
  requested_start_mode: OPTIONAL_TEXT,
  requestedStartMode: OPTIONAL_TEXT,
  calculated_earliest_start_date: OPTIONAL_TEXT,
  calculatedEarliestStartDate: OPTIONAL_TEXT,
  grid_area_code: OPTIONAL_TEXT,
  gridAreaCode: OPTIONAL_TEXT,
  price_area_code: OPTIONAL_TEXT,
  priceAreaCode: OPTIONAL_TEXT,
  resolution_status: OPTIONAL_TEXT,
  resolutionStatus: OPTIONAL_TEXT,
  grid_owner_verification_status: OPTIONAL_TEXT,
  gridOwnerVerificationStatus: OPTIONAL_TEXT,
  customer: CustomerSchema,
  site: SiteSchema,
  metering_point: MeteringPointSchema,
  contract: ContractSchema,
  consents: z.record(z.unknown()).optional(),
  legalAcceptances: z.array(z.record(z.unknown())).optional(),
  legal_acceptances: z.array(z.record(z.unknown())).optional(),
  powerOfAttorney: PowerOfAttorneySchema,
  power_of_attorney: PowerOfAttorneySchema,
  metadata: z.record(z.unknown()).optional(),
});

type StructuredPowerOfAttorney = z.infer<typeof PowerOfAttorneySchema>;

type NormalizedStructuredPoa = {
  accepted: boolean;
  scope: string[];
  signerName: string | null;
  signerIdentityNumber: string | null;
  method: string | null;
  acceptedAt: string | null;
  textVersionId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

// Normalizes the structured powerOfAttorney object (camel or snake case).
function normalizeStructuredPoa(
  body: ApplicationInput,
): NormalizedStructuredPoa | null {
  const raw = (body.powerOfAttorney ?? body.power_of_attorney) as
    StructuredPowerOfAttorney | undefined;
  if (!raw) return null;
  const pick = (a: unknown, b: unknown) =>
    typeof a === "string" && a.trim()
      ? a.trim()
      : typeof b === "string" && b.trim()
        ? b.trim()
        : null;
  return {
    accepted: raw.accepted === true,
    scope: Array.isArray(raw.scope)
      ? raw.scope.map((value) => String(value))
      : [],
    signerName: pick(raw.signerName, raw.signer_name),
    signerIdentityNumber: pick(
      raw.signerIdentityNumber,
      raw.signer_identity_number,
    ),
    method: pick(raw.method, null),
    acceptedAt: pick(raw.acceptedAt, raw.accepted_at),
    textVersionId: pick(raw.textVersionId, raw.text_version_id),
    ipAddress: pick(raw.ipAddress, raw.ip_address),
    userAgent: pick(raw.userAgent, raw.user_agent),
  };
}

function structuredPoaIsExternallySendable(
  poa: NormalizedStructuredPoa | null,
): boolean {
  return Boolean(
    poa?.accepted === true &&
    poa.signerName &&
    poa.signerIdentityNumber &&
    poa.method,
  );
}

function validateStructuredPoaForExternalSendability(
  poa: NormalizedStructuredPoa | null,
): WebsiteApplicationError | null {
  if (!poa?.accepted) return null;

  const missing: Array<{ field: string; label: string }> = [];
  if (!poa.signerName)
    missing.push({ field: "powerOfAttorney.signerName", label: "signerName" });
  if (!poa.signerIdentityNumber)
    missing.push({
      field: "powerOfAttorney.signerIdentityNumber",
      label: "signerIdentityNumber",
    });
  if (!poa.method)
    missing.push({ field: "powerOfAttorney.method", label: "method" });
  if (poa.scope.length === 0)
    missing.push({ field: "powerOfAttorney.scope", label: "scope" });

  if (missing.length === 0) return null;

  return validationError(
    `Strukturerad fullmakt är markerad accepted=true men saknar ${missing.map((item) => item.label).join(", ")}. Skicka signerName, signerIdentityNumber, method och exakt scope eller skicka bara legacy consent som intern, icke sändbar accept.`,
    missing[0]?.field ?? "powerOfAttorney",
    "Automatisk nätägarkommunikation kräver komplett strukturerad powerOfAttorney. Legacy consents.power_of_attorney=true blir aldrig externt sändbar.",
  );
}

type ApplicationInput = z.infer<typeof ApplicationSchema>;

const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+-]+$/;
const REQUESTED_START_MODES = new Set(["earliest_possible", "specific_date"]);
const REPLAYABLE_COMMITTED_STATUSES = new Set([
  "received",
  "application_received",
  "customer_created",
  "customer_matched",
  "contract_created",
  "confirmation_pending",
  "confirmation_sent",
  "cooling_off_sent",
  "webhook_pending",
  "completed",
  "linked_existing_customer",
  "needs_address_resolution",
  "address_resolved",
  "grid_area_resolved",
  "needs_facility_data",
  "information_request_ready",
  "information_request_sent",
  "waiting_grid_owner_response",
  "facility_data_received",
  "needs_information",
  "pending_validation",
  "pending_review",
  "manual_review",
  "ready_for_switch",
  "switch_requested",
  "switch_confirmed",
  "active",
  "repaired",
]);
const BUSINESS_CONFLICT_STATUSES = new Set([
  "processing",
  ...REPLAYABLE_COMMITTED_STATUSES,
]);
const COMMITTED_SITE_REQUIRED_STATUSES = new Set([
  "needs_address_resolution",
  "address_resolved",
  "grid_area_resolved",
  "needs_facility_data",
  "information_request_ready",
  "information_request_sent",
  "waiting_grid_owner_response",
  "facility_data_received",
  "ready_for_switch",
  "switch_requested",
  "switch_confirmed",
  "active",
  "repaired",
]);
const COMMITTED_METERING_REQUIRED_STATUSES = new Set([
  "facility_data_received",
  "ready_for_switch",
  "switch_requested",
  "switch_confirmed",
  "active",
]);
const COMMITTED_CONTRACT_REQUIRED_STATUSES = new Set([
  "contract_created",
  "confirmation_pending",
  "confirmation_sent",
  "cooling_off_sent",
  "webhook_pending",
  "completed",
  "ready_for_switch",
  "switch_requested",
  "switch_confirmed",
  "active",
]);

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function applicationPayloadHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function normalizedBusinessToken(value: unknown): string | null {
  const text = clean(value);
  return text ? text.toLowerCase().replace(/\s+/g, " ").trim() : null;
}

function normalizedFacilityToken(value: unknown): string | null {
  const text = clean(value);
  return text ? text.replace(/\s+/g, "").toUpperCase() : null;
}

/**
 * Stable business identity used to prevent a second parallel application for
 * the same external customer/site/offer/start event under a new idempotency
 * key. Mutable completion data (supplier details, POA evidence, metadata) is
 * deliberately excluded so it cannot create a second business process.
 */
function applicationBusinessKeyHash(
  input: ApplicationInput,
  externalCustomerId: string,
): string | null {
  const site = input.site;
  const metering = input.metering_point;
  const contract = input.contract;
  const facilityId = normalizedFacilityToken(
    site?.facility_id ?? metering?.site_facility_id ?? metering?.anlage_id,
  );
  const meteringPointId = normalizedFacilityToken(
    metering?.metering_point_id ??
      metering?.meter_point_id ??
      metering?.ediel_metering_point_id,
  );
  const address =
    [site?.street, site?.postal_code, site?.city]
      .map(normalizedBusinessToken)
      .filter((value): value is string => Boolean(value))
      .join("|") || null;
  const siteIdentity = facilityId
    ? `facility:${facilityId}`
    : meteringPointId
      ? `metering:${meteringPointId}`
      : address
        ? `address:${address}`
        : null;
  if (!siteIdentity) return null;

  const offerIdentity =
    normalizedBusinessToken(
      input.offer_reference ??
        input.offerReference ??
        contract?.offer_reference ??
        contract?.offerReference ??
        input.contract_offer_id ??
        contract?.contract_offer_id ??
        input.price_plan_version_id ??
        contract?.price_plan_version_id ??
        input.product_code ??
        contract?.product_code ??
        input.price_plan_id ??
        contract?.price_plan_id,
    ) ?? "unspecified-offer";
  const requestedStartDate =
    clean(
      input.requested_start_date ??
        contract?.requested_start_date ??
        contract?.requestedStartDate ??
        contract?.starts_at ??
        site?.move_in_date,
    ) ?? "unspecified-start";

  return applicationPayloadHash({
    external_customer_id: externalCustomerId,
    site_identity: siteIdentity,
    offer_identity: offerIdentity,
    requested_start_date: requestedStartDate,
  });
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function validIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

function nestedRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : null;
}

function validateCanonicalApplicationReferencePlacement(
  value: unknown,
): WebsiteApplicationError | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const contract = nestedRecord(value, "contract");
  const fields: Array<{
    canonical: "offer_reference" | "quote_reference" | "resolution_id";
    alias: "offerReference" | "quoteReference" | "resolutionId";
    conflictCode: string;
  }> = [
    { canonical: "offer_reference", alias: "offerReference", conflictCode: "offer_reference_mismatch" },
    { canonical: "quote_reference", alias: "quoteReference", conflictCode: "quote_reference_mismatch" },
    { canonical: "resolution_id", alias: "resolutionId", conflictCode: "quote_resolution_mismatch" },
  ];

  for (const field of fields) {
    const topLevel = clean(root[field.canonical]) ?? clean(root[field.alias]);
    const nested = clean(contract?.[field.canonical]) ?? clean(contract?.[field.alias]);
    if (topLevel && nested && topLevel !== nested) {
      return new WebsiteApplicationError({
        message: `${field.canonical} under contract motsäger det canonicala top-level-värdet.`,
        status: 422,
        code: field.conflictCode,
        field: `contract.${field.canonical}`,
        stage: "validation",
        hint: `Skicka ${field.canonical} en gång på top-level. Ta bort det duplicerade contract.${field.canonical}-fältet.`,
      });
    }
  }
  return null;
}

function validateApplicationDates(
  input: Record<string, unknown>,
): WebsiteApplicationError | null {
  const site = nestedRecord(input, "site");
  const metering = nestedRecord(input, "metering_point");
  const contract = nestedRecord(input, "contract");
  const dateFields: Array<[string, unknown]> = [
    ["requested_start_date", input.requested_start_date],
    ["confirmed_start_date", input.confirmed_start_date],
    ["actual_start_date", input.actual_start_date],
    ["calculated_earliest_start_date", input.calculated_earliest_start_date],
    [
      "current_supplier_contract_end_date",
      input.current_supplier_contract_end_date,
    ],
    ["site.move_in_date", site?.move_in_date],
    [
      "site.current_supplier_contract_end_date",
      site?.current_supplier_contract_end_date,
    ],
    ["metering_point.start_date", metering?.start_date],
    ["metering_point.installation_date", metering?.installation_date],
    ["contract.starts_at", contract?.starts_at],
    ["contract.expected_start_at", contract?.expected_start_at],
    ["contract.requested_start_date", contract?.requested_start_date],
    ["contract.confirmed_start_date", contract?.confirmed_start_date],
    ["contract.actual_start_date", contract?.actual_start_date],
    [
      "contract.calculated_earliest_start_date",
      contract?.calculated_earliest_start_date,
    ],
  ];
  for (const [field, value] of dateFields) {
    const text = clean(value);
    if (text && !validIsoDate(text)) {
      return new WebsiteApplicationError({
        message: `${field} måste vara ett giltigt kalenderdatum i formatet YYYY-MM-DD.`,
        status: 422,
        code: "date_invalid",
        field,
        stage: "validation",
        hint: "Skicka datum som exempelvis 2026-07-15.",
      });
    }
  }

  const poa =
    nestedRecord(input, "powerOfAttorney") ??
    nestedRecord(input, "power_of_attorney");
  const acceptedAt = clean(poa?.acceptedAt) ?? clean(poa?.accepted_at);
  if (acceptedAt && !validIsoTimestamp(acceptedAt)) {
    return new WebsiteApplicationError({
      message:
        "powerOfAttorney.acceptedAt måste vara en giltig ISO 8601-tidsstämpel.",
      status: 422,
      code: "timestamp_invalid",
      field: "powerOfAttorney.acceptedAt",
      stage: "validation",
      hint: "Skicka exempelvis 2026-07-10T08:30:00Z.",
    });
  }
  const signedAt = clean(contract?.signed_at);
  if (signedAt && !validIsoTimestamp(signedAt)) {
    return new WebsiteApplicationError({
      message: "contract.signed_at måste vara en giltig ISO 8601-tidsstämpel.",
      status: 422,
      code: "timestamp_invalid",
      field: "contract.signed_at",
      stage: "validation",
      hint: "Skicka exempelvis 2026-07-10T08:30:00Z.",
    });
  }
  return null;
}

function validateRequestedStartMode(
  input: Record<string, unknown>,
): WebsiteApplicationError | null {
  const contract = nestedRecord(input, "contract");
  const raw =
    clean(input.requested_start_mode) ??
    clean(input.requestedStartMode) ??
    clean(contract?.requested_start_mode) ??
    clean(contract?.requestedStartMode);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (!REQUESTED_START_MODES.has(normalized)) {
    return new WebsiteApplicationError({
      message: `requested_start_mode "${raw}" stöds inte.`,
      status: 422,
      code: "requested_start_mode_invalid",
      field: "requested_start_mode",
      stage: "validation",
      hint: "Använd earliest_possible eller specific_date.",
    });
  }
  return null;
}

function validateIdempotencyKey(
  value: string | null | undefined,
): WebsiteApplicationError | null {
  if (!value) {
    return new WebsiteApplicationError({
      message: "Idempotency-Key krävs för kundansökningar.",
      status: 400,
      code: "idempotency_key_required",
      field: "Idempotency-Key",
      stage: "idempotency",
      hint: "Skicka en stabil unik nyckel och återanvänd den endast för exakt samma payload.",
    });
  }
  if (
    value.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    value.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(value)
  ) {
    return new WebsiteApplicationError({
      message: "Idempotency-Key har ogiltigt format.",
      status: 400,
      code: "idempotency_key_invalid",
      field: "Idempotency-Key",
      stage: "idempotency",
      hint: `Använd ${IDEMPOTENCY_KEY_MIN_LENGTH}-${IDEMPOTENCY_KEY_MAX_LENGTH} tecken: bokstäver, siffror, punkt, understreck, kolon, plus, tilde eller bindestreck.`,
    });
  }
  return null;
}

const TOP_LEVEL_PAYLOAD_FIELDS = new Set([
  "actual_start_date",
  "address",
  "addressLine1",
  "addressType",
  "address_line1",
  "address_type",
  "anlage_id",
  "anlaggningId",
  "annualConsumptionKwh",
  "annual_consumption_kwh",
  "authUserId",
  "auth_user_id",
  "biddingZoneCode",
  "bidding_zone_code",
  "billingAddressSameAsSite",
  "billingCity",
  "billingCountry",
  "billingPostalCode",
  "billingStreet",
  "billing_address_same_as_site",
  "billing_city",
  "billing_country",
  "billing_postal_code",
  "billing_street",
  "bindingMonths",
  "binding_months",
  "calculatedEarliestStartDate",
  "calculated_earliest_start_date",
  "campaignCode",
  "campaign_code",
  "channel",
  "city",
  "companyName",
  "company_name",
  "confirmed_start_date",
  "consents",
  "contract",
  "contractName",
  "contractNumber",
  "contractOfferId",
  "contractType",
  "contract_name",
  "contract_number",
  "contract_offer_id",
  "contract_type",
  "country",
  "currentSupplierContractEndDate",
  "currentSupplierContractStatus",
  "currentSupplierEdielId",
  "currentSupplierId",
  "currentSupplierName",
  "currentSupplierNoticePeriod",
  "currentSupplierOrgNumber",
  "currentSupplierResponseStatus",
  "currentSupplierTerminationFee",
  "currentSupplierUnknown",
  "current_supplier_contract_end_date",
  "current_supplier_contract_status",
  "current_supplier_ediel_id",
  "current_supplier_id",
  "current_supplier_name",
  "current_supplier_notice_period",
  "current_supplier_org_number",
  "current_supplier_response_status",
  "current_supplier_termination_fee",
  "current_supplier_unknown",
  "customer",
  "customerPortalUserId",
  "customerType",
  "customer_external_id",
  "customer_portal_user_id",
  "customer_type",
  "edielMeteringPointId",
  "ediel_metering_point_id",
  "electricity_supplier_id",
  "email",
  "estimatedAnnualConsumptionKwh",
  "estimated_annual_consumption_kwh",
  "externalAccountId",
  "externalCustomerId",
  "external_account_id",
  "external_customer_id",
  "facilityId",
  "facility_id",
  "firstName",
  "first_name",
  "fixedPriceOrePerKwh",
  "fixed_price_ore_per_kwh",
  "fullName",
  "full_name",
  "greenFeeMode",
  "greenFeeValue",
  "green_fee_mode",
  "green_fee_value",
  "gridAreaCode",
  "gridOwnerId",
  "gridOwnerVerificationStatus",
  "grid_area_code",
  "grid_owner_id",
  "grid_owner_verification_status",
  "identityNumber",
  "identity_number",
  "installationDate",
  "installation_date",
  "invoiceEmail",
  "invoiceFeeSek",
  "invoice_email",
  "invoice_fee_sek",
  "lastName",
  "last_name",
  "legalAcceptances",
  "legal_acceptances",
  "markupOrePerKwh",
  "markup_ore_per_kwh",
  "measurement_type",
  "metadata",
  "meterPointId",
  "meter_point_id",
  "meteringPointId",
  "metering_point",
  "metering_point_id",
  "monthlyFeeSek",
  "monthly_fee_sek",
  "moveInDate",
  "move_in_date",
  "name",
  "network_owner_id",
  "noticeMonths",
  "notice_months",
  "offerReference",
  "offer_reference",
  "orgNumber",
  "org_number",
  "organisationNumber",
  "organisation_number",
  "organisationsnummer",
  "organizationNumber",
  "organization_number",
  "orgnr",
  "personalIdentityNumber",
  "personalNumber",
  "personal_identity_number",
  "personal_number",
  "personnummer",
  "phone",
  "postalCode",
  "postal_code",
  "powerOfAttorney",
  "power_of_attorney",
  "priceArea",
  "priceAreaCode",
  "pricePlanId",
  "pricePlanVersionId",
  "price_area",
  "price_area_code",
  "price_plan_id",
  "price_plan_version_id",
  "quoteReference",
  "quote_reference",
  "price_version",
  "productCode",
  "productName",
  "product_code",
  "product_name",
  "reading_frequency",
  "requestedStartDate",
  "requestedStartMode",
  "requested_start_date",
  "requested_start_mode",
  "resolutionStatus",
  "resolution_status",
  "site",
  "siteFacilityId",
  "siteName",
  "siteType",
  "site_facility_id",
  "site_name",
  "site_type",
  "source",
  "spotMarkupOrePerKwh",
  "spot_markup_ore_per_kwh",
  "startDate",
  "start_date",
  "startsAt",
  "starts_at",
  "street",
  "streetAddress",
  "street_address",
  "termsVersion",
  "terms_version",
  "type",
  "variableFeeOrePerKwh",
  "variable_fee_ore_per_kwh",
  "webAuthUserId",
  "web_auth_user_id",
  "website",
  "zip",
]);

const NESTED_PAYLOAD_FIELDS: Record<string, Set<string>> = {
  customer: new Set([
    "customer_type",
    "customerType",
    "type",
    "first_name",
    "firstName",
    "last_name",
    "lastName",
    "full_name",
    "fullName",
    "name",
    "company_name",
    "companyName",
    "personal_number",
    "personalNumber",
    "personal_identity_number",
    "personalIdentityNumber",
    "identity_number",
    "identityNumber",
    "personnummer",
    "org_number",
    "orgNumber",
    "organization_number",
    "organizationNumber",
    "organisation_number",
    "organisationNumber",
    "organisationsnummer",
    "orgnr",
    "email",
    "phone",
    "invoice_email",
    "invoiceEmail",
    "billing_street",
    "billingStreet",
    "billing_postal_code",
    "billingPostalCode",
    "billing_city",
    "billingCity",
    "billing_country",
    "billingCountry",
  ]),
  site: new Set([
    "facility_id",
    "facilityId",
    "site_facility_id",
    "siteFacilityId",
    "anlage_id",
    "anlaggningId",
    "site_name",
    "siteName",
    "site_type",
    "siteType",
    "street",
    "address",
    "postal_code",
    "postalCode",
    "city",
    "country",
    "price_area_code",
    "priceAreaCode",
    "price_area",
    "priceArea",
    "bidding_zone_code",
    "biddingZoneCode",
    "grid_area_code",
    "gridAreaCode",
    "grid_owner_id",
    "gridOwnerId",
    "grid_owner_verification_status",
    "gridOwnerVerificationStatus",
    "current_supplier_id",
    "currentSupplierId",
    "current_supplier_name",
    "currentSupplierName",
    "current_supplier_org_number",
    "currentSupplierOrgNumber",
    "current_supplier_ediel_id",
    "currentSupplierEdielId",
    "current_supplier_unknown",
    "currentSupplierUnknown",
    "current_supplier_contract_status",
    "currentSupplierContractStatus",
    "current_supplier_contract_end_date",
    "currentSupplierContractEndDate",
    "current_supplier_notice_period",
    "currentSupplierNoticePeriod",
    "current_supplier_termination_fee",
    "currentSupplierTerminationFee",
    "current_supplier_response_status",
    "currentSupplierResponseStatus",
    "latitude",
    "longitude",
    "sweref99_x",
    "sweref99X",
    "sweref99_y",
    "sweref99Y",
    "move_in_date",
    "moveInDate",
    "annual_consumption_kwh",
    "annualConsumptionKwh",
  ]),
  metering_point: new Set([
    "metering_point_id",
    "meteringPointId",
    "meter_point_id",
    "meterPointId",
    "ediel_metering_point_id",
    "edielMeteringPointId",
    "anlage_id",
    "anlaggningId",
    "site_facility_id",
    "siteFacilityId",
    "reading_frequency",
    "readingFrequency",
    "measurement_type",
    "measurementType",
    "price_area_code",
    "priceAreaCode",
    "price_area",
    "priceArea",
    "bidding_zone_code",
    "biddingZoneCode",
    "grid_area_code",
    "gridAreaCode",
    "grid_owner_id",
    "gridOwnerId",
    "start_date",
    "startDate",
    "installation_date",
    "installationDate",
    "estimated_annual_consumption_kwh",
    "estimatedAnnualConsumptionKwh",
  ]),
  contract: new Set([
    "offer_reference",
    "offerReference",
    "quote_reference",
    "quoteReference",
    "contract_name",
    "contractName",
    "contract_type",
    "contractType",
    "contract_number",
    "contractNumber",
    "price_plan_id",
    "pricePlanId",
    "price_plan_version_id",
    "pricePlanVersionId",
    "contract_offer_id",
    "contractOfferId",
    "product_code",
    "productCode",
    "starts_at",
    "startsAt",
    "expected_start_at",
    "expectedStartAt",
    "requested_start_date",
    "requestedStartDate",
    "confirmed_start_date",
    "confirmedStartDate",
    "actual_start_date",
    "actualStartDate",
    "requested_start_mode",
    "requestedStartMode",
    "calculated_earliest_start_date",
    "calculatedEarliestStartDate",
    "signed_at",
    "signedAt",
    "monthly_fee_sek",
    "monthlyFeeSek",
    "invoice_fee_sek",
    "invoiceFeeSek",
    "markup_ore_per_kwh",
    "markupOrePerKwh",
    "spot_markup_ore_per_kwh",
    "spotMarkupOrePerKwh",
    "variable_fee_ore_per_kwh",
    "variableFeeOrePerKwh",
    "fixed_price_ore_per_kwh",
    "fixedPriceOrePerKwh",
    "green_fee_mode",
    "greenFeeMode",
    "green_fee_value",
    "greenFeeValue",
    "binding_months",
    "bindingMonths",
    "notice_months",
    "noticeMonths",
    "campaign_code",
    "campaignCode",
    "price_version",
    "priceVersion",
    "terms_version",
    "termsVersion",
  ]),
  powerOfAttorney: new Set([
    "accepted",
    "scope",
    "signerName",
    "signer_name",
    "signerIdentityNumber",
    "signer_identity_number",
    "method",
    "acceptedAt",
    "accepted_at",
    "textVersionId",
    "text_version_id",
    "ipAddress",
    "ip_address",
    "userAgent",
    "user_agent",
  ]),
  power_of_attorney: new Set([
    "accepted",
    "scope",
    "signerName",
    "signer_name",
    "signerIdentityNumber",
    "signer_identity_number",
    "method",
    "acceptedAt",
    "accepted_at",
    "textVersionId",
    "text_version_id",
    "ipAddress",
    "ip_address",
    "userAgent",
    "user_agent",
  ]),
};

function validateNestedPayloadFields(
  rawBody: unknown,
): WebsiteApplicationError | null {
  if (!isObject(rawBody)) return null;
  const unknownFields: string[] = Object.keys(rawBody).filter(
    (key) => !TOP_LEVEL_PAYLOAD_FIELDS.has(key),
  );
  for (const [container, allowed] of Object.entries(NESTED_PAYLOAD_FIELDS)) {
    const value = rawBody[container];
    if (!isObject(value)) continue;
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) unknownFields.push(`${container}.${key}`);
    }
  }
  if (unknownFields.length === 0) return null;
  return new WebsiteApplicationError({
    message: "Payloaden innehåller okända eller felplacerade fält.",
    status: 422,
    code: "unknown_field",
    field: unknownFields[0],
    stage: "validation",
    hint: "Flytta fältet till dokumenterad plats eller ta bort det. API:t ignorerar inte längre okända affärskritiska nested-fält.",
    details: { fields: unknownFields },
  });
}

type WebsiteLegalAcceptanceVersion = {
  id: string;
  type: string;
  module_key?: string;
  version: string;
  title: string;
  body: string | null;
  published_at: string | null;
  status?: string | null;
  content_sha256?: string | null;
  legal_bundle_version_id?: string | null;
};

const WEBSITE_LEGAL_ACCEPTANCE_DEFINITIONS: Array<{
  legalType: string;
  acceptanceType: string;
  field: string;
  aliases: string[];
  label: string;
}> = [
  {
    legalType: "terms",
    acceptanceType: "terms",
    field: "consents.terms",
    aliases: ["terms", "terms_accepted", "accept_terms", "accepted_terms"],
    label: "allmänna villkor",
  },
  {
    legalType: "privacy_policy",
    acceptanceType: "privacy_policy",
    field: "consents.privacy_policy",
    aliases: [
      "privacy_policy",
      "privacy_policy_accepted",
      "privacy_accepted",
      "gdpr_accepted",
    ],
    label: "integritetspolicy",
  },
  {
    legalType: "withdrawal",
    acceptanceType: "withdrawal_info",
    field: "consents.withdrawal",
    aliases: [
      "withdrawal",
      "withdrawal_info",
      "withdrawal_accepted",
      "cooling_off_accepted",
    ],
    label: "ångerrättsinformation",
  },
  {
    legalType: "power_of_attorney",
    acceptanceType: "power_of_attorney",
    field: "consents.power_of_attorney",
    aliases: [
      "power_of_attorney",
      "poa_accepted",
      "power_of_attorney_accepted",
    ],
    label: "fullmakt",
  },
  {
    legalType: "price_terms",
    acceptanceType: "price_snapshot",
    field: "consents.price_terms",
    aliases: [
      "price_terms",
      "price_snapshot",
      "price_terms_accepted",
      "price_snapshot_accepted",
    ],
    label: "prisvillkor/prisbild",
  },
];

function consentAccepted(
  consents: Record<string, unknown> | undefined,
  aliases: string[],
): boolean {
  if (!consents) return false;
  return aliases.some((alias) => {
    const value = consents[alias];
    return (
      value === true ||
      value === "true" ||
      value === 1 ||
      value === "1" ||
      value === "yes" ||
      value === "accepted"
    );
  });
}

function hasStoredAcceptance(
  acceptanceIds: Record<string, string>,
  legalType: string,
) {
  return (
    typeof acceptanceIds[legalType] === "string" &&
    acceptanceIds[legalType].trim().length > 0
  );
}

function requiredWebsiteLegalAcceptances(offer: PublicContractOffer) {
  const versions = offer.legal_versions ?? [];
  const requiredTypes = new Set(
    versions.map((version) => legalAcceptanceTypeForModule(version.type)),
  );
  return WEBSITE_LEGAL_ACCEPTANCE_DEFINITIONS.filter((definition) =>
    requiredTypes.has(definition.legalType as LegacyLegalAcceptanceType),
  );
}

function contractLegalMailEvidenceReady(input: {
  acceptanceIds: Record<string, string>;
  legalVersions: WebsiteLegalAcceptanceVersion[];
}) {
  const requiredTypes = new Set(
    input.legalVersions.map((version) => version.id),
  );
  return (
    requiredTypes.size > 0 &&
    Array.from(requiredTypes).every((documentId) =>
      hasStoredAcceptance(input.acceptanceIds, documentId),
    )
  );
}

function resultList(value: unknown): Array<Record<string, unknown>> {
  const items = Array.isArray(value) ? value : [value];
  return items.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function emailTriggerSucceeded(value: unknown): boolean {
  const items = resultList(value);
  return items.length > 0 && items.every((item) => item.ok !== false);
}

// Truthful per-event dispatch status derived from the actual
// communication_logs rows created by the trigger (the source of truth) —
// never from the mere absence of an exception. 'queued' means a log +
// outbox row exists; 'sent' only when the provider already confirmed it.
function emailDispatchStatus(
  value: unknown,
): "sent" | "queued" | "skipped" | "failed" {
  const items = resultList(value);
  const statuses = items.map((item) => {
    const log = (item as { log?: { status?: unknown } }).log;
    return typeof log?.status === "string" ? log.status : null;
  });
  if (statuses.some((status) => status === "sent" || status === "delivered"))
    return "sent";
  if (statuses.some((status) => status === "queued")) return "queued";
  if (items.some((item) => item.skipped === true)) return "skipped";
  return "failed";
}

async function loadOfferBoundLegalVersions(input: {
  companyId: string;
  publicOffer: PublicContractOffer;
}): Promise<WebsiteLegalAcceptanceVersion[]> {
  const offerVersions = input.publicOffer.legal_versions ?? [];
  if (offerVersions.length === 0) {
    throw new WebsiteApplicationError({
      message: "Det valda erbjudandet saknar ett exakt juridikpaket.",
      status: 422,
      code: "offer_legal_versions_missing",
      field: "offer_reference",
      stage: "legal_acceptance",
      hint: "Publicera om erbjudandet med ett komplett canonical juridikpaket. Kundens accept får aldrig bindas till tenantens senaste texter i efterhand.",
    });
  }

  const expectedIds = offerVersions.map((item) => item.id);
  if (
    new Set(expectedIds).size !== offerVersions.length ||
    expectedIds.some((id) => !isUuid(id)) ||
    !input.publicOffer.legal_bundle_version_id
  ) {
    throw new WebsiteApplicationError({
      message:
        "Erbjudandets juridikpaket innehåller ogiltiga eller dubbla dokument-ID:n.",
      status: 422,
      code: "offer_legal_versions_invalid",
      field: "offer_reference",
      stage: "legal_acceptance",
      hint: "Publicera om erbjudandet så att varje accept binds till exakt legal_bundle_version_documents.id.",
    });
  }

  const bundleResult = await supabaseService
    .from("legal_bundle_versions")
    .select("id,company_id,status,published_at,locked_at")
    .eq("id", input.publicOffer.legal_bundle_version_id)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (
    bundleResult.error ||
    !bundleResult.data ||
    !bundleResult.data.locked_at
  ) {
    throw new WebsiteApplicationError({
      message:
        "OPS kunde inte verifiera det låsta juridikpaketet för erbjudandet.",
      status: bundleResult.error ? 500 : 422,
      code: "offer_legal_bundle_unavailable",
      field: "offer_reference",
      stage: "legal_acceptance",
      hint: "Kör senaste migration och publicera om erbjudandet.",
      details: bundleResult.error
        ? schemaErrorDetail(bundleResult.error)
        : undefined,
    });
  }
  const verifiedBundle = bundleResult.data;
  if (
    !["published", "replaced", "archived"].includes(
      String(verifiedBundle.status),
    )
  ) {
    throw new WebsiteApplicationError({
      message: "Erbjudandets juridikpaket är inte publicerat och låst.",
      status: 422,
      code: "offer_legal_bundle_not_published",
      field: "offer_reference",
      stage: "legal_acceptance",
    });
  }

  const documents = await supabaseService
    .from("legal_bundle_version_documents")
    .select(
      "id,legal_bundle_version_id,module_key,title,rendered_body,template_version,content_sha256,created_at,unresolved_variables",
    )
    .eq("legal_bundle_version_id", input.publicOffer.legal_bundle_version_id)
    .in("id", expectedIds)
    .order("sort_order", { ascending: true });

  if (documents.error) {
    throw new WebsiteApplicationError({
      message:
        "OPS kunde inte läsa de exakta juridikdokument som hör till erbjudandet.",
      status: 500,
      code: "offer_legal_versions_unavailable",
      field: "legal_bundle_version_documents",
      stage: "legal_acceptance",
      hint: "Kör senaste migration och kontrollera erbjudandets canonical legal bundle.",
      details: schemaErrorDetail(documents.error),
    });
  }

  const loadedById = new Map(
    (documents.data ?? []).map((row) => [String(row.id), row]),
  );
  const ordered: Array<WebsiteLegalAcceptanceVersion | null> = offerVersions.map(
    (version) => {
      const row = loadedById.get(version.id);
      if (
        !row ||
        (Array.isArray(row.unresolved_variables) &&
          row.unresolved_variables.length > 0)
      ) {
        return null;
      }
      return {
        id: String(row.id),
        type: String(row.module_key),
        module_key: String(row.module_key),
        version:
          version.version ||
          String(row.template_version ?? row.created_at ?? row.id),
        title: String(row.title ?? version.title),
        body: String(row.rendered_body ?? ""),
        published_at:
          typeof verifiedBundle.published_at === "string"
            ? verifiedBundle.published_at
            : typeof row.created_at === "string"
              ? row.created_at
              : null,
        status: "published",
        content_sha256: String(
          row.content_sha256 ??
            createHash("sha256").update(String(row.rendered_body ?? ""), "utf8").digest("hex"),
        ),
        legal_bundle_version_id: String(row.legal_bundle_version_id),
      } satisfies WebsiteLegalAcceptanceVersion;
    },
  );

  if (ordered.some((row) => !row)) {
    throw new WebsiteApplicationError({
      message:
        "Erbjudandets låsta juridikdokument saknas, innehåller olösta variabler eller matchar inte publiceringsversionen.",
      status: 422,
      code: "offer_legal_version_mismatch",
      field: "offer_reference",
      stage: "legal_acceptance",
      hint: "Hämta ett nytt offer_reference från public-contracts. Ett gammalt erbjudande får inte accepteras mot andra juridikdokument.",
    });
  }

  return ordered.filter(
    (row): row is WebsiteLegalAcceptanceVersion => row !== null,
  );
}

async function assertWebsiteLegalAcceptances(input: {
  companyId: string;
  consents?: Record<string, unknown>;
  publicOffer: PublicContractOffer;
}): Promise<WebsiteLegalAcceptanceVersion[]> {
  const requirements = requiredWebsiteLegalAcceptances(input.publicOffer);
  const missingConsents = requirements.filter(
    (item) => !consentAccepted(input.consents, item.aliases),
  );
  if (missingConsents.length > 0) {
    throw new WebsiteApplicationError({
      message: `Kunden måste godkänna ${missingConsents.map((item) => item.label).join(", ")} innan ansökan kan skickas.`,
      status: 422,
      code: "legal_acceptance_missing",
      field: missingConsents[0]?.field ?? "consents",
      stage: "legal_acceptance",
      hint: "Skicka separata consent-flaggor för villkor, integritet, ångerrätt, fullmakt och prisvillkor.",
    });
  }

  return loadOfferBoundLegalVersions({
    companyId: input.companyId,
    publicOffer: input.publicOffer,
  });
}

type CustomerLegalAcceptanceEvidenceInput = {
  companyId: string;
  customerId: string;
  contractId: string | null;
  applicationId: string;
  publicOffer: PublicContractOffer | null;
  legalVersions: WebsiteLegalAcceptanceVersion[];
  consents?: Record<string, unknown>;
  rawPayload: unknown;
  requestAudit?: RequestAuditMetadata;
  acceptedAt: string;
};

function buildCustomerLegalAcceptanceEvidence(
  input: CustomerLegalAcceptanceEvidenceInput,
) {
  if (input.legalVersions.length === 0) return [];
  const now = input.acceptedAt;
  const requirements = input.publicOffer
    ? requiredWebsiteLegalAcceptances(input.publicOffer)
    : [];
  const definitionsByType = new Map(
    requirements.map((definition) => [definition.legalType, definition]),
  );
  const rows = input.legalVersions
    .map((legal) => {
      const legalType = legalAcceptanceTypeForModule(
        legal.module_key ?? legal.type,
      );
      const definition = definitionsByType.get(legalType);
      if (!definition) return null;
      return {
        company_id: input.companyId,
        customer_id: input.customerId,
        contract_id: input.contractId,
        contract_application_id: input.applicationId,
        acceptance_type: definition.acceptanceType,
        legal_text_version_id: null,
        legal_bundle_version_document_id: legal.id,
        legal_module_key: legal.module_key ?? legal.type,
        legal_document_version: legal.version,
        legal_document_sha256:
          legal.content_sha256 ??
          createHash("sha256").update(legal.body ?? "", "utf8").digest("hex"),
        request_id: input.requestAudit?.requestId ?? null,
        trace_id: input.requestAudit?.traceId ?? null,
        accepted_at: now,
        accepted_ip: input.requestAudit?.ipAddress ?? null,
        accepted_ip_hash: input.requestAudit?.ipHash ?? null,
        accepted_user_agent: input.requestAudit?.userAgent ?? null,
        source: "website",
        snapshot: {
          legal_text: {
            id: legal.id,
            type: legal.type,
            module_key: legal.module_key ?? legal.type,
            version: legal.version,
            title: legal.title,
            body: legal.body,
            published_at: legal.published_at,
          },
          public_offer: input.publicOffer,
          consent_key: definition.field,
          consents: input.consents ?? {},
        },
        metadata: {
          source: "website_customer_applications",
          application_id: input.applicationId,
          request_audit: input.requestAudit ?? {},
          raw_payload: input.rawPayload,
        },
      };
    })
    .filter(Boolean);

  return rows;
}

async function persistCustomerLegalAcceptances(
  input: CustomerLegalAcceptanceEvidenceInput,
): Promise<Record<string, string>> {
  if (input.legalVersions.length === 0) return {};
  const rows = buildCustomerLegalAcceptanceEvidence(input);
  const requirements = input.publicOffer
    ? requiredWebsiteLegalAcceptances(input.publicOffer)
    : [];
  const { data, error } = await supabaseService
    .from("customer_legal_acceptances")
    .insert(rows)
    .select("id,acceptance_type,legal_bundle_version_document_id");
  if (error) {
    // Required legal evidence — a schema mismatch must fail clearly so we never
    // persist a "complete" customer without recorded legal acceptances.
    if (missingSchema(error)) {
      throw new WebsiteApplicationError({
        message:
          "Juridiska godkännanden kunde inte sparas eftersom databasens schema för customer_legal_acceptances inte matchar.",
        status: 500,
        code: "legal_bundle_missing",
        field: "customer_legal_acceptances",
        stage: "legal_acceptance",
        hint: "Kör senaste migration för customer_legal_acceptances och retrya ansökan.",
        details: schemaErrorDetail(error),
      });
    }
    throw error;
  }

  // Map acceptance_type -> id, keyed back to the canonical legal type so the
  // API response can expose legal_acceptances ids.
  const acceptanceTypeToLegalType = new Map(
    requirements.map((item) => [item.acceptanceType, item.legalType]),
  );
  const ids: Record<string, string> = {};
  for (const acceptanceRow of (data ?? []) as Array<{
    id: string;
    acceptance_type: string;
    legal_bundle_version_document_id: string;
  }>) {
    const legalType = acceptanceTypeToLegalType.get(
      acceptanceRow.acceptance_type,
    );
    if (acceptanceRow.legal_bundle_version_document_id && acceptanceRow.id) {
      ids[acceptanceRow.legal_bundle_version_document_id] = String(
        acceptanceRow.id,
      );
    }
    if (legalType && acceptanceRow.id && !ids[legalType]) {
      ids[legalType] = String(acceptanceRow.id);
    }
  }
  return ids;
}

// Loads a specific legal text version by id, scoped to the tenant. Used so the
// website API binds the POA to the active legal text it references rather than
// any text supplied by the frontend.
async function loadLegalTextVersionById(
  companyId: string,
  textVersionId: string | null,
): Promise<WebsiteLegalAcceptanceVersion | null> {
  if (!textVersionId) return null;
  if (!isUuid(textVersionId)) {
    throw new WebsiteApplicationError({
      message:
        "Angiven fullmaktsversion (textVersionId) måste vara ett immutable OPS-dokument-ID i UUID-format, inte ett versionsnamn.",
      status: 422,
      code: "power_of_attorney_version_invalid",
      field: "powerOfAttorney.textVersionId",
      stage: "power_of_attorney",
      hint: "Hämta legal.power_of_attorney_version_id från GET /api/v1/website/public-contracts och skicka det som powerOfAttorney.textVersionId.",
      details: {
        expected: "uuid",
        received_format: "version_label_or_invalid_uuid",
      },
    });
  }

  const exact = await supabaseService
    .from("legal_bundle_version_documents")
    .select(
      "id,legal_bundle_version_id,module_key,title,rendered_body,template_version,created_at,unresolved_variables",
    )
    .eq("id", textVersionId)
    .eq("module_key", "power_of_attorney")
    .maybeSingle();
  if (exact.error && !missingSchema(exact.error)) throw exact.error;
  if (exact.data) {
    const bundle = await supabaseService
      .from("legal_bundle_versions")
      .select("company_id,status,published_at,locked_at")
      .eq("id", exact.data.legal_bundle_version_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (bundle.error && !missingSchema(bundle.error)) throw bundle.error;
    if (
      bundle.data?.locked_at &&
      ["published", "replaced", "archived"].includes(
        String(bundle.data.status),
      ) &&
      (!Array.isArray(exact.data.unresolved_variables) ||
        exact.data.unresolved_variables.length === 0)
    ) {
      return {
        id: String(exact.data.id),
        type: "power_of_attorney",
        version: String(
          exact.data.template_version ??
            bundle.data.published_at ??
            exact.data.created_at ??
            exact.data.id,
        ),
        title: String(exact.data.title),
        body: String(exact.data.rendered_body ?? ""),
        published_at:
          typeof bundle.data.published_at === "string"
            ? bundle.data.published_at
            : typeof exact.data.created_at === "string"
              ? exact.data.created_at
              : null,
        status: "published",
      };
    }
    return null;
  }

  // Historical fallback for contracts issued before canonical bundle documents
  // became the public evidence id. New publications never use this path.
  const legacy = await supabaseService
    .from("legal_text_versions")
    .select("id,type,version,title,body,published_at,status")
    .eq("company_id", companyId)
    .eq("id", textVersionId)
    .eq("type", "power_of_attorney")
    .eq("status", "published")
    .maybeSingle();
  if (legacy.error) {
    if (missingSchema(legacy.error)) {
      throw new WebsiteApplicationError({
        message:
          "Fullmaktsversionen kunde inte läsas eftersom canonical juridikmigrationen saknas.",
        status: 500,
        code: "legal_bundle_missing",
        field: "legal_bundle_version_documents",
        stage: "legal_acceptance",
        hint: "Kör senaste migration och retrya ansökan.",
        details: schemaErrorDetail(legacy.error),
      });
    }
    throw legacy.error;
  }
  return (legacy.data as WebsiteLegalAcceptanceVersion | null) ?? null;
}

async function ensureWebsitePowerOfAttorney(input: {
  companyId: string;
  customerId: string;
  contractId: string | null;
  customerSiteId: string | null;
  meteringPointId: string | null;
  applicationId: string;
  publicOffer: PublicContractOffer | null;
  legalVersions: WebsiteLegalAcceptanceVersion[];
  consents?: Record<string, unknown>;
  requestAudit?: RequestAuditMetadata;
  rawPayload: unknown;
  structuredPoa?: NormalizedStructuredPoa | null;
}) {
  if (
    !consentAccepted(input.consents, [
      "power_of_attorney",
      "poa_accepted",
      "power_of_attorney_accepted",
    ])
  )
    return null;
  if (input.structuredPoa?.accepted !== true) return null;
  if (input.structuredPoa.scope.length === 0) {
    throw new WebsiteApplicationError({
      message: "Signerad fullmakt saknar exakt scope.",
      status: 422,
      code: "power_of_attorney_scope_missing",
      field: "powerOfAttorney.scope",
      stage: "power_of_attorney",
    });
  }
  // Never trust frontend legal text: prefer the explicitly referenced active
  // legal version (textVersionId), then the published power_of_attorney version.
  const requestedVersionId = input.structuredPoa?.textVersionId ?? null;
  let referencedLegal: WebsiteLegalAcceptanceVersion | null = null;
  if (requestedVersionId) {
    // loadLegalTextVersionById throws on schema mismatch, so a null result here
    // means the supplied textVersionId does not belong to this tenant.
    referencedLegal = await loadLegalTextVersionById(
      input.companyId,
      requestedVersionId,
    );
    if (!referencedLegal) {
      throw new WebsiteApplicationError({
        message:
          "Angiven fullmaktsversion (textVersionId) tillhör inte detta bolag eller finns inte.",
        status: 422,
        code: "power_of_attorney_version_tenant_mismatch",
        field: "powerOfAttorney.textVersionId",
        stage: "power_of_attorney",
        hint: "Skicka en textVersionId som tillhör samma bolag som API-nyckeln, eller utelämna fältet så används den publicerade fullmaktsversionen.",
      });
    }
    if (referencedLegal.type !== "power_of_attorney") {
      throw new WebsiteApplicationError({
        message:
          "Angiven textVersionId refererar inte till en fullmaktsversion.",
        status: 422,
        code: "power_of_attorney_version_missing",
        field: "powerOfAttorney.textVersionId",
        stage: "power_of_attorney",
      });
    }
    if (referencedLegal.status && referencedLegal.status !== "published") {
      throw new WebsiteApplicationError({
        message: "Angiven fullmaktsversion är inte publicerad.",
        status: 422,
        code: "power_of_attorney_version_not_published",
        field: "powerOfAttorney.textVersionId",
        stage: "power_of_attorney",
        hint: "Publicera fullmaktsversionen i bolagskortet innan kunder kan acceptera den.",
      });
    }
  }
  const legal =
    referencedLegal ??
    input.legalVersions.find((row) => row.type === "power_of_attorney");
  if (!legal) {
    // POA consent was given (gated above) but no published power_of_attorney
    // legal version exists for this tenant. This must fail clearly.
    throw new WebsiteApplicationError({
      message:
        "Det finns ingen publicerad fullmaktsversion för bolaget, men kunden har accepterat fullmakt.",
      status: 422,
      code: "power_of_attorney_version_missing",
      field: "powerOfAttorney",
      stage: "power_of_attorney",
      hint: "Publicera en power_of_attorney-version i bolagskortet i OPS.",
    });
  }

  const now = new Date().toISOString();
  const submittedStructuredPoaIsSendable = structuredPoaIsExternallySendable(
    input.structuredPoa ?? null,
  );
  let existingQuery = supabaseService
    .from("powers_of_attorney")
    .select(
      "id,signer_name,signer_identity_number,method,evidence_payload,metadata",
    )
    .eq("company_id", input.companyId)
    .eq("customer_id", input.customerId)
    .eq("scope", "supplier_switch")
    .in("status", ["active", "accepted", "signed"]);

  existingQuery = input.contractId
    ? existingQuery.eq("contract_id", input.contractId)
    : existingQuery.is("contract_id", null);

  const existing = await existingQuery.limit(1).maybeSingle();

  if (existing.error && !missingSchema(existing.error)) throw existing.error;
  if (existing.data?.id) {
    const existingEvidence = existing.data.evidence_payload as
      Record<string, unknown> | null | undefined;
    const existingMetadata = existing.data.metadata as
      Record<string, unknown> | null | undefined;
    const existingIsStructuredComplete =
      existingEvidence?.capture_type === "structured_complete" ||
      existingEvidence?.externally_sendable_at_capture === true ||
      existingMetadata?.poa_capture_type === "structured_complete" ||
      existingMetadata?.externally_sendable === true;
    const existingLooksSendable = Boolean(
      clean(existing.data.signer_name) &&
      clean(existing.data.signer_identity_number) &&
      clean(existing.data.method) &&
      existingIsStructuredComplete,
    );
    // Reuse weak/legacy rows for weak submissions, and reuse complete rows for
    // complete submissions. If a customer later submits a complete structured
    // POA after an older weak one, insert a fresh complete row instead of
    // letting the weak row block external sendability.
    if (!submittedStructuredPoaIsSendable || existingLooksSendable) {
      const existingPowerOfAttorneyId = String(existing.data.id);
      await ensureWebsiteAuthorizationChainFromPowerOfAttorney({
        companyId: input.companyId,
        customerId: input.customerId,
        contractId: input.contractId,
        customerSiteId: input.customerSiteId,
        meteringPointId: input.meteringPointId,
        powerOfAttorneyId: existingPowerOfAttorneyId,
        applicationId: input.applicationId,
        reference: `POA-${input.applicationId}`,
        scopes: input.structuredPoa.scope,
        legal,
        snapshot: {
          source: "website_customer_applications",
          application_id: input.applicationId,
          reused_power_of_attorney_id: existingPowerOfAttorneyId,
          legal_text: {
            id: legal.id,
            type: legal.type,
            version: legal.version,
            title: legal.title,
          },
        },
        evidencePayload: {
          reused: true,
          legal_text_version_id: legal.id,
          source: "website_api",
        },
      });
      return existingPowerOfAttorneyId;
    }
  }

  const poa =
    input.structuredPoa?.accepted === true ? input.structuredPoa : null;
  const externallySendableAtCapture = structuredPoaIsExternallySendable(poa);
  const scopes = poa?.scope ?? [];
  const acceptedAt = poa?.acceptedAt ?? now;
  const method = poa?.method ?? null;
  // Legacy consent-only creates an internal legal acceptance only. It must not
  // silently inherit signer name, identity number or method from the customer
  // record, because that would make a weak consent look externally sendable.
  const signerName = poa?.signerName ?? null;
  const signerIdentityNumber = poa?.signerIdentityNumber ?? null;

  const snapshot = {
    legal_text: {
      id: legal.id,
      type: legal.type,
      version: legal.version,
      title: legal.title,
      body: legal.body,
      published_at: legal.published_at,
    },
    public_offer: input.publicOffer,
    consents: input.consents ?? {},
    application_id: input.applicationId,
    accepted_at: acceptedAt,
    scopes,
  };

  const evidencePayload = {
    accepted: true,
    accepted_at: acceptedAt,
    method,
    scopes,
    signer_name: signerName,
    signer_identity_number: signerIdentityNumber,
    ip_address: poa?.ipAddress ?? input.requestAudit?.ipAddress ?? null,
    user_agent: poa?.userAgent ?? input.requestAudit?.userAgent ?? null,
    legal_text_version_id: legal.id,
    legal_text_version: legal.version,
    source: "website_api",
    externally_sendable_at_capture: externallySendableAtCapture,
    requires_completion: !externallySendableAtCapture,
    capture_type: externallySendableAtCapture
      ? "structured_complete"
      : "legacy_weak_consent",
  };

  const row = {
    company_id: input.companyId,
    customer_id: input.customerId,
    contract_id: input.contractId,
    site_id: input.customerSiteId,
    customer_site_id: input.customerSiteId,
    metering_point_id: input.meteringPointId,
    scope: "supplier_switch",
    status: "signed",
    signed_at: now,
    accepted_at: acceptedAt,
    valid_from: now.slice(0, 10),
    legal_text_version_id: legal.id,
    fullmakt_snapshot: snapshot,
    signer_name: signerName,
    signer_identity_number: signerIdentityNumber,
    method,
    evidence_payload: evidencePayload,
    source: "website_api",
    accepted_ip: poa?.ipAddress ?? input.requestAudit?.ipAddress ?? null,
    accepted_ip_hash: input.requestAudit?.ipHash ?? null,
    accepted_user_agent:
      poa?.userAgent ?? input.requestAudit?.userAgent ?? null,
    accepted_source: "website",
    reference: `POA-${input.applicationId}`,
    scope_summary: {
      scopes,
      supplier_switch: true,
      facility_information_lookup: scopes.includes(
        "facility_information_lookup",
      ),
      customer_site_id: input.customerSiteId,
      metering_point_id: input.meteringPointId,
      contract_id: input.contractId,
    },
    metadata: {
      source: "website_customer_applications",
      application_id: input.applicationId,
      raw_payload: input.rawPayload,
      poa_capture_type: externallySendableAtCapture
        ? "structured_complete"
        : "legacy_weak_consent",
      externally_sendable: externallySendableAtCapture,
      requires_completion: !externallySendableAtCapture,
    },
    updated_at: now,
  };

  const { data, error } = await supabaseService
    .from("powers_of_attorney")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    // Do NOT silently swallow schema mismatches here. A required power of
    // attorney that cannot be persisted must fail the whole application so we
    // never produce a "complete" customer without legal authorization.
    if (missingSchema(error)) {
      throw new WebsiteApplicationError({
        message:
          "Fullmakten kunde inte sparas eftersom databasens schema för powers_of_attorney inte matchar.",
        status: 500,
        code: "powers_of_attorney_schema_mismatch",
        field: "powers_of_attorney",
        stage: "power_of_attorney",
        hint: "Kör senaste migration för powers_of_attorney och retrya ansökan från admin.",
        details: schemaErrorDetail(error),
      });
    }
    throw error;
  }

  const powerOfAttorneyId = data?.id ? String(data.id) : null;
  if (powerOfAttorneyId) {
    const scopeResult = await supabaseService
      .from("power_of_attorney_scopes")
      .insert({
        company_id: input.companyId,
        power_of_attorney_id: powerOfAttorneyId,
        customer_id: input.customerId,
        site_id: input.customerSiteId,
        metering_point_id: input.meteringPointId,
        customer_contract_id: input.contractId,
        scope_type: "supplier_switch",
        status: "active",
        is_active: true,
        valid_from: now.slice(0, 10),
        metadata: {
          source: "website_customer_applications",
          application_id: input.applicationId,
        },
      });

    if (scopeResult.error && !missingSchema(scopeResult.error))
      throw scopeResult.error;

    // Immutable POA document snapshot (JSON) linked back onto the POA row.
    const documentId = await createPowerOfAttorneyDocumentSnapshot({
      companyId: input.companyId,
      customerId: input.customerId,
      contractId: input.contractId,
      customerSiteId: input.customerSiteId,
      meteringPointId: input.meteringPointId,
      powerOfAttorneyId,
      reference: row.reference,
      snapshot,
      evidencePayload,
    });
    const authorizationDocumentId =
      await ensureWebsiteAuthorizationChainFromPowerOfAttorney({
        companyId: input.companyId,
        customerId: input.customerId,
        contractId: input.contractId,
        customerSiteId: input.customerSiteId,
        meteringPointId: input.meteringPointId,
        powerOfAttorneyId,
        applicationId: input.applicationId,
        reference: row.reference,
        scopes,
        legal,
        snapshot,
        evidencePayload,
        internalSnapshotDocumentId: documentId,
      });

    if (authorizationDocumentId || documentId) {
      // The operational document_id must point at the authorization document chain
      // used by customer_info_requests/grid_owner_data_requests/outbound_requests.
      // The old customer_documents JSON snapshot is retained only as internal audit
      // metadata and must never be mailed to a grid owner as the POA attachment.
      await supabaseService
        .from("powers_of_attorney")
        .update({
          document_id: authorizationDocumentId ?? documentId,
          metadata: {
            ...row.metadata,
            authorization_document_id: authorizationDocumentId,
            internal_snapshot_document_id: documentId,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", powerOfAttorneyId)
        .then(
          () => undefined,
          () => undefined,
        );
    }

    // Audit trail: created + accepted (+ internal JSON snapshot created). The
    // JSON snapshot is NOT a generated PDF, so it is recorded as
    // `snapshot_created`. A real `pdf_generated` event is only emitted when an
    // actual PDF is rendered for external grid-owner communication.
    await supabaseService
      .from("power_of_attorney_events")
      .insert([
        {
          company_id: input.companyId,
          power_of_attorney_id: powerOfAttorneyId,
          event_type: "created",
          payload: {
            application_id: input.applicationId,
            source: "website_api",
          },
        },
        {
          company_id: input.companyId,
          power_of_attorney_id: powerOfAttorneyId,
          event_type: "accepted",
          payload: evidencePayload,
        },
        ...(documentId
          ? [
              {
                company_id: input.companyId,
                power_of_attorney_id: powerOfAttorneyId,
                event_type: "snapshot_created" as const,
                payload: {
                  document_id: documentId,
                  mime_type: "application/json",
                  internal_snapshot: true,
                },
              },
            ]
          : []),
      ])
      .then(
        () => undefined,
        () => undefined,
      );
  }

  return powerOfAttorneyId;
}

// Creates an immutable JSON document snapshot for a power of attorney and stores
// it in customer_documents (best-effort; tolerant of missing schema).
async function createPowerOfAttorneyDocumentSnapshot(input: {
  companyId: string;
  customerId: string;
  contractId: string | null;
  customerSiteId: string | null;
  meteringPointId: string | null;
  powerOfAttorneyId: string;
  reference: string;
  snapshot: Record<string, unknown>;
  evidencePayload: Record<string, unknown>;
}): Promise<string | null> {
  const documentRow = {
    company_id: input.companyId,
    customer_id: input.customerId,
    customer_site_id: input.customerSiteId,
    metering_point_id: input.meteringPointId,
    contract_id: input.contractId,
    power_of_attorney_id: input.powerOfAttorneyId,
    document_type: "power_of_attorney",
    title: `Signerad fullmakt ${input.reference}`,
    file_name: `fullmakt-${input.reference}.json`,
    mime_type: "application/json",
    status: "available",
    source: "website_customer_applications",
    source_system: "ops_powers_of_attorney",
    raw_payload: { snapshot: input.snapshot, evidence: input.evidencePayload },
    // Mark explicitly as the internal JSON snapshot. External grid-owner email
    // must attach a PDF (rendered or uploaded), never this JSON record.
    metadata: {
      document_kind: "json_snapshot",
      internal_snapshot: true,
      external_pdf: false,
    },
  };
  const { data, error } = await supabaseService
    .from("customer_documents")
    .insert(documentRow)
    .select("id")
    .maybeSingle();
  if (error) {
    if (missingSchema(error)) return null;
    // Document storage is non-fatal for the POA write path.
    return null;
  }
  return data?.id ? String(data.id) : null;
}

async function ensureWebsiteAuthorizationChainFromPowerOfAttorney(input: {
  companyId: string;
  customerId: string;
  contractId: string | null;
  customerSiteId: string | null;
  meteringPointId: string | null;
  powerOfAttorneyId: string;
  applicationId: string;
  reference: string;
  scopes: string[];
  legal: WebsiteLegalAcceptanceVersion;
  snapshot: Record<string, unknown>;
  evidencePayload: Record<string, unknown>;
  internalSnapshotDocumentId?: string | null;
}): Promise<string | null> {
  const now = new Date().toISOString();
  const existing = await supabaseService
    .from("customer_authorization_documents")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("customer_id", input.customerId)
    .eq("power_of_attorney_id", input.powerOfAttorneyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error && !missingSchema(existing.error)) throw existing.error;

  let authorizationDocumentId = existing.data?.id
    ? String(existing.data.id)
    : null;
  if (!authorizationDocumentId) {
    const snapshotJson = JSON.stringify(
      {
        source: "website_customer_applications",
        application_id: input.applicationId,
        power_of_attorney_id: input.powerOfAttorneyId,
        reference: input.reference,
        snapshot: input.snapshot,
        evidence: input.evidencePayload,
        legal_text_version_id: input.legal.id,
        legal_text_version: input.legal.version,
        scopes: input.scopes,
      },
      null,
      2,
    );
    const filePath = `companies/${input.companyId}/customers/${input.customerId}/authorizations/${input.powerOfAttorneyId}.json`;
    const fileSizeBytes = new TextEncoder().encode(snapshotJson).byteLength;
    const uploadIdempotencyKey = `website-poa:${input.companyId}:${input.applicationId}:${input.powerOfAttorneyId}`;

    const uploadResult = await supabaseService.storage
      .from("customer-documents")
      .upload(filePath, snapshotJson, {
        contentType: "application/json",
        upsert: true,
      });

    if (uploadResult.error) {
      throw new WebsiteApplicationError({
        message: "Fullmaktens JSON-snapshot kunde inte sparas i storage.",
        status: 500,
        code: "power_of_attorney_snapshot_storage_failed",
        field: "customer_authorization_documents.file_path",
        stage: "power_of_attorney",
        details: schemaErrorDetail(uploadResult.error),
      });
    }

    const baseRow: Record<string, unknown> = {
      company_id: input.companyId,
      customer_id: input.customerId,
      site_id: input.customerSiteId,
      metering_point_id: input.meteringPointId,
      customer_contract_id: input.contractId,
      power_of_attorney_id: input.powerOfAttorneyId,
      document_type: "power_of_attorney",
      status: "uploaded",
      title: `Signerad fullmakt ${input.reference}`,
      file_name: `fullmakt-${input.reference}.json`,
      mime_type: "application/json",
      file_size_bytes: fileSizeBytes,
      storage_bucket: "customer-documents",
      file_path: filePath,
      reference: input.reference,
      notes: "Website POA snapshot bound to operational authorization chain.",
      uploaded_at: now,
      upload_idempotency_key: uploadIdempotencyKey,
      metadata: {
        source: "website_customer_applications",
        application_id: input.applicationId,
        legal_text_version_id: input.legal.id,
        legal_text_version: input.legal.version,
        scopes: input.scopes,
        snapshot: input.snapshot,
        evidence: input.evidencePayload,
        internal_snapshot_document_id: input.internalSnapshotDocumentId ?? null,
      },
    };

    let inserted = await supabaseService
      .from("customer_authorization_documents")
      .insert(baseRow)
      .select("id")
      .maybeSingle();

    if (inserted.error && missingSchema(inserted.error)) {
      const fallbackRow = { ...baseRow };
      delete fallbackRow.customer_contract_id;
      delete fallbackRow.metering_point_id;
      delete fallbackRow.file_size_bytes;
      delete fallbackRow.upload_idempotency_key;
      inserted = await supabaseService
        .from("customer_authorization_documents")
        .insert(fallbackRow)
        .select("id")
        .maybeSingle();
    }

    if (inserted.error) {
      if (missingSchema(inserted.error)) {
        throw new WebsiteApplicationError({
          message:
            "Fullmaktens authorization document kunde inte sparas eftersom customer_authorization_documents saknas eller har fel schema.",
          status: 500,
          code: "customer_authorization_document_schema_mismatch",
          field: "customer_authorization_documents",
          stage: "power_of_attorney",
          hint: "Kör senaste migration för customer_authorization_documents och authorization_scopes innan ansökan retryas.",
          details: schemaErrorDetail(inserted.error),
        });
      }
      throw inserted.error;
    }
    authorizationDocumentId = inserted.data?.id
      ? String(inserted.data.id)
      : null;
  }

  if (authorizationDocumentId) {
    const existingScope = await supabaseService
      .from("authorization_scopes")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("customer_id", input.customerId)
      .eq("authorization_document_id", authorizationDocumentId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (existingScope.error && !missingSchema(existingScope.error))
      throw existingScope.error;

    if (!existingScope.data?.id) {
      const normalizedScopes = new Set(input.scopes.map((scope) => scope.trim().toLowerCase()).filter(Boolean));
      if (normalizedScopes.size === 0) {
        throw new WebsiteApplicationError({
          message: "Authorization scope kan inte skapas utan signerade scopes.",
          status: 422,
          code: "authorization_scope_snapshot_missing",
          field: "powerOfAttorney.scope",
          stage: "power_of_attorney",
        });
      }
      const coversGridOwnerData =
        normalizedScopes.has("grid_owner_data") ||
        normalizedScopes.has("facility_information_lookup") ||
        normalizedScopes.has("supplier_switch");
      const coversCurrentSupplierContract =
        normalizedScopes.has("current_supplier_contract") || normalizedScopes.has("supplier_switch");
      const coversMeteringData =
        normalizedScopes.has("metering_data") || normalizedScopes.has("facility_information_lookup");
      const signedScopeSnapshot = [...normalizedScopes];
      const scopeInsert = await supabaseService
        .from("authorization_scopes")
        .insert({
          company_id: input.companyId,
          customer_id: input.customerId,
          authorization_document_id: authorizationDocumentId,
          scope_type: "supplier_switch_data",
          status: "active",
          covers_grid_owner_data: coversGridOwnerData,
          covers_current_supplier_contract: coversCurrentSupplierContract,
          covers_metering_data: coversMeteringData,
          signed_scope_snapshot: signedScopeSnapshot,
          valid_from: now.slice(0, 10),
          evidence_note:
            "Signerad website-fullmakt verifierad och kopplad till uppgifts-/leverantörsbytesflödet.",
          metadata: {
            source: "website_customer_applications",
            application_id: input.applicationId,
            power_of_attorney_id: input.powerOfAttorneyId,
            authorization_document_id: authorizationDocumentId,
            scopes: input.scopes,
          },
        });
      if (scopeInsert.error) {
        if (missingSchema(scopeInsert.error)) {
          throw new WebsiteApplicationError({
            message:
              "Fullmaktens authorization scope kunde inte sparas eftersom authorization_scopes saknas eller har fel schema.",
            status: 500,
            code: "authorization_scope_schema_mismatch",
            field: "authorization_scopes",
            stage: "power_of_attorney",
            hint: "Kör senaste migration för authorization_scopes innan ansökan retryas.",
            details: schemaErrorDetail(scopeInsert.error),
          });
        }
        throw scopeInsert.error;
      }
    }
  }

  return authorizationDocumentId;
}

type CustomerRow = {
  id: string;
  customer_number: string | null;
  email: string | null;
  full_name: string | null;
  company_name: string | null;
};

type ErrorStage =
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
  | "facility_lookup"
  | "email_dispatch";

class WebsiteApplicationError extends Error {
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

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// Like clean(), but only returns values safe to write into uuid columns.
// Non-UUID inputs (e.g. human-readable version names) are dropped instead of
// crashing the insert with `invalid input syntax for type uuid`.
function cleanUuid(value: unknown): string | null {
  const cleaned = clean(value);
  return isUuid(cleaned) ? cleaned : null;
}

function duplicateIdempotencyKey(error: unknown): boolean {
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

function duplicateBusinessKey(error: unknown): boolean {
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

function normalizedEmail(value: unknown): string | null {
  return clean(value)?.toLowerCase() ?? null;
}

function digits(value: unknown): string | null {
  const output = clean(value)?.replace(/\D/g, "") ?? "";
  return output || null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorMessage(error: unknown): string {
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

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return (
    ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(code) ||
    /schema cache|does not exist|column .* does not exist|could not find the function/i.test(
      message,
    )
  );
}

function schemaRepairStatus(error: unknown): "pending_review" | null {
  return missingSchema(error) ? "pending_review" : null;
}

// Builds a non-sensitive diagnostic detail from a database error. Only the
// Postgres/PostgREST error code and a truncated message are surfaced — never
// row data, identity numbers or payloads.
function schemaErrorDetail(error: unknown): {
  db_code: string | null;
  db_message: string | null;
} {
  const code = (error as { code?: string } | null)?.code ?? null;
  const rawMessage = (error as { message?: string } | null)?.message ?? null;
  const message = rawMessage ? rawMessage.slice(0, 300) : null;
  return { db_code: code, db_message: message };
}

const WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE = "website_application";
const WEBSITE_APPLICATION_CONTRACT_CHANNEL = "external_website";
const WEBSITE_APPLICATION_READY_CONTRACT_STATUS = "pending_signature";
const WEBSITE_APPLICATION_SIGNED_CONTRACT_STATUS = "signed";
const WEBSITE_PORTAL_PROVIDER = "gridex_website";

type RequestAuditMetadata = {
  ipAddress?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  traceId?: string | null;
};

function timelineEvent(
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

function reviewAuditEvent(
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

async function updateCustomerIntakeStatus(
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

function calculatedEarliestStartDate(): string {
  // MVP-policy: produktion räknar datum server-side, inte i UI. Detta kan senare ersättas med tenant-/nätägarregler.
  return addBusinessDays(new Date(), 14).toISOString().slice(0, 10);
}

function requestedStartModeFromInput(
  input: ApplicationInput,
): "earliest_possible" | "specific_date" {
  const raw =
    clean(input.requested_start_mode) ??
    clean(input.requestedStartMode) ??
    clean(input.contract?.requested_start_mode) ??
    clean(input.contract?.requestedStartMode);
  return raw === "specific_date" ? "specific_date" : "earliest_possible";
}

function explicitGridAreaCodeFromInput(input: ApplicationInput): string | null {
  return (
    clean(input.site?.grid_area_code) ??
    clean(input.site?.gridAreaCode) ??
    clean(input.metering_point?.grid_area_code) ??
    clean(input.metering_point?.gridAreaCode) ??
    clean(input.grid_area_code) ??
    clean(input.gridAreaCode)
  );
}

function explicitPriceAreaCodeFromInput(
  input: ApplicationInput,
): string | null {
  return (
    clean(input.site?.price_area_code) ??
    clean(input.site?.price_area) ??
    clean(input.metering_point?.price_area_code) ??
    clean(input.metering_point?.price_area) ??
    clean(input.price_area_code) ??
    clean(input.priceAreaCode)
  );
}

function explicitGridOwnerIdFromInput(input: ApplicationInput): string | null {
  return (
    clean(input.site?.grid_owner_id) ??
    clean(input.site?.gridOwnerId) ??
    clean(input.grid_owner_id) ??
    clean(input.network_owner_id)
  );
}

function normalizePriceAreaCode(value: unknown): string | null {
  return clean(value)?.toUpperCase() ?? null;
}

function explicitSiteGridAreaCode(input: ApplicationInput): string | null {
  return (
    clean(input.site?.grid_area_code) ??
    clean(input.site?.gridAreaCode) ??
    clean(input.grid_area_code) ??
    clean(input.gridAreaCode) ??
    clean(input.metering_point?.grid_area_code) ??
    clean(input.metering_point?.gridAreaCode)
  );
}

function explicitSitePriceAreaCode(input: ApplicationInput): string | null {
  return normalizePriceAreaCode(
    clean(input.site?.price_area_code) ??
      clean(input.site?.price_area) ??
      clean(input.price_area_code) ??
      clean(input.priceAreaCode) ??
      clean(input.metering_point?.price_area_code) ??
      clean(input.metering_point?.price_area),
  );
}

function explicitSiteGridOwnerId(input: ApplicationInput): string | null {
  return (
    clean(input.site?.grid_owner_id) ??
    clean(input.site?.gridOwnerId) ??
    clean(input.grid_owner_id) ??
    clean(input.network_owner_id)
  );
}

function explicitMeteringGridAreaCode(input: ApplicationInput): string | null {
  return (
    clean(input.metering_point?.grid_area_code) ??
    clean(input.metering_point?.gridAreaCode) ??
    explicitSiteGridAreaCode(input)
  );
}

function explicitMeteringPriceAreaCode(input: ApplicationInput): string | null {
  return normalizePriceAreaCode(
    clean(input.metering_point?.price_area_code) ??
      clean(input.metering_point?.price_area) ??
      explicitSitePriceAreaCode(input),
  );
}

function explicitMeteringGridOwnerId(input: ApplicationInput): string | null {
  return (
    clean(input.metering_point?.grid_owner_id) ??
    clean(input.metering_point?.gridOwnerId) ??
    explicitSiteGridOwnerId(input)
  );
}

function requestedSiteMoveInDate(input: ApplicationInput): string | null {
  return (
    clean(input.site?.move_in_date) ??
    clean(input.contract?.requested_start_date) ??
    clean(input.contract?.requestedStartDate) ??
    clean(input.contract?.starts_at) ??
    clean(input.requested_start_date)
  );
}

function requestedAnnualConsumption(input: ApplicationInput): number | null {
  const siteValue = input.site?.annual_consumption_kwh;
  const meteringValue = input.metering_point?.estimated_annual_consumption_kwh;
  return typeof siteValue === "number" && Number.isFinite(siteValue)
    ? siteValue
    : typeof meteringValue === "number" && Number.isFinite(meteringValue)
      ? meteringValue
      : null;
}

function stripUndefined(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function websiteSiteCanonicalFields(
  input: ApplicationInput,
  options: { facilityId?: string | null; status?: string } = {},
): Record<string, unknown> {
  const gridAreaCode = explicitSiteGridAreaCode(input);
  const priceAreaCode = explicitSitePriceAreaCode(input);
  const gridOwnerId = explicitSiteGridOwnerId(input);
  const moveInDate = requestedSiteMoveInDate(input);
  const annualConsumption = requestedAnnualConsumption(input);
  const site = input.site;
  const currentSupplierId =
    clean(site?.current_supplier_id) ??
    clean(site?.currentSupplierId) ??
    clean(input.current_supplier_id) ??
    clean(input.currentSupplierId);
  const currentSupplierName =
    clean(site?.current_supplier_name) ??
    clean(site?.currentSupplierName) ??
    clean(input.current_supplier_name) ??
    clean(input.currentSupplierName);
  const currentSupplierOrgNumber =
    clean(site?.current_supplier_org_number) ??
    clean(site?.currentSupplierOrgNumber) ??
    clean(input.current_supplier_org_number) ??
    clean(input.currentSupplierOrgNumber);
  const currentSupplierEdielId =
    clean(site?.current_supplier_ediel_id) ??
    clean(site?.currentSupplierEdielId) ??
    clean(input.current_supplier_ediel_id) ??
    clean(input.currentSupplierEdielId);
  const currentSupplierUnknown =
    site?.current_supplier_unknown ??
    site?.currentSupplierUnknown ??
    input.current_supplier_unknown ??
    input.currentSupplierUnknown;
  const currentSupplierContractStatus =
    clean(site?.current_supplier_contract_status) ??
    clean(site?.currentSupplierContractStatus) ??
    clean(input.current_supplier_contract_status) ??
    clean(input.currentSupplierContractStatus);
  const currentSupplierContractEndDate =
    clean(site?.current_supplier_contract_end_date) ??
    clean(site?.currentSupplierContractEndDate) ??
    clean(input.current_supplier_contract_end_date) ??
    clean(input.currentSupplierContractEndDate);
  const currentSupplierNoticePeriod =
    clean(site?.current_supplier_notice_period) ??
    clean(site?.currentSupplierNoticePeriod) ??
    clean(input.current_supplier_notice_period) ??
    clean(input.currentSupplierNoticePeriod);
  const currentSupplierTerminationFee =
    site?.current_supplier_termination_fee ??
    site?.currentSupplierTerminationFee ??
    input.current_supplier_termination_fee ??
    input.currentSupplierTerminationFee;
  const currentSupplierResponseStatus =
    clean(site?.current_supplier_response_status) ??
    clean(site?.currentSupplierResponseStatus) ??
    clean(input.current_supplier_response_status) ??
    clean(input.currentSupplierResponseStatus);

  return stripUndefined({
    site_name: clean(site?.site_name) ?? undefined,
    facility_id: options.facilityId ?? undefined,
    site_type: clean(site?.site_type) ?? "consumption",
    status: options.status ?? "active",
    grid_area_code: gridAreaCode ?? undefined,
    price_area_code: priceAreaCode ?? undefined,
    bidding_zone_code: priceAreaCode ?? undefined,
    grid_owner_id: gridOwnerId ?? undefined,
    selected_grid_owner_id: gridOwnerId ?? undefined,
    move_in_date: moveInDate ?? undefined,
    annual_consumption_kwh: annualConsumption ?? undefined,
    current_supplier_id: currentSupplierId ?? undefined,
    current_supplier_name: currentSupplierName ?? undefined,
    current_supplier_org_number: currentSupplierOrgNumber ?? undefined,
    current_supplier_ediel_id: currentSupplierEdielId ?? undefined,
    current_supplier_unknown:
      typeof currentSupplierUnknown === "boolean"
        ? currentSupplierUnknown
        : undefined,
    current_supplier_contract_status:
      currentSupplierContractStatus ?? undefined,
    current_supplier_contract_end_date:
      currentSupplierContractEndDate ?? undefined,
    current_supplier_notice_period: currentSupplierNoticePeriod ?? undefined,
    current_supplier_termination_fee:
      typeof currentSupplierTerminationFee === "number" &&
      Number.isFinite(currentSupplierTerminationFee)
        ? currentSupplierTerminationFee
        : undefined,
    current_supplier_response_status:
      currentSupplierResponseStatus ?? undefined,
    street: clean(site?.street) ?? undefined,
    postal_code: clean(site?.postal_code) ?? undefined,
    city: clean(site?.city) ?? undefined,
    country: clean(site?.country) ?? undefined,
    updated_at: new Date().toISOString(),
  });
}

async function patchWebsiteSiteCanonicalFields(
  companyId: string,
  customerId: string,
  siteId: string,
  input: ApplicationInput,
  facilityId: string | null,
): Promise<void> {
  const patch = websiteSiteCanonicalFields(input, {
    facilityId,
    status: "active",
  });
  if (Object.keys(patch).length <= 1) return;

  const result = await supabaseService
    .from("customer_sites")
    .update(patch)
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .eq("id", siteId);

  if (!result.error) return;
  if (!missingSchema(result.error)) throw result.error;

  // Compatibility fallback for older environments: keep the columns proven to
  // exist in production and drop newer optional columns if PostgREST schema cache
  // is stale. Never drop grid_area_code/price_area_code/move_in_date/consumption.
  const fallback = { ...patch };
  delete fallback.selected_grid_owner_id;
  delete fallback.bidding_zone_code;
  const fallbackResult = await supabaseService
    .from("customer_sites")
    .update(fallback)
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .eq("id", siteId);

  if (fallbackResult.error && !missingSchema(fallbackResult.error))
    throw fallbackResult.error;
  if (fallbackResult.error && missingSchema(fallbackResult.error)) {
    console.warn(
      "[website-applications] canonical site patch skipped because customer_sites schema differs",
      fallbackResult.error,
    );
  }
}

const VALID_PRICE_AREAS = new Set(["SE1", "SE2", "SE3", "SE4"]);

function isValidExplicitPriceArea(value: string | null): value is string {
  return Boolean(value && VALID_PRICE_AREAS.has(value.toUpperCase()));
}

// Submitted grid data is a claim, not an authoritative route. A resolver result
// which is verified against platform master data always wins. Explicit values
// may be retained only as review metadata when master data cannot verify them;
// they must never make automation sendable on their own.
function mergeResolverWithExplicitInput(
  input: ApplicationInput,
  resolution: EnergyResolverResult,
  explicitGridOwner?: { opsGridOwnerId: string | null; warnings: string[] },
): EnergyResolverResult {
  const explicitGridAreaCode = explicitGridAreaCodeFromInput(input);
  const explicitPriceAreaCodeRaw = explicitPriceAreaCodeFromInput(input);
  const explicitPriceAreaCode = isValidExplicitPriceArea(
    explicitPriceAreaCodeRaw,
  )
    ? explicitPriceAreaCodeRaw.toUpperCase()
    : null;
  const explicitOwnerId = explicitGridOwner?.opsGridOwnerId ?? null;
  const masterVerified = Boolean(
    resolution.gridAreaCode &&
    resolution.gridOwnerId &&
    resolution.priceArea &&
    resolution.gridOwnerVerificationStatus === "verified",
  );
  const gridAreaDisagrees = Boolean(
    explicitGridAreaCode &&
    resolution.gridAreaCode &&
    resolution.gridAreaCode !== explicitGridAreaCode,
  );
  const priceAreaDisagrees = Boolean(
    explicitPriceAreaCode &&
    resolution.priceArea &&
    resolution.priceArea !== explicitPriceAreaCode,
  );
  const gridOwnerDisagrees = Boolean(
    explicitOwnerId &&
    resolution.gridOwnerId &&
    explicitOwnerId !== resolution.gridOwnerId,
  );
  const claimedOnly =
    !masterVerified &&
    Boolean(explicitGridAreaCode || explicitPriceAreaCode || explicitOwnerId);

  return {
    ...resolution,
    gridAreaCode: masterVerified
      ? resolution.gridAreaCode
      : (resolution.gridAreaCode ?? explicitGridAreaCode),
    priceArea: masterVerified
      ? resolution.priceArea
      : (resolution.priceArea ??
        (explicitPriceAreaCode as EnergyResolverResult["priceArea"] | null)),
    gridOwnerId: masterVerified
      ? resolution.gridOwnerId
      : (resolution.gridOwnerId ?? explicitOwnerId),
    automationAllowed: Boolean(
      resolution.automationAllowed &&
      masterVerified &&
      !gridAreaDisagrees &&
      !priceAreaDisagrees &&
      !gridOwnerDisagrees,
    ),
    nextRequiredAction:
      gridAreaDisagrees ||
      priceAreaDisagrees ||
      gridOwnerDisagrees ||
      claimedOnly
        ? "Insända nätuppgifter avviker från eller saknar verifiering i masterdata. Granska innan automation fortsätter."
        : resolution.nextRequiredAction,
    sourceChain: Array.from(
      new Set([
        ...resolution.sourceChain,
        ...(explicitGridAreaCode || explicitPriceAreaCode || explicitOwnerId
          ? ["input.claimed_energy_context"]
          : []),
      ]),
    ),
    warnings: Array.from(
      new Set([
        ...resolution.warnings,
        ...(explicitGridOwner?.warnings ?? []),
        ...(claimedOnly ? ["claimed_energy_context_not_master_verified"] : []),
        ...(gridAreaDisagrees
          ? ["resolver_grid_area_disagrees_with_claimed_input"]
          : []),
        ...(priceAreaDisagrees
          ? ["resolver_price_area_disagrees_with_claimed_input"]
          : []),
        ...(gridOwnerDisagrees
          ? ["resolver_grid_owner_disagrees_with_claimed_input"]
          : []),
      ]),
    ),
  };
}

function enrichApplicationWithEnergyResolution(
  input: ApplicationInput,
  resolution: EnergyResolverResult,
): ApplicationInput {
  const requestedStartMode = requestedStartModeFromInput(input);
  const calculatedStart =
    requestedStartMode === "earliest_possible"
      ? (clean(input.calculated_earliest_start_date) ??
        clean(input.calculatedEarliestStartDate) ??
        clean(input.contract?.calculated_earliest_start_date) ??
        clean(input.contract?.calculatedEarliestStartDate) ??
        calculatedEarliestStartDate())
      : undefined;
  return {
    ...input,
    // grid_owner_id intentionally never falls back to the raw explicit input:
    // the merged resolution already carries the OPS-normalized owner id, and a
    // raw explicit id could reference the platform_grid_owners namespace.
    grid_owner_id: resolution.gridOwnerId ?? undefined,
    grid_area_code: resolution.gridAreaCode ?? undefined,
    price_area_code: resolution.priceArea ?? undefined,
    resolution_status: resolution.resolutionStatus,
    grid_owner_verification_status:
      resolution.gridOwnerVerificationStatus ?? undefined,
    requested_start_mode: requestedStartMode,
    calculated_earliest_start_date: calculatedStart,
    site: input.site
      ? {
          ...input.site,
          grid_area_code: resolution.gridAreaCode ?? undefined,
          grid_owner_id: resolution.gridOwnerId ?? undefined,
          grid_owner_verification_status:
            resolution.gridOwnerVerificationStatus ?? undefined,
          price_area_code: resolution.priceArea ?? undefined,
          latitude: resolution.coordinates?.latitude ?? undefined,
          longitude: resolution.coordinates?.longitude ?? undefined,
          sweref99_x: resolution.coordinates?.sweref99X ?? undefined,
          sweref99_y: resolution.coordinates?.sweref99Y ?? undefined,
        }
      : input.site,
    metering_point: input.metering_point
      ? {
          ...input.metering_point,
          grid_area_code: resolution.gridAreaCode ?? undefined,
          price_area_code: resolution.priceArea ?? undefined,
        }
      : input.metering_point,
    contract: input.contract
      ? {
          ...input.contract,
          requested_start_mode: requestedStartMode,
          calculated_earliest_start_date: calculatedStart,
        }
      : input.contract,
    metadata: {
      ...(input.metadata ?? {}),
      energy_resolution: resolution,
    },
  };
}

async function runEnergyResolution(input: {
  client: IntegrationApiClient;
  companyId: string;
  customerId?: string | null;
  customerSiteId?: string | null;
  customerApplicationId?: string | null;
  body: ApplicationInput;
}): Promise<{ body: ApplicationInput; resolution: EnergyResolverResult }> {
  const body = input.body;
  const submittedResolutionId = clean(body.resolution_id) ?? clean(body.resolutionId) ?? clean(body.contract?.resolution_id) ?? clean(body.contract?.resolutionId);
  const resolution = submittedResolutionId
    ? await loadBoundEnergyResolution({ client: input.client, resolutionId: submittedResolutionId }).then((bound): EnergyResolverResult => ({
        resolutionId: bound.id,
        gridAreaCode: bound.gridAreaCode,
        gridAreaName: bound.gridAreaName,
        gridOwnerId: bound.gridOwnerId,
        gridOwnerName: bound.gridOwnerName,
        priceArea: bound.priceArea,
        resolutionStatus: bound.resolutionStatus as EnergyResolverResult['resolutionStatus'],
        confidence: bound.confidence,
        sourceChain: Array.isArray(bound.sourceChain) ? bound.sourceChain.map(String) : [],
        automationAllowed: bound.automationAllowed,
        nextRequiredAction: 'Resolutionen är verifierad och bunden till kundintaget.',
        lookupKey: bound.id,
        warnings: [],
        gridOwnerVerificationStatus: 'verified',
        gridOwnerVerificationIssues: [],
        resolverVersion: bound.resolverVersion,
        geodataVersion: bound.geodataVersion,
        resolvedAt: bound.resolvedAt,
        expiresAt: bound.expiresAt,
      }))
    : await resolveEnergyContext({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.customerSiteId,
    customerApplicationId: input.customerApplicationId,
    street: clean(body.site?.street),
    postalCode: clean(body.site?.postal_code),
    city: clean(body.site?.city),
    country: clean(body.site?.country) ?? "SE",
    gridAreaCode: explicitGridAreaCodeFromInput(body),
    facilityId: clean(body.site?.facility_id),
    meteringPointId:
      clean(body.metering_point?.metering_point_id) ??
      clean(body.metering_point?.meter_point_id) ??
      clean(body.metering_point?.ediel_metering_point_id) ??
      clean(body.metering_point?.anlage_id),
    requestedStartMode: requestedStartModeFromInput(body),
    requestedStartDate:
      clean(body.requested_start_date) ??
      clean(body.contract?.requested_start_date) ??
      clean(body.contract?.starts_at),
    metadata: body.metadata ?? {},
  });
  const explicitGridOwnerNormalization = await normalizeGridOwnerIdToOps({
    gridOwnerId: explicitGridOwnerIdFromInput(body),
    companyId: input.companyId,
  });
  const resolved = mergeResolverWithExplicitInput(body, resolution, {
    opsGridOwnerId: explicitGridOwnerNormalization.opsGridOwnerId,
    warnings: explicitGridOwnerNormalization.warnings,
  });
  return {
    body: enrichApplicationWithEnergyResolution(body, resolved),
    resolution: resolved,
  };
}

function operationalErrorMessage(error: unknown): string {
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

function technicalBlockingReason(error: WebsiteApplicationError) {
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

function isControlledBusinessError(error: WebsiteApplicationError): boolean {
  return CONTROLLED_BUSINESS_ERROR_CODES.has(error.code);
}

function controlledBusinessErrorCode(
  error: WebsiteApplicationError,
): FacilityBusinessErrorCode {
  if (CONTROLLED_BUSINESS_ERROR_CODES.has(error.code))
    return error.code as FacilityBusinessErrorCode;
  return "needs_customer_correction";
}

function controlledBusinessStatus(error: WebsiteApplicationError): string {
  return mapFacilityBusinessError(controlledBusinessErrorCode(error)).status;
}

function controlledBusinessNextStep(error: WebsiteApplicationError): string {
  return mapFacilityBusinessError(controlledBusinessErrorCode(error))
    .recommendedAction;
}

function controlledBusinessBlockingReason(error: WebsiteApplicationError) {
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

function validationError(message: string, field: string, hint?: string) {
  return new WebsiteApplicationError({
    message,
    status: 422,
    code: "validation_error",
    field,
    hint,
    stage: "validation",
  });
}

async function stage<T>(
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

function firstClean(...values: unknown[]): string | undefined {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function firstDefined<T>(
  ...values: Array<T | undefined | null>
): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function normalizedSiteType(
  value: unknown,
): "consumption" | "production" | "combined" | undefined {
  const cleaned = clean(value)?.toLowerCase();
  if (
    cleaned === "consumption" ||
    cleaned === "production" ||
    cleaned === "combined"
  )
    return cleaned;
  return undefined;
}

function hasAnyCleanValue(
  record: Record<string, unknown>,
  keys: string[],
): boolean {
  return keys.some((key) => clean(record[key]));
}

function normalizeWebsiteApplicationCustomerType(value: unknown): string | null {
  const normalized = normalizeExternalCustomerType(value);
  if (normalized.ok) return normalized.value;
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

function normalizeRawApplication(rawBody: unknown): Record<string, unknown> {
  const raw = isObject(rawBody) ? { ...rawBody } : {};
  const rawCustomer = isObject(raw.customer) ? { ...raw.customer } : {};
  const rawAddress = isObject(raw.address) ? raw.address : {};
  const rawSource = raw.source;
  const nestedSite = isObject(raw.site) ? { ...raw.site } : null;
  const explicitSiteAddress = Boolean(
    nestedSite ||
    ["site", "facility", "installation", "anlaggning"].includes(
      String(
        raw.address_type ?? raw.addressType ?? rawAddress.type ?? "",
      ).toLowerCase(),
    ) ||
    raw.billing_address_same_as_site === true ||
    raw.billingAddressSameAsSite === true,
  );
  const nestedMeteringPoint = isObject(raw.metering_point)
    ? { ...raw.metering_point }
    : null;
  const nestedContract = isObject(raw.contract) ? { ...raw.contract } : null;

  const customer = {
    customer_type:
      normalizeWebsiteApplicationCustomerType(
        raw.customer_type ??
          rawCustomer.customer_type ??
          raw.customerType ??
          rawCustomer.customerType ??
          raw.type ??
          rawCustomer.type,
      ) ?? "private",
    first_name:
      raw.first_name ??
      raw.firstName ??
      rawCustomer.first_name ??
      rawCustomer.firstName,
    last_name:
      raw.last_name ??
      raw.lastName ??
      rawCustomer.last_name ??
      rawCustomer.lastName,
    full_name:
      raw.name ??
      raw.full_name ??
      raw.fullName ??
      rawCustomer.full_name ??
      rawCustomer.fullName ??
      rawCustomer.name,
    company_name:
      raw.company_name ??
      raw.companyName ??
      rawCustomer.company_name ??
      rawCustomer.companyName,
    // Private identity: accept every documented alias and collapse to the
    // canonical personal_number column used by the platform.
    personal_number:
      raw.personal_number ??
      raw.personalNumber ??
      raw.personal_identity_number ??
      raw.personalIdentityNumber ??
      raw.identity_number ??
      raw.identityNumber ??
      raw.personnummer ??
      rawCustomer.personal_number ??
      rawCustomer.personalNumber ??
      rawCustomer.personal_identity_number ??
      rawCustomer.personalIdentityNumber ??
      rawCustomer.identity_number ??
      rawCustomer.identityNumber ??
      rawCustomer.personnummer,
    // Business identity: accept every documented alias and collapse to the
    // canonical org_number column used by the platform.
    org_number:
      raw.org_number ??
      raw.orgNumber ??
      raw.organization_number ??
      raw.organizationNumber ??
      raw.organisation_number ??
      raw.organisationNumber ??
      raw.organisationsnummer ??
      raw.orgnr ??
      rawCustomer.org_number ??
      rawCustomer.orgNumber ??
      rawCustomer.organization_number ??
      rawCustomer.organizationNumber ??
      rawCustomer.organisation_number ??
      rawCustomer.organisationNumber ??
      rawCustomer.organisationsnummer ??
      rawCustomer.orgnr,
    email: raw.email ?? rawCustomer.email,
    phone: raw.phone ?? rawCustomer.phone,
    invoice_email:
      raw.invoice_email ??
      raw.invoiceEmail ??
      rawCustomer.invoice_email ??
      rawCustomer.invoiceEmail,
    billing_street:
      raw.billing_street ??
      raw.billingStreet ??
      rawCustomer.billing_street ??
      rawCustomer.billingStreet ??
      rawAddress.street,
    billing_postal_code:
      raw.billing_postal_code ??
      raw.billingPostalCode ??
      rawCustomer.billing_postal_code ??
      rawCustomer.billingPostalCode ??
      rawAddress.postal_code,
    billing_city:
      raw.billing_city ??
      raw.billingCity ??
      rawCustomer.billing_city ??
      rawCustomer.billingCity ??
      rawAddress.city,
    billing_country:
      raw.billing_country ??
      raw.billingCountry ??
      rawCustomer.billing_country ??
      rawCustomer.billingCountry ??
      rawAddress.country,
  };

  const topLevelMeteringPointId = firstClean(
    raw.metering_point_id,
    raw.meteringPointId,
    raw.meter_point_id,
    raw.meterPointId,
    raw.ediel_metering_point_id,
    raw.edielMeteringPointId,
  );
  const topLevelFacilityId = firstClean(
    raw.facility_id,
    raw.facilityId,
    raw.site_facility_id,
    raw.siteFacilityId,
    raw.anlage_id,
    raw.anlaggningId,
  );
  const hasTopLevelSite = Boolean(
    nestedSite ||
    topLevelFacilityId ||
    hasAnyCleanValue(raw, [
      "site_name",
      "site_type",
      ...(explicitSiteAddress
        ? [
            "street",
            "address_line1",
            "addressLine1",
            "address",
            "street_address",
            "streetAddress",
            "postal_code",
            "postalCode",
            "zip",
            "city",
            "country",
          ]
        : []),
      "move_in_date",
      "moveInDate",
      "current_supplier_id",
      "currentSupplierId",
      "current_supplier_name",
      "currentSupplierName",
    ]) ||
    firstDefined(
      raw.annual_consumption_kwh,
      raw.annualConsumptionKwh,
      raw.estimated_annual_consumption_kwh,
      raw.estimatedAnnualConsumptionKwh,
    ) !== undefined,
  );

  const site = hasTopLevelSite
    ? {
        ...(nestedSite ?? {}),
        facility_id: firstDefined(
          nestedSite?.facility_id,
          nestedSite?.facilityId,
          raw.facility_id,
          raw.facilityId,
          raw.site_facility_id,
          raw.siteFacilityId,
          raw.anlage_id,
          raw.anlaggningId,
          topLevelFacilityId,
        ),
        site_name: firstDefined(
          nestedSite?.site_name,
          nestedSite?.siteName,
          raw.site_name,
          raw.siteName,
        ),
        site_type: normalizedSiteType(
          firstDefined(
            nestedSite?.site_type,
            nestedSite?.siteType,
            raw.site_type,
            raw.siteType,
          ),
        ),
        street: firstDefined(
          nestedSite?.street,
          nestedSite?.address,
          explicitSiteAddress ? raw.street : undefined,
          explicitSiteAddress ? raw.address_line1 : undefined,
          explicitSiteAddress ? raw.addressLine1 : undefined,
          explicitSiteAddress ? raw.address : undefined,
          explicitSiteAddress ? raw.street_address : undefined,
          explicitSiteAddress ? raw.streetAddress : undefined,
          explicitSiteAddress ? rawAddress.street : undefined,
        ),
        postal_code: firstDefined(
          nestedSite?.postal_code,
          nestedSite?.postalCode,
          explicitSiteAddress ? raw.postal_code : undefined,
          explicitSiteAddress ? raw.postalCode : undefined,
          explicitSiteAddress ? raw.zip : undefined,
          explicitSiteAddress ? rawAddress.postal_code : undefined,
        ),
        city: firstDefined(
          nestedSite?.city,
          explicitSiteAddress ? raw.city : undefined,
          explicitSiteAddress ? rawAddress.city : undefined,
        ),
        country: firstDefined(
          nestedSite?.country,
          explicitSiteAddress ? raw.country : undefined,
          explicitSiteAddress ? rawAddress.country : undefined,
        ),
        price_area_code: firstDefined(
          nestedSite?.price_area_code,
          nestedSite?.priceAreaCode,
          nestedSite?.price_area,
          nestedSite?.priceArea,
          nestedSite?.bidding_zone_code,
          nestedSite?.biddingZoneCode,
          raw.price_area_code,
          raw.priceAreaCode,
          raw.price_area,
          raw.priceArea,
          raw.bidding_zone_code,
          raw.biddingZoneCode,
        ),
        grid_area_code: firstDefined(
          nestedSite?.grid_area_code,
          nestedSite?.gridAreaCode,
          raw.grid_area_code,
          raw.gridAreaCode,
        ),
        grid_owner_id: firstDefined(
          nestedSite?.grid_owner_id,
          nestedSite?.gridOwnerId,
          raw.grid_owner_id,
          raw.gridOwnerId,
          raw.network_owner_id,
        ),
        current_supplier_id: firstDefined(
          nestedSite?.current_supplier_id,
          nestedSite?.currentSupplierId,
          raw.current_supplier_id,
          raw.currentSupplierId,
          raw.electricity_supplier_id,
        ),
        current_supplier_name: firstDefined(
          nestedSite?.current_supplier_name,
          nestedSite?.currentSupplierName,
          raw.current_supplier_name,
          raw.currentSupplierName,
        ),
        current_supplier_org_number: firstDefined(
          nestedSite?.current_supplier_org_number,
          nestedSite?.currentSupplierOrgNumber,
          raw.current_supplier_org_number,
          raw.currentSupplierOrgNumber,
        ),
        current_supplier_ediel_id: firstDefined(
          nestedSite?.current_supplier_ediel_id,
          nestedSite?.currentSupplierEdielId,
          raw.current_supplier_ediel_id,
          raw.currentSupplierEdielId,
        ),
        current_supplier_unknown: firstDefined(
          nestedSite?.current_supplier_unknown,
          nestedSite?.currentSupplierUnknown,
          raw.current_supplier_unknown,
          raw.currentSupplierUnknown,
        ),
        current_supplier_contract_status: firstDefined(
          nestedSite?.current_supplier_contract_status,
          nestedSite?.currentSupplierContractStatus,
          raw.current_supplier_contract_status,
          raw.currentSupplierContractStatus,
        ),
        current_supplier_contract_end_date: firstDefined(
          nestedSite?.current_supplier_contract_end_date,
          nestedSite?.currentSupplierContractEndDate,
          raw.current_supplier_contract_end_date,
          raw.currentSupplierContractEndDate,
        ),
        current_supplier_notice_period: firstDefined(
          nestedSite?.current_supplier_notice_period,
          nestedSite?.currentSupplierNoticePeriod,
          raw.current_supplier_notice_period,
          raw.currentSupplierNoticePeriod,
        ),
        current_supplier_termination_fee: firstDefined(
          nestedSite?.current_supplier_termination_fee,
          nestedSite?.currentSupplierTerminationFee,
          raw.current_supplier_termination_fee,
          raw.currentSupplierTerminationFee,
        ),
        current_supplier_response_status: firstDefined(
          nestedSite?.current_supplier_response_status,
          nestedSite?.currentSupplierResponseStatus,
          raw.current_supplier_response_status,
          raw.currentSupplierResponseStatus,
        ),
        move_in_date: firstDefined(
          nestedSite?.move_in_date,
          nestedSite?.moveInDate,
          raw.move_in_date,
          raw.moveInDate,
          raw.start_date,
          raw.startDate,
        ),
        annual_consumption_kwh: firstDefined(
          nestedSite?.annual_consumption_kwh,
          nestedSite?.annualConsumptionKwh,
          raw.annual_consumption_kwh,
          raw.annualConsumptionKwh,
          raw.estimated_annual_consumption_kwh,
          raw.estimatedAnnualConsumptionKwh,
        ),
      }
    : undefined;

  const hasTopLevelMeteringPoint = Boolean(
    nestedMeteringPoint ||
    topLevelMeteringPointId ||
    hasAnyCleanValue(raw, [
      "reading_frequency",
      "measurement_type",
      "start_date",
      "startDate",
      "installation_date",
      "installationDate",
    ]) ||
    firstDefined(
      raw.estimated_annual_consumption_kwh,
      raw.estimatedAnnualConsumptionKwh,
      raw.annual_consumption_kwh,
      raw.annualConsumptionKwh,
    ) !== undefined,
  );

  const meteringPoint = hasTopLevelMeteringPoint
    ? {
        ...(nestedMeteringPoint ?? {}),
        metering_point_id: firstDefined(
          nestedMeteringPoint?.metering_point_id,
          nestedMeteringPoint?.meteringPointId,
          raw.metering_point_id,
          raw.meteringPointId,
          topLevelMeteringPointId,
        ),
        meter_point_id: firstDefined(
          nestedMeteringPoint?.meter_point_id,
          nestedMeteringPoint?.meterPointId,
          raw.meter_point_id,
          raw.meterPointId,
          topLevelMeteringPointId,
        ),
        ediel_metering_point_id: firstDefined(
          nestedMeteringPoint?.ediel_metering_point_id,
          nestedMeteringPoint?.edielMeteringPointId,
          raw.ediel_metering_point_id,
          raw.edielMeteringPointId,
          topLevelMeteringPointId,
        ),
        anlage_id: firstDefined(
          nestedMeteringPoint?.anlage_id,
          nestedMeteringPoint?.anlaggningId,
          raw.anlage_id,
          raw.anlaggningId,
        ),
        site_facility_id: firstDefined(
          nestedMeteringPoint?.site_facility_id,
          nestedMeteringPoint?.siteFacilityId,
          raw.site_facility_id,
          raw.siteFacilityId,
          site?.facility_id,
        ),
        reading_frequency: firstDefined(
          nestedMeteringPoint?.reading_frequency,
          raw.reading_frequency,
        ),
        measurement_type: firstDefined(
          nestedMeteringPoint?.measurement_type,
          raw.measurement_type,
        ),
        price_area_code: firstDefined(
          nestedMeteringPoint?.price_area_code,
          nestedMeteringPoint?.priceAreaCode,
          nestedMeteringPoint?.price_area,
          nestedMeteringPoint?.bidding_zone_code,
          nestedMeteringPoint?.biddingZoneCode,
          raw.price_area_code,
          raw.priceAreaCode,
          raw.price_area,
          raw.bidding_zone_code,
          raw.biddingZoneCode,
          site?.price_area_code,
        ),
        grid_area_code: firstDefined(
          nestedMeteringPoint?.grid_area_code,
          nestedMeteringPoint?.gridAreaCode,
          raw.grid_area_code,
          raw.gridAreaCode,
          site?.grid_area_code,
        ),
        grid_owner_id: firstDefined(
          nestedMeteringPoint?.grid_owner_id,
          nestedMeteringPoint?.gridOwnerId,
          raw.grid_owner_id,
          raw.gridOwnerId,
          raw.network_owner_id,
          site?.grid_owner_id,
        ),
        start_date: firstDefined(
          nestedMeteringPoint?.start_date,
          nestedMeteringPoint?.startDate,
          raw.start_date,
          raw.startDate,
          site?.move_in_date,
        ),
        installation_date: firstDefined(
          nestedMeteringPoint?.installation_date,
          nestedMeteringPoint?.installationDate,
          raw.installation_date,
          raw.installationDate,
          raw.start_date,
          raw.startDate,
          site?.move_in_date,
        ),
        estimated_annual_consumption_kwh: firstDefined(
          nestedMeteringPoint?.estimated_annual_consumption_kwh,
          nestedMeteringPoint?.estimatedAnnualConsumptionKwh,
          raw.estimated_annual_consumption_kwh,
          raw.estimatedAnnualConsumptionKwh,
          raw.annual_consumption_kwh,
          raw.annualConsumptionKwh,
          site?.annual_consumption_kwh,
        ),
      }
    : undefined;

  const contract = {
    ...(nestedContract ?? {}),
    contract_name: firstDefined(
      nestedContract?.contract_name,
      nestedContract?.contractName,
      raw.contract_name,
      raw.contractName,
      raw.product_name,
      raw.productName,
    ),
    contract_type: firstDefined(
      nestedContract?.contract_type,
      nestedContract?.contractType,
      raw.contract_type,
      raw.contractType,
    ),
    contract_number: firstDefined(
      nestedContract?.contract_number,
      nestedContract?.contractNumber,
      raw.contract_number,
      raw.contractNumber,
    ),
    offer_reference: firstDefined(
      raw.offer_reference,
      raw.offerReference,
      nestedContract?.offer_reference,
      nestedContract?.offerReference,
    ),
    quote_reference: firstDefined(
      raw.quote_reference,
      raw.quoteReference,
      nestedContract?.quote_reference,
      nestedContract?.quoteReference,
    ),
    price_plan_id: firstDefined(
      nestedContract?.price_plan_id,
      nestedContract?.pricePlanId,
      raw.price_plan_id,
      raw.pricePlanId,
    ),
    price_plan_version_id: firstDefined(
      nestedContract?.price_plan_version_id,
      nestedContract?.pricePlanVersionId,
      raw.price_plan_version_id,
      raw.pricePlanVersionId,
    ),
    contract_offer_id: firstDefined(
      nestedContract?.contract_offer_id,
      nestedContract?.contractOfferId,
      raw.contract_offer_id,
      raw.contractOfferId,
    ),
    product_code: firstDefined(
      nestedContract?.product_code,
      nestedContract?.productCode,
      raw.product_code,
      raw.productCode,
    ),
    starts_at: firstDefined(
      nestedContract?.starts_at,
      nestedContract?.startsAt,
      raw.starts_at,
      raw.startsAt,
      raw.start_date,
      raw.startDate,
    ),
    requested_start_date: firstDefined(
      nestedContract?.requested_start_date,
      nestedContract?.requestedStartDate,
      raw.requested_start_date,
      raw.requestedStartDate,
      raw.start_date,
      raw.startDate,
    ),
    requested_start_mode: firstDefined(
      nestedContract?.requested_start_mode,
      nestedContract?.requestedStartMode,
      raw.requested_start_mode,
      raw.requestedStartMode,
    ),
    calculated_earliest_start_date: firstDefined(
      nestedContract?.calculated_earliest_start_date,
      nestedContract?.calculatedEarliestStartDate,
      raw.calculated_earliest_start_date,
      raw.calculatedEarliestStartDate,
    ),
    monthly_fee_sek: firstDefined(
      nestedContract?.monthly_fee_sek,
      nestedContract?.monthlyFeeSek,
      raw.monthly_fee_sek,
      raw.monthlyFeeSek,
    ),
    invoice_fee_sek: firstDefined(
      nestedContract?.invoice_fee_sek,
      nestedContract?.invoiceFeeSek,
      raw.invoice_fee_sek,
      raw.invoiceFeeSek,
    ),
    markup_ore_per_kwh: firstDefined(
      nestedContract?.markup_ore_per_kwh,
      nestedContract?.markupOrePerKwh,
      raw.markup_ore_per_kwh,
      raw.markupOrePerKwh,
    ),
    spot_markup_ore_per_kwh: firstDefined(
      nestedContract?.spot_markup_ore_per_kwh,
      nestedContract?.spotMarkupOrePerKwh,
      raw.spot_markup_ore_per_kwh,
      raw.spotMarkupOrePerKwh,
    ),
    variable_fee_ore_per_kwh: firstDefined(
      nestedContract?.variable_fee_ore_per_kwh,
      nestedContract?.variableFeeOrePerKwh,
      raw.variable_fee_ore_per_kwh,
      raw.variableFeeOrePerKwh,
    ),
    fixed_price_ore_per_kwh: firstDefined(
      nestedContract?.fixed_price_ore_per_kwh,
      nestedContract?.fixedPriceOrePerKwh,
      raw.fixed_price_ore_per_kwh,
      raw.fixedPriceOrePerKwh,
    ),
    green_fee_mode: firstDefined(
      nestedContract?.green_fee_mode,
      nestedContract?.greenFeeMode,
      raw.green_fee_mode,
      raw.greenFeeMode,
    ),
    green_fee_value: firstDefined(
      nestedContract?.green_fee_value,
      nestedContract?.greenFeeValue,
      raw.green_fee_value,
      raw.greenFeeValue,
    ),
    binding_months: firstDefined(
      nestedContract?.binding_months,
      nestedContract?.bindingMonths,
      raw.binding_months,
      raw.bindingMonths,
    ),
    notice_months: firstDefined(
      nestedContract?.notice_months,
      nestedContract?.noticeMonths,
      raw.notice_months,
      raw.noticeMonths,
    ),
    campaign_code: firstDefined(
      nestedContract?.campaign_code,
      nestedContract?.campaignCode,
      raw.campaign_code,
      raw.campaignCode,
    ),
    terms_version: firstDefined(
      nestedContract?.terms_version,
      nestedContract?.termsVersion,
      raw.terms_version,
      raw.termsVersion,
    ),
  };

  const source =
    typeof rawSource === "string"
      ? rawSource
      : isObject(rawSource)
        ? (clean(rawSource.website) ??
          clean(rawSource.channel) ??
          "external_website")
        : (clean(raw.website) ?? clean(raw.channel) ?? "external_website");

  return {
    ...raw,
    source,
    quote_reference: firstDefined(
      raw.quote_reference,
      raw.quoteReference,
      nestedContract?.quote_reference,
      nestedContract?.quoteReference,
    ),
    external_customer_id:
      raw.external_customer_id ??
      raw.customer_external_id ??
      raw.external_customer_reference ??
      raw.customer_reference ??
      raw.externalCustomerId,
    customer_external_id:
      raw.customer_external_id ??
      raw.external_customer_id ??
      raw.external_customer_reference ??
      raw.customer_reference ??
      raw.externalCustomerId,
    external_customer_reference:
      raw.external_customer_reference ??
      raw.customer_reference ??
      raw.external_customer_id ??
      raw.customer_external_id ??
      raw.externalCustomerId,
    customer_reference:
      raw.customer_reference ??
      raw.external_customer_reference ??
      raw.external_customer_id ??
      raw.customer_external_id ??
      raw.externalCustomerId,
    external_account_id: firstDefined(
      raw.external_account_id,
      raw.externalAccountId,
      raw.auth_user_id,
      raw.authUserId,
      raw.customer_portal_user_id,
      raw.customerPortalUserId,
      raw.web_auth_user_id,
      raw.webAuthUserId,
    ),
    auth_user_id: firstDefined(
      raw.auth_user_id,
      raw.authUserId,
      raw.web_auth_user_id,
      raw.webAuthUserId,
    ),
    customer_portal_user_id: firstDefined(
      raw.customer_portal_user_id,
      raw.customerPortalUserId,
      raw.web_auth_user_id,
      raw.webAuthUserId,
      raw.auth_user_id,
      raw.authUserId,
    ),
    current_supplier_id: firstDefined(
      raw.current_supplier_id,
      raw.currentSupplierId,
      raw.electricity_supplier_id,
      site?.current_supplier_id,
    ),
    current_supplier_name: firstDefined(
      raw.current_supplier_name,
      raw.currentSupplierName,
      site?.current_supplier_name,
    ),
    current_supplier_org_number: firstDefined(
      raw.current_supplier_org_number,
      raw.currentSupplierOrgNumber,
      site?.current_supplier_org_number,
    ),
    current_supplier_ediel_id: firstDefined(
      raw.current_supplier_ediel_id,
      raw.currentSupplierEdielId,
      site?.current_supplier_ediel_id,
    ),
    current_supplier_unknown: firstDefined(
      raw.current_supplier_unknown,
      raw.currentSupplierUnknown,
      site?.current_supplier_unknown,
    ),
    current_supplier_contract_status: firstDefined(
      raw.current_supplier_contract_status,
      raw.currentSupplierContractStatus,
      site?.current_supplier_contract_status,
    ),
    current_supplier_contract_end_date: firstDefined(
      raw.current_supplier_contract_end_date,
      raw.currentSupplierContractEndDate,
      site?.current_supplier_contract_end_date,
    ),
    current_supplier_notice_period: firstDefined(
      raw.current_supplier_notice_period,
      raw.currentSupplierNoticePeriod,
      site?.current_supplier_notice_period,
    ),
    current_supplier_termination_fee: firstDefined(
      raw.current_supplier_termination_fee,
      raw.currentSupplierTerminationFee,
      site?.current_supplier_termination_fee,
    ),
    current_supplier_response_status: firstDefined(
      raw.current_supplier_response_status,
      raw.currentSupplierResponseStatus,
      site?.current_supplier_response_status,
    ),
    customer,
    site,
    metering_point: meteringPoint,
    contract,
    metadata: {
      ...(isObject(raw.metadata) ? raw.metadata : {}),
      original_payload_shape:
        isObject(raw.customer) ||
        nestedSite ||
        nestedMeteringPoint ||
        nestedContract
          ? "nested"
          : "simplified",
      simple_payload_normalized:
        Boolean(!nestedSite && site) ||
        Boolean(!nestedMeteringPoint && meteringPoint),
      raw_source: isObject(rawSource) ? rawSource : undefined,
    },
  };
}

function fullName(customer: ApplicationInput["customer"]): string | null {
  const combined = [clean(customer.first_name), clean(customer.last_name)]
    .filter(Boolean)
    .join(" ");
  return (
    clean(customer.full_name) ??
    (combined || null) ??
    clean(customer.company_name)
  );
}

function eventVariables(input: {
  companyName: string;
  customer: CustomerRow;
  rawCustomer?: ApplicationInput["customer"] | null;
  customerNumber: string;
  siteId?: string | null;
  facilityId?: string | null;
  meteringPointId?: string | null;
  contractName?: string | null;
  contractNumber?: string | null;
  contractType?: string | null;
  signedAt?: string | null;
  withdrawalDeadline?: string | null;
  offerReference?: string | null;
  priceSummary?: string | null;
  legalVersionsSummary?: string | null;
  startDate?: string | null;
  supportEmail?: string | null;
  portalUrl?: string | null;
}) {
  const rawFirstName = clean(input.rawCustomer?.first_name);
  const rawLastName = clean(input.rawCustomer?.last_name);
  const rawFullName = input.rawCustomer ? fullName(input.rawCustomer) : null;
  const customerName =
    input.customer.full_name ??
    input.customer.company_name ??
    rawFullName ??
    input.customer.email ??
    input.customerNumber;

  return {
    customer_name: customerName,
    first_name: rawFirstName ?? customerName,
    last_name: rawLastName ?? "",
    customer_email:
      input.customer.email ?? clean(input.rawCustomer?.email) ?? "",
    customer_phone: clean(input.rawCustomer?.phone) ?? "",
    customer_number: input.customerNumber,
    company_name: input.companyName,
    contract_name: input.contractName ?? "Elavtal",
    contract_number: input.contractNumber ?? "",
    contract_type: input.contractType ?? "",
    signed_at: input.signedAt ?? "",
    offer_reference: input.offerReference ?? "",
    price_summary: input.priceSummary ?? "",
    legal_versions_summary: input.legalVersionsSummary ?? "",
    agreement_pdf_note:
      "En PDF med den frysta avtals- och bevisinformationen bifogas detta mejl.",
    start_date: input.startDate ?? "",
    facility_id: input.facilityId ?? "",
    metering_point_id: input.meteringPointId ?? "",
    support_email: input.supportEmail ?? "",
    cancellation_deadline: input.withdrawalDeadline?.slice(0, 10) ?? "",
    portal_url: input.portalUrl ?? "",
  };
}

function safePortalUrl(): string | null {
  try {
    return `${getBaseAppUrl()}/login`;
  } catch {
    return null;
  }
}

async function companyEmailContext(
  companyId: string,
  customerContractId?: string | null,
): Promise<{
  name: string;
  legalName: string;
  organizationNumber: string | null;
  postalAddress: string | null;
  phone: string | null;
  website: string | null;
  logoUrl: string | null;
  senderName: string;
  senderEmail: string | null;
  replyTo: string | null;
  supportEmail: string | null;
  adminEmail: string | null;
  portalUrl: string | null;
  legalFooter: string | null;
  snapshot: Record<string, unknown>;
  snapshotSha256: string;
}> {
  const { data, error } = await supabaseService
    .from("companies")
    .select("name,support_email,primary_contact_email,phone,website,branding")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw error;

  const [settingsResult, profileResult, contractSnapshotResult] =
    await Promise.all([
      supabaseService
        .from("company_email_settings")
        .select("sender_name,sender_email,support_email,reply_to_email")
        .eq("company_id", companyId)
        .maybeSingle(),
      supabaseService
        .from("tenant_legal_profiles")
        .select(
          "legal_name,organization_number,postal_address,customer_service_email,phone,website",
        )
        .eq("company_id", companyId)
        .maybeSingle(),
      customerContractId
        ? supabaseService
            .from("customer_contracts")
            .select(
              "tenant_communication_snapshot,tenant_communication_snapshot_sha256,tenant_legal_party_snapshot",
            )
            .eq("id", customerContractId)
            .eq("company_id", companyId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  if (settingsResult.error && !missingSchema(settingsResult.error))
    throw settingsResult.error;
  if (profileResult.error && !missingSchema(profileResult.error))
    throw profileResult.error;
  if (
    contractSnapshotResult.error &&
    !missingSchema(contractSnapshotResult.error)
  )
    throw contractSnapshotResult.error;

  const settings: Record<string, unknown> = isObject(settingsResult.data)
    ? settingsResult.data
    : {};
  const profile: Record<string, unknown> = isObject(profileResult.data)
    ? profileResult.data
    : {};
  const contractSnapshot: Record<string, unknown> = isObject(
    contractSnapshotResult.data,
  )
    ? contractSnapshotResult.data
    : {};
  const lockedCommunication: Record<string, unknown> = isObject(
    contractSnapshot.tenant_communication_snapshot,
  )
    ? contractSnapshot.tenant_communication_snapshot
    : {};
  const lockedLegalParty: Record<string, unknown> = isObject(
    contractSnapshot.tenant_legal_party_snapshot,
  )
    ? contractSnapshot.tenant_legal_party_snapshot
    : {};
  const branding: Record<string, unknown> = isObject(data?.branding)
    ? data.branding
    : {};
  const profileAddress: Record<string, unknown> = isObject(
    profile.postal_address,
  )
    ? profile.postal_address
    : {};
  const lockedAddress: Record<string, unknown> = isObject(
    lockedLegalParty.postal_address,
  )
    ? lockedLegalParty.postal_address
    : {};

  const legalName =
    clean(lockedLegalParty.legal_name) ??
    clean(lockedCommunication.legal_name) ??
    clean(profile.legal_name) ??
    clean(data?.name) ??
    "din elhandlare";
  const brandName =
    clean(lockedCommunication.brand_name) ??
    clean(branding.brand_name) ??
    clean(branding.display_name) ??
    clean(data?.name) ??
    legalName;
  const supportEmail =
    clean(lockedCommunication.support_email) ??
    clean(settings.support_email) ??
    clean(settings.reply_to_email) ??
    clean(profile.customer_service_email) ??
    clean(branding.support_email) ??
    clean(data?.support_email) ??
    clean(data?.primary_contact_email);
  const postalAddress =
    clean(lockedAddress.formatted) ??
    clean(lockedAddress.text) ??
    clean(lockedAddress.address) ??
    clean(profileAddress.formatted) ??
    clean(profileAddress.text) ??
    clean(profileAddress.address);
  const senderName =
    clean(lockedCommunication.sender_name) ??
    clean(settings.sender_name) ??
    brandName;
  const senderEmail =
    clean(lockedCommunication.sender_email) ?? clean(settings.sender_email);
  const replyTo =
    clean(lockedCommunication.reply_to) ??
    clean(settings.reply_to_email) ??
    supportEmail;
  const snapshot = {
    schema: "gridex_tenant_communication_v1",
    company_id: companyId,
    legal_name: legalName,
    brand_name: brandName,
    organization_number:
      clean(lockedLegalParty.organization_number) ??
      clean(profile.organization_number),
    postal_address: postalAddress,
    phone:
      clean(lockedLegalParty.phone) ??
      clean(lockedCommunication.phone) ??
      clean(profile.phone) ??
      clean(data?.phone),
    website:
      clean(lockedLegalParty.website) ??
      clean(lockedCommunication.website) ??
      clean(profile.website) ??
      clean(data?.website),
    sender_name: senderName,
    sender_email: senderEmail,
    reply_to: replyTo,
    support_email: supportEmail,
    logo_url: clean(lockedCommunication.logo_url) ?? clean(branding.logo_url),
    legal_footer:
      clean(lockedCommunication.legal_footer) ?? clean(branding.legal_footer),
    customer_contract_id: customerContractId ?? null,
  };
  const storedHash = clean(
    contractSnapshot.tenant_communication_snapshot_sha256,
  );

  return {
    name: brandName,
    legalName,
    organizationNumber: clean(snapshot.organization_number),
    postalAddress,
    phone: clean(snapshot.phone),
    website: clean(snapshot.website),
    logoUrl: clean(snapshot.logo_url),
    senderName,
    senderEmail,
    replyTo,
    supportEmail,
    adminEmail:
      clean(data?.primary_contact_email) ??
      clean(data?.support_email) ??
      supportEmail,
    portalUrl:
      clean(branding.customer_portal_url) ??
      clean(branding.website_url) ??
      safePortalUrl(),
    legalFooter: clean(snapshot.legal_footer),
    snapshot,
    snapshotSha256:
      storedHash ??
      createHash("sha256")
        .update(JSON.stringify(snapshot), "utf8")
        .digest("hex"),
  };
}

type WebsiteEmailDispatchResult = {
  eventKey: string;
  ok: boolean;
  dispatch_status: "sent" | "queued" | "skipped" | "failed";
  result: unknown;
};

async function dispatchInitialWebsiteApplicationEmails(input: {
  companyId: string;
  applicationId: string;
  customer: CustomerRow;
  rawCustomer: ApplicationInput["customer"];
  customerNumber: string;
  externalCustomerId: string;
  siteId?: string | null;
  facilityId?: string | null;
  meteringPointId?: string | null;
  contract: WebsiteContractCreateResult | null;
  publicOffer: PublicContractOffer | null;
  offerReference: string | null;
  legalVersions: WebsiteLegalAcceptanceVersion[];
  legalAcceptanceIds: Record<string, string>;
  startDate?: string | null;
}): Promise<{ events: string[]; results: WebsiteEmailDispatchResult[] }> {
  const email =
    normalizedEmail(input.rawCustomer.email) ??
    normalizedEmail(input.customer.email);
  if (!email) return { events: [], results: [] };

  const company = await companyEmailContext(
    input.companyId,
    input.contract?.id,
  );
  const priceParts = [
    input.publicOffer?.monthly_fee_sek !== null &&
    input.publicOffer?.monthly_fee_sek !== undefined
      ? `${input.publicOffer.monthly_fee_sek} kr/mån`
      : null,
    input.publicOffer?.invoice_fee_sek !== null &&
    input.publicOffer?.invoice_fee_sek !== undefined
      ? `${input.publicOffer.invoice_fee_sek} kr/faktura`
      : null,
    input.publicOffer?.spot_markup_ore_per_kwh !== null &&
    input.publicOffer?.spot_markup_ore_per_kwh !== undefined
      ? `${input.publicOffer.spot_markup_ore_per_kwh} öre/kWh spotpåslag`
      : null,
    input.publicOffer?.variable_fee_ore_per_kwh !== null &&
    input.publicOffer?.variable_fee_ore_per_kwh !== undefined
      ? `${input.publicOffer.variable_fee_ore_per_kwh} öre/kWh rörlig avgift`
      : null,
    input.publicOffer?.fixed_price_ore_per_kwh !== null &&
    input.publicOffer?.fixed_price_ore_per_kwh !== undefined
      ? `${input.publicOffer.fixed_price_ore_per_kwh} öre/kWh fast pris`
      : null,
  ].filter((value): value is string => Boolean(value));
  const legalVersionsSummary = input.legalVersions
    .map((version) => `${version.title} v${version.version}`)
    .join(", ");
  const variables = eventVariables({
    companyName: company.name,
    customer: input.customer,
    rawCustomer: input.rawCustomer,
    customerNumber: input.customerNumber,
    siteId: input.siteId,
    facilityId: input.facilityId,
    meteringPointId: input.meteringPointId,
    contractName: input.contract?.contract_name,
    contractNumber: input.contract?.contract_number,
    contractType: input.publicOffer?.contract_type,
    signedAt: input.contract?.signed_at,
    withdrawalDeadline: input.contract?.withdrawal_deadline_at,
    offerReference: input.offerReference,
    priceSummary: priceParts.join(", "),
    legalVersionsSummary,
    startDate: input.startDate ?? input.contract?.starts_at,
    supportEmail: company.supportEmail,
    portalUrl: company.portalUrl,
  });

  const agreementAttachment =
    input.contract?.contract_number &&
    input.contract.signed_at &&
    input.publicOffer &&
    input.offerReference
      ? buildAgreementPdfAttachment({
          companyName: company.legalName,
          brandName: company.name,
          organizationNumber: company.organizationNumber,
          companyAddress: company.postalAddress,
          companySupportEmail: company.supportEmail,
          companyPhone: company.phone,
          companyWebsite: company.website,
          legalFooter: company.legalFooter,
          customerName:
            fullName(input.rawCustomer) ??
            input.customer.full_name ??
            input.customer.company_name ??
            email,
          customerEmail: email,
          customerNumber: input.customerNumber,
          contractNumber: input.contract.contract_number,
          contractName:
            input.contract.contract_name ?? input.publicOffer.public_name,
          contractDescription: input.publicOffer.public_description,
          contractType: input.publicOffer.contract_type,
          signedAt: input.contract.signed_at,
          startsAt: input.contract.starts_at,
          withdrawalDeadline: input.contract.withdrawal_deadline_at ?? null,
          offerReference: input.offerReference,
          contractPublicationVersionId:
            input.publicOffer.contract_publication_version_id ?? null,
          pricePlanVersionId: input.publicOffer.price_plan_version_id,
          legalBundleVersionId:
            input.publicOffer.legal_bundle_version_id ?? null,
          tenantSnapshotSha256: company.snapshotSha256,
          evidenceId: `contract:${input.contract.id}`,
          monthlyFeeSek: input.publicOffer.monthly_fee_sek,
          invoiceFeeSek: input.publicOffer.invoice_fee_sek,
          spotMarkupOrePerKwh: input.publicOffer.spot_markup_ore_per_kwh,
          fixedPriceOrePerKwh: input.publicOffer.fixed_price_ore_per_kwh,
          variableFeeOrePerKwh: input.publicOffer.variable_fee_ore_per_kwh,
          bindingMonths: input.publicOffer.binding_months ?? null,
          noticeMonths: input.publicOffer.notice_months ?? null,
          legalVersions: input.legalVersions.map((version) => ({
            id: version.id,
            type: version.type,
            title: version.title,
            version: version.version,
            body: version.body,
          })),
          signatureSnapshotSha256:
            input.contract.signature_snapshot_sha256 ?? null,
        })
      : null;

  if (agreementAttachment && input.contract?.id) {
    const pdfBuffer = Buffer.from(agreementAttachment.content, "base64");
    const documentSha256 = createHash("sha256").update(pdfBuffer).digest("hex");
    const generationSnapshot = {
      offer_reference: input.offerReference,
      contract_number: input.contract.contract_number,
      signed_at: input.contract.signed_at,
      signature_snapshot_sha256:
        input.contract.signature_snapshot_sha256 ?? null,
      legal_version_ids: input.legalVersions.map((version) => version.id),
      contract_publication_version_id:
        input.publicOffer?.contract_publication_version_id ?? null,
      price_plan_version_id: input.publicOffer?.price_plan_version_id ?? null,
      legal_bundle_version_id:
        input.publicOffer?.legal_bundle_version_id ?? null,
      tenant_communication_snapshot: company.snapshot,
      tenant_communication_snapshot_sha256: company.snapshotSha256,
    };
    await archiveSignedCustomerContractPdf({
      companyId: input.companyId,
      customerContractId: input.contract.id,
      pdfBuffer,
      mimeType: agreementAttachment.contentType ?? undefined,
      documentSha256,
      generationSnapshot,
    });
    const { error: contractDocumentError } = await supabaseService
      .from("customer_contracts")
      .update({
        document_sha256: documentSha256,
        locked_at: input.contract.signed_at ?? new Date().toISOString(),
      })
      .eq("id", input.contract.id)
      .eq("company_id", input.companyId);
    if (contractDocumentError) throw contractDocumentError;
  }

  const legalMailReady = Boolean(
    input.contract?.status === WEBSITE_APPLICATION_SIGNED_CONTRACT_STATUS &&
    input.contract.signed_at &&
    agreementAttachment &&
    contractLegalMailEvidenceReady({
      acceptanceIds: input.legalAcceptanceIds,
      legalVersions: input.legalVersions,
    }),
  );
  const events = [
    "contract.application_received",
    ...(legalMailReady
      ? ["contract.confirmation_sent", "contract.cooling_off_sent"]
      : []),
  ];

  // Preserve the legal communication order. The next message is not queued
  // until the previous event has produced its canonical communication row.
  const results: WebsiteEmailDispatchResult[] = [];
  for (const eventKey of events) {
      const result = await triggerEmailEvent({
        companyId: input.companyId,
        customerId: input.customer.id,
        siteId: input.siteId ?? null,
        meteringPointId: input.meteringPointId ?? null,
        eventKey,
        to: email,
        adminTo: company.adminEmail,
        variables,
        attachments:
          eventKey === "contract.confirmation_sent" && agreementAttachment
            ? [agreementAttachment]
            : [],
        idempotencyKey: `website_application:${input.applicationId}:${eventKey}`,
        metadata: {
          application_id: input.applicationId,
          contract_id: input.contract?.id ?? null,
          contract_number: input.contract?.contract_number ?? null,
          signed_at: input.contract?.signed_at ?? null,
          offer_reference: input.offerReference,
          public_contract_offer_id: input.publicOffer?.id ?? null,
          signature_snapshot_sha256:
            input.contract?.signature_snapshot_sha256 ?? null,
          tenant_communication_snapshot_sha256: company.snapshotSha256,
          contract_publication_version_id:
            input.publicOffer?.contract_publication_version_id ?? null,
          price_plan_version_id:
            input.publicOffer?.price_plan_version_id ?? null,
          legal_bundle_version_id:
            input.publicOffer?.legal_bundle_version_id ?? null,
          external_customer_id: input.externalCustomerId,
          customer_number: input.customerNumber,
          source: "website_customer_applications",
        },
      }).catch((error) => [
        { ok: false, eventKey, error: errorMessage(error) },
      ]);

      results.push({
        eventKey,
        ok: emailTriggerSucceeded(result),
        dispatch_status: emailDispatchStatus(result),
        result,
      });
  }

  return { events, results };
}

async function loadExistingIdentity(
  companyId: string,
  externalCustomerId: string,
  customerInput: ApplicationInput["customer"],
) {
  const { data, error } = await supabaseService
    .from("customer_portal_identities")
    .select("id,customer_id,external_customer_id,status")
    .eq("company_id", companyId)
    .eq("provider", WEBSITE_PORTAL_PROVIDER)
    .eq("external_customer_id", externalCustomerId)
    .in("status", ["active", "pending_review"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const identity = data as {
    id: string;
    customer_id: string | null;
    status: string;
  } | null;
  if (!identity?.customer_id) return identity;

  const customerResult = await supabaseService
    .from("customers")
    .select("id,customer_type,personal_number,org_number,email")
    .eq("company_id", companyId)
    .eq("id", identity.customer_id)
    .maybeSingle();
  if (customerResult.error) throw customerResult.error;
  const customer = customerResult.data as
    | {
        id: string;
        customer_type?: string | null;
        personal_number?: string | null;
        org_number?: string | null;
        email?: string | null;
      }
    | null;
  if (!customer) {
    throw new WebsiteApplicationError({
      message: "Portalidentiteten pekar på en kund som inte finns i aktuell tenant.",
      status: 409,
      code: "portal_identity_customer_invalid",
      stage: "customer_lookup",
    });
  }

  const requestedLegalId =
    customerInput.customer_type === "business"
      ? digits(customerInput.org_number)
      : digits(customerInput.personal_number);
  const storedLegalId =
    customerInput.customer_type === "business"
      ? digits(customer.org_number)
      : digits(customer.personal_number);
  const requestedEmail = normalizedEmail(customerInput.email);
  const storedEmail = normalizedEmail(customer.email);
  const conflicts = [
    ...(customer.customer_type &&
    customer.customer_type !== customerInput.customer_type
      ? ["customer_type"]
      : []),
    ...(!requestedLegalId || !storedLegalId || requestedLegalId !== storedLegalId
      ? [
          customerInput.customer_type === "business"
            ? "org_number"
            : "personal_number",
        ]
      : []),
    ...(requestedEmail && storedEmail && requestedEmail !== storedEmail
      ? ["email"]
      : []),
  ];
  if (identity.status !== "active" || conflicts.length > 0) {
    throw new WebsiteApplicationError({
      message:
        "Portalidentiteten motsvarar inte ansökans verifierbara kundidentitet.",
      status: 409,
      code: "portal_identity_mismatch",
      stage: "customer_lookup",
      details: {
        conflicting_identifiers: conflicts,
        requires_manual_review: true,
      },
    });
  }
  return identity;
}

async function upsertPortalIdentity(input: {
  client: IntegrationApiClient;
  customerId: string;
  externalCustomerId: string;
  externalAccountId?: string | null;
  authUserId?: string | null;
  customerPortalUserId?: string | null;
  customerNumber?: string | null;
  email?: string | null;
  applicationId?: string | null;
}) {
  const now = new Date().toISOString();
  const payload = {
    company_id: input.client.company_id,
    customer_id: input.customerId,
    api_client_id: input.client.id,
    provider: WEBSITE_PORTAL_PROVIDER,
    external_customer_id: input.externalCustomerId,
    external_account_id:
      input.externalAccountId ??
      input.customerPortalUserId ??
      input.authUserId ??
      null,
    customer_number: input.customerNumber ?? null,
    auth_user_id: input.authUserId ?? input.customerPortalUserId ?? null,
    customer_portal_user_id:
      input.customerPortalUserId ?? input.authUserId ?? null,
    last_resolved_at: now,
    email: input.email ?? null,
    status: "active",
    match_strength:
      input.applicationId && (input.authUserId || input.customerPortalUserId)
        ? "strong"
        : "medium",
    match_method:
      input.applicationId && (input.authUserId || input.customerPortalUserId)
        ? "verified_portal_and_legal_identity"
        : "website_application_legal_identity",
    linked_at: now,
    metadata: {
      source: "website_customer_applications",
      api_client_id: input.client.id,
      application_id: input.applicationId ?? null,
      customer_portal_user_id:
        input.customerPortalUserId ?? input.authUserId ?? null,
    },
    updated_at: now,
  };

  const { data, error } = await supabaseService
    .from("customer_portal_identities")
    .upsert(payload, { onConflict: "company_id,provider,external_customer_id" })
    .select("id")
    .single();

  if (error) throw error;
  return data as { id: string };
}

type WebsiteContractCreateResult = {
  id: string;
  contract_name: string | null;
  starts_at: string | null;
  status: string;
  signed_at?: string | null;
  withdrawal_deadline_at?: string | null;
  public_contract_offer_id?: string | null;
  offer_reference?: string | null;
  energy_direction?: "consumption" | "production";
  signature_snapshot_sha256?: string | null;
  contract_number: string | null;
  price_plan_id: string | null;
  price_plan_version_id: string | null;
  contract_price_snapshot_id?: string | null;
};

function selectedOfferFields(
  offer: PublicContractOffer,
  contract: ApplicationInput["contract"],
  priceArea?: string | null,
) {
  const selectedAreaFixedPrice = fixedPriceOreForArea(
    offer.pricing_snapshot,
    priceArea,
    offer.fixed_price_ore_per_kwh,
    offer.price_areas ?? [],
  );
  return {
    // Client-supplied fallbacks are UUID-gated: these values are written to
    // uuid columns (customer_contracts / contract_price_snapshots /
    // website_customer_applications). Version *names* like "2026-06-12-v1"
    // previously caused `invalid input syntax for type uuid` 500s mid-flow.
    pricePlanId: offer.price_plan_id ?? cleanUuid(contract?.price_plan_id),
    pricePlanVersionId:
      offer.price_plan_version_id ??
      cleanUuid(contract?.price_plan_version_id),
    publicContractOfferId: offer.id,
    internalContractOfferId: null,
    campaignVersionId: offer.campaign_version_id ?? null,
    contractName:
      offer.public_name ?? clean(contract?.contract_name) ?? "Elavtal",
    contractType:
      offer.contract_type ??
      clean(contract?.contract_type) ??
      "variable_monthly",
    energyDirection: offer.energy_direction ?? null,
    monthlyFeeSek: offer.monthly_fee_sek ?? contract?.monthly_fee_sek ?? null,
    invoiceFeeSek: offer.invoice_fee_sek ?? contract?.invoice_fee_sek ?? null,
    markupOrePerKwh:
      offer.markup_ore_per_kwh ?? contract?.markup_ore_per_kwh ?? null,
    spotMarkupOrePerKwh:
      offer.spot_markup_ore_per_kwh ??
      contract?.spot_markup_ore_per_kwh ??
      contract?.markup_ore_per_kwh ??
      null,
    variableFeeOrePerKwh:
      offer.variable_fee_ore_per_kwh ??
      contract?.variable_fee_ore_per_kwh ??
      null,
    fixedPriceOrePerKwh:
      selectedAreaFixedPrice ??
      offer.fixed_price_ore_per_kwh ??
      contract?.fixed_price_ore_per_kwh ??
      null,
    greenFeeMode:
      offer.green_fee_mode ?? clean(contract?.green_fee_mode) ?? "none",
    greenFeeValue: offer.green_fee_value ?? contract?.green_fee_value ?? null,
    termsVersion:
      offer.terms_version ?? clean(contract?.terms_version) ?? null,
    productCode: offer.product_code ?? clean(contract?.product_code) ?? null,
    billingModel: offer.billing_model ?? null,
  };
}

function websiteLegalVersionsSnapshot(
  versions: WebsiteLegalAcceptanceVersion[],
) {
  return versions.map((version) => ({
    id: version.id,
    type: version.type,
    legal_bundle_version_document_id: version.id,
    module_key: version.module_key ?? version.type,
    version: version.version,
    title: version.title,
    published_at: version.published_at,
    document_sha256:
      version.content_sha256 ??
      createHash("sha256").update(version.body ?? "", "utf8").digest("hex"),
    legal_bundle_version_id: version.legal_bundle_version_id ?? null,
  }));
}

function websiteSignatureSnapshot(input: {
  companyId: string;
  customerId: string;
  contractId: string;
  applicationId: string;
  publicOffer: PublicContractOffer;
  offerReference: string;
  acceptedAt: string;
  legalVersions: WebsiteLegalAcceptanceVersion[];
  contractPriceSnapshotId?: string | null;
  requestAudit?: RequestAuditMetadata;
}) {
  return {
    schema: "gridex_website_contract_signature_v2",
    company_id: input.companyId,
    customer_id: input.customerId,
    contract_id: input.contractId,
    application_id: input.applicationId,
    public_contract_offer_id: input.publicOffer.id,
    offer_reference: input.offerReference,
    contract_publication_version_id:
      input.publicOffer.contract_publication_version_id ?? null,
    contract_product_id: input.publicOffer.contract_product_id ?? null,
    contract_product_version_id:
      input.publicOffer.contract_product_version_id ?? null,
    energy_direction: input.publicOffer.energy_direction,
    legal_bundle_version_id: input.publicOffer.legal_bundle_version_id ?? null,
    price_plan_id: input.publicOffer.price_plan_id,
    price_plan_version_id: input.publicOffer.price_plan_version_id,
    price_book_id: input.publicOffer.price_book_id ?? null,
    contract_price_snapshot_id: input.contractPriceSnapshotId ?? null,
    accepted_at: input.acceptedAt,
    agreement_channel: WEBSITE_APPLICATION_CONTRACT_CHANNEL,
    legal_versions: websiteLegalVersionsSnapshot(input.legalVersions),
    request_evidence: {
      request_id: input.requestAudit?.requestId ?? null,
      trace_id: input.requestAudit?.traceId ?? null,
      ip_hash: input.requestAudit?.ipHash ?? null,
      user_agent: input.requestAudit?.userAgent ?? null,
    },
  };
}

async function finalizeWebsiteContractSignature(input: {
  companyId: string;
  customerId: string;
  contract: WebsiteContractCreateResult;
  applicationId: string;
  publicOffer: PublicContractOffer;
  offerReference: string;
  acceptedAt: string;
  legalVersions: WebsiteLegalAcceptanceVersion[];
  consents?: Record<string, unknown>;
  rawPayload: unknown;
  requestAudit?: RequestAuditMetadata;
}): Promise<{
  contract: WebsiteContractCreateResult;
  acceptanceIds: Record<string, string>;
}> {
  const snapshot = websiteSignatureSnapshot({
    companyId: input.companyId,
    customerId: input.customerId,
    contractId: input.contract.id,
    applicationId: input.applicationId,
    publicOffer: input.publicOffer,
    offerReference: input.offerReference,
    acceptedAt: input.acceptedAt,
    legalVersions: input.legalVersions,
    contractPriceSnapshotId: input.contract.contract_price_snapshot_id ?? null,
    requestAudit: input.requestAudit,
  });
  const snapshotHash = createHash("sha256")
    .update(JSON.stringify(snapshot), "utf8")
    .digest("hex");
  const { data, error } = await supabaseService.rpc(
    "gridex_finalize_website_contract_signature",
    {
      p_company_id: input.companyId,
      p_contract_id: input.contract.id,
      p_application_id: input.applicationId,
      p_public_contract_offer_id: input.publicOffer.id,
      p_offer_reference: input.offerReference,
      p_accepted_at: input.acceptedAt,
      p_legal_versions: websiteLegalVersionsSnapshot(input.legalVersions),
      p_signature_snapshot: snapshot,
      p_acceptance_evidence: buildCustomerLegalAcceptanceEvidence({
        companyId: input.companyId,
        customerId: input.customerId,
        contractId: input.contract.id,
        applicationId: input.applicationId,
        publicOffer: input.publicOffer,
        legalVersions: input.legalVersions,
        consents: input.consents,
        rawPayload: input.rawPayload,
        requestAudit: input.requestAudit,
        acceptedAt: input.acceptedAt,
      }),
      p_signature_snapshot_sha256: snapshotHash,
      p_signed_ip_hash: input.requestAudit?.ipHash ?? null,
      p_signed_user_agent: input.requestAudit?.userAgent ?? null,
    },
  );

  if (error) {
    throw new WebsiteApplicationError({
      message:
        "Avtalet kunde inte slutmarkeras som signerat eftersom den juridiska beviskedjan inte kunde verifieras atomiskt.",
      status: 500,
      code: "contract_signature_finalize_failed",
      field: "contract",
      stage: "legal_acceptance",
      hint: "Kör senaste migration för gridex_finalize_website_contract_signature och kontrollera att alla juridiska accepter för den exakta publiceringsversionen finns.",
      details: schemaErrorDetail(error),
    });
  }

  const result = isObject(data) ? data : {};
  const exactAcceptanceIds = isObject(result.acceptance_ids)
    ? Object.fromEntries(
        Object.entries(result.acceptance_ids)
          .filter((entry): entry is [string, string] =>
            typeof entry[1] === "string",
          ),
      )
    : {};
  const acceptanceIds = { ...exactAcceptanceIds };
  for (const legalVersion of input.legalVersions) {
    const id = exactAcceptanceIds[legalVersion.id];
    if (!id) continue;
    const legacyType = legalAcceptanceTypeForModule(
      legalVersion.module_key ?? legalVersion.type,
    );
    if (!acceptanceIds[legacyType]) acceptanceIds[legacyType] = id;
  }
  return {
    contract: {
    ...input.contract,
    status: WEBSITE_APPLICATION_SIGNED_CONTRACT_STATUS,
    signed_at: clean(result.signed_at) ?? input.acceptedAt,
    withdrawal_deadline_at: clean(result.withdrawal_deadline_at),
    public_contract_offer_id: input.publicOffer.id,
    offer_reference: input.offerReference,
    signature_snapshot_sha256:
      clean(result.signature_snapshot_sha256) ?? snapshotHash,
    },
    acceptanceIds,
  };
}

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

async function createApplicationRow(input: CreateApplicationRowInput) {
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

  if (error && !missingSchema(error)) {
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
    throw error;
  }
  if (data) {
    const created = data as { id: string };
    await syncExternalContractIntakeRow({
      ...input,
      applicationId: created.id,
    });
    return created;
  }

  const fallback = await supabaseService
    .from("website_customer_applications")
    .insert({
      company_id: input.client.company_id,
      api_client_id: input.client.id,
      customer_id: input.customer?.id ?? null,
      external_customer_id: input.externalCustomerId,
      customer_number: input.customer?.customer_number ?? null,
      source:
        clean((input.payload as { source?: unknown }).source) ??
        "external_website",
      status: input.status,
      idempotency_key: input.idempotencyKey ?? null,
      payload_hash: input.payloadHash ?? applicationPayloadHash(input.payload),
      business_key_hash: input.businessKeyHash ?? null,
      payload: input.payload,
      response_payload: input.responsePayload,
      warnings: input.warnings ?? [],
    })
    .select("id")
    .single();
  if (fallback.error && !missingSchema(fallback.error)) {
    if (duplicateIdempotencyKey(fallback.error) && input.idempotencyKey) {
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
    throw fallback.error;
  }
  if (fallback.error && missingSchema(fallback.error)) {
    throw new WebsiteApplicationError({
      message:
        "Kundansökan kunde inte loggas eftersom website_customer_applications-schemat inte matchar koden.",
      status: 500,
      code: "website_application_schema_mismatch",
      stage: "application_record_create",
      details: fallback.error,
    });
  }
  const created = fallback.data as { id: string };
  await syncExternalContractIntakeRow({ ...input, applicationId: created.id });
  return created;
}

// Marks an already-created application row as failed/partial. Used when a
// failure happens after the application row exists, so we update in place
// instead of inserting a duplicate that would collide on the unique
// (company_id, idempotency_key) index.
async function markApplicationFailed(input: {
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

async function loadIdempotentApplication(
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
  return data as {
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
  } | null;
}

function storedApplicationPayloadHash(
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>,
): string | null {
  return (
    existing.payload_hash ??
    (existing.payload ? applicationPayloadHash(existing.payload) : null)
  );
}

function expectsSiteOrMetering(
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

function hasCompleteSiteAndMetering(
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>,
) {
  const response = existing.response_payload ?? {};
  return Boolean(
    (existing.customer_site_id ?? clean(response.customer_site_id)) &&
    (existing.metering_point_id ?? clean(response.metering_point_id)),
  );
}

function idempotentFailure(
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

function isFailedIdempotentApplication(
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

function isRetryableFailedSiteProvisioningApplication(
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

async function releaseRetryableFailedIdempotency(input: {
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

function idempotencyPayloadMismatchError(
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

async function loadEquivalentCommittedApplication(input: {
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

function duplicateApplicationError(
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

async function loadConflictingBusinessApplication(input: {
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

function applicationBusinessConflictError(
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

async function reserveWebsiteApplicationIdempotency(input: {
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

function successResponse(
  data: Record<string, unknown>,
  warnings: string[] = [],
) {
  return {
    ok: true as const,
    status: 200,
    body: {
      data: {
        ...data,
        warnings,
      },
    },
  };
}

function failureResponse(error: WebsiteApplicationError) {
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


async function onboardCanonicalWebsiteCustomerGraph(input: {
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
  const selected = selectedOfferFields(
    input.publicOffer,
    input.body.contract,
    input.readiness.priceArea,
  );
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
  const selectedAreaBaseComponents = selectBaseComponentsForPriceArea(
    exactPricing,
    input.readiness.priceArea,
  );
  const frozenBaseComponents = selectedAreaBaseComponents.length > 0
    ? selectedAreaBaseComponents
    : compatibilitySnapshot.basePriceComponents;
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
      binding_months: input.body.contract?.binding_months ?? null,
      notice_months: input.body.contract?.notice_months ?? null,
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
      price_components_snapshot: compatibilitySnapshot.priceComponents,
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
        price_components_snapshot: compatibilitySnapshot.priceComponents,
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
  });

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
        .select("id,contract_name,starts_at,status,signed_at,withdrawal_deadline_at,public_contract_offer_id,offer_reference,signature_snapshot_sha256,contract_number,price_plan_id,price_plan_version_id,contract_price_snapshot_id")
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

export async function processWebsiteCustomerApplication(input: {
  client: IntegrationApiClient;
  rawBody: unknown;
  idempotencyKey?: string | null;
  requestAudit?: RequestAuditMetadata;
}) {
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
          applicationId: applicationRowId,
        });
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
          clean(body.auth_user_id) ??
          clean(body.web_auth_user_id),
        authUserId:
          clean(body.auth_user_id) ??
          clean(body.web_auth_user_id) ??
          clean(body.customer_portal_user_id),
        customerPortalUserId:
          clean(body.customer_portal_user_id) ??
          clean(body.auth_user_id) ??
          clean(body.web_auth_user_id),
        customerNumber,
        email: normalizedEmail(body.customer.email),
      }),
    );

    const portalUserId =
      clean(body.customer_portal_user_id) ??
      clean(body.auth_user_id) ??
      clean(body.web_auth_user_id) ??
      clean(body.external_account_id);
    if (portalUserId) {
      await stage("portal_user_link", () =>
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
      );
    }

    const applicationStatus = readiness.status;

    const responsePayload: Record<string, unknown> = {
      customer_id: resolvedCustomerResult.customer.id,
      customer_number: customerNumber,
      application_number: applicationNumber,
      external_customer_id: externalCustomerId,
      external_customer_reference: externalCustomerId,
      portal_identity_id: identity.id,
      customer_site_id: site?.id ?? null,
      site_id: site?.id ?? null,
      metering_point_id: meteringPoint?.id ?? null,
      contract_id: contract?.id ?? null,
      contract_number: contract?.contract_number ?? null,
      offer_reference: publicOffer ? selectedOfferReference : null,
      quote_reference: websiteQuote?.quote_reference ?? null,
      quote_valid_until: websiteQuote?.valid_until ?? null,
      quote_bound: Boolean(websiteQuote),
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
async function repairMissingPoaOnIdempotentApplication(input: {
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
        response_payload: { ...responsePayload, status: "needs_customer_information", workflow_state: "facility_information_required", next_step: "complete_power_of_attorney", communication: { events: communication.events, pending: false } },
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
      idempotencyKey: `workflow.facility_lookup:${input.applicationId}:${state}`,
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
        response_payload: { ...responsePayload, status: status === "needs_review" ? "needs_customer_information" : "processing", workflow_state: state, next_step: intakeDecision.nextAction, communication: { events: communication.events, pending: false } },
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
      response_payload: { ...responsePayload, status: terminalStatus === "needs_review" ? "needs_customer_information" : "processing", workflow_state: finalState, next_step: next.actionTaken ?? next.decision, communication: { events: communication.events, pending: false }, supplier_switch_request_id: next.supplierSwitchRequestId ?? null },
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
