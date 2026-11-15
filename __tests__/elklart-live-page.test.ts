import fs from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const ctx = vi.hoisted(() => ({
  companyId: '00000000-0000-0000-0000-000000000001',
  customerId: '00000000-0000-0000-0000-000000000002',
  meteringPointId: '00000000-0000-0000-0000-000000000003',
  host: 'demo.gridex.se', guard: vi.fn(), load: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: ctx.host }) }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: ctx.guard }))
vi.mock('@/lib/demo/elklartLiveData', () => ({ loadLiveDemoData: ctx.load }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
import Page from '@/app/admin/elklart-demo/ops-portfolio/page'
beforeEach(() => {
  vi.stubEnv('ELKLART_DEMO_ENABLED', 'true')
  vi.stubEnv('ELKLART_DEMO_COMPANY_ID', ctx.companyId)
  vi.stubEnv('ELKLART_DEMO_BINDINGS', JSON.stringify([{ profile: 'anna', customerId: ctx.customerId, meteringPointId: ctx.meteringPointId }]))
  ctx.guard.mockResolvedValue({ email: null, companyId: ctx.companyId })
  ctx.host = 'demo.gridex.se'
})
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
it('rejects normal hosts and foreign companies before the data loader', async () => {
  ctx.host = 'app.gridex.se'
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/404/)
  expect(ctx.guard).not.toHaveBeenCalled()
  ctx.host = 'demo.gridex.se'
  ctx.guard.mockResolvedValue({ companyId: ctx.customerId })
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/404/)
  expect(ctx.load).not.toHaveBeenCalled()
})
it('shows an explicit setup state instead of fabricated readings', async () => {
  vi.stubEnv('ELKLART_DEMO_BINDINGS', '')
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('Demokunderna är ännu inte kopplade')
  expect(ctx.load).not.toHaveBeenCalled()
})
it('does not fall back to examples or expose internal errors on read failures', async () => {
  ctx.load.mockRejectedValue(new Error('secret internal detail'))
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('Portföljen kunde inte verifieras')
  expect(html).not.toContain('secret internal detail')
  expect(html).not.toContain('0,600 MWh')
})
it('renders the supplied quarter with customer drilldown and a mobile interval selector', async () => {
  ctx.load.mockResolvedValue({ readAt: '2026-11-10T10:00:00Z', readings: [], supplies: [{ companyId: ctx.companyId, customerId: ctx.customerId, meteringPointId: ctx.meteringPointId, startAt: '2026-11-10T11:00:00Z', endAt: null, confirmed: true, cancelled: false, updatedAt: '2026-11-10T10:00:00Z' }] })
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ interval: '2026-11-10T11:00:00.000Z' }) }))
  expect(html).toContain('0,003 MWh')
  expect(html).toContain('0,012 MW')
  expect(html).toContain(`/admin/customers/${ctx.customerId}`)
  expect(html).toContain('name="interval"')
  expect(html).toContain('Prognosprofilen och inköpsprofilen är förberedda demoantaganden')
  expect(html).toContain('Saknas')
  if (process.env.ELKLART_RENDER_FIXTURE) fs.writeFileSync('/tmp/elklart-portfolio-fixture.html', `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${html}</body></html>`)
})
