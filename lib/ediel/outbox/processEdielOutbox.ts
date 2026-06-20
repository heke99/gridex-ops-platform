import { claimEdielOutboxItems } from '@/lib/ediel/outbox/claimOutboxItems'
import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'

export async function processEdielOutbox(params: {
  actorUserId: string
  companyId?: string | null
  limit?: number
  environment?: 'test' | 'production' | string | null
}): Promise<{ processed: number; sent: number; failed: number; blocked: number; deliveryUncertain: number; results: Array<Record<string, unknown>> }> {
  const workerId = `ediel-outbox-${params.actorUserId}-${Date.now()}`
  const items = await claimEdielOutboxItems({
    workerId,
    companyId: params.companyId ?? null,
    environment: params.environment ?? null,
    limit: params.limit ?? 25,
  })

  const results: Array<Record<string, unknown>> = []
  for (const item of items) {
    const result = await sendOutboxItem({
      actorUserId: params.actorUserId,
      outboxItemId: item.id,
      workerId,
      sendAttemptId: item.current_send_attempt_id ?? null,
      alreadyClaimed: true,
    })
    results.push({ id: item.id, ...result })
  }

  return {
    processed: results.length,
    sent: results.filter((item) => item.status === 'sent').length,
    failed: results.filter((item) => item.status === 'failed').length,
    blocked: results.filter((item) => item.status === 'blocked').length,
    deliveryUncertain: results.filter((item) => item.status === 'delivery_uncertain').length,
    results,
  }
}
