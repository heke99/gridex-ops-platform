'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { CANONICAL_LEGAL_MODULES, isCanonicalLegalModule } from '@/lib/legal/canonicalModules'
import { seedGridexDefaultLegalPackage } from '@/lib/tenant/legalDefaults'
import { supabaseService } from '@/lib/supabase/service'

function text(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function redirectBack(companyId: string, params: { success?: string; error?: string }) {
  const key = params.success ? 'success' : 'error'
  const message = params.success ?? params.error ?? ''
  redirect(`/admin/companies/${companyId}?${key}=${encodeURIComponent(message)}#legal-master`)
}

function isRedirectError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'digest' in error &&
    String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')
  )
}

function assertLegalType(value: string) {
  if (!isCanonicalLegalModule(value)) {
    throw new Error('Okänd juridisk modul.')
  }
}

async function auditTenantLegalOverride(input: {
  companyId: string
  actorUserId: string
  action: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}) {
  await supabaseService.from('audit_logs').insert({
    company_id: input.companyId,
    actor_user_id: input.actorUserId,
    action: input.action,
    entity_type: 'tenant_legal_overrides',
    entity_id: input.entityId ?? null,
    new_values: input.metadata ?? {},
  }).then(() => null)
}

export async function createLegalTextVersionAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))

  try {
    const type = text(formData.get('type'))
    const version = text(formData.get('version'))
    const title = text(formData.get('title'))
    const body = text(formData.get('body'))
    const legalMode = text(formData.get('legal_mode')) || 'replacement'
    const publishNow = text(formData.get('publish_now')) === 'on'

    if (!companyId) throw new Error('Bolag saknas.')
    assertLegalType(type)
    if (!version) throw new Error('Version krävs.')
    if (!title) throw new Error('Rubrik krävs.')
    if (!body) throw new Error('Text krävs.')
    if (!['replacement', 'addendum'].includes(legalMode)) throw new Error('Ogiltigt juridiskt läge.')

    const { data, error } = await supabaseService.rpc('gridex_create_tenant_legal_override', {
      p_company_id: companyId,
      p_module_key: type,
      p_legal_mode: legalMode,
      p_version_label: version,
      p_title: title,
      p_body: body,
      p_publish: publishNow,
      p_actor_user_id: admin.userId,
    })
    if (error) throw error

    const id = typeof data === 'string' ? data : null
    await auditTenantLegalOverride({
      companyId,
      actorUserId: admin.userId,
      action: publishNow ? 'TENANT_LEGAL_OVERRIDE_CREATED_AND_PUBLISHED' : 'TENANT_LEGAL_OVERRIDE_CREATED',
      entityId: id,
      metadata: { type, version, title, legalMode, publishNow },
    })

    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: publishNow ? 'Juridisk modul skapades och publicerades.' : 'Juridisk modul skapades som utkast.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'Juridisk modul kunde inte sparas.' })
  }
}

export async function publishLegalTextVersionAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))

  try {
    const id = text(formData.get('id'))
    if (!companyId || !id) throw new Error('Version saknas.')

    const { data: existing, error: existingError } = await supabaseService
      .from('canonical_tenant_legal_overrides_v')
      .select('id,type,version,title,status,metadata')
      .eq('company_id', companyId)
      .eq('id', id)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) throw new Error('Versionen hittades inte.')

    const { error } = await supabaseService.rpc('gridex_publish_tenant_legal_override', {
      p_company_id: companyId,
      p_override_id: id,
      p_actor_user_id: admin.userId,
    })
    if (error) throw error

    await auditTenantLegalOverride({
      companyId,
      actorUserId: admin.userId,
      action: 'TENANT_LEGAL_OVERRIDE_PUBLISHED',
      entityId: id,
      metadata: existing as Record<string, unknown>,
    })

    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: 'Juridisk modul publicerades.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'Versionen kunde inte publiceras.' })
  }
}

export async function archiveLegalTextVersionAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))

  try {
    const id = text(formData.get('id'))
    if (!companyId || !id) throw new Error('Version saknas.')

    const { data: existing, error: existingError } = await supabaseService
      .from('canonical_tenant_legal_overrides_v')
      .select('id,type,version,title,status,metadata')
      .eq('company_id', companyId)
      .eq('id', id)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) throw new Error('Versionen hittades inte.')
    if (existing.status === 'published') throw new Error('Publicerade juridikversioner är låsta och får inte arkiveras genom att ändras. Skapa en ny version i stället.')

    const { error } = await supabaseService.rpc('gridex_archive_draft_tenant_legal_override', {
      p_company_id: companyId,
      p_override_id: id,
    })
    if (error) throw error

    await auditTenantLegalOverride({
      companyId,
      actorUserId: admin.userId,
      action: 'TENANT_LEGAL_OVERRIDE_DRAFT_ARCHIVED',
      entityId: id,
      metadata: existing as Record<string, unknown>,
    })

    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: 'Juridiskt utkast arkiverades.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'Versionen kunde inte arkiveras.' })
  }
}

export async function seedDefaultLegalPackageAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))

  try {
    if (!companyId) throw new Error('Bolag saknas.')
    const result = await seedGridexDefaultLegalPackage(companyId, admin.userId)
    if (result.missingTypes.length > 0) {
      throw new Error(`Gridex standardjuridik saknar publicerade mastermallar: ${result.missingTypes.join(', ')}`)
    }

    await auditTenantLegalOverride({
      companyId,
      actorUserId: admin.userId,
      action: 'CANONICAL_LEGAL_TEMPLATES_VALIDATED_FOR_TENANT',
      entityId: null,
      metadata: result,
    })

    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: `OPS-standardmallar ${result.platformPublishedCount}/${CANONICAL_LEGAL_MODULES.length} · egna overrides ${result.tenantOverrideCount} · effektiva moduler ${result.effectiveModuleCount}/${CANONICAL_LEGAL_MODULES.length}. Alla dokument renderas med bolagets låsta juridikprofil vid publicering.` })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'Standardjuridiken kunde inte valideras.' })
  }
}
