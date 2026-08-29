import { supabaseService } from '@/lib/supabase/service'

type JsonRecord = Record<string, unknown>

const WAITING_WORKFLOW_STATES = ['waiting_for_facility_response', 'waiting_for_customer_data_response']
const EXTERNAL_WAIT_REQUEST_STATUSES = ['waiting_manual_response', 'awaiting_response', 'sent']

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(row?.code ?? '') || /does not exist|schema cache|column .* does not exist/i.test(row?.message ?? '')
}

function sameScope(workflow: JsonRecord, request: JsonRecord) {
  return clean(workflow.company_id) === clean(request.company_id)
    && clean(workflow.customer_id) === clean(request.customer_id)
    && clean(workflow.customer_site_id) === clean(request.customer_site_id)
}

function isEligibleExistingRequest(workflow: JsonRecord, request: JsonRecord) {
  if (!sameScope(workflow, request)) return false
  const applicationId = clean(workflow.customer_application_id)
  const linkedApplicationId = clean(request.customer_application_id)
  if (linkedApplicationId && linkedApplicationId !== applicationId) return false
  const status = clean(request.status)
  if (!status || !EXTERNAL_WAIT_REQUEST_STATUSES.includes(status)) return false
  return Boolean(clean(request.sent_at) || status === 'waiting_manual_response' || status === 'awaiting_response')
}

/**
 * Correlates already-created legacy facility-information requests back to the
 * canonical website-application workflow. This function is deliberately
 * non-dispatching: it never creates or sends a network-owner request.
 *
 * A link is repaired only when exactly one request matches the exact
 * company + customer + site scope and the request is already in an external
 * waiting state. Ambiguous or conflicting cases remain human review.
 */
export async function reconcileLegacyFacilityRequestLinks(input: { limit?: number } = {}) {
  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString()
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const { data: workflows, error } = await supabaseService
    .from('customer_application_workflows')
    .select('id,company_id,customer_application_id,customer_id,customer_site_id,state,updated_at')
    .in('state', WAITING_WORKFLOW_STATES)
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(limit)
  if (error) {
    if (missingSchema(error)) return { checked: 0, linked: 0, tasksCompleted: 0, ambiguous: 0, skipped: 0, schemaMissing: true }
    throw error
  }

  const workflowRows = (workflows ?? []) as JsonRecord[]
  const siteIds = [...new Set(workflowRows.map((row) => clean(row.customer_site_id)).filter((value): value is string => Boolean(value)))]
  if (workflowRows.length === 0 || siteIds.length === 0) {
    return { checked: workflowRows.length, linked: 0, tasksCompleted: 0, ambiguous: 0, skipped: workflowRows.length, schemaMissing: false }
  }

  const { data: requests, error: requestsError } = await supabaseService
    .from('grid_owner_information_requests')
    .select('id,company_id,customer_id,customer_site_id,customer_application_id,status,sent_at,grid_owner_id,grid_area_code,price_area,updated_at')
    .in('customer_site_id', siteIds)
    .in('status', EXTERNAL_WAIT_REQUEST_STATUSES)
    .order('created_at', { ascending: false })
  if (requestsError) {
    if (missingSchema(requestsError)) return { checked: workflowRows.length, linked: 0, tasksCompleted: 0, ambiguous: 0, skipped: workflowRows.length, schemaMissing: true }
    throw requestsError
  }

  const requestRows = (requests ?? []) as JsonRecord[]
  let linked = 0
  let tasksCompleted = 0
  let ambiguous = 0
  let skipped = 0

  for (const workflow of workflowRows) {
    const companyId = clean(workflow.company_id)
    const applicationId = clean(workflow.customer_application_id)
    const customerId = clean(workflow.customer_id)
    const siteId = clean(workflow.customer_site_id)
    if (!companyId || !applicationId || !customerId || !siteId) {
      skipped += 1
      continue
    }

    const candidates = requestRows.filter((request) => isEligibleExistingRequest(workflow, request))
    if (candidates.length !== 1) {
      if (candidates.length > 1) ambiguous += 1
      else skipped += 1
      continue
    }

    const request = candidates[0]
    const requestId = clean(request.id)
    if (!requestId) {
      skipped += 1
      continue
    }

    const alreadyLinkedApplication = clean(request.customer_application_id)
    if (!alreadyLinkedApplication) {
      const { error: linkError } = await supabaseService
        .from('grid_owner_information_requests')
        .update({ customer_application_id: applicationId, updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('company_id', companyId)
        .eq('customer_id', customerId)
        .eq('customer_site_id', siteId)
        .is('customer_application_id', null)
      if (linkError) throw linkError
    }

    const projectionUpdate: JsonRecord = {
      grid_owner_information_request_id: requestId,
      next_step: 'wait_for_grid_owner',
      updated_at: new Date().toISOString(),
    }
    const gridOwnerId = clean(request.grid_owner_id)
    const gridAreaCode = clean(request.grid_area_code)
    const priceArea = clean(request.price_area)
    if (gridOwnerId) projectionUpdate.grid_owner_id = gridOwnerId
    if (gridAreaCode) projectionUpdate.grid_area_code = gridAreaCode
    if (priceArea) projectionUpdate.price_area_code = priceArea

    const { error: applicationError } = await supabaseService
      .from('website_customer_applications')
      .update(projectionUpdate)
      .eq('id', applicationId)
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .eq('customer_site_id', siteId)
    if (applicationError) throw applicationError

    linked += 1

    const { data: openTasks, error: tasksError } = await supabaseService
      .from('customer_operation_tasks')
      .select('id,metadata')
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .eq('task_type', 'customer_data_review')
      .eq('status', 'open')
      .contains('metadata', { website_application_id: applicationId })
    if (tasksError && !missingSchema(tasksError)) throw tasksError

    for (const task of (openTasks ?? []) as JsonRecord[]) {
      const taskId = clean(task.id)
      if (!taskId) continue
      const existingMetadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? task.metadata as JsonRecord
        : {}
      const { error: taskUpdateError } = await supabaseService
        .from('customer_operation_tasks')
        .update({
          status: 'completed',
          resolved_at: new Date().toISOString(),
          metadata: {
            ...existingMetadata,
            zero_admin_reconciled: true,
            zero_admin_reason: 'canonical_facility_request_waiting_external_response',
            grid_owner_information_request_id: requestId,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId)
        .eq('company_id', companyId)
        .eq('customer_id', customerId)
        .eq('task_type', 'customer_data_review')
        .eq('status', 'open')
      if (taskUpdateError) throw taskUpdateError
      tasksCompleted += 1
    }
  }

  return { checked: workflowRows.length, linked, tasksCompleted, ambiguous, skipped, schemaMissing: false }
}
