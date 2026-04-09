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

export type CommunicationRouteScope =
  | 'supplier_switch'
  | 'meter_values'
  | 'billing_underlay'

export type CommunicationRouteType =
  | 'partner_api'
  | 'ediel_partner'
  | 'file_export'
  | 'email_manual'

export type CommunicationRouteRow = {
  id: string
  route_name: string
  is_active: boolean
  route_scope: CommunicationRouteScope
  route_type: CommunicationRouteType
  grid_owner_id: string | null
  target_system: string
  endpoint: string | null
  target_email: string | null
  auth_config: Record<string, unknown>
  supported_payload_version: string | null
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type OutboundRequestType =
  | 'supplier_switch'
  | 'meter_values'
  | 'billing_underlay'

export type OutboundRequestStatus =
  | 'queued'
  | 'prepared'
  | 'sent'
  | 'acknowledged'
  | 'failed'
  | 'cancelled'

export type OutboundChannelType =
  | 'partner_api'
  | 'ediel_partner'
  | 'file_export'
  | 'email_manual'
  | 'unresolved'

export type OutboundRequestRow = {
  id: string
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  grid_owner_id: string | null
  communication_route_id: string | null
  request_type: OutboundRequestType
  source_type:
    | 'supplier_switch_request'
    | 'grid_owner_data_request'
    | 'bulk_generation'
    | 'manual'
    | null
  source_id: string | null
  status: OutboundRequestStatus
  channel_type: OutboundChannelType
  payload: Record<string, unknown>
  response_payload: Record<string, unknown>
  period_start: string | null
  period_end: string | null
  external_reference: string | null
  dispatch_batch_key: string | null
  attempts_count: number
  queued_at: string
  prepared_at: string | null
  sent_at: string | null
  acknowledged_at: string | null
  failed_at: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type OutboundDispatchEventRow = {
  id: string
  outbound_request_id: string
  event_type:
    | 'queued'
    | 'prepared'
    | 'sent'
    | 'acknowledged'
    | 'failed'
    | 'cancelled'
  event_status: string
  message: string | null
  payload: Record<string, unknown>
  created_at: string
  created_by: string | null
}