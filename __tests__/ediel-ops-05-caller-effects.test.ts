// masterplan: OPS-05, AT-OPS-05
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Row = Record<string, unknown>
const port = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  calls: [] as Array<{ name: string; args: Row }>,
  writes: [] as Array<{ table: string; operation: string; value: unknown }>,
  fault: null as Error | null,
  initialSourceReadFault: false,
  legalIdentityReadFault: false,
  sourceReceiptMismatch: false,
  wire: '',
  ack: {} as Row,
  retainedAckSnapshot: {} as Row,
  mime: '',
}))

// Only the external DB and IMAP ports are replaced. Runtime, admission, ACK
// original qualification, coordinator, writer and alarm consumer are actual.
vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Array<(row: Row) => boolean> = []
    selection = '*'
    operation = 'read'
    value: Row | Row[] = {}
    maximum = Infinity
    one = false
    exactCount = false
    constructor(readonly table: string) {}
    select(value = '*', options?: { count?: string }) { this.selection = value; this.exactCount = options?.count === 'exact'; return this }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
    neq(key: string, value: unknown) { this.filters.push(row => row[key] !== value); return this }
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this }
    is(key: string, value: unknown) { this.filters.push(row => (row[key] ?? null) === value); return this }
    not(key: string, op: string, value: unknown) { if (op !== 'is') throw Error(`Unexpected operator ${op}`); this.filters.push(row => (row[key] ?? null) !== value); return this }
    lt(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) < value); return this }
    lte(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) <= value); return this }
    gte(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) >= value); return this }
    gt(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) > value); return this }
    ilike(key: string, value: string) { const pattern = new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i'); this.filters.push(row => pattern.test(String(row[key] ?? ''))); return this }
    or(expression: string) {
      const alternatives = expression.split(',').map(part => {
        const match = /^([^.]+)\.(eq|is|lt)\.(.*)$/.exec(part)
        if (!match) throw Error(`Unexpected OR ${expression}`)
        const [, key, op, value] = match
        return (row: Row) => op === 'eq' ? String(row[key] ?? '') === value : op === 'is' ? value === 'null' && row[key] == null : row[key] != null && String(row[key]) < value
      })
      this.filters.push(row => alternatives.some(filter => filter(row)))
      return this
    }
    contains(key: string, value: Row) { this.filters.push(row => Object.entries(value).every(([k, v]) => (row[key] as Row | undefined)?.[k] === v)); return this }
    order() { return this }
    limit(maximum: number) { this.maximum = maximum; return this }
    abortSignal() { return this }
    update(value: Row) { this.operation = 'update'; this.value = value; return this }
    insert(value: Row | Row[]) { this.operation = 'insert'; this.value = value; return this }
    upsert(value: Row | Row[]) { this.operation = 'upsert'; this.value = value; return this }
    maybeSingle() { this.one = true; return this }
    single() { this.one = true; return this }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => {
        if (port.initialSourceReadFault && this.table === 'ediel_messages' && this.operation === 'read' && this.selection === '*') throw Error('initial_source_read_unavailable')
        if (port.legalIdentityReadFault && this.table === 'tenant_actor_identifiers' && this.operation === 'read') throw Error('legal_identity_read_unavailable')
        const all = port.tables[this.table] ?? []
        const selected = all.filter(row => this.filters.every(filter => filter(row)))
        let rows: Row[]
        if (this.operation === 'read') rows = selected.slice(0, this.maximum)
        else {
          const allowed = ['ediel_messages', 'ediel_message_events', 'ediel_mailboxes', 'ediel_inbound_poll_runs', 'ediel_processing_runs', 'ediel_decision_traces', 'ediel_sla_timers', 'ediel_inbound_cases', 'audit_logs']
          if (!allowed.includes(this.table)) throw Error(`Unexpected write ${this.table}`)
          port.writes.push({ table: this.table, operation: this.operation, value: structuredClone(this.value) })
          if (this.operation === 'update') {
            for (const row of selected) Object.assign(row, structuredClone(this.value))
            rows = selected
          } else {
            rows = (Array.isArray(this.value) ? this.value : [this.value]).map((value, index) => ({ id: `${this.table}-${all.length + index + 1}`, created_at: new Date().toISOString(), ...structuredClone(value) }))
            port.tables[this.table] = [...all, ...rows]
          }
        }
        return { data: structuredClone(this.one ? rows[0] ?? null : rows), error: null, ...(this.exactCount ? { count: selected.length } : {}) }
      }).then(resolve, reject)
    }
  }
  const hash = (value: unknown) => createHash('sha256').update(String(value), 'utf8').digest('hex')
  const rpc = (name: string, args: Row) => {
    port.calls.push({ name, args: structuredClone(args) })
    const promise = Promise.resolve().then(() => {
      const company = '00000000-0000-4000-8000-000000000002'
      const actor = '00000000-0000-4000-8000-000000000050'
      const source = port.tables.ediel_messages[0]
      const originalUNB = { sender: ['12345', '14'], receiver: ['54321', '14'], interchangeReference: 'I', uciReference: 'I', applicationReference: '23-DDQ-PRODAT', testIndicator: '1' }
      const technical = { companyId: company, environment: 'test', sourceMessageId: source.id, sourceHash: hash(port.wire), transportEdielId: '54321', originalUNB }
      if (name === 'gridex_actor_has_company_permission') return { data: args.p_actor_user_id === actor && args.p_company_id === company && ['communication.write', 'ediel_testing.write'].includes(String(args.p_permission)), error: null }
      if (name === 'ediel_read_technical_source_endpoint_v2') return { data: { ...technical, executionActorUserId: actor, executionPhase: 'prepare', kind: 'technical_endpoint_only', authorizesBusinessEffect: false }, error: null }
      if (name === 'ediel_record_technical_syntax_facet_v2') return { data: { status: 'recorded' }, error: null }
      if (name === 'ediel_capture_technical_syntax_ack_basis_v2') return { data: { ...technical, kind: 'technical_syntax_ack', version: 1, transportActorId: '30000000-0000-4000-8000-000000000001', observedAt: new Date().toISOString(), syntaxAssessmentId: '40000000-0000-4000-8000-000000000001', syntaxDecision: 'accepted' }, error: null }
      if (name === 'gridex_read_outbound_acks_for_source_v2') return { data: { version: 2, executionActorUserId: actor, executionPhase: args.p_phase, sourceMessageId: source.id, sourcePayloadHash: hash(port.wire), environment: 'test', companyId: company, originals: args.p_ack_family === 'CONTRL' ? [{ status: 'qualified', message: port.ack, payloadHash: hash(port.ack.raw_payload) }] : [] }, error: null }
      if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') { if (port.fault) throw port.fault; return { data: [ownerRulePack()], error: null } }
      if (name === 'gridex_record_prodat_source_validation_v6') {
        const factsHash = (key: string) => args[key] == null ? null : hash(args[key])
        return { data: { version: 6, companyId: port.sourceReceiptMismatch ? '10000000-0000-4000-8000-000000000001' : company, environment: 'test', sourceMessageId: source.id, sourcePayloadHash: hash(port.wire), factsHash: factsHash('p_facts_text'), sourceDisposition: 'not_established', assessmentId: '40000000-0000-4000-8000-000000000002', objectFactsHash: factsHash('p_object_facts_text'), applicationFactsHash: factsHash('p_application_facts_text'), responseFactsHash: factsHash('p_response_facts_text'), ignoredFieldsHash: factsHash('p_ignored_fields_text'), sourceFunctionFactsHash: factsHash('p_source_function_facts_text') }, error: null }
      }
      if (name === 'ediel_probe_source_rule_pack_capture_v1') { const row = ownerRulePack(); return { data: { status: 'captured', evidence: { rulePackId: row.rule_pack_id, messageProfileId: row.message_profile_id, profileKey: row.profile_key, version: row.original_version, sourceHash: row.source_hash, snapshot: { profileKey: row.profile_key, profileVersionId: row.message_profile_id, version: row.original_version, checksum: row.source_hash, ...row.original_snapshot } } }, error: null } }
      if (name === 'gridex_record_source_object_decisions_v1') return { data: { version: 1, companyId: company, environment: 'test', sourceMessageId: source.id, sourcePayloadHash: hash(port.wire), canonicalAssessmentId: args.p_canonical_assessment_id, factsHash: hash(args.p_facts_text), assessmentId: '40000000-0000-4000-8000-000000000003' }, error: null }
      if (name === 'gridex_witness_source_objects_v1') return { data: { version: 1, companyId: company, environment: 'test', assessmentId: args.p_assessment_id, factsHash: args.p_facts_hash, witnessId: '40000000-0000-4000-8000-000000000004', availableAt: new Date().toISOString() }, error: null }
      // A declared held native owner is not a customer-effect success receipt.
      if (name === 'ediel_apply_supply_source_v1') return { data: { applied: false, reason: 'declared_native_owner_held', idempotent: false, periods: [], commits: [] }, error: null }
      if (['claim_inbound_processing_jobs', 'gridex_claim_customer_operation_jobs'].includes(name)) return { data: [], error: null }
      throw Error(`Unexpected RPC ${name}`)
    })
    return Object.assign(promise, { abortSignal: () => promise })
  }
  return { supabaseService: { from: (table: string) => new Query(table), rpc } }
})

vi.mock('imapflow', () => ({ ImapFlow: class {
  async connect() {}
  async getMailboxLock() { return { release() {} } }
  async *fetch() { yield { uid: 42, source: Buffer.from(port.mime), internalDate: new Date(), envelope: { messageId: '<ops05-fixture@example.invalid>', from: [{ address: 'source@example.invalid' }], to: [{ address: 'recipient@example.invalid' }], subject: 'Synthetic PRODAT' } } }
  async messageFlagsAdd() {}
  async logout() {}
} }))

import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'
import { resolveCanonicalRuntimeDecision, resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { buildEdielControlTowerOperationsSummary } from '@/lib/ediel/operations/controlTower'
import { runInboundEdielMailEngine } from '@/lib/inbound-mail/edielMailboxPoller'
import { OWNER, ownerId, ownerSourceWithInstallationStatus as ownerSource, ownerRows, ownerRulePack } from './helpers/sourceOwnerFixtures'

const company = OWNER.company
const actor = ownerId(50)
const raw = ownerSource('Z12').raw_payload!
const ackFields = ['requires_contrl', 'requires_aperak', 'contrl_status', 'aperak_status', 'utilts_err_status', 'ack_status', 'ack_outcome', 'syntax_check_status', 'functional_check_status', 'ack_due_at', 'contrl_due_at', 'business_response_due_at', 'response_overdue_at', 'acknowledged_at'] as const
const ackSnapshot = (row: Row) => Object.fromEntries(ackFields.map(key => [key, row[key]]))
const snapshot = () => structuredClone(port.tables.ediel_messages[0])

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-30T13:00:00Z'))
  port.writes = []; port.calls = []; port.fault = null; port.initialSourceReadFault = false; port.legalIdentityReadFault = false; port.sourceReceiptMismatch = false; port.wire = raw
  const message = { ...ownerSource('Z12'), company_id: company, status: 'received', processing_status: 'received', requires_contrl: true, requires_aperak: true, contrl_status: 'sent', aperak_status: 'pending', utilts_err_status: 'not_required', ack_status: 'waiting', ack_outcome: null, syntax_check_status: 'not_checked', functional_check_status: 'not_checked', ack_due_at: '2026-09-30T13:30:00Z', contrl_due_at: '2026-09-30T13:30:00Z', business_response_due_at: null, response_overdue_at: null, acknowledged_at: null, inbound_email_message_id: 'email-ops05' }
  Object.assign(message, { execution_context_snapshot: { receivedProdatContext: { version: 1, contextOrigin: 'database_insert', sourceMessageId: message.id, companyId: company, environment: 'test', messageCode: 'Z04', payloadHash: createHash('sha256').update(raw).digest('hex'), sourceReceivedAt: message.message_received_at, capturedAt: message.message_received_at } } })
  const contrlRaw = EdifactEnvelopeCodec.encode({ sender: '54321', receiver: '12345', environment: 'test', applicationReference: '23-DDQ-PRODAT', interchangeReference: 'ACK-I', acknowledgementRequest: false, messages: [{ messageReference: 'ACK-M', messageTypeToken: 'CONTRL:2:2:UN', businessSegments: ['UCI+I+12345:14+54321:14+1'] }] })
  port.ack = { id: '50000000-0000-4000-8000-000000000001', company_id: company, environment: 'test', direction: 'outbound', message_standard: 'edifact', message_family: 'CONTRL', message_code: 'CONTRL', related_message_id: message.id, raw_payload: contrlRaw, parsed_payload: {}, status: 'sent', ack_outcome: 'positive' }
  port.retainedAckSnapshot = structuredClone(port.ack)
  port.mime = `Message-ID: <ops05-fixture@example.invalid>\r\nFrom: source@example.invalid\r\nTo: recipient@example.invalid\r\nSubject: Synthetic PRODAT\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${raw}`
  port.tables = {
    ...ownerRows(),
    ediel_messages: [message],
    company_memberships: [{ company_id: company, user_id: actor, status: 'active', is_active: true, accepted_at: '2026-01-01T00:00:00Z' }],
    user_profiles: [{ id: actor, user_status: 'active' }],
    inbound_email_messages: [{ id: 'email-ops05', mailbox_id: 'mailbox-ops05', internet_message_id: '<ops05-fixture@example.invalid>', raw_email: port.mime, body_text: raw, match_status: 'parsed' }],
    ediel_mailboxes: [{ id: 'mailbox-ops05', company_id: company, mailbox_name: 'Synthetic OPS05', environment: 'test', is_active: true, imap_host: 'example.invalid', imap_port: 993, username: 'fixture', secret_reference: 'env:OPS05_SYNTHETIC_MAILBOX_PASSWORD', locked_at: null, last_polled_at: null, poll_interval_minutes: 1, metadata: {} }],
  }
  vi.stubEnv('OPS05_SYNTHETIC_MAILBOX_PASSWORD', 'synthetic-only')
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

function assertOriginalAndAckPreserved(before: Row) {
  const current = port.tables.ediel_messages[0]
  expect(current.raw_payload).toBe(before.raw_payload)
  expect(current.execution_context_snapshot).toEqual(before.execution_context_snapshot)
  expect(port.ack).toEqual(port.retainedAckSnapshot)
  expect(ackSnapshot(current)).toEqual(ackSnapshot(before))
  expect(port.writes.filter(write => write.table === 'ediel_messages' && write.operation !== 'update')).toEqual([])
  expect(port.writes.filter(write => write.table === 'ediel_messages').every(write => ackFields.every(key => !(key in (write.value as Row))))).toBe(true)
}

describe('OPS-05 actual caller effects through finite external ports', () => {
  it('starts with an independently valid source rather than a fabricated protocol rejection', () => {
    const baseline = resolveCanonicalRuntimeDecision(snapshot() as unknown as EdielMessageRow)
    expect(baseline.syntaxDecision).toBe('accepted')
    expect(baseline.applicationDecision).toBe('accepted')
    expect(baseline.functionalDecision).toBe('accepted')
  })

  it('actual coordinator reaches the real registry and persists accepted canonical validation', async () => {
    const before = snapshot()
    const result = await processInboundEdielMessage({ actorUserId: actor, edielMessageId: String(before.id) })
    expect(port.calls.filter(call => call.name === 'resolve_canonical_ediel_rule_pack_with_witness_v1')).toHaveLength(1)
    expect(result.validation_report).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'accepted', functionalDecision: 'accepted' })
    expect(port.tables.ediel_message_events).toContainEqual(expect.objectContaining({ company_id: company, ediel_message_id: before.id, event_status: 'success', payload: expect.objectContaining({ batch: '2.5B', applicationDecision: 'accepted' }) }))
    expect(port.calls.some(call => call.name === 'gridex_actor_has_company_permission')).toBe(true)
    expect(port.calls.some(call => call.name === 'gridex_read_outbound_acks_for_source_v2')).toBe(true)
    expect((port.tables.ediel_message_events ?? []).some(event => (event.payload as Row)?.blockedBy === 'canonical_inbound_ack_guard')).toBe(false)
    assertOriginalAndAckPreserved(before)
  })

  it('keeps a native validation receipt mismatch held without a success or business effect', async () => {
    const before = snapshot()
    port.sourceReceiptMismatch = true
    await expect(processInboundEdielMessage({ actorUserId: actor, edielMessageId: String(before.id) })).rejects.toThrow('prodat_canonical_source_validation_unconfirmed')
    expect(port.calls.filter(call => call.name === 'resolve_canonical_ediel_rule_pack_with_witness_v1')).toHaveLength(1)
    expect(port.calls.some(call => call.name === 'gridex_record_prodat_source_validation_v6')).toBe(true)
    expect(port.calls.some(call => call.name === 'ediel_apply_supply_source_v1' || call.name === 'ediel_probe_source_rule_pack_capture_v1')).toBe(false)
    expect((port.tables.ediel_message_events ?? []).some(event => (event.payload as Row)?.batch === '2.5B')).toBe(false)
    assertOriginalAndAckPreserved(before)
  })

  it('retains a real source-qualified physical national rejection through the actual registry read failure', async () => {
    const message = snapshot()
    const badCountry = raw.replace("+SE'", "+SWE'")
    expect(badCountry).not.toBe(raw)
    message.raw_payload = badCountry
    const context = (message.execution_context_snapshot as Row).receivedProdatContext as Row
    context.payloadHash = createHash('sha256').update(badCountry).digest('hex')
    const baseline = resolveCanonicalRuntimeDecision(message as unknown as EdielMessageRow)
    expect(baseline.syntaxDecision).toBe('accepted')
    expect(baseline.applicationDecision).toBe('rejected')
    const sourceNegative = baseline.responsePlan.find(plan => plan.family === 'APERAK' && plan.outcome === 'negative')
    expect(sourceNegative?.applicationErrors).toContainEqual(expect.objectContaining({ ercCode: '42', fieldCode: '207' }))
    port.fault = new Error('local_registry_read_unavailable')
    const result = await resolveCanonicalRuntimeDecisionWithRegistry(message as unknown as EdielMessageRow)
    expect(port.calls.filter(call => call.name === 'resolve_canonical_ediel_rule_pack_with_witness_v1')).toHaveLength(1)
    expect(result.validationReport.failureDisposition).toMatchObject({ kind: 'internal_failure' })
    expect(result.responsePlan.find(plan => plan.family === 'APERAK' && plan.outcome === 'negative')).toEqual(sourceNegative)
    expect(result.responsePlan.some(plan => plan.family === 'APERAK' && plan.outcome === 'positive')).toBe(false)
    expect(port.writes).toEqual([])
  })

  it('classifies an actual physical unknown BGM code as a qualified protocol rejection', async () => {
    const message = snapshot()
    const badCode = raw.replace('BGM+Z04', 'BGM+ZZZ')
    expect(badCode).not.toBe(raw)
    message.raw_payload = badCode
    message.message_code = 'ZZZ'
    const context = (message.execution_context_snapshot as Row).receivedProdatContext as Row
    context.messageCode = 'ZZZ'
    context.payloadHash = createHash('sha256').update(badCode).digest('hex')
    const result = resolveCanonicalRuntimeDecision(message as unknown as EdielMessageRow)
    expect(result.syntaxDecision).toBe('accepted')
    expect(result.applicationDecision).toBe('rejected')
    expect(result.responsePlan.find(plan => plan.family === 'APERAK' && plan.outcome === 'negative')?.applicationErrors).toContainEqual(expect.objectContaining({ ercCode: '42', fieldCode: '202' }))
    const asynchronous = await resolveCanonicalRuntimeDecisionWithRegistry(message as unknown as EdielMessageRow)
    expect(asynchronous.syntaxDecision).toBe('accepted')
    expect(asynchronous.applicationDecision).toBe('rejected')
    expect(asynchronous.responsePlan).toEqual(result.responsePlan)
    expect(port.calls).toEqual([])
    expect(asynchronous.validationReport.failureDisposition).toMatchObject({ kind: 'protocol_rejection', externalDiagnosticQualified: true })
    expect(result.validationReport.failureDisposition).toEqual(asynchronous.validationReport.failureDisposition)
  })

  it.each([
    ['internal_failure', () => new Error('local_registry_read_unavailable'), 'EDIEL_INTERNAL_EXECUTION_FAILURE'],
    ['security_quarantine', () => new EdielExecutionFailure({ kind: 'security_quarantine', code: 'REGISTRY_PORT_FORBIDDEN' }, 'local_registry_read_forbidden'), 'REGISTRY_PORT_FORBIDDEN'],
    ['unsupported_capability', () => new EdielExecutionFailure({ kind: 'unsupported_capability', code: 'REGISTRY_CAPABILITY_UNAVAILABLE' }, 'local_registry_capability_unavailable'), 'REGISTRY_CAPABILITY_UNAVAILABLE'],
  ] as const)('preserves %s and exposes its actual persisted warning to the operator', async (kind, failure, code) => {
    const before = snapshot()
    port.fault = failure()
    const runtime = await resolveCanonicalRuntimeDecisionWithRegistry(before as unknown as EdielMessageRow)
    expect(runtime.applicationDecision).toBe('manual_review')
    expect(runtime.functionalDecision).toBe('manual_review')
    expect(runtime.issues.find(issue => issue.code === 'CANONICAL_RULE_PACK_EVIDENCE_NOT_ACTIVE')?.description).toContain(port.fault.message)
    expect(runtime.validationReport.failureDisposition).toMatchObject({ kind, code })
    expect(runtime.prodatProcessingDisposition).toMatchObject({ kind: 'internal_review', reasons: expect.arrayContaining([expect.objectContaining({ code, sourceRule: 'OPS-05', reason: port.fault.message })]) })
    expect(runtime.validationReport.prodatProcessingDisposition).toEqual(runtime.prodatProcessingDisposition)
    expect(runtime.responsePlan.some(plan => plan.family === 'APERAK' || plan.family === 'UTILTS_ERR')).toBe(false)
    const invocation = await Promise.allSettled([processInboundEdielMessage({ actorUserId: actor, edielMessageId: String(before.id) })])
    expect(port.calls.some(call => call.name === 'gridex_actor_has_company_permission' && call.args.p_company_id === company && call.args.p_actor_user_id === actor)).toBe(true)
    assertOriginalAndAckPreserved(before)
    expect(port.calls.filter(call => call.name === 'resolve_canonical_ediel_rule_pack_with_witness_v1')).toHaveLength(2)
    expect(port.calls.some(call => call.name === 'ediel_apply_supply_source_v1' || call.name === 'ediel_probe_source_rule_pack_capture_v1')).toBe(false)
    const canonical = (port.tables.ediel_message_events ?? []).find(event => (event.payload as Row)?.batch === '2.5B')
    expect(canonical).toMatchObject({ company_id: company, ediel_message_id: before.id, event_status: 'warning', payload: { applicationDecision: 'manual_review', functionalDecision: 'manual_review' } })
    expect(invocation[0].status).toBe('fulfilled')
    if (invocation[0].status === 'fulfilled') {
      const result = invocation[0].value
      expect(result.validation_report.canonicalRuntime).toMatchObject({ failureDisposition: { kind, code }, prodatProcessingDisposition: runtime.prodatProcessingDisposition, applicationDecision: 'manual_review', functionalDecision: 'manual_review' })
      expect((result.validation_report.responsePlan as Row[]).some(plan => plan.family === 'APERAK' || plan.family === 'UTILTS_ERR')).toBe(false)
    }
    expect((canonical?.payload as Row)?.prodatProcessingDisposition).toEqual(runtime.prodatProcessingDisposition)
    const summary = await buildEdielControlTowerOperationsSummary({ companyId: company, scope: 'tenant' })
    expect(summary.incidents).toContainEqual(expect.objectContaining({ id: canonical?.id, tone: 'warning', href: `/admin/ediel/messages/${before.id}` }))
    assertOriginalAndAckPreserved(before)
  })

  it('does not turn an initial source DB read failure before tenant attribution into a tenant journal or reply', async () => {
    const before = snapshot()
    port.initialSourceReadFault = true
    await expect(processInboundEdielMessage({ actorUserId: actor, edielMessageId: String(before.id) })).rejects.toThrow('initial_source_read_unavailable')
    expect(port.writes).toEqual([])
    expect(port.calls).toEqual([])
    assertOriginalAndAckPreserved(before)
  })

  it('does not journal a legal attribution read failure after technical access is authorized', async () => {
    const before = snapshot()
    port.legalIdentityReadFault = true
    await expect(processInboundEdielMessage({ actorUserId: actor, edielMessageId: String(before.id) })).rejects.toThrow('legal_identity_read_unavailable')
    // Technical source access is actual and scoped; it supplies no legal
    // business attribution when the later identity port cannot be read.
    expect(port.calls.some(call => call.name === 'gridex_actor_has_company_permission' && call.args.p_actor_user_id === actor && call.args.p_company_id === company)).toBe(true)
    expect(port.calls.some(call => call.name === 'gridex_read_outbound_acks_for_source_v2')).toBe(true)
    expect(port.calls.some(call => call.name === 'resolve_canonical_ediel_rule_pack_with_witness_v1')).toBe(false)
    expect(port.writes).toEqual([])
    expect(port.ack.raw_payload).toContain('UCI+I+12345:14+54321:14+1')
    assertOriginalAndAckPreserved(before)
  })

  it('actual mailbox catch persists its warning without inventing a tenant event or ACK', async () => {
    const before = snapshot()
    port.initialSourceReadFault = true
    const result = await runInboundEdielMailEngine({ companyId: company, environment: 'test', mailboxId: 'mailbox-ops05', actorUserId: actor, forcePoll: true, sharedOnly: false, markSeen: false, messageLimitPerMailbox: 1 })
    expect(result.debug.errorsByMailbox).toEqual([])
    expect(result.dedupedEmails).toBe(1)
    expect(result.edielMessageIds).toEqual([before.id])
    expect(result.debug.autoProcessedEdielMessages).toBe(0)
    expect(result.debug.autoProcessErrors).toEqual([`${before.id}: initial_source_read_unavailable`])
    expect(port.tables.ediel_inbound_poll_runs).toEqual([expect.objectContaining({ status: 'warning', environment: 'test', metadata: expect.objectContaining({ edielMessageIds: [before.id], autoProcessedEdielMessages: 0, autoProcessErrors: result.debug.autoProcessErrors }) })])
    expect(port.tables.ediel_message_events ?? []).toEqual([])
    assertOriginalAndAckPreserved(before)
  })
})
