// lib/ediel/xml/esett/schemaRegistry.ts
//
// Batch 9: eSett/NBS XML is a SEPARATE message family (ESETT_XML), not EDIFACT.
// It uses schema validation before outbox but the same tenant/route/outbox/audit/
// ACK lifecycle. This registry declares the supported XML document types and the
// required root/elements for schema validation. Unknown document types resolve to
// manual_review rather than being parsed as EDIFACT or guessed.

export type EsettXmlSupportStatus = 'full' | 'inbound_only' | 'outbound_only' | 'manual_review' | 'unsupported'

export type EsettXmlSchema = {
  documentType: string
  rootElement: string
  requiredElements: string[]
  supportStatus: EsettXmlSupportStatus
  isAcknowledgement: boolean
  note: string
}

// Conservative scaffolding. Exact XSDs come from the eSett/NBS specification; until
// a document type is explicitly modelled it is manual_review (never auto-sent).
export const ESETT_XML_SCHEMAS: EsettXmlSchema[] = [
  {
    documentType: 'AcknowledgementDocument',
    rootElement: 'AcknowledgementDocument',
    requiredElements: ['mRID', 'createdDateTime', 'receiver_MarketParticipant.mRID', 'sender_MarketParticipant.mRID'],
    supportStatus: 'inbound_only',
    isAcknowledgement: true,
    note: 'eSett/NBS acknowledgement document; parsed inbound and correlated to the originating intent.',
  },
  {
    documentType: 'ReconciliationFinancialReport',
    rootElement: 'ReconciliationFinancialReport_MarketDocument',
    requiredElements: ['mRID', 'createdDateTime', 'sender_MarketParticipant.mRID', 'receiver_MarketParticipant.mRID'],
    supportStatus: 'manual_review',
    isAcknowledgement: false,
    note: 'Not yet fully modelled; route to manual review until schema is confirmed.',
  },
]

export function getEsettXmlSchema(documentType: string | null | undefined): EsettXmlSchema | null {
  const normalized = String(documentType ?? '').trim()
  if (!normalized) return null
  return ESETT_XML_SCHEMAS.find((schema) => schema.documentType.toLowerCase() === normalized.toLowerCase()) ?? null
}

export function resolveEsettXmlSupportStatus(documentType: string | null | undefined): EsettXmlSupportStatus {
  const schema = getEsettXmlSchema(documentType)
  return schema ? schema.supportStatus : 'unsupported'
}

export function isEsettXmlSendable(documentType: string | null | undefined): boolean {
  const status = resolveEsettXmlSupportStatus(documentType)
  return status === 'full' || status === 'outbound_only'
}
