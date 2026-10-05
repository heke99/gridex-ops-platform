import { supabaseService } from '@/lib/supabase/service'

export type Z01ResponseSlaWatchdogResult = {
  scanned: number
  contrl_overdue: number
  business_response_overdue: number
  automatic_resends: number
  available: boolean
}

function schemaCompatibilityError(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null
  return ['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(row?.code ?? '')
    || /does not exist|schema cache|function .* not found/i.test(row?.message ?? '')
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function runZ01ResponseSlaWatchdog(input?: {
  limit?: number
}): Promise<Z01ResponseSlaWatchdogResult> {
  const limit = Math.min(Math.max(Math.floor(input?.limit ?? 100), 1), 500)
  const { data, error } = await supabaseService.rpc('gridex_escalate_overdue_z01_responses', {
    p_limit: limit,
  })

  if (error) {
    if (schemaCompatibilityError(error)) {
      return {
        scanned: 0,
        contrl_overdue: 0,
        business_response_overdue: 0,
        automatic_resends: 0,
        available: false,
      }
    }
    throw error
  }

  const row = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {}

  return {
    scanned: numberValue(row.scanned),
    contrl_overdue: numberValue(row.contrl_overdue),
    business_response_overdue: numberValue(row.business_response_overdue),
    automatic_resends: numberValue(row.automatic_resends),
    available: true,
  }
}
