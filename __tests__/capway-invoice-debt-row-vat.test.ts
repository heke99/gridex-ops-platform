import { describe, expect, it } from 'vitest'
import { buildCapwayInvoicePayload } from '@/lib/integrations/billing/capway/payloadBuilder'
import type { CapwayConnectionConfig, CapwayInvoiceDebt } from '@/lib/integrations/billing/capway/types'

const config: CapwayConnectionConfig = {
  companyId: 'test-company', environment: 'test', provider: 'capway_aptic', baseUrl: 'https://capway.example.invalid',
  authMode: 'apikey', defaultService: 'test-service', defaultFinancingMode: 'invoice_service',
}

function priceLine(net: number | string, vat: number | string, gross: number | string, rate = 0.25) {
  return { description: 'Elhandel', amount_ex_vat: net, vat_amount: vat, amount_inc_vat: gross, vat_rate: rate, quantity: 1 }
}

function debt(pricingLines: Record<string, unknown>[], total: number) {
  const payload = buildCapwayInvoicePayload({
    config, company: null, customer: { id: 'test-customer' }, pricingRun: { id: 'price-run', total_inc_vat: total },
    pricingLines, underlay: { price_area: 'SE3' }, invoiceDate: '2026-11-19T00:00:00Z', dueDate: '2026-12-09T00:00:00Z',
  })
  return JSON.parse(JSON.stringify(payload.debts?.[0] ?? null)) as CapwayInvoiceDebt | null
}

describe('Capway approved debt row VAT validation', () => {
  it.each([
    { net: 0.01, vat: 0, gross: 0.01, rate: 0, vatCode: 'SE0' },
    { net: 0.05, vat: 0.01, gross: 0.06, rate: 0.25, vatCode: 'SE25' },
    { net: 0.08, vat: 0.02, gross: 0.10, rate: 0.25, vatCode: 'SE25' },
    { net: -0.05, vat: -0.01, gross: -0.06, rate: 0.25, vatCode: 'SE25' },
  ])('retains the approved amounts for $vat SEK VAT and $rate rate', ({ net, vat, gross, rate, vatCode }) => {
    expect(debt([priceLine(net, vat, gross, rate)], gross)).toMatchObject({
      debtPrincipalType: net < 0 ? 2 : 1, originalPrincipal: net, remainingPrincipal: net, originalVat: vat, remainingVat: vat, rounding: 0,
      debtRows: [{ itemNetAmount: net, rowPrincipalAmount: net, vatAmount: vat, vatCode, includingVAT: false }],
    })
  })

  it('retains accepted numeric strings and pairs a debt row with its own approved pricing line', () => {
    const emptyLine = { ...priceLine(0, 0, 0), description: ' ' }
    expect(debt([emptyLine, priceLine('0,05', '0,01', '0,06')], 0.06)).toMatchObject({
      originalPrincipal: 0.05, originalVat: 0.01, rounding: 0,
      debtRows: [{ description: 'Elhandel', itemNetAmount: 0.05, rowPrincipalAmount: 0.05, vatAmount: 0.01, includingVAT: false }],
    })
  })

  it.each([0.05, 0.07])('blocks an inconsistent gross of %s for an approved 0.05 SEK net and 0.01 SEK VAT', gross => {
    expect(() => debt([priceLine(0.05, 0.01, gross)], gross)).toThrow(/moms/)
  })

  it('blocks a monetary line whose description would otherwise be skipped from the exported rows', () => {
    const hiddenLine = { ...priceLine(49, 12.25, 61.25), description: ' ' }
    expect(() => debt([hiddenLine], 61.25)).toThrow(/beskrivning/)
  })
})
