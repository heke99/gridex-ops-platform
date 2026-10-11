/**
 * Conservative structural PDF check (F26). It proves the bytes are a readable
 * PDF document — header, cross-reference reachable from `startxref`, a
 * document catalog and at least one page — not that any signature is genuine.
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

  const text = withObjectStreams(buffer)
  if (!/\/Type\s*\/Catalog\b/.test(text)) return { ok: false, reason: 'catalog' }
  if (!/\/Type\s*\/Page\b(?!s)/.test(text)) return { ok: false, reason: 'page' }
  return { ok: true }
}

function xrefAt(buffer: Buffer, offset: number): boolean {
  const head = buffer.subarray(offset, offset + 64).toString('latin1')
  if (/^xref\s/.test(head)) return true
  return /^\d+\s+\d+\s+obj\b[\s\S]*\/Type\s*\/XRef/.test(head + buffer.subarray(offset + 64, offset + 512).toString('latin1'))
}

/** Adds inflated object streams so compressed catalogs/pages are visible. */
function withObjectStreams(buffer: Buffer): string {
  let text = buffer.toString('latin1')
  if (!/\/Type\s*\/ObjStm\b/.test(text)) return text
  const streams = /\/Type\s*\/ObjStm\b[^]*?stream\r?\n/g
  let match: RegExpExecArray | null
  const inflated: string[] = []
  while ((match = streams.exec(text)) && inflated.length < 64) {
    const start = match.index + match[0].length
    const end = text.indexOf('endstream', start)
    if (end < 0) break
    try {
      inflated.push(inflateSync(buffer.subarray(start, end)).toString('latin1'))
    } catch {
      // Not Flate or truncated: leave it out; the page/catalog check then fails closed.
    }
  }
  text += inflated.join('\n')
  return text
}
