import { supabaseService } from "@/lib/supabase/service";
import { ensureGridOwnerInformationRequest } from "@/lib/energy/gridOwnerRequests";
import { makeCustomerOperationBlocker } from "@/lib/customer-operations/blockers";

export const Z01_FACILITY_IDENTIFIER_BLOCKER_CODE =
  "facility_or_metering_point_missing";
export const Z01_FACILITY_IDENTIFIER_BLOCKER_REASON =
  "Anläggningsuppgifter saknas. Systemet ska i första hand begära uppgifter från nätägaren och bara blockera om nätägare, fullmakt eller produktionsväg saknas.";
export const Z01_FACILITY_IDENTIFIER_NEXT_ACTION =
  "Begär uppgifter från nätägaren eller komplettera kundkortet om uppgiftsbegäran redan har avvisats.";
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

async function listCandidateMeteringPoints(input: {
  companyId: string;
  customerId: string;
  siteId?: string | null;
}): Promise<Array<Record<string, unknown>>> {
  const siteId = text(input.siteId);
  const byCustomer = await supabaseService
    .from("metering_points")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("customer_id", input.customerId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (byCustomer.error) {
    if (!missingSchema(byCustomer.error)) throw byCustomer.error;
  } else {
    const rows = ((byCustomer.data ?? []) as unknown[])
      .map(asRecord)
      .filter(Boolean) as Array<Record<string, unknown>>;
    if (!siteId) return rows;
    const matched = rows.filter(
      (row) =>
        text(row.site_id) === siteId ||
        text(row.customer_site_id) === siteId ||
        text(row.customerSiteId) === siteId,
    );
    if (matched.length > 0) return matched;
    return rows;
  }

  if (!siteId) return [];
  const fallback = await supabaseService
    .from("metering_points")
    .select("*")
    .eq("company_id", input.companyId)
    .or(`site_id.eq.${siteId},customer_site_id.eq.${siteId}`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (fallback.error) {
    if (missingSchema(fallback.error)) return [];
    throw fallback.error;
  }
  return ((fallback.data ?? []) as unknown[])
    .map(asRecord)
    .filter(Boolean) as Array<Record<string, unknown>>;
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
  const result = await ensureGridOwnerInformationRequest({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: text(site.id),
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
  const meteringPoints = await listCandidateMeteringPoints({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId,
  });
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

  const facilityId = firstText(
    site?.facility_id,
    site?.normalized_facility_id,
    firstPoint?.site_facility_id,
    firstPoint?.facility_id,
  );
  const meteringPointId = firstText(
    input.meteringPointId,
    customerInfoRequest?.metering_point_id,
    gridOwnerDataRequest?.metering_point_id,
    firstPoint?.ediel_reference,
    firstPoint?.ediel_metering_point_id,
    firstPoint?.meter_point_id,
    firstPoint?.metering_point_id,
  );

  const evidence: Record<string, unknown> = {
    source: "z01_prerequisites",
    customer_info_request_id: input.customerInfoRequestId ?? null,
    grid_owner_data_request_id: input.gridOwnerDataRequestId ?? null,
    site_id: siteId,
    customer_info_request_metering_point_id:
      customerInfoRequest?.metering_point_id ?? null,
    grid_owner_data_request_metering_point_id:
      gridOwnerDataRequest?.metering_point_id ?? null,
    site_facility_id: site?.facility_id ?? null,
    site_normalized_facility_id: site?.normalized_facility_id ?? null,
    metering_points_checked: meteringPoints.length,
    selected_metering_point_record_id: firstPoint?.id ?? null,
  };

  if (facilityId || meteringPointId) {
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
  if (input.ensureFacilityLookup) {
    facilityLookup = await ensureFacilityLookupForZ01Blocker({
      companyId: input.companyId,
      customerId: input.customerId,
      site,
      customerInfoRequestId: input.customerInfoRequestId,
      gridOwnerDataRequestId: input.gridOwnerDataRequestId,
      actorUserId: input.actorUserId,
    });
  }

  return {
    canBuildZ01: false,
    facilityId: null,
    meteringPointId: null,
    blockerCode: Z01_FACILITY_IDENTIFIER_BLOCKER_CODE,
    blockerReason: Z01_FACILITY_IDENTIFIER_BLOCKER_REASON,
    nextRequiredAction: Z01_FACILITY_IDENTIFIER_NEXT_ACTION,
    routeResolutionStatus: Z01_FACILITY_IDENTIFIER_ROUTE_STATUS,
    evidence: {
      ...evidence,
      facility_lookup: facilityLookup,
      blocker_code: Z01_FACILITY_IDENTIFIER_BLOCKER_CODE,
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
