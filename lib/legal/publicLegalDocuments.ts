import { supabaseService } from '@/lib/supabase/service'
import { getBaseAppUrl } from '@/lib/auth/urls'

// Canonical legal types as stored in legal_text_versions.type.
export type LegalDocumentType =
  | 'terms'
  | 'privacy_policy'
  | 'withdrawal'
  | 'price_terms'
  | 'power_of_attorney'

// URL path segments are stable, human-readable and decoupled from the DB enum
// so the public legal URLs stay clean (e.g. /legal/{slug}/power-of-attorney/{id}).
const TYPE_TO_SEGMENT: Record<LegalDocumentType, string> = {
  terms: 'terms',
  privacy_policy: 'privacy',
  withdrawal: 'withdrawal',
  price_terms: 'price-terms',
  power_of_attorney: 'power-of-attorney',
}

const SEGMENT_TO_TYPE: Record<string, LegalDocumentType> = Object.entries(TYPE_TO_SEGMENT).reduce(
  (acc, [type, segment]) => {
    acc[segment] = type as LegalDocumentType
    return acc
  },
  {} as Record<string, LegalDocumentType>,
)

export function legalTypeToUrlSegment(type: string): string | null {
  return TYPE_TO_SEGMENT[type as LegalDocumentType] ?? null
}

export function urlSegmentToLegalType(segment: string): LegalDocumentType | null {
  return SEGMENT_TO_TYPE[segment] ?? null
}

// Returns a path (never throws). Callers that need an absolute URL use
// buildPublicLegalUrl which is also safe in non-production without a base URL.
export function buildPublicLegalPath(slug: string, type: string, versionId: string): string | null {
  const segment = legalTypeToUrlSegment(type)
  if (!segment || !slug || !versionId) return null
  return `/legal/${encodeURIComponent(slug)}/${segment}/${encodeURIComponent(versionId)}`
}

function safeBaseAppUrl(): string | null {
  try {
    return getBaseAppUrl()
  } catch {
    return null
  }
}

// Builds an absolute public legal URL when a base app URL is configured,
// otherwise falls back to the relative path. Never throws.
export function buildPublicLegalUrl(slug: string, type: string, versionId: string): string | null {
  const path = buildPublicLegalPath(slug, type, versionId)
  if (!path) return null
  const base = safeBaseAppUrl()
  return base ? `${base}${path}` : path
}

export type PublicLegalCompany = {
  id: string
  name: string | null
  brand_name: string | null
  org_number: string | null
  support_email: string | null
  primary_contact_email: string | null
  phone: string | null
  website: string | null
  address_line_1: string | null
  address_line_2: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  slug: string | null
}

export type PublicLegalVersion = {
  id: string
  company_id: string
  type: string
  version: string
  title: string
  body: string
  status: string
  published_at: string | null
  effective_from: string | null
  metadata: Record<string, unknown> | null
}

const COMPANY_PUBLIC_LEGAL_COLUMNS =
  'id,name,org_number,support_email,primary_contact_email,phone,website,address_line_1,address_line_2,postal_code,city,country_code,slug,company_slug,branding,metadata'

function deriveBrandName(row: Record<string, unknown>): string | null {
  const branding = (row.branding as Record<string, unknown> | null) ?? null
  const metadata = (row.metadata as Record<string, unknown> | null) ?? null
  const candidates = [
    branding?.brand_name,
    branding?.display_name,
    branding?.name,
    metadata?.brand_name,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function mapCompanyRow(row: Record<string, unknown>): PublicLegalCompany {
  return {
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    brand_name: deriveBrandName(row),
    org_number: (row.org_number as string | null) ?? null,
    support_email: (row.support_email as string | null) ?? null,
    primary_contact_email: (row.primary_contact_email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    address_line_1: (row.address_line_1 as string | null) ?? null,
    address_line_2: (row.address_line_2 as string | null) ?? null,
    postal_code: (row.postal_code as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    country: (row.country_code as string | null) ?? null,
    slug: ((row.slug as string | null) ?? (row.company_slug as string | null)) ?? null,
  }
}

// Resolves a tenant by its public slug (slug or legacy company_slug). Read-only
// and narrow; relies on the unique slug index.
export async function loadCompanyBySlug(slug: string): Promise<PublicLegalCompany | null> {
  const cleaned = slug.trim().toLowerCase()
  if (!cleaned) return null
  const { data, error } = await supabaseService
    .from('companies')
    .select(COMPANY_PUBLIC_LEGAL_COLUMNS)
    .or(`slug.eq.${cleaned},company_slug.eq.${cleaned}`)
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return mapCompanyRow(data as Record<string, unknown>)
}

// Best-effort slug lookup by company id (PK), used when building public legal
// URLs from the website API. Returns null if no slug is set.
export async function loadCompanySlugById(companyId: string): Promise<string | null> {
  if (!companyId) return null
  const { data, error } = await supabaseService
    .from('companies')
    .select('slug,company_slug')
    .eq('id', companyId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { slug?: string | null; company_slug?: string | null }
  return row.slug ?? row.company_slug ?? null
}

// Loads a single PUBLISHED legal version, strictly scoped to the tenant resolved
// from the slug, the requested type and the version id. Draft/archived versions
// are never returned. Returns null on any mismatch or schema problem.
export async function loadPublishedLegalVersion(
  slug: string,
  urlSegment: string,
  versionId: string,
): Promise<{ company: PublicLegalCompany; version: PublicLegalVersion } | null> {
  const type = urlSegmentToLegalType(urlSegment)
  if (!type) return null
  const company = await loadCompanyBySlug(slug)
  if (!company) return null

  const { data, error } = await supabaseService
    .from('legal_text_versions')
    .select('id,company_id,type,version,title,body,status,published_at,metadata')
    .eq('company_id', company.id)
    .eq('id', versionId)
    .eq('type', type)
    .eq('status', 'published')
    .maybeSingle()
  if (error || !data) return null
  const row = data as Record<string, unknown>
  const metadata = (row.metadata as Record<string, unknown> | null) ?? null
  // effective_from is not a column on legal_text_versions; derive it from
  // metadata.effective_from when present, otherwise the publication date.
  const effectiveFrom =
    (typeof metadata?.effective_from === 'string' ? metadata.effective_from : null) ??
    ((row.published_at as string | null) ?? null)
  const version: PublicLegalVersion = {
    id: String(row.id),
    company_id: String(row.company_id),
    type: String(row.type),
    version: String(row.version),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    status: String(row.status ?? ''),
    published_at: (row.published_at as string | null) ?? null,
    effective_from: effectiveFrom,
    metadata,
  }
  return { company, version }
}
