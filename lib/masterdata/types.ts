export type PriceAreaCode = 'SE1' | 'SE2' | 'SE3' | 'SE4'

export type SiteType = 'consumption' | 'production' | 'mixed'

export type SiteStatus =
  | 'draft'
  | 'active'
  | 'pending_move'
  | 'inactive'
  | 'closed'

export type MeteringPointStatus =
  | 'draft'
  | 'active'
  | 'pending_validation'
  | 'inactive'
  | 'closed'

export type MeasurementType = 'consumption' | 'production' | 'mixed'

export type ReadingFrequency = 'hourly' | 'daily' | 'monthly' | 'manual'

export type GridOwnerRow = {
  id: string
  name: string
  owner_code: string
  ediel_id: string | null
  org_number: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
  address_line_1: string | null
  address_line_2: string | null
  postal_code: string | null
  city: string | null
  country: string
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type PriceAreaRow = {
  code: PriceAreaCode
  name: string
  sort_order: number
  created_at: string
}

export type CustomerSiteRow = {
  id: string
  customer_id: string
  site_name: string
  facility_id: string | null
  site_type: SiteType
  status: SiteStatus
  grid_owner_id: string | null
  price_area_code: PriceAreaCode | null
  move_in_date: string | null
  annual_consumption_kwh: number | null
  current_supplier_name: string | null
  current_supplier_org_number: string | null
  street: string | null
  care_of: string | null
  postal_code: string | null
  city: string | null
  country: string
  moved_from_street: string | null
  moved_from_postal_code: string | null
  moved_from_city: string | null
  moved_from_supplier_name: string | null
  internal_notes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type MeteringPointRow = {
  id: string
  site_id: string
  meter_point_id: string
  site_facility_id: string | null
  ediel_reference: string | null
  status: MeteringPointStatus
  measurement_type: MeasurementType
  reading_frequency: ReadingFrequency
  grid_owner_id: string | null
  price_area_code: PriceAreaCode | null
  start_date: string | null
  end_date: string | null
  is_settlement_relevant: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type CustomerInternalNoteRow = {
  id: string
  customer_id: string
  body: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type AuditLogRow = {
  id: string
  actor_user_id: string | null
  entity_type: string
  entity_id: string
  action: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export type CustomerListRow = {
  id: string
  customer_type: string | null
  status: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  created_at: string
  site_count: number
  metering_point_count: number
  active_site_count: number
  active_metering_point_count: number
}

export type MasterdataAuditEntry = {
  id: string
  actor_user_id: string | null
  entity_type: 'customer_site' | 'metering_point'
  entity_id: string
  action: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
}