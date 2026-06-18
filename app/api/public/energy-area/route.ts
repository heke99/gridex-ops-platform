import { NextRequest, NextResponse } from 'next/server'
import { publicPriceAreaByPostalCode, normalizePostalCode } from '@/lib/energy/resolver'
import { allowPublicRequest } from '@/lib/http/publicRateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for') ?? ''
  const clientKey = forwarded.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  if (!allowPublicRequest(`energy-area:${clientKey}`, 60, 60_000)) {
    return NextResponse.json({ error: 'För många förfrågningar. Försök igen om en minut.' }, { status: 429, headers: { 'Cache-Control': 'no-store' } })
  }

  const postalCode = request.nextUrl.searchParams.get('postalCode') ?? request.nextUrl.searchParams.get('postal_code')
  if (!normalizePostalCode(postalCode)) {
    return NextResponse.json({ postalCode, priceArea: null, confidence: 0, disclaimer: 'Ange ett svenskt postnummer med fem siffror.' }, { status: 400, headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } })
  }

  const result = await publicPriceAreaByPostalCode(postalCode)
  return NextResponse.json(result, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } })
}
