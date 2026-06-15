import { supabaseService } from '@/lib/supabase/service'
import { REQUIRED_LEGAL_TEXT_TYPES, type LegalTextType, type LegalTextVersion } from '@/lib/opsMaster/readiness'

export const GRIDEX_DEFAULT_LEGAL_VERSION = 'gridex-standard-2026-06'

export type TenantLegalDefaultStatus = {
  companyId: string
  hasAllRequiredLegalTexts: boolean
  hasTenantOwnedPublishedTexts: boolean
  usingGridexDefaults: boolean
  missingTypes: LegalTextType[]
  publishedVersions: LegalTextVersion[]
  defaultBundleId: string | null
}

function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST200', 'PGRST201', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist|function .* does not exist/i.test(message)
}

function legalSource(row: LegalTextVersion): string | null {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  const source = (metadata as Record<string, unknown>).source
  return typeof source === 'string' ? source : null
}

export function legalTypeLabel(type: string): string {
  switch (type) {
    case 'terms':
      return 'Allmänna villkor'
    case 'privacy_policy':
      return 'Integritetspolicy'
    case 'withdrawal':
      return 'Ångerrättsinformation'
    case 'price_terms':
      return 'Prisvillkor'
    case 'power_of_attorney':
      return 'Fullmaktstext'
    default:
      return type
  }
}

export async function seedGridexDefaultLegalPackage(companyId: string, actorUserId?: string | null): Promise<{
  insertedCount: number
  existingCount: number
  bundleId: string | null
  missingTypes: string[]
}> {
  const { data, error } = await supabaseService.rpc('gridex_seed_default_legal_package_for_company', {
    p_company_id: companyId,
    p_actor_user_id: actorUserId ?? null,
  })

  if (error) {
    if (isMissingSchema(error)) {
      return { insertedCount: 0, existingCount: 0, bundleId: null, missingTypes: [...REQUIRED_LEGAL_TEXT_TYPES] }
    }
    throw error
  }

  const row = Array.isArray(data) ? data[0] : data
  return {
    insertedCount: Number(row?.inserted_count ?? 0),
    existingCount: Number(row?.existing_count ?? 0),
    bundleId: typeof row?.bundle_id === 'string' ? row.bundle_id : null,
    missingTypes: Array.isArray(row?.missing_types) ? row.missing_types.map(String) : [],
  }
}

export async function getTenantLegalDefaultStatus(companyId: string): Promise<TenantLegalDefaultStatus> {
  const { data, error } = await supabaseService
    .from('legal_text_versions')
    .select('id,company_id,type,version,title,body,status,published_at,created_at,updated_at,metadata')
    .eq('company_id', companyId)
    .eq('status', 'published')
    .in('type', [...REQUIRED_LEGAL_TEXT_TYPES])
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    if (isMissingSchema(error)) {
      return {
        companyId,
        hasAllRequiredLegalTexts: false,
        hasTenantOwnedPublishedTexts: false,
        usingGridexDefaults: false,
        missingTypes: [...REQUIRED_LEGAL_TEXT_TYPES],
        publishedVersions: [],
        defaultBundleId: null,
      }
    }
    throw error
  }

  const latestByType = new Map<string, LegalTextVersion>()
  for (const row of (data ?? []) as LegalTextVersion[]) {
    if (!latestByType.has(row.type)) latestByType.set(row.type, row)
  }
  const publishedVersions = [...latestByType.values()]
  const missingTypes = REQUIRED_LEGAL_TEXT_TYPES.filter((type) => !latestByType.has(type))
  const usingGridexDefaults = publishedVersions.some((row) => legalSource(row) === 'gridex_default')
  const hasTenantOwnedPublishedTexts = publishedVersions.some((row) => legalSource(row) !== 'gridex_default')

  const { data: bundle } = await supabaseService
    .from('legal_bundles')
    .select('id,metadata,status')
    .eq('company_id', companyId)
    .in('status', ['published', 'active'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .then((result: { data: { id?: string | null } | null; error?: unknown }) => result.error && isMissingSchema(result.error) ? { data: null } : result)

  return {
    companyId,
    hasAllRequiredLegalTexts: missingTypes.length === 0,
    hasTenantOwnedPublishedTexts,
    usingGridexDefaults,
    missingTypes,
    publishedVersions,
    defaultBundleId: typeof bundle?.id === 'string' ? bundle.id : null,
  }
}
