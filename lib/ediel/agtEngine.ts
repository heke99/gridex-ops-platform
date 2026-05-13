// lib/ediel/agtEngine.ts

import {
  buildAperakDraft,
  buildContrlDraft,
  buildUtiltsErrDraft,
  type AckFamily,
  type AckOutcome,
  type EdielAperakApplicationError,
} from '@/lib/ediel/ack'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { resolveCanonicalActorContext } from '@/lib/ediel/core/actorRegistry'
import {
  attachEdielMessageToTestRun,
  createEdielMessage,
  createEdielMessageEvent,
  createEdielTestRun,
  getEdielMessageById,
  listAckMessagesForSource,
  listEdielTestRuns,
} from '@/lib/ediel/db'
import {
  DIV3RSA_PRODUCTION_EDIEL_ID,
  EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
  EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
  EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS,
  EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
  EDIEL_TGT_TESTSYSTEM_EMAIL,
} from '@/lib/ediel/fileEngine'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { renderProdat26A, type ProdatEngineCode } from '@/lib/ediel/prodatEngine'
import {
  getEdielAgtTestCaseByCode,
  inferEdielAgtCaseForInboundMessage,
  isEdielAgtRunApprovalVersion,
  type EdielAgtExpectedStep,
  type EdielAgtTestCaseDefinition,
} from '@/lib/ediel/agtRegistry'
import { computeOutboundAckDueAt, deriveEdielAckDefaults } from '@/lib/ediel/references'
import type {
  CreateEdielMessageInput,
  EdielMessageRow,
  EdielTestRunRow,
} from '@/lib/ediel/types'

export type EdielAgtActorRuntime = {
  actorName: string
  actorEdielId: string
  senderSubAddress: string | null
  mailbox: string | null
  smtpFromEmail: string | null
}

export type EdielAgtReadinessIssue = {
  severity: 'error' | 'warning'
  code: string
  title: string
  description: string
}

export type EdielAgtReadiness = {
  actor: EdielAgtActorRuntime
  issues: EdielAgtReadinessIssue[]
  isReadyForAgt: boolean
}

export type EdielAgtAckPlanItem = {
  ackFamily: Extract<AckFamily, 'CONTRL' | 'APERAK' | 'UTILTS_ERR'>
  outcome: AckOutcome
  messageText: string | null
  applicationErrors: EdielAperakApplicationError[] | null
  stepNo: number | null
}

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function upper(value?: string | null): string {
  return String(value ?? '').trim().toUpperCase()
}

function agtStamp(date = new Date()): string {
  const yy = String(date.getFullYear()).slice(-2)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${yy}${month}${day}${hour}${minute}${second}`
}

function datePlusDays102(days: number, base = new Date()): string {
  const date = new Date(base)
  date.setDate(date.getDate() + days)
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function sanitizeToken(value: string, maxLength = 35): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, maxLength)
}

function agtDocumentReference(definition: EdielAgtTestCaseDefinition): string {
  return sanitizeToken(`AGT${definition.testCaseCode}${definition.messageCode}${agtStamp()}`, 20)
}

function agtTransactionReference(definition: EdielAgtTestCaseDefinition): string {
  return sanitizeToken(`LIAGT${definition.testCaseCode}${definition.messageCode}${agtStamp()}`, 25)
}

async function resolveAgtActorRuntime(params?: {
  actorName?: string | null
  actorEdielId?: string | null
}): Promise<EdielAgtActorRuntime> {
  const explicitActorEdielId = trimOrNull(params?.actorEdielId)
  const explicitActorName = trimOrNull(params?.actorName)

  if (explicitActorEdielId) {
    return {
      actorEdielId: explicitActorEdielId,
      actorName: explicitActorName ?? 'Div3rsa AB',
      senderSubAddress: EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS,
      mailbox: 'agt-file-engine',
      smtpFromEmail: null,
    }
  }

  const actor = await resolveCanonicalActorContext('test').catch(() => null)

  return {
    actorEdielId: actor?.senderEdielId ?? DIV3RSA_PRODUCTION_EDIEL_ID,
    actorName: explicitActorName ?? actor?.senderName ?? actor?.actor.actor_name ?? 'Div3rsa AB',
    senderSubAddress: actor?.senderSubAddress ?? EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS,
    mailbox: actor?.mailbox ?? 'agt-file-engine',
    smtpFromEmail: actor?.smtpFromEmail ?? null,
  }
}

export async function getEdielAgtReadiness(params?: {
  actorName?: string | null
  actorEdielId?: string | null
}): Promise<EdielAgtReadiness> {
  const actor = await resolveAgtActorRuntime(params)
  const issues: EdielAgtReadinessIssue[] = []

  if (!trimOrNull(actor.actorEdielId)) {
    issues.push({
      severity: 'error',
      code: 'actor_ediel_id_missing',
      title: 'Aktörens Ediel-id saknas',
      description: 'AGT kan inte köras utan leverantörens Ediel-id. För Div3rsa AB ska värdet vara 21660.',
    })
  }

  if (actor.actorEdielId === '92825') {
    issues.push({
      severity: 'error',
      code: 'gridcore_sender_in_actor_test',
      title: 'Gridcore/TGT-id får inte användas som Div3rsa-aktör',
      description: '92825 hör till Gridcore/Systemtest. Div3rsa AGT ska skickas med aktörens Ediel-id 21660 eller respektive SaaS-kunds eget Ediel-id.',
    })
  }

  if (actor.actorEdielId !== DIV3RSA_PRODUCTION_EDIEL_ID) {
    issues.push({
      severity: 'warning',
      code: 'non_div3rsa_actor',
      title: 'Annat Ediel-id än Div3rsa',
      description: `AGT-runtime använder ${actor.actorEdielId}. Det är korrekt för SaaS-kund men inte för Div3rsa AB om du testar Div3rsa nu.`,
    })
  }

  return {
    actor,
    issues,
    isReadyForAgt: issues.every((issue) => issue.severity !== 'error'),
  }
}

function agtApprovalVersion(): string {
  return 'AGT 2026A'
}

export async function createEdielSupplierAgtRun(params: {
  actorUserId: string
  testCaseCode: string
  suite?: 'PRODAT' | 'UTILTS' | null
  actorName?: string | null
  actorEdielId?: string | null
}): Promise<EdielTestRunRow> {
  const definition = getEdielAgtTestCaseByCode({
    suite: params.suite ?? null,
    roleCode: 'supplier',
    testCaseCode: params.testCaseCode,
  })

  if (!definition) {
    throw new Error(`Okänt AGT 2026A-testfall för leverantör: ${params.testCaseCode}`)
  }

  const readiness = await getEdielAgtReadiness({
    actorName: params.actorName ?? null,
    actorEdielId: params.actorEdielId ?? null,
  })

  if (!readiness.isReadyForAgt) {
    throw new Error(
      readiness.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => `${issue.title}: ${issue.description}`)
        .join(' | ')
    )
  }

  return createEdielTestRun({
    actorUserId: params.actorUserId,
    approvalVersion: `${agtApprovalVersion()} · ${readiness.actor.actorName} · ${readiness.actor.actorEdielId}`,
    roleCode: definition.roleCode,
    testSuite: definition.suite,
    testCaseCode: definition.testCaseCode,
    title: definition.title,
    status: 'running',
    startedAt: new Date().toISOString(),
    notes: [
      definition.purpose,
      definition.agtInstruction,
      `AGT-aktör: ${readiness.actor.actorName} (${readiness.actor.actorEdielId})`,
      'Motpart: Edielportalen 91100 / 91100@ediel.se.',
      'PRODAT använder subadress PRODAT. UTILTS använder ingen subadress.',
      ...definition.notes,
    ].join('\n'),
  })
}

function findStep(definition: EdielAgtTestCaseDefinition, params: {
  actor?: 'actor' | 'portal'
  family?: string
  code?: string
  direction?: string
}): EdielAgtExpectedStep | null {
  return definition.expectedSteps.find((step) => {
    if (params.actor && step.actor !== params.actor) return false
    if (params.direction && step.direction !== params.direction) return false
    if (params.family && upper(step.family) !== upper(params.family)) return false
    if (params.code && upper(step.code) !== upper(params.code)) return false
    return true
  }) ?? null
}

async function findActiveAgtRunForDefinition(definition: EdielAgtTestCaseDefinition): Promise<EdielTestRunRow | null> {
  const runs = await listEdielTestRuns()
  return runs.find((run) =>
    isEdielAgtRunApprovalVersion(run.approval_version) &&
    (run.status === 'running' || run.status === 'draft') &&
    run.test_suite === definition.suite &&
    run.role_code === definition.roleCode &&
    run.test_case_code === definition.testCaseCode
  ) ?? null
}

export async function autoAttachImportedMessageToActiveAgtRun(params: {
  actorUserId?: string | null
  edielMessage: EdielMessageRow
  explicitTestCaseCode?: string | null
}): Promise<{ testRunId: string; stepNo: number | null } | null> {
  if (params.edielMessage.direction !== 'inbound') return null

  const definition = inferEdielAgtCaseForInboundMessage({
    family: String(params.edielMessage.message_family ?? ''),
    code: String(params.edielMessage.message_code ?? ''),
    rawPayload: params.edielMessage.raw_payload,
    applicationReference: params.edielMessage.application_reference,
    explicitTestCaseCode: params.explicitTestCaseCode ?? null,
  })

  if (!definition) return null

  const activeRun = await findActiveAgtRunForDefinition(definition)
  if (!activeRun) return null

  const step = findStep(definition, {
    actor: 'portal',
    family: String(params.edielMessage.message_family ?? ''),
    code: String(params.edielMessage.message_code ?? ''),
    direction: 'inbound',
  }) ?? findStep(definition, {
    actor: 'portal',
    family: String(params.edielMessage.message_family ?? ''),
    direction: 'inbound',
  })

  const attached = await attachEdielMessageToTestRun({
    testRunId: activeRun.id,
    edielMessageId: params.edielMessage.id,
    stepNo: step?.stepNo ?? null,
    expectedDirection: step?.direction ?? 'inbound',
    expectedFamily: step?.family ?? String(params.edielMessage.message_family ?? ''),
    expectedCode: step?.code ?? String(params.edielMessage.message_code ?? ''),
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId ?? params.edielMessage.created_by ?? 'system',
    edielMessageId: params.edielMessage.id,
    eventType: 'linked',
    eventStatus: 'success',
    message: `Inbound-meddelande kopplat automatiskt till AGT ${definition.testCaseCode}.`,
    payload: {
      agt: true,
      testRunId: activeRun.id,
      testCaseCode: definition.testCaseCode,
      stepNo: attached.step_no,
    },
  })

  return { testRunId: activeRun.id, stepNo: attached.step_no }
}

function buildAgtProdatDraftInput(params: {
  actorUserId: string
  definition: EdielAgtTestCaseDefinition
  actor: EdielAgtActorRuntime
}): CreateEdielMessageInput {
  const definition = params.definition
  const code = definition.messageCode as ProdatEngineCode
  const externalReference = agtDocumentReference(definition)
  const transactionReference = agtTransactionReference(definition)
  const startDate = datePlusDays102(30)
  const reasonForTransaction = code === 'Z09' ? 'E64' : 'Z22'

  const rendered = renderProdat26A({
    context: {
      code,
      bgmReference: externalReference,
      transactionReference,
      senderEdielId: params.actor.actorEdielId,
      receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
      customerName: 'AGT TESTKUND',
      customerId: '197001010000',
      customerIdCodeListQualifier: 'SE2',
      meterPointId: '735999216600000001',
      gridAreaId: 'TES',
      startDate,
      customerAddress: 'AGTGATAN 1',
      customerPostalCode: '11111',
      customerCity: 'STOCKHOLM',
      customerCountry: 'SE',
      siteAddress: 'AGTGATAN 1',
      sitePostalCode: '11111',
      siteCity: 'STOCKHOLM',
      siteCountry: 'SE',
      reasonForTransaction,
      meteringMethod: 'Z03',
      powerOfAttorneyReference: `AGT-${externalReference}`,
    },
    portalSnapshot: {
      reasonForTransaction,
      meteringMethod: 'Z03',
      customerName: 'AGT TESTKUND',
      customerId: '197001010000',
      customerIdCodeListQualifier: 'SE2',
      facilityId: '735999216600000001',
      gridAreaId: 'TES',
      agreementStartDateTime: `${startDate}0000`,
      powerOfAttorneyReference: `AGT-${externalReference}`,
    },
  })

  const envelope = buildEdifactEnvelope({
    senderEdielId: params.actor.actorEdielId,
    senderSubAddress: EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS,
    receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
    receiverSubAddress: EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
    applicationReference: EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
    testFlag: 1,
    messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
    segments: rendered.segments,
  })

  const ack = deriveEdielAckDefaults({ family: 'PRODAT', code })

  return {
    actorUserId: params.actorUserId,
    direction: 'outbound',
    messageStandard: 'edifact',
    messageFamily: 'PRODAT',
    messageCode: code,
    messageVersion: '26A',
    processType: `agt_supplier_${definition.testCaseCode.toLowerCase()}`,
    environment: 'test',
    testFlag: 1,
    status: 'draft',
    transportType: 'smtp',
    mailbox: params.actor.mailbox,
    senderEdielId: params.actor.actorEdielId,
    senderName: params.actor.actorName,
    senderSubAddress: EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS,
    receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
    receiverName: 'Edielportalen AGT',
    receiverSubAddress: EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
    senderEmail: params.actor.smtpFromEmail,
    receiverEmail: EDIEL_TGT_TESTSYSTEM_EMAIL,
    subject: `AGT ${definition.testCaseCode} PRODAT ${code} ${externalReference}`,
    fileName: `AGT_${definition.testCaseCode}_${code}_${externalReference}.edi`,
    mimeType: 'application/edifact',
    interchangeReference: envelope.interchangeReference,
    externalReference,
    correlationReference: transactionReference,
    transactionReference,
    applicationReference: EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
    rawPayload: envelope.raw,
    parsedPayload: {
      agt: true,
      agtApprovalVersion: definition.approvalVersion,
      agtTestCaseCode: definition.testCaseCode,
      agtPortalTitle: definition.portalTitle,
      agtScenario: definition.scenario,
      generator: 'ediel.agtEngine.buildAgtProdatDraftInput',
      actorEdielId: params.actor.actorEdielId,
      portalEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
      prodatEngine: rendered.diagnostics,
    },
    validationReport: {
      ok: true,
      agt: true,
      errors: [],
      warnings: rendered.issues.map((issue) => `${issue.title}: ${issue.description}`),
      expectedPortalResponse: 'positive CONTRL + negative APERAK',
      instruction: definition.agtInstruction,
    },
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: ack.utiltsErrStatus,
    syntaxCheckStatus: 'not_checked',
    functionalCheckStatus: 'not_checked',
    ackDueAt: computeOutboundAckDueAt({
      requiresContrl: ack.requiresContrl,
      requiresAperak: ack.requiresAperak,
      contrlStatus: ack.contrlStatus,
      aperakStatus: ack.aperakStatus,
      utiltsErrStatus: ack.utiltsErrStatus,
    }),
  }
}

export async function createEdielSupplierAgtOutboundDraft(params: {
  actorUserId: string
  testRunId?: string | null
  testCaseCode: string
  actorName?: string | null
  actorEdielId?: string | null
}): Promise<EdielMessageRow> {
  const definition = getEdielAgtTestCaseByCode({
    roleCode: 'supplier',
    testCaseCode: params.testCaseCode,
  })

  if (!definition) throw new Error(`Okänt AGT-testfall: ${params.testCaseCode}`)
  if (definition.suite !== 'PRODAT' || definition.scenario !== 'actor_sends_and_receives_ack') {
    throw new Error(`${definition.testCaseCode} ägs av Edielportalen. Vänta på inbound-meddelande och skapa AGT-svar från meddelanderaden.`)
  }

  const readiness = await getEdielAgtReadiness({
    actorName: params.actorName ?? null,
    actorEdielId: params.actorEdielId ?? null,
  })
  if (!readiness.isReadyForAgt) {
    throw new Error(readiness.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.description).join(' | '))
  }

  const message = await createEdielMessage(buildAgtProdatDraftInput({
    actorUserId: params.actorUserId,
    definition,
    actor: readiness.actor,
  }))

  const run = params.testRunId
    ? await getActiveRunById(params.testRunId)
    : await findActiveAgtRunForDefinition(definition)

  if (run) {
    const step = findStep(definition, {
      actor: 'actor',
      direction: 'outbound',
      family: 'PRODAT',
      code: definition.messageCode,
    })

    await attachEdielMessageToTestRun({
      testRunId: run.id,
      edielMessageId: message.id,
      stepNo: step?.stepNo ?? 1,
      expectedDirection: 'outbound',
      expectedFamily: 'PRODAT',
      expectedCode: definition.messageCode,
    })
  }

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: message.id,
    eventType: 'prepared',
    eventStatus: 'success',
    message: `AGT ${definition.testCaseCode} ${definition.messageCode}-draft skapad. Kontrollera payload och skicka när motsvarande test är startat i Edielportalen.`,
    payload: {
      agt: true,
      testCaseCode: definition.testCaseCode,
      testRunId: run?.id ?? null,
      actorEdielId: readiness.actor.actorEdielId,
      portalEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
    },
  })

  return message
}

async function getActiveRunById(testRunId: string | null | undefined): Promise<EdielTestRunRow | null> {
  if (!testRunId) return null
  const runs = await listEdielTestRuns()
  return runs.find((run) => run.id === testRunId && (run.status === 'running' || run.status === 'draft')) ?? null
}

function agtGenericAperakErrors(sourceMessage: EdielMessageRow): EdielAperakApplicationError[] {
  return [
    {
      ercCode: '40',
      fieldCode: '105',
      text: `AGT ${sourceMessage.message_family} ${sourceMessage.message_code}: meddelandet innehåller uppgifter som inte finns i aktörens produktionsapplikation`,
      referenceQualifier: sourceMessage.metering_point_id ? 'Z07' : null,
      referenceNumber: sourceMessage.metering_point_id ?? null,
      lineItemReference: sourceMessage.transaction_reference ?? null,
    },
  ]
}

function planForInboundSource(sourceMessage: EdielMessageRow, definition: EdielAgtTestCaseDefinition | null): EdielAgtAckPlanItem[] {
  const family = upper(sourceMessage.message_family)

  if (family === 'CONTRL') return []

  if (family === 'APERAK' || family === 'UTILTS_ERR') {
    return [
      { ackFamily: 'CONTRL', outcome: 'positive', messageText: null, applicationErrors: null, stepNo: null },
    ]
  }

  if (family === 'PRODAT') {
    const contrlStep = definition ? findStep(definition, { actor: 'actor', direction: 'outbound', family: 'CONTRL' }) : null
    const aperakStep = definition ? findStep(definition, { actor: 'actor', direction: 'outbound', family: 'APERAK' }) : null
    return [
      { ackFamily: 'CONTRL', outcome: 'positive', messageText: null, applicationErrors: null, stepNo: contrlStep?.stepNo ?? null },
      { ackFamily: 'APERAK', outcome: 'negative', messageText: 'AGT: Uppgifter saknas i produktionsapplikationen', applicationErrors: agtGenericAperakErrors(sourceMessage), stepNo: aperakStep?.stepNo ?? null },
    ]
  }

  if (family === 'UTILTS') {
    const contrlStep = definition ? findStep(definition, { actor: 'actor', direction: 'outbound', family: 'CONTRL' }) : null
    const errStep = definition ? findStep(definition, { actor: 'actor', direction: 'outbound', family: 'UTILTS_ERR' }) : null
    return [
      { ackFamily: 'CONTRL', outcome: 'positive', messageText: null, applicationErrors: null, stepNo: contrlStep?.stepNo ?? null },
      { ackFamily: 'UTILTS_ERR', outcome: 'negative', messageText: 'E14', applicationErrors: null, stepNo: errStep?.stepNo ?? null },
    ]
  }

  return []
}

function buildAckDraftForAgtPlan(params: {
  sourceMessage: EdielMessageRow
  plan: EdielAgtAckPlanItem
  actorUserId: string
}): CreateEdielMessageInput {
  if (params.plan.ackFamily === 'CONTRL') {
    return buildContrlDraft({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      outcome: params.plan.outcome,
    })
  }

  if (params.plan.ackFamily === 'UTILTS_ERR') {
    return buildUtiltsErrDraft({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      messageText: params.plan.messageText ?? 'E14',
    })
  }

  return buildAperakDraft({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    outcome: params.plan.outcome,
    messageText: params.plan.messageText,
    applicationErrors: params.plan.applicationErrors,
  })
}

export async function createEdielSupplierAgtResponsesForInbound(params: {
  actorUserId: string
  sourceMessageId: string
  testCaseCode?: string | null
  testRunId?: string | null
}): Promise<EdielMessageRow[]> {
  const sourceMessage = await getEdielMessageById(params.sourceMessageId)
  if (!sourceMessage) throw new Error('Källmeddelande hittades inte')
  if (sourceMessage.direction !== 'inbound') {
    throw new Error('AGT-svar kan bara skapas från inbound-meddelanden från Edielportalen.')
  }

  const definition = inferEdielAgtCaseForInboundMessage({
    family: sourceMessage.message_family,
    code: String(sourceMessage.message_code ?? ''),
    rawPayload: sourceMessage.raw_payload,
    applicationReference: sourceMessage.application_reference,
    explicitTestCaseCode: params.testCaseCode ?? null,
  })

  const plan = planForInboundSource(sourceMessage, definition)
  if (plan.length === 0) {
    throw new Error('Det finns inget AGT-svar att skapa för detta meddelande. CONTRL ska inte kvitteras, och okänd familj saknar AGT-regel.')
  }

  const activeRun = params.testRunId
    ? await getActiveRunById(params.testRunId)
    : definition
      ? await findActiveAgtRunForDefinition(definition)
      : null

  if (definition && activeRun) {
    const sourceStep = findStep(definition, {
      actor: 'portal',
      direction: 'inbound',
      family: sourceMessage.message_family,
      code: String(sourceMessage.message_code ?? ''),
    }) ?? findStep(definition, {
      actor: 'portal',
      direction: 'inbound',
      family: sourceMessage.message_family,
    })

    await attachEdielMessageToTestRun({
      testRunId: activeRun.id,
      edielMessageId: sourceMessage.id,
      stepNo: sourceStep?.stepNo ?? null,
      expectedDirection: 'inbound',
      expectedFamily: sourceStep?.family ?? String(sourceMessage.message_family ?? ''),
      expectedCode: sourceStep?.code ?? String(sourceMessage.message_code ?? ''),
    })
  }

  const existingAcks = await listAckMessagesForSource({ sourceMessageId: sourceMessage.id })
  const created: EdielMessageRow[] = []

  for (const item of plan) {
    const alreadyExists = existingAcks.find((ack) =>
      ack.message_family === item.ackFamily &&
      ack.status !== 'cancelled' &&
      ack.status !== 'failed'
    )
    if (alreadyExists) {
      created.push(alreadyExists)
      continue
    }

    const draft = buildAckDraftForAgtPlan({
      actorUserId: params.actorUserId,
      sourceMessage,
      plan: item,
    })

    const ackMessage = await createCanonicalAckMessage({
      actorUserId: params.actorUserId,
      sourceMessage,
      ackFamily: item.ackFamily,
      outcome: item.ackFamily === 'UTILTS_ERR' ? undefined : item.outcome,
      draft,
    })

    if (activeRun && item.stepNo) {
      await attachEdielMessageToTestRun({
        testRunId: activeRun.id,
        edielMessageId: ackMessage.id,
        stepNo: item.stepNo,
        expectedDirection: 'outbound',
        expectedFamily: item.ackFamily,
        expectedCode: item.ackFamily,
      })
    }

    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: ackMessage.id,
      eventType:
        item.ackFamily === 'CONTRL'
          ? 'contrl_sent'
          : item.ackFamily === 'APERAK'
            ? 'aperak_sent'
            : 'utilts_err_sent',
      eventStatus: 'success',
      message: `AGT-preview skapad: ${item.ackFamily} ${item.ackFamily === 'UTILTS_ERR' ? 'negative' : item.outcome}. Kontrollera payload och skicka från kvittensraden.`,
      payload: {
        agt: true,
        sourceMessageId: sourceMessage.id,
        testCaseCode: definition?.testCaseCode ?? params.testCaseCode ?? null,
        testRunId: activeRun?.id ?? null,
        ackFamily: item.ackFamily,
        outcome: item.outcome,
        stepNo: item.stepNo,
      },
    })

    created.push(ackMessage)
  }

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: sourceMessage.id,
    eventType: 'manual_note',
    eventStatus: 'success',
    message: `AGT-svar skapades för ${definition?.testCaseCode ?? 'okänt AGT-test'}: ${created.map((row) => row.message_family).join(' + ')}.`,
    payload: {
      agt: true,
      testCaseCode: definition?.testCaseCode ?? params.testCaseCode ?? null,
      testRunId: activeRun?.id ?? null,
      createdMessageIds: created.map((row) => row.id),
    },
  })

  return created
}
