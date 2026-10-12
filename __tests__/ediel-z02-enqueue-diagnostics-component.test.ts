// masterplan: AT-Z02L-SUPPLIER, AT-Z02LK-SUPPLIER
// Diagnostic component only: the real parser, request matcher and exported
// linker run. SDK, actor, worker and event IO are declared finite ports; this
// does not execute SQL admission or prove either whole native contract.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type Row } from './helpers/supabaseMock'
import { raw, line, characteristic, type Parts } from './fixtures/prodat-register'
import { head, source } from './fixtures/prodat-identity'

type Event = {
  actorUserId: string
  edielMessageId: string
  eventType: string
  eventStatus?: string
  message?: string
  payload?: Record<string, unknown>
}
const io = vi.hoisted(() => ({
  from: vi.fn(), tenantFrom: vi.fn(), enqueue: vi.fn(), authorize: vi.fn(), event: vi.fn(), permission: vi.fn(),
  order: [] as string[], events: [] as Event[], updateFailure: null as unknown, eventFailure: null as unknown,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: (companyId: string) => ({
  from: (table: string) => io.tenantFrom(companyId, table),
}) }))
vi.mock('@/lib/customer-operations/automation', () => ({ enqueueInboundGridOwnerResponseAutomation: io.enqueue }))
vi.mock('@/lib/ediel/services/authorization', () => ({ assertEdielTenantActor: io.authorize }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
vi.mock('@/lib/ediel/permissions/permissionMarketTransition', () => ({ applyPermissionMarketSource: io.permission }))

// First RED imports the existing consumer only, not the nonexistent new helper.
import { applyInboundProdatZ02ToCustomerInfoRequest } from '@/lib/onboarding/inboundEdielLinking'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = { company: id(1), actor: id(2), request: id(3), customer: id(4), site: id(5), point: id(6),
  message: id(7), operation: id(8), job: id(9), original: id(20), gridRequest: id(21), foreignCompany: id(90) }
const pointId = '735123456789012345'
const li = 'OWN-Z01-LI'
const errorEventMessage = 'Z02 kunde inte starta canonical verifiering och applicerades inte.'
const unknownClassification = { schemaVersion: 1, sqlState: 'unknown', publicLabel: 'unknown' }
const publicLabels = [
  ['Det inkommande svaret saknar en aktiv requestsnapshot. Svaret måste granskas manuellt innan kunddata kan uppdateras.', 'active_request_snapshot_unavailable'],
  ['Operationssnapshot saknas. Kör den senaste OPS-migrationen innan inkommande svar appliceras.', 'original_snapshot_schema_unavailable'],
  ['Automationstabellen saknas. Kör migrationen för kundautomation först.', 'automation_job_schema_unavailable'],
  ['Operationssnapshot saknas. Kör den senaste OPS-migrationen innan extern kommunikation startas.', 'persisted_operation_snapshot_schema_unavailable'],
] as const
function message(reason: 'Z22' | 'Z23') {
  const body: Parts[] = [...head(), line('1', pointId, undefined, '9'), ...characteristic('Z04', 'Z03'),
    ...characteristic('Z13', reason), ['RFF', ['Z05', 'NET']], ['RFF', ['LI', li]],
    ['NAD', 'UD', ['199001011234', 'SE2', '260'], '', 'Synthetic Person', 'Street', 'City', '', '12345', 'SE'],
    ['NAD', 'IT', [pointId, '', '9'], '', '', 'Street', 'City', '', '12345', 'SE']]
  return { ...source(raw(body, 'Z02').replace('+S+R+', '+12345:14+54321:14+'), 'Z02'),
    id: own.message, company_id: own.company, grid_owner_data_request_id: own.gridRequest,
    customer_id: own.customer, site_id: own.site, metering_point_id: own.point,
    parsed_payload: { meteringPointId: 'UNTRUSTED-CACHED-POINT', lineItemReference: 'UNTRUSTED-CACHED-LI' } }
}
let tables: Record<string, Row[]>
let db: ReturnType<typeof createFakeSupabase>
let protectedSnapshot: Row
let foreignBefore: Row
const request = () => tables.customer_info_requests[0]
const errorEvent = () => io.events.find(e => e.eventType === 'manual_note' && e.eventStatus === 'error')!
const writes = () => db.calls.filter(call => call.operation !== 'select')
const completeGate = () => ({ z02_correlation_status: 'exact', z02_payload_validation_status: 'valid',
  z02_snapshot_freshness_status: 'valid', z02_atomic_core_applied: true, z02_atomic_core: { ok: true } })
function assertLegacyCatch(errorMessage: string, result: unknown) {
  expect(result).toEqual({ applied: false, targetId: own.request, reason: 'z02_processing_enqueue_failed' })
  expect(request()).toMatchObject({ status: 'manual_review_required', blocker_code: 'z02_processing_enqueue_failed',
    blocker_reason: errorMessage, next_required_action: 'Granska requestsnapshot och Z02 innan kunddata uppdateras.',
    updated_by: own.actor, verified_payload: protectedSnapshot, ediel_message_id: own.original,
    customer_id: own.customer, site_id: own.site, metering_point_id: own.point })
  expect(typeof request().updated_at).toBe('string')
  expect(Number.isFinite(Date.parse(String(request().updated_at)))).toBe(true)
  expect(tables.customer_info_requests[1]).toEqual(foreignBefore)
  expect(tables.customer_operation_jobs).toEqual([])
  expect(tables.customer_info_request_events).toEqual([])
  expect(writes()).toHaveLength(1)
  expect(writes()[0]).toMatchObject({ table: 'customer_info_requests', operation: 'update',
    filters: [{ method: 'eq', column: 'company_id', value: own.company }, { method: 'eq', column: 'id', value: own.request }] })
  const patch = writes()[0].payload
  for (const key of ['verified_payload', 'ediel_message_id', 'response_ediel_message_id', 'customer_id', 'site_id'])
    expect(patch).not.toHaveProperty(key)
  expect(io.authorize).toHaveBeenCalledExactlyOnceWith({ companyId: own.company, actorUserId: own.actor, permission: 'metering.write' })
  expect(io.enqueue).toHaveBeenCalledExactlyOnceWith({ companyId: own.company, customerId: own.customer, siteId: own.site,
    meteringPointId: own.point, requestId: own.request, edielMessageId: own.message, actorUserId: own.actor, operationId: own.operation })
  expect(io.order).toEqual(['actor', 'event:info', 'enqueue', 'update:customer_info_requests', 'event:error'])
  expect(io.events).toHaveLength(2)
  expect(io.events[0]).toMatchObject({ actorUserId: own.actor, edielMessageId: own.message, eventType: 'manual_note', eventStatus: 'info',
    payload: { candidateCustomerInfoRequestId: own.request, z02: { lineItems: [expect.objectContaining({
      facilityId: pointId, caseReference: li, endUserName: 'Synthetic Person' })] } } })
  expect(errorEvent()).toMatchObject({ actorUserId: own.actor, edielMessageId: own.message, eventType: 'manual_note',
    eventStatus: 'error', message: errorEventMessage, payload: { customerInfoRequestId: own.request, error: errorMessage } })
  expect(io.tenantFrom).not.toHaveBeenCalled()
  expect(io.permission).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks()
  io.order.length = 0; io.events.length = 0; io.updateFailure = null; io.eventFailure = null
  protectedSnapshot = { sourceMessageId: own.original, lineItemReference: li, gridAreaId: 'PRIOR-VERIFIED-NET' }
  foreignBefore = { id: id(91), company_id: own.foreignCompany, grid_owner_data_request_id: own.gridRequest,
    customer_id: id(92), site_id: id(93), status: 'z01_sent', verified_payload: { protectedForeign: true } }
  tables = { customer_info_requests: [{ id: own.request, company_id: own.company, grid_owner_data_request_id: own.gridRequest,
    customer_id: own.customer, site_id: own.site, metering_point_id: own.point, operation_id: own.operation,
    external_reference: li, ediel_message_id: own.original, status: 'z01_sent', verified_payload: structuredClone(protectedSnapshot) },
    structuredClone(foreignBefore)], customer_operation_jobs: [], customer_info_request_events: [] }
  db = createFakeSupabase({ tables })
  io.from.mockImplementation((table: string) => {
    if (!(table in tables)) throw Error(`undeclared_table:${table}`)
    const query = db.client.from(table), update = query.update.bind(query)
    query.update = (patch: Row) => {
      io.order.push(`update:${table}`)
      if (io.updateFailure) throw io.updateFailure
      return update(patch)
    }
    return query
  })
  io.tenantFrom.mockImplementation((companyId: string, table: string) => {
    if (companyId !== own.company) throw Error('undeclared_foreign_tenant')
    return io.from(table)
  })
  io.authorize.mockImplementation(async () => { io.order.push('actor') })
  io.event.mockImplementation(async (event: Event) => {
    if (event.actorUserId !== own.actor || event.edielMessageId !== own.message) throw Error('undeclared_event_scope')
    io.order.push(`event:${event.eventStatus}`)
    if (event.eventStatus === 'error' && io.eventFailure) throw io.eventFailure
    io.events.push(event)
  })
  io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw { code: '23514', message: 'SYNTHETIC_PRIVATE_CANARY' } })
  io.permission.mockImplementation(() => { throw Error('undeclared_permission_transition') })
})

describe.each([['L', 'Z22'], ['LK', 'Z23']] as const)('finite Z02%s enqueue diagnostics', (_variant, reason) => {
  it('retains the thrown own SQLSTATE before opaque String loss on the same refused request event', async () => {
    const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })
    // All unchanged effect/state/ordering assertions run before the meaningful RED.
    assertLegacyCatch('[object Object]', result)
    expect(errorEvent().payload?.enqueueFailureClassification).toEqual({ schemaVersion: 1, sqlState: '23514', publicLabel: 'unknown' })
    expect(JSON.stringify(errorEvent())).not.toContain('SYNTHETIC_PRIVATE_CANARY')
  })

  it.each(publicLabels)('adds only the finite public label %s without changing the legacy Error message', async (text, publicLabel) => {
    io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw new Error(text) })
    const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })
    assertLegacyCatch(text, result)
    expect(errorEvent().payload?.enqueueFailureClassification).toEqual({ schemaVersion: 1, sqlState: 'unknown', publicLabel })
  })

  it('does not call caught-object code/message getters to add diagnostic metadata', async () => {
    const reads = { code: 0, message: 0 }
    const thrown = Object.defineProperties({}, {
      code: { get() { reads.code++; throw Error('SYNTHETIC_CODE_GETTER_CANARY') } },
      message: { get() { reads.message++; throw Error('SYNTHETIC_MESSAGE_GETTER_CANARY') } },
    })
    io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw thrown })
    const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })
    assertLegacyCatch('[object Object]', result)
    expect(reads).toEqual({ code: 0, message: 0 })
    expect(errorEvent().payload?.enqueueFailureClassification).toEqual(unknownClassification)
  })

  it('ignores inherited SQLSTATE and public-label data while preserving the old opaque catch', async () => {
    const thrown = Object.create({ code: '23514', message: publicLabels[0][0] })
    io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw thrown })
    const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })
    assertLegacyCatch('[object Object]', result)
    expect(errorEvent().payload?.enqueueFailureClassification).toEqual(unknownClassification)
  })

  it('adds no proxy traps beyond the unchanged legacy instanceof/String coercion', async () => {
    const counts = { descriptor: 0, prototype: 0, get: 0, keys: 0 }
    const thrown = new Proxy({ code: '23514', message: 'SYNTHETIC_PROXY_CANARY' }, {
      getOwnPropertyDescriptor(target, key) { counts.descriptor++; return Reflect.getOwnPropertyDescriptor(target, key) },
      getPrototypeOf(target) { counts.prototype++; return Reflect.getPrototypeOf(target) },
      get(target, key, receiver) { counts.get++; return Reflect.get(target, key, receiver) },
      ownKeys(target) { counts.keys++; return Reflect.ownKeys(target) },
    })
    // Characterize only existing coercion side effects; finite classification
    // expectations remain independent literal values.
    const oldString = thrown instanceof Error ? thrown.message : String(thrown)
    const baselineCounts = { ...counts }
    counts.descriptor = 0; counts.prototype = 0; counts.get = 0; counts.keys = 0
    io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw thrown })
    const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })
    expect(oldString).toBe('[object Object]')
    assertLegacyCatch('[object Object]', result)
    expect(counts).toEqual(baselineCounts)
    expect(errorEvent().payload?.enqueueFailureClassification).toEqual(unknownClassification)
  })

  it('propagates the current actor denial before any query, enqueue or event', async () => {
    const denied = Error('DECLARED_METERING_ACTOR_DENIAL'), before = structuredClone(tables)
    io.authorize.mockImplementation(async () => { io.order.push('actor'); throw denied })
    await expect(applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })).rejects.toBe(denied)
    expect(tables).toEqual(before)
    expect(db.calls).toEqual([]); expect(io.events).toEqual([]); expect(io.order).toEqual(['actor'])
    expect(io.enqueue).not.toHaveBeenCalled()
  })

  it('preserves an exception raised by the original String coercion before catch writes', async () => {
    const coercionFailure = Error('DECLARED_ORIGINAL_COERCION_FAILURE'), before = structuredClone(tables)
    const thrown = { code: '23514', [Symbol.toPrimitive]() { throw coercionFailure } }
    io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw thrown })
    await expect(applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })).rejects.toBe(coercionFailure)
    expect(tables).toEqual(before); expect(writes()).toEqual([])
    expect(io.order).toEqual(['actor', 'event:info', 'enqueue'])
    expect(io.events.map(e => e.eventStatus)).toEqual(['info'])
  })

  it('preserves the request-update exception instead of reporting a completed catch', async () => {
    const updateFailure = Error('DECLARED_REQUEST_UPDATE_FAILURE'), before = structuredClone(tables)
    io.updateFailure = updateFailure
    await expect(applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })).rejects.toBe(updateFailure)
    expect(tables).toEqual(before)
    expect(io.order).toEqual(['actor', 'event:info', 'enqueue', 'update:customer_info_requests'])
    expect(io.events.map(e => e.eventStatus)).toEqual(['info'])
  })

  it('preserves the event-port exception after the same request review update', async () => {
    const eventFailure = Error('DECLARED_ERROR_EVENT_FAILURE')
    io.eventFailure = eventFailure
    await expect(applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })).rejects.toBe(eventFailure)
    expect(request()).toMatchObject({ status: 'manual_review_required', blocker_code: 'z02_processing_enqueue_failed', blocker_reason: '[object Object]' })
    expect(request().verified_payload).toEqual(protectedSnapshot); expect(tables.customer_info_requests[1]).toEqual(foreignBefore)
    expect(writes()).toHaveLength(1); expect(tables.customer_operation_jobs).toEqual([])
    expect(io.order).toEqual(['actor', 'event:info', 'enqueue', 'update:customer_info_requests', 'event:error'])
    expect(io.events.map(e => e.eventStatus)).toEqual(['info'])
  })

  it('does not attach enqueue-failure metadata to a declared complete worker result', async () => {
    io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); return { id: own.job, status: 'completed', operationId: own.operation, result: completeGate() } })
    expect(await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })).toEqual({ applied: true, targetId: own.request })
    expect(io.events.map(e => [e.eventType, e.eventStatus])).toEqual([['manual_note', 'info'], ['linked', 'success']])
    for (const event of io.events) expect(event.payload).not.toHaveProperty('enqueueFailureClassification')
    expect(request().verified_payload).toEqual(protectedSnapshot); expect(tables.customer_info_requests[1]).toEqual(foreignBefore)
    expect(tables.customer_info_request_events.map(e => e.event_type)).toEqual(['z02_market_verified'])
  })
})

// Added after the frozen 26 real-consumer RED oracles; no original oracle changed.
import { classifyZ02EnqueueFailure } from '@/lib/onboarding/z02EnqueueFailureClassification'
import { execFileSync } from 'node:child_process'

const finiteSqlStates = ['23502', '23503', '23505', '23514', '42501', '42P01', '42703', 'P0001', '22P02', '42883'] as const
describe('pure finite enqueue classification', () => {
  it('rejects a populated array even when its own data contains exact known fields', () => {
    const array = Object.assign([], { code: '23514', message: publicLabels[0][0] })
    expect(classifyZ02EnqueueFailure(array)).toEqual(unknownClassification)
  })
  it('rejects an accessor array without reading its accessor or retaining its own code', () => {
    let reads = 0
    const array = Object.defineProperties([], {
      code: { value: '23514' }, message: { get() { reads++; throw Error('PRIVATE_ARRAY_CANARY') } },
    })
    expect(classifyZ02EnqueueFailure(array)).toEqual(unknownClassification)
    expect(reads).toBe(0)
  })
  it('rejects a proxy-wrapped populated array without inspecting its shape', () => {
    const trap = vi.fn(() => { throw Error('PRIVATE_ARRAY_PROXY_CANARY') })
    const proxy = new Proxy(Object.assign([], { code: '23514', message: publicLabels[0][0] }), {
      get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap,
    })
    expect(classifyZ02EnqueueFailure(proxy)).toEqual(unknownClassification)
    expect(trap).not.toHaveBeenCalled()
  })
  it('rejects a revoked array proxy without a throw or trap', () => {
    const revoked = Proxy.revocable([], {}); revoked.revoke()
    expect(classifyZ02EnqueueFailure(revoked.proxy)).toEqual(unknownClassification)
  })
  it.each(finiteSqlStates)('accepts only the exact own SQLSTATE %s', code => {
    expect(classifyZ02EnqueueFailure(Object.freeze({ code, message: 'PRIVATE_CANARY' })))
      .toEqual({ schemaVersion: 1, sqlState: code, publicLabel: 'unknown' })
  })
  it.each(publicLabels)('accepts only the exact own public equality %s', (text, label) => {
    expect(classifyZ02EnqueueFailure({ code: '23514', message: text }))
      .toEqual({ schemaVersion: 1, sqlState: '23514', publicLabel: label })
    for (const near of [` ${text}`, `${text} `, `${text}PRIVATE_CANARY`, text.toUpperCase(), text.slice(0, -1)])
      expect(classifyZ02EnqueueFailure({ message: near })).toEqual(unknownClassification)
  })
  it.each([undefined, null, true, 23514, '23514', Symbol('PRIVATE_CANARY')])('ignores primitive input %#', value => {
    expect(classifyZ02EnqueueFailure(value)).toEqual(unknownClassification)
  })
  it.each(['', '235140', '23514PRIVATE_CANARY', ' 23514', '23514 ', '42p01', 'p0001', 'PGRST205', 'XX000', 23514, null, undefined, {}, ['23514']])
    ('does not normalize or coerce an unknown code %#', code => {
      expect(classifyZ02EnqueueFailure({ code })).toEqual(unknownClassification)
    })
  it('does not invoke getters, inherited properties, coercion or private cause fields', () => {
    let reads = 0
    const forbidden = () => { reads++; throw Error('PRIVATE_CANARY') }
    const coercible = { toString: forbidden, valueOf: forbidden, [Symbol.toPrimitive]: forbidden }
    const thrown = Object.defineProperties(Object.create({ code: '23514', message: publicLabels[0][0] }), {
      code: { get: forbidden }, message: { get: forbidden }, detail: { get: forbidden }, hint: { get: forbidden },
      stack: { get: forbidden }, cause: { get: forbidden }, id: { get: forbidden }, privateUrl: { get: forbidden },
    })
    expect(classifyZ02EnqueueFailure(thrown)).toEqual(unknownClassification)
    expect(classifyZ02EnqueueFailure(Object.create({ code: '23514', message: publicLabels[0][0] }))).toEqual(unknownClassification)
    expect(classifyZ02EnqueueFailure({ code: coercible, message: coercible })).toEqual(unknownClassification)
    expect(reads).toBe(0)
  })
  it('does not enumerate or trigger any normal or revoked proxy trap', () => {
    const trap = vi.fn(() => { throw Error('PRIVATE_PROXY_CANARY') })
    const proxy = new Proxy({ code: '23514', message: publicLabels[0][0] }, {
      get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap,
    })
    expect(classifyZ02EnqueueFailure(proxy)).toEqual(unknownClassification)
    const revoked = Proxy.revocable({}, {}); revoked.revoke()
    expect(classifyZ02EnqueueFailure(revoked.proxy)).toEqual(unknownClassification)
    expect(trap).not.toHaveBeenCalled()
  })
  it('returns only finite own JSON keys without new logging or private leakage', () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    try {
      const result = classifyZ02EnqueueFailure({ code: '23514', message: 'PRIVATE_CANARY', detail: 'PRIVATE_CANARY',
        hint: 'PRIVATE_CANARY', stack: 'PRIVATE_CANARY', cause: { code: '42501' }, privateUrl: 'PRIVATE_CANARY' })
      expect(result).toEqual({ schemaVersion: 1, sqlState: '23514', publicLabel: 'unknown' })
      expect(Object.keys(result).sort()).toEqual(['publicLabel', 'schemaVersion', 'sqlState'])
      expect(JSON.stringify(result)).not.toContain('PRIVATE_CANARY')
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally { for (const spy of spies) spy.mockRestore() }
  })
  it('links the actual helper in both existing util VM boundaries and missing-capability closures without widening them', () => {
    const output = execFileSync(process.execPath, ['--experimental-vm-modules', '-e', `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const ts = require('typescript');
      const { createContext, SourceTextModule, SyntheticModule } = require('node:vm');
      const original = fs.readFileSync('lib/onboarding/z02EnqueueFailureClassification.ts', 'utf8');
      const compiled = ts.transpileModule(original, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
      const unknown = { schemaVersion: 1, sqlState: 'unknown', publicLabel: 'unknown' };
      const bridge = require('./scripts/helpers/ediel-source-manifest-vm.cjs');
      const data = require('./scripts/lib/ediel-source-test-data.cjs');
      (async () => {
        const closures = [
          (context, cache) => bridge.sourceRuntimeBoundary('node:util', cache, { context }),
          (context, cache) => data.loadEdielSourceTestData('node:util', process.cwd(), cache, context),
          context => new SyntheticModule(['types'], function () { this.setExport('types', {}); }, { context }),
          context => new SyntheticModule(['types'], function () { this.setExport('types', { isProxy: undefined }); }, { context }),
        ];
        for (const closure of closures) {
          const context = createContext({}), cache = new Map();
          const helper = new SourceTextModule(compiled, { context });
          const util = closure(context, cache);
          await helper.link(specifier => { assert.equal(specifier, 'node:util'); return util; });
          await helper.evaluate();
          let reads = 0;
          const thrown = Object.defineProperties({}, {
            code: { get() { reads++; throw Error('PRIVATE_CANARY'); } },
            message: { get() { reads++; throw Error('PRIVATE_CANARY'); } },
          });
          const proxy = new Proxy({}, { getOwnPropertyDescriptor() { reads++; throw Error('PRIVATE_CANARY'); } });
          const revoked = Proxy.revocable({}, {}); revoked.revoke();
          for (const value of [{ code: '23514', message: ${JSON.stringify(publicLabels[0][0])} }, thrown, proxy, revoked.proxy])
            assert.deepEqual(JSON.parse(JSON.stringify(helper.namespace.classifyZ02EnqueueFailure(value))), unknown);
          assert.equal(reads, 0);
        }
        bridge.assertNoSourceBoundaryAttempts();
        process.stdout.write('both existing util VM closures and missing capability PASS');
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `], { cwd: process.cwd(), encoding: 'utf8' })
    expect(output).toBe('both existing util VM closures and missing capability PASS')
  })
})

describe.each([['L', 'Z22'], ['LK', 'Z23']] as const)('additional unchanged Z02%s consumer boundaries', (_variant, reason) => {
  it('retains legacy array String and all refused-request effects while classifying the array as unknown', async () => {
    const thrown = Object.assign([], { code: '23514', message: publicLabels[0][0] })
    io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw thrown })
    const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })
    assertLegacyCatch('', result)
    expect(errorEvent().payload?.enqueueFailureClassification).toEqual(unknownClassification)
  })
  it('adds no Error.message getter calls beyond the one original catch read', async () => {
    let reads = 0
    const thrown = Object.defineProperty(new Error(), 'message', { get() { reads++; return 'LEGACY_PRIVATE_CANARY' } })
    Object.defineProperty(thrown, 'code', { value: '23514' })
    io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw thrown })
    const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })
    assertLegacyCatch('LEGACY_PRIVATE_CANARY', result)
    expect(reads).toBe(1)
    expect(errorEvent().payload?.enqueueFailureClassification).toEqual({ schemaVersion: 1, sqlState: '23514', publicLabel: 'unknown' })
    expect(JSON.stringify(errorEvent().payload?.enqueueFailureClassification)).not.toContain('LEGACY_PRIVATE_CANARY')
  })
  it('adds no coercion calls beyond the one original String read', async () => {
    let reads = 0
    const thrown = { code: '23514', [Symbol.toPrimitive]() { reads++; return 'LEGACY_PRIVATE_CANARY' } }
    io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw thrown })
    const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) })
    assertLegacyCatch('LEGACY_PRIVATE_CANARY', result)
    expect(reads).toBe(1)
    expect(errorEvent().payload?.enqueueFailureClassification).toEqual({ schemaVersion: 1, sqlState: '23514', publicLabel: 'unknown' })
  })
  it.each(['needs_review', 'blocked', 'completed'] as const)('adds no enqueue-failure class to a %s incomplete gate', async status => {
    io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); return { id: own.job, status,
      operationId: own.operation, result: { reason_code: 'DECLARED_GATE_REFUSAL', blocker_reason: 'Declared gate refused.' } } })
    expect(await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) }))
      .toEqual({ applied: false, targetId: own.request, reason: 'DECLARED_GATE_REFUSAL' })
    expect(request().verified_payload).toEqual(protectedSnapshot)
    expect(request().ediel_message_id).toBe(own.original)
    expect(tables.customer_info_requests[1]).toEqual(foreignBefore)
    expect(tables.customer_info_request_events.map(e => e.event_type)).toEqual(['z02_needs_review'])
    expect(io.events.map(e => e.eventStatus)).toEqual(['info', 'warning'])
    for (const event of io.events) expect(event.payload).not.toHaveProperty('enqueueFailureClassification')
    expect(io.enqueue).toHaveBeenCalledTimes(1)
    if (status === 'completed') {
      expect(request()).toMatchObject({ status: 'manual_review_required', blocker_code: 'DECLARED_GATE_REFUSAL' })
      expect(writes().map(write => [write.table, write.operation])).toEqual([
        ['customer_info_requests', 'update'], ['customer_operation_jobs', 'update'], ['customer_info_request_events', 'insert'],
      ])
    } else {
      expect(request().status).toBe('z01_sent')
      expect(writes().map(write => [write.table, write.operation])).toEqual([['customer_info_request_events', 'insert']])
    }
  })
  it('does not match or classify the same grid request belonging only to another company', async () => {
    tables.customer_info_requests.splice(0, 1)
    const before = structuredClone(tables)
    expect(await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(reason) }))
      .toEqual({ applied: false, targetId: null, reason: 'no_matching_customer_info_request' })
    expect(tables).toEqual(before); expect(writes()).toEqual([])
    expect(io.enqueue).not.toHaveBeenCalled(); expect(io.tenantFrom).not.toHaveBeenCalled()
    expect(io.events.map(event => event.eventStatus)).toEqual(['warning'])
    expect(io.events[0].payload).not.toHaveProperty('enqueueFailureClassification')
    expect(io.order).toEqual(['actor', 'event:warning'])
  })
  it('rejects a malformed actor before any new classification or IO', async () => {
    const before = structuredClone(tables)
    await expect(applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: 'malformed', message: message(reason) }))
      .rejects.toThrow('ediel_processing_actor_required')
    expect(tables).toEqual(before); expect(db.calls).toEqual([]); expect(io.events).toEqual([])
    expect(io.authorize).not.toHaveBeenCalled(); expect(io.enqueue).not.toHaveBeenCalled()
  })
})


// Consumer-only desired SDK oracle. Run this group against the unchanged
// consumer first: actual enqueue catch completes but the sibling key is absent.
const desiredZ02SdkCodes = [
  '23502', '23503', '23505', '23514', '42501', '42P01', '42703', 'P0001', '22P02', '42883',
  '21000', '22023', 'XX000', 'P0002', 'P0003', '40001', '40P01',
  'PGRST116', 'PGRST200', 'PGRST201', 'PGRST202', 'PGRST203', 'PGRST204', 'PGRST205',
] as const
describe('real Z02 consumer separate SDK evidence desired oracle', () => {
  for (const variant of ['Z22', 'Z23'] as const) {
    it.each(desiredZ02SdkCodes)(`${variant} preserves legacy catch and records exact SDK %s`, async code => {
      const thrown = Object.freeze({ code, message: 'SDK_PRIVATE_CANARY', details: 'SDK_PRIVATE_CANARY', hint: 'SDK_PRIVATE_CANARY' })
      io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw thrown })
      const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(variant) })
      assertLegacyCatch('[object Object]', result)
      expect(errorEvent().payload?.enqueueFailureClassification).toEqual({ schemaVersion: 1,
        sqlState: (finiteSqlStates as readonly string[]).includes(code) ? code : 'unknown', publicLabel: 'unknown' })
      expect(errorEvent().payload?.enqueueFailureSdkEvidence).toEqual({ schemaVersion: 1, sdkCode: code })
      expect(JSON.stringify(errorEvent().payload?.enqueueFailureSdkEvidence)).not.toContain('SDK_PRIVATE_CANARY')
      expect(io.events[0].payload).not.toHaveProperty('enqueueFailureSdkEvidence')
    })
  }
})

describe('separate SDK evidence privacy and capability', () => {
  const sdk = async (value: unknown) => (await import('@/lib/onboarding/z02EnqueueFailureClassification'))
    .classifyZ02EnqueueFailureSdkEvidence(value)
  it('distinguishes only exact own strings and fixed unavailable/unlisted states', async () => {
    for (const code of ['SDK_PRIVATE_CANARY', ' 21000', '21000 ', 'pgrst116', '21000SDK_PRIVATE_CANARY', ''])
      expect(await sdk({ code })).toEqual({ schemaVersion: 1, sdkCode: 'unlisted' })
    for (const code of [null, undefined, 21000, true, {}, ['21000']])
      expect(await sdk({ code })).toEqual({ schemaVersion: 1, sdkCode: 'unavailable' })
    for (const value of [null, undefined, true, 21000, '21000', [], Object.create({ code: '21000' })])
      expect(await sdk(value)).toEqual({ schemaVersion: 1, sdkCode: 'unavailable' })
  })
  it('never reads getters, coercion, prototype, private fields or proxy traps', async () => {
    const trap = vi.fn(() => { throw Error('SDK_PRIVATE_CANARY') })
    const accessor = Object.defineProperties({}, { code: { get: trap }, message: { get: trap },
      details: { get: trap }, hint: { get: trap }, cause: { get: trap }, stack: { get: trap } })
    expect(await sdk(accessor)).toEqual({ schemaVersion: 1, sdkCode: 'unavailable' })
    const ownCode = Object.defineProperties({}, { code: { value: '21000' }, message: { get: trap },
      details: { get: trap }, hint: { get: trap }, cause: { get: trap } })
    expect(await sdk(ownCode)).toEqual({ schemaVersion: 1, sdkCode: '21000' })
    expect(await sdk({ code: { toString: trap, [Symbol.toPrimitive]: trap } }))
      .toEqual({ schemaVersion: 1, sdkCode: 'unavailable' })
    const proxy = new Proxy({ code: '21000' }, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap })
    expect(await sdk(proxy)).toEqual({ schemaVersion: 1, sdkCode: 'unavailable' })
    const revoked = Proxy.revocable({}, {}); revoked.revoke()
    expect(await sdk(revoked.proxy)).toEqual({ schemaVersion: 1, sdkCode: 'unavailable' })
    expect(trap).not.toHaveBeenCalled()
  })
  it('links the actual sibling helper through missing trap-free capability without widening it', () => {
    const output = execFileSync(process.execPath, ['--experimental-vm-modules', '-e', `
      const assert=require('node:assert/strict'), fs=require('node:fs'), ts=require('typescript');
      const {createContext,SourceTextModule,SyntheticModule}=require('node:vm');
      const source=fs.readFileSync('lib/onboarding/z02EnqueueFailureClassification.ts','utf8');
      const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
      const bridge=require('./scripts/helpers/ediel-source-manifest-vm.cjs');
      const data=require('./scripts/lib/ediel-source-test-data.cjs');
      (async()=>{for(const factory of [
        (c,cache)=>bridge.sourceRuntimeBoundary('node:util',cache,{context:c}),
        (c,cache)=>data.loadEdielSourceTestData('node:util',process.cwd(),cache,c),
        c=>new SyntheticModule(['types'],function(){this.setExport('types',{});},{context:c}),
        c=>new SyntheticModule(['types'],function(){this.setExport('types',{isProxy:undefined});},{context:c})]){
        const context=createContext({}),helper=new SourceTextModule(compiled,{context});
        await helper.link(name=>{assert.equal(name,'node:util');return factory(context,new Map());});await helper.evaluate();
        let reads=0;const trap=()=>{reads++;throw Error('SDK_PRIVATE_CANARY');};
        const getter=Object.defineProperty({},'code',{get:trap}),proxy=new Proxy({},{getOwnPropertyDescriptor:trap});
        for(const input of [{code:'21000'},getter,proxy])
          assert.deepEqual(JSON.parse(JSON.stringify(helper.namespace.classifyZ02EnqueueFailureSdkEvidence(input))),{schemaVersion:1,sdkCode:'unavailable'});
        assert.equal(reads,0);
      }bridge.assertNoSourceBoundaryAttempts();process.stdout.write('SDK missing-capability PASS');})().catch(()=>{process.exitCode=1;});
    `], { cwd: process.cwd(), encoding: 'utf8' })
    expect(output).toBe('SDK missing-capability PASS')
  })
})

// Desired sibling contract: first RED runs the existing exported consumer and
// its complete retained catch/effect/ordering oracle before these assertions.
const desiredZ02Supplement = [
  ['', 'empty_sdk_code'], ['57014', '57014'], ['55P03', '55P03'], ['PGRST000', 'PGRST000'],
  ['PGRST001', 'PGRST001'], ['PGRST002', 'PGRST002'], ['22001', '22001'],
  ['21000', 'retained_sdk_code'], ['SDK_PRIVATE_CANARY', 'other_unlisted'],
] as const

describe('real Z02 consumer supplemental fixed diagnostic desired oracle', () => {
  for (const variant of ['Z22', 'Z23'] as const) {
    it.each(desiredZ02Supplement)(`${variant} retains old catch before sibling SDK %s`, async (code, token) => {
      const thrown = Object.freeze({ code, message: 'SDK_PRIVATE_CANARY', details: 'SDK_PRIVATE_CANARY' })
      io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw thrown })
      const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(variant) })
      assertLegacyCatch('[object Object]', result)
      expect(errorEvent().payload?.enqueueFailureSdkEvidence).toEqual({ schemaVersion: 1,
        sdkCode: code === '21000' ? '21000' : 'unlisted' })
      expect(errorEvent().payload?.enqueueFailureSdkSupplementEvidence).toEqual({ schemaVersion: 1, sdkCode: token })
      expect(errorEvent().payload?.enqueueFailurePortEvidence).toEqual({ schemaVersion: 1, operationPort: 'unavailable' })
      const sibling = { sdk: errorEvent().payload?.enqueueFailureSdkSupplementEvidence,
        port: errorEvent().payload?.enqueueFailurePortEvidence }
      expect(JSON.stringify(sibling)).not.toContain('SDK_PRIVATE_CANARY')
      expect(io.events[0].payload).not.toHaveProperty('enqueueFailureSdkSupplementEvidence')
      expect(io.events[0].payload).not.toHaveProperty('enqueueFailurePortEvidence')
    })
  }
  it('records unavailable for an ordinary Error while preserving its existing text', async () => {
    io.enqueue.mockImplementation(async () => { io.order.push('enqueue'); throw new Error('SYNTHETIC_FIXED_ERROR') })
    const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message('Z22') })
    assertLegacyCatch('SYNTHETIC_FIXED_ERROR', result)
    expect(errorEvent().payload?.enqueueFailureSdkSupplementEvidence).toEqual({ schemaVersion: 1, sdkCode: 'unavailable' })
    expect(errorEvent().payload?.enqueueFailurePortEvidence).toEqual({ schemaVersion: 1, operationPort: 'unavailable' })
  })
})

describe('supplemental SDK and invocation-scope privacy component', () => {
  it('rejects getters/proxies/nonstring codes and never reads private fields', async () => {
    const helper = await import('@/lib/onboarding/z02EnqueueFailureClassification')
    const trap = vi.fn(() => { throw Error('SDK_PRIVATE_CANARY') })
    const getter = Object.defineProperty({}, 'code', { get: trap })
    const ownCode = Object.defineProperties({}, { code: { value: '57014' },
      message: { get: trap }, details: { get: trap }, hint: { get: trap }, cause: { get: trap }, stack: { get: trap } })
    const proxy = new Proxy({ code: '57014' }, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap })
    const revoked = Proxy.revocable({}, {}); revoked.revoke()
    for (const value of [getter, proxy, revoked.proxy, null, false, [], { code: null }, { code: 57014 },
      Object.create({ code: '57014' })])
      expect(helper.classifyZ02EnqueueFailureSdkSupplementEvidence(value)).toEqual({ schemaVersion: 1, sdkCode: 'unavailable' })
    expect(helper.classifyZ02EnqueueFailureSdkSupplementEvidence(ownCode)).toEqual({ schemaVersion: 1, sdkCode: '57014' })
    for (const code of [' 57014', '57014 ', 'pgrst000', 'PGRST003', '08006', 'PRIVATE_CANARY'])
      expect(helper.classifyZ02EnqueueFailureSdkSupplementEvidence({ code })).toEqual({ schemaVersion: 1, sdkCode: 'other_unlisted' })
    expect(trap).not.toHaveBeenCalled()
  })
  it('keeps distinct concurrent inputs isolated and cleans up rejection scopes', async () => {
    const helper = await import('@/lib/onboarding/z02EnqueueFailureClassification')
    const first = {}, second = {}, thrown = Object.freeze({ code: '' })
    const seen: string[] = []
    const run = (input: object, port: 'original_snapshot_select' | 'job_insert') => helper.withZ02EnqueueDiagnosticPortWitness(input,
      async () => { await Promise.resolve(); helper.z02EnqueueDiagnosticPortObserver(input)?.(port, thrown); throw thrown },
      observed => { seen.push(observed) })
    const results = await Promise.allSettled([run(first, 'original_snapshot_select'), run(second, 'job_insert')])
    expect(results).toEqual([{ status: 'rejected', reason: thrown }, { status: 'rejected', reason: thrown }])
    expect(seen).toEqual(['original_snapshot_select', 'job_insert'])
    expect(helper.z02EnqueueDiagnosticPortObserver(first)).toBeUndefined()
    expect(helper.z02EnqueueDiagnosticPortObserver(second)).toBeUndefined()
  })
  it('suppresses ambiguous reused input identities without replacing the action result', async () => {
    const helper = await import('@/lib/onboarding/z02EnqueueFailureClassification')
    const input = {}, seen = vi.fn(), error = Object.freeze({ code: '' })
    const value = await helper.withZ02EnqueueDiagnosticPortWitness(input, async () => {
      const beforeCollision = helper.z02EnqueueDiagnosticPortObserver(input)
      const result = await helper.withZ02EnqueueDiagnosticPortWitness(input, async () => {
        beforeCollision?.('job_insert', error)
        helper.z02EnqueueDiagnosticPortObserver(input)?.('snapshot_upsert', error)
        return 'UNCHANGED_SYNTHETIC_ACTION_RESULT'
      }, seen)
      return result
    }, seen)
    expect(value).toBe('UNCHANGED_SYNTHETIC_ACTION_RESULT')
    expect(seen).not.toHaveBeenCalled()
    expect(helper.z02EnqueueDiagnosticPortObserver(input)).toBeUndefined()
  })
})

// Invocation callback fixture proves consumer error-identity selection only.
// The separate complete automation source program proves actual port placement.
describe('real Z02 consumer same-error port evidence component', () => {
  const ports = ['original_snapshot_select', 'job_insert', 'duplicate_job_select', 'snapshot_upsert'] as const
  for (const variant of ['Z22', 'Z23'] as const) {
    it.each(ports)(`${variant} accepts the same caught object at fixed port %s`, async port => {
      const helper = await import('@/lib/onboarding/z02EnqueueFailureClassification')
      const thrown = Object.freeze({ code: '57014', message: 'SDK_PRIVATE_CANARY' })
      io.enqueue.mockImplementation(async (input: object) => {
        io.order.push('enqueue'); helper.z02EnqueueDiagnosticPortObserver(input)?.(port, thrown); throw thrown
      })
      const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(variant) })
      assertLegacyCatch('[object Object]', result)
      expect(errorEvent().payload?.enqueueFailurePortEvidence).toEqual({ schemaVersion: 1, operationPort: port })
      expect(errorEvent().payload?.enqueueFailureSdkEvidence).toEqual({ schemaVersion: 1, sdkCode: 'unlisted' })
      expect(errorEvent().payload?.enqueueFailureSdkSupplementEvidence).toEqual({ schemaVersion: 1, sdkCode: '57014' })
      expect(JSON.stringify(errorEvent())).not.toContain('SDK_PRIVATE_CANARY')
    })
  }
  it('does not attribute an earlier observed error to a different final catch', async () => {
    const helper = await import('@/lib/onboarding/z02EnqueueFailureClassification')
    const earlier = Object.freeze({ code: '23505' }), final = Object.freeze({ code: '57014' })
    io.enqueue.mockImplementation(async (input: object) => {
      io.order.push('enqueue'); helper.z02EnqueueDiagnosticPortObserver(input)?.('job_insert', earlier); throw final
    })
    const result = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message('Z22') })
    assertLegacyCatch('[object Object]', result)
    expect(errorEvent().payload?.enqueueFailurePortEvidence).toEqual({ schemaVersion: 1, operationPort: 'unavailable' })
    expect(errorEvent().payload?.enqueueFailureSdkSupplementEvidence).toEqual({ schemaVersion: 1, sdkCode: '57014' })
  })
})

const actualZ02PortIdentityProgram = [
  "// Executes only in the future ROOT-approved component test. No real SDK or SQL.",
  "const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm')",
  "function extract(path,names){",
  " const source=fs.readFileSync(path,'utf8'),ast=ts.createSourceFile(path,source,ts.ScriptTarget.ES2022,true)",
  " assert.equal(ast.parseDiagnostics.length,0)",
  " const selected=ast.statements.filter(n=>ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n)?names.includes(n.name?.text):ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>names.includes(d.name.text)))",
  " const actual=selected.flatMap(n=>ts.isVariableStatement(n)?n.declarationList.declarations.map(d=>d.name.text):[n.name.text])",
  " assert.deepEqual(actual.slice().sort(),names.slice().sort())",
  " const code=selected.map(n=>source.slice(n.getFullStart(),n.end)).join('\\n')",
  " const out=ts.transpileModule(code,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}})",
  " assert.equal((out.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0)",
  " return out.outputText",
  "}",
  "const programs=[",
  " extract('lib/onboarding/z02EnqueueFailureClassification.ts',['z02EnqueueDiagnosticScopes','withZ02EnqueueDiagnosticPortWitness','z02EnqueueDiagnosticPortObserver']),",
  " extract('lib/validation/uuid.ts',['UUID_PATTERN','UuidValidationError','cleanUuidCandidate','normalizeUuidOrNull','requireUuid']),",
  " extract('lib/customer-operations/automation.part-1.ts',['reportZ02EnqueuePortFailure','observeZ02EnqueueSdkRejection','originalCustomerDataSnapshot','persistOperationSnapshot','enqueue','enqueueInboundGridOwnerResponseAutomation','missingSchema','duplicate','clean','record','nowIso']),",
  "]",
  "const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`",
  "const input={companyId:id(1),customerId:id(4),siteId:id(5),meteringPointId:id(6),requestId:id(3),edielMessageId:id(7),actorUserId:id(2),operationId:id(8)}",
  "const stamp='2026-10-11T00:00:00.000Z',snapshot={site_id:id(5),address_hash:'FINITE_HASH',grid_owner_id:null,grid_area_code:'NET',route_profile_id:null,facility_id:'FINITE_POINT',captured_at:stamp}",
  "const snapshotReply={site_address_hash:'FINITE_HASH',grid_owner_id:null,grid_area_code:'NET',route_profile_id:null,snapshot,superseded_at:null}",
  "const jobReply={id:id(9),operation_id:id(8),trace_id:id(10),status:'queued',result:{},last_error:null}",
  "const snapshotSteps=[['from',['customer_operation_request_snapshots']],['select',['site_address_hash,grid_owner_id,grid_area_code,route_profile_id,snapshot,superseded_at']],['eq',['company_id',id(1)]],['eq',['operation_id',id(8)]],['eq',['request_kind','customer_data_request']],['eq',['request_reference',id(3)]],['maybeSingle',[]],['await',[]]]",
  "const jobSteps=[['from',['customer_operation_jobs']],['insert',[{company_id:id(1),customer_id:id(4),customer_site_id:id(5),metering_point_id:id(6),job_type:'apply_inbound_grid_owner_response',status:'queued',priority:5,idempotency_key:`inbound-grid-owner-response:${id(7)}`,operation_id:id(8),trace_id:id(10),payload:{customer_info_request_id:id(3),ediel_message_id:id(7),site_snapshot:snapshot},request_snapshot:snapshot,run_after:stamp,created_by:id(2)}]],['select',['id, operation_id, trace_id, status, result, last_error']],['single',[]],['await',[]]]",
  "const duplicateSteps=[['from',['customer_operation_jobs']],['select',['id, operation_id, trace_id, status, result, last_error']],['eq',['company_id',id(1)]],['eq',['job_type','apply_inbound_grid_owner_response']],['eq',['idempotency_key',`inbound-grid-owner-response:${id(7)}`]],['in',['status',['queued','running','waiting_response']]],['order',['created_at',{ascending:false}]],['limit',[1]],['maybeSingle',[]],['await',[]]]",
  "const persistSteps=[['from',['customer_operation_request_snapshots']],['upsert',[{company_id:id(1),customer_id:id(4),customer_site_id:id(5),metering_point_id:id(6),customer_operation_job_id:id(9),operation_id:id(8),request_kind:'inbound_grid_owner_response',site_address_hash:'FINITE_HASH',grid_owner_id:null,grid_area_code:'NET',route_profile_id:null,request_reference:id(3),trace_id:id(10),snapshot:{...snapshot,operation_id:id(8),request_reference:id(3),route_profile_id:null,trace_id:id(10)}},{onConflict:'company_id,operation_id,request_kind'}]],['await',[]]]",
  "const normalize=v=>JSON.parse(JSON.stringify(v))",
  "function setup(queue){",
  " let count=0,randomCalls=0;const calls=[]",
  " const service={from(table){const row=queue[count++];assert.ok(row,'undeclared query');let cursor=0",
  "  function step(name,args){assert.deepEqual(normalize([name,args]),row.steps[cursor++]);calls.push(name);return builder}",
  "  const builder={then(resolve,reject){step('await',[]);assert.equal(cursor,row.steps.length);return (row.reject?Promise.reject(row.error):Promise.resolve({data:row.data??null,error:row.error??null})).then(resolve,reject)}}",
  "  for(const name of ['select','eq','insert','upsert','in','order','limit','single','maybeSingle'])builder[name]=(...args)=>step(name,args)",
  "  return step('from',[table])",
  " }}",
  " class FixedDate extends Date{constructor(...args){super(...(args.length?args:[stamp]))}}",
  " const context=vm.createContext({exports:{},supabaseService:service,Date:FixedDate,randomUUID(){randomCalls++;return id(10)}})",
  " for(const program of programs)vm.runInContext(program,context)",
  " const api=vm.runInContext('({enqueueInboundGridOwnerResponseAutomation,withZ02EnqueueDiagnosticPortWitness,z02EnqueueDiagnosticPortObserver,observeZ02EnqueueSdkRejection})',context)",
  " return {api,done(){assert.equal(count,queue.length);assert.equal(calls.filter(x=>x==='await').length,queue.length);return randomCalls}}",
  "}",
  "const cases=[]",
  "async function check(name,fn){await fn();assert.ok(!cases.includes(name));cases.push(name)}",
  "async function main(){",
  " for(const port of ['original_snapshot_select','job_insert','duplicate_job_select','snapshot_upsert'])for(const reject of [false,true])await check(port+'-'+(reject?'await-rejection':'returned-error'),async()=>{",
  "  const error=Object.freeze({code:'57014',message:'PRIVATE_PORT_CANARY'}),dup=Object.freeze({code:'23505'})",
  "  const queue=[]",
  "  queue.push({steps:snapshotSteps,...(port==='original_snapshot_select'?{error,reject}:{data:snapshotReply})})",
  "  if(port!=='original_snapshot_select')queue.push({steps:jobSteps,...(port==='job_insert'?{error,reject}:port==='duplicate_job_select'?{error:dup}:{data:jobReply})})",
  "  if(port==='duplicate_job_select')queue.push({steps:duplicateSteps,error,reject})",
  "  if(port==='snapshot_upsert')queue.push({steps:persistSteps,error,reject})",
  "  const env=setup(queue),arg={...input},observed=[]",
  "  let caught;try{await env.api.withZ02EnqueueDiagnosticPortWitness(arg,()=>env.api.enqueueInboundGridOwnerResponseAutomation(arg),(p,e)=>observed.push([p,e]))}catch(e){caught=e}",
  "  assert.equal(caught,error);assert.equal(observed.at(-1)[0],port);assert.equal(observed.at(-1)[1],error)",
  "  assert.equal(observed.length,port==='duplicate_job_select'?2:1)",
  "  if(port==='duplicate_job_select'){assert.equal(observed[0][0],'job_insert');assert.equal(observed[0][1],dup)}",
  "  assert.equal(env.api.z02EnqueueDiagnosticPortObserver(arg),undefined);assert.deepEqual(arg,input);assert.deepEqual(Object.keys(error),['code','message'])",
  "  assert.equal(env.done(),port==='original_snapshot_select'?0:1)",
  " })",
  " await check('default-thenable-identity-preserved',async()=>{const env=setup([]),pending={then(){throw Error('must not evaluate')}};assert.equal(env.api.observeZ02EnqueueSdkRejection(pending,'job_insert',undefined),pending);assert.equal(env.done(),0)})",
  " for(const scoped of [false,true])await check('success-no-failure-'+scoped,async()=>{",
  "  const env=setup([{steps:snapshotSteps,data:snapshotReply},{steps:jobSteps,data:jobReply},{steps:persistSteps}]),arg={...input},seen=[]",
  "  const action=()=>env.api.enqueueInboundGridOwnerResponseAutomation(arg)",
  "  const result=scoped?await env.api.withZ02EnqueueDiagnosticPortWitness(arg,action,(...v)=>seen.push(v)):await action()",
  "  assert.deepEqual(normalize(result),{id:id(9),duplicate:false,operationId:id(8),traceId:id(10),status:'queued',result:{},lastError:null});assert.deepEqual(seen,[]);assert.equal(env.done(),1)",
  " })",
  " await check('throwing-observer-preserves-original-error',async()=>{const error=Object.freeze({code:'57014'}),env=setup([{steps:snapshotSteps,error}]),arg={...input};let caught",
  "  try{await env.api.withZ02EnqueueDiagnosticPortWitness(arg,()=>env.api.enqueueInboundGridOwnerResponseAutomation(arg),()=>{throw Error('OBSERVER_PRIVATE')})}catch(e){caught=e}assert.equal(caught,error);assert.equal(env.done(),0)",
  " })",
  " await check('duplicate-success-no-upsert-and-clean-scope',async()=>{const dup=Object.freeze({code:'23505'}),env=setup([{steps:snapshotSteps,data:snapshotReply},{steps:jobSteps,error:dup},{steps:duplicateSteps,data:jobReply}]),arg={...input},seen=[]",
  "  const result=await env.api.withZ02EnqueueDiagnosticPortWitness(arg,()=>env.api.enqueueInboundGridOwnerResponseAutomation(arg),(p,e)=>seen.push([p,e]));assert.equal(result.duplicate,true);assert.deepEqual(seen,[['job_insert',dup]]);assert.equal(env.api.z02EnqueueDiagnosticPortObserver(arg),undefined);assert.equal(env.done(),1)",
  " })",
  " assert.equal(cases.length,13)",
  " process.stdout.write(JSON.stringify({kind:'ACTUAL_AUTOMATION_SOURCE_FINITE_PORT_IDENTITY',tests:13,pass:13,fail:0,sqlExecuted:false,nativeExecuted:false}))",
  "}",
  "main().catch(()=>{process.exitCode=1})"
].join('\n')


describe("actual automation runtime diagnostics component", () => {
  it("preserves actual SDK query queues, errors, duplicates and invocation cleanup", () => {
    const output = execFileSync(process.execPath, ["-e", actualZ02PortIdentityProgram], { cwd: process.cwd(), encoding: "utf8" })
    expect(JSON.parse(output)).toEqual({ kind: "ACTUAL_AUTOMATION_SOURCE_FINITE_PORT_IDENTITY", tests: 13, pass: 13, fail: 0, sqlExecuted: false, nativeExecuted: false })
  })
})
