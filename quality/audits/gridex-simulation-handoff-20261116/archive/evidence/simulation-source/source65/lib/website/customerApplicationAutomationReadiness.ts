import { supabaseService } from '@/lib/supabase/service'
import { DEFAULT_EMAIL_EVENT_RULES } from '@/lib/email/emailEvents'
import { DEFAULT_EMAIL_TEMPLATES, type CompanyEmailTemplate } from '@/lib/email/emailTemplates'
import { renderEmailTemplate } from '@/lib/email/templateRenderer'
import { sampleEmailVariablesForEvent } from '@/lib/email/eventVariableContracts'
import { validateAutomationUserConfig } from '@/lib/customer-operations/automationConfig'

export type CustomerApplicationAutomationReadiness = {
  ready: boolean
  blockers: string[]
  warnings: string[]
  checks: Record<string, boolean>
}

function validUuid(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
}

function schemaMissing(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(row?.code ?? '') || /does not exist|schema cache|column .* does not exist/i.test(row?.message ?? '')
}

const MANDATORY_EMAIL_KEYS = new Set([
  'contract.application_received',
  'contract.confirmation_sent',
  'contract.cooling_off_sent',
  'contract.power_of_attorney_required',
  'contract.facility_id_required',
  'contract.customer_information_required',
  'switch.action_required',
])

function templateRenderCheck(
  templatesByKey: Map<string, CompanyEmailTemplate>,
  keys: string[],
): { ok: boolean; failures: string[] } {
  const failures: string[] = []
  for (const key of keys) {
    const template = templatesByKey.get(key)
    if (!template || template.is_active === false) {
      failures.push(`${key}:missing_or_inactive`)
      continue
    }
    try {
      renderEmailTemplate(template, sampleEmailVariablesForEvent(key), { eventKey: key })
    } catch (error) {
      failures.push(`${key}:${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { ok: failures.length === 0, failures }
}

export async function evaluateCustomerApplicationAutomationReadiness(companyId: string): Promise<CustomerApplicationAutomationReadiness> {
  const [automationUser, sender, templates, rules, manualMailbox, contacts, runtimeContract] = await Promise.all([
    validateAutomationUserConfig(),
    supabaseService.from('company_email_settings').select('id').eq('company_id', companyId).in('verification_status', ['verified', 'completed', 'active']).limit(1),
    supabaseService.from('company_email_templates').select('id,company_id,template_key,name,subject,body_html,body_text,language,is_active,created_at,updated_at').eq('company_id', companyId).eq('language', 'sv'),
    supabaseService.from('email_event_rules').select('event_key,template_key,enabled,is_active').eq('company_id', companyId),
    supabaseService.from('manual_communication_mailboxes').select('id,company_id').eq('environment', 'production').eq('is_active', true).eq('is_verified', true).or(`company_id.is.null,company_id.eq.${companyId}`).limit(1),
    supabaseService.from('grid_owner_contact_channels').select('id').eq('channel_type', 'email').eq('is_enabled', true).or(`company_id.is.null,company_id.eq.${companyId}`).limit(1),
    supabaseService.rpc('gridex_customer_application_runtime_contract_v1'),
  ])

  for (const result of [sender, templates, rules, manualMailbox, contacts]) {
    if (result.error && !schemaMissing(result.error)) throw result.error
  }

  const runtimeContractData = runtimeContract.error
    ? null
    : runtimeContract.data as { ready?: boolean; checks?: Record<string, boolean> } | null
  const templateRows = (templates.data ?? []) as CompanyEmailTemplate[]
  const ruleRows = (rules.data ?? []) as Array<{ event_key: string; template_key: string; enabled: boolean; is_active: boolean | null }>
  const activeTemplateKeys = new Set(templateRows.filter((row) => row.is_active !== false).map((row) => row.template_key))
  const activeRulePairs = new Set(ruleRows.filter((row) => row.enabled === true && row.is_active !== false).map((row) => `${row.event_key}:${row.template_key}`))
  const templatesByKey = new Map(templateRows.map((row) => [row.template_key, row]))
  const requiredTemplateKeys = DEFAULT_EMAIL_TEMPLATES.filter((row) => MANDATORY_EMAIL_KEYS.has(row.template_key)).map((row) => row.template_key)
  const requiredRulePairs = DEFAULT_EMAIL_EVENT_RULES.filter((row) => MANDATORY_EMAIL_KEYS.has(row.event_key)).map((row) => `${row.event_key}:${row.template_key}`)
  const optionalTemplateKeys = DEFAULT_EMAIL_TEMPLATES.filter((row) => !MANDATORY_EMAIL_KEYS.has(row.template_key)).map((row) => row.template_key)
  const optionalRulePairs = DEFAULT_EMAIL_EVENT_RULES.filter((row) => !MANDATORY_EMAIL_KEYS.has(row.event_key)).map((row) => `${row.event_key}:${row.template_key}`)
  const requiredRender = templateRenderCheck(templatesByKey, requiredTemplateKeys)
  const optionalRender = templateRenderCheck(templatesByKey, optionalTemplateKeys)

  const checks = {
    automation_user_configured: validUuid(process.env.GRIDEX_AUTOMATION_USER_ID),
    automation_user_verified: automationUser.ok,
    cron_secret_configured: Boolean(process.env.CUSTOMER_OPERATION_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim()),
    runtime_contract_ready: runtimeContractData?.ready === true,
    verified_customer_email_sender: Boolean(sender.data?.length),
    required_email_templates_active: requiredTemplateKeys.every((key) => activeTemplateKeys.has(key)),
    required_email_rules_active: requiredRulePairs.every((key) => activeRulePairs.has(key)),
    required_email_templates_renderable: requiredRender.ok,
    optional_email_templates_active: optionalTemplateKeys.every((key) => activeTemplateKeys.has(key)),
    optional_email_rules_active: optionalRulePairs.every((key) => activeRulePairs.has(key)),
    optional_email_templates_renderable: optionalRender.ok,
    manual_operations_mailbox_ready: Boolean(manualMailbox.data?.length),
    grid_owner_email_contacts_available: Boolean(contacts.data?.length),
  }

  const blockers: string[] = []
  const warnings: string[] = []
  if (!checks.automation_user_configured) blockers.push('GRIDEX_AUTOMATION_USER_ID saknas eller är inte ett giltigt UUID.')
  else if (!checks.automation_user_verified) blockers.push(automationUser.message ?? 'GRIDEX_AUTOMATION_USER_ID kunde inte verifieras mot auth.users.')
  if (!checks.cron_secret_configured) blockers.push('CUSTOMER_OPERATION_CRON_SECRET eller CRON_SECRET saknas; kundautomationens workers kan inte skyddas eller köras.')
  if (!checks.runtime_contract_ready) blockers.push('Produktionsdatabasens runtime-kontrakt för kundautomation är inte komplett; automatisk fortsättning stoppas tills schema, routes, pgcrypto och integritetstriggers är verifierade.')
  if (!checks.verified_customer_email_sender) blockers.push('Verifierad avsändaridentitet för obligatoriska kundmail saknas.')
  if (!checks.required_email_templates_active) blockers.push('En eller flera obligatoriska kundmailmallar saknas eller är inaktiva.')
  if (!checks.required_email_rules_active) blockers.push('En eller flera obligatoriska kundmailregler saknas eller är inaktiva.')
  if (!checks.required_email_templates_renderable) blockers.push(`En eller flera obligatoriska kundmailmallar bryter mot eventets variabelkontrakt: ${requiredRender.failures.join(' | ')}`)
  if (!checks.optional_email_templates_active) warnings.push('En eller flera valfria statusmailmallar saknas eller är inaktiva.')
  if (!checks.optional_email_rules_active) warnings.push('En eller flera valfria statusmailregler saknas eller är inaktiva.')
  if (!checks.optional_email_templates_renderable) warnings.push(`En eller flera valfria statusmailmallar kan inte renderas mot eventets variabelkontrakt: ${optionalRender.failures.join(' | ')}`)
  if (!checks.manual_operations_mailbox_ready) blockers.push('Verifierad production-mailbox för manuell nätägarkommunikation saknas.')
  if (!checks.grid_owner_email_contacts_available) warnings.push('Ingen aktiv nätägarkontakt via e-post hittades; berörda nätområden kommer kräva manuell granskning.')

  return { ready: blockers.length === 0, blockers, warnings, checks }
}
