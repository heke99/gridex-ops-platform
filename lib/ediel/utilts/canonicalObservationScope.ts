import { segmentComposite, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

export type CanonicalUtiltsQuantity = {
  raw: string
  segmentIndex: number
  qualifier: string | null
  value: string | null
  components: string[]
}

export type CanonicalUtiltsReference = CanonicalUtiltsQuantity & {
  /** Physical initial SG8 DTM/RFF window, not a validity or authority decision. */
  directReferenceSlot: boolean
}

export type CanonicalUtiltsObservation = {
  messageIndex: number
  transactionIndex: number
  observationIndex: number
  segmentIndex: number
  observationId: string | null
  sequenceComponents: string[]
  segments: EdifactTokenizedSegment[]
  references: CanonicalUtiltsReference[]
  quantities: CanonicalUtiltsQuantity[]
}

export type CanonicalUtiltsTransaction = {
  messageIndex: number
  transactionIndex: number
  segmentIndex: number
  transactionId: string | null
  identityQualifier: string | null
  identityComponents: string[]
  segments: EdifactTokenizedSegment[]
  observations: CanonicalUtiltsObservation[]
}

/** Empty is observable absence; spaces, case and punctuation are source data. */
function observedScalar(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value
}

function observedComposite(segment: EdifactTokenizedSegment, una: EdifactServiceStringAdvice): CanonicalUtiltsQuantity {
  const components = segmentComposite(segment, 1, una)
  return {
    raw: segment.raw,
    segmentIndex: segment.index,
    qualifier: observedScalar(components[0]),
    value: observedScalar(components[1]),
    components,
  }
}

/**
 * Project one actual UTILTS message's physical IDE/SEQ occurrences in one pass.
 * The caller supplies its existing tokenized message slice and service advice.
 * Tokens stay original; duplicates and malformed identities are not repaired.
 * This is observed input, not grammar acceptance, inherited meter identity,
 * expected register inventory, a guide decision or permission to persist/send.
 */
export function canonicalUtiltsTransactions(
  segments: readonly EdifactTokenizedSegment[],
  una: EdifactServiceStringAdvice,
  messageIndex: number,
): CanonicalUtiltsTransaction[] {
  const transactions: CanonicalUtiltsTransaction[] = []
  let transaction: CanonicalUtiltsTransaction | null = null
  let observation: CanonicalUtiltsObservation | null = null
  let directReferenceSlot = false

  for (const [position, segment] of segments.entries()) {
    // Legacy message slices end at the next UNH. Do not change those other
    // projections, but never adopt trailer/interchange content into this one.
    if (['UNT', 'UNZ', 'UNB'].includes(segment.tag) || (segment.tag === 'UNH' && position > 0)) break
    if (segment.tag === 'UNH') continue

    if (segment.tag === 'IDE') {
      const identityComponents = segmentComposite(segment, 2, una)
      transaction = {
        messageIndex,
        transactionIndex: transactions.length,
        segmentIndex: segment.index,
        transactionId: observedScalar(identityComponents[0]),
        identityQualifier: observedScalar(segmentComposite(segment, 1, una)[0]),
        identityComponents,
        segments: [segment],
        observations: [],
      }
      transactions.push(transaction)
      observation = null
      directReferenceSlot = false
      continue
    }

    // Orphan observations remain in the original AST segments, never attached
    // to a later transaction or supplied with a synthetic transaction identity.
    if (!transaction) continue
    transaction.segments.push(segment)

    if (segment.tag === 'SEQ') {
      const sequenceComponents = segmentComposite(segment, 2, una)
      observation = {
        messageIndex,
        transactionIndex: transaction.transactionIndex,
        observationIndex: transaction.observations.length,
        segmentIndex: segment.index,
        observationId: observedScalar(sequenceComponents[0]),
        sequenceComponents,
        segments: [segment],
        references: [],
        quantities: [],
      }
      transaction.observations.push(observation)
      directReferenceSlot = true
      continue
    }

    if (!observation) continue
    observation.segments.push(segment)
    if (segment.tag === 'RFF') {
      observation.references.push({ ...observedComposite(segment, una), directReferenceSlot })
    } else if (segment.tag === 'QTY') {
      observation.quantities.push(observedComposite(segment, una))
    }
    // Once a nested/other segment begins, a later RFF is still raw evidence but
    // cannot masquerade as the observation's initial meter/register reference.
    if (segment.tag !== 'DTM' && segment.tag !== 'RFF') directReferenceSlot = false
  }

  return transactions
}
