// TR-08 relay TLS/SPF trace evaluator (code-only component).
//
// TLS to our first SMTP server (smtp.strato.de:465, see mailReadiness) proves
// nothing about the following server hops, and a reachable port proves nothing
// at all. This pure evaluator parses the Received headers of a read-back
// message into an ordered hop chain, classifies each hop's TLS strictly from
// its RFC 3848 transmission type, and reads the SPF result recorded by the
// final receiving server. Any doubt yields verified=false with reasons.
//
// Re-landed from closed PR #543 (claude/tr-08-relay-trace, 29b63436) with the
// known weakness closed: duplicated/reordered hops and plaintext hops whose
// comments or stray text claim TLS can no longer produce verified=true.
// Whole TR-08 approval still requires a genuine provider test-mailbox trace.

export const RELAY_TRACE_SCHEMA = 'gridex_relay_trace_v2'
export const RELAY_TRACE_MAX_HEADER_BYTES = 64 * 1024
export const RELAY_TRACE_MAX_FIELDS = 500
export const RELAY_TRACE_MAX_FIELD_CHARS = 8 * 1024
export const RELAY_TRACE_MAX_HOPS = 30
/** Accepted backwards clock skew between consecutive hops. */
export const RELAY_TRACE_CLOCK_SKEW_MS = 30_000

export type HopTls = 'tls' | 'plaintext' | 'unknown' | 'ambiguous' | 'local_final_delivery'
export type SpfResult = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'missing' | 'conflicting'

export type RelayHop = {
  /** Chronological position, 0 = first (oldest) hop. */
  index: number
  from: string | null
  fromNames: string[]
  /** Sender recorded only as loopback (localhost, 127.0.0.0/8, ::1). */
  fromLoopback: boolean
  by: string | null
  protocol: string | null
  tls: HopTls
  tlsVersion: string | null
  timestamp: number | null
}

export type RelayTraceVerdict = {
  schema: typeof RELAY_TRACE_SCHEMA
  verified: boolean
  hops: RelayHop[]
  spf: SpfResult
  /** True only when the newest hop is an exempted local delivery step inside the final server. */
  localFinalDelivery: boolean
  /** Informational notes that do not block verification. */
  notes: string[]
  reasons: string[]
}

export type RelayTraceInput = {
  rawHeaders: string
  /** Informational only: reachability is never transport proof. */
  smtpPortReachable?: boolean
}

// RFC 3848: the trailing S (STARTTLS/implicit TLS) is the only accepted TLS signal.
const TLS_PROTOCOLS = new Set(['ESMTPS', 'ESMTPSA', 'UTF8SMTPS', 'UTF8SMTPSA', 'LMTPS', 'LMTPSA'])
const PLAINTEXT_PROTOCOLS = new Set(['SMTP', 'ESMTP', 'ESMTPA', 'UTF8SMTP', 'UTF8SMTPA', 'LMTP', 'LMTPA', 'LOCAL', 'HTTP'])
// Local delivery inside the final server (not a network relay hop).
const LOCAL_DELIVERY_PROTOCOLS = new Set(['LMTP', 'LOCAL'])
const CLAUSES = new Set(['from', 'by', 'via', 'with', 'id', 'for'])
const SPF_VALUES = new Set(['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror'])
const HOST_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

type Field = { name: string; value: string }

function fail(reasons: string[], hops: RelayHop[] = [], spf: SpfResult = 'missing'): RelayTraceVerdict {
  return { schema: RELAY_TRACE_SCHEMA, verified: false, hops, spf, localFinalDelivery: false, notes: [], reasons }
}

/** Strip RFC 5322 comments with a linear scan; returns null on unbalanced input. */
export function stripComments(value: string): { text: string; comments: string[]; commentAt: number[] } | null {
  let depth = 0
  let out = ''
  let current = ''
  const comments: string[] = []
  const commentAt: number[] = []
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '\\' && depth > 0) { current += value[i + 1] ?? ''; i++; continue }
    if (ch === '(') { if (depth > 0) current += ch; else commentAt.push(out.length); depth++; continue }
    if (ch === ')') {
      if (depth === 0) return null
      depth--
      if (depth === 0) { comments.push(current); current = ''; out += ' ' } else current += ch
      continue
    }
    if (depth > 0) current += ch
    else out += ch
  }
  return depth === 0 ? { text: out, comments, commentAt } : null
}

function isLoopbackLiteral(value: string): boolean {
  const v = value.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/^ipv6:/, '')
  if (v === 'localhost' || v === '::1') return true
  const parts = v.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)
}

/** Sender-scoped tokens from comments attached to the from clause (HELO, rDNS, address). */
function senderTokens(fromComments: string[]): string[] {
  const out: string[] = []
  for (const c of fromComments) {
    for (const t of c.split(/\s+/)) {
      if (!t) continue
      const eq = t.indexOf('=')
      out.push(eq >= 0 ? t.slice(eq + 1) : t)
    }
  }
  return out.filter(Boolean)
}

function isIpLiteral(value: string): boolean {
  const v = value.replace(/^\[/, '').replace(/\]$/, '').toLowerCase().replace(/^ipv6:/, '')
  if (v.includes(':')) return /^[0-9a-f:.]+$/.test(v)
  const parts = v.split('.')
  return parts.length === 4 && parts.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)
}

function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null
  const h = value.trim().toLowerCase().replace(/\.$/, '')
  return HOST_RE.test(h) ? h : null
}

function hostsRelated(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a)
}

function parseFields(raw: string, reasons: string[]): Field[] | null {
  const text = raw.split('\r\n').join('\n')
  const end = text.indexOf('\n\n')
  const block = end >= 0 ? text.slice(0, end) : text
  const fields: Field[] = []
  for (const line of block.split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && fields.length) {
      fields[fields.length - 1].value += ' ' + line.trim()
    } else {
      const colon = line.indexOf(':')
      if (colon <= 0) { if (line.trim()) reasons.push('malformed_header_line'); continue }
      fields.push({ name: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim() })
    }
    if (fields.length > RELAY_TRACE_MAX_FIELDS) { reasons.push('too_many_fields'); return null }
    if (fields[fields.length - 1]?.value.length > RELAY_TRACE_MAX_FIELD_CHARS) { reasons.push('field_oversized'); return null }
  }
  return fields
}

function tlsVersionsOf(value: string): Set<string> {
  const found = new Set<string>()
  // Collapse whitespace runs (tabs, repeated spaces) so every spaced form is matched.
  const upper = value.replace(/\s+/g, ' ').toUpperCase()
  if (upper.includes('SSLV2') || upper.includes('SSLV3')) found.add('SSLv3')
  // TLSv1.x, TLS v1.x, TLS 1.x, TLS1_x; single optional spaces only (no backtracking).
  for (const m of upper.matchAll(/TLS ?V? ?1[._]([0-3])/g)) found.add(`TLS1.${m[1]}`)
  if (/TLS ?V1(?![._0-9])/.test(upper)) found.add('TLS1.0')
  return found
}

function parseHop(value: string, index: number, reasons: string[]): RelayHop {
  const hop: RelayHop = { index, from: null, fromNames: [], fromLoopback: false, by: null, protocol: null, tls: 'unknown', tlsVersion: null, timestamp: null }
  const p = `hop_${index}`
  const stripped = stripComments(value)
  if (!stripped) { reasons.push(`${p}_malformed_comment`); hop.tls = 'ambiguous'; return hop }
  const semi = stripped.text.lastIndexOf(';')
  const clausesText = semi >= 0 ? stripped.text.slice(0, semi) : stripped.text
  const dateText = semi >= 0 ? stripped.text.slice(semi + 1).trim() : ''
  const ts = dateText ? Date.parse(dateText) : NaN
  if (Number.isFinite(ts)) hop.timestamp = ts
  else reasons.push(`${p}_timestamp_missing`)

  const located = [...clausesText.matchAll(/\S+/g)].map((m) => ({ text: m[0], at: m.index ?? 0 }))
  const tokens = located.map((t) => t.text)
  const seen = new Map<string, string>()
  let fromStart = -1
  let fromEnd = clausesText.length
  let ambiguous = false
  for (let i = 0; i < tokens.length; i++) {
    const kw = tokens[i].toLowerCase()
    if (!CLAUSES.has(kw)) continue
    if (fromStart >= 0 && fromEnd === clausesText.length) fromEnd = located[i].at
    if (kw === 'from' && fromStart < 0) fromStart = located[i].at
    const val = tokens[i + 1]
    if (val === undefined || CLAUSES.has(val.toLowerCase())) { reasons.push(`${p}_clause_${kw}_empty`); ambiguous = true; continue }
    if (seen.has(kw)) { reasons.push(`${p}_ambiguous_clause_${kw}`); ambiguous = true }
    else seen.set(kw, val)
    i++
  }
  hop.from = normalizeHost(seen.get('from'))
  hop.by = normalizeHost(seen.get('by'))
  if (!hop.by) reasons.push(`${p}_by_missing`)
  // Only comments attached to an actual from clause are sender-scoped.
  const rawFrom = seen.get('from')
  const fromComments = fromStart < 0 ? [] : stripped.comments.filter((_c, i) => stripped.commentAt[i] > fromStart && stripped.commentAt[i] <= fromEnd)
  const sTokens = senderTokens(fromComments)
  // Every bare token between `from` and the next clause is sender-scoped too.
  const rawSenderTokens = fromStart < 0 ? [] : located.filter((t) => t.at > fromStart && t.at < fromEnd).map((t) => t.text)
  hop.fromLoopback = Boolean(rawFrom && rawSenderTokens.length > 0 && rawSenderTokens.every(isLoopbackLiteral) && sTokens.every(isLoopbackLiteral))
  hop.fromNames = rawFrom
    ? [...new Set([hop.from, ...sTokens.map(normalizeHost)].filter((h): h is string => Boolean(h)))]
    : []
  if (!rawFrom || (!hop.from && !isIpLiteral(rawFrom) && !isLoopbackLiteral(rawFrom))) reasons.push(`${p}_sender_missing`)

  const protocol = seen.get('with')?.toUpperCase() ?? null
  hop.protocol = protocol
  const outsideVersions = tlsVersionsOf(clausesText)
  if (ambiguous) hop.tls = 'ambiguous'
  else if (!protocol) { hop.tls = 'unknown'; reasons.push(`${p}_protocol_missing`) }
  else if (TLS_PROTOCOLS.has(protocol)) hop.tls = 'tls'
  else if (PLAINTEXT_PROTOCOLS.has(protocol)) {
    hop.tls = 'plaintext'
    reasons.push(`${p}_plaintext`)
    if (outsideVersions.size || stripped.comments.some((c) => tlsVersionsOf(c).size)) reasons.push(`${p}_tls_claim_contradicts_protocol`)
  } else { hop.tls = 'unknown'; reasons.push(`${p}_protocol_unrecognized`) }

  if (hop.tls === 'tls') {
    const versions = tlsVersionsOf(value)
    if (versions.size > 1) { hop.tls = 'ambiguous'; reasons.push(`${p}_tls_version_ambiguous`) }
    else if (versions.size === 1) {
      hop.tlsVersion = [...versions][0]
      if (hop.tlsVersion !== 'TLS1.2' && hop.tlsVersion !== 'TLS1.3') reasons.push(`${p}_weak_tls`)
    }
  } else if (hop.tls === 'ambiguous') reasons.push(`${p}_tls_ambiguous`)
  return hop
}

function spfOf(field: Field, finalBy: string | null, reasons: string[]): SpfResult | null {
  const stripped = stripComments(field.value)
  if (!stripped) { reasons.push('spf_field_malformed'); return null }
  if (field.name === 'received-spf') {
    const word = stripped.text.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    return SPF_VALUES.has(word) ? (word as SpfResult) : null
  }
  const parts = stripped.text.split(';')
  const authserv = normalizeHost(parts[0]?.trim().split(/\s+/)[0])
  if (!hostsRelated(authserv, finalBy)) { reasons.push('spf_authserv_untrusted'); return null }
  const results = new Set<string>()
  for (const part of parts.slice(1)) {
    const t = part.trim().toLowerCase()
    if (!t.startsWith('spf=')) continue
    results.add(t.slice(4).split(/\s+/)[0])
  }
  if (results.size > 1) return 'conflicting'
  const only = [...results][0]
  return only && SPF_VALUES.has(only) ? (only as SpfResult) : null
}

/** Pure, strict TR-08 evaluator. Never throws; any doubt is verified=false with reasons. */
export function evaluateRelayTrace(input: RelayTraceInput): RelayTraceVerdict {
  const raw = input?.rawHeaders as unknown
  const reasons: string[] = []
  const reachable = input?.smtpPortReachable === true
  const done = (v: RelayTraceVerdict) => {
    if (!v.verified && reachable) v.reasons.push('port_reachability_is_not_transport_proof')
    return v
  }
  if (typeof raw !== 'string') return done(fail(['input_not_string']))
  if (Buffer.byteLength(raw, 'utf8') > RELAY_TRACE_MAX_HEADER_BYTES) return done(fail(['input_oversized']))
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) return done(fail(['input_control_characters']))

  const fields = parseFields(raw, reasons)
  if (!fields) return done(fail(reasons))

  // Header order is newest first; the chain is evaluated chronologically.
  const receivedPositions: number[] = []
  fields.forEach((f, i) => { if (f.name === 'received') receivedPositions.push(i) })
  if (receivedPositions.length === 0) return done(fail([...reasons, 'no_received_hops']))
  if (receivedPositions.length > RELAY_TRACE_MAX_HOPS) return done(fail([...reasons, 'too_many_hops']))

  const chronological = [...receivedPositions].reverse()
  const hops = chronological.map((pos, i) => parseHop(fields[pos].value, i, reasons))

  const normalized = chronological.map((pos) => fields[pos].value.replace(/\s+/g, ' ').trim().toLowerCase())
  if (new Set(normalized).size !== normalized.length) reasons.push('duplicate_hop')

  if (hops.length === 1) reasons.push('first_hop_only_trace')

  // Narrow exception: only the newest hop of a multi-hop chain, LMTP/LOCAL,
  // loopback sender, delivered by the same host that received the last relay hop.
  const notes: string[] = []
  const last = hops[hops.length - 1]
  const prevHop = hops.length > 1 ? hops[hops.length - 2] : null
  const localFinal = Boolean(
    prevHop && last.tls === 'plaintext' && last.protocol && LOCAL_DELIVERY_PROTOCOLS.has(last.protocol) &&
    last.fromLoopback && last.by !== null && last.by === prevHop.by,
  )
  if (localFinal) {
    last.tls = 'local_final_delivery'
    const drop = new Set([`hop_${last.index}_plaintext`])
    for (let i = reasons.length - 1; i >= 0; i--) if (drop.has(reasons[i])) reasons.splice(i, 1)
    notes.push(`hop_${last.index}_local_final_delivery_excluded_from_tls`)
  }
  const relayHops = localFinal ? hops.slice(0, -1) : hops

  for (let i = 1; i < relayHops.length; i++) {
    const prev = hops[i - 1], cur = hops[i]
    if (!cur.fromNames.some((n) => hostsRelated(n, prev.by))) {
      if (!reasons.includes('hop_chain_discontinuity')) reasons.push('hop_chain_discontinuity')
    }
    if (prev.timestamp !== null && cur.timestamp !== null && cur.timestamp + RELAY_TRACE_CLOCK_SKEW_MS < prev.timestamp) {
      if (!reasons.includes('hop_timestamps_out_of_order')) reasons.push('hop_timestamps_out_of_order')
    }
  }
  if (localFinal && last.timestamp !== null && prevHop?.timestamp != null && last.timestamp + RELAY_TRACE_CLOCK_SKEW_MS < prevHop.timestamp) {
    if (!reasons.includes('hop_timestamps_out_of_order')) reasons.push('hop_timestamps_out_of_order')
  }
  const byHosts = relayHops.map((h) => h.by).filter(Boolean)
  if (new Set(byHosts).size !== byHosts.length) reasons.push('hop_loop')
  if (relayHops.some((h) => h.tls !== 'tls')) reasons.push('not_all_hops_tls')

  // Only SPF results the final receiving server added (above the newest Received) count.
  const finalBy = hops[hops.length - 1].by
  const spfResults = new Set<SpfResult>()
  for (const f of fields.slice(0, receivedPositions[0])) {
    if (f.name !== 'authentication-results' && f.name !== 'received-spf') continue
    const r = spfOf(f, finalBy, reasons)
    if (r) spfResults.add(r)
  }
  let spf: SpfResult = 'missing'
  if (spfResults.size > 1 || spfResults.has('conflicting')) { spf = 'conflicting'; reasons.push('spf_conflicting') }
  else if (spfResults.size === 1) spf = [...spfResults][0]
  if (spf === 'missing') reasons.push('spf_missing')
  else if (spf !== 'pass' && spf !== 'conflicting') reasons.push('spf_not_pass')

  return done({ schema: RELAY_TRACE_SCHEMA, verified: reasons.length === 0, hops, spf, localFinalDelivery: localFinal, notes, reasons })
}
