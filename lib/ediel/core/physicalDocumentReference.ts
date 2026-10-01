import { segmentComposite, segmentUntrimmedRaw, tokenizeEdifact } from './edifactTokenizer'

/** Observe the original UTILTS document, including a physically empty BGM/1004.
 * This is source data only: national validation and protected source authority
 * decide whether a response is allowed. Metadata and technical references may
 * never substitute for an absent or ambiguous original document. */
export function readPhysicalUtiltsDocumentIdentity(rawPayload: string | null | undefined): Readonly<{
  messageCode: string
  reference: string
}> | null {
  const wire = tokenizeEdifact(rawPayload)
  const headers = wire.segments.filter(segment => segment.tag === 'UNH')
  const documents = wire.segments.filter(segment => segment.tag === 'BGM')
  if (headers.length !== 1 || documents.length !== 1) return null
  const header = { ...headers[0], raw: segmentUntrimmedRaw(headers[0]) }
  const document = { ...documents[0], raw: segmentUntrimmedRaw(documents[0]) }
  if (segmentComposite(header, 2, wire.una)[0] !== 'UTILTS' || document.index <= header.index) return null
  const headerEnd = wire.segments.find(segment => ['IDE', 'UNT', 'UNZ'].includes(segment.tag))
  if (headerEnd && document.index >= headerEnd.index) return null
  const reference = segmentComposite(document, 2, wire.una)
  if (reference.length !== 1) return null
  return Object.freeze({ messageCode: segmentComposite(document, 1, wire.una)[0], reference: reference[0] })
}
