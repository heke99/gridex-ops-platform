// lib/operations/types.ts
export type PowerOfAttorneyScope =
  | 'supplier_switch'
  | 'meter_data'
  | 'billing_handoff'

export type PowerOfAttorneyStatus =
  | 'draft'
  | 'sent'
  | 'signed'
  | 'expired'
  | 'revoked'

export type PowerOfAttorneyRow = {
  id: string
  customer_id: string
  site_id: string | null
  scope: PowerOfAttorneyScope
  status: PowerOfAttorneyStatus
  signed_at: string | null
  valid_from: string | null
  valid_to: string | null
  document_path: string | null
  reference: string | null
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type AuthorizationDocumentType =
  | 'power_of_attorney'
  | 'complete_agreement'

export type AuthorizationDocumentStatus = 'uploaded' | 'active' | 'archived'

export type CustomerAuthorizationDocumentRow = {
  id: string
  customer_id: string
  site_id: string | null
  power_of_attorney_id: string | null
  replaced_document_id: string | null
  document_type: AuthorizationDocumentType
  status: AuthorizationDocumentStatus
  title: string | null
  file_name: string | null
  mime_type: string | null
  file_size_bytes: number | null
  storage_bucket: string | null
  file_path: string
  reference: string | null
  notes: string | null
  archived_reason: string | null
  uploaded_at: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type CustomerOperationTaskStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'cancelled'

export type CustomerOperationTaskPriority =
  | 'low'
  | 'normal'
  | 'high'
  | 'critical'

export type CustomerOperationTaskType =
  | 'power_of_attorney_missing'
  | 'power_of_attorney_not_signed'
  | 'metering_point_missing'
  | 'meter_point_id_missing'
  | 'grid_owner_missing'
  | 'price_area_missing'
  | 'current_supplier_missing'
  | 'move_in_date_missing'

export type CustomerOperationTaskRow = {
  id: string
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  task_type: CustomerOperationTaskType | string
  status: CustomerOperationTaskStatus
  priority: CustomerOperationTaskPriority
  title: string
  description: string | null
  assigned_to: string | null
  due_at: string | null
  resolved_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type SupplierSwitchRequestType =
  | 'switch'
  | 'move_in'
  | 'move_out_takeover'

export type SupplierSwitchRequestStatus =
  | 'draft'
  | 'queued'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'completed'
  | 'failed'

export type SupplierSwitchRequestRow = {
  id: string
  customer_id: string
  site_id: string
  metering_point_id: string
  power_of_attorney_id: string | null
  authorization_document_id: string | null
  request_type: SupplierSwitchRequestType
  status: SupplierSwitchRequestStatus
  requested_start_date: string | null
  current_supplier_name: string | null
  current_supplier_org_number: string | null
  incoming_supplier_name: string
  incoming_supplier_org_number: string | null
  grid_owner_id: string | null
  price_area_code: string | null
  validation_snapshot: Record<string, unknown>
  external_reference: string | null
  submitted_at: string | null
  completed_at: string | null
  failed_at: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type SupplierSwitchEventRow = {
  id: string
  switch_request_id: string
  event_type: string
  event_status: string
  message: string | null
  payload: Record<string, unknown>
  created_at: string
  created_by: string | null
}

export type SwitchReadinessIssueCode =
  | 'power_of_attorney_missing'
  | 'power_of_attorney_not_signed'
  | 'metering_point_missing'
  | 'meter_point_id_missing'
  | 'grid_owner_missing'
  | 'price_area_missing'
  | 'current_supplier_missing'
  | 'move_in_date_missing'

export type SwitchReadinessIssue = {
  code: SwitchReadinessIssueCode
  title: string
  description: string
  priority: CustomerOperationTaskPriority
  taskType: CustomerOperationTaskType
}

export type SwitchReadinessResult = {
  customerId: string
  siteId: string
  siteName: string
  candidateMeteringPointId: string | null
  latestPowerOfAttorneyId: string | null
  isReady: boolean
  issues: SwitchReadinessIssue[]
}