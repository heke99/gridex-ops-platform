import { getBaseAppUrl } from '@/lib/auth/urls'
import {
  getTenantEmailBranding,
  queueAndTrySendTenantEmail,
  renderTenantEmailLayout,
} from '@/lib/tenant/emailBranding'
import { supabaseService } from '@/lib/supabase/service'

export type TenantEmailTemplateKey =
  | 'customer_created'
  | 'switch_confirmation'
  | 'withdrawal_received'
  | 'move_out_confirmation'
  | 'cancellation_sent'

export type TenantEmailTemplateDefinition = {
  key: TenantEmailTemplateKey
  label: string
  description: string
  defaultSubject: string
  defaultIntro: string
  defaultBody: string
}

export type TenantEmailTemplateRow = {
  id: string
  company_id: string
  template_key: TenantEmailTemplateKey
  subject: string
  intro: string
  body: string
  is_active: boolean
  updated_at: string | null
}

export type TenantEmailTemplateContext = {
  companyId: string
  customerId?: string | null
  customerCaseId?: string | null
  customerName?: string | null
  customerEmail?: string | null
  caseTitle?: string | null
  caseTypeLabel?: string | null
  nextAction?: string | null
  portalUrl?: string | null
  actorUserId?: string | null
}

export const TENANT_EMAIL_TEMPLATE_DEFINITIONS: TenantEmailTemplateDefinition[] = [
  {
    key: 'customer_created',
    label: 'Kund skapad',
    description: 'Bekräftar att kunden är registrerad hos bolaget.',
    defaultSubject: 'Välkommen som kund hos {{companyName}}',
    defaultIntro: 'Hej {{customerName}}, vi har registrerat dig som kund hos {{companyName}}.',
    defaultBody: '<p>Vi återkommer när nästa steg i överflytten är klart. Du kan följa status via kundportalen.</p>',
  },
  {
    key: 'switch_confirmation',
    label: 'Överflytt påbörjad',
    description: 'Bekräftar att leverantörsbyte/överflytt hanteras.',
    defaultSubject: 'Din överflytt till {{companyName}} är påbörjad',
    defaultIntro: 'Hej {{customerName}}, vi har påbörjat överflytten till {{companyName}}.',
    defaultBody: '<p>Systemet hanterar meddelanden mot nätägare och tidigare leverantör automatiskt. Vi kontaktar dig om något behöver kompletteras.</p>',
  },
  {
    key: 'withdrawal_received',
    label: 'Ånger mottagen',
    description: 'Bekräftar ånger och stoppar relaterade flöden när det är möjligt.',
    defaultSubject: 'Vi har tagit emot din ånger',
    defaultIntro: 'Hej {{customerName}}, vi har tagit emot din ånger.',
    defaultBody: '<p>Vi kontrollerar om leverantörsbytet kan stoppas automatiskt. Om något kräver manuell hantering kontaktar vi dig.</p><p>Nästa steg: {{nextAction}}</p>',
  },
  {
    key: 'move_out_confirmation',
    label: 'Flytt/avslut bekräftad',
    description: 'Bekräftar att flytt eller avslut registrerats.',
    defaultSubject: 'Flytt eller avslut är registrerat',
    defaultIntro: 'Hej {{customerName}}, vi har registrerat flytt eller avslut för ditt avtal.',
    defaultBody: '<p>Historik, mätvärden och faktureringsunderlag sparas enligt lagkrav och för spårbarhet.</p>',
  },
  {
    key: 'cancellation_sent',
    label: 'Annullering skickad',
    description: 'Informerar kunden när annullering har initierats mot Ediel-flödet.',
    defaultSubject: 'Vi har skickat annullering av överflytten',
    defaultIntro: 'Hej {{customerName}}, vi har skickat annullering av överflytten.',
    defaultBody: '<p>Vi inväntar kvittens från motparten. Ärendet är fortsatt blockerat tills annulleringen är bekräftad.</p>',
  },
]

const TEMPLATE_BY_KEY = new Map(TENANT_EMAIL_TEMPLATE_DEFINITIONS.map((template) => [template.key, template]))

function replaceTokens(value: string, context: TenantEmailTemplateContext & { companyName: string }) {
  const tokens: Record<string, string> = {
    companyName: context.companyName,
    customerName: context.customerName ?? 'kund',
    caseTitle: context.caseTitle ?? '',
    caseType: context.caseTypeLabel ?? '',
    nextAction: context.nextAction ?? 'Vi återkommer med nästa steg.',
    portalUrl: context.portalUrl ?? getBaseAppUrl(),
  }

  return value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => tokens[key] ?? '')
}

export async function listTenantEmailTemplates(companyId: string): Promise<TenantEmailTemplateRow[]> {
  const { data, error } = await supabaseService
    .from('tenant_email_templates')
    .select('*')
    .eq('company_id', companyId)
    .order('template_key', { ascending: true })

  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return []
    throw error
  }

  return (data ?? []) as TenantEmailTemplateRow[]
}

export async function upsertTenantEmailTemplate(input: {
  companyId: string
  templateKey: TenantEmailTemplateKey
  subject: string
  intro: string
  body: string
  isActive: boolean
  actorUserId?: string | null
}) {
  const definition = TEMPLATE_BY_KEY.get(input.templateKey)
  if (!definition) throw new Error('Okänd e-postmall.')

  const { error } = await supabaseService.from('tenant_email_templates').upsert({
    company_id: input.companyId,
    template_key: input.templateKey,
    subject: input.subject.trim() || definition.defaultSubject,
    intro: input.intro.trim() || definition.defaultIntro,
    body: input.body.trim() || definition.defaultBody,
    is_active: input.isActive,
    updated_by: input.actorUserId ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id,template_key' })

  if (error) throw error
}

async function resolveTemplate(companyId: string, key: TenantEmailTemplateKey) {
  const definition = TEMPLATE_BY_KEY.get(key)
  if (!definition) throw new Error('Okänd e-postmall.')

  const { data, error } = await supabaseService
    .from('tenant_email_templates')
    .select('*')
    .eq('company_id', companyId)
    .eq('template_key', key)
    .eq('is_active', true)
    .maybeSingle()

  if (error && !['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) throw error
  const row = data as TenantEmailTemplateRow | null

  return {
    subject: row?.subject ?? definition.defaultSubject,
    intro: row?.intro ?? definition.defaultIntro,
    body: row?.body ?? definition.defaultBody,
  }
}

export async function queueTenantTemplateEmail(
  key: TenantEmailTemplateKey,
  context: TenantEmailTemplateContext
) {
  if (!context.customerEmail) return { ok: false, skipped: true, reason: 'customer_email_missing' }

  const branding = await getTenantEmailBranding(context.companyId)
  const template = await resolveTemplate(context.companyId, key)
  const tokenContext = {
    ...context,
    companyName: branding.displayName,
    portalUrl: context.portalUrl ?? branding.customerPortalUrl,
  }
  const subject = replaceTokens(template.subject, tokenContext)
  const intro = replaceTokens(template.intro, tokenContext)
  const body = replaceTokens(template.body, tokenContext)
  const html = renderTenantEmailLayout({
    branding,
    title: subject,
    intro,
    body,
    ctaLabel: 'Öppna kundportalen',
    ctaUrl: tokenContext.portalUrl,
  })

  return queueAndTrySendTenantEmail({
    companyId: context.companyId,
    customerId: context.customerId ?? null,
    customerCaseId: context.customerCaseId ?? null,
    emailType: key,
    toEmail: context.customerEmail,
    subject,
    htmlBody: html,
    textBody: `${intro}\n\n${body.replace(/<[^>]+>/g, ' ')}`,
    redirectUrl: tokenContext.portalUrl,
    actorUserId: context.actorUserId ?? null,
  })
}
