import type { CapwayConnectionConfig, CapwayFinancingMode, CapwayInvoiceDebtRow, CapwayPutInvoice } from '@/lib/integrations/billing/capway/types'
import { purchasableValue } from '@/lib/integrations/billing/capway/statusMapper'

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function splitName(name: string | null): { firstname: string | null; lastname: string | null } {
  if (!name) return { firstname: null, lastname: null }
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return { firstname: parts[0], lastname: null }
  return { firstname: parts.slice(0, -1).join(' '), lastname: parts.at(-1) ?? null }
}

function customerName(customer: Record<string, unknown>): string | null {
  const personalName = [stringValue(customer.first_name), stringValue(customer.last_name)].filter(Boolean).join(' ')
  return (
    stringValue(customer.company_name) ??
    (personalName || null) ??
    stringValue(customer.name) ??
    stringValue(customer.full_name)
  )
}

function vatCodeForRate(rate: number): string {
  const normalizedRate = rate > 1 ? rate / 100 : rate
  const percent = Math.round(normalizedRate * 100)
  if (percent === 25) return 'SE25'
  if (percent === 12) return 'SE12'
  if (percent === 6) return 'SE6'
  return 'SE0'
}

function assertCapwayDebtRowsAreExVat(input: {
  rows: CapwayInvoiceDebtRow[]
  pricingLines: Record<string, unknown>[]
}) {
  input.rows.forEach((row, index) => {
    const line = input.pricingLines[index] ?? {}
    const description = stringValue(row.description) ?? `rad ${index + 1}`
    const amountExVat = roundMoney(numberValue(line.amount_ex_vat))
    const amountIncVat = roundMoney(numberValue(line.amount_inc_vat))
    const vatAmount = roundMoney(numberValue(line.vat_amount))
    const rowPrincipal = roundMoney(numberValue(row.rowPrincipalAmount))
    const rowNet = roundMoney(numberValue(row.itemNetAmount))

    if (!row.vatCode) {
      throw new Error(`Capway-export blockerad: debtRow ${description} saknar vatCode.`)
    }

    if (row.includingVAT !== false) {
      throw new Error(`Capway-export blockerad: debtRow ${description} måste skickas exkl. moms.`)
    }

    if (rowPrincipal !== rowNet) {
      throw new Error(`Capway-export blockerad: debtRow ${description} har olika net amount och principal amount.`)
    }

    if (Math.abs(rowPrincipal - amountExVat) > 0.01) {
      throw new Error(`Capway-export blockerad: debtRow ${description} matchar inte amount_ex_vat.`)
    }

    if (vatAmount !== 0 && amountIncVat !== 0 && Math.abs(amountExVat - amountIncVat) <= 0.01) {
      throw new Error(`Capway-export blockerad: fakturarad ${description} verkar sakna separat exkl./inkl. moms.`)
    }

    if (vatAmount !== 0 && amountIncVat !== 0 && Math.abs(rowPrincipal - amountIncVat) <= 0.01) {
      throw new Error(`Capway-export blockerad: debtRow ${description} verkar innehålla belopp inkl. moms.`)
    }
  })
}

export function buildCapwayInvoicePayload(input: {
  config: CapwayConnectionConfig
  company: Record<string, unknown> | null
  customer: Record<string, unknown>
  pricingRun: Record<string, unknown>
  pricingLines: Record<string, unknown>[]
  underlay?: Record<string, unknown> | null
  financingMode?: CapwayFinancingMode
  invoiceDate?: string | null
  dueDate?: string | null
  paymentConditionDays?: number | null
}): CapwayPutInvoice {
  const financingMode = input.financingMode ?? input.config.defaultFinancingMode
  const invoiceDate = input.invoiceDate ?? new Date().toISOString()
  const dueDate = input.dueDate ?? new Date(Date.now() + 10 * 86_400_000).toISOString()
  const name = customerName(input.customer)
  const { firstname, lastname } = splitName(name)
  const juridicalType = stringValue(input.customer.customer_type) === 'business' || stringValue(input.customer.org_number) ? 1 : 0

  const rowLines = input.pricingLines
    .filter((line) => stringValue(line.description))
    .map((line, index) => {
      const amountExVat = roundMoney(numberValue(line.amount_ex_vat))
      const vatAmount = roundMoney(numberValue(line.vat_amount))
      const vatRate = numberValue(line.vat_rate)
      return {
        rowReference: stringValue(line.id) ?? `ROW-${index + 1}`,
        itemReference: stringValue(line.line_type) ?? null,
        description: stringValue(line.description),
        itemCount: numberValue(line.quantity) || 1,
        itemNetAmount: amountExVat,
        rowPrincipalAmount: amountExVat,
        includingVAT: false,
        vatAmount,
        vatCode: vatCodeForRate(vatRate),
        extraFields: [
          { name: 'gridex_line_type', value: [stringValue(line.line_type) ?? 'unknown'] },
          { name: 'gridex_unit', value: [stringValue(line.unit) ?? ''] },
        ],
      }
    })

  assertCapwayDebtRowsAreExVat({ rows: rowLines, pricingLines: input.pricingLines })

  const principal = roundMoney(input.pricingLines.reduce((sum, line) => sum + numberValue(line.amount_ex_vat), 0))
  const vat = roundMoney(input.pricingLines.reduce((sum, line) => sum + numberValue(line.vat_amount), 0))
  const totalIncVat = roundMoney(numberValue(input.pricingRun.total_inc_vat) || principal + vat)
  const rounding = roundMoney(totalIncVat - principal - vat)
  const externalReference = stringValue(input.pricingRun.id) ?? `GRIDEX-${Date.now()}`
  const customerRef = stringValue(input.customer.customer_number) ?? stringValue(input.customer.external_customer_id) ?? stringValue(input.customer.id)
  const address = stringValue(input.customer.full_address) ?? stringValue(input.customer.address_line_1) ?? stringValue(input.customer.street)
  const metadata = isObject(input.underlay?.payload) ? input.underlay?.payload as Record<string, unknown> : {}

  return {
    creditorReference: stringValue(input.config.rawSettings?.creditor_reference) ?? stringValue(input.company?.org_number) ?? input.config.companyId,
    referenceNumber: customerRef,
    deliverySystemCode: 'Gridex',
    paymentReference: stringValue(input.pricingRun.provider_payment_reference) ?? null,
    service: input.config.defaultService,
    claimantName: stringValue(input.company?.name) ?? null,
    purchasable: purchasableValue(financingMode),
    invoiceDate,
    paymentCode: input.config.defaultPaymentCode ?? null,
    printCode: input.config.defaultPrintCode ?? null,
    formCode: input.config.defaultFormCode ?? null,
    receiverReference: stringValue(input.customer.email),
    preferredChannel: input.config.defaultPreferredChannel ?? stringValue(input.customer.invoice_channel) ?? 'Email',
    externalReferenceCode: externalReference,
    paymentProductCode: input.config.defaultPaymentProductCode ?? 'INVOICE',
    customer: {
      customerReference: customerRef,
      idNumber: stringValue(input.customer.personal_number) ?? stringValue(input.customer.org_number),
      juridicalType,
      customerRole: 1,
      firstname: juridicalType === 0 ? firstname : null,
      lastname: juridicalType === 0 ? lastname : name,
      street: address,
      city: stringValue(input.customer.city),
      zipCode: stringValue(input.customer.postal_code),
      fullAddress: address,
      countryCode: stringValue(input.customer.country) ?? 'SE',
      vatNumber: stringValue(input.customer.vat_number),
      cellularPhone: stringValue(input.customer.phone),
      email: stringValue(input.customer.email),
      languageCode: 'sv-SE',
      currencyCode: 'SEK',
      preferredchannel: input.config.defaultPreferredChannel ?? 'Email',
      invoiceChannel: input.config.defaultPreferredChannel ?? 'Email',
      extraFields: [
        { name: 'gridex_customer_id', value: [stringValue(input.customer.id) ?? ''] },
      ],
    },
    debts: [
      {
        debtPrincipalType: principal < 0 ? 2 : 1,
        description: `Elhandel ${String(input.pricingRun.billing_period_start ?? '').slice(0, 7)}`,
        originalReferenceNumber: externalReference,
        ledgerReference: externalReference,
        originalPrincipal: principal,
        remainingPrincipal: principal,
        originalVat: vat,
        remainingVat: vat,
        rounding,
        currencyCode: 'SEK',
        invoiceDate,
        dueDate,
        paymentCondition: input.paymentConditionDays ?? 10,
        message: stringValue(input.config.rawSettings?.invoice_message) ?? 'Faktura skapad från Gridex faktureringsunderlag.',
        receiverFullName: name,
        receiverStreet: address,
        receiverCity: stringValue(input.customer.city),
        receiverZipCode: stringValue(input.customer.postal_code),
        receiverCountryCode: stringValue(input.customer.country) ?? 'SE',
        debtRows: rowLines,
        extraFields: [
          { name: 'gridex_billing_underlay_id', value: [stringValue(input.pricingRun.billing_underlay_id) ?? ''] },
          { name: 'gridex_price_area', value: [stringValue(input.underlay?.price_area) ?? stringValue(metadata.price_area) ?? ''] },
        ],
      },
    ],
    extraFields: [
      { name: 'gridex_pricing_run_id', unique: true, value: [externalReference] },
      { name: 'gridex_company_id', value: [input.config.companyId] },
      { name: 'gridex_financing_mode', value: [financingMode] },
    ],
    note: [
      {
        noteText: `Gridex export ${externalReference}. Finansieringsläge: ${financingMode}.`,
        systemCode: 'Gridex',
        important: false,
      },
    ],
  }
}
