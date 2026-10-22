// Physical EDIFACT interchanges carried by one inbound e-mail.
//
// Each physical source (the payload extracted at reception and every decoded
// attachment) is framed on its own. Joining them into one text made distinct
// sources one "interchange": two attachments merged into one payload, a cover
// letter mentioning "unzip" extended a valid file into free text, and the same
// file stored twice with a trailing newline was parsed as two copies (FINDINGS
// F3 variant; reality defects J3-01/J3-02).
import { parseUna } from '@/lib/ediel/core/una'
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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** S/MIME containers repeat the decrypted MIME; their parts are stored separately. */
function isSmimeContainer(source: InboundEdifactSource): boolean {
  const filename = typeof source.filename === 'string' ? source.filename.toLowerCase() : ''
  const mimeType = typeof source.mimeType === 'string' ? source.mimeType.toLowerCase() : ''
  return mimeType.includes('pkcs7') || filename.endsWith('.p7m') || filename.endsWith('.p7s')
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
  const una = parseUna(payload)
  const terminator = escapeRegExp(una.segmentTerminator)
  const separator = escapeRegExp(una.dataElementSeparator)
  const matches = payload.match(new RegExp(`(?:^|${terminator}|^UNA[\\s\\S]{6})\\s*UNB${separator}`, 'g'))
  return Math.max(1, matches?.length ?? 0)
}

function interchangeReference(payload: string): string | null {
  const una = parseUna(payload)
  const separator = escapeRegExp(una.dataElementSeparator)
  const terminator = escapeRegExp(una.segmentTerminator)
  const match = new RegExp(`UNB${separator}(?:[^${separator}${terminator}]*${separator}){4}([^${separator}${terminator}]*)`).exec(payload)
  return match?.[1]?.trim() || null
}

/** Selects the one physical interchange of a mail, or reports that there are several. */
export function selectInboundEdifactInterchange(sources: readonly InboundEdifactSource[]): InboundEdifactSelection {
  // Two projections of one physical file can differ in line breaks or in a
  // leading UNA; they are one interchange. The copy carrying its UNA is kept.
  const byInterchange = new Map<string, string>()
  for (const source of sources) {
    if (isSmimeContainer(source)) continue
    const payload = strictEdifactPayload(source.text)
    if (!payload) continue
    const key = (payload.startsWith('UNA') ? payload.slice(9) : payload).replace(/\s+/g, '')
    const current = byInterchange.get(key)
    if (!current || (!current.startsWith('UNA') && payload.startsWith('UNA'))) byInterchange.set(key, payload)
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
  const una = parseUna(payload)
  const separator = escapeRegExp(una.dataElementSeparator)
  const terminator = escapeRegExp(una.segmentTerminator)
  const unb = new RegExp(`UNB${separator}([^${terminator}]*)`).exec(payload)?.[1]
  if (unb === undefined) return null
  // Element positions after the tag: 0001/0002, sender, receiver, date/time, 0020, password, 0026, 0029, 0031, 0032, 0035.
  const elements = unb.split(new RegExp(`(?<!${escapeRegExp(una.releaseCharacter)})${separator}`))
  const indicator = (elements[10] ?? '').trim()
  return indicator === '' || indicator === '1' ? indicator : null
}
