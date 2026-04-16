'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
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

async function getActor() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user
}

export async function createProdatDraftAction(formData: FormData) {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()

  const code = stringValue(formData, 'code') as
    | 'Z01'
    | 'Z03'
    | 'Z09'
    | 'Z13'
    | 'Z18'
    | null

  if (!code) throw new Error('Missing PRODAT code')

  const draft = buildProdatOutboundDraft({
    actorUserId: actor.id,
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
    actorUserId: actor.id,
    edielMessageId: row.id,
    eventType: 'prepared',
    eventStatus: 'success',
    message: `Prepared outbound PRODAT ${row.message_code}`,
    payload: { visibility: 'admin', nextStep: 'review_and_send' },
  })

  revalidatePath('/admin/ediel')
  revalidatePath('/admin/outbound')
}

export async function registerInboundUtiltsAction(formData: FormData) {
  await requireAdminActionAccess([
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()

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
    actorUserId: actor.id,
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
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/metering')
  revalidatePath('/admin/billing')
}

export async function createAckDraftAction(formData: FormData) {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()

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
      ? buildContrlDraft({
          actorUserId: actor.id,
          sourceMessage: source,
          outcome,
          messageText,
        })
      : ackType === 'APERAK'
        ? buildAperakDraft({
            actorUserId: actor.id,
            sourceMessage: source,
            outcome,
            messageText,
          })
        : ackType === 'UTILTS_ERR'
          ? buildUtiltsErrDraft({
              actorUserId: actor.id,
              sourceMessage: source,
              messageText,
            })
          : null

  if (!draft) throw new Error(`Unsupported ack type: ${ackType}`)

  await createEdielMessage(draft)

  revalidatePath('/admin/ediel')
}

export async function createEdielTestRunAction(formData: FormData) {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()

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
    actorUserId: actor.id,
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
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

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
  await requireAdminActionAccess(['switching.write'])

  const actor = await getActor()

  await prepareAndQueueEdielZ03({
    actorUserId: actor.id,
    senderEdielId: stringValue(formData, 'senderEdielId') ?? '',
    receiverEdielId: stringValue(formData, 'receiverEdielId') ?? '',
    receiverEmail: stringValue(formData, 'receiverEmail'),
    switchRequestId: stringValue(formData, 'switchRequestId') ?? '',
    communicationRouteId: stringValue(formData, 'communicationRouteId'),
    mailbox: stringValue(formData, 'mailbox'),
  })

  revalidatePath('/admin/ediel')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/outbound')
}

export async function prepareSwitchZ09Action(formData: FormData) {
  await requireAdminActionAccess(['switching.write'])

  const actor = await getActor()

  await prepareAndQueueEdielZ09({
    actorUserId: actor.id,
    senderEdielId: stringValue(formData, 'senderEdielId') ?? '',
    receiverEdielId: stringValue(formData, 'receiverEdielId') ?? '',
    receiverEmail: stringValue(formData, 'receiverEmail'),
    switchRequestId: stringValue(formData, 'switchRequestId') ?? '',
    communicationRouteId: stringValue(formData, 'communicationRouteId'),
    mailbox: stringValue(formData, 'mailbox'),
  })

  revalidatePath('/admin/ediel')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/outbound')
}

export async function sendEdielMessageAction(formData: FormData) {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()
  const edielMessageId = stringValue(formData, 'edielMessageId')

  if (!edielMessageId) {
    throw new Error('Missing ediel message id')
  }

  await sendQueuedEdielMessage({
    actorUserId: actor.id,
    edielMessageId,
  })

  revalidatePath('/admin/ediel')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/outbound')
}

export async function pollMailboxAction(formData: FormData) {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()

  await pollAndIngestEdielMailbox({
    actorUserId: actor.id,
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
  await requireAdminActionAccess([
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()
  const edielMessageId = stringValue(formData, 'edielMessageId')
  const messageText = stringValue(formData, 'messageText') ?? 'Functional error'

  if (!edielMessageId) {
    throw new Error('Missing ediel message id')
  }

  await createNegativeUtiltsResponse({
    actorUserId: actor.id,
    edielMessageId,
    messageText,
  })

  revalidatePath('/admin/ediel')
}

export async function runEdielSelfTestAction(formData: FormData) {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()
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

  if (!scenario) {
    throw new Error('Missing scenario')
  }

  await runEdielSelfTest({
    actorUserId: actor.id,
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