'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import {
  TENANT_EMAIL_TEMPLATE_DEFINITIONS,
  type TenantEmailTemplateKey,
  upsertTenantEmailTemplate,
} from '@/lib/tenant/emailTemplates'
import { supabaseService } from '@/lib/supabase/service'

function text(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim()
}

function isTemplateKey(value: string): value is TenantEmailTemplateKey {
  return TENANT_EMAIL_TEMPLATE_DEFINITIONS.some((template) => template.key === value)
}

export async function saveTenantEmailTemplateAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  const templateKey = text(formData.get('template_key'))

  if (!companyId) throw new Error('Bolag saknas.')
  if (!isTemplateKey(templateKey)) throw new Error('Okänd e-postmall.')

  await upsertTenantEmailTemplate({
    companyId,
    templateKey,
    subject: text(formData.get('subject')),
    intro: text(formData.get('intro')),
    body: text(formData.get('body')),
    isActive: formData.get('is_active') !== null,
    actorUserId: admin.userId,
  })

  await supabaseService.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: admin.userId,
    action: 'SUPERADMIN_TENANT_EMAIL_TEMPLATE_SAVED',
    entity_type: 'tenant_email_template',
    entity_id: companyId,
    new_values: {
      templateKey,
      subject: text(formData.get('subject')),
      isActive: formData.get('is_active') !== null,
    },
  }).then(() => null)

  revalidatePath(`/admin/companies/${companyId}`)
  redirect(`/admin/companies/${companyId}?success=${encodeURIComponent('E-postmallen sparades.')}#email-templates`)
}
