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
import { buildAperakDraft, buildContrlDraft, buildUtiltsErrDraft } from '@/lib/ediel/ack'
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

async function createPositiveAcks(params: {
  actorUserId: string
  sourceMessageId: string
}): Promise<string[]> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('ediel_messages')
    .select('*')
    .eq('id', params.sourceMessageId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Kunde inte hitta källmeddelandet för kvittens')

  const sourceMessage = data as Awaited<ReturnType<typeof createEdielMessage>>

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

async function runProdatInboundScenario(
  input: RunEdielSelfTestInput,
  code: 'Z04' | 'Z05' | 'Z06' | 'Z10'
): Promise<EdielSelfTestResult> {
  if (!input.switchRequestId) {
    throw new Error('switchRequestId krävs för detta self-test')
  }

  const supabase = await createSupabaseServerClient()

  const switchRequest = await getSupplierSwitchRequestById(supabase, input.switchRequestId)
  if (!switchRequest) {
    throw new Error('Switch request hittades inte')
  }

  const site = await getCustomerSiteById(supabase, switchRequest.site_id)
  const meteringPoint = await getMeteringPointById(supabase, switchRequest.metering_point_id)
  const gridOwner = switchRequest.grid_owner_id
    ? await getGridOwnerById(supabase, switchRequest.grid_owner_id)
    : null

  if (!site || !meteringPoint) {
    throw new Error('Kunde inte läsa site eller mätpunkt för switch request')
  }

  const senderEdielId = input.senderEdielId ?? gridOwner?.ediel_id ?? '91100'
  const receiverEdielId = input.receiverEdielId ?? 'GRIDEX-SIM'
  const externalReference =
    switchRequest.external_reference ?? `${code}-${switchRequest.id}`
  const transactionReference =
    switchRequest.external_reference ?? `${code}-TX-${switchRequest.id}`

  const rawPayload = buildProdatInboundRaw({
    code,
    senderEdielId,
    receiverEdielId,
    externalReference,
    transactionReference,
    meterPointId: meteringPoint.meter_point_id,
    customerName: site.site_name,
    street: site.street,
    postalCode: site.postal_code,
    city: site.city,
    requestedStartDate: switchRequest.requested_start_date,
  })

  const parsed = parseInboundProdat(rawPayload)

  const testRun = await createEdielTestRun({
    actorUserId: input.actorUserId,
    approvalVersion: '2026A',
    roleCode: 'supplier',
    testSuite: 'PRODAT',
    testCaseCode: code,
    title: `Self-test ${code}`,
    status: 'running',
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    notes: 'Automatiskt self-test utan extern TGT-kanal.',
  })

  const createdMessageIds: string[] = []
  const notes: string[] = []

  try {
    const inboundMessage = await createEdielMessage({
      actorUserId: input.actorUserId,
      direction: 'inbound',
      messageFamily: 'PRODAT',
      messageCode: code,
      status: 'received',
      transportType: 'manual_upload',
      mailbox: input.mailbox ?? 'SELFTEST',
      senderEdielId,
      receiverEdielId,
      senderSubAddress: 'PRODAT',
      receiverSubAddress: 'GRIDEX',
      senderEmail: input.senderEmail ?? 'svk-selftest@gridex.local',
      receiverEmail: input.receiverEmail ?? 'ediel@gridex.se',
      externalReference,
      transactionReference,
      applicationReference: '23-DDQ-PRODAT',
      customerId: switchRequest.customer_id,
      siteId: switchRequest.site_id,
      meteringPointId: switchRequest.metering_point_id,
      gridOwnerId: switchRequest.grid_owner_id,
      switchRequestId: switchRequest.id,
      rawPayload,
      parsedPayload: parsed.parsedPayload,
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
      id: inboundMessage.id,
      status: 'validated',
      parsedPayload: parsed.parsedPayload,
      validationReport: {
        selfTest: true,
        scenario: code,
        linkedSwitchRequestId: switchRequest.id,
      },
    })

    if (code === 'Z04') {
      await updateSupplierSwitchRequestStatus(supabase, {
        requestId: switchRequest.id,
        status: 'accepted',
        externalReference,
      })
      notes.push('Switch request uppdaterad till accepted.')
    } else if (code === 'Z05') {
      await updateSupplierSwitchRequestStatus(supabase, {
        requestId: switchRequest.id,
        status: 'completed',
        externalReference,
      })
      notes.push('Switch request uppdaterad till completed.')
    } else if (code === 'Z06') {
      await updateSupplierSwitchRequestStatus(supabase, {
        requestId: switchRequest.id,
        status: 'rejected',
        failureReason: 'Self-test rejection via Z06.',
        externalReference,
      })
      notes.push('Switch request uppdaterad till rejected.')
    } else if (code === 'Z10') {
      await createSupplierSwitchEvent(supabase, {
        switchRequestId: switchRequest.id,
        eventType: 'ediel_z10_received',
        eventStatus: 'received',
        message: 'Z10 mottaget i self-test.',
        payload: {
          edielMessageId: inboundMessage.id,
          externalReference,
        },
      })
      notes.push('Z10 loggad som inbound switch-event.')
    }

    const ackIds = await createPositiveAcks({
      actorUserId: input.actorUserId,
      sourceMessageId: inboundMessage.id,
    })
    createdMessageIds.push(...ackIds)

    await Promise.all(
      ackIds.map((messageId, index) =>
        attachEdielMessageToTestRun({
          testRunId: testRun.id,
          edielMessageId: messageId,
          stepNo: index + 2,
          expectedDirection: 'outbound',
          expectedFamily: index === 0 ? 'CONTRL' : 'APERAK',
          expectedCode: index === 0 ? 'CONTRL' : 'APERAK',
        })
      )
    )

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
  variant: 'sch' | 'kvart' | 'generic' | 'negative'
): Promise<EdielSelfTestResult> {
  if (!input.gridOwnerDataRequestId) {
    throw new Error('gridOwnerDataRequestId krävs för detta self-test')
  }

  const supabase = await createSupabaseServerClient()

  const { data: request, error: requestError } = await supabase
    .from('grid_owner_data_requests')
    .select('*')
    .eq('id', input.gridOwnerDataRequestId)
    .maybeSingle()

  if (requestError) throw requestError
  if (!request) throw new Error('Grid owner data request hittades inte')

  const site = request.site_id ? await getCustomerSiteById(supabase, request.site_id) : null
  const meteringPoint = request.metering_point_id
    ? await getMeteringPointById(supabase, request.metering_point_id)
    : null
  const gridOwner = request.grid_owner_id
    ? await getGridOwnerById(supabase, request.grid_owner_id)
    : null

  if (!meteringPoint) {
    throw new Error('Mätpunkt saknas för data request')
  }

  const senderEdielId = input.senderEdielId ?? gridOwner?.ediel_id ?? '91100'
  const receiverEdielId = input.receiverEdielId ?? 'GRIDEX-SIM'
  const externalReference = request.external_reference ?? `${code}-${request.id}`
  const transactionReference = request.external_reference ?? `${code}-TX-${request.id}`

  const quantity =
    code === 'S02'
      ? 14500
      : code === 'S03'
        ? 72
        : code === 'E66'
          ? variant === 'kvart'
            ? 12.75
            : 58.4
          : 480.25

  const rawPayload = buildUtiltsInboundRaw({
    code,
    senderEdielId,
    receiverEdielId,
    externalReference,
    transactionReference,
    meterPointId: meteringPoint.meter_point_id,
    periodStart: request.requested_period_start,
    periodEnd: request.requested_period_end,
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
    approvalVersion: '2026A',
    roleCode: 'supplier',
    testSuite: 'UTILTS',
    testCaseCode:
      code === 'E66'
        ? variant === 'kvart'
          ? 'E66_KVART'
          : 'E66_SCH'
        : code === 'E31'
          ? 'E31_SCH'
          : code,
    title: `Self-test ${code} ${variant}`,
    status: 'running',
    customerId: request.customer_id,
    siteId: request.site_id,
    meteringPointId: request.metering_point_id,
    gridOwnerId: request.grid_owner_id,
    notes: 'Automatiskt UTILTS self-test utan extern TGT-kanal.',
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
      mailbox: input.mailbox ?? 'SELFTEST',
      mailboxMessageId: `${code}-${Date.now()}`,
      senderEdielId,
      receiverEdielId,
      senderEmail: input.senderEmail ?? 'svk-selftest@gridex.local',
      receiverEmail: input.receiverEmail ?? 'ediel@gridex.se',
      rawPayload,
    })

    const inboundMessage = await createEdielMessage(inboundInput)
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
      id: inboundMessage.id,
      status: 'validated',
      parsedPayload: inboundInput.parsedPayload ?? {},
      validationReport: {
        selfTest: true,
        scenario: input.scenario,
        requestId: request.id,
        variant,
      },
    })

    await updateGridOwnerDataRequestStatus({
      actorUserId: input.actorUserId,
      requestId: request.id,
      status: 'received',
      externalReference,
      responsePayload: {
        selfTest: true,
        edielMessageId: inboundMessage.id,
        code,
        variant,
      },
      notes: `Self-test ${code} ${variant} mottaget och kopplat.`,
    })

    if (code === 'E66') {
      await ingestMeteringValue({
        actorUserId: input.actorUserId,
        customerId: request.customer_id,
        siteId: request.site_id,
        meteringPointId: request.metering_point_id,
        sourceRequestId: request.id,
        gridOwnerId: request.grid_owner_id,
        readingType: 'consumption',
        valueKwh: quantity,
        qualityCode: variant === 'kvart' ? 'KVART' : 'SCH',
        readAt: new Date().toISOString(),
        periodStart: toIsoDate(request.requested_period_start),
        periodEnd: toIsoDate(request.requested_period_end),
        sourceSystem: 'ediel_selftest',
        rawPayload: {
          code,
          variant,
          externalReference,
        },
      })
      notes.push(`Metering value skapad för ${variant.toUpperCase()}.`)
    }

    if (code === 'E31') {
      const month = new Date().getMonth() + 1
      const year = new Date().getFullYear()

      await ingestBillingUnderlay({
        actorUserId: input.actorUserId,
        customerId: request.customer_id,
        siteId: request.site_id,
        meteringPointId: request.metering_point_id,
        sourceRequestId: request.id,
        gridOwnerId: request.grid_owner_id,
        underlayMonth: month,
        underlayYear: year,
        status: 'received',
        totalKwh: quantity,
        totalSekExVat: null,
        sourceSystem: 'ediel_selftest',
        payload: {
          code,
          variant,
          externalReference,
        },
      })
      notes.push('Billing-underlag skapat från E31 self-test.')
    }

    const contrl = await createEdielMessage(
      buildContrlDraft({
        actorUserId: input.actorUserId,
        sourceMessage: inboundMessage,
        outcome: 'positive',
        messageText: 'Self-test CONTRL OK',
      })
    )
    const aperak =
      variant === 'negative'
        ? await createEdielMessage(
            buildAperakDraft({
              actorUserId: input.actorUserId,
              sourceMessage: inboundMessage,
              outcome: 'negative',
              messageText: 'Self-test negativ APERAK',
            })
          )
        : await createEdielMessage(
            buildAperakDraft({
              actorUserId: input.actorUserId,
              sourceMessage: inboundMessage,
              outcome: 'positive',
              messageText: 'Self-test APERAK OK',
            })
          )

    createdMessageIds.push(contrl.id, aperak.id)

    await attachEdielMessageToTestRun({
      testRunId: testRun.id,
      edielMessageId: contrl.id,
      stepNo: 2,
      expectedDirection: 'outbound',
      expectedFamily: 'CONTRL',
      expectedCode: 'CONTRL',
    })

    await attachEdielMessageToTestRun({
      testRunId: testRun.id,
      edielMessageId: aperak.id,
      stepNo: 3,
      expectedDirection: 'outbound',
      expectedFamily: 'APERAK',
      expectedCode: 'APERAK',
    })

    if (variant === 'negative') {
      const utiltsErr = await createEdielMessage(
        buildUtiltsErrDraft({
          actorUserId: input.actorUserId,
          sourceMessage: inboundMessage,
          messageText: 'Self-test negativ UTILTS-respons.',
        })
      )
      createdMessageIds.push(utiltsErr.id)

      await attachEdielMessageToTestRun({
        testRunId: testRun.id,
        edielMessageId: utiltsErr.id,
        stepNo: 4,
        expectedDirection: 'outbound',
        expectedFamily: 'UTILTS_ERR',
        expectedCode: 'UTILTS_ERR',
      })

      notes.push('Negativ UTILTS-ERR skapad.')
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