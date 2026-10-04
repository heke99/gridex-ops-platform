import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { canonicalAckRequirementsForFamilyCode } from '@/lib/ediel/rulebook/canonicalEdielFacade'

/** TGT retains its preallocated references and source clock. Service positions,
 * escaping and 0031/0035 belong to the shared envelope and ACK authorities. */
export function serializeTgtUnb(input: {
  family: string; code?: string | null; sender: string; receiver: string
  senderSubAddress?: string | null; receiverSubAddress?: string | null
  applicationReference: string; interchangeReference: string; createdAt: Date
}): string {
  const raw = EdifactEnvelopeCodec.encode({
    sender: input.sender, receiver: input.receiver,
    senderSubAddress: input.senderSubAddress, receiverSubAddress: input.receiverSubAddress,
    applicationReference: input.applicationReference, interchangeReference: input.interchangeReference,
    createdAt: input.createdAt, timeZone: 'UTC', environment: 'test',
    acknowledgementRequest: canonicalAckRequirementsForFamilyCode({ family: input.family, code: input.code }).requiresContrl,
    // Only UNB is returned. Existing TGT source body/negative-case serialization
    // remains independent of this internal envelope extraction placeholder.
    messages: [{ messageReference: 'UNB-EXTRACTION', messageTypeToken: 'DUMMY:D:00A:UN', businessSegments: [] }],
  })
  const unb = EdifactEnvelopeCodec.decode(raw).segments.find(segment => segment.tag === 'UNB')
  if (!unb) throw new Error('tgt_unb_serialization_required')
  return unb.raw
}
