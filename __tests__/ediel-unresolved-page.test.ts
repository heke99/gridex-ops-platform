import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>(), guard: vi.fn(), scope: vi.fn(), readError: false }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://local-fixture.example.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: io.fetch },
  }) }
})
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: io.guard, isPlatformAdminContext: () => true }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: io.scope }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('h1', null, title) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))

import EdielUnresolvedPage from '@/app/admin/ediel/unresolved/page'
import EdielAutomationPage from '@/app/admin/ediel/automation/page'

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const companyId = id(1), otherCompanyId = id(2), sourceId = id(3), oldMessageId = id(4)
const fixtures: Record<string, unknown[]> = {
  ediel_decision_traces: [{ id: id(21), company_id: companyId, decision: 'manual_review', can_auto_send: false }],
  ediel_outbox: [{ id: id(22), company_id: companyId, status: 'failed' }],
  ediel_sla_timers: [{ id: id(23), company_id: companyId, status: 'expired' }],
  ediel_portal_validation_feedback: [],
}
let db: PGlite

// Forward the actual SDK column selection, status predicates and ordered limit
// to the canonical table DDL under a synthetic tenant. No upstream calls.
async function fetchPort(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input))
  const table = url.pathname.split('/').at(-1)!
  expect(url.searchParams.get('company_id')).toBe(`eq.${companyId}`)
  if (table !== 'ediel_unresolved_items') {
    expect(fixtures).toHaveProperty(table)
    if (table === 'ediel_sla_timers' && init?.method === 'HEAD') {
      expect(new Headers(init.headers).get('prefer')).toContain('count=exact')
      return new Response(null, { headers: { 'content-range': '0-0/1' } })
    }
    return Response.json(fixtures[table])
  }
  if (io.readError) return Response.json({ code: '42703', message: 'internal_fixture_column', details: 'internal_fixture_details' }, { status: 400 })

  const columns = url.searchParams.get('select')!.split(',')
  expect(columns.every(column => /^[a-z_]+$/.test(column))).toBe(true)
  const order = url.searchParams.get('order')
  expect(['created_at.desc', 'created_at.desc,id.desc']).toContain(order)
  const orderSql = order === 'created_at.desc,id.desc' ? 'created_at desc, id desc' : 'created_at desc'
  const status = url.searchParams.get('status')
  if (status) expect(status).toBe('in.(open,manual_review)')
  const statusSql = status ? "and status in ('open','manual_review')" : ''
  try {
    const { rows } = await db.query(`select ${columns.join(',')} from public.ediel_unresolved_items
      where company_id=$1 ${statusSql} order by ${orderSql} limit $2`, [companyId, Number(url.searchParams.get('limit'))])
    return Response.json(rows)
  } catch (error) {
    const failure = error as { code?: string; message: string }
    return Response.json({ code: failure.code, message: failure.message }, { status: 400 })
  }
}

function count(html: string, label: string) {
  return html.match(new RegExp(`>${label}</p><p[^>]*>([^<]*)</p>`))?.[1]
}

beforeAll(async () => {
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
  const ddl = schema.match(/^CREATE TABLE public\.ediel_unresolved_items \([\s\S]+?^\);/m)?.[0]
  if (!ddl) throw new Error('missing_unresolved_schema_fixture')
  db = new PGlite()
  await db.exec(ddl)
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  vi.stubGlobal('React', React)
  io.fetch.mockReset().mockImplementation(fetchPort)
  io.guard.mockReset().mockResolvedValue({ userId: 'synthetic-operator', email: 'operator@example.invalid' })
  io.scope.mockReset().mockResolvedValue({ companyId, companyName: 'Syntetiskt bolag' })
  io.readError = false
  await db.exec('truncate public.ediel_unresolved_items')
})
afterEach(() => vi.unstubAllGlobals())

describe('Ediel unresolved list and overview', () => {
  it('uses the actual schema and keeps active tenant cases visible behind newer closed cases', async () => {
    await db.query(`insert into public.ediel_unresolved_items (company_id, issue_type, status, created_at)
      select $1, 'closed_fixture', 'closed', '2026-11-19'::timestamptz from generate_series(1,101)`, [companyId])
    await db.query(`insert into public.ediel_unresolved_items
      (id,company_id,source_message_id,ediel_message_id,issue_type,status,created_at) values
      ($1,$2,$3,$4,'tenant_not_found','open','2026-11-18'),
      ($5,$2,null,$4,'legacy_review','manual_review','2026-11-18'),
      ($6,$7,$8,null,'other_company_fixture','open','2026-11-18')`,
    [id(11), companyId, sourceId, oldMessageId, id(12), id(13), otherCompanyId, id(5)])

    const list = renderToStaticMarkup(await EdielUnresolvedPage())
    const overview = renderToStaticMarkup(await EdielAutomationPage())
    expect(count(list, 'Unresolved')).toBe('2')
    expect(count(overview, 'Unresolved')).toBe('2')
    expect(list).toContain(`href="/admin/ediel/messages/${sourceId}"`)
    expect(list).toContain(`href="/admin/ediel/messages/${oldMessageId}"`)
    expect(list.indexOf('legacy_review')).toBeLessThan(list.indexOf('tenant_not_found'))
    expect(list).not.toMatch(/closed_fixture|other_company_fixture|Inga osäkra matchningar/)
  })

  it('shows zero and the empty-state confirmation after a successful scoped read', async () => {
    const list = renderToStaticMarkup(await EdielUnresolvedPage())
    const overview = renderToStaticMarkup(await EdielAutomationPage())
    expect(count(list, 'Unresolved')).toBe('0')
    expect(count(overview, 'Unresolved')).toBe('0')
    expect(list).toContain('Inga osäkra matchningar just nu.')
    expect(list + overview).not.toMatch(/kunde inte läsas|ediel_unresolved_items|Migration\/åtkomst/)
  })

  it('shows unavailable instead of zero on both pages and preserves successful adjacent metrics', async () => {
    io.readError = true
    const list = renderToStaticMarkup(await EdielUnresolvedPage())
    const overview = renderToStaticMarkup(await EdielAutomationPage())
    for (const html of [list, overview]) {
      expect(count(html, 'Unresolved')).toBe('Okänt')
      expect(html).toContain('Osäkra matchningar kunde inte läsas.')
      expect(html).not.toMatch(/Inga osäkra matchningar|internal_fixture|ediel_unresolved_items/)
      expect(count(html, 'SLA kritisk')).toBe('1')
    }
    expect(count(list, 'Manual decisions')).toBe('1')
    expect(count(list, 'Outbox stopp')).toBe('1')
    expect(count(overview, 'Manual review')).toBe('1')
    expect(count(overview, 'Outbox fel')).toBe('1')
  })

  it('requires access before reading any dashboard data', async () => {
    io.guard.mockRejectedValue(new Error('forbidden_fixture'))
    await expect(EdielUnresolvedPage()).rejects.toThrow('forbidden_fixture')
    await expect(EdielAutomationPage()).rejects.toThrow('forbidden_fixture')
    expect(io.fetch).not.toHaveBeenCalled()
  })
})
