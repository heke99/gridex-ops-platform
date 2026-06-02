import { sendQueuedEdielMessage } from '@/lib/ediel/orchestrator'

export type EdielOutboundQueueStatus =
  | 'queued'
  | 'preparing'
  | 'validated'
  | 'locked_for_send'
  | 'sent'
  | 'waiting_for_ack'
  | 'ack_positive'
  | 'ack_negative'
  | 'failed'
  | 'manual_review'

export async function sendQueuedOutboundItem(params: {
  actorUserId: string
  edielMessageId: string
}) {
  return sendQueuedEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: params.edielMessageId,
  })
}
