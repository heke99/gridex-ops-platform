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
import type { AckFamily, AckOutcome, EdielAperakApplicationError } from '@/lib/ediel/ack'
import { registerInboundCanonicalMessage } from '@/lib/ediel/core/kernel'
import {
  attachEdielMessageToTestRun,
  createEdielMessage,
  createEdielMessageEvent,
  createEdielTestRun,
  getEdielMessageById,
  listAckMessagesForSource,
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
import type { EdielTgtCaseTestData } from '@/lib/ediel/tgtTestData'
import { buildEdielTgtDraft } from '@/lib/ediel/tgtEdifact'
import {
  getEdielTgtDynamicTestDataForCase,
  listEdielTgtDynamicTestData,
  upsertEdielTgtDynamicTestData,
  type EdielTgtDynamicTestDataSummary,
} from '@/lib/ediel/tgtTestDataStore'
import { resolveRecommendedAckForInboundMessage } from '@/lib/ediel/core/ackDecisionEngine'
import { findBestTgtTestDataForMessage } from '@/lib/ediel/core/tgtAutoMatcher'
import {
  attachAperakErrorDetailsToMessage,
  resolveAndStoreProdatAperakErrors,
} from '@/lib/ediel/core/aperakErrorRuleRegistry'
import { parseEdielTgtUploadedTestDataFile } from '@/lib/ediel/tgtTestDataFileImport'
import {
  autoAttachImportedMessageToActiveTgtRun,
  createMockPortalMessageForNextStep,
  runTgtAutopilotForRun,
} from '@/lib/ediel/tgtAutopilot'
import { processEdielOperationalMessage } from '@/lib/ediel/operationalBridge'
import { createEdielPortalTestCustomerGraph } from '@/lib/ediel/portalTestCustomer'
import { createSafeMasterdataProposalForMessage } from '@/lib/ediel/operationalVerification'
import { approveSafeMasterdataChanges, rejectSafeMasterdataChanges } from '@/lib/ediel/safeApplyReview'
import type { EdielEnvironment, EdielMessageRow, EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'
import { approveEdielInboundCase, rejectEdielInboundCase, type EdielInboundCaseActionMode } from '@/lib/ediel/inboundCases'
import { supabaseService } from '@/lib/supabase/service'

function formString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
  )
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

  const fileName = typeof maybeFile.name === 'string' ? maybeFile.name : null
  const parsed = parseEdielTgtUploadedTestDataFile({
    bytes: await maybeFile.arrayBuffer(),
    fileName,
  })

  return {
    text: parsed.text,
    fileName: parsed.fileName,
  }
}


function isFormFileLike(value: FormDataEntryValue | null): boolean {
  if (!value || typeof value === 'string') return false

  const maybeFile = value as unknown as {
    arrayBuffer?: () => Promise<ArrayBuffer>
    size?: number
  }

  return typeof maybeFile.arrayBuffer === 'function' && Number(maybeFile.size ?? 0) > 0
}

async function formFilesText(values: FormDataEntryValue[]): Promise<{ text: string | null; fileNames: string[] }> {
  const parts: string[] = []
  const fileNames: string[] = []

  for (const value of values) {
    const uploaded = await formFileText(value)
    if (uploaded.text) parts.push(uploaded.text)
    if (uploaded.fileName) fileNames.push(uploaded.fileName)
  }

  return {
    text: parts.length > 0 ? parts.join('\n\n') : null,
    fileNames,
  }
}

function collectTestDataFileEntries(formData: FormData): FormDataEntryValue[] {
  const explicitNames = [
    'testDataFile',
    'testDataFiles',
    'testDataFile[]',
    'file',
    'files',
    'upload',
  ]

  const seen = new Set<FormDataEntryValue>()
  const values: FormDataEntryValue[] = []

  for (const name of explicitNames) {
    for (const value of formData.getAll(name)) {
      if (!isFormFileLike(value) || seen.has(value)) continue
      seen.add(value)
      values.push(value)
    }
  }

  for (const value of Array.from(formData.values())) {
    if (!isFormFileLike(value) || seen.has(value)) continue
    seen.add(value)
    values.push(value)
  }

  return values
}

function describeReceivedUploadFields(formData: FormData): string {
  const fileEntries = Array.from(formData.entries())
    .map(([name, value]) => {
      if (typeof value === 'string') return null
      const maybeFile = value as unknown as { name?: string; size?: number; type?: string }
      return `${name}: ${maybeFile.name ?? 'namnlös fil'} (${maybeFile.size ?? 0} bytes${maybeFile.type ? `, ${maybeFile.type}` : ''})`
    })
    .filter(Boolean) as string[]

  return fileEntries.length > 0 ? fileEntries.join(' | ') : 'inga filfält mottogs av server action'
}


type EncodedInboundUploadFile = {
  fileName?: unknown
  type?: unknown
  size?: unknown
  base64?: unknown
}

function arrayBufferFromBase64(value: string): ArrayBuffer {
  const buffer = Buffer.from(value, 'base64')
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

async function encodedUploadFilesText(value: FormDataEntryValue | null): Promise<{ text: string | null; fileNames: string[] }> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { text: null, fileNames: [] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Uppladdad fil kunde inte läsas: encoded upload JSON är ogiltig.')
  }

  const files = Array.isArray(parsed) ? parsed : []
  const parts: string[] = []
  const fileNames: string[] = []

  for (const entry of files as EncodedInboundUploadFile[]) {
    const base64 = typeof entry.base64 === 'string' ? entry.base64 : ''
    if (!base64) continue

    const fileName = typeof entry.fileName === 'string' && entry.fileName.trim().length > 0 ? entry.fileName.trim() : null
    const parsedFile = parseEdielTgtUploadedTestDataFile({
      bytes: arrayBufferFromBase64(base64),
      fileName,
    })

    if (parsedFile.text.trim().length > 0) parts.push(parsedFile.text.trim())
    if (parsedFile.fileName) fileNames.push(parsedFile.fileName)
  }

  return {
    text: parts.length > 0 ? parts.join('\n\n') : null,
    fileNames,
  }
}

function mergeUploadedFileResults(...items: Array<{ text: string | null; fileNames: string[] }>): { text: string | null; fileNames: string[] } {
  const text = items
    .map((item) => item.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')

  return {
    text: text.length > 0 ? text : null,
    fileNames: items.flatMap((item) => item.fileNames),
  }
}

function inferInboundTgtTestCaseCode(input: {
  provided?: string | null
  title?: string | null
  rawText?: string | null
  fileNames?: string[]
  messageCode?: string | null
}): string {
  const provided = input.provided?.trim()
  if (provided) return provided

  const haystack = [input.title, input.rawText, ...(input.fileNames ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  const explicit = haystack.match(/\b(u?\d+(?:\.\d+){1,2}[a-z]?)\b/i)?.[1]
  if (explicit) return explicit.toUpperCase().startsWith('U') ? explicit.toUpperCase() : explicit

  if (haystack.includes('felaktigt anlaggningsid') || haystack.includes('anlaggningen kan inte identifieras')) return '2.2.1'
  if (haystack.includes('antal siffror')) return '2.2.2'
  if (haystack.includes('konstant saknas')) return '2.4.2'
  if (haystack.includes('matarbyte') || haystack.includes('mätarbyte')) return '2.3.1'

  const code = String(input.messageCode ?? '').toUpperCase()
  if (code === 'Z06') return '2.1.1'
  if (code === 'Z10') return '2.3.1'
  if (code === 'Z09') return '2.5.1'
  if (code === 'Z05') return '3.1.1'
  return ''
}

async function resolveTgtTestDataForAckAction(params: {
  message: EdielMessageRow
  testSuite: EdielTestSuite
  roleCode: EdielTestRoleCode
  requestedTestCaseCode: string | null
}): Promise<{ testData: EdielTgtCaseTestData | null; selectedRow: EdielTgtDynamicTestDataSummary | null; requestedTestData: EdielTgtCaseTestData | null }> {
  const { message, testSuite, roleCode, requestedTestCaseCode } = params
  const requestedTestData = requestedTestCaseCode
    ? await getEdielTgtDynamicTestDataForCase(testSuite, roleCode, requestedTestCaseCode)
    : null

  if (message.message_family !== 'PRODAT' && message.message_family !== 'UTILTS') {
    return { testData: requestedTestData, selectedRow: null, requestedTestData }
  }

  const rows = (await listEdielTgtDynamicTestData()).filter((row) => row.testSuite === testSuite && row.roleCode === roleCode)
  const best = findBestTgtTestDataForMessage(message, rows)

  if (!best) return { testData: requestedTestData, selectedRow: null, requestedTestData }

  // The backend must not blindly trust a stale hidden UI row. When the actual
  // inbound payload matches another imported TGT row better, use that row as the
  // masterdata simulator for validation. This keeps production logic generic:
  // identity validation first, then detail validation only when identity is OK.
  return { testData: best.parsedPayload, selectedRow: best, requestedTestData }
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

function formStringList(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)
}

function collectAperakApplicationErrors(formData: FormData): EdielAperakApplicationError[] | null {
  const ercCodes = formStringList(formData, 'aperakErrorErc')
  const fieldCodes = formStringList(formData, 'aperakErrorFieldCode')
  const texts = formStringList(formData, 'aperakErrorText')
  const referenceQualifiers = formStringList(formData, 'aperakErrorReferenceQualifier')
  const referenceNumbers = formStringList(formData, 'aperakErrorReferenceNumber')
  const lineItemReferences = formStringList(formData, 'aperakErrorLineItemReference')
  const max = Math.max(
    ercCodes.length,
    fieldCodes.length,
    texts.length,
    referenceQualifiers.length,
    referenceNumbers.length,
    lineItemReferences.length
  )
  const errors: EdielAperakApplicationError[] = []

  for (let index = 0; index < max; index += 1) {
    const ercCode = ercCodes[index] ?? ercCodes[0] ?? ''
    const text = texts[index] ?? ''
    if (!ercCode || !text) continue
    errors.push({
      ercCode,
      fieldCode: fieldCodes[index] ?? null,
      text,
      referenceQualifier: referenceQualifiers[index] ?? null,
      referenceNumber: referenceNumbers[index] ?? null,
      lineItemReference: lineItemReferences[index] ?? null,
    })
  }

  return errors.length > 0 ? errors : null
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
  if (!edielMessageId) throw new Error('edielMessageId saknas')

  await sendQueuedEdielMessage({
    actorUserId: context.userId,
    edielMessageId,
    smtpMimeMode: 'ediel-singlepart-base64',
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


export async function saveEdielTgtPortalTestDataAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const testSuite = parseEdielTestSuite(formData.get('testSuite'))
  const roleCode = parseEdielTestRoleCode(formData.get('roleCode'))
  const testCaseCode = formString(formData.get('testCaseCode')) ?? ''
  const title = formString(formData.get('title'))
  const pastedText = formString(formData.get('rawText')) ?? ''
  const uploaded = await formFilesText(formData.getAll('testDataFile'))
  // Keep pasted text first when both text and files exist. This preserves the
  // visible order the admin copied from Edielportalen, while uploaded files can
  // fill missing fields through dedupe without changing sourceOrder.
  const rawText = [pastedText, uploaded.text].filter(Boolean).join('\n\n')

  if (!testCaseCode) throw new Error('testCaseCode saknas')
  if (!rawText) {
    throw new Error('Klistra in testdata från Edielportalen eller ladda upp Excel/CSV innan du sparar.')
  }

  await upsertEdielTgtDynamicTestData({
    suite: testSuite,
    roleCode,
    testCaseCode,
    title: uploaded.fileNames.length > 0 ? `${title ?? `TGT ${testCaseCode}`} · ${uploaded.fileNames.join(', ')}` : title,
    rawText,
    actorUserId: context.userId,
  })

  revalidateEdiel()
}


export async function saveEdielInboundMessageTestDataAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const sourceMessageId = formString(formData.get('sourceMessageId'))
  const testSuite = parseEdielTestSuite(formData.get('testSuite'))
  const roleCode = parseEdielTestRoleCode(formData.get('roleCode'))
  const title = formString(formData.get('title'))
  const pastedText = formString(formData.get('rawText')) ?? ''
  const nativeUploaded = await formFilesText(collectTestDataFileEntries(formData))
  const encodedUploaded = await encodedUploadFilesText(formData.get('uploadedFilesJson'))
  const uploaded = mergeUploadedFileResults(nativeUploaded, encodedUploaded)
  const uploadedText = [pastedText, uploaded.text].filter(Boolean).join('\n\n').trim()

  if (!sourceMessageId) throw new Error('sourceMessageId saknas')
  if (!uploadedText) {
    throw new Error(
      `Klistra in testdata eller ladda upp Excel/CSV från Edielportalen. Servern tog emot: ${describeReceivedUploadFields(formData)}.`
    )
  }

  const sourceMessage = await getEdielMessageById(sourceMessageId)
  if (!sourceMessage) throw new Error('Källmeddelande hittades inte')

  const testCaseCode = inferInboundTgtTestCaseCode({
    provided: formString(formData.get('testCaseCode')),
    title,
    rawText: uploadedText,
    fileNames: uploaded.fileNames,
    messageCode: sourceMessage.message_code,
  })
  if (!testCaseCode) throw new Error('Kunde inte avgöra testfall från filnamn, rubrik eller meddelandekod. Ange testfall som override.')

  const rawText = [
    `GRIDCORE_SOURCE_MESSAGE_ID:${sourceMessageId}`,
    `GRIDCORE_SOURCE_MESSAGE_CODE:${sourceMessage.message_code ?? ''}`,
    uploadedText,
  ].join('\n')

  const saved = await upsertEdielTgtDynamicTestData({
    suite: testSuite,
    roleCode,
    testCaseCode,
    title: uploaded.fileNames.length > 0 ? `${title ?? `TGT ${testCaseCode}`} · ${uploaded.fileNames.join(', ')}` : title,
    rawText,
    actorUserId: context.userId,
  })

  await createEdielMessageEvent({
    actorUserId: context.userId,
    edielMessageId: sourceMessageId,
    eventType: 'manual_note',
    eventStatus: 'success',
    message: `TGT-testdata ${testCaseCode} sparad och kan användas av backendbeslutet för detta inbound-meddelande.`,
    payload: {
      testSuite,
      roleCode,
      testCaseCode,
      testDataId: saved.id,
      fileNames: uploaded.fileNames,
    },
  })

  revalidateEdiel(sourceMessageId)
}


export async function createEdielTgtDraftAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const testSuite = parseEdielTestSuite(formData.get('testSuite'))
  const roleCode = parseEdielTestRoleCode(formData.get('roleCode'))
  const testCaseCode = formString(formData.get('testCaseCode')) ?? ''
  const stepNo = formNumber(formData.get('stepNo'))
  const testRunId = formString(formData.get('testRunId'))

  if (!stepNo) throw new Error('Välj vilket TGT-steg som ska genereras')

  const importedTestData = await getEdielTgtDynamicTestDataForCase(testSuite, roleCode, testCaseCode)

  const draft = buildEdielTgtDraft({
    actorUserId: context.userId,
    testSuite,
    roleCode,
    testCaseCode,
    stepNo,
    importedTestData,
  })

  const blockingIssues = draft.validationIssues.filter((issue) => issue.severity === 'error')
  if (blockingIssues.length > 0) {
    throw new Error(
      `TGT-utkastet är blockerat: ${blockingIssues
        .map((issue) => `${issue.title}: ${issue.description}`)
        .join(' | ')}`
    )
  }

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
  const applicationErrors = collectAperakApplicationErrors(formData)

  if (!sourceMessageId) throw new Error('sourceMessageId saknas')
  if (!ackType || !['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(ackType)) {
    throw new Error('Ogiltig ackType')
  }

  try {
    const ackMessage = await createAckDraftForMessage({
      actorUserId: context.userId,
      sourceMessageId,
      ackFamily: ackType,
      outcome: ackType === 'UTILTS_ERR' ? undefined : outcome,
      messageText,
      applicationErrors: ackType === 'APERAK' ? applicationErrors : null,
    })

    revalidateEdiel(sourceMessageId)
    await revalidateRelatedMessage(ackMessage.id)
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) throw error

    await createEdielMessageEvent({
      actorUserId: context.userId,
      edielMessageId: sourceMessageId,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: ackType + ' finns redan för detta källmeddelande. Inget nytt utkast skapades.',
      payload: {
        reason: 'duplicate_ack_unique_constraint',
        ackType,
        outcome,
      },
    })

    revalidateEdiel(sourceMessageId)
  }
}





export async function createAndSendRecommendedAckAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const sourceMessageId = formString(formData.get('sourceMessageId'))
  const testSuite = parseEdielTestSuite(formData.get('testSuite'))
  const roleCode = parseEdielTestRoleCode(formData.get('roleCode'))
  const testCaseCode = formString(formData.get('testCaseCode'))

  if (!sourceMessageId) throw new Error('sourceMessageId saknas')

  const sourceMessage = await getEdielMessageById(sourceMessageId)
  if (!sourceMessage) throw new Error('Källmeddelande hittades inte')

  const relatedAcks = await listAckMessagesForSource({ sourceMessageId })
  const tgtResolution = await resolveTgtTestDataForAckAction({
    message: sourceMessage,
    testSuite,
    roleCode,
    requestedTestCaseCode: testCaseCode,
  })
  const tgtTestData = tgtResolution.testData

  const recommendation = resolveRecommendedAckForInboundMessage({
    message: sourceMessage,
    relatedAcks,
    tgtTestData,
  })

  if (!recommendation.action) {
    throw new Error(`${recommendation.title}: ${recommendation.description}`)
  }

  let backendResolvedAperakErrors: EdielAperakApplicationError[] | null = null
  let backendRuleKeys: string[] = []
  let backendIssueCount = 0
  let backendUnmappedRuleKeys: string[] = []
  let finalOutcome = recommendation.action.outcome

  if (recommendation.action.ackFamily === 'APERAK' && sourceMessage.message_family === 'PRODAT') {
    const resolved = await resolveAndStoreProdatAperakErrors({
      message: sourceMessage,
      testData: tgtTestData,
    })

    backendIssueCount = resolved.issueCount
    backendUnmappedRuleKeys = resolved.unmappedIssues.map((issue) => issue.ruleKey)

    if (resolved.unmappedIssues.length > 0) {
      await createEdielMessageEvent({
        actorUserId: context.userId,
        edielMessageId: sourceMessageId,
        eventType: 'manual_note',
        eventStatus: 'error',
        message: 'Negativ APERAK stoppad: backend saknar APERAK-regel för ett eller flera valideringsfel.',
        payload: {
          unmappedIssues: resolved.unmappedIssues,
          issueCount: resolved.issueCount,
        },
      })

      throw new Error(
        `Negativ APERAK stoppad: saknar backendregel för ${resolved.unmappedIssues
          .map((issue) => issue.ruleKey)
          .join(', ')}.`
      )
    }

    if (resolved.errors.length > 0) {
      backendResolvedAperakErrors = resolved.errors
      backendRuleKeys = resolved.matchedRuleKeys
      finalOutcome = 'negative'
    } else {
      backendResolvedAperakErrors = []
      backendRuleKeys = []
      finalOutcome = 'positive'
    }
  }

  await removeReplaceableAckMessagesForSource({
    actorUserId: context.userId,
    sourceMessageId,
    ackFamily: recommendation.action.ackFamily,
    preset: recommendation.title,
  })

  const finalApplicationErrors =
    recommendation.action.ackFamily === 'APERAK'
      ? backendResolvedAperakErrors ?? recommendation.action.applicationErrors ?? null
      : null

  const ackMessage = await createAckDraftForMessage({
    actorUserId: context.userId,
    sourceMessageId,
    ackFamily: recommendation.action.ackFamily,
    outcome: recommendation.action.ackFamily === 'UTILTS_ERR' ? undefined : finalOutcome,
    messageText:
      finalApplicationErrors && finalApplicationErrors.length > 0
        ? finalApplicationErrors.map((error) => `${error.fieldCode ?? error.ercCode}: ${error.text}`).join(' | ')
        : recommendation.action.messageText ?? null,
    applicationErrors: finalApplicationErrors,
  })

  if (recommendation.action.ackFamily === 'APERAK' && backendRuleKeys.length > 0) {
    await attachAperakErrorDetailsToMessage({
      sourceMessageId,
      aperakMessageId: ackMessage.id,
    })
  }

  await sendQueuedEdielMessage({
    actorUserId: context.userId,
    edielMessageId: ackMessage.id,
    smtpMimeMode: 'ediel-singlepart-base64',
  })

  await createEdielMessageEvent({
    actorUserId: context.userId,
    edielMessageId: sourceMessageId,
    eventType: 'manual_note',
    eventStatus: 'success',
    message: `${recommendation.title}: backend-beslut skapade och skickade ${recommendation.action.ackFamily}.`,
    payload: {
      ackMessageId: ackMessage.id,
      decisionKind: recommendation.kind,
      matchedRule: recommendation.matchedRule,
      ackFamily: recommendation.action.ackFamily,
      outcome: finalOutcome ?? null,
      canAutoSend: recommendation.canAutoSend,
      reasonItems: recommendation.reasonItems,
      syntaxIssues: recommendation.syntaxIssues,
      applicationErrors: finalApplicationErrors,
      backendRuleKeys,
      backendIssueCount,
      backendUnmappedRuleKeys,
    },
  })

  revalidateEdiel(sourceMessageId)
  await revalidateRelatedMessage(ackMessage.id)
}

export async function createAndSendAckAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const sourceMessageId = formString(formData.get('sourceMessageId'))
  const ackType = formString(formData.get('ackType')) as AckFamily | null
  const outcome = (formString(formData.get('outcome')) as AckOutcome | null) ?? 'positive'
  const messageText = formString(formData.get('messageText'))
  const applicationErrors = collectAperakApplicationErrors(formData)

  if (!sourceMessageId) throw new Error('sourceMessageId saknas')
  if (!ackType || !['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(ackType)) {
    throw new Error('Ogiltig ackType')
  }

  await removeReplaceableAckMessagesForSource({
    actorUserId: context.userId,
    sourceMessageId,
    ackFamily: ackType,
    preset: `${ackType} ${outcome}`,
  })

  const ackMessage = await createAckDraftForMessage({
    actorUserId: context.userId,
    sourceMessageId,
    ackFamily: ackType,
    outcome: ackType === 'UTILTS_ERR' ? undefined : outcome,
    messageText,
    applicationErrors: ackType === 'APERAK' ? applicationErrors : null,
  })

  await sendQueuedEdielMessage({
    actorUserId: context.userId,
    edielMessageId: ackMessage.id,
    smtpMimeMode: 'ediel-singlepart-base64',
  })

  await createEdielMessageEvent({
    actorUserId: context.userId,
    edielMessageId: sourceMessageId,
    eventType: 'manual_note',
    eventStatus: 'success',
    message: `${ackType} skapades och skickades direkt från inbound-kortet.`,
    payload: {
      ackMessageId: ackMessage.id,
      ackType,
      outcome,
    },
  })

  revalidateEdiel(sourceMessageId)
  await revalidateRelatedMessage(ackMessage.id)
}

const REPLACEABLE_TGT_ACK_STATUSES = new Set(['draft', 'queued', 'prepared', 'failed', 'cancelled'])

async function removeReplaceableAckMessagesForSource(params: {
  actorUserId: string
  sourceMessageId: string
  ackFamily: AckFamily
  preset: string
}) {
  const existingAcks = await listAckMessagesForSource({
    sourceMessageId: params.sourceMessageId,
    ackFamily: params.ackFamily,
  })

  const nonReplaceable = existingAcks.find((ack) => !REPLACEABLE_TGT_ACK_STATUSES.has(String(ack.status)))
  if (nonReplaceable) {
    throw new Error(
      `${params.preset} kan inte skapas eftersom ${params.ackFamily} redan finns med status ${nonReplaceable.status}. Radera inte historik automatiskt efter skick.`
    )
  }

  const replaceableIds = existingAcks.map((ack) => ack.id).filter(Boolean)
  if (replaceableIds.length === 0) return

  const testRunDelete = await supabaseService
    .from('ediel_test_run_messages')
    .delete()
    .in('ediel_message_id', replaceableIds)
  if (testRunDelete.error) throw testRunDelete.error

  const eventsDelete = await supabaseService
    .from('ediel_message_events')
    .delete()
    .in('ediel_message_id', replaceableIds)
  if (eventsDelete.error) throw eventsDelete.error

  const messagesDelete = await supabaseService
    .from('ediel_messages')
    .delete()
    .in('id', replaceableIds)
  if (messagesDelete.error) throw messagesDelete.error

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessageId,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message: `${params.preset}: ersatte gammal kvittens-draft/failed/cancelled innan nytt skick.`,
    payload: {
      removedAckMessageIds: replaceableIds,
      ackFamily: params.ackFamily,
      preset: params.preset,
    },
  })
}

function parseLineItemReferencesByZ07(sourcePayload?: string | null): Map<string, string> {
  const segments = (sourcePayload ?? '')
    .replace(/\r\n/g, '')
    .replace(/\n/g, '')
    .replace(/^UNA.{6}'/i, '')
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)

  const lineRefsByZ07 = new Map<string, string>()
  let currentZ07: string | null = null

  for (const segment of segments) {
    if (segment.startsWith('LIN+')) {
      const linId = segment.split('+')[3]?.split(':')[0]?.trim() ?? null
      currentZ07 = linId && linId.length > 0 ? linId : null
      continue
    }

    if (currentZ07 && segment.startsWith('RFF+LI:')) {
      const li = segment.replace(/^RFF\+LI:/, '').trim()
      if (li) lineRefsByZ07.set(currentZ07, li)
    }
  }

  return lineRefsByZ07
}

function withLineItemReferences(
  sourcePayload: string | null | undefined,
  errors: readonly EdielAperakApplicationError[]
): EdielAperakApplicationError[] {
  const lineRefsByZ07 = parseLineItemReferencesByZ07(sourcePayload)

  return errors.map((error) => ({
    ...error,
    lineItemReference:
      error.referenceNumber && lineRefsByZ07.has(error.referenceNumber)
        ? lineRefsByZ07.get(error.referenceNumber) ?? null
        : error.lineItemReference ?? null,
  }))
}

async function createAndSendTgtAperakPreset(params: {
  actorUserId: string
  sourceMessageId: string
  preset: string
  errors: readonly EdielAperakApplicationError[]
  successMessage: string
}) {
  const sourceMessage = await getEdielMessageById(params.sourceMessageId)
  if (!sourceMessage) throw new Error('Källmeddelande hittades inte')

  if (
    sourceMessage.direction !== 'inbound' ||
    sourceMessage.message_family !== 'PRODAT' ||
    String(sourceMessage.message_code).toUpperCase() !== 'Z04'
  ) {
    throw new Error(
      `${params.preset}-APERAK måste skapas från inbound PRODAT/Z04. Vald rad är ${sourceMessage.direction} ${sourceMessage.message_family}/${sourceMessage.message_code}.`
    )
  }

  await removeReplaceableAckMessagesForSource({
    actorUserId: params.actorUserId,
    sourceMessageId: params.sourceMessageId,
    ackFamily: 'APERAK',
    preset: params.preset,
  })

  const ackMessage = await createAckDraftForMessage({
    actorUserId: params.actorUserId,
    sourceMessageId: params.sourceMessageId,
    ackFamily: 'APERAK',
    outcome: 'negative',
    applicationErrors: withLineItemReferences(sourceMessage.raw_payload, params.errors),
  })

  await sendQueuedEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: ackMessage.id,
    smtpMimeMode: 'ediel-singlepart-base64',
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessageId,
    eventType: 'manual_note',
    eventStatus: 'success',
    message: params.successMessage,
    payload: {
      ackMessageId: ackMessage.id,
      preset: params.preset,
    },
  })

  revalidateEdiel(params.sourceMessageId)
  await revalidateRelatedMessage(ackMessage.id)
}

const TGT_S142_APERAK_APPLICATION_ERRORS: EdielAperakApplicationError[] = [
  {
    ercCode: '42',
    fieldCode: '210',
    text: 'Felaktig avtal, startdatum 2040-08-01',
    referenceQualifier: 'Z07',
    referenceNumber: '735999888000000123',
    lineItemReference: 'GRIDEX-1.4.2-S1',
  },
  {
    ercCode: '41',
    fieldCode: '213',
    text: 'Årsförbrukning saknas',
    referenceQualifier: 'Z07',
    referenceNumber: '735999888000000123',
    lineItemReference: 'GRIDEX-1.4.2-S1',
  },
  {
    ercCode: '41',
    fieldCode: '214',
    text: 'Konstant saknas',
    referenceQualifier: 'Z07',
    referenceNumber: '735999888000000130',
    lineItemReference: null,
  },
  {
    ercCode: '41',
    fieldCode: '226',
    text: 'Ärendereferens saknas, kundid=196501022773',
    referenceQualifier: 'Z07',
    referenceNumber: '735999888000000130',
    lineItemReference: null,
  },
  {
    ercCode: '100',
    fieldCode: null,
    text: 'OK',
    referenceQualifier: 'Z07',
    referenceNumber: '735999888000000147',
    lineItemReference: 'GRIDEX-1.4.2-S1-3',
  },
]

function deriveS142LineItemReferences(sourcePayload?: string | null): EdielAperakApplicationError[] {
  return withLineItemReferences(sourcePayload, TGT_S142_APERAK_APPLICATION_ERRORS)
}


export async function createAndSendTgtS142AperakAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const sourceMessageId = formString(formData.get('sourceMessageId'))

  if (!sourceMessageId) throw new Error('sourceMessageId saknas')

  await createAndSendTgtAperakPreset({
    actorUserId: context.userId,
    sourceMessageId,
    preset: 'S1.4.2',
    errors: TGT_S142_APERAK_APPLICATION_ERRORS,
    successMessage: 'S1.4.2-APERAK skapades och skickades med fem objekt-/felgrupper.',
  })
}

const TGT_S142B_APERAK_APPLICATION_ERRORS: EdielAperakApplicationError[] = [
  {
    ercCode: '42',
    fieldCode: '210',
    text: 'Felaktig avtal, startdatum 2040-08-01',
    referenceQualifier: 'Z07',
    referenceNumber: '735999888000000123',
    lineItemReference: null,
  },
  {
    ercCode: '41',
    fieldCode: '213',
    text: 'Årsförbrukning saknas',
    referenceQualifier: 'Z07',
    referenceNumber: '735999888000000123',
    lineItemReference: null,
  },
  {
    ercCode: '41',
    fieldCode: '214',
    text: 'Konstant saknas',
    referenceQualifier: 'Z07',
    referenceNumber: '735999888000000123',
    lineItemReference: null,
  },
  {
    ercCode: '41',
    fieldCode: '226',
    text: 'Ärendereferens saknas, kundid=196805249288',
    referenceQualifier: 'Z07',
    referenceNumber: '735999888000000123',
    lineItemReference: null,
  },
]

export async function createAndSendTgtS142BAperakAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const sourceMessageId = formString(formData.get('sourceMessageId'))

  if (!sourceMessageId) throw new Error('sourceMessageId saknas')

  await createAndSendTgtAperakPreset({
    actorUserId: context.userId,
    sourceMessageId,
    preset: 'S1.4.2B',
    errors: TGT_S142B_APERAK_APPLICATION_ERRORS,
    successMessage: 'S1.4.2B-APERAK skapades och skickades med en anläggning och fyra felgrupper.',
  })
}

const TGT_S143_APERAK_APPLICATION_ERRORS: EdielAperakApplicationError[] = [
  {
    ercCode: '41',
    fieldCode: '319',
    text: 'Referens till anläggning saknas',
    referenceQualifier: null,
    referenceNumber: null,
    lineItemReference: null,
  },
]

export async function createAndSendTgtS143AperakAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const sourceMessageId = formString(formData.get('sourceMessageId'))

  if (!sourceMessageId) throw new Error('sourceMessageId saknas')

  await createAndSendTgtAperakPreset({
    actorUserId: context.userId,
    sourceMessageId,
    preset: 'S1.4.3',
    errors: TGT_S143_APERAK_APPLICATION_ERRORS,
    successMessage: 'S1.4.3-APERAK skapades och skickades för saknad anläggningsreferens.',
  })
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
    customerIdCodeListQualifier: formString(formData.get('customerIdCodeListQualifier')),
    reasonForTransaction: formString(formData.get('reasonForTransaction')),
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

function actionJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function normalizeEdielMeteringMethod(value: string | null): 'Z01' | 'Z02' | 'Z03' | 'Z04' | null {
  if (value === 'Z01' || value === 'Z02' || value === 'Z03' || value === 'Z04') return value
  return null
}

function normalizeProdatReason(value: string | null): 'Z22' | 'Z23' | null {
  if (value === 'Z22' || value === 'Z23') return value
  return null
}

function normalizeCustomerIdQualifier(value: string | null): 'SE1' | 'SE2' | '1' | null {
  if (value === 'SE1' || value === 'SE2' || value === '1') return value
  return null
}

export async function updateEdielPortalSwitchTestDataAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['masterdata.write', 'switching.write', 'communication.write', 'communication.read'])
  const switchRequestId = formString(formData.get('switchRequestId'))
  if (!switchRequestId) throw new Error('switchRequestId saknas')

  const meteringMethod = normalizeEdielMeteringMethod(formString(formData.get('meteringMethod')))
  const reasonForTransaction = normalizeProdatReason(formString(formData.get('reasonForTransaction')))
  const customerIdCodeListQualifier = normalizeCustomerIdQualifier(formString(formData.get('customerIdCodeListQualifier')))
  const customerName = formString(formData.get('customerName'))

  if (!meteringMethod && !reasonForTransaction && !customerIdCodeListQualifier && !customerName) {
    throw new Error('Inget testdatafält att uppdatera valdes.')
  }

  const supabase = await makeServerClient()
  const { data: row, error } = await supabase
    .from('supplier_switch_requests')
    .select('id,validation_snapshot')
    .eq('id', switchRequestId)
    .single()

  if (error) throw error

  const snapshot = actionJsonObject(row.validation_snapshot)
  const portalData = actionJsonObject(snapshot.portalData)
  const testCaseOverrides = actionJsonObject(portalData.testCaseOverrides)

  const nextPortalData = {
    ...portalData,
    ...(meteringMethod ? { meteringMethod } : {}),
    ...(reasonForTransaction ? { reasonForTransaction } : {}),
    ...(customerIdCodeListQualifier ? { customerIdCodeListQualifier } : {}),
    ...(customerName ? { customerName } : {}),
    testCaseOverrides: {
      ...testCaseOverrides,
      ...(meteringMethod ? { meteringMethod } : {}),
      ...(reasonForTransaction ? { reasonForTransaction } : {}),
      ...(customerIdCodeListQualifier ? { customerIdCodeListQualifier } : {}),
    },
  }

  const nextSnapshot = {
    ...snapshot,
    portalData: nextPortalData,
    manualPortalTestDataOverride: {
      source: 'ediel_production_prodat_panel',
      updatedAt: new Date().toISOString(),
      updatedBy: context.userId,
      fields: {
        meteringMethod,
        reasonForTransaction,
        customerIdCodeListQualifier,
        customerName,
      },
    },
  }

  const { error: updateError } = await supabase
    .from('supplier_switch_requests')
    .update({
      validation_snapshot: nextSnapshot,
      updated_by: context.userId,
    })
    .eq('id', switchRequestId)

  if (updateError) throw updateError

  await supabase.from('supplier_switch_events').insert({
    switch_request_id: switchRequestId,
    event_type: 'ediel_portal_test_data_updated',
    event_status: 'success',
    message: 'Edielportal-testdata uppdaterades manuellt. Gamla oskickade PRODAT-utkast avbryts och nytt utkast ska skapas.',
    payload: nextSnapshot,
    created_by: context.userId,
  })

  await cancelSupersededSwitchProdatDrafts({ actorUserId: context.userId, switchRequestId, messageCode: 'Z03' })
  await cancelSupersededSwitchProdatDrafts({ actorUserId: context.userId, switchRequestId, messageCode: 'Z04' })

  revalidatePath('/admin/ediel')
  revalidatePath('/admin/operations/switches')
  revalidatePath(`/admin/operations/switches/${switchRequestId}`)
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

function parseInboundCaseMode(value: FormDataEntryValue | null): EdielInboundCaseActionMode {
  if (value === 'create_new_customer') return 'create_new_customer'
  if (value === 'link_existing_only') return 'link_existing_only'
  return 'update_existing_customer'
}

export async function approveEdielInboundCaseAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'masterdata.write'])
  const caseId = formString(formData.get('caseId'))
  if (!caseId) throw new Error('caseId saknas')

  await approveEdielInboundCase({
    actorUserId: context.userId,
    caseId,
    mode: parseInboundCaseMode(formData.get('mode')),
    selectedCustomerId: formString(formData.get('selectedCustomerId')),
    selectedSiteId: formString(formData.get('selectedSiteId')),
    selectedMeteringPointId: formString(formData.get('selectedMeteringPointId')),
    note: formString(formData.get('note')),
  })

  revalidateEdiel()
  revalidatePath('/admin/customers')
}

export async function rejectEdielInboundCaseAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'masterdata.write'])
  const caseId = formString(formData.get('caseId'))
  if (!caseId) throw new Error('caseId saknas')

  await rejectEdielInboundCase({
    actorUserId: context.userId,
    caseId,
    note: formString(formData.get('note')),
  })

  revalidateEdiel()
}
