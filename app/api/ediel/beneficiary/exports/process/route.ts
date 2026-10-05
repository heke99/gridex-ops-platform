import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { runBeneficiaryExports } from '@/lib/ediel/services/beneficiaryExport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

export async function POST(_request: NextRequest) {
  void _request
  const access = await requireAdminApiAccess(['metering.read'])
  if (access.response) return access.response
  if (!access.guard.companyId) return NextResponse.json({ error: 'Välj ett behörigt bolag.' }, { status: 403, headers })
  try {
    return NextResponse.json(await runBeneficiaryExports({ beneficiaryCompanyId: access.guard.companyId, actorUserId: access.guard.userId }), { headers })
  } catch {
    return NextResponse.json({ error: 'Exportjobben kunde inte köras.' }, { status: 503, headers })
  }
}
