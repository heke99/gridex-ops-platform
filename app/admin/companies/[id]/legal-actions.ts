'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { REQUIRED_LEGAL_TEXT_TYPES } from '@/lib/opsMaster/readiness'
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
  if (!(REQUIRED_LEGAL_TEXT_TYPES as readonly string[]).includes(value)) {
    throw new Error('Okänd juridisk texttyp.')
  }
}

export async function createLegalTextVersionAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))

  try {
    const type = text(formData.get('type'))
    const version = text(formData.get('version'))
    const title = text(formData.get('title'))
    const body = text(formData.get('body'))
    const publishNow = text(formData.get('publish_now')) === 'on'

    if (!companyId) throw new Error('Bolag saknas.')
    assertLegalType(type)
    if (!version) throw new Error('Version krävs.')
    if (!title) throw new Error('Rubrik krävs.')
    if (!body) throw new Error('Text krävs.')

    const { data, error } = await supabaseService
      .from('legal_text_versions')
      .insert({
        company_id: companyId,
        type,
        version,
        title,
        body,
        status: 'draft',
        created_by: admin.userId,
        updated_by: admin.userId,
        metadata: { source: 'platform_admin_ui' },
      })
      .select('id')
      .single()

    if (error) throw error

    if (publishNow && data?.id) {
      await publishLegalTextVersion(companyId, data.id, type, admin.userId)
    }

    await supabaseService.from('audit_logs').insert({
      company_id: companyId,
      actor_user_id: admin.userId,
      action: publishNow ? 'LEGAL_TEXT_CREATED_AND_PUBLISHED' : 'LEGAL_TEXT_CREATED',
      entity_type: 'legal_text_versions',
      entity_id: data?.id ?? null,
      new_values: { type, version, title, publishNow },
    }).then(() => null)

    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: publishNow ? 'Juridisk version skapades och publicerades.' : 'Juridisk version skapades som utkast.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'Juridisk version kunde inte sparas.' })
  }
}

async function publishLegalTextVersion(companyId: string, id: string, type: string, userId: string) {
  const { error: archiveError } = await supabaseService
    .from('legal_text_versions')
    .update({ status: 'archived', updated_by: userId })
    .eq('company_id', companyId)
    .eq('type', type)
    .eq('status', 'published')
    .neq('id', id)

  if (archiveError) throw archiveError

  const { error: publishError } = await supabaseService
    .from('legal_text_versions')
    .update({ status: 'published', published_at: new Date().toISOString(), published_by: userId, updated_by: userId })
    .eq('company_id', companyId)
    .eq('id', id)

  if (publishError) throw publishError
}

export async function publishLegalTextVersionAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))

  try {
    const id = text(formData.get('id'))
    if (!companyId || !id) throw new Error('Version saknas.')

    const { data, error } = await supabaseService
      .from('legal_text_versions')
      .select('id,type,version,title,status')
      .eq('company_id', companyId)
      .eq('id', id)
      .single()

    if (error) throw error
    if (!data) throw new Error('Versionen hittades inte.')

    await publishLegalTextVersion(companyId, id, String(data.type), admin.userId)

    await supabaseService.from('audit_logs').insert({
      company_id: companyId,
      actor_user_id: admin.userId,
      action: 'LEGAL_TEXT_PUBLISHED',
      entity_type: 'legal_text_versions',
      entity_id: id,
      new_values: data,
    }).then(() => null)

    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: 'Juridisk version publicerades.' })
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

    const { data, error } = await supabaseService
      .from('legal_text_versions')
      .update({ status: 'archived', updated_by: admin.userId })
      .eq('company_id', companyId)
      .eq('id', id)
      .select('id,type,version,title,status')
      .single()

    if (error) throw error

    await supabaseService.from('audit_logs').insert({
      company_id: companyId,
      actor_user_id: admin.userId,
      action: 'LEGAL_TEXT_ARCHIVED',
      entity_type: 'legal_text_versions',
      entity_id: id,
      new_values: data,
    }).then(() => null)

    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: 'Juridisk version arkiverades.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'Versionen kunde inte arkiveras.' })
  }
}
