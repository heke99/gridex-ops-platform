import { supabaseService } from '@/lib/supabase/service'

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(row?.code ?? '') || /does not exist|schema cache|column .* does not exist/i.test(row?.message ?? '')
}

const REPLAYABLE_STATES = [
  'canonical_data_committed',
  'initial_notifications_pending',
  'initial_notifications_queued',
  'facility_information_check',
  'switch_readiness_check',
]

/**
 * Repairs the narrow failure window where an application is durably committed
 * but no runnable continuation remains. Waiting-on-external-response states are
 * deliberately excluded; they are continued by their own inbound pipelines.
 */
export async function reconcileCustomerApplicationContinuationJobs(input: { limit?: number } = {}) {
  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString()
  const { data: workflows, error } = await supabaseService
    .from('customer_application_workflows')
    .select('id,company_id,customer_application_id,customer_id,customer_site_id,metering_point_id,contract_id,operation_id,state,snapshot,last_job_id,updated_at')
    .in('state', REPLAYABLE_STATES)
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 200))
  if (error) {
    if (missingSchema(error)) return { checked: 0, created: 0, requeued: 0, skipped: 0, schemaMissing: true }
    throw error
  }

  const workflowRows = (workflows ?? []) as JsonRecord[]
  const workflowIds = workflowRows
    .map((workflow) => clean(workflow.id))
    .filter((workflowId): workflowId is string => Boolean(workflowId))
  const jobsByWorkflowId = new Map<string, JsonRecord>()
  if (workflowIds.length > 0) {
    const { data: jobs, error: jobsError } = await supabaseService
      .from('customer_operation_jobs')
      .select('id,workflow_id,status,attempts,max_attempts')
      .in('workflow_id', workflowIds)
      .eq('job_type', 'customer_application_continuation')
    if (jobsError && !missingSchema(jobsError)) throw jobsError
    for (const job of (jobs ?? []) as JsonRecord[]) {
      const workflowId = clean(job.workflow_id)
      if (workflowId && !jobsByWorkflowId.has(workflowId)) {
        jobsByWorkflowId.set(workflowId, job)
      }
    }
  }

  let created = 0
  let requeued = 0
  let skipped = 0
  for (const workflow of workflowRows) {
    const workflowId = clean(workflow.id)
    const companyId = clean(workflow.company_id)
    const customerId = clean(workflow.customer_id)
    const applicationId = clean(workflow.customer_application_id)
    const operationId = clean(workflow.operation_id)
    if (!workflowId || !companyId || !customerId || !applicationId || !operationId) {
      skipped += 1
      continue
    }

    const job = jobsByWorkflowId.get(workflowId)

    if (!job) {
      const { data: inserted, error: insertError } = await supabaseService
        .from('customer_operation_jobs')
        .insert({
          company_id: companyId,
          customer_id: customerId,
          customer_site_id: clean(workflow.customer_site_id),
          metering_point_id: clean(workflow.metering_point_id),
          workflow_id: workflowId,
          job_type: 'customer_application_continuation',
          status: 'queued',
          priority: 15,
          idempotency_key: `customer_application_continuation:${applicationId}`,
          operation_id: operationId,
          payload_version: 1,
          payload: {
            application_id: applicationId,
            workflow_id: workflowId,
            contract_id: clean(workflow.contract_id),
            snapshot: workflow.snapshot ?? {},
            reconciliation: true,
          },
          request_snapshot: workflow.snapshot ?? {},
          run_after: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (insertError && insertError.code !== '23505') throw insertError
      if (inserted?.id) {
        created += 1
        await supabaseService
          .from('customer_application_workflows')
          .update({ last_job_id: inserted.id, next_action: 'customer_application_continuation', updated_at: new Date().toISOString() })
          .eq('id', workflowId)
          .eq('company_id', companyId)
      } else skipped += 1
      continue
    }

    const status = clean(job.status)
    const attempts = Number(job.attempts ?? 0)
    const maxAttempts = Number(job.max_attempts ?? 5)
    const shouldRequeue =
      status === 'completed' ||
      ((status === 'failed' || status === 'blocked' || status === 'delivery_uncertain') && attempts < maxAttempts)
    if (!shouldRequeue) {
      skipped += 1
      continue
    }

    const { error: updateError } = await supabaseService
      .from('customer_operation_jobs')
      .update({
        status: 'queued',
        run_after: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        lock_token: null,
        completed_at: null,
        last_error: null,
        last_error_code: null,
        last_error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('company_id', companyId)
    if (updateError) throw updateError
    requeued += 1
  }

  return { checked: workflows?.length ?? 0, created, requeued, skipped, schemaMissing: false }
}
