// masterplan: U-16, AT-U-16, U-15, AT-U-15
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
  it('keeps one MB outgoing/incoming packing severity independent of actual whole syntax rejection', () => {
    const payload = raw('UTILTS', [`ZZZ+${'A'.repeat(1024 * 1024)}`])
    const outgoing=preflight(payload,'send'),incoming=preflight(payload,'parse')
    expect(outgoing.issues.find(issue => issue.code === 'UTILTS_CONSERVATIVE_PACKING_LIMIT')?.severity).toBe('error')
    expect(incoming.issues.find(issue => issue.code === 'UTILTS_CONSERVATIVE_PACKING_LIMIT')?.severity).toBe('warning')
    for(const result of [outgoing,incoming]){
      expect(result.blocking).toBe(true)
      expect(result.issues.some(issue=>issue.code==='UNSM_MESSAGE_STRUCTURE_INVALID'&&issue.severity==='error')).toBe(true)
    }
    // Real megabyte tokenization/full-directory validation is exercised here;
    // the default five-second unit timeout is not a wire acceptance budget.
  },45000)
  it('counts actual transaction occurrences for the conservative 999 outgoing limit', () => {
    const payload = raw('UTILTS', Array.from({ length: 1000 }, (_, index) => `IDE+24+T${index}`))
    expect(preflight(payload, 'send').issues.find(issue => issue.code === 'UTILTS_CONSERVATIVE_PACKING_LIMIT')?.description).toContain('1000 transaktioner')
    expect(preflight(payload, 'parse').issues.find(issue => issue.code === 'UTILTS_CONSERVATIVE_PACKING_LIMIT')?.severity).toBe('warning')
  })
  it('uses the same UTILTS single-message national packaging guard before send', () => {
    const result = preflight(raw('UTILTS', ['IDE+24+T1'], 2), 'send')
    expect(result.issues.some(issue => issue.code === 'UTILTS_PACKAGING_MESSAGE_COUNT' && issue.severity === 'error')).toBe(true)
  })
  it('U-15 blocks an outgoing UTILTS with two legal receivers, mixed reasons or mixed resolutions before send', () => {
    const errors = (body: string[]) => preflight(raw('UTILTS', body), 'send').issues
      .filter(issue => issue.severity === 'error' && issue.code.startsWith('UTILTS_PACKAGING_')).map(issue => issue.code)
    expect(errors(['NAD+MS+11111:SVK:260', 'NAD+MR+22222:SVK:260', 'IDE+24+T1'])).toEqual([])
    expect(errors(['NAD+MS+11111:SVK:260', 'NAD+MR+22222:SVK:260', 'NAD+MR+33333:SVK:260', 'IDE+24+T1'])).toEqual(['UTILTS_PACKAGING_MULTIPLE_RECEIVERS'])
    // U-12: the same installation never makes E23 and E88 one batch.
    expect(errors(['IDE+24+T1', 'STS+7++E23::260', 'IDE+24+T2', 'STS+7++E88::260'])).toEqual(['UTILTS_PACKAGING_MIXED_REASONS'])
    expect(errors(['IDE+24+T1', 'DTM+354:15:806', 'IDE+24+T2', 'DTM+354:1:802'])).toEqual(['UTILTS_PACKAGING_MIXED_RESOLUTIONS'])
    expect(errors(['IDE+24+T1', 'STS+7++E88::260', 'DTM+354:15:806', 'IDE+24+T2', 'STS+7++E88::260', 'DTM+354:15:806'])).toEqual([])
  })
  it('does not let XML hints avoid physical EDIFACT encoding and policy', () => {
    const payload = raw('PRODAT', ['FTX+AAO+++Å'])
    const result = preflightEdielPayload({ rawPayload: payload, messageStandard: 'xml', mode: 'send' })
    expect(result.blocking).toBe(true)
    expect(result.issues.some(issue => issue.code === 'EDIEL_WIRE_FORMAT_IDENTITY_MISMATCH')).toBe(true)
    expect(result.family).toBe('PRODAT')
  })
})
