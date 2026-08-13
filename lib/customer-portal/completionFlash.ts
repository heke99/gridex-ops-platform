export const PORTAL_COMPLETION_CUSTOMER_MISSING_MESSAGE = 'Kundkoppling saknas'
export const PORTAL_COMPLETION_EMPTY_MESSAGE = 'Fyll i minst en uppgift'

const ALLOWED_BLOCKED = new Set([
  PORTAL_COMPLETION_CUSTOMER_MISSING_MESSAGE,
  PORTAL_COMPLETION_EMPTY_MESSAGE,
])

export function sanitizePortalCompletionBlockedFlash(
  value: string | null | undefined,
): string {
  const trimmed = String(value ?? '').trim()
  return ALLOWED_BLOCKED.has(trimmed) ? trimmed : PORTAL_COMPLETION_EMPTY_MESSAGE
}
