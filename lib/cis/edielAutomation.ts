// lib/cis/edielAutomation.ts

import { supabaseService } from '@/lib/supabase/service'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import { prepareAndQueueUtiltsE73 } from '@/lib/ediel/orchestrator'

export type QueueUtiltsFromDataRequestInput = {
  actorUserId: string
  dataRequestId: string
  // E66 is retained in the input union temporarily so legacy callers fail with
  // a deterministic domain error instead of silently changing behaviour.
  // A supplier-side data request may only originate E73 here.
  utiltsCode: 'E66' | 'E73'
  communicationRouteId?: string | null
  quantity?: number | null
  periodStart?: string | null
  periodEnd?: string | null
  registrationTime?: string | null
}

async function getGridOwnerDataRequestById(
  dataRequestId: string
): Promise<GridOwnerDataRequestRow | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('id', dataRequestId)
    .maybeSingle()

  if (error) throw error
  return (data as GridOwnerDataRequestRow | null) ?? null
}

export async function ensureAndPrepareUtiltsFromDataRequest(
  input: QueueUtiltsFromDataRequestInput
) {
  const row = await getGridOwnerDataRequestById(input.dataRequestId)
  if (!row) {
    throw new Error('Grid owner data request hittades inte')
  }

  // E66 is validated metering data sent by the metering-data responsible actor.
  // It is not a supplier request. Failing before an outbound row is created is
  // important: otherwise a wrong business object survives even if rendering is
  // later blocked.
  if (input.utiltsCode === 'E66') {
    throw new Error(
      'UTILTS E66 är en mätvärdesleverans och får inte skapas som outbound data request från Gridex supplier-flöde. Använd E73 för en legitim begäran om saknade validerade mätvärden när bilateral UTILTS-route är tillåten.',
    )
  }

  // E73 qualifies the actor, route and delivery period before handling its
  // outbound request.
  return prepareAndQueueUtiltsE73({
    actorUserId: input.actorUserId,
    gridOwnerDataRequestId: row.id,
    communicationRouteId: input.communicationRouteId ?? null,
  })
}
