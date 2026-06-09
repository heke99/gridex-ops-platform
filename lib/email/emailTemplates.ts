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
    template_key: 'contract_confirmation',
    name: 'Avtalsbekräftelse',
    subject: 'Avtalsbekräftelse från {{company_name}}',
    body_html: '<p>Hej {{customer_name}},</p><p>Tack för att du har tecknat avtal med {{company_name}}. Kundnummer {{customer_number}}. Ditt avtal {{contract_name}} är mottaget och hanteras nu av oss.</p><p>Planerad start: {{start_date}}.</p><p>Kontakta oss på {{support_email}} om du har frågor.</p>',
    body_text: 'Hej {{customer_name}}, tack för att du har tecknat avtal med {{company_name}}. Kundnummer {{customer_number}}. Ditt avtal {{contract_name}} är mottaget. Planerad start: {{start_date}}.',
  },
  {
    template_key: 'welcome_email',
    name: 'Välkomstmail',
    subject: 'Välkommen till {{company_name}}',
    body_html: '<p>Hej {{customer_name}},</p><p>Välkommen som kund hos {{company_name}}. Ditt kundnummer är {{customer_number}}. Vi återkommer när nästa steg i ditt kundärende är klart.</p><p>Du kan nå oss på {{support_email}}.</p>',
    body_text: 'Hej {{customer_name}}, välkommen som kund hos {{company_name}}. Vi återkommer när nästa steg är klart.',
  },
  {
    template_key: 'cancellation_right',
    name: 'Ångerrätt',
    subject: 'Information om ångerrätt',
    body_html: '<p>Hej {{customer_name}},</p><p>Du har rätt att ångra ditt avtal enligt gällande villkor. Sista dag för ånger är {{cancellation_deadline}}.</p><p>Kontakta {{support_email}} om du vill använda ångerrätten.</p>',
    body_text: 'Hej {{customer_name}}, du har rätt att ångra ditt avtal. Sista dag för ånger är {{cancellation_deadline}}.',
  },
  {
    template_key: 'delivery_start_confirmed',
    name: 'Leveransstart bekräftad',
    subject: 'Din leveransstart är bekräftad',
    body_html: '<p>Hej {{customer_name}},</p><p>Leveransstart hos {{company_name}} är bekräftad från {{start_date}}.</p><p>Anläggning: {{facility_id}}. Mätpunkt: {{metering_point_id}}.</p>',
    body_text: 'Hej {{customer_name}}, leveransstart hos {{company_name}} är bekräftad från {{start_date}}.',
  },
  {
    template_key: 'switch_started',
    name: 'Leverantörsbyte påbörjat',
    subject: 'Ditt leverantörsbyte är påbörjat',
    body_html: '<p>Hej {{customer_name}},</p><p>Vi har påbörjat leverantörsbytet till {{company_name}}. Vi kontaktar dig om någon uppgift behöver kompletteras.</p>',
    body_text: 'Hej {{customer_name}}, vi har påbörjat leverantörsbytet till {{company_name}}.',
  },
  {
    template_key: 'switch_confirmed',
    name: 'Leverantörsbyte klart',
    subject: 'Ditt leverantörsbyte är klart',
    body_html: '<p>Hej {{customer_name}},</p><p>Leverantörsbytet är bekräftat. {{company_name}} startar leveransen {{start_date}}.</p>',
    body_text: 'Hej {{customer_name}}, leverantörsbytet är bekräftat. {{company_name}} startar leveransen {{start_date}}.',
  },
  {
    template_key: 'switch_failed',
    name: 'Leverantörsbyte misslyckades',
    subject: 'Vi behöver kontrollera ditt leverantörsbyte',
    body_html: '<p>Hej {{customer_name}},</p><p>Leverantörsbytet kunde inte slutföras automatiskt. Vi granskar ärendet och kontaktar dig om vi behöver mer information.</p>',
    body_text: 'Hej {{customer_name}}, leverantörsbytet kunde inte slutföras automatiskt. Vi granskar ärendet.',
  },
  {
    template_key: 'missing_information',
    name: 'Saknade uppgifter',
    subject: 'Vi behöver kompletterande uppgifter',
    body_html: '<p>Hej {{customer_name}},</p><p>Vi behöver kompletterande uppgifter för att kunna hantera ditt ärende hos {{company_name}}.</p><p>Öppna {{portal_url}} eller kontakta {{support_email}}.</p>',
    body_text: 'Hej {{customer_name}}, vi behöver kompletterande uppgifter. Öppna {{portal_url}} eller kontakta {{support_email}}.',
  },
  {
    template_key: 'power_of_attorney_confirmation',
    name: 'Fullmaktsbekräftelse',
    subject: 'Fullmakt mottagen',
    body_html: '<p>Hej {{customer_name}},</p><p>Vi har tagit emot din fullmakt. Den används endast för att hantera ditt ärende hos {{company_name}}.</p>',
    body_text: 'Hej {{customer_name}}, vi har tagit emot din fullmakt för ärendet hos {{company_name}}.',
  },
  {
    template_key: 'customer_ended',
    name: 'Kund avslutad',
    subject: 'Bekräftelse på avslut',
    body_html: '<p>Hej {{customer_name}},</p><p>Vi bekräftar att kundrelationen hos {{company_name}} är avslutad. Historik sparas enligt gällande regler.</p>',
    body_text: 'Hej {{customer_name}}, vi bekräftar att kundrelationen hos {{company_name}} är avslutad.',
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
  return data as CompanyEmailTemplate | null
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
