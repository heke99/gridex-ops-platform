import { supabaseService } from "@/lib/supabase/service";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import { createGridOwnerDataRequest } from "@/lib/cis/db-data";
import { createOutboundRequest } from "@/lib/cis/db-outbound";
import { prepareAndQueueProdatZ01FromDataRequest } from "@/lib/ediel/flows/prodatCustomerMasterdata";

export type CustomerOption = {
  id: string;
  label: string;
  sublabel: string | null;
};

export type CustomerInfoSiteOption = {
  id: string;
  customerId: string;
  label: string;
  sublabel: string | null;
  gridOwnerId: string | null;
};

export type CustomerInfoMeteringPointOption = {
  id: string;
  siteId: string;
  customerId: string | null;
  label: string;
  sublabel: string | null;
  gridOwnerId: string | null;
};

export type CustomerInfoGridOwnerOption = {
  id: string;
  label: string;
  sublabel: string | null;
};

export type CustomerInfoRequestResourceOptions = {
  sites: CustomerInfoSiteOption[];
  meteringPoints: CustomerInfoMeteringPointOption[];
  gridOwners: CustomerInfoGridOwnerOption[];
};

export type CustomerInfoRequestRow = {
  id: string;
  company_id: string;
  customer_id: string;
  site_id: string | null;
  metering_point_id: string | null;
  authorization_document_id: string | null;
  request_type: string;
  target_party_type: string;
  target_party_name: string | null;
  grid_owner_id: string | null;
  current_supplier_name: string | null;
  status: string;
  requested_data_categories: string[];
  verified_payload: Record<string, unknown>;
  blocker_reason: string | null;
  notes: string | null;
  requested_at: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type AuthorizationScopeRow = {
  id: string;
  company_id: string;
  customer_id: string;
  authorization_document_id: string | null;
  scope_type: string;
  status: string;
  covers_grid_owner_data: boolean;
  covers_current_supplier_contract: boolean;
  covers_metering_data: boolean;
  valid_from: string | null;
  valid_to: string | null;
  revoked_at: string | null;
  evidence_note: string | null;
  created_at: string;
};

export type MeteringPermissionRow = {
  id: string;
  company_id: string;
  customer_id: string;
  site_id: string | null;
  metering_point_id: string | null;
  grid_owner_id: string | null;
  authorization_document_id: string | null;
  permission_reference: string | null;
  case_reference: string | null;
  status: string;
  requested_start_date: string | null;
  requested_end_date: string | null;
  approved_start_date: string | null;
  approved_end_date: string | null;
  resolution_code: string | null;
  report_frequency: string | null;
  last_blocker: string | null;
  created_at: string;
  updated_at: string;
};

export type PricingCustomerContext = {
  customer_id: string;
  site_id: string | null;
  metering_point_id: string | null;
};

function isMissingRelationError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null;
  return Boolean(
    maybe &&
    (maybe.code === "42P01" ||
      maybe.code === "42703" ||
      maybe.code === "PGRST205" ||
      /does not exist|schema cache|relation .* does not exist/i.test(
        maybe.message ?? "",
      )),
  );
}

function customerLabel(row: Record<string, unknown>): string {
  const companyName = String(row.company_name ?? "").trim();
  const fullName = String(row.full_name ?? "").trim();
  const firstName = String(row.first_name ?? "").trim();
  const lastName = String(row.last_name ?? "").trim();
  const personal = String(row.personal_number ?? "").trim();
  const org = String(row.org_number ?? "").trim();
  const base =
    companyName ||
    fullName ||
    [firstName, lastName].filter(Boolean).join(" ") ||
    personal ||
    org ||
    String(row.id);
  return base;
}

export async function listCustomersForInfoRequestSelector(
  companyId: string,
): Promise<CustomerOption[]> {
  try {
    const { data, error } = await supabaseService
      .from("customers")
      .select(
        "id, customer_number, first_name, last_name, full_name, company_name, email, personal_number, org_number",
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }

    return (data ?? []).map((row) => ({
      id: String(row.id),
      label: customerLabel(row as Record<string, unknown>),
      sublabel:
        [row.customer_number, row.email, row.personal_number, row.org_number]
          .filter(Boolean)
          .join(" · ") || null,
    }));
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function listCustomerInfoRequests(
  companyId: string,
): Promise<CustomerInfoRequestRow[]> {
  try {
    const { data, error } = await supabaseService
      .from("customer_info_requests")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }

    return (data ?? []) as CustomerInfoRequestRow[];
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function listAuthorizationScopes(
  companyId: string,
): Promise<AuthorizationScopeRow[]> {
  try {
    const { data, error } = await supabaseService
      .from("authorization_scopes")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }

    return (data ?? []) as AuthorizationScopeRow[];
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function listMeteringPermissions(
  companyId: string,
): Promise<MeteringPermissionRow[]> {
  try {
    const { data, error } = await supabaseService
      .from("metering_permissions")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }

    return (data ?? []) as MeteringPermissionRow[];
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

function siteOptionLabel(row: Record<string, unknown>): string {
  const siteName = String(row.site_name ?? "").trim();
  const facilityId = String(row.facility_id ?? "").trim();
  return siteName || facilityId || String(row.id);
}

function meteringPointOptionLabel(row: Record<string, unknown>): string {
  const meterPointId = String(row.meter_point_id ?? "").trim();
  const edielReference = String(row.ediel_reference ?? "").trim();
  const facilityId = String(row.site_facility_id ?? "").trim();
  return meterPointId || edielReference || facilityId || String(row.id);
}

export async function listCustomerInfoRequestResourceOptions(
  companyId: string,
): Promise<CustomerInfoRequestResourceOptions> {
  try {
    const [sitesResult, meteringPointsResult, gridOwnersResult] =
      await Promise.all([
        supabaseService
          .from("customer_sites")
          .select(
            "id, customer_id, site_name, facility_id, status, grid_owner_id, street, postal_code, city",
          )
          .eq("company_id", companyId)
          .order("updated_at", { ascending: false })
          .limit(250),
        supabaseService
          .from("metering_points")
          .select(
            "id, site_id, meter_point_id, site_facility_id, ediel_reference, status, grid_owner_id, price_area_code",
          )
          .eq("company_id", companyId)
          .order("updated_at", { ascending: false })
          .limit(250),
        supabaseService
          .from("grid_owners")
          .select("id, name, owner_code, ediel_id, is_active")
          .eq("is_active", true)
          .order("name", { ascending: true })
          .limit(250),
      ]);

    if (sitesResult.error) {
      if (!isMissingRelationError(sitesResult.error)) throw sitesResult.error;
    }
    if (meteringPointsResult.error) {
      if (!isMissingRelationError(meteringPointsResult.error))
        throw meteringPointsResult.error;
    }
    if (gridOwnersResult.error) {
      if (!isMissingRelationError(gridOwnersResult.error))
        throw gridOwnersResult.error;
    }

    const siteRows = (sitesResult.data ?? []) as Array<Record<string, unknown>>;
    const siteCustomerById = new Map(
      siteRows.map((row) => [String(row.id), String(row.customer_id ?? "")]),
    );

    return {
      sites: siteRows.map((row) => ({
        id: String(row.id),
        customerId: String(row.customer_id ?? ""),
        label: siteOptionLabel(row),
        sublabel:
          [row.facility_id, row.status, row.street, row.postal_code, row.city]
            .filter(Boolean)
            .join(" · ") || null,
        gridOwnerId:
          typeof row.grid_owner_id === "string" ? row.grid_owner_id : null,
      })),
      meteringPoints: (
        (meteringPointsResult.data ?? []) as Array<Record<string, unknown>>
      ).map((row) => {
        const siteId = String(row.site_id ?? "");
        return {
          id: String(row.id),
          siteId,
          customerId: siteCustomerById.get(siteId) || null,
          label: meteringPointOptionLabel(row),
          sublabel:
            [row.status, row.site_facility_id, row.price_area_code]
              .filter(Boolean)
              .join(" · ") || null,
          gridOwnerId:
            typeof row.grid_owner_id === "string" ? row.grid_owner_id : null,
        };
      }),
      gridOwners: (
        (gridOwnersResult.data ?? []) as Array<Record<string, unknown>>
      ).map((row) => ({
        id: String(row.id),
        label: String(row.name ?? row.owner_code ?? row.id),
        sublabel:
          [row.owner_code, row.ediel_id].filter(Boolean).join(" · ") || null,
      })),
    };
  } catch (error) {
    if (isMissingRelationError(error))
      return { sites: [], meteringPoints: [], gridOwners: [] };
    throw error;
  }
}

async function resolveCustomerInfoRequestAnchors(input: {
  companyId: string;
  customerId: string;
  siteId?: string | null;
  meteringPointId?: string | null;
  gridOwnerId?: string | null;
}): Promise<{
  siteId: string | null;
  meteringPointId: string | null;
  gridOwnerId: string | null;
}> {
  const requestedSiteId = input.siteId ?? null;
  const requestedMeteringPointId = input.meteringPointId ?? null;
  let site: Record<string, unknown> | null = null;
  let meteringPoint: Record<string, unknown> | null = null;

  if (requestedMeteringPointId) {
    const { data, error } = await supabaseService
      .from("metering_points")
      .select("id, site_id, grid_owner_id")
      .eq("company_id", input.companyId)
      .eq("id", requestedMeteringPointId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("Mätpunkten hittades inte för valt bolag.");
    meteringPoint = data as Record<string, unknown>;
  }

  const effectiveSiteId =
    requestedSiteId ??
    (typeof meteringPoint?.site_id === "string" ? meteringPoint.site_id : null);

  if (effectiveSiteId) {
    const { data, error } = await supabaseService
      .from("customer_sites")
      .select("id, customer_id, grid_owner_id")
      .eq("company_id", input.companyId)
      .eq("customer_id", input.customerId)
      .eq("id", effectiveSiteId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id)
      throw new Error(
        "Anläggningen hittades inte på vald kund och valt bolag.",
      );
    site = data as Record<string, unknown>;
  }

  if (
    meteringPoint &&
    effectiveSiteId &&
    meteringPoint.site_id !== effectiveSiteId
  ) {
    throw new Error("Vald mätpunkt tillhör inte vald anläggning.");
  }

  const inferredGridOwnerId =
    (typeof meteringPoint?.grid_owner_id === "string"
      ? meteringPoint.grid_owner_id
      : null) ??
    (typeof site?.grid_owner_id === "string" ? site.grid_owner_id : null);

  if (
    input.gridOwnerId &&
    inferredGridOwnerId &&
    input.gridOwnerId !== inferredGridOwnerId
  ) {
    throw new Error(
      "Vald nätägare matchar inte anläggningens eller mätpunktens nätägare.",
    );
  }

  return {
    siteId: effectiveSiteId,
    meteringPointId: requestedMeteringPointId,
    gridOwnerId: input.gridOwnerId ?? inferredGridOwnerId ?? null,
  };
}

async function assertCustomerBelongsToCompany(
  customerId: string,
  companyId: string,
) {
  const { data, error } = await supabaseService
    .from("customers")
    .select("id, company_id")
    .eq("id", customerId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id)
    throw new Error("Kunden tillhör inte valt bolag eller saknas.");
}

export async function createCustomerInfoRequest(input: {
  companyId: string;
  actorUserId: string;
  customerId: string;
  requestType: string;
  targetPartyType: string;
  targetPartyName?: string | null;
  gridOwnerId?: string | null;
  currentSupplierName?: string | null;
  siteId?: string | null;
  meteringPointId?: string | null;
  requestedDataCategories: string[];
  notes?: string | null;
  externalReference?: string | null;
}) {
  await requireCompanyOperationalForWrites(input.companyId);
  await assertCustomerBelongsToCompany(input.customerId, input.companyId);
  const anchors = await resolveCustomerInfoRequestAnchors({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    gridOwnerId: input.gridOwnerId ?? null,
  });

  const normalizedCategories = Array.from(
    new Set(
      input.requestedDataCategories
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  if (normalizedCategories.length === 0) {
    throw new Error(
      "Välj minst en uppgift som ska begäras eller kontrolleras.",
    );
  }

  const { data, error } = await supabaseService
    .from("customer_info_requests")
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      request_type: input.requestType,
      target_party_type: input.targetPartyType,
      target_party_name: input.targetPartyName ?? null,
      site_id: anchors.siteId,
      metering_point_id: anchors.meteringPointId,
      grid_owner_id: anchors.gridOwnerId,
      current_supplier_name: input.currentSupplierName ?? null,
      status: "draft",
      requested_data_categories: normalizedCategories,
      verified_payload: input.externalReference
        ? { externalReference: input.externalReference }
        : {},
      notes: input.notes ?? null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select("*")
    .single();

  if (error) throw error;

  await supabaseService.from("customer_info_request_events").insert({
    company_id: input.companyId,
    customer_info_request_id: data.id,
    customer_id: input.customerId,
    event_type: "created",
    message: "Uppgiftsbegäran skapades.",
    payload: {
      requested_data_categories: normalizedCategories,
      siteId: anchors.siteId,
      meteringPointId: anchors.meteringPointId,
      gridOwnerId: anchors.gridOwnerId,
    },
    created_by: input.actorUserId,
  });

  return data as CustomerInfoRequestRow;
}

export async function createAuthorizationScope(input: {
  companyId: string;
  actorUserId: string;
  customerId: string;
  scopeType: string;
  coversGridOwnerData: boolean;
  coversCurrentSupplierContract: boolean;
  coversMeteringData: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  evidenceNote?: string | null;
}) {
  await requireCompanyOperationalForWrites(input.companyId);
  await assertCustomerBelongsToCompany(input.customerId, input.companyId);

  const { data, error } = await supabaseService
    .from("authorization_scopes")
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      scope_type: input.scopeType,
      status: "active",
      covers_grid_owner_data: input.coversGridOwnerData,
      covers_current_supplier_contract: input.coversCurrentSupplierContract,
      covers_metering_data: input.coversMeteringData,
      valid_from: input.validFrom ?? null,
      valid_to: input.validTo ?? null,
      evidence_note: input.evidenceNote ?? null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as AuthorizationScopeRow;
}

export async function createMeteringPermissionDraft(input: {
  companyId: string;
  actorUserId: string;
  customerId: string;
  siteId?: string | null;
  meteringPointId?: string | null;
  gridOwnerId?: string | null;
  requestedStartDate?: string | null;
  requestedEndDate?: string | null;
  caseReference?: string | null;
  lastBlocker?: string | null;
}) {
  await requireCompanyOperationalForWrites(input.companyId);
  await assertCustomerBelongsToCompany(input.customerId, input.companyId);
  const anchors = await resolveCustomerInfoRequestAnchors({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    gridOwnerId: input.gridOwnerId ?? null,
  });

  const { data, error } = await supabaseService
    .from("metering_permissions")
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      site_id: anchors.siteId,
      metering_point_id: anchors.meteringPointId,
      grid_owner_id: anchors.gridOwnerId,
      status: input.lastBlocker ? "blocked" : "draft",
      requested_start_date: input.requestedStartDate ?? null,
      requested_end_date: input.requestedEndDate ?? null,
      case_reference: input.caseReference ?? null,
      last_blocker: input.lastBlocker ?? null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as MeteringPermissionRow;
}

export type InfoRequestDispatchResult = {
  customerInfoRequest: CustomerInfoRequestRow;
  gridOwnerDataRequestId: string | null;
  outboundRequestId: string | null;
  status: string;
  blockerReason: string | null;
};

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isDateBeforeToday(value: string | null | undefined): boolean {
  if (!value) return false;
  return value < todayDate();
}

function requestNeedsGridOwnerAuthorization(
  request: Pick<
    CustomerInfoRequestRow,
    "target_party_type" | "request_type" | "requested_data_categories"
  >,
): boolean {
  return (
    request.target_party_type === "grid_owner" ||
    request.request_type === "z01_customer_masterdata" ||
    request.requested_data_categories.includes("facility_id") ||
    request.requested_data_categories.includes("grid_area") ||
    request.requested_data_categories.includes("annual_consumption") ||
    request.requested_data_categories.includes("customer_masterdata")
  );
}

function requestNeedsSupplierContractAuthorization(
  request: Pick<
    CustomerInfoRequestRow,
    "target_party_type" | "requested_data_categories"
  >,
): boolean {
  return (
    request.target_party_type === "current_supplier" ||
    request.requested_data_categories.includes("binding_period") ||
    request.requested_data_categories.includes("termination_notice") ||
    request.requested_data_categories.includes("contract_end_date") ||
    request.requested_data_categories.includes("break_fee")
  );
}

async function listActiveAuthorizationScopesForCustomer(params: {
  companyId: string;
  customerId: string;
}): Promise<AuthorizationScopeRow[]> {
  const { data, error } = await supabaseService
    .from("authorization_scopes")
    .select("*")
    .eq("company_id", params.companyId)
    .eq("customer_id", params.customerId)
    .eq("status", "active")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as AuthorizationScopeRow[]).filter(
    (scopeRow) => !isDateBeforeToday(scopeRow.valid_to),
  );
}

function hasAuthorizationForRequest(
  request: CustomerInfoRequestRow,
  scopes: AuthorizationScopeRow[],
): { ok: boolean; reason: string | null } {
  const needsGridOwner = requestNeedsGridOwnerAuthorization(request);
  const needsSupplier = requestNeedsSupplierContractAuthorization(request);

  if (!needsGridOwner && !needsSupplier) return { ok: true, reason: null };

  if (
    needsGridOwner &&
    !scopes.some((scopeRow) => scopeRow.covers_grid_owner_data)
  ) {
    return {
      ok: false,
      reason:
        "Fullmakt/avtal måste täcka nätägarens anläggnings- och kunduppgifter innan begäran kan skickas.",
    };
  }

  if (
    needsSupplier &&
    !scopes.some((scopeRow) => scopeRow.covers_current_supplier_contract)
  ) {
    return {
      ok: false,
      reason:
        "Fullmakt/avtal måste täcka bindning, uppsägning och uppgifter från nuvarande elhandlare.",
    };
  }

  return { ok: true, reason: null };
}

async function getCustomerInfoRequestById(params: {
  companyId: string;
  requestId: string;
}): Promise<CustomerInfoRequestRow | null> {
  const { data, error } = await supabaseService
    .from("customer_info_requests")
    .select("*")
    .eq("company_id", params.companyId)
    .eq("id", params.requestId)
    .maybeSingle();

  if (error) throw error;
  return (data as CustomerInfoRequestRow | null) ?? null;
}

export async function listCustomerInfoRequestsByCustomerId(params: {
  companyId: string;
  customerId: string;
}): Promise<CustomerInfoRequestRow[]> {
  try {
    const { data, error } = await supabaseService
      .from("customer_info_requests")
      .select("*")
      .eq("company_id", params.companyId)
      .eq("customer_id", params.customerId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }

    return (data ?? []) as CustomerInfoRequestRow[];
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function listAuthorizationScopesByCustomerId(params: {
  companyId: string;
  customerId: string;
}): Promise<AuthorizationScopeRow[]> {
  try {
    const { data, error } = await supabaseService
      .from("authorization_scopes")
      .select("*")
      .eq("company_id", params.companyId)
      .eq("customer_id", params.customerId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }

    return (data ?? []) as AuthorizationScopeRow[];
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function listMeteringPermissionsByCustomerId(params: {
  companyId: string;
  customerId: string;
}): Promise<MeteringPermissionRow[]> {
  try {
    const { data, error } = await supabaseService
      .from("metering_permissions")
      .select("*")
      .eq("company_id", params.companyId)
      .eq("customer_id", params.customerId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }

    return (data ?? []) as MeteringPermissionRow[];
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

async function addCustomerInfoRequestEvent(input: {
  companyId: string;
  requestId: string;
  customerId: string;
  actorUserId: string;
  eventType: string;
  message: string;
  payload?: Record<string, unknown>;
}) {
  const { error } = await supabaseService
    .from("customer_info_request_events")
    .insert({
      company_id: input.companyId,
      customer_info_request_id: input.requestId,
      customer_id: input.customerId,
      event_type: input.eventType,
      message: input.message,
      payload: input.payload ?? {},
      created_by: input.actorUserId,
    });

  if (error && !isMissingRelationError(error)) throw error;
}

async function blockCustomerInfoRequest(params: {
  request: CustomerInfoRequestRow;
  companyId: string;
  actorUserId: string;
  status?: string;
  blockerReason: string;
  eventType: string;
}): Promise<InfoRequestDispatchResult> {
  const { data, error } = await supabaseService
    .from("customer_info_requests")
    .update({
      status: params.status ?? "blocked",
      blocker_reason: params.blockerReason,
      updated_by: params.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", params.companyId)
    .eq("id", params.request.id)
    .select("*")
    .single();

  if (error) throw error;

  await addCustomerInfoRequestEvent({
    companyId: params.companyId,
    requestId: params.request.id,
    customerId: params.request.customer_id,
    actorUserId: params.actorUserId,
    eventType: params.eventType,
    message: params.blockerReason,
  });

  return {
    customerInfoRequest: data as CustomerInfoRequestRow,
    gridOwnerDataRequestId: null,
    outboundRequestId: null,
    status: params.status ?? "blocked",
    blockerReason: params.blockerReason,
  };
}

function customerMasterdataAnchorsAreMissing(
  request: CustomerInfoRequestRow,
): string | null {
  if (!requestNeedsGridOwnerAuthorization(request)) return null;
  if (!request.site_id && !request.metering_point_id) {
    return "Anläggning och mätpunkt behöver väljas eller kompletteras innan begäran kan skickas.";
  }
  if (!request.grid_owner_id) {
    return "Nätägare behöver verifieras innan begäran kan skickas.";
  }
  return null;
}

export async function queueCustomerInfoRequestForDispatch(input: {
  companyId: string;
  actorUserId: string;
  requestId: string;
}): Promise<InfoRequestDispatchResult> {
  await requireCompanyOperationalForWrites(input.companyId);

  const request = await getCustomerInfoRequestById({
    companyId: input.companyId,
    requestId: input.requestId,
  });

  if (!request)
    throw new Error("Uppgiftsbegäran hittades inte för valt bolag.");
  await assertCustomerBelongsToCompany(request.customer_id, input.companyId);

  const scopes = await listActiveAuthorizationScopesForCustomer({
    companyId: input.companyId,
    customerId: request.customer_id,
  });
  const authorization = hasAuthorizationForRequest(request, scopes);

  if (!authorization.ok) {
    const { data, error } = await supabaseService
      .from("customer_info_requests")
      .update({
        status: "missing_authorization",
        blocker_reason: authorization.reason,
        updated_by: input.actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", input.companyId)
      .eq("id", request.id)
      .select("*")
      .single();

    if (error) throw error;

    await addCustomerInfoRequestEvent({
      companyId: input.companyId,
      requestId: request.id,
      customerId: request.customer_id,
      actorUserId: input.actorUserId,
      eventType: "blocked_missing_authorization",
      message:
        authorization.reason ?? "Begäran blockerades av fullmaktskontroll.",
    });

    return {
      customerInfoRequest: data as CustomerInfoRequestRow,
      gridOwnerDataRequestId: null,
      outboundRequestId: null,
      status: "missing_authorization",
      blockerReason: authorization.reason,
    };
  }

  if (
    requestNeedsSupplierContractAuthorization(request) &&
    !requestNeedsGridOwnerAuthorization(request)
  ) {
    const { data, error } = await supabaseService
      .from("customer_info_requests")
      .update({
        status: "manual_review_required",
        blocker_reason:
          "Bindningstid, uppsägningstid och avtalsvillkor ska bekräftas från kund eller nuvarande elhandlare. Ingen nätägarroute används för detta.",
        requested_at: new Date().toISOString(),
        updated_by: input.actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", input.companyId)
      .eq("id", request.id)
      .select("*")
      .single();

    if (error) throw error;

    await addCustomerInfoRequestEvent({
      companyId: input.companyId,
      requestId: request.id,
      customerId: request.customer_id,
      actorUserId: input.actorUserId,
      eventType: "manual_supplier_contract_check",
      message:
        "Begäran markerades för manuell kontroll mot kund eller nuvarande elhandlare.",
    });

    return {
      customerInfoRequest: data as CustomerInfoRequestRow,
      gridOwnerDataRequestId: null,
      outboundRequestId: null,
      status: "manual_review_required",
      blockerReason: null,
    };
  }

  const anchorBlockerReason = customerMasterdataAnchorsAreMissing(request);
  if (anchorBlockerReason) {
    return blockCustomerInfoRequest({
      request,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      blockerReason: anchorBlockerReason,
      eventType: "blocked_missing_z01_anchors",
    });
  }

  const automationKey = `customer-info-request:${request.id}:z01`;
  const gridOwnerDataRequest = await createGridOwnerDataRequest({
    actorUserId: input.actorUserId,
    customerId: request.customer_id,
    siteId: request.site_id,
    meteringPointId: request.metering_point_id,
    gridOwnerId: request.grid_owner_id,
    requestScope: "customer_masterdata",
    externalReference:
      (request.verified_payload?.externalReference as string | null) ??
      `Z01-${request.id.slice(0, 8).toUpperCase()}`,
    notes: request.notes,
    automationOrigin: "customer_info_request",
    automationKey,
  });

  let z01: Awaited<ReturnType<typeof prepareAndQueueProdatZ01FromDataRequest>>;
  try {
    z01 = await prepareAndQueueProdatZ01FromDataRequest({
      actorUserId: input.actorUserId,
      gridOwnerDataRequestId: gridOwnerDataRequest.id,
    });
  } catch (error) {
    const blockerReason =
      error instanceof Error
        ? error.message
        : "PRODAT Z01 kunde inte förberedas.";
    return blockCustomerInfoRequest({
      request,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      blockerReason,
      eventType: "blocked_z01_prepare_failed",
    });
  }

  const nextStatus = z01.prepared ? "z01_prepared" : "route_missing";
  const blockerReason = z01.blockerReason;
  const now = new Date().toISOString();

  const { data, error } = await supabaseService
    .from("customer_info_requests")
    .update({
      status: nextStatus,
      requested_at: now,
      sent_at: null,
      blocker_reason: blockerReason,
      verified_payload: {
        ...(request.verified_payload ?? {}),
        gridOwnerDataRequestId: gridOwnerDataRequest.id,
        outboundRequestId: z01.outbound.id,
        edielMessageId: z01.message?.id ?? null,
        expectedResponse:
          "Svar från nätägare",
        prodatCode: "Z01",
        routeReady: z01.prepared,
      },
      updated_by: input.actorUserId,
      updated_at: now,
    })
    .eq("company_id", input.companyId)
    .eq("id", request.id)
    .select("*")
    .single();

  if (error) throw error;

  await addCustomerInfoRequestEvent({
    companyId: input.companyId,
    requestId: request.id,
    customerId: request.customer_id,
    actorUserId: input.actorUserId,
    eventType: z01.prepared ? "z01_prepared_for_dispatch" : "z01_route_missing",
    message: z01.prepared
      ? "Begäran är förberedd och köad för utskick till nätägare."
      : (blockerReason ?? "Kontaktväg till nätägare behöver verifieras innan utskick."),
    payload: {
      gridOwnerDataRequestId: gridOwnerDataRequest.id,
      outboundRequestId: z01.outbound.id,
      edielMessageId: z01.message?.id ?? null,
      prodatCode: "Z01",
    },
  });

  return {
    customerInfoRequest: data as CustomerInfoRequestRow,
    gridOwnerDataRequestId: gridOwnerDataRequest.id,
    outboundRequestId: z01.outbound.id,
    status: nextStatus,
    blockerReason,
  };
}

async function getMeteringPermissionById(params: {
  companyId: string;
  permissionId: string;
}): Promise<MeteringPermissionRow | null> {
  const { data, error } = await supabaseService
    .from("metering_permissions")
    .select("*")
    .eq("company_id", params.companyId)
    .eq("id", params.permissionId)
    .maybeSingle();

  if (error) throw error;
  return (data as MeteringPermissionRow | null) ?? null;
}

export async function queueMeteringPermissionForZ13(input: {
  companyId: string;
  actorUserId: string;
  permissionId: string;
}): Promise<{
  permission: MeteringPermissionRow;
  gridOwnerDataRequestId: string | null;
  outboundRequestId: string | null;
}> {
  await requireCompanyOperationalForWrites(input.companyId);

  const permission = await getMeteringPermissionById({
    companyId: input.companyId,
    permissionId: input.permissionId,
  });

  if (!permission)
    throw new Error("Mätvärdestillstånd hittades inte för valt bolag.");
  await assertCustomerBelongsToCompany(permission.customer_id, input.companyId);

  const scopes = await listActiveAuthorizationScopesForCustomer({
    companyId: input.companyId,
    customerId: permission.customer_id,
  });

  if (!scopes.some((scopeRow) => scopeRow.covers_metering_data)) {
    const { data, error } = await supabaseService
      .from("metering_permissions")
      .update({
        status: "missing_authorization",
        last_blocker:
          "Fullmakt/avtal måste täcka mätvärden innan PRODAT Z13 kan skickas.",
        updated_by: input.actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", input.companyId)
      .eq("id", permission.id)
      .select("*")
      .single();

    if (error) throw error;
    return {
      permission: data as MeteringPermissionRow,
      gridOwnerDataRequestId: null,
      outboundRequestId: null,
    };
  }

  const automationKey = `metering-permission:${permission.id}:z13`;
  const gridOwnerDataRequest = await createGridOwnerDataRequest({
    actorUserId: input.actorUserId,
    customerId: permission.customer_id,
    siteId: permission.site_id,
    meteringPointId: permission.metering_point_id,
    gridOwnerId: permission.grid_owner_id,
    requestScope: "meter_values",
    requestedPeriodStart: permission.requested_start_date,
    requestedPeriodEnd: permission.requested_end_date,
    externalReference:
      permission.case_reference ??
      `Z13-${permission.id.slice(0, 8).toUpperCase()}`,
    notes: "Skapad från mätvärdestillstånd/Z13-flöde.",
    automationOrigin: "metering_permission",
    automationKey,
  });

  const outbound = await createOutboundRequest({
    actorUserId: input.actorUserId,
    customerId: permission.customer_id,
    siteId: permission.site_id,
    meteringPointId: permission.metering_point_id,
    gridOwnerId: permission.grid_owner_id,
    requestType: "meter_values",
    sourceType: "grid_owner_data_request",
    sourceId: gridOwnerDataRequest.id,
    periodStart: permission.requested_start_date,
    periodEnd: permission.requested_end_date,
    externalReference:
      permission.case_reference ?? gridOwnerDataRequest.external_reference,
    automationOrigin: "metering_permission_z13",
    automationKey: `outbound:${automationKey}`,
    payload: {
      prodatCode: "Z13",
      expectedResponse: "PRODAT Z14 V/VH eller Z14N",
      meteringPermissionId: permission.id,
      gridOwnerDataRequestId: gridOwnerDataRequest.id,
    },
  });

  const metadata = {
    ...((permission as unknown as { metadata?: Record<string, unknown> })
      .metadata ?? {}),
    z13: {
      gridOwnerDataRequestId: gridOwnerDataRequest.id,
      outboundRequestId: outbound.id,
      queuedAt: new Date().toISOString(),
    },
  };

  const { data, error } = await supabaseService
    .from("metering_permissions")
    .update({
      status: "z13_sent",
      case_reference:
        permission.case_reference ?? gridOwnerDataRequest.external_reference,
      last_blocker: null,
      metadata,
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("id", permission.id)
    .select("*")
    .single();

  if (error) throw error;

  return {
    permission: data as MeteringPermissionRow,
    gridOwnerDataRequestId: gridOwnerDataRequest.id,
    outboundRequestId: outbound.id,
  };
}

export async function applyZ14SnapshotToMeteringPermission(input: {
  companyId: string;
  actorUserId: string;
  permissionId: string;
  permissionReference?: string | null;
  approvedStartDate?: string | null;
  approvedEndDate?: string | null;
  resolutionCode?: string | null;
  reportFrequency?: string | null;
  approvedSites?: Array<{
    siteId?: string | null;
    meteringPointId?: string | null;
    facilityId?: string | null;
    gridAreaCode?: string | null;
    status?: string | null;
  }>;
}) {
  await requireCompanyOperationalForWrites(input.companyId);

  const permission = await getMeteringPermissionById({
    companyId: input.companyId,
    permissionId: input.permissionId,
  });
  if (!permission)
    throw new Error("Mätvärdestillstånd hittades inte för valt bolag.");

  const approvedSites = input.approvedSites ?? [];
  const status = approvedSites.some(
    (site) => (site.status ?? "approved") === "approved",
  )
    ? approvedSites.length > 1
      ? "partially_approved"
      : "z14_received"
    : "rejected_active";

  const { data, error } = await supabaseService
    .from("metering_permissions")
    .update({
      status,
      permission_reference:
        input.permissionReference ?? permission.permission_reference,
      approved_start_date:
        input.approvedStartDate ?? permission.approved_start_date,
      approved_end_date: input.approvedEndDate ?? permission.approved_end_date,
      resolution_code: input.resolutionCode ?? permission.resolution_code,
      report_frequency: input.reportFrequency ?? permission.report_frequency,
      last_blocker:
        status === "rejected_active"
          ? "Z14 markerade begäran som nekad."
          : null,
      metadata: {
        ...((permission as unknown as { metadata?: Record<string, unknown> })
          .metadata ?? {}),
        z14: {
          appliedAt: new Date().toISOString(),
          approvedSites,
        },
      },
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("id", permission.id)
    .select("*")
    .single();

  if (error) throw error;

  if (approvedSites.length > 0) {
    const rows = approvedSites.map((site) => ({
      company_id: input.companyId,
      metering_permission_id: permission.id,
      customer_id: permission.customer_id,
      site_id: site.siteId ?? permission.site_id,
      metering_point_id: site.meteringPointId ?? permission.metering_point_id,
      facility_id: site.facilityId ?? null,
      grid_area_code: site.gridAreaCode ?? null,
      status: site.status ?? "approved",
      start_date: input.approvedStartDate ?? permission.approved_start_date,
      end_date: input.approvedEndDate ?? permission.approved_end_date,
      metadata: { source: "z14_snapshot" },
    }));

    const { error: siteError } = await supabaseService
      .from("metering_permission_sites")
      .insert(rows);

    if (siteError && !isMissingRelationError(siteError)) throw siteError;
  }

  return data as MeteringPermissionRow;
}
