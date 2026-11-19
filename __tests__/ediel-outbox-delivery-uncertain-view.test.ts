import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(), guard: vi.fn(), scope: vi.fn(), failReviewRead: false,
  recentStatus: null as 'sent' | 'failed' | null,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://outbox-fixture.example.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: io.fetch },
  }) }
})
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: io.guard, isPlatformAdminContext: () => true }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: io.scope }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/app/admin/ediel/outbox/actions', () => ({ processEdielOutboxAction: vi.fn(), sendSingleEdielOutboxItemAction: vi.fn() }))

import EdielOutboxPage from '@/app/admin/ediel/outbox/page'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uid(1), otherCompany = uid(2), oldMessage = uid(3), recentMessage = uid(4), foreignMessage = uid(5)
type OutboxFixtureRow = Record<string, unknown> & { ediel_message_id: string }
let db: PGlite

async function fetchPort(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  expect(init?.method).toBe('GET')
  expect(url.searchParams.get('company_id')).toBe(`eq.${company}`)
  if (url.pathname !== '/rest/v1/ediel_outbox') return Response.json([])
  const review = url.searchParams.has('status')
  if (review) {
    expect(url.searchParams.get('status')).toBe('eq.delivery_uncertain')
    expect(url.searchParams.get('order')).toBe('updated_at.desc,id.desc')
    expect(url.searchParams.get('limit')).toBe('101')
    if (io.failReviewRead) return Response.json({ code: '42703', message: 'synthetic_internal_error' }, { status: 400 })
  } else {
    expect(url.searchParams.get('order')).toBe('created_at.desc')
    expect(url.searchParams.get('limit')).toBe('100')
  }
  const columns = url.searchParams.get('select')!.split(',')
  expect(columns.every(column => /^[a-z_]+$/.test(column))).toBe(true)
  const status = review ? "and status='delivery_uncertain'" : ''
  const order = review ? 'updated_at desc, id desc' : 'created_at desc'
  const { rows } = await db.query<OutboxFixtureRow>(`select ${columns.join(',')} from public.ediel_outbox
    where company_id=$1 ${status} order by ${order} limit $2`, [company, Number(url.searchParams.get('limit'))])
  if (!review && io.recentStatus) {
    return Response.json(rows.map(row => row.ediel_message_id === recentMessage ? { ...row, status: io.recentStatus } : row))
  }
  return Response.json(rows)
}

const render = async () => renderToStaticMarkup(await EdielOutboxPage())
function reviewSection(html: string) {
  return html.match(/<section[^>]*aria-label="Avstämningsbehov"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? ''
}

async function put(id: string, messageId: string, tenant: string, status: string, created: string, updated: string) {
  await db.query(`insert into public.ediel_outbox
    (id, lock_key, ediel_message_id, company_id, message_family, status, created_at, updated_at, last_error)
    values ($1::uuid,$1::uuid::text,$2,$3,'APERAK',$4,$5,$6,'synthetic_private_transport_detail')`, [id, messageId, tenant, status, created, updated])
}

beforeAll(async () => {
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
  const ddl = schema.match(/^CREATE TABLE public\.ediel_outbox \([\s\S]+?^\);/m)?.[0]
  if (!ddl) throw new Error('missing_ediel_outbox_fixture_ddl')
  db = new PGlite()
  await db.exec(ddl)
})
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  vi.stubGlobal('React', React)
  io.fetch.mockReset().mockImplementation(fetchPort)
  io.guard.mockReset().mockResolvedValue({ userId: 'synthetic-operator', email: 'operator@example.invalid' })
  io.scope.mockReset().mockResolvedValue({ companyId: company, companyName: 'Syntetiskt bolag' })
  io.failReviewRead = false
  io.recentStatus = null
  await db.exec('truncate public.ediel_outbox')
})
afterEach(() => vi.unstubAllGlobals())

describe('delivery-uncertain Ediel outbox visibility', () => {
  it('keeps older and recent uncertain items visible once, even behind 100 newer successful items', async () => {
    await put(uid(11), oldMessage, company, 'delivery_uncertain', '2026-11-15', '2026-11-18')
    await put(uid(12), recentMessage, company, 'delivery_uncertain', '2026-11-19', '2026-11-18')
    await put(uid(13), foreignMessage, otherCompany, 'delivery_uncertain', '2026-11-20', '2026-11-20')
    await db.query(`insert into public.ediel_outbox(lock_key, ediel_message_id, company_id, status, created_at)
      select 'newer-'||n, gen_random_uuid(), $1, 'sent', '2026-11-18'::timestamptz from generate_series(1,100) n`, [company])
    const html = await render()
    const section = reviewSection(html)
    expect(section).toContain('2 poster visas')
    expect(section).toContain(`/admin/ediel/messages/${oldMessage}`)
    expect(section.indexOf(recentMessage)).toBeLessThan(section.indexOf(oldMessage))
    expect(html.split(`/admin/ediel/messages/${recentMessage}`)).toHaveLength(2)
    expect(html).not.toContain(foreignMessage)
    expect(section).not.toMatch(/Skicka denna|synthetic_private_transport_detail/)
    expect(html).toContain('Test-outbox')
  })

  it('states a bounded list clearly when additional reconciliation items exist', async () => {
    await db.query(`insert into public.ediel_outbox(lock_key, ediel_message_id, company_id, status, updated_at)
      select 'review-'||n, gen_random_uuid(), $1, 'delivery_uncertain', '2026-11-18'::timestamptz from generate_series(1,101) n`, [company])
    const section = reviewSection(await render())
    expect(section).toContain('Visar de 100 senast uppdaterade posterna.')
    expect(section.split('Öppna meddelande för avstämning')).toHaveLength(101)
  })

  it.each(['sent', 'failed'] as const)('keeps one reconciliation row when recent history reads the same ID as %s', async status => {
    await put(uid(12), recentMessage, company, 'delivery_uncertain', '2026-11-19', '2026-11-19')
    io.recentStatus = status
    const html = await render()
    expect(reviewSection(html)).toContain(`/admin/ediel/messages/${recentMessage}`)
    expect(html.split(`/admin/ediel/messages/${recentMessage}`)).toHaveLength(2)
    expect(html).toContain('0 poster redo för kontroll/skick')
    expect(html).not.toContain('Skicka denna')
  })

  it('distinguishes a failed read from verified empty and preserves recent history on failure', async () => {
    expect(reviewSection(await render())).toContain('Inga leveransovissa poster att stämma av.')
    io.failReviewRead = true
    await put(uid(12), recentMessage, company, 'delivery_uncertain', '2026-11-19', '2026-11-19')
    const html = await render()
    const section = reviewSection(html)
    expect(section).toContain('Avstämningsbehovet kunde inte läsas.')
    expect(section).not.toContain('Inga leveransovissa poster')
    expect(html).toContain(`/admin/ediel/messages/${recentMessage}`)
    expect(html).not.toMatch(/Skicka denna|synthetic_internal_error|synthetic_private_transport_detail/)
  })

  it('checks the existing platform permission before either outbox read', async () => {
    io.guard.mockRejectedValue(new Error('forbidden_fixture'))
    await expect(EdielOutboxPage()).rejects.toThrow('forbidden_fixture')
    expect(io.fetch).not.toHaveBeenCalled()
  })
})
