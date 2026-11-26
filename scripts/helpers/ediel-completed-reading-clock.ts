import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { localEdifactDateTimeToUtc, parseEdifactTimezoneOffsetFromComponents } from '@/lib/ediel/utilts/timezone'
import { parseUtilts } from '@/lib/ediel/utilts/parseUtilts'
import { parseSourceReceiptInstant } from '@/lib/ediel/utilts/receivedSourceInventory'

/** Test-only phase boundary. The admitted native controller owns every actual clock write. */
export type ReadingClockSnapshot = {
  os: { realtime_ms: number; monotonic_ms: number }
  node: { realtime_ms: number; monotonic_ms: number }
  postgres_new_transaction: {
    now_ms: number
    statement_ms: number
    clock_ms: number
    system_identifier: string
    postmaster_started_at: string
  }
}

type SupplyChronology = {
  ledgerOpenedAt: string
  switchCreatedAt: string
  marketStartAt: string
  structureEffectiveAt: string
  structureAdmittedAt: string
  registrationInstants: readonly string[]
}

type ClockAdmission = {
  admitted: boolean
  mode: string
  original_realtime_ms: number
  deadline_monotonic_ms: number
}

const DAY_MS = 86_400_000
const MAX_ADVANCE_MS = 35 * DAY_MS
const CLOCK_SKEW_MS = 5_000
const ADVANCE_SETTLE_MS = 2_000

function absoluteInstant(value: string): number {
  const microseconds = parseSourceReceiptInstant(value)
  if (microseconds === null) throw Error('reading_clock_absolute_instant_required')
  return Number(microseconds) / 1_000
}

export function readCompletedReadingRegistration(wire: string): string {
  const { segments, una } = tokenizeEdifact(wire)
  const firstSequence = segments.findIndex(segment => segment.tag === 'SEQ')
  if (firstSequence < 0) throw Error('reading_clock_physical_registration_required')
  const dtms = segments.slice(0, firstSequence)
    .filter(segment => segment.tag === 'DTM')
    .map(segment => segmentComposite(segment, 1, una))
  const registrations = dtms.filter(components => components[0] === '597')
  const offsets = dtms.filter(components => components[0] === '735')
  const registration = registrations[0]
  const offset = offsets.length === 1 ? parseEdifactTimezoneOffsetFromComponents(offsets[0]) : null
  const [transaction, ...otherTransactions] = parseUtilts(wire).transactions
  const instant = registrations.length === 1 && registration[2] === '203' && offset && transaction && otherTransactions.length === 0
    ? localEdifactDateTimeToUtc(transaction.registrationTime, offset)
    : null
  if (!instant) throw Error('reading_clock_physical_registration_required')
  return instant
}

function requireAlignedClock(snapshot: ReadingClockSnapshot) {
  const pg = snapshot.postgres_new_transaction
  const clock = snapshot.node.realtime_ms
  if (![clock, snapshot.node.monotonic_ms, snapshot.os.monotonic_ms].every(Number.isFinite) ||
      [snapshot.os.realtime_ms, pg.now_ms, pg.statement_ms, pg.clock_ms].some(value => !Number.isFinite(value) || Math.abs(value - clock) > CLOCK_SKEW_MS) ||
      !/^\d+$/.test(pg.system_identifier) || !Number.isFinite(Date.parse(pg.postmaster_started_at))) {
    throw Error('reading_clock_runtime_mismatch')
  }
}

export function planCompletedReadingPhase(
  supply: SupplyChronology,
  admission: ClockAdmission,
  before: ReadingClockSnapshot,
) {
  requireAlignedClock(before)
  if (!admission.admitted || admission.mode !== 'native' ||
      !Number.isFinite(admission.deadline_monotonic_ms) || before.os.monotonic_ms >= admission.deadline_monotonic_ms ||
      !Number.isFinite(admission.original_realtime_ms)) {
    throw Error('reading_clock_owned_epoch_required')
  }

  const epoch = absoluteInstant(supply.ledgerOpenedAt)
  const created = absoluteInstant(supply.switchCreatedAt)
  const start = absoluteInstant(supply.marketStartAt)
  const effective = absoluteInstant(supply.structureEffectiveAt)
  const admitted = absoluteInstant(supply.structureAdmittedAt)
  if (epoch < admission.original_realtime_ms || epoch > created || created > admitted || admitted > before.postgres_new_transaction.clock_ms ||
      before.postgres_new_transaction.clock_ms >= start || start > effective) {
    throw Error('reading_clock_prospective_supply_required')
  }

  const registrations = supply.registrationInstants.map(absoluteInstant)
  if (registrations.length === 0 || registrations.some(value => value < start) || Math.max(...registrations) < effective) {
    throw Error('reading_clock_physical_registration_required')
  }
  const latestRegistration = Math.max(...registrations)
  const target = Math.ceil(latestRegistration / 1_000) * 1_000 + ADVANCE_SETTLE_MS
  if (target > admission.original_realtime_ms + MAX_ADVANCE_MS) throw Error('reading_clock_target_outside_owned_epoch')

  return {
    targetRealtimeMs: target,
    latestRegistrationMs: latestRegistration,
    deadlineMonotonicMs: admission.deadline_monotonic_ms,
    before,
  }
}

export type CompletedReadingPhase = ReturnType<typeof planCompletedReadingPhase>

export function verifyCompletedReadingPhase(
  phase: CompletedReadingPhase,
  receipt: { target_realtime_ms: number; actual_realtime_ms: number; shared_restore_lock: boolean },
  after: ReadingClockSnapshot,
  apiDate: string,
) {
  requireAlignedClock(after)
  const pg = after.postgres_new_transaction
  const originalPg = phase.before.postgres_new_transaction
  const apiRealtime = Date.parse(apiDate)
  if (receipt.shared_restore_lock !== true || receipt.target_realtime_ms !== phase.targetRealtimeMs ||
      !Number.isFinite(receipt.actual_realtime_ms) || Math.abs(receipt.actual_realtime_ms - phase.targetRealtimeMs) > CLOCK_SKEW_MS ||
      Math.abs(pg.clock_ms - receipt.actual_realtime_ms) > CLOCK_SKEW_MS || pg.clock_ms < phase.latestRegistrationMs ||
      after.os.monotonic_ms < phase.before.os.monotonic_ms || after.os.monotonic_ms >= phase.deadlineMonotonicMs ||
      after.node.monotonic_ms < phase.before.node.monotonic_ms ||
      pg.system_identifier !== originalPg.system_identifier || pg.postmaster_started_at !== originalPg.postmaster_started_at ||
      !Number.isFinite(apiRealtime) || Math.abs(apiRealtime - after.node.realtime_ms) > CLOCK_SKEW_MS) {
    throw Error('reading_clock_after_phase_not_qualified')
  }
}
