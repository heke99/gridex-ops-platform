// types/customers.ts

export type CustomerStatus =
  | 'draft'
  | 'pending_verification'
  | 'active'
  | 'inactive'
  | 'moved'
  | 'terminated'
  | 'blocked'

export type CustomerType = 'private' | 'business' | 'association'

export type CustomerRow = {
  id: string
  customer_type: CustomerType | string
  status: CustomerStatus | string
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

export type CustomerAddressType = 'registered' | 'billing' | 'facility' | 'other'

export type CustomerAddressRow = {
  id: string
  customer_id: string
  type: CustomerAddressType | string
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

export type CustomerContactType =
  | 'primary'
  | 'billing'
  | 'operations'
  | 'technical'
  | 'other'
  | string

export type CustomerContactRow = {
  id: string
  customer_id: string
  type: CustomerContactType
  name: string | null
  email: string | null
  phone: string | null
  title: string | null
  is_primary: boolean
  created_at: string
}

export type CustomerNoteRow = {
  id: string
  customer_id: string
  body: string
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type CustomerSiteStatus =
  | 'draft'
  | 'pending_activation'
  | 'active'
  | 'inactive'
  | 'moved'
  | 'ended'
  | string

export type CustomerSiteType = 'consumption' | 'production' | 'mixed' | string

export type CustomerSiteRow = {
  id: string
  customer_id: string
  site_name: string
  created_at: string
  updated_at: string
  facility_id: string | null
  site_type: CustomerSiteType
  status: CustomerSiteStatus
  grid_owner_id: string | null
  price_area_code: string | null
  move_in_date: string | null
  annual_consumption_kwh: number | null

  annual_production_kwh?: number | null
  move_out_date?: string | null
  current_supplier_name?: string | null
  current_supplier_org_number?: string | null
  street?: string | null
  postal_code?: string | null
  city?: string | null
  care_of?: string | null
  moved_from_street?: string | null
  moved_from_postal_code?: string | null
  moved_from_city?: string | null
  moved_from_supplier_name?: string | null
  created_by?: string | null
  updated_by?: string | null

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
  contacts: CustomerContactRow[]
  addresses: CustomerAddressRow[]
  sites: CustomerSiteRow[]
  notes: CustomerNoteRow[]
}