'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { REQUIRED_LEGAL_TEXT_TYPES } from '@/lib/opsMaster/readiness'
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
  if (!(REQUIRED_LEGAL_TEXT_TYPES as readonly string[]).includes(value)) {
    throw new Error('Unknown legal template type.')
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
      entity_type: 'platform_default_legal_templates',
      entity_id: input.entityId ?? null,
      new_values: input.metadata ?? {},
    })
    .then(() => null)
}

async function publishPlatformTemplate(templateId: string, type: string, userId: string) {
  const { error: archiveError } = await supabaseService
    .from('platform_default_legal_templates')
    .update({
      status: 'archived',
      updated_at: new Date().toISOString(),
    })
    .eq('type', type)
    .eq('status', 'published')
    .neq('id', templateId)

  if (archiveError) throw archiveError

  const { error: publishError } = await supabaseService
    .from('platform_default_legal_templates')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', templateId)

  if (publishError) throw publishError

  await auditPlatformLegalTemplate({
    actorUserId: userId,
    action: 'PLATFORM_LEGAL_TEMPLATE_PUBLISHED',
    entityId: templateId,
    metadata: { type },
  })
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

    const { data, error } = await supabaseService
      .from('platform_default_legal_templates')
      .insert({
        type,
        version,
        title,
        body,
        status: 'draft',
        metadata: {
          source: 'platform_admin_ui',
          created_by: admin.userId,
          supported_placeholders: [
            'company_name',
            'brand_name',
            'org_number',
            'support_email',
            'contact_email',
            'phone',
            'website',
            'address_line_1',
            'address_line_2',
            'postal_code',
            'city',
            'country',
          ],
        },
      })
      .select('id')
      .single()

    if (error) throw error

    if (publishNow && data?.id) {
      await publishPlatformTemplate(data.id, type, admin.userId)
    }

    await auditPlatformLegalTemplate({
      actorUserId: admin.userId,
      action: publishNow ? 'PLATFORM_LEGAL_TEMPLATE_CREATED_AND_PUBLISHED' : 'PLATFORM_LEGAL_TEMPLATE_CREATED',
      entityId: data?.id ?? null,
      metadata: { type, version, title, publishNow },
    })

    revalidatePath(PAGE_PATH)
    redirectBack({ success: publishNow ? 'Master template created and published.' : 'Master template created as draft.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack({ error: error instanceof Error ? error.message : 'Could not create master template.' })
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
      .from('platform_default_legal_templates')
      .select('id,type,version,status,metadata')
      .eq('id', id)
      .maybeSingle()

    if (existingError) throw existingError
    if (!existing) throw new Error('Template was not found.')
    if (existing.status !== 'draft') throw new Error('Only draft master templates can be edited.')

    const currentMetadata = existing.metadata && typeof existing.metadata === 'object' ? existing.metadata as Record<string, unknown> : {}
    const { error } = await supabaseService
      .from('platform_default_legal_templates')
      .update({
        title,
        body,
        updated_at: new Date().toISOString(),
        metadata: { ...currentMetadata, updated_by: admin.userId, updated_from: 'platform_admin_ui' },
      })
      .eq('id', id)

    if (error) throw error

    await auditPlatformLegalTemplate({
      actorUserId: admin.userId,
      action: 'PLATFORM_LEGAL_TEMPLATE_DRAFT_UPDATED',
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

    const { data, error } = await supabaseService
      .from('platform_default_legal_templates')
      .select('id,type,version,title,status')
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    if (!data) throw new Error('Template was not found.')

    await publishPlatformTemplate(id, String(data.type), admin.userId)

    revalidatePath(PAGE_PATH)
    redirectBack({ success: 'Master template published.' })
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

    const { data, error } = await supabaseService
      .from('platform_default_legal_templates')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id,type,version,title,status')
      .maybeSingle()

    if (error) throw error
    if (!data) throw new Error('Template was not found.')

    await auditPlatformLegalTemplate({
      actorUserId: admin.userId,
      action: 'PLATFORM_LEGAL_TEMPLATE_ARCHIVED',
      entityId: id,
      metadata: { type: data.type, version: data.version },
    })

    revalidatePath(PAGE_PATH)
    redirectBack({ success: 'Master template archived.' })
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
    const publishNow = text(formData, 'publish_now') !== 'off'
    const onlyMissing = text(formData, 'only_missing') !== 'off'

    let companyIds = selectedCompanyIds
    if (allCompanies) {
      const companies = await listLegalTemplateCompanies(500)
      companyIds = companies.map((company) => company.id)
    }

    if (companyIds.length === 0) throw new Error('Select at least one tenant or choose all tenants.')

    const results = await copyPublishedTemplatesToCompanies({
      companyIds,
      actorUserId: admin.userId,
      publishNow,
      onlyMissing,
      source: 'platform_legal_templates_bulk_ui',
    })

    await supabaseService.from('audit_logs').insert({
      company_id: null,
      actor_user_id: admin.userId,
      action: 'PLATFORM_LEGAL_TEMPLATES_BULK_COPIED_TO_TENANTS',
      entity_type: 'legal_text_versions',
      entity_id: null,
      new_values: {
        company_count: companyIds.length,
        publishNow,
        onlyMissing,
        results,
      },
    }).then(() => null)

    revalidatePath(PAGE_PATH)
    revalidatePath('/admin/platform/legal-readiness')
    redirectBack({ success: summarizeCopyResults(results) })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack({ error: error instanceof Error ? error.message : 'Could not copy templates to tenants.' })
  }
}
