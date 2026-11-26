import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiAccess, requireAdminOperationalCompany } from '@/lib/admin/apiGuards'
import {
  findSingleE66RequalificationSelection, singleE66SelectionQuery,
} from '@/lib/billing/singleE66RequalificationSelection'
import { errorCode, internalApiError } from '@/lib/http/apiError'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const requalificationPermission = { allOf: ['metering.write', 'billing_underlay.write'] }
const requalificationRpc = 'gridex_requalify_planned_move_out_metering_value_v1'
const requalificationRequest = z.strictObject({
  normalizedValueId: z.string().uuid().transform(id => id.toLowerCase()),
  environment: z.enum(['test', 'production']),
})
const requalificationResult = z.object({
  normalizedValueId: z.string().uuid().transform(id => id.toLowerCase()),
  replayed: z.boolean(),
  receipt: z.object({
    contractId: z.string().uuid(),
    eventId: z.string().uuid(),
    effectiveDate: z.string().date(),
    cutoffAt: z.string().datetime({ offset: true }),
    recordedAt: z.string().datetime({ offset: true }),
  }),
})

type RequalificationScope = {
  p_company_id: string
  p_actor_user_id: string
  p_environment: 'test' | 'production'
  p_normalized_value_id: string
}

const closeNeedsReview = new Set([
  'planned_move_out_requalification_close_scope_mismatch',
  'planned_move_out_requalification_receipt_required',
])

export async function GET(request: Request) {
  const access = await requireAdminApiAccess(requalificationPermission)
  if (access.response) return access.response
  if (!access.guard.companyId) {
    return NextResponse.json({ error: 'Välj bolag för omkvalificeringen.' }, { status: 403 })
  }

  const query = new URL(request.url).searchParams
  const selection = singleE66SelectionQuery.safeParse(Object.fromEntries(query))
  if (query.size !== 4 || !selection.success) {
    return NextResponse.json({ error: 'Ange en mätpunkt, ett exakt intervall med tidszon och Edielmiljö.' }, { status: 400 })
  }

  try {
    const companyId = await requireAdminOperationalCompany(access.guard)
    const result = await findSingleE66RequalificationSelection(companyId, selection.data)
    const headers = { 'Cache-Control': 'no-store' }
    switch (result.status) {
      case 'found':
        return NextResponse.json({ data: result.value }, { headers })
      case 'missing':
        return NextResponse.json({ error: 'Inget valbart mätvärde hittades för detta intervall och denna Edielmiljö.' }, { status: 404, headers })
      case 'ambiguous':
        return NextResponse.json({ error: 'Flera mätvärden motsvarar valet. Kontrollera källan före omprövning.' }, { status: 409, headers })
      case 'unverified':
        return NextResponse.json({ error: 'Mätvärdets aktuella E66-källa behöver granskas.' }, { status: 409, headers })
    }
  } catch (error) {
    return internalApiError({
      context: 'billing-find-single-e66',
      error,
      code: 'single_e66_billing_selection_failed',
      message: 'Mätvärdet kunde inte kontrolleras.',
    })
  }
}

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(requalificationPermission)
  if (access.response) return access.response
  if (!access.guard.companyId) {
    return NextResponse.json({ error: 'Välj bolag för omkvalificeringen.' }, { status: 403 })
  }

  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return NextResponse.json({ error: 'Omprövningen kräver JSON.' }, { status: 415 })
  }
  const body = requalificationRequest.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'Ange mätvärdets normaliserade ID och Edielmiljö.' }, { status: 400 })
  }

  try {
    const companyId = await requireAdminOperationalCompany(access.guard)
    const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (
      name: typeof requalificationRpc, args: RequalificationScope
    ) => PromiseLike<{ data: unknown; error: { code: string; message: string } | null }>
    const result = await rpc(requalificationRpc, {
      p_company_id: companyId,
      p_actor_user_id: access.guard.userId,
      p_environment: body.data.environment,
      p_normalized_value_id: body.data.normalizedValueId,
    })
    if (result.error) throw result.error

    const value = requalificationResult.safeParse(result.data)
    if (!value.success || value.data.normalizedValueId !== body.data.normalizedValueId) {
      throw new Error('planned_move_out_requalification_invalid_result')
    }

    return NextResponse.json({
      data: { normalizedValueId: value.data.normalizedValueId, replayed: value.data.replayed },
    })
  } catch (error) {
    const code = errorCode(error)
    const message = (error as { message?: unknown } | null)?.message
    if (code === '42501' &&
        (message === 'planned_move_out_requalification_forbidden' || message === 'utilts_execution_actor_forbidden')) {
      return NextResponse.json({ error: 'Du saknar behörighet för omkvalificering av mätvärdet.' }, { status: 403 })
    }
    if (code === '22023' && message === 'planned_move_out_requalification_scope_required') {
      return NextResponse.json({ error: 'Mätvärdets ID eller Edielmiljö är ogiltig.' }, { status: 400 })
    }
    if (code === '23514' && message === 'planned_move_out_requalification_value_scope_mismatch') {
      return NextResponse.json({ error: 'Ett valbart mätvärde kunde inte hittas inom valt bolag och vald Edielmiljö.' }, { status: 404 })
    }
    if (code === '40001' &&
        (message === 'billing_source_discovery_changed' || message === 'billing_supply_discovery_changed')) {
      return NextResponse.json({ error: 'Underlaget ändrades under kontrollen. Läs om mätvärdet och försök igen.' }, { status: 409 })
    }
    if (code === '23514' && typeof message === 'string' && closeNeedsReview.has(message)) {
      return NextResponse.json({ error: 'Mätvärdets källunderlag eller registrerade utflyttning behöver granskas.' }, { status: 409 })
    }
    return internalApiError({
      context: 'billing-requalify-single-e66',
      error,
      code: 'single_e66_billing_requalification_failed',
      message: 'Mätvärdet kunde inte omkvalificeras för fakturering.',
      status: code === 'PGRST202' && typeof message === 'string' &&
        message.includes(`public.${requalificationRpc}`) ? 503 : 500,
    })
  }
}
