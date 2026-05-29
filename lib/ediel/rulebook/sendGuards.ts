import type { EdielMessageRow } from '@/lib/ediel/types'
import { validateEdielMessageRowWithRulebook } from '@/lib/ediel/rulebook/validator'

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function assertRulebookAllowsSend(message: EdielMessageRow): void {
  if (message.direction !== 'outbound') return
  const parsedPayload = objectValue(message.parsed_payload) ?? {}
  if (parsedPayload.rulebookAllowInvalidSend === true) return

  const validation = validateEdielMessageRowWithRulebook(message, 'send')
  const errors = validation.issues.filter((issue) => issue.severity === 'error' || issue.blocking)
  if (errors.length === 0) return

  throw new Error(
    `Rulebook blockerar skick: ${errors.map((issue) => `${issue.code}: ${issue.description}`).join(' | ')}`
  )
}
