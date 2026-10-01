import { describe, expect, it } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { preflightEdielPayload, edielPayloadSizeRecommendation } from '@/lib/ediel/core/messageBuilder/payloadPreflight'

function raw(family: 'UTILTS' | 'PRODAT', body: string[], count = 1) {
  return EdifactEnvelopeCodec.encode({ sender: 'SENDER', receiver: 'RECEIVER', interchangeReference: 'PACK1',
    applicationReference: family === 'UTILTS' ? '23-DDQ-E66-T' : '23-DDQ-PRODAT', environment: 'test', acknowledgementRequest: true, createdAt: new Date('2026-09-30T10:00:00Z'),
    messages: Array.from({ length: count }, (_, index) => ({ messageReference: `M${index}`, messageTypeToken: family === 'UTILTS' ? 'UTILTS:D:02B:UN:E5SE5A' : 'PRODAT:D:97A:UN:E2SE6A', businessSegments: [`BGM+${family === 'UTILTS' ? 'E66' : 'Z03'}+DOC1+9`, ...body] })) })
}
function preflight(payload: string, mode: 'send' | 'parse') {
  return preflightEdielPayload({ rawPayload: payload, messageStandard: 'edifact', mode })
}

describe('packing limits have distinct authority from syntax', () => {
  it('measures actual Latin1 wire bytes instead of UTF8 length', () => {
    const payload = raw('PRODAT', ['FTX+AAO+++ÅÄÖ'])
    expect(preflight(payload, 'parse').payloadSizeBytes).toBe(Buffer.byteLength(payload, 'latin1'))
  })
  it('keeps the technical ten MB recommendation advisory', () => {
    expect(edielPayloadSizeRecommendation(10 * 1024 * 1024 + 1)?.severity).toBe('warning')
    expect(edielPayloadSizeRecommendation(1024)?.code).toBeUndefined()
  })
  it('holds outgoing UTILTS above one MB but warns incoming without creating syntax codes', () => {
    const payload = raw('UTILTS', [`ZZZ+${'A'.repeat(1024 * 1024)}`])
    expect(preflight(payload, 'send').issues.find(issue => issue.code === 'UTILTS_CONSERVATIVE_PACKING_LIMIT')?.severity).toBe('error')
    expect(preflight(payload, 'parse').issues.find(issue => issue.code === 'UTILTS_CONSERVATIVE_PACKING_LIMIT')?.severity).toBe('warning')
  })
  it('counts actual transaction occurrences for the conservative 999 outgoing limit', () => {
    const payload = raw('UTILTS', Array.from({ length: 1000 }, (_, index) => `IDE+24+T${index}`))
    expect(preflight(payload, 'send').issues.find(issue => issue.code === 'UTILTS_CONSERVATIVE_PACKING_LIMIT')?.description).toContain('1000 transaktioner')
    expect(preflight(payload, 'parse').issues.find(issue => issue.code === 'UTILTS_CONSERVATIVE_PACKING_LIMIT')?.severity).toBe('warning')
  })
  it('uses the same UTILTS single-message national packaging guard before send', () => {
    const result = preflight(raw('UTILTS', ['IDE+24+T1'], 2), 'send')
    expect(result.issues.some(issue => issue.code === 'UTILTS_PACKAGING_MESSAGE_COUNT' && issue.severity === 'error')).toBe(true)
  })
  it('does not let XML hints avoid physical EDIFACT encoding and policy', () => {
    const payload = raw('PRODAT', ['FTX+AAO+++Å'])
    const result = preflightEdielPayload({ rawPayload: payload, messageStandard: 'xml', mode: 'send' })
    expect(result.blocking).toBe(true)
    expect(result.issues.some(issue => issue.code === 'EDIEL_WIRE_FORMAT_IDENTITY_MISMATCH')).toBe(true)
    expect(result.family).toBe('PRODAT')
  })
})
