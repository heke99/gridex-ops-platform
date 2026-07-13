import type { UtiltsCanonicalMessageCode, UtiltsCanonicalProfile } from '@/lib/ediel/rulebook/utiltsRulebook'
import { resolveCanonicalUtiltsProfile } from '@/lib/ediel/rulebook/utiltsRulebook'

export type UtiltsPhase = 'planning' | 'metering' | 'settlement'

export type UtiltsObservation = {
  timestamp: string
  value: number | null
  quality: string | null
  status: string | null
  estimated: boolean
  interpolated: boolean
}

export type UtiltsRegister = {
  registerId: string
  meterNumber: string | null
  unit: string
  observations: UtiltsObservation[]
}

export type UtiltsTransaction = {
  transactionId: string
  meteringPointId: string | null
  gridAreaId: string | null
  timeSeriesProduct: string
  deliveryPeriod: { start: string; end: string }
  resolution: string
  registrationTimestamp: string | null
  latestUpdateTimestamp: string | null
  reasonForTransaction: string
  unit: string
  direction: string | null
  settlementMethod: string | null
  meterNumber: string | null
  registers: UtiltsRegister[]
  observations: UtiltsObservation[]
  references: Record<string, string>
}

export type UtiltsMessage = {
  code: Exclude<UtiltsCanonicalMessageCode, 'ERR'>
  phase: UtiltsPhase
  transactions: UtiltsTransaction[]
}

export type UtiltsSemanticIssue = {
  severity: 'error' | 'warning'
  code: string
  transactionId: string | null
  description: string
}

export type UtiltsSemanticValidation = {
  ok: boolean
  profile: UtiltsCanonicalProfile
  issues: UtiltsSemanticIssue[]
  packageKey: string
}

function clean(value: unknown): string {
  return String(value ?? '').trim()
}

function issue(code: string, description: string, transactionId: string | null = null): UtiltsSemanticIssue {
  return { severity: 'error', code, transactionId, description }
}

function resolutionMinutes(value: string): number | null {
  const normalized = clean(value).toUpperCase()
  if (/^\d+$/.test(normalized)) {
    const minutes = Number(normalized)
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null
  }
  const match = normalized.match(/^PT(\d+)M$/)
  if (match) return Number(match[1])
  if (normalized === 'P1D') return 1440
  return null
}

function hasOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
}

function instant(value: string, subDaily: boolean): number | null {
  const text = clean(value)
  if (!text) return null
  if (subDaily && !hasOffset(text)) return null
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : null
}

function expectedIntervalCount(start: string, end: string, resolution: string): number | null {
  const minutes = resolutionMinutes(resolution)
  if (!minutes) return null
  const subDaily = minutes < 1440
  const startMs = instant(start, subDaily)
  const endMs = instant(end, subDaily)
  if (startMs === null || endMs === null || endMs <= startMs) return null
  const count = (endMs - startMs) / (minutes * 60_000)
  return Number.isInteger(count) ? count : null
}

function allObservations(transaction: UtiltsTransaction): UtiltsObservation[] {
  return [
    ...transaction.observations,
    ...transaction.registers.flatMap((register) => register.observations),
  ]
}

function validateObservation(params: {
  observation: UtiltsObservation
  transaction: UtiltsTransaction
  seenTimestamps: Set<string>
  issues: UtiltsSemanticIssue[]
}) {
  const { observation, transaction, seenTimestamps, issues } = params
  const timestamp = clean(observation.timestamp)
  if (!timestamp) issues.push(issue('UTILTS_OBSERVATION_TIMESTAMP_REQUIRED', 'Observationen saknar tidsstämpel.', transaction.transactionId))
  if (timestamp && seenTimestamps.has(timestamp)) issues.push(issue('UTILTS_OBSERVATION_TIMESTAMP_DUPLICATE', `Dubblett tidsstämpel ${timestamp}.`, transaction.transactionId))
  if (timestamp) seenTimestamps.add(timestamp)
  if (observation.value !== null && !Number.isFinite(observation.value)) {
    issues.push(issue('UTILTS_OBSERVATION_VALUE_INVALID', 'Observationens värde är inte ett ändligt tal.', transaction.transactionId))
  }
  if (observation.value === null && !clean(observation.status)) {
    issues.push(issue('UTILTS_MISSING_VALUE_STATUS_REQUIRED', 'Saknat värde kräver en explicit statuskod.', transaction.transactionId))
  }
  if (observation.value !== null && clean(observation.status).toUpperCase() === 'MISSING') {
    issues.push(issue('UTILTS_MISSING_VALUE_MUST_NOT_HAVE_QUANTITY', 'En observation markerad som saknad får inte bära kvantitet.', transaction.transactionId))
  }
  if ((observation.estimated || observation.interpolated) && !clean(observation.quality)) {
    issues.push(issue('UTILTS_QUALITY_REQUIRED', 'Estimerade/interpolerade värden kräver kvalitetskod.', transaction.transactionId))
  }
}

export function validateUtiltsMessage(input: {
  message: UtiltsMessage
  businessDate: string
  version: string
  senderRole: string
  receiverRole: string
  bilateralCapabilityEnabled?: boolean
  applicationReference: string
}): UtiltsSemanticValidation {
  const profile = resolveCanonicalUtiltsProfile({
    messageCode: input.message.code,
    businessDate: input.businessDate,
    version: input.version,
  })
  const issues: UtiltsSemanticIssue[] = []
  const senderRole = clean(input.senderRole).toLowerCase()
  const receiverRole = clean(input.receiverRole).toLowerCase()
  const appRef = clean(input.applicationReference)
  if (!appRef) issues.push(issue('UTILTS_APPLICATION_REFERENCE_REQUIRED', 'Application Reference saknas.'))
  if (input.message.phase !== profile.phase) issues.push(issue('UTILTS_PHASE_MISMATCH', `${input.message.code} kräver fas ${profile.phase}, fick ${input.message.phase}.`))
  if (!profile.allowedSenderRoles.includes(senderRole)) issues.push(issue('UTILTS_SENDER_ROLE_NOT_ALLOWED', `Avsändarroll ${senderRole || '(saknas)'} är inte tillåten för ${input.message.code}.`))
  if (!profile.allowedReceiverRoles.includes(receiverRole)) issues.push(issue('UTILTS_RECEIVER_ROLE_NOT_ALLOWED', `Mottagarroll ${receiverRole || '(saknas)'} är inte tillåten för ${input.message.code}.`))
  if (profile.bilateralCapabilityRequired && input.bilateralCapabilityEnabled !== true) {
    issues.push(issue('UTILTS_BILATERAL_CAPABILITY_REQUIRED', `${input.message.code} kräver aktiverad bilateral capability.`))
  }
  if (input.message.transactions.length === 0) issues.push(issue('UTILTS_TRANSACTION_REQUIRED', 'Meddelandet saknar transaktioner.'))

  const transactionIds = new Set<string>()
  const packageDimensions = new Set<string>()
  for (const transaction of input.message.transactions) {
    const id = clean(transaction.transactionId)
    if (!id) issues.push(issue('UTILTS_TRANSACTION_ID_REQUIRED', 'Transaktions-id saknas.'))
    if (id && transactionIds.has(id)) issues.push(issue('UTILTS_TRANSACTION_ID_DUPLICATE', `Dubblett transaktions-id ${id}.`, id))
    if (id) transactionIds.add(id)
    if (profile.requiresMeteringPoint && !clean(transaction.meteringPointId)) issues.push(issue('UTILTS_METERING_POINT_REQUIRED', 'Mätpunkt saknas.', id || null))
    if (profile.requiresGridArea && !clean(transaction.gridAreaId)) issues.push(issue('UTILTS_GRID_AREA_REQUIRED', 'Nätområde saknas.', id || null))
    if (!clean(transaction.timeSeriesProduct)) issues.push(issue('UTILTS_TIMESERIES_PRODUCT_REQUIRED', 'Tidsserieprodukt saknas.', id || null))
    if (!clean(transaction.reasonForTransaction)) issues.push(issue('UTILTS_REASON_REQUIRED', 'Reason for transaction saknas.', id || null))
    if (profile.requiresPeriod && (!clean(transaction.deliveryPeriod.start) || !clean(transaction.deliveryPeriod.end))) issues.push(issue('UTILTS_PERIOD_REQUIRED', 'Leveransperiod saknas.', id || null))
    if (profile.requiresResolution && !resolutionMinutes(transaction.resolution)) issues.push(issue('UTILTS_RESOLUTION_INVALID', `Ogiltig upplösning ${transaction.resolution || '(saknas)'}.`, id || null))
    if (profile.requiresUnit && !clean(transaction.unit)) issues.push(issue('UTILTS_UNIT_REQUIRED', 'Enhet saknas.', id || null))

    const observations = allObservations(transaction)
    if (profile.requiresQuantities && observations.length === 0) issues.push(issue('UTILTS_OBSERVATIONS_REQUIRED', 'Profilen kräver observationer.', id || null))
    if (!profile.requiresQuantities && observations.length > 0) issues.push(issue('UTILTS_REQUEST_MUST_NOT_CONTAIN_OBSERVATIONS', 'Requestprofilen får inte innehålla observationer.', id || null))
    const seenTimestamps = new Set<string>()
    for (const observation of observations) validateObservation({ observation, transaction, seenTimestamps, issues })

    if (profile.validatesDst && profile.requiresQuantities) {
      const expected = expectedIntervalCount(transaction.deliveryPeriod.start, transaction.deliveryPeriod.end, transaction.resolution)
      if (expected === null) {
        issues.push(issue('UTILTS_PERIOD_OR_TIMEZONE_INVALID', 'Period/upplösning kan inte valideras. Subdygnsvärden måste ha UTC-offset.', id || null))
      } else if (observations.length !== expected) {
        issues.push(issue('UTILTS_INTERVAL_COUNT_MISMATCH', `Förväntade ${expected} observationer men fick ${observations.length}.`, id || null))
      }
    }

    for (const register of transaction.registers) {
      if (!clean(register.registerId)) issues.push(issue('UTILTS_REGISTER_ID_REQUIRED', 'RegisterId saknas.', id || null))
      if (!clean(register.unit)) issues.push(issue('UTILTS_REGISTER_UNIT_REQUIRED', 'Registerenhet saknas.', id || null))
    }
    packageDimensions.add([input.message.phase, transaction.resolution, transaction.reasonForTransaction, input.receiverRole, appRef].map(clean).join('|'))
  }
  if (packageDimensions.size > 1) issues.push(issue('UTILTS_MIXED_PACKAGE_DIMENSIONS', 'Meddelandet blandar fas, upplösning, reason, juridisk mottagare eller Application Reference.'))

  return {
    ok: !issues.some((entry) => entry.severity === 'error'),
    profile,
    issues,
    packageKey: [input.message.code, input.message.phase, input.receiverRole, appRef, input.version].map(clean).join('|'),
  }
}

function token(value: string | null | undefined): string {
  return clean(value).replace(/[\r\n'+:?]/g, ' ').replace(/\s+/g, ' ')
}

function dtm203(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`utilts_datetime_invalid:${value}`)
  return parsed.toISOString().replace(/[-:TZ.]/g, '').slice(0, 12)
}

export function renderCanonicalUtiltsBody(input: {
  message: UtiltsMessage
  documentReference: string
  generatedAt: string
}): string[] {
  const segments: string[] = [
    `BGM+${input.message.code}::260+${token(input.documentReference)}+9+AB`,
    `DTM+137:${dtm203(input.generatedAt)}:203`,
  ]
  for (const transaction of input.message.transactions) {
    segments.push(`IDE+24+${token(transaction.transactionId)}`)
    if (transaction.meteringPointId) segments.push(`LOC+172+${token(transaction.meteringPointId)}::9`)
    if (transaction.gridAreaId) segments.push(`LOC+239+${token(transaction.gridAreaId)}:SVK:260`)
    segments.push(`RFF+TN:${token(transaction.transactionId)}`)
    segments.push(`RFF+ZTS:${token(transaction.timeSeriesProduct)}`)
    if (transaction.deliveryPeriod.start && transaction.deliveryPeriod.end) {
      segments.push(`DTM+324:${dtm203(transaction.deliveryPeriod.start)}${dtm203(transaction.deliveryPeriod.end)}:719`)
    }
    if (transaction.registrationTimestamp) segments.push(`DTM+597:${dtm203(transaction.registrationTimestamp)}:203`)
    if (transaction.resolution) segments.push(`DTM+354:${token(String(resolutionMinutes(transaction.resolution) ?? transaction.resolution))}:802`)
    segments.push(`STS+7++${token(transaction.reasonForTransaction)}::260`)
    if (transaction.unit) segments.push(`MEA+AAZ++${token(transaction.unit)}`)
    let sequence = 0
    for (const observation of allObservations(transaction)) {
      sequence += 1
      segments.push(`SEQ++${sequence}`)
      segments.push(`DTM+163:${dtm203(observation.timestamp)}:203`)
      if (observation.value !== null) segments.push(`QTY+136:${String(observation.value)}`)
      if (observation.quality) segments.push(`STS+7++${token(observation.quality)}::260`)
      if (observation.status) segments.push(`FTX+AAO+++${token(observation.status)}`)
    }
  }
  return segments
}
