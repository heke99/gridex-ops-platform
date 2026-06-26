// lib/email/manualGridOwnerTemplates.ts
//
// Versioned Swedish templates for the manual (non-Ediel) grid-owner
// communication pipeline. These are deliberately NOT Ediel: they are plain
// business e-mails sent via Resend to a grid owner / current supplier when
// information is missing, when a power of attorney must be presented, or when a
// manual exception must be handled.
//
// Templates do not expose implementation-specific technical IDs to the
// recipient beyond the human case reference.

export type ManualEmailTemplateKey =
  | 'facility_information_request'
  | 'supplier_switch_manual'
  | 'power_of_attorney_request'
  | 'ai_list_request'
  | 'reminder'
  | 'escalation'

export type ManualEmailTemplate = {
  key: ManualEmailTemplateKey
  version: string
  subject: string
  body: string
}

export type ManualEmailTemplateVariables = {
  case_reference?: string | null
  customer_number?: string | null
  customer_name?: string | null
  customer_identity?: string | null
  site_address?: string | null
  postal_code?: string | null
  city?: string | null
  ops_sender_name?: string | null
  tenant_company_name?: string | null
}

// Bumping a version is a content change that downstream audit can reference.
export const MANUAL_EMAIL_TEMPLATES: Record<ManualEmailTemplateKey, ManualEmailTemplate> = {
  facility_information_request: {
    key: 'facility_information_request',
    version: '2026-06-26-v1',
    subject: '[{{case_reference}}] Begäran om anläggningsuppgifter inför leverantörsbyte',
    body: `Hej,

Vi företräder kunden enligt bifogad fullmakt och begär uppgifter för att kunna genomföra leverantörsbyte.

Ärendenummer: {{case_reference}}
Kundnummer hos oss: {{customer_number}}

Kund:
Namn: {{customer_name}}
Person-/organisationsnummer: {{customer_identity}}
Adress: {{site_address}}
Postnummer/ort: {{postal_code}} {{city}}

Vi önskar få följande uppgifter:
- Anläggnings-ID
- Nätavräkningsområde / områdes-ID
- Årsenergi
- Befintligt elhandelsföretag
- Uppsägningstid
- Slutdatum för befintligt elprisavtal
- Mätmetod / rapporteringsfrekvens om tillgängligt
- Övriga uppgifter som behövs inför leverantörsbyte

Fullmakt bifogas.

Vänligen besvara detta mejl och behåll ärendenumret i ämnesraden.

Med vänlig hälsning,
{{ops_sender_name}} på uppdrag av {{tenant_company_name}}`,
  },
  supplier_switch_manual: {
    key: 'supplier_switch_manual',
    version: '2026-06-26-v1',
    subject: '[{{case_reference}}] Begäran om manuell hantering av leverantörsbyte',
    body: `Hej,

Vi företräder kunden enligt bifogad fullmakt och begär manuell hantering av leverantörsbyte som inte kan hanteras via ordinarie elektroniskt flöde.

Ärendenummer: {{case_reference}}
Kundnummer hos oss: {{customer_number}}

Kund:
Namn: {{customer_name}}
Person-/organisationsnummer: {{customer_identity}}
Adress: {{site_address}}
Postnummer/ort: {{postal_code}} {{city}}

Fullmakt bifogas.

Vänligen besvara detta mejl och behåll ärendenumret i ämnesraden.

Med vänlig hälsning,
{{ops_sender_name}} på uppdrag av {{tenant_company_name}}`,
  },
  power_of_attorney_request: {
    key: 'power_of_attorney_request',
    version: '2026-06-26-v1',
    subject: '[{{case_reference}}] Fullmakt för hantering av kundens ärende',
    body: `Hej,

Vi företräder kunden i ärende {{case_reference}}. Bifogad fullmakt styrker vår behörighet att begära och ta emot uppgifter samt hantera leverantörsbyte för kundens räkning.

Kund:
Namn: {{customer_name}}
Person-/organisationsnummer: {{customer_identity}}
Adress: {{site_address}}
Postnummer/ort: {{postal_code}} {{city}}

Fullmakt bifogas.

Vänligen besvara detta mejl och behåll ärendenumret i ämnesraden.

Med vänlig hälsning,
{{ops_sender_name}} på uppdrag av {{tenant_company_name}}`,
  },
  ai_list_request: {
    key: 'ai_list_request',
    version: '2026-06-26-v1',
    subject: '[{{case_reference}}] Begäran om strukturerad anläggningslista (AI-lista)',
    body: `Hej,

Vi företräder kunden enligt bifogad fullmakt och begär en strukturerad lista över anläggningar och tillhörande uppgifter inför avstämning.

Ärendenummer: {{case_reference}}
Kundnummer hos oss: {{customer_number}}

Kund:
Namn: {{customer_name}}
Person-/organisationsnummer: {{customer_identity}}

Fullmakt bifogas.

Vänligen besvara detta mejl och behåll ärendenumret i ämnesraden.

Med vänlig hälsning,
{{ops_sender_name}} på uppdrag av {{tenant_company_name}}`,
  },
  reminder: {
    key: 'reminder',
    version: '2026-06-26-v1',
    subject: '[{{case_reference}}] Påminnelse: begäran om anläggningsuppgifter',
    body: `Hej,

Vi vill påminna om vår tidigare begäran i ärende {{case_reference}} avseende uppgifter inför leverantörsbyte.

Kund:
Namn: {{customer_name}}
Adress: {{site_address}}
Postnummer/ort: {{postal_code}} {{city}}

Fullmakt bifogades den ursprungliga begäran.

Vänligen besvara detta mejl och behåll ärendenumret i ämnesraden.

Med vänlig hälsning,
{{ops_sender_name}} på uppdrag av {{tenant_company_name}}`,
  },
  escalation: {
    key: 'escalation',
    version: '2026-06-26-v1',
    subject: '[{{case_reference}}] Eskalering: utebliven återkoppling',
    body: `Hej,

Vi har inte fått återkoppling i ärende {{case_reference}} trots tidigare begäran och påminnelse. Vi ber er hantera ärendet skyndsamt.

Kund:
Namn: {{customer_name}}
Adress: {{site_address}}
Postnummer/ort: {{postal_code}} {{city}}

Fullmakt bifogades den ursprungliga begäran.

Vänligen besvara detta mejl och behåll ärendenumret i ämnesraden.

Med vänlig hälsning,
{{ops_sender_name}} på uppdrag av {{tenant_company_name}}`,
  },
}

function applyVariables(template: string, variables: ManualEmailTemplateVariables): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, key: string) => {
    const value = (variables as Record<string, unknown>)[key]
    return value === null || value === undefined || value === '' ? '' : String(value)
  })
}

export type RenderedManualEmail = {
  templateKey: ManualEmailTemplateKey
  templateVersion: string
  subject: string
  bodyText: string
  bodyHtml: string
}

export function renderManualEmailTemplate(
  key: ManualEmailTemplateKey,
  variables: ManualEmailTemplateVariables,
): RenderedManualEmail {
  const template = MANUAL_EMAIL_TEMPLATES[key]
  const subject = applyVariables(template.subject, variables).replace(/\s+/g, ' ').trim()
  const bodyText = applyVariables(template.body, variables)
  const bodyHtml = `<pre style="font-family: inherit; white-space: pre-wrap; margin: 0;">${escapeHtml(bodyText)}</pre>`
  return {
    templateKey: key,
    templateVersion: template.version,
    subject,
    bodyText,
    bodyHtml,
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
