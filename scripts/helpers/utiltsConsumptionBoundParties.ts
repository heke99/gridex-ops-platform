import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

/** Fixture-only assertion: references and payload text are not party identities. */
export function assertUtiltsConsumptionPartiesBound(raw: string, parties: { ediel: string; issuer: string }): void {
  try {
    const wire = tokenizeEdifact(raw)
    const unb = wire.segments.filter(segment => segment.tag === 'UNB')
    const nad = wire.segments.filter(segment => segment.tag === 'NAD')
    const sender = nad.filter(segment => segmentComposite(segment, 1, wire.una)[0] === 'MS')
    const receiver = nad.filter(segment => segmentComposite(segment, 1, wire.una)[0] === 'MR')
    if (parties.ediel && parties.issuer && unb.length === 1 && sender.length === 1 && receiver.length === 1
      && segmentComposite(unb[0], 2, wire.una)[0] === parties.issuer
      && segmentComposite(unb[0], 3, wire.una)[0] === parties.ediel
      && segmentComposite(sender[0], 2, wire.una)[0] === parties.issuer
      && segmentComposite(receiver[0], 2, wire.una)[0] === parties.ediel) return
  } catch {
    // An unreadable fixture cannot prove binding either.
  }
  throw new Error('native_consumption_parties_unbound')
}
