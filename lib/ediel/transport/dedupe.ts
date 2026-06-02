import { createHash } from 'crypto'
import { edifactPayloadHashInput } from '@/lib/ediel/core/canonicalizeEdifact'
import {
  buildInboundCanonicalIdentity,
  findInboundDuplicateByCanonicalIdentity,
  findOutboundEdielMessageDuplicate,
} from '@/lib/ediel/core/dedupe'

export function rawPayloadHash(rawPayload: string | null | undefined): string {
  return createHash('sha256').update(edifactPayloadHashInput(rawPayload)).digest('hex')
}

export {
  buildInboundCanonicalIdentity,
  findInboundDuplicateByCanonicalIdentity,
  findOutboundEdielMessageDuplicate,
}
