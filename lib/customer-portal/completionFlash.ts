export const PORTAL_COMPLETION_CUSTOMER_MISSING_MESSAGE = 'Ditt konto är inte kopplat till ett kundnummer ännu. Koppla ditt kundnummer först.'
export const PORTAL_COMPLETION_EMPTY_MESSAGE = 'Fyll i minst en uppgift'
export const PORTAL_COMPLETION_FAILED_MESSAGE = 'Uppgifterna kunde inte skickas just nu. Försök igen om en stund.'

const ALLOWED_BLOCKED = new Set([
  PORTAL_COMPLETION_CUSTOMER_MISSING_MESSAGE,
  PORTAL_COMPLETION_EMPTY_MESSAGE,
  PORTAL_COMPLETION_FAILED_MESSAGE,
])

export function sanitizePortalCompletionBlockedFlash(
  value: string | null | undefined,
): string {
  const trimmed = String(value ?? '').trim()
  return ALLOWED_BLOCKED.has(trimmed) ? trimmed : PORTAL_COMPLETION_EMPTY_MESSAGE
}
