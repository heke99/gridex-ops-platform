// lib/ediel/codeLabels.ts

export type EdielCodeLabelKind =
  | 'prodat_code'
  | 'reason_for_transaction'
  | 'metering_method'
  | 'customer_id_qualifier'
  | 'settlement_method'
  | 'product_code'
  | 'installation_status'
  | 'reading_frequency'
  | 'meter_interval'

const LABELS: Record<EdielCodeLabelKind, Record<string, string>> = {
  prodat_code: {
    Z01: 'Z01 – kontroll av kundidentitet/giltigt elnätsavtal inför förändring',
    Z02: 'Z02 – nätägarens svar på Z01',
    Z03: 'Z03 – anmälan om leverantörs-/kundbyte eller återtagande',
    Z04: 'Z04 – nätägarens bekräftelse/information om leveransförändring',
    Z05: 'Z05 – information till tidigare leverantör om leveransförändring',
    Z06: 'Z06 – nätägarens uppdatering av kund-/anläggningsgrunddata',
    Z08: 'Z08 – leverantörens meddelande om hävning/avslut',
    Z09: 'Z09 – leverantörens marknads-/masterdataändring till nätägare',
    Z10: 'Z10 – nätägarens mätarbyte/mätargrunddata',
    Z13: 'Z13 – berättigad parts begäran om mätvärdesrapportering',
    Z14: 'Z14 – nätägarens godkännande eller avslag av Z13',
    Z15: 'Z15 – nätägarens avslut eller återtagande av rapporteringsavslut',
    Z18: 'Z18 – berättigad parts begäran att mätvärdesrapportering ska upphöra',
  },
  reason_for_transaction: {
    Z22: 'Z22 – L, leverantörsbyte',
    Z23: 'Z23 – LK, kund- och leverantörsbyte',
    Z24: 'Z24 – C, återtagande/cancellering av förändringsprocess',
    Z25: 'Z25 – H, hävning/annan tillåten avslutsorsak enligt aktuell profil',
    Z26: 'Z26 – A, övergång till anvisad leverantör',
    Z27: 'Z27 – B, byte av balansansvarig',
    Z70: 'Z70 – D, mottagningsplikt för produktion',
    Z96: 'Z96 – N, avvisat av operatör/nätägare',
    E34: 'E34 – E, uppdatering av kundgrunddata',
    E58: 'E58 – M, uppdatering av mätargrunddata/mätarbyte',
    E64: 'E64 – F, masterdataändring som kräver avläsning',
    E32: 'E32 – G, masterdataändring för mätpunkt/anläggning utan motsvarande avläsning',
    S17: 'S17 – V, start/avslut av löpande mätvärdesrapportering',
    S18: 'S18 – VH, historisk mätvärdesrapportering',
  },
  metering_method: {
    Z01: 'Z01 – profil',
    Z02: 'Z02 – timme (legacy/guidekontext; inte normalt aktuellt UI-val)',
    Z03: 'Z03 – bestäms av mätpunktsadministratören',
    Z04: 'Z04 – 15 minuter',
  },
  customer_id_qualifier: {
    SE1: 'SE1 – organisationsnummer',
    SE2: 'SE2 – personnummer eller samordningsnummer',
    '1': '1 – födelsedatum',
  },
  settlement_method: {
    Z31: 'Z31 – månadsavräkning',
    Z32: 'Z32 – dygnsavräkning/kontinuerlig avräkning',
  },
  product_code: {
    L641Q: 'L641Q – mikroproduktion/produktion enligt PRODAT-testdata',
    L917: 'L917 – månadsavräknad förbrukning/andelstal enligt äldre testdata',
  },
  installation_status: {
    Z12: 'Z12 – anläggningen är aktiv/ansluten',
  },
  reading_frequency: {
    D: 'D – daglig rapportering',
    M: 'M – månadsrapportering',
  },
  meter_interval: {
    '901': '901 – räkneverkskod/tidsintervall enligt Ediel-kodlista',
    '201': '201 – register/tidsintervall enligt Ediel-kodlista',
    '202': '202 – register/tidsintervall enligt Ediel-kodlista',
  },
}

export function edielCodeLabel(
  kind: EdielCodeLabelKind,
  code?: string | null
): string {
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : ''
  if (!normalized) return 'Ej angivet'
  return LABELS[kind][normalized] ?? `${normalized} – okänd/ej mappad kod i Gridex`
}

export function describeProdatCaseType(params: {
  messageCode?: string | null
  reasonForTransaction?: string | null
  productCode?: string | null
  meteringMethod?: string | null
}): string {
  const code = params.messageCode?.trim().toUpperCase()
  const reason = params.reasonForTransaction?.trim().toUpperCase()
  const product = params.productCode?.trim().toUpperCase()
  const meteringMethod = params.meteringMethod?.trim().toUpperCase()

  if (code === 'Z04' && product === 'L641Q') return 'Mottagningspliktig mikroproduktion / Z04D'
  if (code === 'Z03' && reason === 'Z23') return 'Kund- och leverantörsbyte / Z03LK'
  if (code === 'Z03' && reason === 'Z22') return 'Leverantörsbyte / Z03L'
  if (code === 'Z03' && reason === 'Z24') return 'Återtagande av förändringsprocess / Z03C'
  if (code === 'Z04' && reason === 'Z23') return 'Bekräftelse på kund- och leverantörsbyte / Z04LK'
  if (code === 'Z04' && reason === 'Z22') return 'Bekräftelse på leverantörsbyte / Z04L'
  if (code === 'Z04' && reason === 'Z24') return 'Bekräftelse på återtagande / Z04C'
  if (code === 'Z05' && reason === 'Z24') return 'Tidigare leveransavslut återtaget / Z05C'
  if (code === 'Z15' && reason === 'Z24') return 'Rapporteringsavslut återtaget / Z15C'
  if (code === 'Z04' && meteringMethod === 'Z04') return 'PRODAT Z04 med 15-minutersmätt anläggning'

  return code ? edielCodeLabel('prodat_code', code) : 'Inbound PRODAT'
}
