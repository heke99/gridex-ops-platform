// lib/ediel/flows/prodatCustomerMasterdata.ts

import { getGridOwnerById } from '@/lib/masterdata/db'
import type { GridOwnerRow } from '@/lib/masterdata/types'
import { supabaseService } from '@/lib/supabase/service'
import { getCustomerExportContext, requireContextCompanyId } from '@/lib/cis/db-shared'
import type { GridOwnerDataRequestRow, OutboundRequestRow } from '@/lib/cis/types'
import { updateGridOwnerDataRequestStatus } from '@/lib/cis/db-data'
import { linkEdielMessage } from '@/lib/ediel/db'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { isEdielPortalParty } from '@/lib/ediel/core/productionGuards'
import { resolveDecisionBackedOutboundContext, RouteDecisionBlockedError } from '@/lib/ediel/flows/routeDecisionContext'
import type { CreateEdielMessageInput, EdielEnvironment, EdielMessageRow } from '@/lib/ediel/types'
import { buildDefaultApplicationReference } from '@/lib/ediel/config'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { inferEdielFileName } from '@/lib/ediel/classify'
import {
  makeCustomerOperationBlocker,
  routeIssueCodeToCustomerBlocker,
  type CustomerOperationBlocker,
} from '@/lib/customer-operations/blockers'
import { buildCanonicalOutboundReferences } from '@/lib/ediel/core/referenceRegistry'
import { materializePlatformActorRoute } from '@/lib/ediel/routeMaterializer'
import { resolveCustomerInfoOperationEnvironment } from '@/lib/ediel/customerInfoEnvironmentResolver'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import { computeOutboundAckDueAt, deriveEdielAckDefaults } from '@/lib/ediel/references'
import { renderProdat26A } from '@/lib/ediel/prodatEngine'
import {
  ensureActorUserId,
  finalizeOutboundDraft,
  findOrCreateDataRequestOutbound,
  getGridOwnerDataRequestById,
  makeServerClient,
  queuePreparedEdielMessage,
  resolveOutboundRuntimeEnvironment,
} from '@/lib/ediel/flows/shared'

type RouteContext = Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>

type PrepareResult = {
  dataRequest: GridOwnerDataRequestRow
  outbound: OutboundRequestRow
  message: EdielMessageRow | null
  prepared: boolean
  blockerReason: string | null
  blockerCode: string | null
  blockerDetails: (CustomerOperationBlocker & {
    route_resolution_status?: string | null
    platform_actor_route_id?: string | null
    communication_route_id?: string | null
    ediel_route_profile_id?: string | null
    company_market_party_route_id?: string | null
    sender_settings_id?: string | null
    production_send_lock_status?: string | null
  }) | null
}

function sanitize(value?: string | null): string {
  return (value ?? '').replace(/[\r\n'+]/g, ' ').replace(/\s+/g, ' ').trim()
}

function shortProdatTimestamp(): string {
  const now = new Date()
  const year = String(now.getFullYear()).slice(-2)
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  return `${year}${month}${day}${hour}${minute}`
}

function randomToken(length = 3): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < length; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

function compactReference(value: string | null | undefined, fallbackPrefix: string, maxLength: number): string {
  const cleaned = sanitize(value).toUpperCase().replace(/[^A-Z0-9_.\/-]/g, '')
  if (cleaned) return cleaned.slice(0, maxLength)
  return `${fallbackPrefix}${shortProdatTimestamp()}${randomToken(3)}`.slice(0, maxLength)
}

function date102(value?: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(0, 8) : null
}

function normalizeCustomerIdentity(customer: Awaited<ReturnType<typeof getCustomerExportContext>>['customer']) {
  const customerId = sanitize(customer?.personal_number ?? customer?.org_number ?? customer?.customer_number ?? null)
  const qualifier = customer?.org_number
    ? '1'
    : customerId.length === 10
      ? 'SE1'
      : 'SE2'

  const customerName = sanitize(
    customer?.company_name ??
      customer?.full_name ??
      [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ??
      customer?.customer_number ??
      'Kund'
  ) || 'Kund'

  return {
    customerId: customerId || null,
    qualifier,
    customerName,
  }
}

function resolveMeterPointId(context: Awaited<ReturnType<typeof getCustomerExportContext>>): string {
  return sanitize(
    context.meteringPoint?.ediel_reference ??
      context.meteringPoint?.meter_point_id ??
      context.site?.facility_id ??
      ''
  )
}

function resolveGridAreaId(context: Awaited<ReturnType<typeof getCustomerExportContext>>, gridOwner: GridOwnerRow | null): string | null {
  // Grid area and bidding/price area are different market concepts.
  // PRODAT fields that ask for grid area must use e.g. LKA, not SE4.
  return sanitize(
    context.meteringPoint?.grid_area_code ??
      context.site?.grid_area_code ??
      gridOwner?.owner_code ??
      null
  ) || null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function findVerifiedPlatformActorRoute(input: {
  actorId?: string | null
  messageFamily: string
  environment: EdielEnvironment
}): Promise<string | null> {
  if (!input.actorId) return null
  const { data, error } = await supabaseService
    .from('platform_actor_routes')
    .select('id')
    .eq('actor_id', input.actorId)
    .eq('message_family', input.messageFamily)
    .eq('environment', input.environment)
    .eq('status', 'active')
    .eq('is_verified', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    const code = (error as { code?: string }).code ?? ''
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)) return null
    throw error
  }
  return text((data as { id?: string } | null)?.id)
}

async function findCompanyMarketPartyRoute(input: {
  companyId?: string | null
  actorId?: string | null
  messageFamily: string
}): Promise<string | null> {
  if (!input.companyId || !input.actorId) return null
  const { data, error } = await supabaseService
    .from('company_market_party_routes')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('market_party_id', input.actorId)
    .eq('message_family', input.messageFamily)
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    const code = (error as { code?: string }).code ?? ''
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)) return null
    throw error
  }
  return text((data as { id?: string } | null)?.id)
}

function buildProdatZ01Draft(params: {
  actorUserId: string
  routeContext: RouteContext
  dataRequest: GridOwnerDataRequestRow
  gridOwner: GridOwnerRow | null
  externalReference: string
  transactionReference: string
  messageVersion: string
}): Promise<CreateEdielMessageInput> {
  return (async () => {
    const context = await getCustomerExportContext({
      customerId: params.dataRequest.customer_id,
      siteId: params.dataRequest.site_id,
      meteringPointId: params.dataRequest.metering_point_id,
    })
    const companyId = requireContextCompanyId(context, 'Bygg PRODAT Z01')
    const customer = normalizeCustomerIdentity(context.customer)
    const meterPointId = resolveMeterPointId(context)
    if (!meterPointId) {
      throw new Error('PRODAT Z01 kan inte byggas utan anläggnings-id/mätpunkt.')
    }

    const messageVersionToken = params.messageVersion === '26A' ? 'E2SE6A' : params.messageVersion
    const isEdielPortalTgt = isEdielPortalParty(params.routeContext.receiverEdielId)
    const senderSubAddress = isEdielPortalTgt
      ? 'PRODAT'
      : params.routeContext.senderSubAddress
    const receiverSubAddress = isEdielPortalTgt
      ? 'PRODAT'
      : params.routeContext.receiverSubAddress
    const applicationReference = params.routeContext.applicationReference ??
      buildDefaultApplicationReference({
        actorSubAddress: senderSubAddress,
        process: 'PRODAT',
      })

    const rendered = renderProdat26A({
      context: {
        code: 'Z01',
        bgmReference: params.externalReference,
        transactionReference: params.transactionReference,
        senderEdielId: params.routeContext.senderEdielId,
        receiverEdielId: params.routeContext.receiverEdielId,
        customerName: customer.customerName,
        customerId: customer.customerId,
        customerIdCodeListQualifier: customer.qualifier,
        meterPointId,
        gridAreaId: resolveGridAreaId(context, params.gridOwner),
        startDate: date102(context.site?.move_in_date) ?? date102(params.dataRequest.requested_at),
        customerAddress: context.site?.street ?? null,
        customerPostalCode: context.site?.postal_code ?? null,
        customerCity: context.site?.city ?? null,
        customerCountry: context.site?.country ?? 'SE',
        siteAddress: context.site?.street ?? null,
        sitePostalCode: context.site?.postal_code ?? null,
        siteCity: context.site?.city ?? null,
        siteCountry: context.site?.country ?? 'SE',
        reasonForTransaction: 'Z22',
        powerOfAttorneyReference: params.dataRequest.external_reference ?? params.externalReference,
      },
    })

    const envelope = buildEdifactEnvelope({
      senderEdielId: params.routeContext.senderEdielId,
      senderSubAddress,
      receiverEdielId: params.routeContext.receiverEdielId,
      receiverSubAddress,
      applicationReference,
      testFlag: params.routeContext.environment === 'production' ? 0 : 1,
      messageTypeToken: `PRODAT:D:97A:UN:${messageVersionToken}`,
      segments: rendered.segments,
    })

    const ack = deriveEdielAckDefaults({ family: 'PRODAT', code: 'Z01' })
    const validationReport = {
      status: rendered.issues.some((issue) => issue.severity === 'error') ? 'warning' : 'ready',
      checkedAt: new Date().toISOString(),
      prodatEngine: rendered.diagnostics,
      prodatAckExpectation: rendered.ackExpectation ?? null,
      engineIssues: rendered.issues,
      payloadPreflight: envelope.payloadPreflight,
    }

    return {
      actorUserId: params.actorUserId,
      companyId,
      direction: 'outbound',
      messageStandard: 'edifact',
      messageFamily: 'PRODAT',
      messageCode: 'Z01',
      messageVersion: params.messageVersion,
      processType: 'customer_masterdata_request',
      environment: params.routeContext.environment,
      testFlag: params.routeContext.environment === 'production' ? 0 : 1,
      status: 'draft',
      transportType: 'smtp',
      mailbox: params.routeContext.mailbox,
      senderEdielId: params.routeContext.senderEdielId,
      senderName: params.routeContext.senderName,
      receiverEdielId: params.routeContext.receiverEdielId,
      receiverName: params.routeContext.receiverName,
      senderSubAddress,
      receiverSubAddress,
      receiverEmail: params.routeContext.receiverEmail,
      subject: `PRODAT Z01 ${params.externalReference}`,
      fileName: inferEdielFileName({
        family: 'PRODAT',
        code: 'Z01',
        direction: 'outbound',
        extension: 'edi',
      }),
      mimeType: 'application/edifact',
      interchangeReference: envelope.interchangeReference,
      applicationReference,
      externalReference: params.externalReference,
      transactionReference: params.transactionReference,
      communicationRouteId: params.routeContext.route.id,
      gridOwnerDataRequestId: params.dataRequest.id,
      customerId: params.dataRequest.customer_id,
      siteId: params.dataRequest.site_id,
      meteringPointId: params.dataRequest.metering_point_id,
      gridOwnerId: params.dataRequest.grid_owner_id,
      rawPayload: envelope.raw,
      parsedPayload: {
        draftType: 'prodat_customer_masterdata_outbound',
        processLabel: 'customer_masterdata_request',
        prodatCode: 'Z01',
        expectedResponse: 'CONTRL/APERAK och därefter PRODAT Z02 eller negativ APERAK',
        gridOwnerDataRequestId: params.dataRequest.id,
        requestScope: params.dataRequest.request_scope,
        customerId: params.dataRequest.customer_id,
        siteId: params.dataRequest.site_id,
        meteringPointId: params.dataRequest.metering_point_id,
        gridOwnerId: params.dataRequest.grid_owner_id,
        meterPointId,
        gridOwnerEdielId: params.gridOwner?.ediel_id ?? null,
        gridOwnerOwnerCode: params.gridOwner?.owner_code ?? null,
        prodatEngine: rendered.diagnostics,
        prodatAckExpectation: rendered.ackExpectation ?? null,
      },
      validationReport,
      requiresContrl: ack.requiresContrl,
      requiresAperak: ack.requiresAperak,
      contrlStatus: ack.contrlStatus,
      aperakStatus: ack.aperakStatus,
      utiltsErrStatus: ack.utiltsErrStatus,
      ackDueAt: computeOutboundAckDueAt({
        requiresContrl: ack.requiresContrl,
        requiresAperak: ack.requiresAperak,
        contrlStatus: ack.contrlStatus,
        aperakStatus: ack.aperakStatus,
        utiltsErrStatus: ack.utiltsErrStatus,
      }),
      syntaxCheckStatus: 'not_checked',
      functionalCheckStatus: 'not_checked',
    }
  })()
}

export async function prepareAndQueueProdatZ01FromDataRequest(params: {
  actorUserId: string
  gridOwnerDataRequestId: string
  communicationRouteId?: string | null
  environment?: EdielEnvironment | null
}): Promise<PrepareResult> {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const supabase = await makeServerClient()
  const dataRequest = await getGridOwnerDataRequestById(params.gridOwnerDataRequestId)

  if (!dataRequest) throw new Error('Nätägarbegäran hittades inte.')
  if (dataRequest.request_scope !== 'customer_masterdata') {
    throw new Error('PRODAT Z01 kan bara byggas från en customer_masterdata-begäran.')
  }

  const gridOwner = dataRequest.grid_owner_id
    ? await getGridOwnerById(supabase, dataRequest.grid_owner_id)
    : null
  const actorId = gridOwner?.platform_market_actor_id ?? null

  let requestedEnvironment = params.environment ?? null
  let environmentEvidence: Record<string, unknown> = {}
  if (!requestedEnvironment && !params.communicationRouteId) {
    if (!dataRequest.company_id) {
      const outbound = await findOrCreateDataRequestOutbound({
        actorUserId,
        requestType: 'customer_masterdata',
        communicationRouteId: null,
        dataRequest,
        payload: {
          edielCode: 'Z01',
          queuedFrom: 'prepare_prodat_z01_customer_masterdata',
          requestScope: dataRequest.request_scope,
          blockerCode: 'operational_route_missing',
        },
      })
      const blocker = makeCustomerOperationBlocker('operational_route_missing', {
        blocker_reason: 'Bolagskoppling saknas på nätägarbegäran.',
        next_required_action: 'Koppla begäran till rätt bolag innan EDIFACT förbereds.',
      })
      return {
        dataRequest,
        outbound,
        message: null,
        prepared: false,
        blockerReason: blocker.blocker_reason,
        blockerCode: blocker.blocker_code,
        blockerDetails: { ...blocker, route_resolution_status: 'company_missing' },
      }
    }
    const environmentResolution = await resolveCustomerInfoOperationEnvironment({
      companyId: dataRequest.company_id,
      messageFamily: 'PRODAT',
      messageCode: 'Z01',
    })
    if (environmentResolution.status === 'blocked') {
      const outbound = await findOrCreateDataRequestOutbound({
        actorUserId,
        requestType: 'customer_masterdata',
        communicationRouteId: null,
        dataRequest,
        payload: {
          edielCode: 'Z01',
          queuedFrom: 'prepare_prodat_z01_customer_masterdata',
          requestScope: dataRequest.request_scope,
          expectedResponse: 'PRODAT Z02 eller negativ APERAK',
          blockerCode: environmentResolution.blocker.blocker_code,
          environmentResolution: environmentResolution.evidence,
        },
      })
      const blockerDetails = {
        ...environmentResolution.blocker,
        environment_evidence: environmentResolution.evidence,
        sender_settings_id: environmentResolution.actorSettingId,
        ediel_route_profile_id: environmentResolution.routeProfileId,
        production_send_lock_status: environmentResolution.productionSendLockStatus,
      }
      return {
        dataRequest,
        outbound,
        message: null,
        prepared: false,
        blockerReason: environmentResolution.blocker.blocker_reason,
        blockerCode: String(environmentResolution.blocker.blocker_code),
        blockerDetails,
      }
    }
    requestedEnvironment = environmentResolution.environment
    environmentEvidence = environmentResolution.evidence
  }
  const materializationEnvironment = requestedEnvironment ?? null
  const platformActorRouteId = await findVerifiedPlatformActorRoute({
    actorId,
    messageFamily: 'PRODAT',
    environment: materializationEnvironment ?? 'test',
  })
  const materializedRoute = !params.communicationRouteId && platformActorRouteId
    ? (await materializePlatformActorRoute({ platformActorRouteId, actorUserId }))
        .find((row) => row.companyId === dataRequest.company_id && row.status === 'materialized' && row.communicationRouteId)
    : null

  const outbound = await findOrCreateDataRequestOutbound({
    actorUserId,
    requestType: 'customer_masterdata',
    communicationRouteId: params.communicationRouteId ?? materializedRoute?.communicationRouteId ?? null,
    dataRequest,
    payload: {
      edielCode: 'Z01',
      queuedFrom: 'prepare_prodat_z01_customer_masterdata',
      requestScope: dataRequest.request_scope,
      expectedResponse: 'PRODAT Z02 eller negativ APERAK',
      platformActorRouteId,
      materializedRouteProfileId: materializedRoute?.edielRouteProfileId ?? null,
    },
  })

  if (!outbound.communication_route_id) {
    const blocker = makeCustomerOperationBlocker(
      platformActorRouteId
        ? 'platform_route_exists_but_not_materialized'
        : 'operational_route_missing',
      {
        blocker_reason: platformActorRouteId
          ? 'Nätägaren är verifierad i aktörsregistret, men operativ route saknas.'
          : 'Saknar aktiv customer_masterdata-route för nätägaren. Lägg till route innan PRODAT Z01 kan skickas.',
      },
    )
    const blockerDetails = {
      ...blocker,
      route_resolution_status: 'missing_operational_route',
      platform_actor_route_id: platformActorRouteId,
      communication_route_id: null,
      ediel_route_profile_id: null,
      company_market_party_route_id: await findCompanyMarketPartyRoute({
        companyId: dataRequest.company_id ?? null,
        actorId,
        messageFamily: 'PRODAT',
      }),
      sender_settings_id: null,
      production_send_lock_status: null,
    }
    await updateGridOwnerDataRequestStatus({
      actorUserId,
      requestId: dataRequest.id,
      status: 'pending',
      externalReference: outbound.external_reference ?? dataRequest.external_reference,
      responsePayload: {
        ...(dataRequest.response_payload ?? {}),
        outboundRequestId: outbound.id,
        prodatCode: 'Z01',
        blockedReason: blocker.blocker_reason,
        blockerCode: blocker.blocker_code,
        blockerDetails,
      },
      notes: blocker.blocker_reason,
    })

    return {
      dataRequest,
      outbound,
      message: null,
      prepared: false,
      blockerReason: blocker.blocker_reason,
      blockerCode: blocker.blocker_code,
      blockerDetails,
    }
  }

  const environment = await resolveOutboundRuntimeEnvironment({
    preferredRouteId: outbound.communication_route_id,
    explicitEnvironment: params.environment ?? null,
  })
  let routeContext: Awaited<ReturnType<typeof resolveDecisionBackedOutboundContext>>
  try {
    routeContext = await resolveDecisionBackedOutboundContext({
      requestType: 'customer_masterdata',
      gridOwner,
      preferredRouteId: outbound.communication_route_id,
      companyId: dataRequest.company_id ?? null,
      customerId: dataRequest.customer_id,
      siteId: dataRequest.site_id,
      meteringPointId: dataRequest.metering_point_id,
      dataRequestId: dataRequest.id,
      outboundRequestId: outbound.id,
      environment,
      messageFamily: 'PRODAT',
      messageCode: 'Z01',
      messageStandard: 'edifact',
      actorUserId,
      payload: {
        requestScope: dataRequest.request_scope,
      },
    })
  } catch (error) {
    if (!(error instanceof RouteDecisionBlockedError)) throw error
    const firstIssue = error.decision.blockingReasons[0]
    const blocker = makeCustomerOperationBlocker(
      routeIssueCodeToCustomerBlocker(firstIssue?.code),
      {
        blocker_reason: firstIssue?.message ?? 'Ediel-route blockerades av route engine.',
        next_required_action:
          error.decision.requiredAdminActions[0] ??
          makeCustomerOperationBlocker(routeIssueCodeToCustomerBlocker(firstIssue?.code)).next_required_action,
      },
    )
    const evidence = asRecord(asRecord(error.decision.payload).route_decision_evidence)
    const blockerDetails = {
      ...blocker,
      route_resolution_status: error.decision.decisionStatus,
      platform_actor_route_id: await findVerifiedPlatformActorRoute({
        actorId,
        messageFamily: 'PRODAT',
        environment,
      }),
      communication_route_id: error.decision.communicationRouteId ?? outbound.communication_route_id,
      ediel_route_profile_id: error.decision.edielRouteProfileId,
      company_market_party_route_id: await findCompanyMarketPartyRoute({
        companyId: dataRequest.company_id ?? null,
        actorId,
        messageFamily: 'PRODAT',
      }),
      sender_settings_id: text(evidence.sender_settings_id),
      production_send_lock_status: text(evidence.production_send_lock_status),
    }
    await updateGridOwnerDataRequestStatus({
      actorUserId,
      requestId: dataRequest.id,
      status: 'pending',
      externalReference: outbound.external_reference ?? dataRequest.external_reference,
      responsePayload: {
        ...(dataRequest.response_payload ?? {}),
        outboundRequestId: outbound.id,
        prodatCode: 'Z01',
        blockedReason: blocker.blocker_reason,
        blockerCode: blocker.blocker_code,
        blockerDetails,
        routeDecision: error.decision,
      },
      notes: blocker.blocker_reason,
    })
    return {
      dataRequest,
      outbound,
      message: null,
      prepared: false,
      blockerReason: blocker.blocker_reason,
      blockerCode: blocker.blocker_code,
      blockerDetails,
    }
  }

  const refs = buildCanonicalOutboundReferences({
    family: 'PRODAT',
    code: 'Z01',
    relatedMessageId: dataRequest.id,
    preferredExternalReference: outbound.external_reference ?? dataRequest.external_reference ?? null,
    preferredTransactionReference: dataRequest.external_reference ?? outbound.external_reference ?? null,
  })
  const externalReference = compactReference(refs.externalReference ?? dataRequest.external_reference, 'Z01', 20)
  const transactionReference = compactReference(refs.transactionReference ?? dataRequest.external_reference, 'LIZ01', 25)
  const messageVersion =
    (await resolveCanonicalOutboundVersion({
      family: 'PRODAT',
      code: 'Z01',
      fallback: '26A',
      standard: 'edifact',
      routeDefaultMessageVersion: routeContext.defaultMessageVersion ?? null,
      environment: routeContext.environment,
    })) ?? '26A'

  const draft = await buildProdatZ01Draft({
    actorUserId,
    routeContext,
    dataRequest,
    gridOwner,
    externalReference,
    transactionReference,
    messageVersion,
  })

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: 'customer_masterdata',
    routeContext,
    draft,
    outboundRequestId: outbound.id,
    duplicateCheck: {
      sourceType: 'grid_owner_data_request',
      sourceId: dataRequest.id,
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: 'PRODAT',
      messageCode: 'Z01',
      messageVersion,
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
    externalReference,
    payload: {
      edielCode: 'Z01',
      routeId: routeContext.route.id,
      gridOwnerDataRequestId: dataRequest.id,
      messageFamily: 'PRODAT',
      messageCode: 'Z01',
      messageVersion,
    },
  })

  await updateGridOwnerDataRequestStatus({
    actorUserId,
    requestId: dataRequest.id,
    status: 'pending',
    externalReference,
    responsePayload: {
      ...(dataRequest.response_payload ?? {}),
      outboundRequestId: outbound.id,
      edielMessageId: message.id,
      prodatCode: 'Z01',
      expectedResponse: 'CONTRL/APERAK och därefter PRODAT Z02 eller negativ APERAK',
      routeId: routeContext.route.id,
    },
    notes: dataRequest.notes,
  })

  return {
    dataRequest,
    outbound,
    message,
    prepared: true,
    blockerReason: null,
    blockerCode: null,
    blockerDetails: null,
  }
}
