import type { EdielMessageRow } from '@/lib/ediel/types'
import { createEdielMessageEvent, updateEdielMessageStatus } from '@/lib/ediel/db'
import { recordEdielExchangeLog } from '@/lib/ediel/operations/exchangeLog'

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function isProductionShadowMessage(message: EdielMessageRow): boolean {
  const report = objectValue(message.validation_report)
  return (
    message.environment === 'production' &&
    (
      report.productionMode === 'shadow' ||
      report.production_mode === 'shadow'
    )
  )
}

export async function markProductionShadowPrepared(input: {
  actorUserId: string
  message: EdielMessageRow
  reason?: string | null
}) {
  await createEdielMessageEvent({
    actorUserId: input.actorUserId,
    edielMessageId: input.message.id,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message: input.reason ?? 'Production shadow mode: EDIFACT byggdes och validerades men skickades inte.',
    payload: {
      productionMode: 'shadow',
      rawPayloadStored: Boolean(input.message.raw_payload),
    },
  })

  await recordEdielExchangeLog({
    companyId: input.message.company_id ?? null,
    environmentType: 'production',
    edielMessageId: input.message.id,
    routeProfileId: input.message.communication_route_id ?? null,
    direction: 'outbound',
    exchangeKind: 'production_shadow',
    rawPayload: input.message.raw_payload ?? null,
    senderEdielId: input.message.sender_ediel_id ?? null,
    receiverEdielId: input.message.receiver_ediel_id ?? null,
    interchangeReference: input.message.interchange_reference ?? null,
    messageReference: input.message.message_reference ?? null,
    messageType: input.message.message_family ?? null,
    businessCode: input.message.message_code ?? null,
    metadata: {
      productionMode: 'shadow',
      skippedSmtpDelivery: true,
    },
    actorUserId: input.actorUserId,
  })

  await updateEdielMessageStatus({
    actorUserId: input.actorUserId,
    edielMessageId: input.message.id,
    status: 'prepared',
    validationReport: {
      ...(input.message.validation_report ?? {}),
      productionMode: 'shadow',
      shadowPreparedAt: new Date().toISOString(),
    },
  })
}
