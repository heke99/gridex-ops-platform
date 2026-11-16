import { supabaseService } from '@/lib/supabase/service'

export type CanonicalContractCatalogRow = {
  assignment_id: string
  company_id: string
  assignment_status: string
  legal_mode: string
  valid_from: string | null
  valid_to: string | null
  internal_sales_allowed: boolean
  website_publication_allowed: boolean
  relation_status: 'ok' | 'missing_product_version' | 'missing_product'
  contract_product_version_id: string
  version_number: number
  version_status: string
  customer_type: string
  contract_type: string
  pricing_model: string
  commercial_snapshot: Record<string, unknown>
  required_legal_modules: string[]
  product_id: string
  product_code: string
  product_name: string
  product_category: string
  channels: Array<{ id: string; channel: string; status: string; valid_from: string | null; valid_to: string | null; marketing_content: Record<string, unknown> }>
  publications: Array<{ id: string; channel: string; status: string; versions: Array<{ id: string; version_number: number; status: string; valid_from: string | null; valid_to: string | null; offer_reference: string | null; locked_at: string | null }> }>
}

export type TenantLegalProfile = {
  id: string
  company_id: string
  legal_name: string | null
  organization_number: string | null
  customer_service_email: string | null
  phone: string | null
  website: string | null
  completeness_status: string
  postal_address: Record<string, unknown>
  customer_service_address: Record<string, unknown>
  customer_service_contact?: Record<string, unknown>
  complaints_contact: Record<string, unknown>
  data_protection_contact: Record<string, unknown>
  billing_information: Record<string, unknown>
  dispute_resolution_information: Record<string, unknown>
  missing_fields?: string[]
  review_required?: boolean
  verified_at?: string | null
  reviewed_at?: string | null
  reviewed_by?: string | null
  last_synced_at?: string | null
  last_synced_by?: string | null
  updated_at?: string | null
}

export type CanonicalTenantContractReadiness = {
  company_id: string
  company_name: string
  legal_profile_status: 'ready' | 'blocked' | 'unknown'
  legal_profile_missing_fields: string[]
  legal_profile_review_required: boolean
  legal_profile_verified_at: string | null
  legal_profile_updated_at: string | null
  total_publication_versions: number
  published_publication_versions: number
  can_display: boolean
  can_accept_applications: boolean
  publication_blockers: string[]
  overall_status: 'ready' | 'blocked' | 'unknown'
  no_published_contracts: boolean
  evaluated_at: string | null
}

type CanonicalRawRow = Record<string, unknown> & {
  contract_product_versions?: unknown
  tenant_contract_channels?: unknown
  contract_publications?: unknown
}
type CanonicalPublicationRaw = Record<string, unknown> & { contract_publication_versions?: unknown }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function firstRecord(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? record(value[0]) : record(value)
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function bool(value: unknown): boolean {
  return value === true
}

function integer(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function objectValue(value: unknown): Record<string, unknown> {
  return record(value)
}

export async function listCanonicalContractCatalog(companyId: string): Promise<CanonicalContractCatalogRow[]> {
  const { data, error } = await supabaseService
    .from('tenant_contract_assignments')
    .select(`
      id,company_id,status,legal_mode,valid_from,valid_to,internal_sales_allowed,website_publication_allowed,
      contract_product_versions(
        id,version_number,status,customer_type,contract_type,pricing_model,commercial_snapshot,required_legal_modules,
        contract_products(id,product_code,name,product_category)
      ),
      tenant_contract_channels(id,channel,status,valid_from,valid_to,marketing_content),
      contract_publications(id,channel,status,contract_publication_versions(id,version_number,status,valid_from,valid_to,offer_reference,locked_at))
    `)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
  if (error) throw error

  return (data ?? []).map((rawValue): CanonicalContractCatalogRow => {
    const raw = rawValue as CanonicalRawRow
    const version = firstRecord(raw.contract_product_versions)
    const product = firstRecord(version.contract_products)
    const channels = Array.isArray(raw.tenant_contract_channels) ? raw.tenant_contract_channels : []
    const publications = Array.isArray(raw.contract_publications) ? raw.contract_publications : []

    return {
      assignment_id: text(raw.id),
      company_id: text(raw.company_id),
      assignment_status: text(raw.status, 'active'),
      legal_mode: text(raw.legal_mode, 'ops_standard'),
      valid_from: nullableText(raw.valid_from),
      valid_to: nullableText(raw.valid_to),
      internal_sales_allowed: bool(raw.internal_sales_allowed),
      website_publication_allowed: bool(raw.website_publication_allowed),
      relation_status: !version.id
        ? 'missing_product_version'
        : !product.id
          ? 'missing_product'
          : 'ok',
      contract_product_version_id: text(version.id),
      version_number: integer(version.version_number),
      version_status: text(version.status, 'draft'),
      customer_type: text(version.customer_type, 'both'),
      contract_type: text(version.contract_type, 'variable_monthly'),
      pricing_model: text(version.pricing_model, 'variable_monthly'),
      commercial_snapshot: objectValue(version.commercial_snapshot),
      required_legal_modules: stringArray(version.required_legal_modules),
      product_id: text(product.id),
      product_code: text(product.product_code, 'unknown'),
      product_name: text(product.name, 'Avtal'),
      product_category: text(product.product_category, 'electricity'),
      channels: channels.map((channelValue) => {
        const channel = record(channelValue)
        return {
          id: text(channel.id),
          channel: text(channel.channel),
          status: text(channel.status, 'paused'),
          valid_from: nullableText(channel.valid_from),
          valid_to: nullableText(channel.valid_to),
          marketing_content: objectValue(channel.marketing_content),
        }
      }),
      publications: publications.map((publicationValue) => {
        const publication = publicationValue as CanonicalPublicationRaw
        const versions = Array.isArray(publication.contract_publication_versions) ? publication.contract_publication_versions : []
        return {
          id: text(publication.id),
          channel: text(publication.channel),
          status: text(publication.status, 'draft'),
          versions: versions.map((versionValue) => {
            const publicationVersion = record(versionValue)
            return {
              id: text(publicationVersion.id),
              version_number: integer(publicationVersion.version_number),
              status: text(publicationVersion.status, 'draft'),
              valid_from: nullableText(publicationVersion.valid_from),
              valid_to: nullableText(publicationVersion.valid_to),
              offer_reference: nullableText(publicationVersion.offer_reference),
              locked_at: nullableText(publicationVersion.locked_at),
            }
          }),
        }
      }),
    }
  })
}

export async function getTenantLegalProfile(companyId: string): Promise<TenantLegalProfile | null> {
  const { data, error } = await supabaseService.from('tenant_legal_profiles').select('*').eq('company_id', companyId).maybeSingle()
  if (error) throw error
  return data as TenantLegalProfile | null
}

export async function listTenantLegalOverrides(companyId: string) {
  const { data, error } = await supabaseService
    .from('tenant_legal_overrides')
    .select('id,module_key,legal_mode,title,status,submitted_at,reviewed_at,review_notes,content_sha256,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function listPublicationReadiness(companyId: string) {
  const { data, error } = await supabaseService
    .from('contract_publication_readiness_v')
    .select('*')
    .eq('company_id', companyId)
  if (error) throw error
  return data ?? []
}


function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST200', 'PGRST201', 'PGRST204', 'PGRST205'].includes(code)
    || /schema cache|does not exist|column .* does not exist|relationship/i.test(message)
}

export async function getCanonicalTenantContractReadiness(
  companyId: string,
): Promise<CanonicalTenantContractReadiness> {
  const { data, error } = await supabaseService
    .from('gridex_tenant_contract_readiness_v')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) {
    if (!isMissingSchemaError(error)) throw error
    return {
      company_id: companyId,
      company_name: '',
      legal_profile_status: 'unknown',
      legal_profile_missing_fields: ['tenant_legal_profile'],
      legal_profile_review_required: false,
      legal_profile_verified_at: null,
      legal_profile_updated_at: null,
      total_publication_versions: 0,
      published_publication_versions: 0,
      can_display: false,
      can_accept_applications: false,
      publication_blockers: ['canonical_readiness_unavailable'],
      overall_status: 'unknown',
      no_published_contracts: true,
      evaluated_at: null,
    }
  }

  const row = record(data)
  return {
    company_id: text(row.company_id, companyId),
    company_name: text(row.company_name),
    legal_profile_status: ['ready', 'blocked', 'unknown'].includes(text(row.legal_profile_status))
      ? text(row.legal_profile_status) as CanonicalTenantContractReadiness['legal_profile_status']
      : 'unknown',
    legal_profile_missing_fields: stringArray(row.legal_profile_missing_fields),
    legal_profile_review_required: bool(row.legal_profile_review_required),
    legal_profile_verified_at: nullableText(row.legal_profile_verified_at),
    legal_profile_updated_at: nullableText(row.legal_profile_updated_at),
    total_publication_versions: integer(row.total_publication_versions),
    published_publication_versions: integer(row.published_publication_versions),
    can_display: bool(row.can_display),
    can_accept_applications: bool(row.can_accept_applications),
    publication_blockers: stringArray(row.publication_blockers),
    overall_status: ['ready', 'blocked', 'unknown'].includes(text(row.overall_status))
      ? text(row.overall_status) as CanonicalTenantContractReadiness['overall_status']
      : 'unknown',
    no_published_contracts: bool(row.no_published_contracts),
    evaluated_at: nullableText(row.evaluated_at),
  }
}
