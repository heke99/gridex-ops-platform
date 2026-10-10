// Customer-facing Swedish labels for raw status/enum codes in the portal.
// Unknown codes never leak to customers as snake_case: they fall back to a
// neutral label.

function lookup(map: Record<string, string>, value: string | null | undefined, fallback: string): string {
  const key = String(value ?? '').trim()
  if (!key) return fallback
  return map[key] ?? fallback
}

const CASE_STATUS: Record<string, string> = {
  open: 'Öppet',
  action_required: 'Åtgärd krävs',
  awaiting_external_response: 'Väntar på svar',
  billing_blocked: 'Under utredning',
  manual_follow_up: 'Under handläggning',
  resolved: 'Löst',
  cancelled: 'Avbrutet',
  closed: 'Avslutat',
  done: 'Klart',
  blocked: 'Under utredning',
  failed: 'Under utredning',
}

export function portalCaseStatusLabel(status: string | null | undefined): string {
  return lookup(CASE_STATUS, status, 'Under handläggning')
}

const INFO_REQUEST_STATUS: Record<string, string> = {
  draft: 'Förbereds',
  missing_authorization: 'Väntar på fullmakt',
  ready_to_send: 'Förbereds',
  z01_prepared: 'Förbereds',
  route_missing: 'Under handläggning',
  sent_to_grid_owner: 'Skickad till nätägaren',
  waiting_for_contrl: 'Väntar på svar från nätägaren',
  waiting_for_aperak: 'Väntar på svar från nätägaren',
  waiting_for_z02: 'Väntar på svar från nätägaren',
  z02_received: 'Svar mottaget',
  negative_aperak: 'Under handläggning',
  manual_review_required: 'Under handläggning',
  missing_binding_info: 'Uppgifter om bindningstid saknas',
  missing_termination_info: 'Uppgifter om uppsägning saknas',
  ready_for_switch: 'Klar för byte',
  cancelled: 'Avbruten',
  rejected: 'Avslagen',
  completed: 'Klar',
  closed: 'Avslutad',
  blocked: 'Under handläggning',
}

export function portalInfoRequestStatusLabel(status: string | null | undefined): string {
  return lookup(INFO_REQUEST_STATUS, status, 'Under handläggning')
}

const INFO_REQUEST_TYPE: Record<string, string> = {
  z01_customer_masterdata: 'Kontroll av kund- och anläggningsuppgifter',
  current_supplier_contract_check: 'Kontroll av nuvarande elavtal',
  current_supplier_contract: 'Kontroll av nuvarande elavtal',
  manual_customer_document_check: 'Kontroll av dokument',
}

export function portalInfoRequestTypeLabel(type: string | null | undefined): string {
  return lookup(INFO_REQUEST_TYPE, type, 'Uppgiftsbegäran')
}

const SITE_STATUS: Record<string, string> = {
  active: 'Aktiv',
  inactive: 'Inaktiv',
  pending: 'Under uppstart',
  pending_review: 'Under granskning',
  draft: 'Under uppstart',
  onboarding: 'Under uppstart',
  switching: 'Byte pågår',
  pending_switch: 'Byte pågår',
  moved_out: 'Utflyttad',
  terminated: 'Avslutad',
  closed: 'Avslutad',
  blocked: 'Under handläggning',
}

export function portalSiteStatusLabel(status: string | null | undefined): string {
  return lookup(SITE_STATUS, status, 'Under handläggning')
}

const CONTRACT_TYPE: Record<string, string> = {
  fixed: 'Fast pris',
  variable_hourly: 'Rörligt timpris',
  variable_monthly: 'Rörligt månadspris',
  variable_quarterly: 'Rörligt kvartspris',
  portfolio: 'Portföljpris',
}

export function portalContractTypeLabel(type: string | null | undefined): string {
  return lookup(CONTRACT_TYPE, type, 'Elavtal')
}

const INVOICE_LINE_TYPE: Record<string, string> = {
  energy: 'Elenergi',
  spot: 'Spotpris',
  spot_price: 'Spotpris',
  markup: 'Påslag',
  fixed_price: 'Fast pris',
  monthly_fee: 'Månadsavgift',
  fixed_fee: 'Fast avgift',
  invoice_fee: 'Fakturaavgift',
  green_fee: 'Grön el',
  certificate: 'Elcertifikat',
  electricity_certificate: 'Elcertifikat',
  energy_tax: 'Energiskatt',
  tax: 'Skatt',
  vat: 'Moms',
  discount: 'Rabatt',
  adjustment: 'Justering',
  credit: 'Kreditering',
  rounding: 'Öresavrundning',
  fee: 'Avgift',
  other: 'Övrigt',
}

export function portalInvoiceLineTypeLabel(type: string | null | undefined): string {
  return lookup(INVOICE_LINE_TYPE, type, 'Övrigt')
}

const COMPLETION_TYPE: Record<string, string> = {
  missing_information: 'Saknad uppgift',
  metering_point_update: 'Mätpunktsuppgift',
  contact_update: 'Kontaktuppgift',
  case_reply: 'Svar på ärende',
}

export function portalCompletionTypeLabel(type: string | null | undefined): string {
  return lookup(COMPLETION_TYPE, type, 'Komplettering')
}

/** Customer-facing invoice title; never falls back to an internal id. */
export function portalInvoiceTitle(invoice: {
  invoice_number?: string | null
  issued_at?: string | null
  period_end?: string | null
  created_at?: string | null
}): string {
  const number = (invoice.invoice_number ?? '').trim()
  if (number) return `Faktura ${number}`
  const dateSource = invoice.issued_at ?? invoice.period_end ?? invoice.created_at ?? null
  if (dateSource) {
    const date = new Date(dateSource)
    if (!Number.isNaN(date.getTime())) return `Faktura ${new Intl.DateTimeFormat('sv-SE').format(date)}`
  }
  return 'Faktura'
}
