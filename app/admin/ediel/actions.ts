// app/admin/ediel/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import {
  attachEdielMessageToTestRun,
  createEdielMessage,
  createEdielMessageEvent,
  createEdielTestRun,
  getEdielMessageById,
} from '@/lib/ediel/db'
import {
  buildAperakDraft,
  buildContrlDraft,
  buildUtiltsErrDraft,
} from '@/lib/ediel/ack'
import { buildProdatOutboundDraft } from '@/lib/ediel/prodat'
import { buildInboundUtiltsMessageInput } from '@/lib/ediel/utilts'
import { runEdielSelfTest } from '@/lib/ediel/selftest'
import {
  createNegativeUtiltsResponse,
  pollAndIngestEdielMailbox,
  prepareAndQueueEdielZ03,
  prepareAndQueueEdielZ09,
  sendQueuedEdielMessage,
} from '@/lib/ediel/orchestrator'

function stringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function jsonValue(formData: FormData, key: string): Record<string, unknown> {
  const raw = stringValue(formData, key)
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export async function createProdatDraftAction(formData: FormData) {
  const code = stringValue(formData, 'code') as
    | 'Z01'
    | 'Z03'
    | 'Z09'
    | 'Z13'
    | 'Z18'
    | null

  if (!code) throw new Error('Missing PRODAT code')

  const draft = buildProdatOutboundDraft({
    code,
    communicationRouteId: stringValue(formData, 'communicationRouteId'),
    customerId: stringValue(formData, 'customerId'),
    siteId: stringValue(formData, 'siteId'),
    meteringPointId: stringValue(formData, 'meteringPointId'),
    gridOwnerId: stringValue(formData, 'gridOwnerId'),
    outboundRequestId: stringValue(formData, 'outboundRequestId'),
    switchRequestId: stringValue(formData, 'switchRequestId'),
    gridOwnerDataRequestId: stringValue(formData, 'gridOwnerDataRequestId'),
    senderEdielId: stringValue(formData, 'senderEdielId'),
    receiverEdielId: stringValue(formData, 'receiverEdielId'),
    senderSubAddress: stringValue(formData, 'senderSubAddress'),
    receiverSubAddress: stringValue(formData, 'receiverSubAddress'),
    mailbox: stringValue(formData, 'mailbox'),
    receiverEmail: stringValue(formData, 'receiverEmail'),
    subject: stringValue(formData, 'subject'),
    externalReference: stringValue(formData, 'externalReference'),
    correlationReference: stringValue(formData, 'correlationReference'),
    transactionReference: stringValue(formData, 'transactionReference'),
    reasonForTransaction: stringValue(formData, 'reasonForTransaction'),
    referenceToLineItem: stringValue(formData, 'referenceToLineItem'),
    payload: jsonValue(formData, 'payload'),
  })

  const row = await createEdielMessage(draft)

  await createEdielMessageEvent({
    edielMessageId: row.id,
    eventType: 'prepared',
    eventStatus: 'success',
    message: `Prepared outbound PRODAT ${row.message_code}`,
    payload: { visibility: 'admin', nextStep: 'review_and_send' },
  })

  revalidatePath('/admin/ediel')
}

export async function registerInboundUtiltsAction(formData: FormData) {
  const code = stringValue(formData, 'code') as
    | 'S01'
    | 'S02'
    | 'S03'
    | 'S04'
    | 'E31'
    | 'E66'
    | null

  const rawPayload = stringValue(formData, 'rawPayload')

  if (!code || !rawPayload) {
    throw new Error('Missing UTILTS code or raw payload')
  }

  const input = buildInboundUtiltsMessageInput({
    code,
    communicationRouteId: stringValue(formData, 'communicationRouteId'),
    customerId: stringValue(formData, 'customerId'),
    siteId: stringValue(formData, 'siteId'),
    meteringPointId: stringValue(formData, 'meteringPointId'),
    gridOwnerId: stringValue(formData, 'gridOwnerId'),
    mailbox: stringValue(formData, 'mailbox'),
    mailboxMessageId: stringValue(formData, 'mailboxMessageId'),
    senderEdielId: stringValue(formData, 'senderEdielId'),
    receiverEdielId: stringValue(formData, 'receiverEdielId'),
    senderEmail: stringValue(formData, 'senderEmail'),
    receiverEmail: stringValue(formData, 'receiverEmail'),
    rawPayload,
  })

  await createEdielMessage(input)
  revalidatePath('/admin/ediel')
}

export async function createAckDraftAction(formData: FormData) {
  const sourceMessageId = stringValue(formData, 'sourceMessageId')
  const ackType = stringValue(formData, 'ackType')
  const outcome = (stringValue(formData, 'outcome') ?? 'positive') as
    | 'positive'
    | 'negative'
  const messageText = stringValue(formData, 'messageText')

  if (!sourceMessageId || !ackType) {
    throw new Error('Missing source message or ack type')
  }

  const source = await getEdielMessageById(sourceMessageId)
  if (!source) throw new Error('Source Ediel message not found')

  const draft =
    ackType === 'CONTRL'
      ? buildContrlDraft({ sourceMessage: source, outcome, messageText })
      : ackType === 'APERAK'
        ? buildAperakDraft({ sourceMessage: source, outcome, messageText })
        : ackType === 'UTILTS_ERR'
          ? buildUtiltsErrDraft({ sourceMessage: source, messageText })
          : null

  if (!draft) throw new Error(`Unsupported ack type: ${ackType}`)

  await createEdielMessage(draft)
  revalidatePath('/admin/ediel')
}

export async function createEdielTestRunAction(formData: FormData) {
  const testSuite = stringValue(formData, 'testSuite') as
    | 'PRODAT'
    | 'UTILTS'
    | 'NBS_XML'
    | 'OTHER'
    | null
  const roleCode = stringValue(formData, 'roleCode') as
    | 'supplier'
    | 'grid_owner'
    | 'balance_responsible'
    | 'esco'
    | null
  const testCaseCode = stringValue(formData, 'testCaseCode')

  if (!testSuite || !roleCode || !testCaseCode) {
    throw new Error('Missing test suite, role code, or test case code')
  }

  await createEdielTestRun({
    approvalVersion: stringValue(formData, 'approvalVersion'),
    roleCode,
    testSuite,
    testCaseCode,
    title: stringValue(formData, 'title'),
    status: 'draft',
    customerId: stringValue(formData, 'customerId'),
    siteId: stringValue(formData, 'siteId'),
    meteringPointId: stringValue(formData, 'meteringPointId'),
    gridOwnerId: stringValue(formData, 'gridOwnerId'),
    notes: stringValue(formData, 'notes'),
  })

  revalidatePath('/admin/ediel')
}

export async function attachMessageToTestRunAction(formData: FormData) {
  const testRunId = stringValue(formData, 'testRunId')
  const edielMessageId = stringValue(formData, 'edielMessageId')

  if (!testRunId || !edielMessageId) {
    throw new Error('Missing test run or Ediel message')
  }

  const stepNoRaw = stringValue(formData, 'stepNo')
  const stepNo = stepNoRaw ? Number(stepNoRaw) : null

  await attachEdielMessageToTestRun({
    testRunId,
    edielMessageId,
    stepNo: Number.isFinite(stepNo) ? stepNo : null,
    expectedDirection: (stringValue(formData, 'expectedDirection') as
      | 'inbound'
      | 'outbound'
      | null) ?? null,
    expectedFamily: stringValue(formData, 'expectedFamily'),
    expectedCode: stringValue(formData, 'expectedCode'),
  })

  revalidatePath('/admin/ediel')
}

export async function prepareSwitchZ03Action(formData: FormData) {
  await prepareAndQueueEdielZ03({
    actorUserId: stringValue(formData, 'actorUserId') ?? '',
    senderEdielId: stringValue(formData, 'senderEdielId') ?? '',
    receiverEdielId: stringValue(formData, 'receiverEdielId') ?? '',
    receiverEmail: stringValue(formData, 'receiverEmail'),
    switchRequestId: stringValue(formData, 'switchRequestId') ?? '',
    communicationRouteId: stringValue(formData, 'communicationRouteId'),
    mailbox: stringValue(formData, 'mailbox'),
  })

  revalidatePath('/admin/ediel')
  revalidatePath('/admin/operations')
}

export async function prepareSwitchZ09Action(formData: FormData) {
  await prepareAndQueueEdielZ09({
    actorUserId: stringValue(formData, 'actorUserId') ?? '',
    senderEdielId: stringValue(formData, 'senderEdielId') ?? '',
    receiverEdielId: stringValue(formData, 'receiverEdielId') ?? '',
    receiverEmail: stringValue(formData, 'receiverEmail'),
    switchRequestId: stringValue(formData, 'switchRequestId') ?? '',
    communicationRouteId: stringValue(formData, 'communicationRouteId'),
    mailbox: stringValue(formData, 'mailbox'),
  })

  revalidatePath('/admin/ediel')
  revalidatePath('/admin/operations')
}

export async function sendEdielMessageAction(formData: FormData) {
  const actorUserId = stringValue(formData, 'actorUserId')
  const edielMessageId = stringValue(formData, 'edielMessageId')

  if (!actorUserId || !edielMessageId) {
    throw new Error('Missing actor user id or ediel message id')
  }

  await sendQueuedEdielMessage({
    actorUserId,
    edielMessageId,
  })

  revalidatePath('/admin/ediel')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/outbound')
}

export async function pollMailboxAction(formData: FormData) {
  const actorUserId = stringValue(formData, 'actorUserId')
  if (!actorUserId) throw new Error('Missing actor user id')

  await pollAndIngestEdielMailbox({
    actorUserId,
    mailbox: stringValue(formData, 'mailbox'),
    communicationRouteId: stringValue(formData, 'communicationRouteId'),
    limit: Number(stringValue(formData, 'limit') ?? '10'),
  })

  revalidatePath('/admin/ediel')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/metering')
  revalidatePath('/admin/billing')
  revalidatePath('/admin/customers')
}

export async function createNegativeUtiltsResponseAction(formData: FormData) {
  const actorUserId = stringValue(formData, 'actorUserId')
  const edielMessageId = stringValue(formData, 'edielMessageId')
  const messageText = stringValue(formData, 'messageText') ?? 'Functional error'

  if (!actorUserId || !edielMessageId) {
    throw new Error('Missing actor user id or ediel message id')
  }

  await createNegativeUtiltsResponse({
    actorUserId,
    edielMessageId,
    messageText,
  })

  revalidatePath('/admin/ediel')
}

export async function runEdielSelfTestAction(formData: FormData) {
  const actorUserId = stringValue(formData, 'actorUserId')
  const scenario = stringValue(formData, 'scenario') as
    | 'PRODAT_Z04_IN'
    | 'PRODAT_Z05_IN'
    | 'PRODAT_Z06_IN'
    | 'PRODAT_Z10_IN'
    | 'UTILTS_S02_IN'
    | 'UTILTS_S03_IN'
    | 'UTILTS_E66_KVART_IN'
    | 'UTILTS_E66_SCH_IN'
    | 'UTILTS_E31_SCH_IN'
    | 'UTILTS_NEGATIVE'
    | null

  if (!actorUserId || !scenario) {
    throw new Error('Missing actor user id or scenario')
  }

  await runEdielSelfTest({
    actorUserId,
    scenario,
    switchRequestId: stringValue(formData, 'switchRequestId'),
    gridOwnerDataRequestId: stringValue(formData, 'gridOwnerDataRequestId'),
    senderEdielId: stringValue(formData, 'senderEdielId'),
    receiverEdielId: stringValue(formData, 'receiverEdielId'),
    mailbox: stringValue(formData, 'mailbox'),
    senderEmail: stringValue(formData, 'senderEmail'),
    receiverEmail: stringValue(formData, 'receiverEmail'),
  })

  revalidatePath('/admin/ediel')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/customers')
  revalidatePath('/admin/outbound')
}