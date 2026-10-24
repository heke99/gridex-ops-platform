// Physical EDIFACT interchanges carried by one inbound e-mail.
//
// Each physical source (the payload extracted at reception and every decoded
// attachment) is framed on its own. Joining them into one text made distinct
// sources one "interchange": two attachments merged into one payload, a cover
// letter mentioning "unzip" extended a valid file into free text, and the same
// file stored twice with a trailing newline was parsed as two copies (FINDINGS
// F3 variant; reality defects J3-01/J3-02).
import { inspectMimeStructure, mimeParameter } from '@/lib/inbound-mail/mimeStructure'
import { binaryToBuffer, decodeTextBytes } from '@/lib/inbound-mail/mimeCharset'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { extractEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'

export type InboundEdifactSource = {
  text: unknown
  filename?: unknown
  mimeType?: unknown
}

export type InboundEdifactSelection =
  | { kind: 'none'; payloads: [] ; interchangeCount: 0 }
  | { kind: 'single'; payload: string; payloads: [string]; interchangeCount: 1 }
  | { kind: 'multiple'; payloads: string[]; interchangeCount: number; interchangeReferences: Array<string | null> }


/** Inventory MIME parts before selecting any parsed projection. Storage may
 * retain only a prefix of the decoded parts, so labels are never completeness
 * evidence. Reuse MAIN's bounded byte-preserving traversal and charset decoder.
 */
function physicalTexts(input: unknown): string[] {
  if (typeof input !== 'string' || !input) return []
  const text = input.replace(/^\uFEFF/, '')
  if (/^[\t \r\n]*(?:UNA[\s\S]{6}[\t \r\n]*UNB|UNB\+)/.test(text)) return [input]
  const separator = text.search(/\r?\n\r?\n/)
  const header = separator < 0 ? '' : text.slice(0, separator)
  // A plain EDIFACT field can contain ':' and blank lines; it is not MIME.
  if (!/^(?:content-type|mime-version|content-transfer-encoding|from|to|subject|message-id):/im.test(header)) return [input]
  const mime = inspectMimeStructure(text, { preserveBytes: true })
  if (mime.exceededLimits || mime.issues.length || mime.entities.some(entity => entity.mediaType.startsWith('message/'))) {
    throw new Error('edifact_mime_source_inventory_required')
  }
  const representedChildren = new Map<number, number>()
  for (const entity of mime.entities) {
    if (entity.parent !== null) representedChildren.set(entity.parent, (representedChildren.get(entity.parent) ?? 0) + 1)
  }
  for (const entity of mime.entities.filter(entity => entity.mediaType.startsWith('multipart/'))) {
    const boundary = mimeParameter(entity.contentType, 'boundary')
    if (!boundary) throw new Error('edifact_mime_source_inventory_required')
    const open = '--' + boundary, close = open + '--'
    let expectedChildren = 0, start = 0
    while (start < entity.body.length) {
      const newline = entity.body.indexOf('\n', start)
      const end = newline < 0 ? entity.body.length : newline
      const marker = entity.body.slice(start, end).replace(/\r$/, '').replace(/[ \t]+$/, '')
      if (marker === close) break
      if (marker === open) expectedChildren += 1
      if (newline < 0) break
      start = newline + 1
    }
    if (expectedChildren !== (representedChildren.get(entity.index) ?? 0)) throw new Error('edifact_mime_source_inventory_required')
  }
  return mime.entities.filter(entity => !entity.mediaType.startsWith('multipart/')).map(entity => {
    const encoding = (entity.headers.get('content-transfer-encoding')?.[0] ?? '').toLowerCase()
    // Transfer encodings have already been decoded once by inspectMimeStructure.
    // Unencoded stored JS text is already characters, exactly as MAIN's poller.
    return encoding === 'base64' || encoding === 'quoted-printable'
      ? decodeTextBytes(binaryToBuffer(entity.body), mimeParameter(entity.contentType, 'charset'))
      : entity.body
  })
}

/**
 * Service segments are upper case and start a line, the text or follow a
 * segment terminator. A case-insensitive substring match ("unable", "Kunz",
 * base64 text) is not the start of an interchange.
 */
export function strictEdifactPayload(input: unknown): string | null {
  if (typeof input !== 'string' || !input) return null
  // A UTF-8 BOM decoded as ISO-8859-1 (UNOC) is "ï»¿".
  const start = /(?:^|[\r\n'﻿]|ï»¿|[\t ](?=UN[AB]))[\t ]*(UNA[\s\S]{6}|UNB[^A-Za-z0-9\s])/.exec(input)
  if (!start) return null
  const offset = start.index + start[0].length - start[1].length
  return extractEdifactPayload(input.slice(offset))
}

/** Number of UNB service segments at a segment boundary of the payload's own UNA. */
export function countInterchanges(payload: string): number {
  return Math.max(1, tokenizeEdifact(payload).segments.filter(segment => segment.tag === 'UNB').length)
}

function interchangeReference(payload: string): string | null {
  return tokenizeEdifact(payload).segments.find(segment => segment.tag === 'UNB')?.elements[5]?.trim() || null
}

/** Selects the one physical interchange of a mail, or reports that there are several. */
export function selectInboundEdifactInterchange(sources: readonly InboundEdifactSource[]): InboundEdifactSelection {
  // Deduplicate only identical framed payloads. The extractor already removes
  // outer BOM/newline framing; whitespace inside data and UNA remain significant.
  const byInterchange = new Map<string, string>()
  for (const source of sources) {
    for (const text of physicalTexts(source.text)) {
      const payload = strictEdifactPayload(text)
      if (payload) byInterchange.set(payload, payload)
    }
  }
  const payloads = [...byInterchange.values()]
  if (payloads.length === 0) return { kind: 'none', payloads: [], interchangeCount: 0 }
  const interchangeCount = payloads.reduce((sum, payload) => sum + countInterchanges(payload), 0)
  if (payloads.length === 1 && interchangeCount === 1) return { kind: 'single', payload: payloads[0], payloads: [payloads[0]], interchangeCount: 1 }
  return { kind: 'multiple', payloads, interchangeCount, interchangeReferences: payloads.map(interchangeReference) }
}

/** UNB/0035 of a parsed interchange: '1' test, '' production (omitted), null unreadable. */
export function unbTestIndicator(payload: string | null | undefined): '' | '1' | null {
  if (!payload) return null
  try {
    const unb = tokenizeEdifact(payload).segments.find((segment) => segment.tag === 'UNB')
    if (!unb) return null
    // elements[0] is the tag; UNB/0035 is the eleventh data element.
    const indicator = (unb.elements[11] ?? '').trim()
    return indicator === '' || indicator === '1' ? indicator : null
  } catch {
    return null
  }
}
