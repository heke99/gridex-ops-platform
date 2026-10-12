// masterplan: TR-08
//
// Callsite tests: transport security readiness never reports the relay transport
// verified from port reachability alone. Synthetic fixtures; does not approve TR-08.
import { describe, expect, it } from 'vitest'

import { relayTransportStatus } from '@/lib/ediel/mailReadiness'
import { evaluateRelayTrace } from '@/lib/ediel/transport/relayTrace'

const hdr = (proto: string) =>
  [
    'Authentication-Results: mx.mailbox.example.invalid; spf=pass smtp.mailfrom=own.example.invalid',
    `Received: from smtp.provider.example.invalid (smtp.provider.example.invalid [192.0.2.10])\r\n\tby mx.mailbox.example.invalid with ${proto} id r2; Mon, 12 Oct 2026 12:00:02 +0200`,
    'Received: from app.own.example.invalid (app.own.example.invalid [192.0.2.5])\r\n\tby smtp.provider.example.invalid with ESMTPSA id s1; Mon, 12 Oct 2026 12:00:01 +0200',
    'Subject: SYNTHETIC',
    '',
  ].join('\r\n')

describe('TR-08 mail readiness relay transport status', () => {
  it('stays unknown without a relay trace, even if port 465 is reachable', () => {
    expect(relayTransportStatus(null).status).toBe('unknown')
  })

  it('reports error when the next hop is plaintext despite a reachable port', () => {
    const v = evaluateRelayTrace({ rawHeaders: hdr('ESMTP'), smtpPortReachable: true })
    expect(relayTransportStatus(v).status).toBe('error')
  })

  it('reports ok only for a verified all-TLS SPF-pass trace', () => {
    const v = evaluateRelayTrace({ rawHeaders: hdr('ESMTPS') })
    expect(v.verified).toBe(true)
    expect(relayTransportStatus(v).status).toBe('ok')
  })
})
