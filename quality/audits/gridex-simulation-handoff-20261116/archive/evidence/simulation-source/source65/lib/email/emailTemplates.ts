import { supabaseService } from '@/lib/supabase/service'
import { EMAIL_TEMPLATE_VARIABLES } from './eventVariableContracts'
import { validateEmailTemplateVariableContract } from './templateRenderer'

export { EMAIL_TEMPLATE_VARIABLES }

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

export type EmailTemplateRepairReport = {
  checked: number
  created: number
  repaired: number
  preserved: number
}

type TemplateInput = {
  name?: string
  subject?: string
  bodyHtml?: string
  bodyText?: string | null
  language?: string
  isActive?: boolean
}

export const DEFAULT_EMAIL_TEMPLATES = [
  {
    template_key: 'contract.application_received',
    name: 'Ansökan mottagen',
    subject: 'Vi har tagit emot din ansökan hos {{company_name}}',
    body_html: '<p>Hej {{customer_name}},</p><p>Vi har tagit emot din ansökan om elavtal hos {{company_name}}.</p><p>Kundnummer: {{customer_number}}.</p><p>Vi kontrollerar uppgifterna och återkommer om något behöver kompletteras.</p><p>Har du frågor når du oss på {{support_email}}.</p>',
    body_text: 'Hej {{customer_name}}, vi har tagit emot din ansökan om elavtal hos {{company_name}}. Kundnummer: {{customer_number}}. Vi återkommer om något behöver kompletteras.',
  },
  {
    template_key: 'contract.confirmation_sent',
    name: 'Avtalsbekräftelse',
    subject: 'Din avtalsbekräftelse från {{company_name}}',
    body_html: '<p>Hej {{customer_name}},</p><p>Ditt avtal {{contract_name}} hos {{company_name}} är tecknat.</p><p>Avtalsnummer: {{contract_number}}.<br>Kundnummer: {{customer_number}}.<br>Tecknat: {{signed_at}}.<br>Önskat startdatum: {{start_date}}.</p><p>Pris: {{price_summary}}</p><p>Juridiska versioner: {{legal_versions_summary}}</p><p>Referens: {{offer_reference}}</p><p>{{agreement_pdf_note}}</p><p>Har du frågor når du oss på {{support_email}}.</p>',
    body_text: 'Hej {{customer_name}}, ditt avtal {{contract_name}} hos {{company_name}} är tecknat. Avtalsnummer: {{contract_number}}. Kundnummer: {{customer_number}}. Tecknat: {{signed_at}}. Önskat startdatum: {{start_date}}. Pris: {{price_summary}}. Juridiska versioner: {{legal_versions_summary}}. Referens: {{offer_reference}}. {{agreement_pdf_note}}',
  },
  {
    template_key: 'contract.cooling_off_sent',
    name: 'Ångerrätt',
    subject: 'Information om ångerrätt från {{company_name}}',
    body_html: '<p>Hej {{customer_name}},</p><p>Här kommer information om din ångerrätt för avtalet hos {{company_name}}.</p><p>Ångerfristen gäller till {{cancellation_deadline}}.</p><p>Har du frågor når du oss på {{support_email}}.</p>',
    body_text: 'Hej {{customer_name}}, här kommer information om din ångerrätt för avtalet hos {{company_name}}. Ångerfristen gäller till {{cancellation_deadline}}.',
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
    body_html: '<p>Hej {{customer_name}},</p><p>{{case_message}}</p><p>Kontakta oss på {{support_email}} eller öppna {{portal_url}} om du behöver komplettera uppgifter.</p>',
    body_text: 'Hej {{customer_name}}, {{case_message}} Kontakta {{support_email}} eller öppna {{portal_url}} för att komplettera uppgifter.',
  },
  {
    template_key: 'contract.power_of_attorney_required',
    name: 'Begäran om fullmakt',
    subject: 'Fullmakt behövs för ditt avtal hos {{company_name}}',
    body_html: '<p>Hej {{customer_name}},</p><p>För att vi ska kunna fortsätta med avtalet {{contract_name}} behöver du lämna eller signera fullmakt.</p><p>Använd denna länk: {{power_of_attorney_url}}</p><p>Har du frågor når du oss på {{support_email}}.</p>',
    body_text: 'Hej {{customer_name}}, för att vi ska kunna fortsätta med avtalet {{contract_name}} behöver du lämna eller signera fullmakt. Länk: {{power_of_attorney_url}}. Frågor: {{support_email}}.',
  },
  {
    template_key: 'contract.facility_id_required',
    name: 'Begäran om anläggnings-ID',
    subject: 'Vi behöver ditt anläggnings-ID',
    body_html: '<p>Hej {{customer_name}},</p><p>Vi behöver anläggnings-ID eller mätpunkts-ID för att fortsätta ditt avtal hos {{company_name}}.</p><p>Svara med uppgiften eller komplettera den i portalen: {{portal_url}}</p>',
    body_text: 'Hej {{customer_name}}, vi behöver anläggnings-ID eller mätpunkts-ID för att fortsätta ditt avtal hos {{company_name}}. Komplettera i portalen: {{portal_url}}.',
  },
  {
    template_key: 'contract.customer_information_required',
    name: 'Begäran om kunduppgifter',
    subject: 'Ditt avtal behöver kompletteras',
    body_html: '<p>Hej {{customer_name}},</p><p>Vi behöver följande uppgifter för att fortsätta ditt avtal hos {{company_name}}:</p><p>{{required_information}}</p><p>Komplettera i portalen: {{portal_url}}</p>',
    body_text: 'Hej {{customer_name}}, vi behöver följande uppgifter för att fortsätta ditt avtal hos {{company_name}}: {{required_information}}. Portal: {{portal_url}}.',
  },
  {
    template_key: 'contract.completion_reminder',
    name: 'Påminnelse om komplettering',
    subject: 'Påminnelse: komplettera ditt avtal',
    body_html: '<p>Hej {{customer_name}},</p><p>Det finns fortfarande uppgifter som behöver kompletteras för avtalet {{contract_name}}.</p><p>{{required_information}}</p><p>Komplettera senast {{completion_deadline}} via {{portal_url}}.</p>',
    body_text: 'Hej {{customer_name}}, avtalet {{contract_name}} behöver fortfarande kompletteras: {{required_information}}. Komplettera senast {{completion_deadline}} via {{portal_url}}.',
  },
  {
    template_key: 'contract.rejected',
    name: 'Avtal avslaget',
    subject: 'Information om din avtalsansökan',
    body_html: '<p>Hej {{customer_name}},</p><p>Vi kan inte godkänna din ansökan om {{contract_name}} i nuvarande form.</p><p>Orsak: {{review_reason}}</p><p>Kontakta {{support_email}} om du vill få beslutet förklarat.</p>',
    body_text: 'Hej {{customer_name}}, vi kan inte godkänna din ansökan om {{contract_name}} i nuvarande form. Orsak: {{review_reason}}. Kontakta {{support_email}} vid frågor.',
  },
  {
    template_key: 'contract.manual_review',
    name: 'Manuell granskning',
    subject: 'Din avtalsansökan granskas manuellt',
    body_html: '<p>Hej {{customer_name}},</p><p>Din ansökan om {{contract_name}} hos {{company_name}} behöver granskas manuellt.</p><p>Orsak: {{review_reason}}</p><p>Vi återkommer när granskningen är klar.</p>',
    body_text: 'Hej {{customer_name}}, din ansökan om {{contract_name}} hos {{company_name}} behöver granskas manuellt. Orsak: {{review_reason}}. Vi återkommer när granskningen är klar.',
  },
  {
    template_key: 'customer.welcome_active',
    name: 'Välkommen som aktiv kund',
    subject: 'Välkommen som kund hos {{company_name}}',
    body_html: '<p>Hej {{first_name}},</p><p>Välkommen som aktiv kund hos {{company_name}}.</p><p>Ditt kundnummer är {{customer_number}}.</p><p>Du hittar dina uppgifter i kundportalen: {{portal_url}}</p><p>Du kan nå oss på {{support_email}}.</p>',
    body_text: 'Hej {{first_name}}, välkommen som aktiv kund hos {{company_name}}. Ditt kundnummer är {{customer_number}}. Kundportal: {{portal_url}}.',
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

  validateEmailTemplateVariableContract({
    template_key: payload.template_key,
    subject: payload.subject,
    body_html: payload.body_html,
    body_text: payload.body_text,
  }, templateKey)

  const { data, error } = await supabaseService
    .from('company_email_templates')
    .upsert(payload, { onConflict: 'company_id,template_key,language' })
    .select('*')
    .single()

  if (error) throw error
  return data as CompanyEmailTemplate
}

export async function seedDefaultEmailTemplates(companyId: string): Promise<EmailTemplateRepairReport> {
  const { data: existingRows, error: existingError } = await supabaseService
    .from('company_email_templates')
    .select('id,company_id,template_key,name,subject,body_html,body_text,language,is_active,created_at,updated_at')
    .eq('company_id', companyId)
    .eq('language', 'sv')

  if (existingError && !['42P01', '42703', 'PGRST205'].includes(existingError.code ?? '')) throw existingError

  const existing = (existingRows ?? []) as CompanyEmailTemplate[]
  const existingKeys = new Set(existing.map((row) => row.template_key))
  const now = new Date().toISOString()
  const missingRows = DEFAULT_EMAIL_TEMPLATES
    .filter((fallback) => !existingKeys.has(fallback.template_key))
    .map((fallback) => ({
      company_id: companyId,
      template_key: fallback.template_key,
      name: fallback.name,
      subject: fallback.subject,
      body_html: fallback.body_html,
      body_text: fallback.body_text,
      language: 'sv',
      is_active: true,
      updated_at: now,
    }))

  for (const template of missingRows) {
    validateEmailTemplateVariableContract(template, template.template_key)
  }

  if (missingRows.length > 0) {
    const { error } = await supabaseService
      .from('company_email_templates')
      .insert(missingRows)
    if (error && error.code !== '23505') throw error
  }

  return {
    checked: DEFAULT_EMAIL_TEMPLATES.length,
    created: missingRows.length,
    repaired: 0,
    preserved: DEFAULT_EMAIL_TEMPLATES.length - missingRows.length,
  }
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
