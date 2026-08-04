export type CustomerPortalAccountRole = 'owner' | 'billing' | 'viewer'

export type CustomerPortalAccountRow = {
  id: string
  user_id: string
  customer_id: string
  role: CustomerPortalAccountRole | string
  is_active: boolean
  invited_at: string | null
  activated_at: string | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export type CustomerInvoiceStatus =
  | 'draft'
  | 'issued'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'cancelled'
  | 'credited'

export type CustomerInvoiceRow = {
  id: string
  customer_id: string
  agreement_id: string | null
  billing_underlay_id: string | null
  partner_export_id: string | null
  partner_invoice_reference: string | null
  invoice_number: string | null
  period_start: string | null
  period_end: string | null
  total_kwh: number | null
  amount_ex_vat: number | null
  vat_amount: number | null
  amount_inc_vat: number | null
  currency: string
  due_date: string | null
  issued_at: string | null
  paid_at: string | null
  status: CustomerInvoiceStatus | string
  pdf_path: string | null
  pdf_url: string | null
  source_system: string
  raw_payload: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type CustomerInvoiceLineRow = {
  id: string
  invoice_id: string
  line_type: string
  description: string
  quantity: number | null
  unit: string | null
  unit_price: number | null
  amount_ex_vat: number | null
  vat_rate: number | null
  metadata: Record<string, unknown>
  sort_order: number
  created_at: string
}

export type CustomerInvoiceDocumentRow = {
  id: string
  invoice_id: string
  document_type: string
  title: string | null
  file_path: string | null
  public_url: string | null
  source_system: string | null
  created_at: string
}

export type CustomerPortalCustomerRow = {
  id: string
  customer_number: string | null
  customer_type: string | null
  status: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
}

export type CustomerPortalSiteRow = {
  id: string
  customer_id: string
  site_name: string | null
  facility_id: string | null
  street: string | null
  postal_code: string | null
  city: string | null
  grid_owner_id: string | null
  price_area_code: string | null
  status: string | null
  annual_consumption_kwh: number | null
}

export type CustomerPortalMeteringPointRow = {
  id: string
  site_id: string | null
  meter_point_id: string | null
  grid_owner_id: string | null
  price_area_code: string | null
  status: string | null
}

export type CustomerPortalMeteringValueRow = {
  id: string
  customer_id: string
  site_id: string | null
  metering_point_id: string
  source_request_id: string | null
  grid_owner_id: string | null
  reading_type: string
  value_kwh: number
  quality_code: string | null
  read_at: string
  period_start: string | null
  period_end: string | null
  source_system: string
  created_at: string
}

export type CustomerPortalBranding = {
  companyId: string | null
  brandName: string
  portalName: string
  supportEmail: string | null
  websiteUrl: string | null
  logoUrl: string | null
  primaryColor: string
}

export type CustomerPortalContext = {
  userEmail: string | null
  /**
   * The single tenant the portal session is scoped to. A portal session never
   * mixes data from several companies even when the auth user has linked
   * customer accounts in more than one tenant.
   */
  companyId: string | null
  customerIds: string[]
  customers: CustomerPortalCustomerRow[]
  branding: CustomerPortalBranding
}

export type CustomerConsumptionMonth = {
  monthKey: string
  label: string
  totalKwh: number
  valueCount: number
}

export type CustomerPortalContractRow = {
  id: string
  company_id: string | null
  customer_id: string
  site_id: string | null
  contract_name: string | null
  contract_type: string | null
  status: string | null
  starts_at: string | null
  ends_at: string | null
  signed_at: string | null
  monthly_fee_sek: number | null
  invoice_fee_sek: number | null
  start_fee_sek: number | null
  admin_fee_sek: number | null
  break_fee_sek: number | null
  spot_markup_ore_per_kwh: number | null
  variable_fee_ore_per_kwh: number | null
  fixed_price_ore_per_kwh: number | null
  green_fee_mode: string | null
  green_fee_value: number | null
  binding_months: number | null
  notice_months: number | null
  created_at: string
}

export type CustomerPortalCaseRow = {
  id: string
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  case_type: string | null
  status: string | null
  priority: string | null
  title: string | null
  description: string | null
  reason_category: string | null
  next_action: string | null
  created_at: string
  updated_at: string
}

export type CustomerPortalInfoRequestRow = {
  id: string
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  request_type: string | null
  target_party_type: string | null
  status: string | null
  requested_data_categories: unknown
  notes: string | null
  created_at: string
  updated_at: string
}

export type CustomerPortalCompletionRow = {
  id: string
  customer_id: string
  completion_type: string
  status: string
  submitted_payload: Record<string, unknown>
  created_at: string
  updated_at: string
}
