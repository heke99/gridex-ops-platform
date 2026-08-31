import type { EdielMessageRow } from '@/lib/ediel/types'
import { resolveUtiltsProcessabilityPolicy } from '@/lib/ediel/rulebook/utilts25A4'
import { resolutionFormatNeedsLegacyCountCorrection } from '@/lib/ediel/utilts/resolution'
import {
  decideUtiltsRuntimeAckPlan,
  resolveUtiltsTransactionDispositions,
  runUtiltsRuntimeForMessage as runLegacyUtiltsRuntimeForMessage,
  type UtiltsRuntimeResult,
  type UtiltsRuntimeValidation,
  type UtiltsValidationIssue,
} from '@/lib/ediel/utiltsEngine.part-1'

export * from '@/lib/ediel/utiltsEngine.part-1'

export type UtiltsRuntimeReferenceOptions = {
  referenceDate?: string | Date | null
}

function normalizedReferenceDate(
  message: EdielMessageRow,
  options?: UtiltsRuntimeReferenceOptions,
): string {
  const explicit = options?.referenceDate
  if (explicit instanceof Date) {
    if (Number.isNaN(explicit.getTime())) throw new Error('utilts_reference_date_invalid')
    return explicit.toISOString().slice(0, 10)
  }
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().slice(0, 10)

  const receivedAt = String(message.message_received_at ?? '').trim()
  if (receivedAt) return receivedAt.slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}

function rebuildValidation(issues: UtiltsValidationIssue[]): UtiltsRuntimeValidation {
  const syntaxOk = !issues.some((issue) => issue.severity === 'error' && issue.kind === 'syntax')
  const hasApplicationErrors = issues.some(
    (issue) => issue.severity === 'error' && issue.kind === 'application',
  )
  const hasFunctionalErrors = issues.some(
    (issue) => issue.severity === 'error' && issue.kind === 'functional',
  )
  const classification: UtiltsRuntimeValidation['classification'] = !syntaxOk
    ? 'syntax_rejected'
    : hasApplicationErrors
      ? 'application_rejected'
      : hasFunctionalErrors
        ? 'functional_rejected'
        : 'accepted'

  return {
    ok: classification === 'accepted',
    syntaxOk,
    functionalOk: !hasFunctionalErrors,
    issues,
    classification,
  }
}

function rebuildRuntimeResult(input: {
  message: EdielMessageRow
  result: UtiltsRuntimeResult
  issues: UtiltsValidationIssue[]
}): UtiltsRuntimeResult {
  if (input.issues.length === input.result.validation.issues.length) return input.result
  const validation = rebuildValidation(input.issues)
  const transactionDispositions = resolveUtiltsTransactionDispositions({
    syntaxOk: validation.syntaxOk,
    transactions: input.result.facts.transactions,
    issues: validation.issues,
  })
  const ackPlan = decideUtiltsRuntimeAckPlan({
    message: input.message,
    facts: input.result.facts,
    validation,
  })
  return { ...input.result, validation, transactionDispositions, ackPlan }
}

export function applyUtiltsResolutionFormatPolicyToRuntimeResult(input: {
  message: EdielMessageRow
  result: UtiltsRuntimeResult
}): UtiltsRuntimeResult {
  const issues = input.result.validation.issues.filter((issue) => {
    if (issue.code !== 'UTILTS_DST_INTERVAL_COUNT_MISMATCH') return true
    const reference = String(issue.referenceNumber ?? issue.lineItemReference ?? '').trim()
    const transaction = input.result.facts.transactions.find((entry) =>
      reference ? String(entry.transactionId ?? '').trim() === reference : false,
    ) ?? (input.result.facts.transactions.length === 1 ? input.result.facts.transactions[0] : null)

    // The legacy interval validator treated DTM+354's numeric value as minutes
    // regardless of EDIFACT 2379. For calendar/hour/second formats this creates
    // a false DST/interval-count rejection. Minute format 806 remains governed
    // by the existing strict count check.
    return !resolutionFormatNeedsLegacyCountCorrection(transaction?.resolutionFormat)
  })

  return rebuildRuntimeResult({ message: input.message, result: input.result, issues })
}

export function applyUtiltsEffectiveDatePolicyToRuntimeResult(input: {
  message: EdielMessageRow
  result: UtiltsRuntimeResult
  referenceDate: string
}): UtiltsRuntimeResult {
  const policy = resolveUtiltsProcessabilityPolicy(input.referenceDate)
  if (policy.guideRevision === '25-A-3') return input.result

  const removedRejectionCodes = new Set(
    policy.removedRejectionReasonCodes.map((code) => code.toUpperCase()),
  )
  const issues = input.result.validation.issues.filter((issue) => {
    const utiltsErrCode = String(issue.utiltsErrCode ?? '').trim().toUpperCase()
    if (utiltsErrCode && removedRejectionCodes.has(utiltsErrCode)) return false
    if (
      !policy.compareMeterReadingsToEnergyVolumes &&
      issue.code === 'UTILTS_E66_METER_READING_ENERGY_MISMATCH'
    ) {
      return false
    }
    return true
  })

  return rebuildRuntimeResult({ message: input.message, result: input.result, issues })
}

export function runUtiltsRuntimeForMessage(
  message: EdielMessageRow,
  options?: UtiltsRuntimeReferenceOptions,
): UtiltsRuntimeResult {
  const referenceDate = normalizedReferenceDate(message, options)
  const legacyResult = runLegacyUtiltsRuntimeForMessage(message)
  const resolutionCorrected = applyUtiltsResolutionFormatPolicyToRuntimeResult({
    message,
    result: legacyResult,
  })
  return applyUtiltsEffectiveDatePolicyToRuntimeResult({
    message,
    result: resolutionCorrected,
    referenceDate,
  })
}
