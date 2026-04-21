// app/admin/ediel/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  createEdielMessage,
  createEdielMessageEvent,
  createEdielTestRun,
  getEdielMessageById,
  listOverdueAckMessages,
  updateEdielMessageStatus,
} from '@/lib/ediel/db'
import { buildInboundUtiltsMessageInput } from '@/lib/ediel/utilts'
import {
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
import {
  buildAperakDraft,
  buildContrlDraft,
  hasAckAlreadyBeenCreated,
} from '@/lib/ediel/ack'
import { runEdielSelfTest, type EdielSelfTestScenarioCode } from '@/lib/ediel/selftest'
import { inferEdielFileName } from '@/lib/ediel/classify'
import { isActiveEdielMessageFamily } from '@/lib/ediel/types'

function asString(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asOptionalString(value: FormDataEntryValue | null): string | null {
  const parsed = asString(value)
  return parsed.length > 0 ? parsed : null
}

function asNumber(value: FormDataEntryValue | null): number | null {
  const parsed = asString(value)
  if (!parsed) return null
  const normalized = parsed.replace(',', '.')
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

function asIsoDateTimeLocal(value: FormDataEntryValue | null): string | null {
  const parsed = asString(value)
  if (!parsed) return null
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(parsed)) {
    return `${parsed}:00`
  }
  return parsed
}

function asIsoDate(value: FormDataEntryValue | null): string | null {
  const parsed = asString(value)
  return parsed || null
}

async function getActorUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) {
    throw new Error('Ingen inloggad användare hittades för server action')
  }

  return user.id
}

function revalidateEdielSurfaces() {
  revalidatePath('/admin/ediel')
  revalidatePath('/admin/ediel/control-tower')
  revalidatePath('/admin/ediel/messages/[id]', 'page')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/outbound')
}

function buildSimpleInboundUtiltsRaw(params: {
  code: 'E66' | 'S02' | 'S03' | 'E31'
  senderEdielId: string
  receiverEdielId: string
  externalReference: string
  transactionReference: string
  meterPointId: string
  periodStart?: string | null
  periodEnd?: string | null
  quantity?: number | null
}): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .slice(2, 13)

  const periodStart = (params.periodStart ?? new Date().toISOString().slice(0, 10)).replace(
    /-/g,
    ''
  )
  const periodEnd = (params.periodEnd ?? new Date().toISOString().slice(0, 10)).replace(
    /-/g,
    ''
  )

  const quantity =
    typeof params.quantity === 'number' && Number.isFinite(params.quantity)
      ? String(params.quantity)
      : null

  const segments = [
    `UNB+UNOC:3+${params.senderEdielId}:UTILTS+${params.receiverEdielId}:GRIDEX+${stamp}+++++23-GRIDEX-UTILTS`,
    `UNH+1+UTILTS:D:03A:UN:1.0`,
    `BGM+${params.code}+${params.externalReference}+9`,
    `RFF+TN:${params.transactionReference}`,
    `LOC+172+${params.meterPointId}`,
    `DTM+137:${periodStart}:102`,
    `DTM+163:${periodEnd}:102`,
    quantity ? `QTY+Z13:${quantity}:KWH` : null,
    `UNT+${quantity ? '8' : '7'}+1`,
    `UNZ+1+${params.externalReference}`,
  ].filter(Boolean)

  return `${segments.join("'")}'`
}

export async function prepareSwitchZ03Action(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()
  const switchRequestId = asString(formData.get('switchRequestId'))
  const communicationRouteId = asOptionalString(formData.get('communicationRouteId'))

  if (!switchRequestId) {
    throw new Error('switchRequestId saknas')
  }

  await prepareAndQueueEdielZ03({
    actorUserId,
    switchRequestId,
    communicationRouteId,
  })

  revalidateEdielSurfaces()
}

export async function prepareSwitchZ05Action(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()
  const switchRequestId = asString(formData.get('switchRequestId'))
  const communicationRouteId = asOptionalString(formData.get('communicationRouteId'))

  if (!switchRequestId) {
    throw new Error('switchRequestId saknas')
  }

  await prepareAndQueueEdielZ05({
    actorUserId,
    switchRequestId,
    communicationRouteId,
  })

  revalidateEdielSurfaces()
}

export async function prepareSwitchZ09Action(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()
  const switchRequestId = asString(formData.get('switchRequestId'))
  const communicationRouteId = asOptionalString(formData.get('communicationRouteId'))

  if (!switchRequestId) {
    throw new Error('switchRequestId saknas')
  }

  await prepareAndQueueEdielZ09({
    actorUserId,
    switchRequestId,
    communicationRouteId,
  })

  revalidateEdielSurfaces()
}

export async function prepareUtiltsE73Action(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()
  const gridOwnerDataRequestId = asString(formData.get('gridOwnerDataRequestId'))
  const communicationRouteId = asOptionalString(formData.get('communicationRouteId'))

  if (!gridOwnerDataRequestId) {
    throw new Error('gridOwnerDataRequestId saknas')
  }

  await prepareAndQueueUtiltsE73({
    actorUserId,
    gridOwnerDataRequestId,
    communicationRouteId,
  })

  revalidateEdielSurfaces()
}

export async function prepareUtiltsE66Action(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()
  const gridOwnerDataRequestId = asString(formData.get('gridOwnerDataRequestId'))
  const communicationRouteId = asOptionalString(formData.get('communicationRouteId'))
  const quantity = asNumber(formData.get('quantity'))
  const periodStart = asIsoDate(formData.get('periodStart'))
  const periodEnd = asIsoDate(formData.get('periodEnd'))
  const registrationTime = asIsoDateTimeLocal(formData.get('registrationTime'))

  if (!gridOwnerDataRequestId) {
    throw new Error('gridOwnerDataRequestId saknas')
  }

  await prepareAndQueueUtiltsE66({
    actorUserId,
    gridOwnerDataRequestId,
    communicationRouteId,
    quantity,
    periodStart,
    periodEnd,
    registrationTime,
  })

  revalidateEdielSurfaces()
}

export async function prepareAiListAction(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()

  const listType = asString(formData.get('listType')) === 'BI' ? 'BI' : 'AI'
  const customerId = asString(formData.get('customerId'))
  const siteId = asString(formData.get('siteId'))
  const meteringPointId = asOptionalString(formData.get('meteringPointId'))
  const supplierEdielId = asOptionalString(formData.get('supplierEdielId'))
  const balanceResponsibleEdielId = asOptionalString(
    formData.get('balanceResponsibleEdielId')
  )
  const receiverEdielId = asString(formData.get('receiverEdielId'))
  const receiverEmail = asOptionalString(formData.get('receiverEmail'))
  const fromDate = asString(formData.get('fromDate'))
  const toDate = asString(formData.get('toDate'))
  const communicationRouteId = asOptionalString(formData.get('communicationRouteId'))

  if (!customerId || !siteId || !receiverEdielId || !fromDate || !toDate) {
    throw new Error('AI-list kräver customerId, siteId, receiverEdielId, fromDate och toDate')
  }

  await prepareAndQueueAiList({
    actorUserId,
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

  revalidateEdielSurfaces()
}

export async function sendEdielMessageAction(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()
  const edielMessageId = asString(formData.get('edielMessageId'))

  if (!edielMessageId) {
    throw new Error('edielMessageId saknas')
  }

  await sendQueuedEdielMessage({
    actorUserId,
    edielMessageId,
  })

  revalidateEdielSurfaces()
}

export async function retryEdielMessageAction(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()
  const edielMessageId = asString(formData.get('edielMessageId'))

  if (!edielMessageId) {
    throw new Error('edielMessageId saknas')
  }

  const message = await getEdielMessageById(edielMessageId)
  if (!message) {
    throw new Error('Ediel-meddelande hittades inte')
  }

  if (message.direction !== 'outbound') {
    throw new Error('Endast outbound meddelanden kan retryas via denna action')
  }

  if (!isActiveEdielMessageFamily(message.message_family)) {
    throw new Error('Meddelandet ligger utanför aktiv release och ska inte retryas här')
  }

  if (message.status === 'failed' || message.status === 'cancelled') {
    await updateEdielMessageStatus({
      actorUserId,
      edielMessageId: message.id,
      status: 'queued',
      failureReason: null,
    })
  }

  await sendQueuedEdielMessage({
    actorUserId,
    edielMessageId: message.id,
  })

  revalidateEdielSurfaces()
}

export async function pollMailboxAction(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()
  const mailbox = asOptionalString(formData.get('mailbox'))
  const communicationRouteId = asOptionalString(formData.get('communicationRouteId'))
  const limitRaw = asNumber(formData.get('limit'))
  const limit =
    typeof limitRaw === 'number' && limitRaw > 0 ? Math.floor(limitRaw) : 10

  await pollAndIngestEdielMailbox({
    actorUserId,
    mailbox,
    communicationRouteId,
    limit,
  })

  revalidateEdielSurfaces()
}

export async function sweepOverdueAckAction() {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()
  const overdueRows = await listOverdueAckMessages({ limit: 200 })

  for (const row of overdueRows) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: row.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Ack overdue upptäckt i manuell sweep.',
      payload: {
        contrlStatus: row.contrl_status,
        aperakStatus: row.aperak_status,
        utiltsErrStatus: row.utilts_err_status,
        ackDueAt: row.ack_due_at,
      },
    })
  }

  revalidateEdielSurfaces()

  return {
    count: overdueRows.length,
  }
}

export async function createNegativeUtiltsResponseAction(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()
  const edielMessageId = asString(formData.get('edielMessageId'))
  const messageText = asOptionalString(formData.get('messageText')) ?? 'Functional error'

  if (!edielMessageId) {
    throw new Error('edielMessageId saknas')
  }

  await createNegativeUtiltsResponse({
    actorUserId,
    edielMessageId,
    messageText,
  })

  revalidateEdielSurfaces()
}

export async function createAckDraftAction(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()
  const sourceMessageId = asString(formData.get('sourceMessageId'))
  const ackType = asString(formData.get('ackType'))
  const outcome = asString(formData.get('outcome')) === 'negative' ? 'negative' : 'positive'
  const messageText = asOptionalString(formData.get('messageText'))

  if (!sourceMessageId) {
    throw new Error('sourceMessageId saknas')
  }

  const sourceMessage = await getEdielMessageById(sourceMessageId)
  if (!sourceMessage) {
    throw new Error('Källmeddelande hittades inte')
  }

  if (ackType !== 'CONTRL' && ackType !== 'APERAK') {
    throw new Error(`ACK-typ ${ackType} stöds inte i createAckDraftAction`)
  }

  const alreadyExists = await hasAckAlreadyBeenCreated({
    sourceMessageId,
    ackFamily: ackType,
    outcome,
  })

  if (alreadyExists) {
    throw new Error(`Det finns redan en ${ackType} med outcome ${outcome} för detta källmeddelande`)
  }

  if (ackType === 'CONTRL') {
    await createEdielMessage(
      buildContrlDraft({
        actorUserId,
        sourceMessage,
        outcome,
        messageText,
      })
    )
  }

  if (ackType === 'APERAK') {
    await createEdielMessage(
      buildAperakDraft({
        actorUserId,
        sourceMessage,
        outcome,
        messageText,
      })
    )
  }

  revalidateEdielSurfaces()
}

export async function createProdatDraftAction(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()
  const switchRequestId = asString(formData.get('switchRequestId'))
  const communicationRouteId = asOptionalString(formData.get('communicationRouteId'))
  const messageCode = asString(formData.get('messageCode'))

  if (!switchRequestId) {
    throw new Error('switchRequestId saknas')
  }

  if (messageCode === 'Z03') {
    await prepareAndQueueEdielZ03({
      actorUserId,
      switchRequestId,
      communicationRouteId,
    })
  } else if (messageCode === 'Z05') {
    await prepareAndQueueEdielZ05({
      actorUserId,
      switchRequestId,
      communicationRouteId,
    })
  } else if (messageCode === 'Z09') {
    await prepareAndQueueEdielZ09({
      actorUserId,
      switchRequestId,
      communicationRouteId,
    })
  } else {
    throw new Error(`PRODAT-kod ${messageCode} stöds inte`)
  }

  revalidateEdielSurfaces()
}

export async function registerInboundUtiltsAction(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()

  const messageCodeRaw = asString(formData.get('messageCode'))
  const messageCode =
    messageCodeRaw === 'S02' || messageCodeRaw === 'S03' || messageCodeRaw === 'E31'
      ? messageCodeRaw
      : 'E66'

  const senderEdielId = asOptionalString(formData.get('senderEdielId')) ?? '99999'
  const receiverEdielId = asOptionalString(formData.get('receiverEdielId')) ?? '00000'
  const quantity = asNumber(formData.get('quantity'))
  const periodStart = asIsoDateTimeLocal(formData.get('periodStart')) ?? new Date().toISOString()
  const periodEnd = asIsoDateTimeLocal(formData.get('periodEnd')) ?? new Date().toISOString()

  const externalReference = `IN-${messageCode}-${Date.now()}`
  const transactionReference = `TX-${messageCode}-${Date.now()}`
  const meterPointId = 'SELFTEST-MP'

  const rawPayload = buildSimpleInboundUtiltsRaw({
    code: messageCode,
    senderEdielId,
    receiverEdielId,
    externalReference,
    transactionReference,
    meterPointId,
    periodStart,
    periodEnd,
    quantity,
  })

  const input = buildInboundUtiltsMessageInput({
    actorUserId,
    code: messageCode,
    senderEdielId,
    receiverEdielId,
    rawPayload,
    quantity,
    periodStart,
    periodEnd,
    registrationTime: new Date().toISOString(),
    unit: 'KWH',
  })

  const fileName = inferEdielFileName({
    family: 'UTILTS',
    code: messageCode,
    direction: 'inbound',
    extension: 'edi',
  })

  await createEdielMessage({
    ...input,
    fileName,
  })

  revalidateEdielSurfaces()
}

export async function runEdielSelfTestAction(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()

  const scenario = asString(formData.get('scenario')) as EdielSelfTestScenarioCode
  const switchRequestId = asOptionalString(formData.get('switchRequestId'))
  const gridOwnerDataRequestId = asOptionalString(formData.get('gridOwnerDataRequestId'))
  const senderEdielId = asOptionalString(formData.get('senderEdielId'))
  const receiverEdielId = asOptionalString(formData.get('receiverEdielId'))
  const mailbox = asOptionalString(formData.get('mailbox'))
  const receiverEmail = asOptionalString(formData.get('receiverEmail'))

  await runEdielSelfTest({
    actorUserId,
    scenario,
    switchRequestId,
    gridOwnerDataRequestId,
    senderEdielId,
    receiverEdielId,
    mailbox,
    receiverEmail,
  })

  revalidateEdielSurfaces()
}

export async function createEdielTestRunAction(formData: FormData) {
  await requirePermissionServer('communication.read')

  const actorUserId = await getActorUserId()

  const testSuite = asString(formData.get('testSuite'))
  const roleCode = asString(formData.get('roleCode'))
  const testCaseCode = asString(formData.get('testCaseCode'))
  const title = asOptionalString(formData.get('title'))
  const approvalVersion = asOptionalString(formData.get('approvalVersion'))
  const notes = asOptionalString(formData.get('notes'))

  if (!testSuite || !roleCode || !testCaseCode) {
    throw new Error('testSuite, roleCode och testCaseCode krävs')
  }

  await createEdielTestRun({
    actorUserId,
    testSuite: testSuite as 'PRODAT' | 'UTILTS' | 'AI_LIST',
    roleCode: roleCode as 'supplier' | 'grid_owner' | 'balance_responsible' | 'esco',
    testCaseCode,
    title,
    approvalVersion,
    notes,
    status: 'draft',
  })

  revalidateEdielSurfaces()
}