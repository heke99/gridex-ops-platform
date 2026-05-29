export type RulebookCodeListRule = {
  codeList: string
  values: string[]
  description: string
}

export const STATIC_CODE_RULES: RulebookCodeListRule[] = [
  { codeList: 'PRODAT_MESSAGE_CODES', values: ['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10', 'Z13', 'Z14', 'Z15', 'Z18'], description: 'Svenska PRODAT-funktioner.' },
  { codeList: 'PRODAT_SUPPLIER_SUBTYPES', values: ['L', 'LK', 'C', 'A', 'B', 'D', 'E', 'F', 'G', 'H', 'M', 'N', 'Z22', 'Z23', 'Z24', 'Z26', 'Z27', 'Z34', 'Z70', 'Z96', 'E32', 'E58', 'E64'], description: 'Leverantörs-/grunddataflöden.' },
  { codeList: 'PRODAT_PERMISSION_SUBTYPES', values: ['V', 'VH', 'C', 'N', 'S17', 'S18', 'Z24', 'Z96'], description: 'Mätvärdesåtkomst/berättigad part.' },
  { codeList: 'ACK_FAMILIES', values: ['CONTRL', 'APERAK', 'UTILTS_ERR'], description: 'Kvittenstyper.' },
  { codeList: 'AI_BI_FORMATS', values: ['skv', 'csv', 'Ver20140401'], description: 'AI/BI-listor; csv efter 2025-10-01 men fortsatt semikolonseparerat.' },
]

export function allowedValuesForCodeList(codeList: string): string[] {
  return STATIC_CODE_RULES.find((rule) => rule.codeList === codeList)?.values ?? []
}
