import { parseEdifact } from '@/lib/ediel/core/edifactParser'
import { serializeUna } from '@/lib/ediel/core/una'

export function canonicalizeEdifact(rawPayload: string | null | undefined): string {
  const parsed = parseEdifact(rawPayload)
  const segments = parsed.segments.map((segment) => segment.raw.replace(/\s+/g, ' ').trim()).filter(Boolean)
  return `${serializeUna(parsed.una)}${segments.map((segment) => `${segment}${parsed.una.segmentTerminator}`).join('')}`
}

export function edifactPayloadHashInput(rawPayload: string | null | undefined): string {
  return canonicalizeEdifact(rawPayload).toUpperCase()
}
