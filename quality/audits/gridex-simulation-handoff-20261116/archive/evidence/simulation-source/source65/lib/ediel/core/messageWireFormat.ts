import { parseUna, stripUna } from './una'

/** Physical service bytes cannot be reclassified through mutable row hints. */
export function wireFormatIdentityIssue(input: { rawPayload?: string | null; messageStandard?: string | null; mimeType?: string | null }): {
  code: 'EDIEL_WIRE_FORMAT_IDENTITY_MISMATCH'; title: string; description: string
} | null {
  const raw = input.rawPayload ?? ''
  const standard = input.messageStandard?.trim().toLowerCase() ?? ''
  const xmlMime = /(?:\bxml\b|\+xml\b)/i.test(input.mimeType ?? '')
  const una = parseUna(raw)
  const physicalEdifact = stripUna(raw).trimStart().startsWith(`UNB${una.dataElementSeparator}`)
  if (physicalEdifact && (standard && standard !== 'edifact' || xmlMime) || standard === 'edifact' && xmlMime) {
    return { code: 'EDIEL_WIRE_FORMAT_IDENTITY_MISMATCH', title: 'Transportformat stämmer inte med källan',
      description: 'Fysiskt EDIFACT-kuvert kräver EDIFACT-format och förlustfri teckenkodning i hela transportkedjan.' }
  }
  return null
}
