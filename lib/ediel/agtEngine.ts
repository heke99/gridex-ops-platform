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
import { getEdielAgtSupplierRuntime } from '@/lib/ediel/agtRuntime'
import {
  attachEdielMessageToTestRun,
  createEdielMessage,
  createEdielMessageEvent,
  createEdielTestRun,
  getEdielMessageById,
  listAckMessagesForSource,
  listEdielTestRuns,
} from '@/lib/ediel/db'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { renderProdat26A, type ProdatEngineCode } from '@/lib/ediel/prodatEngine'
import {
  EDIEL_AGT_PORTAL_EDIEL_ID,
  EDIEL_AGT_PORTAL_SMTP,
  EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS,
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
  receiverSubAddress: string | null
  receiverEdielId: string
  receiverEmail: string
  applicationReference: string | null
  mailbox: string | null
  smtpFromEmail: string | null
  balanceResponsibleEdielId: string | null
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

function parseAgtActorNotes(notes?: string | null): { balanceResponsibleEdielId: string | null } {
  const text = trimOrNull(notes)
  if (!text) return { balanceResponsibleEdielId: null }

  try {
    const parsed = JSON.parse(text) as { balanceResponsibleEdielId?: unknown }
    return {
      balanceResponsibleEdielId:
        typeof parsed.balanceResponsibleEdielId === 'string' && parsed.balanceResponsibleEdielId.trim().length > 0
          ? parsed.balanceResponsibleEdielId.trim().toUpperCase()
          : null,
    }
  } catch {
    const match = text.match(/balanceResponsibleEdielId\s*[:=]\s*([A-Za-z0-9_-]+)/i)
    return { balanceResponsibleEdielId: match?.[1]?.toUpperCase() ?? null }
  }
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

function buildAgtSyntheticMeteringPointId(actorEdielId: string, definition: EdielAgtTestCaseDefinition): string {
  const numeric = digitsOnly(`${actorEdielId}${definition.testCaseCode === 'L7' ? '9' : '3'}`)
  return `735999${numeric.padStart(12, '0').slice(-12)}`
}

function buildAgtSyntheticCustomerId(actorEdielId: string): string {
  const numeric = digitsOnly(actorEdielId).padStart(4, '0').slice(-4)
  return `19700101${numeric}`
}

function buildAgtSyntheticCustomerName(actorEdielId: string): string {
  const suffix = sanitizeToken(actorEdielId, 8) || 'AKTOR'
  return `TESTKUND ${suffix}`
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

function getAgtOutboundProdatDefaults(definition: EdielAgtTestCaseDefinition): {
  reasonForTransaction: string
  meteringMethod: string
  includePowerOfAttorneyReference: boolean
} {
  // AGT-testregel, inte tenant-/referenshårdkodning:
  // L7 i leverantörs-AGT valideras som Z09G-lik ändring där portalen förväntar
  // 223 = E32 och 217 = Z04. Tidigare E64/Z03 passerade EDIFACT-validering
  // men föll på testdata-matchningen i Edielportalen.
  if (definition.testCaseCode === 'L7' && definition.messageCode === 'Z09') {
    return {
      reasonForTransaction: 'E32',
      meteringMethod: 'Z04',
      includePowerOfAttorneyReference: false,
    }
  }

  return {
    reasonForTransaction: 'Z22',
    meteringMethod: 'Z03',
    includePowerOfAttorneyReference: true,
  }
}

async function resolveAgtActorRuntime(params?: {
  actorName?: string | null
  actorEdielId?: string | null
}): Promise<EdielAgtActorRuntime> {
  const explicitActorEdielId = trimOrNull(params?.actorEdielId)
  const explicitActorName = trimOrNull(params?.actorName)
  const [actor, agtRuntime] = await Promise.all([
    resolveCanonicalActorContext('test').catch(() => null),
    getEdielAgtSupplierRuntime().catch(() => null),
  ])
  const activeActor = agtRuntime?.actor ?? actor?.actor ?? null
  const agtNotes = parseAgtActorNotes(activeActor?.notes ?? null)

  const actorEdielId = explicitActorEdielId ?? actor?.senderEdielId ?? activeActor?.actor_ediel_id ?? ''
  const actorName = explicitActorName ?? actor?.senderName ?? activeActor?.sender_name ?? activeActor?.actor_name ?? 'Leverantör'

  return {
    actorEdielId,
    actorName,
    senderSubAddress: agtRuntime?.prodat.profile?.sender_sub_address ?? activeActor?.sender_sub_address ?? null,
    receiverSubAddress: EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS,
    receiverEdielId: agtRuntime?.prodat.profile?.receiver_ediel_id ?? EDIEL_AGT_PORTAL_EDIEL_ID,
    receiverEmail: agtRuntime?.prodat.route?.target_email ?? EDIEL_AGT_PORTAL_SMTP,
    applicationReference: agtRuntime?.prodat.profile?.application_reference ?? '23-DDQ-PRODAT',
    mailbox: actor?.mailbox ?? activeActor?.mailbox ?? 'agt-file-engine',
    smtpFromEmail: actor?.smtpFromEmail ?? activeActor?.smtp_from_email ?? null,
    balanceResponsibleEdielId: agtNotes.balanceResponsibleEdielId,
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
      description: 'AGT kan inte köras utan leverantörens Ediel-id. Värdet ska komma från aktiv SaaS-tenant/aktörskort, inte från Gridcore/TGT.',
    })
  }

  if (actor.actorEdielId === '92825') {
    issues.push({
      severity: 'error',
      code: 'gridcore_sender_in_actor_test',
      title: 'Gridcore/TGT-id får inte användas som leverantörsaktör',
      description: '92825 hör till Gridcore/Systemtest. Leverantörens AGT ska skickas med aktiv tenant/aktörs eget Ediel-id.',
    })
  }

  if (!trimOrNull(actor.balanceResponsibleEdielId)) {
    issues.push({
      severity: 'warning',
      code: 'agt_balance_responsible_missing',
      title: 'Balansansvarig Ediel-id saknas',
      description: 'L1 PRODAT Z03 kräver NAD+Z02 enligt portalens validering. Fyll i balansansvarig Ediel-id innan outbound-draft skapas för L1/L7. L2-L5 är inbound-tester och ska inte blockeras av detta.',
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
      'PRODAT använder tenantens sparade UNB sender-subadress och receiver-subadress PRODAT. För Div3rsa är sender-subadress tom. UTILTS använder ingen subadress.',
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
  const agtProdatDefaults = getAgtOutboundProdatDefaults(definition)

  const rendered = renderProdat26A({
    context: {
      code,
      bgmReference: externalReference,
      transactionReference,
      senderEdielId: params.actor.actorEdielId,
      receiverEdielId: params.actor.receiverEdielId,
      customerName: buildAgtSyntheticCustomerName(params.actor.actorEdielId),
      customerId: buildAgtSyntheticCustomerId(params.actor.actorEdielId),
      customerIdCodeListQualifier: 'SE2',
      meterPointId: buildAgtSyntheticMeteringPointId(params.actor.actorEdielId, definition),
      gridAreaId: 'TES',
      startDate,
      customerAddress: 'TESTGATAN 1',
      customerPostalCode: '11111',
      customerCity: 'STOCKHOLM',
      customerCountry: 'SE',
      siteAddress: 'TESTGATAN 1',
      sitePostalCode: '11111',
      siteCity: 'STOCKHOLM',
      siteCountry: 'SE',
      reasonForTransaction: agtProdatDefaults.reasonForTransaction,
      meteringMethod: agtProdatDefaults.meteringMethod,
      powerOfAttorneyReference: agtProdatDefaults.includePowerOfAttorneyReference ? `AGT-${externalReference}` : null,
      balanceResponsibleId: params.actor.balanceResponsibleEdielId,
    },
    portalSnapshot: {
      reasonForTransaction: agtProdatDefaults.reasonForTransaction,
      meteringMethod: agtProdatDefaults.meteringMethod,
      customerName: buildAgtSyntheticCustomerName(params.actor.actorEdielId),
      customerId: buildAgtSyntheticCustomerId(params.actor.actorEdielId),
      customerIdCodeListQualifier: 'SE2',
      facilityId: buildAgtSyntheticMeteringPointId(params.actor.actorEdielId, definition),
      gridAreaId: 'TES',
      agreementStartDateTime: `${startDate}0000`,
      powerOfAttorneyReference: agtProdatDefaults.includePowerOfAttorneyReference ? `AGT-${externalReference}` : null,
      balanceResponsibleId: params.actor.balanceResponsibleEdielId,
    },
  })

  const envelope = buildEdifactEnvelope({
    senderEdielId: params.actor.actorEdielId,
    senderSubAddress: params.actor.senderSubAddress,
    receiverEdielId: params.actor.receiverEdielId,
    receiverSubAddress: params.actor.receiverSubAddress,
    applicationReference: params.actor.applicationReference ?? '23-DDQ-PRODAT',
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
    senderSubAddress: params.actor.senderSubAddress,
    receiverEdielId: params.actor.receiverEdielId,
    receiverName: 'Edielportalen AGT',
    receiverSubAddress: params.actor.receiverSubAddress,
    senderEmail: params.actor.smtpFromEmail,
    receiverEmail: params.actor.receiverEmail,
    subject: `AGT ${definition.testCaseCode} PRODAT ${code} ${externalReference}`,
    fileName: `AGT_${definition.testCaseCode}_${code}_${externalReference}.edi`,
    mimeType: 'application/edifact',
    interchangeReference: envelope.interchangeReference,
    externalReference,
    correlationReference: transactionReference,
    transactionReference,
    applicationReference: params.actor.applicationReference ?? '23-DDQ-PRODAT',
    rawPayload: envelope.raw,
    parsedPayload: {
      agt: true,
      agtApprovalVersion: definition.approvalVersion,
      agtTestCaseCode: definition.testCaseCode,
      agtPortalTitle: definition.portalTitle,
      agtScenario: definition.scenario,
      generator: 'ediel.agtEngine.buildAgtProdatDraftInput',
      actorEdielId: params.actor.actorEdielId,
      portalEdielId: params.actor.receiverEdielId,
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

  if (!trimOrNull(readiness.actor.balanceResponsibleEdielId)) {
    throw new Error('Outbound AGT PRODAT kräver NAD+Z02. Fyll i balansansvarig/BRP Ediel-id i AGT-runtime innan du skapar L1/L7-draft. Detta stoppar bara felaktig outbound-payload, inte L2-L5 inbound-testerna.')
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
      portalEdielId: readiness.actor.receiverEdielId,
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
      text: 'The object could not be identified',
      referenceQualifier: sourceMessage.metering_point_id ? 'Z07' : null,
      referenceNumber: sourceMessage.metering_point_id ?? null,
      lineItemReference: sourceMessage.transaction_reference ?? null,
    },
  ]
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function hasAgtSyntaxFailure(sourceMessage: EdielMessageRow): boolean {
  const report = sourceMessage.validation_report ?? {}
  const errors = asArray(report.errors)
  const syntaxErrors = asArray(report.syntaxErrors)

  return (
    sourceMessage.syntax_check_status === 'failed' ||
    report.syntaxAccepted === false ||
    report.syntaxCheckStatus === 'failed' ||
    report.syntaxRejected === true ||
    errors.length > 0 ||
    syntaxErrors.length > 0
  )
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

    if (hasAgtSyntaxFailure(sourceMessage)) {
      return [
        { ackFamily: 'CONTRL', outcome: 'negative', messageText: 'AGT: syntaxfel eller valideringsfel i inbound PRODAT', applicationErrors: null, stepNo: contrlStep?.stepNo ?? null },
      ]
    }

    return [
      { ackFamily: 'CONTRL', outcome: 'positive', messageText: null, applicationErrors: null, stepNo: contrlStep?.stepNo ?? null },
      { ackFamily: 'APERAK', outcome: 'negative', messageText: 'AGT: Uppgifter saknas i produktionsapplikationen', applicationErrors: agtGenericAperakErrors(sourceMessage), stepNo: aperakStep?.stepNo ?? null },
    ]
  }

  if (family === 'UTILTS') {
    const contrlStep = definition ? findStep(definition, { actor: 'actor', direction: 'outbound', family: 'CONTRL' }) : null
    const errStep = definition ? findStep(definition, { actor: 'actor', direction: 'outbound', family: 'UTILTS_ERR' }) : null

    if (hasAgtSyntaxFailure(sourceMessage)) {
      return [
        { ackFamily: 'CONTRL', outcome: 'negative', messageText: 'AGT: syntaxfel eller valideringsfel i inbound UTILTS', applicationErrors: null, stepNo: contrlStep?.stepNo ?? null },
      ]
    }

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

  if (
    definition?.direction === 'portal_to_actor' &&
    (
      upper(sourceMessage.message_family) !== upper(definition.messageFamily) ||
      upper(String(sourceMessage.message_code ?? '')) !== upper(definition.messageCode)
    )
  ) {
    throw new Error(
      `AGT ${definition.testCaseCode} ska bara skapa svar från portalens affärsmeddelande ${definition.messageFamily}/${definition.messageCode}. Kvittenser eller gamla testmeddelanden ska bara visas/länkas, inte generera nya svar.`
    )
  }

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
