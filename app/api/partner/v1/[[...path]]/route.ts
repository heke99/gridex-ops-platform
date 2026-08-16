import { NextRequest } from 'next/server'
import { handleCanonicalPartnerApi } from '@/lib/partner-api/canonical'
import { handlePartnerApi } from '@/lib/partner-api/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ path?: string[] }> }

async function dispatch(
  request: NextRequest,
  method: 'GET' | 'POST' | 'DELETE',
  context: RouteContext,
) {
  const { path } = await context.params
  const canonical = await handleCanonicalPartnerApi(request, method, path)
  return canonical ?? handlePartnerApi(request, method, path)
}

export async function GET(request: NextRequest, context: RouteContext) {
  return dispatch(request, 'GET', context)
}

export async function POST(request: NextRequest, context: RouteContext) {
  return dispatch(request, 'POST', context)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return dispatch(request, 'DELETE', context)
}
