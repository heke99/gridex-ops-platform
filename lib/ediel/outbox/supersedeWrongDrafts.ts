import type { AckFamily, AckOutcome } from '@/lib/ediel/core/ackPolicy'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { createEdielMessageEvent, listAckMessagesForSource } from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'

const REPLACEABLE = new Set(['draft', 'prepared', 'queued', 'failed'])
const FINAL = new Set(['sent', 'acknowledged', 'validated'])

function isOppositeAck(row: EdielMessageRow, family: AckFamily, desiredOutcome?: AckOutcome | null): boolean {
  if (row.message_family !== family) return false
  if (family === 'UTILTS_ERR') return false
  if (!desiredOutcome) return false
  return row.ack_outcome === 'positive' || row.ack_outcome === 'negative'
    ? row.ack_outcome !== desiredOutcome
    : false
}

export async function supersedeWrongDraftsForDecision(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  desiredFamily: AckFamily
  desiredOutcome?: AckOutcome | null
}): Promise<{ supersededIds: string[]; blockedFinalAckId: string | null }> {
  const existing = await listAckMessagesForSource({ sourceMessageId: params.sourceMessage.id })
  const opposite = existing.filter((row) => isOppositeAck(row, params.desiredFamily, params.desiredOutcome))
  const finalConflict = opposite.find((row) => FINAL.has(String(row.status ?? '').toLowerCase()))

  if (finalConflict) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.sourceMessage.id,
      eventType: 'manual_note',
      eventStatus: 'error',
      message: 'Final ACK med motsatt outcome finns redan. Automation blockerades.',
      payload: {
        reason: 'blocked_final_ack_exists',
        desiredFamily: params.desiredFamily,
        desiredOutcome: params.desiredOutcome,
        conflictingAckId: finalConflict.id,
        conflictingOutcome: finalConflict.ack_outcome,
      },
    })
    return { supersededIds: [], blockedFinalAckId: finalConflict.id }
  }

  const replaceable = opposite.filter((row) => REPLACEABLE.has(String(row.status ?? '').toLowerCase()))
  if (replaceable.length === 0) return { supersededIds: [], blockedFinalAckId: null }

  const ids = replaceable.map((row) => row.id)
  const { error } = await supabaseService
    .from('ediel_messages')
    .update({
      status: 'cancelled',
      processing_status: 'superseded',
      failure_reason: 'Superseded because backend decision selected the opposite ACK outcome.',
      updated_by: params.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (error) throw error

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessage.id,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message: 'Felaktiga draft/prepared/queued ACKs ersattes av aktuell backend decision.',
    payload: {
      reason: 'supersede_wrong_drafts',
      supersededAckIds: ids,
      desiredFamily: params.desiredFamily,
      desiredOutcome: params.desiredOutcome,
    },
  })

  return { supersededIds: ids, blockedFinalAckId: null }
}
