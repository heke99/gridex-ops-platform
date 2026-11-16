export type ContractDateFields = {
  actual_start_date?: unknown
  actual_start_at?: unknown
  confirmed_start_date?: unknown
  confirmed_start_at?: unknown
  starts_at?: unknown
  expected_start_at?: unknown
}

export type ContractStartDatePolicy = 'delivered' | 'planning' | 'pricing'

/** A real Swedish calendar day; never normalize an impossible date into another month. */
export function contractCalendarDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(text)
  if (!match || Number(match[1]) === 0) return null
  const day = `${match[1]}-${match[2]}-${match[3]}`
  const midnight = new Date(`${day}T00:00:00.000Z`)
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== day) return null
  if (text === day) return day
  // A timestamp without an offset depends on the machine timezone: hold it.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return null
  const instant = new Date(text)
  if (!Number.isFinite(instant.getTime())) return null
  const localDay = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant)
  return /^\d{4}-\d{2}-\d{2}$/.test(localDay) ? localDay : null
}

const fields: Record<ContractStartDatePolicy, ReadonlyArray<keyof ContractDateFields>> = {
  delivered: ['actual_start_date', 'actual_start_at'],
  planning: ['actual_start_date', 'actual_start_at', 'confirmed_start_date', 'confirmed_start_at', 'starts_at', 'expected_start_at'],
  // Retain the old signed-start fallback for legacy pricing. This is an anchor,
  // never permission to bill: actual source-bound supply gates remain required.
  pricing: ['actual_start_date', 'actual_start_at', 'starts_at'],
}

/** Read canonical operational dates first; never rewrite frozen signed terms. */
export function resolveContractStartDate(
  contract: ContractDateFields | null | undefined,
  policy: ContractStartDatePolicy = 'planning',
): string | null {
  if (!contract) return null
  for (const field of fields[policy]) {
    const value = contract[field]
    if (value == null || (typeof value === 'string' && !value.trim())) continue
    // Invalid authoritative data must not silently downgrade to a planned date.
    return contractCalendarDate(value)
  }
  return null
}
