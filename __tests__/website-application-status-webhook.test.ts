import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/v1/website/customer-applications/[applicationId]/route'
import website from '@/docs/openapi/website-integration-v1.json'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  requests: [] as URL[],
  auth: vi.fn(),
  log: vi.fn(),
}))

vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  requireIntegrationApiAccess: io.auth,
  logIntegrationApiRequest: io.log,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const supabaseService = createClient('https://database.example.test', 'synthetic-status-fixture', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: readFixture },
  })
  return { supabaseService }
})

async function readFixture(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(request.method).toBe('GET')
  expect(url.origin).toBe('https://database.example.test')
  io.requests.push(url)
  const table = url.pathname.replace(/^\/rest\/v1\//, '')
  const data = io.rows[table]
  if (!data) throw new Error(`Unexpected fixture table: ${table}`)
  const rows = data.filter(row => {
    for (const [column, expression] of url.searchParams) {
      if (['select', 'order', 'limit'].includes(column)) continue
      const separator = expression.indexOf('.')
      const operator = expression.slice(0, separator)
      const value = expression.slice(separator + 1)
      if (operator === 'eq') {
        if (row[column] !== value) return false
      } else if (operator === 'in') {
        if (!value.slice(1, -1).split(',').includes(String(row[column]))) return false
      } else if (operator === 'cs') {
        const expected = JSON.parse(value) as Row
        const nested = row[column] as Row | undefined
        if (!Object.entries(expected).every(([key, item]) => nested?.[key] === item)) return false
      } else {
        throw new Error(`Unexpected fixture filter: ${operator}`)
      }
    }
    return true
  })
  const order = url.searchParams.get('order')
  if (order) {
    const [column, direction] = order.split('.')
    rows.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (direction === 'desc' ? -1 : 1))
  }
  const limit = Number(url.searchParams.get('limit') ?? rows.length)
  const columns = (url.searchParams.get('select') ?? '').split(',')
  return Response.json(rows.slice(0, limit).map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? null]))))
}

const company = '00000000-0000-4000-8000-0000000000a1'
const applicationNumber = 'APP-SYNTHETIC-001'
const applicationId = '00000000-0000-4000-8000-0000000000b1'
const domainEventId = '00000000-0000-4000-8000-0000000000c1'
const emailLogId = '00000000-0000-4000-8000-0000000000d1'
const parentAt = '2026-11-19T12:00:00+00:00'
const earlyAt = '2026-11-19T11:45:00+00:00'
const deliveryAt = '2026-11-19T12:10:00+00:00'
const emailAt = '2026-11-19T12:20:00+00:00'
const futureRetry = '2026-11-19T12:40:00+00:00'
const schemaPath = '/api/v1/website/customer-applications/{application_number}'
const { validateResponse } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs')

function delivery(id: string, status: string, nextAttempt: string, updatedAt = earlyAt) {
  return { id, company_id: company, domain_event_id: domainEventId, status, attempts: 1, max_attempts: 8,
    next_attempt_at: nextAttempt, created_at: earlyAt, updated_at: updatedAt }
}

function fanout(status: string, availableAt: string) {
  return { company_id: company, domain_event_id: domainEventId, status, attempts: 1, max_attempts: 8,
    destination_type: 'webhook', destination_key: 'webhook_fanout_v1', available_at: availableAt, created_at: earlyAt, updated_at: earlyAt }
}

function getStatus() {
  const request = new NextRequest(`https://ops.example.test/api/v1/website/customer-applications/${applicationNumber}`)
  return GET(request, { params: Promise.resolve({ applicationId: applicationNumber }) })
}

async function readStatus() {
  const response = await getStatus()
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  const body = await response.json()
  expect(validateResponse(website, schemaPath, body, 'get', '200')).toEqual([])
  return body.data
}

beforeEach(() => {
  vi.clearAllMocks()
  io.requests.length = 0
  io.auth.mockResolvedValue({ ok: true, context: { companyId: company }, client: { id: 'synthetic-client' } })
  io.rows = {
    website_customer_applications: [{ id: applicationId, company_id: company, application_number: applicationNumber,
      status: 'processing', updated_at: parentAt }],
    customer_application_workflows: [],
    customer_operation_jobs: [],
    communication_logs: [],
    tenant_email_outbox: [],
    domain_events: [{ id: domainEventId, company_id: company, aggregate_type: 'website_customer_application', aggregate_id: applicationId }],
    webhook_deliveries: [],
    event_outbox: [],
  }
})

describe('mounted application webhook status', () => {
  it('API-146 omits retry times when all deliveries have left the worker queue', async () => {
    io.rows.webhook_deliveries = [delivery('sent', 'sent', earlyAt)]
    io.rows.event_outbox = [fanout('sent', earlyAt)]
    const status = await readStatus()
    expect(status.webhook).toMatchObject({ status: 'sent', sent: 1, queued: 0, next_retry_at: null })
  })

  it('API-146 uses the earliest queued or failed attempt across both workers', async () => {
    io.rows.webhook_deliveries = [
      delivery('sent', 'sent', earlyAt),
      delivery('uncertain', 'delivery_uncertain', earlyAt),
      delivery('processing', 'processing', earlyAt),
      delivery('failed', 'failed', futureRetry),
    ]
    io.rows.event_outbox = [fanout('dead_letter', earlyAt), fanout('queued', emailAt)]
    expect((await readStatus()).webhook.next_retry_at).toBe(emailAt)
    io.rows.event_outbox = [fanout('sent', earlyAt)]
    expect((await readStatus()).webhook.next_retry_at).toBe(futureRetry)
  })

  it('API-146 keeps tenant and event scope and preserves queued attempt times', async () => {
    io.rows.webhook_deliveries = [
      delivery('queued', 'queued', deliveryAt),
      { ...delivery('unrelated', 'queued', earlyAt), domain_event_id: '00000000-0000-4000-8000-0000000000c2' },
    ]
    const status = await readStatus()
    expect(status.webhook).toMatchObject({ queued: 1, next_retry_at: deliveryAt })
    expect(io.auth).toHaveBeenCalledWith(expect.any(NextRequest), ['website_switch_status.read'])
    const requests = io.requests.filter(url => /\/(webhook_deliveries|event_outbox)$/.test(url.pathname))
    expect(requests).toHaveLength(2)
    for (const url of requests) {
      expect(url.searchParams.get('company_id')).toBe(`eq.${company}`)
      expect(url.searchParams.get('domain_event_id')).toBe(`in.(${domainEventId})`)
    }
  })

  it('uses the existing access decision before reading application status', async () => {
    io.auth.mockResolvedValueOnce({ ok: false, status: 403, errorCode: 'api_scope_missing', error: 'Missing synthetic scope' })
    const response = await getStatus()
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('api_scope_missing')
    expect(io.requests).toHaveLength(0)
  })

  it('API-147 includes the latest recorded email update in the returned sample', async () => {
    io.rows.communication_logs = [{ id: emailLogId, company_id: company, event_key: 'contract.confirmation_sent',
      metadata: { application_id: applicationId }, status: 'sent', created_at: earlyAt, sent_at: earlyAt }]
    expect((await readStatus()).updated_at).toBe(parentAt)
    io.rows.tenant_email_outbox = [{ communication_log_id: emailLogId, company_id: company,
      status: 'failed', failed_at: deliveryAt, updated_at: emailAt }]
    const status = await readStatus()
    expect(status.communication.failed).toMatchObject([{ event_type: 'contract.confirmation_sent', occurred_at: emailAt }])
    expect(status.updated_at).toBe(emailAt)
  })

  it('API-147 includes the latest recorded webhook update without treating scheduled work as a change', async () => {
    io.rows.webhook_deliveries = [delivery('queued', 'queued', futureRetry, deliveryAt)]
    const status = await readStatus()
    expect(status.webhook).toMatchObject({ next_retry_at: futureRetry, updated_at: deliveryAt })
    expect(status.updated_at).toBe(deliveryAt)
  })
})
