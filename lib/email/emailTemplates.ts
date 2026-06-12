import { supabaseService } from '@/lib/supabase/service'

export type CompanyEmailTemplate = {
  id: string
  company_id: string
  template_key: string
  name: string
  subject: string
  body_html: string
  body_text: string | null
  language: string
  is_active: boolean
  created_at: string
  updated_at: string
}

type TemplateInput = {
  name?: string
  subject?: string
  bodyHtml?: string
  bodyText?: string | null
  language?: string
  isActive?: boolean
}

export const EMAIL_TEMPLATE_VARIABLES = [
  'customer_name',
  'first_name',
  'last_name',
  'customer_email',
  'customer_phone',
  'customer_number',
  'company_name',
  'contract_name',
  'start_date',
  'facility_id',
  'metering_point_id',
  'support_email',
  'cancellation_deadline',
  'portal_url',
]

export const DEFAULT_EMAIL_TEMPLATES = [
  {
    template_key: 'contract.application_received',
    name: 'Ansökan mottagen',
    subject: 'Vi har tagit emot din ansökan hos {{company_name}}',
    body_html: '<p>Hej {{customer_name}},</p><p>Vi har tagit emot din ansökan om elavtal hos {{company_name}}.</p><p>Kundnummer: {{customer_number}}.</p><p>Vi kontrollerar uppgifterna och återkommer om något behöver kompletteras.</p><p>Har du frågor når du oss på {{support_email}}.</p>',
    body_text: 'Hej {{customer_name}}, vi har tagit emot din ansökan om elavtal hos {{company_name}}. Kundnummer: {{customer_number}}. Vi återkommer om något behöver kompletteras.',
  },
  {
    template_key: 'switch.started',
    name: 'Leverantörsbyte startat',
    subject: 'Ditt leverantörsbyte är startat',
    body_html: '<p>Hej {{customer_name}},</p><p>Vi har startat leverantörsbytet till {{company_name}}.</p><p>Anläggning: {{facility_id}}. Mätpunkt: {{metering_point_id}}.</p><p>Vi kontaktar dig om någon uppgift behöver kompletteras.</p>',
    body_text: 'Hej {{customer_name}}, vi har startat leverantörsbytet till {{company_name}}. Vi kontaktar dig om någon uppgift behöver kompletteras.',
  },
  {
    template_key: 'switch.confirmed',
    name: 'Leverantörsbyte bekräftat',
    subject: 'Ditt leverantörsbyte är bekräftat',
    body_html: '<p>Hej {{customer_name}},</p><p>Leverantörsbytet är bekräftat och {{company_name}} startar leveransen {{start_date}}.</p><p>Anläggning: {{facility_id}}. Mätpunkt: {{metering_point_id}}.</p>',
    body_text: 'Hej {{customer_name}}, leverantörsbytet är bekräftat och {{company_name}} startar leveransen {{start_date}}.',
  },
  {
    template_key: 'switch.action_required',
    name: 'Leverantörsbyte kräver åtgärd',
    subject: 'Vi behöver komplettera ditt leverantörsbyte',
    body_html: '<p>Hej {{customer_name}},</p><p>Leverantörsbytet kunde inte slutföras automatiskt. Vi behöver kontrollera eller komplettera uppgifter innan bytet kan fortsätta.</p><p>Kontakta oss på {{support_email}} om du har frågor.</p>',
    body_text: 'Hej {{customer_name}}, leverantörsbytet kunde inte slutföras automatiskt. Vi behöver kontrollera eller komplettera uppgifter innan bytet kan fortsätta.',
  },
  {
    template_key: 'customer.welcome_active',
    name: 'Välkommen som aktiv kund',
    subject: 'Välkommen som kund hos {{company_name}}',
    body_html: '<p>Hej {{customer_name}},</p><p>Välkommen som aktiv kund hos {{company_name}}.</p><p>Ditt kundnummer är {{customer_number}}.</p><p>Du kan nå oss på {{support_email}}.</p>',
    body_text: 'Hej {{customer_name}}, välkommen som aktiv kund hos {{company_name}}. Ditt kundnummer är {{customer_number}}.',
  },
]

const DEFAULT_BY_KEY = new Map(DEFAULT_EMAIL_TEMPLATES.map((template) => [template.template_key, template]))

export async function getCompanyEmailTemplates(companyId: string): Promise<CompanyEmailTemplate[]> {
  const { data, error } = await supabaseService
    .from('company_email_templates')
    .select('*')
    .eq('company_id', companyId)
    .order('template_key', { ascending: true })

  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return []
    throw error
  }

  return (data ?? []) as CompanyEmailTemplate[]
}

export async function getCompanyEmailTemplate(companyId: string, templateKey: string, language = 'sv') {
  const { data, error } = await supabaseService
    .from('company_email_templates')
    .select('*')
    .eq('company_id', companyId)
    .eq('template_key', templateKey)
    .eq('language', language)
    .eq('is_active', true)
    .maybeSingle()

  if (error && !['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) throw error
  if (data) return data as CompanyEmailTemplate

  const fallback = DEFAULT_BY_KEY.get(templateKey)
  if (!fallback) return null

  return {
    id: `system-default:${templateKey}:${language}`,
    company_id: companyId,
    template_key: fallback.template_key,
    name: fallback.name,
    subject: fallback.subject,
    body_html: fallback.body_html,
    body_text: fallback.body_text,
    language,
    is_active: true,
    created_at: 'system-default',
    updated_at: 'system-default',
  } as CompanyEmailTemplate
}

export async function upsertCompanyEmailTemplate(companyId: string, templateKey: string, input: TemplateInput) {
  const fallback = DEFAULT_BY_KEY.get(templateKey)
  if (!fallback) throw new Error('Okänd e-postmall.')

  const payload = {
    company_id: companyId,
    template_key: templateKey,
    name: input.name?.trim() || fallback.name,
    subject: input.subject?.trim() || fallback.subject,
    body_html: input.bodyHtml?.trim() || fallback.body_html,
    body_text: input.bodyText?.trim() || fallback.body_text,
    language: input.language?.trim() || 'sv',
    is_active: input.isActive ?? true,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabaseService
    .from('company_email_templates')
    .upsert(payload, { onConflict: 'company_id,template_key,language' })
    .select('*')
    .single()

  if (error) throw error
  return data as CompanyEmailTemplate
}

export async function seedDefaultEmailTemplates(companyId: string) {
  const { error } = await supabaseService
    .from('company_email_templates')
    .upsert(DEFAULT_EMAIL_TEMPLATES.map((template) => ({
      ...template,
      company_id: companyId,
      language: 'sv',
      is_active: true,
      updated_at: new Date().toISOString(),
    })), { onConflict: 'company_id,template_key,language', ignoreDuplicates: true })

  if (error) throw error
}

export async function resetEmailTemplateToDefault(companyId: string, templateKey: string) {
  const fallback = DEFAULT_BY_KEY.get(templateKey)
  if (!fallback) throw new Error('Okänd e-postmall.')

  return upsertCompanyEmailTemplate(companyId, templateKey, {
    name: fallback.name,
    subject: fallback.subject,
    bodyHtml: fallback.body_html,
    bodyText: fallback.body_text,
    language: 'sv',
    isActive: true,
  })
}
