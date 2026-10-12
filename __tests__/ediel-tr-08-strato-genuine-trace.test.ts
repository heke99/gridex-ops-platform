// masterplan: TR-08, AT-TR-08
//
// Genuine operator-owned read-back traces of test mail from the Ediel mailbox
// (ediel@gridex.se) via STRATO to an external Gmail mailbox, 2026-10-12. The
// Received / Authentication-Results / Received-SPF lines are verbatim; only the
// recipient local part is masked. Forged variants of the same traces must fail.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluateRelayTrace, type RelayTraceInput } from '@/lib/ediel/transport/relayTrace'
import { relayTransportStatus } from '@/lib/ediel/mailReadiness'

type Evidence = {
  providerPolicy: { providerDomains: string[]; spfPolicy: string }
  ownerDecision: { ref: string }
  traces: Array<{ name: string; rawHeaders: string }>
}

const evidence = JSON.parse(
  readFileSync(join(process.cwd(), 'quality/audits/ediel-masterplan-v2/evidence/tr-08-strato-genuine-traces-20261012.json'), 'utf8'),
) as Evidence
const policy = { providerDomains: evidence.providerPolicy.providerDomains, policyRef: evidence.ownerDecision.ref }
const trace = (name: string) => evidence.traces.find((t) => t.name === name)!.rawHeaders
const SUBMISSION = trace('trace-2-authenticated-submission')
const WEBMAIL = trace('trace-1-strato-webmail')
const run = (rawHeaders: string, extra: Partial<RelayTraceInput> = {}) =>
  evaluateRelayTrace({ rawHeaders, providerPolicy: policy, ...extra })

describe('TR-08 genuine STRATO relay traces', () => {
  it('verifies the authenticated-submission trace hop by hop: TLS to STRATO, TLS to the next server, SPF pass', () => {
    const v = run(SUBMISSION, { smtpPortReachable: true })
    expect(v.reasons).toEqual([])
    expect(v.verified).toBe(true)
    expect(v.spf).toBe('pass')
    expect(v.hops.map((h) => [h.by, h.protocol, h.tls, h.tlsVersion])).toEqual([
      ['smtp.strato.com', 'ESMTPSA', 'tls', 'TLS1.3'],
      ['mx.google.com', 'ESMTPS', 'tls', 'TLS1.3'],
      [null, 'SMTP', 'receiver_internal', null],
    ])
    expect(v.notes).toEqual(['hop_2_receiver_internal_excluded_from_tls', 'hop_1_provider_internal_handoff'])
    expect(relayTransportStatus(v).status).toBe('ok')
  })

  it('keeps the STRATO webmail trace unverified: its first hop names an internal host outside the provider domains', () => {
    const v = run(WEBMAIL)
    expect(v.hops.map((h) => [h.by, h.tls, h.tlsVersion])).toEqual([
      ['smtp-ox.front', 'tls', 'TLS1.2'],
      ['mx.google.com', 'tls', 'TLS1.3'],
      [null, 'receiver_internal', null],
    ])
    expect(v.spf).toBe('pass')
    expect(v.reasons).toEqual(['hop_chain_discontinuity'])
    expect(v.verified).toBe(false)
  })

  it('without the operator provider policy the unrecorded STRATO hand-off is a chain break', () => {
    const v = evaluateRelayTrace({ rawHeaders: SUBMISSION })
    expect(v.verified).toBe(false)
    expect(v.reasons).toContain('hop_chain_discontinuity')
    expect(evaluateRelayTrace({ rawHeaders: SUBMISSION, providerPolicy: { ...policy, policyRef: ' ' } }).reasons).toContain('hop_chain_discontinuity')
  })

  it('rejects the trace when the next hop to the recipient is plaintext (TLS to STRATO alone is not enough)', () => {
    const v = run(SUBMISSION.replace('by mx.google.com with ESMTPS', 'by mx.google.com with ESMTP'), { smtpPortReachable: true })
    expect(v.verified).toBe(false)
    expect(v.reasons).toEqual(expect.arrayContaining(['hop_1_plaintext', 'not_all_hops_tls', 'port_reachability_is_not_transport_proof']))
    expect(relayTransportStatus(v).status).toBe('error')
  })

  it('does not exempt receiver-internal hops when the receiving hop itself was plaintext', () => {
    const v = run(SUBMISSION.replace('by mx.google.com with ESMTPS', 'by mx.google.com with ESMTP'))
    expect(v.hops[2].tls).toBe('plaintext')
    expect(v.reasons).toContain('hop_2_plaintext')
  })

  it('rejects SPF results that are not pass at the receiving boundary', () => {
    for (const bad of ['fail', 'softfail', 'none']) {
      const v = run(SUBMISSION.replaceAll('spf=pass', `spf=${bad}`).replace('Received-SPF: pass', `Received-SPF: ${bad}`))
      expect(v.verified).toBe(false)
      expect(v.spf).toBe(bad)
    }
  })

  it('ignores an SPF pass forged by a host that is not the receiving boundary', () => {
    const forged = SUBMISSION
      .replaceAll('Authentication-Results: mx.google.com;', 'Authentication-Results: mx.attacker.example;')
      .replace(/Received-SPF:[^\r]*\r\n/, '')
    const v = run(forged)
    expect(v.verified).toBe(false)
    expect(v.reasons).toContain('spf_missing')
  })

  it('does not treat a later hop with a sender as receiver-internal', () => {
    const extra = 'Received: from relay.attacker.example (relay.attacker.example [192.0.2.66]) by inbox.example.invalid with SMTP id z; Mon, 12 Oct 2026 09:30:09 -0700 (PDT)\r\n'
    const v = run(extra + SUBMISSION)
    expect(v.verified).toBe(false)
    expect(v.reasons).toContain('not_all_hops_tls')
  })

  it('does not treat a by-first line with a late from clause as receiver-internal (review 5493996486)', () => {
    const lateFrom = 'Received: by inbox.final.example with SMTP from remote.attacker.example; Mon, 12 Oct 2026 09:30:09 -0700 (PDT)\r\n'
    const v = run(lateFrom + SUBMISSION)
    expect(v.verified).toBe(false)
    expect(v.hops.every((h) => h.tls !== 'receiver_internal' || h.index === 2)).toBe(true)
    expect(v.hops[3].tls).not.toBe('receiver_internal')
  })

  it('does not accept a hand-off into a host outside the declared provider domains', () => {
    const v = run(SUBMISSION.replaceAll('mo4-p00-ob.smtp.rzone.de', 'mo4.relay.attacker.example'))
    expect(v.verified).toBe(false)
    expect(v.reasons).toContain('hop_chain_discontinuity')
  })
})
