import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(), requirePlatform: vi.fn(), companyScope: vi.fn(),
  runOutbox: vi.fn(), sendSingle: vi.fn(),
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://outbox-local-fixture.example.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: io.fetch },
  }) }
})
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: io.requirePlatform, isPlatformAdminContext: () => true }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: io.companyScope }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => React.createElement('a', { href }, children),
}))
vi.mock('@/app/admin/ediel/outbox/actions', () => ({
  processEdielOutboxAction: io.runOutbox, sendSingleEdielOutboxItemAction: io.sendSingle,
}))

import EdielOutboxPage from '@/app/admin/ediel/outbox/page'

const company = 'fixture-company', neighbor = 'fixture-other-company'
const problem = 'in.(failed,blocked,blocked_tenant_state)'
const ready = 'in.(prepared,queued)'
type Row = {
  id: string; company_id: string; environment: string; status: string; ediel_message_id: string;
  created_at: string; updated_at: string; last_error?: string;
}
type Read = { method: string; environment: string | null; status: string | null; params: URLSearchParams }
let rows: Row[], reads: Read[], refused: (request: Read) => boolean, snapshot: (request: Read) => Row[]

function row(id: string, environment: string, status: string, created_at = '2026-11-20T00:00:00Z', owner = company): Row {
  return { id, company_id: owner, environment, status, created_at, updated_at: created_at, ediel_message_id: id + '-message' }
}

function selected(query: URLSearchParams, column: keyof Row, value: Row) {
  const filter = query.get(column)
  if (!filter) return true
  if (filter.startsWith('eq.')) return value[column] === filter.slice(3)
  if (filter.startsWith('in.(')) return filter.slice(4, -1).split(',').includes(String(value[column]))
  throw new Error('unsupported fixture filter '+column)
}

async function transport(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  expect(url.hostname).toBe('outbox-local-fixture.example.invalid')
  expect(url.searchParams.get('company_id')).toBe('eq.' + company)
  if (url.pathname !== '/rest/v1/ediel_outbox') {
    return init?.method === 'HEAD'
      ? new Response(null, { headers: { 'content-range': '*/0' } })
      : Response.json([])
  }

  const params = url.searchParams
  const request = { method: init?.method ?? 'GET', environment: params.get('environment'), status: params.get('status'), params }
  reads.push(request)
  if (refused(request)) return Response.json({ code: '42703', message: 'synthetic private diagnostic' }, { status: 400 })
  const available = snapshot(request).filter(value => selected(params, 'company_id', value)
    && selected(params, 'environment', value) && selected(params, 'status', value))

  if (request.method === 'HEAD') {
    expect(new Headers(init?.headers).get('prefer')).toContain('count=exact')
    expect(params.get('select')).toBe('id')
    expect(params.has('limit')).toBe(false)
    return new Response(null, { headers: { 'content-range': '*/' + available.length } })
  }

  expect(request.method).toBe('GET')
  const limit = Number(params.get('limit'))
  expect(Number.isInteger(limit) && limit > 0 && limit <= 101).toBe(true)
  const order = params.get('order')?.split(',') ?? []
  available.sort((a, b) => {
    for (const criterion of order) {
      const [column, direction] = criterion.split('.') as [keyof Row, string]
      const comparison = String(a[column]).localeCompare(String(b[column]))
      if (comparison) return direction === 'desc' ? -comparison : comparison
    }
    return 0
  })
  return Response.json(available.slice(0, limit))
}

const render = async () => renderToStaticMarkup(await EdielOutboxPage())
function section(html: string, title: string) {
  return html.match(new RegExp('<section[^>]*aria-label="' + title + '"[^>]*>[\\s\\S]*?<\\/section>'))?.[0] ?? ''
}
const prodSection = (html: string) => section(html, 'Produktions-outbox')
const testSection = (html: string) => section(html, 'Test-outbox')

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.clearAllMocks()
  io.requirePlatform.mockResolvedValue({ userId: 'fixture-operator' })
  io.companyScope.mockResolvedValue({ companyId: company, companyName: 'Syntetiskt bolag' })
  io.fetch.mockImplementation(transport)
  rows = []
  reads = []
  refused = () => false
  snapshot = () => rows
})
afterEach(() => vi.unstubAllGlobals())

describe('outbox workloads by environment', () => {
  it('keeps old problems visible after newer history or other work fills the limit', async () => {
    rows = [
      row('old-prod-failed', 'production', 'failed', '2026-11-18T00:00:00Z'),
      row('old-prod-blocked', 'production', 'blocked', '2026-11-18T00:00:00Z'),
      row('old-prod-tenant-hold', 'production', 'blocked_tenant_state', '2026-11-18T00:00:00Z'),
      row('foreign-prod-failed', 'production', 'failed', undefined, neighbor),
      row('old-test-queued', 'test', 'queued', '2026-11-18T00:00:00Z'),
      ...Array.from({ length: 101 }, (_, i) => row('fresh-test-' + i, 'test', 'sent')),
      ...Array.from({ length: 102 }, (_, i) => row('fresh-prod-' + i, 'production', 'prepared')),
    ]
    const html = await render()
    for (const id of ['old-prod-failed', 'old-prod-blocked', 'old-prod-tenant-hold']) {
      expect(prodSection(html)).toContain('/admin/ediel/messages/' + id + '-message')
      expect(html).not.toContain('value="' + id + '"')
    }
    expect(prodSection(html)).toContain('3 med fel eller spärr')
    expect(prodSection(html)).toContain('102 i sändkö')
    expect(testSection(html)).toContain('0 med fel eller spärr')
    expect(testSection(html)).toContain('value="old-test-queued"')
    expect(html).not.toContain('foreign-prod-failed')
    const workloadReads = reads.filter(read => read.status === problem || read.status === ready)
    expect(workloadReads).toHaveLength(8)
    for (const environment of ['eq.production', 'eq.test']) {
      for (const status of [problem, ready]) {
        const branch = workloadReads.filter(read => read.environment === environment && read.status === status)
        expect(branch.map(read => read.method).sort()).toEqual(['GET', 'HEAD'])
        expect(branch.find(read => read.method === 'GET')?.params.get('order')).toBe('created_at.desc,id.desc')
      }
    }
  })

  it('reports the exact count even when the visible failed list is bounded', async () => {
    rows = Array.from({ length: 101 }, (_, i) => row('same-time-failed-' + String(i).padStart(3, '0'), 'production', 'failed'))
    const html = await render()
    expect(prodSection(html)).toContain('101 med fel eller spärr')
    expect(prodSection(html)).toContain('/admin/ediel/messages/same-time-failed-100-message')
    expect(prodSection(html)).not.toContain('/admin/ediel/messages/same-time-failed-000-message')
  })

  it('keeps counts and lists independently available across environments', async () => {
    refused = read => read.environment === 'eq.production'
      && ((read.method === 'HEAD' && read.status === ready) || (read.method === 'GET' && read.status === problem))
    rows = [row('prod-failed', 'production', 'failed', '2026-11-18T00:00:00Z'), row('test-queued', 'test', 'queued')]
    const html = await render()
    expect(prodSection(html)).toContain('Antalet i sändkön kunde inte läsas.')
    expect(prodSection(html)).toContain('Listan över fel och spärrar kunde inte läsas.')
    expect(prodSection(html)).toContain('1 med fel eller spärr')
    expect(testSection(html)).toContain('0 med fel eller spärr')
    expect(testSection(html)).toContain('value="test-queued"')
    expect(html).not.toContain('synthetic private diagnostic')
  })

  it('keeps one non-sendable row when recent history sees a ready row become failed', async () => {
    rows = [row('status-changed', 'production', 'queued')]
    snapshot = read => read.status ? rows : [row('status-changed', 'production', 'failed')]

    const html = await render()
    expect(html.match(/\/admin\/ediel\/messages\/status-changed-message/g)).toHaveLength(1)
    expect(prodSection(html)).toContain('>failed<')
    expect(html).not.toContain('value="status-changed"')
  })

  it('keeps the earlier authorized view and never runs actions while reading', async () => {
    rows = [row('historical', 'legacy', 'sent'), row('held', 'production', 'delivery_uncertain')]
    const html = await render()
    expect(section(html, 'Outbox utan tydlig miljö')).toContain('/admin/ediel/messages/historical-message')
    expect(section(html, 'Avstämningsbehov')).toContain('/admin/ediel/messages/held-message')
    expect(html.match(/\/admin\/ediel\/messages\/held-message/g)).toHaveLength(1)
    expect(io.runOutbox).not.toHaveBeenCalled()
    expect(io.sendSingle).not.toHaveBeenCalled()

    io.fetch.mockClear()
    io.requirePlatform.mockRejectedValue(new Error('fixture denied'))
    await expect(EdielOutboxPage()).rejects.toThrow('fixture denied')
    expect(io.fetch).not.toHaveBeenCalled()
  })
})
