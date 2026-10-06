// masterplan: AT-Z05L-SUPPLIER, AT-Z05LK-SUPPLIER
// Component probes only; native/physical ACK/whole rows remain unapproved.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closureFixture, CLOSURE_OBJECT } from './helpers/closureWireFixtures'
import { source } from './fixtures/prodat-identity'
import { createFakeSupabase, type Row } from './helpers/supabaseMock'

// Only table/RPC/audit/notification/workflow ports are finite doubles. The real
// codec/parser/matrix/policy/lifecycle/facade/source adapter remain executable.
// A favorable RPC DTO does not prove accepted/native source authority or storage.
const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), event: vi.fn(), permission: vi.fn(),
  notification: vi.fn(), workflow: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
vi.mock('@/lib/ediel/permissions/permissionMarketTransition', () => ({ applyPermissionMarketSource: io.permission }))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: io.notification }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: io.workflow }))

import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { validateProdat } from '@/lib/ediel/prodat/validateProdat'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { decideProdatLifecycle } from '@/lib/ediel/stateMachines/prodatLifecycle'
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachine'
import { applySupplyMarketSource } from '@/lib/ediel/flows/supplyMarketTransition'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = { company: id(1), actor: id(2), message: id(3), period: id(4), customer: id(5), point: id(6),
  secondPeriod: id(7), secondCustomer: id(8), secondPoint: id(9), foreignCompany: id(90),
  cachedCustomer: id(91), cachedPoint: id(92), cachedSite: id(93), cachedSwitch: id(94) }
const profiles = [{ subtype: 'L', reason: 'Z22' }, { subtype: 'LK', reason: 'Z23' }]
type Profile = typeof profiles[number]
function message(profile: Profile, mutate: (wire: string) => string = wire => wire) {
  // Existing generic fixture defaults are corrected only in the caller: actual
  // three-character area, valid UD identity and source-supported L midnight.
  const wire = closureFixture({ reason: profile.reason, minute: '202610150000', li: 'OWN-END-LI' }).wire
    .replace('RFF+Z05:NET-1\'', 'RFF+Z05:NET\'').replace('CUSTOMER-1::89', '199001011234:SE2:260')
  return { ...source(mutate(wire), 'Z05'), id: own.message, company_id: own.company,
    message_version: 'E2SE6A', message_received_at: '2026-10-05T12:00:00.000000Z',
    created_at: '2026-10-05T12:00:00.000000Z', status: 'received' as const,
    customer_id: null, metering_point_id: null, site_id: null, switch_request_id: null,
    // These are deliberately contradictory, never native source proof.
    parsed_payload: { end_date: '1900-01-01', supply_period_id: id(99), lineItemReference: 'CACHED-OTHER-LI' },
  }
}
function policy(profile: Profile) {
  return resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z05', subtypeOrReasonCode: profile.reason,
    direction: 'inbound', referenceDate: '2026-10-05', associationAssignedCode: 'E2SE6A',
    applicationReference: '23-DDQ-PRODAT', mode: 'parse' })
}
function fieldIssues(profile: Profile, mutate?: (wire: string) => string) {
  const wire = message(profile, mutate).raw_payload!
  const tokenized = tokenizeEdifact(wire)
  return validateCanonicalPolicyFields({ policy: policy(profile), rawPayload: wire,
    rawSegments: tokenized.segments.map(segment => segment.raw), una: tokenized.una })
}
let tables: Record<string, Row[]>
let db: ReturnType<typeof createFakeSupabase>
const changes = () => db.calls.filter(call => call.operation !== 'select')
const cases = () => tables.customer_cases
function assertOnlyEndTasks() {
  expect(changes().every(call => call.table === 'customer_cases' && call.operation === 'insert')).toBe(true)
  expect(io.permission).not.toHaveBeenCalled()
  expect(io.notification).not.toHaveBeenCalled()
  expect(io.workflow).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks()
  tables = { customer_supply_periods: [
    { id: own.period, company_id: own.company, customer_id: own.customer, metering_point_id: own.point,
      status: 'ending', end_date: '2026-10-15', metadata: { history: 'retained' } },
    { id: own.secondPeriod, company_id: own.company, customer_id: own.secondCustomer, metering_point_id: own.secondPoint, status: 'ended' },
    { id: own.period, company_id: own.foreignCompany, customer_id: id(95), metering_point_id: id(96), status: 'ending' },
    { id: id(97), company_id: own.company, customer_id: id(98), metering_point_id: id(99), status: 'active' },
  ], customer_cases: [] }
  db = createFakeSupabase({ tables })
  io.from.mockImplementation((table: string) => {
    if (!(table in tables)) throw Error(`undeclared_table:${table}`)
    const query = db.client.from(table)
    // One-row insert DTO adapter only: the existing helper lacks single().
    // Each strict insert here supplies exactly one row; no authority is mocked.
    return Object.assign(query, { single: () => query.maybeSingle() })
  })
  io.rpc.mockImplementation(async (name: string) => {
    if (name !== 'ediel_apply_supply_source_v1') throw Error(`undeclared_rpc:${name}`)
    return { data: { applied: true, periods: [{ id: own.period, status: 'ending' }] }, error: null }
  })
  io.event.mockResolvedValue(undefined)
  for (const port of [io.permission, io.notification, io.workflow]) port.mockImplementation(() => { throw Error('unexpected_non_end_effect') })
})

describe.each(profiles)('AT-Z05 $subtype supplier ($reason)', profile => {
  it('validates complete own DDQ wire and projects ending, never a Z09E answer or supply activation', () => {
    const row = message(profile)
    expect(validateEdifactSyntax(row).issues.filter(issue => issue.severity === 'error')).toEqual([])
    expect(validateEdifactSyntax(row).ok).toBe(true)
    expect(fieldIssues(profile).filter(issue => issue.blocking)).toEqual([])
    expect(policy(profile)).toMatchObject({ code: 'Z05', subtype: profile.subtype, applicationReference: '23-DDQ-PRODAT' })
    const parsed = parseProdatMessage(row)
    expect(parsed.messageCode).toBe('Z05')
    expect(parsed.lineItems).toHaveLength(1)
    expect(parsed.lineItems[0]).toMatchObject({ meteringPointId: CLOSURE_OBJECT, installationId: CLOSURE_OBJECT,
      lineItemReference: 'OWN-END-LI', gridAreaId: 'NET', reasonForTransaction: profile.reason,
      endUserId: '199001011234', balanceResponsibleId: '11111' })
    expect(parsed.lineItems[0].contractEndDate).toBe('202610150000')
    expect(validateProdat(row.raw_payload!).ok).toBe(true)
    expect(decideProdatLifecycle(row)).toMatchObject({ subtype: profile.subtype, outcome: 'supply_terminated',
      createSupplyPeriod: false, endSupplyPeriod: true })
    expect(changes()).toEqual([])
  })

  it.each([['LIN', '314'], ['DTM+93', '211'], ['RFF+LI', '226'], ['RFF+Z05', '260'],
    ['NAD+UD', '227'], ['NAD+IT', '233'], ['NAD+Z02', '262']])('rejects missing R-field %s with the actual matching diagnostic', (selector, fieldNumber) => {
    const issues = fieldIssues(profile, wire => wire.split("'").filter(segment => !segment.startsWith(selector + (selector === 'LIN' ? '+' : ':')) && !segment.startsWith(selector + '+')).join("'"))
    expect(issues).toContainEqual(expect.objectContaining({ blocking: true,
      prodatDiagnostic: expect.objectContaining({ fieldNumber }) }))
  })

  it('holds a malformed end date and does not substitute the cached end date', () => {
    expect(fieldIssues(profile, wire => wire.replace('93:202610150000:203', '93:NOT-A-DATE:203')))
      .toContainEqual(expect.objectContaining({ blocking: true, prodatDiagnostic: expect.objectContaining({ fieldNumber: '211' }) }))
  })

  it('holds a different IT object in the real field consumer', () => {
    const row = message(profile, wire => wire.replace(`NAD+IT+${CLOSURE_OBJECT}`, 'NAD+IT+735123456789012346'))
    expect(validateProdat(row.raw_payload!).ok).toBe(false)
    expect(validateProdat(row.raw_payload!).issues).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'prodat_party_structure_invalid', message: expect.stringContaining('233') }))
  })

  it('rejects the ESCO DGI application profile in actual Z05 policy', () => {
    expect(() => resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z05', subtypeOrReasonCode: profile.reason,
      direction: 'inbound', referenceDate: '2026-10-05', associationAssignedCode: 'E2SE6A', applicationReference: '23-DGI-PRODAT', mode: 'parse' })).toThrow()
    expect(io.rpc).not.toHaveBeenCalled()
  })

  it('refused native source leaves every app business table unchanged', async () => {
    io.rpc.mockResolvedValue({ data: { applied: false, reason: 'own_end_source_unqualified' }, error: null })
    const before = structuredClone(tables)
    const result = await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: message(profile) })
    expect(result).toMatchObject({ outcome: 'manual_review_required', reviewRequired: true, updated: [] })
    expect(tables).toEqual(before)
    expect(changes()).toEqual([])
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1', {
      p_company_id: own.company, p_source_message_id: own.message, p_actor_user_id: own.actor })
    assertOnlyEndTasks()
  })

  it('outbound source cannot enter a native end mutation or create end tasks', async () => {
    const result = await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: { ...message(profile), direction: 'outbound' } })
    expect(result.reviewRequired).toBe(true)
    expect(io.rpc).not.toHaveBeenCalled()
    expect(changes()).toEqual([])
    assertOnlyEndTasks()
  })

  it('actual facade uses only returned own ending-period scope and preserves finite history tables', async () => {
    const before = structuredClone(tables.customer_supply_periods)
    const result = await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: message(profile) })
    expect(result).toMatchObject({ outcome: 'supply_terminated', reviewRequired: false, updated: ['customer_supply_periods', 'customer_cases'] })
    expect(result.tenantMessage).toContain('giltiga sluttid')
    expect(cases()).toHaveLength(1)
    expect(cases()[0]).toMatchObject({ company_id: own.company, customer_id: own.customer, metering_point_id: own.point,
      reason_category: 'final_metering_and_billing', metadata: { source_ediel_message_id: own.message } })
    expect(tables.customer_supply_periods).toEqual(before)
    expect(db.calls[0]).toMatchObject({ table: 'customer_supply_periods', operation: 'select', filters: [
      { method: 'eq', column: 'company_id', value: own.company }, { method: 'in', column: 'id', value: [own.period] }] })
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1', {
      p_company_id: own.company, p_source_message_id: own.message, p_actor_user_id: own.actor })
    assertOnlyEndTasks()
  })

  it('a validated own receipt partition delegates final-value projection without a second Legacy task', async () => {
    // The real adapter validates this declared finite RPC DTO. The independent
    // native case establishes the actual receipt-owned task and persistence.
    const row = message(profile), segmentIndex = tokenizeEdifact(row.raw_payload!).segments.findIndex(segment => segment.tag === 'LIN')
    expect(segmentIndex).toBeGreaterThanOrEqual(0)
    io.rpc.mockResolvedValue({ data: { applied: true, idempotent: false,
      periods: [{ id: own.period, status: 'ending' }], effectReceiptIds: [id(44)],
      partition: [{ object: { messageIndex: 0, messageReference: '1', objectId: CLOSURE_OBJECT, identityAgency: '9',
        registers: [{ lineIndex: 0, segmentIndex, lineNumber: '1', registerIndex: null, registerPosition: 1 }] },
      disposition: 'applied', effectReceiptId: id(44), effectFactsHash: 'a'.repeat(64) }] }, error: null })
    const committedSupplyResult = await applySupplyMarketSource({ actorUserId: own.actor, message: row })
    const result = await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: row, committedSupplyResult })
    expect(cases()).toEqual([])
    expect(result).toMatchObject({ outcome: 'supply_terminated', reviewRequired: false, updated: ['customer_supply_periods'] })
    expect(db.calls).toEqual([])
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1', {
      p_company_id: own.company, p_source_message_id: own.message, p_actor_user_id: own.actor })
    assertOnlyEndTasks()
  })

  it('direct native closure creates its scoped final task and replay preserves that task', async () => {
    const row = message(profile), segmentIndex = tokenizeEdifact(row.raw_payload!).segments.findIndex(segment => segment.tag === 'LIN')
    const receipt = { applied: true, idempotent: false,
      periods: [{ id: own.period, status: 'ending' }], effectReceiptIds: [id(44)],
      partition: [{ object: { messageIndex: 0, messageReference: '1', objectId: CLOSURE_OBJECT, identityAgency: '9',
        registers: [{ lineIndex: 0, segmentIndex, lineNumber: '1', registerIndex: null, registerPosition: 1 }] },
        disposition: 'applied', effectReceiptId: id(44), effectFactsHash: 'a'.repeat(64) }] }
    io.rpc.mockResolvedValue({ data: receipt, error: null })
    const before = structuredClone(tables.customer_supply_periods)
    const result = await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: row })
    expect(result).toMatchObject({ outcome: 'supply_terminated', reviewRequired: false,
      updated: ['customer_supply_periods', 'customer_cases'] })
    expect(cases()).toHaveLength(1)
    expect(cases()[0]).toMatchObject({ company_id: own.company, customer_id: own.customer,
      metering_point_id: own.point, reason_category: 'final_metering_and_billing',
      metadata: { source_ediel_message_id: own.message } })
    expect(tables.customer_supply_periods).toEqual(before)
    assertOnlyEndTasks()
    const after = structuredClone(tables)
    io.rpc.mockResolvedValue({ data: { ...receipt, idempotent: true }, error: null })
    await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: row })
    expect(tables).toEqual(after)
    expect(cases()).toHaveLength(1)
    assertOnlyEndTasks()
  })

  it('plans each returned ending/ended scope without including an unrelated active period', async () => {
    io.rpc.mockResolvedValue({ data: { applied: true, periods: [
      { id: own.period, status: 'ending' }, { id: own.secondPeriod, status: 'ended' }, { id: id(97), status: 'active' }] }, error: null })
    await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: message(profile) })
    expect(cases().map(row => [row.customer_id, row.metering_point_id])).toEqual([
      [own.customer, own.point], [own.secondCustomer, own.secondPoint]])
    assertOnlyEndTasks()
  })

  it('idempotent native replay creates no extra final-value task and no new business reply', async () => {
    await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: message(profile) })
    io.rpc.mockResolvedValue({ data: { applied: true, idempotent: true, periods: [{ id: own.period, status: 'ending' }] }, error: null })
    const before = structuredClone(tables)
    await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: message(profile) })
    expect(tables).toEqual(before)
    expect(cases()).toHaveLength(1)
    assertOnlyEndTasks()
  })

  it('native authorization error propagates without app mutation', async () => {
    io.rpc.mockResolvedValue({ data: null, error: Error('own_source_actor_denied') })
    await expect(applyInboundBusinessStateMachine({ actorUserId: own.actor, message: message(profile) })).rejects.toThrow('own_source_actor_denied')
    expect(changes()).toEqual([])
    expect(io.event).not.toHaveBeenCalled()
    assertOnlyEndTasks()
  })

  it('cached customer and point hints cannot replace the committed ending-period task scope', async () => {
    await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: { ...message(profile),
      customer_id: own.cachedCustomer, metering_point_id: own.cachedPoint } })
    expect(cases()).toHaveLength(1)
    expect(cases()[0]).toMatchObject({ customer_id: own.customer, metering_point_id: own.point })
    assertOnlyEndTasks()
  })

  it.each(['missing', 'foreign-only'])('an unresolvable %s returned period cannot gain a task from cached hints', async kind => {
    tables.customer_supply_periods = kind === 'missing' ? [] : tables.customer_supply_periods.filter(row => row.company_id === own.foreignCompany)
    await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: { ...message(profile),
      customer_id: own.cachedCustomer, metering_point_id: own.cachedPoint } })
    expect(cases()).toEqual([])
    expect(changes()).toEqual([])
    assertOnlyEndTasks()
  })
})
