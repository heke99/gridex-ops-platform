import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'

const context = vi.hoisted(() => ({
  companyId: '00000000-0000-0000-0000-000000000001',
  host: 'demo.gridex.se',
  guard: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: context.host }) }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: context.guard }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))

import ElklartDemoPage from '@/app/admin/elklart-demo/page'

afterEach(() => {
  vi.unstubAllEnvs()
  context.guard.mockReset()
})

function enableDemo() {
  vi.stubEnv('ELKLART_DEMO_ENABLED', 'true')
  vi.stubEnv('ELKLART_DEMO_COMPANY_ID', context.companyId)
}

it('renders measured portfolio figures with the matching site breakdown', async () => {
  enableDemo()
  context.guard.mockResolvedValue({ email: null, companyId: context.companyId })
  const page = await ElklartDemoPage({ searchParams: Promise.resolve({ stage: 'measured', interval: '48' }) })
  const html = renderToStaticMarkup(page)
  expect(context.guard).toHaveBeenCalledWith('analytics.workspace')
  expect(html).toContain('0,600 MWh')
  expect(html).toContain('2,4 MW')
  expect(html).toContain('0,640 MWh')
  expect(html.replaceAll('<!-- -->', '')).toContain('Anläggningar kl. 12:00')
  expect(html).toContain('https://mina-sidor-demo.gridex.se/mina-sidor')
})

it('rejects access from another company even when the demo is enabled', async () => {
  enableDemo()
  context.guard.mockResolvedValue({ email: null, companyId: '00000000-0000-0000-0000-000000000002' })
  await expect(ElklartDemoPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/404/)
})

it('rejects the demo on a normal OPS hostname before reading data', async () => {
  enableDemo()
  context.host = 'app.gridex.se'
  try {
    await expect(ElklartDemoPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/404/)
    expect(context.guard).not.toHaveBeenCalled()
  } finally {
    context.host = 'demo.gridex.se'
  }
})
