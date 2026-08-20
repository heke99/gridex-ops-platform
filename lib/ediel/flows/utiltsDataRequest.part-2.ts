// Extracted from utiltsDataRequest.ts; keep public imports on the facade module.
import { applyCertifiedUtiltsAckPolicy } from '@/lib/ediel/rulebook/utiltsAckPolicy'
import { getCustomerSiteById, getGridOwnerById, getMeteringPointById } from '@/lib/masterdata/db'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { createEdielMessageEvent, getEdielMessageById, linkEdielMessage, updateEdielMessageStatus } from '@/lib/ediel/db'

import { resolveDecisionBackedOutboundContext } from '@/lib/ediel/flows/routeDecisionContext'
import { ensureActorUserId, finalizeOutboundDraft, findOrCreateDataRequestOutbound, getGridOwnerDataRequestById, makeServerClient, queuePreparedEdielMessage, resolveOutboundRuntimeEnvironment } from '@/lib/ediel/flows/shared'
import { syncGridOwnerDataRequestReceivedFromEdiel, updateGridOwnerDataRequestStatus } from '@/lib/cis/db'

import type { EdielEnvironment, EdielMessageRow } from '@/lib/ediel/types'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { findActiveMeteringPermissionForUtiltsMessage } from '@/lib/onboarding/inboundEdielLinking'




import { buildUtiltsTransactionPersistencePayload, persistUtiltsTransactionResults, resolveUtiltsTransactionId } from '@/lib/ediel/utilts/transactionPersistence'


import type { UtiltsProcessResult } from './utiltsDataRequest.part-1'
import { allUtiltsTransactionMeteringPointsMatched, createUtiltsRuntimeAcks, ensureJson, linkInboundUtiltsMessageCanonically, markDataRequestOutboundAcknowledged, matchUtiltsTransactionsForTenant, maybeCreateBillingUnderlay, maybeIngestMeteringValue, resolveUtiltsRuntimeTestCaseCode, stringOrNull } from './utiltsDataRequest.part-1'

export async function prepareAndQueueUtiltsE73(params: {
  actorUserId: string
  gridOwnerDataRequestId: string
  communicationRouteId?: string | null
  environment?: EdielEnvironment | null
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const dataRequest = await getGridOwnerDataRequestById(params.gridOwnerDataRequestId)

  if (!dataRequest) throw new Error('Grid owner data request hittades inte')
  const companyId = dataRequest.company_id
  if (!companyId) {
    throw new Error('UTILTS E73 stoppades: nätägarbegäran saknar company_id.')
  }
  await requireCompanyOperationalForWrites(companyId)

  const site = dataRequest.site_id ? await getCustomerSiteById(supabase, dataRequest.site_id) : null
  const meteringPoint = dataRequest.metering_point_id
    ? await getMeteringPointById(supabase, dataRequest.metering_point_id)
    : null
  const gridOwner = dataRequest.grid_owner_id
    ? await getGridOwnerById(supabase, dataRequest.grid_owner_id)
    : null

  const environment = await resolveOutboundRuntimeEnvironment({
    preferredRouteId: params.communicationRouteId ?? null,
    explicitEnvironment: params.environment ?? null,
  })

  const routeContext = await resolveDecisionBackedOutboundContext({
    requestType: 'meter_values',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    companyId,
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    dataRequestId: dataRequest.id,
    environment,
    messageFamily: 'UTILTS',
    messageCode: 'E73',
    messageStandard: 'edifact',
    actorUserId,
    payload: {
      requestScope: dataRequest.request_scope,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
    },
  })

  const outbound = await findOrCreateDataRequestOutbound({
    actorUserId,
    requestType: 'meter_values',
    communicationRouteId: routeContext.route.id,
    dataRequest,
    payload: {
      edielCode: 'E73',
      queuedFrom: 'prepare_utilts_e73',
      requestScope: dataRequest.request_scope,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
      communicationRouteId: routeContext.route.id,
    },
  })

  const draft = await buildUtiltsOutboundDraft({
    actorUserId,
    code: 'E73',
    environment,
    communicationRouteId: routeContext.route.id,
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    gridOwnerId: dataRequest.grid_owner_id,
    outboundRequestId: outbound.id,
    gridOwnerDataRequestId: dataRequest.id,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    senderSubAddress: routeContext.senderSubAddress,
    receiverSubAddress: routeContext.receiverSubAddress,
    mailbox: routeContext.mailbox,
    receiverEmail: routeContext.receiverEmail,
    routeDefaultMessageVersion: routeContext.defaultMessageVersion,
    payload: {
      meterPointId: meteringPoint?.meter_point_id ?? null,
      meteringPointId: meteringPoint?.meter_point_id ?? null,
      gridAreaId: gridOwner?.owner_code ?? gridOwner?.ediel_id ?? null,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
      periodStart: dataRequest.requested_period_start,
      periodEnd: dataRequest.requested_period_end,
      transactionReason: 'Begäran om saknade validerade mätvärden',
      requestScope: dataRequest.request_scope,
      siteType: site?.site_type ?? 'consumption',
      readingFrequency: meteringPoint?.reading_frequency ?? null,
    },
  })

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'meter_values',
    routeContext,
    draft,
    outboundRequestId: outbound.id,
    duplicateCheck: {
      sourceType: 'grid_owner_data_request',
      sourceId: dataRequest.id,
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: draft.messageFamily,
      messageCode: String(draft.messageCode),
      messageVersion: draft.messageVersion ?? null,
      periodStart: dataRequest.requested_period_start,
      periodEnd: dataRequest.requested_period_end,
    },
  })

  await linkEdielMessage({
    actorUserId,
    edielMessageId: message.id,
    outboundRequestId: outbound.id,
    gridOwnerDataRequestId: dataRequest.id,
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    gridOwnerId: dataRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await queuePreparedEdielMessage({
    actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference: message.external_reference ?? dataRequest.external_reference,
    payload: {
      edielCode: 'E73',
      routeId: routeContext.route.id,
      gridOwnerDataRequestId: dataRequest.id,
    },
  })

  await updateGridOwnerDataRequestStatus({
    actorUserId,
    requestId: dataRequest.id,
    status: 'sent',
    externalReference: message.external_reference ?? dataRequest.external_reference,
    responsePayload: {
      ...(ensureJson(dataRequest.response_payload)),
      edielMessageId: message.id,
      outboundRequestId: outbound.id,
      preparedVia: 'prepareAndQueueUtiltsE73',
      requestedVia: 'UTILTS_E73',
    },
    notes: dataRequest.notes ?? null,
  })

  return message
}

export async function prepareAndQueueUtiltsE66(params: {
  actorUserId: string
  gridOwnerDataRequestId: string
  communicationRouteId?: string | null
  environment?: EdielEnvironment | null
  quantity?: number | null
  periodStart?: string | null
  periodEnd?: string | null
  registrationTime?: string | null
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const dataRequest = await getGridOwnerDataRequestById(params.gridOwnerDataRequestId)

  if (!dataRequest) throw new Error('Grid owner data request hittades inte')
  const companyId = dataRequest.company_id
  if (!companyId) {
    throw new Error('UTILTS E66 stoppades: nätägarbegäran saknar company_id.')
  }
  await requireCompanyOperationalForWrites(companyId)

  const site = dataRequest.site_id ? await getCustomerSiteById(supabase, dataRequest.site_id) : null
  const meteringPoint = dataRequest.metering_point_id
    ? await getMeteringPointById(supabase, dataRequest.metering_point_id)
    : null
  const gridOwner = dataRequest.grid_owner_id
    ? await getGridOwnerById(supabase, dataRequest.grid_owner_id)
    : null

  const environment = await resolveOutboundRuntimeEnvironment({
    preferredRouteId: params.communicationRouteId ?? null,
    explicitEnvironment: params.environment ?? null,
  })

  const routeContext = await resolveDecisionBackedOutboundContext({
    requestType: 'meter_values',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    companyId,
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    dataRequestId: dataRequest.id,
    environment,
    messageFamily: 'UTILTS',
    messageCode: 'E66',
    messageStandard: 'edifact',
    actorUserId,
    payload: {
      requestScope: dataRequest.request_scope,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
    },
  })

  const outbound = await findOrCreateDataRequestOutbound({
    actorUserId,
    requestType: 'meter_values',
    communicationRouteId: routeContext.route.id,
    dataRequest,
    payload: {
      edielCode: 'E66',
      queuedFrom: 'prepare_utilts_e66',
      requestScope: dataRequest.request_scope,
      requestedPeriodStart: dataRequest.requested_period_start,
      requestedPeriodEnd: dataRequest.requested_period_end,
      communicationRouteId: routeContext.route.id,
    },
  })

  const draft = await buildUtiltsOutboundDraft({
    actorUserId,
    code: 'E66',
    environment,
    communicationRouteId: routeContext.route.id,
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    gridOwnerId: dataRequest.grid_owner_id,
    outboundRequestId: outbound.id,
    gridOwnerDataRequestId: dataRequest.id,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    senderSubAddress: routeContext.senderSubAddress,
    receiverSubAddress: routeContext.receiverSubAddress,
    mailbox: routeContext.mailbox,
    receiverEmail: routeContext.receiverEmail,
    routeDefaultMessageVersion: routeContext.defaultMessageVersion,
    payload: {
      meterPointId: meteringPoint?.meter_point_id ?? null,
      meteringPointId: meteringPoint?.meter_point_id ?? null,
      gridAreaId: gridOwner?.owner_code ?? gridOwner?.ediel_id ?? null,
      periodStart: params.periodStart ?? dataRequest.requested_period_start,
      periodEnd: params.periodEnd ?? dataRequest.requested_period_end,
      registrationTime: params.registrationTime ?? new Date().toISOString(),
      quantity: params.quantity ?? 0,
      unit: 'KWH',
      resolution:
        meteringPoint?.reading_frequency === 'monthly'
          ? '1440'
          : meteringPoint?.reading_frequency === 'daily'
            ? '1440'
            : '15',
      siteType: site?.site_type ?? 'consumption',
    },
  })

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'meter_values',
    routeContext,
    draft,
    outboundRequestId: outbound.id,
    duplicateCheck: {
      sourceType: 'grid_owner_data_request',
      sourceId: dataRequest.id,
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: draft.messageFamily,
      messageCode: String(draft.messageCode),
      messageVersion: draft.messageVersion ?? null,
      periodStart: params.periodStart ?? dataRequest.requested_period_start,
      periodEnd: params.periodEnd ?? dataRequest.requested_period_end,
    },
  })

  await linkEdielMessage({
    actorUserId,
    edielMessageId: message.id,
    outboundRequestId: outbound.id,
    gridOwnerDataRequestId: dataRequest.id,
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    gridOwnerId: dataRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await queuePreparedEdielMessage({
    actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference: message.external_reference ?? dataRequest.external_reference,
    payload: {
      edielCode: 'E66',
      routeId: routeContext.route.id,
      gridOwnerDataRequestId: dataRequest.id,
    },
  })

  return message
}

export async function processInboundUtiltsMessage(params: {
  actorUserId: string
  edielMessageId: string
  testCaseCode?: string | null
}): Promise<UtiltsProcessResult> {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const message = await getEdielMessageById(params.edielMessageId)

  if (!message) throw new Error('Ediel-meddelande hittades inte')
  if (message.message_family !== 'UTILTS') {
    throw new Error(`Meddelande ${message.id} är inte UTILTS.`)
  }

  const runtimeTestCaseCode = await resolveUtiltsRuntimeTestCaseCode({
    sourceMessage: message,
    explicitTestCaseCode: params.testCaseCode ?? null,
  })

  // First build a parse-only runtime snapshot so matching/permission logic can use
  // normalized UTILTS facts. The final ACK decision is run again after canonical
  // business matching, because live/test must use the same production rule: object
  // identity/processability is validated before period/observation-count checks.
  const provisionalRuntime = runUtiltsRuntimeForMessage(message)
  const transactionMatches = await matchUtiltsTransactionsForTenant({
    message,
    facts: provisionalRuntime.facts,
  })
  const provisionalNormalizedPayload = {
    ...provisionalRuntime.normalizedPayload,
    utiltsTransactionMatches: transactionMatches,
  }
  const canonicalLinks = await linkInboundUtiltsMessageCanonically({
    actorUserId,
    message,
    transactionMatches,
  })

  const permissionProbeMessage: EdielMessageRow = {
    ...message,
    customer_id: canonicalLinks.siteAndCustomer?.customerId ?? canonicalLinks.matchedDataRequest?.customer_id ?? message.customer_id,
    site_id: canonicalLinks.siteAndCustomer?.siteId ?? canonicalLinks.matchedDataRequest?.site_id ?? message.site_id,
    metering_point_id: canonicalLinks.meteringPointId ?? canonicalLinks.matchedDataRequest?.metering_point_id ?? message.metering_point_id,
    grid_owner_id: canonicalLinks.siteAndCustomer?.gridOwnerId ?? canonicalLinks.matchedDataRequest?.grid_owner_id ?? message.grid_owner_id,
    grid_owner_data_request_id: canonicalLinks.matchedDataRequest?.id ?? message.grid_owner_data_request_id,
    parsed_payload: {
      ...(message.parsed_payload ?? {}),
      normalizedMeteringPayload: provisionalNormalizedPayload,
      utiltsRuntimeFacts: provisionalRuntime.facts,
      utiltsRuntimeTestCaseCode: runtimeTestCaseCode,
      utiltsTransactionMatches: transactionMatches,
    },
  }

  const matchedPermission = !canonicalLinks.matchedDataRequest
    ? await findActiveMeteringPermissionForUtiltsMessage(permissionProbeMessage)
    : null

  const runtimeSourceMessage: EdielMessageRow = {
    ...permissionProbeMessage,
    customer_id: permissionProbeMessage.customer_id ?? matchedPermission?.customer_id ?? null,
    site_id: permissionProbeMessage.site_id ?? matchedPermission?.site_id ?? null,
    metering_point_id: permissionProbeMessage.metering_point_id ?? matchedPermission?.metering_point_id ?? null,
    grid_owner_id: permissionProbeMessage.grid_owner_id ?? matchedPermission?.grid_owner_id ?? null,
    business_match_status:
      permissionProbeMessage.metering_point_id || canonicalLinks.matchedDataRequest || matchedPermission || allUtiltsTransactionMeteringPointsMatched(transactionMatches)
        ? 'matched'
        : permissionProbeMessage.business_match_status,
  }

  const runtime = runUtiltsRuntimeForMessage(runtimeSourceMessage)
  const ackPlan = applyCertifiedUtiltsAckPolicy({
    runtime,
    testCaseCode: runtimeTestCaseCode,
  })
  let transactionDispositions = runtime.transactionDispositions
  let transactionPersistenceResults: Awaited<ReturnType<typeof persistUtiltsTransactionResults>> = []
  const companyId = stringOrNull(runtimeSourceMessage.company_id)
  const messageCode = stringOrNull(runtime.facts.messageCode)
  if (companyId && messageCode && transactionDispositions.length > 0) {
    transactionPersistenceResults = await persistUtiltsTransactionResults({
      companyId,
      environment: runtimeSourceMessage.environment,
      sourceMessageId: runtimeSourceMessage.id,
      messageCode,
      transactions: buildUtiltsTransactionPersistencePayload({
        messageCode,
        transactions: runtime.facts.transactions,
        dispositions: transactionDispositions,
        matches: transactionMatches,
      }),
    })
    transactionDispositions = transactionDispositions.map((disposition, index) => {
      const transactionId = resolveUtiltsTransactionId(disposition.transactionId, index)
      const persisted = transactionPersistenceResults.find((item) => item.transactionId === transactionId)
      if (!persisted || persisted.persistenceStatus !== 'failed') {
        return transactionId === disposition.transactionId
          ? disposition
          : { ...disposition, transactionId }
      }
      return {
        ...disposition,
        transactionId,
        disposition: 'processability_rejected' as const,
        responseType: 'utilts_err' as const,
        issueCodes: [...new Set([...disposition.issueCodes, ...(persisted.issueCodes ?? ['UTILTS_PERSISTENCE_FAILED'])])],
      }
    })
  }
  const normalizedPayload = {
    ...runtime.normalizedPayload,
    utiltsTransactionMatches: transactionMatches,
    utiltsTransactionDispositions: transactionDispositions,
    utiltsTransactionPersistenceResults: transactionPersistenceResults,
  }
  const forcedPositiveTgtAckPlan =
    runtimeTestCaseCode === 'U3.1.1' || runtimeTestCaseCode === 'U3.1.2'
  const shouldRejectByAckPlan =
    ackPlan.contrlOutcome === 'negative' ||
    ackPlan.shouldSendUtiltsErr ||
    (ackPlan.shouldSendAperak && ackPlan.aperakOutcome === 'negative')

  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: message.id,
    status: 'parsed',
    parsedPayload: {
      ...(message.parsed_payload ?? {}),
      normalizedMeteringPayload: normalizedPayload,
      utiltsRuntimeFacts: runtime.facts,
      utiltsRuntimeTestCaseCode: runtimeTestCaseCode,
    },
    validationReport: {
      ...(message.validation_report ?? {}),
      utiltsRuntime: {
        validation: runtime.validation,
        ackPlan: ackPlan,
          testCaseCode: runtimeTestCaseCode,
        },
    },
  })

  if ((!runtime.validation.ok && !forcedPositiveTgtAckPlan) || shouldRejectByAckPlan) {
    const ackIds = await createUtiltsRuntimeAcks({
      actorUserId,
      sourceMessage: runtimeSourceMessage,
      ackPlan: ackPlan,
      transactionDispositions,
      testCaseCode: runtimeTestCaseCode,
    })

    await updateEdielMessageStatus({
      actorUserId,
      edielMessageId: message.id,
      status: runtime.validation.classification === 'syntax_rejected' ? 'failed' : 'validated',
      failureReason: ackPlan.reason,
      parsedPayload: {
        ...(message.parsed_payload ?? {}),
        normalizedMeteringPayload: normalizedPayload,
        utiltsRuntimeFacts: runtime.facts,
      },
      validationReport: {
        ...(message.validation_report ?? {}),
        utiltsRuntime: {
          validation: runtime.validation,
          ackPlan: ackPlan,
          createdAckMessageIds: ackIds,
        },
      },
    })

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'validated',
      eventStatus: 'warning',
      message: 'Inbound UTILTS avvisades av produktionsruntime och korrekt kvittensflöde skapades.',
      payload: {
        createdAckMessageIds: ackIds,
        normalizedMeteringPayload: normalizedPayload,
        validation: runtime.validation,
        ackPlan: ackPlan,
          testCaseCode: runtimeTestCaseCode,
        },
    })

    return {
      message,
      matchedDataRequest: canonicalLinks.matchedDataRequest,
      ackIds,
      outboundRequestId: null,
      ingestedMeterValueId: null,
      ingestedMeterValueIds: [],
      billingUnderlayId: null,
    }
  }

  if (!canonicalLinks.matchedDataRequest) {
    if (matchedPermission) {
      const permissionCustomerId = canonicalLinks.siteAndCustomer?.customerId ?? matchedPermission.customer_id ?? null
      const permissionSiteId = canonicalLinks.siteAndCustomer?.siteId ?? matchedPermission.site_id ?? null
      const permissionMeteringPointId = canonicalLinks.meteringPointId ?? matchedPermission.metering_point_id ?? null
      const permissionGridOwnerId = canonicalLinks.siteAndCustomer?.gridOwnerId ?? matchedPermission.grid_owner_id ?? null

      await linkEdielMessage({
        actorUserId,
        edielMessageId: message.id,
        customerId: permissionCustomerId,
        siteId: permissionSiteId,
        meteringPointId: permissionMeteringPointId,
        gridOwnerId: permissionGridOwnerId,
        relatedMessageId: message.related_message_id,
      })

      const ingestedMeterValues = await maybeIngestMeteringValue({
        actorUserId,
        customerId: permissionCustomerId,
        siteId: permissionSiteId,
        meteringPointId: permissionMeteringPointId,
        gridOwnerId: permissionGridOwnerId,
        dataRequestId: null,
        message,
        normalizedPayload,
      })

      const ingestedMeterValueIds = ingestedMeterValues.map((row) => row.id)
      const ackIds = await createUtiltsRuntimeAcks({
        actorUserId,
        sourceMessage: runtimeSourceMessage,
        ackPlan: ackPlan,
        transactionDispositions,
        testCaseCode: runtimeTestCaseCode,
      })

      await updateEdielMessageStatus({
        actorUserId,
        edielMessageId: message.id,
        status: 'validated',
        parsedPayload: {
          ...(message.parsed_payload ?? {}),
          normalizedMeteringPayload: normalizedPayload,
          utiltsRuntimeFacts: runtime.facts,
          matchedMeteringPermissionId: matchedPermission.id,
          ingestedMeterValueId: ingestedMeterValueIds[0] ?? null,
          ingestedMeterValueIds,
        },
        validationReport: {
          ...(message.validation_report ?? {}),
          utiltsRuntime: {
            validation: runtime.validation,
            ackPlan: ackPlan,
            createdAckMessageIds: ackIds,
          },
        },
      })

      await createEdielMessageEvent({
        actorUserId,
        edielMessageId: message.id,
        eventType: 'validated',
        eventStatus: 'success',
        message: 'Inbound UTILTS matchades mot aktivt mätvärdestillstånd och mätvärden sparades utan att kräva separat data request.',
        payload: {
          matchedMeteringPermissionId: matchedPermission.id,
          ingestedMeterValueIds,
          normalizedMeteringPayload: normalizedPayload,
          validation: runtime.validation,
          ackPlan: ackPlan,
          testCaseCode: runtimeTestCaseCode,
        },
      })

      return {
        message,
        matchedDataRequest: null,
        ackIds,
        outboundRequestId: null,
        ingestedMeterValueId: ingestedMeterValueIds[0] ?? null,
        ingestedMeterValueIds,
        billingUnderlayId: null,
      }
    }

    if (allUtiltsTransactionMeteringPointsMatched(transactionMatches)) {
      const ingestedMeterValues = await maybeIngestMeteringValue({
        actorUserId,
        customerId: canonicalLinks.siteAndCustomer?.customerId ?? null,
        siteId: canonicalLinks.siteAndCustomer?.siteId ?? null,
        meteringPointId: canonicalLinks.meteringPointId ?? null,
        gridOwnerId: canonicalLinks.siteAndCustomer?.gridOwnerId ?? null,
        dataRequestId: null,
        message,
        normalizedPayload,
      })

      const ingestedMeterValueIds = ingestedMeterValues.map((row) => row.id)
      const ackIds = await createUtiltsRuntimeAcks({
        actorUserId,
        sourceMessage: runtimeSourceMessage,
        ackPlan: ackPlan,
        transactionDispositions,
        testCaseCode: runtimeTestCaseCode,
      })

      await updateEdielMessageStatus({
        actorUserId,
        edielMessageId: message.id,
        status: 'validated',
        parsedPayload: {
          ...(message.parsed_payload ?? {}),
          normalizedMeteringPayload: normalizedPayload,
          utiltsRuntimeFacts: runtime.facts,
          utiltsTransactionMatches: transactionMatches,
          ingestedMeterValueId: ingestedMeterValueIds[0] ?? null,
          ingestedMeterValueIds,
        },
        validationReport: {
          ...(message.validation_report ?? {}),
          utiltsRuntime: {
            validation: runtime.validation,
            ackPlan: ackPlan,
            createdAckMessageIds: ackIds,
          },
        },
      })

      await createEdielMessageEvent({
        actorUserId,
        edielMessageId: message.id,
        eventType: 'validated',
        eventStatus: 'success',
        message: 'Inbound UTILTS matchades per tidsserie/anläggning inom tenant och mätvärden sparades automatiskt utan separat data request.',
        payload: {
          utiltsTransactionMatches: transactionMatches,
          ingestedMeterValueIds,
          normalizedMeteringPayload: normalizedPayload,
          validation: runtime.validation,
          ackPlan: ackPlan,
          testCaseCode: runtimeTestCaseCode,
        },
      })

      return {
        message,
        matchedDataRequest: null,
        ackIds,
        outboundRequestId: null,
        ingestedMeterValueId: ingestedMeterValueIds[0] ?? null,
        ingestedMeterValueIds,
        billingUnderlayId: null,
      }
    }

    const ackIds = await createUtiltsRuntimeAcks({
      actorUserId,
      sourceMessage: runtimeSourceMessage,
      ackPlan: ackPlan,
      transactionDispositions,
      testCaseCode: runtimeTestCaseCode,
    })

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'validated',
      eventStatus: 'warning',
      message:
        'Inbound UTILTS accepterades och kvitterades av produktionsruntime men saknar stark data request- eller mätvärdestillståndskoppling.',
      payload: {
        createdAckMessageIds: ackIds,
        normalizedMeteringPayload: normalizedPayload,
        validation: runtime.validation,
        ackPlan: ackPlan,
          testCaseCode: runtimeTestCaseCode,
        },
    })

    return {
      message,
      matchedDataRequest: null,
      ackIds,
      outboundRequestId: null,
      ingestedMeterValueId: null,
      ingestedMeterValueIds: [],
      billingUnderlayId: null,
    }
  }

  const dataRequest = canonicalLinks.matchedDataRequest
  const customerId = canonicalLinks.siteAndCustomer?.customerId ?? dataRequest.customer_id ?? null
  const siteId = canonicalLinks.siteAndCustomer?.siteId ?? dataRequest.site_id ?? null
  const meteringPointId = canonicalLinks.meteringPointId ?? dataRequest.metering_point_id ?? null
  const gridOwnerId = canonicalLinks.siteAndCustomer?.gridOwnerId ?? dataRequest.grid_owner_id ?? null

  const acknowledgedOutbound = await markDataRequestOutboundAcknowledged({
    actorUserId,
    dataRequestId: dataRequest.id,
    externalReference: message.external_reference ?? null,
    edielMessageId: message.id,
    normalizedPayload,
  })

  const ingestedMeterValues = await maybeIngestMeteringValue({
    actorUserId,
    customerId,
    siteId,
    meteringPointId,
    gridOwnerId,
    dataRequestId: dataRequest.id,
    message,
    normalizedPayload,
  })

  const ingestedMeterValue = ingestedMeterValues[0] ?? null
  const ingestedMeterValueIds = ingestedMeterValues.map((row) => row.id)

  const billingUnderlay = await maybeCreateBillingUnderlay({
    actorUserId,
    dataRequest,
    customerId,
    siteId,
    meteringPointId,
    gridOwnerId,
    message,
    normalizedPayload,
  })

  await syncGridOwnerDataRequestReceivedFromEdiel({
    actorUserId,
    requestId: dataRequest.id,
    edielMessageId: message.id,
    externalReference: message.external_reference ?? dataRequest.external_reference ?? null,
    parsedPayload: message.parsed_payload ?? {},
    ingestedMeterValueId: ingestedMeterValue?.id ?? null,
    notes: dataRequest.notes ?? null,
    extraResponsePayload: {
      normalizedMeteringPayload: normalizedPayload,
      ingestedMeterValueIds,
      utiltsRuntime: {
        validation: runtime.validation,
        ackPlan: ackPlan,
          testCaseCode: runtimeTestCaseCode,
        },
      outboundRequestId: acknowledgedOutbound?.id ?? null,
      billingUnderlayId: billingUnderlay?.id ?? null,
      billingUnderlayCandidate:
        dataRequest.request_scope === 'billing_underlay'
          ? {
              status: billingUnderlay ? 'created' : 'not_created',
              reason: billingUnderlay
                ? 'billing_underlay_created_from_inbound_utilts'
                : 'missing_customer_or_quantity_or_existing_underlay',
            }
          : null,
    },
  })

  const ackIds = await createUtiltsRuntimeAcks({
    actorUserId,
    sourceMessage: runtimeSourceMessage,
    ackPlan: ackPlan,
    transactionDispositions,
    testCaseCode: runtimeTestCaseCode,
  })

  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: message.id,
    status: 'validated',
    parsedPayload: {
      ...(message.parsed_payload ?? {}),
      normalizedMeteringPayload: normalizedPayload,
      utiltsRuntimeFacts: runtime.facts,
      ingestedMeterValueId: ingestedMeterValue?.id ?? null,
      ingestedMeterValueIds,
      billingUnderlayId: billingUnderlay?.id ?? null,
    },
    validationReport: {
      ...(message.validation_report ?? {}),
      utiltsRuntime: {
        validation: runtime.validation,
        ackPlan: ackPlan,
        createdAckMessageIds: ackIds,
      },
    },
  })

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: message.id,
    eventType: 'validated',
    eventStatus: 'success',
    message:
      'Inbound UTILTS matchat mot data request, mätvärde/fakturaunderlag hanterat och kvitterat av produktionsruntime.',
    payload: {
      matchedGridOwnerDataRequestId: dataRequest.id,
      createdAckMessageIds: ackIds,
      outboundRequestId: acknowledgedOutbound?.id ?? null,
      ingestedMeterValueId: ingestedMeterValue?.id ?? null,
      ingestedMeterValueIds,
      billingUnderlayId: billingUnderlay?.id ?? null,
      normalizedMeteringPayload: normalizedPayload,
      validation: runtime.validation,
      ackPlan: ackPlan,
    },
  })

  return {
    message,
    matchedDataRequest: dataRequest,
    ackIds,
    outboundRequestId: acknowledgedOutbound?.id ?? null,
    ingestedMeterValueId: ingestedMeterValue?.id ?? null,
    ingestedMeterValueIds,
    billingUnderlayId: billingUnderlay?.id ?? null,
  }
}
