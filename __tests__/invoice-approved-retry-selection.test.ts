import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { processDueApprovedInvoiceRetries } from '@/lib/billing/invoiceApprovedDispatch'

const ports = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>(), withLock: vi.fn() }))

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://billing.example.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: ports.fetch },
  }) }
})
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: async () => undefined }))
vi.mock('@/lib/automation/locks', () => ({ withAutomationLock: ports.withLock }))
vi.mock('@/lib/ediel/retention/financeCopyRetention', () => ({ requireInvoiceSourceCopiesAvailable: vi.fn() }))

const uuid = (number: number) => `abc00000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`
const company = uuid(101), otherCompany = uuid(102), actor = uuid(103)
const oldestEligible = uuid(51), nextEligible = uuid(52)
const approvalStatus = 'metadata->approval->>status'
const approvedBy = 'metadata->approval->>approved_by'
const statusSql = "metadata->'approval'->>'status'"
const actorSql = "metadata->'approval'->>'approved_by'"
const reads: { cutoff: string; companyId: string | null; kind: string }[] = []
let db: PGlite

// Execute the predicates, order and limit from the real Supabase client's HTTP request against PostgreSQL.
async function queryPort(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input))
  const query = url.searchParams
  const cutoff = query.get('next_retry_at')?.slice('lte.'.length)
  const companyId = query.get('company_id')?.slice('eq.'.length) ?? null
  expect(url.pathname).toBe('/rest/v1/invoice_export_items')
  expect(query.get('status')).toBe('eq.failed_retryable')
  expect(cutoff).toBeDefined()
  const args = [cutoff!]
  const predicates = ["status = 'failed_retryable'", 'next_retry_at <= $1']
  if (companyId) predicates.push(`company_id = $${args.push(companyId)}`)

  if (init?.method === 'HEAD') {
    reads.push({ cutoff: cutoff!, companyId, kind: 'diagnostic' })
    expect(new Headers(init.headers).get('prefer')).toContain('count=exact')
    const complement = query.get('or')?.slice(1, -1).split(',') ?? []
    expect(complement.slice(0, 3)).toEqual([
      `${approvalStatus}.neq.approved`, `${approvalStatus}.is.null`, `${approvedBy}.is.null`,
    ])
    const pattern = complement[3]?.slice(`${approvedBy}.not.match.`.length)
    if (!pattern) throw new Error('Missing approving actor filter')
    expect(complement[3]).toBe(`${approvedBy}.not.match.${pattern}`)
    predicates.push(`(${statusSql} <> 'approved' or ${statusSql} is null or ${actorSql} is null or ${actorSql} !~ $${args.push(pattern)})`)
    const { rows } = await db.query<{ count: number }>(`select count(*)::int from invoice_export_items where ${predicates.join(' and ')}`, args)
    return new Response(null, { headers: { 'content-range': `*/${rows[0].count}` } })
  }

  reads.push({ cutoff: cutoff!, companyId, kind: 'selection' })
  if (query.has(approvalStatus)) {
    expect(query.get(approvalStatus)).toBe('eq.approved')
    predicates.push(`${statusSql} = 'approved'`)
  }
  if (query.has(approvedBy)) {
    const filter = query.get(approvedBy)!
    expect(filter).toMatch(/^match\./)
    predicates.push(`${actorSql} ~ $${args.push(filter.slice('match.'.length))}`)
  }
  const order = query.get('order')
  expect(['next_retry_at.asc', 'next_retry_at.asc,id.asc']).toContain(order)
  const orderBy = order === 'next_retry_at.asc,id.asc' ? 'next_retry_at, id' : 'next_retry_at'
  const { rows } = await db.query(`select id, company_id, metadata from invoice_export_items where ${predicates.join(' and ')}
    order by ${orderBy} limit $${args.push(query.get('limit')!)}`, args)
  return Response.json(rows)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create table invoice_export_items(
    id uuid primary key, company_id uuid, status text, next_retry_at timestamptz, metadata jsonb
  )`)
})

afterAll(async () => { await db?.close() })

const approved = { approval: { status: 'approved', approved_by: ` ${actor.toUpperCase()} ` } }

async function addItem(id: string, metadata: object, attributes?: { company_id?: string; status?: string; next_retry_at?: string }) {
  await db.query('insert into invoice_export_items values ($1,$2,$3,$4,$5)', [id, attributes?.company_id ?? company,
    attributes?.status ?? 'failed_retryable', attributes?.next_retry_at ?? '2000-01-01T00:00:00Z', JSON.stringify(metadata)])
}

beforeEach(async () => {
  reads.length = 0
  ports.fetch.mockReset().mockImplementation(queryPort)
  ports.withLock.mockReset().mockResolvedValue({ status: 'sent' })
  await db.exec('truncate invoice_export_items')
})

describe('approved invoice retry queue selection', () => {
  it('picks eligible work behind 50 older items without a usable approval and reports the gap', async () => {
    const invalid = [{}, { approval: { status: 'pending', approved_by: actor } },
      ...[null, 123, { id: actor }, '  '].map(approved_by => ({ approval: { status: 'approved', approved_by } }))]
    for (let n = 1; n <= 50; n += 1) await addItem(uuid(n), invalid[n % invalid.length])
    await addItem(oldestEligible, approved, { next_retry_at: '2000-01-02T00:00:00Z' })
    await addItem(uuid(53), approved, { company_id: otherCompany })
    await addItem(uuid(54), {}, { company_id: otherCompany })
    await addItem(uuid(55), {}, { next_retry_at: '2099-01-01T00:00:00Z' })
    await addItem(uuid(56), {}, { status: 'configuration_error' })

    expect(await processDueApprovedInvoiceRetries({ companyId: company, limit: 50 })).toEqual({
      processed: 1, sent: 1, failed: 0, needsApproval: 50,
    })
    expect(ports.withLock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ lockKey: `approved-invoice:${company}:${oldestEligible}` }))
    expect(reads).toEqual([
      { kind: 'selection', companyId: company, cutoff: expect.any(String) },
      { kind: 'diagnostic', companyId: company, cutoff: reads[0].cutoff },
    ])
  })

  it('keeps stable oldest-first ties and processes a bounded batch if the diagnostic read fails', async () => {
    const logger = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    ports.fetch.mockImplementation(async (input, init) => init?.method === 'HEAD'
      ? new Response(null, { status: 400 })
      : queryPort(input, init))
    await addItem(nextEligible, approved)
    await addItem(oldestEligible, approved)
    await addItem(uuid(50), approved, { next_retry_at: '2000-01-02T00:00:00Z' })

    try {
      expect(await processDueApprovedInvoiceRetries({ limit: 1 })).toEqual({
        processed: 1, sent: 1, failed: 0, needsApproval: null,
      })
      expect(ports.withLock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ lockKey: `approved-invoice:${company}:${oldestEligible}` }))
    } finally {
      logger.mockRestore()
    }
  })
})
