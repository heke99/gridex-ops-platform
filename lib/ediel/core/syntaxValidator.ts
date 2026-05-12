// lib/ediel/core/syntaxValidator.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import { element, parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'

export type EdielSyntaxIssue = {
  code:
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
}


function runtimeSyntaxAccepted(message: EdielMessageRow): boolean {
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


function actualEdifactMessageType(message: EdielMessageRow): string | null {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  return facts.messageType ? String(facts.messageType).toUpperCase() : null
}

function isActualContrl(message: EdielMessageRow, facts?: ReturnType<typeof parseEdifactMessageFacts>): boolean {
  const storedFamily = String(message.message_family ?? '').toUpperCase()
  const storedCode = String(message.message_code ?? '').toUpperCase()
  const parsedType = String(facts?.messageType ?? actualEdifactMessageType(message) ?? '').toUpperCase()
  return storedFamily === 'CONTRL' || storedCode === 'CONTRL' || parsedType === 'CONTRL'
}

function shouldRequireBgmReference(message: EdielMessageRow): boolean {
  if (message.message_family !== 'PRODAT') return false
  const code = String(message.message_code ?? '').toUpperCase()
  return ['Z03', 'Z04', 'Z05', 'Z06', 'Z09', 'Z10'].includes(code)
}

export function validateEdifactSyntax(message: EdielMessageRow): EdielSyntaxValidationResult {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  const issues: EdielSyntaxIssue[] = []

  if (!facts.unb) {
    issues.push({
      code: 'missing_unb',
      severity: 'error',
      title: 'UNB saknas',
      description: 'Meddelandet saknar EDIFACT-interchange header UNB.',
    })
  }

  if (!facts.unh) {
    issues.push({
      code: 'missing_unh',
      severity: 'error',
      title: 'UNH saknas',
      description: 'Meddelandet saknar EDIFACT message header UNH.',
    })
  }

  if (!facts.bgm && !isActualContrl(message, facts)) {
    issues.push({
      code: 'missing_bgm',
      severity: 'error',
      title: 'BGM saknas',
      description: 'Meddelandet saknar BGM-segment. APERAK/PRODAT/UTILTS ska ha BGM enligt anvisning.',
    })
  }

  if (facts.bgm && shouldRequireBgmReference(message) && !facts.documentReference) {
    issues.push({
      code: 'missing_bgm_reference',
      severity: 'error',
      title: 'BGM-referens saknas',
      description: 'PRODAT-meddelandet saknar BGM/1004 dokumentreferens.',
    })
  }

  if (!facts.unt) {
    issues.push({
      code: 'missing_unt',
      severity: 'error',
      title: 'UNT saknas',
      description: 'Meddelandet saknar EDIFACT message trailer UNT.',
    })
  }

  if (!facts.unz) {
    issues.push({
      code: 'missing_unz',
      severity: 'error',
      title: 'UNZ saknas',
      description: 'Meddelandet saknar EDIFACT interchange trailer UNZ.',
    })
  }

  const declaredUntCountRaw = element(facts.unt, 1)
  const declaredUntCount = declaredUntCountRaw ? Number(declaredUntCountRaw) : null
  const unhIndex = facts.unh?.index ?? -1
  const untIndex = facts.unt?.index ?? -1
  const actualMessageSegmentCount = unhIndex >= 0 && untIndex >= unhIndex ? untIndex - unhIndex + 1 : null

  if (declaredUntCountRaw && !Number.isFinite(declaredUntCount)) {
    issues.push({
      code: 'unt_count_mismatch',
      severity: 'error',
      title: 'UNT antal är ogiltigt',
      description: `UNT/0074 är inte numeriskt: ${declaredUntCountRaw}.`,
    })
  } else if (
    declaredUntCount !== null &&
    actualMessageSegmentCount !== null &&
    declaredUntCount !== actualMessageSegmentCount
  ) {
    issues.push({
      code: 'unt_count_mismatch',
      severity: 'error',
      title: 'UNT segmentantal stämmer inte',
      description: `Deklarerat antal är ${declaredUntCount}, faktiskt antal är ${actualMessageSegmentCount}.`,
    })
  }

  const unhReference = element(facts.unh, 1)
  const untReference = element(facts.unt, 2)
  if (unhReference && untReference && unhReference !== untReference) {
    issues.push({
      code: 'unh_unt_reference_mismatch',
      severity: 'error',
      title: 'UNH/UNT-referens stämmer inte',
      description: `UNH/0062 är ${unhReference}, men UNT/0062 är ${untReference}.`,
    })
  }

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
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
    declaredUntCount: Number.isFinite(declaredUntCount) ? declaredUntCount : null,
    actualMessageSegmentCount,
  }
}
