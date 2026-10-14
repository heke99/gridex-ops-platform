// masterplan: SC-031
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { approveEdielInboundCase, createOrUpdateInboundProdatCase, parseInboundProdatBusinessData, type EdielInboundCaseRow } from '@/lib/ediel/inboundCases'
import { resolveCanonicalRuntimeDecision, resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { CanonicalOnboardingCommand } from '@/lib/customers/canonicalOnboarding'
import { msg } from './fixtures/prodat-prior-flow'
import { bindReceivedProdatIgnoredFields } from '@/lib/ediel/core/receivedProdatIgnoredFieldBinding'
import { guideOrderedFixtureRaw } from './helpers/prodatGuideOrderedFixture'
import { createProdatOwnSourceReadingSdk, resetProdatOwnSourceReadingSdk, installProdatOwnSourceReadingFixture, prodatOwnSourceReadingMessage } from './helpers/prodatOwnSourceReadingFixture'
import { finiteProdatRulePack, prodatOwnSourceReadingAdapter, prodatOwnSourceReadingFixtureDatabase } from './helpers/prodatOwnSourceReadingAdapter'
import { alphabets, characteristic, line, type Parts } from './fixtures/prodat-register'
import { head } from './fixtures/prodat-identity'

// These tests call the full production parser, staging and approval consumers.
// Only SDK persistence, protected source/actor RPC, event and graph RPC IO
// are declared finite ports. No native DB, actual customer mutation or ACK send
// is claimed. Successful declared graph receipts let the real callers continue.
type Row = Record<string, unknown>
type Query = { table: string; operation: 'select' | 'insert' | 'update'; filters: [string, unknown][]; payload?: Row }
const COMPANY = '00000000-0000-4000-8000-000000000002'
const ACTOR = '00000000-0000-4000-8000-000000000003'
const CASE = '00000000-0000-4000-8000-000000000004'
const FOREIGN = '00000000-0000-4000-8000-000000000005'
const CUSTOMER = '00000000-0000-4000-8000-000000000006'
const ASSESSMENT = '00000000-0000-4000-8000-000000000007'
const PORT_RESULT = { ok: true, code: 'customer_onboarding_committed' as const, operation_id: 'declared-op', correlation_id: 'declared-correlation', customer_id: CUSTOMER, site_id: 'declared-site', metering_point_id: 'declared-point', application_id: 'declared-application' }
const ports = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), read: vi.fn(), event: vi.fn(), link: vi.fn(), graph: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: ports.from, rpc: ports.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: ports.read, createEdielMessageEvent: ports.event, linkEdielMessage: ports.link }))
// The canonicalOnboarding production adapter remains real; only its RPC endpoint is finite.

let message: EdielMessageRow
let stored: EdielInboundCaseRow | null
let queries: Query[]
let commands: CanonicalOnboardingCommand[]
let events: Row[]
let clock: number
let sourceAvailable: boolean
const hash = (wire: string) => createHash('sha256').update(wire).digest('hex')
const ud = (kind: 'org' | 'person' = 'org'): Parts => ['NAD', 'UD', [kind === 'org' ? '0000000000' : '000000000000', kind === 'org' ? 'SE1' : 'SE2', '260'], '', 'Ignored Name', 'Ignored Street', 'Ignored City', '', '12345', 'SE']
const ignoredObject = (extra: boolean, seq = '1', point = 'POINT', kind: 'org' | 'person' = 'org'): Parts[] => [
  line(seq, point), ...characteristic('Z13', 'Z96'), ...characteristic('Z23', 'A76'), ['RFF', ['LI', `CASE-${point}`]], ...(extra ? [ud(kind)] : []),
]
function negative(extra: boolean, kind: 'org' | 'person' = 'org', alphabet: readonly string[] = alphabets[0]) {
  return { ...msg('Z14', 'Z96', 'CASE-POINT', ignoredObject(extra, '1', 'POINT', kind), alphabet), company_id: COMPANY,
    parsed_payload: { subtype: 'V', customerName: 'Cached Name', customerId: 'CACHED', customerIdCodeListQualifier: 'SE1' } } as EdielMessageRow
}
function execute(q: Query) {
  const matches = (row: Row) => q.filters.every(([key, value]) => key === 'or' || (key.startsWith('is:') ? row[key.slice(3)] === value : value !== null && row[key] === value))
  if (q.table === 'ediel_inbound_cases') {
    if (q.operation === 'insert') {
      stored = { id: CASE, review_decision: null, reviewed_by: null, reviewed_at: null, applied_at: null, failure_reason: null, created_at: '0', updated_at: String(++clock), ...q.payload } as EdielInboundCaseRow
    } else if (stored && matches(stored as unknown as Row) && q.operation === 'update') {
      stored = { ...stored, ...structuredClone(q.payload), updated_at: String(++clock) } as EdielInboundCaseRow
    }
    return { data: stored && matches(stored as unknown as Row) ? structuredClone(stored) : null, error: null }
  }
  if (q.table === 'ediel_messages') return { data: matches(message as unknown as Row) ? structuredClone(message) : null, error: null }
  if (q.table === 'customers') {
    // A same-ID customer in another tenant is a trap for missing company scope.
    const rows = [{ id: CUSTOMER, company_id: COMPANY, org_number: '0000000000', personal_number: '000000000000' }, { id: FOREIGN, company_id: FOREIGN, org_number: '0000000000', personal_number: '000000000000' }]
    return { data: rows.find(matches) ?? null, error: null }
  }
  if (['metering_points', 'customer_sites', 'grid_owners', 'audit_logs'].includes(q.table)) return { data: null, error: null }
  throw Error(`UNEXPECTED_DECLARED_TABLE:${q.table}`)
}
function install(row: EdielMessageRow) {
  message = structuredClone(row); stored = null; queries = []; commands = []; events = []; clock = 0; sourceAvailable = true
}
beforeEach(() => {
  vi.clearAllMocks()
  install(negative(false))
  ports.from.mockImplementation((table: string) => {
    const q: Query = { table, operation: 'select', filters: [] }; queries.push(q)
    const chain = {
      select: () => chain, eq: (k: string, v: unknown) => { q.filters.push([k, v]); return chain },
      is: (k: string, v: unknown) => { q.filters.push([`is:${k}`, v]); return chain },
      or: (v: string) => { q.filters.push(['or', v]); return chain }, limit: () => chain,
      insert: (payload: Row) => { q.operation = 'insert'; q.payload = structuredClone(payload); return chain },
      update: (payload: Row) => { q.operation = 'update'; q.payload = structuredClone(payload); return chain },
      maybeSingle: async () => execute(q), single: async () => execute(q),
      then: (resolve: (r: ReturnType<typeof execute>) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(execute(q)).then(resolve, reject),
    }
    return chain
  })
  ports.read.mockImplementation(async (id: string) => id === message.id ? structuredClone(message) : null)
  ports.event.mockImplementation(async (event: Row) => { events.push(structuredClone(event)); return {} })
  ports.link.mockResolvedValue(undefined)
  ports.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'canonical_onboard_customer_graph') {
      const command = args.p_command as CanonicalOnboardingCommand
      if (command.company_id !== COMPANY || command.actor_user_id !== ACTOR) throw Error('DECLARED_GRAPH_TENANT_ACTOR_MISMATCH')
      commands.push(structuredClone(command)); return { data: { ...PORT_RESULT, customer_number: 'DECLARED-0001', operation_id: `declared-op-${commands.length}` }, error: null }
    }
    if (name === 'ediel_read_prodat_object_batch_source_v1') {
      if (!sourceAvailable || args.p_company_id !== COMPANY || args.p_source_message_id !== message.id || args.p_actor_user_id !== ACTOR) return { data: null, error: Error('DECLARED_SOURCE_HELD') }
      // Acceptance facets come from the actual complete canonical invocation.
      // The surrounding protected read/INSERT context is declared IO, not a
      // newly qualified native authority witness.
      const decision = message.message_code === 'Z04' ? await canonicalSupplier(message, message.raw_payload!.includes('CAV+Z23') ? 'LK' : 'L') : resolveCanonicalRuntimeDecision(message)
      if (!decision.prodatApplicationValidation) throw Error('ACTUAL_APPLICATION_FACET_REQUIRED')
      const original = { ...structuredClone(message), execution_context_snapshot: { receivedProdatContext: { version: 1, contextOrigin: 'database_insert', sourceMessageId: message.id, companyId: COMPANY, environment: message.environment, messageCode: message.message_code, payloadHash: hash(message.raw_payload!), sourceReceivedAt: message.message_received_at, capturedAt: message.message_received_at } } }
      return { data: { version: 1, sourceMessage: original, sourcePayloadHash: hash(message.raw_payload!), assessmentId: ASSESSMENT, applicationValidation: { ...decision.prodatApplicationValidation, sourcePayloadHash: hash(message.raw_payload!) } }, error: null }
    }
    if (name === 'ediel_compare_and_set_prodat_object_case_v1') {
      if (!stored || args.p_company_id !== COMPANY || args.p_case_id !== CASE || args.p_source_message_id !== message.id || args.p_actor_user_id !== ACTOR) throw Error('DECLARED_CAS_OWNER_MISMATCH')
      const prior = stored.review_decision?.objectApplication as { fingerprint: string; revision: number } | undefined
      if (args.p_expected_updated_at !== stored.updated_at || args.p_expected_status !== stored.status || args.p_expected_fingerprint !== (prior?.fingerprint ?? null) || args.p_expected_revision !== (prior?.revision ?? null)) return { data: null, error: null }
      const patch = args.p_patch
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('DECLARED_CAS_PATCH_REQUIRED')
      stored = { ...stored, ...structuredClone(patch), updated_at: String(++clock) } as EdielInboundCaseRow
      return { data: structuredClone(stored), error: null }
    }
    throw Error(`UNEXPECTED_DECLARED_RPC:${name}`)
  })
})
const stage = () => createOrUpdateInboundProdatCase({ actorUserId: ACTOR, message })
const approveSingle = () => approveEdielInboundCase({ actorUserId: ACTOR, companyId: COMPANY, caseId: CASE, mode: 'create_new_customer' })


const fixtureSourceBindings = () => Object.fromEntries(['lib/ediel/inboundCases.ts', 'lib/ediel/core/receivedProdatIgnoredFieldBinding.ts', 'lib/ediel/rulebook/fieldMatrix.ts', '__tests__/ediel-sc-031-source-owned-business-projection-root-20261014.test.ts'].map(path => [path, hash(readFileSync(new URL('../' + path, import.meta.url), 'utf8'))]))
const readings = createProdatOwnSourceReadingSdk()
const points = ['735123456789012345', '735123456789012352']
function supplier(reason: 'Z22' | 'Z23', extra: boolean, count = 1): EdielMessageRow {
  const block = (point: string, i: number): Parts[] => [
    line(String(i + 1), point, undefined, '9'), ['DTM', ['92', '202610010000', '203']], ['DTM', ['354', '15', '806']], ['QTY', ['31', '1000', 'KWH']],
    ...characteristic('Z13', reason), ...characteristic('Z04', 'Z03'), ...characteristic('Z07', 'Z12'), ...characteristic('Z12', 'D', 3),
    ...characteristic('Z15', 'D'), ['CCI', '', 'Z14'], ['CAV', ['', '', '', 'L917', '8716867000030']],
    ...characteristic('Z02', '1', 3), ...characteristic('Z05', '6', 3), ...characteristic('Z16', '111', 3),
    ['RFF', ['MG', `METER-${point}`]], ['RFF', ['Z05', 'TES']], ['RFF', ['LI', `OWN-${i + 1}`]], ...(extra ? [['RFF', ['Z07', `IGNORED-${i + 1}`]]] as Parts[] : []),
    ['NAD', 'UD', ['199001011234', 'SE2', '260'], '', 'Synthetic Customer', 'Street', 'City', '', '12345', 'SE'],
    ['NAD', 'IT', [point, '', '9'], '', '', 'Street', 'Town', '', '12345', 'SE'], ['NAD', 'Z02', ['54321', '160', 'SVK']],
  ]
  const wire = guideOrderedFixtureRaw([...head(), ...points.slice(0, count).flatMap(block)], 'Z04')
    .replace('+S+R+', '+12345:14+54321:14+').replace("+23-DDQ-PRODAT'", "+23-DDQ-PRODAT++1++1'")
  return prodatOwnSourceReadingMessage(wire)
}
function installation(extra: boolean, alphabet: readonly string[] = alphabets[0]) {
  const m = negative(false, 'org', alphabet)
  if (!extra) return m
  const body: Parts[] = [...ignoredObject(false), ['NAD', 'IT', ['POINT', '', '89'], '', '', 'Ignored Street', 'Ignored City', '', '12345', 'NO']]
  return { ...msg('Z14', 'Z96', 'CASE-POINT', body, alphabet), company_id: COMPANY, parsed_payload: { siteAddress: 'Cached Street', siteCountry: 'DK', subtype: 'VH' } } as EdielMessageRow
}
async function canonicalSupplier(m: EdielMessageRow, subtype: 'L' | 'LK') {
  resetProdatOwnSourceReadingSdk(readings)
  installProdatOwnSourceReadingFixture(readings, m, subtype, { actorUserId: ACTOR, receivedAt: m.message_received_at!, mailId: m.inbound_email_message_id!, parseId: '00000000-0000-4000-8000-000000000005', receptionId: '00000000-0000-4000-8000-000000000006', legalActorId: '00000000-0000-4000-8000-000000000008' })
  const finite = prodatOwnSourceReadingFixtureDatabase(readings, () => [finiteProdatRulePack('Z04', subtype, subtype === 'L' ? 'Z22' : 'Z23')])
  const baseFrom = ports.from.getMockImplementation()!, baseRpc = ports.rpc.getMockImplementation()!
  const combined = prodatOwnSourceReadingAdapter(() => readings, { from: baseFrom, rpc: (name, args) => name === 'resolve_canonical_ediel_rule_pack_with_witness_v1' ? finite.rpc(name, args) : baseRpc(name, args) })
  ports.from.mockImplementation(combined.from); ports.rpc.mockImplementation(combined.rpc)
  const baseRead = ports.read.getMockImplementation()!
  ports.read.mockImplementation(async (sourceId: string) => sourceId === m.id ? structuredClone(m) : null)
  const d = await resolveCanonicalRuntimeDecisionWithRegistry(m, { actorUserId: ACTOR })
  ports.read.mockImplementation(baseRead)
  ports.from.mockImplementation(baseFrom); ports.rpc.mockImplementation(baseRpc)
  return d
}
function business(command: CanonicalOnboardingCommand) {
  return { customer: command.customer, site: command.site, meter: command.metering_point }
}

// Mutation oracle: restoring raw319 or rawIT as the business input must fail
// these literal command/staging assertions. No mocked parser/onboarding adapter.
describe('SC-031 source-owned reference and installation business boundaries', () => {
  for (const [reason, subtype] of [['Z22', 'L'], ['Z23', 'LK']] as const) {
    it(`full canonical ${subtype} accepts extra319 and the real binder binds both physical objects`, async () => {
      const fixtures = []
      for (const extra of [false, true]) {
        const row = supplier(reason, extra, 2), before = structuredClone(row), decision = await canonicalSupplier(row, subtype)
        expect([decision.syntaxDecision, decision.applicationDecision]).toEqual(['accepted', 'accepted'])
        expect(decision.prodatApplicationValidation?.objects.map(o => o.applicationDecision), JSON.stringify({ objects: decision.prodatApplicationValidation?.objects, issues: decision.issues })).toEqual(['accepted', 'accepted'])
        expect(decision.responsePlan.some(p => p.family === 'APERAK' && p.outcome === 'negative')).toBe(false)
        const ignored = bindReceivedProdatIgnoredFields(decision.prodatIgnoredFields, row.raw_payload!)
        expect(ignored).not.toBeNull()
        expect(ignored?.filter(f => f.fieldNumber === '319').map(f => f.occurrence.objectId)).toEqual(extra ? points : [])
        expect(row).toEqual(before)
        fixtures.push({ row, ignored, application: decision.prodatApplicationValidation, registers: decision.prodatApplicationValidation!.objects.map(o => parseInboundProdatBusinessData(row, { meteringPointId: o.objectId!, identityAgency: o.identityAgency! }).meteringPoint.registers) })
      }
      // Explicit local finite fixture output, not original/backend evidence.
      writeFileSync(`/tmp/sc031-v4-qualified-supplier-${subtype}-cohorts.json`, JSON.stringify({ declaration: 'REAL TS canonical/binder under DECLARED SDK/legal/source/registry ports; NOT native DB authority', sourceBindings: fixtureSourceBindings(), subtype, fixtures }, null, 2) + '\n')
    })
    it(`${subtype} ignored319 changes raw evidence but cannot change staging/reference/production`, async () => {
      install(supplier(reason, false)); const baseline = await stage()
      install(supplier(reason, true)); const before = structuredClone(message); const result = await stage()
      expect(result?.parsed_metering_point).toMatchObject({ referenceToMeteringPoint: null })
      expect(result?.parsed_metering_point.referenceToMeteringPoint).toEqual(baseline?.parsed_metering_point.referenceToMeteringPoint)
      expect(result?.parsed_production).toEqual(baseline?.parsed_production)
      expect(result?.parsed_customer).toEqual(baseline?.parsed_customer)
      expect(result?.parsed_site).toEqual(baseline?.parsed_site)
      expect(result?.proposed_action.objects).not.toEqual(baseline?.proposed_action.objects)
      expect(message).toEqual(before)
    })
    it(`${subtype} real single approval and real canonical adapter send no ignored319 business field or notes`, async () => {
      install(supplier(reason, false)); await stage(); await approveSingle(); const baseline = business(commands[0])
      install(supplier(reason, true)); await stage(); await approveSingle()
      expect(commands).toHaveLength(1)
      expect(commands[0].metering_point).toMatchObject({ ediel_reference: null, meter_point_id: points[0] })
      expect(commands[0].site?.internal_notes).not.toContain('IGNORED-1')
      expect(business(commands[0])).toEqual(baseline)
      expect(commands[0].application).toMatchObject({ payload_snapshot: { prodatRegisters: expect.any(Array) } })
    })
  }
  for (const [reason, subtype] of [['Z22', 'L'], ['Z23', 'LK']] as const) it(`${subtype} actual scoped batch rebuilds each command from its own source and real adapter`, async () => {
    install(supplier(reason, true, 2)); await stage()
    await approveEdielInboundCase({ actorUserId: ACTOR, companyId: COMPANY, caseId: CASE, objectDecisions: points.map(meteringPointId => ({ meteringPointId, identityAgency: '9', mode: 'create_new_customer' as const })) })
    expect(commands.map(c => c.metering_point?.ediel_reference)).toEqual([null, null])
    expect(commands.map(c => c.metering_point?.meter_point_id)).toEqual(points)
    for (const command of commands) expect(command.site?.internal_notes).not.toContain('IGNORED-')
    expect(stored?.status).toBe('applied')
  })
  it('held current source prevents scoped batch commands and retains pending review', async () => {
    install(supplier('Z22', true, 2)); await stage(); sourceAvailable = false
    await expect(approveEdielInboundCase({ actorUserId: ACTOR, companyId: COMPANY, caseId: CASE, objectDecisions: points.map(meteringPointId => ({ meteringPointId, identityAgency: '9', mode: 'create_new_customer' as const })) })).rejects.toThrow('DECLARED_SOURCE_HELD')
    expect(commands).toEqual([]); expect(stored?.status).toBe('pending_review')
  })
  it('exports only an actual canonical N/IT comparator input; no native supplier admission is asserted', () => {
    const it = (point: string): Parts => ['NAD', 'IT', [point, '', '89'], '', '', 'Ignored Street', 'Ignored City', '', '12345', 'NO']
    const row = { ...msg('Z14', 'Z96', 'CASE-POINT', [...ignoredObject(false), it('POINT'), ...ignoredObject(false, '2', 'SECOND'), it('SECOND')]), company_id: COMPANY } as EdielMessageRow
    const decision = resolveCanonicalRuntimeDecision(row)
    expect([decision.syntaxDecision, decision.applicationDecision]).toEqual(['accepted', 'accepted'])
    const ignored = bindReceivedProdatIgnoredFields(decision.prodatIgnoredFields, row.raw_payload!)
    expect(ignored?.filter(f => f.fieldNumber === 'INSTALLATION_GROUP')).toHaveLength(2)
    expect(decision.prodatApplicationValidation?.objects).toHaveLength(2)
    writeFileSync('/tmp/sc031-v4-qualified-N-component-cohort.json', JSON.stringify({ declaration: 'Canonical TS/binder N mechanics ONLY; actual SQL generic supplier role must HOLD ESCO source', sourceBindings: fixtureSourceBindings(), row, ignored, application: decision.prodatApplicationValidation, registers: decision.prodatApplicationValidation!.objects.map(o => parseInboundProdatBusinessData(row, { meteringPointId: o.objectId!, identityAgency: o.identityAgency! }).meteringPoint.registers) }, null, 2) + '\n')
  })
  for (const alphabet of alphabets) it(`Z14N ignored IT changes raw/register evidence, not site staging (${alphabet.join('')})`, async () => {
    install(installation(false, alphabet)); const baseline = await stage()
    install(installation(true, alphabet)); const before = structuredClone(message); const result = await stage()
    expect(result?.parsed_site).toEqual(baseline?.parsed_site)
    expect(result?.parsed_site).toMatchObject({ street: null, city: null, postalCode: null, country: null, facilityId: 'POINT' })
    expect(result?.proposed_action.objects).not.toEqual(baseline?.proposed_action.objects)
    expect(message).toEqual(before)
  })
  it('Z14N real single approval sends the absent-installation baseline including SE country fallback', async () => {
    install(installation(false)); await stage(); await approveSingle(); const baseline = business(commands[0])
    install(installation(true)); await stage(); await approveSingle()
    expect(business(commands[0])).toEqual(baseline)
    expect(commands[0].site).toMatchObject({ street: null, city: null, postal_code: null, country: 'SE', facility_id: 'POINT' })
  })
  it('canonical Z14N ignores the installation parent without negative APERAK', () => {
    const decision = resolveCanonicalRuntimeDecision(installation(true))
    expect([decision.syntaxDecision, decision.applicationDecision]).toEqual(['accepted', 'accepted'])
    expect(decision.prodatIgnoredFields).toContainEqual(expect.objectContaining({ fieldNumber: 'INSTALLATION_GROUP' }))
    expect(bindReceivedProdatIgnoredFields(decision.prodatIgnoredFields, installation(true).raw_payload!)).not.toBeNull()
  })
  it('applicable D319 and applicable IT retain their exact own values', () => {
    const m = supplier('Z22', true); m.raw_payload = m.raw_payload!.replace('CAV+Z22', 'CAV+Z70'); m.parsed_payload = { subtype: 'L' }
    const p = parseInboundProdatBusinessData(m)
    expect(p.meteringPoint.referenceToMeteringPoint).toBe('IGNORED-1')
    expect(p.site).toMatchObject({ street: 'Street', city: 'Town', postalCode: '12345', country: 'SE' })
  })
  it('unknown own reason, legacy no-wire and outbound records do not infer an incoming ignore decision', () => {
    const m = supplier('Z22', true), unknown = { ...m, raw_payload: m.raw_payload!.replace('CAV+Z22', 'CAV+UNKNOWN'), parsed_payload: { subtype: 'L' } }
    expect(parseInboundProdatBusinessData(unknown).meteringPoint.referenceToMeteringPoint).toBe('IGNORED-1')
    expect(parseInboundProdatBusinessData({ ...m, direction: 'outbound' }).meteringPoint.referenceToMeteringPoint).toBe('IGNORED-1')
    expect(parseInboundProdatBusinessData({ ...m, raw_payload: null, parsed_payload: { referenceToMeteringPoint: 'LEGACY' } }).meteringPoint.referenceToMeteringPoint).toBe('LEGACY')
  })
  it('a later selected object uses its own first physical reason, never cached/root/sibling subtype', () => {
    const m = supplier('Z22', true, 2); m.raw_payload = m.raw_payload!.replace("CAV+Z22'", "CAV+Z70'"); m.parsed_payload = { subtype: 'D' }
    expect(parseInboundProdatBusinessData(m, { meteringPointId: points[0], identityAgency: '9' }).meteringPoint.referenceToMeteringPoint).toBe('IGNORED-1')
    expect(parseInboundProdatBusinessData(m, { meteringPointId: points[1], identityAgency: '9' }).meteringPoint.referenceToMeteringPoint).toBeNull()
  })
  it('foreign single approval stops before the real canonical RPC', async () => {
    install(supplier('Z22', true)); await stage()
    await expect(approveEdielInboundCase({ actorUserId: ACTOR, companyId: FOREIGN, caseId: CASE, mode: 'create_new_customer' })).rejects.toThrow('TENANT_CONTEXT_MISMATCH')
    expect(commands).toEqual([])
  })
})
