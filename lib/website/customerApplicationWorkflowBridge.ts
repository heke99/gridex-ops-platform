import { supabaseService } from '@/lib/supabase/service'
import {
  transitionCustomerApplicationWorkflow,
  type CustomerApplicationWorkflowState,
} from '@/lib/website/applicationWorkflow'

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const TERMINAL_STATES = ['completed', 'cancelled', 'failed']

/**
 * Correlates downstream facility/Ediel lifecycle updates back to the original
 * website customer-application workflow. Operation id is preferred; customer
 * and site are only a guarded fallback for older records.
 */
export async function transitionCorrelatedCustomerApplicationWorkflow(input: {
  companyId: string
  state: CustomerApplicationWorkflowState
  eventCode: string
  idempotencyKey: string
  operationId?: string | null
  customerId?: string | null
  siteId?: string | null
  reasonCode?: string | null
  snapshotPatch?: JsonRecord
}): Promise<{ transitioned: boolean; applicationId: string | null }> {
  let query = supabaseService
    .from('customer_application_workflows')
    .select('customer_application_id,state,operation_id,customer_id,customer_site_id,updated_at')
    .eq('company_id', input.companyId)
    .not('state', 'in', `(${TERMINAL_STATES.join(',')})`)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (clean(input.operationId)) {
    query = query.eq('operation_id', clean(input.operationId) as string)
  } else {
    if (!clean(input.customerId)) return { transitioned: false, applicationId: null }
    query = query.eq('customer_id', clean(input.customerId) as string)
    if (clean(input.siteId)) query = query.eq('customer_site_id', clean(input.siteId) as string)
  }

  const { data, error } = await query.maybeSingle()
  if (error) {
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) {
      return { transitioned: false, applicationId: null }
    }
    throw error
  }

  const applicationId = clean(data?.customer_application_id)
  if (!applicationId) return { transitioned: false, applicationId: null }

  await transitionCustomerApplicationWorkflow({
    companyId: input.companyId,
    applicationId,
    state: input.state,
    eventCode: input.eventCode,
    reasonCode: input.reasonCode ?? null,
    idempotencyKey: input.idempotencyKey,
    snapshotPatch: input.snapshotPatch ?? {},
  })

  return { transitioned: true, applicationId }
}
