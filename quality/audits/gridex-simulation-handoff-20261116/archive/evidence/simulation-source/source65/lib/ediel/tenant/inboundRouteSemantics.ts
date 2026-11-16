import { canonicalBusinessResponsesForFamilyCode } from '@/lib/ediel/rulebook/canonicalAckFacade'

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

/**
 * Exact route codes match directly. A configured request code may also
 * match its canonical business response; unknown families fail closed.
 */
export function inboundRouteMessageCodeMatches(input: {
  family: string | null | undefined
  configuredCode: string | null | undefined
  inboundCode: string | null | undefined
}): boolean {
  const family = upper(input.family)
  const configuredCode = upper(input.configuredCode)
  const inboundCode = upper(input.inboundCode)

  if (!configuredCode || !inboundCode) return true
  if (configuredCode === inboundCode) return true
  if (!family) return false

  try {
    return canonicalBusinessResponsesForFamilyCode({ family, code: configuredCode })
      .map(upper)
      .includes(inboundCode)
  } catch {
    return false
  }
}
