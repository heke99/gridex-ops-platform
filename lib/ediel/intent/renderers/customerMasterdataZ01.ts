import { getCustomerExportContext, requireContextCompanyId } from '@/lib/cis/db-shared'
import { buildDefaultApplicationReference } from '@/lib/ediel/config'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { isEdielPortalParty } from '@/lib/ediel/core/productionGuards'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { inferEdielFileName } from '@/lib/ediel/classify'
import { renderProdat } from '@/lib/ediel/prodatEngine'
import { computeOutboundAckDueAt, deriveEdielAckDefaults } from '@/lib/ediel/references'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'
import {
  resolveCustomerSiteProcessContext,
  resolveProdatCustomerProcessVariant,
} from '@/lib/customer-operations/customerSiteProcessContext'

type JsonRecord = Record<string, unknown>

type RouteContext = Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>

export type CustomerMasterdataZ01RenderRequest = {
  id: string
  company_id?: string | null
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  grid_owner_id: string | null
  authorization_document_id?: string | null
  external_reference?: string | null
  requested_at?: string | null
  request_scope?: string | null
  request_payload?: JsonRecord | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function sanitize(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n'+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function date102(value?: string | null): string | null {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(0, 8) : null
}

function customerIdentity(customer: JsonRecord | null | undefined): {
  id: string | null
  qualifier: string | null
  name: string
} {
  const id = sanitize(customer?.personal_number ?? customer?.org_number ?? customer?.customer_number ?? '') || null
  const name = sanitize(
    customer?.company_name ??
      customer?.full_name ??
      [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ??
      customer?.customer_number ??
      'Kund',
  ) || 'Kund'
  const qualifier = customer?.org_number ? '1' : id?.length === 10 ? 'SE1' : id ? 'SE2' : null
  return { id, qualifier, name }
}

function meterPointIdentifier(context: Awaited<ReturnType<typeof getCustomerExportContext>>): string | null {
  return clean(context.meteringPoint?.ediel_reference)
    ?? clean(context.meteringPoint?.meter_point_id)
    ?? clean(context.site?.normalized_facility_id)
    ?? clean(context.site?.facility_id)
}

function gridAreaIdentifier(
  context: Awaited<ReturnType<typeof getCustomerExportContext>>,
  gridOwner: JsonRecord | null,
): string | null {
  return clean(context.meteringPoint?.grid_area_code)
    ?? clean(context.site?.grid_area_code)
    ?? clean(gridOwner?.owner_code)
}

export async function buildCustomerMasterdataZ01Draft(input: {
  actorUserId: string
  routeContext: RouteContext
  dataRequest: CustomerMasterdataZ01RenderRequest
  gridOwner: JsonRecord | null
  externalReference: string
  transactionReference: string
  messageVersion: string
  operationId?: string | null
}): Promise<CreateEdielMessageInput> {
  if (!input.dataRequest.site_id) {
    throw new Error('z01_customer_masterdata_site_required')
  }

  const context = await getCustomerExportContext({
    customerId: input.dataRequest.customer_id,
    siteId: input.dataRequest.site_id,
    meteringPointId: input.dataRequest.metering_point_id,
  })
  const companyId = requireContextCompanyId(context, 'Bygg canonical PRODAT Z01')

  if (clean(input.dataRequest.company_id) && clean(input.dataRequest.company_id) !== companyId) {
    throw new Error('z01_customer_masterdata_tenant_mismatch')
  }

  const siteProcess = await resolveCustomerSiteProcessContext({
    companyId,
    customerId: input.dataRequest.customer_id,
    siteId: input.dataRequest.site_id,
    operationId: input.operationId ?? null,
  })
  const variant = resolveProdatCustomerProcessVariant(siteProcess.processType)
  if (!variant.supported || !variant.z01Variant || !variant.z01Reason || !variant.expectedZ02Variant) {
    throw new Error(variant.blockerCode ?? 'z01_process_variant_not_resolved')
  }

  const customer = customerIdentity((context.customer ?? null) as unknown as JsonRecord | null)
  const meterPointId = meterPointIdentifier(context)
  if (!meterPointId) {
    throw new Error('PRODAT Z01 kan inte byggas utan anläggnings-id/mätpunkt.')
  }

  const isTgt = isEdielPortalParty(input.routeContext.receiverEdielId)
  const senderSubAddress = isTgt ? 'PRODAT' : input.routeContext.senderSubAddress
  const receiverSubAddress = isTgt ? 'PRODAT' : input.routeContext.receiverSubAddress
  const applicationReference = input.routeContext.applicationReference
    ?? buildDefaultApplicationReference({ actorSubAddress: senderSubAddress, process: 'PRODAT' })
  const messageVersionToken = input.messageVersion === '26A' ? 'E2SE6A' : input.messageVersion

  const rendered = renderProdat({
    code: 'Z01',
    variant: variant.z01Variant,
    mode: 'production',
    actor: {
      senderEdielId: input.routeContext.senderEdielId,
      receiverEdielId: input.routeContext.receiverEdielId,
    },
    route: {
      senderSubAddress,
      receiverSubAddress,
      applicationReference,
      communicationRouteId: input.routeContext.route.id,
      receiverEmail: input.routeContext.receiverEmail,
      mailbox: input.routeContext.mailbox,
      routeDecisionReason: 'canonical_customer_site_process',
    },
    version: {
      selectedVersion: input.messageVersion,
      messageTypeToken: `PRODAT:D:97A:UN:${messageVersionToken}`,
      acceptedVersions: ['26A', 'E2SE6A'],
    },
    context: {
      code: 'Z01',
      bgmReference: input.externalReference,
      transactionReference: input.transactionReference,
      senderEdielId: input.routeContext.senderEdielId,
      receiverEdielId: input.routeContext.receiverEdielId,
      customerName: customer.name,
      customerId: customer.id,
      customerIdCodeListQualifier: customer.qualifier,
      meterPointId,
      gridAreaId: gridAreaIdentifier(context, input.gridOwner),
      startDate:
        date102(siteProcess.requestedStartDate)
        ?? date102(context.site?.move_in_date)
        ?? date102(input.dataRequest.requested_at),
      customerAddress: context.site?.street ?? null,
      customerPostalCode: context.site?.postal_code ?? null,
      customerCity: context.site?.city ?? null,
      customerCountry: context.site?.country ?? 'SE',
      siteAddress: context.site?.street ?? null,
      sitePostalCode: context.site?.postal_code ?? null,
      siteCity: context.site?.city ?? null,
      siteCountry: context.site?.country ?? 'SE',
      reasonForTransaction: variant.z01Reason,
      powerOfAttorneyReference: input.dataRequest.external_reference ?? input.externalReference,
    },
  })

  const envelope = buildEdifactEnvelope({
    senderEdielId: input.routeContext.senderEdielId,
    senderSubAddress,
    receiverEdielId: input.routeContext.receiverEdielId,
    receiverSubAddress,
    applicationReference,
    testFlag: input.routeContext.environment === 'production' ? 0 : 1,
    messageTypeToken: `PRODAT:D:97A:UN:${messageVersionToken}`,
    segments: rendered.segments,
  })
  const ack = deriveEdielAckDefaults({ family: 'PRODAT', code: 'Z01' })

  return {
    actorUserId: input.actorUserId,
    companyId,
    direction: 'outbound',
    messageStandard: 'edifact',
    messageFamily: 'PRODAT',
    messageCode: 'Z01',
    messageVersion: input.messageVersion,
    processType: 'customer_masterdata_request',
    environment: input.routeContext.environment,
    testFlag: input.routeContext.environment === 'production' ? 0 : 1,
    status: 'draft',
    transportType: 'smtp',
    mailbox: input.routeContext.mailbox,
    senderEdielId: input.routeContext.senderEdielId,
    senderName: input.routeContext.senderName,
    receiverEdielId: input.routeContext.receiverEdielId,
    receiverName: input.routeContext.receiverName,
    senderSubAddress,
    receiverSubAddress,
    receiverEmail: input.routeContext.receiverEmail,
    subject: `PRODAT Z01${variant.z01Variant} ${input.externalReference}`,
    fileName: inferEdielFileName({ family: 'PRODAT', code: 'Z01', direction: 'outbound', extension: 'edi' }),
    mimeType: 'application/edifact',
    interchangeReference: envelope.interchangeReference,
    applicationReference,
    externalReference: input.externalReference,
    transactionReference: input.transactionReference,
    communicationRouteId: input.routeContext.route.id,
    gridOwnerDataRequestId: input.dataRequest.id,
    customerId: input.dataRequest.customer_id,
    siteId: input.dataRequest.site_id,
    meteringPointId: input.dataRequest.metering_point_id,
    gridOwnerId: input.dataRequest.grid_owner_id,
    rawPayload: envelope.raw,
    parsedPayload: {
      draftType: 'prodat_customer_masterdata_outbound',
      processLabel: 'customer_masterdata_request',
      prodatCode: 'Z01',
      prodatVariant: variant.z01Variant,
      reasonForTransaction: variant.z01Reason,
      expectedZ02Variant: variant.expectedZ02Variant,
      canonicalProcessType: siteProcess.processType,
      gridOwnerDataRequestId: input.dataRequest.id,
      requestScope: input.dataRequest.request_scope ?? null,
      customerId: input.dataRequest.customer_id,
      siteId: input.dataRequest.site_id,
      meteringPointId: input.dataRequest.metering_point_id,
      gridOwnerId: input.dataRequest.grid_owner_id,
      meterPointId,
      gridOwnerEdielId: clean(input.gridOwner?.ediel_id),
      gridOwnerOwnerCode: clean(input.gridOwner?.owner_code),
      authorization_document_id: input.dataRequest.authorization_document_id ?? null,
      power_of_attorney_id: clean(input.dataRequest.request_payload?.power_of_attorney_id),
      operation_id: input.operationId ?? null,
      prodatEngine: rendered.diagnostics,
      prodatAckExpectation: rendered.ackExpectation ?? null,
    },
    validationReport: {
      status: rendered.issues.some((issue) => issue.severity === 'error') ? 'blocked' : 'ready',
      checkedAt: new Date().toISOString(),
      canonicalProcessType: siteProcess.processType,
      prodatVariant: variant.z01Variant,
      expectedZ02Variant: variant.expectedZ02Variant,
      prodatEngine: rendered.diagnostics,
      prodatAckExpectation: rendered.ackExpectation ?? null,
      engineIssues: rendered.issues,
      payloadPreflight: envelope.payloadPreflight,
    },
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
}
