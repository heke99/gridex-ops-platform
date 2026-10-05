import { canonicalAckRequirements } from '@/lib/ediel/ack/canonicalAckEngine'

/**
 * Narrow canonical ACK projection for operational runtime consumers.
 *
 * The normative ACK matrix stays owned by canonicalAckEngine. Operational
 * modules use this facade so they only load the response relation they need
 * instead of eagerly importing the full Ediel policy facade and unrelated
 * rulebook domains.
 */
export function canonicalBusinessResponsesForFamilyCode(input: {
  family: string
  code: string | null | undefined
}): readonly string[] {
  return canonicalAckRequirements(input).businessResponses
}
