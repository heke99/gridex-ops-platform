import type { EdielEnvironment, EdielMessageFamily } from '@/lib/ediel/types'

export type RouteScope =
  | 'customer_masterdata'
  | 'supplier_switch'
  | 'metering_access'
  | 'meter_values'
  | 'billing_underlay'
  | 'partner_export'
  | 'ediel_ack'

export type BusinessProcess =
  | 'customer_masterdata'
  | 'supplier_switch'
  | 'metering_access'
  | 'meter_values'
  | 'billing_underlay'
  | 'partner_export'
  | 'ediel_ack'

export type OutboundIntent =
  | 'grid_owner_metering_access_agreement'
  | 'switch_information_request'
  | 'current_supplier_contract_information_request'
  | 'customer_masterdata_request'
  | 'supplier_switch'
  | 'supplier_switch_cancellation'
  | 'metering_access_request'
  | 'metering_access_termination'
  | 'meter_values_request'
  | 'billing_underlay_request'

export type RouteDecisionStatus = 'send' | 'hold' | 'manual_review' | 'blocked'

export type RouteDecisionIssue = {
  code: string
  message: string
  severity: 'warning' | 'blocking'
  source?: string
  metadata?: Record<string, unknown>
}

export type RouteDecisionTraceEntry = {
  step: string
  status: 'success' | 'warning' | 'blocked' | 'info'
  message: string
  metadata?: Record<string, unknown>
}

export type RouteDecisionInput = {
  companyId?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  businessProcess: BusinessProcess
  requestedAction?: string | null
  messageFamily?: EdielMessageFamily | string | null
  messageCode?: string | null
  environment?: EdielEnvironment | string | null
  preferredRouteId?: string | null
  customerAuthorizationId?: string | null
  customerContractId?: string | null
  authorizationDocumentId?: string | null
  payload?: Record<string, unknown>
  actorUserId?: string | null
}

export type RouteDecisionOutput = {
  decisionStatus: RouteDecisionStatus
  routeScope: RouteScope
  communicationRouteId: string | null
  edielRouteProfileId: string | null
  gridOwnerAccessAgreementId: string | null
  messageFamily: EdielMessageFamily | string
  messageCode: string | null
  messageIntent: OutboundIntent | string
  businessProcess: BusinessProcess
  applicationReference: string | null
  messageVersion: string | null
  senderEdielId: string | null
  senderSubAddress: string | null
  receiverEdielId: string | null
  receiverSubAddress: string | null
  ackPolicy: Record<string, unknown>
  blockingReasons: RouteDecisionIssue[]
  warnings: RouteDecisionIssue[]
  requiredAdminActions: string[]
  decisionTrace: RouteDecisionTraceEntry[]
  payload: Record<string, unknown>
}

export type RouteDecisionDbRow = {
  id: string
  company_id: string | null
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  grid_owner_id: string | null
  business_process: string | null
  requested_action: string | null
  message_family: string | null
  message_code: string | null
  environment: string | null
  decision_status: string | null
  route_scope: string | null
  communication_route_id: string | null
  ediel_route_profile_id: string | null
  grid_owner_access_agreement_id: string | null
  application_reference: string | null
  message_version: string | null
  sender_ediel_id: string | null
  sender_sub_address: string | null
  receiver_ediel_id: string | null
  receiver_sub_address: string | null
  ack_policy: Record<string, unknown>
  blocking_reasons: RouteDecisionIssue[]
  warnings: RouteDecisionIssue[]
  required_admin_actions: string[]
  decision_trace: RouteDecisionTraceEntry[]
  source_payload: Record<string, unknown>
  created_by: string | null
  created_at: string
}
