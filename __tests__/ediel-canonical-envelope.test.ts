import { describe, expect, it } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'

describe('EdifactEnvelopeCodec', () => {
  it('roundtrips application reference and test indicator in canonical UNB positions', () => {
    const raw = EdifactEnvelopeCodec.encode({
      sender: 'SENDER', receiver: 'RECEIVER', senderSubAddress: 'SENDSUB', receiverSubAddress: 'RECVSUB',
      interchangeReference: 'INT-1', applicationReference: 'DDQ', environment: 'test',
      createdAt: new Date('2026-07-12T10:15:00Z'),
      messages: [{ messageReference: 'MSG-1', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: ["BGM+Z03+CASE-1+9"] }],
    })
    const parsed = EdifactEnvelopeCodec.decode(raw)
    expect(parsed.applicationReference).toBe('DDQ')
    expect(parsed.testIndicator).toBe('1')
    expect(parsed.environment).toBe('test')
    expect(parsed.senderSubAddress).toBe('SENDSUB')
    expect(parsed.receiverSubAddress).toBe('RECVSUB')
    expect(raw).toContain("UNH+MSG-1+PRODAT:D:97A:UN:E2SE6A'")
    expect(raw).toContain("UNT+3+MSG-1'")
    expect(raw).toContain("UNZ+1+INT-1'")
  })

  it('omits the production test indicator instead of writing zero', () => {
    const raw = EdifactEnvelopeCodec.encode({
      sender: 'SENDER', receiver: 'RECEIVER', interchangeReference: 'INT-2', applicationReference: 'DGI', environment: 'production',
      messages: [{ messageReference: 'MSG-2', messageTypeToken: 'UTILTS:D:96A:UN:E5SE5A', businessSegments: ['BGM+E66+CASE-2+9'] }],
    })
    const parsed = EdifactEnvelopeCodec.decode(raw)
    expect(parsed.environment).toBe('production')
    expect(parsed.testIndicator).toBeNull()
    expect(raw).not.toMatch(/\+0'|\+0\+UNH/)
  })

  it('rejects nested envelope segments from business builders', () => {
    expect(() => EdifactEnvelopeCodec.encode({
      sender: 'S', receiver: 'R', interchangeReference: 'I', environment: 'test',
      messages: [{ messageReference: 'M', messageTypeToken: 'APERAK:D:96A:UN:E2SE3A', businessSegments: ['UNH+BAD'] }],
    })).toThrow('edifact_business_segment_contains_envelope_tag:UNH')
  })
})
