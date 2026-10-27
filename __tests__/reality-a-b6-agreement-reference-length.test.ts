// reality-defects: A-B6
// A-B6 (scenario A, batch 5e): the website and portal flows name their powers of attorney `POA-<uuid>` (40
// characters). RFF+ANJ (PRODAT field 261, C506/1154) is an..35, so the Z03 envelope preflight refused every website
// customer's Z03 (UNSM_ELEMENT_LENGTH_INVALID). edielAgreementReference sends a fitting reference as it is and a
// longer one in a deterministic short form that still fits and stays unique.
import { expect, it } from 'vitest'
import { edielAgreementReference, PRODAT_AGREEMENT_REFERENCE_MAX } from '@/lib/ediel/prodat/agreementReference'

it('a fitting reference is sent unchanged', () => {
  expect(edielAgreementReference('POA00428E191A23')).toBe('POA00428E191A23')
  expect(edielAgreementReference('x'.repeat(35))).toBe('x'.repeat(35))
  expect(edielAgreementReference('  ')).toBeNull()
  expect(edielAgreementReference(null)).toBeNull()
})

it('POA-<uuid> becomes POA + its 32 hex digits: exactly 35, unique per uuid', () => {
  const a = edielAgreementReference('POA-2b321a57-0ef6-46d3-818a-2cd45ea19abb')
  expect(a).toBe('POA2B321A570EF646D3818A2CD45EA19ABB')
  expect(a!.length).toBe(PRODAT_AGREEMENT_REFERENCE_MAX)
  expect(edielAgreementReference('POA-2b321a57-0ef6-46d3-818a-2cd45ea19abc')).not.toBe(a)
})

it('any other longer reference becomes a stable hash form that fits', () => {
  const long = 'INTAKE-POA-' + 'a'.repeat(40)
  const short = edielAgreementReference(long)!
  expect(short).toMatch(/^POA[0-9A-F]{32}$/)
  expect(edielAgreementReference(long)).toBe(short)
  expect(edielAgreementReference(long + 'b')).not.toBe(short)
})
