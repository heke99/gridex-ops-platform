// lib/ediel/rulebook/messageParser.ts

import { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { parseInboundUtilts } from '@/lib/ediel/utilts'
import { getBusinessProcessForMessage } from '@/lib/ediel/rulebook/rulebook'

export type CanonicalRulebookParsedMessage = {
  family: string
  messageCode: string | null
  subtype: string | null
  sender: string | null
  receiver: string | null
  applicationReference: string | null
  interchangeReference: string | null
  messageReference: string | null
  transactionReference: string | null
  caseReference: string | null
  facilityId: string | null
  meteringPointId: string | null
  customerIdentifier: string | null
  permissionId: string | null
  period: string | null
  businessProcess: string
  errors: string[]
  warnings: string[]
  rawSegments: string[]
}

export function parseRulebookMessage(rawPayload: string): CanonicalRulebookParsedMessage {
  const facts = parseEdifactMessageFacts(rawPayload)
  const family = String(facts.messageType ?? '').toUpperCase()
  const code = String(facts.messageCode ?? '').toUpperCase() || null
  const rawSegments = rawPayload
    .split("'")
    .map((item) => item.trim())
    .filter(Boolean)

  if (family === 'PRODAT') {
    const parsed = parseProdatMessage(rawPayload)
    const first = parsed.lineItems[0]
    return {
      family,
      messageCode: parsed.messageCode,
      subtype: first?.reasonForTransaction ?? null,
      sender: parsed.senderEdielId ?? (facts.senderComposite?.split(':')[0]?.trim() || null),
      receiver: parsed.receiverEdielId ?? (facts.receiverComposite?.split(':')[0]?.trim() || null),
      applicationReference: parsed.applicationReference ?? (facts.unb?.elements[7]?.trim() || null),
      interchangeReference: parsed.interchangeReference ?? facts.interchangeReference,
      messageReference: parsed.messageReference,
      transactionReference: parsed.transactionReference ?? first?.lineItemReference ?? null,
      caseReference: first?.lineItemReference ?? null,
      facilityId: first?.meteringPointId ?? null,
      meteringPointId: first?.meteringPointId ?? null,
      customerIdentifier: first?.customerId ?? null,
      permissionId: first?.permissionId ?? null,
      period: first?.contractStartDate ?? null,
      businessProcess: getBusinessProcessForMessage({ family, code: parsed.messageCode }),
      errors: [],
      warnings: [],
      rawSegments,
    }
  }

  if (family === 'UTILTS') {
    const parsed = parseInboundUtilts(rawPayload)
    return {
      family,
      messageCode: String(parsed.messageCode ?? code ?? '') || null,
      subtype: String(parsed.messageCode ?? code ?? '') || null,
      sender: parsed.senderEdielId ?? null,
      receiver: parsed.receiverEdielId ?? null,
      applicationReference: parsed.applicationReference ?? null,
      interchangeReference: facts.interchangeReference ?? null,
      messageReference: parsed.externalReference ?? facts.messageReference ?? null,
      transactionReference: parsed.transactionReference ?? null,
      caseReference: parsed.transactionReference ?? null,
      facilityId: typeof parsed.parsedPayload.meteringPointId === 'string' ? parsed.parsedPayload.meteringPointId : null,
      meteringPointId: typeof parsed.parsedPayload.meteringPointId === 'string' ? parsed.parsedPayload.meteringPointId : null,
      customerIdentifier: null,
      permissionId: null,
      period: typeof parsed.parsedPayload.periodStart === 'string' ? parsed.parsedPayload.periodStart : null,
      businessProcess: 'meter_values',
      errors: [],
      warnings: [],
      rawSegments,
    }
  }

  return {
    family: family || 'UNKNOWN',
    messageCode: code,
    subtype: code,
    sender: facts.senderComposite?.split(':')[0]?.trim() || null,
    receiver: facts.receiverComposite?.split(':')[0]?.trim() || null,
    applicationReference: facts.unb?.elements[7]?.trim() || null,
    interchangeReference: facts.interchangeReference ?? null,
    messageReference: facts.messageReference ?? null,
    transactionReference: null,
    caseReference: null,
    facilityId: null,
    meteringPointId: null,
    customerIdentifier: null,
    permissionId: null,
    period: null,
    businessProcess: getBusinessProcessForMessage({ family, code }),
    errors: [],
    warnings: [],
    rawSegments,
  }
}
