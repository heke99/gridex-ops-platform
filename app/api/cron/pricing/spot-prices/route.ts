import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { importSpotPricesForDay } from '@/lib/pricing/spot/spotPriceImporter'
import { normalizeSpotAutoImportAreas } from '@/lib/pricing/spot/spotImportScheduler'
import {
  currentStockholmCalendarDate,
  nextStockholmCalendarDate,
  previousStockholmCalendarDate,
  stockholmHourForInstant,
  strictIsoDate,
} from '@/lib/time/stockholm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const expected = [process.env.PRICING_CRON_SECRET, process.env.CRON_SECRET]
    .map((value) => (typeof value === 'string' && value.trim() ? value.trim() : null))
    .filter((value): value is string => Boolean(value))
  if (expected.length === 0) return false

  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice('bearer '.length).trim()
    : (request.headers.get('x-cron-secret') ?? '').trim()
  if (!token) return false

  return expected.some((secret) => {
    const left = Buffer.from(token)
    const right = Buffer.from(secret)
    return left.length === right.length && timingSafeEqual(left, right)
  })
}

function parseForce(request: NextRequest): boolean {
  const debugAllowed = request.headers.get('x-gridex-internal-debug') === 'true'
  if (!debugAllowed) return false
  return ['1', 'true', 'yes'].includes((request.nextUrl.searchParams.get('force') ?? '').toLowerCase())
}

function shouldIncludeNextDay(request: NextRequest, now: Date): boolean {
  const explicit = request.nextUrl.searchParams.get('include_next') ?? request.nextUrl.searchParams.get('includeNext')
  if (explicit !== null) return ['1', 'true', 'yes'].includes(explicit.toLowerCase())
  return stockholmHourForInstant(now) >= 13
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (request.nextUrl.searchParams.get('company_id') || request.nextUrl.searchParams.get('companyId')) {
    return NextResponse.json({ ok: false, error: 'company_id får inte skickas till spotpris-cron. Spotpris är global marknadsdata per elområde.' }, { status: 400 })
  }

  try {
    const requestedDate = request.nextUrl.searchParams.get('calendar_date') ?? request.nextUrl.searchParams.get('calendarDate')
    const priceAreas = normalizeSpotAutoImportAreas(request.nextUrl.searchParams.get('price_areas') ?? request.nextUrl.searchParams.get('priceAreas'))
    const force = parseForce(request)
    const now = new Date()
    const dates = requestedDate
      ? [strictIsoDate(requestedDate, 'calendar_date')]
      : [
          previousStockholmCalendarDate(now),
          currentStockholmCalendarDate(now),
          ...(shouldIncludeNextDay(request, now) ? [nextStockholmCalendarDate(now)] : []),
        ]

    const results = []
    for (const calendarDate of dates) {
      const currentDay = calendarDate === currentStockholmCalendarDate(now)
      const nextDay = calendarDate === nextStockholmCalendarDate(now)
      results.push(await importSpotPricesForDay({
        calendarDate,
        priceAreas,
        // Current and next day are refreshed so source_as_of represents real
        // provider evidence rather than a preview recalculation timestamp.
        force: force || currentDay || nextDay,
      }))
    }

    return NextResponse.json({
      ok: true,
      mode: 'preview',
      calendar_dates: dates,
      result: results,
    })
  } catch (error) {
    return internalApiError({ context: 'spot_price_preview_cron_failed', error, code: 'spot_price_preview_cron_failed', message: 'Previewimporten av spotpris kunde inte slutföras.' })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
