// lib/ediel/xml/esett/renderer.ts
//
// Batch 9: eSett/NBS XML renderer. Produces XML from a typed model and validates
// against the schema registry BEFORE the result may be queued. It must not be
// mixed with the EDIFACT renderer. Rendering a document type that is not sendable
// (manual_review/unsupported) is refused.

import { getEsettXmlSchema, isEsettXmlSendable } from '@/lib/ediel/xml/esett/schemaRegistry'
import { validateEsettXml } from '@/lib/ediel/xml/esett/validator'

export type EsettXmlRenderModel = {
  documentType: string
  mRID: string
  createdDateTime: string
  senderMarketParticipant: string
  receiverMarketParticipant: string
  body?: Record<string, string>
}

export type EsettXmlRenderResult =
  | { ok: true; xml: string; documentType: string }
  | { ok: false; reason: string; documentType: string }

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderEsettXml(model: EsettXmlRenderModel): EsettXmlRenderResult {
  const schema = getEsettXmlSchema(model.documentType)
  if (!schema) {
    return { ok: false, reason: 'esett_xml_document_type_unsupported', documentType: model.documentType }
  }
  if (!isEsettXmlSendable(model.documentType)) {
    return { ok: false, reason: `esett_xml_not_sendable_${schema.supportStatus}`, documentType: model.documentType }
  }

  const bodyLines = Object.entries(model.body ?? {}).map(
    ([key, value]) => `  <${key}>${escapeXml(String(value))}</${key}>`,
  )

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${schema.rootElement}>`,
    `  <mRID>${escapeXml(model.mRID)}</mRID>`,
    `  <createdDateTime>${escapeXml(model.createdDateTime)}</createdDateTime>`,
    `  <sender_MarketParticipant.mRID>${escapeXml(model.senderMarketParticipant)}</sender_MarketParticipant.mRID>`,
    `  <receiver_MarketParticipant.mRID>${escapeXml(model.receiverMarketParticipant)}</receiver_MarketParticipant.mRID>`,
    ...bodyLines,
    `</${schema.rootElement}>`,
  ].join('\n')

  // Schema validation must pass before this XML may be queued to the outbox.
  const validation = validateEsettXml(xml)
  if (!validation.ok) {
    return { ok: false, reason: validation.issues[0]?.code ?? 'esett_xml_validation_failed', documentType: model.documentType }
  }

  return { ok: true, xml, documentType: model.documentType }
}
