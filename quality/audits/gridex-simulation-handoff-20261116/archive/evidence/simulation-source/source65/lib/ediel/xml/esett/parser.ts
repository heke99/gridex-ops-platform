// lib/ediel/xml/esett/parser.ts
//
// Batch 9: lightweight, dependency-free eSett/NBS XML parser. It extracts the
// document type and key correlation fields. It must NEVER be used to parse EDIFACT
// (callers route by message family). For robust schema processing a proper XML
// parser/XSD validation would be added; this is sufficient for routing,
// correlation and the pre-outbox validation gate, and is Vercel-safe.

export type ParsedEsettXml = {
  isXml: boolean
  rootElement: string | null
  documentType: string | null
  mRID: string | null
  senderMarketParticipant: string | null
  receiverMarketParticipant: string | null
  correlationMRID: string | null
}

function firstTagValue(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'i')
  const m = xml.match(re)
  return m ? m[1]!.trim() : null
}

export function looksLikeEsettXml(payload: string | null | undefined): boolean {
  if (!payload) return false
  const trimmed = payload.trimStart()
  return trimmed.startsWith('<?xml') || /^<[\w.:-]+[\s>]/.test(trimmed)
}

export function parseEsettXml(payload: string | null | undefined): ParsedEsettXml {
  const empty: ParsedEsettXml = {
    isXml: false,
    rootElement: null,
    documentType: null,
    mRID: null,
    senderMarketParticipant: null,
    receiverMarketParticipant: null,
    correlationMRID: null,
  }
  if (!looksLikeEsettXml(payload)) return empty
  const xml = String(payload)

  const rootMatch = xml.match(/<(?:[\w.-]+:)?([A-Za-z][\w.-]*)[\s>]/)
  const rootElement = rootMatch ? rootMatch[1]! : null

  return {
    isXml: true,
    rootElement,
    documentType: rootElement,
    mRID: firstTagValue(xml, 'mRID'),
    senderMarketParticipant: firstTagValue(xml, 'sender_MarketParticipant.mRID') ?? firstTagValue(xml, 'sender_MarketParticipant'),
    receiverMarketParticipant: firstTagValue(xml, 'receiver_MarketParticipant.mRID') ?? firstTagValue(xml, 'receiver_MarketParticipant'),
    correlationMRID:
      firstTagValue(xml, 'received_MarketDocument.mRID') ??
      firstTagValue(xml, 'original_MarketDocument.mRID') ??
      null,
  }
}
