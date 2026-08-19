import { supabaseService } from '@/lib/supabase/service'
import { buildTenantCheckoutResult } from '@/lib/website/publicCheckoutResult'

type JsonRecord = Record<string, unknown>
type QueryResult<T> = { data: T | null; error: { code?: string; message?: string } | null }

type ApplicationRow = {
  id: string
  company_id: string
  application_number: string
  customer_number: string | null
  customer_id: string | null
  customer_site_id: string | null
  metering_point_id: string | null
  contract_id: string | null
  status: string | null
  next_step: string | null
  response_payload: JsonRecord | null
  updated_at: string | null
}

type WorkflowRow = {
  id: string
  state: string | null
  next_action: string | null
  failure_code: string | null
  last_job_id: string | null
  updated_at: string | null
}

type LineageRow = JsonRecord & {
  id?: string | null
  customer_id?: string | null
  customer_site_id?: string | null
  site_id?: string | null
  metering_point_id?: string | null
  contract_id?: string | null
  customer_contract_id?: string | null
  status?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type JobRow = {
  status: string | null
  attempts: number | null
  max_attempts: number | null
  run_after: string | null
  completed_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  last_error: string | null
  updated_at: string | null
}

type CommunicationRow = {
  id: string
  event_key: string | null
  status: string | null
  error_message: string | null
  sent_at: string | null
  delivered_at: string | null
  bounced_at: string | null
  failed_at: string | null
  created_at: string | null
}

type EmailOutboxRow = {
  communication_log_id: string | null
  status: string | null
  attempts: number | null
  max_attempts: number | null
  next_attempt_at: string | null
  last_error: string | null
  failure_reason: string | null
  blocked_reason: string | null
  blocked_at: string | null
  sent_at: string | null
  failed_at: string | null
  updated_at: string | null
}

type EventOutboxRow = {
  status: string | null
  attempts: number | null
  max_attempts: number | null
  available_at: string | null
  sent_at: string | null
  failed_at: string | null
  last_error: string | null
  payload: JsonRecord | null
  updated_at: string | null
}

type WebhookDeliveryRow = {
  status: string | null
  attempts: number | null
  max_attempts: number | null
  next_attempt_at: string | null
  delivered_at: string | null
  failed_at: string | null
  failure_reason: string | null
  updated_at: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function schemaMissing(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null
  return (
    ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(row?.code ?? '') ||
    /does not exist|schema cache|column .* does not exist/i.test(row?.message ?? '')
  )
}

function newest(...values: Array<string | null | undefined>): string | null {
  return values.filter((value): value is string => Boolean(clean(value))).sort().at(-1) ?? null
}

function earliest(...values: Array<string | null | undefined>): string | null {
  return values.filter((value): value is string => Boolean(clean(value))).sort().at(0) ?? null
}

function mapExternalStatus(input: {
  applicationStatus: string | null
  workflowState: string | null
  switchStatus: string | null
  supplyStatus: string | null
  jobStatus: string | null
}) {
  const workflow = input.workflowState ?? ''
  const supplierSwitch = input.switchStatus ?? ''
  const job = input.jobStatus ?? ''

  if (input.supplyStatus === 'active' || workflow === 'supply_active' || workflow === 'completed') return 'completed'
  if (['rejected', 'cancelled'].includes(supplierSwitch) || workflow === 'validation_failed' || input.applicationStatus === 'rejected') return 'rejected'
  if (['failed', 'dead_letter', 'delivery_uncertain'].includes(job) || ['failed', 'error'].includes(supplierSwitch) || workflow === 'failed' || input.applicationStatus === 'failed') return 'failed'
  if (['manual_review', 'facility_information_required', 'facility_response_needs_review', 'switch_blocked', 'switch_rejected'].includes(workflow) || job === 'needs_review' || job === 'blocked') return 'needs_customer_information'
  if (['queued', 'running', 'waiting_response'].includes(job)) return 'processing'
  if (input.applicationStatus === 'accepted' || workflow === 'canonical_data_committed') return 'accepted'
  return 'processing'
}

export class WebsiteCustomerApplicationStatusError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message)
  }
}

function assertQuery<T>(result: QueryResult<T>, component: string): T | null {
  if (!result.error) return result.data
  if (schemaMissing(result.error)) {
    throw new WebsiteCustomerApplicationStatusError(
      'application_status_schema_not_ready',
      503,
      `Databasschemat för ${component} är inte synkroniserat.`,
    )
  }
  throw result.error
}

function lineageScore(application: ApplicationRow, row: LineageRow): number {
  let score = 0
  if (application.contract_id && [clean(row.contract_id), clean(row.customer_contract_id)].includes(application.contract_id)) score += 100
  if (application.customer_site_id && [clean(row.customer_site_id), clean(row.site_id)].includes(application.customer_site_id)) score += 50
  if (application.metering_point_id && clean(row.metering_point_id) === application.metering_point_id) score += 25
  if (application.customer_id && clean(row.customer_id) === application.customer_id) score += 1
  return score
}

function selectCorrelatedRow(application: ApplicationRow, rows: LineageRow[], component: string): LineageRow | null {
  if (rows.length === 0) return null
  const scored = rows
    .map((row) => ({ row, score: lineageScore(application, row) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(b.row.updated_at ?? b.row.created_at ?? '').localeCompare(String(a.row.updated_at ?? a.row.created_at ?? '')))
  if (scored.length === 0) return null
  const top = scored[0]
  const directLineage = top.score > 1
  const equallyWeak = !directLineage && scored.filter((entry) => entry.score === top.score).length > 1
  if (equallyWeak) {
    throw new WebsiteCustomerApplicationStatusError(
      'application_status_lineage_ambiguous',
      409,
      `${component} kunde inte bindas entydigt till ansökan.`,
    )
  }
  return top.row
}

async function loadCorrelatedSwitch(application: ApplicationRow): Promise<LineageRow | null> {
  if (!application.customer_id) return null
  const result = await supabaseService
    .from('supplier_switch_requests')
    .select('id,company_id,customer_id,customer_site_id,site_id,metering_point_id,contract_id,customer_contract_id,status,requested_start_date,confirmed_start_date,created_at,updated_at')
    .eq('company_id', application.company_id)
    .eq('customer_id', application.customer_id)
    .order('created_at', { ascending: false })
    .limit(50)
  const rows = assertQuery(result as QueryResult<LineageRow[]>, 'leverantörsbyte') ?? []
  return selectCorrelatedRow(application, rows, 'Leverantörsbytet')
}

async function loadCorrelatedSupply(application: ApplicationRow): Promise<LineageRow | null> {
  if (!application.customer_id) return null
  const result = await supabaseService
    .from('customer_supply_periods')
    .select('id,company_id,customer_id,metering_point_id,contract_id,customer_contract_id,status,start_date,end_date,created_at,updated_at')
    .eq('company_id', application.company_id)
    .eq('customer_id', application.customer_id)
    .order('start_date', { ascending: false })
    .limit(50)
  const rows = assertQuery(result as QueryResult<LineageRow[]>, 'försörjningsperiod') ?? []
  return selectCorrelatedRow(application, rows, 'Försörjningsperioden')
}

function summarizeCommunication(logs: CommunicationRow[], outbox: EmailOutboxRow[]) {
  const outboxByLog = new Map(outbox.map((row) => [clean(row.communication_log_id), row]))
  const entries = logs.map((log) => {
    const queued = outboxByLog.get(log.id)
    const logStatus = clean(log.status)
    const queueStatus = clean(queued?.status)
    const status = ['delivered', 'bounced', 'complained'].includes(logStatus ?? '')
      ? logStatus as string
      : queueStatus ?? logStatus ?? 'unknown'
    return {
      event_type: clean(log.event_key),
      status,
      occurred_at: newest(
        log.delivered_at,
        log.sent_at,
        log.bounced_at,
        log.failed_at,
        queued?.blocked_at,
        queued?.sent_at,
        queued?.failed_at,
        queued?.updated_at,
        log.created_at,
      ),
      message:
        clean(log.error_message) ??
        clean(queued?.last_error) ??
        clean(queued?.failure_reason) ??
        clean(queued?.blocked_reason),
    }
  })
  const statusSet = new Set(entries.map((entry) => entry.status))
  return {
    pending: ['queued', 'processing', 'delivery_uncertain'].some((status) => statusSet.has(status)),
    source_of_truth: 'tenant_email_outbox+communication_logs',
    triggered: entries,
    queued: entries.filter((entry) => ['queued', 'processing'].includes(entry.status)),
    sent: entries.filter((entry) => ['sent', 'delivered'].includes(entry.status)),
    failed: entries.filter((entry) => ['failed', 'bounced', 'complained', 'cancelled', 'dead_letter', 'delivery_uncertain', 'blocked_tenant_state'].includes(entry.status)),
  }
}

function summarizeWebhook(
  deliveries: WebhookDeliveryRow[],
  fanoutJobs: EventOutboxRow[],
  hasEvents: boolean,
) {
  const deliveryStatuses = deliveries.map((row) => clean(row.status) ?? 'unknown')
  const fanoutStatuses = fanoutJobs.map((row) => clean(row.status) ?? 'unknown')
  const failedDeliveries = deliveries.filter((row) =>
    ['failed', 'dead_letter', 'delivery_uncertain', 'blocked_tenant_state'].includes(clean(row.status) ?? ''),
  )
  const failedFanout = fanoutJobs.filter((row) => ['failed', 'dead_letter'].includes(clean(row.status) ?? ''))
  const pending =
    deliveryStatuses.some((status) => ['queued', 'processing', 'delivery_uncertain', 'blocked_tenant_state'].includes(status)) ||
    fanoutStatuses.some((status) => ['queued', 'processing', 'failed'].includes(status))
  const delivered = deliveryStatuses.filter((status) => status === 'sent').length
  const fanoutDeliveryCount = fanoutJobs.reduce((sum, row) => {
    const value = row.payload?.delivery_count
    return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  }, 0)
  const failed = failedDeliveries.length + failedFanout.length
  const status = !hasEvents
    ? 'not_triggered'
    : failed > 0
      ? 'failed'
      : pending
        ? 'pending'
        : delivered > 0
          ? 'sent'
          : fanoutJobs.length > 0 && fanoutStatuses.every((value) => value === 'sent') && fanoutDeliveryCount === 0
            ? 'not_configured'
            : 'pending'

  return {
    status,
    fanout_status: failedFanout.length > 0
      ? 'failed'
      : fanoutStatuses.some((value) => ['queued', 'processing', 'failed'].includes(value))
        ? 'pending'
        : fanoutJobs.length > 0
          ? 'completed'
          : 'not_started',
    queued: deliveryStatuses.filter((value) => ['queued', 'processing'].includes(value)).length,
    sent: delivered,
    failed,
    attempts:
      deliveries.reduce((sum, row) => sum + numberValue(row.attempts), 0) +
      fanoutJobs.reduce((sum, row) => sum + numberValue(row.attempts), 0),
    next_retry_at: earliest(
      ...deliveries.map((row) => row.next_attempt_at),
      ...fanoutJobs.filter((row) => ['queued', 'failed'].includes(clean(row.status) ?? '')).map((row) => row.available_at),
    ),
    last_error:
      clean(failedDeliveries.at(0)?.failure_reason) ??
      clean(failedFanout.at(0)?.last_error),
    updated_at: newest(
      ...deliveries.map((row) => row.updated_at ?? row.delivered_at ?? row.failed_at),
      ...fanoutJobs.map((row) => row.updated_at ?? row.sent_at ?? row.failed_at),
    ),
  }
}

export async function loadWebsiteCustomerApplicationStatus(input: {
  companyId: string
  applicationNumber: string
}) {
  const applicationResult = await supabaseService
    .from('website_customer_applications')
    .select('id,company_id,application_number,customer_number,customer_id,customer_site_id,metering_point_id,contract_id,status,next_step,response_payload,updated_at')
    .eq('company_id', input.companyId)
    .eq('application_number', input.applicationNumber)
    .maybeSingle()
  const application = assertQuery(applicationResult as QueryResult<ApplicationRow>, 'kundansökan')
  if (!application) throw new WebsiteCustomerApplicationStatusError('application_not_found', 404, 'Kundansökan hittades inte.')
  const workflowResult = await supabaseService
    .from('customer_application_workflows')
    .select('id,state,next_action,failure_code,last_job_id,updated_at')
    .eq('company_id', input.companyId)
    .eq('customer_application_id', application.id)
    .maybeSingle()
  const workflow = assertQuery(workflowResult as QueryResult<WorkflowRow>, 'ansökningsworkflow')

  const [switchRow, supplyRow, contractResult, jobResult, communicationResult, eventResult] = await Promise.all([
    loadCorrelatedSwitch(application),
    loadCorrelatedSupply(application),
    application.contract_id
      ? supabaseService.from('customer_contracts').select('status,contract_number,signed_at,withdrawal_deadline_at,signature_snapshot_sha256,updated_at').eq('company_id', input.companyId).eq('id', application.contract_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    workflow?.id
      ? supabaseService.from('customer_operation_jobs').select('status,attempts,max_attempts,run_after,completed_at,last_error_code,last_error_message,last_error,updated_at').eq('company_id', input.companyId).eq('workflow_id', workflow.id).eq('job_type', 'customer_application_continuation').order('created_at', { ascending: false }).limit(1).maybeSingle()
      : supabaseService.from('customer_operation_jobs').select('status,attempts,max_attempts,run_after,completed_at,last_error_code,last_error_message,last_error,updated_at').eq('company_id', input.companyId).contains('payload', { application_id: application.id }).eq('job_type', 'customer_application_continuation').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseService.from('communication_logs').select('id,event_key,status,error_message,sent_at,delivered_at,bounced_at,failed_at,created_at').eq('company_id', input.companyId).contains('metadata', { application_id: application.id }).order('created_at', { ascending: true }).limit(50),
    supabaseService.from('domain_events').select('id').eq('company_id', input.companyId).eq('aggregate_type', 'website_customer_application').eq('aggregate_id', application.id).limit(100),
  ])

  const contract = assertQuery(contractResult as QueryResult<JsonRecord>, 'kundavtal') ?? {}
  const job = assertQuery(jobResult as QueryResult<JobRow>, 'fortsättningsjobb')
  const communicationLogs = assertQuery(communicationResult as QueryResult<CommunicationRow[]>, 'kommunikationslogg') ?? []
  const domainEvents = assertQuery(eventResult as QueryResult<Array<{ id: string }>>, 'domänhändelser') ?? []

  const communicationLogIds = communicationLogs.map((row) => row.id)
  const outboxResult = communicationLogIds.length > 0
    ? await supabaseService.from('tenant_email_outbox').select('communication_log_id,status,attempts,max_attempts,next_attempt_at,last_error,failure_reason,blocked_reason,blocked_at,sent_at,failed_at,updated_at').eq('company_id', input.companyId).in('communication_log_id', communicationLogIds)
    : { data: [], error: null }
  const outbox = assertQuery(outboxResult as QueryResult<EmailOutboxRow[]>, 'e-postkö') ?? []

  const eventIds = domainEvents.map((row) => row.id)
  const [webhookResult, fanoutResult] = eventIds.length > 0
    ? await Promise.all([
        supabaseService
          .from('webhook_deliveries')
          .select('status,attempts,max_attempts,next_attempt_at,delivered_at,failed_at,failure_reason,updated_at')
          .eq('company_id', input.companyId)
          .in('domain_event_id', eventIds)
          .order('created_at', { ascending: false })
          .limit(100),
        supabaseService
          .from('event_outbox')
          .select('status,attempts,max_attempts,available_at,sent_at,failed_at,last_error,payload,updated_at')
          .eq('company_id', input.companyId)
          .in('domain_event_id', eventIds)
          .eq('destination_type', 'webhook')
          .eq('destination_key', 'webhook_fanout_v1')
          .order('created_at', { ascending: false })
          .limit(100),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]
  const webhookDeliveries = assertQuery(webhookResult as QueryResult<WebhookDeliveryRow[]>, 'webhookleveranser') ?? []
  const webhookFanoutJobs = assertQuery(fanoutResult as QueryResult<EventOutboxRow[]>, 'webhook fan-out') ?? []

  const response = application.response_payload ?? {}
  const workflowState = clean(workflow?.state)
  const supplierSwitchStatus = clean(switchRow?.status) ?? 'not_started'
  const supplyStatus = clean(supplyRow?.status)
  const externalStatus = mapExternalStatus({
    applicationStatus: clean(application.status),
    workflowState,
    switchStatus: supplierSwitchStatus,
    supplyStatus,
    jobStatus: clean(job?.status),
  })
  const jobError = clean(job?.last_error_message) ?? clean(job?.last_error) ?? clean(job?.last_error_code)
  const workflowFailure = clean(workflow?.failure_code)
  const communication = summarizeCommunication(communicationLogs, outbox)
  const checkout = buildTenantCheckoutResult({
    applicationNumber: application.application_number,
    applicationStatus: externalStatus,
    contractNumber: contract.contract_number,
    contractStatus: contract.status,
    signedAt: contract.signed_at,
    withdrawalDeadlineAt: contract.withdrawal_deadline_at,
    signatureSnapshotSha256: contract.signature_snapshot_sha256,
    canSendAgreementConfirmation: ['signed', 'active'].includes(clean(contract.status) ?? ''),
    communication,
    automationStatus: clean(job?.status),
    missingCustomerAction: externalStatus === 'needs_customer_information',
    nextStep: clean(workflow?.next_action) ?? clean(application.next_step),
  })

  return {
    application_number: application.application_number,
    status: externalStatus,
    stage: workflowState ?? clean(job?.status) ?? clean(application.status) ?? 'processing',
    customer_number: clean(application.customer_number) ?? clean(response.customer_number),
    contract_number: clean(contract.contract_number),
    contract_status: clean(contract.status),
    signed_at: clean(contract.signed_at),
    withdrawal_deadline_at: clean(contract.withdrawal_deadline_at),
    signature_snapshot_sha256: clean(contract.signature_snapshot_sha256),
    supplier_switch_status: supplierSwitchStatus,
    supply_status: supplyStatus,
    requested_start_date: clean(switchRow?.requested_start_date),
    confirmed_start_date: clean(switchRow?.confirmed_start_date) ?? clean(supplyRow?.start_date),
    missing_customer_action: externalStatus === 'needs_customer_information',
    next_step: clean(workflow?.next_action) ?? clean(application.next_step),
    blocking_reason: workflowFailure ?? jobError,
    automation: {
      status: clean(job?.status) ?? 'not_started',
      attempts: numberValue(job?.attempts),
      max_attempts: numberValue(job?.max_attempts),
      next_retry_at: ['queued', 'running'].includes(clean(job?.status) ?? '') ? clean(job?.run_after) : null,
      completed_at: clean(job?.completed_at),
      last_error: jobError,
    },
    communication,
    checkout,
    webhook: summarizeWebhook(webhookDeliveries, webhookFanoutJobs, domainEvents.length > 0),
    updated_at: newest(
      workflow?.updated_at,
      job?.updated_at,
      clean(contract.updated_at),
      clean(switchRow?.updated_at),
      clean(supplyRow?.updated_at),
      application.updated_at,
    ),
  }
}
