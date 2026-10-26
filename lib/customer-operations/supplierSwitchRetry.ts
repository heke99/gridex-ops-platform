import { supabaseService } from '@/lib/supabase/service'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import { enqueueSupplierSwitchAutomation } from '@/lib/customer-operations/automation.part-1'
import { requireUuid } from '@/lib/validation/uuid'
import { OPEN_SUPPLIER_SWITCH_STATUSES } from '@/lib/operations/switchLifecycleBlocks'

/**
 * Owner decision 32 (FINDINGS I-B2d): staff retry a failed supplier switch from the customer card through the existing
 * automation (start_supplier_switch), never through the technical switch form. The retry is only queued when every
 * check holds; anything that may already have reached the grid owner goes to investigation of the existing switch.
 */

export type RetrySwitchRow = {
  id: string
  company_id: string
  customer_id: string | null
  site_id: string | null
  customer_site_id?: string | null
  metering_point_id: string | null
  status: string
  failure_reason: string | null
  requested_start_date: string | null
  outbound_z03_message_id: string | null
  submitted_at: string | null
  contract_id?: string | null
  customer_contract_id?: string | null
  created_at: string
}

export type RetryContractRow = {
  id: string
  company_id: string
  customer_id: string | null
  status: string
  withdrawal_requested_at: string | null
  ends_at: string | null
}

export type RetryZ03Message = {
  id: string
  status: string | null
  message_sent_at: string | null
  canonical_ack_state: string | null
}

export type RetryFacts = {
  switchRequest: RetrySwitchRow | null
  /** Every other switch request of the same site (any status). */
  siblings: RetrySwitchRow[]
  contract: RetryContractRow | null
  /** Supply periods of the switch's contract that the grid owner confirmed or that are active. */
  confirmedSupplyPeriods: number
  z03: RetryZ03Message | null
  today: string
}

export type RetryAssessment =
  | { decision: 'retry'; startDate: string; contractId: string }
  | { decision: 'investigate'; reasons: string[] }
  | { decision: 'refused'; reasons: string[] }

const CONFIRMED_SWITCH_STATUSES = new Set(['accepted', 'completed', 'active'])
const OPEN_SWITCH_STATUSES = new Set<string>(OPEN_SUPPLIER_SWITCH_STATUSES)
/** A Z03 the grid owner definitively did not accept. */
const DEFINITIVE_REJECTION_ACK_STATES = new Set(['aperak_received_negative', 'contrl_failed'])
/** Reasons a new switch must never be started for (the customer stopped it or the case was a duplicate). */
const NON_RETRYABLE_FAILURE = /(withdraw|ånger|cancel|avbr|duplicate|dubblett|customer_left|lämnat)/i

/** The pure decision: every requirement of owner decision 32, in order. */
export function assessSupplierSwitchRetry(facts: RetryFacts): RetryAssessment {
  const s = facts.switchRequest
  if (!s) return { decision: 'refused', reasons: ['switch_not_found_for_tenant'] }
  if (s.status !== 'failed') return { decision: 'refused', reasons: [`switch_not_failed:${s.status}`] }

  const refused: string[] = []
  const siblings = facts.siblings.filter((other) => other.id !== s.id)
  if (siblings.some((other) => CONFIRMED_SWITCH_STATUSES.has(other.status)) || facts.confirmedSupplyPeriods > 0) refused.push('switch_already_confirmed')
  if (siblings.some((other) => OPEN_SWITCH_STATUSES.has(other.status))) refused.push('open_switch_exists')

  const reason = s.failure_reason?.trim() ?? ''
  if (NON_RETRYABLE_FAILURE.test(reason)) refused.push('failure_reason_not_retryable')

  const c = facts.contract
  if (!c || c.company_id !== s.company_id || (s.customer_id && c.customer_id !== s.customer_id)) refused.push('contract_missing')
  else {
    if (!['signed', 'active'].includes(c.status)) refused.push(`contract_not_valid:${c.status}`)
    if (c.withdrawal_requested_at) refused.push('contract_withdrawal_requested')
  }

  const start = s.requested_start_date
  if (!start) refused.push('start_date_missing')
  else {
    // The agreed start date is never moved automatically: a date that has passed needs a staff decision.
    if (start < facts.today) refused.push('start_date_passed')
    if (c?.ends_at && c.ends_at <= start) refused.push('contract_ends_before_start')
  }
  if (refused.length) return { decision: 'refused', reasons: refused }

  // Message status: a retry only follows a Z03 that never left us or that the grid owner definitively rejected.
  const investigate: string[] = []
  if (!reason) investigate.push('failure_reason_unknown')
  if (s.outbound_z03_message_id) {
    const m = facts.z03
    if (!m) investigate.push('z03_status_unknown')
    else if (DEFINITIVE_REJECTION_ACK_STATES.has(m.canonical_ack_state ?? '')) {
      // Rejected by the grid owner: a corrected new switch may be sent.
    } else if (!m.message_sent_at && ['failed', 'cancelled'].includes(m.status ?? '')) {
      // Never sent.
    } else investigate.push(`z03_may_have_reached_grid_owner:${m.canonical_ack_state ?? m.status ?? 'unknown'}`)
  } else if (s.submitted_at) investigate.push('z03_status_unknown')
  if (investigate.length) return { decision: 'investigate', reasons: investigate }

  return { decision: 'retry', startDate: start as string, contractId: c!.id }
}

const one = <T>(rows: T[] | null | undefined): T | null => (rows && rows.length ? rows[0] : null)

/** Reads the facts tenant-scoped (every query bound to the company). */
export async function loadSupplierSwitchRetryFacts(companyId: string, switchRequestId: string, today: string): Promise<RetryFacts> {
  const db = supabaseService
  const switchColumns = 'id,company_id,customer_id,site_id,customer_site_id,metering_point_id,status,failure_reason,requested_start_date,outbound_z03_message_id,submitted_at,contract_id,customer_contract_id,created_at'
  const own = await db.from('supplier_switch_requests').select(switchColumns).eq('company_id', companyId).eq('id', switchRequestId).limit(1)
  if (own.error) throw own.error
  const switchRequest = one(own.data as RetrySwitchRow[] | null)
  if (!switchRequest) return { switchRequest: null, siblings: [], contract: null, confirmedSupplyPeriods: 0, z03: null, today }

  const siteId = switchRequest.site_id ?? switchRequest.customer_site_id ?? null
  const siblings = siteId
    ? await db.from('supplier_switch_requests').select(switchColumns).eq('company_id', companyId).eq('customer_id', switchRequest.customer_id).eq('site_id', siteId)
    : { data: [], error: null }
  if (siblings.error) throw siblings.error

  const contractId = switchRequest.customer_contract_id ?? switchRequest.contract_id ?? null
  let contract: RetryContractRow | null = null
  let confirmedSupplyPeriods = 0
  if (contractId) {
    const c = await db.from('customer_contracts').select('id,company_id,customer_id,status,withdrawal_requested_at,ends_at').eq('company_id', companyId).eq('id', contractId).limit(1)
    if (c.error) throw c.error
    contract = one(c.data as RetryContractRow[] | null)
    const p = await db.from('customer_supply_periods').select('id').eq('company_id', companyId).eq('customer_contract_id', contractId).in('status', ['active', 'confirmed_by_grid_owner'])
    if (p.error) throw p.error
    confirmedSupplyPeriods = (p.data ?? []).length
  }

  let z03: RetryZ03Message | null = null
  if (switchRequest.outbound_z03_message_id) {
    const m = await db.from('ediel_messages').select('id,status,message_sent_at').eq('company_id', companyId).eq('id', switchRequest.outbound_z03_message_id).limit(1)
    if (m.error) throw m.error
    const message = one(m.data as Array<{ id: string; status: string | null; message_sent_at: string | null }> | null)
    if (message) {
      const a = await db.from('ediel_message_ack_state_v').select('id,canonical_ack_state').eq('id', message.id).limit(1)
      if (a.error) throw a.error
      z03 = { ...message, canonical_ack_state: one(a.data as Array<{ canonical_ack_state: string | null }> | null)?.canonical_ack_state ?? null }
    }
  }
  return { switchRequest, siblings: (siblings.data ?? []) as RetrySwitchRow[], contract, confirmedSupplyPeriods, z03, today }
}

export function stockholmToday(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export type RetryResult =
  | { outcome: 'queued'; jobId: string; duplicate: boolean }
  | { outcome: 'investigate'; reasons: string[] }
  | { outcome: 'refused'; reasons: string[] }

/**
 * Retries a failed switch. The caller has already checked switching.write in the company (the server action); this
 * re-reads everything tenant-scoped, decides, and queues through the canonical start_supplier_switch key, so a
 * concurrent or repeated retry joins the same active job (customer_operation_jobs_active_idempotency_uidx) and the
 * worker reuses any open switch for the site instead of sending a second Z03.
 */
export async function retryFailedSupplierSwitch(input: { companyId: string; switchRequestId: string; actorUserId: string; now?: Date }): Promise<RetryResult> {
  const companyId = requireUuid(input.companyId, 'company_id')
  const switchRequestId = requireUuid(input.switchRequestId, 'supplier_switch_request_id')
  const actorUserId = requireUuid(input.actorUserId, 'actor_user_id')
  const facts = await loadSupplierSwitchRetryFacts(companyId, switchRequestId, stockholmToday(input.now))
  const assessment = assessSupplierSwitchRetry(facts)
  const s = facts.switchRequest
  const siteId = s?.site_id ?? s?.customer_site_id ?? null

  if (assessment.decision !== 'retry') {
    if (s?.customer_id) {
      await emitCustomerOperationEvent({
        companyId,
        customerId: s.customer_id,
        actorUserId,
        eventType: assessment.decision === 'investigate' ? 'supplier_switch.retry_needs_review' : 'supplier_switch.retry_blocked',
        title: assessment.decision === 'investigate' ? 'Utred bytet innan nytt försök' : 'Försök igen är inte möjligt',
        message: assessment.decision === 'investigate'
          ? 'Det tidigare bytet kan ha nått nätägaren. Utred det befintliga ärendet innan en ny bytesanmälan skickas.'
          : 'Bytet kan inte startas om automatiskt.',
        customerSiteId: siteId,
        meteringPointId: s.metering_point_id,
        status: assessment.decision === 'investigate' ? 'needs_review' : 'blocked',
        actionRequired: true,
        payload: { supplier_switch_request_id: s.id, reasons: assessment.reasons, initiated_by: actorUserId },
        idempotencyKey: `supplier_switch.retry:${s.id}:${assessment.decision}:${assessment.reasons.join(',')}`,
      })
    }
    return { outcome: assessment.decision, reasons: assessment.reasons }
  }

  const job = await enqueueSupplierSwitchAutomation({
    companyId,
    customerId: s!.customer_id as string,
    siteId: siteId as string,
    meteringPointId: s!.metering_point_id,
    actorUserId,
    source: 'switch_retry',
    payloadContext: {
      // The agreed start date, unchanged.
      requested_start_date: assessment.startDate,
      contract_id: assessment.contractId,
      retry_of_supplier_switch_request_id: s!.id,
      retry_initiated_by: actorUserId,
      retry_failure_reason: s!.failure_reason,
    },
  })
  await emitCustomerOperationEvent({
    companyId,
    customerId: s!.customer_id as string,
    actorUserId,
    eventType: 'supplier_switch.retry_queued',
    title: 'Nytt försök med leverantörsbytet',
    message: 'Bytet startas om genom automationen med det avtalade startdatumet.',
    customerSiteId: siteId,
    meteringPointId: s!.metering_point_id,
    customerOperationJobId: job.id,
    status: 'queued',
    payload: { supplier_switch_request_id: s!.id, customer_operation_job_id: job.id, duplicate: job.duplicate, initiated_by: actorUserId, requested_start_date: assessment.startDate },
    idempotencyKey: `supplier_switch.retry_queued:${s!.id}:${job.id}`,
  })
  return { outcome: 'queued', jobId: job.id, duplicate: job.duplicate }
}
