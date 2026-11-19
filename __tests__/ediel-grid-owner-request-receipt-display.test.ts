import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  guard: vi.fn(), scope: vi.fn(), fetch: vi.fn<typeof fetch>(), failTasks: false,
  request: {} as Record<string, unknown>,
}))

vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: io.guard }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: io.scope }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/components/admin/CustomerName', () => ({ default: () => 'Syntetisk kund' }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw Error('not-found') } }))
vi.mock('@/app/admin/cis/actions', () => ({ updateGridOwnerDataRequestStatusAction: vi.fn(), updateOutboundRequestStatusAction: vi.fn() }))
vi.mock('@/app/admin/ediel/actions', () => ({ prepareUtiltsE66Action: vi.fn(), prepareUtiltsE73Action: vi.fn(), sendEdielMessageAction: vi.fn() }))
vi.mock('@/lib/masterdata/db', () => ({ listGridOwners: async () => [], listMeteringPointsBySiteIds: async () => [] }))
vi.mock('@/lib/cis/db', () => ({ listOutboundDispatchEventsByRequestIds: async () => [], listOutboundRequestsByCustomerId: async () => [] }))
vi.mock('@/lib/supabase/server', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient('https://ediel-receipt-fixture.example.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: io.fetch },
  })
  client.auth.getUser = async () => ({
    data: { user: { id: 'operator', aud: 'authenticated', email: 'operator@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '' } },
    error: null,
  })
  return { createSupabaseServerClient: async () => client }
})

import Page from '@/app/admin/operations/grid-owner-requests/[id]/page'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const requestId = uid(1), companyId = uid(2), customerId = uid(3), mailId = uid(4), parseResultId = uid(5)
const taskType = 'ediel_utilts_meter_value_review'
const receipt = { inboundFamily: 'UTILTS', inboundCode: 'E66', inboundEmailMessageId: mailId, parseResultId }
const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ id: requestId }) }))
let db: PGlite

async function fetchPort(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  expect(init?.method).toBe('GET')
  const params = url.searchParams
  if (url.pathname.endsWith('/grid_owner_data_requests')) {
    expect(params.get('id')).toBe(`eq.${requestId}`)
    return Response.json([io.request])
  }
  if (!url.pathname.endsWith('/customer_operation_tasks')) return Response.json([])

  expect(params.get('select')).toBe('id')
  expect(params.get('company_id')).toBe(`eq.${companyId}`)
  expect(params.get('customer_id')).toBe(`eq.${customerId}`)
  expect(params.get('task_type')).toBe(`eq.${taskType}`)
  expect(params.get('status')).toBe('in.(open,in_progress,blocked)')
  expect(params.get('limit')).toBe('1')
  const metadata = params.get('metadata')!
  expect(metadata.startsWith('cs.')).toBe(true)
  const expected = { inboundEmailMessageId: mailId, parseResultId, outbound: { source_type: 'grid_owner_data_request', source_id: requestId } }
  expect(JSON.parse(metadata.slice(3))).toEqual(expected)
  if (io.failTasks) return Response.json({ code: '42501', message: 'synthetic-private-query-error' }, { status: 403 })
  const { rows } = await db.query<{ id: string }>(`select id from public.customer_operation_tasks
    where company_id=$1 and customer_id=$2 and task_type=$3 and status=any($4::text[]) and metadata @> $5::jsonb limit $6`,
  [params.get('company_id')!.slice(3), params.get('customer_id')!.slice(3), params.get('task_type')!.slice(3),
    params.get('status')!.slice(4, -1).split(','), metadata.slice(3), Number(params.get('limit'))])
  return Response.json(rows)
}

function taskReads() {
  return io.fetch.mock.calls.filter(([url]) => String(url).includes('/customer_operation_tasks'))
}

async function insertReview({ company = companyId, customer = customerId, request = requestId, mail = mailId, parse = parseResultId, status = 'open' } = {}) {
  await db.query(`insert into public.customer_operation_tasks(company_id,customer_id,task_type,status,title,description,metadata)
    values($1,$2,$3,$4,'UTILTS kunde inte importeras till mätvärden','synthetic-private-import-error',$5::jsonb)`,
  [company, customer, taskType, status, JSON.stringify({ ...receipt, inboundEmailMessageId: mail, parseResultId: parse, outbound: { source_type: 'grid_owner_data_request', source_id: request } })])
}

beforeAll(async () => {
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
  const ddl = schema.match(/^CREATE TABLE public\.customer_operation_tasks \([\s\S]+?^\);/m)?.[0]
  if (!ddl) throw new Error('missing_customer_operation_task_fixture_ddl')
  db = new PGlite()
  await db.exec(ddl)
})
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  vi.stubGlobal('React', React)
  io.guard.mockReset().mockResolvedValue({ permissions: ['metering.read'] })
  io.scope.mockReset().mockResolvedValue({ isPlatformAdmin: false, companyId })
  io.fetch.mockReset().mockImplementation(fetchPort)
  io.failTasks = false
  io.request = { id: requestId, company_id: companyId, customer_id: customerId, request_scope: 'meter_values',
    status: 'received', received_at: '2026-11-18T08:00:00Z', created_at: '2026-11-17T08:00:00Z', request_payload: {}, response_payload: receipt }
  await db.exec('truncate public.customer_operation_tasks')
})
afterEach(() => vi.unstubAllGlobals())

it.each(['open', 'in_progress', 'blocked'])('shows the receipt and the %s import review as separate facts for the exact same E66', async status => {
  await insertReview({ status })
  const html = await render()
  expect(html).toContain('Svar mottaget från nätägare')
  expect(html).toContain('Ett öppet importärende behöver granskas')
  expect(html).not.toMatch(/Underlag mottaget från nätägare|synthetic-private-import-error|Spara status/)
  expect(taskReads()).toHaveLength(1)
})

it('treats closed, other-receipt and other-scope errors as absence of verified import', async () => {
  for (const review of [{ company: uid(10) }, { customer: uid(11) }, { request: uid(12) }, { mail: uid(13) }, { parse: uid(14) }, { status: 'completed' }]) await insertReview(review)
  const html = await render()
  expect(html).toContain('Svar mottaget från nätägare')
  expect(html).toContain('Det finns ingen verifierad importstatus för svaret')
  expect(html).not.toContain('Ett öppet importärende')
  expect(taskReads()).toHaveLength(1)
})

it('shows an unavailable evidence read while keeping the known receipt visible', async () => {
  io.failTasks = true
  const html = await render()
  expect(html).toContain('Svar mottaget från nätägare')
  expect(html).toContain('Importstatusen kunde inte läsas')
  expect(html).not.toMatch(/synthetic-private-query-error|ingen verifierad importstatus/)
})

it('keeps a legacy received record unverified when no receipt identity is available', async () => {
  io.request.response_payload = {}
  const html = await render()
  expect(html).toContain('Svar mottaget från nätägare')
  expect(html).toContain('Det finns ingen verifierad importstatus för svaret')
  expect(taskReads()).toHaveLength(0)
})

it('preserves a genuine negative request outcome', async () => {
  io.request.status = 'failed'
  const html = await render()
  expect(html).toContain('Begäran misslyckades')
  expect(html).not.toMatch(/Svar mottaget från nätägare|importstatus för svaret/)
  expect(taskReads()).toHaveLength(0)
})

it('checks the page role and selected company before a task read', async () => {
  io.guard.mockRejectedValueOnce(new Error('no-page-access'))
  await expect(render()).rejects.toThrow('no-page-access')
  expect(io.fetch).not.toHaveBeenCalled()
  io.scope.mockResolvedValueOnce({ isPlatformAdmin: false, companyId: uid(10) })
  await expect(render()).rejects.toThrow('not-found')
  expect(taskReads()).toHaveLength(0)
})
