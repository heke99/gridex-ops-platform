import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { projectEdielSeriesToBeneficiary } from '@/lib/ediel/services/projection'
import { createEdielProjectionCursor, EdielProjectionQueryError, parseEdielProjectionRequest } from '@/lib/ediel/services/projectionRequest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest, context: { params: Promise<{ seriesId: string }> }) {
  const access = await requireAdminApiAccess(['metering.read'])
  if (access.response) return access.response
  if (!access.guard.companyId) return NextResponse.json({ error: 'Välj ett behörigt bolag.' }, { status: 403, headers })
  try {
    const { seriesId } = await context.params
    const input = parseEdielProjectionRequest({ query: request.nextUrl.searchParams, seriesId,
      companyId: access.guard.companyId, actorUserId: access.guard.userId })
    // SQL rechecks active tenant membership, current versioned grant, owner
    // authority, source permission, purpose, fields and exact time window.
    const page = await projectEdielSeriesToBeneficiary(input)
    if (page.grantId !== input.grantId || page.grantVersion !== input.expectedGrantVersion || page.seriesId !== input.seriesId) throw new Error('ediel_projection_scope_mismatch')
    return NextResponse.json({ ...page, next: createEdielProjectionCursor(input, page.next) }, { headers })
  } catch (error) {
    if (error instanceof EdielProjectionQueryError) return NextResponse.json({ error: error.message }, { status: 400, headers })
    // No owner/source/raw diagnostic data escapes a rejected scoped read.
    return NextResponse.json({ error: 'Projekteringen kunde inte auktoriseras eller läsas.' }, { status: 403, headers })
  }
}
