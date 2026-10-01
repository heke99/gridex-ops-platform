import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Actual loader exports and an actual page/SSR consumer. This controlled query
// adapter exercises query results only: no Auth, SQL, HTTP or provider calls.
type Row = Record<string, unknown>
type Query = { table: string; select: string; predicates: Array<[string, unknown]>; order: [string, { ascending: boolean }] | null; limit: number | null }
const f = vi.hoisted(() => ({
  company: '00000000-0000-4000-8000-000000001201', foreign: '00000000-0000-4000-8000-000000001202',
  actor: '00000000-0000-4000-8000-000000001203', subscription: '00000000-0000-4000-8000-000000001204',
  delivery: '00000000-0000-4000-8000-000000001205',
  fullAvailable: false, firstError: null as Row | null, baseError: null as Row | null,
  queries: [] as Query[], rows: {} as Record<string, Row[]>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
  const state: Query = { table, select: '', predicates: [], order: null, limit: null }
  const query = {
    select: (projection: string) => { state.select = projection; return query },
    eq: (column: string, value: unknown) => { state.predicates.push([column, value]); return query },
    order: (column: string, options: { ascending: boolean }) => { state.order = [column, options]; return query },
    limit: (limit: number) => { state.limit = limit; return query },
    then: (resolve: (result: unknown) => unknown) => {
      f.queries.push(structuredClone(state))
      const expanded = state.select.includes('api_client_id')
      const error = expanded
        ? f.firstError ?? (!f.fullAvailable ? { code: '42703', message: 'column webhook_subscriptions.api_client_id does not exist' } : null)
        : f.baseError
      let rows = (f.rows[table] ?? []).filter(row => state.predicates.every(([column, value]) => row[column] === value))
      if (state.order) {
        const [column, { ascending }] = state.order
        rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1))
      }
      if (state.limit !== null) rows = rows.slice(0, state.limit)
      if (!expanded) rows = rows.map(row => {
        const base = structuredClone(row)
        for (const key of ['api_client_id', 'last_success_at', 'last_failure_at', 'integration_api_clients']) delete base[key]
        const subscription = base.webhook_subscriptions as Row | undefined
        if (subscription) delete subscription.api_client_id
        return base
      })
      return Promise.resolve({ data: error ? null : structuredClone(rows), error }).then(resolve)
    },
  }
  return query
} } }))
const actor = () => ({ userId: f.actor, email: null, permissions: ['integrations.read'], roles: ['synthetic'], isAdmin: true, isPlatformAdmin: false, companyId: f.company })
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageAccess: async () => actor(),
  requireCompanyScopedActionAccess: async () => { throw new Error('Forbidden') },
  isPlatformAdminContext: () => false,
}))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => ({ isPlatformAdmin: false, companyId: f.company }) }))
vi.mock('@/app/admin/webhooks/actions', () => ({
  sendWebhookTestEventAction: vi.fn(), resendWebhookDeliveryAction: vi.fn(), markWebhookDeliveryIgnoredAction: vi.fn(),
}))

import { listWebhookSubscriptions, listWebhookDeliveries } from '@/lib/admin/websiteIntegrationOps'
import Page from '@/app/admin/webhooks/deliveries/page'

beforeEach(() => {
  f.fullAvailable = false; f.firstError = null; f.baseError = null; f.queries = []
  const subscription = { id: f.subscription, company_id: f.company, name: 'Synthetic subscription',
    endpoint_url: 'https://example.invalid/never-contacted', event_types: ['webhook.test'], status: 'paused',
    signing_secret_ref: null, failure_count: 0, created_at: '2026-10-01T01:00:00Z', updated_at: '2026-10-01T01:00:00Z',
    api_client_id: f.actor, last_success_at: '2026-09-30T01:00:00Z', last_failure_at: null,
    companies: { name: 'Synthetic company' }, integration_api_clients: { name: 'Synthetic API client', key_prefix: 'synthetic' } }
  const delivery = { id: f.delivery, company_id: f.company, webhook_subscription_id: f.subscription,
    domain_event_id: f.actor, event_type: 'webhook.test', status: 'failed', attempts: 1, max_attempts: 5,
    created_at: '2026-10-01T01:00:00Z', payload: {}, webhook_subscriptions: { name: subscription.name,
      endpoint_url: subscription.endpoint_url, api_client_id: f.actor } }
  f.rows = { webhook_subscriptions: [subscription, { ...subscription, id: f.foreign, company_id: f.foreign }],
    webhook_deliveries: [delivery, { ...delivery, id: f.foreign, company_id: f.foreign },
      { ...delivery, id: f.actor, status: 'sent', created_at: '2026-10-01T02:00:00Z' }] }
})
const loaders = [
  { name: 'subscription', table: 'webhook_subscriptions', load: () => listWebhookSubscriptions({ companyId: f.company, limit: 7 }) },
  { name: 'delivery', table: 'webhook_deliveries', load: () => listWebhookDeliveries({ companyId: f.company, status: 'failed', limit: 7 }) },
]
describe.each(loaders)('actual $name loader known optional projection compatibility', ({ table, load }) => {
  it('returns the actual scoped base rows after an absent optional subscription column instead of false empty', async () => {
    const rows = await load()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ company_id: f.company })
    expect(f.queries).toHaveLength(2)
    expect(f.queries.every(query => query.table === table && query.predicates.some(([key, value]) => key === 'company_id' && value === f.company))).toBe(true)
    expect(f.queries.every(query => query.order?.[0] === 'created_at' && query.order[1].ascending === false && query.limit === 7)).toBe(true)
    if (table === 'webhook_deliveries') expect(f.queries.every(query => query.predicates.some(([key, value]) => key === 'status' && value === 'failed'))).toBe(true)
    expect(f.queries[1].select).not.toContain('api_client_id')
  })
  it('preserves a confirmed empty query result without inventing a row', async () => {
    f.fullAvailable = true; f.rows[table] = []
    expect(await load()).toEqual([])
    expect(f.queries).toHaveLength(1)
  })
  it.each([
    { code: '42P01', message: 'relation webhook_subscriptions does not exist' },
    { code: '42501', message: 'permission denied for table webhook_subscriptions' },
    { code: '42703', message: 'column webhook_subscriptions.name does not exist' },
    { code: '42703', message: 'column companies.api_client_id does not exist' },
    { code: 'PGRST204', message: "Could not find the 'name' column of 'webhook_subscriptions' in the schema cache" },
    { code: 'PGRST200', message: "Could not find a relationship between 'webhook_subscriptions' and 'companies' in the schema cache" },
    { code: '57P03', message: 'database unavailable' },
  ])('propagates an unrelated schema/permission/unavailable result $code without retry or false empty', async error => {
    f.firstError = error
    await expect(load()).rejects.toBe(error)
    expect(f.queries).toHaveLength(1)
  })
  it('propagates a base-projection failure after exactly one known-shape retry', async () => {
    const error = { code: '42P01', message: 'relation disappeared before the confirmed base query' }
    f.baseError = error
    await expect(load()).rejects.toBe(error)
    expect(f.queries).toHaveLength(2)
  })
})
it.each([
  { code: '42703', message: 'column webhook_subscriptions.last_success_at does not exist' },
  { code: '42703', message: 'column webhook_subscriptions.last_failure_at does not exist' },
  { code: 'PGRST204', message: "Could not find the 'api_client_id' column of 'webhook_subscriptions' in the schema cache" },
  { code: 'PGRST200', message: "Could not find a relationship between 'webhook_subscriptions' and 'integration_api_clients' in the schema cache" },
])('subscription retries only its exact optional metadata shape $code', async error => {
  f.firstError = error
  const rows = await listWebhookSubscriptions({ companyId: f.company })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ id: f.subscription, api_client_id: null, last_success_at: null, last_failure_at: null,
    integration_api_clients: null, api_client_binding_available: false })
  expect(f.queries).toHaveLength(2)
})
it('preserves the future expanded subscription metadata exactly when the full projection is available', async () => {
  f.fullAvailable = true
  const rows = await listWebhookSubscriptions({ companyId: f.company })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ id: f.subscription, api_client_id: f.actor, last_success_at: '2026-09-30T01:00:00Z',
    integration_api_clients: { name: 'Synthetic API client', key_prefix: 'synthetic' } })
  expect(f.queries).toHaveLength(1)
})
it('preserves delivery base metadata and nested destination without fabricating an unavailable API binding', async () => {
  const rows = await listWebhookDeliveries({ companyId: f.company, status: 'failed' })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ id: f.delivery, status: 'failed', attempts: 1, max_attempts: 5,
    webhook_subscriptions: { name: 'Synthetic subscription', endpoint_url: 'https://example.invalid/never-contacted' } })
  expect(rows[0].webhook_subscriptions).not.toHaveProperty('api_client_id')
})
it('keeps the query order, existing upper/lower limit clamp and existing absent company-filter behavior', async () => {
  f.fullAvailable = true
  await listWebhookSubscriptions({ limit: 999 }); await listWebhookDeliveries({ companyId: f.company, limit: -1 })
  expect(f.queries[0]).toMatchObject({ limit: 200, predicates: [], order: ['created_at', { ascending: false }] })
  expect(f.queries[1]).toMatchObject({ limit: 1, predicates: [['company_id', f.company]], order: ['created_at', { ascending: false }] })
})
it('actual page/SSR renders unavailable binding as unconfirmed while retaining real scoped rows and disabled controls', async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ status: 'failed' }) }))
  expect(html).toContain('Synthetic subscription'); expect(html).toContain('API-koppling ej bekräftad')
  expect(html).not.toContain('API-client saknas'); expect(html).not.toContain(f.foreign)
  expect([...html.matchAll(/<button\b([^>]*)>/g)].every(match => /\bdisabled/.test(match[1]))).toBe(true)
  expect(f.queries).toHaveLength(4)
})
it('actual page/SSR keeps a known expanded API-client name and a confirmed absent-client label', async () => {
  f.fullAvailable = true
  expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))).toContain('Synthetic API client')
  f.rows.webhook_subscriptions[0].api_client_id = null; f.rows.webhook_subscriptions[0].integration_api_clients = null
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('API-client saknas'); expect(html).not.toContain('API-koppling ej bekräftad')
})
