// lib/ediel/core/messageBuilder/profiles/prodat26A.ts

export const PRODAT_26A_CODES = ['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10', 'Z13', 'Z14', 'Z15', 'Z18'] as const
export const PRODAT_26A_UNH = 'PRODAT:D:97A:UN:E2SE6A'
export const PRODAT_SUPPLIER_SWITCH_CODES = ['Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10'] as const
export const PRODAT_METERING_ACCESS_CODES = ['Z13', 'Z14', 'Z15', 'Z18'] as const

export function isProdat26ACode(value: string | null | undefined): boolean {
  return (PRODAT_26A_CODES as readonly string[]).includes(String(value ?? '').trim().toUpperCase())
}
