// masterplan: TR-08, AT-TR-08
//
// Code-only component tests for the TR-08 relay TLS/SPF trace evaluator.
// ALL header fixtures below are SYNTHETIC (RFC 2606 / RFC 5737 names and
// addresses). They are not a genuine Strato test-mailbox trace and do not
// approve TR-08 or AT-TR-08 as a whole.
import { describe, expect, it } from 'vitest'

import {
  RELAY_TRACE_MAX_HEADER_BYTES,
  RELAY_TRACE_MAX_HOPS,
  evaluateRelayTrace,
} from '@/lib/ediel/transport/relayTrace'

// Synthetic hops, written in chronological order (first = our submission).
const SYN_HOP_SUBMIT =
  'Received: from app.own.example.invalid (app.own.example.invalid [192.0.2.5])\r\n' +
  '\tby smtp.provider.example.invalid with ESMTPSA id s1\r\n' +
  '\t(using TLSv1.3 with cipher TLS_AES_256_GCM_SHA384); Sun, 4 Oct 2026 12:00:01 +0200'
const SYN_HOP_RELAY =
  'Received: from smtp.provider.example.invalid (smtp.provider.example.invalid [192.0.2.10])\r\n' +
  '\tby mx.mailbox.example.invalid with ESMTPS id r2\r\n' +
  '\t(version=TLS1_3 cipher=TLS_AES_128_GCM_SHA256); Sun, 4 Oct 2026 12:00:02 +0200'
const SYN_HOP_RELAY_PLAINTEXT =
  'Received: from smtp.provider.example.invalid (smtp.provider.example.invalid [192.0.2.10])\r\n' +
  '\tby mx.mailbox.example.invalid with ESMTP id r2; Sun, 4 Oct 2026 12:00:02 +0200'
const SYN_SPF_PASS =
  'Authentication-Results: mx.mailbox.example.invalid; spf=pass smtp.mailfrom=own.example.invalid'

/** Build a synthetic header block: hops chronological in, newest-first out (as MTAs prepend). */
function synthetic(hops: string[], top: string[] = [SYN_SPF_PASS]): string {
  return [...top, ...[...hops].reverse(), 'Subject: SYNTHETIC TR-08 fixture', ''].join('\r\n') + '\r\nbody'
}

describe('TR-08 relay trace evaluator (synthetic fixtures)', () => {
  it('verifies an all-TLS chain with SPF pass', () => {
    const v = evaluateRelayTrace({ rawHeaders: synthetic([SYN_HOP_SUBMIT, SYN_HOP_RELAY]) })
    expect(v.reasons).toEqual([])
    expect(v.verified).toBe(true)
    expect(v.hops.map((h) => h.by)).toEqual(['smtp.provider.example.invalid', 'mx.mailbox.example.invalid'])
    expect(v.hops.every((h) => h.tls === 'tls')).toBe(true)
    expect(v.hops[1].tlsVersion).toBe('TLS1.3')
    expect(v.spf).toBe('pass')
  })

  it('does not verify when the second hop is plaintext', () => {
    const v = evaluateRelayTrace({ rawHeaders: synthetic([SYN_HOP_SUBMIT, SYN_HOP_RELAY_PLAINTEXT]) })
    expect(v.verified).toBe(false)
    expect(v.hops[1].tls).toBe('plaintext')
    expect(v.reasons).toContain('hop_1_plaintext')
  })

  it('never verifies the whole transport from port 465 reachability / first hop only (prohibited case)', () => {
    const v = evaluateRelayTrace({ rawHeaders: synthetic([SYN_HOP_SUBMIT]), smtpPortReachable: true })
    expect(v.verified).toBe(false)
    expect(v.reasons).toContain('first_hop_only_trace')
    expect(v.reasons).toContain('port_reachability_is_not_transport_proof')

    const none = evaluateRelayTrace({ rawHeaders: synthetic([]), smtpPortReachable: true })
    expect(none.verified).toBe(false)
    expect(none.reasons).toContain('no_received_hops')
  })

  it('does not verify duplicated hops', () => {
    const v = evaluateRelayTrace({ rawHeaders: synthetic([SYN_HOP_SUBMIT, SYN_HOP_RELAY, SYN_HOP_RELAY]) })
    expect(v.verified).toBe(false)
    expect(v.reasons).toContain('duplicate_hop')
  })

  it('does not verify reordered hops (broken chain / time going backwards)', () => {
    const reordered = evaluateRelayTrace({ rawHeaders: synthetic([SYN_HOP_RELAY, SYN_HOP_SUBMIT]) })
    expect(reordered.verified).toBe(false)
    expect(reordered.reasons).toEqual(expect.arrayContaining(['hop_chain_discontinuity']))

    const backwards = SYN_HOP_RELAY.replace('12:00:02', '11:59:00')
    const time = evaluateRelayTrace({ rawHeaders: synthetic([SYN_HOP_SUBMIT, backwards]) })
    expect(time.verified).toBe(false)
    expect(time.reasons).toContain('hop_timestamps_out_of_order')
  })

  it('does not let comments or spoofed text reclassify a plaintext hop as TLS', () => {
    const spoofs = [
      // TLS words only inside a comment, protocol says ESMTP.
      SYN_HOP_RELAY_PLAINTEXT.replace('id r2;', 'id r2 (with ESMTPS version=TLS1_3 cipher=TLS_AES_128_GCM_SHA256);'),
      // Comment smuggles a second "with" claim.
      SYN_HOP_RELAY_PLAINTEXT.replace('with ESMTP', '(with ESMTPS) with ESMTP'),
      // Two conflicting protocol clauses outside comments.
      SYN_HOP_RELAY_PLAINTEXT.replace('id r2;', 'id r2 with ESMTPS;'),
      // TLS version text outside comments but protocol is plaintext.
      SYN_HOP_RELAY_PLAINTEXT.replace('id r2;', 'id r2 version=TLS1_3;'),
    ]
    for (const hop of spoofs) {
      const v = evaluateRelayTrace({ rawHeaders: synthetic([SYN_HOP_SUBMIT, hop]) })
      expect(v.verified, hop).toBe(false)
      expect(v.hops[1]?.tls, hop).not.toBe('tls')
      expect(v.reasons.length, hop).toBeGreaterThan(0)
    }
  })

  it('does not verify a TLS protocol with a weak TLS version', () => {
    const weak = SYN_HOP_RELAY.replace('version=TLS1_3', 'version=TLS1_0')
    const v = evaluateRelayTrace({ rawHeaders: synthetic([SYN_HOP_SUBMIT, weak]) })
    expect(v.verified).toBe(false)
    expect(v.reasons).toContain('hop_1_weak_tls')
  })

  it.each([
    ['fail', 'Authentication-Results: mx.mailbox.example.invalid; spf=fail smtp.mailfrom=own.example.invalid', 'spf_not_pass'],
    ['softfail', 'Authentication-Results: mx.mailbox.example.invalid; spf=softfail smtp.mailfrom=own.example.invalid', 'spf_not_pass'],
    ['none', 'Authentication-Results: mx.mailbox.example.invalid; spf=none smtp.mailfrom=own.example.invalid', 'spf_not_pass'],
    ['received-spf softfail', 'Received-SPF: Softfail (mx.mailbox.example.invalid: domain transitions) client-ip=192.0.2.10', 'spf_not_pass'],
    ['missing', null, 'spf_missing'],
    ['pass only inside a comment', 'Authentication-Results: mx.mailbox.example.invalid; (spf=pass) spf=none', 'spf_not_pass'],
    ['conflicting results', `${SYN_SPF_PASS}\r\nReceived-SPF: Fail (mx.mailbox.example.invalid) client-ip=192.0.2.10`, 'spf_conflicting'],
  ])('does not verify SPF %s', (_label, spf, reason) => {
    const v = evaluateRelayTrace({ rawHeaders: synthetic([SYN_HOP_SUBMIT, SYN_HOP_RELAY], spf ? [spf] : []) })
    expect(v.verified).toBe(false)
    expect(v.spf).not.toBe('pass')
    expect(v.reasons).toContain(reason)
  })

  it('ignores a forged SPF pass injected below the final receiving hop', () => {
    // Sender-injected pass appears below the provider hop; final hop added nothing.
    const raw = [SYN_HOP_RELAY, SYN_SPF_PASS, SYN_HOP_SUBMIT, 'Subject: SYNTHETIC', '', 'b'].join('\r\n')
    const v = evaluateRelayTrace({ rawHeaders: raw })
    expect(v.verified).toBe(false)
    expect(v.spf).toBe('missing')
    expect(v.reasons).toContain('spf_missing')
  })

  it('bounds malformed and oversized input and never verifies it', () => {
    const big = evaluateRelayTrace({ rawHeaders: 'X: ' + 'a'.repeat(RELAY_TRACE_MAX_HEADER_BYTES + 1) })
    expect(big.verified).toBe(false)
    expect(big.reasons).toContain('input_oversized')
    expect(big.hops).toEqual([])

    const manyHops = Array.from({ length: RELAY_TRACE_MAX_HOPS + 1 }, () => SYN_HOP_RELAY)
    const many = evaluateRelayTrace({ rawHeaders: synthetic(manyHops) })
    expect(many.verified).toBe(false)
    expect(many.reasons).toContain('too_many_hops')

    for (const junk of ['', 'garbage without colon', 'Received: ', 'Received: from ((((((((', 'Received: by x with ESMTPS (unterminated comment', '\u0000\u0001']) {
      const v = evaluateRelayTrace({ rawHeaders: junk })
      expect(v.verified, JSON.stringify(junk)).toBe(false)
      expect(v.reasons.length).toBeGreaterThan(0)
    }

    // Pathological nesting/whitespace must complete quickly (no backtracking).
    const evil = 'Received: from ' + '('.repeat(20_000) + ' by '.repeat(5_000) + 'with ' + ' '.repeat(20_000)
    const t0 = Date.now()
    const e = evaluateRelayTrace({ rawHeaders: evil })
    expect(Date.now() - t0).toBeLessThan(500)
    expect(e.verified).toBe(false)
  })

  it('rejects non-string input', () => {
    const v = evaluateRelayTrace({ rawHeaders: 42 as unknown as string })
    expect(v.verified).toBe(false)
    expect(v.reasons).toContain('input_not_string')
  })
})
