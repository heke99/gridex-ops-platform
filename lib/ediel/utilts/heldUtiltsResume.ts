// lib/ediel/utilts/heldUtiltsResume.ts
//
// Reality finding O2: inbound UTILTS transactions that the runtime holds for
// internal review (ediel_ack_transaction_results.disposition='internal_review',
// planned_response_type 'none', no final reply) were re-evaluated only when a
// platform admin, who is also an active member of the tenant, pressed
// "Återuppta hållna transaktioner" per message. Every held file therefore
// became an APERAK/UTILTS-ERR SLA breach once its hold reason was resolved.
//
// This scheduled resume (run by the inbound-mail cron, beside the F103/F106/
// F112 resumes) re-runs exactly the operator's engine path
// (resumeInboundUtiltsSourceFromOriginal -> processEdielOperationalMessage ->
// processInboundUtiltsMessage, replyOrigin 'operational': replies are queued in
// the outbox and pass every send gate, F112) for a held source ONLY when every
// held transaction's hold reason is one that resolves without a human
// decision AND its basis is now present:
//
//   UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE   -> the protected issuer read
//       (gridex_read_utilts_issuer_identity_authority_v1) is now 'qualified';
//   UTILTS_PERIODIC_REASON_SOURCE_UNAVAILABLE  -> the protected periodic DGI
//       read (gridex_read_periodic_dgi_e66_reason_v1) is no longer 'held';
//   UTILTS_STRUCTURE_UNAVAILABLE with a stored comparison reason that means
//       "approved structure data not (yet) present" -> re-checked on a bounded
//       backoff (no side-effect-free probe exists: the structural snapshot RPC
//       writes an immutable snapshot row per call, exactly like an engine run).
//
// Everything else stays manual (the operator action remains available):
// UTILTS_REGULATING_OBJECT_OWNER_UNAVAILABLE, structure reasons fixed by the
// wire or ambiguous evidence, unknown hold codes, whole-message holds without
// ledger rows (canonical evidence gate, unresolved legal receiver), TGT/AGT/
// test-case/system-test sources (resolveUtiltsRuntimeReplyDispatch) and any
// source with a held transaction in one of these classes.
//
// Bounded: per-run count, probe and time budgets; per-company round robin;
// always lane-scoped and, when given, tenant-scoped; the actor must be an
// active tenant member with metering.write and communication.write (the same
// requirement the engine enforces). Idempotent: each source is claimed with an
// updated_at compare-and-set; an attempt is recorded before acting; a source is
// re-run at most once per evidence fingerprint and at most maxAttempts times.
import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { createEdielMessageEvent } from '@/lib/ediel/db'
import { resolveUtiltsRuntimeReplyDispatch } from '@/lib/ediel/utilts/utiltsRuntimeReplyDispatch'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { UtiltsSourceResumptionResult } from '@/lib/ediel/utilts/utiltsHeldSourceResumption'

export const HELD_UTILTS_RESUME_MARKER = 'held_utilts_resume'

export const UTILTS_HOLD_CODES = {
  issuer: 'UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE',
  periodic: 'UTILTS_PERIODIC_REASON_SOURCE_UNAVAILABLE',
  structure: 'UTILTS_STRUCTURE_UNAVAILABLE',
  regulatingObjectOwner: 'UTILTS_REGULATING_OBJECT_OWNER_UNAVAILABLE',
} as const

/**
 * Structure comparison reasons (lib/ediel/utilts/structuralComparison.ts,
 * lib/ediel/sources/structuralSourceSelection.ts) that mean approved,
 * complete structure data for the period is missing or not yet settled. They
 * can resolve when PRODAT structure arrives or its review is approved. All
 * other reasons are fixed by the received wire (envelope, identity, timezone,
 * period) or report ambiguous/conflicting evidence that needs a human.
 */
export const STRUCTURE_AWAITING_DATA_REASONS: ReadonlySet<string> = new Set([
  'structural_state_missing',
  'structural_outside_coverage',
  'structural_coverage_anchor_missing',
  'structural_universe_incomplete',
  'structural_approval_gap',
  'structural_baseline_unresolved',
  'structural_correction_unresolved',
  'structural_correction_predecessor_unconfirmed',
  'structural_meter_exchange_unresolved',
  'structural_supply_boundary',
  'structural_expected_inventory_unknown',
  'structural_register_membership_unknown',
  'structural_closure_scoped_hold',
  'structural_correction_context_hold',
])

/** Minutes after the hold (then after each re-check) before a structure-held source is re-checked; its length is the cap. */
export const STRUCTURE_RECHECK_BACKOFF_MINUTES: readonly number[] = [15, 60, 6 * 60, 24 * 60]

export type HeldUtiltsHoldClass = 'issuer_identity' | 'periodic_reason' | 'structure_data'
export type HeldUtiltsManualReason =
  | 'regulating_object_owner'
  | 'structure_requires_review'
  | 'structure_evidence_missing'
  | 'unknown_hold'

export type HeldUtiltsTransactionClassification =
  | { kind: 'automatic'; classes: HeldUtiltsHoldClass[] }
  | { kind: 'manual'; reason: HeldUtiltsManualReason }

/** Pure: which hold class(es) a held transaction is in, or why it needs a human. */
export function classifyHeldUtiltsTransaction(input: { issueCodes: readonly string[]; structureReason?: string | null }): HeldUtiltsTransactionClassification {
  const codes = new Set(input.issueCodes)
  if (codes.has(UTILTS_HOLD_CODES.regulatingObjectOwner)) return { kind: 'manual', reason: 'regulating_object_owner' }
  const classes: HeldUtiltsHoldClass[] = []
  if (codes.has(UTILTS_HOLD_CODES.issuer)) classes.push('issuer_identity')
  if (codes.has(UTILTS_HOLD_CODES.periodic)) classes.push('periodic_reason')
  if (codes.has(UTILTS_HOLD_CODES.structure)) {
    if (!input.structureReason) return { kind: 'manual', reason: 'structure_evidence_missing' }
    if (!STRUCTURE_AWAITING_DATA_REASONS.has(input.structureReason)) return { kind: 'manual', reason: 'structure_requires_review' }
    classes.push('structure_data')
  }
  if (classes.length === 0) return { kind: 'manual', reason: 'unknown_hold' }
  return { kind: 'automatic', classes }
}

export type HeldUtiltsResumeOptions = {
  environment: 'test' | 'production'
  /** Tenant-scoped run. Omitted = every tenant of the lane. */
  companyId?: string | null
  /** Sources this run already processed; never touched twice in one run. */
  excludeIds?: readonly string[]
  /** Sources resumed per run. */
  limit?: number
  /** Sources evaluated (probed) per run. */
  probeLimit?: number
  /** No new source is started after this many milliseconds. */
  timeBudgetMs?: number
  /**
   * Reality G-1: epoch milliseconds by which the calling route must have answered
   * (its maxDuration minus a reserve). A source is started only when it is
   * expected to finish before it: one resume stores a whole file (~96 values)
   * and was measured at 2-3 minutes, so a start late in the run overran the
   * route's platform limit.
   */
  deadlineAt?: number | null
  /** Expected duration of one source resume; the longest one seen in this run counts when larger. */
  expectedSourceMs?: number
  /** A hold younger than this may still belong to the run that created it. */
  graceMinutes?: number
  lookbackHours?: number
  /** Automatic attempts per source, over all runs. */
  maxAttempts?: number
  now?: () => Date
}

export type HeldUtiltsResumeResult = {
  heldSources: number
  evaluated: number
  manual: number
  waiting: number
  notOperational: number
  alreadyTried: number
  exhausted: number
  claimed: number
  resumed: number
  stillHeld: number
  notApplicable: number
  failed: number
  skippedCompanies: number
  budgetExhausted: boolean
  errors: string[]
}

type Row = Record<string, unknown>
type Probe = { resolved: boolean; fingerprint: string }

const IN_CHUNK = 50
const LEDGER_PAGE = 1000

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const number = Number.isFinite(value) ? Math.trunc(value as number) : fallback
  return Math.min(Math.max(number, min), max)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message)
  return String(error ?? 'Okänt fel')
}

/** The stored structure comparison reason per transaction of the source's latest runtime. */
export function storedStructureReasons(source: Pick<EdielMessageRow, 'parsed_payload'>): Map<string, string> {
  const evidence = record(record(record(source.parsed_payload).normalizedMeteringPayload).receivedStructureQualification)
  const reasons = new Map<string, string>()
  for (const comparison of Array.isArray(evidence.comparisons) ? evidence.comparisons : []) {
    const row = record(comparison)
    const id = text(row.transactionId), reason = text(row.reason)
    if (id && reason && row.status === 'unavailable') reasons.set(id, reason)
  }
  return reasons
}

async function probeIssuer(source: EdielMessageRow): Promise<Probe> {
  const { data, error } = await supabaseService.rpc('gridex_read_utilts_issuer_identity_authority_v1', {
    p_company_id: source.company_id, p_message_id: source.id,
  })
  if (error) throw new Error(`issuer_probe_failed: ${errorText(error)}`)
  const result = record(data)
  if (result.companyId !== source.company_id || result.sourceMessageId !== source.id || result.environment !== source.environment) {
    throw new Error('issuer_probe_scope_mismatch')
  }
  return { resolved: result.status === 'qualified', fingerprint: `issuer:${String(result.authorityVersionId ?? '')}:${String(result.namespaceEpoch ?? '')}` }
}

async function probePeriodic(source: EdielMessageRow): Promise<Probe> {
  const { data, error } = await supabaseService.rpc('gridex_read_periodic_dgi_e66_reason_v1', {
    p_company_id: source.company_id, p_message_id: source.id,
  })
  if (error) throw new Error(`periodic_probe_failed: ${errorText(error)}`)
  const result = record(data)
  if (result.companyId !== source.company_id || result.sourceMessageId !== source.id || result.environment !== source.environment) {
    throw new Error('periodic_probe_scope_mismatch')
  }
  const expected = Array.isArray(result.expectedReasons) ? result.expectedReasons.map((row) => String(record(row).scopeHash ?? '')).sort() : []
  const digest = createHash('sha256').update(JSON.stringify(expected), 'utf8').digest('hex').slice(0, 16)
  return { resolved: result.status === 'qualified' || result.status === 'not_applicable', fingerprint: `periodic:${String(result.status)}:${digest}` }
}

type History = { attempts: number; completedFingerprints: Set<string>; structureChecks: number; lastAttemptAt: string | null }

async function readHistories(ids: readonly string[]): Promise<Map<string, History>> {
  const histories = new Map<string, History>()
  for (let index = 0; index < ids.length; index += IN_CHUNK) {
    const { data, error } = await supabaseService
      .from('ediel_message_events')
      .select('ediel_message_id,payload,created_at')
      .in('ediel_message_id', ids.slice(index, index + IN_CHUNK))
      .eq('event_type', 'manual_note')
      .eq('payload->>resume', HELD_UTILTS_RESUME_MARKER)
    if (error) throw error
    for (const row of (data ?? []) as Row[]) {
      const id = text(row.ediel_message_id), payload = record(row.payload)
      if (!id || payload.resume !== HELD_UTILTS_RESUME_MARKER) continue
      const history = histories.get(id) ?? { attempts: 0, completedFingerprints: new Set<string>(), structureChecks: 0, lastAttemptAt: null }
      const fingerprint = text(payload.fingerprint)
      if (payload.kind === 'attempt') {
        history.attempts += 1
        if (fingerprint?.split('|').some((part) => part.startsWith('structure:'))) history.structureChecks += 1
        const at = text(row.created_at)
        if (at && (!history.lastAttemptAt || at > history.lastAttemptAt)) history.lastAttemptAt = at
      }
      // A run that finished its check (held again, answered, or a final-reply
      // conflict) is not repeated for the same evidence; a failed or
      // concurrency-stopped run may be retried within maxAttempts.
      if (payload.kind === 'result' && fingerprint && ['processed', 'still_held', 'final_reply_conflict'].includes(String(payload.outcome))) {
        history.completedFingerprints.add(fingerprint)
      }
      histories.set(id, history)
    }
  }
  return histories
}

type HeldLedgerRow = { companyId: string; sourceMessageId: string; transactionId: string; issueCodes: string[]; createdAt: string; updatedAt: string }

/** Held ledger rows of one lane (and tenant), oldest hold first, grouped per source. */
async function readHeldSources(options: HeldUtiltsResumeOptions, graceCutoff: string, lookbackCutoff: string): Promise<Map<string, HeldLedgerRow[]>> {
  let query = supabaseService
    .from('ediel_ack_transaction_results')
    .select('company_id,environment,source_message_id,source_transaction_id,disposition,planned_response_type,final_response_type,response_message_id,finalized_at,issue_codes,created_at,updated_at')
    .eq('environment', options.environment)
    .eq('disposition', 'internal_review')
    .lt('updated_at', graceCutoff)
    .gt('created_at', lookbackCutoff)
  if (options.companyId) query = query.eq('company_id', options.companyId)
  const { data, error } = await query.order('created_at', { ascending: true }).limit(LEDGER_PAGE)
  if (error) throw error
  const exclude = new Set(options.excludeIds ?? [])
  const bySource = new Map<string, HeldLedgerRow[]>()
  for (const row of (data ?? []) as Row[]) {
    const companyId = text(row.company_id), sourceMessageId = text(row.source_message_id), transactionId = text(row.source_transaction_id)
    // Same "held" definition as decideUtiltsSourceResumability.
    if (!companyId || !sourceMessageId || !transactionId || row.environment !== options.environment || row.disposition !== 'internal_review'
      || row.final_response_type || row.finalized_at || row.response_message_id || exclude.has(sourceMessageId)
      || (options.companyId && companyId !== options.companyId)) continue
    const rows = bySource.get(sourceMessageId) ?? []
    if (rows.length && rows[0].companyId !== companyId) continue
    rows.push({ companyId, sourceMessageId, transactionId, issueCodes: Array.isArray(row.issue_codes) ? row.issue_codes.map(String) : [],
      createdAt: String(row.created_at ?? ''), updatedAt: String(row.updated_at ?? '') })
    bySource.set(sourceMessageId, rows)
  }
  return bySource
}

/** Per-company round robin over sources (each company's oldest hold first). */
export function roundRobinByCompany<T extends { companyId: string }>(items: readonly T[]): T[] {
  const queues = new Map<string, T[]>()
  for (const item of items) queues.set(item.companyId, [...(queues.get(item.companyId) ?? []), item])
  const ordered: T[] = []
  for (let round = 0; ordered.length < items.length; round += 1) {
    for (const queue of queues.values()) if (queue[round]) ordered.push(queue[round])
  }
  return ordered
}

/** The sources' updated_at at selection: the claim compares against this value, so a run never claims after another run did. */
async function readSelectionStamps(ids: readonly string[], environment: string): Promise<Map<string, { companyId: string; updatedAt: string }>> {
  const stamps = new Map<string, { companyId: string; updatedAt: string }>()
  for (let index = 0; index < ids.length; index += IN_CHUNK) {
    const { data, error } = await supabaseService
      .from('ediel_messages')
      .select('id,company_id,environment,updated_at')
      .in('id', ids.slice(index, index + IN_CHUNK))
      .eq('environment', environment)
    if (error) throw error
    for (const row of (data ?? []) as Row[]) {
      const id = text(row.id), companyId = text(row.company_id), updatedAt = text(row.updated_at)
      if (id && companyId && updatedAt && row.environment === environment) stamps.set(id, { companyId, updatedAt })
    }
  }
  return stamps
}

async function readSource(id: string, companyId: string, environment: string): Promise<EdielMessageRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .eq('environment', environment)
    .maybeSingle()
  if (error) throw error
  return (data as EdielMessageRow | null) ?? null
}

/** Finds held inbound UTILTS whose hold reason is resolved and resumes each through the operator's engine path. */
export async function resumeHeldInboundUtilts(input: HeldUtiltsResumeOptions & { actorUserId: string; workerId: string }): Promise<HeldUtiltsResumeResult> {
  const result: HeldUtiltsResumeResult = { heldSources: 0, evaluated: 0, manual: 0, waiting: 0, notOperational: 0, alreadyTried: 0, exhausted: 0,
    claimed: 0, resumed: 0, stillHeld: 0, notApplicable: 0, failed: 0, skippedCompanies: 0, budgetExhausted: false, errors: [] }
  if (input.environment !== 'test' && input.environment !== 'production') return result
  const clock = input.now ?? (() => new Date())
  const startedAt = clock()
  const limit = clampInt(input.limit, 10, 1, 50)
  const probeLimit = clampInt(input.probeLimit, 100, 1, 500)
  const timeBudgetMs = clampInt(input.timeBudgetMs, 120_000, 1_000, 600_000)
  const maxAttempts = clampInt(input.maxAttempts, 6, 1, 20)
  const deadlineAt = typeof input.deadlineAt === 'number' && Number.isFinite(input.deadlineAt) ? input.deadlineAt : null
  let expectedSourceMs = clampInt(input.expectedSourceMs, 0, 0, 600_000)
  const fitsBeforeDeadline = () => deadlineAt === null || clock().getTime() + expectedSourceMs <= deadlineAt
  const graceCutoff = new Date(startedAt.getTime() - clampInt(input.graceMinutes, 5, 1, 24 * 60) * 60_000).toISOString()
  const lookbackCutoff = new Date(startedAt.getTime() - clampInt(input.lookbackHours, 45 * 24, 1, 365 * 24) * 3_600_000).toISOString()

  if (!fitsBeforeDeadline()) { result.budgetExhausted = true; return result }
  const held = await readHeldSources(input, graceCutoff, lookbackCutoff)
  result.heldSources = held.size
  if (held.size === 0) return result

  const order = roundRobinByCompany(Array.from(held.values()).map((rows) => ({ companyId: rows[0].companyId, sourceMessageId: rows[0].sourceMessageId })))
  const [histories, stamps] = await Promise.all([
    readHistories(order.map((row) => row.sourceMessageId)),
    readSelectionStamps(order.map((row) => row.sourceMessageId), input.environment),
  ])
  // Loaded only when a held source exists.
  const [{ assertEdielTenantActor }, { resolveUtiltsRuntimeTestCaseCode }, { resumeInboundUtiltsSourceFromOriginal }] = await Promise.all([
    import('@/lib/ediel/services/authorization'),
    import('@/lib/ediel/flows/utiltsDataRequest.part-1'),
    import('@/lib/ediel/utilts/utiltsHeldSourceResumption'),
  ])
  const actorAllowed = new Map<string, boolean>()
  const isActorAllowed = async (companyId: string) => {
    if (!actorAllowed.has(companyId)) {
      try {
        // The engine requires metering.write; the application reply communication.write (require_business_read_actor_v1).
        await assertEdielTenantActor({ companyId, actorUserId: input.actorUserId, permission: 'metering.write' })
        await assertEdielTenantActor({ companyId, actorUserId: input.actorUserId, permission: 'communication.write' })
        actorAllowed.set(companyId, true)
      } catch (error) {
        actorAllowed.set(companyId, false)
        result.skippedCompanies += 1
        result.errors.push(`${companyId}: actor_not_authorized: ${errorText(error)}`)
      }
    }
    return actorAllowed.get(companyId) === true
  }

  for (const candidate of order) {
    if (result.claimed >= limit) break
    if (result.evaluated >= probeLimit || clock().getTime() - startedAt.getTime() >= timeBudgetMs || !fitsBeforeDeadline()) { result.budgetExhausted = true; break }
    const rows = held.get(candidate.sourceMessageId)!
    const { companyId, sourceMessageId } = candidate
    const history = histories.get(sourceMessageId) ?? { attempts: 0, completedFingerprints: new Set<string>(), structureChecks: 0, lastAttemptAt: null }
    if (history.attempts >= maxAttempts) { result.exhausted += 1; continue }
    if (!(await isActorAllowed(companyId))) continue
    result.evaluated += 1
    try {
      const stamp = stamps.get(sourceMessageId)
      const source = stamp && stamp.companyId === companyId ? await readSource(sourceMessageId, companyId, input.environment) : null
      if (!stamp || !source || source.direction !== 'inbound' || source.message_family !== 'UTILTS' || source.status === 'cancelled'
        || source.company_id !== companyId || source.environment !== input.environment) { result.notApplicable += 1; continue }
      // Exactly the lane rule of the runtime replies (F112): only an operational source is resumed automatically.
      const testCaseCode = await resolveUtiltsRuntimeTestCaseCode({ sourceMessage: source, explicitTestCaseCode: null })
      if (resolveUtiltsRuntimeReplyDispatch({ origin: 'operational', sourceMessage: source, testCaseCode }).dispatch !== 'operational_outbox') {
        result.notOperational += 1; continue
      }
      const structureReasons = storedStructureReasons(source)
      const classes = new Set<HeldUtiltsHoldClass>()
      let manual = false
      for (const row of rows) {
        const classification = classifyHeldUtiltsTransaction({ issueCodes: row.issueCodes, structureReason: structureReasons.get(row.transactionId) })
        if (classification.kind === 'manual') { manual = true; break }
        for (const value of classification.classes) classes.add(value)
      }
      if (manual) { result.manual += 1; continue }

      const fingerprints: string[] = []
      let waiting = false
      for (const holdClass of Array.from(classes).sort()) {
        if (holdClass === 'issuer_identity') {
          const probe = await probeIssuer(source)
          if (!probe.resolved) { waiting = true; break }
          fingerprints.push(probe.fingerprint)
        } else if (holdClass === 'periodic_reason') {
          const probe = await probePeriodic(source)
          if (!probe.resolved) { waiting = true; break }
          fingerprints.push(probe.fingerprint)
        } else {
          const step = history.structureChecks
          const delay = STRUCTURE_RECHECK_BACKOFF_MINUTES[step]
          const since = [history.lastAttemptAt, ...rows.map((row) => row.updatedAt)].filter(Boolean).sort().pop() as string
          if (delay === undefined || clock().getTime() - Date.parse(since) < delay * 60_000) { waiting = true; break }
          fingerprints.push(`structure:${step}`)
        }
      }
      if (waiting) { result.waiting += 1; continue }
      const fingerprint = fingerprints.join('|')
      if (history.completedFingerprints.has(fingerprint)) { result.alreadyTried += 1; continue }

      // Probing took time: start the source only when it can still finish before the route deadline.
      if (!fitsBeforeDeadline()) { result.budgetExhausted = true; break }
      // Claim the source once; a concurrent run loses the compare-and-set.
      const claim = await supabaseService
        .from('ediel_messages')
        .update({ updated_at: clock().toISOString() })
        .eq('id', sourceMessageId)
        .eq('company_id', companyId)
        .eq('environment', input.environment)
        .eq('updated_at', stamp.updatedAt)
        .select('id')
      if (claim.error) throw claim.error
      if ((claim.data ?? []).length === 0) continue
      result.claimed += 1
      const attempt = history.attempts + 1
      const heldTransactionIds = rows.map((row) => row.transactionId)
      // The attempt is recorded before acting: a crash mid-run still counts.
      await createEdielMessageEvent({
        actorUserId: input.actorUserId,
        edielMessageId: sourceMessageId,
        eventType: 'manual_note',
        eventStatus: 'info',
        message: `Hållen inbound UTILTS återupptas automatiskt: underlaget för ${heldTransactionIds.length} hållen transaktion(er) finns nu (försök ${attempt} av ${maxAttempts}).`,
        payload: { resume: HELD_UTILTS_RESUME_MARKER, kind: 'attempt', fingerprint, holdClasses: Array.from(classes).sort(), heldTransactionIds,
          attempt, maxAttempts, workerId: input.workerId },
      })
      let outcome: UtiltsSourceResumptionResult
      const resumeStartedAt = clock().getTime()
      try {
        outcome = await resumeInboundUtiltsSourceFromOriginal({
          actorUserId: input.actorUserId,
          sourceMessage: source,
          onlyHeldTransactions: true,
          eventPayload: { resume: HELD_UTILTS_RESUME_MARKER, kind: 'result', resumedBy: 'scheduled_held_utilts_resume', fingerprint, attempt, workerId: input.workerId },
        })
      } catch (error) {
        expectedSourceMs = Math.max(expectedSourceMs, clock().getTime() - resumeStartedAt)
        result.failed += 1
        result.errors.push(`${sourceMessageId}: ${errorText(error)}`)
        if (attempt >= maxAttempts) {
          await createEdielMessageEvent({
            actorUserId: input.actorUserId, edielMessageId: sourceMessageId, eventType: 'manual_note', eventStatus: 'error',
            message: 'Automatisk återupptagning av hållen inbound UTILTS avslutad utan resultat. Kör "Återuppta hållna transaktioner" manuellt när orsaken är åtgärdad.',
            payload: { resume: HELD_UTILTS_RESUME_MARKER, kind: 'exhausted', attempt, maxAttempts, workerId: input.workerId },
          }).catch(() => null)
        }
        continue
      }
      expectedSourceMs = Math.max(expectedSourceMs, clock().getTime() - resumeStartedAt)
      if (outcome.status === 'processed') {
        if (outcome.stillHeldTransactionIds.length > 0) result.stillHeld += 1
        else result.resumed += 1
      } else if (outcome.status === 'refused') {
        result.notApplicable += 1
      } else {
        result.failed += 1
        result.errors.push(`${sourceMessageId}: ${outcome.status}: ${outcome.reason.slice(0, 300)}`)
      }
    } catch (error) {
      result.failed += 1
      result.errors.push(`${sourceMessageId}: ${errorText(error)}`)
    }
  }
  return result
}
