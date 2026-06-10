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
  { event_key: 'contract.application_received', template_key: 'contract.application_received' },
  { event_key: 'support.case_message', template_key: 'support.case_message' },
  { event_key: 'switch.started', template_key: 'switch.started' },
  { event_key: 'switch.confirmed', template_key: 'switch.confirmed' },
  { event_key: 'switch.action_required', template_key: 'switch.action_required' },
  { event_key: 'customer.welcome_active', template_key: 'customer.welcome_active' },
]

const EVENT_ALIASES: Record<string, string> = {
  contract_signed: 'contract.application_received',
  'contract.confirmation_sent': 'contract.application_received',
  'contract.cooling_off_sent': 'contract.application_received',
  customer_created: 'customer.welcome_active',
  'customer.created': 'customer.welcome_active',
  delivery_start_confirmed: 'customer.welcome_active',
  supplier_switch_started: 'switch.started',
  supplier_switch_confirmed: 'switch.confirmed',
  supplier_switch_failed: 'switch.action_required',
  missing_customer_information: 'switch.action_required',
  cancellation_right_started: 'switch.action_required',
}

export function normalizeEmailEventKey(eventKey: string) {
  return EVENT_ALIASES[eventKey] ?? eventKey
}

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
  const normalizedEventKey = normalizeEmailEventKey(eventKey)
  const fallback = DEFAULT_EMAIL_EVENT_RULES.find((rule) => rule.event_key === normalizedEventKey)
  if (!fallback) throw new Error('Okänd automatisk utskicksregel.')

  const { data, error } = await supabaseService
    .from('email_event_rules')
    .upsert({
      company_id: companyId,
      event_key: normalizedEventKey,
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
  idempotencyKey?: string | null
  metadata?: Record<string, unknown>
}) {
  const rules = (await getEmailEventRules(input.companyId))
    .filter((rule) => rule.event_key === normalizeEmailEventKey(input.eventKey) && rule.enabled && rule.send_to_customer)

  const results = []
  for (const rule of rules) {
    results.push(await sendCompanyEmail({
      companyId: input.companyId,
      customerId: input.customerId ?? null,
      eventKey: normalizeEmailEventKey(input.eventKey),
      templateKey: rule.template_key,
      to: input.to,
      variables: input.variables ?? {},
      createdBy: input.createdBy ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: input.metadata ?? {},
    }))
  }

  return results
}
