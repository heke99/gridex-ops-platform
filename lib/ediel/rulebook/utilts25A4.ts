export type UtiltsGuideRevision = '25-A-3' | '25-A-4'
export type UtiltsMessageUseMode = 'live_inbound' | 'outbound' | 'historical_replay'

export type UtiltsProcessabilityPolicy = {
  guideRevision: UtiltsGuideRevision
  effectiveFrom: string
  effectiveTo: string | null
  associationAssignedCode: 'E5SE5A'
  fieldMatrixBase: '25-A-3'
  fieldMatrixOverlayCertified: boolean
  activeOutboundMessageCodes: readonly string[]
  historicalReceiveOnlyMessageCodes: readonly string[]
  removedFieldNumbers: readonly string[]
  removedRejectionReasonCodes: readonly string[]
  removedTransactionReasonCodes: readonly string[]
  compareMeterReadingsToEnergyVolumes: boolean
  endMeterReadingBelowStartIsError: boolean
  validateIndividualMeteringPointEnergyValuesBeyondE30: boolean
  validateMeterAndRegisterAgainstStructuralInformation: boolean
  source: {
    document: string
    section: '1.8 Change log'
    effectiveFrom: string
  }
}

const activeCodes = ['E30', 'E31', 'E66', 'E72', 'E73', 'E74', 'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'ERR'] as const
const S08_LAST_LIVE_USE_DATE = '2026-04-14'

export const UTILTS_25_A_3_POLICY: UtiltsProcessabilityPolicy = {
  guideRevision: '25-A-3',
  effectiveFrom: '2025-06-01',
  effectiveTo: '2026-09-30',
  associationAssignedCode: 'E5SE5A',
  fieldMatrixBase: '25-A-3',
  fieldMatrixOverlayCertified: true,
  activeOutboundMessageCodes: activeCodes,
  // S08 remains recognizable for historical parsing/audit after retirement,
  // but it is not a current production workflow after 2026-04-14.
  historicalReceiveOnlyMessageCodes: ['S08'],
  removedFieldNumbers: [],
  removedRejectionReasonCodes: [],
  removedTransactionReasonCodes: [],
  compareMeterReadingsToEnergyVolumes: true,
  endMeterReadingBelowStartIsError: true,
  validateIndividualMeteringPointEnergyValuesBeyondE30: true,
  validateMeterAndRegisterAgainstStructuralInformation: false,
  source: {
    document: '251001_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-3',
    section: '1.8 Change log',
    effectiveFrom: '2025-06-01',
  },
}

/**
 * 25-A-4 is a dated overlay over the certified 25-A-3 active-field matrix.
 * The change log removes the retired S08 fields 535-538, removes E19 and Z03,
 * and changes processability semantics. It does not create a second unrelated
 * copy of the unchanged active-message field matrix.
 */
export const UTILTS_25_A_4_POLICY: UtiltsProcessabilityPolicy = {
  guideRevision: '25-A-4',
  effectiveFrom: '2026-10-01',
  effectiveTo: null,
  associationAssignedCode: 'E5SE5A',
  fieldMatrixBase: '25-A-3',
  fieldMatrixOverlayCertified: true,
  activeOutboundMessageCodes: activeCodes,
  historicalReceiveOnlyMessageCodes: [],
  removedFieldNumbers: ['535', '536', '537', '538'],
  removedRejectionReasonCodes: ['E19'],
  removedTransactionReasonCodes: ['Z03'],
  compareMeterReadingsToEnergyVolumes: false,
  endMeterReadingBelowStartIsError: false,
  validateIndividualMeteringPointEnergyValuesBeyondE30: false,
  validateMeterAndRegisterAgainstStructuralInformation: true,
  source: {
    document: '260331_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-4',
    section: '1.8 Change log',
    effectiveFrom: '2026-10-01',
  },
}

function isoDate(value: string): string {
  const normalized = String(value ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('utilts_reference_date_invalid')
  return normalized
}

export function resolveUtiltsProcessabilityPolicy(referenceDate: string): UtiltsProcessabilityPolicy {
  const date = isoDate(referenceDate)
  if (date < UTILTS_25_A_3_POLICY.effectiveFrom) throw new Error(`utilts_guide_not_effective:${date}`)
  return date >= UTILTS_25_A_4_POLICY.effectiveFrom ? UTILTS_25_A_4_POLICY : UTILTS_25_A_3_POLICY
}

/**
 * S08 is a historical Swedish UTILTS process. The 25-A-3 guide explicitly says
 * it ceases to be used after 2026-04-14. Historical replay remains parseable,
 * but current inbound/outbound business automation must not revive it.
 */
export function assertUtiltsMessageUseAllowed(input: {
  referenceDate: string
  messageCode: string | null | undefined
  mode: UtiltsMessageUseMode
}): void {
  const date = isoDate(input.referenceDate)
  const policy = resolveUtiltsProcessabilityPolicy(date)
  const code = String(input.messageCode ?? '').trim().toUpperCase()

  if (code === 'S08') {
    if (input.mode === 'historical_replay') return
    if (date <= S08_LAST_LIVE_USE_DATE && policy.guideRevision === '25-A-3') return
    throw new Error(`utilts_s08_live_use_discontinued:${date}`)
  }

  if (input.mode === 'outbound' && !policy.activeOutboundMessageCodes.includes(code)) {
    throw new Error(`utilts_message_not_supported:${policy.guideRevision}:${code || 'missing'}`)
  }
}

export function assertUtiltsOutboundMessageAllowed(input: {
  referenceDate: string
  messageCode: string | null | undefined
}): void {
  assertUtiltsMessageUseAllowed({ ...input, mode: 'outbound' })
}

export function assertUtiltsTransactionReasonAllowed(input: {
  referenceDate: string
  reasonCode: string | null | undefined
}): void {
  const policy = resolveUtiltsProcessabilityPolicy(input.referenceDate)
  const reason = String(input.reasonCode ?? '').trim().toUpperCase()
  if (policy.removedTransactionReasonCodes.includes(reason)) {
    throw new Error(`utilts_transaction_reason_removed:${policy.guideRevision}:${reason}`)
  }
}

export function assertUtiltsRejectionReasonAllowed(input: {
  referenceDate: string
  reasonCode: string | null | undefined
}): void {
  const policy = resolveUtiltsProcessabilityPolicy(input.referenceDate)
  const reason = String(input.reasonCode ?? '').trim().toUpperCase()
  if (policy.removedRejectionReasonCodes.includes(reason)) {
    throw new Error(`utilts_rejection_reason_removed:${policy.guideRevision}:${reason}`)
  }
}
