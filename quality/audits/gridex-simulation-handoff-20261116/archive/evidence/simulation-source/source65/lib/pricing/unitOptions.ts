export type PricingUnitOption = {
  value: string
  label: string
  description: string
  calculationType: string
}

export const PRICE_UNIT_OPTIONS: PricingUnitOption[] = [
  {
    value: 'ore_per_kwh',
    label: 'öre/kWh',
    description: 'Används för vanliga elpåslag, elcertifikat och grön el när priset anges i öre per kWh.',
    calculationType: 'per_kwh',
  },
  {
    value: 'sek_per_kwh',
    label: 'kr/kWh',
    description: 'Används när priset redan är angivet som kronor per kWh.',
    calculationType: 'per_kwh',
  },
  {
    value: 'sek_month',
    label: 'kr/månad',
    description: 'Fast månadsavgift som kan periodiseras vid delperiod.',
    calculationType: 'fixed_monthly',
  },
  {
    value: 'sek_invoice',
    label: 'kr/faktura',
    description: 'Fast fakturaavgift per faktura/exportperiod.',
    calculationType: 'fixed_once',
  },
  {
    value: 'percentage',
    label: 'procent',
    description: 'Procentuell rad, till exempel rabatt eller procentpåslag på basbelopp.',
    calculationType: 'percentage',
  },
  {
    value: 'sek_once',
    label: 'engångsbelopp',
    description: 'Engångsavgift eller manuell justering i kronor.',
    calculationType: 'fixed_once',
  },
]

export function findPricingUnitOption(value: string | null | undefined): PricingUnitOption | null {
  const normalized = value?.trim()
  if (!normalized) return null
  return PRICE_UNIT_OPTIONS.find((option) => option.value === normalized) ?? null
}

export function defaultPricingUnitForComponent(componentType: string | null | undefined): string {
  const type = componentType?.trim().toLowerCase() ?? ''
  if (type.includes('monthly')) return 'sek_month'
  if (type.includes('invoice')) return 'sek_invoice'
  if (type.includes('discount') && type.includes('fixed')) return 'sek_once'
  if (type.includes('percent')) return 'percentage'
  if (type.includes('green') || type.includes('certificate') || type.includes('markup') || type.includes('fee')) return 'ore_per_kwh'
  return 'ore_per_kwh'
}
