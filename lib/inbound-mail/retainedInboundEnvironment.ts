import type { EdielEnvironment } from '@/lib/ediel/types'

export const INBOUND_ORIGINAL_ENVIRONMENT_UNVERIFIED = 'inbound_original_environment_unverified'

export function readRetainedInboundEnvironment(row: Record<string, unknown>): EdielEnvironment | null {
  const mailbox = row.ediel_mailboxes as { environment?: unknown } | null | undefined
  const stored = row.environment
  const configured = mailbox?.environment
  const source = configured ?? stored
  if (source !== 'test' && source !== 'production') return null
  if (stored != null && stored !== source) return null
  return source
}
