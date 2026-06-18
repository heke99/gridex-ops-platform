import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import type { LinkedPortalIdentity } from '@/lib/customer-portal/externalApi'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  portalIdentifiersFromPayload,
  requireCustomerPortalApiContext,
  requireCustomerPortalApiContextForIdentifiers,
} from '@/lib/customer-portal/externalApi'
import {
  listPortalContracts,
  listPortalDocuments,
  listPortalEvents,
  listPortalInvoices,
  listPortalLegalAcceptances,
  listPortalMeteringPoints,
  listPortalMeteringValues,
  listPortalNotifications,
  listPortalPowersOfAttorney,
  listPortalSites,
  listPortalWebsiteApplications,
  portalContextFromResolved,
  portalQueryErrorMetadata,
} from '@/lib/customer-portal/apiData'
import {
  buildPortalCustomerStatus,
  displayNameFromCustomer,
  hasContractPricePlan,
  removeFalsePricePlanBlockers,
} from '@/lib/customer-portal/status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PortalRows = Array<Record<string, unknown>>
type BundleSection =
  | 'contracts'
  | 'sites'
  | 'metering_points'
  | 'invoices'
  | 'metering_values'
  | 'documents'
  | 'legal_acceptances'
  | 'powers_of_attorney'
  | 'notifications'
  | 'events'
  | 'website_applications'

type BundleWarning = {
  section: BundleSection
  code: 'section_unavailable'
  message: string
  trace_id: string
}

function safeWarning(section: BundleSection, error: unknown): BundleWarning {
  const traceId = randomUUID()
  // Keep provider/schema details in server logs only; the portal response must
  // never reveal table names, SQL errors or internal integration endpoints.
  console.error('[customer portal bundle] section failed', {
    traceId,
    section,
    error: portalQueryErrorMetadata(error),
  })
  return {
    section,
    code: 'section_unavailable',
    message: 'Den här delen av kunduppgifterna kunde inte hämtas just nu.',
    trace_id: traceId,
  }
}

async function optionalSection(
  section: BundleSection,
  read: () => Promise<PortalRows>,
  warnings: BundleWarning[]
): Promise<PortalRows> {
  try {
    return await read()
  } catch (error) {
    warnings.push(safeWarning(section, error))
    return []
  }
}

async function buildBundleResponse(input: {
  request: NextRequest
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
  startedAt: number
  accessMode: 'headers_or_query' | 'json_payload'
}) {
  try {
    const portalContext = portalContextFromResolved({
      companyId: input.client.company_id,
      customerId: input.identity.customer_id,
      externalCustomerId: input.identity.external_customer_id,
      customerNumber: input.identity.customer_number,
      provider: input.identity.provider,
    })
    const route = '/api/v1/customer/portal-bundle'
    const warnings: BundleWarning[] = []

    const [rawContracts, sites, invoices, meteringValues, documents, legalAcceptances, powersOfAttorney, notifications, events, rawWebsiteApplications] = await Promise.all([
      optionalSection('contracts', () => listPortalContracts(portalContext, route), warnings),
      optionalSection('sites', () => listPortalSites(portalContext, route), warnings),
      optionalSection('invoices', () => listPortalInvoices(portalContext, route), warnings),
      optionalSection('metering_values', () => listPortalMeteringValues(portalContext, route), warnings),
      optionalSection('documents', () => listPortalDocuments(portalContext, route), warnings),
      optionalSection('legal_acceptances', () => listPortalLegalAcceptances(portalContext, route), warnings),
      optionalSection('powers_of_attorney', () => listPortalPowersOfAttorney(portalContext, route), warnings),
      optionalSection('notifications', () => listPortalNotifications(portalContext, route), warnings),
      optionalSection('events', () => listPortalEvents(portalContext, route), warnings),
      optionalSection('website_applications', () => listPortalWebsiteApplications(portalContext, route), warnings),
    ])
    const meteringPoints = await optionalSection(
      'metering_points',
      () => listPortalMeteringPoints(portalContext, sites, route),
      warnings
    )
    const hasPricePlan = rawContracts.some(hasContractPricePlan) || rawWebsiteApplications.some((application) => {
      const response = application.response_payload && typeof application.response_payload === 'object'
        ? application.response_payload as Record<string, unknown>
        : null
      return Boolean(
        response?.price_plan_id ||
        response?.price_plan_version_id ||
        response?.offer_reference ||
        application.contract_id
      )
    })
    const contracts = rawContracts.map((contract) => removeFalsePricePlanBlockers(contract, hasPricePlan))
    const websiteApplications = rawWebsiteApplications.map((application) => removeFalsePricePlanBlockers(application, hasPricePlan))
    const customerStatus = buildPortalCustomerStatus({
      customer: input.identity.customer,
      contracts,
      sites,
      meteringPoints,
      powersOfAttorney,
      legalAcceptances,
      applications: websiteApplications,
    })
    const displayName = displayNameFromCustomer(input.identity.customer, input.identity.email ?? null)

    await logCustomerPortalSuccess({
      request: input.request,
      client: input.client,
      startedAt: input.startedAt,
      resultCount: 1,
      metadata: {
        access_mode: input.accessMode,
        contracts: contracts.length,
        sites: sites.length,
        invoices: invoices.length,
        metering_points: meteringPoints.length,
        metering_values: meteringValues.length,
        documents: documents.length,
        legal_acceptances: legalAcceptances.length,
        powers_of_attorney: powersOfAttorney.length,
        notifications: notifications.length,
        events: events.length,
        partial_bundle: warnings.length > 0,
        customer_status: customerStatus.code,
        data_quality_issues: customerStatus.issues,
        failed_sections: warnings.map((warning) => warning.section),
        section_errors: warnings,
      },
    })

    return customerPortalJson({
      data: {
        customer: {
          ...input.identity.customer,
          customer_id: input.identity.customer_id,
          external_customer_id: input.identity.external_customer_id,
          customer_number: input.identity.customer_number ?? input.identity.customer.customer_number ?? null,
          email: input.identity.email ?? input.identity.customer.email ?? null,
          display_name: displayName,
          portal_identity: {
            id: input.identity.id,
            external_customer_id: input.identity.external_customer_id,
            customer_number: input.identity.customer_number,
            auth_user_id: input.identity.auth_user_id,
            customer_portal_user_id: input.identity.customer_portal_user_id,
            match_strength: input.identity.match_strength,
            match_method: input.identity.match_method,
            provider: input.identity.provider,
          },
        },
        profile: {
          customer_id: input.identity.customer_id,
          customer_number: input.identity.customer_number ?? input.identity.customer.customer_number ?? null,
          external_customer_id: input.identity.external_customer_id,
          display_name: displayName,
          email: input.identity.email ?? input.identity.customer.email ?? null,
          full_name: input.identity.customer.full_name ?? displayName,
          first_name: input.identity.customer.first_name ?? null,
          last_name: input.identity.customer.last_name ?? null,
          phone: input.identity.customer.phone ?? null,
        },
        contracts,
        sites,
        metering_points: meteringPoints,
        invoices,
        metering_values: meteringValues,
        documents,
        legal_acceptances: legalAcceptances,
        powers_of_attorney: powersOfAttorney,
        powersOfAttorney,
        notifications,
        events,
        website_applications: websiteApplications,
        customer_status: customerStatus,
        data_quality: {
          status: customerStatus.severity === 'success' ? 'complete' : customerStatus.severity === 'blocking' ? 'needs_action' : 'review',
          issues: customerStatus.issues,
          false_blockers_removed: hasPricePlan,
        },
        bundle_status: {
          status: warnings.length > 0 ? 'partial' : 'complete',
          unavailable_sections: warnings.map((warning) => warning.section),
        },
      },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request: input.request, client: input.client, startedAt: input.startedAt, error })
  }
}

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.read'])
  if (!context.ok) return context.response
  return buildBundleResponse({
    request,
    client: context.client,
    identity: context.identity,
    startedAt: context.startedAt,
    accessMode: 'headers_or_query',
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const context = await requireCustomerPortalApiContextForIdentifiers(request, portalIdentifiersFromPayload(body), ['customer_portal.read'])
  if (!context.ok) return context.response
  return buildBundleResponse({
    request,
    client: context.client,
    identity: context.identity,
    startedAt: context.startedAt,
    accessMode: 'json_payload',
  })
}
