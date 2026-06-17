import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
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
  portalContextFromResolved,
  portalQueryErrorMetadata,
} from '@/lib/customer-portal/apiData'

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

type BundleWarning = {
  section: BundleSection
  code: unknown
  message: unknown
  details: unknown
  hint: unknown
}

function safeWarning(section: BundleSection, error: unknown): BundleWarning {
  const meta = portalQueryErrorMetadata(error)
  return {
    section,
    code: meta.code,
    message: meta.message,
    details: meta.details,
    hint: meta.hint,
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
    const warning = safeWarning(section, error)
    warnings.push(warning)
    console.error('[customer portal bundle] section failed', warning)
    return []
  }
}

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.read'])
  if (!context.ok) return context.response

  try {
    const portalContext = portalContextFromResolved({
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      externalCustomerId: context.identity.external_customer_id,
      customerNumber: context.identity.customer_number,
      provider: context.identity.provider,
    })
    const route = '/api/v1/customer/portal-bundle'
    const warnings: BundleWarning[] = []

    const [contracts, sites, invoices, meteringValues, documents, legalAcceptances, powersOfAttorney, notifications, events] = await Promise.all([
      optionalSection('contracts', () => listPortalContracts(portalContext, route), warnings),
      optionalSection('sites', () => listPortalSites(portalContext, route), warnings),
      optionalSection('invoices', () => listPortalInvoices(portalContext, route), warnings),
      optionalSection('metering_values', () => listPortalMeteringValues(portalContext, route), warnings),
      optionalSection('documents', () => listPortalDocuments(portalContext, route), warnings),
      optionalSection('legal_acceptances', () => listPortalLegalAcceptances(portalContext, route), warnings),
      optionalSection('powers_of_attorney', () => listPortalPowersOfAttorney(portalContext, route), warnings),
      optionalSection('notifications', () => listPortalNotifications(portalContext, route), warnings),
      optionalSection('events', () => listPortalEvents(portalContext, route), warnings),
    ])
    const meteringPoints = await optionalSection(
      'metering_points',
      () => listPortalMeteringPoints(portalContext, sites, route),
      warnings
    )

    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: 1,
      metadata: {
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
        failed_sections: warnings.map((warning) => warning.section),
        section_errors: warnings,
      },
    })

    return customerPortalJson({
      data: {
        customer: {
          ...context.identity.customer,
          customer_id: context.identity.customer_id,
          external_customer_id: context.identity.external_customer_id,
          customer_number: context.identity.customer_number ?? context.identity.customer.customer_number ?? null,
          email: context.identity.email ?? context.identity.customer.email ?? null,
          portal_identity: {
            id: context.identity.id,
            external_customer_id: context.identity.external_customer_id,
            customer_number: context.identity.customer_number,
            auth_user_id: context.identity.auth_user_id,
            customer_portal_user_id: context.identity.customer_portal_user_id,
            match_strength: context.identity.match_strength,
            match_method: context.identity.match_method,
            provider: context.identity.provider,
          },
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
        bundle_status: {
          status: warnings.length > 0 ? 'partial' : 'complete',
          unavailable_sections: warnings.map((warning) => warning.section),
        },
      },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
