import { describe, expect, it } from 'vitest'
import { evaluateInboundAckTransportMirror } from '@/lib/inbound-mail/inboundAckTransportGuard'

const outbound = {
  environment: 'test',
  senderEdielId: '21660',
  senderSubAddress: 'GRIDEX',
  receiverEdielId: '91100',
  receiverSubAddress: 'SVK',
}

describe('inbound ACK transport guard', () => {
  it('accepts only the exact reverse UNB party pair', () => {
    expect(evaluateInboundAckTransportMirror({
      environment: 'test',
      outbound,
      parsed: {
        senderEdielId: '91100',
        senderSubAddress: 'SVK',
        receiverEdielId: '21660',
        receiverSubAddress: 'GRIDEX',
      },
    })).toMatchObject({ ok: true, reason: null })
  })

  it('rejects a forged sender even when the reference matched', () => {
    expect(evaluateInboundAckTransportMirror({
      environment: 'test',
      outbound,
      parsed: {
        senderEdielId: '99999',
        senderSubAddress: 'SVK',
        receiverEdielId: '21660',
        receiverSubAddress: 'GRIDEX',
      },
    })).toMatchObject({
      ok: false,
      reason: 'ack_transport_party_mismatch:99999:21660:91100:21660',
    })
  })

  it('rejects cross-environment ACK correlation', () => {
    expect(evaluateInboundAckTransportMirror({
      environment: 'production',
      outbound,
      parsed: {
        senderEdielId: '91100',
        senderSubAddress: 'SVK',
        receiverEdielId: '21660',
        receiverSubAddress: 'GRIDEX',
      },
    })).toMatchObject({
      ok: false,
      reason: 'ack_transport_environment_mismatch:production:test',
    })
  })

  it('fails closed when a configured subaddress is missing or different', () => {
    expect(evaluateInboundAckTransportMirror({
      environment: 'test',
      outbound,
      parsed: {
        senderEdielId: '91100',
        senderSubAddress: null,
        receiverEdielId: '21660',
        receiverSubAddress: 'GRIDEX',
      },
    })).toMatchObject({
      ok: false,
      reason: 'ack_transport_sender_subaddress_mismatch:missing:SVK',
    })
  })
})
