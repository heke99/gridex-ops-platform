// lib/ediel/core/messageBuilder/profiles/utiltsE5SE5A.ts

export const UTILTS_E5SE5A_CODES = ['E66', 'E73', 'E31', 'S01', 'S02', 'S03', 'S04'] as const
export const UTILTS_E5SE5A_UNH = 'UTILTS:D:02B:UN:E5SE5A'

export function isUtiltsE5Se5ACode(value: string | null | undefined): boolean {
  return (UTILTS_E5SE5A_CODES as readonly string[]).includes(String(value ?? '').trim().toUpperCase())
}
