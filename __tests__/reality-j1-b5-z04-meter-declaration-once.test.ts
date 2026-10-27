// reality-defects: J1-B5
// J1-B5 (scenario J1, batch 5): the world's Z04 builder (buildZ04ForSwitchRequest) already declares the meter reading
// fields 214, 218 and 259 (T6), and z04For added them a second time. The platform answered every Z04 with a negative
// APERAK (ERC 42 on fields 214/218), so no switch was confirmed. A Z04 now carries the declaration exactly once, and the
// variant without field 259 (J1-10) carries none. The platform's own validator, policy and parser decide.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { asReceived } from '../scripts/helpers/reality/rejectsWire'
import { withoutMeterReadingDeclaration, z04For } from '../scripts/helpers/reality/inboundProdatWire'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import type { EdielMessageRow } from '@/lib/ediel/types'

const z03 = readFileSync(path.resolve(__dirname, '../scripts/reality/fixtures-z03-normal-switch.edi'), 'utf8')
const FACTS = { market: 'electricity', meterReadingsSentInUtilts: true } as const
const count = (wire: string, segment: string) => wire.split("'").filter(part => part === segment).length
function blockingIssues(wire: string) {
  const row = { ...asReceived(wire), message_code: 'Z04', application_reference: '23-DDQ-PRODAT', parsed_payload: { prodatDependentFacts: FACTS } } as EdielMessageRow
  const tokens = tokenizeEdifact(wire)
  const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z04', subtypeOrReasonCode: 'Z22', direction: 'inbound', referenceDate: '2026-10-25',
    associationAssignedCode: 'E2SE6A', applicationReference: '23-DDQ-PRODAT', mode: 'parse', prodatDependentFacts: FACTS })
  return { syntax: validateEdifactSyntax(row).issues.filter(i => i.severity === 'error'),
    blocking: validateCanonicalPolicyFields({ policy, rawPayload: wire, rawSegments: tokens.segments.map(s => s.raw), una: tokens.una }).filter(i => i.blocking) }
}

describe('J1-B5 a Z04 declares the meter reading fields exactly once', () => {
  it('the default Z04 carries each of fields 214, 218 and 259 once and the product finds no blocking field error', () => {
    const { raw } = z04For(z03, '60000')
    for (const segment of ['CCI++Z02', 'CCI++Z05', 'CCI++Z16']) expect(count(raw, segment), segment).toBe(1)
    expect(blockingIssues(raw)).toEqual({ syntax: [], blocking: [] })
  })

  it('the Z04 without field 259 carries no declaration (J1-10)', () => {
    const { raw } = z04For(z03, '60000', { readings: false })
    for (const segment of ['CCI++Z02', 'CCI++Z05', 'CCI++Z16']) expect(count(raw, segment), segment).toBe(0)
    expect(blockingIssues(raw).syntax).toEqual([])
  })

  it('removing the declaration recounts UNT', () => {
    const { raw } = z04For(z03, '60000')
    const bare = withoutMeterReadingDeclaration(raw)
    const segments = bare.split("'").filter(Boolean)
    const unh = segments.findIndex(s => s.startsWith('UNH+')), unt = segments.findIndex(s => s.startsWith('UNT+'))
    expect(segments[unt]).toMatch(new RegExp(`^UNT\\+${unt - unh + 1}\\+`))
  })
})
