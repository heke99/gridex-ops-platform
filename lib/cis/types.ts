export type GridOwnerDataRequestScope =
  | 'meter_values'
  | 'billing_underlay'
  | 'customer_masterdata'

export type GridOwnerDataRequestStatus =
  | 'pending'
  | 'sent'
  | 'received'
  | 'failed'
  | 'cancelled'

export type GridOwnerDataRequestRow = {
  id: string
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  grid_owner_id: string | null
  request_scope: GridOwnerDataRequestScope
  status: GridOwnerDataRequestStatus
  requested_period_start: string | null
  requested_period_end: string | null
  external_reference: string | null
  request_payload: Record<string, unknown>
  response_payload: Record<string, unknown>
  notes: string | null
  requested_at: string
  sent_at: string | null
  received_at: string | null
  failed_at: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type MeteringValueReadingType =
  | 'consumption'
  | 'production'
  | 'estimated'
  | 'adjustment'

export type MeteringValueRow = {
  id: string
  customer_id: string
  site_id: string | null
  metering_point_id: string
  source_request_id: string | null
  grid_owner_id: string | null
  reading_type: MeteringValueReadingType
  value_kwh: number
  quality_code: string | null
  read_at: string
  period_start: string | null
  period_end: string | null
  source_system: string
  raw_payload: Record<string, unknown>
  created_at: string
  created_by: string | null
}

export type BillingUnderlayStatus =
  | 'pending'
  | 'received'
  | 'validated'
  | 'exported'
  | 'failed'

export type BillingUnderlayRow = {
  id: string
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  source_request_id: string | null
  grid_owner_id: string | null
  underlay_month: number | null
  underlay_year: number | null
  status: BillingUnderlayStatus
  total_kwh: number | null
  total_sek_ex_vat: number | null
  currency: string
  source_system: string
  payload: Record<string, unknown>
  received_at: string | null
  validated_at: string | null
  exported_at: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type PartnerExportKind =
  | 'billing_underlay'
  | 'meter_values'
  | 'customer_snapshot'

export type PartnerExportStatus =
  | 'queued'
  | 'sent'
  | 'acknowledged'
  | 'failed'
  | 'cancelled'

export type PartnerExportRow = {
  id: string
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  billing_underlay_id: string | null
  export_kind: PartnerExportKind
  target_system: string
  status: PartnerExportStatus
  payload: Record<string, unknown>
  response_payload: Record<string, unknown>
  external_reference: string | null
  queued_at: string
  sent_at: string | null
  acknowledged_at: string | null
  failed_at: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}