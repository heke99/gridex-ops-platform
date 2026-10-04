import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { validateEdielMessageRowWithRulebook } from '@/lib/ediel/rulebook/validator'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import type { EdielMessageRow } from '@/lib/ediel/types'
describe('invalid send metadata supplies no operational authority', () => {
  it.each(['test', 'production'] as const)('holds source-invalid messages despite caller bypass flag in %s', environment => {
    const original = energyHandoffMessage('2026-09-30')
    const message = { ...original, direction: 'outbound', environment,
      raw_payload: original.raw_payload?.replace('BGM+E66', 'BGM+E99'), message_code: 'E99',
      parsed_payload: { ...original.parsed_payload, rulebookAllowInvalidSend: true } } as EdielMessageRow
    expect(() => assertRulebookAllowsSend(message)).toThrow(/Rulebook blockerar skick/)
  })
  it('returns the actual chosen policy with successful canonical validation', () => {
    const message = energyHandoffMessage('2026-09-30')
    const result = validateEdielMessageRowWithRulebook({ ...message, message_received_at: '2026-09-30T12:00:00Z' }, 'parse')
    expect(result.canonicalPolicy).toMatchObject({ family: 'UTILTS', code: 'E66', referenceDate: '2026-09-30' })
    expect(result.canonicalPolicy?.guide.guideRevision).toBe('25-A-3')
  })
})
