import { describe, expect, it } from 'vitest'

const RUN = process.env.GRIDEX_INVOICE_TEST_STAGING_E2E === 'YES'
const describeStaging = RUN ? describe : describe.skip

function requiredEnv(name: string): string {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`Missing required staging E2E env: ${name}`)
  return value
}

function gs1CheckDigit(body: string): string {
  let sum = 0
  for (let i = body.length - 1, position = 1; i >= 0; i -= 1, position += 1) {
    const digit = Number(body[i])
    if (!Number.isInteger(digit)) throw new Error('GS1 body must be numeric')
    sum += digit * (position % 2 === 1 ? 3 : 1)
  }
  return String((10 - (sum % 10)) % 10)
}

function uniqueFacilityId(): string {
  const suffix = String(Date.now()).slice(-11).padStart(11, '0')
  const body = `735999${suffix}`
  return `${body}${gs1CheckDigit(body)}`
}

function buildE66(input: { sender: string; receiver: string; facilityId: string }) {
  const now = new Date()
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14)
  const interchange = stamp.slice(0, 14)
  const unh = stamp.slice(-10)
  const bgm = `GXFT2607E66${stamp.slice(-12)}`
  const transaction = `GXFT2607TX${stamp.slice(-12)}`
  const meter = `M-GX-${stamp.slice(-10)}`
  const yyMMdd = stamp.slice(2, 8)
  const hhmm = stamp.slice(8, 12)
  const yyyyMMddHHmm = stamp.slice(0, 12)

  const segments = [
    "UNA:+.? ",
    `UNB+UNOC:3+${input.sender}:ZZ+${input.receiver}:ZZ+${yyMMdd}:${hhmm}+${interchange}++23-DDQ-E66-S++1`,
    `UNH+${unh}+UTILTS:D:02B:UN:E5SE5A`,
    `BGM+E66::260+${bgm}+9+AB`,
    `DTM+137:${yyyyMMddHHmm}:203`,
    'DTM+735:?+0200:406',
    'MKS+23+E02::260',
    `NAD+MS+${input.sender}:SVK:260`,
    `NAD+MR+${input.receiver}:SVK:260`,
    'NAD+DDQ',
    `IDE+24+${transaction}`,
    `LOC+172+${input.facilityId}::9`,
    'LOC+239+TES:SVK:260',
    'LIN+++8716867000030:::9',
    'DTM+324:202607010000202608010000:719',
    'DTM+597:202608010000:203',
    'DTM+354:1:802',
    'STS+7++E88::260',
    'MEA+AAZ++KWH',
    'CCI+++E12::260',
    'CAV+E17::260',
    'SEQ++1',
    'RFF+AES:101',
    `RFF+MG:${meter}`,
    'QTY+220:10000',
    'DTM+597:202607010000:203',
    'CCI+++E22::260',
    'CAV+E27::260',
    'SEQ++2',
    'RFF+AES:101',
    'QTY+220:11000',
    'DTM+597:202608010000:203',
    'CCI+++E22::260',
    'CAV+E27::260',
    'SEQ++3',
    'QTY+136:1000',
    `UNT+35+${unh}`,
    `UNZ+1+${interchange}`,
  ]
  return `${segments.join("'\n")}'\n`
}

describeStaging('Fakturatest staging E2E: E66 -> meter values -> underlay -> pricing -> invoice', () => {
  it('creates an isolated canonical test customer and proves the complete internal invoice graph', async () => {
    const actorUserId = requiredEnv('GRIDEX_E2E_ACTOR_USER_ID')
    const receiverEdielId = String(process.env.GRIDEX_INVOICE_TEST_RECEIVER_EDIEL_ID ?? '21660').trim()
    const senderEdielId = String(process.env.GRIDEX_INVOICE_TEST_SENDER_EDIEL_ID ?? '91100').trim()

    const { supabaseService } = await import('@/lib/supabase/service')
    const { buildCreateCustomerParams } = await import('@/app/admin/customers/actions.part-1')
    const { createCustomerGraph } = await import('@/app/admin/customers/actions.part-2')
    const {
      assertInvoiceTestCompanyAndOffer,
      markInvoiceTestCustomerGraph,
    } = await import('@/lib/ediel/testing/invoiceTestCenterWorkspace')
    const { resolveSingleInvoiceTestContractId } = await import('@/lib/ediel/testing/invoiceTestCenterCreation')
    const { archiveInvoiceTestCustomerSafely } = await import('@/lib/ediel/testing/invoiceTestCenterArchive')
    const { importRawEdifactAndRunTestCenterChain } = await import('@/lib/ediel/testing/testCenterRawEdifactImport')

    const actorRows = await supabaseService
      .from('ediel_actor_settings')
      .select('company_id,ediel_id,actor_ediel_id,is_active,environment')
      .eq('environment', 'test')
      .eq('is_active', true)
      .or(`ediel_id.eq.${receiverEdielId},actor_ediel_id.eq.${receiverEdielId}`)
      .limit(3)
    if (actorRows.error) throw actorRows.error
    const companyIds = Array.from(new Set((actorRows.data ?? []).map((row) => String(row.company_id ?? '')).filter(Boolean)))
    expect(companyIds, `Expected exactly one active TEST tenant owner for receiver Ediel ID ${receiverEdielId}`).toHaveLength(1)
    const companyId = companyIds[0]

    const offers = await supabaseService
      .from('canonical_internal_contract_offers_v')
      .select('id,company_id,name,contract_type,status,lifecycle_status,is_active,internal_publication_ready')
      .eq('company_id', companyId)
      .eq('contract_type', 'variable_monthly')
      .eq('status', 'active')
      .eq('lifecycle_status', 'published')
      .eq('is_active', true)
      .eq('internal_publication_ready', true)
      .limit(2)
    if (offers.error) throw offers.error
    expect(offers.data?.length ?? 0, 'Staging needs at least one published internal variable_monthly offer').toBeGreaterThan(0)
    const contractOfferId = String(offers.data?.[0]?.id ?? '')
    await assertInvoiceTestCompanyAndOffer({ companyId, contractOfferId })

    const spot = await supabaseService
      .from('spot_price_monthly_summaries')
      .select('id,status,price_area,billing_month,interval_count,expected_interval_count,quality_issues')
      .eq('price_area', 'SE3')
      .eq('billing_month', '2026-07')
      .eq('status', 'locked')
      .limit(2)
    if (spot.error) throw spot.error
    expect(spot.data?.length ?? 0, 'Staging needs a locked SE3 spot-price summary for 2026-07').toBeGreaterThan(0)
    expect(Number(spot.data?.[0]?.interval_count)).toBe(Number(spot.data?.[0]?.expected_interval_count))

    const runToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const facilityId = uniqueFacilityId()
    const rawEdifact = buildE66({ sender: senderEdielId, receiver: receiverEdielId, facilityId })
    const form = new FormData()
    for (const [key, value] of Object.entries({
      firstName: 'E2E',
      lastName: 'Fakturakund',
      email: `gridex-e2e-${runToken}@example.invalid`,
      phone: '0701234567',
      priceAreaCode: 'SE3',
      street: 'Testgatan 1',
      postalCode: '11122',
      city: 'Stockholm',
      country: 'SE',
      annualConsumptionKwh: '12000',
      invoiceEmail: `gridex-e2e-${runToken}@example.invalid`,
      invoiceRecipient: 'E2E Fakturakund',
      siteName: `Fakturatest E2E ${runToken}`,
      contractOfferId,
      contractStartDate: '2026-07-01',
    })) form.set(key, value)

    const built = buildCreateCustomerParams(form, actorUserId, companyId)
    let customerId: string | null = null
    try {
      const customer = await createCustomerGraph({
        ...built,
        actorUserId,
        companyId,
        customerType: 'private',
        intakeFlowType: null,
        phone: '0701234567',
        facilityId: null,
        meterPointId: null,
        siteType: 'consumption',
        currentSupplierId: null,
        currentSupplierName: null,
        currentSupplierOrgNumber: null,
        currentSupplierUnknown: true,
        customerConfirmationStatus: 'confirmed',
        authorizationStatus: null,
        authorizationValidFrom: null,
        authorizationValidTo: null,
        expectedStartDate: '2026-07-01',
        confirmedStartDate: '2026-07-01',
        actualStartDate: null,
        startDateSource: 'manual_admin',
        contractStartDate: '2026-07-01',
        contractStatus: 'pending_signature',
        overrideReason: null,
        contractTypeOverride: null,
        fixedPriceOrePerKwh: null,
        spotMarkupOrePerKwh: null,
        variableFeeOrePerKwh: null,
        monthlyFeeSek: null,
        invoiceFeeSek: null,
        startFeeSek: null,
        adminFeeSek: null,
        breakFeeSek: null,
        greenFeeMode: null,
        greenFeeValue: null,
        bindingMonths: null,
        noticeMonths: null,
        optionalFeeLines: [],
        duplicateResolution: 'create_separate_confirmed',
        existingCustomerId: null,
        duplicateOverrideReason: 'Isolerad staging E2E för Fakturatest.',
        invoiceRecipient: 'E2E Fakturakund',
        invoiceEmail: `gridex-e2e-${runToken}@example.invalid`,
        invoiceReference: 'GRIDEX-FAKTURATEST-E2E',
        billingStreet: 'Testgatan 1',
        billingPostalCode: '11122',
        billingCity: 'Stockholm',
        billingCountry: 'SE',
        billingAddressSameAsSite: true,
        billingLevel: 'customer',
        consolidatedInvoice: false,
        intakeCreateMode: 'create',
        signedAgreementFile: null,
        signedPowerOfAttorneyFile: null,
        gridInvoiceFile: null,
        postCreateAction: 'open_customer',
        postCreateRequestTarget: 'both',
      })
      customerId = customer.id
      expect(customer.__createdSiteId).toBeTruthy()
      expect(customer.__createdMeteringPointId).toBeNull()

      const contractId = await resolveSingleInvoiceTestContractId({ companyId, customerId })
      await markInvoiceTestCustomerGraph({
        companyId,
        customerId,
        siteId: customer.__createdSiteId,
        meteringPointId: null,
        contractId,
        actorUserId,
      })

      const result = await importRawEdifactAndRunTestCenterChain({
        actorUserId,
        companyId,
        customerId,
        billingMonth: '2026-07',
        rawEdifact,
        filename: `gridex-e2e-${runToken}.edi`,
      })

      expect(result.runtime.environment).toBe('test')
      expect(result.runtime.externalSideEffectsAllowed).toBe(false)
      expect(result.runtime.totalKwh).toBeCloseTo(1000, 3)
      expect(result.runtime.meteringValueIds).toHaveLength(1)
      expect(result.runtime.billingUnderlayId).toBeTruthy()
      expect(result.runtime.pricingRunId).toBeTruthy()
      expect(result.runtime.invoiceExportItemId).toBeTruthy()
      expect(result.runtime.customerInvoiceId).toBeTruthy()
      expect(result.runtime.invoiceAmountIncVat).toBeGreaterThan(0)

      const [point, contract, supply, meterValue, underlay, pricing, item, invoice] = await Promise.all([
        supabaseService.from('metering_points').select('id,meter_point_id,metering_point_id,site_facility_id,status,is_test_data,archived_at').eq('id', result.runtime.meteringPointId).single(),
        supabaseService.from('customer_contracts').select('id,status,starts_at,metering_point_id,signed_at,signature_method,billing_ready_status').eq('id', contractId).single(),
        supabaseService.from('customer_supply_periods').select('id,status,start_date,end_date,metering_point_id,contract_id').eq('company_id', companyId).eq('customer_id', customerId).in('status', ['active','confirmed_by_grid_owner']).single(),
        supabaseService.from('metering_values').select('id,quantity,quantity_kwh,period_start,period_end,billing_status,billing_gate_status,source_ediel_message_id').eq('id', result.runtime.meteringValueIds[0]).single(),
        supabaseService.from('billing_underlays').select('id,status,readiness_status,total_kwh,price_area,customer_contract_id,missing_values_count').eq('id', result.runtime.billingUnderlayId).single(),
        supabaseService.from('pricing_runs').select('id,status,locked_at,total_inc_vat,billing_underlay_id').eq('id', result.runtime.pricingRunId).single(),
        supabaseService.from('invoice_export_items').select('id,status,environment,provider,total_kwh,amount_inc_vat,sent_at,external_reference').eq('id', result.runtime.invoiceExportItemId).single(),
        supabaseService.from('customer_invoices').select('id,status,total_kwh,consumption_kwh,amount_inc_vat,price_area_code,calculation_snapshot_sha256,invoice_export_item_id').eq('id', result.runtime.customerInvoiceId).single(),
      ])
      for (const query of [point, contract, supply, meterValue, underlay, pricing, item, invoice]) {
        if (query.error) throw query.error
      }

      expect(point.data?.is_test_data).toBe(true)
      expect(point.data?.meter_point_id).toBe(facilityId)
      expect(point.data?.status).toBe('active')
      expect(contract.data?.metering_point_id).toBe(result.runtime.meteringPointId)
      expect(['signed', 'active']).toContain(contract.data?.status)
      expect(contract.data?.signed_at).toBeTruthy()
      expect(supply.data?.contract_id).toBe(contractId)
      expect(supply.data?.metering_point_id).toBe(result.runtime.meteringPointId)
      expect(String(supply.data?.start_date).slice(0, 10)).toBe('2026-07-01')
      expect(supply.data?.end_date).toBeNull()
      expect(Number(meterValue.data?.quantity_kwh ?? meterValue.data?.quantity)).toBeCloseTo(1000, 3)
      expect(meterValue.data?.billing_status).toBe('billable')
      expect(meterValue.data?.billing_gate_status).toBe('eligible')
      expect(meterValue.data?.source_ediel_message_id).toBe(result.edielMessageId)
      expect(underlay.data?.status).toBe('validated')
      expect(underlay.data?.readiness_status).toBe('ready')
      expect(Number(underlay.data?.total_kwh)).toBeCloseTo(1000, 3)
      expect(underlay.data?.price_area).toBe('SE3')
      expect(Number(underlay.data?.missing_values_count ?? 0)).toBe(0)
      expect(pricing.data?.status).toBe('locked')
      expect(pricing.data?.locked_at).toBeTruthy()
      expect(Number(pricing.data?.total_inc_vat)).toBeGreaterThan(0)
      expect(item.data?.environment).toBe('test')
      expect(item.data?.provider).toBe('capway_aptic')
      expect(item.data?.status).not.toBe('sent')
      expect(item.data?.sent_at).toBeNull()
      expect(Number(item.data?.total_kwh)).toBeCloseTo(1000, 3)
      expect(invoice.data?.invoice_export_item_id).toBe(result.runtime.invoiceExportItemId)
      expect(invoice.data?.calculation_snapshot_sha256).toBeTruthy()
      expect(Number(invoice.data?.total_kwh ?? invoice.data?.consumption_kwh)).toBeCloseTo(1000, 3)
      expect(Number(invoice.data?.amount_inc_vat)).toBeCloseTo(Number(pricing.data?.total_inc_vat), 2)
    } finally {
      if (customerId) {
        await archiveInvoiceTestCustomerSafely({ companyId, customerId, actorUserId })
      }
    }
  }, 120_000)
})
