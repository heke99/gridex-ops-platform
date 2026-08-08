// Internal module extracted from customerApplications.ts to keep handwritten production files bounded.
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth";
import { supabaseService } from "@/lib/supabase/service";
import { normaliseGridAreaCode, resolveEnergyContext } from "@/lib/energy/resolver";
import { loadBoundEnergyResolution } from "@/lib/energy/resolutionBinding";
import { normalizeGridOwnerIdToOps } from "@/lib/grid-owners/platformGridOwnerResolver";
import type { EnergyResolverResult } from "@/lib/energy/types";
import { normalizeExternalCustomerType } from "@/lib/customers/externalCustomerType";
import type { ApplicationInput } from "./customerApplicationSchemas";
import { calculatedEarliestStartDate, clean, isObject, missingSchema } from "./customerApplicationShared";

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
    normaliseGridAreaCode(input.site?.grid_area_code) ??
    normaliseGridAreaCode(input.site?.gridAreaCode) ??
    normaliseGridAreaCode(input.metering_point?.grid_area_code) ??
    normaliseGridAreaCode(input.metering_point?.gridAreaCode) ??
    normaliseGridAreaCode(input.grid_area_code) ??
    normaliseGridAreaCode(input.gridAreaCode)
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
    normaliseGridAreaCode(input.site?.grid_area_code) ??
    normaliseGridAreaCode(input.site?.gridAreaCode) ??
    normaliseGridAreaCode(input.grid_area_code) ??
    normaliseGridAreaCode(input.gridAreaCode) ??
    normaliseGridAreaCode(input.metering_point?.grid_area_code) ??
    normaliseGridAreaCode(input.metering_point?.gridAreaCode)
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

export function explicitMeteringGridAreaCode(input: ApplicationInput): string | null {
  return (
    normaliseGridAreaCode(input.metering_point?.grid_area_code) ??
    normaliseGridAreaCode(input.metering_point?.gridAreaCode) ??
    explicitSiteGridAreaCode(input)
  );
}

export function explicitMeteringPriceAreaCode(input: ApplicationInput): string | null {
  return normalizePriceAreaCode(
    clean(input.metering_point?.price_area_code) ??
      clean(input.metering_point?.price_area) ??
      explicitSitePriceAreaCode(input),
  );
}

export function explicitMeteringGridOwnerId(input: ApplicationInput): string | null {
  return (
    clean(input.metering_point?.grid_owner_id) ??
    clean(input.metering_point?.gridOwnerId) ??
    explicitSiteGridOwnerId(input)
  );
}

export function requestedSiteMoveInDate(input: ApplicationInput): string | null {
  return (
    clean(input.site?.move_in_date) ??
    clean(input.contract?.requested_start_date) ??
    clean(input.contract?.requestedStartDate) ??
    clean(input.contract?.starts_at) ??
    clean(input.requested_start_date)
  );
}

export function requestedAnnualConsumption(input: ApplicationInput): number | null {
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

export function websiteSiteCanonicalFields(
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

export async function patchWebsiteSiteCanonicalFields(
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
    normaliseGridAreaCode(resolution.gridAreaCode) !== explicitGridAreaCode,
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

export async function runEnergyResolution(input: {
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
        priceAreaAssurance: bound.priceAreaAssurance,
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

export function normalizeRawApplication(rawBody: unknown): Record<string, unknown> {
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