// lib/ediel/flows/prodatSwitch.ts
//
// Supplier-switch domain flow. A SupplierSwitchRequest may originate PRODAT
// Z03 only. Grid-owner-originated Z04/Z05/Z06/Z10 are inbound messages, while
// Z09 and Z13/Z18 require their own masterdata/permission domain entities.
// Keeping those codes out of this flow prevents a switch row from being reused
// as a generic EDIFACT payload container.

import { getGridOwnerById, getMeteringPointById, getCustomerSiteById } from '@/lib/masterdata/db'
import { createSupplierSwitchEvent, getSupplierSwitchRequestById } from '@/lib/operations/db'
import { buildProdatZ03FromSwitch } from '@/lib/ediel/prodat'
import { linkEdielMessage } from '@/lib/ediel/db'
import { resolveAuthorizationDocumentIdForPowerOfAttorney } from '@/lib/legal/authorizationChain'
import { isEdielPortalParty } from '@/lib/ediel/core/productionGuards'
import { resolveDecisionBackedOutboundContext } from '@/lib/ediel/flows/routeDecisionContext'
import { createEdielMessageIntent } from '@/lib/ediel/intent/intentEngine'
import { resolveCanonicalRulePack } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import type { EdielEnvironment } from '@/lib/ediel/types'
import {
  ensureActorUserId,
  finalizeOutboundDraft,
  findOrCreateSwitchOutbound,
  makeServerClient,
  queuePreparedEdielMessage,
} from '@/lib/ediel/flows/shared'
import { supabaseService } from '@/lib/supabase/service'

export type ProdatSwitchCode = 'Z03' | 'Z04' | 'Z05' | 'Z06' | 'Z09' | 'Z10' | 'Z13' | 'Z14' | 'Z15' | 'Z18'

type PrepareProdatSwitchParams = {
  actorUserId: string
  switchRequestId: string
  communicationRouteId?: string | null
  environment?: EdielEnvironment
  forceRegenerate?: boolean
}

function stockholmDate(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function normalizeSwitchSubtype(switchRequest: {
  status?: string | null
  request_type?: string | null
  prodat_variant?: string | null
  prodat_reason?: string | null
}): 'L' | 'LK' | 'C' {
  const explicit = String(switchRequest.prodat_variant ?? '').trim().toUpperCase()
  const reason = String(switchRequest.prodat_reason ?? '').trim().toUpperCase()
  if (explicit === 'C' || reason === 'Z24' || String(switchRequest.status ?? '').toLowerCase() === 'cancellation_requested') return 'C'
  if (explicit === 'LK' || reason === 'Z23' || String(switchRequest.request_type ?? '').toLowerCase() === 'move_in') return 'LK'
  return 'L'
}

function reasonForSubtype(subtype: 'L' | 'LK' | 'C'): 'Z22' | 'Z23' | 'Z24' {
  if (subtype === 'LK') return 'Z23'
  if (subtype === 'C') return 'Z24'
  return 'Z22'
}

function defaultExternalReference(switchRequestId: string): string {
  return `SWITCH-${switchRequestId}`
}

function makeTgtRetryReference(switchRequestId: string): string {
  const compact = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const random = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `TGT-Z03-${switchRequestId.slice(0, 8).toUpperCase()}-${compact}-${random}`
}

async function loadSwitchContext(switchRequestId: string) {
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

  return { supabase, switchRequest, site, meteringPoint, gridOwner }
}

function blockedSwitchFlowCode(code: Exclude<ProdatSwitchCode, 'Z03'>): never {
  const inboundOnly = ['Z04', 'Z05', 'Z06', 'Z10', 'Z14', 'Z15'].includes(code)
  if (inboundOnly) {
    throw new Error(
      `PRODAT ${code} är inbound för Gridex i aktuell marknadsroll och får inte skapas från ett supplier_switch-ärende.`,
    )
  }
  throw new Error(
    `PRODAT ${code} får inte skapas från ett supplier_switch-ärende. Använd dedikerad ${code === 'Z09' ? 'masterdata' : 'metering_permission'}-process.`,
  )
}

export async function prepareAndQueueProdatSwitch(params: PrepareProdatSwitchParams & {
  messageCode: ProdatSwitchCode
}) {
  if (params.messageCode !== 'Z03') return blockedSwitchFlowCode(params.messageCode)

  const actorUserId = ensureActorUserId(params.actorUserId)
  const { supabase, switchRequest, site, meteringPoint, gridOwner } = await loadSwitchContext(params.switchRequestId)
  const companyId = switchRequest.company_id ?? site.company_id ?? null
  if (!companyId) throw new Error('PRODAT Z03 stoppades: switchärendet och anläggningen saknar company_id.')

  const contractId =
    switchRequest.customer_contract_id
    ?? switchRequest.contract_id
    ?? (typeof switchRequest.metadata?.contract_id === 'string' ? switchRequest.metadata.contract_id : null)
  if (!contractId) throw new Error('PRODAT Z03 stoppades: switchärendet saknar exakt customer_contract_id.')

  const switchGate = await supabaseService.rpc('gridex_assert_supplier_switch_ready', {
    p_company_id: companyId,
    p_contract_id: contractId,
  })
  if (switchGate.error) {
    throw new Error(`PRODAT Z03 stoppades av canonical switch-gate: ${switchGate.error.message}`)
  }

  const subtype = normalizeSwitchSubtype(switchRequest)
  const reasonForTransaction = reasonForSubtype(subtype)
  const canonicalRule = await resolveCanonicalRulePack({
    family: 'PRODAT',
    messageCode: 'Z03',
    transactionSubtype: subtype,
    direction: 'outbound',
    businessDate: stockholmDate(),
    requireBuilder: true,
    requireStateMachine: true,
  })

  const routeContext = await resolveDecisionBackedOutboundContext({
    requestType: 'supplier_switch',
    gridOwner,
    preferredRouteId: params.communicationRouteId ?? null,
    companyId,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    supplierSwitchRequestId: switchRequest.id,
    environment: params.environment ?? 'test',
    messageFamily: 'PRODAT',
    messageCode: 'Z03',
    messageStandard: 'edifact',
    actorUserId,
    payload: {
      requestType: switchRequest.request_type,
      cancellation_requested: subtype === 'C',
      move_in: subtype === 'LK',
      transactionSubtype: subtype,
      reasonForTransaction,
      canonicalRulePackId: canonicalRule.rulePackId,
      canonicalProfileId: canonicalRule.messageProfileId,
      actorRole: 'supplier',
    },
  })

  const forceCreateNewAttempt = Boolean(params.forceRegenerate) && isEdielPortalParty(routeContext.receiverEdielId)
  const externalReference = forceCreateNewAttempt
    ? makeTgtRetryReference(switchRequest.id)
    : switchRequest.external_reference ?? defaultExternalReference(switchRequest.id)

  const authorizationDocumentId =
    switchRequest.authorization_document_id
    ?? (switchRequest.power_of_attorney_id
      ? await resolveAuthorizationDocumentIdForPowerOfAttorney({
          companyId,
          powerOfAttorneyId: switchRequest.power_of_attorney_id,
        }).catch(() => null)
      : null)

  const outbound = await findOrCreateSwitchOutbound({
    actorUserId,
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
    externalReference,
    forceCreateNewAttempt,
    payload: {
      edielCode: 'Z03',
      transactionSubtype: subtype,
      reasonForTransaction,
      queuedFrom: 'prepare_switch_z03',
      requestType: switchRequest.request_type,
      requestedStartDate: switchRequest.requested_start_date,
      communicationRouteId: routeContext.route.id,
      authorization_document_id: authorizationDocumentId,
      power_of_attorney_id: switchRequest.power_of_attorney_id ?? null,
      canonical_rule_pack_id: canonicalRule.rulePackId,
      canonical_message_profile_id: canonicalRule.messageProfileId,
      forceRegenerate: Boolean(params.forceRegenerate),
      forceCreateNewAttempt,
    },
  })

  const draft = await buildProdatZ03FromSwitch({
    actorUserId,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    receiverEmail: routeContext.receiverEmail,
    senderSubAddress: routeContext.senderSubAddress,
    receiverSubAddress: routeContext.receiverSubAddress,
    communicationRouteId: routeContext.route.id,
    mailbox: routeContext.mailbox,
    routeDefaultMessageVersion: routeContext.defaultMessageVersion,
    applicationReference: routeContext.applicationReference,
    environment: routeContext.environment,
    switchRequest,
    site,
    meteringPoint,
    gridOwner,
    externalReference,
  })

  draft.parsedPayload = {
    ...(draft.parsedPayload ?? {}),
    prodatVariant: subtype,
    reasonForTransaction,
    authorization_document_id: authorizationDocumentId,
    power_of_attorney_id: switchRequest.power_of_attorney_id ?? null,
    canonical_rule_pack_id: canonicalRule.rulePackId,
    canonical_message_profile_id: canonicalRule.messageProfileId,
    canonical_profile_key: canonicalRule.profileKey,
  }

  const meteringPointIdentifier = String(meteringPoint.ediel_reference || meteringPoint.meter_point_id || '').trim() || null
  const siteRecord = site as unknown as Record<string, unknown>
  const facilityIdentifier = String(siteRecord.normalized_facility_id ?? siteRecord.facility_id ?? '').trim() || null

  const intent = await createEdielMessageIntent({
    actorUserId,
    companyId,
    environment: routeContext.environment,
    market: 'electricity',
    messageFamily: 'PRODAT',
    messageCode: 'Z03',
    businessProcess: 'supplier_switch',
    direction: 'outbound',
    senderEdielId: routeContext.senderEdielId,
    senderSubaddress: routeContext.senderSubAddress ?? null,
    receiverEdielId: routeContext.receiverEdielId,
    receiverSubaddress: routeContext.receiverSubAddress ?? null,
    applicationReference: routeContext.applicationReference ?? '',
    routeProfileId: routeContext.routeDecision.edielRouteProfileId ?? '',
    communicationRouteId: routeContext.route.id,
    customerId: switchRequest.customer_id,
    customerSiteId: switchRequest.site_id,
    supplierSwitchRequestId: switchRequest.id,
    facilityId: facilityIdentifier,
    meteringPointId: meteringPointIdentifier,
    gridAreaCode: String(site.grid_area_code ?? gridOwner?.owner_code ?? '').trim() || null,
    requestedEffectiveDate: switchRequest.requested_start_date ?? null,
    interchangeReference: externalReference,
    messageReference: externalReference,
    transactionReference: draft.transactionReference ?? externalReference,
    expectedRuleVersion: `${canonicalRule.guideVersion}:r${canonicalRule.guideRevision}`,
    expectedFieldMatrixVersion: canonicalRule.fieldMatrixVersion,
    idempotencyKey: `prodat-Z03:${subtype}:${switchRequest.id}:${externalReference}`,
    payload: {
      edielCode: 'Z03',
      transactionSubtype: subtype,
      reasonForTransaction,
      requestType: switchRequest.request_type,
      actorRole: 'supplier',
      authorization_document_id: authorizationDocumentId,
      power_of_attorney_id: switchRequest.power_of_attorney_id ?? null,
      canonical_rule_pack_id: canonicalRule.rulePackId,
      canonical_message_profile_id: canonicalRule.messageProfileId,
      canonical_profile_key: canonicalRule.profileKey,
      forceRegenerate: Boolean(params.forceRegenerate),
    },
  })
  draft.intentId = intent.id

  if (intent.validationStatus === 'blocked') {
    const firstBlocker = intent.blockingReasons?.[0]
    throw new Error(
      `Ediel-intent för Z03 blockerades före rendering: ${firstBlocker?.message ?? firstBlocker?.code ?? 'intent-validering misslyckades'}`,
    )
  }

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'supplier_switch',
    routeContext,
    draft,
    outboundRequestId: outbound.id,
    duplicateCheck: {
      sourceType: 'supplier_switch_request',
      sourceId: switchRequest.id,
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: draft.messageFamily,
      messageCode: String(draft.messageCode),
      messageVersion: draft.messageVersion ?? null,
    },
  })

  await linkEdielMessage({
    actorUserId,
    edielMessageId: message.id,
    outboundRequestId: outbound.id,
    switchRequestId: switchRequest.id,
    customerId: switchRequest.customer_id,
    siteId: switchRequest.site_id,
    meteringPointId: switchRequest.metering_point_id,
    gridOwnerId: switchRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  })

  await queuePreparedEdielMessage({
    actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference,
    intentId: intent.id,
    payload: {
      edielCode: 'Z03',
      transactionSubtype: subtype,
      reasonForTransaction,
      routeId: routeContext.route.id,
      intentId: intent.id,
      messageFamily: draft.messageFamily,
      messageCode: draft.messageCode,
      messageVersion: draft.messageVersion ?? null,
      canonical_rule_pack_id: canonicalRule.rulePackId,
      canonical_message_profile_id: canonicalRule.messageProfileId,
    },
  })

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: switchRequest.id,
    eventType: 'ediel_prepared',
    eventStatus: 'queued',
    message: `Ediel PRODAT Z03${subtype} förberett via canonical 26.A rule pack.`,
    payload: {
      edielMessageId: message.id,
      outboundRequestId: outbound.id,
      routeId: routeContext.route.id,
      edielCode: 'Z03',
      transactionSubtype: subtype,
      reasonForTransaction,
      messageVersion: draft.messageVersion ?? null,
      canonicalRulePackId: canonicalRule.rulePackId,
      canonicalMessageProfileId: canonicalRule.messageProfileId,
    },
  })

  return message
}

export async function prepareAndQueueEdielZ03(params: PrepareProdatSwitchParams) {
  return prepareAndQueueProdatSwitch({ ...params, messageCode: 'Z03' })
}

export async function prepareAndQueueEdielZ04(_params: PrepareProdatSwitchParams) {
  return blockedSwitchFlowCode('Z04')
}
export async function prepareAndQueueEdielZ05(_params: PrepareProdatSwitchParams) {
  return blockedSwitchFlowCode('Z05')
}
export async function prepareAndQueueEdielZ06(_params: PrepareProdatSwitchParams) {
  return blockedSwitchFlowCode('Z06')
}
export async function prepareAndQueueEdielZ09(_params: PrepareProdatSwitchParams) {
  return blockedSwitchFlowCode('Z09')
}
export async function prepareAndQueueEdielZ10(_params: PrepareProdatSwitchParams) {
  return blockedSwitchFlowCode('Z10')
}
export async function prepareAndQueueEdielZ13(_params: PrepareProdatSwitchParams) {
  return blockedSwitchFlowCode('Z13')
}
export async function prepareAndQueueEdielZ14(_params: PrepareProdatSwitchParams) {
  return blockedSwitchFlowCode('Z14')
}
export async function prepareAndQueueEdielZ15(_params: PrepareProdatSwitchParams) {
  return blockedSwitchFlowCode('Z15')
}
export async function prepareAndQueueEdielZ18(_params: PrepareProdatSwitchParams) {
  return blockedSwitchFlowCode('Z18')
}
