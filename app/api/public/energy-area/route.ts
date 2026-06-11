import { NextRequest, NextResponse } from 'next/server'
import { publicPriceAreaByPostalCode } from '@/lib/energy/resolver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const result = await publicPriceAreaByPostalCode(request.nextUrl.searchParams.get('postalCode') ?? request.nextUrl.searchParams.get('postal_code'))
  return NextResponse.json(result)
}
