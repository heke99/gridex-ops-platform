import { describe, expect, it } from 'vitest'
import {
  evaluateBillingReadinessCore,
  evaluateContractBillingAccountReadiness,
  type BillingReadinessInput,
} from '@/lib/billing/billingReadiness'

function billableInput(overrides: Partial<BillingReadinessInput> = {}): BillingReadinessInput {
  return {
    companyId: 'company-1',
    customerId: 'customer-1',
    customer: {
      id: 'customer-1',
      full_name: 'Anna Andersson',
      email: 'anna@example.com',
    },
    contract: {
      id: 'contract-1',
      company_id: 'company-1',
      customer_id: 'customer-1',
      status: 'active',
      customer_site_id: 'site-1',
      contract_price_snapshot_id: 'snapshot-1',
      vat_rate: 25,
      invoice_recipient: 'Anna Andersson',
      invoice_email: 'anna@example.com',
    },
    issuer: { legalName: 'Elbolaget AB', orgNumber: '556000-0000' },
    site: { id: 'site-1', company_id: 'company-1', customer_id: 'customer-1' },
    meteringPoint: {
      id: 'mp-1',
      company_id: 'company-1',
      customer_id: 'customer-1',
      site_id: 'site-1',
      meter_point_id: '735999000000000001',
    },
    supplyPeriods: [{ id: 'sp-1', status: 'active' }],
    priceArea: 'SE3',
    meterValues: { present: true, missingCount: 0 },
    paymentTerms: { dueDays: 30 },
    paymentProvider: { provider: 'capway_aptic', status: 'active' },
    ...overrides,
  }
}

describe('evaluateBillingReadinessCore', () => {
  it('is billable when all fourteen criteria are satisfied', () => {
    const result = evaluateBillingReadinessCore(billableInput())
    expect(result.blockers).toEqual([])
    expect(result.billable).toBe(true)
    expect(result.evidence).toMatchObject({
      version: 'billing_readiness_core_v1',
      company_id: 'company-1',
      customer_id: 'customer-1',
      contract_id: 'contract-1',
      price_area: 'SE3',
      price_snapshot_present: true,
    })
  })

  it.each([
    [
      'contract_missing',
      billableInput({ contract: null }),
    ],
    [
      'contract_not_approved',
      billableInput({
        contract: { ...billableInput().contract!, status: 'draft' },
      }),
    ],
    [
      'invoice_issuer_missing',
      billableInput({ issuer: { legalName: 'Elbolaget AB', orgNumber: null } }),
    ],
    [
      'delivery_not_started',
      billableInput({ supplyPeriods: [{ id: 'sp-1', status: 'draft' }] }),
    ],
    [
      'contract_site_mismatch',
      billableInput({
        contract: { ...billableInput().contract!, customer_site_id: 'site-OTHER' },
      }),
    ],
    [
      'metering_point_required',
      billableInput({ meteringPoint: null }),
    ],
    [
      'price_snapshot_missing',
      billableInput({
        contract: {
          ...billableInput().contract!,
          contract_price_snapshot_id: null,
          pricing_snapshot_id: null,
          price_snapshot: null,
        },
      }),
    ],
    [
      'price_area_missing',
      billableInput({ priceArea: null }),
    ],
    [
      'meter_values_missing',
      billableInput({ meterValues: { present: false } }),
    ],
    [
      'estimated_values_not_allowed',
      billableInput({
        meterValues: { present: true, estimatedOnly: true, estimationAllowed: false },
      }),
    ],
    [
      'invoice_recipient_missing',
      billableInput({
        customer: { id: 'customer-1' },
        contract: { ...billableInput().contract!, invoice_recipient: null },
      }),
    ],
    [
      'invoice_distribution_missing',
      billableInput({
        customer: { id: 'customer-1', full_name: 'Anna Andersson' },
        contract: {
          ...billableInput().contract!,
          invoice_email: null,
          billing_street: null,
          billing_postal_code: null,
          billing_city: null,
          billing_address_same_as_site: false,
        },
      }),
    ],
    [
      'vat_settings_missing',
      billableInput({
        contract: { ...billableInput().contract!, vat_rate: null, price_snapshot: null },
      }),
    ],
    [
      'payment_terms_missing',
      billableInput({ paymentTerms: { dueDays: null, defaulted: false } }),
    ],
    [
      'billing_blocked',
      billableInput({
        contract: {
          ...billableInput().contract!,
          export_blocked: true,
          export_block_reason: 'Manuell exportspärr.',
        },
      }),
    ],
  ])('blocks with %s', (code, input) => {
    const result = evaluateBillingReadinessCore(input)
    expect(result.billable).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toContain(code)
  })

  it('blocks tenant mismatches on contract, site and metering point', () => {
    const result = evaluateBillingReadinessCore(
      billableInput({
        contract: { ...billableInput().contract!, company_id: 'company-OTHER' },
        site: { id: 'site-1', company_id: 'company-OTHER', customer_id: 'customer-1' },
        meteringPoint: {
          ...billableInput().meteringPoint!,
          customer_id: 'customer-OTHER',
        },
      }),
    )
    expect(result.billable).toBe(false)
    expect(result.blockers.filter((blocker) => blocker.code === 'tenant_mismatch').length)
      .toBeGreaterThanOrEqual(3)
  })

  it('reads VAT from the locked price snapshot when the column is null', () => {
    const result = evaluateBillingReadinessCore(
      billableInput({
        contract: {
          ...billableInput().contract!,
          vat_rate: null,
          price_snapshot: { vatRate: 25 },
        },
      }),
    )
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain('vat_settings_missing')
  })

  it('warns (not blocks) when payment terms use the documented provider default', () => {
    const result = evaluateBillingReadinessCore(
      billableInput({ paymentTerms: { dueDays: null, defaulted: true } }),
    )
    expect(result.billable).toBe(true)
    expect(result.warnings.map((warning) => warning.code)).toContain('payment_terms_defaulted')
  })

  it('warns when no payment provider connection is configured', () => {
    const result = evaluateBillingReadinessCore(billableInput({ paymentProvider: null }))
    expect(result.billable).toBe(true)
    expect(result.warnings.map((warning) => warning.code)).toContain(
      'payment_provider_connection_missing',
    )
  })

  it('blocks when the provider connection exists but is not usable', () => {
    const result = evaluateBillingReadinessCore(
      billableInput({ paymentProvider: { provider: 'capway_aptic', status: 'paused' } }),
    )
    expect(result.billable).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toContain('billing_account_incomplete')
  })

  it('merges structured contract blocker reasons and external blockers', () => {
    const result = evaluateBillingReadinessCore(
      billableInput({
        contract: {
          ...billableInput().contract!,
          billing_blocker_reasons: [{ code: 'portfolio_price_not_locked', message: 'Portföljpris ej låst.' }],
        },
        externalBlockers: [{ code: 'manual_review', message: 'Manuell granskning pågår.' }],
      }),
    )
    const codes = result.blockers.map((blocker) => blocker.code)
    expect(codes).toContain('portfolio_price_not_locked')
    expect(codes).toContain('manual_review')
  })

  it('is idempotent: evaluating twice yields identical blockers and no duplicates', () => {
    const input = billableInput({ supplyPeriods: [], priceArea: null })
    const first = evaluateBillingReadinessCore(input)
    const second = evaluateBillingReadinessCore(input)
    expect(second.blockers).toEqual(first.blockers)
    const keys = first.blockers.map((blocker) => `${blocker.code}:${blocker.message}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('evaluateContractBillingAccountReadiness', () => {
  it('accepts billing_address_same_as_site as a distribution channel', () => {
    const result = evaluateContractBillingAccountReadiness({
      contract: {
        invoice_recipient: 'Anna Andersson',
        invoice_email: null,
        billing_street: null,
        billing_postal_code: null,
        billing_city: null,
        billing_address_same_as_site: true,
        vat_rate: 25,
      },
      paymentTerms: { dueDays: 30 },
    })
    expect(result.blockers).toEqual([])
    expect(result.evidence).toMatchObject({ billing_address_same_as_site: true })
  })

  it('falls back to canonical customer data for recipient and distribution', () => {
    const result = evaluateContractBillingAccountReadiness({
      contract: { vat_rate: 25 },
      customer: {
        full_name: 'Anna Andersson',
        email: 'anna@example.com',
      },
      paymentTerms: { dueDays: 30 },
    })
    expect(result.blockers).toEqual([])
    expect(result.evidence).toMatchObject({
      invoice_recipient: 'Anna Andersson',
      invoice_email: 'anna@example.com',
    })
  })

  it('blocks a contract without recipient, distribution and VAT', () => {
    const result = evaluateContractBillingAccountReadiness({
      contract: {},
      customer: null,
      paymentTerms: { dueDays: null, defaulted: false },
    })
    expect(result.blockers.map((blocker) => blocker.code).sort()).toEqual([
      'invoice_distribution_missing',
      'invoice_recipient_missing',
      'payment_terms_missing',
      'vat_settings_missing',
    ])
  })
})
