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
  // Rewrite only the UNB segment bytes; surrounding line layout is preserved.
  const segment = raw.slice(span.startOffset, span.endOffset), lead = segment.match(/^\s*/)![0], body = segment.slice(lead.length)
  const terminator = body.endsWith(t.una.segmentTerminator) ? t.una.segmentTerminator : ''
  const parts = body.slice(0, body.length - terminator.length).split(t.una.dataElementSeparator)
  while (parts.length < 12) parts.push('')
  parts[9] = '1'; parts[11] = '1'
  return raw.slice(0, span.startOffset) + lead + parts.join(t.una.dataElementSeparator) + terminator + raw.slice(span.endOffset)
}

/** Recompute UNT/0074 from the actual UNH..UNT segment count. Fixture edits
 * insert or remove segments; the count is a mechanical envelope fact. */
export function utiltsRecountUnt(raw: string) {
  const t = tokenizeEdifact(raw), unh = t.segments.findIndex(s => s.tag === 'UNH'), untIndex = t.segments.findIndex(s => s.tag === 'UNT')
  if (unh < 0 || untIndex < unh || t.segments.filter(s => s.tag === 'UNT').length !== 1) return raw
  const unt = t.segments[untIndex], span = segmentSourceSpan(unt)
  if (!span) return raw
  const segment = raw.slice(span.startOffset, span.endOffset), lead = segment.match(/^\s*/)![0], body = segment.slice(lead.length)
  const terminator = body.endsWith(t.una.segmentTerminator) ? t.una.segmentTerminator : ''
  const parts = body.slice(0, body.length - terminator.length).split(t.una.dataElementSeparator)
  parts[1] = String(untIndex - unh + 1)
  return raw.slice(0, span.startOffset) + lead + parts.join(t.una.dataElementSeparator) + terminator + raw.slice(span.endOffset)
}
