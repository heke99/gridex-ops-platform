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
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { buildSafeMasterdataProposal } from '@/lib/ediel/operationalVerification'
import { createOrUpdateInboundProdatCase } from '@/lib/ediel/inboundCases'

function shouldProcessInboundMessage(message: EdielMessageRow): boolean {
  return (
    isActiveEdielMessageFamily(message.message_family) &&
    message.direction === 'inbound' &&
    message.message_standard === 'edifact' &&
    message.status !== 'cancelled'
  )
}

function hasInboundAckParties(message: EdielMessageRow): boolean {
  return Boolean(message.sender_ediel_id?.trim() && message.receiver_ediel_id?.trim())
}

async function createAckBlockedEvent(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  reason: string
  details?: Record<string, unknown>
}) {
  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessage.id,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message: `${params.ackFamily} skapades inte: ${params.reason}`,
    payload: {
      blockedBy: 'canonical_inbound_ack_guard',
      ackFamily: params.ackFamily,
      sourceMessageId: params.sourceMessage.id,
      messageFamily: params.sourceMessage.message_family,
      messageCode: params.sourceMessage.message_code,
      status: params.sourceMessage.status,
      senderEdielId: params.sourceMessage.sender_ediel_id,
      receiverEdielId: params.sourceMessage.receiver_ediel_id,
      ...params.details,
    },
  })
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

  if ((policy.shouldSendContrl || policy.shouldSendPositiveAperak) && !hasInboundAckParties(params.sourceMessage)) {
    await createAckBlockedEvent({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      ackFamily: policy.shouldSendContrl ? 'CONTRL' : 'APERAK',
      reason: 'inbound sender/receiver saknas. Meddelandet kvitteras inte automatiskt.',
      details: {
        shouldSendContrl: policy.shouldSendContrl,
        shouldSendPositiveAperak: policy.shouldSendPositiveAperak,
      },
    })
    return createdIds
  }

  if (policy.shouldSendContrl) {
    try {
      const contrl = await createAckIfMissing({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: 'CONTRL',
        outcome: 'positive',
        messageText: 'Automatiskt CONTRL.',
      })
      createdIds.push(contrl.id)
    } catch (error) {
      await createAckBlockedEvent({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: 'CONTRL',
        reason: error instanceof Error ? error.message : 'Okänt fel vid CONTRL-skapande.',
      })
    }
  }

  if (policy.shouldSendPositiveAperak) {
    try {
      const aperak = await createAckIfMissing({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: 'APERAK',
        outcome: 'positive',
        messageText: 'Automatiskt APERAK.',
      })
      createdIds.push(aperak.id)
    } catch (error) {
      await createAckBlockedEvent({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: 'APERAK',
        reason: error instanceof Error ? error.message : 'Okänt fel vid APERAK-skapande.',
      })
    }
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

  const inboundCase = await createOrUpdateInboundProdatCase({
    actorUserId: params.actorUserId,
    message: params.message,
  })

  if (!canonicalLinks.matchedSwitch) {
    const safeApplyProposalChanges = ['Z06', 'Z10'].includes(String(params.message.message_code))
      ? await buildSafeMasterdataProposal(params.message)
      : []

    if (safeApplyProposalChanges.length > 0) {
      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: params.message.id,
        eventType: 'manual_note',
        eventStatus: 'warning',
        message: 'Safe apply-förslag skapades för Z06/Z10 utan stark switch-koppling. Masterdata skrevs inte över automatiskt.',
        payload: {
          batch: '6B',
          safeApply: true,
          appliedAutomatically: false,
          proposedChanges: safeApplyProposalChanges,
          reviewRequired: true,
          inboundCaseId: inboundCase?.id ?? null,
        },
      })
    }

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
        'Inbound PRODAT kvitterades automatiskt och lades i admin-godkännande eftersom stark switch-koppling saknas.',
      payload: {
        createdAckMessageIds: ackIds,
        canonicalAckState: ackSnapshot.canonicalAckState,
        ackMessages: ackSnapshot.ackMessages,
        safeApplyProposalChanges,
        inboundCaseId: inboundCase?.id ?? null,
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

  const safeApplyProposalChanges = ['Z06', 'Z10'].includes(String(params.message.message_code))
    ? await buildSafeMasterdataProposal(params.message)
    : []

  if (safeApplyProposalChanges.length > 0) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Safe apply-förslag skapades för Z06/Z10. Masterdata skrevs inte över automatiskt.',
      payload: {
        batch: '6B',
        safeApply: true,
        appliedAutomatically: false,
        proposedChanges: safeApplyProposalChanges,
        reviewRequired: true,
        inboundCaseId: inboundCase?.id ?? null,
      },
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
    message: 'Inbound PRODAT behandlad via canonical inbound flow och staging-case skapades för eventuell admin-granskning.',
    payload: {
      edielMessageId: params.message.id,
      createdAckMessageIds: ackIds,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
      safeApplyProposalChanges,
      inboundCaseId: inboundCase?.id ?? null,
    },
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'validated',
    eventStatus: 'success',
    message: 'Inbound PRODAT processad via canonical inbound flow och staging-case skapat.',
    payload: {
      matchedSwitchRequestId: canonicalLinks.matchedSwitch.id,
      createdAckMessageIds: ackIds,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
      safeApplyProposalChanges,
      inboundCaseId: inboundCase?.id ?? null,
    },
  })
}

export async function processInboundEdielMessage(params: {
  actorUserId: string
  edielMessageId: string
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const message = await getEdielMessageById(params.edielMessageId)

  if (!message) throw new Error('Ediel-meddelandet hittades inte')

  if (!isActiveEdielMessageFamily(message.message_family)) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Batch 6 hoppade över meddelandet eftersom familjen ligger utanför aktiv release.',
      payload: {
        messageFamily: message.message_family,
        activeFamilies: ACTIVE_EDIEL_MESSAGE_FAMILIES,
      },
    })
    return message
  }

  if (!shouldProcessInboundMessage(message)) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Batch 6 hoppade över meddelandet eftersom det inte är inbound EDIFACT i aktivt flöde.',
      payload: {
        direction: message.direction,
        standard: message.message_standard,
      },
    })
    return message
  }

  if (
    message.message_family === 'CONTRL' ||
    message.message_family === 'APERAK' ||
    message.message_family === 'UTILTS_ERR'
  ) {
    await processInboundAckMessage({ actorUserId, message })
    return message
  }

  if (message.message_family === 'PRODAT') {
    await processInboundProdatMessage({ actorUserId, message })
    return message
  }

  if (message.message_family === 'UTILTS') {
    await processInboundUtiltsMessage({ actorUserId, edielMessageId: message.id })
    return message
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
    message: 'Inbound meddelande kvitterades automatiskt men saknar ännu stark processkoppling.',
    payload: {
      createdAckMessageIds: ackIds,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
    },
  })

  return message
}

export async function pollAndIngestEdielMailbox(params: {
  actorUserId: string
  mailbox?: string | null
  communicationRouteId?: string | null
  companyId?: string | null
  limit?: number
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)

  const incoming = await pollEdielMailboxViaImap({
    actorUserId,
    mailbox: params.mailbox ?? null,
    communicationRouteId: params.communicationRouteId ?? null,
    companyId: params.companyId ?? null,
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

    if (
      message.message_family === 'CONTRL' ||
      message.message_family === 'APERAK' ||
      message.message_family === 'UTILTS_ERR'
    ) {
      await processInboundAckMessage({
        actorUserId,
        message,
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
