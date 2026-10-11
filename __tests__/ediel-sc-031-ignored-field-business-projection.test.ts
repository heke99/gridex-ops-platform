// masterplan: SC-031, P-02
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseInboundProdatBusinessData } from '@/lib/ediel/inboundCases'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import type { ProdatIgnoredField } from '@/lib/ediel/rulebook/fieldMatrix'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { ignoredProdatSegmentIndexes } from '@/lib/ediel/prodat/prodatIgnoredFieldProjection'
import { raw, line, characteristic, type Parts } from './fixtures/prodat-register'
import { own, head, source } from './fixtures/prodat-identity'
import type { EdielMessageRow } from '@/lib/ediel/types'

const db = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: db }))
beforeEach(() => {
  db.from.mockReset()
  db.from.mockImplementation(() => { throw new Error('Unexpected database access in business projection test') })
})

// P26.A r3 p119: incoming X / false-D fields are ignored. The SAME canonical
// owner that records prodatIgnoredFields (runtime onIgnoredField) is the input;
// the business consumer must not read those physical occurrences.
function ignoredFields(wire: string, code: string, subtype: string): ProdatIgnoredField[] {
  const t = tokenizeEdifact(wire)
  const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: code, subtypeOrReasonCode: subtype, direction: 'inbound',
    referenceDate: '2026-09-30', mode: 'parse', applicationReference: '23-DDQ-PRODAT' })
  const fields: ProdatIgnoredField[] = []
  validateCanonicalPolicyFields({ policy, rawPayload: wire, rawSegments: t.segments.map(s => s.raw), una: t.una, scope: 'all',
    onIgnoredField: field => { if (!fields.some(existing => JSON.stringify(existing) === JSON.stringify(field))) fields.push(field) } })
  return fields
}
function received(wire: string, code: string, subtype: string): EdielMessageRow {
  const prodatIgnoredFields = ignoredFields(wire, code, subtype)
  return { ...source(wire, code), company_id: 'tenant-A', parsed_payload: { canonical: { prodatIgnoredFields } } } as EdielMessageRow
}
const base = (): Parts[] => [...head(), ...own('1', '735123456789012345', 'CASE-A')]
const withSegment = (segment: Parts, after: string): Parts[] => {
  const body = base(), at = body.findIndex(part => part[0] === after)
  body.splice(at + 1, 0, segment)
  return body
}

describe('SC-031 / P-02: P119 ignored PRODAT occurrences never reach inbound case business data', () => {
  it('Z01 with ignored field 224 (RFF+MG) yields case data identical to Z01 without it', () => {
    const extraWire = raw(withSegment(['RFF', ['MG', 'IGNORED-METER']], 'DTM'), 'Z01'), plainWire = raw(base(), 'Z01')
    const extra = received(extraWire, 'Z01', 'L'), plain = received(plainWire, 'Z01', 'L')
    expect(extra.parsed_payload.canonical).toMatchObject({ prodatIgnoredFields: [expect.objectContaining({ fieldNumber: '224', sourceRule: 'PRODAT26A:P119' })] })
    const withExtra = parseInboundProdatBusinessData(extra), without = parseInboundProdatBusinessData(plain)
    expect(withExtra.meteringPoint.meterNumber).toBeNull()
    expect(withExtra).toEqual(without)
    expect(JSON.stringify(withExtra)).not.toContain('IGNORED-METER')
    // Raw evidence is untouched.
    expect(extra.raw_payload).toBe(extraWire)
    expect(extra.raw_payload).toContain("RFF+MG:IGNORED-METER'")
  })

  it('Z01 with ignored field 213 (QTY+31) yields identical annualEnergyKwh, registers and objects', () => {
    const extraWire = raw(withSegment(['QTY', ['31', '777', 'KWH']], 'LIN'), 'Z01'), plainWire = raw(base(), 'Z01')
    const extra = received(extraWire, 'Z01', 'L'), plain = received(plainWire, 'Z01', 'L')
    expect(extra.parsed_payload.canonical).toMatchObject({ prodatIgnoredFields: [expect.objectContaining({ fieldNumber: '213' })] })
    const withExtra = parseInboundProdatBusinessData(extra), without = parseInboundProdatBusinessData(plain)
    expect(withExtra.site.annualEnergyKwh).toBeNull()
    expect(withExtra.meteringPoint.registers).toEqual(without.meteringPoint.registers)
    expect(withExtra.proposedAction).toEqual(without.proposedAction)
    expect(withExtra).toEqual(without)
    expect(JSON.stringify(withExtra)).not.toContain('777')
    expect(extra.raw_payload).toBe(extraWire)
  })

  it('selected-object projection also excludes the ignored occurrence', () => {
    const extra = received(raw(withSegment(['RFF', ['MG', 'IGNORED-METER']], 'DTM'), 'Z01'), 'Z01', 'L')
    const plain = received(raw(base(), 'Z01'), 'Z01', 'L')
    const object = { meteringPointId: '735123456789012345', identityAgency: '9' }
    expect(parseInboundProdatBusinessData(extra, object)).toEqual(parseInboundProdatBusinessData(plain, object))
  })

  it('drops only the ignored occurrence when the identical segment is USED in another line', () => {
    // Z04: field 319 RFF+Z07 is D for subtype D (Z13=Z70) and false-D (ignored) for subtype L (Z13=Z22).
    const body: Parts[] = [line('1', '735123456789012345'), ...characteristic('Z13', 'Z70'), ['RFF', ['Z07', 'SAME-REF']],
      line('2', '735123456789012352'), ...characteristic('Z13', 'Z22'), ['RFF', ['Z07', 'SAME-REF']]]
    const wire = raw(body, 'Z04'), message = received(wire, 'Z04', 'L')
    const ignored = (message.parsed_payload.canonical as { prodatIgnoredFields: ProdatIgnoredField[] }).prodatIgnoredFields
    expect(ignored.filter(field => field.fieldNumber === '319')).toEqual([expect.objectContaining({ occurrence: expect.objectContaining({ lineIndex: 1 }) })])
    // Identical text in both lines; the index set selects only the second line's occurrence.
    const segments = tokenizeEdifact(wire).segments
    const same = segments.filter(segment => segment.raw === 'RFF+Z07:SAME-REF').map(segment => segment.index)
    expect(same).toHaveLength(2)
    expect([...ignoredProdatSegmentIndexes(wire, ignored)!]).toEqual([same[1]])
    const used = parseInboundProdatBusinessData(message, { meteringPointId: '735123456789012345', identityAgency: '89' })
    const dropped = parseInboundProdatBusinessData(message, { meteringPointId: '735123456789012352', identityAgency: '89' })
    expect(used.meteringPoint.referenceToMeteringPoint).toBe('SAME-REF')
    expect(used.production.referenceToMeteringPoint).toBe('SAME-REF')
    expect(dropped.meteringPoint.referenceToMeteringPoint).toBeNull()
    expect(dropped.production.referenceToMeteringPoint).toBeNull()
    expect(message.raw_payload).toBe(wire)
  })

  it('Z04 where 213 and 224 are legitimately used keeps them populated', () => {
    const body: Parts[] = [...head(), line('1', '735123456789012345'), ['DTM', ['92', '202610010000', '203']], ['QTY', ['31', '4200', 'KWH']],
      ...characteristic('Z13', 'Z22'), ['RFF', ['MG', 'METER-1']], ['RFF', ['Z05', 'NET']]]
    const wire = raw(body, 'Z04'), message = received(wire, 'Z04', 'L')
    const ignored = (message.parsed_payload.canonical as { prodatIgnoredFields: ProdatIgnoredField[] }).prodatIgnoredFields
    expect(ignored.map(field => field.fieldNumber)).not.toEqual(expect.arrayContaining(['213']))
    expect(ignored.map(field => field.fieldNumber)).not.toEqual(expect.arrayContaining(['224']))
    const result = parseInboundProdatBusinessData(message)
    expect(result.meteringPoint.meterNumber).toBe('METER-1')
    expect(result.site.annualEnergyKwh).toBe(4200)
    expect(result.meteringPoint.registers).toEqual([expect.objectContaining({ annualConsumption: '4200' })])
  })

  it('fails closed when recorded ignored fields are not bound to this raw source', () => {
    const extra = received(raw(withSegment(['RFF', ['MG', 'IGNORED-METER']], 'DTM'), 'Z01'), 'Z01', 'L')
    const forged = { ...extra, raw_payload: raw(base(), 'Z01') } as EdielMessageRow
    expect(() => parseInboundProdatBusinessData(forged)).toThrow('PRODAT_IGNORED_FIELD_BINDING_INVALID')
  })
})
