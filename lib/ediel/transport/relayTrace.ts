// TR-08 relay-trace evidence (owner decision 2026-10-04).
//
// TLS to our first SMTP server (sendEdielEmail: requireTLS/minVersion) proves
// nothing about the following server hops, and a reachable port 465 proves
// nothing at all. The only accepted transport proof is a test message sent to
// an operator-owned mailbox and read back: its Received headers are parsed into
// a hop chain and every hop after our own submission server must show TLS.
//
// This module is deliberately import-free (node built-ins and type-only
// imports) so the operator launcher can load it with
// `node --experimental-strip-types` without a bundler.
import { createHash } from 'node:crypto'

export const RELAY_TRACE_SCHEMA = 'gridex_relay_trace_v1'
export const RELAY_PROBE_HEADER = 'X-Gridex-Relay-Probe'
export const RELAY_TRACE_MAX_AGE_DAYS = 30

export type RelayHopRole = 'before_own_server' | 'own_submission' | 'relay' | 'mailbox_internal'

export type RelayHop = {
  index: number
  from: string | null
  by: string | null
  with: string | null
  tls: boolean
  tlsVersion: string | null
  cipher: string | null
  weakTls: boolean
  role: RelayHopRole
}

export type RelayTraceVerdict = {
  schema: typeof RELAY_TRACE_SCHEMA
  probeId: string
  rawHeadersSha256: string
  ownHosts: string[]
  hops: RelayHop[]
  relayHopCount: number
  allRelayHopsTls: boolean
  spf: 'pass' | 'fail' | 'absent'
  verified: boolean
  reasons: string[]
}

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

/** Header block of an RFC 5322 message (or a bare header dump), unfolded. */
export function parseHeaderFields(raw: string): Array<{ name: string; value: string }> {
  const text = raw.replace(/\r\n/g, '\n')
  const end = text.search(/\n\n/)
  const block = end >= 0 ? text.slice(0, end) : text
  const fields: Array<{ name: string; value: string }> = []
  for (const line of block.split('\n')) {
    if (/^[ \t]/.test(line) && fields.length) {
      fields[fields.length - 1].value += ' ' + line.trim()
      continue
    }
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    fields.push({ name: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim() })
  }
  return fields
}

// RFC 3848 transmission types: a trailing S (or SA) means STARTTLS/implicit TLS.
const TLS_PROTOCOLS = new Set(['ESMTPS', 'ESMTPSA', 'UTF8SMTPS', 'UTF8SMTPSA', 'LMTPS', 'LMTPSA'])
const INTERNAL_PROTOCOLS = new Set(['LMTP', 'LMTPS', 'LMTPSA', 'LOCAL'])
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[?::1\]?|\[127\.0\.0\.1\])$/i

function tlsVersionOf(value: string): string | null {
  if (/\bSSLv[23]\b/i.test(value)) return 'SSLv3'
  const m = value.match(/TLS\s*v?\s*1[._](\d)/i) ?? value.match(/version=TLS1_(\d)/i)
  if (m) return `TLS1.${m[1]}`
  if (/\bTLSv1\b(?![._\d])/i.test(value)) return 'TLS1.0'
  return null
}

function hostMatches(host: string | null, ownHosts: string[]): boolean {
  if (!host) return false
  const h = host.toLowerCase().replace(/\.$/, '')
  return ownHosts.some((own) => h === own || h.endsWith('.' + own))
}

export function parseReceivedHop(value: string, index: number): Omit<RelayHop, 'role'> {
  const from = value.match(/^\s*from\s+([^\s;()]+)/i)?.[1] ?? null
  const by = value.match(/\bby\s+([^\s;()]+)/i)?.[1] ?? null
  const withProto = value.match(/\bwith\s+([A-Za-z0-9-]+)/i)?.[1]?.toUpperCase() ?? null
  const tlsVersion = tlsVersionOf(value)
  const cipher = value.match(/cipher[=\s]+([A-Za-z0-9_-]+)/i)?.[1] ?? null
  const weakTls = tlsVersion === 'SSLv3' || tlsVersion === 'TLS1.0' || tlsVersion === 'TLS1.1'
  const tls = Boolean((withProto && TLS_PROTOCOLS.has(withProto)) || tlsVersion)
  return { index, from, by, with: withProto, tls, tlsVersion, cipher, weakTls }
}

export function normalizeOwnHosts(hosts: Iterable<string>): string[] {
  return [...new Set([...hosts].map((h) => h.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean))]
}

/**
 * Derive the hop chain from a read-back test message and decide whether every
 * hop after our own submission server carried TLS. Pure and deterministic.
 */
export function verifyRelayTrace(input: { rawHeaders: string; probeId: string; ownHosts: string[] }): RelayTraceVerdict {
  const ownHosts = normalizeOwnHosts(input.ownHosts)
  const fields = parseHeaderFields(input.rawHeaders)
  const reasons: string[] = []
  // Received headers are prepended: reverse to chronological order.
  const received = fields.filter((f) => f.name === 'received').map((f) => f.value).reverse()
  const parsed = received.map((value, index) => parseReceivedHop(value, index))
  if (!input.probeId || !fields.some((f) => f.name === RELAY_PROBE_HEADER.toLowerCase() && f.value === input.probeId)) reasons.push('probe_id_mismatch')
  if (!ownHosts.length) reasons.push('own_hosts_not_configured')
  if (!parsed.length) reasons.push('received_headers_missing')

  const ownIndex = parsed.findIndex((hop) => hostMatches(hop.by, ownHosts))
  if (parsed.length && ownHosts.length && ownIndex < 0) reasons.push('own_server_not_found')

  const hops: RelayHop[] = parsed.map((hop) => {
    let role: RelayHopRole
    if (ownIndex < 0 || hop.index < ownIndex) role = 'before_own_server'
    else if (hop.index === ownIndex) role = 'own_submission'
    else if ((hop.with && INTERNAL_PROTOCOLS.has(hop.with)) || (hop.from && LOOPBACK.test(hop.from))) role = 'mailbox_internal'
    else role = 'relay'
    return { ...hop, role }
  })
  const relays = hops.filter((hop) => hop.role === 'relay')
  if (ownIndex >= 0 && !relays.length) reasons.push('no_relay_hop_after_own_server')
  for (const hop of relays) {
    if (!hop.tls) reasons.push(`relay_hop_without_tls:${hop.index}`)
    else if (hop.weakTls) reasons.push(`relay_hop_weak_tls:${hop.index}`)
  }
  const allRelayHopsTls = relays.length > 0 && relays.every((hop) => hop.tls && !hop.weakTls)

  const auth = fields.filter((f) => f.name === 'authentication-results' || f.name === 'received-spf')
  const spfValues = auth.map((f) => (f.name === 'received-spf' ? f.value.split(/\s/)[0] : f.value.match(/\bspf=(\w+)/i)?.[1] ?? '').toLowerCase()).filter(Boolean)
  const spf: RelayTraceVerdict['spf'] = !spfValues.length ? 'absent' : spfValues[0] === 'pass' ? 'pass' : 'fail'
  if (spf !== 'pass') reasons.push(`spf_${spf}`)

  return {
    schema: RELAY_TRACE_SCHEMA,
    probeId: input.probeId,
    rawHeadersSha256: sha256(input.rawHeaders),
    ownHosts,
    hops,
    relayHopCount: relays.length,
    allRelayHopsTls,
    spf,
    verified: reasons.length === 0,
    reasons,
  }
}

/** Persisted read-back evidence as stored by ediel_record_relay_trace_v1. */
export type RelayTraceRecord = {
  rawHeaders: string
  originalSha256: string
  probeId: string
  ownHosts: string[]
  recordedAt: string
}

export type RelayTraceReadiness = {
  key: 'relay_hop_tls'
  status: 'ok' | 'warning' | 'error'
  allRelayHopsVerified: boolean
  message: string
  reasons: string[]
}

/**
 * Transport readiness for TR-08. Never true from configuration, TCP/port
 * reachability or a stored boolean: the persisted original is hash-checked and
 * re-verified on every evaluation.
 */
export function relayTraceReadiness(record: RelayTraceRecord | null, opts: { now?: Date; smtpPortReachable?: boolean } = {}): RelayTraceReadiness {
  const portNote = opts.smtpPortReachable ? ' SMTP-porten är nåbar, men det bevisar inte reläkedjan.' : ''
  if (!record) {
    return { key: 'relay_hop_tls', status: 'warning', allRelayHopsVerified: false, reasons: ['relay_trace_evidence_missing'],
      message: 'Inget återläst leveransspår finns; transporten är inte verifierad hela vägen.' + portNote }
  }
  if (sha256(record.rawHeaders) !== record.originalSha256) {
    return { key: 'relay_hop_tls', status: 'error', allRelayHopsVerified: false, reasons: ['relay_trace_hash_mismatch'],
      message: 'Leveransspårets original matchar inte sin hash.' }
  }
  const now = opts.now ?? new Date()
  const recordedAt = Date.parse(record.recordedAt)
  if (!Number.isFinite(recordedAt) || recordedAt > now.getTime() || now.getTime() - recordedAt > RELAY_TRACE_MAX_AGE_DAYS * 86_400_000) {
    return { key: 'relay_hop_tls', status: 'warning', allRelayHopsVerified: false, reasons: ['relay_trace_stale'],
      message: `Leveransspåret är äldre än ${RELAY_TRACE_MAX_AGE_DAYS} dagar eller saknar giltig tid; kör en ny återläsning.` + portNote }
  }
  const verdict = verifyRelayTrace({ rawHeaders: record.rawHeaders, probeId: record.probeId, ownHosts: record.ownHosts })
  return verdict.verified
    ? { key: 'relay_hop_tls', status: 'ok', allRelayHopsVerified: true, reasons: [],
        message: `Återläst leveransspår: ${verdict.relayHopCount} reläsprång efter vår server, alla med TLS; SPF pass.` }
    : { key: 'relay_hop_tls', status: 'error', allRelayHopsVerified: false, reasons: verdict.reasons,
        message: `Leveransspåret verifierar inte transporten: ${verdict.reasons.join(', ')}.` + portNote }
}

// ---------------------------------------------------------------------------
// Persistence (DB re-checks hash and verdict consistency) and operator probe.

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> }

export async function recordRelayTrace(client: RpcClient, input: {
  companyId: string; environment: 'test' | 'production'; actorUserId: string; rawHeaders: string; verdict: RelayTraceVerdict
}): Promise<string> {
  const { data, error } = await client.rpc('ediel_record_relay_trace_v1', {
    p_company_id: input.companyId,
    p_environment: input.environment,
    p_actor_user_id: input.actorUserId,
    p_original: '\\x' + Buffer.from(input.rawHeaders, 'utf8').toString('hex'),
    p_verdict: input.verdict,
  })
  if (error) throw new Error(`relay_trace_record_failed: ${error.message}`)
  if (typeof data !== 'string') throw new Error('relay_trace_record_failed: no id')
  return data
}

export type RelayProbeConfig = {
  mailbox: string
  ownHosts: string[]
  companyId: string
  environment: 'test' | 'production'
  actorUserId: string
  imap: { host: string; port: number; user: string; password: string; mailbox: string }
  timeoutSeconds: number
}

const PROBE_ENV = ['EDIEL_RELAY_PROBE_MAILBOX', 'EDIEL_RELAY_PROBE_OWN_HOSTS', 'EDIEL_RELAY_PROBE_COMPANY_ID', 'EDIEL_RELAY_PROBE_ENVIRONMENT',
  'EDIEL_RELAY_PROBE_ACTOR_USER_ID', 'EDIEL_RELAY_PROBE_IMAP_HOST', 'EDIEL_RELAY_PROBE_IMAP_USER', 'EDIEL_RELAY_PROBE_IMAP_PASSWORD'] as const

export function relayProbeConfigFromEnv(env: Record<string, string | undefined>): RelayProbeConfig {
  const missing = PROBE_ENV.filter((k) => !env[k]?.trim())
  if (missing.length) throw new Error(`relay_probe_env_missing: ${missing.join(', ')}`)
  const environment = env.EDIEL_RELAY_PROBE_ENVIRONMENT!.trim()
  if (environment !== 'test' && environment !== 'production') throw new Error('relay_probe_environment_invalid')
  if (env.EDIEL_RELAY_PROBE_OWN_MAILBOX_CONFIRMED !== 'true') throw new Error('relay_probe_own_mailbox_not_confirmed')
  const mailbox = env.EDIEL_RELAY_PROBE_MAILBOX!.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox)) throw new Error('relay_probe_mailbox_invalid')
  return {
    mailbox,
    ownHosts: normalizeOwnHosts(env.EDIEL_RELAY_PROBE_OWN_HOSTS!.split(',')),
    companyId: env.EDIEL_RELAY_PROBE_COMPANY_ID!.trim(),
    environment,
    actorUserId: env.EDIEL_RELAY_PROBE_ACTOR_USER_ID!.trim(),
    imap: {
      host: env.EDIEL_RELAY_PROBE_IMAP_HOST!.trim(),
      port: Number(env.EDIEL_RELAY_PROBE_IMAP_PORT ?? 993),
      user: env.EDIEL_RELAY_PROBE_IMAP_USER!.trim(),
      password: env.EDIEL_RELAY_PROBE_IMAP_PASSWORD!,
      mailbox: env.EDIEL_RELAY_PROBE_IMAP_MAILBOX?.trim() || 'INBOX',
    },
    timeoutSeconds: Number(env.EDIEL_RELAY_PROBE_TIMEOUT_SECONDS ?? 300),
  }
}

export type RelayProbeDeps = {
  probeId: () => string
  send: (message: { to: string; subject: string; text: string; headers: Record<string, string> }) => Promise<void>
  /** Raw header block of the read-back message carrying the probe header, or null if not (yet) delivered. */
  fetchHeaders: (probeId: string) => Promise<string | null>
  persist: (rawHeaders: string, verdict: RelayTraceVerdict) => Promise<string>
  sleep: (ms: number) => Promise<void>
  pollIntervalMs?: number
}

export async function runRelayTraceProbe(config: RelayProbeConfig, deps: RelayProbeDeps): Promise<{ evidenceId: string | null; verdict: RelayTraceVerdict | null; reason?: string }> {
  const probeId = deps.probeId()
  await deps.send({
    to: config.mailbox,
    subject: `Gridex TR-08 relay trace probe ${probeId}`,
    text: 'Syntetiskt testmeddelande för TR-08 leveransspår. Innehåller inga Ediel-data.',
    headers: { [RELAY_PROBE_HEADER]: probeId },
  })
  const interval = deps.pollIntervalMs ?? 10_000
  const attempts = Math.max(1, Math.ceil((config.timeoutSeconds * 1000) / interval))
  for (let i = 0; i < attempts; i++) {
    const rawHeaders = await deps.fetchHeaders(probeId)
    if (rawHeaders) {
      const verdict = verifyRelayTrace({ rawHeaders, probeId, ownHosts: config.ownHosts })
      return { evidenceId: await deps.persist(rawHeaders, verdict), verdict }
    }
    if (i < attempts - 1) await deps.sleep(interval)
  }
  return { evidenceId: null, verdict: null, reason: 'relay_probe_not_delivered_within_timeout' }
}
