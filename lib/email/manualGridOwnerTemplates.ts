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
  tenant_organization_number?: string | null
  poa_reference?: string | null
  poa_verification_number?: string | null
  request_purpose?: 'network' | 'supplier_contract'
  request_topic?: string | null
  requested_information?: string | null
  reply_received_partial?: boolean
  missing_supplier_fields?: Array<'earliest_supplier_start_date' | 'termination_fee' | 'notice_period' | 'binding_period' | 'cancellation_registered' | 'cancellation_deadline'>
}

// Bumping a version is a content change that downstream audit can reference.
export const MANUAL_EMAIL_TEMPLATES: Record<ManualEmailTemplateKey, ManualEmailTemplate> = {
  facility_information_request: {
    key: 'facility_information_request',
    version: '2026-10-18-v3',
    subject: '[{{case_reference}}] Fullmakt – Nätuppgifter – {{tenant_company_name}}',
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
    version: '2026-10-18-v2',
    subject: '[{{case_reference}}] Fullmakt – Handelsuppgifter – {{tenant_company_name}}',
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
- Datum då kunden tidigast kan starta hos en ny leverantör, inklusive eventuella villkor
- Datum då avtalet senast måste sägas upp för detta avslut, och om uppsägning redan har registrerats
- Eventuell brytavgift eller annan kostnad vid förtida avslut

Vi begär inte nätägarens tekniska anläggnings- eller mätpunktsdata i detta ärende.

Fullmakt bifogas.

Vänligen besvara detta mejl och behåll ärendenumret i ämnesraden.

Med vänlig hälsning,
{{ops_sender_name}} på uppdrag av {{tenant_company_name}}`,
  },
  supplier_switch_manual: {
    key: 'supplier_switch_manual',
    version: '2026-10-18-v2',
    subject: '[{{case_reference}}] Manuell hantering av leverantörsbyte – {{tenant_company_name}}',
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
    version: '2026-10-18-v2',
    subject: '[{{case_reference}}] Fullmakt – {{tenant_company_name}}',
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
    version: '2026-10-18-v2',
    subject: '[{{case_reference}}] Anläggningslista (AI-lista) – {{tenant_company_name}}',
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
    version: '2026-10-18-v3',
    subject: '[{{case_reference}}] Påminnelse: {{request_topic}} – {{tenant_company_name}}',
    body: `Hej,

Vi vill påminna om vår tidigare begäran i ärende {{case_reference}} avseende uppgifter inför leverantörsbyte.

{{requested_information}}

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
    version: '2026-10-18-v3',
    subject: '[{{case_reference}}] Eskalering: {{request_topic}} – {{tenant_company_name}}',
    body: `Hej,

Vi har inte fått återkoppling i ärende {{case_reference}} trots tidigare begäran och påminnelse. Vi ber er hantera ärendet skyndsamt.

{{requested_information}}

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
  const supplier = variables.request_purpose === 'supplier_contract'
  const partial = supplier && variables.reply_received_partial === true && ['reminder', 'escalation'].includes(key)
  const missingLabels = {
    earliest_supplier_start_date: 'Datum då kunden ovillkorligen tidigast kan starta hos en ny leverantör.',
    termination_fee: 'Eventuell brytavgift. Ange uttryckligen 0 kr eller att ingen avgift finns när bytet kan ske utan kostnad.',
    notice_period: 'Uppsägningstid.', binding_period: 'Bindningstid.',
    cancellation_registered: 'Om kundens uppsägning har registrerats.', cancellation_deadline: 'Sista datum då uppsägning måste vara registrerad.',
  }
  const missing = [...new Set(variables.missing_supplier_fields ?? [])].filter((field) => Object.hasOwn(missingLabels, field))
  variables = { ...variables,
    request_topic: supplier ? 'Handelsuppgifter' : 'Nätuppgifter',
    requested_information: partial
      ? `Vi saknar följande uppgifter:\n${(missing.length ? missing : ['earliest_supplier_start_date', 'termination_fee'] as const).map((field) => `- ${missingLabels[field]}`).join('\n')}`
      : supplier
      ? 'Begäran gäller endast elhandelsavtalet: avtalsstatus, avtalslut, bindningstid, uppsägningstid, tidigaste start hos ny leverantör, sista uppsägningsdatum, om uppsägning registrerats och eventuell brytavgift.'
      : 'Begäran gäller endast nätuppgifter: anläggnings-ID, eventuellt separat mätpunkts-ID, nätområde, årsenergi, mätmetod, rapporteringsfrekvens och nuvarande elhandelsföretag om uppgiften finns tillgänglig.',
  }
  const subject = applyVariables(template.subject, variables).replace(/\s+/g, ' ').trim()
  const senderIdentity = `Ombud: {{tenant_company_name}}\nOrganisationsnummer: {{tenant_organization_number}}\nFullmaktsreferens: {{poa_reference}}\nVerifikatsnummer: {{poa_verification_number}}`
  const body = partial ? template.body.replace(/^(?:Vi har inte fått|Vi vill påminna)[^\n]+/m, 'Tack för ert svar. Vi behöver kompletterande uppgifter i ärende {{case_reference}} för att kunna slutföra kontrollen av kundens elhandelsavtal.') : template.body
  const bodyText = applyVariables(body, variables).replace('Hej,', `Hej,\n\n${applyVariables(senderIdentity, variables)}`)
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
