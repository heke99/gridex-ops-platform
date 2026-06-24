export type GridexBusinessAudience = "tenant" | "superadmin"

export type GridexBusinessLabelInput = {
  family?: string | null
  code?: string | null
  ackType?: string | null
  status?: string | null
}

const TENANT_MESSAGE_LABELS: Record<string, string> = {
  'PRODAT:Z01': 'Begär uppgifter från nätägare',
  'PRODAT:Z02': 'Svar från nätägare',
  'PRODAT:Z03': 'Starta leverantörsbyte',
  'PRODAT:Z04': 'Svar på leverantörsbyte',
  'PRODAT:Z05': 'Leveransförändring',
  'PRODAT:Z06': 'Ändrade anläggningsuppgifter',
  'PRODAT:Z09': 'Begär ändring',
  'PRODAT:Z10': 'Mätarbyte',
  'UTILTS:E66': 'Mätvärden mottagna',
  'APERAK:NEGATIVE': 'Avvisad av nätägare',
  'CONTRL:NEGATIVE': 'Tekniskt formatfel',
  'UTILTS_ERR:ERROR': 'Fel i mätvärdesmeddelande',
}

const SUPERADMIN_MESSAGE_LABELS: Record<string, string> = {
  'PRODAT:Z01': 'PRODAT Z01 – Begär uppgifter från nätägare',
  'PRODAT:Z02': 'PRODAT Z02 – Svar från nätägare',
  'PRODAT:Z03': 'PRODAT Z03 – Leverantörsbyte/inflytt',
  'PRODAT:Z04': 'PRODAT Z04 – Svar på leverantörsbyte/inflytt',
  'PRODAT:Z05': 'PRODAT Z05 – Leveransförändring',
  'PRODAT:Z06': 'PRODAT Z06 – Anläggnings-/mätarinformation',
  'PRODAT:Z09': 'PRODAT Z09 – Ändringsmeddelande',
  'PRODAT:Z10': 'PRODAT Z10 – Mätarbyte',
  'PRODAT:Z13': 'PRODAT Z13 – Mätvärdesåtkomst',
  'PRODAT:Z14': 'PRODAT Z14 – Svar på mätvärdesåtkomst',
  'PRODAT:Z15': 'PRODAT Z15 – Mätvärdesrapportering upphör/fortsätter',
  'PRODAT:Z18': 'PRODAT Z18 – Avsluta mätvärdesåtkomst',
  'UTILTS:E66': 'UTILTS E66 – Mätvärden',
  'APERAK:NEGATIVE': 'Negativ APERAK – avvisad av mottagaren',
  'CONTRL:NEGATIVE': 'Negativ CONTRL – tekniskt formatfel',
  'UTILTS_ERR:ERROR': 'UTILTS_ERR – fel i mätvärdesmeddelande',
}

export const GRIDEX_TENANT_BUSINESS_ACTIONS = {
  requestGridOwnerInformation: 'Begär uppgifter från nätägare',
  startSupplierSwitch: 'Starta leverantörsbyte',
  customerWithdrawal: 'Kunden har ångrat sig',
  customerMoveOut: 'Kund flyttar från oss',
  endSupply: 'Avsluta leverans',
  disconnectionCase: 'Skapa underlag för frånkoppling/avstängning',
  billingAutomatic: 'Fakturaunderlag skapas automatiskt',
  waitingForMeteringValues: 'Väntar på mätvärden',
  billingSentToPartner: 'Underlag skickat till fakturapartner',
  requiresAction: 'Kräver åtgärd',
} as const

function normalize(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase()
}

export function gridexBusinessMessageLabel(
  input: GridexBusinessLabelInput,
  audience: GridexBusinessAudience = 'tenant',
): string {
  const family = normalize(input.family || input.ackType)
  const code = normalize(input.code || input.status)
  const key = `${family}:${code}`
  const dictionary = audience === 'superadmin' ? SUPERADMIN_MESSAGE_LABELS : TENANT_MESSAGE_LABELS
  return dictionary[key] ?? (audience === 'superadmin' ? [family, code].filter(Boolean).join(' ') : 'Händelse')
}

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
  }

  if (audience === 'tenant') return tenantLabels[normalized] ?? 'Kräver åtgärd.'
  return normalized || 'unknown_blocker'
}
