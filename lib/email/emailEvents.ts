import { supabaseService } from '@/lib/supabase/service'
import { sendCompanyEmail } from './sendCompanyEmail'

export type EmailEventRule = {
  id: string
  company_id: string
  event_key: string
  template_key: string
  enabled: boolean
  delay_minutes: number
  send_to_customer: boolean
  send_to_admin: boolean
  created_at: string
  updated_at: string
}

export const DEFAULT_EMAIL_EVENT_RULES = [
  { event_key: 'contract_signed', template_key: 'contract_confirmation' },
  { event_key: 'customer_created', template_key: 'welcome_email' },
  { event_key: 'cancellation_right_started', template_key: 'cancellation_right' },
  { event_key: 'delivery_start_confirmed', template_key: 'delivery_start_confirmed' },
  { event_key: 'supplier_switch_started', template_key: 'switch_started' },
  { event_key: 'supplier_switch_confirmed', template_key: 'switch_confirmed' },
  { event_key: 'supplier_switch_failed', template_key: 'switch_failed' },
  { event_key: 'missing_customer_information', template_key: 'missing_information' },
  { event_key: 'power_of_attorney_signed', template_key: 'power_of_attorney_confirmation' },
  { event_key: 'customer_ended', template_key: 'customer_ended' },
]

export async function getEmailEventRules(companyId: string): Promise<EmailEventRule[]> {
  const { data, error } = await supabaseService
    .from('email_event_rules')
    .select('*')
    .eq('company_id', companyId)
    .order('event_key', { ascending: true })

  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return []
    throw error
  }

  return (data ?? []) as EmailEventRule[]
}

export async function updateEmailEventRule(
  companyId: string,
  eventKey: string,
  input: { enabled?: boolean; delayMinutes?: number; sendToCustomer?: boolean; sendToAdmin?: boolean }
) {
  const fallback = DEFAULT_EMAIL_EVENT_RULES.find((rule) => rule.event_key === eventKey)
  if (!fallback) throw new Error('Okänd automatisk utskicksregel.')

  const { data, error } = await supabaseService
    .from('email_event_rules')
    .upsert({
      company_id: companyId,
      event_key: eventKey,
      template_key: fallback.template_key,
      enabled: input.enabled ?? true,
      delay_minutes: input.delayMinutes ?? 0,
      send_to_customer: input.sendToCustomer ?? true,
      send_to_admin: input.sendToAdmin ?? false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,event_key,template_key' })
    .select('*')
    .single()

  if (error) throw error
  return data as EmailEventRule
}

export async function seedDefaultEmailEventRules(companyId: string) {
  const { error } = await supabaseService
    .from('email_event_rules')
    .upsert(DEFAULT_EMAIL_EVENT_RULES.map((rule) => ({
      company_id: companyId,
      event_key: rule.event_key,
      template_key: rule.template_key,
      enabled: true,
      delay_minutes: 0,
      send_to_customer: true,
      send_to_admin: false,
      updated_at: new Date().toISOString(),
    })), { onConflict: 'company_id,event_key,template_key', ignoreDuplicates: true })

  if (error) throw error
}

export async function triggerEmailEvent(input: {
  companyId: string
  customerId?: string | null
  eventKey: string
  to: string
  variables?: Record<string, string | number | null | undefined>
  createdBy?: string | null
}) {
  const rules = (await getEmailEventRules(input.companyId))
    .filter((rule) => rule.event_key === input.eventKey && rule.enabled && rule.send_to_customer)

  const results = []
  for (const rule of rules) {
    results.push(await sendCompanyEmail({
      companyId: input.companyId,
      customerId: input.customerId ?? null,
      eventKey: input.eventKey,
      templateKey: rule.template_key,
      to: input.to,
      variables: input.variables ?? {},
      createdBy: input.createdBy ?? null,
    }))
  }

  return results
}
