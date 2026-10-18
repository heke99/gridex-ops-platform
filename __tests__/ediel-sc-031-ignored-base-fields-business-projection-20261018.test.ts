// masterplan: SC-031
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { approveEdielInboundCase, createOrUpdateInboundProdatCase, parseInboundProdatBusinessData, type EdielInboundCaseRow } from '@/lib/ediel/inboundCases'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { CanonicalOnboardingCommand } from '@/lib/customers/canonicalOnboarding'
import { alphabets, characteristic, type Parts } from '@/__tests__/fixtures/prodat-register'
import { head, own, source } from '@/__tests__/fixtures/prodat-identity'
import { structuralOwnerSource } from '@/__tests__/helpers/structuralOwnerFixtures'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'

// These tests call the full production parser, staging and approval consumers.
// Only SDK persistence, event and canonical graph IO
// are declared finite ports. No native DB, actual customer mutation or ACK send
// is claimed. Successful declared graph receipts let the real callers continue.
type Row = Record<string, unknown>
type Query = { table: string; operation: 'select' | 'insert' | 'update'; filters: [string, unknown][]; payload?: Row }
const COMPANY = '00000000-0000-4000-8000-000000000002'
const ACTOR = '00000000-0000-4000-8000-000000000003'
const CASE = '00000000-0000-4000-8000-000000000004'
const FOREIGN = '00000000-0000-4000-8000-000000000005'
const CUSTOMER = '00000000-0000-4000-8000-000000000006'
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
  message = structuredClone(row); stored = null; queries = []; commands = []; events = []; clock = 0
}
beforeEach(() => {
  vi.clearAllMocks()
  install(z01())
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
  ports.rpc.mockImplementation(async (name: string) => { throw Error(`UNEXPECTED_DECLARED_RPC:${name}`) })
})
const stage = () => createOrUpdateInboundProdatCase({ actorUserId: ACTOR, message })
const approveSingle = () => approveEdielInboundCase({ actorUserId: ACTOR, companyId: COMPANY, caseId: CASE, mode: 'create_new_customer' })


import { guideOrderedFixtureRaw } from '@/__tests__/helpers/prodatGuideOrderedFixture'
const baseFields: [string, Parts[]][] = [
 ['213', [['QTY', ['31', '777', 'KWH']]]],
 ['224', [['RFF', ['MG', 'IGNORED']]]],
 ['214', characteristic('Z02', '7', 3)],
 ['218', characteristic('Z05', '7', 3)],
 ['217', characteristic('Z04', 'Z02')],
 ['222', characteristic('Z12', 'D', 3)],
 ['242', characteristic('Z14', 'L641Q', 3)],
 ['254', characteristic('Z15', 'A')],
 ['216', [['DTM', ['157', '202610010000', '203']]]],
 ['508', [['DTM', ['354', '15', '806']]]],
 ['259', characteristic('Z16', '4', 3)],
 ['262', [['NAD', 'Z02', ['54321','160','SVK'], '', '', '', '', '', '', 'SE']]],
]
function z01(extra: Parts[] = [], alphabet: readonly string[] = alphabets[0]): EdielMessageRow {
 return { ...source(guideOrderedFixtureRaw([...head(), ...own('1', '735123456789012345', 'CASE-A'), ...extra], 'Z01', alphabet), 'Z01'), company_id: COMPANY }
}
function businessProjection(row: EdielMessageRow) {
 const p = parseInboundProdatBusinessData(row)
 const meter = { ...p.meteringPoint }; delete meter.registers
 return { customer:p.customer, site:p.site, meteringPoint:meter, contract:p.contract, production:p.production, caseType:p.caseType }
}
describe('SC031 actual canonical base-X fields stay out of incoming business data', () => {
 for (const [field, extra] of baseFields) it(`Z01 field${field} is accepted and ignored by the real decision and by the business consumer`, () => {
  const row = z01(extra), before = structuredClone(row)
  const rule = canonicalProdat26AFieldRules('Z01').find(r => r.fieldNumber === field)
  expect(rule?.requirement).toBe('forbidden')
  const decision = resolveCanonicalRuntimeDecision(row)
  expect([decision.syntaxDecision, decision.applicationDecision], JSON.stringify(decision.issues)).toEqual(['accepted','accepted'])
  expect(decision.prodatIgnoredFields).toContainEqual(expect.objectContaining({fieldNumber:field,sourceRule:'PRODAT26A:P119'}))
  expect(decision.responsePlan.some(p => p.family === 'APERAK' && p.outcome === 'negative')).toBe(false)
  expect(businessProjection(row)).toEqual(businessProjection(z01()))
  expect(row).toEqual(before)
 })
 for (const alphabet of alphabets) it(`real staging and approval do not put ignored annual213 or reading222 in business commands (${alphabet.join('')})`, async () => {
  install(z01([], alphabet)); await stage(); await approveSingle()
  const baseline = { site:commands[0].site?.annual_consumption_kwh, frequency:commands[0].metering_point?.reading_frequency }
  const extras = [...baseFields[0][1], ...baseFields[5][1]]
  install(z01(extras, alphabet)); const wire = message.raw_payload; await stage(); await approveSingle()
  expect(stored?.parsed_site.annualEnergyKwh).toBeNull()
  expect(stored?.parsed_metering_point.readingFrequency).toBeNull()
  expect({ site:commands[0].site?.annual_consumption_kwh, frequency:commands[0].metering_point?.reading_frequency }).toEqual(baseline)
  expect(message.raw_payload).toBe(wire)
  expect(JSON.stringify(stored?.proposed_action.objects)).toContain('777')
 })
 it('supplier-received Z04L keeps a canonical unused216 out of actual staging and approval projections', async () => {
  // This is the same consumer invoked after the Z04/Z05 supply source owner
  // in inboundProcessing; finite IO supplies no native/legal/market authority.
  const baseline = {...structuralOwnerSource('Z04'), company_id:COMPANY}
  const extra = {...baseline, raw_payload:baseline.raw_payload!.replace(/(LIN[^']*')/, '$1DTM+157:202610010000:203\u0027').replace(/UNT\+(\d+)\+/, (_all, count:string)=>`UNT+${Number(count)+1}+`)}
  expect(canonicalProdat26AFieldRules('Z04').find(r=>r.fieldNumber==='216')?.requirement).toBe('forbidden')
  for(const row of [baseline, extra]) {
   const decision = resolveCanonicalRuntimeDecision(row)
   expect([decision.syntaxDecision,decision.applicationDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted'])
  }
  expect(resolveCanonicalRuntimeDecision(extra).prodatIgnoredFields).toContainEqual(expect.objectContaining({fieldNumber:'216'}))
  install(baseline); await stage(); await approveSingle()
  const before = {site:structuredClone(stored!.parsed_site),command:structuredClone(commands[0].site)}
  install(extra); await stage(); await approveSingle()
  expect(stored!.parsed_site).toEqual(before.site)
  expect(commands[0].site).toEqual(before.command)
  expect(message.raw_payload).toBe(extra.raw_payload)
 })
 it('retains optional and dependent values instead of treating them as base X', () => {
  const row = z01([...baseFields[0][1], ...baseFields[2][1]])
  const optional = {...row, raw_payload:row.raw_payload!.replace('BGM+Z01', 'BGM+Z03'), message_code:'Z03'}
  expect(canonicalProdat26AFieldRules('Z03').find(r=>r.fieldNumber==='213')?.requirement).toBe('optional')
  expect(parseInboundProdatBusinessData(optional).site.annualEnergyKwh).toBe(777)
  const dependent = {...row, raw_payload:row.raw_payload!.replace('BGM+Z01', 'BGM+Z04'), message_code:'Z04'}
  expect(canonicalProdat26AFieldRules('Z04').find(r=>r.fieldNumber==='214')?.requirement).toBe('dependent')
  expect(parseInboundProdatBusinessData(dependent).meteringPoint.meterConstant).toBe(7)
 })
 it('retains outbound and no-wire legacy values while cached metadata cannot override the physical incoming type', () => {
  const row = z01(baseFields[0][1])
  expect(parseInboundProdatBusinessData({...row,direction:'outbound'}).site.annualEnergyKwh).toBe(777)
  expect(parseInboundProdatBusinessData({...row,raw_payload:null,parsed_payload:{annualEnergy:'456'}}).site.annualEnergyKwh).toBe(456)
  expect(parseInboundProdatBusinessData({...row,message_code:'Z04',parsed_payload:{annualEnergy:'123'}}).site.annualEnergyKwh).toBeNull()
 })
 it('outbound canonical rejection remains independent from incoming tolerance', () => {
  const d = resolveCanonicalRuntimeDecision({ ...z01(baseFields[0][1]), direction:'outbound' })
  expect(d.syntaxDecision).toBe('accepted'); expect(d.applicationDecision).toBe('rejected')
 })
})
