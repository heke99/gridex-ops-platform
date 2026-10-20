// The grid-owner simulator answers a real platform Z03 (captured from the
// native normal-switch fixture) with a Z04 that echoes the request's facts.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { buildZ04ForSwitchRequest, readSwitchRequest } from './simulators/gridOwnerWire'

const z03 = readFileSync('scripts/reality/fixtures-z03-normal-switch.edi', 'utf8')

describe('grid-owner simulator wire', () => {
  it('reads the facts a DSO needs from our Z03', () => {
    expect(readSwitchRequest(z03)).toEqual({ supplier: '40000', gridOwner: '60000', external: '735123456789051435', startDate: '20261115', variant: 'L',
      caseReference: 'LI9B13B11F12D6402A9DCF7AB03A02536C', gridArea: 'TES', customerIdentity: '199001011234', brp: '99876' })
  })

  it('confirms with a Z04 that echoes case reference, facility, start date and grid area, reversed envelope', () => {
    const { raw } = buildZ04ForSwitchRequest({ request: z03, gridOwnerEdielId: '60000' })
    const t = tokenizeEdifact(raw)
    const value = (tag: string, qualifier: string, element = 1, component = 1) => {
      const s = t.segments.find(x => x.tag === tag && segmentComposite(x, 1, t.una)[0] === qualifier)
      return s ? segmentComposite(s, element, t.una)[component] : undefined
    }
    const unb = t.segments.find(s => s.tag === 'UNB')!
    expect([segmentComposite(unb, 2, t.una)[0], segmentComposite(unb, 3, t.una)[0]]).toEqual(['60000', '40000'])
    expect(segmentComposite(t.segments.find(s => s.tag === 'BGM')!, 1, t.una)[0]).toBe('Z04')
    expect(value('RFF', 'LI')).toBe('LI9B13B11F12D6402A9DCF7AB03A02536C')
    expect(value('RFF', 'Z05')).toBe('TES')
    expect(segmentComposite(t.segments.find(s => s.tag === 'LIN')!, 3, t.una)[0]).toBe('735123456789051435')
    expect(raw).toContain('202611150000')
  })

  it('refuses a request addressed to another grid owner', () => {
    expect(() => buildZ04ForSwitchRequest({ request: z03, gridOwnerEdielId: '61111' })).toThrow('switch_request_addressed_to_other_grid_owner')
  })
})
