import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { E66RequestDeferred, submitPolledE66Request, type PolledE66RequestScope } from '@/lib/inbound-mail/e66RequestRetry'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {requireDataRequestStructure} from '@/lib/ediel/sources/dataRequestStructure'
import {dataRequestLegalParties} from '@/lib/ediel/sources/dataRequestLegalParties'
// Extracted from utiltsDataRequest.ts; keep public imports on the facade module.
import { applyCertifiedUtiltsAckPolicy } from '@/lib/ediel/rulebook/utiltsAckPolicy'
import { captureEdielTechnicalSyntaxAckEvidence, readEdielTechnicalSourceEndpoint, recordEdielTechnicalSyntaxDecision } from '@/lib/ediel/ack/technicalSyntaxAuthority'
import { getCustomerSiteById, getGridOwnerById, getMeteringPointById } from '@/lib/masterdata/db'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {readCanonicalPeriodicReasonAuthority,readCanonicalUtiltsIssuerIdentityAuthority,type CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {holdCanonicalEvidenceGateBlocked,initialCanonicalUtiltsDecision,recordFinalCanonicalUtiltsDecision} from './utiltsCanonicalValidation'
import { E66_INVALID_REGISTRATION_DATE_ISSUE, runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { qualifyReceivedUtiltsStructure } from '@/lib/ediel/utilts/qualifyReceivedStructure'
import { readReceivedStructuralSources } from '@/lib/ediel/utilts/receivedStructuralSources'
import { readAndRecordDurableReceivedSources } from '@/lib/ediel/utilts/receivedSourceLedger'
import { createEdielMessageEvent, getEdielMessageById, linkEdielMessage, updateEdielMessageStatus } from '@/lib/ediel/db'

import { resolveDecisionBackedOutboundContext } from '@/lib/ediel/flows/routeDecisionContext'
import { ensureActorUserId, finalizeOutboundDraft, findOrCreateDataRequestOutbound, getGridOwnerDataRequestById, makeServerClient, queuePreparedEdielMessage, resolveOutboundRuntimeEnvironment } from '@/lib/ediel/flows/shared'
import { syncGridOwnerDataRequestReceivedFromEdiel, updateGridOwnerDataRequestStatus } from '@/lib/cis/db'

import type { EdielEnvironment, EdielMessageRow } from '@/lib/ediel/types'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { findActiveMeteringPermissionForUtiltsMessage } from '@/lib/onboarding/inboundEdielLinking'




import { validateUtiltsPersistenceResults, buildUtiltsTransactionPersistencePayload, persistUtiltsTransactionResults, storedUtiltsConsumptionVersionState, prepareUtiltsPersistenceRpcArguments, resolveUtiltsTransactionId, storedUtiltsConsumption } from '@/lib/ediel/utilts/transactionPersistence'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { createUtiltsRepliesAfterStore } from '@/lib/ediel/utilts/utiltsReplyAfterStore'


import type { UtiltsProcessResult } from './utiltsDataRequest.part-1'
import { type E66RequestCorrelationReview, allUtiltsTransactionMeteringPointsMatched, createUtiltsRuntimeAcks, ensureJson, linkInboundUtiltsMessageCanonically, markDataRequestOutboundAcknowledged, matchUtiltsTransactionsForTenant, maybeCreateBillingUnderlay, maybeIngestMeteringValue, resolveUtiltsRuntimeTestCaseCode, stringOrNull } from './utiltsDataRequest.part-1'

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

  const sourceStructure=await requireDataRequestStructure({companyId,actorUserId,environment,customerId:dataRequest.customer_id,siteId:dataRequest.site_id,meteringPointId:dataRequest.metering_point_id,
    periodStart:dataRequest.requested_period_start,periodEnd:dataRequest.requested_period_end,...dataRequestLegalParties({companyId,environment,route:routeContext,networkEdielId:gridOwner?.ediel_id})})
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
      legalSenderEdielId: sourceStructure.legalSupplier,
      legalReceiverEdielId: sourceStructure.legalNetwork,
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
      readingFrequency: sourceStructure.fields.reportingFrequency,
      resolution:sourceStructure.resolution,
      measurementMethod:sourceStructure.fields.measurementMethod,
      timeSeriesProduct:sourceStructure.fields.productCode,
      structuralSource:{snapshotId:sourceStructure.snapshotId,readsetHash:sourceStructure.readsetHash,selection:sourceStructure.selection},
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

  const sourceStructure=await requireDataRequestStructure({companyId,actorUserId,environment,customerId:dataRequest.customer_id,siteId:dataRequest.site_id,meteringPointId:dataRequest.metering_point_id,
    periodStart:params.periodStart??dataRequest.requested_period_start,periodEnd:params.periodEnd??dataRequest.requested_period_end,...dataRequestLegalParties({companyId,environment,route:routeContext,networkEdielId:gridOwner?.ediel_id})})
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
      legalSenderEdielId: sourceStructure.legalSupplier,
      legalReceiverEdielId: sourceStructure.legalNetwork,
      meterPointId: meteringPoint?.meter_point_id ?? null,
      meteringPointId: meteringPoint?.meter_point_id ?? null,
      gridAreaId: gridOwner?.owner_code ?? gridOwner?.ediel_id ?? null,
      periodStart: params.periodStart ?? dataRequest.requested_period_start,
      periodEnd: params.periodEnd ?? dataRequest.requested_period_end,
      registrationTime: params.registrationTime ?? new Date().toISOString(),
      quantity: params.quantity ?? 0,
      unit: 'KWH',
      resolution:sourceStructure.resolution,
      readingFrequency:sourceStructure.fields.reportingFrequency,
      measurementMethod:sourceStructure.fields.measurementMethod,
      timeSeriesProduct:sourceStructure.fields.productCode,
      structuralSource:{snapshotId:sourceStructure.snapshotId,readsetHash:sourceStructure.readsetHash,selection:sourceStructure.selection},
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

export type DurableE66RequestBasis = {
  requestId: string
  normalizedMeteringPayload: Record<string, unknown>
  utiltsRuntime: {
    validation: ReturnType<typeof runUtiltsRuntimeForMessage>['validation']
    ackPlan: ReturnType<typeof runUtiltsRuntimeForMessage>['ackPlan']
    testCaseCode: Awaited<ReturnType<typeof resolveUtiltsRuntimeTestCaseCode>>
  }
  billingUnderlayCandidate: ReturnType<typeof e66BillingUnderlayCandidate>
}

function e66BillingUnderlayCandidate(requestScope: string | null, created: boolean) {
  if (requestScope !== 'billing_underlay') return null
  return {
    status: created ? 'created' : 'not_created',
    reason: created
      ? 'billing_underlay_created_from_inbound_utilts'
      : 'missing_customer_or_quantity_or_existing_underlay',
  }
}

function e66RequestPayload(
  normalizedMeteringPayload: DurableE66RequestBasis['normalizedMeteringPayload'],
  utiltsRuntime: DurableE66RequestBasis['utiltsRuntime'],
  requestScope: string | null,
  underlayCreated: boolean,
) {
  return {
    normalizedMeteringPayload, utiltsRuntime,
    billingUnderlayCandidate: e66BillingUnderlayCandidate(requestScope, underlayCreated),
  }
}

export async function processInboundUtiltsMessage(params: {
  actorUserId: string
  edielMessageId: string
  testCaseCode?: string | null
  canonicalPolicy?: CanonicalEdielPolicy | null
  canonicalDecision?: CanonicalRuntimeDecision | null
  polledE66RequestScope?: PolledE66RequestScope
  holdDurableE66RequestReview?: (review: E66RequestCorrelationReview) => Promise<void>
  commitDurableE66Qualification?: (
    command: ReturnType<typeof prepareUtiltsPersistenceRpcArguments> & { matchedRequestBasis?: DurableE66RequestBasis },
  ) => Promise<void>
  persistDurableE66RegistrationRejection?: (command: ReturnType<typeof prepareUtiltsPersistenceRpcArguments>) => Promise<unknown>
}): Promise<UtiltsProcessResult> {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const message = await getEdielMessageById(params.edielMessageId)

  if (!message) throw new Error('Ediel-meddelande hittades inte')
  if (message.message_family !== 'UTILTS') {
    throw new Error(`Meddelande ${message.id} är inte UTILTS.`)
  }

  if(!message.company_id) throw new Error('UTILTS-meddelandet saknar tenantkoppling.')
  await assertEdielTenantActor({companyId:message.company_id,actorUserId,permission:'metering.write'})


  const runtimeTestCaseCode = await resolveUtiltsRuntimeTestCaseCode({
    sourceMessage: message,
    explicitTestCaseCode: params.testCaseCode ?? null,
  })

  // First build a parse-only runtime snapshot so matching/permission logic can use
  // normalized UTILTS facts. The final ACK decision is run again after canonical
  // business matching, because live/test must use the same production rule: object
  // identity/processability is validated before period/observation-count checks.
  const initialDecision=await initialCanonicalUtiltsDecision(message,params.canonicalDecision,params.canonicalPolicy)
  if (await holdCanonicalEvidenceGateBlocked({actorUserId,message,initialDecision})) {
    return {message,matchedDataRequest:null,ackIds:[],internalReviewRequired:true,outboundRequestId:null,ingestedMeterValueId:null,ingestedMeterValueIds:[],billingUnderlayId:null}
  }
  const canonicalPolicy = initialDecision.policy
  if (!canonicalPolicy || canonicalPolicy.family !== 'UTILTS' || canonicalPolicy.code !== message.message_code || canonicalPolicy.direction !== 'inbound') {
    throw new Error(`utilts_inbound_policy_context_mismatch:${message.id}`)
  }
  const periodicReasonAuthority=readCanonicalPeriodicReasonAuthority({decision:initialDecision,message})??undefined
  const issuerIdentityAuthority=readCanonicalUtiltsIssuerIdentityAuthority({decision:initialDecision,message})??undefined
  const provisionalRuntime = runUtiltsRuntimeForMessage(message, { canonicalPolicy,issuerIdentityAuthority,periodicReasonAuthority })
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
    provisionalRuntime,
  })

  const permissionProbeMessage: EdielMessageRow = {
    ...message,
    customer_id: canonicalLinks.siteAndCustomer?.customerId ?? canonicalLinks.matchedDataRequest?.customer_id ?? message.customer_id,
    site_id: canonicalLinks.siteAndCustomer?.siteId ?? canonicalLinks.matchedDataRequest?.site_id ?? message.site_id,
    metering_point_id: canonicalLinks.meteringPointId ?? canonicalLinks.matchedDataRequest?.metering_point_id ?? message.metering_point_id,
    grid_owner_id: canonicalLinks.siteAndCustomer?.gridOwnerId ?? canonicalLinks.matchedDataRequest?.grid_owner_id ?? message.grid_owner_id,
    grid_owner_data_request_id: canonicalLinks.requestReview
      ? null
      : canonicalLinks.matchedDataRequest?.id ?? message.grid_owner_data_request_id,
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

  const structuralQualification = await qualifyReceivedUtiltsStructure({
    message: runtimeSourceMessage, canonicalPolicy,issuerIdentityAuthority,periodicReasonAuthority,
    runtime: runUtiltsRuntimeForMessage(runtimeSourceMessage, { canonicalPolicy,issuerIdentityAuthority,periodicReasonAuthority }),
  })
  const runtime = structuralQualification.runtime
  try { await recordFinalCanonicalUtiltsDecision({original:message,validated:runtimeSourceMessage,initialDecision,runtime}) }
  catch (error) {
    // The legal receiver (NAD+MR, field 208) could not be resolved when the
    // source was received: no own identity can sign a reply and no rule basis
    // can be captured. Hold it for manual review: no ACK, consumption or effect.
    if (!legalReceiverUnresolved(error)) throw error
    await createEdielMessageEvent({actorUserId,edielMessageId:message.id,eventType:'validated',eventStatus:'warning',
      message:'Mottagarens juridiska identitet (fält 208) kunde inte fastställas. Meddelandet hålls för manuell granskning utan kvittens eller affärseffekt.',
      payload:{reason:'ediel_inbound_legal_context_required',manualReviewRequired:true}})
    return {message,matchedDataRequest:canonicalLinks.matchedDataRequest,ackIds:[],internalReviewRequired:true,outboundRequestId:null,ingestedMeterValueId:null,ingestedMeterValueIds:[],billingUnderlayId:null}
  }
  const structuralDecisionRequired = structuralQualification.hasInternalReview || structuralQualification.hasNationalMismatch
  const ackPlan = structuralDecisionRequired ? runtime.ackPlan : applyCertifiedUtiltsAckPolicy({
    runtime, testCaseCode: runtimeTestCaseCode,
  })
  let transactionDispositions = runtime.transactionDispositions
  let transactionPersistenceResults: Awaited<ReturnType<typeof persistUtiltsTransactionResults>> = []
  const normalizedPayload = {
    ...runtime.normalizedPayload,
    utiltsTransactionMatches: transactionMatches,
    receivedStructureQualification: structuralQualification.evidence,
    utiltsTransactionDispositions: transactionDispositions,
    utiltsTransactionPersistenceResults: transactionPersistenceResults,
    receivedStructuralSources: await readReceivedStructuralSources({ message: runtimeSourceMessage, transactionMatches }),
    durableReceivedSourceInventory: await readAndRecordDurableReceivedSources(runtimeSourceMessage),
  }
  const companyId = stringOrNull(runtimeSourceMessage.company_id)
  const messageCode = stringOrNull(runtime.facts.messageCode)
  const persistRegistrationRejection = messageCode === 'E66' && !structuralDecisionRequired &&
    runtime.validation.classification === 'application_rejected' &&
    ackPlan.contrlOutcome !== 'negative' && !ackPlan.shouldSendUtiltsErr &&
    transactionDispositions.length === 1 &&
    transactionDispositions[0].disposition === 'guide_rejected' &&
    transactionDispositions[0].responseType === 'negative_aperak' &&
    (transactionDispositions[0].issueCodes.includes(E66_INVALID_REGISTRATION_DATE_ISSUE) ||
      (transactionDispositions[0].issueCodes.includes('UTILTS_TIMEZONE_INVALID') &&
        ackPlan.utiltsHeaderRejection?.applicationErrors.some(issue => issue.ercCode === '42' && issue.fieldCode === '206')))
    ? params.persistDurableE66RegistrationRejection
    : undefined
  const requestReview = canonicalLinks.requestReview
  if (requestReview && !persistRegistrationRejection &&
      (requestReview.reason !== 'missing_reference' || !matchedPermission) &&
      ackPlan.contrlOutcome !== 'negative' && !ackPlan.shouldSendUtiltsErr &&
      (!ackPlan.shouldSendAperak || ackPlan.aperakOutcome === 'positive')) {
    if (params.holdDurableE66RequestReview) {
      await params.holdDurableE66RequestReview(requestReview)
    } else {
      await createEdielMessageEvent({actorUserId,edielMessageId:message.id,eventType:'validated',eventStatus:'warning',
        message:'Kontrollera vilket E73 som E66-svaret gäller.',
        payload:{code:'e66_request_correlation_review',...requestReview}})
    }
    return {message,matchedDataRequest:null,ackIds:[],internalReviewRequired:true,
      outboundRequestId:null,ingestedMeterValueId:null,ingestedMeterValueIds:[],billingUnderlayId:null}
  }
  if (params.commitDurableE66Qualification && !persistRegistrationRejection && (
    !companyId || messageCode !== 'E66' || structuralDecisionRequired || !runtime.validation.ok ||
    ackPlan.contrlOutcome === 'negative' || ackPlan.shouldSendUtiltsErr ||
    (ackPlan.shouldSendAperak && ackPlan.aperakOutcome !== 'positive') ||
    transactionDispositions.length !== 1 || transactionDispositions[0].disposition !== 'accepted' ||
    transactionDispositions[0].responseType !== 'positive_aperak'
  )) throw new Error('e66_durable_qualification_scope_unsupported')
  if (persistRegistrationRejection && ackPlan.shouldSendContrl && ackPlan.contrlOutcome === 'positive') {
    // Durable intake owns the source before the general inbound command can
    // capture syntax. Use the same physical authority for its technical ACK.
    const execution = { actorUserId, phase: 'prepare' as const }
    const endpoint = await readEdielTechnicalSourceEndpoint(message.id, execution)
    const sourceHash = createHash('sha256').update(message.raw_payload ?? '', 'utf8').digest('hex')
    if (!endpoint || endpoint.companyId !== companyId || endpoint.environment !== message.environment || endpoint.sourceHash !== sourceHash) {
      throw new Error('technical_source_wire_scope_mismatch')
    }
    await assertEdielTenantActor({ companyId: endpoint.companyId, actorUserId, permission: 'communication.write' })
    await recordEdielTechnicalSyntaxDecision({ companyId: endpoint.companyId, sourceMessageId: message.id, sourceHash,
      syntaxDecision: 'accepted', reasonCodes: [], execution })
    await captureEdielTechnicalSyntaxAckEvidence(endpoint.companyId, message.id, execution)
  }
  if (companyId && messageCode && transactionDispositions.length > 0) {
    const dataRequest = canonicalLinks.matchedDataRequest
    const fallback = {
      customerId: canonicalLinks.siteAndCustomer?.customerId ?? dataRequest?.customer_id ?? matchedPermission?.customer_id ?? null,
      siteId: canonicalLinks.siteAndCustomer?.siteId ?? dataRequest?.site_id ?? matchedPermission?.site_id ?? null,
      meteringPointId: canonicalLinks.meteringPointId ?? dataRequest?.metering_point_id ?? matchedPermission?.metering_point_id ?? null,
      gridOwnerId: canonicalLinks.siteAndCustomer?.gridOwnerId ?? dataRequest?.grid_owner_id ?? matchedPermission?.grid_owner_id ?? null,
    }
    const contracts = await prepareUtiltsConsumptionContracts({ message: runtimeSourceMessage, runtime, policy: canonicalPolicy,
      matches: transactionMatches, dataRequest, sentRequestPeriod: canonicalLinks.sentRequestPeriod, fallback, allowConsumption: true })
    const command: Parameters<typeof persistUtiltsTransactionResults>[0] = {
      actorUserId,
      companyId,
      environment: runtimeSourceMessage.environment,
      sourceMessageId: runtimeSourceMessage.id,
      messageCode,
      rawPayload: runtimeSourceMessage.raw_payload ?? '',
      contracts,
      transactions: buildUtiltsTransactionPersistencePayload({
        messageCode,
        transactions: runtime.facts.transactions,
        rawPayload: runtimeSourceMessage.raw_payload,
        dispositions: transactionDispositions,
        matches: transactionMatches,
      }),
    }
    if (params.commitDurableE66Qualification && !persistRegistrationRejection) {
      if (contracts.length !== 1 || contracts[0].metering.capability !== 'write' ||
          contracts[0].observations.length === 0 ||
          (contracts[0].billing.capability === 'write' && (
            contracts[0].billing.requestScope !== 'billing_underlay' ||
            !dataRequest || contracts[0].billing.sourceRequestId !== dataRequest.id
          ))) {
        throw new Error('e66_durable_qualification_scope_unsupported')
      }
      let basis: DurableE66RequestBasis | null = null
      if (dataRequest) {
        if (contracts[0].metering.sourceRequestId !== dataRequest.id) {
          throw new Error('e66_durable_request_scope_invalid')
        }
        basis = {
          requestId: dataRequest.id,
          ...e66RequestPayload(
            {
              ...normalizedPayload,
              utiltsTransactionDispositions: transactionDispositions.map(item => ({
                ...item, transactionId: resolveUtiltsTransactionId(item.transactionId, 0),
              })),
            },
            { validation: runtime.validation, ackPlan, testCaseCode: runtimeTestCaseCode },
            dataRequest.request_scope,
            contracts[0].billing.capability === 'write',
          ),
        }
      }
      const prepared = prepareUtiltsPersistenceRpcArguments(command)
      await params.commitDurableE66Qualification(basis ? { ...prepared, matchedRequestBasis: basis } : prepared)
      return {
        message,
        matchedDataRequest: canonicalLinks.matchedDataRequest,
        ackIds: [],
        outboundRequestId: null,
        ingestedMeterValueId: null,
        ingestedMeterValueIds: [],
        billingUnderlayId: null,
        durableQualificationCommitted: true,
      }
    }
    transactionPersistenceResults = persistRegistrationRejection
      ? validateUtiltsPersistenceResults(command, await persistRegistrationRejection(prepareUtiltsPersistenceRpcArguments(command)))
      : await persistUtiltsTransactionResults(command)
    // An RPC array is not evidence unless every requested transaction has one
    // coherent outcome. Stop internally before ACKs or request completion;
    // missing/ambiguous evidence must not fabricate a national rejection.
    const expectedIds = transactionDispositions.map((item, index) => resolveUtiltsTransactionId(item.transactionId, index))
    const validResults = transactionPersistenceResults.length === expectedIds.length &&
      new Set(expectedIds).size === expectedIds.length &&
      transactionDispositions.every((disposition, index) => {
        const results = transactionPersistenceResults.filter(item => ensureJson(item).transactionId === expectedIds[index])
        if (results.length !== 1) return false
        const result = results[0]
        return result.disposition === disposition.disposition && result.responseType === disposition.responseType &&
          result.persistenceStatus === (disposition.disposition === 'accepted' ? 'persisted' : 'not_applicable')
      })
    if (!validResults) throw new Error('utilts_transaction_persistence_invalid_result')
    transactionDispositions = transactionDispositions.map((disposition, index) => ({
      ...disposition, transactionId: resolveUtiltsTransactionId(disposition.transactionId, index),
    }))
  }
  if (transactionPersistenceResults.length === 0 && (transactionDispositions.length > 0 || runtime.validation.ok)) {
    throw new Error('utilts_transaction_persistence_invalid_result')
  }
  normalizedPayload.utiltsTransactionDispositions = transactionDispositions
  normalizedPayload.utiltsTransactionPersistenceResults = transactionPersistenceResults
  const forcedPositiveTgtAckPlan =
    !structuralDecisionRequired && (runtimeTestCaseCode === 'U3.1.1' || runtimeTestCaseCode === 'U3.1.2')
  const shouldRejectByAckPlan =
    ackPlan.contrlOutcome === 'negative' ||
    ackPlan.shouldSendUtiltsErr ||
    (ackPlan.shouldSendAperak && ackPlan.aperakOutcome === 'negative')

  // A guide error belongs to its IDE, not to a healthy sibling. Only enter
  // the partial consumption path when every error is explicitly referenced to
  // a rejected transaction and the persisted accepted result has its own
  // source-bound contract. Header, syntax, functional and structural holds
  // retain the whole-message stop below.
  const rejectedGuideIds = new Set(transactionDispositions
    .flatMap((item, index) => item.disposition === 'guide_rejected' ? [resolveUtiltsTransactionId(item.transactionId, index)] : []))
  const consumeAcceptedGuideSiblings = !structuralDecisionRequired &&
    runtime.validation.classification === 'application_rejected' &&
    ackPlan.contrlOutcome !== 'negative' && !ackPlan.shouldSendUtiltsErr &&
    rejectedGuideIds.size > 0 && transactionDispositions.some(item => item.disposition === 'accepted') &&
    transactionDispositions.every(item => item.disposition === 'accepted' || item.disposition === 'guide_rejected') &&
    runtime.validation.issues.filter(issue => issue.severity === 'error').every(issue =>
      issue.kind === 'application' && issue.referenceQualifier === 'ACW' &&
      Boolean(issue.referenceNumber && rejectedGuideIds.has(issue.referenceNumber)))

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
    if (consumeAcceptedGuideSiblings && canonicalLinks.matchedDataRequest) {
      const request = canonicalLinks.matchedDataRequest
      for (const outcome of transactionPersistenceResults.filter(item => item.disposition === 'accepted')) {
        const contract = storedUtiltsConsumption(outcome, message.id)
        if (!contract || contract.metering.sourceRequestId !== request.id ||
          contract.metering.meteringPointId !== request.metering_point_id ||
          contract.metering.customerId !== request.customer_id ||
          (request.site_id && contract.metering.siteId !== request.site_id) ||
          (request.grid_owner_id && contract.metering.gridOwnerId !== request.grid_owner_id) ||
          (contract.billing.capability === 'write' &&
            (contract.billing.sourceRequestId !== request.id ||
              contract.billing.meteringPointId !== request.metering_point_id ||
              contract.billing.customerId !== request.customer_id))) {
          throw new Error('utilts_partial_request_scope_conflict')
        }
      }
    }
    // Consume before publishing a positive transaction ACK. An exception in a
    // sink leaves the source retryable, while the SQL binding and sink identity
    // keep a repeated attempt tied to the same accepted IDE and source bytes.
    const partialMeterValues = consumeAcceptedGuideSiblings ? await maybeIngestMeteringValue({
      boundOutcomes: transactionPersistenceResults,
      actorUserId,
      customerId: canonicalLinks.siteAndCustomer?.customerId ?? canonicalLinks.matchedDataRequest?.customer_id ?? matchedPermission?.customer_id ?? null,
      siteId: canonicalLinks.siteAndCustomer?.siteId ?? canonicalLinks.matchedDataRequest?.site_id ?? matchedPermission?.site_id ?? null,
      meteringPointId: canonicalLinks.meteringPointId ?? canonicalLinks.matchedDataRequest?.metering_point_id ?? matchedPermission?.metering_point_id ?? null,
      gridOwnerId: canonicalLinks.siteAndCustomer?.gridOwnerId ?? canonicalLinks.matchedDataRequest?.grid_owner_id ?? matchedPermission?.grid_owner_id ?? null,
      dataRequestId: canonicalLinks.matchedDataRequest?.id ?? null,
      message,
      normalizedPayload,
    }) : []
    const partialBillingUnderlay = consumeAcceptedGuideSiblings && canonicalLinks.matchedDataRequest
      ? await maybeCreateBillingUnderlay({
          boundOutcomes: transactionPersistenceResults,
          actorUserId,
          dataRequest: canonicalLinks.matchedDataRequest,
          customerId: canonicalLinks.siteAndCustomer?.customerId ?? canonicalLinks.matchedDataRequest.customer_id ?? null,
          siteId: canonicalLinks.siteAndCustomer?.siteId ?? canonicalLinks.matchedDataRequest.site_id ?? null,
          meteringPointId: canonicalLinks.meteringPointId ?? canonicalLinks.matchedDataRequest.metering_point_id ?? null,
          gridOwnerId: canonicalLinks.siteAndCustomer?.gridOwnerId ?? canonicalLinks.matchedDataRequest.grid_owner_id ?? null,
          message,
          normalizedPayload,
        }) : null
    const partialMeterValueIds = partialMeterValues.map(row => row.id)
    const ackIds = await createUtiltsRepliesAfterStore({ actorUserId, sourceMessageId: message.id,
      storedMeterValueIds: partialMeterValueIds, billingUnderlayId: partialBillingUnderlay?.id ?? null }, () => createUtiltsRuntimeAcks({
      actorUserId,
      sourceMessage: runtimeSourceMessage,
      ackPlan: ackPlan,
      transactionDispositions,
      testCaseCode: runtimeTestCaseCode,
    }))

    await updateEdielMessageStatus({
      actorUserId,
      edielMessageId: message.id,
      status: runtime.validation.classification === 'syntax_rejected' ? 'failed' : 'validated',
      failureReason: ackPlan.reason,
      parsedPayload: {
        ...(message.parsed_payload ?? {}),
        normalizedMeteringPayload: normalizedPayload,
        utiltsRuntimeFacts: runtime.facts,
        ingestedMeterValueIds: partialMeterValueIds,
        billingUnderlayId: partialBillingUnderlay?.id ?? null,
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

    if (!persistRegistrationRejection) await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'validated',
      eventStatus: 'warning',
      message: structuralQualification.hasInternalReview
        ? 'Inbound UTILTS väntar på godkänt strukturunderlag. Berörda transaktioner har inte kvitterats eller lagrats som mätvärden.'
        : consumeAcceptedGuideSiblings
          ? 'Inbound UTILTS avvisade guidefelaktiga transaktioner; endast separat accepterade transaktioner konsumerades och kvitterades.'
        : 'Inbound UTILTS avvisades av produktionsruntime och korrekt kvittensflöde skapades.',
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
      internalReviewRequired: structuralQualification.hasInternalReview,
      outboundRequestId: null,
      ingestedMeterValueId: partialMeterValueIds[0] ?? null,
      ingestedMeterValueIds: partialMeterValueIds,
      billingUnderlayId: partialBillingUnderlay?.id ?? null,
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
        boundOutcomes: transactionPersistenceResults,
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
      const ackIds = await createUtiltsRepliesAfterStore({ actorUserId, sourceMessageId: message.id,
        storedMeterValueIds: ingestedMeterValueIds }, () => createUtiltsRuntimeAcks({
        actorUserId,
        sourceMessage: runtimeSourceMessage,
        ackPlan: ackPlan,
        transactionDispositions,
        testCaseCode: runtimeTestCaseCode,
      }))

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
        boundOutcomes: transactionPersistenceResults,
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
      const ackIds = await createUtiltsRepliesAfterStore({ actorUserId, sourceMessageId: message.id,
        storedMeterValueIds: ingestedMeterValueIds }, () => createUtiltsRuntimeAcks({
        actorUserId,
        sourceMessage: runtimeSourceMessage,
        ackPlan: ackPlan,
        transactionDispositions,
        testCaseCode: runtimeTestCaseCode,
      }))

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

  const isE66 = runtime.facts.messageCode === 'E66'
  let historicalOnly = isE66 && transactionPersistenceResults.length > 0 &&
    transactionPersistenceResults.every(result => result.disposition === 'accepted' &&
      result.persistenceStatus === 'persisted' && storedUtiltsConsumptionVersionState(result, message.id) === 'late_older_history')
  const acknowledgeOutbound = () => markDataRequestOutboundAcknowledged({
    actorUserId,
    dataRequestId: dataRequest.id,
    externalReference: message.external_reference ?? null,
    edielMessageId: message.id,
    normalizedPayload,
  })
  let outboundRequestId = isE66 ? null : (await acknowledgeOutbound())?.id ?? null

  const ingestedMeterValues = await maybeIngestMeteringValue({
    boundOutcomes: transactionPersistenceResults,
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
    boundOutcomes: transactionPersistenceResults,
    actorUserId,
    dataRequest,
    customerId,
    siteId,
    meteringPointId,
    gridOwnerId,
    message,
    normalizedPayload,
  })

  if (!historicalOnly) {
    const response = {
      ...e66RequestPayload(
        normalizedPayload,
        { validation: runtime.validation, ackPlan, testCaseCode: runtimeTestCaseCode },
        dataRequest.request_scope,
        billingUnderlay !== null,
      ),
      ingestedMeterValueIds,
      billingUnderlayId: billingUnderlay?.id ?? null,
    }
    if (isE66 && ingestedMeterValue) {
      if (!companyId) throw new Error('e66_current_request_source_scope_required')
      // Advance the outbound acknowledgement and the request together only
      // while the stored original is still the currently applied revision.
      const meterValueIds = [...new Set(ingestedMeterValueIds)]
      const responsePatch = {
        ...response,
        edielMessageId: message.id,
        parsedPayload: message.parsed_payload ?? {},
        receivedVia: 'inbound_ediel',
        ingestedMeterValueId: ingestedMeterValue.id,
        ingestedMeterValueIds: meterValueIds,
      }
      const { data, error } = params.polledE66RequestScope
        ? await submitPolledE66Request(params.polledE66RequestScope, {
          companyId,
          requestId: dataRequest.id,
          actorUserId,
          sourceMessageId: message.id,
          meterValueIds,
          responsePatch,
        })
        : await supabaseService.rpc('gridex_sync_current_e66_request_v1', {
          p_company_id: companyId,
          p_request_id: dataRequest.id,
          p_actor_id: actorUserId,
          p_source_message_id: message.id,
          p_meter_value_ids: meterValueIds,
          p_response_patch: responsePatch,
        })
      if (error?.code === '55P03') {
        throw Object.assign(new Error('e66_current_request_database_lock_contended', { cause: error }), { code: error.code })
      }
      if (error) throw error
      const outcome = ensureJson(data)
      if (params.polledE66RequestScope && outcome.sourceId !== message.id) {
        throw new Error('e66_current_request_invalid_result')
      }
      if (outcome.status === 'deferred' && params.polledE66RequestScope) throw new E66RequestDeferred()
      if (outcome.status === 'replaced') historicalOnly = true
      else if (outcome.status === 'cancelled') throw new Error('e66_current_request_cancelled')
      else if (outcome.status === 'received' || outcome.status === 'partial') outboundRequestId = stringOrNull(outcome.outboundRequestId)
      else throw new Error('e66_current_request_invalid_result')
    } else if (!isE66) {
      if (!companyId) throw new Error('UTILTS-meddelandet saknar bolag för nätägarbegäran.')
      await syncGridOwnerDataRequestReceivedFromEdiel({
        actorUserId,
        companyId,
        requestId: dataRequest.id,
        edielMessageId: message.id,
        parsedPayload: message.parsed_payload ?? {},
        ingestedMeterValueId: ingestedMeterValue?.id ?? null,
        extraResponsePayload: { ...response, outboundRequestId },
      })
    }
  }

  const ackIds = await createUtiltsRepliesAfterStore({ actorUserId, sourceMessageId: message.id,
    storedMeterValueIds: ingestedMeterValueIds, billingUnderlayId: billingUnderlay?.id ?? null }, () => createUtiltsRuntimeAcks({
    actorUserId,
    sourceMessage: runtimeSourceMessage,
    ackPlan: ackPlan,
    transactionDispositions,
    testCaseCode: runtimeTestCaseCode,
  }))

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
    message: historicalOnly
      ? 'Historiskt E66-källkvitto verifierat. Befintliga mottagna uppgifter för nätägarbegäran bevarades.'
      : 'Inbound UTILTS matchat mot data request, mätvärde/fakturaunderlag hanterat och kvitterat av produktionsruntime.',
    payload: {
      matchedGridOwnerDataRequestId: dataRequest.id,
      ...(historicalOnly ? { historicalOnly: true } : {}),
      createdAckMessageIds: ackIds,
      outboundRequestId,
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
    outboundRequestId,
    ingestedMeterValueId: ingestedMeterValue?.id ?? null,
    ingestedMeterValueIds,
    billingUnderlayId: billingUnderlay?.id ?? null,
  }
}

function legalReceiverUnresolved(error: unknown): boolean {
  if (!(error instanceof Error) || error.message !== 'ediel_source_rule_pack_basis_required') return false
  const cause = (error as { cause?: unknown }).cause as { message?: unknown } | undefined
  return typeof cause?.message === 'string' && cause.message.includes('ediel_inbound_legal_context_required')
}
