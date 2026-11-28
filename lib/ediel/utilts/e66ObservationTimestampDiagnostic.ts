import { segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { observeUtiltsFieldScopes } from '@/lib/ediel/utilts/fieldMatrixOccurrences'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'

type ObservationPolicy = Pick<CanonicalEdielPolicy, 'family' | 'code' | 'direction'> & {
  guide: Pick<CanonicalEdielPolicy['guide'], 'guideRevision'>
}

export const E66_SG11_TIMESTAMP_REVIEW = 'UTILTS_E66_SG11_TIMESTAMP_QUANTITY_NOT_ALLOWED'
function observationTimestamps(raw: string, messageCode: string) {
  const { una, transactions } = observeUtiltsFieldScopes(raw)
  return transactions.flatMap(transaction => transaction.messageCode !== messageCode ? [] :
    transaction.observations.flatMap(observation => {
      let quantity: string | null = null
      return observation.segments.flatMap(segment => {
        if (segment.tag === 'QTY') quantity = segmentComposite(segment, 1, una)[0] ?? null
        if (segment.tag === 'PRI' || segment.tag === 'MOA') quantity = null
        if (segment.tag !== 'DTM' || quantity === null) return []
        const [qualifier, value] = segmentComposite(segment, 1, una)
        if (qualifier !== '597') return []
        return [{
          code: E66_SG11_TIMESTAMP_REVIEW,
          transactionId: transaction.referenceNumber,
          transactionIndex: transaction.transactionIndex,
          observationIndex: observation.observationIndex,
          segmentIndex: segment.index,
          quantity,
          value,
        }]
      })
    }))
}

/** U 25-A-5 and Svk's §7.5 clarification: regular energy has no SG11
 * timestamp. Keep the original segments and exclude only QTY+136's own dates. */
export function ignoredUtiltsEnergyTimestampIndices(raw: string, policy?: ObservationPolicy): ReadonlySet<number> | undefined {
  if (policy?.family !== 'UTILTS' || policy.direction !== 'inbound' ||
    policy.guide.guideRevision !== '25-A-5' || !['E30', 'E66', 'S07'].includes(policy.code)) return undefined

  return new Set(observationTimestamps(raw, policy.code).filter(timestamp => timestamp.quantity === '136')
    .map(timestamp => timestamp.segmentIndex))
}

export function diagnoseE66ObservationTimestamp(raw: string, policy: ObservationPolicy) {
  if (policy.family !== 'UTILTS' || policy.code !== 'E66' || policy.direction !== 'inbound' ||
    policy.guide.guideRevision !== '25-A-5') return []
  return observationTimestamps(raw, 'E66').filter(timestamp => !['136', '220', '42'].includes(timestamp.quantity))
}
