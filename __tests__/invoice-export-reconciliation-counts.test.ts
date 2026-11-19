import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProductionConsistencyChecks } from '@/lib/ops/reconciliation'

const localFetch = vi.hoisted(() => vi.fn<typeof fetch>())
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://reconciliation.example.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: localFetch },
  }) }
})

const uuid = (id: number) => `a0000000-0000-4000-8000-${id.toString(16).padStart(12, '0')}`
const company = uuid(1), otherCompany = uuid(2)
const complete = uuid(100), partial = uuid(101), absent = uuid(102), empty = uuid(103), missingSent = uuid(104), otherRun = uuid(105)
const countRequests: { companyId: string | null; runId: string; sentOnly: boolean }[] = []
let dropCountFor: string | null, activeCounts: number, peakCounts: number
let db: PGlite

async function localRest(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input))
  const table = url.pathname.split('/').at(-1)
  const companyId = url.searchParams.get('company_id')?.slice(3) ?? null
  if (table === 'invoice_export_runs') {
    const fields = ['id', 'company_id', 'total_items', 'sent_items', 'failed_items']
      .filter(field => url.searchParams.get('select')?.split(',').includes(field))
    expect(fields).toContain('id')
    expect(url.searchParams.get('order')).toBe('created_at.desc')
    expect(url.searchParams.get('limit')).toBe('50')
    const { rows } = await db.query(`select ${fields.join(',')} from invoice_export_runs
      where ($1::uuid is null or company_id=$1) order by created_at desc limit 50`, [companyId])
    return Response.json(rows)
  }
  const runId = url.searchParams.get('export_run_id')?.slice(3)
  if (table !== 'invoice_export_items' || !runId) return Response.json([])
  const rowsInScope = 'from invoice_export_items where export_run_id=$1 and ($2::uuid is null or company_id=$2)'
  const argumentsForQuery = [runId, companyId]
  if (init?.method !== 'HEAD') {
    // The production REST limit applies to selected rows, independently of the run size.
    const { rows } = await db.query(`select id,status ${rowsInScope} order by id limit 1000`, argumentsForQuery)
    return Response.json(rows)
  }

  expect(new Headers(init.headers).get('Prefer')).toContain('count=exact')
  expect(url.searchParams.has('limit')).toBe(false)
  const statusFilter = url.searchParams.get('status')
  expect([null, 'in.(sent,credited)']).toContain(statusFilter)
  const sentOnly = statusFilter !== null
  countRequests.push({ companyId, runId, sentOnly })
  activeCounts += 1
  peakCounts = Math.max(peakCounts, activeCounts)
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    if (runId === dropCountFor) return new Response(null)
    const { rows } = await db.query<{ count: number }>(`select count(*)::int ${rowsInScope}
      ${sentOnly ? "and status in ('sent','credited')" : ''}`, argumentsForQuery)
    if (runId === missingSent) await new Promise(resolve => setTimeout(resolve, 15))
    return new Response(null, { headers: { 'Content-Range': `*/${rows[0].count}` } })
  } finally {
    activeCounts -= 1
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create table invoice_export_runs(id uuid primary key, company_id uuid not null, total_items int not null,
    sent_items int not null, failed_items int not null default 0, created_at date not null);
    create table invoice_export_items(id int primary key, company_id uuid not null, export_run_id uuid not null, status text not null);`)
  await db.query(`insert into invoice_export_runs (id,company_id,total_items,sent_items,created_at) values
    ($1,$7,1001,1001,'2026-11-01'),($2,$7,2,1,'2026-11-02'),($3,$7,1,0,'2026-11-03'),
    ($4,$7,0,0,'2026-11-04'),($5,$7,2,2,'2026-11-05'),($6,$8,1,1,'2026-11-06')`,
  [complete, partial, absent, empty, missingSent, otherRun, company, otherCompany])
  await db.query(`insert into invoice_export_items select n,$1,$2,case when n=1001 then 'credited' else 'sent' end
    from generate_series(1,1001) n`, [company, complete])
  await db.query(`insert into invoice_export_items values (1200,$1,$2,'sent'),(1201,$1,$3,'sent'),(1202,$1,$3,'pending'),
    (1203,$4,$5,'pending'),(1204,$4,$6,'sent')`, [company, partial, missingSent, otherCompany, absent, otherRun])
})

afterAll(async () => { await db?.close() })

beforeEach(() => {
  dropCountFor = null
  activeCounts = 0
  peakCounts = 0
  countRequests.length = 0
  localFetch.mockReset().mockImplementation(localRest)
})

async function invoiceCheck(companyId: string | null) {
  const result = await runProductionConsistencyChecks({ companyId })
  return result.checks.find(check => check.key === 'invoice_run_totals_mismatch')
}

describe('invoice export run count reconciliation', () => {
  it('checks actual totals and sent counts beyond the 1000-row cap, including zero and missing rows', async () => {
    expect(await invoiceCheck(company)).toMatchObject({ count: 3, sampleIds: [missingSent, absent, partial] })
    expect(countRequests).toHaveLength(10)
    expect(countRequests.every(request => request.companyId === company && request.runId !== otherRun)).toBe(true)
    expect(peakCounts).toBe(8)
  })

  it('always binds counts to the selected run company in the platform view', async () => {
    expect(await invoiceCheck(null)).toMatchObject({ count: 3, sampleIds: [missingSent, absent, partial] })
    const otherRunCounts = countRequests.filter(request => request.runId === otherRun)
    expect(otherRunCounts).toHaveLength(2)
    expect(otherRunCounts).toEqual(expect.arrayContaining([
      { companyId: otherCompany, runId: otherRun, sentOnly: false },
      { companyId: otherCompany, runId: otherRun, sentOnly: true },
    ]))
    expect(countRequests.filter(request => request.runId === absent).every(request => request.companyId === company)).toBe(true)
  })

  it('reports an unavailable count receipt instead of treating the run as checked', async () => {
    dropCountFor = missingSent
    expect(await invoiceCheck(company)).toMatchObject({
      count: 0, sampleIds: [], error: 'invoice_export_run_counts_unavailable',
    })
    expect(activeCounts).toBe(0)
  })
})
