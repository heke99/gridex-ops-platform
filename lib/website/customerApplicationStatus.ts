import { supabaseService } from '@/lib/supabase/service'

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function mapExternalStatus(input: {
  applicationStatus: string | null
  workflowState: string | null
  switchStatus: string | null
  supplyStatus: string | null
}) {
  if (input.supplyStatus === 'active' || input.workflowState === 'supply_active' || input.workflowState === 'completed') return 'completed'
  if (input.workflowState === 'validation_failed' || input.applicationStatus === 'rejected') return 'rejected'
  if (input.workflowState === 'failed' || input.applicationStatus === 'failed') return 'failed'
  if (['manual_review', 'facility_information_required', 'facility_response_needs_review', 'switch_blocked', 'switch_rejected'].includes(input.workflowState ?? '')) return 'needs_customer_information'
  if (input.applicationStatus === 'accepted' || input.workflowState === 'canonical_data_committed') return 'accepted'
  return 'processing'
}

export class WebsiteCustomerApplicationStatusError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message)
  }
}

export async function loadWebsiteCustomerApplicationStatus(input: {
  companyId: string
  applicationId: string
}) {
  const { data: application, error: applicationError } = await supabaseService
    .from('website_customer_applications')
    .select('id,application_number,customer_id,customer_site_id,metering_point_id,contract_id,status,next_step,response_payload,updated_at')
    .eq('company_id', input.companyId)
    .eq('id', input.applicationId)
    .maybeSingle()
  if (applicationError) throw applicationError
  if (!application) throw new WebsiteCustomerApplicationStatusError('application_not_found', 404, 'Kundansökan hittades inte.')

  const [workflowResult, switchResult, supplyResult] = await Promise.all([
    supabaseService
      .from('customer_application_workflows')
      .select('id,state,next_action,failure_code,last_transition_at,updated_at')
      .eq('company_id', input.companyId)
      .eq('customer_application_id', input.applicationId)
      .maybeSingle(),
    application.customer_id
      ? supabaseService
          .from('supplier_switch_requests')
          .select('id,status,requested_start_date,confirmed_start_date,updated_at')
          .eq('company_id', input.companyId)
          .eq('customer_id', application.customer_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    application.customer_id
      ? supabaseService
          .from('customer_supply_periods')
          .select('id,status,start_date,end_date,updated_at')
          .eq('company_id', input.companyId)
          .eq('customer_id', application.customer_id)
          .order('start_date', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  for (const result of [workflowResult, switchResult, supplyResult]) {
    if (result.error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(result.error.code ?? '')) throw result.error
  }

  const workflow = (workflowResult.data ?? {}) as JsonRecord
  const supplierSwitch = (switchResult.data ?? {}) as JsonRecord
  const supplyPeriod = (supplyResult.data ?? {}) as JsonRecord
  const response = (application.response_payload ?? {}) as JsonRecord
  const workflowState = clean(workflow.state)
  const externalStatus = mapExternalStatus({
    applicationStatus: clean(application.status),
    workflowState,
    switchStatus: clean(supplierSwitch.status),
    supplyStatus: clean(supplyPeriod.status),
  })

  return {
    application_id: application.id,
    application_number: application.application_number,
    status: externalStatus,
    stage: workflowState ?? clean(application.status) ?? 'processing',
    customer_number: clean(response.customer_number),
    contract_status: clean(response.contract_status) ?? (application.contract_id ? 'pending_activation' : null),
    supplier_switch_status: clean(supplierSwitch.status) ?? 'not_started',
    supply_status: clean(supplyPeriod.status),
    requested_start_date: clean(supplierSwitch.requested_start_date),
    confirmed_start_date: clean(supplierSwitch.confirmed_start_date) ?? clean(supplyPeriod.start_date),
    missing_customer_action: externalStatus === 'needs_customer_information',
    next_step: clean(workflow.next_action) ?? clean(application.next_step),
    blocking_reason: clean(workflow.failure_code),
    updated_at: clean(workflow.updated_at) ?? application.updated_at,
  }
}
