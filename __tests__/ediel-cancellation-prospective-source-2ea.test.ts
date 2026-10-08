// Component-only synthetic input; whole C03/C05 acceptance remains untagged.
import { describe, expect, it } from 'vitest'
import { buildCancellationProspectiveZ04 } from '../scripts/helpers/ediel-cancellation-prospective-source-2ea'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatCharacteristicValues } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { prodatRegisterReadingState } from '@/lib/ediel/prodat/prodatRegisterReadings'

const context = {
  external: '735123456789012399', receiver: '67890', sender: '98765', brpEdielId: '11223',
  customerIdentity: { id: 'SYNTHETIC-CUSTOMER' }, gridAreaCode: 'AREA-C', caseReference: 'OWN-C-CASE',
  requestedStartDate: '2026-11-07',
}
function source() {
  const raw = buildCancellationProspectiveZ04(context), wire = tokenizeEdifact(raw)
  const groups = prodatRegisterGroups(wire.segments, wire.una, 'Z04')
  return { raw, wire, groups, own: groups.groups[0] }
}

describe('prospective ordinary Z04 input for cancellation prerequisites', () => {
  it.each([['306', 'Z12'], ['254', 'Z31']])('selects field %s before the source envelope is born', (field, value) => {
    const { wire, own } = source()
    expect(prodatCharacteristicValues(field, own.segments, wire.una)).toEqual([value])
  })

  it('keeps one own first register, its identity agency and ordinary Z22', () => {
    const { wire, groups, own } = source()
    expect(groups.problems).toEqual([])
    expect(groups.groups).toHaveLength(1)
    expect(own).toMatchObject({ itemId: context.external, identityAgency: '9', registerPosition: 1 })
    expect(prodatCharacteristicValues('223', own.segments, wire.una)).toEqual(['Z22'])
  })

  it.each([['214', '1'], ['218', '6'], ['259', '101']])('retains one synthetic physical declaration %s without duplication', (field, value) => {
    const { wire, own } = source()
    expect(prodatRegisterReadingState(field, own.segments, wire.una)).toMatchObject({ present: true, value })
    const descriptor = { '214': 'Z02', '218': 'Z05', '259': 'Z16' }[field]!
    expect(own.segments.filter(s => s.tag === 'CCI' && segmentComposite(s, 2, wire.una)[0] === descriptor)).toHaveLength(1)
  })

  it('binds actual input identities, dates and references before public intake', () => {
    const { raw } = source()
    for (const expected of [
      'DTM+92:202611070000:203', 'RFF+LI:OWN-C-CASE', 'RFF+Z05:AREA-C',
      'NAD+UD+SYNTHETIC-CUSTOMER:SE2:260', 'NAD+Z02+11223:160:SVK',
    ]) expect(raw).toContain(expected)
    expect(raw).not.toContain('CASE-1')
    expect(raw).not.toContain('CUSTOMER-1')
  })

  it('encodes exactly one test interchange and message with correct physical counts', () => {
    const { wire } = source(), segments = wire.segments
    for (const tag of ['UNB', 'UNH', 'UNT', 'UNZ']) expect(segments.filter(s => s.tag === tag)).toHaveLength(1)
    const unb = segments.find(s => s.tag === 'UNB')!, unh = segments.find(s => s.tag === 'UNH')!
    const unt = segments.find(s => s.tag === 'UNT')!, unz = segments.find(s => s.tag === 'UNZ')!
    expect(segmentComposite(unb, 2, wire.una)).toEqual([context.receiver, '14'])
    expect(segmentComposite(unb, 3, wire.una)).toEqual([context.sender, '14'])
    expect(segmentComposite(unb, 7, wire.una)).toEqual(['23-DDQ-PRODAT'])
    expect(segmentComposite(unb, 11, wire.una)).toEqual(['1'])
    expect(segmentComposite(unt, 1, wire.una)).toEqual([String(segments.indexOf(unt) - segments.indexOf(unh) + 1)])
    expect(segmentComposite(unt, 2, wire.una)).toEqual(segmentComposite(unh, 1, wire.una))
    expect(segmentComposite(unz, 2, wire.una)).toEqual(segmentComposite(unb, 5, wire.una))
    expect(segmentComposite(segments.find(s => s.tag === 'BGM')!, 1, wire.una)).toEqual(['Z04'])
  })

  it.each(['', "735123456789012399'LIN+2++FOREIGN:::9"])(
    'refuses a missing or additional physical LIN identity: %s', external => {
      expect(() => buildCancellationProspectiveZ04({ ...context, external }))
        .toThrow('native_cancellation_ordinary_l_wire_scope_required')
    },
  )
})
