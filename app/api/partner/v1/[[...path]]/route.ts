import { NextRequest } from 'next/server'
import { handlePartnerApi } from '@/lib/partner-api/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ path?: string[] }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params
  return handlePartnerApi(request, 'GET', path)
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params
  return handlePartnerApi(request, 'POST', path)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { path } = await context.params
  return handlePartnerApi(request, 'DELETE', path)
}
