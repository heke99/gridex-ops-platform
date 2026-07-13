import { supabaseService } from '@/lib/supabase/service'
import { sendCompanyEmail } from './sendCompanyEmail'
import type { EmailAttachment } from './providers/types'

export type EmailEventDispatchResult =
  | Awaited<ReturnType<typeof sendCompanyEmail>>
  | { ok: false; skipped: true; eventKey: string; reason: string }

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
  { event_key: 'contract.confirmation_sent', template_key: 'contract.confirmation_sent' },
  { event_key: 'contract.cooling_off_sent', template_key: 'contract.cooling_off_sent' },
  { event_key: 'switch.started', template_key: 'switch.started' },
  { event_key: 'switch.confirmed', template_key: 'switch.confirmed' },
  { event_key: 'switch.action_required', template_key: 'switch.action_required' },
  { event_key: 'customer.welcome_active', template_key: 'customer.welcome_active' },
]

const DEFAULT_TEMPLATE_BY_EVENT = new Map(DEFAULT_EMAIL_EVENT_RULES.map((rule) => [rule.event_key, rule.template_key]))

const LEGACY_TEMPLATE_KEYS = new Set([
  'contract_confirmation',
  'cancellation_right',
  'cancellation_right_started',
])

const EVENT_ALIASES: Record<string, string> = {
  contract_signed: 'contract.confirmation_sent',
  'contract.signed': 'contract.confirmation_sent',
  customer_created: 'customer.welcome_active',
  'customer.created': 'customer.welcome_active',
  delivery_start_confirmed: 'customer.welcome_active',
  supplier_switch_started: 'switch.started',
  supplier_switch_confirmed: 'switch.confirmed',
  supplier_switch_failed: 'switch.action_required',
  missing_customer_information: 'switch.action_required',
  cancellation_right_started: 'contract.cooling_off_sent',
  'contract.cancellation_right_started': 'contract.cooling_off_sent',
}

export function normalizeEmailEventKey(eventKey: string) {
  return EVENT_ALIASES[eventKey] ?? eventKey
}

function isAllowedRuleForEvent(rule: Pick<EmailEventRule, 'template_key'>, normalizedEventKey: string) {
  const expectedTemplateKey = DEFAULT_TEMPLATE_BY_EVENT.get(normalizedEventKey)
  if (!expectedTemplateKey) return false
  return rule.template_key === expectedTemplateKey && !LEGACY_TEMPLATE_KEYS.has(rule.template_key)
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

  const enabled = input.enabled ?? true
  const { data, error } = await supabaseService
    .from('email_event_rules')
    .upsert({
      company_id: companyId,
      event_key: normalizedEventKey,
      template_key: fallback.template_key,
      enabled,
      is_active: enabled,
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
  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('email_event_rules')
    .upsert(DEFAULT_EMAIL_EVENT_RULES.map((rule) => ({
      company_id: companyId,
      event_key: rule.event_key,
      template_key: rule.template_key,
      enabled: true,
      is_active: true,
      delay_minutes: 0,
      send_to_customer: true,
      send_to_admin: false,
      updated_at: now,
    })), { onConflict: 'company_id,event_key,template_key', ignoreDuplicates: true })

  if (error) throw error

  await supabaseService
    .from('email_event_rules')
    .update({ enabled: false, is_active: false, updated_at: now })
    .eq('company_id', companyId)
    .or(`template_key.in.(${Array.from(LEGACY_TEMPLATE_KEYS).join(',')}),and(event_key.eq.contract.application_received,template_key.neq.contract.application_received),and(event_key.eq.contract.confirmation_sent,template_key.neq.contract.confirmation_sent),and(event_key.eq.contract.cooling_off_sent,template_key.neq.contract.cooling_off_sent)`)
    .then(({ error: legacyError }) => {
      if (legacyError && !['42P01', '42703', 'PGRST205'].includes(legacyError.code ?? '')) throw legacyError
    })
}

export async function triggerEmailEvent(input: {
  companyId: string
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  eventKey: string
  to: string
  adminTo?: string | null
  variables?: Record<string, string | number | null | undefined>
  createdBy?: string | null
  idempotencyKey?: string | null
  metadata?: Record<string, unknown>
  attachments?: EmailAttachment[]
}) {
  const normalizedEventKey = normalizeEmailEventKey(input.eventKey)
  const fallbackTemplateKey = DEFAULT_TEMPLATE_BY_EVENT.get(normalizedEventKey)
  if (!fallbackTemplateKey) return []

  const rules = await getEmailEventRules(input.companyId)
  const matchingRules = rules.filter((rule) => rule.event_key === normalizedEventKey && isAllowedRuleForEvent(rule, normalizedEventKey))
  const dispatchRules: Array<Pick<EmailEventRule, 'event_key' | 'template_key' | 'enabled' | 'delay_minutes' | 'send_to_customer' | 'send_to_admin'>> =
    matchingRules.length > 0
      ? matchingRules
      : [{
          event_key: normalizedEventKey,
          template_key: fallbackTemplateKey,
          enabled: true,
          delay_minutes: 0,
          send_to_customer: true,
          send_to_admin: false,
        }]

  const results: EmailEventDispatchResult[] = []
  for (const rule of dispatchRules) {
    const recipients = [
      ...(rule.send_to_customer ? [{ role: 'customer', email: input.to }] : []),
      ...(rule.send_to_admin && input.adminTo ? [{ role: 'admin', email: input.adminTo }] : []),
    ].filter((recipient, index, all) => all.findIndex((candidate) => candidate.email.toLowerCase() === recipient.email.toLowerCase()) === index)

    if (recipients.length === 0) {
      results.push({
        ok: false,
        skipped: true,
        eventKey: normalizedEventKey,
        reason: rule.send_to_admin && !input.adminTo ? 'admin_recipient_missing' : 'no_enabled_recipient',
      })
      continue
    }

    for (const recipient of recipients) {
      results.push(await sendCompanyEmail({
        companyId: input.companyId,
        customerId: input.customerId ?? null,
        siteId: input.siteId ?? null,
        meteringPointId: input.meteringPointId ?? null,
        eventKey: normalizedEventKey,
        templateKey: rule.template_key,
        to: recipient.email,
        variables: input.variables ?? {},
        createdBy: input.createdBy ?? null,
        idempotencyKey: `${input.idempotencyKey ?? 'default'}:${recipient.role}`,
        delayMinutes: rule.delay_minutes,
        attachments: input.attachments ?? [],
        metadata: {
          ...(input.metadata ?? {}),
          requested_event_key: input.eventKey,
          normalized_event_key: normalizedEventKey,
          fallback_rule_used: matchingRules.length === 0,
          recipient_role: recipient.role,
          configured_delay_minutes: rule.delay_minutes,
          configured_send_to_customer: rule.send_to_customer,
          configured_send_to_admin: rule.send_to_admin,
        },
      }))
    }
  }

  return results
}
