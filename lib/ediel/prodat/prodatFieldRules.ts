import {
  PRODAT_26A_MESSAGE_CODES,
  canonicalProdat26AFieldRules,
  type Prodat26AMessageCode,
} from '@/lib/ediel/prodat/prodat26AFieldMatrix'

export const SUPPORTED_PRODAT_BUSINESS_CODES = PRODAT_26A_MESSAGE_CODES
export type SupportedProdatBusinessCode = Prodat26AMessageCode

export function isSupportedProdatBusinessCode(value: string | null | undefined): value is SupportedProdatBusinessCode {
  return SUPPORTED_PRODAT_BUSINESS_CODES.includes(String(value ?? '').toUpperCase() as SupportedProdatBusinessCode)
}

/** Compatibility helper. Required segment tags are derived from the immutable
 * 26.A field matrix rather than maintained as a second semantic list. */
export function requiredProdatSegmentsForCode(code: string): string[] {
  const tags = canonicalProdat26AFieldRules(code)
    .filter((rule) => rule.requirement === 'required')
    .map((rule) => String(rule.segmentPath ?? '').split('/')[0])
    .map((path) => path.split('+')[0])
    .filter(Boolean)
  return Array.from(new Set(tags))
}

export { canonicalProdat26AFieldRules }
