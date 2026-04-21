// lib/ediel/selftest.ts

import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  attachEdielMessageToTestRun,
  createEdielMessage,
  createEdielMessageEvent,
  createEdielTestRun,
  linkEdielMessage,
  updateEdielMessageStatus,
} from '@/lib/ediel/db'
import {
  buildAperakDraft,
  buildContrlDraft,
  buildUtiltsErrDraft,
} from '@/lib/ediel/ack'
import { parseInboundProdat } from '@/lib/ediel/prodat'
import { buildInboundUtiltsMessageInput } from '@/lib/ediel/utilts'
import {
  getSupplierSwitchRequestById,
  updateSupplierSwitchRequestStatus,
  createSupplierSwitchEvent,
} from '@/lib/operations/db'
import {
  getCustomerSiteById,
  getGridOwnerById,
  getMeteringPointById,
} from '@/lib/masterdata/db'
import {
  ingestBillingUnderlay,
  ingestMeteringValue,
  updateGridOwnerDataRequestStatus,
} from '@/lib/cis/db'
import {
  ACTIVE_EDIEL_TEST_SUITES,
  isActiveEdielMessageFamily,
} from '@/lib/ediel/types'

export type EdielSelfTestScenarioCode =
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

export type RunEdielSelfTestInput = {
  actorUserId: string
  scenario: EdielSelfTestScenarioCode
  switchRequestId?: string | null
  gridOwnerDataRequestId?: string | null
  senderEdielId?: string | null
  receiverEdielId?: string | null
  mailbox?: string | null
  senderEmail?: string | null
  receiverEmail?: string | null
}

export type EdielSelfTestResult = {
  testRunId: string
  scenario: EdielSelfTestScenarioCode
  createdMessageIds: string[]
  notes: string[]
}

function nowCompact(): string {
  return new Date().toISOString().slice(2, 16).replace(/[-:T]/g, '')
}

function ymd(date = new Date()): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

function toIsoDate(value?: string | null): string {
  if (!value) return new Date().toISOString().slice(0, 10)
  return value
}

function ensureActiveSuite(suite: string) {
  if (!(ACTIVE_EDIEL_TEST_SUITES as readonly string[]).includes(suite)) {
    throw new Error(`Self-test suite ${suite} ligger utanför aktiv release`)
  }
}

function buildProdatInboundRaw(params: {
  code: 'Z04' | 'Z05' | 'Z06' | 'Z10'
  senderEdielId: string
  receiverEdielId: string
  externalReference: string
  transactionReference: string
  meterPointId: string
  customerName: string
  street?: string | null
  postalCode?: string | null
  city?: string | null
  requestedStartDate?: string | null
}): string {
  const stamp = nowCompact()
  const startDate = (params.requestedStartDate ?? '').replace(/-/g, '')

  const segments = [
    `UNB+UNOC:3+${params.senderEdielId}:PRODAT+${params.receiverEdielId}:GRIDEX+${stamp}+++++23-DDQ-PRODAT`,
    `UNH+1+PRODAT:D:03A:UN:1.0`,
    `BGM+${params.code}+${params.externalReference}+9`,
    `RFF+TN:${params.transactionReference}`,
    `LOC+172+${params.meterPointId}`,
    startDate ? `DTM+7:${startDate}:102` : null,
    `NAD+BY+++${params.customerName}`,
    params.street || params.postalCode || params.city
      ? `ADR+${params.street ?? ''}+${params.postalCode ?? ''}+${params.city ?? ''}`
      : null,
    `UNT+${startDate ? '8' : '7'}+1`,
    `UNZ+1+${params.externalReference}`,
  ].filter(Boolean)

  return `${segments.join("'")}'`
}

function buildUtiltsInboundRaw(params: {
  code: 'S02' | 'S03' | 'E66' | 'E31'
  senderEdielId: string
  receiverEdielId: string
  externalReference: string
  transactionReference: string
  meterPointId: string
  periodStart?: string | null
  periodEnd?: string | null
  quantity?: number
  readingType?: string
}): string {
  const stamp = nowCompact()
  const periodStart = (params.periodStart ?? new Date().toISOString().slice(0, 10)).replace(
    /-/g,
    ''
  )
  const periodEnd = (params.periodEnd ?? new Date().toISOString().slice(0, 10)).replace(
    /-/g,
    ''
  )

  const segments = [
    `UNB+UNOC:3+${params.senderEdielId}:UTILTS+${params.receiverEdielId}:GRIDEX+${stamp}+++++23-DDQ-UTILTS`,
    `UNH+1+UTILTS:D:03A:UN:1.0`,
    `BGM+${params.code}+${params.externalReference}+9`,
    `RFF+TN:${params.transactionReference}`,
    `LOC+172+${params.meterPointId}`,
    `DTM+137:${periodStart}:102`,
    `DTM+163:${periodEnd}:102`,
    params.readingType ? `CCI+${params.readingType}` : null,
    typeof params.quantity === 'number' ? `QTY+Z13:${params.quantity}:KWH` : null,
    `UNT+${typeof params.quantity === 'number' ? '9' : '8'}+1`,
    `UNZ+1+${params.externalReference}`,
  ].filter(Boolean)

  return `${segments.join("'")}'`
}

async function setTestRunStatus(params: {
  testRunId: string
  status: 'running' | 'passed' | 'failed' | 'cancelled'
  notes?: string | null
  failureReason?: string | null
}) {
  const supabase = await createSupabaseServerClient()

  const patch: Record<string, unknown> = {
    status: params.status,
    updated_at: new Date().toISOString(),
    notes: params.notes ?? null,
    failure_reason: params.failureReason ?? null,
  }

  if (params.status === 'running') {
    patch.started_at = new Date().toISOString()
  }

  if (params.status === 'passed' || params.status === 'failed' || params.status === 'cancelled') {
    patch.completed_at = new Date().toISOString()
  }

  const { error } = await supabase
    .from('ediel_test_runs')
    .update(patch)
    .eq('id', params.testRunId)

  if (error) throw error
}

async function loadSourceMessage(sourceMessageId: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('ediel_messages')
    .select('*')
    .eq('id', sourceMessageId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Kunde inte hitta källmeddelandet för kvittens')
  return data
}

async function createPositiveAcks(params: {
  actorUserId: string
  sourceMessageId: string
}): Promise<string[]> {
  const sourceMessage = await loadSourceMessage(params.sourceMessageId)

  const contrl = await createEdielMessage(
    buildContrlDraft({
      actorUserId: params.actorUserId,
      sourceMessage,
      outcome: 'positive',
      messageText: 'Self-test CONTRL OK',
    })
  )

  const aperak = await createEdielMessage(
    buildAperakDraft({
      actorUserId: params.actorUserId,
      sourceMessage,
      outcome: 'positive',
      messageText: 'Self-test APERAK OK',
    })
  )

  return [contrl.id, aperak.id]
}

async function createNegativeUtiltsErr(params: {
  actorUserId: string
  sourceMessageId: string
  messageText: string
}): Promise<string> {
  const sourceMessage = await loadSourceMessage(params.sourceMessageId)

  const utiltsErr = await createEdielMessage(
    buildUtiltsErrDraft({
      actorUserId: params.actorUserId,
      sourceMessage,
      messageText: params.messageText,
    })
  )

  return utiltsErr.id
}

async function runProdatInboundScenario(
  input: RunEdielSelfTestInput,
  code: 'Z04' | 'Z05' | 'Z06' | 'Z10'
): Promise<EdielSelfTestResult> {
  ensureActiveSuite('PRODAT')

  if (!input.switchRequestId) {
    throw new Error('switchRequestId krävs för PRODAT self-test')
  }

  const supabase = await createSupabaseServerClient()
  const switchRequest = await getSupplierSwitchRequestById(supabase, input.switchRequestId)
  if (!switchRequest) throw new Error('Switch request hittades inte')

  const site = await getCustomerSiteById(supabase, switchRequest.site_id)
  if (!site) throw new Error('Kunde inte hitta anläggning för switch request')

  const meteringPoint = await getMeteringPointById(supabase, switchRequest.metering_point_id)
  if (!meteringPoint) throw new Error('Kunde inte hitta mätpunkt för switch request')

  const gridOwner = switchRequest.grid_owner_id
    ? await getGridOwnerById(supabase, switchRequest.grid_owner_id)
    : null

  const externalReference = `SELFTEST-${code}-${switchRequest.id}-${nowCompact()}`
  const transactionReference = `TX-${code}-${nowCompact()}`
  const rawPayload = buildProdatInboundRaw({
    code,
    senderEdielId: input.senderEdielId ?? gridOwner?.ediel_id ?? '99999',
    receiverEdielId: input.receiverEdielId ?? '00000',
    externalReference,
    transactionReference,
    meterPointId:
      meteringPoint.ediel_reference ??
      meteringPoint.meter_point_id ??
      meteringPoint.metering_point_id,
    customerName:
      site.current_supplier_name ??
      site.site_name ??
      `Kund ${switchRequest.customer_id.slice(0, 8)}`,
    street: site.street,
    postalCode: site.postal_code,
    city: site.city,
    requestedStartDate: switchRequest.requested_start_date,
  })

  const parsed = parseInboundProdat(rawPayload)

  if (!isActiveEdielMessageFamily(parsed.messageFamily)) {
    throw new Error(`Self-test skapade family utanför aktivt scope: ${parsed.messageFamily}`)
  }

  const testRun = await createEdielTestRun({
    actorUserId: input.actorUserId,
    approvalVersion: 'ACTIVE_SCOPE_R1',
    roleCode: 'supplier',
    testSuite: 'PRODAT',
    testCaseCode: `${code}_IN`,
    title: `Self-test ${code} inbound`,
    status: 'running',
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    notes: 'Automatiskt PRODAT self-test inom aktivt release-scope.',
  })

  const createdMessageIds: string[] = []
  const notes: string[] = []

  try {
    const inboundMessage = await createEdielMessage({
      actorUserId: input.actorUserId,
      direction: 'inbound',
      messageStandard: 'edifact',
      messageFamily: parsed.messageFamily,
      messageCode: parsed.messageCode,
      messageVersion: parsed.messageVersion ?? 'D:03A:UN:1.0',
      processType: 'selftest',
      environment: 'test',
      testFlag: 1,
      status: 'received',
      transportType: 'manual_upload',
      mailbox: input.mailbox ?? null,
      senderEdielId: input.senderEdielId ?? gridOwner?.ediel_id ?? null,
      receiverEdielId: input.receiverEdielId ?? null,
      senderEmail: input.senderEmail ?? null,
      receiverEmail: input.receiverEmail ?? null,
      externalReference,
      transactionReference,
      rawPayload,
      parsedPayload: parsed.parsedPayload,
      validationReport: {},
      requiresContrl: true,
      requiresAperak: true,
      contrlStatus: 'pending',
      aperakStatus: 'pending',
      utiltsErrStatus: 'not_required',
      syntaxCheckStatus: 'pending',
      functionalCheckStatus: 'pending',
      messageReceivedAt: new Date().toISOString(),
    })

    createdMessageIds.push(inboundMessage.id)

    await attachEdielMessageToTestRun({
      testRunId: testRun.id,
      edielMessageId: inboundMessage.id,
      stepNo: 1,
      expectedDirection: 'inbound',
      expectedFamily: 'PRODAT',
      expectedCode: code,
    })

    await linkEdielMessage({
      actorUserId: input.actorUserId,
      edielMessageId: inboundMessage.id,
      switchRequestId: switchRequest.id,
      customerId: switchRequest.customer_id,
      siteId: switchRequest.site_id,
      meteringPointId: switchRequest.metering_point_id,
      gridOwnerId: switchRequest.grid_owner_id,
    })

    await updateEdielMessageStatus({
      actorUserId: input.actorUserId,
      edielMessageId: inboundMessage.id,
      status: 'parsed',
      parsedAt: new Date().toISOString(),
    })

    await updateEdielMessageStatus({
      actorUserId: input.actorUserId,
      edielMessageId: inboundMessage.id,
      status: 'validated',
      validatedAt: new Date().toISOString(),
    })

    if (code === 'Z04') {
      await updateSupplierSwitchRequestStatus(supabase, {
        requestId: switchRequest.id,
        status: 'accepted',
        externalReference,
      })
      notes.push('Switch request markerad som accepted.')
    }

    if (code === 'Z05') {
      await updateSupplierSwitchRequestStatus(supabase, {
        requestId: switchRequest.id,
        status: 'completed',
        externalReference,
      })
      notes.push('Switch request markerad som completed.')
    }

    if (code === 'Z06' || code === 'Z10') {
      await createSupplierSwitchEvent(supabase, {
        switchRequestId: switchRequest.id,
        eventType: 'ediel_inbound',
        eventStatus: 'received',
        message: `Inbound ${code} registrerat via self-test.`,
        payload: {
          edielMessageId: inboundMessage.id,
          externalReference,
        },
      })
      notes.push(`${code} registrerat som inbound switch-event.`)
    }

    const ackMessageIds = await createPositiveAcks({
      actorUserId: input.actorUserId,
      sourceMessageId: inboundMessage.id,
    })

    createdMessageIds.push(...ackMessageIds)

    for (const [index, ackMessageId] of ackMessageIds.entries()) {
      await attachEdielMessageToTestRun({
        testRunId: testRun.id,
        edielMessageId: ackMessageId,
        stepNo: index + 2,
        expectedDirection: 'outbound',
        expectedFamily: index === 0 ? 'CONTRL' : 'APERAK',
        expectedCode: index === 0 ? 'CONTRL' : 'APERAK',
      })
    }

    await createEdielMessageEvent({
      actorUserId: input.actorUserId,
      edielMessageId: inboundMessage.id,
      eventType: 'validated',
      eventStatus: 'success',
      message: `Self-test ${code} genomfört.`,
      payload: {
        createdMessageIds,
        switchRequestId: switchRequest.id,
      },
    })

    await setTestRunStatus({
      testRunId: testRun.id,
      status: 'passed',
      notes: notes.join(' '),
    })

    return {
      testRunId: testRun.id,
      scenario: input.scenario,
      createdMessageIds,
      notes,
    }
  } catch (error) {
    await setTestRunStatus({
      testRunId: testRun.id,
      status: 'failed',
      failureReason: error instanceof Error ? error.message : 'Self-test failed',
    })
    throw error
  }
}

async function runUtiltsInboundScenario(
  input: RunEdielSelfTestInput,
  code: 'S02' | 'S03' | 'E66' | 'E31',
  variant: 'generic' | 'kvart' | 'sch' | 'negative'
): Promise<EdielSelfTestResult> {
  ensureActiveSuite('UTILTS')

  if (!input.gridOwnerDataRequestId) {
    throw new Error('gridOwnerDataRequestId krävs för UTILTS self-test')
  }

  const supabase = await createSupabaseServerClient()
  const { data: request, error } = await supabase
    .from('grid_owner_data_requests')
    .select('*')
    .eq('id', input.gridOwnerDataRequestId)
    .maybeSingle()

  if (error) throw error
  if (!request) throw new Error('Grid owner data request hittades inte')

  const meteringPoint = request.metering_point_id
    ? await getMeteringPointById(supabase, request.metering_point_id)
    : null
  const gridOwner = request.grid_owner_id
    ? await getGridOwnerById(supabase, request.grid_owner_id)
    : null

  const externalReference = `SELFTEST-${code}-${request.id}-${nowCompact()}`
  const transactionReference = `TX-${code}-${nowCompact()}`
  const quantity =
    code === 'E66'
      ? variant === 'kvart'
        ? 12.345
        : variant === 'sch'
          ? 456.789
          : 1.0
      : code === 'E31'
        ? 321.123
        : undefined

  const rawPayload = buildUtiltsInboundRaw({
    code,
    senderEdielId: input.senderEdielId ?? gridOwner?.ediel_id ?? '99999',
    receiverEdielId: input.receiverEdielId ?? '00000',
    externalReference,
    transactionReference,
    meterPointId:
      meteringPoint?.ediel_reference ??
      meteringPoint?.meter_point_id ??
      meteringPoint?.metering_point_id ??
      'UNKNOWN',
    periodStart: toIsoDate(request.requested_period_start),
    periodEnd: toIsoDate(request.requested_period_end),
    quantity,
    readingType:
      code === 'E66'
        ? variant === 'kvart'
          ? 'KVART'
          : 'SCH'
        : code === 'E31'
          ? 'SCH'
          : 'GEN',
  })

  const testRun = await createEdielTestRun({
    actorUserId: input.actorUserId,
    approvalVersion: 'ACTIVE_SCOPE_R1',
    roleCode: 'supplier',
    testSuite: 'UTILTS',
    testCaseCode:
      code === 'E66'
        ? variant === 'kvart'
          ? 'E66_KVART'
          : variant === 'sch'
            ? 'E66_SCH'
            : 'E66_NEG'
        : code === 'E31'
          ? 'E31_SCH'
          : code,
    title: `Self-test ${code} ${variant}`,
    status: 'running',
    customerId: request.customer_id,
    siteId: request.site_id,
    meteringPointId: request.metering_point_id,
    gridOwnerId: request.grid_owner_id,
    notes: 'Automatiskt UTILTS self-test inom aktivt release-scope.',
  })

  const createdMessageIds: string[] = []
  const notes: string[] = []

  try {
    const inboundInput = buildInboundUtiltsMessageInput({
      actorUserId: input.actorUserId,
      code,
      communicationRouteId: null,
      customerId: request.customer_id,
      siteId: request.site_id,
      meteringPointId: request.metering_point_id,
      gridOwnerId: request.grid_owner_id,
      gridOwnerDataRequestId: request.id,
      senderEdielId: input.senderEdielId ?? gridOwner?.ediel_id ?? '99999',
      receiverEdielId: input.receiverEdielId ?? '00000',
      senderEmail: input.senderEmail ?? null,
      receiverEmail: input.receiverEmail ?? null,
      mailbox: input.mailbox ?? null,
      externalReference,
      transactionReference,
      quantity,
      periodStart: toIsoDate(request.requested_period_start),
      periodEnd: toIsoDate(request.requested_period_end),
      registrationTime: new Date().toISOString(),
      unit: 'KWH',
    })

    const inboundMessage = await createEdielMessage({
      ...inboundInput,
      rawPayload,
      processType: 'selftest',
      testFlag: 1,
      transportType: 'manual_upload',
      status: 'received',
      syntaxCheckStatus: 'pending',
      functionalCheckStatus: 'pending',
    })

    if (!isActiveEdielMessageFamily(inboundMessage.message_family)) {
      throw new Error(
        `Self-test skapade family utanför aktivt scope: ${inboundMessage.message_family}`
      )
    }

    createdMessageIds.push(inboundMessage.id)

    await attachEdielMessageToTestRun({
      testRunId: testRun.id,
      edielMessageId: inboundMessage.id,
      stepNo: 1,
      expectedDirection: 'inbound',
      expectedFamily: 'UTILTS',
      expectedCode: code,
    })

    await linkEdielMessage({
      actorUserId: input.actorUserId,
      edielMessageId: inboundMessage.id,
      gridOwnerDataRequestId: request.id,
      customerId: request.customer_id,
      siteId: request.site_id,
      meteringPointId: request.metering_point_id,
      gridOwnerId: request.grid_owner_id,
    })

    await updateEdielMessageStatus({
      actorUserId: input.actorUserId,
      edielMessageId: inboundMessage.id,
      status: 'parsed',
      parsedAt: new Date().toISOString(),
    })

    await updateEdielMessageStatus({
      actorUserId: input.actorUserId,
      edielMessageId: inboundMessage.id,
      status: 'validated',
      validatedAt: new Date().toISOString(),
    })

    await updateGridOwnerDataRequestStatus({
      actorUserId: input.actorUserId,
      requestId: request.id,
      status: 'received',
      externalReference,
      responsePayload: {
        edielMessageId: inboundMessage.id,
        selftest: true,
        code,
        variant,
      },
      notes: null,
    })

    if (code === 'E66' && typeof quantity === 'number') {
      const meteringValue = await ingestMeteringValue({
        actorUserId: input.actorUserId,
        customerId: request.customer_id,
        siteId: request.site_id,
        meteringPointId: request.metering_point_id,
        gridOwnerId: request.grid_owner_id,
        externalReference,
        quantity,
        unit: 'KWH',
        periodStart: toIsoDate(request.requested_period_start),
        periodEnd: toIsoDate(request.requested_period_end),
        sourcePayload: {
          selftest: true,
          edielMessageId: inboundMessage.id,
          variant,
        },
      })

      notes.push(`Mätvärde registrerat: ${meteringValue.id}`)

      if (variant === 'sch') {
        const billingUnderlay = await ingestBillingUnderlay({
          actorUserId: input.actorUserId,
          customerId: request.customer_id,
          siteId: request.site_id,
          meteringPointId: request.metering_point_id,
          gridOwnerId: request.grid_owner_id,
          externalReference,
          periodStart: toIsoDate(request.requested_period_start),
          periodEnd: toIsoDate(request.requested_period_end),
          payload: {
            selftest: true,
            edielMessageId: inboundMessage.id,
            quantity,
          },
        })
        notes.push(`Billing underlay registrerat: ${billingUnderlay.id}`)
      }
    }

    if (variant === 'negative') {
      const utiltsErrId = await createNegativeUtiltsErr({
        actorUserId: input.actorUserId,
        sourceMessageId: inboundMessage.id,
        messageText: 'Self-test functional error',
      })

      createdMessageIds.push(utiltsErrId)

      await attachEdielMessageToTestRun({
        testRunId: testRun.id,
        edielMessageId: utiltsErrId,
        stepNo: 2,
        expectedDirection: 'outbound',
        expectedFamily: 'UTILTS_ERR',
        expectedCode: 'UTILTS_ERR',
      })

      notes.push('Negativ UTILTS-respons skapad.')
    } else {
      const ackMessageIds = await createPositiveAcks({
        actorUserId: input.actorUserId,
        sourceMessageId: inboundMessage.id,
      })

      createdMessageIds.push(...ackMessageIds)

      for (const [index, ackMessageId] of ackMessageIds.entries()) {
        await attachEdielMessageToTestRun({
          testRunId: testRun.id,
          edielMessageId: ackMessageId,
          stepNo: index + 2,
          expectedDirection: 'outbound',
          expectedFamily: index === 0 ? 'CONTRL' : 'APERAK',
          expectedCode: index === 0 ? 'CONTRL' : 'APERAK',
        })
      }
    }

    await createEdielMessageEvent({
      actorUserId: input.actorUserId,
      edielMessageId: inboundMessage.id,
      eventType: 'validated',
      eventStatus: 'success',
      message: `Self-test ${code} ${variant} genomfört.`,
      payload: {
        createdMessageIds,
        requestId: request.id,
      },
    })

    await setTestRunStatus({
      testRunId: testRun.id,
      status: 'passed',
      notes: notes.join(' '),
    })

    return {
      testRunId: testRun.id,
      scenario: input.scenario,
      createdMessageIds,
      notes,
    }
  } catch (error) {
    await setTestRunStatus({
      testRunId: testRun.id,
      status: 'failed',
      failureReason: error instanceof Error ? error.message : 'Self-test failed',
    })
    throw error
  }
}

export async function runEdielSelfTest(
  input: RunEdielSelfTestInput
): Promise<EdielSelfTestResult> {
  switch (input.scenario) {
    case 'PRODAT_Z04_IN':
      return runProdatInboundScenario(input, 'Z04')
    case 'PRODAT_Z05_IN':
      return runProdatInboundScenario(input, 'Z05')
    case 'PRODAT_Z06_IN':
      return runProdatInboundScenario(input, 'Z06')
    case 'PRODAT_Z10_IN':
      return runProdatInboundScenario(input, 'Z10')
    case 'UTILTS_S02_IN':
      return runUtiltsInboundScenario(input, 'S02', 'generic')
    case 'UTILTS_S03_IN':
      return runUtiltsInboundScenario(input, 'S03', 'generic')
    case 'UTILTS_E66_KVART_IN':
      return runUtiltsInboundScenario(input, 'E66', 'kvart')
    case 'UTILTS_E66_SCH_IN':
      return runUtiltsInboundScenario(input, 'E66', 'sch')
    case 'UTILTS_E31_SCH_IN':
      return runUtiltsInboundScenario(input, 'E31', 'sch')
    case 'UTILTS_NEGATIVE':
      return runUtiltsInboundScenario(input, 'E66', 'negative')
    default:
      throw new Error('Okänt self-test scenario')
  }
}