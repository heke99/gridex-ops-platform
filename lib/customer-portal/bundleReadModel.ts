import { ApiInputError } from '@/lib/api/strictRequest'
import { isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'
import { readPortalDocumentsPage } from '@/lib/customer-portal/documentReadModel'
import { readPortalEventsPage } from '@/lib/customer-portal/eventReadModel'
import {
  descendingKeysetFilter,
  finalizeKeysetPage,
  keysetPageInput,
  type KeysetPage,
} from '@/lib/customer-portal/keysetPagination'
import {
  readPortalContractsPage,
  readPortalInvoicesPage,
  readPortalLegalAcceptancesPage,
  readPortalMeteringValuesPage,
  readPortalNotificationsPage,
  readPortalPowersOfAttorneyPage,
  readPortalSitesPage,
  type PortalPublicReadContext,
} from '@/lib/customer-portal/publicReadModel'
import { publicPortalApplication } from '@/lib/customer-portal/publicDto'
import { supabaseService } from '@/lib/supabase/service'

type Row = Record<string, unknown>

export type PortalStatusSnapshot = {
  contracts: Row[]
  sites: Row[]
  meteringPoints: Row[]
  powersOfAttorney: Row[]
  legalAcceptances: Row[]
  applications: Row[]
}

export type PortalBundleSectionPage = KeysetPage & {
  included: boolean
}

function schemaNotReady(error: unknown): never {
  if (isMissingPortalSchemaError(error)) {
    throw new ApiInputError(
      'Kundportalens datamodell är inte komplett för bundle-operationen.',
      'platform_schema_not_ready',
      503,
    )
  }
  throw error
}

function resultRows(result: { data: unknown; error: unknown }): Row[] {
  if (result.error) schemaNotReady(result.error)
  return Array.isArray(result.data) ? result.data as Row[] : []
}

/**
 * Status computation is deliberately separate from response pagination.
 * Only the small set of columns needed by buildPortalCustomerStatus is read,
 * but the customer-level query is not capped, so an older active contract or
 * legal acceptance cannot disappear merely because the response page is full.
 */
export async function loadPortalStatusSnapshot(input: {
  companyId: string
  customerId: string
}): Promise<PortalStatusSnapshot> {
  const [contractsResult, sitesResult, meteringResult, powerResult, legalResult, applicationResult] = await Promise.all([
    supabaseService
      .from('customer_contracts')
      .select('id,status,contract_name,contract_type,price_plan_id,price_plan_version_id,contract_price_snapshot_id,contract_offer_id,metering_point_id,metadata,created_at')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .order('created_at', { ascending: false }),
    supabaseService
      .from('customer_sites')
      .select('id,facility_id,normalized_facility_id,grid_owner_id,grid_owner_ediel_id,resolution_status,created_at')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .order('created_at', { ascending: false }),
    supabaseService
      .from('metering_points')
      .select('id,meter_point_id,metering_point_id,ediel_metering_point_id,site_facility_id,grid_owner_id,grid_owner_ediel_id,created_at')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .order('created_at', { ascending: false }),
    supabaseService
      .from('powers_of_attorney')
      .select('id,status,scope,created_at')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .order('created_at', { ascending: false }),
    supabaseService
      .from('customer_legal_acceptances')
      .select('id,acceptance_type,accepted_at,created_at')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .order('accepted_at', { ascending: false }),
    supabaseService
      .from('website_customer_applications')
      .select('id,status,facility_data_verified_at,contract_id,price_plan_id,price_plan_version_id,payload,response_payload,created_at')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .order('created_at', { ascending: false }),
  ])

  return {
    contracts: resultRows(contractsResult),
    sites: resultRows(sitesResult),
    meteringPoints: resultRows(meteringResult),
    powersOfAttorney: resultRows(powerResult),
    legalAcceptances: resultRows(legalResult),
    applications: resultRows(applicationResult),
  }
}

const APPLICATION_PUBLIC_SELECT = [
  'id',
  'customer_site_id',
  'contract_id',
  'status',
  'grid_area_code',
  'price_area_code',
  'resolution_status',
  'facility_data_verified_at',
  'created_at',
  'updated_at',
].join(',')

export async function readPortalApplicationsPage(
  context: PortalPublicReadContext,
  searchParams: URLSearchParams,
): Promise<{ items: Row[]; page: KeysetPage }> {
  const pageInput = keysetPageInput(searchParams)
  let query = supabaseService
    .from('website_customer_applications')
    .select(APPLICATION_PUBLIC_SELECT)
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageInput.limit + 1)

  if (pageInput.cursor) {
    query = query.or(descendingKeysetFilter('created_at', pageInput.cursor))
  }

  const { data, error } = await query
  if (error) schemaNotReady(error)
  return finalizeKeysetPage({
    rows: (data ?? []) as Row[],
    limit: pageInput.limit,
    sortColumn: 'created_at',
    map: (row) => publicPortalApplication(context.companyId, row),
  })
}

function sectionParams(input: {
  source: URLSearchParams
  section: string
  defaultLimit: number
  legacyLimitParam?: string
}): URLSearchParams {
  const params = new URLSearchParams()
  const cursor = input.source.get(`${input.section}_cursor`)
  const explicitLimit = input.source.get(`${input.section}_limit`)
  const legacyLimit = input.legacyLimitParam
    ? input.source.get(input.legacyLimitParam)
    : null
  params.set('limit', explicitLimit ?? legacyLimit ?? String(input.defaultLimit))
  if (cursor) params.set('cursor', cursor)
  return params
}

function excludedPage(limit: number): PortalBundleSectionPage {
  return {
    included: false,
    limit,
    returned: 0,
    has_more: false,
    next_cursor: null,
  }
}

export async function readPortalBundlePages(input: {
  context: PortalPublicReadContext
  searchParams: URLSearchParams
  includedOptionalSections: Set<'metering_values' | 'documents' | 'events' | 'invoices' | 'notifications'>
  summary: boolean
}): Promise<{
  contracts: Awaited<ReturnType<typeof readPortalContractsPage>>
  sites: Awaited<ReturnType<typeof readPortalSitesPage>>
  invoices: Awaited<ReturnType<typeof readPortalInvoicesPage>> | null
  meteringValues: Awaited<ReturnType<typeof readPortalMeteringValuesPage>> | null
  documents: Awaited<ReturnType<typeof readPortalDocumentsPage>> | null
  legalAcceptances: Awaited<ReturnType<typeof readPortalLegalAcceptancesPage>>
  powersOfAttorney: Awaited<ReturnType<typeof readPortalPowersOfAttorneyPage>>
  notifications: Awaited<ReturnType<typeof readPortalNotificationsPage>> | null
  events: Awaited<ReturnType<typeof readPortalEventsPage>> | null
  applications: Awaited<ReturnType<typeof readPortalApplicationsPage>>
  page: Record<string, PortalBundleSectionPage>
}> {
  const defaultLimit = input.summary ? 30 : 50
  const context = input.context
  const params = input.searchParams
  const include = input.includedOptionalSections

  const contractParams = sectionParams({ source: params, section: 'contracts', defaultLimit })
  const siteParams = sectionParams({ source: params, section: 'sites', defaultLimit })
  const invoiceParams = sectionParams({ source: params, section: 'invoices', defaultLimit })
  const meteringParams = sectionParams({ source: params, section: 'metering_values', defaultLimit, legacyLimitParam: 'metering_values_limit' })
  const documentParams = sectionParams({ source: params, section: 'documents', defaultLimit, legacyLimitParam: 'documents_limit' })
  const legalParams = sectionParams({ source: params, section: 'legal_acceptances', defaultLimit })
  const powerParams = sectionParams({ source: params, section: 'powers_of_attorney', defaultLimit })
  const notificationParams = sectionParams({ source: params, section: 'notifications', defaultLimit })
  const eventParams = sectionParams({ source: params, section: 'events', defaultLimit, legacyLimitParam: 'events_limit' })
  const applicationParams = sectionParams({ source: params, section: 'website_applications', defaultLimit })

  const [contracts, sites, invoices, meteringValues, documents, legalAcceptances, powersOfAttorney, notifications, events, applications] = await Promise.all([
    readPortalContractsPage(context, contractParams),
    readPortalSitesPage(context, siteParams),
    include.has('invoices') ? readPortalInvoicesPage(context, invoiceParams) : Promise.resolve(null),
    include.has('metering_values') ? readPortalMeteringValuesPage(context, meteringParams) : Promise.resolve(null),
    include.has('documents') ? readPortalDocumentsPage({ companyId: context.companyId, customerId: context.customerId, searchParams: documentParams }) : Promise.resolve(null),
    readPortalLegalAcceptancesPage(context, legalParams),
    readPortalPowersOfAttorneyPage(context, powerParams),
    include.has('notifications') ? readPortalNotificationsPage(context, notificationParams) : Promise.resolve(null),
    include.has('events') ? readPortalEventsPage({ companyId: context.companyId, customerId: context.customerId, searchParams: eventParams }) : Promise.resolve(null),
    readPortalApplicationsPage(context, applicationParams),
  ])

  return {
    contracts,
    sites,
    invoices,
    meteringValues,
    documents,
    legalAcceptances,
    powersOfAttorney,
    notifications,
    events,
    applications,
    page: {
      contracts: { included: true, ...contracts.page },
      sites: { included: true, ...sites.page },
      invoices: invoices ? { included: true, ...invoices.page } : excludedPage(Number(invoiceParams.get('limit'))),
      metering_values: meteringValues ? { included: true, ...meteringValues.page } : excludedPage(Number(meteringParams.get('limit'))),
      documents: documents ? { included: true, ...documents.page } : excludedPage(Number(documentParams.get('limit'))),
      legal_acceptances: { included: true, ...legalAcceptances.page },
      powers_of_attorney: { included: true, ...powersOfAttorney.page },
      notifications: notifications ? { included: true, ...notifications.page } : excludedPage(Number(notificationParams.get('limit'))),
      events: events ? { included: true, ...events.page } : excludedPage(Number(eventParams.get('limit'))),
      website_applications: { included: true, ...applications.page },
      metering_points: {
        included: true,
        limit: sites.meteringPoints.length,
        returned: sites.meteringPoints.length,
        has_more: sites.page.has_more,
        next_cursor: sites.page.next_cursor,
      },
    },
  }
}
