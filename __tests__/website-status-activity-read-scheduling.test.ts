import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/v1/website/customer-applications/[applicationId]/route'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  access: vi.fn(),
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { code: string; message: string }>,
  holds: new Map<string, Promise<void>>(),
  reads: [] as Array<{ table: string; query: URLSearchParams }>,
}))
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const companyId = uuid(11), applicationId = uuid(12), logId = uuid(13), eventId = uuid(14)
const otherCompany = uuid(19), number = 'APP-SYNTHETIC-139'
const at = '2026-10-14T12:00:00Z', nextRetry = '2026-10-14T13:00:00Z'
const activityTables = ['tenant_email_outbox', 'webhook_deliveries', 'event_outbox'] as const

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(), requireIntegrationApiAccess: io.access,
  logIntegrationApiRequest: vi.fn(), currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://synthetic.example.test', 'fixture-only', {
    auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: readFixture },
  }) }
})

async function readFixture(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(url.origin).toBe('https://synthetic.example.test')
  expect(request.method).toBe('GET')
  const table = url.pathname.split('/').at(-1)!
  const query = url.searchParams
  expect(io.access).toHaveBeenCalled()
  expect(query.get('company_id')).toBe(`eq.${companyId}`)
  io.reads.push({ table, query })
  await io.holds.get(table)
  const failure = io.failures[table]
  if (failure) return Response.json(failure, { status: 400 })
  const rows = io.tables[table]
  if (!rows) throw new Error(`Unexpected table ${table}`)
  return Response.json(rows.filter(row => {
    for (const [field, condition] of query) {
      if (['select', 'order', 'limit'].includes(field)) continue
      if (condition.startsWith('eq.') && String(row[field]) === condition.slice(3)) continue
      if (condition.startsWith('in.(') && condition.slice(4, -1).split(',').includes(String(row[field]))) continue
      if (condition.startsWith('cs.') && Object.entries(JSON.parse(condition.slice(3))).every(([name, value]) => (row[field] as Row | undefined)?.[name] === value)) continue
      return false
    }
    return true
  }))
}

function runStatus() {
  return GET(new NextRequest(`https://ops.example.test/api/v1/website/customer-applications/${number}`),
    { params: Promise.resolve({ applicationId: number }) })
}

function hold(table: string) {
  let release!: () => void
  io.holds.set(table, new Promise<void>(resolve => { release = resolve }))
  return release
}

function assertScopedActivityReads() {
  const outbox = io.reads.filter(row => row.table === 'tenant_email_outbox')
  const webhook = io.reads.filter(row => row.table === 'webhook_deliveries')
  const fanout = io.reads.filter(row => row.table === 'event_outbox')
  expect(outbox).toHaveLength(1)
  expect(outbox[0].query.get('communication_log_id')).toBe(`in.(${logId})`)
  expect(webhook).toHaveLength(1)
  expect(webhook[0].query.get('domain_event_id')).toBe(`in.(${eventId})`)
  expect(webhook[0].query.get('limit')).toBe('100')
  expect(fanout).toHaveLength(1)
  expect(fanout[0].query.get('domain_event_id')).toBe(`in.(${eventId})`)
  expect(fanout[0].query.get('destination_type')).toBe('eq.webhook')
  expect(fanout[0].query.get('destination_key')).toBe('eq.webhook_fanout_v1')
  expect(fanout[0].query.get('limit')).toBe('100')
}

beforeEach(() => {
  io.reads = []
  io.holds.clear()
  io.failures = {}
  io.access.mockReset().mockResolvedValue({ ok: true, client: { id: uuid(18) }, context: { companyId } })
  io.tables = {
    website_customer_applications: [{ id: applicationId, company_id: companyId, application_number: number, status: 'accepted', updated_at: at }],
    customer_application_workflows: [], customer_operation_jobs: [],
    communication_logs: [{ id: logId, company_id: companyId, status: 'queued', event_key: 'contract.created', created_at: at, metadata: { application_id: applicationId } }],
    domain_events: [{ id: eventId, company_id: companyId, aggregate_type: 'website_customer_application', aggregate_id: applicationId }],
    tenant_email_outbox: [
      { company_id: companyId, communication_log_id: logId, status: 'sent', sent_at: at },
      { company_id: otherCompany, communication_log_id: logId, status: 'failed' },
    ],
    webhook_deliveries: [
      { company_id: companyId, domain_event_id: eventId, status: 'queued', attempts: 1, next_attempt_at: nextRetry, updated_at: at },
      { company_id: otherCompany, domain_event_id: eventId, status: 'failed', attempts: 5 },
    ],
    event_outbox: [
      { company_id: companyId, domain_event_id: eventId, destination_type: 'webhook', destination_key: 'webhook_fanout_v1', status: 'sent', attempts: 1, updated_at: at },
      { company_id: companyId, domain_event_id: eventId, destination_type: 'webhook', destination_key: 'other', status: 'failed', attempts: 5 },
    ],
  }
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

it('starts both webhook reads while the independent email read remains blocked', async () => {
  const releaseEmail = hold('tenant_email_outbox')
  const pending = runStatus()
  let response: Response
  try {
    await vi.waitFor(assertScopedActivityReads, { timeout: 700 })
  } finally {
    releaseEmail()
    response = await pending
  }
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toMatchObject({ data: {
    application_number: number, updated_at: at,
    communication: { pending: false, sent: [expect.objectContaining({ status: 'sent' })], failed: [] },
    webhook: { status: 'pending', queued: 1, failed: 0, attempts: 2, next_retry_at: nextRetry },
  } })
})

it('keeps the earlier email error when the other independent reads fail too', async () => {
  io.failures.tenant_email_outbox = { code: '42P01', message: 'Synthetic missing email queue' }
  io.failures.webhook_deliveries = { code: '58000', message: 'Synthetic webhook failure' }
  io.failures.event_outbox = { code: '58000', message: 'Synthetic fan-out failure' }
  const response = await runStatus()
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ error: { code: 'application_status_schema_not_ready', message: expect.stringContaining('e-postkö') } })
  assertScopedActivityReads()
})

it('skips activity queries without scoped parent IDs', async () => {
  io.tables.communication_logs = []
  io.tables.domain_events = []
  const response = await runStatus()
  expect(response.status).toBe(200)
  expect(io.reads.some(row => activityTables.some(table => table === row.table))).toBe(false)
})

it('preserves the authorization gate before status reads', async () => {
  io.access.mockResolvedValue({ ok: false, status: 401, errorCode: 'invalid_api_token', error: 'Unauthorized synthetic request' })
  expect((await runStatus()).status).toBe(401)
  expect(io.reads).toEqual([])
})
