import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { readBeneficiaryExport } from '@/lib/ediel/services/beneficiaryExport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(_request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const access = await requireAdminApiAccess(['metering.read'])
  if (access.response) return access.response
  if (!access.guard.companyId) return NextResponse.json({ error: 'Välj ett behörigt bolag.' }, { status: 403, headers })
  try {
    const { jobId } = await context.params
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return NextResponse.json({ error: 'Ogiltigt export-ID.' }, { status: 400, headers })
    return NextResponse.json(await readBeneficiaryExport({ beneficiaryCompanyId: access.guard.companyId, actorUserId: access.guard.userId, jobId }), { headers })
  } catch {
    return NextResponse.json({ error: 'Exporten kunde inte auktoriseras eller läsas.' }, { status: 403, headers })
  }
}
