import type { EdielMessageRow } from '@/lib/ediel/types'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder'
import { evaluateEdielProductionSendLock } from '@/lib/ediel/core/productionGuards'

export function assertEdielSendLock(message: EdielMessageRow): void {
  const preflight = preflightEdielMessageRow(message, 'send')
  const protocolErrors = preflight.issues.filter(issue => (issue.code.startsWith('PRODAT_REGISTER_') || issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_')) && issue.severity === 'error')
  if (protocolErrors.length) throw new Error(protocolErrors.map(issue => `${issue.code}: ${issue.description}`).join(' | '))
  const lock = evaluateEdielProductionSendLock(message, preflight)
  if (lock.status === 'blocked') {
    throw new Error(lock.issues.map((issue) => issue.message).join(' | ') || 'Ediel send lock blockerade utskick.')
  }
}
