import { parseEdifact } from '@/lib/ediel/core/edifactParser'
import { countSegmentsUnhToUnt } from '@/lib/ediel/core/unt'

export type EdifactValidationIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export type EdifactValidationResult = {
  ok: boolean
  syntaxOk: boolean
  issues: EdifactValidationIssue[]
}

export function validateEdifactEnvelope(rawPayload: string | null | undefined): EdifactValidationResult {
  const parsed = parseEdifact(rawPayload)
  const issues: EdifactValidationIssue[] = []

  if (!parsed.unb) issues.push({ severity: 'error', code: 'missing_unb', message: 'UNB saknas.' })
  if (!parsed.unh) issues.push({ severity: 'error', code: 'missing_unh', message: 'UNH saknas.' })
  if (!parsed.unt) issues.push({ severity: 'error', code: 'missing_unt', message: 'UNT saknas.' })
  if (!parsed.unz) issues.push({ severity: 'error', code: 'missing_unz', message: 'UNZ saknas.' })

  const actualUntCount = countSegmentsUnhToUnt(parsed.segments)
  if (parsed.unt?.declaredSegmentCount !== null && actualUntCount !== null && parsed.unt?.declaredSegmentCount !== actualUntCount) {
    issues.push({
      severity: 'error',
      code: 'unt_count_mismatch',
      message: `UNT segmentantal stämmer inte. Deklarerat ${parsed.unt?.declaredSegmentCount}, faktiskt ${actualUntCount}.`,
    })
  }

  if (parsed.unh?.messageReference && parsed.unt?.messageReference && parsed.unh.messageReference !== parsed.unt.messageReference) {
    issues.push({ severity: 'error', code: 'unt_unh_reference_mismatch', message: 'UNT referens matchar inte UNH referensen.' })
  }

  if (parsed.unb?.interchangeReference && parsed.unz?.interchangeReference && parsed.unb.interchangeReference !== parsed.unz.interchangeReference) {
    issues.push({ severity: 'error', code: 'unz_unb_reference_mismatch', message: 'UNZ referens matchar inte UNB referensen.' })
  }

  if (parsed.unz?.messageCount !== null && parsed.unz?.messageCount !== 1) {
    issues.push({ severity: 'warning', code: 'multi_message_interchange', message: 'Interchange innehåller fler än ett meddelande; runtime hanterar ett meddelande per payload.' })
  }

  const syntaxOk = !issues.some((issue) => issue.severity === 'error')
  return { ok: syntaxOk, syntaxOk, issues }
}
