import { describe, expect, it } from 'vitest'
import { PRODAT_APERAK_FIELD_NAMES, prodatAperakFieldWireLabel } from '@/lib/ediel/prodat/prodatAperakText'
import { assertEdifactLatin1Representable } from '@/lib/ediel/core/edifactEncoding'

describe('source-owned PRODAT labels have an explicit UNOC wire projection', () => {
  it('preserves the frozen display name and the field216 wire words', () => {
    expect(PRODAT_APERAK_FIELD_NAMES['216']).toBe('Giltighetsdatum – giltig from')
    expect(prodatAperakFieldWireLabel('216')).toBe('Giltighetsdatum - giltig from')
    expect(() => assertEdifactLatin1Representable(prodatAperakFieldWireLabel('216')!)).not.toThrow()
  })
  it('represents every source-owned field label without changing national field identity', () => {
    for (const field of Object.keys(PRODAT_APERAK_FIELD_NAMES)) {
      expect(prodatAperakFieldWireLabel(field)).toBeDefined()
      expect(() => assertEdifactLatin1Representable(prodatAperakFieldWireLabel(field)!)).not.toThrow()
    }
    expect(prodatAperakFieldWireLabel('unregistered')).toBeUndefined()
  })
  it('never repairs an unrepresentable original identifier or invalid field value', () => {
    expect(() => assertEdifactLatin1Representable('ORIGINAL–ID')).toThrow('edifact_character_not_iso8859_1')
  })
})
