import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseService } from "@/lib/supabase/service";
import type {
  AuditLogRow,
  CustomerInternalNoteRow,
  CustomerSiteRow,
  ElectricitySupplierRow,
  GridOwnerRow,
  MeteringPointRow,
  PriceAreaLocalityRow,
  PriceAreaRow,
} from "@/lib/masterdata/types";
import type {
  CustomerInternalNoteInput,
  CustomerSiteInput,
  ElectricitySupplierInput,
  GridOwnerInput,
  MeteringPointInput,
  PriceAreaLocalityInput,
} from "@/lib/masterdata/validators";

async function getActorId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

export async function listPriceAreas(
  supabase: SupabaseClient,
): Promise<PriceAreaRow[]> {
  const { data, error } = await supabase
    .from("price_areas")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data ?? []) as PriceAreaRow[];
}

export async function listPriceAreaLocalities(
  supabase: SupabaseClient,
  options: {
    priceAreaCode?: string | null;
    activeOnly?: boolean;
  } = {},
): Promise<PriceAreaLocalityRow[]> {
  let query = supabase
    .from("price_area_localities")
    .select("*")
    .order("price_area_code", { ascending: true })
    .order("locality_name", { ascending: true });

  if (options.priceAreaCode && options.priceAreaCode !== "all") {
    query = query.eq("price_area_code", options.priceAreaCode);
  }

  if (options.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as PriceAreaLocalityRow[];
}

export async function getPriceAreaLocalityById(
  supabase: SupabaseClient,
  id: string,
): Promise<PriceAreaLocalityRow | null> {
  const { data, error } = await supabase
    .from("price_area_localities")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as PriceAreaLocalityRow | null) ?? null;
}

export async function savePriceAreaLocality(
  supabase: SupabaseClient,
  input: PriceAreaLocalityInput,
): Promise<PriceAreaLocalityRow> {
  const actorId = await getActorId(supabase);

  const payload = {
    price_area_code: input.price_area_code,
    locality_name: input.locality_name,
    municipality: input.municipality,
    postal_code: input.postal_code,
    is_active: input.is_active,
    updated_by: actorId,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("price_area_localities")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();

    if (error) throw error;
    return data as PriceAreaLocalityRow;
  }

  const { data, error } = await supabase
    .from("price_area_localities")
    .insert({
      ...payload,
      created_by: actorId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as PriceAreaLocalityRow;
}

export async function listGridOwners(
  supabase: SupabaseClient,
  options: { customerFlowOnly?: boolean } = {},
): Promise<GridOwnerRow[]> {
  const { data, error } = await supabase
    .from("grid_owners")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;
  const rows = (data ?? []) as GridOwnerRow[];
  if (!options.customerFlowOnly) return rows;

  const verifiedRows = rows.filter((row) => {
    const record = row as GridOwnerRow & { verified_for_customer_flow?: boolean | null; actor_registry_status?: string | null };
    return row.is_active && row.lifecycle_status !== "blocked" && record.verified_for_customer_flow === true && record.actor_registry_status === "verified" && Boolean(row.ediel_id);
  });
  return verifiedRows;
}

export async function getGridOwnerById(
  supabase: SupabaseClient,
  id: string,
): Promise<GridOwnerRow | null> {
  const { data, error } = await supabase
    .from("grid_owners")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as GridOwnerRow | null) ?? null;
}

export async function saveGridOwner(
  supabase: SupabaseClient,
  input: GridOwnerInput,
): Promise<GridOwnerRow> {
  const actorId = await getActorId(supabase);

  const payload = {
    name: input.name,
    owner_code: input.owner_code,
    ediel_id: input.ediel_id,
    org_number: input.org_number,
    environment: input.environment,
    lifecycle_status: input.lifecycle_status,
    default_prodat_subaddress: input.default_prodat_subaddress,
    default_utilts_subaddress: input.default_utilts_subaddress,
    transport_channel: input.transport_channel,
    communication_email: input.communication_email,
    contact_name: input.contact_name,
    email: input.email,
    phone: input.phone,
    address_line_1: input.address_line_1,
    address_line_2: input.address_line_2,
    postal_code: input.postal_code,
    city: input.city,
    country: input.country,
    notes: input.notes,
    is_active: input.is_active,
    updated_by: actorId,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("grid_owners")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();

    if (error) throw error;
    return data as GridOwnerRow;
  }

  const { data, error } = await supabase
    .from("grid_owners")
    .insert({
      ...payload,
      created_by: actorId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as GridOwnerRow;
}

export async function listElectricitySuppliers(
  supabase: SupabaseClient,
  options: {
    activeOnly?: boolean;
    customerFlowOnly?: boolean;
  } = {},
): Promise<ElectricitySupplierRow[]> {
  let query = supabase
    .from("electricity_suppliers")
    .select("*")
    .order("is_own_supplier", { ascending: false })
    .order("name", { ascending: true });

  if (options.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as ElectricitySupplierRow[];
  if (!options.customerFlowOnly) return rows;

  const verifiedRows = rows.filter((row) => {
    const record = row as ElectricitySupplierRow & { verified_for_customer_flow?: boolean | null; actor_registry_status?: string | null };
    return row.is_active && record.verified_for_customer_flow === true && record.actor_registry_status === "verified";
  });
  return verifiedRows;
}

export async function getElectricitySupplierById(
  supabase: SupabaseClient,
  id: string,
): Promise<ElectricitySupplierRow | null> {
  const { data, error } = await supabase
    .from("electricity_suppliers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as ElectricitySupplierRow | null) ?? null;
}

export async function findElectricitySupplierMatch(
  supabase: SupabaseClient,
  params: {
    name?: string | null;
    orgNumber?: string | null;
  },
): Promise<ElectricitySupplierRow | null> {
  const trimmedName = params.name?.trim() ?? null;
  const trimmedOrg = params.orgNumber?.trim() ?? null;

  if (trimmedOrg) {
    const { data, error } = await supabase
      .from("electricity_suppliers")
      .select("*")
      .eq("org_number", trimmedOrg)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data as ElectricitySupplierRow;
  }

  if (trimmedName) {
    const { data, error } = await supabase
      .from("electricity_suppliers")
      .select("*")
      .ilike("name", trimmedName)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data as ElectricitySupplierRow;
  }

  return null;
}

export async function saveElectricitySupplier(
  supabase: SupabaseClient,
  input: ElectricitySupplierInput,
): Promise<ElectricitySupplierRow> {
  const actorId = await getActorId(supabase);

  const payload = {
    name: input.name,
    org_number: input.org_number,
    market_actor_code: input.market_actor_code,
    ediel_id: input.ediel_id,
    contact_name: input.contact_name,
    email: input.email,
    customer_service_email: input.customer_service_email ?? input.email ?? null,
    switching_email: input.switching_email ?? null,
    contract_email: input.contract_email ?? null,
    website: input.website ?? null,
    phone: input.phone,
    notes: input.notes,
    is_active: input.is_active,
    ...(typeof input.is_own_supplier === "boolean"
      ? { is_own_supplier: input.is_own_supplier }
      : {}),
    updated_by: actorId,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("electricity_suppliers")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();

    if (error) throw error;
    return data as ElectricitySupplierRow;
  }

  const existing = await findElectricitySupplierMatch(supabase, {
    name: input.name,
    orgNumber: input.org_number,
  });

  if (existing) {
    const { data, error } = await supabase
      .from("electricity_suppliers")
      .update({
        ...payload,
        updated_by: actorId,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) throw error;
    return data as ElectricitySupplierRow;
  }

  const { data, error } = await supabase
    .from("electricity_suppliers")
    .insert({
      ...payload,
      created_by: actorId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as ElectricitySupplierRow;
}

export async function listCustomerSitesByCustomerId(
  supabase: SupabaseClient,
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {},
): Promise<CustomerSiteRow[]> {
  let query = supabase
    .from("customer_sites")
    .select("*")
    .eq("customer_id", customerId);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (error) throw error;
  return (data ?? []) as CustomerSiteRow[];
}

export async function getCustomerSiteById(
  supabase: SupabaseClient,
  siteId: string,
  options: { companyId?: string | null } = {},
): Promise<CustomerSiteRow | null> {
  let query = supabase.from("customer_sites").select("*").eq("id", siteId);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return (data as CustomerSiteRow | null) ?? null;
}

export async function saveCustomerSite(
  supabase: SupabaseClient,
  input: CustomerSiteInput,
): Promise<CustomerSiteRow> {
  const actorId = await getActorId(supabase);

  const payload = {
    company_id: input.company_id,
    customer_id: input.customer_id,
    site_name: input.site_name,
    facility_id: input.facility_id,
    site_type: input.site_type,
    status: input.status,
    grid_owner_id: input.grid_owner_id,
    data_quality_status:
      !input.facility_id || !input.grid_owner_id ? "incomplete" : "complete",
    missing_data_status:
      !input.facility_id || !input.grid_owner_id
        ? "missing_required_data"
        : null,
    price_area_code: input.price_area_code,
    move_in_date: input.move_in_date,
    annual_consumption_kwh: input.annual_consumption_kwh,
    current_supplier_name: input.current_supplier_name,
    current_supplier_org_number: input.current_supplier_org_number,
    street: input.street,
    care_of: input.care_of,
    postal_code: input.postal_code,
    city: input.city,
    country: input.country,
    moved_from_street: input.moved_from_street,
    moved_from_postal_code: input.moved_from_postal_code,
    moved_from_city: input.moved_from_city,
    moved_from_supplier_name: input.moved_from_supplier_name,
    internal_notes: input.internal_notes,
    updated_by: actorId,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("customer_sites")
      .update(payload)
      .eq("id", input.id)
      .eq("company_id", input.company_id)
      .select("*")
      .single();

    if (error) throw error;
    return data as CustomerSiteRow;
  }

  const { data, error } = await supabase
    .from("customer_sites")
    .insert({
      ...payload,
      created_by: actorId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as CustomerSiteRow;
}

export async function listMeteringPointsBySiteIds(
  supabase: SupabaseClient,
  siteIds: string[],
  options: { companyId?: string | null } = {},
): Promise<MeteringPointRow[]> {
  if (siteIds.length === 0) return [];

  let query = supabase
    .from("metering_points")
    .select("*")
    .in("site_id", siteIds);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as MeteringPointRow[];
}

export async function getMeteringPointById(
  supabase: SupabaseClient,
  id: string,
  options: { companyId?: string | null } = {},
): Promise<MeteringPointRow | null> {
  let query = supabase.from("metering_points").select("*").eq("id", id);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return (data as MeteringPointRow | null) ?? null;
}

export async function saveMeteringPoint(
  supabase: SupabaseClient,
  input: MeteringPointInput,
): Promise<MeteringPointRow> {
  const actorId = await getActorId(supabase);

  const payload = {
    company_id: input.company_id,
    customer_id: input.customer_id,
    site_id: input.site_id,
    meter_point_id: input.meter_point_id,
    site_facility_id: input.site_facility_id,
    ediel_reference: input.ediel_reference,
    status: input.status,
    measurement_type: input.measurement_type,
    reading_frequency: input.reading_frequency,
    grid_owner_id: input.grid_owner_id,
    data_quality_status:
      !input.meter_point_id || !input.grid_owner_id ? "incomplete" : "complete",
    verification_status:
      !input.meter_point_id || !input.grid_owner_id ? "pending" : "verified",
    price_area_code: input.price_area_code,
    start_date: input.start_date,
    end_date: input.end_date,
    is_settlement_relevant: input.is_settlement_relevant,
    updated_by: actorId,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("metering_points")
      .update(payload)
      .eq("id", input.id)
      .eq("company_id", input.company_id)
      .select("*")
      .single();

    if (error) throw error;
    return data as MeteringPointRow;
  }

  const { data, error } = await supabase
    .from("metering_points")
    .insert({
      ...payload,
      created_by: actorId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as MeteringPointRow;
}

export async function listCustomerInternalNotes(
  supabase: SupabaseClient,
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {},
): Promise<CustomerInternalNoteRow[]> {
  let query = supabase
    .from("customer_internal_notes")
    .select("*")
    .eq("customer_id", customerId);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (error) throw error;
  return (data ?? []) as CustomerInternalNoteRow[];
}

export async function listCustomerInternalNotesByCustomerId(
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {},
): Promise<CustomerInternalNoteRow[]> {
  let query = supabaseService
    .from("customer_internal_notes")
    .select("*")
    .eq("customer_id", customerId);

  if (options.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (error) throw error;
  return (data ?? []) as CustomerInternalNoteRow[];
}

export async function addCustomerInternalNote(
  supabase: SupabaseClient,
  input: CustomerInternalNoteInput,
): Promise<CustomerInternalNoteRow> {
  const actorId = await getActorId(supabase);

  const { data, error } = await supabase
    .from("customer_internal_notes")
    .insert({
      company_id: input.company_id,
      customer_id: input.customer_id,
      body: input.body,
      created_by: actorId,
      updated_by: actorId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as CustomerInternalNoteRow;
}

export async function listAuditLogsForCustomer(
  customerId: string,
): Promise<AuditLogRow[]> {
  const { data, error } = await supabaseService
    .from("audit_logs")
    .select("*")
    .eq("entity_id", customerId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []) as AuditLogRow[];
}

export async function listMasterdataAuditLogsForCustomer(params: {
  customerId: string;
  siteIds?: string[];
  meteringPointIds?: string[];
  limit?: number;
}): Promise<AuditLogRow[]> {
  const ids = [
    params.customerId,
    ...(params.siteIds ?? []),
    ...(params.meteringPointIds ?? []),
  ].filter(
    (value, index, array): value is string =>
      Boolean(value) && array.indexOf(value) === index,
  );

  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await supabaseService
    .from("audit_logs")
    .select("*")
    .in("entity_id", ids)
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 50);

  if (error) throw error;
  return (data ?? []) as AuditLogRow[];
}
