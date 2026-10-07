// Bounded TR-09 / AT-TR-09 component regressions, not whole-contract or native proof.
// Real config, preflight, transport policy, route checks and SMTP consumer run.
// Registry/certification/source qualification are declared unit preconditions;
// database reads are finite IO. No exception capability or delivery is invented.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow, EdielRouteProfileRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({
  message: null as EdielMessageRow | null,
  route: null as EdielRouteProfileRow | null,
  from: vi.fn(), rpc: vi.fn(), admission: vi.fn(), qualification: vi.fn(),
  provider: vi.fn(), mail: vi.fn(), effects: [] as string[],
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ediel/db')>(),
  getEdielRouteProfileByCommunicationRouteId: async (id: string, scope: { companyId: string }) => {
    expect(id).toBe(io.message?.communication_route_id)
    expect(scope).toEqual({ companyId: io.message?.company_id })
    return io.route
  },
}))
vi.mock('@/lib/ediel/rulebook/sendGuards', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ediel/rulebook/sendGuards')>(),
  assertRegistryRulebookAllowsSend: io.admission,
}))
vi.mock('@/lib/ediel/scopedCapabilityReadiness', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ediel/scopedCapabilityReadiness')>(),
  assertScopedEdielProductionCapability: io.qualification,
}))
vi.mock('@/lib/ediel/production/sendValidationSources', () => ({
  readFreshEdielSendValidationSources: async (message: EdielMessageRow, actor: string) => {
    expect(message).toEqual(io.message)
    expect(actor).toBe('00000000-0000-4000-8000-000000000003')
    // The original passes real syntax below. Correlated ACK/source authority
    // is deliberately outside this encryption-policy component regression.
    return { deathStatusContext: undefined, customerMasterdataContext: undefined,
      ackSourceQualification: undefined, prodatCommonHeaderRejectionEvidence: undefined }
  },
}))
vi.mock('@/lib/ediel/mailReadiness', () => ({ assertEdielSmtpReadiness: io.mail }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: io.provider }))

import { evaluateProductionTransportSecurity } from '@/lib/ediel/config'
import { validateEdielSendContext, assertEdielSendContextConsistency } from '@/lib/ediel/sendContextConsistency'
import { applyMessageFamilyEncryptionPolicy } from '@/lib/ediel/transport/index.part-1'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const nonProdat = ['UTILTS', 'APERAK', 'CONTRL'] as const
type Family = 'PRODAT' | typeof nonProdat[number]
const plaintextModes = ['ediel-singlepart-base64', 'ediel-singlepart-lines', 'ediel-singlepart-compact',
  'ediel-multipart-validation-base64', 'nodemailer-attachment'] as const
const refusal = 'transport_exception_actual_approved_plaintext_source_required'
const snapshot = { profileKey: 'unit-declared-source-profile', profileVersionId: uid(5),
  version: 'unit-declared-source-version', checksum: 'a'.repeat(64) }

function original(family: Family, environment: 'production' | 'test' = 'production'): EdielMessageRow {
  const specs = {
    PRODAT: { code: 'Z03', token: 'PRODAT:D:97A:UN:E2SE6A', application: '23-DDQ-PRODAT',
      body: ['BGM+Z03+DOC+9+NA', 'DTM+137:202609301200:203', 'DTM+ZZZ:1:805', 'NAD+FR+11111:160:SVK+++++++SE', 'NAD+DO+22222:160:SVK+++++++SE', 'LIN+1'] },
    UTILTS: { code: 'E73', token: 'UTILTS:D:02B:UN:E5SE5A', application: '23-DDQ-E66-S',
      body: ['BGM+E73::260+DOC+9', 'DTM+137:202609301200:203', 'NAD+MS+11111:SVK:260', 'NAD+MR+22222:SVK:260', 'IDE+24+OBJECT'] },
    APERAK: { code: 'APERAK', token: 'APERAK:D:96A:UN:E2SE6A', application: '23-DDQ-PRODAT',
      body: ['BGM+++27', 'DTM+137:202609301200:203', 'RFF+ACW:SOURCE', 'NAD+FR+11111:160:SVK', 'NAD+DO+22222:160:SVK', 'ERC+42::260'] },
    CONTRL: { code: 'CONTRL', token: 'CONTRL:2:2:UN:EDIEL2', application: '23-DDQ-PRODAT',
      body: ['UCI+SOURCE+22222:14+11111:14+7'] },
  } satisfies Record<Family, { code: string; token: string; application: string; body: string[] }>
  const spec = specs[family]
  const raw = EdifactEnvelopeCodec.encode({ sender: '11111', receiver: '22222', senderQualifier: '14', receiverQualifier: '14',
    interchangeReference: `TR09${family}`, applicationReference: spec.application, environment,
    acknowledgementRequest: family !== 'CONTRL', createdAt: new Date('2026-09-30T12:00:00Z'),
    messages: [{ messageReference: 'M1', messageTypeToken: spec.token, businessSegments: spec.body }] })
  const message = { id: uid(1), company_id: uid(2), direction: 'outbound', environment, status: 'queued',
    communication_route_id: uid(4), message_standard: 'edifact', message_family: family, message_code: spec.code,
    message_version: family === 'UTILTS' ? 'E5SE5A' : family === 'CONTRL' ? 'EDIEL2' : 'E2SE6A',
    raw_payload: raw, parsed_payload: {}, receiver_email: 'recipient@example.invalid', sender_email: 'sender@example.invalid',
    sender_ediel_id: '11111', receiver_ediel_id: '22222', application_reference: spec.application,
    interchange_reference: `TR09${family}`, test_flag: environment === 'test' ? 1 : 0,
    ack_outcome: family === 'APERAK' ? 'negative' : null } as EdielMessageRow
  expect(EdifactEnvelopeCodec.decode(raw).environment).toBe(environment)
  const syntax = validateEdifactSyntax({ ...message, status: 'received' })
  expect(syntax.ok, JSON.stringify(syntax.issues)).toBe(true)
  return message
}

function configure(family: Family, mode: 'none' | 'smime', environment: 'production' | 'test' = 'production') {
  io.message = original(family, environment)
  io.route = { id: uid(6), company_id: uid(2), communication_route_id: uid(4), environment,
    message_family: family, business_code: io.message.message_code, encryption_mode: mode,
    transport_security_mode: mode === 'smime' ? 'required_encrypted' : 'unencrypted',
    certificate_id: null, receiver_certificate_id: null, tls_required: true,
    allow_unencrypted_production: true, allow_unencrypted_production_reason: 'Synthetic operator request only',
    allow_unencrypted_production_expires_at: '2099-01-01T00:00:00Z',
    metadata: {} } as unknown as EdielRouteProfileRow
  return io.message
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(new Date('2026-09-30T12:00:00Z'))
  io.effects = []
  io.mail.mockImplementation(() => { io.effects.push('mail'); throw Error('UNIT_MAIL_BOUNDARY_REACHED') })
  io.provider.mockImplementation(() => { io.effects.push('smtp'); throw Error('UNEXPECTED_PROVIDER_ENTRY') })
  io.qualification.mockImplementation(async (message: EdielMessageRow) => { expect(message).toEqual(io.message) })
  io.admission.mockImplementation(async (message: EdielMessageRow) => {
    expect(message).toEqual(io.message)
    return { ok: true, issues: [], rulePackSnapshot: snapshot, canonicalPolicy: null,
      technicalSyntaxAckEvidence: message.message_family === 'CONTRL' ? {
        kind: 'technical_syntax_ack', version: 1, companyId: uid(2), environment: message.environment,
        sourceMessageId: uid(7), sourceHash: 'b'.repeat(64), observedAt: '2026-09-30T11:59:00Z',
        syntaxAssessmentId: uid(8), syntaxDecision: 'accepted', transportActorId: uid(3), transportEdielId: '11111',
        originalUNB: { sender: ['22222', '14'], receiver: ['11111', '14'], interchangeReference: 'SOURCE',
          uciReference: 'SOURCE', applicationReference: '23-DDQ-PRODAT', testIndicator: message.environment === 'test' ? '1' : '' },
      } : null }
  })
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'gridex_ediel_accepted_transport_projection_v1') {
      expect(args).toEqual({ p_company_id: uid(2), p_environment: io.message?.environment,
        p_actor_user_id: uid(3), p_message_id: uid(1) })
      return { data: null, error: null }
    }
    if (name === 'gridex_ediel_negative_fixture_read_v1') return { data: null, error: null }
    if (name === 'ediel_capture_source_rule_pack_basis_v1') {
      expect(args).toEqual({ p_company_id: uid(2), p_message_id: uid(1) })
      return { data: { rulePackId: uid(9), messageProfileId: uid(5), profileKey: snapshot.profileKey,
        version: snapshot.version, sourceHash: snapshot.checksum, snapshot }, error: null }
    }
    if (name === 'ediel_reserve_wire_reference_namespace_v1') {
      expect(args).toEqual({ p_company_id: uid(2), p_message_id: uid(1) })
      return { data: null, error: null }
    }
    io.effects.push(`rpc:${name}`)
    throw Error(`UNDECLARED_RPC:${name}`)
  })
  io.from.mockImplementation((table: string) => {
    const filters: Array<[string, unknown]> = []
    const rows = () => {
      if (table === 'ediel_route_profiles') return io.route ? [io.route] : []
      if (['ediel_test_run_messages', 'ediel_counterparties'].includes(table)) return []
      throw Error(`UNDECLARED_TABLE:${table}`)
    }
    const result = () => ({ data: rows().filter(row => filters.every(([key, value]) => Reflect.get(row, key) === value)), error: null })
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
      order: () => q, limit: () => q, or: () => q,
      maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
      insert: () => { io.effects.push(`insert:${table}`); throw Error('UNEXPECTED_DATABASE_WRITE') },
      update: () => { io.effects.push(`update:${table}`); throw Error('UNEXPECTED_DATABASE_WRITE') },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve) }
    return q
  })
})
afterEach(() => vi.useRealTimers())

describe('production family policy through real public consumers', () => {
  it.each(nonProdat)('config rejects production %s plaintext without activating legacy reason/expiry flags', family => {
    const message = configure(family, 'none')
    const result = evaluateProductionTransportSecurity({ runtime: { environment: message.environment,
      message_standard: message.message_standard, message_family: family, encryption_mode: 'none',
      transport_security_mode: 'unencrypted', certificate_id: null, allow_unencrypted_production: true,
      allow_unencrypted_production_reason: 'Synthetic operator request only', allow_unencrypted_production_expires_at: '2099-01-01T00:00:00Z' } })
    expect(result.overrideActive).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.issues.some(issue => issue.severity === 'error')).toBe(true)
  })

  it('retains the PRODAT config refusal diagnostic and rejects its legacy plaintext request', () => {
    const result = evaluateProductionTransportSecurity({ runtime: { environment: 'production', message_standard: 'edifact',
      message_family: 'PRODAT', encryption_mode: 'none', certificate_id: null, allow_unencrypted_production: true,
      allow_unencrypted_production_reason: 'Synthetic operator request only', allow_unencrypted_production_expires_at: '2099-01-01T00:00:00Z' } })
    expect(result.ok).toBe(false)
    expect(result.overrideActive).toBe(false)
    expect(result.issues.map(issue => issue.key)).toContain('production_prodat_smime_required')
  })

  it.each(nonProdat)('preflight refuses production %s default plaintext despite the legacy flag', async family => {
    const message = configure(family, 'none')
    const before = structuredClone(message)
    const result = await validateEdielSendContext({ message })
    expect(result.ok).toBe(false)
    expect(result.blockingIssues.map(issue => issue.code)).toContain('production_requires_smime')
    expect(message).toEqual(before)
    expect(io.effects).toEqual([])
  })

  it('retains the existing PRODAT preflight refusal diagnostic', async () => {
    const message = configure('PRODAT', 'none')
    io.route!.allow_unencrypted_production = false
    const result = await validateEdielSendContext({ message })
    expect(result.ok).toBe(false)
    expect(result.blockingIssues.map(issue => issue.code)).toContain('production_prodat_requires_smime')
    expect(io.effects).toEqual([])
  })

  it('PRODAT preflight cannot use the legacy route flag as production plaintext authority', async () => {
    const message = configure('PRODAT', 'none')
    expect((await validateEdielSendContext({ message })).ok).toBe(false)
    expect(io.effects).toEqual([])
  })

  it.each(nonProdat)('preflight preserves production %s S/MIME without a bilateral opt-in', async family => {
    const message = configure(family, 'smime')
    const result = await validateEdielSendContext({ message })
    expect(result.ok).toBe(true)
    expect(result.resolvedEncryptionMode).toBe('smime')
    expect(result.resolvedSmtpMimeMode).toBe('ediel-smime-enveloped')
    expect(io.effects).toEqual([])
  })

  it.each(nonProdat)('preflight rejects a production %s plaintext MIME override on an S/MIME route', async family => {
    const message = configure(family, 'smime')
    // The supported materialized 'encrypted' policy keeps the old exact
    // 'required_encrypted' mismatch check from masking this independent gap.
    io.route!.transport_security_mode = 'encrypted'
    io.route!.metadata = { bilateralSmimeException: true }
    const result = await validateEdielSendContext({ message, smtpMimeModeOverride: 'ediel-singlepart-base64' })
    expect(result.ok).toBe(false)
    expect(result.blockingIssues.map(issue => issue.code)).toContain('production_requires_smime')
    expect(io.effects).toEqual([])
  })

  it('the public enforcing preflight throws and records its refusal before any provider entry', async () => {
    const message = configure('UTILTS', 'none')
    await expect(assertEdielSendContextConsistency({ message, actorUserId: uid(3) })).rejects.toThrow(/production.*S\/MIME|S\/MIME.*production/i)
    // The audit sink is intentionally unavailable. Its attempted write cannot
    // erase the real preflight refusal or authorize SMTP.
    expect(io.effects).toEqual(['insert:ediel_message_events'])
    expect(io.provider).not.toHaveBeenCalled()
  })

  it.each(nonProdat)('the actual production %s sender holds default plaintext before mail, writes, attempt or SMTP', async family => {
    const message = configure(family, 'none'), before = structuredClone(message)
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: uid(3) })).rejects.toThrow(refusal)
    expect(io.effects).toEqual([])
    expect(message).toEqual(before)
  })

  for (const mode of plaintextModes) {
    it.each(nonProdat)(`the actual production %s sender refuses ${mode} on an S/MIME route`, async family => {
      const message = configure(family, 'smime'), before = structuredClone(message)
      await expect(sendEdielMessageViaSmtp(message, { actorUserId: uid(3), smtpMimeMode: mode })).rejects.toThrow(refusal)
      expect(io.effects).toEqual([])
      expect(message).toEqual(before)
    })
  }

  it.each(nonProdat)('the actual production %s sender retains S/MIME and requires its receiver certificate', async family => {
    const message = configure(family, 'smime'), before = structuredClone(message)
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: uid(3) })).rejects.toThrow('certificate_missing')
    expect(io.effects).toEqual([])
    expect(message).toEqual(before)
  })

  it('the PRODAT production sender still refuses its legacy route plaintext switch', async () => {
    const message = configure('PRODAT', 'none')
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: uid(3) })).rejects.toThrow(refusal)
    expect(io.effects).toEqual([])
  })

  it.each(nonProdat)('retains %s test-environment bilateral opt-in behavior and permits ordinary plaintext preflight', async family => {
    configure(family, 'smime', 'test')
    const args = { messageFamily: family, environment: 'test', requestedEncryptionMode: 'smime', routeProfile: io.route }
    expect(applyMessageFamilyEncryptionPolicy(args)).toBe('none')
    io.route!.metadata = { bilateralSmimeException: true }
    expect(applyMessageFamilyEncryptionPolicy(args)).toBe('smime')
    configure(family, 'none', 'test')
    expect((await validateEdielSendContext({ message: io.message! })).ok).toBe(true)
    expect(io.effects).toEqual([])
  })
})
