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
  'PRODAT:Z01:L': 'Kontrollera nätavtal inför leverantörsbyte',
  'PRODAT:Z01:LK': 'Kontrollera nätavtal inför kund-/leverantörsbyte',
  'PRODAT:Z02': 'Svar från nätägare',
  'PRODAT:Z02:L': 'Svar på nätavtalskontroll',
  'PRODAT:Z02:LK': 'Svar på nätavtalskontroll vid kund-/leverantörsbyte',
  'PRODAT:Z03': 'Leveransförändring',
  'PRODAT:Z03:L': 'Leverantörsbyte',
  'PRODAT:Z03:LK': 'Inflytt / kund- och leverantörsbyte',
  'PRODAT:Z03:C': 'Återta leverantörsbyte',
  'PRODAT:Z03:H': 'Bilateral leveransförändring – granskning krävs',
  'PRODAT:Z04': 'Svar/information om leveransförändring',
  'PRODAT:Z04:L': 'Leverantörsbyte bekräftat',
  'PRODAT:Z04:LK': 'Kund- och leverantörsbyte bekräftat',
  'PRODAT:Z04:C': 'Leverantörsbyte återtaget',
  'PRODAT:Z04:H': 'Bilateralt svar – granskning krävs',
  'PRODAT:Z04:A': 'Anvisad leverans startar',
  'PRODAT:Z04:D': 'Mottagningsplikt för produktion startar',
  'PRODAT:Z05': 'Befintlig leverans förändras',
  'PRODAT:Z05:L': 'Befintlig leverans upphör',
  'PRODAT:Z05:LK': 'Leverans upphör när kund-/nätavtal avslutas',
  'PRODAT:Z05:C': 'Leveransen fortsätter',
  'PRODAT:Z05:H': 'Bilateral leveransinformation – granskning krävs',
  'PRODAT:Z06': 'Kund-/anläggningsuppgifter uppdaterade',
  'PRODAT:Z06:E': 'Kunduppgifter uppdaterade',
  'PRODAT:Z06:F': 'Anläggningsuppgifter ändrade – mätvärde hör till förändringen',
  'PRODAT:Z06:G': 'Anläggningsuppgifter ändrade',
  'PRODAT:Z08': 'Leveransavtal förändras',
  'PRODAT:Z08:H': 'Hävning av leveransavtal',
  'PRODAT:Z08:LK': 'Bilateral kund-/leverantörsförändring – granskning krävs',
  'PRODAT:Z09': 'Ändra marknads-/kunduppgifter',
  'PRODAT:Z09:B': 'Byt balansansvarig',
  'PRODAT:Z09:D': 'Produktionsavtal / mottagningsplikt förändras',
  'PRODAT:Z09:E': 'Kunduppgifter ändrade',
  'PRODAT:Z09:F': 'Avtal om kvartsvärden startar',
  'PRODAT:Z09:G': 'Avtal om högupplösta mätvärden upphör',
  'PRODAT:Z10': 'Mätarbyte',
  'PRODAT:Z10:M': 'Mätarbyte',
  'PRODAT:Z13': 'Begär mätvärdesåtkomst',
  'PRODAT:Z13:V': 'Begär löpande mätvärdesrapportering',
  'PRODAT:Z13:VH': 'Begär historisk mätvärdesåtkomst',
  'PRODAT:Z14': 'Svar på mätvärdesåtkomst',
  'PRODAT:Z14:V': 'Löpande mätvärdesrapportering godkänd',
  'PRODAT:Z14:VH': 'Historisk mätvärdesåtkomst godkänd',
  'PRODAT:Z14:N': 'Mätvärdesåtkomst nekad',
  'PRODAT:Z15': 'Mätvärdesrapportering ändrad',
  'PRODAT:Z15:V': 'Löpande mätvärdesrapportering avslutad',
  'PRODAT:Z15:VH': 'Historisk mätvärdesrapportering avslutad',
  'PRODAT:Z15:C': 'Mätvärdesrapportering fortsätter',
  'PRODAT:Z18': 'Begär avslut av mätvärdesrapportering',
  'PRODAT:Z18:V': 'Begär avslut av mätvärdesrapportering',
  'UTILTS:E30': 'Insamlade mätvärden',
  'UTILTS:E31': 'Aggregerade mätdata',
  'UTILTS:E66': 'Validerade mätvärden mottagna',
  'UTILTS:E72': 'Begär saknade insamlade mätvärden',
  'UTILTS:E73': 'Begär saknade validerade mätdata/prognos',
  'UTILTS:E74': 'Begär saknade aggregerade mätdata',
  'UTILTS:S01': 'Aggregerade avräkningsvärden',
  'UTILTS:S02': 'Förbrukningsprognos',
  'UTILTS:S03': 'Preliminära aggregerade planvärden',
  'UTILTS:S04': 'Preliminära avräknings-/planvärden',
  'UTILTS:S05': 'Aggregerade avräkningsvärden',
  'UTILTS:S06': 'Begär saknade aggregerade avräkningsvärden',
  'UTILTS:S07': 'Tidsserie per objekt',
  'APERAK:NEGATIVE': 'Avvisad av mottagaren',
  'CONTRL:NEGATIVE': 'Tekniskt formatfel',
  'UTILTS_ERR:ERROR': 'Funktionsfel i UTILTS-meddelande',
}

const SUPERADMIN_MESSAGE_LABELS: Record<string, string> = {
  'PRODAT:Z01': 'PRODAT Z01 – kontroll av giltigt elnätsavtal/kundidentitet före bytesprocess',
  'PRODAT:Z02': 'PRODAT Z02 – nätägarens svar på Z01',
  'PRODAT:Z03': 'PRODAT Z03 – anmälan om leverantörs-/kundbyte eller återtagande beroende på undertyp',
  'PRODAT:Z04': 'PRODAT Z04 – nätägarens bekräftelse/information om leveransförändring',
  'PRODAT:Z05': 'PRODAT Z05 – information till befintlig/tidigare leverantör om leveransens slut eller fortsättning',
  'PRODAT:Z06': 'PRODAT Z06 – nätägarens uppdatering av kund-/anläggningsgrunddata',
  'PRODAT:Z08': 'PRODAT Z08 – leverantörens hävnings-/bilaterala leveransmeddelande enligt undertyp',
  'PRODAT:Z09': 'PRODAT Z09 – leverantörens marknads-/masterdataändring till nätägare',
  'PRODAT:Z10': 'PRODAT Z10M – mätarbyte/mätargrunddata från nätägare',
  'PRODAT:Z13': 'PRODAT Z13 – berättigad parts begäran om löpande eller historisk mätvärdesrapportering',
  'PRODAT:Z14': 'PRODAT Z14 – nätägarens godkännande/avslag av Z13',
  'PRODAT:Z15': 'PRODAT Z15 – nätägarens avslut eller återtagande av rapporteringsavslut',
  'PRODAT:Z18': 'PRODAT Z18V – berättigad parts begäran att rapporteringen ska upphöra',
  'UTILTS:E30': 'UTILTS E30 – insamlade mätvärden per objekt',
  'UTILTS:E31': 'UTILTS E31 – aggregerade mätdata inklusive slutliga andelar',
  'UTILTS:E66': 'UTILTS E66 – validerade mätvärden per objekt',
  'UTILTS:E72': 'UTILTS E72 – bilateral begäran om saknad E30',
  'UTILTS:E73': 'UTILTS E73 – bilateral begäran om saknad S02 eller E66',
  'UTILTS:E74': 'UTILTS E74 – bilateral begäran om saknad S03 eller E31',
  'UTILTS:S01': 'UTILTS S01 – aggregerade avräkningsvärden',
  'UTILTS:S02': 'UTILTS S02 – förbrukningsprognos per objekt',
  'UTILTS:S03': 'UTILTS S03 – preliminära aggregerade planvärden',
  'UTILTS:S04': 'UTILTS S04 – aggregerade planvärden från avräkningsansvarig',
  'UTILTS:S05': 'UTILTS S05 – aggregerade avräkningsvärden',
  'UTILTS:S06': 'UTILTS S06 – bilateral begäran om saknad S01/S04',
  'UTILTS:S07': 'UTILTS S07 – tidsserie per objekt',
  'APERAK:NEGATIVE': 'Negativ APERAK – applikations-/affärsvalidering avvisad',
  'CONTRL:NEGATIVE': 'Negativ CONTRL – tekniskt EDIFACT-fel',
  'UTILTS_ERR:ERROR': 'UTILTS_ERR – funktions-/processbarhetsfel i UTILTS',
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

  if (family === 'PRODAT' && subtype) {
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
  requestMeteringValues: 'Begär saknade mätvärden',
  requestHistoricalMeteringValues: 'Begär historisk mätvärdesåtkomst',
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
