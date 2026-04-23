'use server'

import { revalidatePath } from 'next/cache'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  createAckDraftForMessage,
  createNegativeUtiltsResponse,
  pollAndIngestEdielMailbox,
  prepareAndQueueAiList,
  prepareAndQueueEdielZ03,
  prepareAndQueueEdielZ05,
  prepareAndQueueEdielZ09,
  prepareAndQueueUtiltsE66,
  prepareAndQueueUtiltsE73,
  sendQueuedEdielMessage,
} from '@/lib/ediel/orchestrator'
import type { AckFamily, AckOutcome } from '@/lib/ediel/ack'
import { registerInboundCanonicalMessage } from '@/lib/ediel/core/kernel'
import { createEdielTestRun, getEdielMessageById } from '@/lib/ediel/db'
import { runEdielSelfTest } from '@/lib/ediel/selftest'
import { buildInboundUtiltsMessageInput } from '@/lib/ediel/utilts'
import {
  buildProdatZ03FromSwitch,
  buildProdatZ05FromSwitch,
  buildProdatZ09FromSwitch,
} from '@/lib/ediel/prodat'
import { finalizeOutboundDraft, makeServerClient } from '@/lib/ediel/flows/shared'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { getSupplierSwitchRequestById } from '@/lib/operations/db'
import {
  getCustomerSiteById,
  getGridOwnerById,
  getMeteringPointById,
} from '@/lib/masterdata/db'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest'
import type { EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'

function formString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function formNumber(value: FormDataEntryValue | null): number | null {
  const raw = formString(value)
  if (!raw) return null
  const parsed = Number(raw.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

const EDIEL_TEST_SUITES: readonly EdielTestSuite[] = [
  'PRODAT',
  'UTILTS',
  'AI_LIST',
  'NBS_XML',
  'OTHER',
] as const

const EDIEL_TEST_ROLE_CODES: readonly EdielTestRoleCode[] = [
  'supplier',
  'grid_owner',
  'balance_responsible',
  'esco',
] as const

function isEdielTestSuite(value: string): value is EdielTestSuite {
  return (EDIEL_TEST_SUITES as readonly string[]).includes(value)
}

function isEdielTestRoleCode(value: string): value is EdielTestRoleCode {
  return (EDIEL_TEST_ROLE_CODES as readonly string[]).includes(value)
}

function parseEdielTestSuite(value: FormDataEntryValue | null): EdielTestSuite {
  const raw = formString(value)
  return raw && isEdielTestSuite(raw) ? raw : 'PRODAT'
}

function parseEdielTestRoleCode(value: FormDataEntryValue | null): EdielTestRoleCode {
  const raw = formString(value)
  return raw && isEdielTestRoleCode(raw) ? raw : 'supplier'
}

function revalidateEdiel(messageId?: string | null) {
  revalidatePath('/admin/ediel')
  revalidatePath('/admin/ediel/ai-list')
  revalidatePath('/admin/ediel/control-tower')
  revalidatePath('/admin/outbound')
  if (messageId) revalidatePath(`/admin/ediel/messages/${messageId}`)
}

export async function sendEdielMessageAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const edielMessageId = formString(formData.get('edielMessageId'))

  if (!edielMessageId) throw new Error('edielMessageId saknas')

  await sendQueuedEdielMessage({
    actorUserId: context.userId,
    edielMessageId,
  })

  revalidateEdiel(edielMessageId)
}

export async function pollMailboxAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])

  const mailbox = formString(formData.get('mailbox'))
  const communicationRouteId = formString(formData.get('communicationRouteId'))
  const limitRaw = formString(formData.get('limit'))
  const limit = limitRaw ? Number(limitRaw) : 10

  await pollAndIngestEdielMailbox({
    actorUserId: context.userId,
    mailbox,
    communicationRouteId,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
  })

  revalidateEdiel()
}

export async function createAckDraftAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const sourceMessageId = formString(formData.get('sourceMessageId'))
  const ackType = formString(formData.get('ackType')) as AckFamily | null
  const outcome = (formString(formData.get('outcome')) as AckOutcome | null) ?? 'positive'
  const messageText = formString(formData.get('messageText'))

  if (!sourceMessageId) throw new Error('sourceMessageId saknas')
  if (!ackType || !['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(ackType)) {
    throw new Error('Ogiltig ackType')
  }

  const ackMessage = await createAckDraftForMessage({
    actorUserId: context.userId,
    sourceMessageId,
    ackFamily: ackType,
    outcome: ackType === 'UTILTS_ERR' ? undefined : outcome,
    messageText,
  })

  revalidateEdiel(sourceMessageId)
  revalidateEdiel(ackMessage.id)
}

export async function createNegativeUtiltsResponseAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const edielMessageId = formString(formData.get('edielMessageId'))
  const messageText = formString(formData.get('messageText'))

  if (!edielMessageId) throw new Error('edielMessageId saknas')
  if (!messageText) throw new Error('messageText saknas')

  const ackMessage = await createNegativeUtiltsResponse({
    actorUserId: context.userId,
    edielMessageId,
    messageText,
  })

  revalidateEdiel(edielMessageId)
  revalidateEdiel(ackMessage.id)
}

export async function createProdatDraftAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const switchRequestId = formString(formData.get('switchRequestId'))
  const communicationRouteId = formString(formData.get('communicationRouteId'))
  const messageCode = formString(formData.get('messageCode')) as 'Z03' | 'Z05' | 'Z09' | null

  if (!switchRequestId) throw new Error('switchRequestId saknas')
  if (!messageCode || !['Z03', 'Z05', 'Z09'].includes(messageCode)) {
    throw new Error('Ogiltig messageCode')
  }

  const supabase = await makeServerClient()
  const switchRequest = await getSupplierSwitchRequestById(supabase, switchRequestId)
  if (!switchRequest) throw new Error('Switch request hittades inte')

  const site = await getCustomerSiteById(supabase, switchRequest.site_id)
  if (!site) throw new Error('Anläggning saknas för switchärendet')

  const meteringPoint = await getMeteringPointById(supabase, switchRequest.metering_point_id)
  if (!meteringPoint) throw new Error('Mätpunkt saknas för switchärendet')

  const gridOwner = switchRequest.grid_owner_id
    ? await getGridOwnerById(supabase, switchRequest.grid_owner_id)
    : null

  const routeContext = await resolveCanonicalOutboundContext({
    requestType: 'supplier_switch',
    gridOwner,
    preferredRouteId: communicationRouteId ?? null,
    environment: 'test',
    messageStandard: 'edifact',
  })

  const draftBuilder =
    messageCode === 'Z03'
      ? buildProdatZ03FromSwitch
      : messageCode === 'Z05'
        ? buildProdatZ05FromSwitch
        : buildProdatZ09FromSwitch

  const draft = await draftBuilder({
    actorUserId: context.userId,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    receiverEmail: formString(formData.get('receiverEmail')) ?? routeContext.receiverEmail,
    senderSubAddress:
      formString(formData.get('senderSubAddress')) ?? routeContext.senderSubAddress,
    receiverSubAddress:
      formString(formData.get('receiverSubAddress')) ?? routeContext.receiverSubAddress,
    communicationRouteId: routeContext.route.id,
    mailbox: formString(formData.get('mailbox')) ?? routeContext.mailbox,
    switchRequest,
    site,
    meteringPoint,
    gridOwner,
  })

  const message = await finalizeOutboundDraft({
    actorUserId: context.userId,
    requestType: 'supplier_switch',
    routeContext: {
      ...routeContext,
      receiverEmail:
        formString(formData.get('receiverEmail')) ?? routeContext.receiverEmail,
    },
    draft,
    outboundRequestId: null,
    duplicateCheck: {
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: draft.messageFamily,
      messageCode: String(draft.messageCode),
      messageVersion: draft.messageVersion ?? null,
    },
  })

  revalidateEdiel(message.id)
}

export async function prepareSwitchZ03Action(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const switchRequestId = formString(formData.get('switchRequestId'))
  const communicationRouteId = formString(formData.get('communicationRouteId'))
  if (!switchRequestId) throw new Error('switchRequestId saknas')

  const message = await prepareAndQueueEdielZ03({
    actorUserId: context.userId,
    switchRequestId,
    communicationRouteId,
  })

  revalidateEdiel(message.id)
}

export async function prepareSwitchZ05Action(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const switchRequestId = formString(formData.get('switchRequestId'))
  const communicationRouteId = formString(formData.get('communicationRouteId'))
  if (!switchRequestId) throw new Error('switchRequestId saknas')

  const message = await prepareAndQueueEdielZ05({
    actorUserId: context.userId,
    switchRequestId,
    communicationRouteId,
  })

  revalidateEdiel(message.id)
}

export async function prepareSwitchZ09Action(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const switchRequestId = formString(formData.get('switchRequestId'))
  const communicationRouteId = formString(formData.get('communicationRouteId'))
  if (!switchRequestId) throw new Error('switchRequestId saknas')

  const message = await prepareAndQueueEdielZ09({
    actorUserId: context.userId,
    switchRequestId,
    communicationRouteId,
  })

  revalidateEdiel(message.id)
}

export async function prepareUtiltsE73Action(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const gridOwnerDataRequestId = formString(formData.get('gridOwnerDataRequestId'))
  const communicationRouteId = formString(formData.get('communicationRouteId'))
  if (!gridOwnerDataRequestId) throw new Error('gridOwnerDataRequestId saknas')

  const message = await prepareAndQueueUtiltsE73({
    actorUserId: context.userId,
    gridOwnerDataRequestId,
    communicationRouteId,
  })

  revalidateEdiel(message.id)
}

export async function prepareUtiltsE66Action(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const gridOwnerDataRequestId = formString(formData.get('gridOwnerDataRequestId'))
  const communicationRouteId = formString(formData.get('communicationRouteId'))
  const quantity = formNumber(formData.get('quantity'))
  const periodStart = formString(formData.get('periodStart'))
  const periodEnd = formString(formData.get('periodEnd'))
  const registrationTime = formString(formData.get('registrationTime'))
  if (!gridOwnerDataRequestId) throw new Error('gridOwnerDataRequestId saknas')

  const message = await prepareAndQueueUtiltsE66({
    actorUserId: context.userId,
    gridOwnerDataRequestId,
    communicationRouteId,
    quantity,
    periodStart,
    periodEnd,
    registrationTime,
  })

  revalidateEdiel(message.id)
}

export async function prepareAiListAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])

  const listType = formString(formData.get('listType')) as 'AI' | 'BI' | null
  const customerId = formString(formData.get('customerId'))
  const siteId = formString(formData.get('siteId'))
  const meteringPointId = formString(formData.get('meteringPointId'))
  const receiverEdielId = formString(formData.get('receiverEdielId'))
  const receiverEmail = formString(formData.get('receiverEmail'))
  const supplierEdielId = formString(formData.get('supplierEdielId'))
  const balanceResponsibleEdielId = formString(formData.get('balanceResponsibleEdielId'))
  const communicationRouteId = formString(formData.get('communicationRouteId'))
  const fromDate = formString(formData.get('fromDate'))
  const toDate = formString(formData.get('toDate'))

  if (!listType || (listType !== 'AI' && listType !== 'BI')) {
    throw new Error('listType saknas')
  }
  if (!customerId) throw new Error('customerId saknas')
  if (!siteId) throw new Error('siteId saknas')
  if (!receiverEdielId) throw new Error('receiverEdielId saknas')
  if (!fromDate || !toDate) throw new Error('fromDate/toDate saknas')

  const message = await prepareAndQueueAiList({
    actorUserId: context.userId,
    listType,
    customerId,
    siteId,
    meteringPointId,
    supplierEdielId,
    balanceResponsibleEdielId,
    receiverEdielId,
    receiverEmail,
    fromDate,
    toDate,
    communicationRouteId,
  })

  revalidateEdiel(message.id)
}

export async function registerInboundUtiltsAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])

  const messageCode = formString(formData.get('messageCode')) as
    | 'E66'
    | 'S02'
    | 'S03'
    | 'E31'
    | null
  const senderEdielId = formString(formData.get('senderEdielId'))
  const receiverEdielId = formString(formData.get('receiverEdielId'))
  const quantity = formNumber(formData.get('quantity'))
  const periodStart = formString(formData.get('periodStart'))
  const periodEnd = formString(formData.get('periodEnd'))

  if (!messageCode) throw new Error('messageCode saknas')

  const externalReference = `MANUAL-${messageCode}-${Date.now()}`
  const transactionReference = `TN-${Date.now()}`
  const start = periodStart ? periodStart.replace(/[-:T]/g, '').slice(0, 8) : ''
  const end = periodEnd ? periodEnd.replace(/[-:T]/g, '').slice(0, 8) : ''
  const qty = quantity ?? 0

  const rawPayload =
    [
      `UNB+UNOC:3+${senderEdielId ?? 'SENDER'}:UTILTS+${receiverEdielId ?? 'RECEIVER'}:GRIDEX+250101:1200+${externalReference}`,
      `UNH+1+UTILTS:D:03A:UN:E5SE5A`,
      `BGM+${messageCode}+${externalReference}+9`,
      `RFF+TN:${transactionReference}`,
      `QTY+47:${qty}:KWH`,
      start ? `DTM+163:${start}:102` : null,
      end ? `DTM+164:${end}:102` : null,
      'UNT+6+1',
      `UNZ+1+${externalReference}`,
    ]
      .filter(Boolean)
      .join("'") + "'"

  const input = buildInboundUtiltsMessageInput({
    actorUserId: context.userId,
    code: messageCode,
    senderEdielId,
    receiverEdielId,
    rawPayload,
    quantity,
    periodStart,
    periodEnd,
  })

  const message = await registerInboundCanonicalMessage({
    actorUserId: context.userId,
    input,
  })

  await processInboundUtiltsMessage({
    actorUserId: context.userId,
    edielMessageId: message.id,
  })

  revalidateEdiel(message.id)
}

export async function runEdielSelfTestAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])

  await runEdielSelfTest({
    actorUserId: context.userId,
    scenario:
      (formString(formData.get('scenario')) as Parameters<
        typeof runEdielSelfTest
      >[0]['scenario']) ?? 'PRODAT_Z05_IN',
    switchRequestId: formString(formData.get('switchRequestId')),
    gridOwnerDataRequestId: formString(formData.get('gridOwnerDataRequestId')),
    senderEdielId: formString(formData.get('senderEdielId')),
    receiverEdielId: formString(formData.get('receiverEdielId')),
    mailbox: formString(formData.get('mailbox')),
    receiverEmail: formString(formData.get('receiverEmail')),
  })

  revalidateEdiel()
}

export async function createEdielTestRunAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])

  await createEdielTestRun({
    actorUserId: context.userId,
    testSuite: parseEdielTestSuite(formData.get('testSuite')),
    roleCode: parseEdielTestRoleCode(formData.get('roleCode')),
    testCaseCode: formString(formData.get('testCaseCode')) ?? '',
    title: formString(formData.get('title')),
    approvalVersion: formString(formData.get('approvalVersion')),
    notes: formString(formData.get('notes')),
    status: 'draft',
  })

  revalidateEdiel()
}