import { supabaseService } from '@/lib/supabase/service'
import {
  CANONICAL_LEGAL_MODULES,
  canonicalLegalModuleLabel,
  type CanonicalLegalModule,
} from '@/lib/legal/canonicalModules'
import type { LegalTextVersion } from '@/lib/opsMaster/readiness'
import { copyPublishedTemplatesToCompany } from '@/lib/legal/platformLegalTemplates'

export const GRIDEX_DEFAULT_LEGAL_VERSION = 'gridex-canonical-2026-07-v2'

export type TenantEffectiveLegalSource = {
  type: CanonicalLegalModule
  platformTemplateVersionId: string | null
  platformVersion: string | null
  tenantOverrideId: string | null
  tenantOverrideVersion: string | null
  tenantOverrideMode: 'replacement' | 'addendum' | null
  effectiveSource: 'platform_template' | 'tenant_replacement' | 'platform_template_with_tenant_addendum' | 'missing'
  available: boolean
}

export type TenantLegalDefaultStatus = {
  companyId: string
  hasAllRequiredLegalTexts: boolean
  hasTenantOwnedPublishedTexts: boolean
  usingGridexDefaults: boolean
  missingTypes: CanonicalLegalModule[]
  publishedVersions: LegalTextVersion[]
  defaultBundleId: string | null
  platformPublishedCount: number
  tenantOverrideCount: number
  effectiveModuleCount: number
  effectiveSources: TenantEffectiveLegalSource[]
}

function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST200', 'PGRST201', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist|function .* does not exist/i.test(message)
}

export function legalTypeLabel(type: string): string {
  return canonicalLegalModuleLabel(type)
}

export async function seedGridexDefaultLegalPackage(companyId: string, actorUserId?: string | null): Promise<{
  insertedCount: number
  existingCount: number
  bundleId: string | null
  missingTypes: string[]
  platformPublishedCount: number
  tenantOverrideCount: number
  effectiveModuleCount: number
}> {
  const validation = await copyPublishedTemplatesToCompany({
    companyId,
    actorUserId: actorUserId ?? null,
    source: 'canonical_platform_template_validation',
  })
  const status = await getTenantLegalDefaultStatus(companyId)

  return {
    insertedCount: 0,
    existingCount: validation.skipped,
    bundleId: null,
    missingTypes: status.missingTypes,
    platformPublishedCount: status.platformPublishedCount,
    tenantOverrideCount: status.tenantOverrideCount,
    effectiveModuleCount: status.effectiveModuleCount,
  }
}

function emptyStatus(companyId: string): TenantLegalDefaultStatus {
  return {
    companyId,
    hasAllRequiredLegalTexts: false,
    hasTenantOwnedPublishedTexts: false,
    usingGridexDefaults: false,
    missingTypes: [...CANONICAL_LEGAL_MODULES],
    publishedVersions: [],
    defaultBundleId: null,
    platformPublishedCount: 0,
    tenantOverrideCount: 0,
    effectiveModuleCount: 0,
    effectiveSources: CANONICAL_LEGAL_MODULES.map((type) => ({
      type,
      platformTemplateVersionId: null,
      platformVersion: null,
      tenantOverrideId: null,
      tenantOverrideVersion: null,
      tenantOverrideMode: null,
      effectiveSource: 'missing',
      available: false,
    })),
  }
}

export async function getTenantLegalDefaultStatus(companyId: string): Promise<TenantLegalDefaultStatus> {
  const [{ data: effectiveRows, error: effectiveError }, { data: overrides, error: overridesError }] = await Promise.all([
    supabaseService
      .from('gridex_tenant_effective_legal_sources_v')
      .select('company_id,module_key,platform_template_version_id,platform_version,tenant_override_id,tenant_override_version,tenant_override_mode,effective_source,effective_available')
      .eq('company_id', companyId)
      .order('module_key', { ascending: true }),
    supabaseService
      .from('canonical_tenant_legal_overrides_v')
      .select('id,company_id,type,version,title,body,status,published_at,created_at,updated_at,metadata')
      .eq('company_id', companyId)
      .eq('status', 'published')
      .order('created_at', { ascending: false }),
  ])

  if (effectiveError) {
    if (!isMissingSchema(effectiveError)) throw effectiveError
    return getTenantLegalDefaultStatusLegacy(companyId)
  }
  if (overridesError && !isMissingSchema(overridesError)) throw overridesError

  return summarizeTenantEffectiveLegalSources(
    companyId,
    (effectiveRows ?? []) as Array<Record<string, unknown>>,
    (overrides ?? []) as LegalTextVersion[],
  )
}

export function summarizeTenantEffectiveLegalSources(
  companyId: string,
  rows: Array<Record<string, unknown>>,
  publishedVersions: LegalTextVersion[] = [],
): TenantLegalDefaultStatus {
  if (rows.length === 0) return emptyStatus(companyId)

  const byType = new Map(rows.map((row) => [String(row.module_key), row]))
  const effectiveSources: TenantEffectiveLegalSource[] = CANONICAL_LEGAL_MODULES.map((type) => {
    const row = byType.get(type)
    const rawSource = String(row?.effective_source ?? 'missing')
    const effectiveSource: TenantEffectiveLegalSource['effectiveSource'] =
      rawSource === 'platform_template' ||
      rawSource === 'tenant_replacement' ||
      rawSource === 'platform_template_with_tenant_addendum'
        ? rawSource
        : 'missing'
    return {
      type,
      platformTemplateVersionId: typeof row?.platform_template_version_id === 'string' ? row.platform_template_version_id : null,
      platformVersion: typeof row?.platform_version === 'string' ? row.platform_version : null,
      tenantOverrideId: typeof row?.tenant_override_id === 'string' ? row.tenant_override_id : null,
      tenantOverrideVersion: typeof row?.tenant_override_version === 'string' ? row.tenant_override_version : null,
      tenantOverrideMode: row?.tenant_override_mode === 'replacement' || row?.tenant_override_mode === 'addendum' ? row.tenant_override_mode : null,
      effectiveSource,
      available: row?.effective_available === true,
    }
  })

  const missingTypes = effectiveSources.filter((row) => !row.available).map((row) => row.type)
  const platformPublishedCount = effectiveSources.filter((row) => Boolean(row.platformTemplateVersionId)).length
  const tenantOverrideCount = effectiveSources.filter((row) => Boolean(row.tenantOverrideId)).length
  const effectiveModuleCount = effectiveSources.filter((row) => row.available).length

  return {
    companyId,
    hasAllRequiredLegalTexts: missingTypes.length === 0,
    hasTenantOwnedPublishedTexts: tenantOverrideCount > 0,
    usingGridexDefaults: effectiveSources.some((row) => row.effectiveSource === 'platform_template' || row.effectiveSource === 'platform_template_with_tenant_addendum'),
    missingTypes,
    publishedVersions,
    defaultBundleId: null,
    platformPublishedCount,
    tenantOverrideCount,
    effectiveModuleCount,
    effectiveSources,
  }
}

async function getTenantLegalDefaultStatusLegacy(companyId: string): Promise<TenantLegalDefaultStatus> {
  const [{ data: templates, error: templatesError }, { data: overrides, error: overridesError }] = await Promise.all([
    supabaseService
      .from('canonical_legal_template_versions_v')
      .select('id,type,version,title,body,status,published_at,created_at,updated_at,metadata')
      .eq('status', 'published')
      .order('created_at', { ascending: false }),
    supabaseService
      .from('canonical_tenant_legal_overrides_v')
      .select('id,company_id,type,version,title,body,status,published_at,created_at,updated_at,metadata')
      .eq('company_id', companyId)
      .eq('status', 'published')
      .order('created_at', { ascending: false }),
  ])

  if (templatesError) {
    if (isMissingSchema(templatesError)) return emptyStatus(companyId)
    throw templatesError
  }
  if (overridesError && !isMissingSchema(overridesError)) throw overridesError

  const latestTemplateByType = new Map<string, LegalTextVersion>()
  for (const row of (templates ?? []) as LegalTextVersion[]) {
    if (!latestTemplateByType.has(row.type)) latestTemplateByType.set(row.type, row)
  }
  const latestOverrideByType = new Map<string, LegalTextVersion>()
  for (const row of (overrides ?? []) as LegalTextVersion[]) {
    if (!latestOverrideByType.has(row.type)) latestOverrideByType.set(row.type, row)
  }

  const effectiveSources: TenantEffectiveLegalSource[] = CANONICAL_LEGAL_MODULES.map((type) => {
    const platform = latestTemplateByType.get(type)
    const override = latestOverrideByType.get(type)
    const metadata = override?.metadata && typeof override.metadata === 'object' ? override.metadata : null
    const mode = metadata?.legal_mode === 'addendum' ? 'addendum' : override ? 'replacement' : null
    const available = Boolean(override || platform)
    return {
      type,
      platformTemplateVersionId: platform?.id ?? null,
      platformVersion: platform?.version ?? null,
      tenantOverrideId: override?.id ?? null,
      tenantOverrideVersion: override?.version ?? null,
      tenantOverrideMode: mode,
      effectiveSource: override
        ? mode === 'addendum' && platform
          ? 'platform_template_with_tenant_addendum'
          : 'tenant_replacement'
        : platform
          ? 'platform_template'
          : 'missing',
      available,
    }
  })
  const missingTypes = effectiveSources.filter((row) => !row.available).map((row) => row.type)

  return {
    companyId,
    hasAllRequiredLegalTexts: missingTypes.length === 0,
    hasTenantOwnedPublishedTexts: latestOverrideByType.size > 0,
    usingGridexDefaults: latestTemplateByType.size > 0,
    missingTypes,
    publishedVersions: Array.from(latestOverrideByType.values()),
    defaultBundleId: null,
    platformPublishedCount: effectiveSources.filter((row) => Boolean(row.platformTemplateVersionId)).length,
    tenantOverrideCount: effectiveSources.filter((row) => Boolean(row.tenantOverrideId)).length,
    effectiveModuleCount: effectiveSources.filter((row) => row.available).length,
    effectiveSources,
  }
}
