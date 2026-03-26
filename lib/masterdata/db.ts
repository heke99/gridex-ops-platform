import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
  PriceAreaRow,
} from '@/lib/masterdata/types'
import type {
  CustomerSiteInput,
  GridOwnerInput,
  MeteringPointInput,
} from '@/lib/masterdata/validators'

async function getActorId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user?.id ?? null
}

export async function listPriceAreas(
  supabase: SupabaseClient
): Promise<PriceAreaRow[]> {
  const { data, error } = await supabase
    .from('price_areas')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data ?? []) as PriceAreaRow[]
}

export async function listGridOwners(
  supabase: SupabaseClient
): Promise<GridOwnerRow[]> {
  const { data, error } = await supabase
    .from('grid_owners')
    .select('*')
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []) as GridOwnerRow[]
}

export async function getGridOwnerById(
  supabase: SupabaseClient,
  id: string
): Promise<GridOwnerRow | null> {
  const { data, error } = await supabase
    .from('grid_owners')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data as GridOwnerRow | null) ?? null
}

export async function saveGridOwner(
  supabase: SupabaseClient,
  input: GridOwnerInput
): Promise<GridOwnerRow> {
  const actorId = await getActorId(supabase)

  const payload = {
    name: input.name,
    owner_code: input.owner_code,
    ediel_id: input.ediel_id,
    org_number: input.org_number,
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
  }

  if (input.id) {
    const { data, error } = await supabase
      .from('grid_owners')
      .update(payload)
      .eq('id', input.id)
      .select('*')
      .single()

    if (error) throw error
    return data as GridOwnerRow
  }

  const { data, error } = await supabase
    .from('grid_owners')
    .insert({
      ...payload,
      created_by: actorId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as GridOwnerRow
}

export async function listCustomerSitesByCustomerId(
  supabase: SupabaseClient,
  customerId: string
): Promise<CustomerSiteRow[]> {
  const { data, error } = await supabase
    .from('customer_sites')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as CustomerSiteRow[]
}

export async function getCustomerSiteById(
  supabase: SupabaseClient,
  siteId: string
): Promise<CustomerSiteRow | null> {
  const { data, error } = await supabase
    .from('customer_sites')
    .select('*')
    .eq('id', siteId)
    .maybeSingle()

  if (error) throw error
  return (data as CustomerSiteRow | null) ?? null
}

export async function saveCustomerSite(
  supabase: SupabaseClient,
  input: CustomerSiteInput
): Promise<CustomerSiteRow> {
  const actorId = await getActorId(supabase)

  const payload = {
    customer_id: input.customer_id,
    site_name: input.site_name,
    facility_id: input.facility_id,
    site_type: input.site_type,
    status: input.status,
    grid_owner_id: input.grid_owner_id,
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
    internal_notes: input.internal_notes,
    updated_by: actorId,
  }

  if (input.id) {
    const { data, error } = await supabase
      .from('customer_sites')
      .update(payload)
      .eq('id', input.id)
      .select('*')
      .single()

    if (error) throw error
    return data as CustomerSiteRow
  }

  const { data, error } = await supabase
    .from('customer_sites')
    .insert({
      ...payload,
      created_by: actorId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as CustomerSiteRow
}

export async function listMeteringPointsBySiteId(
  supabase: SupabaseClient,
  siteId: string
): Promise<MeteringPointRow[]> {
  const { data, error } = await supabase
    .from('metering_points')
    .select('*')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as MeteringPointRow[]
}

export async function listMeteringPointsBySiteIds(
  supabase: SupabaseClient,
  siteIds: string[]
): Promise<MeteringPointRow[]> {
  if (siteIds.length === 0) return []

  const { data, error } = await supabase
    .from('metering_points')
    .select('*')
    .in('site_id', siteIds)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as MeteringPointRow[]
}

export async function saveMeteringPoint(
  supabase: SupabaseClient,
  input: MeteringPointInput
): Promise<MeteringPointRow> {
  const actorId = await getActorId(supabase)

  const payload = {
    site_id: input.site_id,
    meter_point_id: input.meter_point_id,
    site_facility_id: input.site_facility_id,
    ediel_reference: input.ediel_reference,
    status: input.status,
    measurement_type: input.measurement_type,
    reading_frequency: input.reading_frequency,
    grid_owner_id: input.grid_owner_id,
    price_area_code: input.price_area_code,
    start_date: input.start_date,
    end_date: input.end_date,
    is_settlement_relevant: input.is_settlement_relevant,
    updated_by: actorId,
  }

  if (input.id) {
    const { data, error } = await supabase
      .from('metering_points')
      .update(payload)
      .eq('id', input.id)
      .select('*')
      .single()

    if (error) throw error
    return data as MeteringPointRow
  }

  const { data, error } = await supabase
    .from('metering_points')
    .insert({
      ...payload,
      created_by: actorId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as MeteringPointRow
}