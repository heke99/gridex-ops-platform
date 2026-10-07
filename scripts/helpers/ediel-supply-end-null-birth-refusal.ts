/** Classifies a database diagnostic only; it supplies no admission or authority. */
export function isSupplyEndProfileResolutionRefusal(warning: readonly unknown[], effectiveDate: string): boolean {
  if (warning.length !== 2 || warning[0] !== '[inbound-mail] Kunde inte skapa/uppdatera inbound ediel_message') return false
  const error = warning[1]
  if (!error || typeof error !== 'object') return false
  // The database supplies plain data. Do not invoke diagnostic getters or
  // convert unrelated objects to strings to manufacture a matching refusal.
  try {
    const code = Object.getOwnPropertyDescriptor(error, 'code')?.value
    const message = Object.getOwnPropertyDescriptor(error, 'message')?.value
    if (code !== '23514' || typeof message !== 'string') return false
    const match = /^canonical_inbound_rule_profile_resolution_failed:PRODAT:Z05:(\d{4}-\d{2}-\d{2}):(0|[2-9]|[1-9]\d+)$/u.exec(message)
    return !!match && match[0] === message && match[1] === effectiveDate
  } catch {
    return false
  }
}
