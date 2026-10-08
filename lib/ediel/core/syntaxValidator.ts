// lib/ediel/core/syntaxValidator.ts

import { validateEdifactEnvelope, validateUnsmGrammar, type UnsmGrammarResult, type EdifactValidationIssue } from '@/lib/ediel/core/edifactValidation'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'

type EdielSyntaxInput = Pick<EdielMessageRow,
  'raw_payload' | 'message_family' | 'message_code' | 'status' | 'syntax_check_status' | 'validation_report' | 'failure_reason'>

export type EdielSyntaxIssue = {
  code:
    | EdifactValidationIssue['code']
    | 'missing_unb'
    | 'missing_unh'
    | 'missing_bgm'
    | 'missing_bgm_reference'
    | 'missing_unt'
    | 'missing_unz'
    | 'unt_count_mismatch'
    | 'unh_unt_reference_mismatch'
    | 'syntax_check_failed'
    | 'message_failed'
  severity: 'error' | 'warning'
  title: string
  description: string
}

export type EdielSyntaxValidationResult = {
  ok: boolean
  issues: EdielSyntaxIssue[]
  declaredUntCount: number | null
  actualMessageSegmentCount: number | null
  grammarQualification: UnsmGrammarResult['qualification']
  grammarSources: UnsmGrammarResult['sources']
}


function runtimeSyntaxAccepted(message: EdielSyntaxInput): boolean {
  const report = message.validation_report as {
    utiltsRuntime?: {
      validation?: {
        syntaxOk?: unknown
        classification?: unknown
      }
    }
  } | null

  const validation = report?.utiltsRuntime?.validation
  if (!validation) return false
  if (validation.syntaxOk === true) return true
  return (
    validation.classification === 'application_rejected' ||
    validation.classification === 'functional_rejected' ||
    validation.classification === 'accepted'
  )
}


function actualEdifactMessageType(message: EdielSyntaxInput): string | null {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  return facts.messageType ? String(facts.messageType).toUpperCase() : null
}

function isActualContrl(message: EdielSyntaxInput, facts?: ReturnType<typeof parseEdifactMessageFacts>): boolean {
  const storedFamily = String(message.message_family ?? '').toUpperCase()
  const storedCode = String(message.message_code ?? '').toUpperCase()
  const parsedType = String(facts?.messageType ?? actualEdifactMessageType(message) ?? '').toUpperCase()
  return storedFamily === 'CONTRL' || storedCode === 'CONTRL' || parsedType === 'CONTRL'
}

export function validateEdifactSyntax(message: EdielSyntaxInput): EdielSyntaxValidationResult {
  const envelope = validateEdifactEnvelope(message.raw_payload)
  const issues: EdielSyntaxIssue[] = envelope.issues.map(item => ({
    code: item.code === 'unt_unh_reference_mismatch' ? 'unh_unt_reference_mismatch' : item.code,
    severity: item.severity, title: 'EDIFACT-kuvert', description: item.message,
  }))
  // A lexical rejection cannot safely be reparsed for national/header facts.
  const facts = envelope.issues.some(item => item.code === 'syntax_tokenization_failed')
    ? null : parseEdifactMessageFacts(message.raw_payload)
  const grammar: UnsmGrammarResult = facts ? validateUnsmGrammar(message.raw_payload ?? '')
    : { qualification: 'not_applicable', syntaxOk: false, issues: [], sources: [] }
  issues.push(...grammar.issues.map(item => ({ code: item.code, severity: item.severity,
    title: 'Full versionsbunden UNSM-grammatik', description: item.description })))
  if (facts && !facts.bgm && !isActualContrl(message, facts)) {
    issues.push({ code: 'missing_bgm', severity: 'error', title: 'BGM saknas',
      description: 'Meddelandet saknar BGM-segment. APERAK/PRODAT/UTILTS ska ha BGM enligt anvisning.' })
  }

  // PRODAT field203 is a national Required field owned by the canonical
  // field profile. Missing BGM/1004 therefore stays in that guide layer;
  // service syntax must not invent a CONTRL failure from national R.

  if (message.syntax_check_status === 'failed' && !runtimeSyntaxAccepted(message)) {
    issues.push({
      code: 'syntax_check_failed',
      severity: 'error',
      title: 'Syntaxkontroll failed',
      description: 'Meddelandet är markerat med syntax_check_status=failed.',
    })
  }

  if (message.status === 'failed' && !runtimeSyntaxAccepted(message)) {
    issues.push({
      code: 'message_failed',
      severity: 'error',
      title: 'Meddelandestatus failed',
      description: message.failure_reason ?? 'Meddelandet är markerat som failed.',
    })
  }

  return {
    ok: grammar.qualification !== 'unavailable' && !issues.some((issue) => issue.severity === 'error'),
    issues,
    declaredUntCount: envelope.declaredUntCount,
    actualMessageSegmentCount: envelope.actualMessageSegmentCount,
    grammarQualification: grammar.qualification,
    grammarSources: grammar.sources,
  }
}
