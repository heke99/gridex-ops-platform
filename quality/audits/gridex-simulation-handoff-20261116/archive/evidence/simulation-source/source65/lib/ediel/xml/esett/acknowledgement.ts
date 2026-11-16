// lib/ediel/xml/esett/acknowledgement.ts
//
// Batch 9: eSett/NBS XML acknowledgement handling, integrated with the shared
// AcknowledgementEngine lifecycle (family ESETT_XML_ACK). The XML ack is correlated
// to the originating intent/message via the acknowledgement document's correlation
// mRID; unmatched acks go to manual_review like every other family.

import { parseEsettXml } from '@/lib/ediel/xml/esett/parser'
import { getEsettXmlSchema } from '@/lib/ediel/xml/esett/schemaRegistry'
import { classifyAcknowledgement, type AcknowledgementClassification } from '@/lib/ediel/ack/acknowledgementEngine'

export type EsettXmlAckInput = {
  payload: string | null | undefined
  // The intent/message correlation reference (mRID) of the originating outbound.
  expectedCorrelationMRID?: string | null
  // Caller-resolved source message id (from correlation lookup); null => unmatched.
  matchedSourceMessageId?: string | null
  duplicate?: boolean
  late?: boolean
}

export type EsettXmlAckResult = AcknowledgementClassification & {
  documentType: string | null
  correlationMRID: string | null
  isAcknowledgement: boolean
}

function inferOutcome(payload: string): 'positive' | 'negative' | null {
  const lower = payload.toLowerCase()
  if (/reason\.code>\s*a0[12]/.test(lower) || lower.includes('fully accepted') || lower.includes('>accepted<')) return 'positive'
  if (lower.includes('rejected') || /reason\.code>\s*a0[2-9]/.test(lower) || lower.includes('error')) return 'negative'
  return null
}

export function classifyEsettXmlAcknowledgement(input: EsettXmlAckInput): EsettXmlAckResult {
  const parsed = parseEsettXml(input.payload)
  const schema = getEsettXmlSchema(parsed.documentType)
  const correlationMRID = parsed.correlationMRID ?? input.expectedCorrelationMRID ?? null
  const outcome = parsed.isXml ? inferOutcome(String(input.payload)) : null

  const classification = classifyAcknowledgement({
    family: 'ESETT_XML_ACK',
    outcome,
    matchedSourceMessageId: input.matchedSourceMessageId ?? null,
    duplicate: input.duplicate,
    late: input.late,
    sourceReference: correlationMRID,
  })

  return {
    ...classification,
    documentType: parsed.documentType,
    correlationMRID,
    isAcknowledgement: Boolean(schema?.isAcknowledgement),
  }
}
