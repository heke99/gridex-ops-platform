import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/cron/billing/invoice-export-retry/route'

const jobs = vi.hoisted(() => ({
  exportRetries: vi.fn(),
  providerEvents: vi.fn(),
  reviewRetries: vi.fn(),
}))

vi.mock('@/lib/billing/invoiceApprovedDispatch', () => ({
  processDueApprovedInvoiceRetries: jobs.exportRetries,
}))

vi.mock('@/lib/billing/providerEventProcessor', () => ({
  processPendingInvoiceProviderEvents: jobs.providerEvents,
  retryReviewableInvoiceProviderEvents: jobs.reviewRetries,
}))

function request(authorized = true, method = 'GET') {
  return new NextRequest('https://gridex.example.invalid/api/cron/billing/invoice-export-retry?company_id=test-company&limit=17', {
    method,
    headers: authorized ? { Authorization: 'Bearer synthetic-cron-secret' } : {},
  })
}

beforeEach(() => {
  vi.stubEnv('BILLING_AUTOMATION_CRON_SECRET', 'synthetic-cron-secret')
  vi.stubEnv('CRON_SECRET', '')
  jobs.exportRetries.mockReset().mockResolvedValue({ processed: 0, sent: 0, failed: 0 })
  jobs.providerEvents.mockReset().mockResolvedValue({ processed: 0, needsReview: 0, failed: 0, results: [] })
  jobs.reviewRetries.mockReset().mockResolvedValue({ processed: 0, stillNeedsReview: 0, failed: 0, results: [] })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('invoice export cron outcomes', () => {
  it('rejects an unauthenticated request before invoking any job', async () => {
    expect((await GET(request(false))).status).toBe(401)
    expect(jobs.exportRetries).not.toHaveBeenCalled()
    expect(jobs.providerEvents).not.toHaveBeenCalled()
    expect(jobs.reviewRetries).not.toHaveBeenCalled()
  })

  it('reports an idle run as complete and preserves independent scoped job limits', async () => {
    const response = await POST(request(true, 'POST'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true, outcome: 'completed', failed_entries: 0, failed_steps: [],
      retries: { processed: 0, sent: 0, failed: 0 },
      approval_enforced: true,
    })
    expect(jobs.exportRetries).toHaveBeenCalledWith({ companyId: 'test-company', limit: 17 })
    expect(jobs.providerEvents).toHaveBeenCalledWith({ companyId: 'test-company', limit: 200 })
    expect(jobs.reviewRetries).toHaveBeenCalledWith({ companyId: 'test-company', limit: 50 })
  })

  it('preserves provider event work if the independent export queue cannot be read', async () => {
    jobs.exportRetries.mockRejectedValueOnce(new Error('private connection error'))
    jobs.providerEvents.mockResolvedValueOnce({
      processed: 1, needsReview: 0, failed: 1,
      results: [{ eventId: 'event-a', outcome: 'skipped', reason: 'private provider response' }],
    })

    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: false, outcome: 'partial', failed_entries: 1,
      failed_steps: [{ step: 'retries', trace_id: expect.any(String) }],
      retries: null, providerEvents: { processed: 1 }, reviewRetries: { processed: 0 },
    })
    expect(JSON.stringify(body)).not.toContain('private connection error')
    expect(JSON.stringify(body)).not.toContain('private provider response')
    expect(jobs.providerEvents).toHaveBeenCalledBefore(jobs.reviewRetries)
  })

  it('reports partial processing when a job returns both successful and failed entries', async () => {
    jobs.exportRetries.mockResolvedValueOnce({ processed: 3, sent: 2, failed: 1 })

    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: false, outcome: 'partial', failed_entries: 1, failed_steps: [],
      retries: { processed: 3, sent: 2, failed: 1 },
    })
  })

  it('returns a failed HTTP status when every attempted entry failed', async () => {
    jobs.exportRetries.mockResolvedValueOnce({ processed: 1, sent: 0, failed: 1 })
    jobs.providerEvents.mockResolvedValueOnce({
      processed: 0, needsReview: 0, failed: 1,
      results: [{ eventId: 'event-a', outcome: 'skipped', reason: 'private processing trace' }],
    })
    jobs.reviewRetries.mockResolvedValueOnce({
      processed: 0, stillNeedsReview: 0, failed: 1,
      results: [{ eventId: 'event-b', outcome: 'skipped', reason: 'private retry trace' }],
    })

    const response = await GET(request())
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: false, outcome: 'blocked', code: 'invoice_export_retry_cron_failed',
      failed_entries: 3, failed_steps: [], approval_enforced: true,
    })
    expect(JSON.stringify(body)).not.toContain('private')
  })
})
