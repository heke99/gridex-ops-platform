import { supabaseService } from '@/lib/supabase/service'
import type { ParsedMeteringObservation } from '@/lib/ediel/utilts/meteringObservationParser'

export async function storeMeteringValueBatch(input: {
  companyId: string
  meteringPointId: string
  permissionId?: string | null
  utiltsMessageId: string
  observations: ParsedMeteringObservation[]
}) {
  const { data: batch, error: batchError } = await supabaseService
    .from('metering_value_batches')
    .insert({
      company_id: input.companyId,
      metering_point_id: input.meteringPointId,
      permission_id: input.permissionId ?? null,
      utilts_message_id: input.utiltsMessageId,
      status: 'received',
      observation_count: input.observations.length,
    })
    .select('*')
    .single()

  if (batchError) throw batchError

  if (input.observations.length > 0) {
    const { error } = await supabaseService.from('metering_values').insert(
      input.observations.map((observation) => ({
        company_id: input.companyId,
        metering_point_id: input.meteringPointId,
        permission_id: input.permissionId ?? null,
        utilts_message_id: input.utiltsMessageId,
        batch_id: (batch as { id: string }).id,
        timestamp: observation.timestamp,
        period_start: observation.periodStart,
        period_end: observation.periodEnd,
        resolution: observation.measurementResolution,
        measurement_resolution: observation.measurementResolution,
        utilts_subtype: observation.utiltsSubtype,
        quantity: observation.quantity,
        unit: observation.unit,
        status_code: observation.qualityStatus,
        quality_code: observation.qualityStatus,
        register_code: observation.registerCode,
        meter_number: observation.meterNumber,
        source: 'ediel_utilts_e66',
      }))
    )
    if (error) throw error
  }

  return batch
}
