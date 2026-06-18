import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { isSchemaError } from '@/lib/http/apiError'

export type CustomerApplicationWorkflowState =
  | 'received'
  | 'provisioning'
  | 'provisioned'
  | 'pending_customer_data'
  | 'ready_for_switch'
  | 'pending_review'
  | 'failed'
  | 'cancelled'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function ensureCustomerApplicationWorkflow(input: {
  companyId: string
  applicationId: string
  customerId: string
  customerSiteId?: string | null
  meteringPointId?: string | null
  contractId?: string | null
  state: CustomerApplicationWorkflowState
  operationId?: string | null
  snapshot?: Record<string, unknown>
}) {
  const operationId = clean(input.operationId) ?? randomUUID()
  const row = {
    company_id: input.companyId,
    customer_application_id: input.applicationId,
    customer_id: input.customerId,
    customer_site_id: input.customerSiteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    contract_id: input.contractId ?? null,
    operation_id: operationId,
    state: input.state,
    snapshot: input.snapshot ?? {},
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabaseService
    .from('customer_application_workflows')
    .upsert(row, { onConflict: 'company_id,customer_application_id' })
    .select('id,operation_id,state')
    .single()
  if (error) {
    if (isSchemaError(error)) throw new Error('Kundansökans workflow-tabell saknas. Kör den senaste OPS-migrationen innan automation startas.')
    throw error
  }
  return { id: String(data.id), operationId: String(data.operation_id ?? operationId), state: String(data.state) as CustomerApplicationWorkflowState }
}

export async function transitionCustomerApplicationWorkflow(input: {
  companyId: string
  applicationId: string
  state: CustomerApplicationWorkflowState
  failureCode?: string | null
  failureDetailInternal?: string | null
  snapshotPatch?: Record<string, unknown>
}) {
  const { data: existing, error: existingError } = await supabaseService
    .from('customer_application_workflows')
    .select('snapshot')
    .eq('company_id', input.companyId)
    .eq('customer_application_id', input.applicationId)
    .maybeSingle()
  if (existingError) throw existingError
  const existingSnapshot = existing?.snapshot && typeof existing.snapshot === 'object' && !Array.isArray(existing.snapshot)
    ? existing.snapshot as Record<string, unknown>
    : {}
  const { error } = await supabaseService
    .from('customer_application_workflows')
    .update({
      state: input.state,
      failure_code: input.failureCode ?? null,
      failure_detail_internal: input.failureDetailInternal ?? null,
      snapshot: { ...existingSnapshot, ...(input.snapshotPatch ?? {}) },
      updated_at: new Date().toISOString(),
      completed_at: ['ready_for_switch', 'failed', 'cancelled'].includes(input.state) ? new Date().toISOString() : null,
    })
    .eq('company_id', input.companyId)
    .eq('customer_application_id', input.applicationId)
  if (error) throw error
}
