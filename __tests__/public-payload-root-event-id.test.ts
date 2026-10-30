// Finding 20261029-3f1a8ab1/claude-track5/003: the public payload guard accepts
// the opaque event reference at exactly $.event_id (webhook root) and
// $.data[n].event_id (event list), nowhere else and in no other format.
import { describe, expect, it } from 'vitest'
import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'

const REF = `event_${'0123456789abcdef'.repeat(2)}`

describe('public payload event_id exception', () => {
  it('accepts the opaque reference at the webhook root and in the event list', () => {
    expect(() => assertPublicResponsePayload({ event_id: REF, event_type: 'site.created', data: {} })).not.toThrow()
    expect(() => assertPublicResponsePayload({ data: [{ event_id: REF }] })).not.toThrow()
  })

  it('rejects a UUID at $.event_id', () => {
    expect(() => assertPublicResponsePayload({ event_id: '6f1c2a4e-1b2c-4d3e-8f90-123456789abc' })).toThrow(/\$\.event_id/)
  })

  it('rejects a non-canonical value at $.event_id', () => {
    for (const value of [`event_${'a'.repeat(31)}`, `event_${'a'.repeat(33)}`, `EVENT_${'a'.repeat(32)}`, `event_${'A'.repeat(32)}`, `evt_${'a'.repeat(32)}`]) {
      expect(() => assertPublicResponsePayload({ event_id: value }), value).toThrow()
    }
  })

  it('rejects the opaque reference at any other or nested path', () => {
    for (const payload of [
      { resource: { event_id: REF } },
      { data: { event_id: REF } },
      { data: [{ nested: { event_id: REF } }] },
      { items: [{ event_id: REF }] },
      { delivery: { event: { event_id: REF } } },
    ]) {
      expect(() => assertPublicResponsePayload(payload), JSON.stringify(payload)).toThrow()
    }
  })
})
