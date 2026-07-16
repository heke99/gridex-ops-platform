'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { isCanonicalLegalModule } from '@/lib/legal/canonicalModules'
import { supabaseService } from '@/lib/supabase/service'
import {
  copyPublishedTemplatesToCompanies,
  listLegalTemplateCompanies,
  summarizeCopyResults,
} from '@/lib/legal/platformLegalTemplates'

const PAGE_PATH = '/admin/platform/legal-templates'

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function redirectBack(params: { success?: string; error?: string }) {
  const key = params.success ? 'success' : 'error'
  const message = params.success ?? params.error ?? ''
  redirect(`${PAGE_PATH}?${key}=${encodeURIComponent(message)}`)
}

function isRedirectError(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'digest' in error &&
      String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT'),
  )
}

function assertLegalType(value: string) {
  if (!isCanonicalLegalModule(value)) {
    throw new Error('Unknown canonical legal module.')
  }
}

async function auditPlatformLegalTemplate(input: {
  actorUserId: string
  action: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}) {
  await supabaseService
    .from('audit_logs')
    .insert({
      company_id: null,
      actor_user_id: input.actorUserId,
      action: input.action,
      entity_type: 'legal_template_versions',
      entity_id: input.entityId ?? null,
      new_values: input.metadata ?? {},
    })
    .then(() => null)
}

export async function createPlatformLegalTemplateAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()

  try {
    const type = text(formData, 'type')
    const version = text(formData, 'version')
    const title = text(formData, 'title')
    const body = text(formData, 'body')
    const publishNow = text(formData, 'publish_now') === 'on'

    assertLegalType(type)
    if (!version) throw new Error('Version is required.')
    if (!title) throw new Error('Title is required.')
    if (!body) throw new Error('Body is required.')

    const { data, error } = await supabaseService.rpc('gridex_create_legal_template_version', {
      p_module_key: type,
      p_version_label: version,
      p_title: title,
      p_body: body,
      p_publish: publishNow,
      p_actor_user_id: admin.userId,
    })
    if (error) throw error

    const id = typeof data === 'string' ? data : null
    await auditPlatformLegalTemplate({
      actorUserId: admin.userId,
      action: publishNow ? 'CANONICAL_LEGAL_TEMPLATE_CREATED_AND_PUBLISHED' : 'CANONICAL_LEGAL_TEMPLATE_CREATED',
      entityId: id,
      metadata: { type, version, title, publishNow },
    })

    revalidatePath(PAGE_PATH)
    redirectBack({ success: publishNow ? 'Canonical master template created and published.' : 'Canonical master template created as draft.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack({ error: error instanceof Error ? error.message : 'Could not create canonical master template.' })
  }
}

export async function updateDraftPlatformLegalTemplateAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()

  try {
    const id = text(formData, 'id')
    const title = text(formData, 'title')
    const body = text(formData, 'body')
    if (!id) throw new Error('Template is missing.')
    if (!title) throw new Error('Title is required.')
    if (!body) throw new Error('Body is required.')

    const { data: existing, error: existingError } = await supabaseService
      .from('canonical_legal_template_versions_v')
      .select('id,type,version,status,metadata')
      .eq('id', id)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) throw new Error('Template was not found.')
    if (existing.status !== 'draft') throw new Error('Only unlocked draft master templates can be edited.')

    const { error } = await supabaseService.rpc('gridex_update_draft_legal_template_version', {
      p_version_id: id,
      p_title: title,
      p_body: body,
      p_actor_user_id: admin.userId,
    })
    if (error) throw error

    await auditPlatformLegalTemplate({
      actorUserId: admin.userId,
      action: 'CANONICAL_LEGAL_TEMPLATE_DRAFT_UPDATED',
      entityId: id,
      metadata: { type: existing.type, version: existing.version },
    })

    revalidatePath(PAGE_PATH)
    redirectBack({ success: 'Draft template updated.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack({ error: error instanceof Error ? error.message : 'Could not update draft template.' })
  }
}

export async function publishPlatformLegalTemplateAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()

  try {
    const id = text(formData, 'id')
    if (!id) throw new Error('Template is missing.')

    const { data: existing, error: existingError } = await supabaseService
      .from('canonical_legal_template_versions_v')
      .select('id,type,version,title,status')
      .eq('id', id)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) throw new Error('Template was not found.')

    const { error } = await supabaseService.rpc('gridex_publish_legal_template_version', {
      p_version_id: id,
      p_actor_user_id: admin.userId,
    })
    if (error) throw error

    await auditPlatformLegalTemplate({
      actorUserId: admin.userId,
      action: 'CANONICAL_LEGAL_TEMPLATE_PUBLISHED',
      entityId: id,
      metadata: existing as Record<string, unknown>,
    })

    revalidatePath(PAGE_PATH)
    redirectBack({ success: 'Canonical master template published and locked.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack({ error: error instanceof Error ? error.message : 'Could not publish master template.' })
  }
}

export async function archivePlatformLegalTemplateAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()

  try {
    const id = text(formData, 'id')
    if (!id) throw new Error('Template is missing.')

    const { data: existing, error: existingError } = await supabaseService
      .from('canonical_legal_template_versions_v')
      .select('id,type,version,title,status')
      .eq('id', id)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) throw new Error('Template was not found.')
    if (existing.status === 'published') throw new Error('Published master templates are immutable. Publish a newer version instead.')

    const { error } = await supabaseService.rpc('gridex_archive_draft_legal_template_version', {
      p_version_id: id,
    })
    if (error) throw error

    await auditPlatformLegalTemplate({
      actorUserId: admin.userId,
      action: 'CANONICAL_LEGAL_TEMPLATE_DRAFT_ARCHIVED',
      entityId: id,
      metadata: existing as Record<string, unknown>,
    })

    revalidatePath(PAGE_PATH)
    redirectBack({ success: 'Draft master template archived.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack({ error: error instanceof Error ? error.message : 'Could not archive master template.' })
  }
}

export async function copyPublishedTemplatesToTenantsAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()

  try {
    const selectedCompanyIds = formData.getAll('company_ids').map((value) => String(value).trim()).filter(Boolean)
    const allCompanies = text(formData, 'all_companies') === 'on'

    let companyIds = selectedCompanyIds
    if (allCompanies) {
      const companies = await listLegalTemplateCompanies(500)
      companyIds = companies.map((company) => company.id)
    }

    if (companyIds.length === 0) throw new Error('Select at least one tenant or choose all tenants.')

    const results = await copyPublishedTemplatesToCompanies({
      companyIds,
      actorUserId: admin.userId,
      source: 'platform_legal_templates_validation_ui',
    })

    await supabaseService.from('audit_logs').insert({
      company_id: null,
      actor_user_id: admin.userId,
      action: 'CANONICAL_LEGAL_TEMPLATES_VALIDATED_FOR_TENANTS',
      entity_type: 'legal_template_versions',
      entity_id: null,
      new_values: {
        company_count: companyIds.length,
        results,
      },
    }).then(() => null)

    revalidatePath(PAGE_PATH)
    revalidatePath('/admin/platform/legal-readiness')
    redirectBack({ success: summarizeCopyResults(results) })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack({ error: error instanceof Error ? error.message : 'Could not validate canonical legal templates for tenants.' })
  }
}
