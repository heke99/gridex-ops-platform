import { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import {
  isMissingSchemaError,
  listPortalContracts,
  listPortalDocuments,
  listPortalEvents,
  listPortalInvoices,
  listPortalLegalAcceptances,
  listPortalMeteringValues,
  listPortalNotifications,
  listPortalSites,
  portalContextFromResolved,
} from '@/lib/customer-portal/apiData'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function listMeteringPoints(companyId: string, sites: Array<Record<string, unknown>>) {
  const siteIds = sites.map((site) => String(site.id ?? '')).filter(Boolean)
  if (siteIds.length === 0) return []

  const { data, error } = await supabaseService
    .from('metering_points')
    .select('id,site_id,customer_site_id,metering_point_id,meter_point_id,ediel_metering_point_id,status,metering_type,measurement_type,reading_frequency,grid_owner_id,grid_area_code,price_area_code,start_date,end_date')
    .eq('company_id', companyId)
    .in('site_id', siteIds)

  if (error) {
    if (isMissingSchemaError(error)) return []
    throw error
  }
  return data ?? []
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

    const [contracts, sites, invoices, meteringValues, documents, legalAcceptances, notifications, events] = await Promise.all([
      listPortalContracts(portalContext, '/api/v1/customer/portal-bundle'),
      listPortalSites(portalContext, '/api/v1/customer/portal-bundle'),
      listPortalInvoices(portalContext, '/api/v1/customer/portal-bundle'),
      listPortalMeteringValues(portalContext, '/api/v1/customer/portal-bundle'),
      listPortalDocuments(portalContext, '/api/v1/customer/portal-bundle'),
      listPortalLegalAcceptances(portalContext, '/api/v1/customer/portal-bundle'),
      listPortalNotifications(portalContext, '/api/v1/customer/portal-bundle'),
      listPortalEvents(portalContext, '/api/v1/customer/portal-bundle'),
    ])
    const meteringPoints = await listMeteringPoints(context.client.company_id, sites as Array<Record<string, unknown>>)

    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: 1,
      metadata: {
        contracts: contracts.length,
        sites: sites.length,
        invoices: invoices.length,
        documents: documents.length,
        legal_acceptances: legalAcceptances.length,
        notifications: notifications.length,
        events: events.length,
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
        notifications,
        events,
      },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
