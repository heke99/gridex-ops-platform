// types/customers.ts

export type CustomerStatus =
  | 'draft'
  | 'pending_verification'
  | 'active'
  | 'inactive'
  | 'moved'
  | 'terminated'
  | 'blocked'

export type CustomerType = 'private' | 'business'

export type CustomerRow = {
  id: string
  customer_type: CustomerType
  status: CustomerStatus
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
  customer_number: string | null
  apartment_number: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CustomerAddressRow = {
  id: string
  customer_id: string
  address_type: 'registered' | 'billing' | 'facility' | 'other'
  street: string | null
  street_2: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  municipality: string | null
  moved_in_at: string | null
  moved_out_at: string | null
  is_primary: boolean | null
  is_active: boolean | null
  created_at: string
  updated_at?: string | null
}

export type CustomerNoteRow = {
  id: string
  customer_id: string
  title?: string | null
  body: string | null
  note_type?: string | null
  created_by: string | null
  created_at: string
  updated_at: string | null
}

export type CustomerSiteRow = {
  id: string
  customer_id: string
  site_name: string | null
  facility_id: string | null
  site_type: 'consumption' | 'production' | 'mixed'
  status:
    | 'draft'
    | 'pending_activation'
    | 'active'
    | 'inactive'
    | 'moved'
    | 'ended'
    | string
  grid_owner_id: string | null
  price_area_code: string | null
  move_in_date: string | null
  move_out_date: string | null
  annual_consumption_kwh: number | null
  annual_production_kwh?: number | null
  current_supplier_name: string | null
  current_supplier_org_number?: string | null
  street: string | null
  care_of?: string | null
  postal_code: string | null
  city: string | null
  moved_from_street?: string | null
  moved_from_postal_code?: string | null
  moved_from_city?: string | null
  moved_from_supplier_name?: string | null
  notes?: string | null
  created_by?: string | null
  updated_by?: string | null
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

export type CustomerContactRow = {
  id: string
  customer_id: string
  name: string | null
  role: string | null
  email: string | null
  phone: string | null
  is_primary: boolean | null
  created_at: string
  updated_at?: string | null
}

export type CustomerDetailData = {
  customer: CustomerRow
  contacts: CustomerContactRow[]
  addresses: CustomerAddressRow[]
  sites: CustomerSiteRow[]
  notes: CustomerNoteRow[]
}