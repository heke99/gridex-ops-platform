// lib/email/manualGridOwnerTemplates.ts
//
// Versioned Swedish templates for manual (non-Ediel) business communication.
// Grid-owner facility data and current-supplier commercial contract data are
// deliberately separate responsibilities and must never be mixed in one request.

export type ManualEmailTemplateKey =
  | 'facility_information_request'
  | 'current_supplier_contract_information_request'
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
    version: '2026-08-21-v2',
    subject: '[{{case_reference}}] Begäran om anläggningsuppgifter inför leverantörsbyte',
    body: `Hej,

Vi företräder kunden enligt bifogad fullmakt och begär tekniska anläggningsuppgifter för att kunna genomföra rätt marknadsprocess.

Ärendenummer: {{case_reference}}
Kundnummer hos oss: {{customer_number}}

Kund:
Namn: {{customer_name}}
Person-/organisationsnummer: {{customer_identity}}
Adress: {{site_address}}
Postnummer/ort: {{postal_code}} {{city}}

Vi önskar få följande uppgifter:
- Anläggnings-ID
- Mätpunkts-ID, om separat identifierare används
- Nätavräkningsområde / områdes-ID
- Årsenergi
- Mätmetod
- Rapporteringsfrekvens
- Nuvarande elhandelsföretag, om uppgiften finns tillgänglig hos er

Vi begär inte kommersiella avtalsvillkor från nätägaren. Uppgifter om bindningstid, uppsägningstid, avtalslut eller brytavgift hanteras separat med aktuellt elhandelsföretag när det behövs.

Fullmakt bifogas.

Vänligen besvara detta mejl och behåll ärendenumret i ämnesraden.

Med vänlig hälsning,
{{ops_sender_name}} på uppdrag av {{tenant_company_name}}`,
  },
  current_supplier_contract_information_request: {
    key: 'current_supplier_contract_information_request',
    version: '2026-08-21-v1',
    subject: '[{{case_reference}}] Begäran om avtalsuppgifter för nuvarande elleverans',
    body: `Hej,

Vi företräder kunden enligt bifogad fullmakt och behöver verifiera kundens nuvarande elhandelsavtal inför ett planerat leverantörsbyte.

Ärendenummer: {{case_reference}}
Kundnummer hos oss: {{customer_number}}

Kund:
Namn: {{customer_name}}
Person-/organisationsnummer: {{customer_identity}}
Anläggningsadress: {{site_address}}
Postnummer/ort: {{postal_code}} {{city}}

Vi önskar få följande avtalsuppgifter:
- Avtalsstatus
- Avtalets slutdatum
- Bindningstid, om sådan finns
- Uppsägningstid
- Eventuell brytavgift eller annan kostnad vid förtida avslut

Vi begär inte nätägarens tekniska anläggnings- eller mätpunktsdata i detta ärende.

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
