import { supabaseService } from '@/lib/supabase/service'
import type {
  CommunicationRouteRow,
  GridOwnerDataRequestRow,
  OutboundRequestRow,
} from '@/lib/cis/types'
import { getContractLifecycleSummary } from '@/lib/customer-contracts/lifecycle'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { CustomerContactRow, CustomerRow } from '@/types/customers'

export function normalizeQuery(value?: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

export function matchesQuery(
  values: Array<string | null | undefined>,
  query: string
): boolean {
  if (!query) return true

  return values
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query)
}

export function buildBatchKey(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${prefix}_${stamp}`
}

export function mergeJsonObjects(
  base?: Record<string, unknown> | null,
  extra?: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    ...(base ?? {}),
    ...(extra ?? {}),
  }
}

export function findPostgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const maybeCode = (error as { code?: unknown }).code
  return typeof maybeCode === 'string' ? maybeCode : null
}

export async function getGridOwnerDataRequestByAutomationKey(
  automationKey: string
): Promise<GridOwnerDataRequestRow | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('automation_key', automationKey)
    .maybeSingle()

  if (error) throw error
  return (data as GridOwnerDataRequestRow | null) ?? null
}

export async function getOutboundRequestByAutomationKey(
  automationKey: string
): Promise<OutboundRequestRow | null> {
  const { data, error } = await supabaseService
    .from('outbound_requests')
    .select('*')
    .eq('automation_key', automationKey)
    .maybeSingle()

  if (error) throw error
  return (data as OutboundRequestRow | null) ?? null
}

type CustomerExportContext = {
  customer: CustomerRow | null
  contacts: CustomerContactRow[]
  site: CustomerSiteRow | null
  meteringPoint: MeteringPointRow | null
  contract: CustomerContractRow | null
}

function preferPrimaryContact(contacts: CustomerContactRow[]): CustomerContactRow | null {
  if (contacts.length === 0) return null

  return (
    contacts.find((row) => row.is_primary) ??
    contacts.find((row) => row.type === 'primary') ??
    contacts.find((row) => Boolean(row.email || row.phone || row.name)) ??
    contacts[0] ??
    null
  )
}

async function getCustomerRow(customerId: string): Promise<CustomerRow | null> {
  const { data, error } = await supabaseService
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle()

  if (error) throw error
  return (data as CustomerRow | null) ?? null
}

async function getCustomerContacts(customerId: string): Promise<CustomerContactRow[]> {
  const { data, error } = await supabaseService
    .from('customer_contacts')
    .select('*')
    .eq('customer_id', customerId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw error
  return (data ?? []) as CustomerContactRow[]
}

async function getSite(siteId?: string | null): Promise<CustomerSiteRow | null> {
  if (!siteId) return null

  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('*')
    .eq('id', siteId)
    .maybeSingle()

  if (error) throw error
  return (data as CustomerSiteRow | null) ?? null
}

async function getMeteringPoint(
  meteringPointId?: string | null
): Promise<MeteringPointRow | null> {
  if (!meteringPointId) return null

  const { data, error } = await supabaseService
    .from('metering_points')
    .select('*')
    .eq('id', meteringPointId)
    .maybeSingle()

  if (error) throw error
  return (data as MeteringPointRow | null) ?? null
}

async function getLatestContract(params: {
  customerId: string
  siteId?: string | null
}): Promise<CustomerContractRow | null> {
  if (params.siteId) {
    const { data, error } = await supabaseService
      .from('customer_contracts')
      .select('*')
      .eq('customer_id', params.customerId)
      .eq('site_id', params.siteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (data) return data as CustomerContractRow
  }

  const { data, error } = await supabaseService
    .from('customer_contracts')
    .select('*')
    .eq('customer_id', params.customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as CustomerContractRow | null) ?? null
}

export async function getCustomerExportContext(params: {
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
}): Promise<CustomerExportContext> {
  const [customer, contacts, site, meteringPoint, contract] = await Promise.all([
    getCustomerRow(params.customerId),
    getCustomerContacts(params.customerId),
    getSite(params.siteId),
    getMeteringPoint(params.meteringPointId),
    getLatestContract({
      customerId: params.customerId,
      siteId: params.siteId ?? null,
    }),
  ])

  return {
    customer,
    contacts,
    site,
    meteringPoint,
    contract,
  }
}

export function buildCustomerIdentityPayload(
  context: CustomerExportContext
): Record<string, unknown> {
  const customer = context.customer
  const primaryContact = preferPrimaryContact(context.contacts)

  return {
    customer: customer
      ? {
          id: customer.id,
          customer_type: customer.customer_type ?? null,
          status: customer.status ?? null,
          customer_number: customer.customer_number ?? null,
          first_name: customer.first_name ?? null,
          last_name: customer.last_name ?? null,
          full_name:
            customer.full_name ??
            ([customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
              customer.company_name ||
              null),
          company_name: customer.company_name ?? null,
          personal_number: customer.personal_number ?? null,
          org_number: customer.org_number ?? null,
          email: customer.email ?? primaryContact?.email ?? null,
          phone: customer.phone ?? primaryContact?.phone ?? null,
          apartment_number: customer.apartment_number ?? null,
          preferred_language: customer.preferred_language ?? null,
        }
      : null,
    primary_contact: primaryContact
      ? {
          id: primaryContact.id,
          type: primaryContact.type,
          name: primaryContact.name ?? null,
          email: primaryContact.email ?? null,
          phone: primaryContact.phone ?? null,
          title: primaryContact.title ?? null,
          is_primary: primaryContact.is_primary,
        }
      : null,
  }
}

export function buildSitePayload(site: CustomerSiteRow | null): Record<string, unknown> {
  return {
    site: site
      ? {
          id: site.id,
          customer_id: site.customer_id,
          site_name: site.site_name,
          facility_id: site.facility_id ?? null,
          site_type: site.site_type,
          status: site.status,
          grid_owner_id: site.grid_owner_id ?? null,
          price_area_code: site.price_area_code ?? null,
          move_in_date: site.move_in_date ?? null,
          annual_consumption_kwh: site.annual_consumption_kwh ?? null,
          current_supplier_name: site.current_supplier_name ?? null,
          current_supplier_org_number: site.current_supplier_org_number ?? null,
          street: site.street ?? null,
          care_of: site.care_of ?? null,
          postal_code: site.postal_code ?? null,
          city: site.city ?? null,
          country: site.country,
        }
      : null,
  }
}

export function buildMeteringPointPayload(
  meteringPoint: MeteringPointRow | null
): Record<string, unknown> {
  return {
    metering_point: meteringPoint
      ? {
          id: meteringPoint.id,
          site_id: meteringPoint.site_id,
          meter_point_id: meteringPoint.meter_point_id,
          site_facility_id: meteringPoint.site_facility_id ?? null,
          ediel_reference: meteringPoint.ediel_reference ?? null,
          status: meteringPoint.status,
          measurement_type: meteringPoint.measurement_type,
          reading_frequency: meteringPoint.reading_frequency,
          grid_owner_id: meteringPoint.grid_owner_id ?? null,
          price_area_code: meteringPoint.price_area_code ?? null,
          start_date: meteringPoint.start_date ?? null,
          end_date: meteringPoint.end_date ?? null,
          is_settlement_relevant: meteringPoint.is_settlement_relevant,
        }
      : null,
  }
}

export function buildContractPayload(
  contract: CustomerContractRow | null
): Record<string, unknown> {
  const lifecycle = contract
    ? getContractLifecycleSummary({
        startsAt: contract.starts_at,
        endsAt: contract.ends_at,
        bindingMonths: contract.binding_months,
        noticeMonths: contract.notice_months,
        terminationNoticeDate: contract.termination_notice_date,
        terminationReason: contract.termination_reason,
        autoRenewEnabled: contract.auto_renew_enabled,
        autoRenewTermMonths: contract.auto_renew_term_months,
        status: contract.status,
      })
    : null

  return {
    contract: contract
      ? {
          id: contract.id,
          contract_offer_id: contract.contract_offer_id ?? null,
          source_type: contract.source_type,
          status: contract.status,
          contract_name: contract.contract_name,
          contract_type: contract.contract_type,
          campaign_name: contract.campaign_name ?? null,
          fixed_price_ore_per_kwh: contract.fixed_price_ore_per_kwh ?? null,
          spot_markup_ore_per_kwh: contract.spot_markup_ore_per_kwh ?? null,
          variable_fee_ore_per_kwh: contract.variable_fee_ore_per_kwh ?? null,
          monthly_fee_sek: contract.monthly_fee_sek ?? null,
          green_fee_mode: contract.green_fee_mode,
          green_fee_value: contract.green_fee_value ?? null,
          binding_months: contract.binding_months ?? null,
          notice_months: contract.notice_months ?? null,
          auto_renew_enabled: contract.auto_renew_enabled,
          auto_renew_term_months: contract.auto_renew_term_months ?? null,
          termination_reason: contract.termination_reason ?? null,
          optional_fee_lines: contract.optional_fee_lines ?? [],
          starts_at: contract.starts_at ?? null,
          ends_at: contract.ends_at ?? null,
          signed_at: contract.signed_at ?? null,
          termination_notice_date: contract.termination_notice_date ?? null,
          lifecycle_summary: lifecycle,
        }
      : null,
  }
}

export function buildRoutePayload(
  route: CommunicationRouteRow | null
): Record<string, unknown> {
  return {
    communication_route: route
      ? {
          id: route.id,
          route_name: route.route_name,
          route_scope: route.route_scope,
          route_type: route.route_type,
          target_system: route.target_system,
          endpoint: route.endpoint ?? null,
          target_email: route.target_email ?? null,
          supported_payload_version: route.supported_payload_version ?? null,
          grid_owner_id: route.grid_owner_id ?? null,
        }
      : null,
  }
}