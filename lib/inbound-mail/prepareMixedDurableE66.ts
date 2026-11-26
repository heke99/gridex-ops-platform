import type { UtiltsRuntimeResult, UtiltsValidationIssue } from '@/lib/ediel/utiltsEngine'

type ScopedIssue = UtiltsValidationIssue & { referenceNumber: string }
type GuideIssue = ScopedIssue & { referenceQualifier: 'ACW'; aperakErcCode: string }
type ProcessabilityIssue = ScopedIssue & { referenceQualifier: 'TN'; utiltsErrCode: string }
type Member = { transactionId: string; transactionIndex: number }

export type MixedDurableE66Member = Member & (
  | { disposition: 'accepted'; responseType: 'positive_aperak' }
  | { disposition: 'guide_rejected'; responseType: 'negative_aperak'; issues: GuideIssue[] }
  | { disposition: 'processability_rejected'; responseType: 'utilts_err'; issues: ProcessabilityIssue[] }
)

function isGuideIssue(issue: ScopedIssue): issue is GuideIssue {
  return issue.kind === 'application' && issue.referenceQualifier === 'ACW' && Boolean(issue.aperakErcCode)
}

function isProcessabilityIssue(issue: ScopedIssue): issue is ProcessabilityIssue {
  return issue.kind === 'functional' && issue.referenceQualifier === 'TN' && Boolean(issue.utiltsErrCode)
}

export function prepareMixedDurableE66(
  runtime: UtiltsRuntimeResult,
  structuralDecisionRequired: boolean,
): MixedDurableE66Member[] | null {
  const { facts, validation, transactionDispositions, ackPlan } = runtime
  if (facts.messageCode !== 'E66' || structuralDecisionRequired || ackPlan.contrlOutcome === 'negative' ||
      ackPlan.utiltsHeaderRejection || transactionDispositions.length < 2) return null

  const physical = facts.utiltsObservedTransactions
  if (!physical || physical.length !== transactionDispositions.length ||
      facts.transactions.length !== transactionDispositions.length) return null

  const ids = new Map<string, number>()
  for (const [index, row] of transactionDispositions.entries()) {
    const id = row.transactionId
    if (!id || ids.has(id) || id !== physical[index].transactionId ||
        id !== facts.transactions[index].transactionId) return null
    ids.set(id, index)
  }

  const errors = new Map<string, ScopedIssue[]>()
  for (const issue of validation.issues) {
    if (issue.severity !== 'error') continue
    const id = issue.referenceNumber
    if (!id || !ids.has(id)) return null
    const scoped = { ...issue, referenceNumber: id }
    const existing = errors.get(id)
    if (existing) existing.push(scoped)
    else errors.set(id, [scoped])
  }

  const members: MixedDurableE66Member[] = []
  for (const [transactionId, transactionIndex] of ids) {
    const { disposition, responseType, issueCodes } = transactionDispositions[transactionIndex]
    const issues = errors.get(transactionId) ?? []
    const member = { transactionIndex, transactionId }
    if (disposition === 'accepted' && responseType === 'positive_aperak' && issues.length === 0) {
      members.push({ ...member, disposition, responseType })
      continue
    }
    if (!issues.length || issues.some(issue => !issueCodes.includes(issue.code))) return null
    if (disposition === 'guide_rejected' && responseType === 'negative_aperak' && issues.every(isGuideIssue)) {
      members.push({ ...member, disposition, responseType, issues })
    } else if (disposition === 'processability_rejected' && responseType === 'utilts_err' && issues.every(isProcessabilityIssue)) {
      members.push({ ...member, disposition, responseType, issues })
    } else {
      return null
    }
  }
  return members
}
