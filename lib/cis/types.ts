export type GridOwnerDataRequestScope =
  | 'meter_values'
  | 'billing_underlay'
  | 'customer_masterdata'
  | 'metering_access'
  | 'supplier_switch'
  | 'partner_export'
  | 'ediel_ack'

export type GridOwnerDataRequestStatus =
  | 'pending'
  | 'sent'
  | 'received'
  | 'failed'
  | 'cancelled'

export type GridOwnerDataRequestRow = {
  id: string
  company_id?: string | null
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  grid_owner_id: string | null
  authorization_document_id: string | null
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
  readiness_status?: 'not_checked' | 'ready' | 'warning' | 'blocked' | 'exported' | 'requires_correction' | string | null
  readiness_issues?: Array<Record<string, unknown>> | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  automation_origin: string | null
  operation_id?: string | null
  automation_key: string | null
}

export type MeteringValueReadingType =
  | 'consumption'
  | 'production'
  | 'estimated'
  | 'adjustment'

export type MeteringValueRow = {
  id: string
  company_id?: string | null
  customer_id: string
  site_id: string | null
  customer_site_id?: string | null
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
  price_area?: string | null
  resolution?: string | null
  source_transaction_reference?: string | null
  source_line_reference?: string | null
  source_ediel_message_id?: string | null
  canonical_dedupe_key?: string | null
  is_current?: boolean | null
  previous_value_id?: string | null
  replaced_by_value_id?: string | null
  revision_number?: number | null
  correction_reason?: string | null
  value_status?: 'current' | 'replaced' | 'void' | string | null
  created_at: string
  created_by: string | null
}

export type BillingUnderlayStatus =
  | 'pending'
  | 'received'
  | 'validated'
  | 'exported'
  | 'failed'
  | 'missing_metering_data'
  | 'metering_received'
  | 'ready_for_pricing'
  | 'pricing_failed'
  | 'price_preview_ready'
  | 'needs_review'
  | 'reprice_required'
  | 'locked'
  | 'export_ready'

export type BillingUnderlayRow = {
  id: string
  company_id?: string | null
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  source_request_id: string | null
  contract_id?: string | null
  price_plan_id?: string | null
  campaign_id?: string | null
  customer_site_id?: string | null
  price_area?: string | null
  billing_period_start?: string | null
  billing_period_end?: string | null
  calculated_total_sek_ex_vat?: number | null
  calculated_vat_sek?: number | null
  calculated_total_sek_inc_vat?: number | null
  pricing_snapshot?: Record<string, unknown> | null
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
  readiness_status?: 'not_checked' | 'ready' | 'warning' | 'blocked' | 'exported' | 'requires_correction' | string | null
  readiness_issues?: Array<Record<string, unknown>> | null
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
  company_id?: string | null
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
  export_batch_key?: string | null
  idempotency_key?: string | null
  retry_count?: number | null
  adapter_key?: string | null
  payload_version?: string | null
  partner_response_log?: Array<Record<string, unknown>> | null
  last_partner_response_at?: string | null
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
  | 'customer_masterdata'
  | 'metering_access'
  | 'partner_export'
  | 'ediel_ack'

export type CommunicationRouteType =
  | 'partner_api'
  | 'ediel_partner'
  | 'file_export'
  | 'email_manual'

export type CommunicationRouteRow = {
  id: string
  company_id?: string | null
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
  | 'customer_masterdata'
  | 'metering_access'
  | 'partner_export'
  | 'ediel_ack'
  | 'grid_owner_metering_access_agreement'
  | 'switch_information_request'
  | 'current_supplier_contract_information_request'
  | 'customer_masterdata_request'
  | 'supplier_switch_cancellation'
  | 'metering_access_request'
  | 'metering_access_termination'
  | 'meter_values_request'
  | 'billing_underlay_request'

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
  company_id?: string | null
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  grid_owner_id: string | null
  communication_route_id: string | null
  authorization_document_id: string | null
  agreement_id?: string | null
  grid_owner_access_agreement_id?: string | null
  ediel_route_profile_id?: string | null
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
  business_process?: string | null
  message_intent?: string | null
  message_family?: string | null
  message_code?: string | null
  message_version?: string | null
  application_reference?: string | null
  sender_ediel_id?: string | null
  sender_sub_address?: string | null
  receiver_ediel_id?: string | null
  receiver_sub_address?: string | null
  ack_policy?: Record<string, unknown> | null
  blocking_reasons?: Array<Record<string, unknown>> | null
  required_admin_actions?: string[] | null
  route_decision_payload?: Record<string, unknown> | null
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
  automation_origin: string | null
  operation_id?: string | null
  automation_key: string | null
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