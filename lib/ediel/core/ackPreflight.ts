// lib/ediel/core/ackPreflight.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'

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

function upperPayload(message: EdielMessageRow): string {
  return String(message.raw_payload ?? '').toUpperCase()
}

function containsSegment(rawUpper: string, tag: string): boolean {
  const normalized = rawUpper.replace(/\r?\n/g, '')
  return normalized.startsWith(`${tag}+`) || normalized.includes(`'${tag}+`)
}

function firstSegment(raw: string, tag: string): string | null {
  const upperTag = tag.toUpperCase()
  return String(raw ?? '')
    .split("'")
    .map((segment) => segment.trim())
    .find((segment) => segment.toUpperCase().startsWith(`${upperTag}+`)) ?? null
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

  const rawUpper = upperPayload(params.ackMessage)
  if (!rawUpper.includes(':ZZ:PRODAT')) return []

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
  const rawUpper = raw.toUpperCase()
  const issues: EdielAckPreflightIssue[] = []
  const outcome = parseAckOutcome(ackMessage) ?? 'positive'

  if (sourceMessage.message_family === 'CONTRL') {
    issues.push(issue('error', 'contrl_on_contrl_blocked', 'CONTRL får aldrig skickas som kvittens på inkommande CONTRL.'))
  }

  if (!containsSegment(rawUpper, 'UCI')) {
    issues.push(issue('error', 'contrl_missing_uci', 'CONTRL-preview saknar UCI-segment.'))
  }

  for (const forbiddenTag of ['BGM', 'RFF', 'ERC', 'FTX']) {
    if (containsSegment(rawUpper, forbiddenTag)) {
      issues.push(issue('error', `contrl_forbidden_${forbiddenTag.toLowerCase()}`, `CONTRL får inte innehålla ${forbiddenTag}; det hör till APERAK/andra meddelanden.`))
    }
  }

  const uci = firstSegment(raw, 'UCI')
  if (uci) {
    const actionCode = uci.split('+')[4]?.split(':')[0]?.trim() ?? null
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
  const rawUpper = upperPayload(ackMessage)
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

  if (!containsSegment(rawUpper, 'BGM')) {
    issues.push(issue('error', 'aperak_missing_bgm', 'APERAK-preview saknar BGM-segment.'))
  }

  if (!containsSegment(rawUpper, 'RFF')) {
    issues.push(issue('error', 'aperak_missing_reference', 'APERAK-preview saknar referenssegment.'))
  }

  if (!containsSegment(rawUpper, 'ERC')) {
    issues.push(issue('error', 'aperak_missing_erc', 'APERAK-preview saknar ERC-segment.'))
  }

  if (!containsSegment(rawUpper, 'FTX')) {
    issues.push(issue('error', 'aperak_missing_ftx', 'APERAK-preview saknar FTX-segment.'))
  }

  if (outcome === 'positive') {
    if (!rawUpper.includes('ERC+100')) {
      issues.push(issue('error', 'positive_aperak_missing_100', 'Positiv APERAK ska innehålla ERC+100.'))
    }
  } else if (outcome === 'negative') {
    if (rawUpper.includes('ERC+100')) {
      issues.push(issue('error', 'negative_aperak_contains_100', 'Negativ APERAK får inte innehålla ERC+100/OK.'))
    }
  }

  if (sourceMessage.message_family === 'UTILTS' && /'DOC\+S0[1234]::260\+/.test(rawUpper)) {
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
  const rawUpper = upperPayload(ackMessage)
  const issues: EdielAckPreflightIssue[] = []
  const sourceSyntaxOk = sourceSyntaxAccepted(sourceMessage)

  if (sourceMessage.message_family === 'CONTRL' || sourceMessage.message_family === 'APERAK') {
    issues.push(issue('error', 'utilts_err_on_ack_blocked', 'UTILTS-ERR får inte skickas på inkommande kvittensmeddelanden.'))
  }

  if (!sourceSyntaxOk) {
    issues.push(issue('error', 'utilts_err_blocked_by_syntax_error', 'UTILTS-ERR får inte skickas när källmeddelandet har syntaxfel; negativ CONTRL ska skickas först.'))
  }

  if (!containsSegment(rawUpper, 'BGM')) {
    issues.push(issue('error', 'utilts_err_missing_bgm', 'UTILTS-ERR-preview saknar BGM-segment.'))
  }

  if (!rawUpper.includes('UNH+1+UTILTS:D:02B:UN:E5SE5A')) {
    issues.push(issue('error', 'utilts_err_wrong_unh', 'UTILTS-ERR ska använda UNH+1+UTILTS:D:02B:UN:E5SE5A.'))
  }

  if (!rawUpper.includes('BGM+ERR:SVK:260')) {
    issues.push(issue('error', 'utilts_err_wrong_bgm', 'UTILTS-ERR ska använda BGM+ERR:SVK:260.'))
  }

  if (!rawUpper.includes('STS+E01::260+41+')) {
    issues.push(issue('error', 'utilts_err_missing_sts_e01', 'UTILTS-ERR saknar STS+E01::260+41+<felkod>::260.'))
  }

  issues.push(...validateNoProdatSubaddressForUtilts({ ackMessage, sourceMessage }))

  return issues
}

export function validateAckPreflight(params: {
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
