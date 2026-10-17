import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'

const io = vi.hoisted(() => ({
  started: [] as string[],
  filters: [] as Array<{ table: string; key: string; value: unknown }>,
  held: new Set<string>(),
  release: new Map<string, () => void>(),
  errors: {} as Record<string, unknown>,
  delayMs: 0,
  guardDenied: false,
  superadmin: true,
  portfolios: true,
}))

vi.mock('@/lib/admin/guards', () => ({
  requirePlatformAdminAccess: async () => {
    if (io.guardDenied) throw new Error('guard denied')
    return { userId: 'synthetic-platform-operator', email: 'operator@example.test' }
  },
}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/app/admin/pricing/portfolio-settlements/actions', () => ({
  correctSettlementAction: async () => {},
  createPortfolioAction: async () => {},
  generatePortfolioEstimateAction: async () => {},
  saveSettlementAreaDraftsAction: async () => {},
  transitionSettlementAction: async () => {},
}))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error('redirect:' + url) } }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: async () => { io.started.push('superadmin'); return { data: io.superadmin, error: null } },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { io.filters.push({ table, key, value }); return query },
        is: () => query,
        neq: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        then: async (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          io.started.push(table)
          if (io.held.has(table)) await new Promise<void>(done => { io.release.set(table, done) })
          if (io.delayMs) await new Promise<void>(done => setTimeout(done, io.delayMs))
          const rows: Record<string, Array<Record<string, unknown>>> = {
            companies: [{ id: 'company-a', name: 'Testbolag' }],
            portfolios: io.portfolios ? [{ id: 'portfolio-a', company_id: 'company-a', name: 'Testportfölj', code: 'TEST' }] : [],
            price_plans: [{ id: 'plan-a', name: 'Testplan' }],
            price_plan_versions: [{ id: 'version-a', price_plan_id: 'plan-a', version_label: 'v1', status: 'draft', snapshot_json: { portfolio_method: { portfolio_id: 'portfolio-a' } } }],
          }
          return Promise.resolve({ data: rows[table] ?? [], error: io.errors[table] ?? null }).then(resolve, reject)
        },
      }
      return query
    },
  },
}))

import PortfolioSettlementsPage from '@/app/admin/pricing/portfolio-settlements/page'

const branches = ['portfolio_monthly_settlements', 'portfolio_price_estimates', 'portfolio_settlement_audit_log']
const page = () => PortfolioSettlementsPage({ searchParams: Promise.resolve({ companyId: 'foreign-company', portfolioId: 'foreign-portfolio' }) })

beforeEach(() => {
  io.started = []
  io.filters = []
  io.held = new Set()
  io.release = new Map()
  io.errors = {}
  io.delayMs = 0
  io.guardDenied = false
  io.superadmin = true
  io.portfolios = true
  vi.stubGlobal('React', React)
})

describe('portfolio settlement independent reads', () => {
  it('starts every independent branch before any held branch completes', async () => {
    const independentReads = ['price_plans', ...branches]
    io.held = new Set(independentReads)
    const pending = page()
    try {
      await vi.waitFor(() => {
        expect(io.started).toEqual(expect.arrayContaining(independentReads))
      }, { timeout: 150, interval: 5 })
      for (const table of branches) {
        expect(io.filters).toContainEqual({ table, key: 'company_id', value: 'company-a' })
        expect(io.filters).toContainEqual({ table, key: 'portfolio_id', value: 'portfolio-a' })
      }
    } finally {
      // Drain both parallel and old sequential implementations on assertion failure.
      for (const table of independentReads) {
        io.held.delete(table)
        io.release.get(table)?.()
      }
      await pending
    }
  })

  it.each(branches.concat('price_plan_versions'))('preserves a read failure from %s', async table => {
    const error = { code: '42501', message: 'synthetic read denied' }
    io.errors[table] = error
    await expect(page()).rejects.toBe(error)
  })

  it('does not start database reads when the platform guard rejects', async () => {
    io.guardDenied = true
    await expect(page()).rejects.toThrow('guard denied')
    expect(io.started).toEqual([])
  })

  it('does not read tenant tables when the database superadmin check rejects', async () => {
    io.superadmin = false
    await expect(page()).rejects.toThrow('redirect:/admin')
    expect(io.started).toEqual(['superadmin'])
  })

  it('skips portfolio-specific branches when the qualified company has no portfolio', async () => {
    io.portfolios = false
    const html = renderToStaticMarkup(await page())
    expect(io.started.some(table => branches.includes(table))).toBe(false)
    expect(html).toContain('Ingen portfölj vald')
  })

  it.skipIf(!process.env.GRIDEX_P22_MEASURE_PATH)('records a bounded synthetic port-latency baseline or after measurement', async () => {
    const path = process.env.GRIDEX_P22_MEASURE_PATH!
    if (!/^quality\/system-build-execution-2026-10-14\/root\/P22-(before|after)\.json$/.test(path)) throw new Error('invalid measurement output')
    io.delayMs = 8
    const observations: number[] = []
    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      await page()
      observations.push(performance.now() - start)
    }
    const ordered = observations.slice().sort((a, b) => a - b)
    writeFileSync(path, JSON.stringify({
      scope: 'actual page with authenticated synthetic guard and database ports; no live DB/network/browser',
      method: '100 sequential page requests, same fixture and8ms independent table adapter latency, Node22',
      samples: observations.length, p50_ms: ordered[49], p95_ms: ordered[94],
      errors: 0, observations_ms: observations,
    }, null, 2) + '\n')
    expect(observations).toHaveLength(100)
  }, 20000)
})
