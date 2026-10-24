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
// Bounded: 200-row cursor pages, 50 actions, and finite probe/time budgets; per-company round robin;
// always lane-scoped and, when given, tenant-scoped; the actor must be an
// active tenant member with metering.write and communication.write (the same
// requirement the engine enforces). Idempotent: each source is claimed with an
// durable source token; START atomically counts before acting; a source is
// re-run at most once per evidence fingerprint and at most maxAttempts times.
import { claimRecoveryWork, runRecoveryBatch, releaseRecoveryWork, type RecoveryClaim } from '@/lib/inbound-mail/edielRecoveryWork'
import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
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
  }).abortSignal(AbortSignal.timeout(5000))
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
  }).abortSignal(AbortSignal.timeout(5000))
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

async function readHistories(targets: readonly { companyId: string; sourceMessageId: string }[]): Promise<Map<string, History>> {
  const histories = new Map<string, History>()
  for (let index = 0; index < targets.length; index += IN_CHUNK) {
    const chunk = targets.slice(index, index + IN_CHUNK)
    const ids = chunk.map(target => target.sourceMessageId)
    const companyBySource = new Map(chunk.map(target => [target.sourceMessageId, target.companyId]))
    // One bounded mixed-tenant read, matching the actual leased company/message pairs.
    // PostgREST quoted values escape punctuation rather than treating it as filter syntax.
    const pairs = chunk.map(target => `and(company_id.eq.${JSON.stringify(target.companyId)},ediel_message_id.eq.${JSON.stringify(target.sourceMessageId)})`).join(',')
    const { data, error } = await supabaseService
      .from('ediel_message_events')
      .select('company_id,ediel_message_id,payload,created_at')
      .in('ediel_message_id', ids)
      .or(pairs)
      .eq('event_type', 'manual_note')
      .eq('payload->>resume', HELD_UTILTS_RESUME_MARKER)
      .order('created_at', {ascending:false}).limit(201).abortSignal(AbortSignal.timeout(5000))
    if (error) throw error
    // An incomplete history cannot authorize replay of a fingerprint.
    if ((data ?? []).length >= 201) { for (const id of ids) histories.set(id,{attempts:20,completedFingerprints:new Set(),structureChecks:4,lastAttemptAt:null}); continue }
    for (const row of (data ?? []) as Row[]) {
      const id = text(row.ediel_message_id), payload = record(row.payload)
      if (!id || row.company_id !== companyBySource.get(id) || payload.resume !== HELD_UTILTS_RESUME_MARKER) continue
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

/** Read every held transaction of each leased source, refusing a source above the finite per-source cap. */
async function readHeldSources(options: HeldUtiltsResumeOptions, targets: readonly (RecoveryClaim & {sourceMessageId:string})[]): Promise<Map<string, HeldLedgerRow[]>> {
  const bySource = new Map<string, HeldLedgerRow[]>()
  for (const target of targets) {
    if(performance.now()>=target.recovery.deadline) break
    const {data,error}=await (tenantDb(target.companyId).from('ediel_ack_transaction_results').select('company_id,environment,source_message_id,source_transaction_id,disposition,final_response_type,response_message_id,finalized_at,issue_codes,created_at,updated_at') as ReturnType<ReturnType<typeof supabaseService.from>['select']>)
      .eq('environment',options.environment).eq('source_message_id',target.sourceMessageId).eq('disposition','internal_review').limit(201).abortSignal(AbortSignal.timeout(Math.max(1,Math.floor(Math.min(5000,target.recovery.deadline-performance.now())))))
    if(error) throw error
    if((data??[]).length>200) continue
    const graceCutoff=Date.now()-clampInt(options.graceMinutes,5,2,1440)*60000
    // Never classify a partial set by filtering away a newly held transaction.
    if(((data??[]) as Row[]).some(row=>!Number.isFinite(Date.parse(String(row.updated_at))) || Date.parse(String(row.updated_at))>=graceCutoff)) continue
    const rows:HeldLedgerRow[]=[]
    for(const row of (data??[]) as Row[]) {
      if(row.final_response_type || row.finalized_at || row.response_message_id) continue
      const transactionId=text(row.source_transaction_id)
      if(!transactionId || row.company_id!==target.companyId || row.environment!==options.environment || row.source_message_id!==target.sourceMessageId) continue
      rows.push({companyId:target.companyId,sourceMessageId:target.sourceMessageId,transactionId,issueCodes:Array.isArray(row.issue_codes)?row.issue_codes.map(String):[],createdAt:String(row.created_at??''),updatedAt:String(row.updated_at??'')})
    }
    if(rows.length) bySource.set(target.sourceMessageId,rows)
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

async function readSource(id: string, companyId: string, environment: string): Promise<EdielMessageRow | null> {
  const { data, error } = await (tenantDb(companyId).from('ediel_messages').select('*') as ReturnType<ReturnType<typeof supabaseService.from>['select']>)
    .eq('id', id)
    .eq('environment', environment)
    .abortSignal(AbortSignal.timeout(5000)).maybeSingle()
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
  const timeBudgetMs = clampInt(input.timeBudgetMs, 45_000, 1_000, 45_000)
  const maxAttempts = clampInt(input.maxAttempts, 6, 1, 20)
  const lease = await claimRecoveryWork<RecoveryClaim & {sourceMessageId:string}>('held', {...input,limit,graceMinutes: input.graceMinutes ?? 5})
  const leased=lease.claimed
  try {
  const held = await readHeldSources(input, leased)
  result.heldSources = held.size
  const order = roundRobinByCompany(leased.filter(target=>held.has(target.sourceMessageId)))
  const histories = await readHistories(order)
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
    if (result.evaluated >= probeLimit || clock().getTime() - startedAt.getTime() >= timeBudgetMs) { result.budgetExhausted = true; break }
    const rows = held.get(candidate.sourceMessageId)!
    const { companyId, sourceMessageId } = candidate
    const history = histories.get(sourceMessageId) ?? { attempts: 0, completedFingerprints: new Set<string>(), structureChecks: 0, lastAttemptAt: null }
    if (history.attempts >= maxAttempts) { result.exhausted += 1; continue }
    if (!(await isActorAllowed(companyId))) continue
    result.evaluated += 1
    try {
      const source = await readSource(sourceMessageId, companyId, input.environment)
      if (!source || source.direction !== 'inbound' || source.message_family !== 'UTILTS' || source.status === 'cancelled'
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

      await runRecoveryBatch([candidate], async target => {
      result.claimed += 1
      const attempt = target.attempt
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
      try {
        outcome = await resumeInboundUtiltsSourceFromOriginal({
          actorUserId: input.actorUserId,
          sourceMessage: source,
          onlyHeldTransactions: true,
          eventPayload: { resume: HELD_UTILTS_RESUME_MARKER, kind: 'result', resumedBy: 'scheduled_held_utilts_resume', fingerprint, attempt, recoveryToken: target.recovery.token, workerId: input.workerId },
        })
      } catch (error) {
        result.failed += 1
        result.errors.push(`${sourceMessageId}: ${errorText(error)}`)
        if (attempt >= maxAttempts) {
          await createEdielMessageEvent({
            actorUserId: input.actorUserId, edielMessageId: sourceMessageId, eventType: 'manual_note', eventStatus: 'error',
            message: 'Automatisk återupptagning av hållen inbound UTILTS avslutad utan resultat. Kör "Återuppta hållna transaktioner" manuellt när orsaken är åtgärdad.',
            payload: { resume: HELD_UTILTS_RESUME_MARKER, kind: 'exhausted', attempt, maxAttempts, workerId: input.workerId },
          }).catch(() => null)
        }
        return 'ambiguous'
      }
      if (outcome.status === 'processed') {
        if (outcome.stillHeldTransactionIds.length > 0) result.stillHeld += 1
        else result.resumed += 1
        return 'completed'
      } else if (outcome.status === 'refused') {
        result.notApplicable += 1
      } else {
        result.failed += 1
        result.errors.push(`${sourceMessageId}: ${outcome.status}: ${outcome.reason.slice(0, 300)}`)
      }
      return 'ambiguous'
      }, result.errors)
    } catch (error) {
      result.failed += 1
      result.errors.push(`${sourceMessageId}: ${errorText(error)}`)
    }
  }
  } finally {
    // STARTed and UNCERTAIN reservations reject release; only untouched leases return to READY.
    for (const target of leased) await releaseRecoveryWork(target).catch(() => undefined)
  }
  return result
}
