import { createHash } from 'node:crypto'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'

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
