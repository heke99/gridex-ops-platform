import { NextRequest, NextResponse } from 'next/server'
import { handleBusinessPartnerApi } from '@/lib/partner-api/business'
import { partnerPublicOpenApi } from '@/lib/partner-api/businessOpenApi'
import { handleCanonicalPartnerApi } from '@/lib/partner-api/canonical'
import { handlePartnerApi } from '@/lib/partner-api/core'
import { PARTNER_API_VERSION } from '@/lib/partner-api/openApi'
import { handleSimplePartnerApi } from '@/lib/partner-api/simple'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ path?: string[] }> }

async function dispatch(
  request: NextRequest,
  method: 'GET' | 'POST' | 'DELETE',
  context: RouteContext,
) {
  const { path } = await context.params
  const segments = (path ?? []).filter(Boolean)

  if (method === 'GET' && segments.length === 1 && segments[0] === 'openapi.json') {
    return NextResponse.json(partnerPublicOpenApi, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'X-Gridex-API-Version': PARTNER_API_VERSION,
      },
    })
  }

  const business = await handleBusinessPartnerApi(request, method, path)
  if (business) return business

  const simple = await handleSimplePartnerApi(request, method, path)
  if (simple) return simple

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
