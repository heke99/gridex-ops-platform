export const EMAIL_TEMPLATE_VARIABLES = [
  'customer_name',
  'first_name',
  'last_name',
  'customer_email',
  'customer_phone',
  'customer_number',
  'company_name',
  'contract_name',
  'contract_number',
  'contract_type',
  'signed_at',
  'offer_reference',
  'price_summary',
  'legal_versions_summary',
  'agreement_pdf_note',
  'start_date',
  'facility_id',
  'metering_point_id',
  'support_email',
  'cancellation_deadline',
  'portal_url',
  'required_information',
  'review_reason',
  'completion_deadline',
  'power_of_attorney_url',
  'case_message',
  'case_subject',
] as const

export type EmailTemplateVariable = (typeof EMAIL_TEMPLATE_VARIABLES)[number]

export type EmailEventVariableContract = {
  eventKey: string
  templateKey: string
  required: readonly EmailTemplateVariable[]
  optional: readonly EmailTemplateVariable[]
}

function contract(
  eventKey: string,
  required: readonly EmailTemplateVariable[],
  optional: readonly EmailTemplateVariable[] = [],
): EmailEventVariableContract {
  return { eventKey, templateKey: eventKey, required, optional }
}

export const EMAIL_EVENT_VARIABLE_CONTRACTS = {
  'contract.application_received': contract(
    'contract.application_received',
    ['customer_name', 'customer_email', 'customer_number', 'company_name', 'support_email'],
    ['first_name', 'last_name', 'customer_phone', 'portal_url'],
  ),
  'contract.confirmation_sent': contract(
    'contract.confirmation_sent',
    [
      'customer_name',
      'customer_number',
      'company_name',
      'contract_name',
      'contract_number',
      'signed_at',
      'start_date',
      'price_summary',
      'legal_versions_summary',
      'offer_reference',
      'agreement_pdf_note',
      'support_email',
    ],
    ['first_name', 'last_name', 'portal_url'],
  ),
  'contract.cooling_off_sent': contract(
    'contract.cooling_off_sent',
    ['customer_name', 'company_name', 'cancellation_deadline', 'support_email'],
    ['first_name', 'contract_name', 'contract_number', 'portal_url'],
  ),
  'contract.power_of_attorney_required': contract(
    'contract.power_of_attorney_required',
    ['customer_name', 'company_name', 'contract_name', 'power_of_attorney_url', 'support_email'],
    ['first_name', 'customer_number', 'contract_number', 'portal_url'],
  ),
  'contract.facility_id_required': contract(
    'contract.facility_id_required',
    ['customer_name', 'company_name', 'portal_url'],
    ['first_name', 'customer_number', 'contract_name', 'contract_number', 'facility_id', 'metering_point_id', 'support_email'],
  ),
  'contract.customer_information_required': contract(
    'contract.customer_information_required',
    ['customer_name', 'company_name', 'required_information', 'portal_url'],
    ['first_name', 'customer_number', 'contract_name', 'contract_number', 'support_email'],
  ),
  'contract.completion_reminder': contract(
    'contract.completion_reminder',
    ['customer_name', 'contract_name', 'required_information', 'completion_deadline', 'portal_url'],
    ['first_name', 'customer_number', 'company_name', 'contract_number', 'support_email'],
  ),
  'contract.rejected': contract(
    'contract.rejected',
    ['customer_name', 'contract_name', 'review_reason', 'support_email'],
    ['first_name', 'customer_number', 'company_name', 'contract_number', 'portal_url'],
  ),
  'contract.manual_review': contract(
    'contract.manual_review',
    ['customer_name', 'company_name', 'contract_name', 'review_reason'],
    ['first_name', 'customer_number', 'contract_number', 'support_email', 'portal_url'],
  ),
  'switch.started': contract(
    'switch.started',
    [
      'customer_name',
      'first_name',
      'customer_number',
      'company_name',
      'contract_name',
      'facility_id',
      'metering_point_id',
      'start_date',
      'support_email',
    ],
    ['contract_number', 'portal_url', 'cancellation_deadline'],
  ),
  'switch.confirmed': contract(
    'switch.confirmed',
    [
      'customer_name',
      'first_name',
      'customer_number',
      'company_name',
      'contract_name',
      'facility_id',
      'metering_point_id',
      'start_date',
      'support_email',
      'portal_url',
    ],
    ['contract_number', 'cancellation_deadline'],
  ),
  'switch.action_required': contract(
    'switch.action_required',
    [
      'customer_name',
      'first_name',
      'customer_number',
      'company_name',
      'contract_name',
      'facility_id',
      'metering_point_id',
      'support_email',
      'portal_url',
      'case_message',
    ],
    ['contract_number', 'start_date', 'cancellation_deadline', 'case_subject'],
  ),
  'customer.welcome_active': contract(
    'customer.welcome_active',
    [
      'customer_name',
      'first_name',
      'customer_number',
      'company_name',
      'contract_name',
      'facility_id',
      'metering_point_id',
      'start_date',
      'support_email',
      'portal_url',
    ],
    ['contract_number', 'cancellation_deadline'],
  ),
} satisfies Record<string, EmailEventVariableContract>

const CONTRACT_BY_TEMPLATE = new Map(
  Object.values(EMAIL_EVENT_VARIABLE_CONTRACTS).map((item) => [item.templateKey, item]),
)

export function getEmailEventVariableContract(eventOrTemplateKey: string | null | undefined) {
  if (!eventOrTemplateKey) return null
  return (
    EMAIL_EVENT_VARIABLE_CONTRACTS[eventOrTemplateKey as keyof typeof EMAIL_EVENT_VARIABLE_CONTRACTS]
    ?? CONTRACT_BY_TEMPLATE.get(eventOrTemplateKey)
    ?? null
  )
}

export function emailEventAvailableVariables(eventOrTemplateKey: string): ReadonlySet<EmailTemplateVariable> {
  const item = getEmailEventVariableContract(eventOrTemplateKey)
  return new Set(item ? [...item.required, ...item.optional] : EMAIL_TEMPLATE_VARIABLES)
}

export function emailEventRequiredVariables(eventOrTemplateKey: string): ReadonlySet<EmailTemplateVariable> {
  return new Set(getEmailEventVariableContract(eventOrTemplateKey)?.required ?? [])
}

export const EMAIL_TEMPLATE_SAMPLE_VARIABLES: Record<EmailTemplateVariable, string> = {
  customer_name: 'Test Kund',
  first_name: 'Test',
  last_name: 'Kund',
  customer_email: 'test@example.invalid',
  customer_phone: '+46700000000',
  customer_number: 'DX-100001',
  company_name: 'Exempel Energi AB',
  contract_name: 'Rörligt elavtal',
  contract_number: 'AV-100001',
  contract_type: 'spot_hourly',
  signed_at: '2026-08-19T10:00:00.000Z',
  offer_reference: 'offer_test_001',
  price_summary: '49 kr/mån · 11 öre/kWh',
  legal_versions_summary: 'Allmänna villkor v1',
  agreement_pdf_note: 'Avtals-PDF bifogas.',
  start_date: '2026-09-01',
  facility_id: '735999999999999999',
  metering_point_id: 'SE000000000000000000',
  support_email: 'support@example.invalid',
  cancellation_deadline: '2026-09-02',
  portal_url: 'https://portal.example.invalid/',
  required_information: 'Anläggnings-ID',
  review_reason: 'Uppgift behöver verifieras.',
  completion_deadline: '2026-08-26',
  power_of_attorney_url: 'https://portal.example.invalid/fullmakt',
  case_message: 'Vi behöver verifiera en uppgift innan leverantörsbytet kan fortsätta.',
  case_subject: 'Komplettering krävs',
}

export function sampleEmailVariablesForEvent(eventOrTemplateKey: string) {
  const available = emailEventAvailableVariables(eventOrTemplateKey)
  return Object.fromEntries(
    [...available].map((key) => [key, EMAIL_TEMPLATE_SAMPLE_VARIABLES[key]]),
  ) as Partial<Record<EmailTemplateVariable, string>>
}
