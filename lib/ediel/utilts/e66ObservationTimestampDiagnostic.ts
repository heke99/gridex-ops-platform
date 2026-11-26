import { segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { observeUtiltsFieldScopes } from '@/lib/ediel/utilts/fieldMatrixOccurrences'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'

type ObservationPolicy = Pick<CanonicalEdielPolicy, 'family' | 'code' | 'direction'> & {
  guide: Pick<CanonicalEdielPolicy['guide'], 'guideRevision'>
}

export const E66_SG11_TIMESTAMP_REVIEW = 'UTILTS_E66_SG11_TIMESTAMP_QUANTITY_NOT_ALLOWED'
function e66ObservationTimestamps(raw: string) {
  const { una, transactions } = observeUtiltsFieldScopes(raw)
  return transactions.flatMap(transaction => transaction.messageCode !== 'E66' ? [] :
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

export function usesE66SuperfluousEnergyTimestampPolicy(policy?: ObservationPolicy): boolean {
  return policy?.family === 'UTILTS' && policy.code === 'E66' && policy.direction === 'inbound' &&
    policy.guide.guideRevision === '25-A-5'
}

/** U 25-A-5 p94 and Svk's §7.5 clarification: a QTY+136 timestamp has no
 * semantic effect. Identify the physical segment without rewriting the source. */
export function superfluousE66EnergyTimestampIndices(raw: string): ReadonlySet<number> {
  return new Set(e66ObservationTimestamps(raw).filter(timestamp => timestamp.quantity === '136')
    .map(timestamp => timestamp.segmentIndex))
}

export function diagnoseE66ObservationTimestamp(raw: string, policy: ObservationPolicy) {
  if (!usesE66SuperfluousEnergyTimestampPolicy(policy)) return []
  return e66ObservationTimestamps(raw).filter(timestamp => !['136', '220', '42'].includes(timestamp.quantity))
}
