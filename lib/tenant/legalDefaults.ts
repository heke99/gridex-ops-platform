import { supabaseService } from '@/lib/supabase/service'
import {
  CANONICAL_LEGAL_MODULES,
  canonicalLegalModuleLabel,
  type CanonicalLegalModule,
} from '@/lib/legal/canonicalModules'
import type { LegalTextVersion } from '@/lib/opsMaster/readiness'
import { copyPublishedTemplatesToCompany } from '@/lib/legal/platformLegalTemplates'

export const GRIDEX_DEFAULT_LEGAL_VERSION = 'gridex-canonical-2026-07'

export type TenantLegalDefaultStatus = {
  companyId: string
  hasAllRequiredLegalTexts: boolean
  hasTenantOwnedPublishedTexts: boolean
  usingGridexDefaults: boolean
  missingTypes: CanonicalLegalModule[]
  publishedVersions: LegalTextVersion[]
  defaultBundleId: string | null
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
}> {
  const result = await copyPublishedTemplatesToCompany({
    companyId,
    actorUserId: actorUserId ?? null,
    source: 'canonical_platform_template_validation',
  })

  return {
    insertedCount: 0,
    existingCount: result.skipped,
    bundleId: null,
    missingTypes: result.missingTemplates,
  }
}

export async function getTenantLegalDefaultStatus(companyId: string): Promise<TenantLegalDefaultStatus> {
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
    if (isMissingSchema(templatesError)) {
      return {
        companyId,
        hasAllRequiredLegalTexts: false,
        hasTenantOwnedPublishedTexts: false,
        usingGridexDefaults: false,
        missingTypes: [...CANONICAL_LEGAL_MODULES],
        publishedVersions: [],
        defaultBundleId: null,
      }
    }
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

  const missingTypes = CANONICAL_LEGAL_MODULES.filter(
    (type) => !latestTemplateByType.has(type) && !latestOverrideByType.has(type),
  )
  const publishedVersions = Array.from(latestOverrideByType.values())

  return {
    companyId,
    hasAllRequiredLegalTexts: missingTypes.length === 0,
    hasTenantOwnedPublishedTexts: publishedVersions.length > 0,
    usingGridexDefaults: missingTypes.length === 0,
    missingTypes,
    publishedVersions,
    defaultBundleId: null,
  }
}
