'use server'

import { revalidatePath } from 'next/cache'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  createAckDraftForMessage,
  createNegativeUtiltsResponse,
  pollAndIngestEdielMailbox,
  prepareAndQueueAiList,
  prepareAndQueueEdielZ03,
  prepareAndQueueEdielZ04,
  prepareAndQueueEdielZ05,
  prepareAndQueueEdielZ06,
  prepareAndQueueEdielZ09,
  prepareAndQueueEdielZ10,
  prepareAndQueueUtiltsE66,
  prepareAndQueueUtiltsE73,
  sendQueuedEdielMessage,
} from '@/lib/ediel/orchestrator'
import type { AckFamily, AckOutcome } from '@/lib/ediel/ack'
import { registerInboundCanonicalMessage } from '@/lib/ediel/core/kernel'
import {
  attachEdielMessageToTestRun,
  createEdielMessage,
  createEdielTestRun,
  getEdielMessageById,
  listEdielTestRuns,
  updateEdielMessageStatus,
  updateEdielTestRunStatus,
} from '@/lib/ediel/db'
import { runEdielSelfTest } from '@/lib/ediel/selftest'
import { buildInboundUtiltsMessageInput } from '@/lib/ediel/utilts'
import {
  buildProdatZ03FromSwitch,
  buildProdatZ04FromSwitch,
  buildProdatZ05FromSwitch,
  buildProdatZ06FromSwitch,
  buildProdatZ09FromSwitch,
  buildProdatZ10FromSwitch,
  isProdatSwitchCode,
  type ProdatSwitchCode,
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
import { registerEdielFile, type EdielFileEngineMode } from '@/lib/ediel/fileEngine'
import { getEdielTgtTestCaseByCode } from '@/lib/ediel/tgtRegistry'
import { buildEdielTgtDraft } from '@/lib/ediel/tgtEdifact'
import {
  autoAttachImportedMessageToActiveTgtRun,
  createMockPortalMessageForNextStep,
  runTgtAutopilotForRun,
} from '@/lib/ediel/tgtAutopilot'
import { processEdielOperationalMessage } from '@/lib/ediel/operationalBridge'
import { createEdielPortalTestCustomerGraph } from '@/lib/ediel/portalTestCustomer'
import { createSafeMasterdataProposalForMessage } from '@/lib/ediel/operationalVerification'
import { approveSafeMasterdataChanges, rejectSafeMasterdataChanges } from '@/lib/ediel/safeApplyReview'
import type { EdielEnvironment, EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'

function formString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function formFileText(value: FormDataEntryValue | null): Promise<{ text: string | null; fileName: string | null }> {
  if (!value || typeof value === 'string') return { text: null, fileName: null }

  const maybeFile = value as unknown as {
    arrayBuffer?: () => Promise<ArrayBuffer>
    name?: string
    size?: number
  }

  if (!maybeFile.arrayBuffer || (maybeFile.size ?? 0) <= 0) {
    return { text: null, fileName: null }
  }

  const buffer = await maybeFile.arrayBuffer()
  return {
    text: new TextDecoder('utf-8').decode(buffer),
    fileName: typeof maybeFile.name === 'string' ? maybeFile.name : null,
  }
}

function parseFileEngineMode(value: FormDataEntryValue | null): EdielFileEngineMode {
  const raw = formString(value)
  if (raw === 'internal_test' || raw === 'production_dry_run') return raw
  return 'tgt'
}

function parseDirection(value: FormDataEntryValue | null): 'inbound' | 'outbound' {
  return formString(value) === 'outbound' ? 'outbound' : 'inbound'
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

function getProdatDraftBuilder(messageCode: ProdatSwitchCode) {
  if (messageCode === 'Z03') return buildProdatZ03FromSwitch
  if (messageCode === 'Z04') return buildProdatZ04FromSwitch
  if (messageCode === 'Z05') return buildProdatZ05FromSwitch
  if (messageCode === 'Z06') return buildProdatZ06FromSwitch
  if (messageCode === 'Z09') return buildProdatZ09FromSwitch
  return buildProdatZ10FromSwitch
}

function revalidateEdiel(messageId?: string | null) {
  revalidatePath('/admin/ediel')
  revalidatePath('/admin/ediel/ai-list')
  revalidatePath('/admin/ediel/control-tower')
  revalidatePath('/admin/ediel/routes')
  revalidatePath('/admin/ediel/settings')
  revalidatePath('/admin/outbound')
  if (messageId) revalidatePath(`/admin/ediel/messages/${messageId}`)
}

async function revalidateRelatedMessage(messageId?: string | null) {
  if (!messageId) return
  const message = await getEdielMessageById(messageId)
  if (!message) return

  if (message.related_message_id) {
    revalidatePath(`/admin/ediel/messages/${message.related_message_id}`)
  }

  if (message.outbound_request_id) {
    revalidatePath('/admin/outbound')
  }

  revalidateEdiel(message.id)
}

export async function cancelEdielMessageAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const edielMessageId = formString(formData.get('edielMessageId'))
  const reason = formString(formData.get('reason')) ?? 'Dold/raderad från admin av användare.'

  if (!edielMessageId) throw new Error('edielMessageId saknas')

  await updateEdielMessageStatus({
    actorUserId: context.userId,
    edielMessageId,
    status: 'cancelled',
    failureReason: reason,
  })

  await revalidateRelatedMessage(edielMessageId)
  revalidateEdiel(edielMessageId)
}

export async function sendEdielMessageAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const edielMessageId = formString(formData.get('edielMessageId'))
  const smtpMimeMode = formString(formData.get('smtpMimeMode'))

  if (!edielMessageId) throw new Error('edielMessageId saknas')

  await sendQueuedEdielMessage({
    actorUserId: context.userId,
    edielMessageId,
    smtpMimeMode,
  })

  await revalidateRelatedMessage(edielMessageId)
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

export async function registerEdielFileAction(formData: FormData) {
  const context = await requireAnyPermissionServer(["communication.write", "communication.read"])

  const uploaded = await formFileText(formData.get("edielFile"))
  const pastedPayload = formString(formData.get("rawPayload"))
  const rawPayload = uploaded.text ?? pastedPayload

  if (!rawPayload) {
    throw new Error("Ladda upp en fil eller klistra in EDIFACT/CSV-innehåll.")
  }

  const message = await registerEdielFile({
    actorUserId: context.userId,
    direction: parseDirection(formData.get("direction")),
    mode: parseFileEngineMode(formData.get("mode")),
    rawPayload,
    fileName: uploaded.fileName,
    mailbox: formString(formData.get("mailbox")) ?? "file-engine",
    mailboxMessageId: formString(formData.get("mailboxMessageId")),
    senderEmail: formString(formData.get("senderEmail")),
    receiverEmail: formString(formData.get("receiverEmail")),
    subject: formString(formData.get("subject")),
  })

  const createdMessage = await getEdielMessageById(message.id)
  if (createdMessage) {
    const autoAttachResult = await autoAttachImportedMessageToActiveTgtRun({
      edielMessage: createdMessage,
    })

    if (autoAttachResult) {
      await runTgtAutopilotForRun({
        actorUserId: context.userId,
        testRunId: autoAttachResult.testRunId,
      })
    }
  }

  await revalidateRelatedMessage(message.id)
  revalidateEdiel(message.id)
}

export async function createEdielTgtRunFromTemplateAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const testSuite = parseEdielTestSuite(formData.get('testSuite'))
  const roleCode = parseEdielTestRoleCode(formData.get('roleCode'))
  const testCaseCode = formString(formData.get('testCaseCode')) ?? ''
  const definition = getEdielTgtTestCaseByCode(testSuite, roleCode, testCaseCode)

  if (!definition) {
    throw new Error(`Okänt TGT-testfall: ${testSuite}/${roleCode}/${testCaseCode}`)
  }

  const testRun = await createEdielTestRun({
    actorUserId: context.userId,
    testSuite: definition.suite,
    roleCode: definition.roleCode,
    testCaseCode: definition.testCaseCode,
    title: definition.title,
    approvalVersion: definition.approvalVersion,
    notes: [
      definition.purpose,
      `Testdata: ${definition.testDataHint}`,
      ...definition.notes,
      'Autopilot: första Gridex-fil skapas automatiskt om första steget ägs av Gridex.',
    ].join('\n'),
    status: 'running',
    startedAt: new Date().toISOString(),
  })

  await runTgtAutopilotForRun({
    actorUserId: context.userId,
    testRunId: testRun.id,
  })

  revalidateEdiel()
}


export async function attachEdielMessageToTestRunAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const testRunId = formString(formData.get('testRunId'))
  const edielMessageId = formString(formData.get('edielMessageId'))
  const stepNo = formNumber(formData.get('stepNo'))
  const expectedDirection = parseDirection(formData.get('expectedDirection'))
  const expectedFamily = formString(formData.get('expectedFamily'))
  const expectedCode = formString(formData.get('expectedCode'))

  if (!testRunId) throw new Error('testRunId saknas')
  if (!edielMessageId) throw new Error('Välj ett Ediel-meddelande att koppla')

  await attachEdielMessageToTestRun({
    testRunId,
    edielMessageId,
    stepNo,
    expectedDirection,
    expectedFamily,
    expectedCode,
  })

  await revalidateRelatedMessage(edielMessageId)
  revalidateEdiel()
}

export async function createEdielTgtDraftAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const testSuite = parseEdielTestSuite(formData.get('testSuite'))
  const roleCode = parseEdielTestRoleCode(formData.get('roleCode'))
  const testCaseCode = formString(formData.get('testCaseCode')) ?? ''
  const stepNo = formNumber(formData.get('stepNo'))
  const testRunId = formString(formData.get('testRunId'))

  if (!stepNo) throw new Error('Välj vilket TGT-steg som ska genereras')

  const draft = buildEdielTgtDraft({
    actorUserId: context.userId,
    testSuite,
    roleCode,
    testCaseCode,
    stepNo,
  })

  const message = await createEdielMessage(draft.messageInput)

  if (testRunId) {
    await attachEdielMessageToTestRun({
      testRunId,
      edielMessageId: message.id,
      stepNo: draft.step.stepNo,
      expectedDirection: draft.step.direction,
      expectedFamily: draft.step.family,
      expectedCode: draft.step.code,
    })
  }

  await revalidateRelatedMessage(message.id)
  revalidateEdiel(message.id)
}

export async function runEdielTgtAutopilotAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const testRunId = formString(formData.get('testRunId'))

  if (!testRunId) throw new Error('testRunId saknas')

  await runTgtAutopilotForRun({
    actorUserId: context.userId,
    testRunId,
  })

  revalidateEdiel()
}

export async function createMockPortalMessageForNextTgtStepAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const testRunId = formString(formData.get('testRunId'))

  if (!testRunId) throw new Error('testRunId saknas')

  const result = await createMockPortalMessageForNextStep({
    actorUserId: context.userId,
    testRunId,
  })

  await revalidateRelatedMessage(result.messageId)
  revalidateEdiel(result.messageId)
}


export async function markEdielTgtRunStatusAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const testRunId = formString(formData.get('testRunId'))
  const statusRaw = formString(formData.get('status'))
  const failureReason = formString(formData.get('failureReason'))

  if (!testRunId) throw new Error('testRunId saknas')
  if (statusRaw !== 'running' && statusRaw !== 'passed' && statusRaw !== 'failed' && statusRaw !== 'cancelled') {
    throw new Error('Ogiltig TGT-status')
  }

  await updateEdielTestRunStatus({
    actorUserId: context.userId,
    testRunId,
    status: statusRaw,
    failureReason,
    completedAt: statusRaw === 'passed' || statusRaw === 'failed' || statusRaw === 'cancelled'
      ? new Date().toISOString()
      : null,
  })

  revalidateEdiel()
}
export async function archiveEdielTgtRunAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const testRunId = formString(formData.get('testRunId'))
  const reason = formString(formData.get('reason')) ?? 'Arkiverad från TGT workbench.'

  if (!testRunId) throw new Error('testRunId saknas')

  await updateEdielTestRunStatus({
    actorUserId: context.userId,
    testRunId,
    status: 'cancelled',
    failureReason: reason,
    completedAt: new Date().toISOString(),
  })

  revalidateEdiel()
}

export async function archiveOlderEdielTgtRunsForCaseAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const keepTestRunId = formString(formData.get('keepTestRunId'))
  const testSuite = parseEdielTestSuite(formData.get('testSuite'))
  const roleCode = parseEdielTestRoleCode(formData.get('roleCode'))
  const testCaseCode = formString(formData.get('testCaseCode'))

  if (!keepTestRunId) throw new Error('keepTestRunId saknas')
  if (!testCaseCode) throw new Error('testCaseCode saknas')

  const runs = await listEdielTestRuns()
  const sameCaseRuns = runs.filter((run) =>
    run.id !== keepTestRunId &&
    run.status !== 'cancelled' &&
    run.test_suite === testSuite &&
    run.role_code === roleCode &&
    run.test_case_code === testCaseCode
  )

  await Promise.all(
    sameCaseRuns.map((run) =>
      updateEdielTestRunStatus({
        actorUserId: context.userId,
        testRunId: run.id,
        status: 'cancelled',
        failureReason: `Arkiverad automatiskt från TGT workbench. Nyare/vald run behölls: ${keepTestRunId}.`,
        completedAt: new Date().toISOString(),
      })
    )
  )

  revalidateEdiel()
}

export async function processEdielOperationalMessageAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const edielMessageId = formString(formData.get('edielMessageId'))

  if (!edielMessageId) throw new Error('edielMessageId saknas')

  await processEdielOperationalMessage({
    actorUserId: context.userId,
    edielMessageId,
  })

  await revalidateRelatedMessage(edielMessageId)
  revalidateEdiel(edielMessageId)
}

export async function createSafeMasterdataProposalAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const edielMessageId = formString(formData.get('edielMessageId'))

  if (!edielMessageId) throw new Error('edielMessageId saknas')

  await createSafeMasterdataProposalForMessage({
    actorUserId: context.userId,
    edielMessageId,
  })

  await revalidateRelatedMessage(edielMessageId)
  revalidateEdiel(edielMessageId)
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
  await revalidateRelatedMessage(ackMessage.id)
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
  await revalidateRelatedMessage(ackMessage.id)
}

export async function createProdatDraftAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const switchRequestId = formString(formData.get('switchRequestId'))
  const communicationRouteId = formString(formData.get('communicationRouteId'))
  const messageCodeRaw = formString(formData.get('messageCode'))
  const messageCode = isProdatSwitchCode(messageCodeRaw) ? messageCodeRaw : null

  if (!switchRequestId) throw new Error('switchRequestId saknas')
  if (!messageCode) {
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

  const draftBuilder = getProdatDraftBuilder(messageCode)

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
    routeDefaultMessageVersion: routeContext.defaultMessageVersion,
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

  await revalidateRelatedMessage(message.id)
}


async function cancelSupersededSwitchProdatDrafts(params: {
  actorUserId: string
  switchRequestId: string
  messageCode: ProdatSwitchCode
}) {
  const supabase = await makeServerClient()
  const { data, error } = await supabase
    .from('ediel_messages')
    .select('id,status,message_family,message_code,external_reference,created_at')
    .eq('switch_request_id', params.switchRequestId)
    .eq('direction', 'outbound')
    .eq('message_family', 'PRODAT')
    .eq('message_code', params.messageCode)
    .in('status', ['draft', 'prepared', 'queued', 'failed'])
    .order('created_at', { ascending: false })

  if (error) throw error

  const rows = (data ?? []) as Array<{ id: string; status: string | null }>

  for (const row of rows) {
    await updateEdielMessageStatus({
      actorUserId: params.actorUserId,
      edielMessageId: row.id,
      status: 'cancelled',
      failureReason:
        'Automatiskt avbrutet innan nytt PRODAT-utkast skapades. Ej skickat utkast ska inte återanvändas efter ändrat underlag eller generatorfix.',
    })
  }
}

async function prepareSwitchProdatAction(formData: FormData, messageCode: ProdatSwitchCode) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const switchRequestId = formString(formData.get('switchRequestId'))
  const communicationRouteId = formString(formData.get('communicationRouteId'))
  const environment = (formString(formData.get('environment')) === 'production' ? 'production' : 'test') as EdielEnvironment
  const forceRegenerate = formString(formData.get('forceRegenerate')) === 'true'
  if (!switchRequestId) throw new Error('switchRequestId saknas')

  if (forceRegenerate) {
    await cancelSupersededSwitchProdatDrafts({
      actorUserId: context.userId,
      switchRequestId,
      messageCode,
    })
  }

  const params = {
    actorUserId: context.userId,
    switchRequestId,
    communicationRouteId,
    environment,
    forceRegenerate,
  }

  const message =
    messageCode === 'Z03'
      ? await prepareAndQueueEdielZ03(params)
      : messageCode === 'Z04'
        ? await prepareAndQueueEdielZ04(params)
        : messageCode === 'Z05'
          ? await prepareAndQueueEdielZ05(params)
          : messageCode === 'Z06'
            ? await prepareAndQueueEdielZ06(params)
            : messageCode === 'Z09'
              ? await prepareAndQueueEdielZ09(params)
              : await prepareAndQueueEdielZ10(params)

  await revalidateRelatedMessage(message.id)
}

export async function createEdielPortalTestCustomerAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['masterdata.write', 'switching.write', 'communication.write', 'communication.read'])
  const testSuite = parseEdielTestSuite(formData.get('testSuite'))
  const roleCode = parseEdielTestRoleCode(formData.get('roleCode'))
  const testCaseCode = formString(formData.get('testCaseCode'))
  const agreementStartDateTime = formString(formData.get('agreementStartDateTime'))
  const powerOfAttorneyReference = formString(formData.get('powerOfAttorneyReference'))
  const balanceResponsibleId = formString(formData.get('balanceResponsibleId'))
  const priceAreaCode = formString(formData.get('priceAreaCode'))

  if (!testCaseCode) throw new Error('testCaseCode saknas')

  const supabase = await makeServerClient()
  const result = await createEdielPortalTestCustomerGraph(supabase, {
    actorUserId: context.userId,
    testSuite,
    roleCode,
    testCaseCode,
    agreementStartDateTime,
    powerOfAttorneyReference,
    powerOfAttorneyStatus: formString(formData.get('powerOfAttorneyStatus')) as 'draft' | 'sent' | 'signed' | 'expired' | 'revoked' | null,
    balanceResponsibleId,
    priceAreaCode,
    customerFirstName: formString(formData.get('customerFirstName')),
    customerLastName: formString(formData.get('customerLastName')),
    customerName: formString(formData.get('customerName')),
    customerPersonalNumber: formString(formData.get('customerPersonalNumber')),
    customerBirthDate: formString(formData.get('customerBirthDate')),
    customerEmail: formString(formData.get('customerEmail')),
    customerPhone: formString(formData.get('customerPhone')),
    customerAddress: formString(formData.get('customerAddress')),
    customerPostalCode: formString(formData.get('customerPostalCode')),
    customerCity: formString(formData.get('customerCity')),
    customerCountry: formString(formData.get('customerCountry')),
    billingRecipientId: formString(formData.get('billingRecipientId')),
    billingRecipientName: formString(formData.get('billingRecipientName')),
    billingRecipientAddress: formString(formData.get('billingRecipientAddress')),
    billingRecipientPostalCode: formString(formData.get('billingRecipientPostalCode')),
    billingRecipientCity: formString(formData.get('billingRecipientCity')),
    billingRecipientCountry: formString(formData.get('billingRecipientCountry')),
    billingRecipientEmail: formString(formData.get('billingRecipientEmail')),
    billingRecipientPhone: formString(formData.get('billingRecipientPhone')),
    facilityId: formString(formData.get('facilityId')),
    siteAddress: formString(formData.get('siteAddress')),
    sitePostalCode: formString(formData.get('sitePostalCode')),
    siteCity: formString(formData.get('siteCity')),
    siteCountry: formString(formData.get('siteCountry')),
    gridAreaId: formString(formData.get('gridAreaId')),
    annualEnergyKwh: formString(formData.get('annualEnergyKwh')),
    annualEnergyUnit: formString(formData.get('annualEnergyUnit')),
    meteringMethod: formString(formData.get('meteringMethod')),
    reportingFrequency: formString(formData.get('reportingFrequency')),
    meterNumber: formString(formData.get('meterNumber')),
    productCode: formString(formData.get('productCode')),
    settlementMethod: formString(formData.get('settlementMethod')),
    installationStatus: formString(formData.get('installationStatus')),
    tariffCode: formString(formData.get('tariffCode')),
    priority: formString(formData.get('priority')),
    register1AnnualEnergyKwh: formString(formData.get('register1AnnualEnergyKwh')),
    register1MeterConstant: formString(formData.get('register1MeterConstant')),
    register1MeterDigits: formString(formData.get('register1MeterDigits')),
    register1MeterTimeInterval: formString(formData.get('register1MeterTimeInterval')),
    register1Resolution: formString(formData.get('register1Resolution')),
    register2AnnualEnergyKwh: formString(formData.get('register2AnnualEnergyKwh')),
    register2MeterConstant: formString(formData.get('register2MeterConstant')),
    register2MeterDigits: formString(formData.get('register2MeterDigits')),
    register2MeterTimeInterval: formString(formData.get('register2MeterTimeInterval')),
    register2Resolution: formString(formData.get('register2Resolution')),
  })

  revalidatePath('/admin/customers')
  revalidatePath(`/admin/customers/${result.customerId}`)
  revalidatePath('/admin/operations/switches')
  revalidatePath(`/admin/operations/switches/${result.switchRequestId}`)
  revalidateEdiel()
}

export async function prepareSwitchZ03Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, 'Z03')
}

export async function prepareSwitchZ04Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, 'Z04')
}

export async function prepareSwitchZ05Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, 'Z05')
}

export async function prepareSwitchZ06Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, 'Z06')
}

export async function prepareSwitchZ09Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, 'Z09')
}

export async function prepareSwitchZ10Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, 'Z10')
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

  await revalidateRelatedMessage(message.id)
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

  await revalidateRelatedMessage(message.id)
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

  await revalidateRelatedMessage(message.id)
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
      'UNH+1+UTILTS:D:03A:UN:E5SE5A',
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

  await revalidateRelatedMessage(message.id)
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

export async function approveEdielSafeApplyAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const edielMessageId = formString(formData.get('edielMessageId'))
  if (!edielMessageId) throw new Error('edielMessageId saknas')

  await approveSafeMasterdataChanges({
    actorUserId: context.userId,
    edielMessageId,
  })

  await revalidateRelatedMessage(edielMessageId)
}

export async function rejectEdielSafeApplyAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const edielMessageId = formString(formData.get('edielMessageId'))
  if (!edielMessageId) throw new Error('edielMessageId saknas')

  await rejectSafeMasterdataChanges({
    actorUserId: context.userId,
    edielMessageId,
    reason: formString(formData.get('reason')),
  })

  await revalidateRelatedMessage(edielMessageId)
}

export async function processEdielUtiltsBillingAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const edielMessageId = formString(formData.get('edielMessageId'))
  if (!edielMessageId) throw new Error('edielMessageId saknas')

  await processInboundUtiltsMessage({
    actorUserId: context.userId,
    edielMessageId,
  })

  await revalidateRelatedMessage(edielMessageId)
}
