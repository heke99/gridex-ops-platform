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

export function inspectPdfStructure(bytes: Uint8Array): PdfStructureResult {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (!/^%PDF-[12]\.\d/.test(buffer.subarray(0, 16).toString('latin1'))) return { ok: false, reason: 'header' }

  const tail = buffer.subarray(Math.max(0, buffer.length - TAIL_WINDOW)).toString('latin1')
  if (!/%%EOF\s*$/.test(tail)) return { ok: false, reason: 'eof' }

  const startxref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail)
  if (!startxref) return { ok: false, reason: 'startxref' }
  const offset = Number(startxref[1])
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= buffer.length) return { ok: false, reason: 'startxref' }
  const atXref = buffer.subarray(offset, offset + 64).toString('latin1')
  if (!/^xref\s/.test(atXref) && !/^\d+\s+\d+\s+obj\b[\s\S]*\/Type\s*\/XRef/.test(atXref + buffer.subarray(offset + 64, offset + 512).toString('latin1'))) {
    return { ok: false, reason: 'xref' }
  }

  const text = withObjectStreams(buffer)
  if (!/\/Type\s*\/Catalog\b/.test(text)) return { ok: false, reason: 'catalog' }
  if (!/\/Type\s*\/Page\b(?!s)/.test(text)) return { ok: false, reason: 'page' }
  return { ok: true }
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
