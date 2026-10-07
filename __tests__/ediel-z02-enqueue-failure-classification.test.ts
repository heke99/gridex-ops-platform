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


// Permanent observer component controls. The child reads the LIVE repository
// AST, evaluates only the explicit pure observer closure, and supplies finite
// process/psql/log ports. PGlite below uses column-subset fixtures, without RLS,
// source triggers, SQL admission or any whole native/market acceptance credit.
// Expected finite alphabets remain independent literals. No outside artifacts,
// frozen source hashes, native89 module import, or fixture-file writer is used.
const liveCompleteObserverProgram = [
  "import fs from 'node:fs'",
  "import path from 'node:path'",
  "import vm from 'node:vm'",
  "import assert from 'node:assert/strict'",
  "import {createRequire} from 'node:module'",
  "import {createHash} from 'node:crypto'",
  "import * as actualNodeUtil from 'node:util'",
  "",
  "const root=process.cwd()",
  "const require=createRequire(root+'/package.json'),ts=require('typescript')",
  "const nativePath=root+'/scripts/ediel-at-z02-supplier-native.test.ts'",
  "const source=fs.readFileSync(nativePath,'utf8')",
  "const sha=value=>createHash('sha256').update(value).digest('hex')",
  "const ast=ts.createSourceFile(nativePath,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS)",
  "assert.equal(ast.parseDiagnostics.length,0)",
  "const names=['positiveProjectionStates','positiveProjectionReasons','positiveProjectionData','positiveProjectionCount',",
  " 'positiveProjectionObject','positiveEnqueueThrowClasses','positiveEnqueueClasses','positiveEnqueueShape',",
  " 'positiveEnqueueFailureProjection','observeZ02EnqueueFailureProjection','observeZ02PositiveProjection',",
  " 'positiveStructuredSqlStates','positiveStructuredPublicLabels','positiveStructuredEvidenceClasses',",
  " 'positiveStructuredObject','positiveStructuredData','positiveStructuredShape','positiveStructuredBins',",
  " 'positiveStructuredEnqueueFailureProjection','observeZ02StructuredEnqueueFailureProjection']",
  "const selected=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)",
  " ||ts.isVariableStatement(node)&&node.declarationList.declarations.some(row=>ts.isIdentifier(row.name)&&names.includes(row.name.text)))",
  "const extractedNames=selected.flatMap(node=>ts.isFunctionDeclaration(node)?[node.name.text]:node.declarationList.declarations.map(row=>row.name.text))",
  "assert.deepEqual([...extractedNames].sort(),[...names].sort())",
  "const snippet=selected.map(node=>source.slice(node.getFullStart(),node.end)).join('\\n')",
  "const transpiled=ts.transpileModule(snippet,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}})",
  "assert.equal((transpiled.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0)",
  "const declarations=selected.map(node=>({name:ts.isFunctionDeclaration(node)?node.name.text:node.declarationList.declarations[0].name.text,",
  " start:node.getFullStart(),end:node.end,sourceSha256:sha(source.slice(node.getFullStart(),node.end))}))",
  "",
  "const sqlStates=['23502','23503','23505','23514','42501','42P01','42703','P0001','22P02','42883','unknown']",
  "const labels=['active_request_snapshot_unavailable','original_snapshot_schema_unavailable','automation_job_schema_unavailable',",
  " 'persisted_operation_snapshot_schema_unavailable','unknown']",
  "const evidence=['classified','missing_metadata','malformed_metadata','conflicting_copies']",
  "const oldClasses=['active_request_snapshot_unavailable','original_snapshot_schema_unavailable','automation_job_schema_unavailable',",
  " 'persisted_operation_snapshot_schema_unavailable','opaque_object_string','absent','unclassified','conflicting_evidence']",
  "const bins=keys=>Object.fromEntries(keys.map(key=>[key,0]))",
  "const tests=[],queries=[]",
  "for(const [index,variant] of ['L','LK'].entries()){",
  " const id=n=>`${index+1}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`",
  " const f={companyId:id(1),customerId:id(2),siteId:id(3),pointId:id(4),variant}",
  " const original={originalZ01:{id:id(5)},requestId:id(6),variant}",
  " const received={id:id(7),variant}",
  " const oldBins={...bins(oldClasses),opaque_object_string:1}",
  " const proposed={schemaVersion:1,requestCount:1,eventCount:1,eventOverflow:false,copiesAgree:true,",
  "  evidenceBins:{...bins(evidence),classified:1},sqlStateBins:{...bins(sqlStates),'23514':1},",
  "  publicLabelBins:{...bins(labels),unknown:1}}",
  " const fixture={message:{originalMatches:true,pointMatches:true,customerMatches:true,siteMatches:true,atomicProjection:null,",
  "  status:'received',processingStatus:'manual_review',assessmentReceipt:'absent'},",
  "  request:{originalMatches:true,responseMatches:true,pointMatches:true,status:'manual_review_required',blockerCode:'z02_processing_enqueue_failed'},",
  "  jobCount:0,jobs:[],enqueueFailure:{requestCount:1,requestClass:'opaque_object_string',eventCount:1,copiesAgree:true,bins:oldBins},",
  "  enqueueFailureClassification:proposed}",
  " const logs=[],calls=[]",
  " const context=vm.createContext({positiveStructuredNodeUtil:actualNodeUtil,",
  "  execFileSync(command,args,config){",
  "   assert.equal(command,'psql')",
  "   assert.deepEqual(Array.from(args),['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'])",
  "   assert.equal(config.timeout,10000);assert.equal(config.maxBuffer,2_000_000);assert.equal(config.encoding,'utf8')",
  "   assert.deepEqual(Array.from(config.stdio),['pipe','pipe','pipe'])",
  "   calls.push({command,args:Array.from(args),config:{...config,stdio:Array.from(config.stdio)}})",
  "   return JSON.stringify(fixture)",
  "  },process:{env:{NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321'}},JSON,",
  "  literal(value){assert.equal(typeof value,'string');return \"'\"+value.replaceAll(\"'\",\"''\")+\"'\"},",
  "  console:{info(...args){logs.push(args)}},f,original,received})",
  " vm.runInContext(transpiled.outputText,context,{filename:'actual-complete-existing-observer-transpiled.js'})",
  " assert.equal(vm.runInContext('observeZ02PositiveProjection(f, original, received)',context),undefined)",
  " assert.equal(calls.length,1)",
  " const query=calls[0].config.input",
  " assert.equal(typeof query,'string');assert.match(query,/^WITH enqueue_request AS/)",
  " assert.doesNotMatch(query,/\\b(INSERT|UPDATE|DELETE|CALL|CREATE|ALTER|DROP)\\b/i)",
  " for(const token of [\"r.id='\"+original.requestId+\"'\", \"r.company_id='\"+f.companyId+\"'\", \"r.customer_id='\"+f.customerId+\"'\",",
  "  \"r.site_id='\"+f.siteId+\"'\", \"r.ediel_message_id='\"+original.originalZ01.id+\"'\", \"m.id='\"+received.id+\"'\",",
  "  \"m.company_id='\"+f.companyId+\"'\", \"m.direction='inbound'\", \"m.message_family='PRODAT'\", \"m.message_code='Z02'\",",
  "  \"e.company_id='\"+f.companyId+\"'\", \"e.ediel_message_id='\"+received.id+\"'\", \"e.event_type='manual_note'\", \"e.event_status='error'\",",
  "  \"e.message='Z02 kunde inte starta canonical verifiering och applicerades inte.'\", \"payload->>'customerInfoRequestId'='\"+original.requestId+\"'\",",
  "  'AND EXISTS (SELECT 1 FROM enqueue_request)', 'payload IS DISTINCT FROM event_payload', 'least(count(*),65)'])assert.ok(query.includes(token),variant+': original SQL predicate '+token)",
  " assert.equal((query.match(/LIMIT 5/g)??[]).length,1)",
  " assert.equal(logs.length,3)",
  " assert.deepEqual(logs.slice(0,2).map(row=>row[0]),['Z02_NATIVE_POSITIVE_PROJECTION','Z02_NATIVE_ENQUEUE_FAILURE_CLASSIFICATION'])",
  " const publicProjection=JSON.parse(logs[0][1]),oldProjection=JSON.parse(logs[1][1])",
  " assert.deepEqual(publicProjection,{stage:'positive.pre606.public_projection',observed:true,jobCount:0,jobsTruncated:false,",
  "  message:fixture.message,request:fixture.request,jobs:[]})",
  " assert.deepEqual(oldProjection,{stage:'positive.pre606.enqueue_failure_classification',observed:true,eventCount:1,eventOverflow:false,",
  "  requestClass:'opaque_object_string',copiesAgree:true,classAgreement:true,bins:oldBins})",
  " const control={variant,actualCompleteObserverCalled:true,originalPublicProjectionPASS:true,originalEnqueueProjectionPASS:true,",
  "  originalPsqlPortPASS:true,originalCorrelatedSelectPASS:true,proposedStructuredInput:proposed,",
  "  fixtureSha256:sha(JSON.stringify(fixture)),querySha256:sha(query),oldLogSha256:sha(JSON.stringify(logs)),",
  "  expectedNewPrefix:'Z02_NATIVE_ENQUEUE_STRUCTURED_CLASSIFICATION',newAssertionOutcome:null}",
  " try{",
  "  const newLog=logs.find(row=>row[0]===control.expectedNewPrefix)",
  "  assert.ok(newLog,variant+': complete existing observer must emit the new separately keyed finite structured classification')",
  "  const result=JSON.parse(newLog[1]);assert.equal(result.observed,true)",
  "  for(const key of Object.keys(proposed))assert.deepEqual(result[key],proposed[key],variant+': finite new output '+key)",
  "  control.newAssertionOutcome='PASS'",
  " }catch(error){",
  "  assert.ok(error instanceof assert.AssertionError)",
  "  control.newAssertionOutcome='FAIL';control.firstFailure={name:error.name,code:error.code,operator:error.operator,",
  "   message:error.message,actual:error.actual,expected:error.expected}",
  " }",
  " tests.push(control);queries.push({variant,sha256:sha(query)})",
  "}",
  "assert.equal(fs.readFileSync(nativePath,'utf8'),source,'native source unchanged during controls')",
  "const failed=tests.filter(row=>row.newAssertionOutcome==='FAIL').length",
  "const result={kind:'SAME_FULL_ACTUAL_OBSERVER_RED_TO_GREEN_NEW_FINITE_EMIT',sourcePath:nativePath,",
  " sourceSha256:sha(source),snippetSha256:sha(snippet),transpiledSha256:sha(transpiled.outputText),declarations,",
  " completeSourceExtracted:true,parseDiagnostics:0,testedVariants:['L','LK'],tests:tests.length,pass:tests.length-failed,fail:failed,",
  " legacyControlCallsPASS:tests.length,newAssertions:tests,queries,expectedFailure:'previous_missing_new_emit_now_present_old_logs_and_port_unchanged',",
  " trueExit:failed?1:0,genuineNativeExecuted:false,actualDbExecuted:false,sourceEdited:true,productCause:'UNKNOWN',stoppedAfterAuthorizedSourceControls:true}",
  "console.log(JSON.stringify({kind:result.kind,sourceSha256:result.sourceSha256,snippetSha256:result.snippetSha256,",
  " tests:result.tests,pass:result.pass,fail:result.fail,legacyControlCallsPASS:result.legacyControlCallsPASS,trueExit:result.trueExit}))",
  "process.exitCode=result.trueExit",
].join('\n')

const liveHostileAndCapturedSelectProgram = [
  "import fs from 'node:fs'",
  "import vm from 'node:vm'",
  "import assert from 'node:assert/strict'",
  "import path from 'node:path'",
  "import {createRequire} from 'node:module'",
  "import {createHash} from 'node:crypto'",
  "import * as actualNodeUtil from 'node:util'",
  "const root=process.cwd()",
  "const require=createRequire(root+'/package.json'),ts=require('typescript'),{PGlite}=require('@electric-sql/pglite')",
  "const sha=v=>createHash('sha256').update(v).digest('hex')",
  "const source=fs.readFileSync(root+'/scripts/ediel-at-z02-supplier-native.test.ts','utf8')",
  "const nativePath=root+'/scripts/ediel-at-z02-supplier-native.test.ts'",
  "const ast=ts.createSourceFile(nativePath,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS)",
  "assert.equal(ast.parseDiagnostics.length,0)",
  "const names=['positiveProjectionStates','positiveProjectionReasons','positiveProjectionData','positiveProjectionCount',",
  " 'positiveProjectionObject','positiveEnqueueThrowClasses','positiveEnqueueClasses','positiveEnqueueShape',",
  " 'positiveEnqueueFailureProjection','observeZ02EnqueueFailureProjection','observeZ02PositiveProjection',",
  " 'positiveStructuredSqlStates','positiveStructuredPublicLabels','positiveStructuredEvidenceClasses',",
  " 'positiveStructuredObject','positiveStructuredData','positiveStructuredShape','positiveStructuredBins',",
  " 'positiveStructuredEnqueueFailureProjection','observeZ02StructuredEnqueueFailureProjection']",
  "const selected=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)",
  " ||ts.isVariableStatement(node)&&node.declarationList.declarations.some(row=>ts.isIdentifier(row.name)&&names.includes(row.name.text)))",
  "const extractedNames=selected.flatMap(node=>ts.isFunctionDeclaration(node)?[node.name.text]:node.declarationList.declarations.map(row=>row.name.text))",
  "assert.deepEqual([...extractedNames].sort(),[...names].sort())",
  "const snippet=selected.map(node=>source.slice(node.getFullStart(),node.end)).join('\\n')",
  "const transpiled=ts.transpileModule(snippet,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}})",
  "assert.equal((transpiled.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0)",
  "",
  "const compiled=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText",
  "const base=()=>({\"message\":{\"originalMatches\":true,\"pointMatches\":true,\"customerMatches\":true,\"siteMatches\":true,\"atomicProjection\":null,\"status\":\"received\",\"processingStatus\":\"manual_review\",\"assessmentReceipt\":\"absent\"},\"request\":{\"originalMatches\":true,\"responseMatches\":true,\"pointMatches\":true,\"status\":\"manual_review_required\",\"blockerCode\":\"z02_processing_enqueue_failed\"},\"jobCount\":0,\"jobs\":[],\"enqueueFailure\":{\"requestCount\":1,\"requestClass\":\"opaque_object_string\",\"eventCount\":1,\"copiesAgree\":true,\"bins\":{\"active_request_snapshot_unavailable\":0,\"original_snapshot_schema_unavailable\":0,\"automation_job_schema_unavailable\":0,\"persisted_operation_snapshot_schema_unavailable\":0,\"opaque_object_string\":1,\"absent\":0,\"unclassified\":0,\"conflicting_evidence\":0}},\"enqueueFailureClassification\":{\"schemaVersion\":1,\"requestCount\":1,\"eventCount\":1,\"eventOverflow\":false,\"copiesAgree\":true,\"evidenceBins\":{\"classified\":1,\"missing_metadata\":0,\"malformed_metadata\":0,\"conflicting_copies\":0},\"sqlStateBins\":{\"23502\":0,\"23503\":0,\"23505\":0,\"23514\":1,\"42501\":0,\"42703\":0,\"42883\":0,\"42P01\":0,\"P0001\":0,\"22P02\":0,\"unknown\":0},\"publicLabelBins\":{\"active_request_snapshot_unavailable\":0,\"original_snapshot_schema_unavailable\":0,\"automation_job_schema_unavailable\":0,\"persisted_operation_snapshot_schema_unavailable\":0,\"unknown\":1}}})",
  "const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`",
  "const f={companyId:id(1),customerId:id(2),siteId:id(3),pointId:id(4),variant:'L'}",
  "const original={originalZ01:{id:id(5)},requestId:id(6),variant:'L'},received={id:id(7),variant:'L'}",
  "const privateCanary='PRIVATE_FINITE_OBSERVER_CANARY_MUST_NOT_LEAK'",
  "const tests=[],failures=[]",
  "let capturedQuery",
  "function environment(data,opts={}){",
  " const logs=[],calls=[]",
  " const context=vm.createContext({positiveStructuredNodeUtil:opts.missingCapability?{}:actualNodeUtil,data,f,original,received,",
  "  process:{env:{NEXT_PUBLIC_SUPABASE_URL:opts.foreignHost?'https://foreign.invalid':'http://127.0.0.1:54321'}},",
  "  JSON:{parse:opts.decoded?()=>data:JSON.parse,stringify:JSON.stringify},",
  "  literal(value){assert.equal(typeof value,'string');return \"'\"+value.replaceAll(\"'\",\"''\")+\"'\"},",
  "  execFileSync(command,args,config){",
  "   assert.equal(command,'psql');assert.deepEqual(Array.from(args),['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'])",
  "   assert.equal(config.timeout,10000);assert.equal(config.maxBuffer,2_000_000);assert.equal(config.encoding,'utf8')",
  "   assert.deepEqual(Array.from(config.stdio),['pipe','pipe','pipe']);capturedQuery=config.input;calls.push(config.input)",
  "   if(opts.sqlError)throw Object.assign(Error(privateCanary),{stdout:privateCanary,stderr:privateCanary})",
  "   return opts.badJson?privateCanary:opts.decoded?'{}':JSON.stringify(data)",
  "  },console:{info(...args){if(opts.loggerError)throw Error(privateCanary);logs.push(args)}}})",
  " vm.runInContext(compiled,context)",
  " const expression=opts.whole?'observeZ02PositiveProjection(f,original,received)':'observeZ02StructuredEnqueueFailureProjection(data)'",
  " assert.equal(vm.runInContext(expression,context),undefined)",
  " for(const [prefix,text] of logs){assert.equal(typeof text,'string');assert.equal(text.includes(privateCanary),false);assert.ok(['Z02_NATIVE_POSITIVE_PROJECTION','Z02_NATIVE_ENQUEUE_FAILURE_CLASSIFICATION','Z02_NATIVE_ENQUEUE_STRUCTURED_CLASSIFICATION'].includes(prefix))}",
  " const log=logs.find(row=>row[0]==='Z02_NATIVE_ENQUEUE_STRUCTURED_CLASSIFICATION')",
  " return {result:log?JSON.parse(log[1]):null,logs,calls,context}",
  "}",
  "function check(name,fn){try{fn();tests.push({name,kind:'ACTUAL_EXTRACTED_JS',outcome:'PASS'})}catch(error){failures.push({name,error:error.name,message:error.message});tests.push({name,kind:'ACTUAL_EXTRACTED_JS',outcome:'FAIL'})}}",
  "function unavailable(data,opts={}){const r=environment(data,opts).result;assert.deepEqual(r,{stage:'positive.pre606.enqueue_structured_classification',observed:false,reason:'observation_unavailable'});return r}",
  "check('same-whole-structured-and-old-controls',()=>{const r=environment(base(),{whole:true});assert.equal(r.logs.length,3);assert.equal(r.result.observed,true);assert.equal(r.result.sqlStateBins['23514'],1)})",
  "const actual=environment(base()).context",
  "// Expected alphabets are independent literals, never copied from production.",
  "const states=['23502','23503','23505','23514','42501','42P01','42703','P0001','22P02','42883','unknown']",
  "const labels=['active_request_snapshot_unavailable','original_snapshot_schema_unavailable','automation_job_schema_unavailable','persisted_operation_snapshot_schema_unavailable','unknown']",
  "const evidence=['classified','missing_metadata','malformed_metadata','conflicting_copies'],empty=keys=>Object.fromEntries(keys.map(k=>[k,0]))",
  "assert.deepEqual(Array.from(vm.runInContext('positiveStructuredSqlStates',actual)),states)",
  "assert.deepEqual(Array.from(vm.runInContext('positiveStructuredPublicLabels',actual)),labels)",
  "assert.deepEqual(Array.from(vm.runInContext('positiveStructuredEvidenceClasses',actual)),evidence)",
  "for(const state of states)check('exact-state-'+state,()=>{const d=base();d.enqueueFailureClassification.sqlStateBins={...empty(states),[state]:1};assert.equal(environment(d).result.sqlStateBins[state],1)})",
  "for(const label of labels)check('exact-label-'+label,()=>{const d=base();d.enqueueFailureClassification.publicLabelBins={...empty(labels),[label]:1};assert.equal(environment(d).result.publicLabelBins[label],1)})",
  "for(const category of evidence)check('finite-evidence-'+category,()=>{const d=base(),n=d.enqueueFailureClassification;n.evidenceBins={...empty(evidence),[category]:1};if(category!=='classified'){n.sqlStateBins=empty(states);n.publicLabelBins=empty(labels)}if(category==='conflicting_copies')n.copiesAgree=false;assert.equal(environment(d).result.evidenceBins[category],1)})",
  "check('zero-events-null-copy-and-zero-bins',()=>{const d=base(),n=d.enqueueFailureClassification;n.eventCount=0;n.copiesAgree=null;n.evidenceBins=empty(evidence);n.sqlStateBins=empty(states);n.publicLabelBins=empty(labels);assert.equal(environment(d).result.eventCount,0)})",
  "check('exact64-complete-counts',()=>{const d=base(),n=d.enqueueFailureClassification;n.eventCount=64;n.evidenceBins.classified=64;n.sqlStateBins['23514']=64;n.publicLabelBins.unknown=64;assert.equal(environment(d).result.eventCount,64)})",
  "check('exact65-overflow-allbinsnull-only-unavailable',()=>{const d=base(),n=d.enqueueFailureClassification;n.eventCount=65;n.eventOverflow=true;n.evidenceBins=null;n.sqlStateBins=null;n.publicLabelBins=null;assert.deepEqual(environment(d).result,{stage:'positive.pre606.enqueue_structured_classification',observed:false,reason:'observation_unavailable',eventOverflow:true})})",
  "for(const bad of [null,undefined,false,0,'1',[],()=>1])check('new-value-reject-'+String(typeof bad)+'-'+String(bad),()=>{const d=base();d.enqueueFailureClassification=bad;unavailable(d)})",
  "for(const [key,values] of Object.entries({schemaVersion:[0,2,'1',true,null],requestCount:[0,2,'1',true,null],eventCount:[-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',true,66],eventOverflow:[null,0,'false'],copiesAgree:[undefined,0,'true',null]}))for(const [i,value] of values.entries())check('invalid-scalar-'+key+'-'+i,()=>{const d=base();d.enqueueFailureClassification[key]=value;unavailable(d,{whole:true,decoded:true})})",
  "for(const key of Object.keys(base().enqueueFailureClassification)){",
  " check('missing-new-key-'+key,()=>{const d=base();delete d.enqueueFailureClassification[key];unavailable(d)})",
  " check('accessor-new-key-'+key+'-zero-getters',()=>{let calls=0;const d=base();Object.defineProperty(d.enqueueFailureClassification,key,{get(){calls++;throw Error(privateCanary)}});unavailable(d);assert.equal(calls,0)})",
  "}",
  "check('extra-new-key-refused',()=>{const d=base();d.enqueueFailureClassification[privateCanary]=privateCanary;unavailable(d)})",
  "check('extra-symbol-key-refused',()=>{const d=base();d.enqueueFailureClassification[Symbol(privateCanary)]=privateCanary;unavailable(d)})",
  "check('outer-accessor-new-key-zero-getters',()=>{let calls=0;const d=base();Object.defineProperty(d,'enqueueFailureClassification',{get(){calls++;throw Error(privateCanary)}});unavailable(d);assert.equal(calls,0)})",
  "check('inherited-new-key-refused',()=>unavailable(Object.create(base())))",
  "for(const key of ['evidenceBins','sqlStateBins','publicLabelBins']){",
  " for(const value of [null,[],{},false,privateCanary])check('bad-bin-container-'+key+'-'+typeof value,()=>{const d=base();d.enqueueFailureClassification[key]=value;unavailable(d)})",
  " const first=Object.keys(base().enqueueFailureClassification[key])[0]",
  " for(const value of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',true,65])check('bad-bin-count-'+key+'-'+String(value),()=>{const d=base();d.enqueueFailureClassification[key][first]=value;unavailable(d,{whole:true,decoded:true})})",
  " check('missing-bin-'+key,()=>{const d=base();delete d.enqueueFailureClassification[key][first];unavailable(d)})",
  " check('extra-bin-'+key,()=>{const d=base();d.enqueueFailureClassification[key][privateCanary]=1;unavailable(d)})",
  " check('inherited-bin-'+key,()=>{const d=base();d.enqueueFailureClassification[key]=Object.create(d.enqueueFailureClassification[key]);unavailable(d)})",
  " check('accessor-bin-'+key+'-zero-getters',()=>{let calls=0;const d=base();Object.defineProperty(d.enqueueFailureClassification[key],first,{get(){calls++;throw Error(privateCanary)}});unavailable(d);assert.equal(calls,0)})",
  "}",
  "for(const key of ['eventCount','evidenceBins','sqlStateBins','publicLabelBins'])check('impossible-sum-'+key,()=>{const d=base(),n=d.enqueueFailureClassification;if(key==='eventCount')n.eventCount=2;else n[key][Object.keys(n[key])[0]]=3;unavailable(d)})",
  "check('false-copy-requires-conflict',()=>{const d=base();d.enqueueFailureClassification.copiesAgree=false;unavailable(d)})",
  "check('true-copy-forbids-conflict',()=>{const d=base(),n=d.enqueueFailureClassification;n.evidenceBins={...empty(evidence),conflicting_copies:1};n.sqlStateBins=empty(states);n.publicLabelBins=empty(labels);unavailable(d)})",
  "check('zero-copy-must-null',()=>{const d=base(),n=d.enqueueFailureClassification;n.eventCount=0;unavailable(d)})",
  "for(const key of ['eventOverflow','evidenceBins','sqlStateBins','publicLabelBins'])check('invalid65-sentinel-'+key,()=>{const d=base(),n=d.enqueueFailureClassification;n.eventCount=65;n.eventOverflow=true;n.evidenceBins=null;n.sqlStateBins=null;n.publicLabelBins=null;n[key]=key==='eventOverflow'?false:{};unavailable(d)})",
  "check('false65-overflow-on64-refused',()=>{const d=base();d.enqueueFailureClassification.eventOverflow=true;unavailable(d)})",
  "for(const target of ['outer','new','evidenceBins','sqlStateBins','publicLabelBins']){",
  " check('actual-proxy-'+target+'-zero-all-traps',()=>{let traps=0;const handler=Object.fromEntries(['get','set','has','deleteProperty','ownKeys','getOwnPropertyDescriptor','defineProperty','getPrototypeOf','setPrototypeOf','isExtensible','preventExtensions'].map(k=>[k,()=>{traps++;throw Error(privateCanary)}]));let d=base();if(target==='outer')d=new Proxy(d,handler);else if(target==='new')d.enqueueFailureClassification=new Proxy(d.enqueueFailureClassification,handler);else d.enqueueFailureClassification[target]=new Proxy(d.enqueueFailureClassification[target],handler);unavailable(d);assert.equal(traps,0)})",
  " check('actual-revoked-proxy-'+target+'-refused',()=>{let d=base(),proxy=Proxy.revocable({},{});proxy.revoke();if(target==='outer')d=proxy.proxy;else if(target==='new')d.enqueueFailureClassification=proxy.proxy;else d.enqueueFailureClassification[target]=proxy.proxy;unavailable(d)})",
  "}",
  "check('missing-trusted-capability-no-outer-inspection',()=>{let gets=0;const d=base();Object.defineProperty(d,'enqueueFailureClassification',{get(){gets++;throw Error(privateCanary)}});unavailable(d,{missingCapability:true});assert.equal(gets,0)})",
  "check('missing-trusted-capability-proxy-zero-traps',()=>{let traps=0;const d=new Proxy({}, {ownKeys(){traps++;throw Error(privateCanary)},getOwnPropertyDescriptor(){traps++;throw Error(privateCanary)}});unavailable(d,{missingCapability:true});assert.equal(traps,0)})",
  "check('missing-capability-old-whole-two-logs-preserved',()=>{const r=environment(base(),{whole:true,missingCapability:true});assert.equal(r.logs.length,3);assert.equal(JSON.parse(r.logs[0][1]).observed,true);assert.equal(JSON.parse(r.logs[1][1]).observed,true);assert.equal(r.result.observed,false)})",
  "check('new-logger-throw-does-not-escape',()=>assert.equal(environment(base(),{loggerError:true}).logs.length,0))",
  "for(const opts of [{sqlError:true},{badJson:true},{foreignHost:true}])check('whole-old-failure-plus-new-unavailable-'+Object.keys(opts)[0],()=>{const r=environment(base(),{whole:true,...opts});assert.equal(r.logs.length,3);assert.equal(JSON.parse(r.logs[0][1]).observed,false);assert.equal(JSON.parse(r.logs[1][1]).observed,false);assert.equal(r.result.observed,false)})",
  "check('legacy-raw-unlisted-input-does-not-echo-or-infer',()=>{const d=base();d.enqueueFailure.requestClass=privateCanary;const r=environment(d,{whole:true});assert.equal(JSON.parse(r.logs[1][1]).observed,false);assert.equal(r.result.observed,true)})",
  "",
  "// Capture the actual COMPLETE observer SELECT. The standalone fixture below",
  "// has columns only: no actual RLS, source trigger, admission, or business state.",
  "environment(base(),{whole:true});const query=capturedQuery",
  "const db=new PGlite();let schema,ddl;try {",
  "schema=fs.readFileSync(root+'/supabase/schema.sql','utf8')",
  "const columns={ediel_messages:['id','company_id','related_message_id','metering_point_id','customer_id','site_id','status','processing_status','validation_report','parsed_payload','direction','message_family','message_code'],customer_info_requests:['id','company_id','customer_id','site_id','status','ediel_message_id','response_ediel_message_id','metering_point_id','blocker_code','blocker_reason'],customer_operation_jobs:['id','company_id','customer_id','customer_site_id','job_type','status','payload','result','created_at'],ediel_message_events:['company_id','ediel_message_id','event_type','event_status','message','payload','event_payload']};ddl=[]",
  "for(const [table,names] of Object.entries(columns)){",
  " const start=schema.indexOf('CREATE TABLE public.'+table+' ('),text=schema.slice(start,schema.indexOf('\\n);',start)+3)",
  " assert.ok(start>=0)",
  " const definitions=names.map(name=>{const m=text.match(new RegExp('^    '+name+' (uuid|text|jsonb|timestamp with time zone)(?:[ ,].*)?$','m'));assert.ok(m,table+'.'+name);return name+' '+m[1]})",
  " ddl.push({table,sourceDdlSha256:sha(text),columns:definitions})",
  " await db.exec('CREATE TABLE public.'+table+' ('+definitions.join(',')+');')",
  "}",
  "const lit=v=>v==null?'NULL':\"'\"+String(v).replaceAll(\"'\",\"''\")+\"'\"",
  "const eventText='Z02 kunde inte starta canonical verifiering och applicerades inte.'",
  "const metadata=(sqlState='23514',publicLabel='unknown')=>({schemaVersion:1,sqlState,publicLabel})",
  "async function sqlObservation(events=[{}],requestOverrides={},messageOverrides={}){",
  " await db.exec('TRUNCATE public.ediel_messages,public.customer_info_requests,public.ediel_message_events,public.customer_operation_jobs')",
  " const m={company:id(1),customer:id(2),site:id(3),direction:'inbound',family:'PRODAT',code:'Z02',...messageOverrides}",
  " const r={company:id(1),customer:id(2),site:id(3),id:id(6),original:id(5),...requestOverrides}",
  " await db.exec(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,direction,message_family,message_code) VALUES(${lit(id(7))},${lit(m.company)},${lit(m.customer)},${lit(m.site)},${lit(m.direction)},${lit(m.family)},${lit(m.code)}); INSERT INTO public.customer_info_requests(id,company_id,customer_id,site_id,ediel_message_id,blocker_code,blocker_reason) VALUES(${lit(r.id)},${lit(r.company)},${lit(r.customer)},${lit(r.site)},${lit(r.original)},'z02_processing_enqueue_failed','[object Object]');`)",
  " for(const e of events){",
  "  const payload={customerInfoRequestId:e.request??id(6),error:e.error??'[object Object]'}",
  "  if(!e.missing)payload.enqueueFailureClassification=Object.hasOwn(e,'metadata')?e.metadata:metadata()",
  "  const copy=Object.hasOwn(e,'copy')?e.copy:payload",
  "  await db.exec(`INSERT INTO public.ediel_message_events(company_id,ediel_message_id,event_type,event_status,message,payload,event_payload) VALUES(${lit(e.company??id(1))},${lit(e.messageId??id(7))},${lit(e.type??'manual_note')},${lit(e.status??'error')},${lit(e.message??eventText)},${lit(JSON.stringify(payload))}::jsonb,${lit(JSON.stringify(copy))}::jsonb);`)",
  " }",
  " const data=(await db.query(query)).rows[0].jsonb_build_object",
  " assert.equal(JSON.stringify(data).includes(privateCanary),false,'SQL reduction before stdout excludes canary')",
  " return data",
  "}",
  "async function sqlCheck(name,fn){try{await fn();tests.push({name,kind:'ACTUAL_CAPTURED_SELECT_FINITE_PGLITE',outcome:'PASS'})}catch(error){failures.push({name,error:error.name,message:error.message});tests.push({name,kind:'ACTUAL_CAPTURED_SELECT_FINITE_PGLITE',outcome:'FAIL'})}}",
  "for(const state of states)await sqlCheck('SQL-exact-state-'+state,async()=>{const data=await sqlObservation([{metadata:metadata(state),error:privateCanary}]);const r=environment(data).result;assert.equal(r.sqlStateBins[state],1);assert.equal(r.publicLabelBins.unknown,1);assert.equal(data.enqueueFailure.bins.unclassified,1)})",
  "for(const label of labels)await sqlCheck('SQL-exact-label-'+label,async()=>{const data=await sqlObservation([{metadata:metadata('unknown',label)}]);assert.equal(environment(data).result.publicLabelBins[label],1)})",
  "for(const value of [null,false,[],privateCanary,0,{},metadata('PGRST999'),metadata('23514',privateCanary),{...metadata(),extra:privateCanary},{schemaVersion:'1',sqlState:'23514',publicLabel:'unknown'},{...metadata(),sqlState:23514},{...metadata(),publicLabel:null},{...metadata(),schemaVersion:true},{sqlState:'23514',publicLabel:'unknown'}])await sqlCheck('SQL-malformed-meta-'+JSON.stringify(value),async()=>{const data=await sqlObservation([{metadata:value}]);const r=environment(data).result;assert.equal(r.evidenceBins.malformed_metadata,1);assert.equal(r.sqlStateBins.unknown,0);assert.equal(r.publicLabelBins.unknown,0)})",
  "await sqlCheck('SQL-missing-historical-metadata',async()=>{const data=await sqlObservation([{missing:true}]);assert.equal(environment(data).result.evidenceBins.missing_metadata,1);assert.equal(data.enqueueFailure.bins.opaque_object_string,1)})",
  "await sqlCheck('SQL-mismatched-copy-overrides-known-metadata',async()=>{const data=await sqlObservation([{copy:{customerInfoRequestId:id(6),error:privateCanary,enqueueFailureClassification:metadata('42P01')}}]);const r=environment(data).result;assert.equal(r.evidenceBins.conflicting_copies,1);assert.equal(r.copiesAgree,false);assert.equal(r.sqlStateBins['23514'],0);assert.equal(data.enqueueFailure.bins.conflicting_evidence,1)})",
  "await sqlCheck('SQL-nonobject-copy-no-trusted-metadata',async()=>{const data=await sqlObservation([{copy:privateCanary}]);assert.equal(environment(data).result.evidenceBins.conflicting_copies,1)})",
  "await sqlCheck('SQL-wrong-copy-request',async()=>{const data=await sqlObservation([{copy:{customerInfoRequestId:id(8),error:'[object Object]',enqueueFailureClassification:metadata()}}]);assert.equal(environment(data).result.evidenceBins.conflicting_copies,1)})",
  "await sqlCheck('SQL-mixed-finite-bins-preserved',async()=>{const data=await sqlObservation([{},{metadata:metadata('42P01',labels[0])},{missing:true},{metadata:null}]);const r=environment(data).result;assert.equal(r.eventCount,4);assert.equal(r.evidenceBins.classified,2);assert.equal(r.evidenceBins.missing_metadata,1);assert.equal(r.evidenceBins.malformed_metadata,1);assert.equal(r.sqlStateBins['23514'],1);assert.equal(r.sqlStateBins['42P01'],1)})",
  "for(const field of ['company','customer','site','id','original'])await sqlCheck('SQL-wrong-request-'+field,async()=>{const data=await sqlObservation([{}],{[field]:id(8)});assert.equal(data.enqueueFailureClassification.requestCount,0);assert.equal(data.enqueueFailureClassification.eventCount,0);assert.equal(environment(data).result.observed,false)})",
  "for(const [field,value] of [['company',id(8)],['customer',id(8)],['site',id(8)],['direction','outbound'],['family','UTILTS'],['code','Z14']])await sqlCheck('SQL-wrong-received-'+field,async()=>{const data=await sqlObservation([{}],{},{[field]:value});assert.equal(data.enqueueFailureClassification.requestCount,0);assert.equal(environment(data).result.observed,false)})",
  "for(const event of [{company:id(8)},{messageId:id(8)},{request:id(8)},{type:'failed'},{status:'info'},{message:eventText+privateCanary}])await sqlCheck('SQL-wrong-event-'+Object.keys(event)[0],async()=>{const data=await sqlObservation([event]);assert.equal(environment(data).result.eventCount,0);assert.equal(data.enqueueFailure.eventCount,0)})",
  "for(const count of [0,3,64])await sqlCheck('SQL-complete-count-'+count,async()=>{const data=await sqlObservation(Array.from({length:count},()=>({})));assert.equal(environment(data).result.eventCount,count);assert.equal(data.enqueueFailureClassification.copiesAgree,count?true:null)})",
  "for(const count of [65,70])await sqlCheck('SQL-overflow-'+count+'-exactnullbins',async()=>{const data=await sqlObservation(Array.from({length:count},(_,i)=>({metadata:metadata(i%2?'42P01':'23514')})));assert.equal(data.enqueueFailureClassification.eventCount,65);assert.equal(data.enqueueFailureClassification.eventOverflow,true);for(const key of ['evidenceBins','sqlStateBins','publicLabelBins'])assert.equal(data.enqueueFailureClassification[key],null);assert.equal(environment(data).result.eventOverflow,true);assert.equal(environment(data).result.observed,false)})",
  "} finally { await db.close() }",
  "assert.equal(fs.readFileSync(root+'/scripts/ediel-at-z02-supplier-native.test.ts','utf8'),source,'native source unchanged during controls')",
  "const report={kind:'COMPLETE_ACTUAL_SOURCE_EXTRACTED_HOSTILE_AND_CAPTURED_SELECT_CONTROLS',sourceSha256:sha(source),snippetSha256:sha(snippet),querySha256:sha(query),capturedSchemaSha256:sha(schema),ddl,",
  " tests:tests.length,pass:tests.filter(t=>t.outcome==='PASS').length,fail:failures.length,trueExit:failures.length?1:0,",
  " jsCount:tests.filter(t=>t.kind==='ACTUAL_EXTRACTED_JS').length,pgliteCount:tests.filter(t=>t.kind==='ACTUAL_CAPTURED_SELECT_FINITE_PGLITE').length,",
  " controls:tests,failures,genuineNativeExecuted:false,actualDbAdmissionExecuted:false,sourceAuthorityMinted:false,wholeApproval:false,underlyingPositiveCause:'UNKNOWN'}",
  "assert.deepEqual(failures,[], 'all live observer and finite SQL controls must pass');",
  "console.log(JSON.stringify({kind:report.kind,tests:report.tests,pass:report.pass,fail:report.fail,jsCount:report.jsCount,pgliteCount:report.pgliteCount,trueExit:report.trueExit}))",
  "process.exitCode=report.trueExit",
].join('\n')


describe('permanent live native observer regression controls', () => {
  it('retains both full L/LK legacy logs and correlated SELECT before finite structured output', () => {
    const result = JSON.parse(execFileSync(process.execPath,
      ['--input-type=module', '-e', liveCompleteObserverProgram], { cwd: process.cwd(), encoding: 'utf8' }))
    expect(result).toMatchObject({ tests: 2, pass: 2, fail: 0, legacyControlCallsPASS: 2, trueExit: 0 })
  })
  it('preserves all hostile decoder and actual correlated SELECT fixture invariants', () => {
    const result = JSON.parse(execFileSync(process.execPath,
      ['--input-type=module', '-e', liveHostileAndCapturedSelectProgram], { cwd: process.cwd(), encoding: 'utf8' }))
    expect(result).toEqual({ kind: 'COMPLETE_ACTUAL_SOURCE_EXTRACTED_HOSTILE_AND_CAPTURED_SELECT_CONTROLS',
      tests: 214, pass: 214, fail: 0, jsCount: 157, pgliteCount: 57, trueExit: 0 })
  })
})
