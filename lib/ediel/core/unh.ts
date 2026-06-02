import { splitComposite, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

export type ParsedUnh = {
  messageReference: string | null
  messageType: string | null
  version: string | null
  release: string | null
  controllingAgency: string | null
  associationAssignedCode: string | null
  messageTypeToken: string | null
}

export function parseUnh(segment: EdifactTokenizedSegment | null | undefined, una: EdifactServiceStringAdvice): ParsedUnh | null {
  if (!segment || segment.tag !== 'UNH') return null
  const token = segment.elements[2] ?? ''
  const parts = splitComposite(token, una)

  return {
    messageReference: segment.elements[1] || null,
    messageType: parts[0] || null,
    version: parts[1] || null,
    release: parts[2] || null,
    controllingAgency: parts[3] || null,
    associationAssignedCode: parts[4] || null,
    messageTypeToken: token || null,
  }
}

export function serializeUnh(input: { messageReference: string; messageTypeToken: string }): string {
  return `UNH+${input.messageReference}+${input.messageTypeToken}`
}
