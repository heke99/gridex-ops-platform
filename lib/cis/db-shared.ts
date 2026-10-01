import type {QualifiedCustomerStructure} from '@/lib/ediel/sources/qualifiedCustomerStructure'
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
import { readCustomerLifeEventExportProjection, type CustomerLifeEventExportProjection } from '@/lib/ediel/production/customerLifeEventExport'

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

export type TenantConsistencyIssue = {
  code: 'company_missing' | 'company_conflict'
  message: string
}

export type CustomerExportContext = {
  companyId: string | null
  tenantIssues: TenantConsistencyIssue[]
  customer: CustomerRow | null
  contacts: CustomerContactRow[]
  site: CustomerSiteRow | null
  meteringPoint: MeteringPointRow | null
  contract: CustomerContractRow | null
  qualifiedStructure?:QualifiedCustomerStructure
  customerLifeEvent?: CustomerLifeEventExportProjection | null
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

async function getCustomerRow(customerId:string,companyId?:string):Promise<CustomerRow|null>{
 let q=supabaseService.from('customers').select('*').eq('id',customerId)
 if(companyId)q=q.eq('company_id',companyId)
 const {data,error}=await q.maybeSingle();if(error)throw error;return (data??null) as CustomerRow|null
}
async function getCustomerContacts(customerId:string,companyId?:string):Promise<CustomerContactRow[]>{
 let q=supabaseService.from('customer_contacts').select('*').eq('customer_id',customerId)
 if(companyId)q=q.eq('company_id',companyId)
 const {data,error}=await q.order('is_primary',{ascending:false}).order('created_at',{ascending:false}).limit(20);if(error)throw error;return (data??[]) as CustomerContactRow[]
}
async function getSite(siteId?:string|null,companyId?:string):Promise<CustomerSiteRow|null>{
 if(!siteId)return null
 let q=supabaseService.from('customer_sites').select('*').eq('id',siteId)
 if(companyId)q=q.eq('company_id',companyId)
 const {data,error}=await q.maybeSingle();if(error)throw error;return (data??null) as CustomerSiteRow|null
}
async function getMeteringPoint(meteringPointId?:string|null,companyId?:string):Promise<MeteringPointRow|null>{
 if(!meteringPointId)return null
 let q=supabaseService.from('metering_points').select('*').eq('id',meteringPointId)
 if(companyId)q=q.eq('company_id',companyId)
 const {data,error}=await q.maybeSingle();if(error)throw error;return (data??null) as MeteringPointRow|null
}
async function getLatestContract(params:{customerId:string;siteId?:string|null;companyId?:string}):Promise<CustomerContractRow|null>{
 if(params.siteId){
  let q=supabaseService.from('customer_contracts').select('*').eq('customer_id',params.customerId).eq('site_id',params.siteId)
  if(params.companyId)q=q.eq('company_id',params.companyId)
  const {data,error}=await q.order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw error;if(data)return data as CustomerContractRow
 }
 let q=supabaseService.from('customer_contracts').select('*').eq('customer_id',params.customerId)
 if(params.companyId)q=q.eq('company_id',params.companyId)
 const {data,error}=await q.order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw error;return (data??null) as CustomerContractRow|null
}

function normalizeCompanyId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function resolveTenantConsistency(params: {
  customer: CustomerRow | null
  site: CustomerSiteRow | null
  meteringPoint: MeteringPointRow | null
  contract: CustomerContractRow | null
}): { companyId: string | null; tenantIssues: TenantConsistencyIssue[] } {
  const candidates = [
    { source: 'customer', companyId: normalizeCompanyId(params.customer?.company_id) },
    { source: 'site', companyId: normalizeCompanyId(params.site?.company_id) },
    { source: 'metering_point', companyId: normalizeCompanyId(params.meteringPoint?.company_id) },
    { source: 'contract', companyId: normalizeCompanyId(params.contract?.company_id) },
  ].filter((row): row is { source: string; companyId: string } => row.companyId !== null)

  const uniqueCompanyIds = Array.from(new Set(candidates.map((row) => row.companyId)))

  if (uniqueCompanyIds.length > 1) {
    return {
      companyId: null,
      tenantIssues: [
        {
          code: 'company_conflict',
          message: `Tenant-konflikt: kund, anläggning, mätpunkt eller avtal pekar på olika bolag (${uniqueCompanyIds.join(', ')}).`,
        },
      ],
    }
  }

  if (uniqueCompanyIds.length === 0) {
    return {
      companyId: null,
      tenantIssues: [
        {
          code: 'company_missing',
          message: 'Tenant saknas: kundflödet saknar company_id och får inte användas för mätvärden, export eller Ediel-runtime.',
        },
      ],
    }
  }

  return {
    companyId: uniqueCompanyIds[0],
    tenantIssues: [],
  }
}

export function requireContextCompanyId(
  context: CustomerExportContext,
  operationLabel = 'operation'
): string {
  const blockingIssue = context.tenantIssues.find((issue) =>
    issue.code === 'company_conflict' || issue.code === 'company_missing'
  )

  if (blockingIssue) {
    throw new Error(`${operationLabel} stoppades: ${blockingIssue.message}`)
  }

  if (!context.companyId) {
    throw new Error(`${operationLabel} stoppades: company_id saknas.`)
  }

  return context.companyId
}

export async function getCustomerExportContext(params: {
  edielStructure?:{companyId:string;actorUserId:string;environment:'test'|'production';periodStart:string;periodEnd:string}
  companyId?: string | null
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  actorUserId?: string | null
  asOf?: string
}): Promise<CustomerExportContext> {
  const explicitCompanyId = normalizeCompanyId(params.companyId)
  const explicitActorUserId = normalizeCompanyId(params.actorUserId)
  if (params.companyId !== undefined && params.companyId !== null && !explicitCompanyId) throw new Error('customer_export_company_required')
  if (params.edielStructure && ((explicitCompanyId && explicitCompanyId !== params.edielStructure.companyId)
    || (explicitActorUserId && explicitActorUserId !== params.edielStructure.actorUserId))) throw new Error('customer_export_actor_scope_conflict')
  if (params.asOf && params.edielStructure && Date.parse(params.asOf) !== Date.parse(params.edielStructure.periodStart)) throw new Error('customer_export_date_scope_conflict')
  const scopedCompanyId = explicitCompanyId ?? params.edielStructure?.companyId
  const scopedActorUserId = explicitActorUserId ?? params.edielStructure?.actorUserId
  if (scopedCompanyId) {
    if (!scopedActorUserId) throw new Error('customer_export_actor_required')
    const { assertEdielTenantActor } = await import('@/lib/ediel/services/authorization')
    await assertEdielTenantActor({ companyId: scopedCompanyId, actorUserId: scopedActorUserId, permissionAnyOf: ['communication.write', 'ediel_testing.write'] })
  }
  const [customer, contacts, site, meteringPoint, contract] = await Promise.all([
    getCustomerRow(params.customerId,scopedCompanyId),
    getCustomerContacts(params.customerId,scopedCompanyId),
    getSite(params.siteId,scopedCompanyId),
    getMeteringPoint(params.meteringPointId,scopedCompanyId),
    getLatestContract({
      companyId:scopedCompanyId,
      customerId: params.customerId,
      siteId: params.siteId ?? null,
    }),
  ])

  const tenant = resolveTenantConsistency({
    customer,
    site,
    meteringPoint,
    contract,
  })

  if (scopedCompanyId && (tenant.companyId !== scopedCompanyId || tenant.tenantIssues.length)) throw new Error('customer_export_tenant_scope_mismatch')
  let qualifiedStructure:QualifiedCustomerStructure|undefined
  if(params.edielStructure){
    if(tenant.companyId!==params.edielStructure.companyId||tenant.tenantIssues.length||!site||!meteringPoint||site.customer_id!==params.customerId||meteringPoint.customer_id!==params.customerId||(meteringPoint.customer_site_id??meteringPoint.site_id)!==site.id)throw new Error('dated_structure_export_scope_mismatch')
    const {readQualifiedCustomerStructure}=await import('@/lib/ediel/sources/qualifiedCustomerStructure')
    qualifiedStructure=await readQualifiedCustomerStructure({...params.edielStructure,customerId:params.customerId,siteId:site.id,meteringPointId:meteringPoint.id})
  }
  const customerLifeEvent = tenant.companyId && customer && tenant.tenantIssues.length === 0
    ? await readCustomerLifeEventExportProjection({ companyId: tenant.companyId, customerId: customer.id, actorUserId: scopedActorUserId, asOf: params.asOf ?? params.edielStructure?.periodStart })
    : null

  return {
    ...(qualifiedStructure?{qualifiedStructure}:{}),
    companyId: tenant.companyId,
    tenantIssues: tenant.tenantIssues,
    customer: customer && customerLifeEvent ? { ...customer, ...customerLifeEvent.customerFields } : customer,
    contacts,
    site,
    meteringPoint,
    contract,
    customerLifeEvent,
  }
}

export function buildCustomerIdentityPayload(
  context: CustomerExportContext
): Record<string, unknown> {
  const customer = context.customer
  const primaryContact = preferPrimaryContact(context.contacts)

  return {
    tenant: {
      company_id: context.companyId,
      issues: context.tenantIssues,
    },
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
  meteringPoint: MeteringPointRow | null,
  qualifiedStructure?:QualifiedCustomerStructure
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
          measurement_type: qualifiedStructure?.status==='selected'?qualifiedStructure.fields.measurementMethod:null,
          reading_frequency: qualifiedStructure?.status==='selected'?qualifiedStructure.fields.reportingFrequency:null,
          structural_source:qualifiedStructure??{status:'unavailable',reason:'dated_structure_not_requested'},
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
          invoice_fee_sek: contract.invoice_fee_sek ?? null,
          start_fee_sek: contract.start_fee_sek ?? null,
          admin_fee_sek: contract.admin_fee_sek ?? null,
          break_fee_sek: contract.break_fee_sek ?? null,
          discount_value: contract.discount_value ?? null,
          discount_unit: contract.discount_unit ?? null,
          vat_rate: contract.vat_rate ?? null,
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
