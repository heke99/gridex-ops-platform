import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { fieldRulesForMessage } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { UtiltsValidationIssue } from '@/lib/ediel/utiltsEngine.part-1'
import { localEdifactDateTimeToUtc, parseEdifactTimezoneOffsetFromSegments } from '@/lib/ediel/utilts/timezone'

/** Single source of physical message-header guide findings, also used to
 * qualify header-level ACK serialization. An IDE can never supply a header. */
export function resolveUtiltsHeaderGuideIssues(
  message: Pick<EdielMessageRow, 'raw_payload' | 'message_received_at' | 'created_at'>,
  messageCode: string | null,
): UtiltsValidationIssue[] {
  const rules = fieldRulesForMessage('UTILTS', messageCode)
  const parsed = tokenizeEdifact(message.raw_payload)
  const start = parsed.segments.findIndex(segment => segment.tag === 'UNH')
  const end = parsed.segments.findIndex((segment, index) => index > start && (segment.tag === 'IDE' || segment.tag === 'UNT'))
  const wire = { ...parsed, segments: parsed.segments.slice(Math.max(start, 0), end < 0 ? undefined : end) }
  const nadIssues: UtiltsValidationIssue[] = []
  const ancillaryRoles = new Set(['DDK', 'DDQ', 'DDX', 'DEA', 'DEC', 'DER', 'DGG', 'DGI', 'EZ', 'MDR', 'PQ'])
  for (const segment of wire.segments) {
    if (segment.tag === 'IDE' || segment.tag === 'UNT') break
    if (segment.tag !== 'NAD') continue
    const role = segmentComposite(segment, 1, wire.una)[0]?.trim() ?? ''
    if (role !== 'MS' && role !== 'MR') {
      if (!ancillaryRoles.has(role)) nadIssues.push({
        severity: 'error', kind: 'application',
        code: role ? 'UTILTS_ANCILLARY_ROLE_INVALID' : 'UTILTS_ANCILLARY_ROLE_MISSING',
        title: role ? 'Ogiltig underordnad roll' : 'Underordnad roll saknas',
        description: role ? `SG2/NAD/3035 har otillåtet värde ${role}.` : 'SG2/NAD/3035 saknas.',
        aperakErcCode: role ? '42' : '41', aperakFieldCode: '509',
        aperakText: role ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
      })
      continue
    }
    const field = role === 'MS' ? '207' : '208'
    const parts = segmentComposite(segment, 2, wire.una)
    const partyId = parts[0]?.trim() ?? ''
    const qualifier = parts[1]?.trim() ?? ''
    const agency = parts[2]?.trim() ?? ''
    const badAgency = !['260', '9', '305'].includes(agency)
    const badQualifier = agency === '260' && qualifier !== 'SVK'
    if (badAgency || badQualifier) {
      const missing = badAgency ? !agency : !qualifier
      const path = badAgency ? 'C082/3055' : 'C082/1131'
      nadIssues.push({
        severity: 'error', kind: 'application',
        code: badAgency ? (missing ? 'UTILTS_NAD_AGENCY_MISSING' : 'UTILTS_NAD_AGENCY_INVALID')
          : (missing ? 'UTILTS_NAD_QUALIFIER_MISSING' : 'UTILTS_NAD_QUALIFIER_INVALID'),
        title: missing ? 'NAD-kod saknas' : 'Ogiltig NAD-kod',
        description: `NAD+${role}/${path} ${missing ? 'saknas' : 'har otillåtet värde'}.`,
        aperakErcCode: missing ? '41' : '42', aperakFieldCode: field,
        aperakText: missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
      })
    }
    if (qualifier === 'SVK' && !/^\d{5}$/.test(partyId)) {
      const missing = !partyId
      nadIssues.push({
        severity: 'error', kind: 'application',
        code: missing ? 'UTILTS_NAD_EDIEL_ID_MISSING' : 'UTILTS_NAD_EDIEL_ID_INVALID',
        title: missing ? 'Ediel-id saknas' : 'Ogiltigt Ediel-id',
        description: `NAD+${role}/C082/3039 ska vara fem siffror när 1131=SVK.`,
        aperakErcCode: missing ? '41' : '42', aperakFieldCode: field,
        aperakText: missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
      })
    }
    // UG-122-24: agencies 9/305 identify GS1 parties. Their GLN is 13
    // digits, including the final modulo-10 check digit. Keep this separate
    // from the five-digit national Ediel-id under qualifier SVK.
    if (['9', '305'].includes(agency) && (!/^\d{13}$/.test(partyId) ||
      [...partyId].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0) % 10 !== 0)) {
      const missing = !partyId
      nadIssues.push({
        severity: 'error', kind: 'application',
        code: missing ? 'UTILTS_NAD_GS1_ID_MISSING' : 'UTILTS_NAD_GS1_CHECK_DIGIT_INVALID',
        title: missing ? 'GS1-id saknas' : 'Ogiltigt GS1-id',
        description: `NAD+${role}/C082/3039 ska vara ett GLN med giltig GS1-kontrollsiffra.`,
        aperakErcCode: missing ? '41' : '42', aperakFieldCode: field,
        aperakText: missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
      })
    }
  }
  const market = wire.segments.find(segment => segment.tag === 'MKS')
  const mksIssues = (['501', '502'] as const).flatMap(fieldNumber => {
    const rule = rules.find(item => item.fieldNumber === fieldNumber)
    if (!rule?.allowedValues?.length) return []
    const composite = market ? segmentComposite(market, fieldNumber === '501' ? 1 : 2, wire.una) : []
    const value = composite[0]?.trim() ?? null
    const allowed = Boolean(value && rule.allowedValues.includes(value))
    // 25-A-3 annex C UG-122-21 qualifies phase 502 with agency 260.
    const agency = fieldNumber === '502' ? composite[2]?.trim() : null
    const invalidAgency = fieldNumber === '502' && allowed && agency !== '260'
    if (allowed && !invalidAgency) return []
    const missing = !value || (invalidAgency && !agency)
    const path = invalidAgency ? 'MKS/C332/3055' : rule.segmentPath
    return [{
      severity: 'error' as const, kind: 'application' as const,
      code: invalidAgency ? (missing ? 'UTILTS_PHASE_AGENCY_MISSING' : 'UTILTS_PHASE_AGENCY_INVALID')
        : missing ? rule.errorCodeIfMissing ?? 'MKS_MISSING' : rule.errorCodeIfInvalid ?? 'UTILTS_PHASE_INVALID',
      title: invalidAgency ? (missing ? 'Byråkod för skede saknas' : 'Ogiltig byråkod för skede')
        : missing ? `${rule.label} saknas` : `Ogiltigt ${rule.label}`,
      description: missing ? `${path} saknas.` : `${path} har otillåtet värde ${invalidAgency ? agency : value}.`,
      aperakErcCode: missing ? '41' : '42',
      aperakFieldCode: fieldNumber,
      aperakText: missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
    }]
  })
  const ackRule = rules.find(item => item.fieldNumber === '313')
  const bgm = wire.segments.find(segment => segment.tag === 'BGM')
  const documentCodeRule = rules.find(item => item.fieldNumber === '202')
  const documentParts = bgm ? segmentComposite(bgm, 1, wire.una) : []
  const documentCode = documentParts[0]?.trim() ?? ''
  const documentQualifier = documentParts[1]?.trim() ?? ''
  const documentQualifierIssues = /^S0[1-7]$/.test(documentCode) && documentQualifier !== 'SVK'
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: documentQualifier ? 'UTILTS_DOCUMENT_QUALIFIER_INVALID' : 'UTILTS_DOCUMENT_QUALIFIER_MISSING',
      title: documentQualifier ? 'Ogiltig dokumentkodlistequalifierare' : 'Dokumentkodlistequalifierare saknas',
      description: documentQualifier ? `BGM/C002/1131 har otillåtet värde ${documentQualifier}.` : 'BGM/C002/1131 saknas.',
      aperakErcCode: documentQualifier ? '42' : '41',
      aperakFieldCode: '202',
      aperakText: documentQualifier ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
    }] : []
  const documentAgency = bgm ? segmentComposite(bgm, 1, wire.una)[2]?.trim() : null
  const documentAgencyIssues = bgm && documentCodeRule?.requirement === 'required' && documentAgency !== '260'
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: documentAgency ? 'UTILTS_DOCUMENT_AGENCY_INVALID' : 'UTILTS_DOCUMENT_AGENCY_MISSING',
      title: documentAgency ? 'Ogiltig byråkod för dokumenttyp' : 'Byråkod för dokumenttyp saknas',
      description: documentAgency ? `BGM/C002/3055 har otillåtet värde ${documentAgency}.` : 'BGM/C002/3055 saknas.',
      aperakErcCode: documentAgency ? '42' : '41',
      aperakFieldCode: '202',
      aperakText: documentAgency ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
    }] : []
  const documentRule = rules.find(item => item.fieldNumber === '203')
  const documentIdentifier = bgm ? segmentComposite(bgm, 2, wire.una)[0]?.trim() : null
  const documentIssues = documentRule?.requirement === 'required' && !documentIdentifier
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: documentRule.errorCodeIfMissing ?? 'UTILTS_DOCUMENT_IDENTIFIER_MISSING',
      title: 'Dokumentnummer saknas',
      description: 'BGM/C106/1004 saknas.',
      aperakErcCode: '41',
      aperakFieldCode: '203',
      aperakText: 'MANDATORY FIELD MISSING',
    }] : []
  const functionRule = rules.find(item => item.fieldNumber === '204')
  const functionCode = bgm ? segmentComposite(bgm, 3, wire.una)[0]?.trim() : null
  const functionIssues = functionRule?.allowedValues?.length && (!functionCode || !functionRule.allowedValues.includes(functionCode))
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: functionCode ? functionRule.errorCodeIfInvalid ?? 'UTILTS_MESSAGE_FUNCTION_INVALID' : functionRule.errorCodeIfMissing ?? 'UTILTS_MESSAGE_FUNCTION_MISSING',
      title: functionCode ? 'Ogiltig meddelandefunktion' : 'Meddelandefunktion saknas',
      description: functionCode ? `BGM/1225 har otillåtet värde ${functionCode}.` : 'BGM/1225 saknas.',
      aperakErcCode: functionCode ? '42' : '41',
      aperakFieldCode: '204',
      aperakText: functionCode ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
    }] : []
  const request = bgm ? segmentComposite(bgm, 4, wire.una)[0]?.trim() : null
  const ackIssues = ackRule?.allowedValues?.length && (!request || !ackRule.allowedValues.includes(request))
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: request ? ackRule.errorCodeIfInvalid ?? 'UTILTS_ACK_REQUEST_INVALID' : ackRule.errorCodeIfMissing ?? 'UTILTS_ACK_REQUEST_MISSING',
      title: request ? 'Ogiltig kvittensbegäran' : 'Kvittensbegäran saknas',
      description: request ? `BGM/4343 har otillåtet värde ${request}.` : 'BGM/4343 saknas.',
      aperakErcCode: request ? '42' : '41',
      aperakFieldCode: '313',
      aperakText: request ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
    }] : []
  const timezoneRule = rules.find(item => item.fieldNumber === '206')
  const timezoneSegment = wire.segments.find(segment => segment.tag === 'DTM' && segmentComposite(segment, 1, wire.una)[0] === '735')
  const timezoneParts = timezoneSegment ? segmentComposite(timezoneSegment, 1, wire.una) : []
  const timezoneValue = timezoneParts[1]?.trim() ?? ''
  const timezone = parseEdifactTimezoneOffsetFromSegments(timezoneSegment ? [`DTM+${timezoneParts.join(':')}`] : [])
  const timezoneValid = Boolean(timezone)
  const timezoneIssues = timezoneRule?.requirement === 'required' && !timezoneValid
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: timezoneValue ? 'UTILTS_TIMEZONE_INVALID' : 'UTILTS_TIMEZONE_MISSING',
      title: timezoneValue ? 'Ogiltig tidzon' : 'Tidzon saknas',
      description: timezoneValue ? 'DTM+735 måste ha giltig UTC-offset och format 406.' : 'DTM+735/C507/2380 saknas.',
      aperakErcCode: timezoneValue ? '42' : '41',
      aperakFieldCode: '206',
      aperakText: timezoneValue ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
    }] : []
  const dateRule = rules.find(item => item.fieldNumber === '205')
  const dateSegment = wire.segments.find(segment => segment.tag === 'DTM' && segmentComposite(segment, 1, wire.una)[0] === '137')
  const dateParts = dateSegment ? segmentComposite(dateSegment, 1, wire.una) : []
  const dateValue = dateParts[1]?.trim() ?? ''
  const dateFormat = dateParts[2]?.trim() ?? ''
  const localDate = /^\d{12}$/.test(dateValue)
    ? `${dateValue.slice(0, 4)}-${dateValue.slice(4, 6)}-${dateValue.slice(6, 8)}T${dateValue.slice(8, 10)}:${dateValue.slice(10, 12)}:00`
    : null
  const dateInstant = localDate ? localEdifactDateTimeToUtc(localDate, timezone ?? { raw: '+0000', offsetMinutes: 0, format: '406' }) : null
  const receivedAt = Date.parse(message.message_received_at ?? message.created_at ?? '')
  const futureDate = Boolean(dateInstant && timezone && Number.isFinite(receivedAt) && Date.parse(dateInstant) > receivedAt)
  const dateInvalid = Boolean(dateValue && (dateFormat !== '203' || !dateInstant || futureDate))
  const dateIssues = dateRule?.requirement === 'required' && (!dateValue || dateInvalid)
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: !dateValue ? 'UTILTS_MESSAGE_DATE_MISSING' : 'UTILTS_MESSAGE_DATE_INVALID',
      title: !dateValue ? 'Meddelandedatum saknas' : 'Ogiltigt meddelandedatum',
      description: !dateValue ? 'DTM+137/C507/2380 saknas.' : 'DTM+137 måste vara ett giltigt, icke framtida datum i format 203.',
      aperakErcCode: !dateValue ? '41' : '42',
      aperakFieldCode: '205',
      aperakText: !dateValue ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
    }] : []
  const issues = [...nadIssues, ...mksIssues, ...documentQualifierIssues, ...documentAgencyIssues, ...documentIssues, ...functionIssues, ...ackIssues, ...timezoneIssues, ...dateIssues]
  return issues
}
