// SC-031 component only: real production renderer -> serializer -> tokenizer.
// Declared synthetic context proves outbound omission/refusal, not source
// authority, physical DB/outbox/ACKs or whole-contract approval.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderProdat, ProdatRenderValidationError } from '@/lib/ediel/prodat/engine'
import type { ProdatEngineInput } from '@/lib/ediel/prodat/types'
import { serializeEdifact } from '@/lib/ediel/core/edifactSerializer'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: () => { throw new Error('SC031_FINITE_DATABASE_IO_FORBIDDEN') },
    rpc: () => { throw new Error('SC031_FINITE_DATABASE_IO_FORBIDDEN') },
  },
}))

const profiles = [
  { variant: 'L', reason: 'Z22' },
  { variant: 'LK', reason: 'Z23' },
] as const
type Profile = typeof profiles[number]
const point = '735123456789012345'
const createdAt = new Date('2026-10-13T10:00:00.000Z')

function input(profile: Profile): ProdatEngineInput {
  const address = {
    lines: ['Source street', '', ''] as [string, string, string],
    postalCode: '12345', city: 'Source City', country: 'SE',
    representation: { convention: 'finite postal tuple', reference: 'finite source', mode: 1 as const },
  }
  const identity = { id: 'OWN-USER', qualifier: '' as const, agency: '89' as const }
  return {
    code: 'Z01', variant: profile.variant, mode: 'production', generatedAt: createdAt,
    actor: { senderEdielId: '12345', receiverEdielId: '54321' },
    route: { applicationReference: '23-DDQ-PRODAT' },
    version: { selectedVersion: 'E2SE6A', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A' },
    context: {
      code: 'Z01', bgmReference: `OWN-DOC-${profile.variant}`, transactionReference: `OWN-LI-${profile.variant}`,
      senderEdielId: '12345', receiverEdielId: '54321', legalSenderId: '23456', legalReceiverId: '67890',
      meterPointId: point, meterPointIdAgency: '9', gridAreaId: 'TES',
      customerId: 'OWN-USER', customerIdAgency: '89',
      // A literal segment-like name must survive as data, not become a field.
      customerName: 'Synthetic RFF+MG User', customerAddress: 'Source street',
      customerPostalCode: '12345', customerCity: 'Source City', customerCountry: 'SE',
      siteAddress: 'Site street', sitePostalCode: '54321', siteCity: 'Site City', siteCountry: 'SE',
      startDate: '2027-07-15', reasonForTransaction: profile.reason,
      dependentConditionFacts: {
        market: 'electricity',
        endUserAddressObjects: [{
          meteringPointId: point, identityAgency: '9', endUser: identity,
          availability: 'available', addressLines: ['Source street'],
          source: { kind: 'caller_selection', companyId: 'finite-tenant', reference: 'finite own address' },
        }],
        invoiceeObjects: [{
          meteringPointId: point, identityAgency: '9', endUser: { identity, address },
          invoicee: { identity, nameLines: ['Synthetic invoicee'], address, availability: 'available' },
          event: { state: 'none', reference: 'finite unchanged invoicee' },
          source: { kind: 'caller_selection', companyId: 'finite-tenant', reference: 'finite own invoicee' },
        }],
      },
    },
  }
}

function wire(source: ProdatEngineInput): string {
  const rendered = renderProdat(source)
  expect(rendered.issues.filter(issue => issue.severity === 'error')).toEqual([])
  return serializeEdifact({
    sender: source.actor.senderEdielId, receiver: source.actor.receiverEdielId,
    interchangeReference: '26101310000001', messageReference: '1',
    messageTypeToken: source.version.messageTypeToken, applicationReference: '23-DDQ-PRODAT',
    acknowledgementRequest: true, testIndicator: '1', createdAt,
    businessSegments: rendered.segments,
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('SC031_FINITE_NETWORK_IO_FORBIDDEN') })
})
afterEach(() => { vi.unstubAllGlobals() })

describe.each(profiles)('SC031 outbound Z01$variant serializer component', profile => {
  it('keeps its real tuple and optional installation while omitting forbidden extras', () => {
    const source = input(profile), before = structuredClone(source)
    const raw = wire(source)
    const { segments, una } = tokenizeEdifact(raw)
    const values = (tag: string, index: number) => segments.filter(segment => segment.tag === tag)
      .map(segment => segmentComposite(segment, index, una))

    expect(values('UNH', 2)).toEqual([['PRODAT', 'D', '97A', 'UN', 'E2SE6A']])
    expect(values('BGM', 1)).toEqual([['Z01']])
    expect(values('BGM', 2)).toEqual([[`OWN-DOC-${profile.variant}`]])
    expect(values('LIN', 3)).toEqual([[point, '', '', '9']])
    expect(values('DTM', 1)).toContainEqual(['92', '202707150000', '203'])
    expect(values('RFF', 1)).toContainEqual(['LI', `OWN-LI-${profile.variant}`])
    expect(values('CCI', 2)).toContainEqual(['Z13'])
    expect(values('CAV', 1)).toContainEqual([profile.reason])
    expect(values('NAD', 1)).toContainEqual(['UD'])
    expect(values('NAD', 1)).toContainEqual(['IT'])
    expect(values('NAD', 2)).toContainEqual(['OWN-USER', '', '89'])
    expect(values('NAD', 4)).toContainEqual(['Synthetic RFF+MG User'])

    expect(values('RFF', 1).some(value => value[0] === 'MG')).toBe(false)
    expect(values('QTY', 1).some(value => value[0] === '31')).toBe(false)
    expect(values('CCI', 2).some(value => value[0] === 'Z02' || value[0] === 'Z05')).toBe(false)
    expect(source).toEqual(before)
  })

  it('omits only the absent optional installation without losing the end user', () => {
    const source = input(profile)
    source.context.siteAddress = null
    source.context.sitePostalCode = null
    source.context.siteCity = null
    const { segments, una } = tokenizeEdifact(wire(source))
    const parties = segments.filter(segment => segment.tag === 'NAD')
      .map(segment => segmentComposite(segment, 1, una)[0])
    expect(parties).toContain('UD')
    expect(parties).not.toContain('IT')
  })

  for (const extra of [
    { field: 'annualConsumption', value: '777' },
    { field: 'meterConstant', value: '42' },
    { field: 'meterDigitCount', value: '8' },
  ] as const) for (const location of ['context', 'registers'] as const) {
    it(`refuses explicit forbidden ${extra.field} in ${location} before serialization`, () => {
      const source = input(profile)
      if (location === 'context') source.context[extra.field] = extra.value
      else source.context.registers = [{ [extra.field]: extra.value }]
      const before = structuredClone(source)
      let observed: unknown
      try { wire(source) } catch (error) { observed = error }
      expect(observed).toBeInstanceOf(ProdatRenderValidationError)
      expect((observed as ProdatRenderValidationError).issues).toContainEqual(expect.objectContaining({
        severity: 'error', code: 'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT',
      }))
      expect(source).toEqual(before)
    })
  }
})
