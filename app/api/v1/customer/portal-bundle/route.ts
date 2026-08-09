import { NextRequest } from 'next/server'
import { readJsonObject } from '@/lib/api/strictRequest'
import {
  loadPortalStatusSnapshot,
  readPortalBundlePages,
} from '@/lib/customer-portal/bundleReadModel'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  portalIdentifiersFromPayload,
  requireCustomerPortalApiContext,
  requireCustomerPortalApiContextForIdentifiers,
  type LinkedPortalIdentity,
} from '@/lib/customer-portal/externalApi'
import { publicPortalCustomer } from '@/lib/customer-portal/publicDto'
import { publicPortalIdentity } from '@/lib/customer-portal/publicIdentity'
import {
  buildPortalCustomerStatus,
  displayNameFromCustomer,
  hasContractPricePlan,
  removeFalsePricePlanBlockers,
} from '@/lib/customer-portal/status'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { startRouteTimer } from '@/lib/performance/timing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPTIONAL_SECTIONS = ['metering_values', 'documents', 'events', 'invoices', 'notifications'] as const
type OptionalSection = (typeof OPTIONAL_SECTIONS)[number]

type BundleOptions = {
  summary: boolean
  includedOptionalSections: Set<OptionalSection>
}

function parseBooleanFlag(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

function parseBundleOptions(request: NextRequest): BundleOptions {
  const params = request.nextUrl.searchParams
  const summary = parseBooleanFlag(params.get('summary'))
  const includeRaw = params.get('include')
  const includedOptionalSections = includeRaw && includeRaw.trim()
    ? new Set<OptionalSection>(
        OPTIONAL_SECTIONS.filter((section) =>
          new Set(
            includeRaw
              .split(',')
              .map((part) => part.trim().toLowerCase())
              .filter(Boolean),
          ).has(section),
        ),
      )
    : new Set<OptionalSection>(OPTIONAL_SECTIONS)

  return { summary, includedOptionalSections }
}

async function buildBundleResponse(input: {
  request: NextRequest
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
  startedAt: number
  accessMode: 'headers_or_query' | 'json_payload'
  options: BundleOptions
}) {
  const timer = startRouteTimer('/api/v1/customer/portal-bundle')
  try {
    const context = {
      companyId: input.client.company_id,
      customerId: input.identity.customer_id,
      externalCustomerId: input.identity.external_customer_id,
      customerNumber: input.identity.customer_number,
    }

    const [pages, statusSnapshot] = await Promise.all([
      readPortalBundlePages({
        context,
        searchParams: input.request.nextUrl.searchParams,
        includedOptionalSections: input.options.includedOptionalSections,
        summary: input.options.summary,
      }),
      loadPortalStatusSnapshot({
        companyId: input.client.company_id,
        customerId: input.identity.customer_id,
      }),
    ])

    const hasPricePlan =
      statusSnapshot.contracts.some(hasContractPricePlan) ||
      statusSnapshot.applications.some((application) => Boolean(
        application.price_plan_id ||
        application.price_plan_version_id ||
        application.contract_id ||
        (application.response_payload && typeof application.response_payload === 'object' && (
          (application.response_payload as Record<string, unknown>).price_plan_id ||
          (application.response_payload as Record<string, unknown>).price_plan_version_id ||
          (application.response_payload as Record<string, unknown>).offer_reference
        )),
      ))

    const statusContracts = statusSnapshot.contracts.map((row) =>
      removeFalsePricePlanBlockers(row, hasPricePlan),
    )
    const statusApplications = statusSnapshot.applications.map((row) =>
      removeFalsePricePlanBlockers(row, hasPricePlan),
    )
    const customerStatus = buildPortalCustomerStatus({
      customer: input.identity.customer,
      contracts: statusContracts,
      sites: statusSnapshot.sites,
      meteringPoints: statusSnapshot.meteringPoints,
      powersOfAttorney: statusSnapshot.powersOfAttorney,
      legalAcceptances: statusSnapshot.legalAcceptances,
      applications: statusApplications,
    })

    const displayName = displayNameFromCustomer(
      input.identity.customer,
      input.identity.email ?? null,
    )
    const publicCustomer = publicPortalCustomer(input.identity.customer, {
      external_customer_id: input.identity.external_customer_id,
      customer_number: input.identity.customer_number,
      email: input.identity.email,
    })
    const portalIdentity = publicPortalIdentity(
      input.client.company_id,
      input.identity,
    )

    const excludedSections = OPTIONAL_SECTIONS.filter(
      (section) => !input.options.includedOptionalSections.has(section),
    )

    await logCustomerPortalSuccess({
      request: input.request,
      client: input.client,
      startedAt: input.startedAt,
      resultCount: 1,
      metadata: {
        access_mode: input.accessMode,
        contracts: pages.contracts.items.length,
        sites: pages.sites.sites.length,
        invoices: pages.invoices?.items.length ?? 0,
        metering_points: pages.sites.meteringPoints.length,
        metering_values: pages.meteringValues?.items.length ?? 0,
        documents: pages.documents?.items.length ?? 0,
        legal_acceptances: pages.legalAcceptances.items.length,
        powers_of_attorney: pages.powersOfAttorney.items.length,
        notifications: pages.notifications?.items.length ?? 0,
        events: pages.events?.items.length ?? 0,
        website_applications: pages.applications.items.length,
        customer_status: customerStatus.code,
        summary_mode: input.options.summary,
        excluded_optional_sections: excludedSections,
      },
    })

    timer.stop({
      status: 200,
      count:
        pages.contracts.items.length +
        pages.sites.sites.length +
        pages.sites.meteringPoints.length +
        (pages.invoices?.items.length ?? 0),
      companyId: input.client.company_id,
      meta: { summary: input.options.summary },
    })

    return customerPortalJson({
      data: {
        customer: {
          ...publicCustomer,
          display_name: displayName,
          portal_identity: portalIdentity,
        },
        profile: {
          customer_reference: publicCustomer.customer_reference,
          customer_number: publicCustomer.customer_number,
          external_customer_id: publicCustomer.external_customer_id,
          display_name: displayName,
          email: publicCustomer.email,
          first_name: publicCustomer.first_name,
          last_name: publicCustomer.last_name,
          phone: publicCustomer.phone,
        },
        contracts: pages.contracts.items,
        sites: pages.sites.sites,
        metering_points: pages.sites.meteringPoints,
        invoices: pages.invoices?.items ?? [],
        metering_values: pages.meteringValues?.items ?? [],
        documents: pages.documents?.items ?? [],
        legal_acceptances: pages.legalAcceptances.items,
        powers_of_attorney: pages.powersOfAttorney.items,
        notifications: pages.notifications?.items ?? [],
        events: pages.events?.items ?? [],
        website_applications: pages.applications.items,
        customer_status: customerStatus,
        data_quality: {
          status:
            customerStatus.severity === 'success'
              ? 'complete'
              : customerStatus.severity === 'blocking'
                ? 'needs_action'
                : 'review',
          issues: customerStatus.issues,
          false_blockers_removed: hasPricePlan,
        },
        bundle_status: {
          status: 'complete',
          complete: true,
          excluded_sections: excludedSections,
          summary_mode: input.options.summary,
        },
      },
      page: pages.page,
    })
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: number }).status ?? 500)
      : 500
    timer.stop({ status, companyId: input.client.company_id })
    return handleCustomerPortalRouteError({
      request: input.request,
      client: input.client,
      startedAt: input.startedAt,
      error,
    })
  }
}

const BUNDLE_SCOPES = [
  'customer_profile.read',
  'customer_sites.read',
  'customer_contracts.read',
  'customer_invoices.read',
  'customer_metering.read',
  'customer_legal.read',
  'customer_events.read',
  'customer_documents.read',
  'customer_notifications.read',
  'customer_power_of_attorney.read',
] as const

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, [...BUNDLE_SCOPES])
  if (!context.ok) return context.response
  return buildBundleResponse({
    request,
    client: context.client,
    identity: context.identity,
    startedAt: context.startedAt,
    accessMode: 'headers_or_query',
    options: parseBundleOptions(request),
  })
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  let client: IntegrationApiClient | null = null

  try {
    const body = await readJsonObject(request)
    const context = await requireCustomerPortalApiContextForIdentifiers(
      request,
      portalIdentifiersFromPayload(body),
      [...BUNDLE_SCOPES],
    )
    if (!context.ok) return context.response
    client = context.client
    return buildBundleResponse({
      request,
      client: context.client,
      identity: context.identity,
      startedAt: context.startedAt,
      accessMode: 'json_payload',
      options: parseBundleOptions(request),
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client, startedAt, error })
  }
}
