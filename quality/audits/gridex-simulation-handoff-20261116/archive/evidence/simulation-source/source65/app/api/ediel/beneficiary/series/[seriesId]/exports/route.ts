import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { queueBeneficiaryExport } from '@/lib/ediel/services/beneficiaryExport'
import { EdielProjectionQueryError, parseEdielProjectionRequest } from '@/lib/ediel/services/projectionRequest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

/** Queues one scoped page; the completed page retains its next position. */
export async function POST(request: NextRequest, context: { params: Promise<{ seriesId: string }> }) {
  const access = await requireAdminApiAccess(['metering.read'])
  if (access.response) return access.response
  if (!access.guard.companyId) return NextResponse.json({ error: 'Välj ett behörigt bolag.' }, { status: 403, headers })
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
      !('idempotencyKey' in body) || typeof body.idempotencyKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.idempotencyKey)) {
      return NextResponse.json({ error: 'Ogiltig exportförfrågan.' }, { status: 400, headers })
    }
    const { seriesId } = await context.params
    const input = parseEdielProjectionRequest({ query: request.nextUrl.searchParams, seriesId,
      companyId: access.guard.companyId, actorUserId: access.guard.userId })
    if ((input.limit ?? 100) > 500) return NextResponse.json({ error: 'Exporten kan omfatta högst 500 värden per sida.' }, { status: 400, headers })
    return NextResponse.json(await queueBeneficiaryExport(input, body.idempotencyKey), { status: 202, headers })
  } catch (error) {
    if (error instanceof EdielProjectionQueryError || error instanceof SyntaxError) return NextResponse.json({ error: 'Ogiltig exportförfrågan.' }, { status: 400, headers })
    return NextResponse.json({ error: 'Exporten kunde inte auktoriseras eller köläggas.' }, { status: 403, headers })
  }
}
