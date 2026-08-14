// Internal module extracted from customerApplications.ts to keep handwritten production files bounded.
//lib/website/customerApplications.ts
import { createHash } from "node:crypto";
import { z } from "zod";
import { IDEMPOTENCY_KEY_MAX_LENGTH, IDEMPOTENCY_KEY_MIN_LENGTH, isValidIdempotencyKey } from "@/lib/api/idempotencyKey";
import { WebsiteApplicationError, calculatedEarliestStartDate, clean, isObject, stage, validationError } from "./customerApplicationShared";

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

export const LegalAcceptanceSchema = z.object({
  requirement_code: z.string().trim().min(1),
  document_reference: z.string().trim().min(20).max(100),
  document_version: z.string().trim().min(1),
  document_hash: z.string().regex(/^[a-f0-9]{64}$/i),
  accepted: z.literal(true),
  accepted_at: z.string().datetime({ offset: true }),
}).strict();

export const ApplicationSchema = z.object({
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
  price_option_reference: z.string().trim().min(3).max(100).optional(),
  invoice_delivery_method: z
    .enum(["email", "e_invoice", "paper", "direct_debit"])
    .optional(),
  selected_component_references: z
    .array(z.string().trim().min(3).max(100))
    .optional(),
  site_count: z.coerce.number().int().min(1).optional(),
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
  legal_bundle_version: OPTIONAL_TEXT,
  legalAcceptances: z.array(LegalAcceptanceSchema).optional(),
  legal_acceptances: z.array(LegalAcceptanceSchema).optional(),
  powerOfAttorney: PowerOfAttorneySchema,
  power_of_attorney: PowerOfAttorneySchema,
  metadata: z.record(z.unknown()).optional(),
});

type StructuredPowerOfAttorney = z.infer<typeof PowerOfAttorneySchema>;

export type NormalizedStructuredPoa = {
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

const WEBSITE_POWER_OF_ATTORNEY_SCOPES = new Set([
  "supplier_switch",
  "facility_information_lookup",
]);

// Normalizes the structured powerOfAttorney object (camel or snake case).
export function normalizeStructuredPoa(
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
      ? Array.from(
          new Set<string>(
            raw.scope
              .map((value: unknown) => String(value).trim().toLowerCase())
              .filter((value: string) => value.length > 0),
          ),
        )
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

export function structuredPoaIsExternallySendable(
  poa: NormalizedStructuredPoa | null,
): boolean {
  return Boolean(
    poa?.accepted === true &&
    poa.signerName &&
    poa.signerIdentityNumber &&
    poa.method &&
    poa.scope.includes("supplier_switch") &&
    poa.scope.every((scope) => WEBSITE_POWER_OF_ATTORNEY_SCOPES.has(scope)),
  );
}

export function validateStructuredPoaForExternalSendability(
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

  const unsupportedScopes = poa.scope.filter(
    (scope) => !WEBSITE_POWER_OF_ATTORNEY_SCOPES.has(scope),
  );
  if (unsupportedScopes.length > 0) {
    return new WebsiteApplicationError({
      message: `Fullmakten innehåller scopes som OPS inte stöder: ${unsupportedScopes.join(", ")}.`,
      status: 422,
      code: "power_of_attorney_scope_invalid",
      field: "powerOfAttorney.scope",
      stage: "power_of_attorney",
      hint:
        "Använd supplier_switch och lägg endast till facility_information_lookup när kunden även ger rätt att hämta anläggningsuppgifter.",
      details: {
        unsupported_scopes: unsupportedScopes,
        supported_scopes: Array.from(WEBSITE_POWER_OF_ATTORNEY_SCOPES),
      },
    });
  }
  if (poa.scope.length > 0 && !poa.scope.includes("supplier_switch")) {
    return new WebsiteApplicationError({
      message:
        "Fullmakten för ett elhandelsavtal måste uttryckligen omfatta supplier_switch.",
      status: 422,
      code: "power_of_attorney_supplier_switch_scope_missing",
      field: "powerOfAttorney.scope",
      stage: "power_of_attorney",
      hint:
        'Skicka scope=["supplier_switch"] eller scope=["supplier_switch", "facility_information_lookup"]. OPS utökar aldrig scope efter kundens godkännande.',
    });
  }

  if (missing.length === 0) return null;

  return validationError(
    `Strukturerad fullmakt är markerad accepted=true men saknar ${missing.map((item) => item.label).join(", ")}. Skicka signerName, signerIdentityNumber, method och exakt scope eller skicka bara legacy consent som intern, icke sändbar accept.`,
    missing[0]?.field ?? "powerOfAttorney",
    "Automatisk nätägarkommunikation kräver komplett strukturerad powerOfAttorney. Legacy consents.power_of_attorney=true blir aldrig externt sändbar.",
  );
}

export type ApplicationInput = z.infer<typeof ApplicationSchema>;

const REQUESTED_START_MODES = new Set(["earliest_possible", "specific_date"]);
export const REPLAYABLE_COMMITTED_STATUSES = new Set([
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
export const BUSINESS_CONFLICT_STATUSES = new Set([
  "processing",
  ...REPLAYABLE_COMMITTED_STATUSES,
]);
export const COMMITTED_SITE_REQUIRED_STATUSES = new Set([
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
export const COMMITTED_METERING_REQUIRED_STATUSES = new Set([
  "facility_data_received",
  "ready_for_switch",
  "switch_requested",
  "switch_confirmed",
  "active",
]);
export const COMMITTED_CONTRACT_REQUIRED_STATUSES = new Set([
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

export function applicationPayloadHash(value: unknown): string {
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
export function applicationBusinessKeyHash(
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
    price_option_reference:
      normalizedBusinessToken(input.price_option_reference) ??
      "unspecified-price-option",
    invoice_delivery_method:
      normalizedBusinessToken(input.invoice_delivery_method) ??
      "unspecified-invoice-delivery",
    selected_component_references: [
      ...(input.selected_component_references ?? []),
    ].sort(),
    site_count: input.site_count ?? 1,
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

export function validateCanonicalApplicationReferencePlacement(
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

export function validateApplicationDates(
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

export function validateRequestedStartMode(
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

export function validateIdempotencyKey(
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
    !isValidIdempotencyKey(value)
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
  "legal_bundle_version",
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
  "price_option_reference",
  "invoice_delivery_method",
  "selected_component_references",
  "site_count",
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

export function validateNestedPayloadFields(
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
