import { Buffer } from 'node:buffer'
import { supabaseService } from '@/lib/supabase/service'
import {
  attachEdielMessageToTestRun,
  createEdielMessageEvent,
  createEdielTestRun,
  getEdielMessageById,
  listAckMessagesForSource,
  listEdielTestRunMessages,
  listEdielMessagesByIds,
  updateEdielTestRunStatus,
} from '@/lib/ediel/db'
import {
  ACTOR_TEST_CASES,
  buildActorTestResultEvidence,
  getActorTestCase,
  mapTestStatusToRunStatus,
  type ActorTestCaseDefinition,
  type ActorTestResultRow,
  type ActorTestStatus,
  type ActorTestingCompanyRow,
} from '@/lib/ediel/actorTesting'
import {
  createEdielSupplierAgtOutboundCommand,
  createEdielSupplierAgtResponsesForInbound,
} from '@/lib/ediel/agtEngine'
import {
  inferEdielAgtCaseForInboundMessage,
  type EdielAgtExpectedStep,
} from '@/lib/ediel/agtRegistry'
import { sendQueuedEdielMessage } from '@/lib/ediel/orchestrator'
import type { EdielMessageRow, EdielTestRunRow } from '@/lib/ediel/types'

type MaybeString = string | null | undefined

export type ActorTestingAutoRunResult = {
  testRun: EdielTestRunRow
  result: ActorTestResultRow | null
  outboundMessage?: EdielMessageRow | null
  createdAckMessages: EdielMessageRow[]
  syncedStatus: ActorTestStatus
  note: string
}

export type ActorTestingEvidenceMessage = {
  id: string
  direction: string
  family: string
  code: string
  status: string
  ackOutcome: string | null
  senderEdielId: string | null
  receiverEdielId: string | null
  interchangeReference: string | null
  externalReference: string | null
  transactionReference: string | null
  applicationReference: string | null
  sentAt: string | null
  receivedAt: string | null
  rawPayload: string | null
}

export type ActorTestingEvidencePackage = {
  company: {
    id: string
    name: string
    orgNumber: string | null
    edielId: string | null
    role: string | null
    brpName: string | null
    brpEdielId: string | null
  }
  generatedAt: string
  tests: Array<{
    testKey: string
    testName: string
    testId: string | null
    packageKey: string | null
    messageFamily: string | null
    messageCode: string | null
    status: string | null
    portalStatus: string | null
    failureReason: string | null
    latestRunAt: string | null
    passedAt: string | null
    edielTestRunId: string | null
    messages: ActorTestingEvidenceMessage[]
    evidence: Record<string, unknown> | null
  }>
}

function trimOrNull(value: MaybeString): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function upper(value: MaybeString): string {
  return String(value ?? '').trim().toUpperCase()
}

function nowIso(): string {
  return new Date().toISOString()
}

function isTerminalStatus(status: ActorTestStatus): boolean {
  return status === 'passed' || status === 'manual_verified' || status === 'failed' || status === 'blocked'
}

function asActorTestStatus(status: string | null | undefined): ActorTestStatus {
  if (status === 'running' || status === 'passed' || status === 'failed' || status === 'blocked' || status === 'manual_verified') return status
  return 'not_started'
}

function isSentLike(message: EdielMessageRow | null | undefined): boolean {
  if (!message) return false
  return ['sent', 'queued', 'prepared', 'acknowledged', 'validated'].includes(String(message.status ?? ''))
}

function isPositiveContrl(message: EdielMessageRow | null | undefined): boolean {
  if (!message || upper(message.message_family) !== 'CONTRL') return false
  if (message.ack_outcome === 'positive') return true
  if (message.syntax_check_status === 'ok' || message.syntax_check_status === 'warning') return true
  return !String(message.raw_payload ?? '').includes("UCI+7") && !String(message.raw_payload ?? '').includes("UCI+4")
}

function isNegativeAperak(message: EdielMessageRow | null | undefined): boolean {
  if (!message || upper(message.message_family) !== 'APERAK') return false
  if (message.ack_outcome === 'negative') return true
  const raw = String(message.raw_payload ?? '').toUpperCase()
  return raw.includes('ERC+40') || raw.includes('ERC+41') || raw.includes('ERC+42') || raw.includes('BGM+313')
}

function isUtiltsErr(message: EdielMessageRow | null | undefined): boolean {
  return Boolean(message && upper(message.message_family) === 'UTILTS_ERR')
}

async function getCompany(companyId: string): Promise<ActorTestingCompanyRow> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Bolaget hittades inte.')
  return data as unknown as ActorTestingCompanyRow
}

async function findCompanyForMessage(message: EdielMessageRow): Promise<ActorTestingCompanyRow | null> {
  if (message.company_id) return getCompany(message.company_id)

  const ownEdielId = message.direction === 'inbound'
    ? trimOrNull(message.receiver_ediel_id)
    : trimOrNull(message.sender_ediel_id)

  if (!ownEdielId) return null

  const { data, error } = await supabaseService
    .from('companies')
    .select('*')
    .or(`ediel_id.eq.${ownEdielId},test_ediel_id.eq.${ownEdielId},production_ediel_id.eq.${ownEdielId}`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as unknown as ActorTestingCompanyRow | null) ?? null
}

function actorIdentityForCompany(company: ActorTestingCompanyRow) {
  return {
    actorName: company.name,
    actorEdielId: trimOrNull(company.test_ediel_id) ?? trimOrNull(company.ediel_id) ?? null,
    balanceResponsibleEdielId: trimOrNull(company.brp_ediel_id),
  }
}

async function getLatestResult(companyId: string, testKey: string): Promise<ActorTestResultRow | null> {
  const { data, error } = await supabaseService
    .from('actor_test_results')
    .select('*')
    .eq('company_id', companyId)
    .eq('test_key', testKey)
    .maybeSingle()

  if (error) throw error
  return (data as unknown as ActorTestResultRow | null) ?? null
}

async function findOrCreateActorTestRun(params: {
  actorUserId: string
  companyId: string
  testCase: ActorTestCaseDefinition
  status?: 'draft' | 'running'
}): Promise<EdielTestRunRow> {
  const { data, error } = await supabaseService
    .from('ediel_test_runs')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('test_suite', params.testCase.suite)
    .eq('role_code', 'supplier')
    .eq('test_case_code', params.testCase.key)
    .in('status', ['draft', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (data) return data as unknown as EdielTestRunRow

  return createEdielTestRun({
    actorUserId: params.actorUserId,
    companyId: params.companyId,
    approvalVersion: `AGT 2026A · ${params.testCase.label}`,
    roleCode: 'supplier',
    testSuite: params.testCase.suite,
    testCaseCode: params.testCase.key,
    title: params.testCase.label,
    status: params.status ?? 'running',
    startedAt: nowIso(),
    notes: JSON.stringify({
      actorTestingModule: true,
      automatedEngine: true,
      testId: params.testCase.testId,
      messageFamily: params.testCase.messageFamily,
      messageCode: params.testCase.messageCode,
      direction: params.testCase.direction,
    }),
  })
}

async function upsertActorResult(params: {
  actorUserId: string
  companyId: string
  testCase: ActorTestCaseDefinition
  status: ActorTestStatus
  runId?: string | null
  rawPayload?: string | null
  failureReason?: string | null
  portalStatus?: string | null
  evidence?: Record<string, unknown> | null
  contrlMessageId?: string | null
  aperakMessageId?: string | null
  utiltsErrMessageId?: string | null
}): Promise<ActorTestResultRow | null> {
  const timestamp = nowIso()
  const baseEvidence = buildActorTestResultEvidence({
    testCase: params.testCase,
    status: params.status,
    portalStatus: params.portalStatus ?? null,
    rawPayload: params.rawPayload ?? null,
    failureReason: params.failureReason ?? null,
    actorUserId: params.actorUserId,
  })
  const evidence = {
    ...baseEvidence,
    ...(params.evidence ?? {}),
    automatedEngine: true,
    updatedAt: timestamp,
  }

  const payload = {
    company_id: params.companyId,
    test_key: params.testCase.key,
    test_name: params.testCase.label,
    test_id: params.testCase.testId,
    package_key: params.testCase.packageKey,
    message_family: params.testCase.messageFamily,
    message_code: params.testCase.messageCode,
    direction: params.testCase.direction,
    status: params.status,
    latest_run_at: timestamp,
    passed_at: params.status === 'passed' || params.status === 'manual_verified' ? timestamp : null,
    failure_reason: params.failureReason ?? null,
    portal_status: params.portalStatus ?? null,
    raw_payload: params.rawPayload ?? null,
    ediel_test_run_id: params.runId ?? null,
    contrl_message_id: params.contrlMessageId ?? null,
    aperak_message_id: params.aperakMessageId ?? null,
    utilts_err_message_id: params.utiltsErrMessageId ?? null,
    evidence,
    created_by: params.actorUserId,
    updated_by: params.actorUserId,
    updated_at: timestamp,
  }

  const { data, error } = await supabaseService
    .from('actor_test_results')
    .upsert(payload, { onConflict: 'company_id,test_key' })
    .select('*')
    .maybeSingle()

  if (error) throw error

  if (params.runId) {
    await updateEdielTestRunStatus({
      actorUserId: params.actorUserId,
      testRunId: params.runId,
      status: mapTestStatusToRunStatus(params.status),
      failureReason: params.failureReason ?? null,
      completedAt: isTerminalStatus(params.status) ? timestamp : null,
    }).catch(() => null)
  }

  return (data as unknown as ActorTestResultRow | null) ?? null
}

function expectedStepForMessage(params: {
  testCase: ActorTestCaseDefinition
  message: EdielMessageRow
  steps?: EdielAgtExpectedStep[] | null
}): EdielAgtExpectedStep | null {
  const family = upper(params.message.message_family)
  const code = upper(String(params.message.message_code ?? ''))
  return (params.steps ?? []).find((step) =>
    upper(step.family) === family &&
    (upper(step.code) === code || upper(step.family) === code) &&
    step.direction === params.message.direction
  ) ?? null
}

async function attachMessage(params: {
  actorUserId: string
  testRunId: string
  message: EdielMessageRow
  testCase: ActorTestCaseDefinition
  steps?: EdielAgtExpectedStep[] | null
}) {
  const step = expectedStepForMessage(params)
  await attachEdielMessageToTestRun({
    testRunId: params.testRunId,
    edielMessageId: params.message.id,
    stepNo: step?.stepNo ?? null,
    expectedDirection: step?.direction ?? params.message.direction,
    expectedFamily: step?.family ?? String(params.message.message_family ?? ''),
    expectedCode: step?.code ?? String(params.message.message_code ?? ''),
  }).catch(() => null)

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'linked',
    eventStatus: 'success',
    message: `Meddelandet kopplades till aktörstest ${params.testCase.key}.`,
    payload: {
      actorTesting: true,
      testRunId: params.testRunId,
      testKey: params.testCase.key,
      stepNo: step?.stepNo ?? null,
    },
  }).catch(() => null)
}

async function sendMessageIfNeeded(actorUserId: string, message: EdielMessageRow): Promise<EdielMessageRow> {
  if (message.direction !== 'outbound') return message
  if (message.status === 'sent' || message.status === 'acknowledged') return message
  if (!['draft', 'prepared', 'queued'].includes(message.status)) return message
  return sendQueuedEdielMessage({ actorUserId, edielMessageId: message.id })
}

async function findMessagesForResult(result: ActorTestResultRow): Promise<EdielMessageRow[]> {
  const ids = [
    result.contrl_message_id,
    result.aperak_message_id,
    result.utilts_err_message_id,
  ].filter((value): value is string => Boolean(value))

  const runIds: string[] = []
  if (result.ediel_test_run_id) {
    const links = await listEdielTestRunMessages({ testRunId: result.ediel_test_run_id }).catch(() => [])
    runIds.push(...links.map((link) => link.ediel_message_id))
  }

  const uniqueIds = Array.from(new Set([...ids, ...runIds]))
  if (uniqueIds.length === 0) return []
  return listEdielMessagesByIds(uniqueIds, { companyId: result.company_id }).catch(() => [])
}

function firstMessage(messages: EdielMessageRow[], family: string, predicate?: (message: EdielMessageRow) => boolean): EdielMessageRow | null {
  return messages.find((message) => upper(message.message_family) === upper(family) && (!predicate || predicate(message))) ?? null
}

async function buildEvidenceFromMessages(params: {
  testCase: ActorTestCaseDefinition
  sourceMessage?: EdielMessageRow | null
  messages: EdielMessageRow[]
}) {
  const refs = params.messages.map((message) => ({
    id: message.id,
    direction: message.direction,
    family: message.message_family,
    code: message.message_code,
    status: message.status,
    ackOutcome: message.ack_outcome,
    senderEdielId: message.sender_ediel_id,
    receiverEdielId: message.receiver_ediel_id,
    interchangeReference: message.interchange_reference,
    externalReference: message.external_reference,
    transactionReference: message.transaction_reference,
    applicationReference: message.application_reference,
    sentAt: message.message_sent_at,
    receivedAt: message.message_received_at,
  }))

  return {
    evidenceVersion: 'actor-testing-automation-v1',
    testKey: params.testCase.key,
    testId: params.testCase.testId,
    sourceMessageId: params.sourceMessage?.id ?? null,
    messages: refs,
    createdFromRealEdielMessages: refs.length > 0,
  }
}

async function findInboundAcksForOutbound(companyId: string, outbound: EdielMessageRow): Promise<EdielMessageRow[]> {
  const refs = [
    outbound.id,
    outbound.interchange_reference,
    outbound.external_reference,
    outbound.transaction_reference,
    outbound.correlation_reference,
  ].map(trimOrNull).filter((value): value is string => Boolean(value))

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('company_id', companyId)
    .eq('direction', 'inbound')
    .in('message_family', ['CONTRL', 'APERAK', 'UTILTS_ERR'])
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  const rows = (data ?? []) as unknown as EdielMessageRow[]
  if (refs.length === 0) return rows
  return rows.filter((row) => {
    const haystack = [
      row.raw_payload,
      row.original_message_id,
      row.original_transaction_id,
      row.external_reference,
      row.transaction_reference,
      row.correlation_reference,
      row.application_reference,
      JSON.stringify(row.parsed_payload ?? {}),
    ].join(' ').toUpperCase()
    return refs.some((ref) => haystack.includes(ref.toUpperCase()))
  })
}

async function resolveEvidenceStatus(params: {
  testCase: ActorTestCaseDefinition
  companyId: string
  run: EdielTestRunRow
  sourceMessage?: EdielMessageRow | null
  createdAckMessages?: EdielMessageRow[]
}): Promise<{
  status: ActorTestStatus
  portalStatus: string
  failureReason: string | null
  messages: EdielMessageRow[]
  contrl: EdielMessageRow | null
  aperak: EdielMessageRow | null
  utiltsErr: EdielMessageRow | null
}> {
  const runLinks = await listEdielTestRunMessages({ testRunId: params.run.id }).catch(() => [])
  const linkedMessages = await listEdielMessagesByIds(runLinks.map((link) => link.ediel_message_id), { companyId: params.companyId }).catch(() => [])
  const created = params.createdAckMessages ?? []
  const source = params.sourceMessage ? [params.sourceMessage] : []
  let messages = Array.from(new Map([...source, ...linkedMessages, ...created].map((message) => [message.id, message])).values())

  if (params.testCase.direction === 'actor_to_portal') {
    const outbound = messages.find((message) => message.direction === 'outbound' && upper(message.message_family) === 'PRODAT') ?? params.sourceMessage ?? null
    const inboundAcks = outbound ? await findInboundAcksForOutbound(params.companyId, outbound) : []
    messages = Array.from(new Map([...messages, ...inboundAcks].map((message) => [message.id, message])).values())

    const contrl = firstMessage(messages, 'CONTRL', isPositiveContrl)
    const aperak = firstMessage(messages, 'APERAK', isNegativeAperak)
    if (contrl && aperak) {
      return {
        status: 'passed',
        portalStatus: 'Beviskedja komplett: outbound + positiv CONTRL + negativ APERAK från Edielportalen.',
        failureReason: null,
        messages,
        contrl,
        aperak,
        utiltsErr: null,
      }
    }
    return {
      status: 'running',
      portalStatus: `Skickad. Väntar på ${contrl ? '' : 'positiv CONTRL'}${!contrl && !aperak ? ' och ' : ''}${aperak ? '' : 'negativ APERAK'} från Edielportalen.`,
      failureReason: null,
      messages,
      contrl,
      aperak,
      utiltsErr: null,
    }
  }

  const contrl = firstMessage(messages, 'CONTRL')
  const aperak = firstMessage(messages, 'APERAK')
  const utiltsErr = firstMessage(messages, 'UTILTS_ERR')
  const sourceBusiness = messages.find((message) =>
    message.direction === 'inbound' &&
    upper(message.message_family) === upper(params.testCase.messageFamily) &&
    upper(String(message.message_code ?? '')) === upper(params.testCase.messageCode)
  ) ?? params.sourceMessage ?? null

  if (!sourceBusiness) {
    return {
      status: 'running',
      portalStatus: 'Testet är startat. Väntar på inbound från Edielportalen.',
      failureReason: null,
      messages,
      contrl,
      aperak,
      utiltsErr,
    }
  }

  if (params.testCase.messageFamily === 'PRODAT') {
    if (contrl && aperak && isSentLike(contrl) && isSentLike(aperak)) {
      return {
        status: 'passed',
        portalStatus: 'Beviskedja komplett: inbound PRODAT + CONTRL + APERAK skapad/skickad.',
        failureReason: null,
        messages,
        contrl,
        aperak,
        utiltsErr,
      }
    }
    return {
      status: 'running',
      portalStatus: 'Inbound PRODAT mottagen. Väntar på komplett CONTRL/APERAK-kedja.',
      failureReason: null,
      messages,
      contrl,
      aperak,
      utiltsErr,
    }
  }

  const utiltsBusinessReply = utiltsErr ?? aperak
  if (contrl && utiltsBusinessReply && isSentLike(contrl) && isSentLike(utiltsBusinessReply)) {
    return {
      status: 'passed',
      portalStatus: utiltsErr
        ? 'Beviskedja komplett: inbound UTILTS + CONTRL + UTILTS_ERR skapad/skickad.'
        : 'Beviskedja komplett: inbound UTILTS + CONTRL + APERAK skapad/skickad.',
      failureReason: null,
      messages,
      contrl,
      aperak,
      utiltsErr,
    }
  }

  return {
    status: 'running',
    portalStatus: 'Inbound UTILTS mottagen. Väntar på komplett CONTRL och APERAK/UTILTS_ERR-kedja.',
    failureReason: null,
    messages,
    contrl,
    aperak,
    utiltsErr,
  }
}

export async function runActorTestAutomation(params: {
  actorUserId: string
  companyId: string
  testKey: string
  autoSend?: boolean
}): Promise<ActorTestingAutoRunResult> {
  const testCase = getActorTestCase(params.testKey)
  if (!testCase) throw new Error('Okänt aktörstest.')
  const company = await getCompany(params.companyId)
  const run = await findOrCreateActorTestRun({
    actorUserId: params.actorUserId,
    companyId: params.companyId,
    testCase,
  })

  await upsertActorResult({
    actorUserId: params.actorUserId,
    companyId: params.companyId,
    testCase,
    status: 'running',
    runId: run.id,
    portalStatus: testCase.direction === 'actor_to_portal' ? 'Skapar och skickar outbound mot Edielportalen.' : 'Väntar på inbound från Edielportalen.',
  })

  if (testCase.direction === 'actor_to_portal') {
    const identity = actorIdentityForCompany(company)
    const outbound = await createEdielSupplierAgtOutboundCommand({
      actorUserId: params.actorUserId,
      testRunId: run.id,
      testCaseCode: testCase.key,
      actorName: identity.actorName,
      actorEdielId: identity.actorEdielId,
      balanceResponsibleEdielId: identity.balanceResponsibleEdielId,
      companyId: params.companyId,
    })

    await attachMessage({
      actorUserId: params.actorUserId,
      testRunId: run.id,
      message: outbound,
      testCase,
    })

    const sent = params.autoSend === false ? outbound : await sendMessageIfNeeded(params.actorUserId, outbound)
    const status = await resolveEvidenceStatus({
      testCase,
      companyId: params.companyId,
      run,
      sourceMessage: sent,
    })
    const evidence = await buildEvidenceFromMessages({ testCase, sourceMessage: sent, messages: status.messages })
    const result = await upsertActorResult({
      actorUserId: params.actorUserId,
      companyId: params.companyId,
      testCase,
      status: status.status,
      runId: run.id,
      rawPayload: sent.raw_payload,
      portalStatus: status.portalStatus,
      failureReason: status.failureReason,
      evidence,
      contrlMessageId: status.contrl?.id ?? null,
      aperakMessageId: status.aperak?.id ?? null,
      utiltsErrMessageId: status.utiltsErr?.id ?? null,
    })

    return {
      testRun: run,
      result,
      outboundMessage: sent,
      createdAckMessages: [],
      syncedStatus: status.status,
      note: status.portalStatus,
    }
  }

  const existing = await syncActorTestResultFromExistingMessages({
    actorUserId: params.actorUserId,
    companyId: params.companyId,
    testKey: testCase.key,
    autoRespond: true,
    autoSend: params.autoSend !== false,
  })

  return {
    testRun: run,
    result: existing.result,
    outboundMessage: null,
    createdAckMessages: existing.createdAckMessages,
    syncedStatus: existing.status,
    note: existing.portalStatus,
  }
}

export async function syncActorTestingForMessage(params: {
  actorUserId: string
  edielMessage: EdielMessageRow
  explicitTestCaseCode?: string | null
  autoRespond?: boolean
  autoSend?: boolean
}): Promise<{ companyId: string; testKey: string; status: ActorTestStatus; createdAckMessages: EdielMessageRow[] } | null> {
  const definition = inferEdielAgtCaseForInboundMessage({
    family: params.edielMessage.message_family,
    code: String(params.edielMessage.message_code ?? ''),
    rawPayload: params.edielMessage.raw_payload,
    applicationReference: params.edielMessage.application_reference,
    explicitTestCaseCode: params.explicitTestCaseCode ?? null,
  })

  if (!definition) return null
  const testCase = getActorTestCase(definition.testCaseCode)
  if (!testCase) return null

  const company = await findCompanyForMessage(params.edielMessage)
  if (!company) return null

  const run = await findOrCreateActorTestRun({
    actorUserId: params.actorUserId,
    companyId: company.id,
    testCase,
  })

  await attachMessage({
    actorUserId: params.actorUserId,
    testRunId: run.id,
    message: params.edielMessage,
    testCase,
    steps: definition.expectedSteps,
  })

  let createdAckMessages: EdielMessageRow[] = []
  const isSourceBusiness =
    params.edielMessage.direction === 'inbound' &&
    upper(params.edielMessage.message_family) === upper(testCase.messageFamily) &&
    upper(String(params.edielMessage.message_code ?? '')) === upper(testCase.messageCode)

  if (params.autoRespond !== false && isSourceBusiness && testCase.direction === 'portal_to_actor') {
    createdAckMessages = await createEdielSupplierAgtResponsesForInbound({
      actorUserId: params.actorUserId,
      sourceMessageId: params.edielMessage.id,
      testCaseCode: testCase.key,
      testRunId: run.id,
    })

    if (params.autoSend !== false) {
      const sent: EdielMessageRow[] = []
      for (const ack of createdAckMessages) {
        sent.push(await sendMessageIfNeeded(params.actorUserId, ack))
      }
      createdAckMessages = sent
    }
  }

  const status = await resolveEvidenceStatus({
    testCase,
    companyId: company.id,
    run,
    sourceMessage: params.edielMessage,
    createdAckMessages,
  })
  const evidence = await buildEvidenceFromMessages({ testCase, sourceMessage: params.edielMessage, messages: status.messages })
  await upsertActorResult({
    actorUserId: params.actorUserId,
    companyId: company.id,
    testCase,
    status: status.status,
    runId: run.id,
    rawPayload: params.edielMessage.raw_payload,
    portalStatus: status.portalStatus,
    failureReason: status.failureReason,
    evidence,
    contrlMessageId: status.contrl?.id ?? null,
    aperakMessageId: status.aperak?.id ?? null,
    utiltsErrMessageId: status.utiltsErr?.id ?? null,
  })

  return { companyId: company.id, testKey: testCase.key, status: status.status, createdAckMessages }
}

export async function syncActorTestResultFromExistingMessages(params: {
  actorUserId: string
  companyId: string
  testKey: string
  autoRespond?: boolean
  autoSend?: boolean
}): Promise<{ result: ActorTestResultRow | null; status: ActorTestStatus; portalStatus: string; createdAckMessages: EdielMessageRow[] }> {
  const testCase = getActorTestCase(params.testKey)
  if (!testCase) throw new Error('Okänt aktörstest.')
  const run = await findOrCreateActorTestRun({ actorUserId: params.actorUserId, companyId: params.companyId, testCase })
  const result = await getLatestResult(params.companyId, testCase.key)
  const linkedMessages = result ? await findMessagesForResult(result) : []

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('message_family', testCase.messageFamily)
    .eq('message_code', testCase.messageCode)
    .order('created_at', { ascending: false })
    .limit(25)

  if (error) throw error
  const candidates = (data ?? []) as unknown as EdielMessageRow[]
  const source = candidates.find((message) =>
    testCase.direction === 'portal_to_actor'
      ? message.direction === 'inbound'
      : message.direction === 'outbound'
  ) ?? linkedMessages.find((message) =>
    upper(message.message_family) === upper(testCase.messageFamily) && upper(String(message.message_code ?? '')) === upper(testCase.messageCode)
  ) ?? null

  const currentStatus = asActorTestStatus(result?.status ?? null)
  if (!source && result && isTerminalStatus(currentStatus)) {
    return {
      result,
      status: currentStatus,
      portalStatus: result.portal_status ?? 'Befintligt terminalt testresultat bevarades; ingen ny Ediel-kedja hittades vid synk.',
      createdAckMessages: [],
    }
  }

  let createdAckMessages: EdielMessageRow[] = []
  if (source) {
    await attachMessage({ actorUserId: params.actorUserId, testRunId: run.id, message: source, testCase })
    if (params.autoRespond !== false && testCase.direction === 'portal_to_actor' && source.direction === 'inbound') {
      createdAckMessages = await createEdielSupplierAgtResponsesForInbound({
        actorUserId: params.actorUserId,
        sourceMessageId: source.id,
        testCaseCode: testCase.key,
        testRunId: run.id,
      }).catch(() => [])
      if (params.autoSend !== false) {
        const sent: EdielMessageRow[] = []
        for (const ack of createdAckMessages) {
          sent.push(await sendMessageIfNeeded(params.actorUserId, ack))
        }
        createdAckMessages = sent
      }
    }
  }

  const resolved = await resolveEvidenceStatus({ testCase, companyId: params.companyId, run, sourceMessage: source, createdAckMessages })
  const evidence = await buildEvidenceFromMessages({ testCase, sourceMessage: source, messages: resolved.messages })
  const saved = await upsertActorResult({
    actorUserId: params.actorUserId,
    companyId: params.companyId,
    testCase,
    status: resolved.status,
    runId: run.id,
    rawPayload: source?.raw_payload ?? result?.raw_payload ?? null,
    portalStatus: resolved.portalStatus,
    failureReason: resolved.failureReason,
    evidence,
    contrlMessageId: resolved.contrl?.id ?? null,
    aperakMessageId: resolved.aperak?.id ?? null,
    utiltsErrMessageId: resolved.utiltsErr?.id ?? null,
  })

  return { result: saved, status: resolved.status, portalStatus: resolved.portalStatus, createdAckMessages }
}

export async function syncAllActorTestsForCompany(params: {
  actorUserId: string
  companyId: string
  autoRespond?: boolean
  autoSend?: boolean
}): Promise<Array<{ testKey: string; status: ActorTestStatus; portalStatus: string }>> {
  const synced: Array<{ testKey: string; status: ActorTestStatus; portalStatus: string }> = []
  for (const testCase of ACTOR_TEST_CASES) {
    const result = await syncActorTestResultFromExistingMessages({
      actorUserId: params.actorUserId,
      companyId: params.companyId,
      testKey: testCase.key,
      autoRespond: params.autoRespond,
      autoSend: params.autoSend,
    })
    synced.push({ testKey: testCase.key, status: result.status, portalStatus: result.portalStatus })
  }
  return synced
}

export async function buildActorTestingEvidencePackage(companyId: string): Promise<ActorTestingEvidencePackage> {
  const company = await getCompany(companyId)
  const { data, error } = await supabaseService
    .from('actor_test_results')
    .select('*')
    .eq('company_id', companyId)
    .order('test_key', { ascending: true })

  if (error) throw error
  const results = (data ?? []) as unknown as ActorTestResultRow[]

  const tests = []
  for (const definition of ACTOR_TEST_CASES) {
    const result = results.find((row) => row.test_key === definition.key) ?? null
    const messages = result ? await findMessagesForResult(result) : []
    tests.push({
      testKey: definition.key,
      testName: result?.test_name ?? definition.label,
      testId: result?.test_id ?? definition.testId,
      packageKey: result?.package_key ?? definition.packageKey,
      messageFamily: result?.message_family ?? definition.messageFamily,
      messageCode: result?.message_code ?? definition.messageCode,
      status: result?.status ?? 'not_started',
      portalStatus: result?.portal_status ?? null,
      failureReason: result?.failure_reason ?? null,
      latestRunAt: result?.latest_run_at ?? null,
      passedAt: result?.passed_at ?? null,
      edielTestRunId: result?.ediel_test_run_id ?? null,
      messages: messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        family: message.message_family,
        code: String(message.message_code),
        status: message.status,
        ackOutcome: message.ack_outcome,
        senderEdielId: message.sender_ediel_id,
        receiverEdielId: message.receiver_ediel_id,
        interchangeReference: message.interchange_reference,
        externalReference: message.external_reference,
        transactionReference: message.transaction_reference,
        applicationReference: message.application_reference,
        sentAt: message.message_sent_at,
        receivedAt: message.message_received_at,
        rawPayload: message.raw_payload,
      })),
      evidence: result?.evidence ?? null,
    })
  }

  return {
    company: {
      id: company.id,
      name: company.name,
      orgNumber: company.org_number,
      edielId: company.production_ediel_id ?? company.ediel_id ?? company.test_ediel_id,
      role: company.market_role ?? company.actor_role,
      brpName: company.brp_name,
      brpEdielId: company.brp_ediel_id,
    },
    generatedAt: nowIso(),
    tests,
  }
}

export function renderActorTestingEvidenceCsv(pkg: ActorTestingEvidencePackage): string {
  const header = [
    'Bolag',
    'Orgnummer',
    'Ediel-id',
    'Test',
    'Test-ID',
    'Meddelande',
    'Status',
    'Portalstatus',
    'Felorsak',
    'Senast körd',
    'Meddelande-ID',
    'Riktning',
    'UNB sender',
    'UNB receiver',
    'Interchange reference',
    'Transaction reference',
  ]
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const rows = pkg.tests.flatMap((test) => {
    const messages = test.messages.length > 0 ? test.messages : [null]
    return messages.map((message) => [
      pkg.company.name,
      pkg.company.orgNumber,
      pkg.company.edielId,
      test.testName,
      test.testId,
      `${test.messageFamily ?? ''} ${test.messageCode ?? ''}`.trim(),
      test.status,
      test.portalStatus,
      test.failureReason,
      test.latestRunAt,
      message?.id ?? '',
      message?.direction ?? '',
      message?.senderEdielId ?? '',
      message?.receiverEdielId ?? '',
      message?.interchangeReference ?? '',
      message?.transactionReference ?? '',
    ].map(escape).join(','))
  })
  return [header.map(escape).join(','), ...rows].join('\n')
}

function pdfEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' ')
}

export function renderActorTestingEvidencePdf(pkg: ActorTestingEvidencePackage): Uint8Array {
  const lines = [
    `Bevispaket - ${pkg.company.name}`,
    `Orgnummer: ${pkg.company.orgNumber ?? '-'}`,
    `Ediel-id: ${pkg.company.edielId ?? '-'}`,
    `BRP: ${pkg.company.brpName ?? '-'} ${pkg.company.brpEdielId ?? ''}`.trim(),
    `Skapad: ${pkg.generatedAt}`,
    '',
    ...pkg.tests.flatMap((test) => [
      `${test.testKey} ${test.testName} (${test.testId ?? '-'})`,
      `Status: ${test.status ?? 'not_started'} · ${test.messageFamily ?? ''} ${test.messageCode ?? ''}`,
      `Portal: ${test.portalStatus ?? '-'}`,
      `Fel: ${test.failureReason ?? '-'}`,
      `Meddelanden: ${test.messages.map((m) => `${m.family}/${m.code}/${m.status}`).join(', ') || '-'}`,
      '',
    ]),
  ].slice(0, 120)

  const content = [
    'BT',
    '/F1 10 Tf',
    '40 800 Td',
    ...lines.map((line, index) => `${index === 0 ? '' : '0 -14 Td '}(${pdfEscape(line)}) Tj`),
    'ET',
  ].join('\n')
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(content, 'utf8')} >> stream\n${content}\nendstream endobj`,
  ]
  let offset = '%PDF-1.4\n'.length
  const xref = ['0000000000 65535 f ']
  const body = objects.map((obj) => {
    xref.push(String(offset).padStart(10, '0') + ' 00000 n ')
    offset += Buffer.byteLength(`${obj}\n`, 'utf8')
    return obj
  }).join('\n') + '\n'
  const xrefOffset = offset
  const pdf = `%PDF-1.4\n${body}xref\n0 ${objects.length + 1}\n${xref.join('\n')}\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new Uint8Array(Buffer.from(pdf, 'utf8'))
}
