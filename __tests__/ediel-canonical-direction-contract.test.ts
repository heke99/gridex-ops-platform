import { describe, expect, it } from 'vitest'
import { renderContrl2Ediel2 } from '@/lib/ediel/contrlEngine'
import { parseRulebookMessage } from '@/lib/ediel/rulebook/messageParser'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'

const CONTRL_PAYLOAD = [
  "UNA:+.? '",
  "UNB+UNOC:3+21660:ZZ+91100:ZZ+260831:1600+ABC123'",
  "UNH+1+CONTRL:2:2:UN:EDIEL2'",
  "UCI+SOURCE123+91100:ZZ+21660:ZZ+1'",
  "UNT+3+1'",
  "UNZ+1+ABC123'",
].join('')

const SOURCE_PAYLOAD = [
  "UNA:+.? '",
  "UNB+UNOC:3+91100:ZZ+21660:ZZ+260831:1555+SOURCE123++E66-T'",
  "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
  "BGM+E66+SOURCE-DOC'",
  "UNT+3+1'",
  "UNZ+1+SOURCE123'",
].join('')

function contrlPayload(actionCode: string): string {
  return CONTRL_PAYLOAD.replace("+21660:ZZ+1'", `+21660:ZZ+${actionCode}'`)
}

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

  it('renders Ediel positive CONTRL with UCI action code 1', () => {
    const rendered = renderContrl2Ediel2({
      source: { rawPayload: SOURCE_PAYLOAD },
      outcome: 'positive',
    })

    expect(rendered.diagnostics.syntaxActionCode).toBe('1')
    expect(rendered.segments).toEqual(['UCI+SOURCE123+91100:ZZ+21660:ZZ+1'])
  })

  it('renders Ediel negative CONTRL with UCI action code 4', () => {
    const rendered = renderContrl2Ediel2({
      source: { rawPayload: SOURCE_PAYLOAD },
      outcome: 'negative',
    })

    expect(rendered.diagnostics.syntaxActionCode).toBe('4')
    expect(rendered.segments).toEqual(['UCI+SOURCE123+91100:ZZ+21660:ZZ+4'])
  })

  it('parses Ediel UCI action code 1 as positive', () => {
    const parsed = parseRulebookMessage(contrlPayload('1'))

    expect(parsed.facts.actionCode).toBe('1')
    expect(parsed.outcome).toBe('positive')
    expect(parsed.errors).toEqual([])
  })

  it('parses Ediel UCI action code 4 as negative', () => {
    const parsed = parseRulebookMessage(contrlPayload('4'))

    expect(parsed.facts.actionCode).toBe('4')
    expect(parsed.outcome).toBe('negative')
    expect(parsed.errors).toEqual([])
  })

  it.each(['7', '8'])('fails closed for non-Ediel UCI action code %s', (actionCode) => {
    const parsed = parseRulebookMessage(contrlPayload(actionCode))

    expect(parsed.facts.actionCode).toBe(actionCode)
    expect(parsed.outcome).toBeNull()
    expect(parsed.errors.some((error) => error.includes('måste vara 1 eller 4'))).toBe(true)
  })
})
