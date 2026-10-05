// masterplan: SC-068
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { processInboundUtiltsMessageByCanonicalPolicy } from '@/lib/ediel/flows/utiltsInboundPolicyProcessor'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport/index.part-2'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { receivedUtiltsOwnerFixture, resetUtiltsCanonicalOwnerIo } from './helpers/utiltsCanonicalOwnerIo'
import { createUtiltsFinalValidationIo, currentUtiltsActorQuery, qualifyUtiltsFixtureSource, UTILTS_FIXTURE_ACTOR } from './helpers/utiltsCurrentOwnerFixture'
import { createUtiltsFinalValidationIo as createDiagnosticValidationIo } from './helpers/utiltsFinalValidationFixture'
import { requireEdielInboundLegalContext } from '@/lib/ediel/tenant/sourceLegalContext'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'

const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), link: vi.fn(), ack: vi.fn(), rpc: vi.fn(), from: vi.fn(), meter: vi.fn(), bill: vi.fn(), provider: vi.fn(), complete: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.get, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event, linkEdielMessage: io.link, listEdielTestRuns: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/ediel/core/kernel', () => ({ createCanonicalAckMessage: io.ack }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: io.provider }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: io.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', () => ({ ingestBillingUnderlay: io.bill, findOpenOutboundBySource: vi.fn().mockResolvedValue(null), syncGridOwnerDataRequestReceivedFromEdiel: io.complete }))
vi.mock('@/lib/ediel/matching', () => ({
  matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point-a'), matchMeteringPointForEdielMessage: vi.fn().mockResolvedValue('point-a'),
  matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer-a', siteId: 'site-a', gridOwnerId: 'owner-a' }),
  findMatchingGridOwnerDataRequest: vi.fn().mockResolvedValue({ id: 'request-a', request_scope: 'billing_underlay', response_payload: {}, customer_id: 'customer-a', metering_point_id: 'point-a' }),
}))

// Public SMTP and inbound consumers/opaque owners are real. Current identity,
// registry/original birth and accepted journal are explicit finite DB ports.
// A copied diagnostic decision below is deliberately NOT a genuine operative
// historical_replay decision: the current public owner has no such mode field.
beforeEach(() => {
  vi.clearAllMocks(); resetUtiltsCanonicalOwnerIo()
  const canonical = createUtiltsFinalValidationIo()
  io.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'gridex_ediel_accepted_transport_projection_v1'
    ? Promise.resolve({ data: null, error: null })
    : canonical(name, args) ?? Promise.resolve({ data: null, error: { message: `undeclared_sc068_port:${name}` } }))
  io.from.mockImplementation((table: string) => {
    const actor = currentUtiltsActorQuery(table); if (actor) return actor
    if (table !== 'ediel_counterparties') throw new Error(`undeclared_sc068_table:${table}`)
    const q = { select: () => q, eq: () => q, or: async () => ({ error: null, data: [] }) }
    return q
  })
})

function productionMessage(): EdielMessageRow {
  return { id: 'sc068-reference', company_id: 'own-company', environment: 'production', direction: 'outbound', status: 'queued', test_flag: 0,
    message_family: 'PRODAT', message_code: 'Z13', message_version: 'E2SE6A', message_standard: 'edifact',
    sender_ediel_id: '21660', receiver_ediel_id: '54321', receiver_email: 'dso@example.invalid', application_reference: '23-DGI-PRODAT',
    communication_route_id: 'declared-route', raw_payload: 'DECLARED UNCHANGED REFERENCE ORIGINAL' } as EdielMessageRow
}
function expectNoProductionEffect() {
  expect(io.provider).not.toHaveBeenCalled(); expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.complete).not.toHaveBeenCalled(); expect(io.ack).not.toHaveBeenCalled(); expect(io.update).not.toHaveBeenCalled()
}

it.each([{ sender_ediel_id: '91100' }, { receiver_ediel_id: '91109' }, { application_reference: '23-TGT-PRODAT' }])(
  'SC-068 actual public production send holds a test reference identity %j before any new authority/provider', async testIdentity => {
    const message = { ...productionMessage(), ...testIdentity }, before = structuredClone(message)
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: 'own-actor' })).rejects.toThrow(/TGT/)
    expect(io.rpc.mock.calls.map(([name]) => name)).toEqual(['gridex_ediel_accepted_transport_projection_v1'])
    expect(io.from).not.toHaveBeenCalled(); expect(io.event).not.toHaveBeenCalled(); expect(io.link).not.toHaveBeenCalled()
    expectNoProductionEffect(); expect(message).toEqual(before)
  })

it.each(['catalog_evidence', 'historical_replay'] as const)(
  'SC-068 a copied %s diagnostic policy cannot mint an operative final owner through the public inbound consumer', async mode => {
    const message = energyHandoffMessage('2026-10-01')
    message.raw_payload = message.raw_payload!.replace("23-DDQ-E66-T++1'", "23-DDQ-E66-T++1++1'")
    Object.assign(message, receivedUtiltsOwnerFixture(message)); qualifyUtiltsFixtureSource(message); io.get.mockResolvedValue(message)
    const original = structuredClone(message)
    const initial = await resolveCanonicalRuntimeDecisionWithRegistry(message)
    const timeAnchors = initial.policy?.timeAnchors
    expect(timeAnchors).toBeDefined()
    const diagnosticPolicy = { ...resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound', referenceDate: '2026-10-01',
      associationAssignedCode: 'E5SE5A', applicationReference: message.application_reference, mode }), timeAnchors }
    // This real catalogue resolver returns semantics, not private original
    // authority. Attaching them to a copied genuine initial object loses its
    // opaque ownership; no invented wire/row/mode authority is supplied.
    const copiedDiagnostic = { ...initial, policy: diagnosticPolicy }
    io.rpc.mockClear()
    await expect(processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id,
      canonicalDecision: copiedDiagnostic, canonicalPolicy: diagnosticPolicy })).rejects.toThrow('ediel_initial_utilts_owner_unavailable')
    expect(io.rpc.mock.calls.some(([name]) => ['gridex_record_utilts_source_validation_v4', 'gridex_persist_utilts_consumption_v1'].includes(name))).toBe(false)
    expectNoProductionEffect(); expect(message).toEqual(original)
    // Matching may link diagnostic message metadata before denial; this does
    // not claim a zero-write DB snapshot or a valid historical-mode producer.
  })

it('SC-068 actual historical accepted-original repair cannot re-enter the provider after today changes to a test identity', async () => {
  const message = { ...productionMessage(), status: 'acknowledged' as const, sender_ediel_id: '91100' }, before = structuredClone(productionMessage())
  const observedAt = '2026-09-29T10:00:00.123Z'
  const accepted = { status: 'accepted_projection', companyId: message.company_id, environment: message.environment, messageId: message.id,
    attemptId: '40000000-0000-4000-8000-000000000001', lane: 'generic_journal', originalHash: createHash('sha256').update(message.raw_payload!).digest('hex'),
    observedAt, frozenRecipient: 'original@example.invalid', providerReceipt: { accepted: ['original@example.invalid'], rejected: [], messageId: '<frozen@example.invalid>', response: '250 declared' },
    businessExpectationPlan: { version: 1 }, authorizesProviderEntry: false, deliveryProven: false, projectionStatus: 'acknowledged' }
  const original = structuredClone(message)
  io.rpc.mockImplementation(async (name: string) => {
    if (name === 'gridex_ediel_accepted_transport_projection_v1' || name === 'gridex_ediel_repair_accepted_transport_projection_v1') return { data: accepted, error: null }
    throw new Error(`undeclared_historical_port:${name}`)
  })
  const result = await sendEdielMessageViaSmtp(message, { actorUserId: 'own-actor' })
  expect(result).toMatchObject({ accepted: ['original@example.invalid'], messageId: '<frozen@example.invalid>', dispatchObservedAt: observedAt })
  expect(io.rpc.mock.calls.map(([name]) => name)).toEqual(['gridex_ediel_accepted_transport_projection_v1', 'gridex_ediel_repair_accepted_transport_projection_v1'])
  expect(io.rpc.mock.calls[1][1]).toEqual({ p_company_id: before.company_id, p_environment: 'production', p_actor_user_id: 'own-actor', p_message_id: before.id })
  expect(io.from).not.toHaveBeenCalled(); expectNoProductionEffect(); expect(message).toEqual(original)
  // The private repair port may repair the SAME original's projection; this is
  // neither external send nor the missing no-production-mutation replay mode.
})

it('SC-068 historical sent status without an actual accepted journal never creates new production traffic', async () => {
  const message = { ...productionMessage(), status: 'sent' as const }, original = structuredClone(productionMessage())
  await expect(sendEdielMessageViaSmtp(message, { actorUserId: 'own-actor' })).rejects.toThrow('ediel_historical_transport_receipt_unavailable')
  expect(io.rpc.mock.calls.map(([name]) => name)).toEqual(['gridex_ediel_accepted_transport_projection_v1'])
  expect(io.from).not.toHaveBeenCalled(); expectNoProductionEffect(); expect(message.raw_payload).toEqual(original.raw_payload)
})

it('SC-068 unchanged TEST original is held by actual production admission and customer-effect source capture before any business sink', async () => {
  type Row = Record<string, unknown>
  type Db = { exec(sql: string): Promise<unknown>; query(sql: string, args?: unknown[]): Promise<{ rows: Row[] }> }
  const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
  const hash = (raw: string) => createHash('sha256').update(raw).digest('hex')
  const reference = energyHandoffMessage('2026-10-01')
  // Construct the synthetic TEST reference once, before freezing its bytes.
  // This is no authentic TGT file. Neither treatment removes physical 0035=1
  // or changes the test sender to manufacture a production original.
  const raw = reference.raw_payload!.replace("23-DDQ-E66-T++1'", "23-DDQ-E66-T++1++1'")
  const referenceHash = hash(raw), productionId = uid(70), testId = uid(69), companyId = uid(1)
  expect(EdifactEnvelopeCodec.decode(raw)).toMatchObject({ environment: 'test', testIndicator: '1', sender: '91100' })
  const schema = readFileSync(resolve('supabase/schema.sql'), 'utf8')
  const functionDefinition = (name: string) => {
    const marker = `CREATE FUNCTION ${name}(`
    expect(schema.split(marker)).toHaveLength(2)
    const start = schema.indexOf(marker), after = schema.slice(start)
    const match = /\bAS (\$\$|\$_\$)/.exec(after)
    expect(match).not.toBeNull()
    const bodyStart = start + match!.index + match![0].length
    const end = schema.indexOf(match![1] + ';', bodyStart)
    expect(end).toBeGreaterThan(bodyStart)
    return { name, ddl: schema.slice(start, end + match![1].length + 1), body: schema.slice(bodyStart, end) }
  }
  const tableDefinition = (name: string) => {
    const marker = `CREATE TABLE ${name} (`
    expect(schema.split(marker)).toHaveLength(2)
    const start = schema.indexOf(marker), end = schema.indexOf('\n);', start)
    expect(end).toBeGreaterThan(start)
    return schema.slice(start, end + 3)
  }
  const ownerNames = ['gridex_ediel_inbound_context.derive_before_received_err_response_v1', 'gridex_ediel_inbound_context.derive',
    'gridex_ediel_inbound_context.require_before_received_err_response_v1', 'gridex_ediel_inbound_context.require_v1',
    'gridex_ediel_inbound_context.capture', 'public.ediel_require_inbound_legal_context_v1', 'gridex_received_sources.seal_utilts_insert_v1',
    'gridex_ediel_source_rules.capture_before_outbound_owner_v1', 'gridex_ediel_source_rules.capture_before_native_ack_guide_v1',
    'gridex_ediel_source_rules.capture_v1', 'gridex_ediel_source_rules.probe_v1', 'public.ediel_probe_source_rule_pack_capture_v1']
  const definitions = ownerNames.map(functionDefinition), ownerProof: Row[] = []
  const hook = '__sc068ProductionReferenceProbe', global = globalThis as unknown as Record<string, unknown>
  const previousHook = global[hook], oldModule = process.env.EDIEL_PGLITE_MODULE
  global[hook] = async ({ db }: { db: Db }) => {
    // The unchanged retained harness supplies the actual prospective identity
    // owner and its declared tenant/role/catalog tables. Add only captured
    // current owner bodies and empty captured table declarations for the
    // ordinary E66 negative path. No private accepted source witness is seeded.
    await db.exec(`CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_received_err_response;CREATE SCHEMA gridex_ediel_source_rules;
      ALTER TABLE public.ediel_messages ADD COLUMN message_standard text,ADD COLUMN status text,ADD COLUMN execution_context_snapshot jsonb,
      ADD COLUMN immutable_payload_hash text,ADD COLUMN message_sent_at timestamptz,ADD COLUMN canonical_rule_pack_id uuid,
      ADD COLUMN rule_profile_version_id uuid,ADD COLUMN rule_profile_version text,ADD COLUMN rule_pack_checksum text,
      ADD COLUMN rule_profile_key text,ADD COLUMN rule_pack_snapshot jsonb;
      -- Explicit finite erasure port: this fresh INSERT is never an approved
      -- retention transition. No retention owner or deletion acceptance proof.
      CREATE FUNCTION public.ediel_is_qualified_retention_transition_v1(public.ediel_messages,public.ediel_messages)
      RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`)
    for (const table of ['gridex_received_err_response.receipts', 'gridex_ediel_source_rules.receipts', 'gridex_received_sources.validation_assessments',
      'public.ediel_rule_packs', 'public.ediel_message_profiles', 'public.ediel_rule_pack_sources']) await db.exec(tableDefinition(table))
    for (const definition of definitions) await db.exec(definition.ddl.replace('CREATE FUNCTION ', 'CREATE OR REPLACE FUNCTION '))
    await db.exec(`CREATE TRIGGER sc068_actual_utilts_birth BEFORE INSERT OR UPDATE ON public.ediel_messages
      FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.seal_utilts_insert_v1();
      REVOKE ALL ON ALL TABLES IN SCHEMA gridex_ediel_source_rules FROM PUBLIC,anon,authenticated,service_role;
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_source_rules FROM PUBLIC,anon,authenticated,service_role;
      GRANT USAGE ON SCHEMA gridex_ediel_source_rules TO service_role;
      GRANT EXECUTE ON FUNCTION gridex_ediel_source_rules.probe_v1(uuid,uuid) TO service_role;
      REVOKE ALL ON FUNCTION public.ediel_probe_source_rule_pack_capture_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
      GRANT EXECUTE ON FUNCTION public.ediel_probe_source_rule_pack_capture_v1(uuid,uuid) TO service_role;
      UPDATE tenant_actor_identifiers SET identifier_value='21660' WHERE id='${uid(4)}';
      UPDATE tenant_actor_roles SET role_code='electricity_supplier' WHERE id='${uid(5)}';
      INSERT INTO tenant_ediel_profiles VALUES('${uid(60)}','${companyId}','production','electricity',true,'2000-01-01',null);
      INSERT INTO tenant_actor_identifiers VALUES('${uid(61)}','${companyId}','production','${uid(2)}','EdielId','21660','2000-01-01',null);
      INSERT INTO tenant_actor_roles VALUES('${uid(62)}','${companyId}','production','${uid(2)}','electricity_supplier','2000-01-01',null);`)
    for (const [messageId, environment] of [[testId, 'test'], [productionId, 'production']]) {
      await db.query(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at,message_standard,status)
        VALUES($1,$2,$3,'inbound','UTILTS','E66',$4,$5,'edifact','received')`, [messageId, companyId, environment, raw, reference.message_received_at])
    }
    const one = async (sql: string, args: unknown[] = []) => { const result = await db.query(sql, args); expect(result.rows).toHaveLength(1); return result.rows[0] }
    const service = async (sql: string, args: unknown[]) => {
      await db.exec('SET ROLE service_role')
      try { return await one(sql, args) } finally { await db.exec('RESET ROLE') }
    }
    // SDK timestamptz values are JSON strings; preserve the actual row through
    // PostgreSQL's own JSON projection rather than PGlite's Date-object driver.
    const original = (await one('SELECT to_jsonb(m) row FROM public.ediel_messages m WHERE id=$1', [productionId])).row as Row
    const receipt = await one('SELECT status,reason,context,payload_sha256 FROM gridex_ediel_inbound_context.receipts WHERE source_message_id=$1', [productionId])
    expect(receipt).toMatchObject({ status: 'held', reason: 'ediel_inbound_legal_context_required', context: {}, payload_sha256: referenceHash })
    const control = await service('SELECT public.ediel_require_inbound_legal_context_v1($1,$2) context', [companyId, testId])
    expect(control.context).toMatchObject({ environment: 'test', legalEdielId: '21660', actorRole: 'electricity_supplier' })
    await expect(service('SELECT public.ediel_require_inbound_legal_context_v1($1,$2) context', [companyId, productionId])).rejects.toThrow('ediel_inbound_legal_context_required')
    const message = { ...reference, ...original } as unknown as EdielMessageRow
    // The observed birth context comes from the actual seal, not a helper's
    // invented qualified production original. Canonical assessment/issuer and
    // selected guide are finite diagnostic inputs, not legal/source acceptance.
    const diagnostic = createDiagnosticValidationIo(), businessSinks: Record<'customers' | 'meters' | 'billing' | 'permissions' | 'supply', string[]> = { customers: [], meters: [], billing: [], permissions: [], supply: [] }
    const sinksBefore = structuredClone(businessSinks), probeErrors: string[] = []
    io.get.mockResolvedValue(message)
    io.meter.mockImplementation(() => { businessSinks.meters.push('forbidden'); throw Error('production meter sink reached') })
    io.bill.mockImplementation(() => { businessSinks.billing.push('forbidden'); throw Error('production billing sink reached') })
    io.complete.mockImplementation(() => { businessSinks.customers.push('forbidden'); throw Error('production request/customer sink reached') })
    io.from.mockImplementation((table: string) => {
      if (!['company_memberships', 'user_profiles', 'ediel_counterparties'].includes(table)) throw Error(`sc068_unprovided_customer_permission_supply_port:${table}`)
      const filters = new Map<string, unknown>()
      const query = { select: () => query, eq: (key: string, value: unknown) => { filters.set(key, value); return query }, not: () => query,
        or: async () => ({ data: [], error: null }), maybeSingle: async () => {
          expect(filters.get(table === 'user_profiles' ? 'id' : 'user_id')).toBe(UTILTS_FIXTURE_ACTOR)
          if (table === 'company_memberships') expect(filters.get('company_id')).toBe(companyId)
          return { error: null, data: table === 'user_profiles' ? { id: UTILTS_FIXTURE_ACTOR, user_status: 'active' }
            : { company_id: companyId, user_id: UTILTS_FIXTURE_ACTOR, status: 'active', is_active: true, accepted_at: '2026-09-01T00:00:00Z' } }
        } }
      return query
    })
    io.rpc.mockImplementation((name: string, args: Row) => {
      if (name === 'gridex_actor_has_company_permission') {
        expect(args).toEqual({ p_actor_user_id: UTILTS_FIXTURE_ACTOR, p_company_id: companyId, p_permission: 'metering.write' })
        return Promise.resolve({ data: true, error: null })
      }
      if (name === 'gridex_read_utilts_issuer_identity_authority_v1') return Promise.resolve({ error: null, data: { version: 1, companyId, environment: 'production', sourceMessageId: productionId,
        sourcePayloadHash: referenceHash, status: 'qualified', authorityVersionId: uid(63), namespaceEpoch: '1', messageReferenceCollision: false, transactionReferenceCollisions: [], holdReason: null } })
      if (name === 'ediel_require_inbound_legal_context_v1' || name === 'ediel_probe_source_rule_pack_capture_v1') {
        expect(args).toEqual({ p_company_id: companyId, p_message_id: productionId })
        return service(`SELECT public.${name}($1,$2) data`, [companyId, productionId])
          .then(row => ({ data: row.data, error: null }), error => { probeErrors.push(String(error.message)); return { data: null, error } })
      }
      const response = diagnostic(name, args)
      if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') return response!.then(result => ({ ...result, data: (result.data as Row[]).map(row => ({ ...row,
        original_snapshot: { ...row.original_snapshot as Row, rulePack: { ...(row.original_snapshot as Row).rulePack as Row, family: row.family } } })) }))
      if (response) return response
      throw Error(`sc068_unprovided_production_admission_port:${name}`)
    })
    await expect(requireEdielInboundLegalContext(companyId, productionId)).rejects.toThrow('ediel_inbound_legal_context_required')
    io.rpc.mockClear(); probeErrors.length = 0
    const denied = await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: productionId })
    expect(denied).toMatchObject({ internalReviewRequired: true, ackIds: [], outboundRequestId: null,
      ingestedMeterValueId: null, ingestedMeterValueIds: [], billingUnderlayId: null })
    expect(io.rpc.mock.calls.map(([name]) => name)).toContain('gridex_record_utilts_source_validation_v4')
    expect(io.rpc.mock.calls.map(([name]) => name)).toContain('ediel_probe_source_rule_pack_capture_v1')
    expect(probeErrors).toEqual(['ediel_inbound_legal_context_required'])
    expect(io.rpc.mock.calls.some(([name]) => name === 'gridex_persist_utilts_consumption_v1')).toBe(false)
    expect(io.from.mock.calls.map(([table]) => table).every(table => ['company_memberships', 'user_profiles', 'ediel_counterparties'].includes(table))).toBe(true)
    expect(io.event).toHaveBeenCalledWith(expect.objectContaining({ payload: { reason: 'ediel_inbound_legal_context_required', manualReviewRequired: true } }))
    expectNoProductionEffect(); expect(businessSinks).toEqual(sinksBefore)
    expect(message).toEqual({ ...reference, ...original })
    expect((await one('SELECT to_jsonb(m) row FROM public.ediel_messages m WHERE id=$1', [productionId])).row).toEqual(original)
    expect(await one('SELECT status,reason,context,payload_sha256 FROM gridex_ediel_inbound_context.receipts WHERE source_message_id=$1', [productionId])).toEqual(receipt)
    expect((await one('SELECT count(*)::int n FROM gridex_ediel_source_rules.receipts')).n).toBe(0)
    expect(raw).toBe(original.raw_payload); expect(hash(String(original.raw_payload))).toBe(referenceHash)
    for (const definition of definitions) {
      const installed = (await one('SELECT prosrc FROM pg_proc WHERE pronamespace=$1::regnamespace AND proname=$2', [definition.name.slice(0, definition.name.lastIndexOf('.')), definition.name.slice(definition.name.lastIndexOf('.') + 1)])).prosrc
      expect(installed).toBe(definition.body)
      ownerProof.push({ name: definition.name, installedBodySha256: hash(String(installed)), capturedBodySha256: hash(definition.body), exactBody: true })
    }
    console.log('SC068_PRODUCTION_REFERENCE_RESULT ' + JSON.stringify({ referenceHash, testControl: 'ready', productionReceipt: 'held',
      actualPublicSourceCapture: 'ediel_inbound_legal_context_required', unchangedProductionOriginal: true, unchangedBusinessSinks: true,
      native: 'NOT_RUN', assessmentIssuerGuideActorPorts: 'finite diagnostic only; no qualified production source witness', ownerProof }))
  }
  const scriptPath = resolve('scripts/ediel-source-legal-context-sql-regression.mjs'), script = readFileSync(scriptPath, 'utf8')
  const marker = '  console.log(`Focused PostgreSQL immutable legal/transport/rolebasis/sourceclock/replay/ACK/ACL checks:'
  expect(script.split(marker)).toHaveLength(2)
  // Runtime-copy only: retain existing harness statements and resolve its
  // relative source URLs against its original location. No file is rewritten.
  const runtime = script.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(scriptPath).href))
    .replace(marker, `  await globalThis.${hook}({db});\n` + marker)
  process.env.EDIEL_PGLITE_MODULE = createRequire(import.meta.url).resolve('@electric-sql/pglite')
  try { await import(/* @vite-ignore */('data:text/javascript;base64,' + Buffer.from(runtime).toString('base64'))) }
  finally { if (previousHook === undefined) delete global[hook]; else global[hook] = previousHook; if (oldModule === undefined) delete process.env.EDIEL_PGLITE_MODULE; else process.env.EDIEL_PGLITE_MODULE = oldModule }
}, 60000)
