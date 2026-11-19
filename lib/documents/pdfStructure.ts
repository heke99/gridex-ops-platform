/**
 * Conservative structural PDF check (F26). Checks the header, cross-reference
 * at `startxref`, catalog and at least one page within an inspection budget.
 */
import { inflateSync } from 'node:zlib'

export type PdfStructureResult =
  | { ok: true }
  | { ok: false; reason: 'header' | 'eof' | 'startxref' | 'xref' | 'catalog' | 'page' }

const TAIL_WINDOW = 2048
/** Readers accept up to 1024 bytes before `%PDF-` (PDF 32000-1, Annex H). */
const MAX_LEADING_BYTES = 1024
/** Bytes tolerated after the last `%%EOF` (padding, transport garbage). */
const MAX_TRAILING_BYTES = 1024
const MAX_OBJECT_STREAM_HEADERS = 64
const MAX_OBJECT_STREAM_HEADER_BYTES = 4 * 1024
const MAX_INFLATED_STREAM_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_INFLATED_BYTES = 16 * 1024 * 1024
const catalogMarker = /\/Type\s*\/Catalog\b/
const pageMarker = /\/Type\s*\/Page\b(?!s)/

export function inspectPdfStructure(bytes: Uint8Array): PdfStructureResult {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerAt = buffer.subarray(0, MAX_LEADING_BYTES + 5).indexOf('%PDF-', 0, 'latin1')
  if (headerAt < 0 || !/^%PDF-[12]\.\d/.test(buffer.subarray(headerAt, headerAt + 16).toString('latin1'))) {
    return { ok: false, reason: 'header' }
  }

  // The last %%EOF wins (incremental updates append revisions), and at most
  // MAX_TRAILING_BYTES may follow it.
  const tailStart = Math.max(headerAt, buffer.length - TAIL_WINDOW - MAX_TRAILING_BYTES)
  const tail = buffer.subarray(tailStart).toString('latin1')
  const eofAt = tail.lastIndexOf('%%EOF')
  if (eofAt < 0 || tail.length - (eofAt + 5) > MAX_TRAILING_BYTES) return { ok: false, reason: 'eof' }

  const startxref = /startxref\s+(\d+)\s*$/.exec(tail.slice(0, eofAt))
  if (!startxref) return { ok: false, reason: 'startxref' }
  const declared = Number(startxref[1])
  if (!Number.isSafeInteger(declared) || declared <= 0) return { ok: false, reason: 'startxref' }
  // Offsets are relative to the header when leading bytes precede it; accept
  // the absolute interpretation too, as many writers produce that.
  const candidates = headerAt > 0 ? [declared + headerAt, declared] : [declared]
  const xrefOk = candidates.some((offset) => offset < buffer.length && xrefAt(buffer, offset))
  if (!candidates.some((offset) => offset < buffer.length)) return { ok: false, reason: 'startxref' }
  if (!xrefOk) return { ok: false, reason: 'xref' }

  const { catalog, page } = findDocumentObjects(buffer)
  if (!catalog) return { ok: false, reason: 'catalog' }
  if (!page) return { ok: false, reason: 'page' }
  return { ok: true }
}

function xrefAt(buffer: Buffer, offset: number): boolean {
  const head = buffer.subarray(offset, offset + 64).toString('latin1')
  if (/^xref\s/.test(head)) return true
  return /^\d+\s+\d+\s+obj\b[\s\S]*\/Type\s*\/XRef/.test(head + buffer.subarray(offset + 64, offset + 512).toString('latin1'))
}

function findDocumentObjects(buffer: Buffer) {
  const text = buffer.toString('latin1')
  let catalog = catalogMarker.test(text)
  let page = pageMarker.test(text)
  const headers = /\/Type\s*\/ObjStm\b/g
  let remaining = MAX_TOTAL_INFLATED_BYTES

  for (let inspected = 0; inspected < MAX_OBJECT_STREAM_HEADERS && remaining > 0 && !(catalog && page); inspected += 1) {
    if (!headers.exec(text)) break
    const headerStart = headers.lastIndex
    const header = text.slice(headerStart, headerStart + MAX_OBJECT_STREAM_HEADER_BYTES)
    const opening = /\bstream\r?\n/.exec(header)
    if (!opening) continue
    const start = headerStart + opening.index + opening[0].length
    const end = text.indexOf('endstream', start)
    if (end < 0) break

    // Advance past this stream so its raw bytes are searched at most once.
    headers.lastIndex = end + 'endstream'.length
    const maxOutputLength = Math.min(remaining, MAX_INFLATED_STREAM_BYTES)
    try {
      const inflated = inflateSync(buffer.subarray(start, end), { maxOutputLength })
      remaining -= inflated.length
      const objects = inflated.toString('latin1')
      catalog ||= catalogMarker.test(objects)
      page ||= pageMarker.test(objects)
    } catch {
      // Failed inflation can still consume the entire attempt's output budget.
      remaining -= maxOutputLength
    }
  }
  return { catalog, page }
}
