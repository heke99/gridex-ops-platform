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
    Z03: 'Z03 – anmälan om leverantörsbyte/inflytt',
    Z04: 'Z04 – bekräftelse/svar på leverantörsbyte eller produktionsinformation',
    Z05: 'Z05 – leveransstart/aktivering',
    Z06: 'Z06 – ändrade anläggnings- eller mätuppgifter',
    Z09: 'Z09 – avslut/utflytt/upphörande',
    Z10: 'Z10 – mätarbyte eller mätaruppgifter',
    Z13: 'Z13 – begäran om tillstånd för mätvärdesåtkomst',
    Z14: 'Z14 – svar på tillståndsbegäran',
    Z15: 'Z15 – ändring/avslut av tillstånd',
    Z18: 'Z18 – information kopplad till tillstånd',
  },
  reason_for_transaction: {
    Z22: 'Z22 – L, leverantörsbyte',
    Z23: 'Z23 – LK, leverantörs- och kundbyte',
    Z24: 'Z24 – kundflytt/inflytt enligt process',
    Z25: 'Z25 – annan processorsak enligt PRODAT-anvisning',
    Z26: 'Z26 – felaktig transaktionstyp i TGT-negativtest',
    E64: 'E64 – Z06F, ändrade mät-/avräkningsuppgifter',
    E32: 'E32 – Z06G, ändring av anläggningsadress',
    Z27: 'Z27 – avslut enligt PRODAT-process',
    Z28: 'Z28 – kancellering/annullering enligt PRODAT-process',
    Z29: 'Z29 – informationsmeddelande enligt PRODAT-process',
  },
  metering_method: {
    Z01: 'Z01 – månadsavläst/månadsavräknad',
    Z03: 'Z03 – dygnsavräknad/timmätt historisk metod i vissa testfall',
    Z04: 'Z04 – 15-minutersmätt/kvartsmätt',
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
    '901': '901 – räkneverkskod/tidsintervall för kvartsmätt/dygnsrapporterad mätare',
    '201': '201 – register/tidsintervall enligt Ediel kodlista',
    '202': '202 – register/tidsintervall enligt Ediel kodlista',
  },
}

export function edielCodeLabel(
  kind: EdielCodeLabelKind,
  code?: string | null
): string {
  const normalized = typeof code === 'string' ? code.trim() : ''
  if (!normalized) return 'Ej angivet'
  return LABELS[kind][normalized] ?? `${normalized} – okänd/ej mappad kod i Gridex`
}

export function describeProdatCaseType(params: {
  messageCode?: string | null
  reasonForTransaction?: string | null
  productCode?: string | null
  meteringMethod?: string | null
}): string {
  const code = params.messageCode?.trim()
  const reason = params.reasonForTransaction?.trim()
  const product = params.productCode?.trim()
  const meteringMethod = params.meteringMethod?.trim()

  if (code === 'Z04' && product === 'L641Q') {
    return 'Mottagningspliktig mikroproduktion / Z04D'
  }

  if (code === 'Z03' && reason === 'Z23') {
    return 'Leverantörs- och kundbyte / Z03LK'
  }

  if (code === 'Z03' && reason === 'Z22') {
    return 'Leverantörsbyte / Z03L'
  }

  if (code === 'Z04' && reason === 'Z23') {
    return 'Bekräftelse på leverantörs- och kundbyte / Z04LK'
  }

  if (code === 'Z04' && reason === 'Z22') {
    return 'Bekräftelse på leverantörsbyte / Z04L'
  }

  if (code === 'Z04' && meteringMethod === 'Z04') {
    return 'PRODAT Z04 med kvartsmätt anläggning'
  }

  return code ? edielCodeLabel('prodat_code', code) : 'Inbound PRODAT'
}
