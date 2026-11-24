import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AutomationPage from '@/app/admin/ediel/automation/page'
import UnresolvedPage from '@/app/admin/ediel/unresolved/page'
import { getEdielAutomationDashboard } from '@/lib/ediel/operations/automationDashboard'

const io = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('http://127.0.0.1:1', 'synthetic-service-test', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: io.fetch },
  }) }
})
vi.mock('@/lib/admin/guards', () => ({
  requirePlatformAdminAccess: async () => ({ userId: 'authorized-operator', email: 'operator@example.invalid' }),
  isPlatformAdminContext: () => true,
}))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: async () => ({ companyId: 'company-a', companyName: 'Testbolag A' }),
}))
vi.mock('@/components/admin/AdminHeader', () => ({
  default: ({ title }: { title: string }) => React.createElement('header', null, title),
}))

const evaluatedAt = '2026-11-19T12:00:00.000Z'
const before = '2026-11-19T11:59:59.999Z'
const after = '2026-11-19T12:00:00.001Z'
const history = '2026-11-01T12:00:00.000Z'
const companyId = 'company-a'

function timer(id: string, status: string, dueAt: string, owner = companyId) {
  return { id, company_id: owner, status, due_at: dueAt }
}
type Timer = ReturnType<typeof timer>

function mountSqlRead(timers: Timer[], countResponse: 'success' | 'error' | 'missing-count' = 'success') {
  io.fetch.mockImplementation(async (value, init) => {
    const url = new URL(value instanceof Request ? value.url : String(value))
    expect(url.origin).toBe('http://127.0.0.1:1')
    const table = url.pathname.split('/').at(-1)
    if (table !== 'ediel_sla_timers') {
      return Response.json([], { headers: { 'content-range': '*/0' } })
    }
    const tenant = url.searchParams.get('company_id')
    const scoped = timers.filter(row => !tenant || tenant === `eq.${row.company_id}`)
    if (init?.method !== 'HEAD') {
      const limit = Number(url.searchParams.get('limit') ?? scoped.length)
      return Response.json(scoped.sort((a, b) => a.due_at.localeCompare(b.due_at)).slice(0, limit))
    }
    expect(new Headers(init.headers).get('prefer')).toContain('count=exact')
    expect(url.searchParams.get('status')).toBe('in.(open,warning,critical,expired)')
    expect(url.searchParams.get('or')).toBe(`(status.in.(critical,expired),due_at.lte.${evaluatedAt})`)
    expect(url.searchParams.has('limit')).toBe(false)
    if (countResponse === 'error') return new Response(null, { status: 403, statusText: 'Synthetic read denied' })
    if (countResponse === 'missing-count') return new Response(null)
    const count = scoped.filter(row => ['open', 'warning', 'critical', 'expired'].includes(row.status)
      && (['critical', 'expired'].includes(row.status) || Date.parse(row.due_at) <= Date.parse(evaluatedAt))).length
    const contentRange = count ? `0-${count - 1}/${count}` : '*/0'
    return new Response(null, { headers: { 'content-range': contentRange } })
  })
}

beforeEach(() => {
  io.fetch.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(evaluatedAt))
})
afterEach(() => vi.useRealTimers())

it('keeps old terminal history from crowding out the scoped active count', async () => {
  const oldTerminal = Array.from({ length: 70 }, (_, index) => timer(`history-${index}`, index % 2 === 0 ? 'resolved' : 'cancelled', history))
  const active = Array.from({ length: 61 }, (_, index) => timer(`active-${index}`, 'open', before))
  mountSqlRead([...oldTerminal, ...active, timer('at', 'open', evaluatedAt), timer('warning', 'warning', before),
    timer('critical-future', 'critical', after), timer('expired', 'expired', before), timer('future', 'open', after),
    timer('unknown-early', 'unknown', history), timer('foreign', 'critical', before, 'company-b')])
  const dashboard = await getEdielAutomationDashboard({ companyId, limit: 3 })
  expect(dashboard.metrics.slaCritical).toBe(65)
  expect(dashboard.slaTimers.map(row => row.id)).toEqual(['history-0', 'history-1', 'history-2'])
  const counts = io.fetch.mock.calls.filter(([, init]) => init?.method === 'HEAD')
  expect(counts).toHaveLength(1)
  expect(new URL(String(counts[0][0])).searchParams.get('company_id')).toBe('eq.company-a')
})

it('displays verified zero for a tenant whose only prior timers are resolved and cancelled', async () => {
  mountSqlRead([timer('resolved', 'resolved', history), timer('cancelled', 'cancelled', history), timer('future', 'warning', after)])
  for (const page of [AutomationPage, UnresolvedPage]) {
    const html = renderToStaticMarkup(await page())
    expect(html).toMatch(/SLA kritisk<\/p><p[^>]*>0<\/p>/)
    expect(html).not.toContain('Kritiska kvittensfrister kunde inte räknas.')
  }
})

it.each(['error', 'missing-count'] as const)('distinguishes unavailable count (%s) from zero on both pages', async outcome => {
  mountSqlRead([], outcome)
  const dashboard = await getEdielAutomationDashboard({ companyId })
  expect(dashboard.metrics.slaCritical).toBeNull()
  for (const page of [AutomationPage, UnresolvedPage]) {
    const html = renderToStaticMarkup(await page())
    expect(html).toMatch(/SLA kritisk<\/p><p[^>]*>Okänt<\/p>/)
    expect(html).toContain('Kritiska kvittensfrister kunde inte räknas.')
    expect(html).toMatch(/Unresolved<\/p><p[^>]*>0<\/p>/)
    expect(html).not.toContain('Synthetic read denied')
  }
})

it('keeps positive active counts consistent between the two ordinary pages', async () => {
  mountSqlRead([timer('at', 'open', evaluatedAt), timer('late', 'expired', before)])
  for (const page of [AutomationPage, UnresolvedPage]) {
    const html = renderToStaticMarkup(await page())
    expect(html).toMatch(/SLA kritisk<\/p><p[^>]*>2<\/p>/)
  }
})
