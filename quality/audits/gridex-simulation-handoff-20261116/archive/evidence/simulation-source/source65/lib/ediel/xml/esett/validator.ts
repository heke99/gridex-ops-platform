// lib/ediel/xml/esett/validator.ts
//
// Batch 9: eSett/NBS XML schema validation that must run BEFORE the message is
// queued to ediel_outbox. Unsupported/unknown document types are routed to
// manual_review (never auto-sent). Well-formedness is checked dependency-free.

import { getEsettXmlSchema, resolveEsettXmlSupportStatus } from '@/lib/ediel/xml/esett/schemaRegistry'
import { parseEsettXml } from '@/lib/ediel/xml/esett/parser'

export type EsettXmlValidationIssue = { code: string; message: string; severity: 'block' | 'warning' }

export type EsettXmlValidationResult = {
  ok: boolean
  documentType: string | null
  supportStatus: string
  manualReview: boolean
  issues: EsettXmlValidationIssue[]
}

function isWellFormedish(xml: string): boolean {
  // Dependency-free balance check on the root element. Robust XSD validation is a
  // follow-up; this gate prevents obviously malformed payloads from being queued.
  const rootMatch = xml.match(/<(?:[\w.-]+:)?([A-Za-z][\w.-]*)[\s>]/)
  if (!rootMatch) return false
  const root = rootMatch[1]!
  const close = new RegExp(`</(?:[\\w.-]+:)?${root}>\\s*$`)
  return close.test(xml.trimEnd())
}

export function validateEsettXml(payload: string | null | undefined): EsettXmlValidationResult {
  const issues: EsettXmlValidationIssue[] = []
  const parsed = parseEsettXml(payload)

  if (!parsed.isXml) {
    return {
      ok: false,
      documentType: null,
      supportStatus: 'unsupported',
      manualReview: true,
      issues: [{ code: 'not_xml', message: 'Payload är inte XML och kan inte hanteras som eSett/NBS XML.', severity: 'block' }],
    }
  }

  if (!isWellFormedish(String(payload))) {
    issues.push({ code: 'xml_not_well_formed', message: 'XML-rotelementet är inte korrekt stängt.', severity: 'block' })
  }

  const supportStatus = resolveEsettXmlSupportStatus(parsed.documentType)
  const schema = getEsettXmlSchema(parsed.documentType)
  const manualReview = supportStatus === 'manual_review' || supportStatus === 'unsupported'

  if (!schema) {
    issues.push({
      code: 'esett_xml_document_type_unsupported',
      message: `eSett XML-dokumenttyp ${parsed.documentType ?? 'okänd'} stöds inte och går till manuell granskning.`,
      severity: 'block',
    })
  } else {
    for (const element of schema.requiredElements) {
      const re = new RegExp(`<(?:[\\w.-]+:)?${element.replace(/[.]/g, '\\.')}[\\s>]`, 'i')
      if (!re.test(String(payload))) {
        issues.push({ code: 'esett_xml_missing_required_element', message: `Obligatoriskt element saknas: ${element}.`, severity: 'block' })
      }
    }
  }

  return {
    ok: issues.filter((i) => i.severity === 'block').length === 0,
    documentType: parsed.documentType,
    supportStatus,
    manualReview,
    issues,
  }
}
