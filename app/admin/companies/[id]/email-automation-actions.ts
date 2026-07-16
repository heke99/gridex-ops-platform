'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { DEFAULT_EMAIL_EVENT_RULES, updateEmailEventRule, seedDefaultEmailEventRules } from '@/lib/email/emailEvents'
import { seedDefaultEmailTemplates } from '@/lib/email/emailTemplates'
import { supabaseService } from '@/lib/supabase/service'

function text(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim()
}

function redirectBack(companyId: string, message: string): never {
  redirect(`/admin/companies/${companyId}?success=${encodeURIComponent(message)}#tenant-mail`)
  throw new Error('Redirect failed after email automation action.')
}

function isKnownEvent(eventKey: string) {
  return DEFAULT_EMAIL_EVENT_RULES.some((rule) => rule.event_key === eventKey)
}

export async function toggleCompanyEmailEventRuleAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  const eventKey = text(formData.get('event_key'))
  const enabled = text(formData.get('enabled')) === 'true'

  if (!companyId) throw new Error('Bolag saknas.')
  if (!isKnownEvent(eventKey)) throw new Error('Okänd utskicksregel.')

  await seedDefaultEmailTemplates(companyId)
  await updateEmailEventRule(companyId, eventKey, { enabled, sendToCustomer: true })

  await supabaseService.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: admin.userId,
    action: enabled ? 'SUPERADMIN_EMAIL_EVENT_RULE_ENABLED' : 'SUPERADMIN_EMAIL_EVENT_RULE_DISABLED',
    entity_type: 'email_event_rule',
    entity_id: companyId,
    new_values: { eventKey, enabled },
  }).then(() => null)

  revalidatePath(`/admin/companies/${companyId}`)
  redirectBack(companyId, enabled ? 'Utskicket aktiverades.' : 'Utskicket stängdes av.')
}

export async function repairCompanyEmailAutomationAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  if (!companyId) throw new Error('Bolag saknas.')

  const templates = await seedDefaultEmailTemplates(companyId)
  const rules = await seedDefaultEmailEventRules(companyId)

  await supabaseService.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: admin.userId,
    action: 'SUPERADMIN_EMAIL_AUTOMATION_REPAIRED',
    entity_type: 'email_event_rules',
    entity_id: companyId,
    new_values: { repaired_defaults: DEFAULT_EMAIL_EVENT_RULES, templates, rules },
  }).then(() => null)

  revalidatePath(`/admin/companies/${companyId}`)
  redirectBack(companyId, `${templates.checked} mallar kontrollerades: ${templates.created} skapades, ${templates.repaired} reparerades, ${templates.preserved} bevarades. ${rules.checked} regler verifierades: ${rules.created} skapades, ${rules.repaired} reparerades och ${rules.legacyDisabled} felkopplade legacyregler stängdes av.`)
}
