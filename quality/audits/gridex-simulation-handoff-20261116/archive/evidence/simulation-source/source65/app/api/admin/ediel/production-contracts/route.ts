import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { internalApiError } from '@/lib/http/apiError'
import { prepareAndQueueProductionContractZ09 } from '@/lib/ediel/flows/prodatProductionContract'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
export async function POST(request: NextRequest) {
  const access = await requireAdminApiAccess({ allOf: ['communication.write', 'communication.send'] })
  if (access.response) return access.response
  if (!access.guard.companyId) return NextResponse.json({ error: 'Aktuellt bolag krävs.' }, { status: 403 })
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Ogiltigt kommando.' }, { status: 400 })
  const input = body as Record<string, unknown>
  if (Object.keys(input).some(k => !['eventId', 'preferredRouteId'].includes(k)) || !uuid(input.eventId) || (input.preferredRouteId !== undefined && !uuid(input.preferredRouteId))) return NextResponse.json({ error: 'Ett autentiskt produktionsavtals-id krävs.' }, { status: 400 })
  try {
    const result = await prepareAndQueueProductionContractZ09({ companyId: access.guard.companyId, actorUserId: access.guard.userId, eventId: input.eventId, preferredRouteId: input.preferredRouteId })
    return NextResponse.json({ result }, { status: result.status === 'held' ? 409 : 200 })
  } catch (error) {
    return internalApiError({ context: 'ediel-production-contract', error, code: 'ediel_production_contract_failed', message: 'Produktionsavtalets Ediel-kommando kunde inte förberedas.' })
  }
}
