import { describe, expect, it } from 'vitest'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'

const CONTRL_PAYLOAD = [
  "UNA:+.? '",
  "UNB+UNOC:3+21660:ZZ+91100:ZZ+260831:1600+ABC123'",
  "UNH+1+CONTRL:D:3:UN'",
  "UCI+SOURCE123+91100:ZZ+21660:ZZ+1'",
  "UNT+3+1'",
  "UNZ+1+ABC123'",
].join('')

function hasDirectionRequired(result: ReturnType<typeof validateRulebookMessage>): boolean {
  return result.issues.some((issue) =>
    String(issue.description ?? '').includes('canonical_policy_direction_required:CONTRL:CONTRL'),
  )
}

describe('canonical Ediel runtime direction contract', () => {
  it('treats send validation as an outbound transport operation', () => {
    const result = validateRulebookMessage({
      rawPayload: CONTRL_PAYLOAD,
      mode: 'send',
      businessDate: '2026-08-31',
    })

    expect(hasDirectionRequired(result)).toBe(false)
  })

  it('keeps parse validation fail-closed when direction is unknown', () => {
    const result = validateRulebookMessage({
      rawPayload: CONTRL_PAYLOAD,
      mode: 'parse',
      businessDate: '2026-08-31',
    })

    expect(hasDirectionRequired(result)).toBe(true)
    expect(result.blocking).toBe(true)
  })

  it('accepts explicit direction for parse validation', () => {
    const result = validateRulebookMessage({
      rawPayload: CONTRL_PAYLOAD,
      mode: 'parse',
      direction: 'outbound',
      businessDate: '2026-08-31',
    })

    expect(hasDirectionRequired(result)).toBe(false)
  })
})
