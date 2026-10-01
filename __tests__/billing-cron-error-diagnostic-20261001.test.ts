import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const fixture = vi.hoisted(() => ({
  retry: vi.fn(), pending: vi.fn(), review: vi.fn(), monthly: vi.fn(),
}))
vi.mock('@/lib/billing/invoiceApprovedDispatch', () => ({processDueApprovedInvoiceRetries: fixture.retry}))
vi.mock('@/lib/billing/providerEventProcessor', () => ({processPendingInvoiceProviderEvents: fixture.pending, retryReviewableInvoiceProviderEvents: fixture.review}))
vi.mock('@/lib/billing/monthlyAutomation', () => ({runMonthlyBillingAutomation: fixture.monthly}))

import { GET as retryGet, POST as retryPost } from '@/app/api/cron/billing/invoice-export-retry/route'
import { GET as monthlyGet, POST as monthlyPost } from '@/app/api/cron/billing/monthly/route'

const key = 'SYNTHETIC_LOCAL_BILLING_CRON_KEY'
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('BILLING_AUTOMATION_CRON_SECRET', key); vi.stubEnv('CRON_SECRET', '')
  fixture.retry.mockResolvedValue({sent: 0, skipped: 1}); fixture.pending.mockResolvedValue({processed: 1})
  fixture.review.mockResolvedValue({processed: 0}); fixture.monthly.mockResolvedValue({prepared: 1})
})
afterEach(() => vi.unstubAllEnvs())
function request(path: string, method = 'GET', authorized = true) {
  return new NextRequest(`https://synthetic.invalid${path}`, {method,
    headers: authorized ? {authorization: `Bearer ${key}`} : {},
  })
}
it.each([
  {name: 'retry', run: retryGet, adapter: fixture.retry, path: '/api/cron/billing/invoice-export-retry?company_id=SYN-COMPANY&limit=25', code: 'invoice_export_retry_cron_failed'},
  {name: 'monthly', run: monthlyGet, adapter: fixture.monthly, path: '/api/cron/billing/monthly?company_id=SYN-COMPANY&billing_month=2026-10', code: 'billing_monthly_automation_failed'},
])('actual $name cron uses constant technical diagnosis and keeps its public trace/status', async row => {
  row.adapter.mockRejectedValue(Object.assign(new Error('SYN_PRIVATE_CUSTOMER_KARIN_SECRET_CANARY'), {code: '23503', details: 'SYN_PRIVATE_DETAILS'}))
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const response = await row.run(request(row.path))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({ok: false, code: row.code, trace_id: expect.any(String)})
    expect(log.mock.calls[0][1]).toEqual({traceId: body.trace_id, error: {code: '23503', message: 'database_error'}})
    expect(JSON.stringify(log.mock.calls)).not.toContain('KARIN')
    expect(JSON.stringify(body)).not.toContain('KARIN')
  } finally {log.mockRestore()}
})
it.each([
  {name: 'retry GET', run: retryGet, method: 'GET', path: '/api/cron/billing/invoice-export-retry'},
  {name: 'retry POST', run: retryPost, method: 'POST', path: '/api/cron/billing/invoice-export-retry'},
  {name: 'monthly GET', run: monthlyGet, method: 'GET', path: '/api/cron/billing/monthly'},
  {name: 'monthly POST', run: monthlyPost, method: 'POST', path: '/api/cron/billing/monthly'},
])('actual $name denies a missing credential before automation or diagnostic logging', async row => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    expect((await row.run(request(row.path, row.method, false))).status).toBe(401)
    expect(fixture.retry).not.toHaveBeenCalled(); expect(fixture.pending).not.toHaveBeenCalled()
    expect(fixture.review).not.toHaveBeenCalled(); expect(fixture.monthly).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled()
  } finally {log.mockRestore()}
})
it('actual retry POST success preserves current selected-company arguments, all three local worker results and approval marker', async () => {
  const response = await retryPost(request('/api/cron/billing/invoice-export-retry?company_id=SYN-COMPANY&limit=25', 'POST'))
  expect(await response.json()).toEqual({ok: true, retries: {sent: 0, skipped: 1}, providerEvents: {processed: 1}, reviewRetries: {processed: 0}, approval_enforced: true})
  expect(fixture.retry).toHaveBeenCalledWith({companyId: 'SYN-COMPANY', limit: 25})
  expect(fixture.pending).toHaveBeenCalledWith({companyId: 'SYN-COMPANY', limit: 200})
  expect(fixture.review).toHaveBeenCalledWith({companyId: 'SYN-COMPANY', limit: 50})
})
it('actual monthly POST success preserves prepare-only approval-required result and current company/month arguments', async () => {
  const response = await monthlyPost(request('/api/cron/billing/monthly?company_id=SYN-COMPANY&billing_month=2026-10', 'POST'))
  expect(await response.json()).toEqual({prepared: 1, mode: 'prepare_only', approval_required: true})
  expect(fixture.monthly).toHaveBeenCalledWith({companyId: 'SYN-COMPANY', billingMonth: '2026-10'})
})
