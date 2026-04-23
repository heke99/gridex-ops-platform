// lib/ediel/flows/inboundProcessing.ts

import { createEdielMessageEvent, getEdielMessageById, listAckMessagesForSource } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  ACTIVE_EDIEL_MESSAGE_FAMILIES,
  isActiveEdielMessageFamily,
} from '@/lib/ediel/types'
import { pollEdielMailboxViaImap } from '@/lib/ediel/transport'
import { ensureActorUserId } from '@/lib/ediel/flows/shared'
import {
  createSupplierSwitchEvent,
  updateSupplierSwitchRequestStatus,
} from '@/lib/operations/db'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  findMatchingSupplierSwitchRequest,
  matchMeteringPointForEdielMessage,
  matchSiteAndCustomerForMeteringPoint,
} from '@/lib/ediel/matching'
import { linkEdielMessage, updateEdielMessageStatus } from '@/lib/ediel/db'
import { buildContrlDraft, buildAperakDraft, buildUtiltsErrDraft, getAutomaticAckPolicy, getCanonicalAckState } from '@/lib/ediel/ack'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest'

function shouldProcessInboundMessage(message: EdielMessageRow): boolean {
  return (
    isActiveEdielMessageFamily(message.message_family) &&
    message.direction === 'inbound' &&
    message.message_standard === 'edifact'
  )
}

async function createAckIfMissing(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  messageText?: string | null
}) {
  const draft =
    params.ackFamily === 'CONTRL'
      ? buildContrlDraft({
          actorUserId: params.actorUserId,
          sourceMessage: params.sourceMessage,
          outcome: params.outcome ?? 'positive',
          messageText: params.messageText ?? null,
        })
      : params.ackFamily === 'APERAK'
        ? buildAperakDraft({
            actorUserId: params.actorUserId,
            sourceMessage: params.sourceMessage,
            outcome: params.outcome ?? 'positive',
            messageText: params.messageText ?? null,
          })
        : buildUtiltsErrDraft({
            actorUserId: params.actorUserId,
            sourceMessage: params.sourceMessage,
            messageText: params.messageText ?? null,
          })

  return createCanonicalAckMessage({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
    draft,
  })
}

async function readCanonicalAckSnapshot(sourceMessageId: string) {
  const source = await getEdielMessageById(sourceMessageId)
  const ackMessages = await listAckMessagesForSource({ sourceMessageId })

  return {
    canonicalAckState: source ? getCanonicalAckState(source) : null,
    ackMessages: ackMessages.map((row) => ({
      id: row.id,
      family: row.message_family,
      code: row.message_code,
      status: row.status,
      functionalCheckStatus: row.functional_check_status,
      syntaxCheckStatus: row.syntax_check_status,
    })),
  }
}

async function createAutomaticPositiveAcks(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
}) {
  const createdIds: string[] = []
  const policy = await getAutomaticAckPolicy(params.sourceMessage)

  if (policy.shouldSendContrl) {
    const contrl = await createAckIfMissing({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      ackFamily: 'CONTRL',
      outcome: 'positive',
      messageText: 'Automatiskt CONTRL.',
    })
    createdIds.push(contrl.id)
  }

  if (policy.shouldSendPositiveAperak) {
    const aperak = await createAckIfMissing({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      ackFamily: 'APERAK',
      outcome: 'positive',
      messageText: 'Automatiskt APERAK.',
    })
    createdIds.push(aperak.id)
  }

  return createdIds
}

async function linkInboundProdatMessageCanonically(params: {
  actorUserId: string
  message: EdielMessageRow
}) {
  const meteringPointId = await matchMeteringPointForEdielMessage(params.message)
  const siteAndCustomer = await matchSiteAndCustomerForMeteringPoint({
    meteringPointId,
  })
  const matchedSwitch = await findMatchingSupplierSwitchRequest(params.message)

  await linkEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    switchRequestId: matchedSwitch?.id ?? null,
    customerId: siteAndCustomer?.customerId ?? null,
    siteId: siteAndCustomer?.siteId ?? null,
    meteringPointId,
    gridOwnerId: siteAndCustomer?.gridOwnerId ?? null,
    relatedMessageId: null,
  })

  return {
    meteringPointId,
    siteAndCustomer,
    matchedSwitch,
  }
}

async function processInboundProdatMessage(params: {
  actorUserId: string
  message: EdielMessageRow
}) {
  const canonicalLinks = await linkInboundProdatMessageCanonically({
    actorUserId: params.actorUserId,
    message: params.message,
  })

  await updateEdielMessageStatus({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    status: 'parsed',
    parsedPayload: params.message.parsed_payload ?? {},
  })

  if (!canonicalLinks.matchedSwitch) {
    const ackIds = await createAutomaticPositiveAcks({
      actorUserId: params.actorUserId,
      sourceMessage: params.message,
    })
    const ackSnapshot = await readCanonicalAckSnapshot(params.message.id)

    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'validated',
      eventStatus: 'warning',
      message:
        'Inbound PRODAT kvitterades automatiskt men saknar ännu stark switch-koppling.',
      payload: {
        createdAckMessageIds: ackIds,
        canonicalAckState: ackSnapshot.canonicalAckState,
        ackMessages: ackSnapshot.ackMessages,
      },
    })

    return
  }

  const supabase = await createSupabaseServerClient()

  if (params.message.message_code === 'Z04') {
    await updateSupplierSwitchRequestStatus(supabase, {
      requestId: canonicalLinks.matchedSwitch.id,
      status: 'accepted',
      externalReference:
        params.message.external_reference ?? canonicalLinks.matchedSwitch.external_reference,
    })
  }

  if (params.message.message_code === 'Z05') {
    await updateSupplierSwitchRequestStatus(supabase, {
      requestId: canonicalLinks.matchedSwitch.id,
      status: 'completed',
      externalReference:
        params.message.external_reference ?? canonicalLinks.matchedSwitch.external_reference,
    })
  }

  const ackIds = await createAutomaticPositiveAcks({
    actorUserId: params.actorUserId,
    sourceMessage: params.message,
  })
  const ackSnapshot = await readCanonicalAckSnapshot(params.message.id)

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: canonicalLinks.matchedSwitch.id,
    eventType: 'ediel_inbound_processed',
    eventStatus: 'success',
    message: 'Inbound PRODAT behandlad via canonical inbound flow.',
    payload: {
      edielMessageId: params.message.id,
      createdAckMessageIds: ackIds,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
    },
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'validated',
    eventStatus: 'success',
    message: 'Inbound PRODAT processad via canonical inbound flow.',
    payload: {
      matchedSwitchRequestId: canonicalLinks.matchedSwitch.id,
      createdAckMessageIds: ackIds,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
    },
  })
}

export async function pollAndIngestEdielMailbox(params: {
  actorUserId: string
  mailbox?: string | null
  communicationRouteId?: string | null
  limit?: number
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)

  const incoming = await pollEdielMailboxViaImap({
    actorUserId,
    mailbox: params.mailbox ?? null,
    communicationRouteId: params.communicationRouteId ?? null,
    limit: params.limit ?? 10,
  })

  for (const message of incoming) {
    if (!isActiveEdielMessageFamily(message.message_family)) {
      await createEdielMessageEvent({
        actorUserId,
        edielMessageId: message.id,
        eventType: 'manual_note',
        eventStatus: 'warning',
        message:
          'Inbound meddelande ligger utanför aktiv release och behandlas därför inte vidare.',
        payload: {
          messageFamily: message.message_family,
          activeFamilies: ACTIVE_EDIEL_MESSAGE_FAMILIES,
        },
      })
      continue
    }

    if (!shouldProcessInboundMessage(message)) {
      await createEdielMessageEvent({
        actorUserId,
        edielMessageId: message.id,
        eventType: 'manual_note',
        eventStatus: 'warning',
        message: 'Inbound meddelande ligger utanför canonical inbound-EDIFACT-flödet.',
        payload: {
          direction: message.direction,
          standard: message.message_standard,
        },
      })
      continue
    }

    if (message.message_family === 'PRODAT') {
      await processInboundProdatMessage({
        actorUserId,
        message,
      })
      continue
    }

    if (message.message_family === 'UTILTS') {
      await processInboundUtiltsMessage({
        actorUserId,
        edielMessageId: message.id,
      })
      continue
    }

    const ackIds = await createAutomaticPositiveAcks({
      actorUserId,
      sourceMessage: message,
    })
    const ackSnapshot = await readCanonicalAckSnapshot(message.id)

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'validated',
      eventStatus: 'warning',
      message:
        'Inbound meddelande kvitterades automatiskt men saknar ännu stark processkoppling.',
      payload: {
        createdAckMessageIds: ackIds,
        canonicalAckState: ackSnapshot.canonicalAckState,
        ackMessages: ackSnapshot.ackMessages,
      },
    })
  }

  return incoming
}

export async function createNegativeUtiltsResponse(params: {
  actorUserId: string
  edielMessageId: string
  messageText: string
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const source = await getEdielMessageById(params.edielMessageId)
  if (!source) throw new Error('Källmeddelande hittades inte')
  if (source.message_family !== 'UTILTS') {
    throw new Error(`Meddelande ${source.id} är inte UTILTS.`)
  }

  const utiltsErr = await createAckIfMissing({
    actorUserId,
    sourceMessage: source,
    ackFamily: 'UTILTS_ERR',
    messageText: params.messageText,
  })

  const ackSnapshot = await readCanonicalAckSnapshot(source.id)

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: source.id,
    eventType: 'utilts_err_sent',
    eventStatus: 'warning',
    message: 'UTILTS-ERR-utkast skapat via canonical kernel.',
    payload: {
      utiltsErrMessageId: utiltsErr.id,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
    },
  })

  return utiltsErr
}