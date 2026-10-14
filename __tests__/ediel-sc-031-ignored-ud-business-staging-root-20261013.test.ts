// masterplan: SC-031
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { approveEdielInboundCase, createOrUpdateInboundProdatCase, parseInboundProdatBusinessData, type EdielInboundCaseRow } from '@/lib/ediel/inboundCases'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { CanonicalOnboardingCommand } from '@/lib/customers/canonicalOnboarding'
import { msg } from './fixtures/prodat-prior-flow'
import { permissionObject } from './fixtures/prodat-energy-product'
import { alphabets, characteristic, line, raw, type Parts } from './fixtures/prodat-register'
import { head, source } from './fixtures/prodat-identity'

// These tests call the full production parser, staging and approval consumers.
// Only SDK persistence, protected source/actor RPC, event and canonical graph IO
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
vi.mock('@/lib/customers/canonicalOnboarding', async original => ({ ...await original<typeof import('@/lib/customers/canonicalOnboarding')>(), onboardCustomerGraph: ports.graph }))

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
function ownWire(code: string, reason: string, extra = true, birth = false): EdielMessageRow {
  const body: Parts[] = [line('1', 'POINT'), ...(birth ? [['DTM', ['329', '19900101', '102']] as Parts] : []), ...characteristic('Z13', reason), ...(extra ? [ud()] : [])]
  return { ...source(raw([...head(), ...body], code), code), company_id: COMPANY, parsed_payload: { subtype: 'E', customerName: 'Cached Name' } }
}
const nullCustomer = { customerId: null, customerIdQualifier: null, customerType: null, personalNumber: null, orgNumber: null, fullName: null, companyName: null, firstName: null, lastName: null, address: null, postalCode: null, city: null, country: null }

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
  ports.graph.mockImplementation(async (command: CanonicalOnboardingCommand, context: { companyId: string }) => {
    if (command.company_id !== COMPANY || command.actor_user_id !== ACTOR || context.companyId !== COMPANY) throw Error('DECLARED_GRAPH_TENANT_ACTOR_MISMATCH')
    commands.push(structuredClone(command)); return { ...PORT_RESULT, operation_id: `declared-op-${commands.length}` }
  })
  ports.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'ediel_read_prodat_object_batch_source_v1') {
      if (!sourceAvailable || args.p_company_id !== COMPANY || args.p_source_message_id !== message.id || args.p_actor_user_id !== ACTOR) return { data: null, error: Error('DECLARED_SOURCE_HELD') }
      // Acceptance facets come from the actual complete canonical invocation.
      // The surrounding protected read/INSERT context is declared IO, not a
      // newly qualified native authority witness.
      const decision = resolveCanonicalRuntimeDecision(message)
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
const customerQueries = () => queries.filter(q => q.table === 'customers')
const approveSingle = () => approveEdielInboundCase({ actorUserId: ACTOR, companyId: COMPANY, caseId: CASE, mode: 'create_new_customer' })

describe('SC-031 ignored national UD cannot become a customer business input', () => {
  for (const kind of ['org', 'person'] as const) for (const alphabet of alphabets) it(`compares Z14N ${kind} business staging to the same own source without ignored UD (${alphabet.join('')})`, async () => {
    install(negative(false, kind, alphabet)); const baseline = await stage()
    install(negative(true, kind, alphabet)); const before = structuredClone(message); const result = await stage()
    expect(result?.parsed_customer).toEqual(baseline?.parsed_customer)
    expect(result?.parsed_customer).toMatchObject(nullCustomer)
    expect({ customer: result?.customer_id, confidence: result?.match_confidence }).toEqual({ customer: null, confidence: 0 })
    expect(customerQueries()).toEqual([])
    expect(events[0]).toMatchObject({ payload: { parsedCustomer: baseline?.parsed_customer } })
    expect(message).toEqual(before)
    expect((result?.proposed_action.objects as { registers: { rawSegments: string[] }[] }[])[0].registers[0].rawSegments.some(segment => segment.includes('Ignored Name'))).toBe(true)
  })

  it('the complete canonical incoming owner still accepts ignored UD and retains its diagnostics/raw source', () => {
    const input = negative(true), before = structuredClone(input), decision = resolveCanonicalRuntimeDecision(input)
    expect([decision.syntaxDecision, decision.applicationDecision]).toEqual(['accepted', 'accepted'])
    expect(decision.responsePlan.some(plan => plan.family === 'APERAK' && plan.outcome === 'negative')).toBe(false)
    expect(decision.prodatIgnoredFields).toContainEqual(expect.objectContaining({ fieldNumber: 'END_USER_GROUP', sourceRule: 'PRODAT26A:P119' }))
    expect(input).toEqual(before)
  })

  for (const [code, reason] of [['Z06', 'E64'], ['Z09', 'E32']] as const) it(`ignores own non-E UD business fields in ${code} while preserving independent DTM249`, () => {
    const baseline = parseInboundProdatBusinessData(ownWire(code, reason, false, true))
    const extra = parseInboundProdatBusinessData(ownWire(code, reason, true, true))
    expect(extra.customer).toEqual(baseline.customer)
    expect(extra.customer).toMatchObject({ ...nullCustomer, birthDate: '19900101' })
    expect(extra.proposedAction.objects).not.toEqual(baseline.proposedAction.objects)
  })

  for (const [code, reason] of [['Z06', 'E34'], ['Z09', 'E34']] as const) it(`keeps own applicable E UD business identity/name in ${code}`, () => {
    const result = parseInboundProdatBusinessData(ownWire(code, reason))
    expect(result.customer).toMatchObject({ customerId: '0000000000', customerIdQualifier: 'SE1', customerType: 'business', orgNumber: '0000000000', fullName: 'Ignored Name', address: 'Ignored Street' })
  })

  it('keeps legacy no-wire projection and supplied outbound UD unchanged', () => {
    const noWire = { ...negative(false), raw_payload: null, parsed_payload: { customerName: 'Legacy Name', customerId: '0000000000', customerIdCodeListQualifier: 'SE1' } }
    expect(parseInboundProdatBusinessData(noWire).customer).toMatchObject({ fullName: 'Legacy Name', orgNumber: '0000000000' })
    expect(parseInboundProdatBusinessData({ ...negative(true), direction: 'outbound' }).customer).toMatchObject({ fullName: 'Ignored Name', orgNumber: '0000000000' })
  })

  it('does not let root cached subtype or a later register turn own non-E into E', () => {
    const body: Parts[] = [line('1', 'POINT', '1'), ...characteristic('Z13', 'E64'), ud(), line('2', 'POINT', '2'), ...characteristic('Z13', 'E34')]
    const input = { ...source(raw([...head(), ...body], 'Z09'), 'Z09'), parsed_payload: { subtype: 'E' } }
    expect(parseInboundProdatBusinessData(input).customer).toMatchObject(nullCustomer)
  })

  it('a selected later object uses its own first-register subtype, never the first object subtype', () => {
    const body: Parts[] = [line('1', 'A'), ...characteristic('Z13', 'E34'), ud(), line('2', 'B'), ...characteristic('Z13', 'E64'), ud('person')]
    const input = { ...source(raw([...head(), ...body], 'Z09'), 'Z09'), parsed_payload: { subtype: 'E' } }
    expect(parseInboundProdatBusinessData(input, { meteringPointId: 'A', identityAgency: '89' }).customer).toMatchObject({ fullName: 'Ignored Name', orgNumber: '0000000000' })
    expect(parseInboundProdatBusinessData(input, { meteringPointId: 'B', identityAgency: '89' }).customer).toMatchObject(nullCustomer)
  })

  it('single approval receives baseline-equivalent customer command while retaining raw evidence snapshots', async () => {
    install(negative(false)); await stage(); await approveSingle(); const baseline = commands[0]
    install(negative(true)); await stage(); await approveSingle()
    expect(commands).toHaveLength(1)
    expect(commands[0].customer).toEqual(baseline.customer)
    expect(commands[0].customer).toMatchObject({ full_name: 'Ediel inbound-kund', org_number: null, personal_number: null, company_name: null })
    expect(commands[0].application?.payload_snapshot).not.toEqual(baseline.application?.payload_snapshot)
    expect(stored?.status).toBe('applied')
  })

  it('keeps an unresolved source free of tenant masterdata matching', async () => {
    install({ ...negative(true), company_id: null }); const result = await stage()
    expect(result).toMatchObject({ company_id: null, customer_id: null, match_confidence: 0, parsed_customer: nullCustomer })
    expect(queries.filter(q => q.table !== 'ediel_inbound_cases')).toEqual([])
  })

  it('does not erase a completed/manual review on inbound replay', async () => {
    install(negative(true)); await stage(); await approveSingle(); const before = structuredClone(stored)
    expect(await stage()).toEqual(before)
    expect(stored).toEqual(before)
  })

  it('keeps malformed register syntax blocking before lookup or case writes', async () => {
    const input = negative(true)
    input.raw_payload = raw([line('1', 'POINT', '1'), ...characteristic('Z13', 'Z96'), line('2', 'POINT', '1')], 'Z14')
    install(input)
    await expect(stage()).rejects.toThrow('PRODAT_REGISTER_STRUCTURE_INVALID')
    expect(queries).toEqual([])
  })
})

function mixed(extra: boolean) {
  const positive = permissionObject('Z14', 'S17', '8716867000030', '2', 'CASE-POSITIVE').map(part => part[0] === 'NAD' && part[1] === 'UD' ? ud('person') : part)
  return { ...msg('Z14', 'Z96', 'CASE-POINT', [...ignoredObject(extra), ...positive]), company_id: COMPANY }
}
const approveBatch = () => approveEdielInboundCase({ actorUserId: ACTOR, companyId: COMPANY, caseId: CASE, objectDecisions: [
  { meteringPointId: 'POINT', identityAgency: '89', mode: 'create_new_customer' },
  { meteringPointId: '735123456789012352', identityAgency: '9', mode: 'create_new_customer' },
] })

describe('SC-031 actual object-scoped approval reprojects each physical source', () => {
  it('batch command excludes own N extras while retaining the positive sibling UD', async () => {
    install(mixed(false)); await stage(); await approveBatch(); const baseline = commands.map(command => command.customer)
    install(mixed(true)); const rawBefore = message.raw_payload; await stage(); await approveBatch()
    expect(commands.map(command => command.customer)).toEqual(baseline)
    expect(commands.map(command => command.customer)).toMatchObject([
      { full_name: 'Ediel inbound-kund', org_number: null, personal_number: null },
      { full_name: 'Ignored Name', org_number: null, personal_number: '000000000000' },
    ])
    expect(message.raw_payload).toBe(rawBefore)
    expect(parseProdatMessage(message).lineItems[0].endUserName).toBe('Ignored Name')
    expect(stored?.status).toBe('applied')
    expect(ports.link).not.toHaveBeenCalled()
  })

  it('a held protected source still stops the full batch before any graph command', async () => {
    install(mixed(true)); await stage(); sourceAvailable = false
    await expect(approveBatch()).rejects.toThrow('DECLARED_SOURCE_HELD')
    expect(commands).toEqual([])
    expect(stored?.status).toBe('pending_review')
  })
})
