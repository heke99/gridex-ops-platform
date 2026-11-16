import { supabaseService } from '@/lib/supabase/service'

export async function createForecastAdjustment(input: {
  companyId: string
  forecastRunId: string
  entityType: string
  entityId?: string | null
  adjustmentType: 'percent' | 'kwh' | 'manual_override'
  adjustmentValue: number
  reason?: string | null
  createdBy?: string | null
}) {
  const { data, error } = await supabaseService
    .from('forecast_adjustments')
    .insert({
      company_id: input.companyId,
      forecast_run_id: input.forecastRunId,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      adjustment_type: input.adjustmentType,
      adjustment_value: input.adjustmentValue,
      reason: input.reason ?? null,
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id as string
}
