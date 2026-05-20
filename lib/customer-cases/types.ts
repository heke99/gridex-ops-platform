export type CustomerCaseType =
  | 'withdrawal'
  | 'rejected_customer'
  | 'onboarding_aborted'
  | 'supplier_switch_aborted'
  | 'sales_misunderstanding'
  | 'dual_invoice_concern'
  | 'binding_period_too_long'
  | 'incorrect_identity'
  | 'incorrect_site_data'
  | 'missing_authorization'
  | 'credit_risk'
  | 'technical_blocker'
  | 'other'

export type CustomerCaseStatus =
  | 'open'
  | 'action_required'
  | 'awaiting_external_response'
  | 'billing_blocked'
  | 'manual_follow_up'
  | 'resolved'
  | 'cancelled'
  | 'closed'

export type CustomerCasePriority = 'low' | 'normal' | 'high' | 'urgent'

export type CancellationStatus =
  | 'not_required'
  | 'draft_required'
  | 'draft_created'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'not_possible'
  | 'manual_review'

export type WithdrawalScenario =
  | 'not_withdrawal'
  | 'before_prodat_sent'
  | 'after_prodat_before_start'
  | 'cannot_stop_switch'

export type CustomerCaseRow = {
  id: string
  company_id: string
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  customer_contract_id: string | null
  supplier_switch_request_id: string | null
  outbound_request_id: string | null
  cancellation_ediel_message_id: string | null
  case_type: CustomerCaseType
  status: CustomerCaseStatus
  priority: CustomerCasePriority
  title: string
  description: string | null
  reason_category: string | null
  agreement_channel: string | null
  is_distance_agreement: boolean
  agreement_created_at: string | null
  withdrawal_information_sent_at: string | null
  withdrawal_deadline_at: string | null
  withdrawal_requested_at: string | null
  withdrawal_possible: boolean
  switch_can_be_stopped: boolean
  delivery_start_at: string | null
  withdrawal_scenario: WithdrawalScenario
  cancellation_required: boolean
  cancellation_status: CancellationStatus
  cancellation_reference: string | null
  billing_blocked: boolean
  billing_manual_review: boolean
  break_fee_flagged: boolean
  customer_contacted_at: string | null
  next_action: string | null
  next_action_due_at: string | null
  assigned_to: string | null
  source: string | null
  metadata: Record<string, unknown>
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  closed_at: string | null
}

export type CustomerCaseEventRow = {
  id: string
  company_id: string
  customer_case_id: string
  customer_id: string
  event_type: string
  event_status: 'info' | 'success' | 'warning' | 'error'
  message: string
  payload: Record<string, unknown>
  created_by: string | null
  created_at: string
}

export type CustomerCaseListRow = CustomerCaseRow & {
  customer_name: string | null
  customer_email: string | null
  customer_number: string | null
}
