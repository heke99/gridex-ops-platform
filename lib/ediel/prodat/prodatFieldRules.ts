export const SUPPORTED_PRODAT_BUSINESS_CODES = ['Z03', 'Z04', 'Z05', 'Z06', 'Z09', 'Z10', 'Z13', 'Z14', 'Z15', 'Z18'] as const

export type SupportedProdatBusinessCode = (typeof SUPPORTED_PRODAT_BUSINESS_CODES)[number]

export function isSupportedProdatBusinessCode(value: string | null | undefined): value is SupportedProdatBusinessCode {
  return SUPPORTED_PRODAT_BUSINESS_CODES.includes(String(value ?? '').toUpperCase() as SupportedProdatBusinessCode)
}

export function requiredProdatSegmentsForCode(code: string): string[] {
  const normalized = code.toUpperCase()
  if (normalized === 'Z13' || normalized === 'Z18') return ['BGM', 'DTM', 'NAD', 'LIN', 'RFF', 'CCI', 'CAV']
  if (normalized === 'Z14' || normalized === 'Z15') return ['BGM', 'DTM', 'NAD', 'LIN', 'RFF']
  return ['BGM', 'DTM', 'NAD', 'LIN']
}
