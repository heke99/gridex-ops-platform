import { describe, expect, it } from 'vitest'
import { importRawEdifactAndRunTestCenterChain } from '@/lib/ediel/testing/testCenterRawEdifactImport'
import { assertInvoiceTestCustomer } from '@/lib/ediel/testing/invoiceTestCenterWorkspace'

const COMPANY_ID = 'b3ad1bf6-fa45-41a6-8054-2e0862e82aca'
const CUSTOMER_ID = 'b2ba249d-350b-4e26-8add-665d59fba70e'
const BILLING_MONTH = '2026-07'
const EXPECTED_METERING_REFERENCE = '735999260731000007'

const MONTHLY_E66 = `UNA:+.? '
UNB+UNOC:3+91100:ZZ+21660:ZZ+260831:1811+260831181101++23-DDQ-E66-S++1'
UNH+1+UTILTS:D:02B:UN:E5SE5A'
BGM+E66::260+GRIDEX2607E66MSG001+9+AB'
DTM+137:202608311811:203'
DTM+735:?+0200:406'
MKS+23+E02::260'
NAD+MS+91100:SVK:260'
NAD+MR+21660:SVK:260'
NAD+DDQ'
IDE+24+GRIDEX2607E66001'
LOC+172+735999260731000007::9'
LOC+239+TES:SVK:260'
LIN+++8716867000030:::9'
DTM+324:202607010000202608010000:719'
DTM+597:202608010000:203'
DTM+354:1:802'
STS+7++E88::260'
MEA+AAZ++KWH'
CCI+++E12::260'
CAV+E17::260'
SEQ++1'
RFF+AES:101'
RFF+MG:M-GRIDEX-2607-01'
QTY+220:10000'
DTM+597:202607010000:203'
CCI+++E22::260'
CAV+E27::260'
SEQ++2'
RFF+AES:101'
QTY+220:11000'
DTM+597:202608010000:203'
CCI+++E22::260'
CAV+E27::260'
SEQ++3'
QTY+136:1000'
UNT+35+1'
UNZ+1+260831181101'`

describe('live isolated Fakturatest E66 -> invoice', () => {
  it('runs the canonical test-only chain without external provider effects', async () => {
    const actorUserId = String(process.env.GRIDEX_E2E_ACTOR_USER_ID ?? '').trim()
    if (!actorUserId) throw new Error('GRIDEX_E2E_ACTOR_USER_ID is required')

    const customer = await assertInvoiceTestCustomer({ companyId: COMPANY_ID, customerId: CUSTOMER_ID })
    expect(customer.id).toBe(CUSTOMER_ID)

    const result = await importRawEdifactAndRunTestCenterChain({
      actorUserId,
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      billingMonth: BILLING_MONTH,
      rawEdifact: MONTHLY_E66,
      filename: 'gridex-live-fakturatest-e66-2026-07.edi',
    })

    expect(result.parsed.messageFamily).toBe('UTILTS')
    expect(String(result.parsed.messageCode).toUpperCase()).toBe('E66')
    expect(result.parsed.locations['172']?.[0]).toBe(EXPECTED_METERING_REFERENCE)
    expect(result.runtime.environment).toBe('test')
    expect(result.runtime.externalSideEffectsAllowed).toBe(false)
    expect(result.materializedMeteringPointId).toBe(result.runtime.meteringPointId)
    expect(result.runtime.meteringValueIds.length).toBeGreaterThan(0)
    expect(result.runtime.totalKwh).toBeCloseTo(1000, 6)
    expect(result.runtime.billingUnderlayId).toBeTruthy()
    expect(result.runtime.pricingRunId).toBeTruthy()
    expect(result.runtime.invoiceExportItemId).toBeTruthy()
    expect(result.runtime.customerInvoiceId).toBeTruthy()
    expect(result.runtime.invoiceAmountIncVat).toBeGreaterThan(0)

    console.log(JSON.stringify({
      inboundEmailMessageId: result.inboundEmailMessageId,
      edielMessageId: result.edielMessageId,
      meteringPointId: result.runtime.meteringPointId,
      meteringValueIds: result.runtime.meteringValueIds,
      billingUnderlayId: result.runtime.billingUnderlayId,
      pricingRunId: result.runtime.pricingRunId,
      invoiceExportItemId: result.runtime.invoiceExportItemId,
      customerInvoiceId: result.runtime.customerInvoiceId,
      totalKwh: result.runtime.totalKwh,
      invoiceAmountIncVat: result.runtime.invoiceAmountIncVat,
      environment: result.runtime.environment,
      externalSideEffectsAllowed: result.runtime.externalSideEffectsAllowed,
    }))
  }, 120_000)
})
