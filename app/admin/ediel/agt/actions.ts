'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { saveCommunicationRoute } from '@/lib/cis/db'
import {
  attachEdielMessageToTestRun,
  createEdielMessageEvent,
  createEdielTestRun,
  getEdielMessageById,
  listEdielMessagesByIds,
  listEdielTestRunMessages,
  listEdielTestRuns,
  updateEdielMessageStatus,
  updateEdielTestRunStatus,
} from '@/lib/ediel/db'
import {
  createEdielSupplierAgtOutboundCommand,
  createEdielSupplierAgtResponsesForInbound,
} from '@/lib/ediel/agtEngine'
import type { EdielMessageRow, EdielRouteProfileAckMode, EdielTestRunRow } from '@/lib/ediel/types'
import {
  EDIEL_AGT_APPROVAL_VERSION_2026A,
  EDIEL_AGT_PORTAL_EDIEL_ID,
  EDIEL_AGT_PORTAL_SMTP,
  EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS,
  EDIEL_AGT_SUPPLIER_2026A_CASES,
  EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID,
  getEdielAgtRouteName,
  getEdielAgtSupplier2026ACase,
  isEdielAgtRunApprovalVersion,
  type EdielAgtExpectedStep,
  type EdielAgtTestCaseDefinition,
} from '@/lib/ediel/agtRegistry'
import { pollEdielMailboxViaImap } from '@/lib/ediel/transport'
import { registerEdielFile } from '@/lib/ediel/fileEngine'
import { getEdielAgtSupplierRuntime } from '@/lib/ediel/agtRuntime'
import { sendQueuedEdielMessage } from '@/lib/ediel/orchestrator'

function value(formData: FormData, key: string): string | null {
  const raw = formData.get(key)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function upper(formData: FormData, key: string): string | null {
  return value(formData, key)?.toUpperCase() ?? null
}


function nullableUpper(value: string | null): string | null {
  return value ? value.toUpperCase() : null
}

function emptyToNull(input: string | null): string | null {
  return input && input.trim().length > 0 ? input.trim() : null
}

async function uploadedFileText(value: FormDataEntryValue | null): Promise<{ text: string | null; fileName: string | null }> {
  if (!value || typeof value === 'string') return { text: null, fileName: null }
  const maybeFile = value as unknown as { arrayBuffer?: () => Promise<ArrayBuffer>; name?: string; size?: number }
  if (typeof maybeFile.arrayBuffer !== 'function' || Number(maybeFile.size ?? 0) <= 0) {
    return { text: null, fileName: null }
  }

  const buffer = Buffer.from(await maybeFile.arrayBuffer())
  return {
    text: buffer.toString('utf8'),
    fileName: typeof maybeFile.name === 'string' ? maybeFile.name : null,
  }
}


function isAckLikeStep(step: EdielAgtExpectedStep): boolean {
  const family = String(step.family ?? '').toUpperCase()
  const code = String(step.code ?? '').toUpperCase()
  return family === 'CONTRL' || code === 'CONTRL' || family === 'APERAK' || code === 'APERAK' || family === 'UTILTS_ERR' || code === 'UTILTS_ERR'
}

function messageMatchesAgtStep(step: EdielAgtExpectedStep, message: EdielMessageRow): boolean {
  const family = String(message.message_family ?? '').toUpperCase()
  const code = String(message.message_code ?? '').toUpperCase()
  const expectedFamily = String(step.family ?? '').toUpperCase()
  const expectedCode = String(step.code ?? '').toUpperCase()

  if (isAckLikeStep(step)) {
    // Portalen kan lagra t.ex. CONTRL som family=PRODAT/code=CONTRL beroende på parserkälla.
    // För kvittenser är koden därför säkrare än family ensam.
    return family === expectedFamily || code === expectedCode || family === expectedCode
  }

  // Affärsmeddelanden måste matcha exakt. L2/Z04 får inte fånga gamla PRODAT CONTRL från L1.
  return family === expectedFamily && code === expectedCode
}

function expectedInboundStepForMessage(
  testCase: EdielAgtTestCaseDefinition,
  message: EdielMessageRow
): EdielAgtExpectedStep | null {
  if (message.direction !== 'inbound') return null

  return testCase.expectedSteps.find((step) => {
    if (step.actor !== 'portal' || step.direction !== 'inbound') return false
    return messageMatchesAgtStep(step, message)
  }) ?? null
}

function isPrimaryBusinessInboundForCase(testCase: EdielAgtTestCaseDefinition, message: EdielMessageRow): boolean {
  return (
    testCase.direction === 'portal_to_actor' &&
    message.direction === 'inbound' &&
    String(message.message_family ?? '').toUpperCase() === String(testCase.messageFamily).toUpperCase() &&
    String(message.message_code ?? '').toUpperCase() === String(testCase.messageCode).toUpperCase()
  )
}

function messageTime(message: EdielMessageRow): number {
  const raw = message.message_received_at ?? message.created_at ?? message.updated_at
  const time = raw ? Date.parse(raw) : 0
  return Number.isFinite(time) ? time : 0
}


async function ensureAgtRunForCase(params: {
  actorUserId: string
  testCase: EdielAgtTestCaseDefinition
  testRunId?: string | null
}): Promise<EdielTestRunRow> {
  const runs = await listEdielTestRuns()
  const explicitRun = params.testRunId
    ? runs.find((run) => run.id === params.testRunId)
    : null

  if (explicitRun && (explicitRun.status === 'draft' || explicitRun.status === 'running')) {
    return explicitRun
  }

  const activeRun = runs.find((run) =>
    isEdielAgtRunApprovalVersion(run.approval_version) &&
    (run.status === 'draft' || run.status === 'running') &&
    run.role_code === params.testCase.roleCode &&
    run.test_suite === params.testCase.suite &&
    run.test_case_code === params.testCase.testCaseCode
  )

  if (activeRun) return activeRun

  return createEdielTestRun({
    actorUserId: params.actorUserId,
    testSuite: params.testCase.suite,
    roleCode: params.testCase.roleCode,
    testCaseCode: params.testCase.testCaseCode,
    title: params.testCase.title,
    approvalVersion: params.testCase.approvalVersion,
    notes: `${params.testCase.notes} Skapad automatiskt från AGT-testkortet vid import.`,
    status: 'running',
    startedAt: new Date().toISOString(),
  })
}

async function attachExpectedAgtMessage(params: {
  actorUserId: string
  testRunId: string
  testCase: EdielAgtTestCaseDefinition
  message: EdielMessageRow
}): Promise<EdielAgtExpectedStep | null> {
  const step = expectedInboundStepForMessage(params.testCase, params.message)
  if (!step) return null

  await attachEdielMessageToTestRun({
    testRunId: params.testRunId,
    edielMessageId: params.message.id,
    stepNo: step.stepNo,
    expectedDirection: step.direction,
    expectedFamily: step.family,
    expectedCode: step.code,
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'linked',
    eventStatus: 'success',
    message: `AGT ${params.testCase.testCaseCode}: meddelandet kopplades till steg ${step.stepNo}.`,
    payload: {
      agt: true,
      testRunId: params.testRunId,
      testCaseCode: params.testCase.testCaseCode,
      stepNo: step.stepNo,
      expectedFamily: step.family,
      expectedCode: step.code,
    },
  })

  return step
}


async function createAgtResponsesIfBusinessInbound(params: {
  actorUserId: string
  testRunId: string
  testCase: EdielAgtTestCaseDefinition
  message: EdielMessageRow
}): Promise<EdielMessageRow[]> {
  if (!isPrimaryBusinessInboundForCase(params.testCase, params.message)) return []

  return createEdielSupplierAgtResponsesForInbound({
    actorUserId: params.actorUserId,
    sourceMessageId: params.message.id,
    testRunId: params.testRunId,
    testCaseCode: params.testCase.testCaseCode,
  })
}


async function getAgtCaseOrThrow(testCaseCode: string | null): Promise<EdielAgtTestCaseDefinition> {
  const testCase = getEdielAgtSupplier2026ACase(String(testCaseCode ?? '').toUpperCase())
  if (!testCase) throw new Error(`Okänt AGT 2026A leverantörstest: ${testCaseCode ?? ''}`)
  return testCase
}

function agtActorNotes(input: {
  balanceResponsibleEdielId: string | null
}): string {
  return JSON.stringify({
    purpose: 'AGT 2026A supplier runtime',
    balanceResponsibleEdielId: input.balanceResponsibleEdielId,
    updatedAt: new Date().toISOString(),
  })
}

function revalidateAgt() {
  revalidatePath('/admin/ediel')
  revalidatePath('/admin/ediel/agt')
  revalidatePath('/admin/ediel/routes')
  revalidatePath('/admin/ediel/settings')
}

async function getCurrentUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Unauthorized')
  return user.id
}

async function saveActiveSupplierActor(input: {
  actorUserId: string
  companyId: string
  actorName: string
  actorEdielId: string
  senderName: string | null
  senderSubAddress: string | null
  smtpFromEmail: string | null
  smtpReplyToEmail: string | null
  mailbox: string | null
  balanceResponsibleEdielId: string | null
  notes: string | null
}) {
  if (!input.actorName || !input.actorEdielId) {
    throw new Error('Bolagsnamn och Ediel-id måste fyllas i.')
  }

  if (input.actorEdielId === EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID) {
    throw new Error(
      `Ediel-id ${EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID} är Gridcore/TGT-id och får inte användas som leverantörens aktörs-id i AGT.`
    )
  }

  const deactivate = await supabaseService
    .from('ediel_actor_settings')
    .update({
      is_active: false,
      updated_by: input.actorUserId,
    })
    .eq('environment', 'test')
    .eq('company_id', input.companyId)

  if (deactivate.error) throw deactivate.error

  const existing = await supabaseService
    .from('ediel_actor_settings')
    .select('id')
    .eq('environment', 'test')
    .eq('company_id', input.companyId)
    .eq('actor_ediel_id', input.actorEdielId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing.error) throw existing.error

  const payload = {
    company_id: input.companyId,
    actor_name: input.actorName,
    actor_ediel_id: input.actorEdielId,
    actor_role: 'supplier',
    environment: 'test',
    is_active: true,
    sender_name: input.senderName,
    sender_sub_address: input.senderSubAddress,
    default_application_reference: null,
    default_timezone: 1,
    default_charset: 'UNOC',
    default_test_flag: 1,
    smtp_from_email: input.smtpFromEmail,
    smtp_reply_to_email: input.smtpReplyToEmail,
    mailbox: input.mailbox,
    notes: input.notes,
    updated_by: input.actorUserId,
  }

  if (existing.data?.id) {
    const { error } = await supabaseService
      .from('ediel_actor_settings')
      .update(payload)
      .eq('id', existing.data.id)

    if (error) throw error
    return
  }

  const { error } = await supabaseService.from('ediel_actor_settings').insert({
    ...payload,
    created_by: input.actorUserId,
  })

  if (error) throw error
}

async function upsertRouteProfile(input: {
  actorUserId: string
  companyId: string
  routeId: string
  family: 'PRODAT' | 'UTILTS'
  senderEdielId: string
  senderName: string | null
  senderSubAddress: string | null
  receiverName: string
  applicationReference: string | null
  defaultMessageVersion: string | null
  ackMode: EdielRouteProfileAckMode
  mailbox: string | null
}) {
  const existing = await supabaseService
    .from('ediel_route_profiles')
    .select('id')
    .eq('communication_route_id', input.routeId)
    .eq('company_id', input.companyId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing.error) throw existing.error

  const isProdat = input.family === 'PRODAT'
  const payload = {
    company_id: input.companyId,
    communication_route_id: input.routeId,
    is_enabled: true,
    sender_ediel_id: input.senderEdielId,
    sender_name: input.senderName,
    sender_sub_address: input.family === 'PRODAT' ? input.senderSubAddress : null,
    receiver_ediel_id: EDIEL_AGT_PORTAL_EDIEL_ID,
    receiver_name: input.receiverName,
    receiver_sub_address: isProdat ? EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS : null,
    application_reference: input.applicationReference,
    default_message_version: input.defaultMessageVersion,
    default_test_flag: 1,
    default_timezone: 1,
    environment: 'test',
    message_standard: 'edifact',
    ack_mode: input.ackMode,
    smtp_host: null,
    smtp_port: null,
    imap_host: null,
    imap_port: null,
    mailbox: input.mailbox,
    encryption_mode: 'none',
    payload_format: 'edifact',
    notes: `${input.family} AGT route profile. Sender-id och eventuell sender-subadress kommer från aktiv SaaS-tenant/Edielregistret, inte från Gridcore/TGT-konstant.`,
    updated_by: input.actorUserId,
    updated_at: new Date().toISOString(),
  }

  if (existing.data?.id) {
    const { error } = await supabaseService
      .from('ediel_route_profiles')
      .update(payload)
      .eq('id', existing.data.id)

    if (error) throw error
    return
  }

  const { error } = await supabaseService.from('ediel_route_profiles').insert({
    ...payload,
    created_by: input.actorUserId,
  })

  if (error) throw error
}

async function upsertAgtRoute(input: {
  actorUserId: string
  companyId: string
  family: 'PRODAT' | 'UTILTS'
  actorEdielId: string
  senderName: string | null
  senderSubAddress: string | null
  receiverName: string
  targetEmail: string
  applicationReference: string | null
  defaultMessageVersion: string | null
  mailbox: string | null
}) {
  const routeName = getEdielAgtRouteName(input.family)
  const existing = await supabaseService
    .from('communication_routes')
    .select('id')
    .eq('route_name', routeName)
    .eq('company_id', input.companyId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing.error) throw existing.error

  const route = await saveCommunicationRoute({
    actorUserId: input.actorUserId,
    companyId: input.companyId,
    id: existing.data?.id ?? undefined,
    routeName,
    isActive: true,
    routeScope: input.family === 'PRODAT' ? 'supplier_switch' : 'meter_values',
    routeType: 'ediel_partner',
    gridOwnerId: null,
    targetSystem: 'ediel',
    endpoint: null,
    targetEmail: input.targetEmail,
    supportedPayloadVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    notes: `${input.family} AGT 2026A mot Edielportalen ${EDIEL_AGT_PORTAL_EDIEL_ID}.`,
  })

  await upsertRouteProfile({
    actorUserId: input.actorUserId,
    companyId: input.companyId,
    routeId: route.id,
    family: input.family,
    senderEdielId: input.actorEdielId,
    senderName: input.senderName,
    senderSubAddress: input.senderSubAddress,
    receiverName: input.receiverName,
    applicationReference: input.applicationReference,
    defaultMessageVersion: input.defaultMessageVersion,
    ackMode: input.family === 'PRODAT' ? 'contrl_and_aperak' : 'default',
    mailbox: input.mailbox,
  })
}

export async function saveAgtSupplierRuntimeAction(formData: FormData) {
  await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const actorUserId = await getCurrentUserId()
  const companyId = await requireOperationalCompanyId(actorUserId)

  const actorName = value(formData, 'actor_name') ?? ''
  const actorEdielId = upper(formData, 'actor_ediel_id') ?? ''
  const senderName = value(formData, 'sender_name')
  const prodatSenderSubAddress = nullableUpper(value(formData, 'prodat_sender_sub_address'))
  const smtpFromEmail = value(formData, 'smtp_from_email')
  const smtpReplyToEmail = value(formData, 'smtp_reply_to_email')
  const mailbox = value(formData, 'mailbox')
  const balanceResponsibleEdielId = upper(formData, 'balance_responsible_ediel_id')
  const targetEmail = value(formData, 'target_email') ?? EDIEL_AGT_PORTAL_SMTP
  const receiverName = value(formData, 'receiver_name') ?? 'Edielportalen'
  const prodatApplicationReference = nullableUpper(value(formData, 'prodat_application_reference'))
  const prodatDefaultVersion = value(formData, 'prodat_default_message_version')
  const utiltsDefaultVersion = value(formData, 'utilts_default_message_version')

  if (targetEmail !== EDIEL_AGT_PORTAL_SMTP) {
    throw new Error(`AGT mot Edielportalen ska skickas till ${EDIEL_AGT_PORTAL_SMTP}.`)
  }

  await saveActiveSupplierActor({
    actorUserId,
    companyId,
    actorName,
    actorEdielId,
    senderName,
    senderSubAddress: prodatSenderSubAddress,
    smtpFromEmail,
    smtpReplyToEmail,
    mailbox,
    balanceResponsibleEdielId,
    notes: emptyToNull(agtActorNotes({ balanceResponsibleEdielId })),
  })

  await upsertAgtRoute({
    actorUserId,
    companyId,
    family: 'PRODAT',
    actorEdielId,
    senderName,
    senderSubAddress: prodatSenderSubAddress,
    receiverName,
    targetEmail,
    applicationReference: prodatApplicationReference,
    defaultMessageVersion: prodatDefaultVersion,
    mailbox,
  })

  await upsertAgtRoute({
    actorUserId,
    companyId,
    family: 'UTILTS',
    actorEdielId,
    senderName,
    senderSubAddress: null,
    receiverName,
    targetEmail,
    applicationReference: null,
    defaultMessageVersion: utiltsDefaultVersion,
    mailbox,
  })

  revalidateAgt()
}

export async function createAgtSupplierTestRunAction(formData: FormData) {
  await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const actorUserId = await getCurrentUserId()
  const testCaseCode = upper(formData, 'test_case_code') ?? ''
  const testCase = getEdielAgtSupplier2026ACase(testCaseCode)

  if (!testCase) {
    throw new Error(`Okänt AGT 2026A leverantörstest: ${testCaseCode}`)
  }

  const runs = await listEdielTestRuns()
  for (const run of runs) {
    if (
      run.role_code === testCase.roleCode &&
      run.test_suite === testCase.suite &&
      run.test_case_code === testCase.testCaseCode &&
      run.approval_version === testCase.approvalVersion &&
      (run.status === 'draft' || run.status === 'running')
    ) {
      await updateEdielTestRunStatus({
        actorUserId,
        testRunId: run.id,
        status: 'cancelled',
        failureReason: 'Ny AGT-körning startades för samma testfall. En aktiv körning åt gången hålls i GridCore för att inte blanda portalens testlogg med gamla payloads.',
        completedAt: new Date().toISOString(),
      })
    }
  }

  await createEdielTestRun({
    actorUserId,
    testSuite: testCase.suite,
    roleCode: testCase.roleCode,
    testCaseCode: testCase.testCaseCode,
    title: testCase.title,
    approvalVersion: testCase.approvalVersion,
    notes: `${testCase.notes} Skapad som aktiv AGT-körning från leverantörens AGT-sida.`,
    status: 'running',
  })

  revalidateAgt()
}


export async function createAgtSupplierOutboundCommandAction(formData: FormData) {
  await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const actorUserId = await getCurrentUserId()
  const testCaseCode = upper(formData, 'test_case_code') ?? ''
  const testRunId = value(formData, 'test_run_id')

  if (!testCaseCode) throw new Error('test_case_code saknas')

  const message = await createEdielSupplierAgtOutboundCommand({
    actorUserId,
    testRunId,
    testCaseCode,
  })

  const sent = await sendQueuedEdielMessage({
    actorUserId,
    edielMessageId: message.id,
    smtpMimeMode: 'ediel-singlepart-base64',
  })

  revalidateAgt()
  redirect(`/admin/ediel/messages/${sent.id}`)
}

// Backwards-compatible server action name for older imports. It does not create a long-lived draft.
export const createAgtSupplierOutboundDraftAction = createAgtSupplierOutboundCommandAction

export async function createAllAgtSupplierTestRunsAction(_formData: FormData) {
  await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const actorUserId = await getCurrentUserId()

  for (const testCase of EDIEL_AGT_SUPPLIER_2026A_CASES) {
    await createEdielTestRun({
      actorUserId,
      testSuite: testCase.suite,
      roleCode: testCase.roleCode,
      testCaseCode: testCase.testCaseCode,
      title: testCase.title,
      approvalVersion: testCase.approvalVersion,
      notes: `${testCase.notes} Skapad som aktiv AGT-körning från leverantörens AGT-sida.`,
      status: 'running',
    })
  }

  revalidateAgt()
}

export async function pollAgtMailboxForCaseAction(formData: FormData) {
  await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const actorUserId = await getCurrentUserId()
  const testCase = await getAgtCaseOrThrow(upper(formData, 'test_case_code'))
  const testRun = await ensureAgtRunForCase({
    actorUserId,
    testCase,
    testRunId: value(formData, 'test_run_id'),
  })

  const runtime = await getEdielAgtSupplierRuntime()
  const routeId = testCase.suite === 'PRODAT' ? runtime.prodat.route?.id : runtime.utilts.route?.id
  const mailbox = value(formData, 'mailbox') ?? runtime.actor?.mailbox ?? 'INBOX'
  const limitRaw = value(formData, 'limit')
  const limit = limitRaw ? Number(limitRaw) : 10

  const imported = await pollEdielMailboxViaImap({
    actorUserId,
    mailbox,
    communicationRouteId: routeId ?? null,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
  })

  let matched = 0
  const sortedImported = [...imported].sort((a, b) => messageTime(b) - messageTime(a))
  const messagesToAttach = testCase.direction === 'portal_to_actor'
    ? sortedImported.filter((message) => isPrimaryBusinessInboundForCase(testCase, message)).slice(0, 1)
    : sortedImported.filter((message) => Boolean(expectedInboundStepForMessage(testCase, message)))

  for (const message of messagesToAttach) {
    const step = await attachExpectedAgtMessage({
      actorUserId,
      testRunId: testRun.id,
      testCase,
      message,
    })

    if (!step) continue
    matched += 1

    await createAgtResponsesIfBusinessInbound({
      actorUserId,
      testRunId: testRun.id,
      testCase,
      message,
    })
  }

  if (matched === 0 && imported[0]) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: imported[0].id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: `AGT ${testCase.testCaseCode}: IMAP importerade ${imported.length} meddelanden, men inget matchade förväntat steg.`,
      payload: {
        agt: true,
        testRunId: testRun.id,
        testCaseCode: testCase.testCaseCode,
        importedCount: imported.length,
        matchedCount: matched,
      },
    }).catch(() => null)
  }

  revalidateAgt()
  redirect(`/admin/ediel/agt/${testCase.testCaseCode}`)
}

export async function importAgtRawInboundForCaseAction(formData: FormData) {
  await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const actorUserId = await getCurrentUserId()
  const testCase = await getAgtCaseOrThrow(upper(formData, 'test_case_code'))
  const testRun = await ensureAgtRunForCase({
    actorUserId,
    testCase,
    testRunId: value(formData, 'test_run_id'),
  })

  const uploaded = await uploadedFileText(formData.get('ediel_file'))
  const pasted = value(formData, 'raw_payload')
  const rawPayload = uploaded.text ?? pasted
  if (!rawPayload) throw new Error('Ladda upp EDIFACT-fil eller klistra in inbound-payload från Edielportalen.')

  const result = await registerEdielFile({
    actorUserId,
    direction: 'inbound',
    mode: 'agt',
    rawPayload,
    fileName: uploaded.fileName,
    mailbox: value(formData, 'mailbox') ?? 'agt-manual-import',
    mailboxMessageId: value(formData, 'mailbox_message_id') ?? `agt-${testCase.testCaseCode}-${Date.now()}`,
    subject: `AGT ${testCase.testCaseCode} manual import`,
  })

  const message = await getEdielMessageById(result.id)
  if (!message) throw new Error('Det importerade meddelandet kunde inte läsas efter import.')

  const step = await attachExpectedAgtMessage({
    actorUserId,
    testRunId: testRun.id,
    testCase,
    message,
  })

  if (!step) {
    throw new Error(`Importerad fil är ${message.message_family}/${message.message_code}, men ${testCase.testCaseCode} väntar på ${testCase.messageFamily}/${testCase.messageCode} eller portalens kvittenser.`)
  }

  await createAgtResponsesIfBusinessInbound({
    actorUserId,
    testRunId: testRun.id,
    testCase,
    message,
  })

  revalidateAgt()
  redirect(`/admin/ediel/agt/${testCase.testCaseCode}`)
}

export async function attachAgtInboundAndCreateResponsesAction(formData: FormData) {
  await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const actorUserId = await getCurrentUserId()
  const testCase = await getAgtCaseOrThrow(upper(formData, 'test_case_code'))
  const testRun = await ensureAgtRunForCase({
    actorUserId,
    testCase,
    testRunId: value(formData, 'test_run_id'),
  })
  const sourceMessageId = value(formData, 'source_message_id')
  if (!sourceMessageId) throw new Error('Välj ett inbound-meddelande att koppla.')

  const message = await getEdielMessageById(sourceMessageId)
  if (!message) throw new Error('Meddelandet hittades inte.')

  const step = await attachExpectedAgtMessage({
    actorUserId,
    testRunId: testRun.id,
    testCase,
    message,
  })

  if (!step) {
    throw new Error(`Meddelandet ${message.message_family}/${message.message_code} matchar inte förväntat portalsteg för ${testCase.testCaseCode}.`)
  }

  await createAgtResponsesIfBusinessInbound({
    actorUserId,
    testRunId: testRun.id,
    testCase,
    message,
  })

  revalidateAgt()
  redirect(`/admin/ediel/agt/${testCase.testCaseCode}`)
}



export async function cleanupAgtCaseUnsentMessagesAction(formData: FormData) {
  await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const actorUserId = await getCurrentUserId()
  const testCase = await getAgtCaseOrThrow(upper(formData, 'test_case_code'))
  const keepRunId = value(formData, 'test_run_id')

  const runs = await listEdielTestRuns()
  const sameCaseRuns = runs.filter((run) =>
    run.role_code === testCase.roleCode &&
    run.test_suite === testCase.suite &&
    run.test_case_code === testCase.testCaseCode &&
    run.approval_version === testCase.approvalVersion &&
    run.status !== 'cancelled'
  )

  for (const run of sameCaseRuns) {
    const links = await listEdielTestRunMessages({ testRunId: run.id })
    const messages = await listEdielMessagesByIds(links.map((link) => link.ediel_message_id))

    for (const message of messages) {
      const canCancel =
        message.direction === 'outbound' &&
        (message.status === 'draft' || message.status === 'prepared' || message.status === 'queued')

      if (!canCancel) continue

      await updateEdielMessageStatus({
        actorUserId,
        edielMessageId: message.id,
        status: 'cancelled',
        failureReason: `Rensad från AGT ${testCase.testCaseCode}. Historik behålls men meddelandet ska inte skickas.`,
      })

      await createEdielMessageEvent({
        actorUserId,
        edielMessageId: message.id,
        eventType: 'manual_note',
        eventStatus: 'warning',
        message: `AGT ${testCase.testCaseCode}: gammalt oskickat AGT-meddelande makulerades från testfönstret.`,
        payload: { agt: true, testCaseCode: testCase.testCaseCode, testRunId: run.id, cleanup: true },
      })
    }

    if (keepRunId && run.id !== keepRunId && (run.status === 'draft' || run.status === 'running')) {
      await updateEdielTestRunStatus({
        actorUserId,
        testRunId: run.id,
        status: 'cancelled',
        failureReason: `Rensad från AGT ${testCase.testCaseCode}; aktuell run behölls: ${keepRunId}.`,
        completedAt: new Date().toISOString(),
      })
    }
  }

  revalidateAgt()
  redirect(`/admin/ediel/agt/${testCase.testCaseCode}`)
}

// Backwards-compatible server action name for older imports. It cleans only unsent queued/prepared test commands.
export const cleanupAgtCaseDraftMessagesAction = cleanupAgtCaseUnsentMessagesAction
