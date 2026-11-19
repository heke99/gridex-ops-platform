import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/cron/pricing/spot-prices/route'

const importSpotPricesForDay = vi.hoisted(() => vi.fn())
vi.mock('@/lib/pricing/spot/spotPriceImporter', () => ({ importSpotPricesForDay }))

const cronSecret = 'synthetic-spot-cron-secret'
const today = '2026-03-29'
const handlers = { GET, POST }

function request(parameters: Record<string, string>, method: keyof typeof handlers, authorized = true) {
  const url = new URL('https://synthetic.invalid/api/cron/pricing/spot-prices')
  url.search = new URLSearchParams({ price_areas: 'SE3', ...parameters }).toString()
  return new NextRequest(url, {
    method,
    headers: authorized ? { authorization: `Bearer ${cronSecret}` } : undefined,
  })
}

beforeEach(() => {
  vi.stubEnv('PRICING_CRON_SECRET', cronSecret)
  vi.stubEnv('CRON_SECRET', '')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-29T12:15:00Z'))
  importSpotPricesForDay.mockReset().mockImplementation(async ({ calendarDate }: { calendarDate: string }) => ({
    calendarDate, status: 'completed', result: { SE3: { imported: 0, status: 'verified' } }, errors: [],
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('scheduled spot price date validation', () => {
  it.each([
    ['GET', 'calendar_date', '2026-02-30'],
    ['POST', 'calendarDate', '2026-04-31'],
    ['POST', 'calendar_date', 'synthetic-invalid-date-input'],
  ] as const)('rejects invalid %s %s=%s before the import', async (method, field, value) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await handlers[method](request({ [field]: value }, method))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      code: 'invalid_calendar_date',
      error: 'calendar_date måste vara ett giltigt datum i formatet YYYY-MM-DD.',
      trace_id: expect.stringMatching(/^[a-f0-9-]{36}$/i),
    })
    expect(errorLog).toHaveBeenCalledWith('[spot_price_preview_cron_invalid_calendar_date] failed', expect.objectContaining({
      traceId: body.trace_id,
    }))
    expect(JSON.stringify([body, errorLog.mock.calls])).not.toContain(value)
    expect(importSpotPricesForDay).not.toHaveBeenCalled()
  })

  it.each([
    ['calendar_date', '2028-02-29', '2028-02-29'],
    ['calendarDate', '2026-10-25', '2026-10-25'],
    ['calendar_date', ' 2026-03-29 ', '2026-03-29'],
  ])('retains the supported %s date %s', async (field, value, calendarDate) => {
    const response = await POST(request({ [field]: value }, 'POST'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, mode: 'preview', calendar_dates: [calendarDate] })
    expect(importSpotPricesForDay).toHaveBeenCalledExactlyOnceWith({
      calendarDate, priceAreas: ['SE3'], force: calendarDate === today,
    })
  })

  it('retains the default Stockholm dates and refresh policy', async () => {
    const response = await GET(request({}, 'GET'))
    expect(response.status).toBe(200)
    const dates = ['2026-03-28', today, '2026-03-30']
    expect(await response.json()).toMatchObject({ ok: true, calendar_dates: dates })
    expect(importSpotPricesForDay.mock.calls).toEqual(dates.map(calendarDate => [{
      calendarDate, priceAreas: ['SE3'], force: true,
    }]))
  })

  it('checks authorization before validating an invalid date', async () => {
    const response = await GET(request({ calendar_date: '2026-02-30' }, 'GET', false))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false, error: 'Unauthorized' })
    expect(importSpotPricesForDay).not.toHaveBeenCalled()
  })

  it('keeps a genuine import failure at 500 with sanitized diagnostics and the matching trace ID', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    importSpotPricesForDay.mockRejectedValueOnce(new Error('Provider rejected Bearer synthetic-provider-token'))
    const response = await POST(request({ calendar_date: today }, 'POST'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      code: 'spot_price_preview_cron_failed',
      error: 'Previewimporten av spotpris kunde inte slutföras.',
      trace_id: expect.stringMatching(/^[a-f0-9-]{36}$/i),
    })
    expect(errorLog).toHaveBeenCalledWith('[spot_price_preview_cron_failed] failed', expect.objectContaining({
      traceId: body.trace_id,
      error: 'Provider rejected Bearer [REDACTED]',
    }))
    expect(JSON.stringify([body, errorLog.mock.calls])).not.toContain('synthetic-provider-token')
  })
})
