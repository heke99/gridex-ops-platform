import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as scanDataQuality } from '@/app/api/cron/data-quality/scan/route'
import { listAnalyticsCompanyIds } from '@/lib/analytics/cron'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  scanCompanyDataQuality: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: mocks.from } }))
vi.mock('@/lib/analytics/dataQuality', () => ({
  scanCompanyDataQuality: mocks.scanCompanyDataQuality,
}))

type CompanyRow = { id: string; status: string }
type CompanyRead = {
  table: string
  columns?: string
  statuses?: string[]
  ascending?: boolean
  after?: string
  through?: string
  limit?: number
}

const companyId = (value: number) =>
  `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`

function eligibleRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: companyId((index + 1) * 2),
    status: index % 2 ? 'active' : 'onboarding',
  }))
}

function modelCompanyReads(rows: CompanyRow[], beforeRead?: (number: number) => Error | void) {
  const reads: CompanyRead[] = []
  mocks.from.mockImplementation((table: string) => {
    const read: CompanyRead = { table }
    const query = {
      select(columns: string) {
        read.columns = columns
        return query
      },
      in(_column: string, statuses: string[]) {
        read.statuses = statuses
        return query
      },
      order(_column: string, { ascending }: { ascending: boolean }) {
        read.ascending = ascending
        return query
      },
      gt(_column: string, after: string) {
        read.after = after
        return query
      },
      lte(_column: string, through: string) {
        read.through = through
        return query
      },
      async limit(limit: number) {
        read.limit = limit
        reads.push(read)
        const error = beforeRead?.(reads.length)
        if (error) return { data: null, error }
        const matches = rows.filter(({ id, status }) =>
          (!read.statuses || read.statuses.includes(status)) &&
          (!read.after || id > read.after) &&
          (!read.through || id <= read.through),
        )
        if (read.ascending !== undefined) {
          const direction = read.ascending ? 1 : -1
          matches.sort((left, right) => direction * left.id.localeCompare(right.id))
        }
        return { data: matches.slice(0, limit).map(({ id }) => ({ id })), error: null }
      },
    }
    return query
  })
  return reads
}

const cronToken = 'synthetic-analytics-cron-secret'
const cronRequest = () => new NextRequest('https://synthetic.invalid/api/cron/data-quality/scan?month=2026-10-01', {
  headers: { authorization: `Bearer ${cronToken}` },
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('ANALYTICS_CRON_SECRET', cronToken)
  vi.stubEnv('CRON_SECRET', '')
  mocks.scanCompanyDataQuality.mockResolvedValue({ issues: 0 })
})

afterEach(() => vi.unstubAllEnvs())

describe('analytics company selection', () => {
  it('reads all eligible companies through the scheduled route in stable pages', async () => {
    const eligible = eligibleRows(1001)
    const reads = modelCompanyReads([
      { id: companyId(3000), status: 'paused' },
      ...eligible.slice().reverse(),
      { id: companyId(1999), status: 'closed' },
    ])

    const response = await scanDataQuality(cronRequest())
    expect(response.status).toBe(200)
    const companyIds = eligible.map(({ id }) => id)
    expect(await response.json()).toMatchObject({
      ok: true,
      results: companyIds.map((companyId) => ({ companyId, issues: 0 })),
    })
    expect(mocks.scanCompanyDataQuality).toHaveBeenCalledTimes(1001)
    expect(reads).toEqual([
      { table: 'companies', columns: 'id', statuses: ['active', 'onboarding'], ascending: false, limit: 1 },
      { table: 'companies', columns: 'id', statuses: ['active', 'onboarding'], ascending: true, through: companyId(2002), limit: 1000 },
      { table: 'companies', columns: 'id', statuses: ['active', 'onboarding'], ascending: true, after: companyId(2000), through: companyId(2002), limit: 1000 },
    ])
  })

  it('includes a concurrent eligible row ahead of the cursor within the initial bound', async () => {
    const eligible = eligibleRows(1001)
    const rows = eligible.slice().reverse()
    modelCompanyReads(rows, (number) => {
      if (number === 3) {
        rows.push(
          { id: companyId(1), status: 'active' },
          { id: companyId(2001), status: 'onboarding' },
          { id: companyId(2003), status: 'active' },
        )
      }
    })

    const startedIds = eligible.map(({ id }) => id)
    expect(await listAnalyticsCompanyIds()).toEqual([...startedIds.slice(0, 1000), companyId(2001), companyId(2002)])
    const orderedIds = rows.map(({ id }) => id).sort()
    modelCompanyReads(rows)
    expect(await listAnalyticsCompanyIds()).toEqual(orderedIds)
  })

  it('returns an empty list when no company is eligible', async () => {
    const reads = modelCompanyReads([{ id: companyId(1), status: 'paused' }])
    await expect(listAnalyticsCompanyIds()).resolves.toEqual([])
    expect(reads).toHaveLength(1)
  })

  it('propagates a later page failure before the scheduled route processes any company', async () => {
    const error = new Error('synthetic company page failure')
    modelCompanyReads(eligibleRows(1001), (number) => number === 3 ? error : undefined)

    await expect(scanDataQuality(cronRequest())).rejects.toBe(error)
    expect(mocks.scanCompanyDataQuality).not.toHaveBeenCalled()
  })
})
