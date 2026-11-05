// Actual registered callbacks with declared finite DB/HTTP/native ports only.
// No Auth, provider, native fixture, Storage or backend process is started.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../scripts/simulation/track5/', import.meta.url))
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const fixture = { companyId: id(10), customerId: id(11), siteId: id(12), actorUserId: id(13), switchId: id(14), routeId: id(15), pointId: id(16), powerOfAttorneyId: id(17), authorizationDocumentId: id(18), contractId: id(19) }
const lanes = ['public.ediel_messages', 'public.outbound_requests', 'public.ediel_message_intents', 'public.ediel_outbox', 'gridex_received_sources.switch_originals', 'gridex_outbound_dispatch.originals', 'gridex_outbound_dispatch.attempts', 'gridex_outbound_dispatch.events', 'gridex_ediel_transport.attempts', 'public.supplier_switch_events', 'public.customer_operation_jobs', 'public.customer_operation_tasks', 'public.customer_operation_events', 'public.powers_of_attorney', 'public.power_of_attorney_events', 'public.supplier_switch_requests']
type Row = Record<string, unknown>
type Options = {
  futureSimple?: boolean; wrongReference?: boolean; futureDate?: boolean; missingDate?: boolean; malformedApi?: boolean; apiStatus?: number
  unrelatedError?: boolean; lookalikeError?: boolean; validError?: boolean; expiredQueues?: boolean
  unsigned?: boolean; wrongPoaScope?: boolean; zeroWrite?: boolean; keepOverrideFuture?: boolean; futureClock?: boolean; initiallyExpired?: boolean
  conflictingSiteAlias?: boolean; conflictingContractAlias?: boolean; missingAcceptance?: boolean
  sweepStatus?: number; badSweep?: boolean; missingEvent?: boolean; signatureOnExpire?: boolean
  wrongReturnShape?: boolean; wrongMessage?: boolean; wrongOriginal?: boolean; extraBlocker?: boolean; wrongReadinessScope?: boolean
  effect?: 'outbox' | 'original' | 'signature' | 'poa-state' | 'switch-state' | 'expiry-history'
}
function actualPoa(options: Options = {}) {
  const tests = new Map<string, () => Promise<void>>()
  let setup: () => Promise<void> = async () => { throw new Error('missing setup') }
  const api = { companyId: id(1), customerId: id(2), siteId: id(3), poaId: id(4) }
  function poa(native: boolean): Row {
    return { id: native ? fixture.powerOfAttorneyId : api.poaId, company_id: native ? fixture.companyId : api.companyId,
      customer_id: native ? fixture.customerId : api.customerId, site_id: native ? fixture.siteId : api.siteId, customer_site_id: native ? fixture.siteId : api.siteId,
      contract_id: native ? fixture.contractId : null, customer_contract_id: native ? fixture.contractId : null,
      power_of_attorney_reference: native ? 'poa_native' : 'poa_api', status: options.unsigned ? 'draft' : 'signed',
      signed_at: '2026-10-30T10:00:00Z', accepted_at: options.missingAcceptance ? null : '2026-10-30T10:00:00Z', valid_to: options.initiallyExpired ? '2000-01-01' : '2099-01-01', valid_until: options.initiallyExpired ? '2000-01-01' : '2099-01-01', revoked_at: null,
      document_hash: hash('controlled native original'), document_path: 'controlled/private/poa.pdf', signed_scopes: ['supplier_switch'], evidence_payload: { accepted: true } }
  }
  let current = poa(false), native = false, creates = 0, expiryEvents = 0, queued = false, tampered = false, switchChanged = false
  const calls = { simpleGet: 0, coreGet: 0, validFlow: 0, expiredFlow: 0, seeds: 0, sweeps: 0 }
  const receipts: Row[] = []
  const expired = () => current.status === 'expired'
  const forbidden = () => { throw new Error('undeclared external port') }
  function graph() {
    return lanes.map(lane => ({ lane, n: queued && ['public.ediel_messages', 'public.ediel_outbox', 'gridex_received_sources.switch_originals'].includes(lane) ? 1 : 0,
      digest: lane === 'public.powers_of_attorney' ? hash(JSON.stringify(current)) : lane === 'public.power_of_attorney_events' ? hash(String(expiryEvents)) : lane === 'public.supplier_switch_requests' ? hash(JSON.stringify({ id: fixture.switchId, changed: switchChanged })) : (tampered && lane === (options.effect === 'original' ? 'gridex_received_sources.switch_originals' : 'public.ediel_outbox') ? 'b' : 'a').repeat(64) }))
  }
  function ready(): Row {
    return { company_id: options.wrongReadinessScope ? id(99) : fixture.companyId, customer_contract_id: fixture.contractId,
      customer_id: fixture.customerId, customer_site_id: fixture.siteId, metering_point_id: fixture.pointId,
      agreement_ready: true, agreement_signed: true, facility_data_ready: true, switch_data_ready: true, signed_pdf_archived: true, start_date_ready: true,
      legal_document_count: 2, accepted_document_count: 2, valid_power_of_attorney: !expired(), switch_ready: !expired(),
      lifecycle_stage: expired() ? 'switch_data_ready' : 'switch_ready',
      blockers: expired() ? ['valid_power_of_attorney_missing', ...(options.extraBlocker ? ['facility_data_not_ready'] : [])] : [] }
  }
  function messageProof() {
    const messageId = id(20), intentId = id(21), outboundId = id(22), raw = "UNB+SYNTHETIC+Z03'UNZ+1'", digest = hash(raw)
    return { message: { id: messageId, company_id: options.wrongMessage ? id(99) : fixture.companyId, customer_id: fixture.customerId,
      site_id: fixture.siteId, metering_point_id: fixture.pointId, switch_request_id: fixture.switchId, message_family: 'PRODAT', message_code: 'Z03',
      direction: 'outbound', environment: 'test', status: 'queued', intent_id: intentId, outbound_request_id: outboundId, raw_payload: raw, immutable_payload_hash: digest },
    intent: { id: intentId, company_id: fixture.companyId, operation_id: fixture.switchId, supplier_switch_request_id: fixture.switchId,
      customer_id: fixture.customerId, customer_site_id: fixture.siteId, ediel_message_id: messageId, outbound_request_id: outboundId },
    original: { message_id: messageId, company_id: fixture.companyId, contract_id: options.wrongOriginal ? id(99) : fixture.contractId, intent_id: intentId, outbound_request_id: outboundId, payload_hash: digest } }
  }
  const ports: Record<string, unknown> = {
    vitest: { describe: (_: string, run: () => void) => run(), beforeAll: (run: typeof setup) => { setup = run },
      it: (name: string, run: () => Promise<void>) => tests.set(name, run), expect },
    '../lib': { sim: { appUrl: 'http://127.0.0.1:3105' }, requireEnv: (name: string) => { expect(name).toBe('CRON_SECRET'); return 'controlled-only' },
      psql: (sql: string) => {
        if (sql.includes('API01_POA_EXPIRE')) {
          expect(sql).toContain(String(current.id)); expect(sql).toContain(String(current.company_id))
          if (options.zeroWrite) return ''
          current.valid_to = '2026-10-31'; if (!options.keepOverrideFuture) current.valid_until = '2026-10-31'
          if (options.signatureOnExpire) current.document_hash = hash('changed original')
          return String(current.id)
        }
        if (sql.includes('customer_reference')) return 'customer-reference'
        return forbidden()
      },
      psqlRows: (sql: string) => {
        if (sql.includes('API01_POA_SITE')) return [{ id: api.siteId }]
        if (sql.includes('API01_POA_FACT')) return [{ ...current, ...(options.wrongPoaScope ? { company_id: id(99) } : {}),
          ...(options.conflictingSiteAlias ? { site_id: id(99) } : {}), ...(options.conflictingContractAlias && native ? { customer_contract_id: id(99) } : {}) }]
        if (sql.includes('API01_POA_CLOCK')) return [{ now: '2026-11-01T12:00:00Z', dbToday: '2026-11-01', stockholmToday: '2026-11-01', expiredOn: options.futureClock ? '2999-01-01' : '2026-10-31' }]
        if (sql.includes('API01_POA_EVENTS')) return [{ n: expiryEvents }]
        if (sql.includes('API01_POA_READINESS')) return [ready()]
        if (sql.includes('API01_POA_GRAPH')) return graph()
        if (sql.includes('API01_POA_MESSAGE')) return [messageProof()]
        return forbidden()
      } },
    '../lib/partner': { createPartnerClient: () => ({}),
      partner: async (_key: unknown, method: string, resource: string, body?: Row) => {
        if (method === 'POST') {
          const site = ++creates === 1
          if (!site) current.document_hash = hash(Buffer.from(String(body?.file_base64), 'base64'))
          return { status: 201, json: { entity_id: site ? 'site-reference' : 'poa_api' }, text: '{}' }
        }
        const core = resource.startsWith('powers-of-attorney/')
        if (core) calls.coreGet++; else calls.simpleGet++
        const facts: Row = { status: options.futureSimple && !core ? 'signed' : current.status,
          valid_to: options.futureSimple && !core || options.futureDate ? '2999-01-01' : options.missingDate ? undefined : current.valid_to,
          signed_at: current.signed_at }
        facts[core ? 'power_of_attorney_reference' : 'entity_id'] = options.wrongReference ? 'poa_wrong' : current.power_of_attorney_reference
        const value = options.malformedApi ? null : core ? { data: facts } : facts
        return { status: options.apiStatus ?? 200, json: value, text: JSON.stringify(value) }
      } },
    '../lib/receipts': { receipt: (_id: string, _step: string, data: Row) => receipts.push(data), http: (status: number, text: string) => ({ status, bodySha256: hash(text) }), sha256: hash },
    '../lib/t5-world': { createCompany: () => api.companyId, createCustomer: () => api.customerId, lit: (v: unknown) => v === null ? 'NULL' : "'" + String(v).replaceAll("'", "''") + "'" },
    '@/scripts/helpers/ediel-normal-switch-native-fixture': {
      futureNativeSupplyDate: (days: number) => { expect(days).toBe(14); return '2026-11-15' },
      seedNormalSwitchNativeFixture: async (input: unknown) => {
        expect(input).toEqual({ deferOriginal: true, requestedStartDate: '2026-11-15' })
        calls.seeds++; native = true; current = poa(true); expiryEvents = 0; queued = false; return { ...fixture }
      } },
    '@/lib/ediel/flows/prodatSwitch': { prepareAndQueueEdielZ03: async (input: unknown) => {
      expect(native).toBe(true)
      expect(input).toEqual({ actorUserId: fixture.actorUserId, switchRequestId: fixture.switchId, communicationRouteId: fixture.routeId, environment: 'test' })
      if (expired()) {
        calls.expiredFlow++
        if (options.expiredQueues) { tampered = true; return { id: id(20) } }
        if (options.effect === 'signature') current.evidence_payload = { accepted: false }
        else if (options.effect === 'poa-state') { current.status = 'signed'; current.valid_to = '2099-01-01'; current.valid_until = '2099-01-01' }
        else if (options.effect === 'switch-state') switchChanged = true
        else if (options.effect === 'expiry-history') expiryEvents++
        else if (options.effect) tampered = true
        throw new Error(options.unrelatedError ? 'UNRELATED_CANONICAL_ROUTE_CONFIGURATION_FAILURE' : options.lookalikeError ? 'PRODAT Z03 stoppades av canonical switch-gate: supplier_switch_not_ready EXTRA' : 'PRODAT Z03 stoppades av canonical switch-gate: supplier_switch_not_ready')
      }
      calls.validFlow++; if (options.validError) throw new Error('controlled infrastructure unavailable')
      queued = true; return options.wrongReturnShape ? { message: { id: id(20) } } : { id: id(20) }
    } },
  }
  const filename = path.join(root, 'scenarios/api01-poa.test.ts')
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  runInNewContext(code, { exports: {}, require: (name: string) => { if (!Object.hasOwn(ports, name)) return forbidden(); return ports[name] },
    Buffer, URL, fetch: async (url: URL, init: RequestInit) => {
      expect(String(url)).toBe('http://127.0.0.1:3105/api/internal/customer-operations/cron?limit=100'); expect(init.method).toBe('POST'); calls.sweeps++
      if ((options.sweepStatus ?? 200) === 200) { current.status = 'expired'; if (!options.missingEvent) expiryEvents++ }
      return new Response(JSON.stringify(options.badSweep ? { ok: false } : { ok: true, result: { poaExpiry: { expired: 1 } } }), { status: options.sweepStatus ?? 200 })
    }, console: { info() {} },
  }, { filename })
  const run = (part: string) => { const found = [...tests].find(([name]) => name.includes(part)); if (!found) throw new Error('missing actual callback'); return found[1]() }
  return { setup: () => setup(), run, calls, receipts }
}

async function execute(options: Options, callback: 'GET redovisar' | 'leverantörsbyte' = 'GET redovisar') {
  const c = actualPoa(options); await c.setup(); return { ...c, result: c.run(callback) }
}
describe('actual POA harness must reject the two preserved falseGREEN stimuli', () => {
  it('rejects signed+2999 on the simple API while stored/core are expired', async () => {
    const c = await execute({ futureSimple: true }); await expect(c.result).rejects.toThrow(); expect(c.calls.simpleGet).toBe(1)
  })
  it('rejects unrelated route/config error instead of calling it a POA refusal', async () => {
    const c = await execute({ unrelatedError: true }, 'leverantörsbyte'); await expect(c.result).rejects.toThrow('technical_failure_not_poa_denial')
    expect(c.calls.validFlow).toBe(1); expect(c.calls.expiredFlow).toBe(1)
  })
})
describe('actual POA expiry and causal refusal positives', () => {
  it('accepts exact stored/simple/core expiry and actual signature binding', async () => {
    const c = await execute({}); await expect(c.result).resolves.toBeUndefined(); expect(c.calls).toMatchObject({ simpleGet: 1, coreGet: 1, sweeps: 1 })
    expect(c.receipts[0].notVerified).toContain('revoked_poa')
  })
  it('accepts same-fixture valid direct-id queue then exact POA refusal without new effects', async () => {
    const c = await execute({}, 'leverantörsbyte'); await expect(c.result).resolves.toBeUndefined()
    expect(c.calls).toMatchObject({ seeds: 1, validFlow: 1, expiredFlow: 1, sweeps: 1 })
    expect(c.receipts[0].controlMessage).toBe(id(20)); expect(c.receipts[0].notVerified).toContain('revoked_poa')
  })
})
describe('actual POA registered callbacks fail closed on unqualified facts and effects', () => {
  it.each(['wrongReference', 'futureDate', 'missingDate', 'malformedApi'] as const)('rejects %s from the API response', async key => {
    const c = await execute({ [key]: true }); await expect(c.result).rejects.toThrow()
  })
  it.each([500, 503])('holds HTTP%d instead of accepting an expiry substring', async apiStatus => {
    const c = await execute({ apiStatus }); await expect(c.result).rejects.toThrow('poa_read_transport')
  })
  it.each(['unsigned', 'wrongPoaScope', 'zeroWrite', 'keepOverrideFuture', 'futureClock', 'signatureOnExpire', 'initiallyExpired', 'conflictingSiteAlias', 'missingAcceptance'] as const)('holds %s before any refusal inference', async key => {
    const c = await execute({ [key]: true }); await expect(c.result).rejects.toThrow(); expect(c.calls.expiredFlow).toBe(0)
  })
  it.each([{ sweepStatus: 500 }, { badSweep: true }, { missingEvent: true }])('holds incomplete sweep %j', async options => {
    const c = await execute(options); await expect(c.result).rejects.toThrow()
  })
  it.each(['wrongReturnShape', 'wrongMessage', 'wrongOriginal', 'extraBlocker', 'wrongReadinessScope', 'validError', 'conflictingContractAlias'] as const)('holds %s on native control/causal inputs', async key => {
    const c = await execute({ [key]: true }, 'leverantörsbyte'); await expect(c.result).rejects.toThrow(); expect(c.calls.expiredFlow).toBe(0)
  })
  it('refuses a canonical-looking message with an unqualified suffix', async () => {
    const c = await execute({ lookalikeError: true }, 'leverantörsbyte'); await expect(c.result).rejects.toThrow('technical_failure_not_poa_denial')
  })
  it.each(['outbox', 'original', 'signature', 'poa-state', 'switch-state', 'expiry-history'] as const)('rejects new or changed %s effects after the apparent denial', async effect => {
    const c = await execute({ effect }, 'leverantörsbyte'); await expect(c.result).rejects.toThrow(); expect(c.calls.expiredFlow).toBe(1)
  })
  it('rejects successful queuing with expired POA', async () => {
    const c = await execute({ expiredQueues: true }, 'leverantörsbyte'); await expect(c.result).rejects.toThrow('expired_poa_queued')
  })
})
