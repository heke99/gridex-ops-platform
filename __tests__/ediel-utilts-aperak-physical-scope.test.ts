// masterplan: ACK-08, AT-ACK-08
import { describe, expect, it } from 'vitest'
import { renderAperakEdiel } from '@/lib/ediel/aperakEngine'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

const reference = 'IDE:A+B?C'
function source(ids: string[]) {
  return {id:'SOURCE-UUID', messageFamily:'UTILTS', messageCode:'E66',
    rawPayload:EdifactEnvelopeCodec.encode({acknowledgementRequest:true,sender:'11111', receiver:'22222', interchangeReference:'INTERCHANGE', environment:'test',
      messages:[{messageReference:'M',messageTypeToken:'UTILTS:D:02B:UN:E5SE5A', businessSegments:[
        'BGM+E66::260+DOCUMENT+9+AB', 'NAD+MS+11111:SVK:260', 'NAD+MR+22222:SVK:260', ...ids.map(id => `IDE+24+${id.replace(/\?/g, '??').replace(/:/g, '?:').replace(/\+/g, '?+')}`),
      ]}]}), senderEdielId:'11111', receiverEdielId:'22222'}
}
function render(ids: string[], params: Partial<Parameters<typeof renderAperakEdiel>[0]> = {}) {
  return renderAperakEdiel({source:source(ids),refs:{documentReference:'DOCUMENT'},externalReference:'ACK', transactionReference:'OWN-ACK',
    outcome:'positive', ...params})
}
function refs(segments: string[], qualifier: string) {
  const wire = tokenizeEdifact(segments.map(segment => segment + "'").join(''))
  return wire.segments.filter(segment => segment.tag === 'RFF' && segmentComposite(segment,1,wire.una)[0] === qualifier)
    .map(segment => segmentComposite(segment,1,wire.una)[1])
}

describe('ACK-03 own DM and physical ACW', () => {
  it('preserves full released positive IDE identity', () => {
    expect(refs(render([reference], {utiltsAcknowledgementReference:reference}).segments, 'ACW')).toEqual([reference])
  })
  it('uses each physical IDE for a message-level positive APERAK rather than BGM', () => {
    const result = render(['FIRST','SECOND'])
    expect(refs(result.segments,'ACW')).toEqual(['FIRST','SECOND'])
    expect(new Set(refs(result.segments,'DM')).size).toBe(2)
  })
  it('gives separate own DM identities to two guide-error transaction groups', () => {
    const result = render([reference], {outcome:'negative', applicationErrors:[
      {ercCode:'41',fieldCode:'512',text:'MANDATORY FIELD MISSING',referenceNumber:reference},
      {ercCode:'42',fieldCode:'508',text:'INCORRECT DATA INVALID-PERIOD',referenceNumber:reference},
    ]})
    expect(refs(result.segments,'ACW')).toEqual([reference, reference])
    expect(new Set(refs(result.segments,'DM')).size).toBe(2)
  })
  it('never substitutes document identity when a negative transaction reference is absent', () => {
    expect(() => render([''], {outcome:'negative',applicationErrors:[
      {ercCode:'41',fieldCode:'505',text:'MANDATORY FIELD MISSING'},
    ]})).toThrow('utilts_aperak_transaction_reference_required')
  })
  it('never acknowledges a synthetic IDE absent from the physical original', () => {
    expect(() => render([''], {outcome:'negative',applicationErrors:[
      {ercCode:'41',fieldCode:'505',text:'MANDATORY FIELD MISSING',referenceNumber:'transaction-1'},
    ]})).toThrow('utilts_aperak_transaction_reference_not_in_source')
  })
  it('preserves a source-selected element fallback up to 17 characters', () => {
    const fallback = 'DTM/C507/2005-REF'
    expect(render(['FIRST'],{outcome:'negative',applicationErrors:[
      {ercCode:'42',fieldCode:fallback,text:'INCORRECT DATA INVALID-ELEMENT',referenceNumber:'FIRST'},
    ]}).segments).toContain(`FTX+AAO++${fallback}::260+INCORRECT DATA INVALID-ELEMENT`)
  })
})
