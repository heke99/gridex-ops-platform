export type GridexBusinessAudience = "tenant" | "superadmin"

export type GridexBusinessLabelInput = {
  family?: string | null
  code?: string | null
  subtype?: string | null
  reasonForTransaction?: string | null
  ackType?: string | null
  status?: string | null
}

const TENANT_MESSAGE_LABELS: Record<string, string> = {
  'PRODAT:Z01': 'Kontrollera nätavtal',
  'PRODAT:Z02': 'Svar från nätägare',
  'PRODAT:Z03': 'Leverantörsbyte',
  'PRODAT:Z03:L': 'Leverantörsbyte',
  'PRODAT:Z03:LK': 'Inflytt / leverantörsbyte',
  'PRODAT:Z03:C': 'Återta leverantörsbyte',
  'PRODAT:Z04': 'Svar på leverantörsbyte',
  'PRODAT:Z04:L': 'Leverantörsbyte bekräftat',
  'PRODAT:Z04:LK': 'Inflytt / leverantörsbyte bekräftat',
  'PRODAT:Z04:C': 'Leverantörsbyte återtaget',
  'PRODAT:Z04:A': 'Anvisad leverans',
  'PRODAT:Z04:D': 'Mottagningsplikt startar',
  'PRODAT:Z05': 'Leveransen förändras',
  'PRODAT:Z05:L': 'Leveransen upphör',
  'PRODAT:Z05:LK': 'Leveransen upphör',
  'PRODAT:Z05:C': 'Leveransen fortsätter',
  'PRODAT:Z06': 'Anläggningsuppgifter uppdaterade',
  'PRODAT:Z06:E': 'Kunduppgifter uppdaterade',
  'PRODAT:Z06:F': 'Anläggningsuppgifter uppdaterade',
  'PRODAT:Z06:G': 'Anläggningsuppgifter uppdaterade',
  'PRODAT:Z08': 'Avsluta leverans',
  'PRODAT:Z09': 'Ändra marknadsuppgifter',
  'PRODAT:Z09:B': 'Byt balansansvarig',
  'PRODAT:Z09:D': 'Ändra produktionsavtal',
  'PRODAT:Z09:E': 'Kunduppgifter ändrade',
  'PRODAT:Z09:F': 'Begär kvartsmätning',
  'PRODAT:Z09:G': 'Avsluta kvartsmätning',
  'PRODAT:Z10': 'Mätarbyte',
  'PRODAT:Z13': 'Begär mätvärden',
  'PRODAT:Z13:V': 'Begär mätvärden',
  'PRODAT:Z13:VH': 'Begär historiska mätvärden',
  'PRODAT:Z14': 'Svar på mätvärdesåtkomst',
  'PRODAT:Z14:V': 'Mätvärdesåtkomst godkänd',
  'PRODAT:Z14:VH': 'Historisk mätvärdesåtkomst godkänd',
  'PRODAT:Z14:N': 'Mätvärdesåtkomst nekad',
  'PRODAT:Z15': 'Mätvärdesrapportering ändrad',
  'PRODAT:Z15:V': 'Mätvärdesrapportering avslutad',
  'PRODAT:Z15:VH': 'Historisk mätvärdesrapportering avslutad',
  'PRODAT:Z15:C': 'Mätvärdesrapportering fortsätter',
  'PRODAT:Z18': 'Avsluta mätvärdesrapportering',
  'UTILTS:E66': 'Mätvärden mottagna',
  'APERAK:NEGATIVE': 'Avvisad av nätägare',
  'CONTRL:NEGATIVE': 'Tekniskt formatfel',
  'UTILTS_ERR:ERROR': 'Fel i mätvärdesmeddelande',
}

const SUPERADMIN_MESSAGE_LABELS: Record<string, string> = {
  'PRODAT:Z01': 'PRODAT Z01 – kontroll av giltigt elnätsavtal/kundidentitet',
  'PRODAT:Z02': 'PRODAT Z02 – nätägarens svar på Z01',
  'PRODAT:Z03': 'PRODAT Z03 – anmälan om leverantörs-/kundbyte eller återtagande',
  'PRODAT:Z04': 'PRODAT Z04 – nätägarens bekräftelse/information om leveransförändring',
  'PRODAT:Z05': 'PRODAT Z05 – information till tidigare leverantör om leveransförändring',
  'PRODAT:Z06': 'PRODAT Z06 – nätägarens uppdatering av kund-/anläggningsgrunddata',
  'PRODAT:Z08': 'PRODAT Z08 – leverantörens meddelande om hävning/avslut',
  'PRODAT:Z09': 'PRODAT Z09 – leverantörens marknads-/masterdataändring till nätägare',
  'PRODAT:Z10': 'PRODAT Z10 – nätägarens mätarbyte/mätargrunddata',
  'PRODAT:Z13': 'PRODAT Z13 – berättigad parts begäran om mätvärdesrapportering',
  'PRODAT:Z14': 'PRODAT Z14 – nätägarens godkännande/avslag av Z13',
  'PRODAT:Z15': 'PRODAT Z15 – nätägarens avslut eller återtagande av rapporteringsavslut',
  'PRODAT:Z18': 'PRODAT Z18 – berättigad parts begäran att rapporteringen ska upphöra',
  'UTILTS:E66': 'UTILTS E66 – validerade mätvärden',
  'APERAK:NEGATIVE': 'Negativ APERAK – avvisad av mottagaren',
  'CONTRL:NEGATIVE': 'Negativ CONTRL – tekniskt formatfel',
  'UTILTS_ERR:ERROR': 'UTILTS_ERR – fel i mätvärdesmeddelande',
}

const REASON_TO_SUBTYPE: Record<string, string> = {
  Z22: 'L',
  Z23: 'LK',
  Z24: 'C',
  Z25: 'H',
  Z26: 'A',
  Z27: 'B',
  Z70: 'D',
  Z96: 'N',
  E34: 'E',
  E58: 'M',
  E64: 'F',
  E32: 'G',
  S17: 'V',
  S18: 'VH',
}

function normalize(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase()
}

function normalizedSubtype(input: GridexBusinessLabelInput): string {
  const direct = normalize(input.subtype)
  if (direct) return REASON_TO_SUBTYPE[direct] ?? direct
  const reason = normalize(input.reasonForTransaction)
  return REASON_TO_SUBTYPE[reason] ?? reason
}

export function gridexBusinessMessageLabel(
  input: GridexBusinessLabelInput,
  audience: GridexBusinessAudience = 'tenant',
): string {
  const family = normalize(input.family || input.ackType)
  const code = normalize(input.code || input.status)
  const subtype = normalizedSubtype(input)
  const dictionary = audience === 'superadmin' ? SUPERADMIN_MESSAGE_LABELS : TENANT_MESSAGE_LABELS

  if (audience === 'tenant' && family === 'PRODAT' && subtype) {
    const exact = dictionary[`${family}:${code}:${subtype}`]
    if (exact) return exact
  }
  const key = `${family}:${code}`
  return dictionary[key] ?? (audience === 'superadmin' ? [family, code, subtype].filter(Boolean).join(' ') : 'Händelse')
}

export const GRIDEX_TENANT_BUSINESS_ACTIONS = {
  requestGridOwnerInformation: 'Begär uppgifter från nätägare',
  checkGridContract: 'Kontrollera nätavtal',
  startSupplierSwitch: 'Starta leverantörsbyte',
  customerWithdrawal: 'Kunden har ångrat sig',
  customerMoveOut: 'Kund flyttar från oss',
  endSupply: 'Avsluta leverans',
  requestMeteringValues: 'Begär mätvärden',
  requestHistoricalMeteringValues: 'Begär historiska mätvärden',
  disconnectionCase: 'Skapa underlag för frånkoppling/avstängning',
  billingAutomatic: 'Fakturaunderlag skapas automatiskt',
  waitingForMeteringValues: 'Väntar på mätvärden',
  billingSentToPartner: 'Underlag skickat till fakturapartner',
  requiresAction: 'Kräver åtgärd',
} as const

export function gridexBlockerLabel(code: string | null | undefined, audience: GridexBusinessAudience = 'tenant') {
  const normalized = String(code ?? '').trim()
  const tenantLabels: Record<string, string> = {
    operational_route_missing: 'Nätägarens tekniska väg saknas. Kontakta plattformsadministratör.',
    platform_route_exists_but_not_materialized: 'Nätägarens tekniska väg behöver aktiveras av plattformsadministratör.',
    production_send_locked: 'Produktionsutskick är inte godkänt ännu.',
    production_route_profile_not_ready: 'Nätägarens tekniska väg är inte produktionsklar.',
    route_profile_disabled: 'Nätägarens tekniska väg är avstängd.',
    route_profile_missing: 'Nätägarens tekniska väg saknas.',
    certificate_missing: 'Mottagarens certifikat saknas.',
    missing_power_of_attorney: 'Fullmakt saknas.',
    grid_area_not_verified: 'Nätområde eller nätägare behöver verifieras.',
    invalid_customer_site_snapshot: 'Anläggningsuppgifterna behöver kompletteras.',
    facility_or_metering_point_missing: 'Anläggningsuppgifter saknas. Begär uppgifter från nätägaren eller komplettera kundkortet.',
    environment_not_resolved: 'Systemet kunde inte välja rätt miljö.',
    sender_settings_missing: 'Avsändarinställningar saknas.',
    stale_response_requires_review: 'Svaret behöver granskas manuellt.',
    route_not_send_ready: 'Nätägarens tekniska väg är inte redo för utskick.',
    route_readiness_missing: 'Produktionsväg till nätägaren saknas.',
    prodat_direction_not_allowed: 'Den här Ediel-händelsen kan inte skickas från er marknadsroll.',
    prodat_actor_role_not_allowed: 'Bolagets marknadsroll får inte skicka den här Ediel-händelsen.',
  }

  if (audience === 'tenant') return tenantLabels[normalized] ?? 'Kräver åtgärd.'
  return normalized || 'unknown_blocker'
}
