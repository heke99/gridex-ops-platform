// masterplan: TR-08, AT-TR-08
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ tcpOk: true }))
vi.mock('dns', () => ({ promises: {
  resolveMx: async () => [{ exchange: 'smtpin.rzone.de', priority: 10 }],
  resolveTxt: async (name: string) => name.startsWith('_dmarc') ? [['v=DMARC1; p=none']] : [['v=spf1 redirect=_spf.strato.com']],
  resolveCname: async (name: string) => [name.replace(/\.own\.example\.invalid$/, '.rzone.com')],
} }))
vi.mock('net', () => ({ default: { createConnection: () => {
  const handlers: Record<string, () => void> = {}
  const socket = { setTimeout: () => socket, once: (e: string, cb: () => void) => { handlers[e] = cb; return socket }, on: (e: string, cb: () => void) => { handlers[e] = cb; return socket }, end: () => {}, destroy: () => {} }
  setTimeout(() => (net.tcpOk ? handlers.connect : handlers.error)?.(), 0)
  return socket
} } }))

import { relayProbeConfigFromEnv, relayTraceReadiness, runRelayTraceProbe, verifyRelayTrace, recordRelayTrace, type RelayTraceRecord } from '@/lib/ediel/transport/relayTrace'
import { getMailReadiness } from '@/lib/ediel/mailReadiness'

const PROBE = 'probe-synthetic-0001'
const OWN = ['smtp.own.example.invalid']
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

// Chronological hops (bottom = first). Our app -> own submission server -> provider relay -> mailbox MX -> LMTP.
function trace(opts: { relayHop?: string; mxHop?: string; spf?: string | null; probe?: string | null; noReceived?: boolean } = {}) {
  const received = opts.noReceived ? [] : [
    'Received: from mx.mailbox.example.invalid (localhost [127.0.0.1])\r\n\tby mailbox.example.invalid with LMTP id a1; Sun, 4 Oct 2026 12:00:03 +0200',
    opts.mxHop ?? 'Received: from relay.provider.example.invalid (relay.provider.example.invalid [192.0.2.20])\r\n\tby mx.mailbox.example.invalid with ESMTPS id b2\r\n\t(version=TLS1_3 cipher=TLS_AES_256_GCM_SHA384); Sun, 4 Oct 2026 12:00:02 +0200',
    opts.relayHop ?? 'Received: from smtp.own.example.invalid (smtp.own.example.invalid [192.0.2.10])\r\n\tby relay.provider.example.invalid (Postfix) with ESMTPS id c3\r\n\t(using TLSv1.3 with cipher TLS_AES_128_GCM_SHA256 (128/128 bits)); Sun, 4 Oct 2026 12:00:01 +0200',
    'Received: from app.example.invalid ([198.51.100.5]) by smtp.own.example.invalid with ESMTPSA id d4 (TLSv1.2:ECDHE-RSA-AES256-GCM-SHA384); Sun, 4 Oct 2026 12:00:00 +0200',
  ]
  return [...received,
    ...(opts.spf === null ? [] : [`Authentication-Results: mx.mailbox.example.invalid; spf=${opts.spf ?? 'pass'} smtp.mailfrom=own.example.invalid`]),
    ...(opts.probe === null ? [] : [`X-Gridex-Relay-Probe: ${opts.probe ?? PROBE}`]),
    'Subject: probe', '', 'body'].join('\r\n')
}
const record = (rawHeaders: string, recordedAt = '2026-10-04T10:00:00Z'): RelayTraceRecord =>
  ({ rawHeaders, originalSha256: sha(rawHeaders), probeId: PROBE, ownHosts: OWN, recordedAt })
const NOW = new Date('2026-10-04T12:00:00Z')

describe('TR-08 Received-header hop chain', () => {
  it('derives every hop and verifies only when all hops after our server carry TLS and SPF passes', () => {
    const v = verifyRelayTrace({ rawHeaders: trace(), probeId: PROBE, ownHosts: OWN })
    expect(v.verified).toBe(true)
    expect(v.reasons).toEqual([])
    expect(v.hops.map((h) => [h.role, h.by, h.with, h.tlsVersion])).toEqual([
      ['own_submission', 'smtp.own.example.invalid', 'ESMTPSA', 'TLS1.2'],
      ['relay', 'relay.provider.example.invalid', 'ESMTPS', 'TLS1.3'],
      ['relay', 'mx.mailbox.example.invalid', 'ESMTPS', 'TLS1.3'],
      ['mailbox_internal', 'mailbox.example.invalid', 'LMTP', null],
    ])
    expect(v.hops[2].cipher).toBe('TLS_AES_256_GCM_SHA384')
    expect(v.relayHopCount).toBe(2)
    expect(v.allRelayHopsTls).toBe(true)
    expect(v.rawHeadersSha256).toBe(sha(trace()))
  })

  it('TLS to the first server does not prove the next hop: one plaintext relay hop fails', () => {
    const v = verifyRelayTrace({ rawHeaders: trace({ mxHop: 'Received: from relay.provider.example.invalid ([192.0.2.20]) by mx.mailbox.example.invalid with ESMTP id b2; Sun, 4 Oct 2026 12:00:02 +0200' }), probeId: PROBE, ownHosts: OWN })
    expect(v.hops[0]).toMatchObject({ role: 'own_submission', tls: true })
    expect(v.verified).toBe(false)
    expect(v.allRelayHopsTls).toBe(false)
    expect(v.reasons).toEqual(['relay_hop_without_tls:2'])
  })

  it('rejects weak TLS on a relay hop', () => {
    const v = verifyRelayTrace({ rawHeaders: trace({ mxHop: 'Received: from r.example.invalid by mx.mailbox.example.invalid with ESMTPS id b2 (version=TLS1_0 cipher=AES128-SHA); Sun, 4 Oct 2026 12:00:02 +0200' }), probeId: PROBE, ownHosts: OWN })
    expect(v.verified).toBe(false)
    expect(v.reasons).toContain('relay_hop_weak_tls:2')
  })

  it('missing Received headers never verify', () => {
    const v = verifyRelayTrace({ rawHeaders: trace({ noReceived: true }), probeId: PROBE, ownHosts: OWN })
    expect(v.verified).toBe(false)
    expect(v.hops).toEqual([])
    expect(v.reasons).toContain('received_headers_missing')
  })

  it('requires our own server in the chain, at least one following relay hop, the probe id and SPF pass', () => {
    expect(verifyRelayTrace({ rawHeaders: trace(), probeId: PROBE, ownHosts: ['other.example.invalid'] }).reasons).toContain('own_server_not_found')
    const onlyOwn = ['Received: from app.example.invalid by smtp.own.example.invalid with ESMTPSA id d4 (TLSv1.3); Sun, 4 Oct 2026 12:00:00 +0200',
      'Authentication-Results: x; spf=pass', `X-Gridex-Relay-Probe: ${PROBE}`, ''].join('\r\n')
    expect(verifyRelayTrace({ rawHeaders: onlyOwn, probeId: PROBE, ownHosts: OWN }).reasons).toEqual(['no_relay_hop_after_own_server', 'spf_absent'])
    expect(verifyRelayTrace({ rawHeaders: trace({ probe: 'probe-other' }), probeId: PROBE, ownHosts: OWN }).reasons).toEqual(['probe_id_mismatch'])
    expect(verifyRelayTrace({ rawHeaders: trace({ spf: 'softfail' }), probeId: PROBE, ownHosts: OWN }).reasons).toEqual(['spf_fail'])
    expect(verifyRelayTrace({ rawHeaders: trace({ spf: null }), probeId: PROBE, ownHosts: OWN }).reasons).toEqual(['spf_absent'])
  })
})

describe('TR-08 transport readiness is bound to persisted read-back evidence', () => {
  it('port 465 reachable but no trace: not verified', () => {
    const r = relayTraceReadiness(null, { now: NOW, smtpPortReachable: true })
    expect(r).toMatchObject({ status: 'warning', allRelayHopsVerified: false, reasons: ['relay_trace_evidence_missing'] })
    expect(r.message).toContain('bevisar inte reläkedjan')
  })

  it('verified only from a hash-matching, fresh, re-verified original', () => {
    expect(relayTraceReadiness(record(trace()), { now: NOW })).toMatchObject({ status: 'ok', allRelayHopsVerified: true })
    expect(relayTraceReadiness({ ...record(trace()), originalSha256: 'f'.repeat(64) }, { now: NOW })).toMatchObject({ allRelayHopsVerified: false, reasons: ['relay_trace_hash_mismatch'] })
    expect(relayTraceReadiness(record(trace(), '2026-08-01T00:00:00Z'), { now: NOW })).toMatchObject({ allRelayHopsVerified: false, reasons: ['relay_trace_stale'] })
    const plain = trace({ relayHop: 'Received: from smtp.own.example.invalid by relay.provider.example.invalid with ESMTP id c3; Sun, 4 Oct 2026 12:00:01 +0200' })
    expect(relayTraceReadiness(record(plain), { now: NOW })).toMatchObject({ status: 'error', allRelayHopsVerified: false, reasons: ['relay_hop_without_tls:1'] })
  })

  it('mail readiness: reachable SMTP port is reported as reachability only and relay status stays unverified without evidence', async () => {
    vi.stubEnv('EDIEL_SMTP_FROM', 'ediel@own.example.invalid')
    net.tcpOk = true
    const { ediel } = await getMailReadiness({ now: NOW })
    const tcp = ediel.statuses.find((s) => s.key === 'smtp_tcp')!
    const relay = ediel.statuses.find((s) => s.key === 'relay_hop_tls')!
    expect(tcp.status).toBe('ok')
    expect(tcp.message).toContain('bevisar inte TLS')
    expect(relay).toMatchObject({ status: 'warning', diagnostics: { allRelayHopsVerified: false } })
    const verified = await getMailReadiness({ now: NOW, relayTrace: record(trace()) })
    expect(verified.ediel.statuses.find((s) => s.key === 'relay_hop_tls')).toMatchObject({ status: 'ok', diagnostics: { allRelayHopsVerified: true } })
    vi.unstubAllEnvs()
  })
})

describe('TR-08 operator probe (injected transports; no mail traffic)', () => {
  const env = {
    EDIEL_RELAY_PROBE_MAILBOX: 'probe@own.example.invalid', EDIEL_RELAY_PROBE_OWN_MAILBOX_CONFIRMED: 'true',
    EDIEL_RELAY_PROBE_OWN_HOSTS: 'smtp.own.example.invalid', EDIEL_RELAY_PROBE_COMPANY_ID: '00000000-0000-4000-8000-000000000001',
    EDIEL_RELAY_PROBE_ENVIRONMENT: 'test', EDIEL_RELAY_PROBE_ACTOR_USER_ID: '00000000-0000-4000-8000-000000000002',
    EDIEL_RELAY_PROBE_IMAP_HOST: 'imap.own.example.invalid', EDIEL_RELAY_PROBE_IMAP_USER: 'probe', EDIEL_RELAY_PROBE_IMAP_PASSWORD: 'synthetic-only',
    EDIEL_RELAY_PROBE_TIMEOUT_SECONDS: '30',
  }

  it('fails closed on missing env or unconfirmed own mailbox', () => {
    expect(() => relayProbeConfigFromEnv({})).toThrow(/relay_probe_env_missing/)
    expect(() => relayProbeConfigFromEnv({ ...env, EDIEL_RELAY_PROBE_OWN_MAILBOX_CONFIRMED: undefined })).toThrow(/own_mailbox_not_confirmed/)
    expect(() => relayProbeConfigFromEnv({ ...env, EDIEL_RELAY_PROBE_ENVIRONMENT: 'prod' })).toThrow(/environment_invalid/)
  })

  it('sends a probe-tagged message to the own mailbox, reads it back and persists the verdict over the original', async () => {
    const config = relayProbeConfigFromEnv(env)
    const sent: unknown[] = []
    const rpc = vi.fn(async () => ({ data: 'evidence-1', error: null }))
    let polls = 0
    const result = await runRelayTraceProbe(config, {
      probeId: () => PROBE,
      send: async (m) => { sent.push(m) },
      fetchHeaders: async (id) => (++polls < 2 ? null : trace({ probe: id })),
      persist: (raw, verdict) => recordRelayTrace({ rpc }, { companyId: config.companyId, environment: config.environment, actorUserId: config.actorUserId, rawHeaders: raw, verdict }),
      sleep: async () => {}, pollIntervalMs: 10_000,
    })
    expect(sent).toEqual([expect.objectContaining({ to: 'probe@own.example.invalid', headers: { 'X-Gridex-Relay-Probe': PROBE } })])
    expect(result).toMatchObject({ evidenceId: 'evidence-1', verdict: { verified: true } })
    expect(rpc).toHaveBeenCalledWith('ediel_record_relay_trace_v1', expect.objectContaining({
      p_company_id: config.companyId, p_environment: 'test', p_original: '\\x' + Buffer.from(trace()).toString('hex'),
      p_verdict: expect.objectContaining({ rawHeadersSha256: sha(trace()), verified: true }) }))
  })

  it('no read-back within the timeout yields no evidence (sent is not delivered-with-TLS)', async () => {
    const persist = vi.fn()
    const result = await runRelayTraceProbe(relayProbeConfigFromEnv(env), { probeId: () => PROBE, send: async () => {}, fetchHeaders: async () => null, persist, sleep: async () => {}, pollIntervalMs: 10_000 })
    expect(result).toEqual({ evidenceId: null, verdict: null, reason: 'relay_probe_not_delivered_within_timeout' })
    expect(persist).not.toHaveBeenCalled()
  })
})

describe('TR-08 independent-review contrasts (permissive verdicts must fail)', () => {
  it('a forged spf=pass from another authserv-id cannot mask the receiver SPF fail', () => {
    const raw = trace({ spf: 'fail' }).replace('X-Gridex-Relay-Probe', 'Authentication-Results: attacker.example.invalid; spf=pass smtp.mailfrom=own.example.invalid\r\nX-Gridex-Relay-Probe')
    const v = verifyRelayTrace({ rawHeaders: raw, probeId: PROBE, ownHosts: OWN })
    expect(v.spf).toBe('fail')
    expect(v.verified).toBe(false)
    const forgedOnly = trace({ spf: null }).replace('X-Gridex-Relay-Probe', 'Authentication-Results: attacker.example.invalid; spf=pass\r\nX-Gridex-Relay-Probe')
    expect(verifyRelayTrace({ rawHeaders: forgedOnly, probeId: PROBE, ownHosts: OWN })).toMatchObject({ spf: 'absent', verified: false })
  })

  it('a remote relay -> MX hop over plaintext LMTP is a relay hop without TLS, not mailbox-internal', () => {
    const v = verifyRelayTrace({ rawHeaders: trace({ mxHop: 'Received: from relay.provider.example.invalid (relay.provider.example.invalid [192.0.2.20])\r\n\tby mx.mailbox.example.invalid with LMTP id b2; Sun, 4 Oct 2026 12:00:02 +0200' }), probeId: PROBE, ownHosts: OWN })
    expect(v.hops[2].role).toBe('relay')
    expect(v.reasons).toContain('relay_hop_without_tls:2')
    expect(v.verified).toBe(false)
  })

  it('a disconnected Received chain (spliced or hidden hop) is rejected', () => {
    const v = verifyRelayTrace({ rawHeaders: trace({ mxHop: 'Received: from other.relay.example.invalid (other.relay.example.invalid [192.0.2.99])\r\n\tby mx.mailbox.example.invalid with ESMTPS id b2 (version=TLS1_3 cipher=TLS_AES_256_GCM_SHA384); Sun, 4 Oct 2026 12:00:02 +0200' }), probeId: PROBE, ownHosts: OWN })
    expect(v.reasons).toContain('received_chain_disconnected:2')
    expect(v.verified).toBe(false)
  })
})
