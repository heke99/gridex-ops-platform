import { describe, expect, it } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { parseInboundUtilts } from '@/lib/ediel/utilts'

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

describe('canonical EDIFACT tokenization in UTILTS', () => {
  it('rejects a dangling release character instead of silently truncating input', () => {
    expect(() => tokenizeEdifact("UNB+UNOC:3+S+R+260813:1200+1'FTX+AAO+++BROKEN?"))
      .toThrow('edifact_dangling_release_character')
  })

  it('keeps released separators inside UTILTS values without creating fake elements or segments', () => {
    const parsed = parseInboundUtilts(
      "UNA:+.? 'UNB+UNOC:3+SENDER:14+RECEIVER:14+260813:1200+INT1++23-DDQ-S02-S++1'" +
      "UNH+MSG1+UTILTS:D:02B:UN:E5SE5A'BGM+S02+DOC?+PLUS+9+AB'" +
      "DTM+137:202608131200:203'MKS+23+E02::260'NAD+MS+SENDER::9'NAD+MR+RECEIVER::9'" +
      "IDE+24+TX1'LOC+172+735999999999999999::9'LOC+239+ABC:SVK:260'" +
      "DTM+324:202608010000202609010000:719'DTM+354:1:802'STS+7++E88::260'MKS+23+E02::260'" +
      "MEA+AAZ++KWH'SEQ++1'QTY+135:1'UNT+17+MSG1'UNZ+1+INT1'",
    )

    expect(parsed.externalReference).toBe('DOC+PLUS')
    expect(parsed.rawSegments.filter((segment) => segment.startsWith('BGM+'))).toHaveLength(1)
  })
})
