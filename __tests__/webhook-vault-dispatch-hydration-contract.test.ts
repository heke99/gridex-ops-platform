// Actual helper/route/resolver with synthetic VM-local env and finite SDK ports.
// Adapted from T3's immutable check-actual-bridge-overlap.private.mjs (d1917120).
// No Vault, network, actual process.env or full delivery loop is exercised.
import * as crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

type Hydrate = typeof import('@/lib/integrations/webhookVaultSecrets').hydrateVaultWebhookSecretsForDispatch
type Env = Record<string, string | undefined>
type Row = { id: string; company_id: string; signing_secret_ref: unknown }
type Result = { data: unknown; error: unknown }
type RPC = { company: string; subscription: string }
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const COMPANY = '10000000-0000-4000-8000-000000000001'
const ROWS: Row[] = [1, 2].map(i => ({ id: `20000000-0000-4000-8000-00000000000${i}`,
  company_id: COMPANY, signing_secret_ref: `30000000-0000-4000-8000-00000000000${i}` }))
const SECRET = 'SYNTHETIC-private-VM-only-signing-value'
const KEY = `WEBHOOK_SIGNING_SECRET_${ROWS[0].signing_secret_ref}`
const CRON = 'SYNTHETIC-private-VM-only-cron-value'
let deniedCalls = 0
const deny = () => { deniedCalls++; throw new Error('Undeclared service, network or timer port') }
beforeEach(() => { deniedCalls = 0 })
afterEach(() => { expect(deniedCalls).toBe(0) })

function load<T>(relative: string, ports: Record<string, unknown>, env: Env, append = ''): T {
  const source = readFileSync(new URL(relative, new URL('../', import.meta.url)), 'utf8')
  const code = ts.transpileModule(source + append, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText
  const exports = {}
  runInNewContext(code, { exports, Buffer, URL, Headers, Response, AbortController, TextDecoder,
    require(name: string) { if (!Object.hasOwn(ports, name)) return deny(); return ports[name] },
    process: { env }, console: { log() {}, warn() {}, error() {} },
    fetch: deny, setTimeout: deny, clearTimeout: deny,
  }, { filename: ROOT + relative, timeout: 5000 })
  return exports as T
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

function world(options: { env?: Env; rows?: (read: number) => Row[]; queryError?: unknown;
  rpc?: (call: RPC, index: number) => Result | Promise<Result> } = {}) {
  const env: Env = { CRON_SECRET: CRON, ...options.env }, calls: RPC[] = []
  let reads = 0, dispatches = 0, fanouts = 0, resolved: string | null = null
  const service = {
    from(table: string) {
      expect(table).toBe('webhook_subscriptions')
      return {
        select(columns: string) { expect(columns).toBe('id,company_id,signing_secret_ref'); return this },
        eq(column: string, value: unknown) { expect([column, value]).toEqual(['status', 'active']); return this },
        not(column: string, operator: string, value: unknown) {
          expect([column, operator, value]).toEqual(['signing_secret_ref', 'is', null])
          return Promise.resolve({ data: options.rows?.(reads++) ?? [ROWS[0]], error: options.queryError ?? null })
        },
      }
    },
    rpc(name: string, args: { p_company_id: string; p_subscription_id: string }) {
      expect(name).toBe('gridex_read_webhook_signing_secret_v1')
      expect(Object.keys(args).sort()).toEqual(['p_company_id', 'p_subscription_id'])
      const row = ROWS.find(item => item.id === args.p_subscription_id)
      expect(row).toBeDefined(); expect(args.p_company_id).toBe(row?.company_id)
      const call = { company: args.p_company_id, subscription: args.p_subscription_id }
      calls.push(call)
      return options.rpc?.(call, calls.length - 1) ?? Promise.resolve({ data: SECRET, error: null })
    },
  }
  const bridge = load<{ hydrateVaultWebhookSecretsForDispatch: Hydrate }>('lib/integrations/webhookVaultSecrets.ts',
    { '@/lib/supabase/service': { supabaseService: service } }, env)
  const refs = load('lib/integrations/publicReferences.ts', { 'node:crypto': crypto }, env)
  const safety = load('lib/api/publicPayloadSafety.ts', {}, env)
  const policy = load('lib/integrations/webhookCredentialPolicy.ts',
    { '@/lib/supabase/service': { supabaseService: { from: deny, rpc: deny } } }, env)
  const resolver = load<{ controlledSigningResolver: (row: Row) => string | null }>('lib/integrations/webhooks.ts', {
    'node:crypto': crypto, '@/lib/supabase/service': { supabaseService: { from: deny, rpc: deny } },
    '@/lib/tenant/operationPolicy': { getTenantOperationDecision: deny },
    '@/lib/integrations/tenantContext': { loadExternalTenantReference: deny },
    '@/lib/integrations/websiteIntegrationContract': { WEBSITE_INTEGRATION_CONTRACT_VERSION: 'finite-unused' },
    '@/lib/api/publicPayloadSafety': safety, '@/lib/integrations/publicWebhookTransport': { postPublicWebhook: deny },
    '@/lib/partner-api/openApi': { PARTNER_API_VERSION: 'finite-unused' },
    '@/lib/integrations/publicReferences': refs, '@/lib/integrations/webhookCredentialPolicy': policy,
    '@/lib/integrations/apiResponseProfile': { projectWebsiteWebhookResponse: deny, websiteWebhookResponseRevision: deny },
  }, env, '\nexports.controlledSigningResolver = signingSecret;')
  type Request = { headers: Headers; nextUrl: URL }
  const route = load<{ POST: (request: Request) => Promise<Response> }>('app/api/internal/webhooks/dispatch/route.ts', {
    'node:crypto': crypto, 'next/server': {},
    '@/lib/customer-portal/externalApi': { customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
    '@/lib/events/domainEvents': { processDomainEventWebhookFanout: async () => { fanouts++; return { processed: 0 } } },
    '@/lib/integrations/webhookVaultSecrets': bridge,
    '@/lib/integrations/webhooks': { dispatchDueWebhookDeliveries: async () => {
      dispatches++; resolved = resolver.controlledSigningResolver(ROWS[0]); return { finiteResolverFound: resolved !== null }
    } },
  }, env)
  return { env, calls, hydrate: bridge.hydrateVaultWebhookSecretsForDispatch,
    resolve: () => resolver.controlledSigningResolver(ROWS[0]),
    post: (authorized = true) => route.POST({ headers: new Headers({ authorization: `Bearer ${authorized ? CRON : 'wrong'}` }),
      nextUrl: new URL('https://finite.invalid/api/internal/webhooks/dispatch?limit=1') }),
    get dispatches() { return dispatches }, get fanouts() { return fanouts }, get resolved() { return resolved } }
}

describe('temporary Vault signing-secret dispatch lifetimes', () => {
  it('normal UUID bridge uses exact scoped RPC and actual route finally restores absence', async () => {
    const c = world(); expect(Object.hasOwn(c.env, KEY)).toBe(false)
    const response = await c.post()
    expect(response.status).toBe(200); expect(c.resolved).toBe(SECRET)
    expect(c.calls).toEqual([{ company: COMPANY, subscription: ROWS[0].id }])
    expect(c.dispatches).toBe(1); expect(Object.hasOwn(c.env, KEY)).toBe(false)
  })
  it('unauthorized actual caller performs no fanout, RPC or dispatch', async () => {
    const c = world(); expect((await c.post(false)).status).toBe(401)
    expect([c.fanouts, c.calls.length, c.dispatches]).toEqual([0, 0, 0])
  })
  it.each([null, '', 42])('missing or invalid RPC data %s never creates a credential', async data => {
    const c = world({ rpc: () => ({ data, error: null }) })
    expect((await c.post()).status).toBe(200) // Existing route response; finite delivery port, no business success claim.
    expect(c.resolved).toBe(null); expect(Object.hasOwn(c.env, KEY)).toBe(false)
  })
  it.each(['query', 'firstRPC', 'laterRPC'])('%s failure preserves original error and removes only owned entries', async fault => {
    const error = { message: 'SYNTHETIC scoped read failure' }
    const c = world({ rows: () => ROWS, queryError: fault === 'query' ? error : null,
      rpc: (_call, index) => ({ data: SECRET, error: fault === 'firstRPC' || index === 1 ? error : null }) })
    await expect(c.hydrate()).rejects.toBe(error)
    for (const row of ROWS) expect(Object.hasOwn(c.env, `WEBHOOK_SIGNING_SECRET_${row.signing_secret_ref}`)).toBe(false)
  })
  it('actual caller returns its existing error response without dispatch or partial residue', async () => {
    const c = world({ rows: () => ROWS, rpc: (_call, index) => ({ data: SECRET, error: index ? { message: 'finite denied' } : null }) })
    expect((await c.post()).status).toBe(500); expect(c.dispatches).toBe(0)
    expect(Object.hasOwn(c.env, KEY)).toBe(false)
  })
  it.each([0, 1])('staggered borrower survives cleanup of invocation %s, then restores absence', async first => {
    const c = world(), cleanups = [await c.hydrate(), await c.hydrate()]
    expect(c.calls).toHaveLength(1); cleanups[first](); cleanups[first]()
    expect(c.resolve()).toBe(SECRET); cleanups[1 - first]()
    expect(Object.hasOwn(c.env, KEY)).toBe(false)
  })
  it.each([[0, 0], [0, 1], [1, 0], [1, 1]])('simultaneous RPC completion %s and cleanup %s leave no stale value', async (published, first) => {
    const entered = deferred<void>(), responses = [deferred<Result>(), deferred<Result>()]
    const c = world({ rpc: (_call, index) => { if (index === 1) entered.resolve(); return responses[index].promise } })
    const pending = [c.hydrate(), c.hydrate()]; await entered.promise
    responses[published].resolve({ data: SECRET, error: null }); const firstCleanup = await pending[published]
    responses[1 - published].resolve({ data: 'SYNTHETIC-later-result-must-not-overwrite', error: null })
    const laterCleanup = await pending[1 - published]
    const cleanups = published === 0 ? [firstCleanup, laterCleanup] : [laterCleanup, firstCleanup]
    expect(c.resolve()).toBe(SECRET)
    cleanups[first](); expect(c.resolve()).toBe(SECRET); cleanups[1 - first]()
    expect(Object.hasOwn(c.env, KEY)).toBe(false)
  })
  it('a missing-data RPC completion still borrows a lease published while it awaited', async () => {
    const entered = deferred<void>(), responses = [deferred<Result>(), deferred<Result>()]
    const c = world({ rpc: (_call, index) => { if (index === 1) entered.resolve(); return responses[index].promise } })
    const a = c.hydrate(), b = c.hydrate(); await entered.promise
    responses[0].resolve({ data: SECRET, error: null }); const cleanA = await a
    responses[1].resolve({ data: null, error: null }); const cleanB = await b
    cleanA(); expect(c.resolve()).toBe(SECRET); cleanB(); expect(Object.hasOwn(c.env, KEY)).toBe(false)
  })
  it('a pending invocation can create a fresh lease after the earlier owner already finished', async () => {
    const entered = deferred<void>(), responses = [deferred<Result>(), deferred<Result>()]
    const c = world({ rpc: (_call, index) => { if (index === 1) entered.resolve(); return responses[index].promise } })
    const a = c.hydrate(), b = c.hydrate(); await entered.promise
    responses[0].resolve({ data: SECRET, error: null }); const cleanA = await a; cleanA()
    responses[1].resolve({ data: SECRET, error: null }); const cleanB = await b
    expect(c.resolve()).toBe(SECRET); cleanB(); expect(Object.hasOwn(c.env, KEY)).toBe(false)
  })
  it('partial failure releases a borrowed token while another owner remains live', async () => {
    const error = { message: 'finite later RPC failure' }
    const c = world({ rows: read => read ? ROWS : [ROWS[0]],
      rpc: call => ({ data: SECRET, error: call.subscription === ROWS[1].id ? error : null }) })
    const cleanA = await c.hydrate(); await expect(c.hydrate()).rejects.toBe(error)
    expect(c.resolve()).toBe(SECRET); cleanA(); expect(Object.hasOwn(c.env, KEY)).toBe(false)
  })
  it('genuine preexisting external mappings are never fetched, borrowed or removed', async () => {
    const c = world({ env: { [KEY]: 'SYNTHETIC-explicit-external-mapping' } })
    const a = await c.hydrate(), b = await c.hydrate(); expect(c.calls).toHaveLength(0)
    a(); b(); a(); expect(c.env[KEY]).toBe('SYNTHETIC-explicit-external-mapping')
  })
  it('an originally empty mapping is restored only after the final borrower', async () => {
    const c = world({ env: { [KEY]: '' } }), a = await c.hydrate(), b = await c.hydrate()
    a(); expect(c.resolve()).toBe(SECRET); b(); expect(c.env[KEY]).toBe(''); expect(Object.hasOwn(c.env, KEY)).toBe(true)
  })
  it('cleanup preserves a subsequent external value', async () => {
    const c = world(), cleanup = await c.hydrate(); c.env[KEY] = 'SYNTHETIC-external-replacement'
    cleanup(); cleanup(); expect(c.env[KEY]).toBe('SYNTHETIC-external-replacement')
  })
  it('a stale cleanup cannot delete a newer same-valued owned entry', async () => {
    const c = world(), oldCleanup = await c.hydrate(); delete c.env[KEY]
    const newCleanup = await c.hydrate(); oldCleanup()
    expect(c.resolve()).toBe(SECRET); newCleanup(); expect(Object.hasOwn(c.env, KEY)).toBe(false)
  })
  it('duplicate input refs do not extend ownership after idempotent cleanup', async () => {
    const c = world({ rows: () => [ROWS[0], ROWS[0]] }), a = await c.hydrate(), b = await c.hydrate()
    expect(c.calls).toHaveLength(1); a(); a(); expect(c.resolve()).toBe(SECRET)
    b(); b(); expect(Object.hasOwn(c.env, KEY)).toBe(false)
  })
  it('an external mapping published during RPC is preserved without an owned lease', async () => {
    const response = deferred<Result>(), entered = deferred<void>()
    const c = world({ rpc: () => { entered.resolve(); return response.promise } })
    const pending = c.hydrate(); await entered.promise; c.env[KEY] = 'SYNTHETIC-published-external'
    response.resolve({ data: SECRET, error: null }); const cleanup = await pending
    expect(c.env[KEY]).toBe('SYNTHETIC-published-external'); cleanup(); expect(c.env[KEY]).toBe('SYNTHETIC-published-external')
  })
  it('blank and non-string refs retain existing skip behavior', async () => {
    const c = world({ rows: () => ['', '  ', null, 7].map(signing_secret_ref => ({ ...ROWS[0], signing_secret_ref })) })
    const cleanup = await c.hydrate(); cleanup(); expect(c.calls).toHaveLength(0); expect(Object.hasOwn(c.env, KEY)).toBe(false)
  })
})
