export type EdifactTimezoneOffset = {
  raw: string
  offsetMinutes: number
  format: '406'
}

function parseTimezoneSegment(segment: string): EdifactTimezoneOffset | null {
  const raw = String(segment ?? '').trim()
  if (!raw) return null

  // Swedish Ediel writes the UTC offset in DTM+735 using format 406. With the
  // default UNA, a positive sign is commonly escaped as ?+ because + is the
  // data-element separator. Accept both the escaped and already-unescaped form.
  const match = /^DTM\+735:(?:[^+\-\d])?([+-])(\d{2})(\d{2}):406$/i.exec(raw)
  if (!match) return null

  const hours = Number(match[2])
  const minutes = Number(match[3])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null

  const sign = match[1] === '-' ? -1 : 1
  return {
    raw: `${match[1]}${match[2]}${match[3]}`,
    offsetMinutes: sign * (hours * 60 + minutes),
    format: '406',
  }
}

export function parseEdifactTimezoneOffsetFromSegments(
  segments: readonly string[] | null | undefined,
): EdifactTimezoneOffset | null {
  for (const segment of segments ?? []) {
    const parsed = parseTimezoneSegment(segment)
    if (parsed) return parsed
  }
  return null
}

export function localEdifactDateTimeToUtc(
  value: string | null | undefined,
  timezone: EdifactTimezoneOffset | null | undefined,
): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  // Do not apply DTM+735 twice if a caller already supplied an absolute instant.
  if (/Z$/i.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)) {
    const absolute = new Date(raw)
    return Number.isNaN(absolute.getTime()) ? null : absolute.toISOString()
  }

  if (!timezone) return raw

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(raw)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] ?? 0)
  const millisecond = Number(String(match[7] ?? '0').padEnd(3, '0'))
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  const check = new Date(localAsUtc)

  // Reject impossible calendar/timestamp values instead of allowing Date.UTC to
  // roll them into another day/month.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null
  }

  return new Date(localAsUtc - timezone.offsetMinutes * 60_000).toISOString()
}

/** Express an absolute instant in the declared fixed Ediel offset (e.g. +01:00),
 * so calendar arithmetic (P1M/P1Y) follows the local wall time it was sent in.
 * Floating values and values without a declared offset are returned unchanged. */
export function edifactInstantInDeclaredOffset(
  value: string | null | undefined,
  timezone: EdifactTimezoneOffset | null | undefined,
): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (!timezone || !(/Z$/i.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw))) return raw
  const instant = Date.parse(raw)
  if (!Number.isFinite(instant)) return raw
  const offset = timezone.offsetMinutes, abs = Math.abs(offset)
  const wall = new Date(instant + offset * 60_000).toISOString().slice(0, -1)
  return `${wall}${offset < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}
