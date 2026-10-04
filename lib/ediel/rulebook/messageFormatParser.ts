import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { parseUna, stripUna } from '@/lib/ediel/core/una'
import { parseRulebookListPayload, parseRulebookMessage, type ParsedRulebookMessage } from './messageParser'

type WireFormat = 'edifact' | 'xml' | 'ai_list'
const edifactFamilies = new Set(['PRODAT', 'UTILTS', 'UTILTS_ERR', 'CONTRL', 'APERAK', 'DELFOR', 'QUOTES', 'MSCONS'])

function expectedFormat(family?: string | null): WireFormat | null {
  const value = family?.trim().toUpperCase()
  return value && edifactFamilies.has(value) ? 'edifact' : value === 'NBS_XML' ? 'xml'
    : value === 'AI_LIST' || value === 'BI_LIST' ? 'ai_list' : null
}

function empty(raw: string): ParsedRulebookMessage {
  return {family:'UNKNOWN',code:null,subtype:null,sender:null,receiver:null,senderSubAddress:null,receiverSubAddress:null,
    applicationReference:null,interchangeReference:null,messageReference:null,transactionReference:null,relatedReference:null,
    facilityId:null,meteringPointId:null,permissionId:null,period:null,outcome:null,processGroup:'unknown',rawSegments:[raw],
    facts:{},errors:[],warnings:[]}
}

function parseXml(raw: string): ParsedRulebookMessage {
  const result = empty(raw)
  result.family = 'NBS_XML'
  // This parser proves XML syntax only. The existing NBS/eSett schema and
  // activation gates remain responsible for support and permission to send.
  if (new TextEncoder().encode(raw).length > 16 * 1024 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw)
      || XMLValidator.validate(raw) !== true) return {...result,errors:['ediel_xml_syntax_invalid']}
  try {
    const document: unknown = new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,
      processEntities:false,htmlEntities:false,maxNestedTags:32}).parse(raw)
    const roots = document && typeof document === 'object' && !Array.isArray(document)
      ? Object.keys(document).filter(key => !key.startsWith('?') && !key.startsWith('#')) : []
    if (roots.length !== 1) return {...result,errors:['ediel_xml_root_invalid']}
    return {...result,code:roots[0],facts:{root:roots[0],xmlParserScope:'syntax_only'},warnings:['XML-schema och dokumentstöd kontrolleras av NBS/eSett-ägaren.']}
  } catch { return {...result,errors:['ediel_xml_syntax_invalid']} }
}

/** Select the parser from physical format bytes. Literal service characters in
 * XML/CSV data never select EDIFACT, and a row family cannot hide its envelope.
 * A declared but malformed family is assessed by its own parser, not retried
 * with another format after failure. */
export function parseRulebookWirePayload(input: {rawPayload: string; family?: string | null}): ParsedRulebookMessage {
  const raw = input.rawPayload.trimStart(), declared = expectedFormat(input.family)
  const una = parseUna(raw), body = stripUna(raw).trimStart()
  const physical: WireFormat | null = raw.startsWith('UNA') || ['UNB','UNH'].some(tag => body.startsWith(`${tag}${una.dataElementSeparator}`))
    ? 'edifact' : raw.startsWith('<') ? 'xml' : /^(?:AI|BI);/.test(raw) ? 'ai_list' : null
  const format = physical ?? declared
  const parsed = format === 'edifact' ? parseRulebookMessage(input.rawPayload)
    : format === 'xml' ? parseXml(input.rawPayload)
      : format === 'ai_list' ? parseRulebookListPayload(input.rawPayload)
        : {...empty(input.rawPayload),errors:['ediel_wire_format_unrecognized']}
  if (physical && declared && physical !== declared) return {...parsed,errors:[...parsed.errors,'EDIEL_WIRE_FORMAT_IDENTITY_MISMATCH']}
  return parsed
}
