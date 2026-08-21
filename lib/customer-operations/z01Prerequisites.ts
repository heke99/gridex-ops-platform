import { supabaseService } from "@/lib/supabase/service";
import { ensureGridOwnerInformationRequest } from "@/lib/energy/gridOwnerRequests";
import { makeCustomerOperationBlocker } from "@/lib/customer-operations/blockers";

export const Z01_FACILITY_IDENTIFIER_BLOCKER_CODE =
  "facility_or_metering_point_missing";
export const Z01_FACILITY_IDENTIFIER_BLOCKER_REASON =
  "Anläggnings-ID eller mätpunkts-ID saknas. Systemet ska hämta uppgifterna från nätägaren innan leverantörsbyte startas.";
export const Z01_FACILITY_IDENTIFIER_NEXT_ACTION =
  "Hämta anläggningsuppgifter från nätägaren. Om begäran redan finns ska den återanvändas och inte skapas igen.";
export const Z01_FACILITY_IDENTIFIER_ROUTE_STATUS =
  "awaiting_facility_identifier";

export type Z01PrerequisiteResult = {
  canBuildZ01: boolean;
  facilityId: string | null;
  meteringPointId: string | null;
  blockerCode: string | null;
  blockerReason: string | null;
  nextRequiredAction: string | null;
  routeResolutionStatus: string | null;
  evidence: Record<string, unknown>;
};

export type Z01PrerequisiteInput = {
  companyId: string;
  customerId: string;
  siteId?: string | null;
  meteringPointId?: string | null;
  gridOwnerDataRequestId?: string | null;
  customerInfoRequestId?: string | null;
  actorUserId?: string | null;
  ensureFacilityLookup?: boolean;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return (
    ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) ||
    /schema cache|does not exist|column .* does not exist/i.test(message)
  );
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const cleaned = text(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function maybeSingle(
  table: string,
  id: string | null | undefined,
  companyId: string,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const { data, error } = await supabaseService
    .from(table)
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    if (missingSchema(error)) return null;
    throw error;
  }
  return asRecord(data);
}

/**
 * Return metering points only from the requested customer site.
 *
 * IMPORTANT: when siteId is known this function must NEVER fall back to another
 * site owned by the same customer. A missing point on Site B is a real blocker;
 * reusing Site A would make the wrong market object sendable.
 */
async function listCandidateMeteringPoints(input: {
  companyId: string;
  customerId: string;
  siteId?: string | null;
}): Promise<Array<Record<string, unknown>>> {
  const siteId = text(input.siteId);

  let query = supabaseService
    .from("metering_points")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("customer_id", input.customerId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (siteId) {
    query = query.or(`site_id.eq.${siteId},customer_site_id.eq.${siteId}`);
  }

  const { data, error } = await query;
  if (error) {
    if (missingSchema(error)) return [];
    throw error;
  }

  return ((data ?? []) as unknown[])
    .map(asRecord)
    .filter(Boolean) as Array<Record<string, unknown>>;
}

function identifierBelongsToCandidate(
  candidate: Record<string, unknown> | null,
  identifier: string | null,
): boolean {
  if (!candidate || !identifier) return false;
  return [
    candidate.id,
    candidate.ediel_reference,
    candidate.ediel_metering_point_id,
    candidate.meter_point_id,
    candidate.metering_point_id,
    candidate.site_facility_id,
    candidate.facility_id,
  ].some((value) => text(value) === identifier);
}

export async function ensureFacilityLookupForZ01Blocker(input: {
  companyId: string;
  customerId: string;
  site: Record<string, unknown> | null;
  customerInfoRequestId?: string | null;
  gridOwnerDataRequestId?: string | null;
  outboundRequestId?: string | null;
  actorUserId?: string | null;
}): Promise<Record<string, unknown> | null> {
  const site = input.site ?? {};
  const siteId = text(site.id);
  if (!siteId || text(site.customer_id) !== input.customerId) {
    return {
      request_id: null,
      status: "blocked",
      channel: null,
      route_id: null,
      next_step: "review_site_customer_relationship",
      warnings: ["Anläggningen saknas eller tillhör inte kunden."],
      source: "z01_prerequisite_blocker",
      customer_info_request_id: input.customerInfoRequestId ?? null,
      grid_owner_data_request_id: input.gridOwnerDataRequestId ?? null,
      outbound_request_id: input.outboundRequestId ?? null,
    };
  }

  const result = await ensureGridOwnerInformationRequest({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: siteId,
    gridOwnerId: text(site.grid_owner_id) ?? text(site.selected_grid_owner_id),
    gridAreaCode: text(site.grid_area_code) ?? text(site.manual_grid_area_code),
    priceArea: text(site.price_area_code) ?? text(site.bidding_zone_code),
    createdBy: text(input.actorUserId),
    requestType: "facility_lookup",
  });
  return {
    request_id: result.requestId,
    status: result.status,
    channel: result.channel,
    route_id: result.routeId ?? null,
    next_step: result.nextStep,
    warnings: result.warnings,
    source: "z01_prerequisite_blocker",
    customer_info_request_id: input.customerInfoRequestId ?? null,
    grid_owner_data_request_id: input.gridOwnerDataRequestId ?? null,
    outbound_request_id: input.outboundRequestId ?? null,
  };
}

export async function evaluateZ01Prerequisites(
  input: Z01PrerequisiteInput,
): Promise<Z01PrerequisiteResult> {
  const customerInfoRequest = await maybeSingle(
    "customer_info_requests",
    input.customerInfoRequestId,
    input.companyId,
  );
  const gridOwnerDataRequest = await maybeSingle(
    "grid_owner_data_requests",
    input.gridOwnerDataRequestId,
    input.companyId,
  );
  const siteId = firstText(
    input.siteId,
    customerInfoRequest?.site_id,
    gridOwnerDataRequest?.site_id,
  );
  const site = await maybeSingle("customer_sites", siteId, input.companyId);
  const siteCustomerMatches = Boolean(
    siteId && site && text(site.customer_id) === input.customerId,
  );

  const customerInfoSite = text(customerInfoRequest?.site_id);
  const gridOwnerDataSite = text(gridOwnerDataRequest?.site_id);
  const customerInfoMatchesSite =
    !customerInfoRequest || !siteId || customerInfoSite === siteId;
  const gridOwnerDataMatchesSite =
    !gridOwnerDataRequest || !siteId || gridOwnerDataSite === siteId;

  const meteringPoints = siteCustomerMatches
    ? await listCandidateMeteringPoints({
        companyId: input.companyId,
        customerId: input.customerId,
        siteId,
      })
    : [];
  const firstPoint =
    meteringPoints.find((row) =>
      firstText(
        row.ediel_reference,
        row.ediel_metering_point_id,
        row.meter_point_id,
        row.metering_point_id,
        row.site_facility_id,
        row.facility_id,
      ),
    ) ?? null;

  const requestedMeteringPointId = text(input.meteringPointId);
  const facilityId = siteCustomerMatches
    ? firstText(
        site?.facility_id,
        site?.normalized_facility_id,
        firstPoint?.site_facility_id,
        firstPoint?.facility_id,
      )
    : null;
  const meteringPointId = siteCustomerMatches
    ? firstText(
        identifierBelongsToCandidate(firstPoint, requestedMeteringPointId)
          ? requestedMeteringPointId
          : null,
        customerInfoMatchesSite ? customerInfoRequest?.metering_point_id : null,
        gridOwnerDataMatchesSite ? gridOwnerDataRequest?.metering_point_id : null,
        firstPoint?.ediel_reference,
        firstPoint?.ediel_metering_point_id,
        firstPoint?.meter_point_id,
        firstPoint?.metering_point_id,
      )
    : null;

  const evidence: Record<string, unknown> = {
    source: "z01_prerequisites",
    customer_info_request_id: input.customerInfoRequestId ?? null,
    grid_owner_data_request_id: input.gridOwnerDataRequestId ?? null,
    site_id: siteId,
    site_customer_matches: siteCustomerMatches,
    customer_info_request_site_matches: customerInfoMatchesSite,
    grid_owner_data_request_site_matches: gridOwnerDataMatchesSite,
    customer_info_request_metering_point_id:
      customerInfoMatchesSite ? customerInfoRequest?.metering_point_id ?? null : null,
    grid_owner_data_request_metering_point_id:
      gridOwnerDataMatchesSite ? gridOwnerDataRequest?.metering_point_id ?? null : null,
    site_facility_id: siteCustomerMatches ? site?.facility_id ?? null : null,
    site_normalized_facility_id: siteCustomerMatches
      ? site?.normalized_facility_id ?? null
      : null,
    metering_points_checked: meteringPoints.length,
    selected_metering_point_record_id: firstPoint?.id ?? null,
  };

  if (siteCustomerMatches && (facilityId || meteringPointId)) {
    return {
      canBuildZ01: true,
      facilityId,
      meteringPointId,
      blockerCode: null,
      blockerReason: null,
      nextRequiredAction: null,
      routeResolutionStatus: null,
      evidence: {
        ...evidence,
        facility_id: facilityId,
        metering_point_id: meteringPointId,
      },
    };
  }

  let facilityLookup: Record<string, unknown> | null = null;
  if (input.ensureFacilityLookup && siteCustomerMatches) {
    facilityLookup = await ensureFacilityLookupForZ01Blocker({
      companyId: input.companyId,
      customerId: input.customerId,
      site,
      customerInfoRequestId: input.customerInfoRequestId,
      gridOwnerDataRequestId: input.gridOwnerDataRequestId,
      actorUserId: input.actorUserId,
    });
  }

  const relationshipMismatch =
    Boolean(siteId) &&
    (!siteCustomerMatches ||
      !customerInfoMatchesSite ||
      !gridOwnerDataMatchesSite);
  const blockerCode = relationshipMismatch
    ? "request_site_customer_mismatch"
    : Z01_FACILITY_IDENTIFIER_BLOCKER_CODE;
  const blockerReason = relationshipMismatch
    ? "Anläggning, kund eller underliggande informationsbegäran matchar inte exakt. Processen stoppas för manuell granskning."
    : Z01_FACILITY_IDENTIFIER_BLOCKER_REASON;

  return {
    canBuildZ01: false,
    facilityId: null,
    meteringPointId: null,
    blockerCode,
    blockerReason,
    nextRequiredAction: relationshipMismatch
      ? "Granska tenant-, kund- och anläggningskopplingen innan processen återupptas."
      : Z01_FACILITY_IDENTIFIER_NEXT_ACTION,
    routeResolutionStatus: relationshipMismatch
      ? "site_customer_mismatch"
      : Z01_FACILITY_IDENTIFIER_ROUTE_STATUS,
    evidence: {
      ...evidence,
      facility_lookup: facilityLookup,
      blocker_code: blockerCode,
    },
  };
}

export function makeZ01FacilityIdentifierBlocker(
  overrides: Record<string, unknown> = {},
) {
  return makeCustomerOperationBlocker(Z01_FACILITY_IDENTIFIER_BLOCKER_CODE, {
    blocker_reason: Z01_FACILITY_IDENTIFIER_BLOCKER_REASON,
    next_required_action: Z01_FACILITY_IDENTIFIER_NEXT_ACTION,
    ...overrides,
  });
}
