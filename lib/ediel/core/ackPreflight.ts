// lib/ediel/core/ackPreflight.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { canonicalUtiltsTransactions } from '@/lib/ediel/utilts/canonicalObservationScope'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'

export type EdielAckPreflightIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export type EdielAckPreflightResult = {
  ok: boolean
  issues: EdielAckPreflightIssue[]
  summary: string
}

function payload(message: EdielMessageRow): string {
  // Preserve original data/case; compare only the source-defined codes below.
  return String(message.raw_payload ?? '')
}

function allSegments(raw: string) {
  return tokenizeEdifact(raw).segments
}

function containsSegment(raw: string, tag: string): boolean {
  return allSegments(raw).some(segment => segment.tag === tag)
}

function segmentOccurrences(raw: string, tag: string): number {
  return allSegments(raw).filter(segment => segment.tag === tag).length
}

function hasComposite(raw: string, tag: string, element: number, expected: readonly string[], prefix = false): boolean {
  const wire = tokenizeEdifact(raw)
  return wire.segments.some(segment => segment.tag === tag && (() => {
    const parts = segmentComposite(segment, element, wire.una)
    return expected.every((value, index) => parts[index] === value)
      && (prefix || parts.slice(expected.length).every(value => !value))
  })())
}

function sourceLooksLikeE66QuarterOrHourly(sourceMessage: EdielMessageRow): boolean {
  if (sourceMessage.message_family !== 'UTILTS') return false
  if (String(sourceMessage.message_code ?? '').toUpperCase() !== 'E66') return false
  const raw = String(sourceMessage.raw_payload ?? '')
  return String(sourceMessage.application_reference ?? '').toUpperCase().includes('E66-T')
    || hasComposite(raw, 'DTM', 1, ['354', '15', '806'])
    || hasComposite(raw, 'DTM', 1, ['354', '60', '806'])
    || hasComposite(raw, 'QTY', 1, ['87'], true)
    || hasComposite(raw, 'QTY', 1, ['136'], true)
}

function sourceHasMissingOrInvalidRegistrationTime(sourceMessage: EdielMessageRow, ackMessage: EdielMessageRow): boolean {
  if (!sourceLooksLikeE66QuarterOrHourly(sourceMessage)) return false
  const wire = tokenizeEdifact(sourceMessage.raw_payload), ack = tokenizeEdifact(ackMessage.raw_payload)
  const requested = ack.segments.filter(segment => segment.tag === 'RFF' && segmentComposite(segment, 1, ack.una)[0] === 'ACW')
    .map(segment => segmentComposite(segment, 1, ack.una)[1])
  const ownTransactions = canonicalUtiltsTransactions(wire.segments, wire.una, 0)
    .filter(transaction => !requested.length || requested.includes(transaction.transactionId ?? ''))
  return ownTransactions.some(transaction => {
    const firstSequence = transaction.segments.findIndex(segment => segment.tag === 'SEQ')
    const header = firstSequence < 0 ? transaction.segments : transaction.segments.slice(0, firstSequence)
    const dates = header.filter(segment => segment.tag === 'DTM' && segmentComposite(segment, 1, wire.una)[0] === '597')
    return dates.length !== 1 || dates.some(segment => {
      const parts = segmentComposite(segment, 1, wire.una)
      return parts[2] === '203' ? !/^\d{12}$/.test(parts[1] ?? '')
        : parts[2] === '204' ? !/^\d{14}$/.test(parts[1] ?? '') : true
    })
  })
}

function isUtiltsS03Err(raw: string, sourceMessage: EdielMessageRow): boolean {
  return sourceMessage.message_family === 'UTILTS'
    && String(sourceMessage.message_code ?? '').toUpperCase() === 'S03'
    && hasComposite(raw, 'BGM', 1, ['ERR', 'SVK', '260'])
}

function firstSegment(raw: string, tag: string) {
  return allSegments(raw).find(segment => segment.tag === tag) ?? null
}

function isUtiltsContext(ackMessage: EdielMessageRow, sourceMessage: EdielMessageRow): boolean {
  return (
    sourceMessage.message_family === 'UTILTS' ||
    sourceMessage.message_family === 'UTILTS_ERR' ||
    ackMessage.message_family === 'UTILTS_ERR' ||
    String(ackMessage.message_version ?? '').toUpperCase() === 'E5SE5A' ||
    String(sourceMessage.application_reference ?? ackMessage.application_reference ?? '').toUpperCase().startsWith('23-DDQ-S')
  )
}

function validateNoProdatSubaddressForUtilts(params: {
  ackMessage: EdielMessageRow
  sourceMessage: EdielMessageRow
}): EdielAckPreflightIssue[] {
  if (!isUtiltsContext(params.ackMessage, params.sourceMessage)) return []

  const rawPayload = payload(params.ackMessage)
  const wire = tokenizeEdifact(rawPayload)
  if (!wire.segments.some(segment => segment.tag === 'UNB' && [2, 3].some(index => {
    const party = segmentComposite(segment, index, wire.una)
    return party[1] === 'ZZ' && party[2] === 'PRODAT'
  }))) return []

  return [
    issue(
      'error',
      'utilts_prodat_subaddress_blocked',
      'UTILTS/UTILTS-APERAK/UTILTS-ERR får inte skickas med PRODAT-subadress i UNB.'
    ),
  ]
}

function parseAckOutcome(message: EdielMessageRow): string | null {
  const parsed = message.parsed_payload as { ackOutcome?: unknown } | null
  const parsedOutcome = typeof parsed?.ackOutcome === 'string' ? parsed.ackOutcome : null
  return parsedOutcome ?? (typeof message.ack_outcome === 'string' ? message.ack_outcome : null)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function nestedRecord(source: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  return asRecord(source?.[key])
}

function utiltsRuntimeSyntaxOk(message: EdielMessageRow): boolean | null {
  if (message.message_family !== 'UTILTS') return null

  const report = asRecord(message.validation_report)
  const utiltsRuntime = nestedRecord(report, 'utiltsRuntime')
  const validation = nestedRecord(utiltsRuntime, 'validation')
  const ackPlan = nestedRecord(utiltsRuntime, 'ackPlan')

  if (typeof validation?.syntaxOk === 'boolean') {
    return validation.syntaxOk
  }

  if (ackPlan?.contrlOutcome === 'positive') {
    return true
  }

  if (ackPlan?.contrlOutcome === 'negative') {
    return false
  }

  return null
}

function sourceSyntaxAccepted(message: EdielMessageRow): boolean {
  const utiltsSyntaxOk = utiltsRuntimeSyntaxOk(message)
  if (utiltsSyntaxOk !== null) return utiltsSyntaxOk

  return validateEdifactSyntax(message).ok
}

function issue(severity: EdielAckPreflightIssue['severity'], code: string, message: string): EdielAckPreflightIssue {
  return { severity, code, message }
}

function validateContrlPreflight(params: {
  ackMessage: EdielMessageRow
  sourceMessage: EdielMessageRow
}): EdielAckPreflightIssue[] {
  const { ackMessage, sourceMessage } = params
  const raw = String(ackMessage.raw_payload ?? '')
  const rawPayload = raw
  const issues: EdielAckPreflightIssue[] = []
  const outcome = parseAckOutcome(ackMessage) ?? 'positive'

  if (sourceMessage.message_family === 'CONTRL') {
    issues.push(issue('error', 'contrl_on_contrl_blocked', 'CONTRL får aldrig skickas som kvittens på inkommande CONTRL.'))
  }

  if (!containsSegment(rawPayload, 'UCI')) {
    issues.push(issue('error', 'contrl_missing_uci', 'CONTRL-preview saknar UCI-segment.'))
  }

  for (const forbiddenTag of ['BGM', 'RFF', 'ERC', 'FTX']) {
    if (containsSegment(rawPayload, forbiddenTag)) {
      issues.push(issue('error', `contrl_forbidden_${forbiddenTag.toLowerCase()}`, `CONTRL får inte innehålla ${forbiddenTag}; det hör till APERAK/andra meddelanden.`))
    }
  }

  const uci = firstSegment(raw, 'UCI')
  if (uci) {
    const actionCode = segmentComposite(uci, 4, tokenizeEdifact(raw).una)[0] ?? null
    const expected = outcome === 'negative' ? '4' : '1'
    if (actionCode !== expected) {
      issues.push(issue('error', 'contrl_uci_action_code_mismatch', `UCI action code är ${actionCode ?? 'saknas'}, men ${expected} krävs för ${outcome} CONTRL.`))
    }
  }

  const sourceSyntaxOk = sourceSyntaxAccepted(sourceMessage)
  if (outcome === 'positive' && !sourceSyntaxOk) {
    issues.push(issue('error', 'positive_contrl_on_syntax_error', 'Positiv CONTRL får inte skickas när källmeddelandet har syntaxfel.'))
  }

  if (outcome === 'negative' && sourceSyntaxOk) {
    issues.push(issue('warning', 'negative_contrl_on_syntax_ok', 'Källmeddelandet ser syntaktiskt OK ut; kontrollera manuellt innan negativ CONTRL skickas.'))
  }

  issues.push(...validateNoProdatSubaddressForUtilts({ ackMessage, sourceMessage }))

  return issues
}

function validateAperakPreflight(params: {
  ackMessage: EdielMessageRow
  sourceMessage: EdielMessageRow
}): EdielAckPreflightIssue[] {
  const { ackMessage, sourceMessage } = params
  const rawPayload = payload(ackMessage)
  const issues: EdielAckPreflightIssue[] = []
  const outcome = parseAckOutcome(ackMessage) ?? 'positive'
  const sourceSyntaxOk = sourceSyntaxAccepted(sourceMessage)

  if (sourceMessage.message_family === 'CONTRL') {
    issues.push(issue('error', 'aperak_on_contrl_blocked', 'APERAK får aldrig skickas som kvittens på inkommande CONTRL.'))
  }

  if (sourceMessage.message_family === 'APERAK') {
    issues.push(issue('error', 'aperak_on_aperak_blocked', 'APERAK får aldrig skickas som kvittens på inkommande APERAK. Endast CONTRL kan skickas på APERAK.'))
  }

  if (!sourceSyntaxOk) {
    issues.push(issue('error', 'aperak_blocked_by_syntax_error', 'APERAK får inte skickas innan syntaxen är accepterad. Skicka negativ CONTRL vid syntaxfel.'))
  }

  if (!containsSegment(rawPayload, 'BGM')) {
    issues.push(issue('error', 'aperak_missing_bgm', 'APERAK-preview saknar BGM-segment.'))
  }

  if (!containsSegment(rawPayload, 'RFF')) {
    issues.push(issue('error', 'aperak_missing_reference', 'APERAK-preview saknar referenssegment.'))
  }

  if (!containsSegment(rawPayload, 'ERC')) {
    issues.push(issue('error', 'aperak_missing_erc', 'APERAK-preview saknar ERC-segment.'))
  }

  if (!containsSegment(rawPayload, 'FTX')) {
    issues.push(issue('error', 'aperak_missing_ftx', 'APERAK-preview saknar FTX-segment.'))
  }

  if (outcome === 'positive') {
    if (!hasComposite(rawPayload, 'ERC', 1, ['100'], true)) {
      issues.push(issue('error', 'positive_aperak_missing_100', 'Positiv APERAK ska innehålla ERC+100.'))
    }
  } else if (outcome === 'negative') {
    if (hasComposite(rawPayload, 'ERC', 1, ['100'], true)) {
      issues.push(issue('error', 'negative_aperak_contains_100', 'Negativ APERAK får inte innehålla ERC+100/OK.'))
    }

    if (sourceMessage.message_family === 'UTILTS' && (hasComposite(rawPayload, 'ERC', 1, ['40', '', '260']) || hasComposite(rawPayload, 'FTX', 3, ['40', '', '260']))) {
      issues.push(issue('error', 'utilts_negative_aperak_generic_erc40_blocked', 'Negativ UTILTS-APERAK får inte använda generisk ERC/FTX 40. Kör UTILTS runtime och skicka specifik APERAK-kod, t.ex. ERC 41 + FTX 512 för saknad registreringstidpunkt.'))
    }

    if (sourceHasMissingOrInvalidRegistrationTime(sourceMessage, ackMessage)) {
      if (!hasComposite(rawPayload, 'ERC', 1, ['41', '', '260'])) {
        issues.push(issue('error', 'utilts_e66_missing_registration_time_requires_erc41', 'UTILTS E66-T med saknad/ogiltig registreringstidpunkt ska besvaras med ERC+41::260.'))
      }

      if (!(() => {
        const wire = tokenizeEdifact(rawPayload)
        return wire.segments.some(segment => segment.tag === 'FTX'
          && JSON.stringify(segmentComposite(segment, 3, wire.una)) === JSON.stringify(['512', '', '260'])
          && segmentComposite(segment, 4, wire.una)[0] === 'MANDATORY FIELD MISSING')
      })()) {
        issues.push(issue('error', 'utilts_e66_missing_registration_time_requires_ftx512', 'UTILTS E66-T med saknad/ogiltig registreringstidpunkt ska besvaras med FTX+AAO++512::260+MANDATORY FIELD MISSING.'))
      }
    }
  }

  if (sourceMessage.message_family === 'UTILTS' && (() => {
    const wire = tokenizeEdifact(rawPayload)
    return wire.segments.some(segment => segment.tag === 'DOC' && (() => {
      const parts = segmentComposite(segment, 1, wire.una)
      return /^S0[1234]$/.test(parts[0] ?? '') && !parts[1] && parts[2] === '260'
    })())
  })()) {
    issues.push(issue('error', 'utilts_aperak_doc_missing_svk', 'UTILTS-APERAK DOC måste ha kodlistekvalificerare SVK:260.'))
  }

  issues.push(...validateNoProdatSubaddressForUtilts({ ackMessage, sourceMessage }))

  return issues
}

function validateUtiltsErrPreflight(params: {
  ackMessage: EdielMessageRow
  sourceMessage: EdielMessageRow
}): EdielAckPreflightIssue[] {
  const { ackMessage, sourceMessage } = params
  const rawPayload = payload(ackMessage)
  const issues: EdielAckPreflightIssue[] = []
  const sourceSyntaxOk = sourceSyntaxAccepted(sourceMessage)

  if (sourceMessage.message_family === 'CONTRL' || sourceMessage.message_family === 'APERAK') {
    issues.push(issue('error', 'utilts_err_on_ack_blocked', 'UTILTS-ERR får inte skickas på inkommande kvittensmeddelanden.'))
  }

  if (!sourceSyntaxOk) {
    issues.push(issue('error', 'utilts_err_blocked_by_syntax_error', 'UTILTS-ERR får inte skickas när källmeddelandet har syntaxfel; negativ CONTRL ska skickas först.'))
  }

  if (!containsSegment(rawPayload, 'BGM')) {
    issues.push(issue('error', 'utilts_err_missing_bgm', 'UTILTS-ERR-preview saknar BGM-segment.'))
  }

  if (!hasComposite(rawPayload, 'UNH', 2, ['UTILTS', 'D', '02B', 'UN', 'E5SE5A'])) {
    issues.push(issue('error', 'utilts_err_wrong_unh', 'UTILTS-ERR ska använda UNH+1+UTILTS:D:02B:UN:E5SE5A.'))
  }

  if (!hasComposite(rawPayload, 'BGM', 1, ['ERR', 'SVK', '260'])) {
    issues.push(issue('error', 'utilts_err_wrong_bgm', 'UTILTS-ERR ska använda BGM+ERR:SVK:260.'))
  }

  if (!(() => {
    const wire = tokenizeEdifact(rawPayload)
    return wire.segments.some(segment => segment.tag === 'STS'
      && JSON.stringify(segmentComposite(segment, 1, wire.una)) === JSON.stringify(['E01', '', '260'])
      && segmentComposite(segment, 2, wire.una)[0] === '41'
      && /^E[0-9A-Z]+$/.test(segmentComposite(segment, 3, wire.una)[0] ?? '')
      && segmentComposite(segment, 3, wire.una)[2] === '260')
  })()) {
    issues.push(issue('error', 'utilts_err_missing_sts_e01', 'UTILTS-ERR saknar STS+E01::260+41+<felkod>::260.'))
  }

  for (const singleton of ['UNB', 'UNH', 'BGM', 'UNT', 'UNZ']) {
    if (segmentOccurrences(rawPayload, singleton) !== 1) {
      issues.push(issue('error', `utilts_err_${singleton.toLowerCase()}_count`, `UTILTS-ERR ska innehålla exakt ett ${singleton}-segment.`))
    }
  }

  if (isUtiltsS03Err(rawPayload, sourceMessage)) {
    const segments = allSegments(String(ackMessage.raw_payload ?? ''))
    const una = tokenizeEdifact(ackMessage.raw_payload).una
    const sg5HasValuedDdk = segments.some(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, una)[0] === 'DDK' && Boolean(segmentComposite(segment, 2, una)[0]))
    const sg5HasValuedDdq = segments.some(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, una)[0] === 'DDQ' && Boolean(segmentComposite(segment, 2, una)[0]))
    const hasPia = segments.some(segment => segment.tag === 'PIA')
    const forbiddenDetail = segments.find(segment => ['LIN', 'MEA', 'CCI', 'CAV', 'SEQ', 'QTY'].includes(segment.tag))

    if (!sg5HasValuedDdk) {
      issues.push(issue('error', 'utilts_s03_err_missing_ddk_value', 'S03 UTILTS-ERR måste innehålla SG5/NAD+DDK med aktörs-ID.'))
    }

    if (!sg5HasValuedDdq) {
      issues.push(issue('error', 'utilts_s03_err_missing_ddq_value', 'S03 UTILTS-ERR måste innehålla SG5/NAD+DDQ med aktörs-ID.'))
    }

    if (!hasPia) {
      issues.push(issue('error', 'utilts_s03_err_missing_pia', 'S03 UTILTS-ERR måste innehålla SG5/PIA.'))
    }

    if (forbiddenDetail) {
      issues.push(issue('error', 'utilts_s03_err_forbidden_quantity_detail', `S03 UTILTS-ERR får inte skicka mät-/kvantitetsdetalj ${forbiddenDetail.tag} i avvisningssvaret.`))
    }
  }

  issues.push(...validateNoProdatSubaddressForUtilts({ ackMessage, sourceMessage }))

  return issues
}

function validateParsedAckPreflight(params: {
  ackMessage: EdielMessageRow
  sourceMessage: EdielMessageRow
}): EdielAckPreflightResult {
  const { ackMessage, sourceMessage } = params
  const issues: EdielAckPreflightIssue[] = []

  if (ackMessage.direction !== 'outbound') {
    issues.push(issue('error', 'ack_not_outbound', 'Endast outbound-kvittenser kan skickas.'))
  }

  if (ackMessage.related_message_id !== sourceMessage.id) {
    issues.push(issue('error', 'ack_source_mismatch', 'Kvittensen är inte kopplad till angivet källmeddelande.'))
  }

  if (ackMessage.message_family === 'CONTRL') {
    issues.push(...validateContrlPreflight({ ackMessage, sourceMessage }))
  } else if (ackMessage.message_family === 'APERAK') {
    issues.push(...validateAperakPreflight({ ackMessage, sourceMessage }))
  } else if (ackMessage.message_family === 'UTILTS_ERR') {
    issues.push(...validateUtiltsErrPreflight({ ackMessage, sourceMessage }))
  } else {
    issues.push(issue('error', 'not_ack_family', `Meddelandefamilj ${ackMessage.message_family} är inte en kvittensfamilj.`))
  }

  const ok = !issues.some((item) => item.severity === 'error')

  return {
    ok,
    issues,
    summary: ok
      ? `${ackMessage.message_family} preflight godkänd.`
      : `${ackMessage.message_family} preflight stoppad: ${issues.filter((item) => item.severity === 'error').map((item) => item.message).join(' ')}`,
  }
}

export function validateAckPreflight(params: { ackMessage: EdielMessageRow; sourceMessage: EdielMessageRow }): EdielAckPreflightResult {
  try {
    return validateParsedAckPreflight(params)
  } catch {
    const issues = [issue('error', 'ack_wire_parse_invalid', 'Kvittensens eller källans fysiska EDIFACT-kuvert kan inte läsas med deklarerad UNA.')]
    return {ok: false, issues, summary: 'Kvittens preflight stoppad: fysiskt EDIFACT-kuvert kan inte läsas.'}
  }
}
