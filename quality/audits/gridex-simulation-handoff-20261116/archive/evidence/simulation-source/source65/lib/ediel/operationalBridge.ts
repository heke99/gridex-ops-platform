// lib/ediel/operationalBridge.ts

import { getEdielMessageById, createEdielMessageEvent } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest'
import { recordInboundBusinessDecision } from '@/lib/ediel/inboundBusinessDecision'

type SimpleSwitchLike = {
  id: string
  status: string
}

type SimpleDataRequestLike = {
  id: string
  status: string
  request_scope: string
}

type SimpleOutboundLike = {
  id: string
  request_type: string
  source_type: string | null
  source_id: string | null
  status: string
}

export type EdielOperationalProcessKind =
  | 'inbound_ack'
  | 'inbound_prodat'
  | 'inbound_utilts'
  | 'unsupported'

export type EdielOperationalProcessResult = {
  messageId: string
  kind: EdielOperationalProcessKind
  processed: boolean
  summary: string
}

export type EdielOperationalBridgeSummary = {
  switchRequestsTotal: number
  switchRequestsOpen: number
  switchRequestsAccepted: number
  switchRequestsCompleted: number
  prodatZ03Outbound: number
  prodatZ04Inbound: number
  prodatZ05Inbound: number
  utiltsInboundMetering: number
  ackInbound: number
  dataRequestsTotal: number
  dataRequestsOpen: number
  dataRequestsReceived: number
  outboundTotal: number
  outboundAcknowledged: number
  candidateInboundToProcess: number
  fileBasedMode: true
  smtpEcpEnabled: false
}

const ACK_FAMILIES = ['CONTRL', 'APERAK', 'UTILTS_ERR'] as const

function isAckFamily(value: string): value is (typeof ACK_FAMILIES)[number] {
  return (ACK_FAMILIES as readonly string[]).includes(value)
}

function isOpenSwitchStatus(status: string): boolean {
  return !['completed', 'failed', 'rejected', 'cancelled'].includes(status)
}

function isOpenDataRequestStatus(status: string): boolean {
  return !['received', 'failed', 'cancelled'].includes(status)
}

function isCandidateInboundToProcess(row: EdielMessageRow): boolean {
  if (row.direction !== 'inbound') return false
  if (!['received', 'parsed', 'validated'].includes(row.status)) return false
  if (row.message_family === 'PRODAT') return ['Z04', 'Z05', 'Z06', 'Z10'].includes(String(row.message_code))
  if (row.message_family === 'UTILTS') return ['E66', 'E30', 'S02', 'S03', 'E31'].includes(String(row.message_code))
  return isAckFamily(row.message_family)
}

export function getEdielOperationalBridgeSummary(params: {
  messages: EdielMessageRow[]
  switchRequests: SimpleSwitchLike[]
  dataRequests: SimpleDataRequestLike[]
  outboundRequests: SimpleOutboundLike[]
}): EdielOperationalBridgeSummary {
  return {
    switchRequestsTotal: params.switchRequests.length,
    switchRequestsOpen: params.switchRequests.filter((row) => isOpenSwitchStatus(row.status)).length,
    switchRequestsAccepted: params.switchRequests.filter((row) => row.status === 'accepted').length,
    switchRequestsCompleted: params.switchRequests.filter((row) => row.status === 'completed').length,
    prodatZ03Outbound: params.messages.filter(
      (row) => row.direction === 'outbound' && row.message_family === 'PRODAT' && row.message_code === 'Z03'
    ).length,
    prodatZ04Inbound: params.messages.filter(
      (row) => row.direction === 'inbound' && row.message_family === 'PRODAT' && row.message_code === 'Z04'
    ).length,
    prodatZ05Inbound: params.messages.filter(
      (row) => row.direction === 'inbound' && row.message_family === 'PRODAT' && row.message_code === 'Z05'
    ).length,
    utiltsInboundMetering: params.messages.filter(
      (row) => row.direction === 'inbound' && row.message_family === 'UTILTS' && ['E66', 'E30'].includes(String(row.message_code))
    ).length,
    ackInbound: params.messages.filter(
      (row) => row.direction === 'inbound' && isAckFamily(row.message_family)
    ).length,
    dataRequestsTotal: params.dataRequests.length,
    dataRequestsOpen: params.dataRequests.filter((row) => isOpenDataRequestStatus(row.status)).length,
    dataRequestsReceived: params.dataRequests.filter((row) => row.status === 'received').length,
    outboundTotal: params.outboundRequests.length,
    outboundAcknowledged: params.outboundRequests.filter((row) => row.status === 'acknowledged').length,
    candidateInboundToProcess: params.messages.filter(isCandidateInboundToProcess).length,
    fileBasedMode: true,
    smtpEcpEnabled: false,
  }
}

export async function processEdielOperationalMessage(params: {
  actorUserId: string
  edielMessageId: string
  testCaseCode?: string | null
}): Promise<EdielOperationalProcessResult> {
  const message = await getEdielMessageById(params.edielMessageId)
  if (!message) throw new Error('Ediel-meddelandet hittades inte')

  if (message.direction === 'inbound') {
    await recordInboundBusinessDecision(message).catch(async (error) => {
      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: message.id,
        eventType: 'manual_note',
        eventStatus: 'warning',
        message: 'Inbound business decision kunde inte loggas.',
        payload: { error: error instanceof Error ? error.message : String(error) },
      }).catch(() => null)
    })
  }

  if (message.direction !== 'inbound') {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Batch 6 hoppade över meddelandet eftersom bara inbound-meddelanden processas in i verksamhetsflöden.',
      payload: { batch: '6', direction: message.direction },
    })

    return {
      messageId: message.id,
      kind: 'unsupported',
      processed: false,
      summary: 'Endast inbound-meddelanden processas av verksamhetskopplingen.',
    }
  }

  if (isAckFamily(message.message_family)) {
    await processInboundAckMessage({ actorUserId: params.actorUserId, message })
    return {
      messageId: message.id,
      kind: 'inbound_ack',
      processed: true,
      summary: 'Inbound ACK kopplades mot källa och uppdaterade outbound/switch/data request där matchning fanns.',
    }
  }

  if (message.message_family === 'PRODAT') {
    await processInboundEdielMessage({ actorUserId: params.actorUserId, edielMessageId: message.id })
    return {
      messageId: message.id,
      kind: 'inbound_prodat',
      processed: true,
      summary: 'Inbound PRODAT processades mot supplier switch/masterdata-flödet.',
    }
  }

  if (message.message_family === 'UTILTS') {
    await processInboundUtiltsMessage({
      actorUserId: params.actorUserId,
      edielMessageId: message.id,
      testCaseCode: params.testCaseCode ?? null,
    })
    return {
      messageId: message.id,
      kind: 'inbound_utilts',
      processed: true,
      summary: 'Inbound UTILTS processades mot mätvärden/billing-underlay-flödet.',
    }
  }

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: message.id,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message: 'Batch 6 saknar verksamhetskoppling för denna meddelandefamilj i aktiv release.',
    payload: {
      batch: '6',
      messageFamily: message.message_family,
      messageCode: message.message_code,
    },
  })

  return {
    messageId: message.id,
    kind: 'unsupported',
    processed: false,
    summary: 'Meddelandefamiljen saknar verksamhetskoppling i aktiv release.',
  }
}
