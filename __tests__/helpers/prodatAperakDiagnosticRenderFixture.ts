import type { buildAperakDraft } from '@/lib/ediel/ack'
import { renderAperakEdiel } from '@/lib/ediel/aperakEngine'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'

/** Read-only probe of the actual renderer and technical envelope codec.
 * This intentionally does not call or replace the full send preflight. A
 * successful diagnostic render is no evidence that an ACK can be created:
 * each caller separately tests the actual buildAperakDraft refusal. */
export function renderProdatAperakDiagnosticRaw(params: Parameters<typeof buildAperakDraft>[0]): string {
  const message = params.sourceMessage
  const rendered = renderAperakEdiel({
    source: {
      id: message.id,
      rawPayload: message.raw_payload,
      messageFamily: message.message_family,
      messageCode: message.message_code,
      senderEdielId: message.sender_ediel_id,
      receiverEdielId: message.receiver_ediel_id,
      externalReference: message.external_reference,
      messageReceivedAt: message.message_received_at,
      createdAt: message.created_at,
    },
    refs: {},
    externalReference: 'DIAGNOSTIC',
    transactionReference: 'DIAGNOSTIC',
    outcome: params.outcome ?? 'positive',
    messageText: params.messageText,
    applicationErrors: params.applicationErrors,
  })
  return EdifactEnvelopeCodec.encode({
    sender: message.receiver_ediel_id!,
    receiver: message.sender_ediel_id!,
    interchangeReference: 'DIAGNOSTIC',
    acknowledgementRequest: false,
    environment: 'test',
    createdAt: new Date('2026-10-01T12:00:00Z'),
    messages: [{ messageReference: 'DIAGNOSTIC', messageTypeToken: 'APERAK:D:96A:UN:E2SE6A', businessSegments: rendered.segments }],
  })
}
