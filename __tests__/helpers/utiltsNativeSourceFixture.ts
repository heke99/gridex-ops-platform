import { createHash } from 'node:crypto'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { segmentSourceSpan, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

/** New synthetic source setup only. Processor retries reuse the persisted row. */
export function utiltsNativeSourceFixture(raw: string, id: string) {
  const previous = parseInboundEmailContent({ attachmentText: raw })?.interchangeReference
  if (!previous || !/^[a-zA-Z0-9-]+$/.test(previous) || raw.split(previous).length !== 3) throw new Error('native_source_interchange_shape')
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('native_source_id_invalid')
  // These bounded fixtures have exactly the UNB and UNZ reference occurrences.
  // Derive both from the new source ID before parsing row metadata from the wire.
  raw = raw.replaceAll(previous, createHash('sha256').update(id).digest('hex').slice(0, 14))
  const parsed = parseInboundEmailContent({ attachmentText: raw })
  if (!parsed?.interchangeReference) throw new Error('native_source_interchange_missing')
  return { id, raw, parsed }
}

/** Test-environment interchange: stamp UNB 0031 (acknowledgement request) and
 * 0035 (test indicator). A source in environment 'test' must carry the
 * physical test indicator; inbound legal-context derivation holds it otherwise. */
export function utiltsTestEnvironmentWire(raw: string) {
  const t = tokenizeEdifact(raw), unb = t.segments.filter(segment => segment.tag === 'UNB')
  if (unb.length !== 1) throw new Error('native_source_unb_shape')
  const span = segmentSourceSpan(unb[0])
  if (!span) throw new Error('native_source_unb_shape')
  const parts = unb[0].raw.split(t.una.dataElementSeparator)
  while (parts.length < 12) parts.push('')
  parts[9] = '1'; parts[11] = '1'
  return raw.slice(0, span.startOffset) + parts.join(t.una.dataElementSeparator) + raw.slice(span.endOffset)
}
