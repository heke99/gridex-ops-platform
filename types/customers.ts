export type CustomerRow = {
  id: string
  customer_type: 'private' | 'business'
  status:
    | 'draft'
    | 'pending_verification'
    | 'active'
    | 'inactive'
    | 'moved'
    | 'terminated'
    | 'blocked'
  first_name: string | null
  last_name: string | null
  full_name: string | null
  company_name: string | null
  personal_number: string | null
  org_number: string | null
  email: string | null
  phone: string | null
  preferred_language: string | null
  source: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CustomerAddressRow = {
  id: string
  customer_id: string
  type: 'registered' | 'billing' | 'facility' | 'other'
  street_1: string
  street_2: string | null
  postal_code: string | null
  city: string | null
  country: string
  municipality: string | null
  moved_in_at: string | null
  moved_out_at: string | null
  is_active: boolean
  created_at: string
}

export type CustomerNoteRow = {
  id: string
  customer_id: string
  note: string
  is_internal: boolean
  created_by: string | null
  created_at: string
}

export type SiteRow = {
  id: string
  customer_id: string
  nickname: string | null
  facility_name: string | null
  status: 'draft' | 'pending_activation' | 'active' | 'inactive' | 'moved' | 'ended'
  grid_owner_id: string | null
  price_area_id: string | null
  site_type: 'consumption' | 'production' | 'mixed'
  facility_address_id: string | null
  move_in_date: string | null
  move_out_date: string | null
  annual_consumption_kwh: number | null
  annual_production_kwh: number | null
  current_supplier_name: string | null
  notes: string | null
  created_at: string
  updated_at: string
  grid_owners?: {
    id: string
    name: string
    code: string | null
  } | null
  price_areas?: {
    id: string
    code: string
    name: string
  } | null
}

export type CustomerDetailData = {
  customer: CustomerRow
  contacts: unknown[]
  addresses: CustomerAddressRow[]
  sites: SiteRow[]
  notes: CustomerNoteRow[]
}