import { supabaseService } from '@/lib/supabase/service'
import { EDIEL_ACK_DEADLINE_MINUTES } from '@/lib/ediel/specRegistry'

/**
 * J1-14, owner decision 39 (TM-ACK, MASTERMASTERPLAN_v2 §15.4): an inbound PRODAT source that waits in
 * (source-bound) review still owes its APERAK within 30 minutes of reaching us (the `aperak_due` timer, anchored to
 * `message_received_at` = the mailbox arrival, never to our CONTRL). Approved processing, its durable storage and the
 * APERAK must all fit in that window.
 *
 * Internal budget: 20 minutes from receipt. The 10-minute margin covers one outbox drain tick after approval
 * (≤ 5 min, vercel.json `1-56/5`), transport and the counterparty's clock. When the budget is spent and the review
 * is still open, an operator gets one critical task (driftkön) and the message one event; when the deadline itself
 * passes, a second, distinct escalation says the APERAK was not sent in time.
 *
 * This watch only prioritises and escalates. It never creates, queues or sends an APERAK: a positive APERAK follows
 * only an approved, durable processing result (approveEdielInboundCase → createReceivedProdatStructuralAcks), and
 * TM-ACK prescribes alarming an internal delay, not a new business decision because time passed.
 */
export const INBOUND_REVIEW_APERAK_BUDGET_MINUTES = 20
export const INBOUND_REVIEW_APERAK_MARGIN_MINUTES = EDIEL_ACK_DEADLINE_MINUTES - INBOUND_REVIEW_APERAK_BUDGET_MINUTES

export const INBOUND_REVIEW_BUDGET_ACK_FAMILY = 'aperak_review_budget'
export const INBOUND_REVIEW_DEADLINE_ACK_FAMILY = 'aperak_review_deadline'
/** A missed deadline is escalated while it is at most this old. */
export const INBOUND_REVIEW_DEADLINE_ESCALATION_WINDOW_HOURS = 24
export const INBOUND_REVIEW_APERAK_TASK_TYPE = 'ediel_inbound_review_aperak_deadline'

/** Timer states that still wait for our APERAK. `resolved`/`cancelled` mean answered (or no APERAK is owed). */
const UNANSWERED_TIMER_STATUSES = ['open', 'warning', 'critical', 'expired'] as const
/** Review not yet completed. A partial structural approval stays `pending_review` (siblings unanswered). */
const OPEN_REVIEW_STATUSES = ['pending_review', 'failed'] as const

export type InboundReviewAperakStage = 'within_budget' | 'budget_exceeded' | 'deadline_passed'

export type InboundReviewAperakPlan = {
  dueAt: string
  budgetAt: string
  stage: InboundReviewAperakStage
  remainingMinutes: number
}

type Row = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * The budget is derived from the persisted `aperak_due.due_at` only. That instant is fixed when the timer is created
 * from the receipt; no CONTRL, retry or re-processing moves it, so nothing here can start a new 30-minute window.
 */
export function planInboundReviewAperakBudget(input: { dueAt: string; now: string }): InboundReviewAperakPlan {
  const dueMs = Date.parse(input.dueAt)
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(dueMs) || !Number.isFinite(nowMs)) throw new Error('inbound_review_aperak_budget_instant_invalid')
  const budgetMs = dueMs - INBOUND_REVIEW_APERAK_MARGIN_MINUTES * 60_000
  return {
    dueAt: new Date(dueMs).toISOString(),
    budgetAt: new Date(budgetMs).toISOString(),
    stage: nowMs >= dueMs ? 'deadline_passed' : nowMs >= budgetMs ? 'budget_exceeded' : 'within_budget',
    remainingMinutes: Math.floor((dueMs - nowMs) / 60_000),
  }
}

export type InboundReviewQueueItem = {
  caseId: string
  companyId: string
  edielMessageId: string
  messageCode: string | null
  caseStatus: string
  caseCreatedAt: string | null
  /** Null when the source owes no (open) APERAK: it is reviewed after every deadline-bound item. */
  aperak: (InboundReviewAperakPlan & { timerId: string; timerStatus: string }) | null
}

/** Review order: an open APERAK deadline first, earliest deadline first; then the rest, oldest first. */
export function prioritizeInboundReviewQueue<T extends Pick<InboundReviewQueueItem, 'aperak' | 'caseCreatedAt' | 'caseId'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.aperak && !b.aperak) return -1
    if (!a.aperak && b.aperak) return 1
    if (a.aperak && b.aperak) {
      const byDue = Date.parse(a.aperak.dueAt) - Date.parse(b.aperak.dueAt)
      if (byDue !== 0) return byDue
    }
    const byCreated = Date.parse(a.caseCreatedAt ?? '') - Date.parse(b.caseCreatedAt ?? '')
    if (Number.isFinite(byCreated) && byCreated !== 0) return byCreated
    return a.caseId.localeCompare(b.caseId)
  })
}

/**
 * Open inbound review cases with their APERAK deadline, in review priority. Every timer is joined only to the case of
 * the same tenant and source message; rows without a tenant are never read into another tenant's queue.
 */
export async function listInboundReviewAperakQueue(params: { companyId?: string | null; now?: string | null; limit?: number }): Promise<InboundReviewQueueItem[]> {
  const now = params.now ?? new Date().toISOString()
  const limit = Math.min(Math.max(Math.floor(params.limit ?? 200), 1), 500)
  let caseQuery = supabaseService.from('ediel_inbound_cases')
    .select('id,company_id,ediel_message_id,message_family,message_code,status,created_at')
    .in('status', [...OPEN_REVIEW_STATUSES]).not('company_id', 'is', null)
    .order('created_at', { ascending: false }).limit(limit)
  // Newest first: a deadline-bound review is at most 30 minutes old, so a backlog of old reviews never hides it.
  if (params.companyId) caseQuery = caseQuery.eq('company_id', params.companyId)
  const { data: cases, error: caseError } = await caseQuery
  if (caseError) throw caseError
  const open = ((cases ?? []) as Row[]).filter(row => text(row.id) && text(row.company_id) && text(row.ediel_message_id))
  if (!open.length) return []

  let timerQuery = supabaseService.from('ediel_sla_timers')
    .select('id,company_id,ediel_message_id,timer_type,due_at,status')
    .eq('timer_type', 'aperak_due').in('status', [...UNANSWERED_TIMER_STATUSES])
    .in('ediel_message_id', open.map(row => String(row.ediel_message_id)))
  if (params.companyId) timerQuery = timerQuery.eq('company_id', params.companyId)
  const { data: timers, error: timerError } = await timerQuery
  if (timerError) throw timerError

  const items = open.map((row): InboundReviewQueueItem => {
    const own = ((timers ?? []) as Row[]).filter(timer => timer.company_id === row.company_id
      && timer.ediel_message_id === row.ediel_message_id && text(timer.due_at))
    const timer = own.length === 1 ? own[0] : null
    return {
      caseId: String(row.id), companyId: String(row.company_id), edielMessageId: String(row.ediel_message_id),
      messageCode: text(row.message_code), caseStatus: String(row.status), caseCreatedAt: text(row.created_at),
      aperak: timer ? { ...planInboundReviewAperakBudget({ dueAt: String(timer.due_at), now }), timerId: String(timer.id), timerStatus: String(timer.status) } : null,
    }
  })
  return prioritizeInboundReviewQueue(items)
}

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

function escalationText(item: InboundReviewQueueItem & { aperak: NonNullable<InboundReviewQueueItem['aperak']> }) {
  const code = item.messageCode ?? 'PRODAT'
  if (item.aperak.stage === 'deadline_passed') {
    return {
      title: `APERAK-fristen har passerat: ${code} i granskning`,
      description: `Granskningen av ${code} (meddelande ${item.edielMessageId}) blev inte klar inom 30 minuter från mottagandet (frist ${hhmm(item.aperak.dueAt)}). `
        + 'Nätägaren har inte fått någon APERAK i tid. Slutför granskningen; en positiv APERAK skickas först efter godkänd och beständig behandling. '
        + 'Kontakta nätägaren om förseningen. Ingen automatisk APERAK eller omsändning görs.',
    }
  }
  return {
    title: `APERAK-frist om ${Math.max(item.aperak.remainingMinutes, 0)} min: ${code} väntar på granskning`,
    description: `Den interna tidsbudgeten (${INBOUND_REVIEW_APERAK_BUDGET_MINUTES} min) för ${code} (meddelande ${item.edielMessageId}) är förbrukad. `
      + `APERAK-fristen löper ut ${hhmm(item.aperak.dueAt)}. Godkänn eller avvisa objekten nu, annars hinner nätägaren inte få svar inom 30 minuter. `
      + 'En positiv APERAK skickas först efter godkänd och beständig behandling, aldrig för att stoppa timern.',
  }
}

export type InboundReviewAperakEscalationResult = { scanned: number; escalated: number; deadlineMissed: number; resolved: number }

/**
 * Escalates open reviews whose APERAK budget or deadline is spent, once per stage and source message (the open
 * ediel_ack_sla_events index is the atomic gate), and closes stage alerts whose source was answered or left review.
 * Never creates or sends an acknowledgement.
 */
export async function runInboundReviewAperakEscalation(params: {
  actorUserId?: string | null
  companyId?: string | null
  now?: string | null
  limit?: number
}): Promise<InboundReviewAperakEscalationResult> {
  const now = params.now ?? new Date().toISOString()
  const queue = await listInboundReviewAperakQueue({ companyId: params.companyId, now, limit: params.limit })
  let escalated = 0
  let deadlineMissed = 0
  const live = new Set<string>()

  for (const item of queue) {
    if (!item.aperak || item.aperak.stage === 'within_budget') continue
    // A deadline missed long ago was already reported by the timer sweep (aperak_due expired); a first run after
    // deployment must not flood the queue with historic reviews.
    if (item.aperak.stage === 'deadline_passed'
      && Date.parse(now) - Date.parse(item.aperak.dueAt) > INBOUND_REVIEW_DEADLINE_ESCALATION_WINDOW_HOURS * 3_600_000) continue
    const aperak = item.aperak
    const ackFamily = aperak.stage === 'deadline_passed' ? INBOUND_REVIEW_DEADLINE_ACK_FAMILY : INBOUND_REVIEW_BUDGET_ACK_FAMILY
    live.add(`${item.edielMessageId}:${ackFamily}`)
    const { error: gateError } = await supabaseService.from('ediel_ack_sla_events').insert({
      company_id: item.companyId,
      ediel_message_id: item.edielMessageId,
      ack_family: ackFamily,
      due_at: aperak.dueAt,
      breached_at: now,
      severity: 'critical',
      status: 'open',
      metadata: { inboundCaseId: item.caseId, messageCode: item.messageCode, stage: aperak.stage, budgetAt: aperak.budgetAt,
        budgetMinutes: INBOUND_REVIEW_APERAK_BUDGET_MINUTES, marginMinutes: INBOUND_REVIEW_APERAK_MARGIN_MINUTES, ownerDecision: 39 },
      created_by: params.actorUserId ?? null,
    })
    if (gateError) {
      if ((gateError as { code?: string }).code === '23505') continue
      throw gateError
    }
    const { title, description } = escalationText({ ...item, aperak })
    const { error: taskError } = await supabaseService.from('customer_operation_tasks').insert({
      company_id: item.companyId,
      task_type: INBOUND_REVIEW_APERAK_TASK_TYPE,
      status: 'open',
      priority: 'critical',
      title,
      description,
      due_at: aperak.dueAt,
      metadata: { sourceId: item.edielMessageId, inboundCaseId: item.caseId, stage: aperak.stage, ackFamily,
        aperakDueAt: aperak.dueAt, budgetAt: aperak.budgetAt, ownerDecision: 39, createdBy: 'inbound_review_aperak_budget' },
      created_by: params.actorUserId ?? null,
    })
    if (taskError) throw taskError
    const { error: eventError } = await supabaseService.from('ediel_message_events').insert({
      company_id: item.companyId,
      ediel_message_id: item.edielMessageId,
      event_type: 'ack_sla_breached',
      event_status: aperak.stage === 'deadline_passed' ? 'error' : 'warning',
      message: title,
      payload: { inboundCaseId: item.caseId, stage: aperak.stage, aperakDueAt: aperak.dueAt, budgetAt: aperak.budgetAt, automaticAck: false },
      created_by: params.actorUserId ?? null,
    })
    if (eventError) throw eventError
    if (aperak.stage === 'deadline_passed') deadlineMissed += 1
    else escalated += 1
  }

  const resolved = await resolveAnsweredReviewEscalations({ companyId: params.companyId, now, live, actorUserId: params.actorUserId ?? null })
  return { scanned: queue.length, escalated, deadlineMissed, resolved }
}

/**
 * An open stage alert whose source is no longer an open review with an unanswered APERAK is closed (event resolved,
 * its open task done). The budget alert also closes once the deadline stage took over.
 */
async function resolveAnsweredReviewEscalations(params: { companyId?: string | null; now: string; live: Set<string>; actorUserId: string | null }): Promise<number> {
  let query = supabaseService.from('ediel_ack_sla_events')
    .select('id,company_id,ediel_message_id,ack_family,status')
    .eq('status', 'open').in('ack_family', [INBOUND_REVIEW_BUDGET_ACK_FAMILY, INBOUND_REVIEW_DEADLINE_ACK_FAMILY])
    .order('created_at', { ascending: true }).limit(500)
  if (params.companyId) query = query.eq('company_id', params.companyId)
  const { data, error } = await query
  if (error) throw error
  const events = ((data ?? []) as Row[]).filter(row => text(row.id) && text(row.company_id) && text(row.ediel_message_id))
  if (!events.length) return 0

  // Re-read the current state per source: whether its review is still open with an unanswered APERAK.
  const messageIds = [...new Set(events.map(row => String(row.ediel_message_id)))]
  const [{ data: cases, error: caseError }, { data: timers, error: timerError }] = await Promise.all([
    supabaseService.from('ediel_inbound_cases').select('company_id,ediel_message_id,status').in('ediel_message_id', messageIds),
    supabaseService.from('ediel_sla_timers').select('company_id,ediel_message_id,status').eq('timer_type', 'aperak_due').in('ediel_message_id', messageIds),
  ])
  if (caseError) throw caseError
  if (timerError) throw timerError
  const stillOwed = (companyId: string, messageId: string) =>
    ((cases ?? []) as Row[]).some(row => row.company_id === companyId && row.ediel_message_id === messageId
      && (OPEN_REVIEW_STATUSES as readonly string[]).includes(String(row.status)))
    && ((timers ?? []) as Row[]).some(row => row.company_id === companyId && row.ediel_message_id === messageId
      && (UNANSWERED_TIMER_STATUSES as readonly string[]).includes(String(row.status)))

  let resolved = 0
  for (const event of events) {
    const companyId = String(event.company_id), messageId = String(event.ediel_message_id), family = String(event.ack_family)
    const superseded = family === INBOUND_REVIEW_BUDGET_ACK_FAMILY && params.live.has(`${messageId}:${INBOUND_REVIEW_DEADLINE_ACK_FAMILY}`)
    if (stillOwed(companyId, messageId) && !superseded) continue
    const { data: changed, error: updateError } = await supabaseService.from('ediel_ack_sla_events')
      .update({ status: 'resolved', resolved_at: params.now, updated_at: params.now })
      .eq('id', String(event.id)).eq('company_id', companyId).eq('status', 'open').select('id')
    if (updateError) throw updateError
    if (!changed?.length) continue
    const { error: taskError } = await supabaseService.from('customer_operation_tasks')
      .update({ status: 'done', resolved_at: params.now, updated_at: params.now, updated_by: params.actorUserId })
      .eq('company_id', companyId).eq('task_type', INBOUND_REVIEW_APERAK_TASK_TYPE).eq('status', 'open')
      .contains('metadata', { sourceId: messageId, ackFamily: family })
    if (taskError) throw taskError
    resolved += 1
  }
  return resolved
}
