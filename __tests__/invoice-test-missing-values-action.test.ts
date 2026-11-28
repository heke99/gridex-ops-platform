import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importRawEdifactAndRunTestCenterAction } from '@/app/admin/ediel/test-center/actions'
import { importInvoiceTestEdifactAction } from '@/app/admin/ediel/test-center/invoice-test/actions'

const io = vi.hoisted(() => ({
  importChain: vi.fn(),
  assertCustomer: vi.fn(),
  revalidate: vi.fn(),
  external: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: io.revalidate }))
vi.mock('next/navigation', () => ({
  redirect: (target: string): never => { throw { target, digest: 'NEXT_REDIRECT' } },
  unstable_rethrow: (error: unknown) => {
    if (error && typeof error === 'object' && 'digest' in error && error.digest === 'NEXT_REDIRECT') throw error
  },
}))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: async () => ({ userId: 'test-user' }) }))
vi.mock('@/lib/ediel/testing/testCenterRawEdifactImport', () => ({
  importRawEdifactAndRunTestCenterChain: io.importChain,
}))
vi.mock('@/lib/ediel/testing/invoiceTestCenterWorkspace', () => ({ assertInvoiceTestCustomer: io.assertCustomer }))
vi.mock('@/lib/billing/invoiceTestCenterDispatch', () => ({ approveAndSendInvoiceTestItem: io.external }))
vi.mock('@/lib/ediel/testing/testCenterRuntimeChain', () => ({ runTestCenterMeteringToInvoiceChain: io.external }))
vi.mock('@/lib/ediel/testing/testRunTransportMetadata', () => ({}))
vi.mock('@/lib/ediel/testing/testCenterSafety', () => ({}))
vi.mock('@/lib/supabase/service', () => ({}))
vi.mock('@/app/admin/customers/actions.part-1', () => ({}))
vi.mock('@/app/admin/customers/actions.part-2', () => ({}))
vi.mock('@/lib/ediel/testing/invoiceTestCenterCreation', () => ({}))
vi.mock('@/lib/ediel/testing/invoiceTestCenterArchive', () => ({}))
vi.mock('@/lib/ediel/testing/invoiceTestCenterQuarantine', () => ({}))

const energyBlock = 'Fakturatest kräver positiv fakturerbar periodenergi i QTY+136. Mätarställning QTY+220 räknas inte som förbruknings-kWh.'
const edifact = "UNB+UNOC:3+SENDER+RECEIVER+260830:1200+1'UNH+1+UTILTS:D:02B:UN:S02'BGM+Z04+1+9'LOC+172+735999000000000001'QTY+136:12.5:KWH'DTM+163:202608010000:203'UNT+6+1'UNZ+1+1'"

beforeEach(() => vi.resetAllMocks())

describe.each([
  { name: 'Fakturatest', action: importInvoiceTestEdifactAction, fields: ['companyId', 'customerId', 'billingMonth'] },
  { name: 'Mätvärde till faktura', action: importRawEdifactAndRunTestCenterAction, fields: ['runtimeCompanyId', 'runtimeCustomerId', 'runtimeBillingMonth'] },
])('$name missing values', ({ action, fields }) => {
  async function run() {
    const form = new FormData()
    form.set(fields[0], 'test-company')
    form.set(fields[1], 'test-customer')
    form.set(fields[2], '2026-08')
    form.set('testScenario', 'missing_values')
    form.set('rawEdifact', edifact)
    try {
      await action(form)
    } catch (error) {
      if (!error || typeof error !== 'object' || !('target' in error) || typeof error.target !== 'string') throw error
      return new URL(error.target, 'https://gridex.invalid').searchParams
    }
    throw new Error('Expected the action to redirect with a test result.')
  }

  it('passes when preflight reports the precise missing QTY+136 energy rejection', async () => {
    io.importChain.mockRejectedValueOnce(new Error(energyBlock))
    const result = await run()
    expect(result.get('runStatus')).toBe('success')
    expect(result.get('runMessage')).toContain(energyBlock)
    expect(io.importChain).toHaveBeenCalledOnce()
    expect(io.importChain.mock.calls[0]?.[0]?.rawEdifact).not.toContain('QTY+136')
    expect(io.external).not.toHaveBeenCalled()
  })

  it('shows an unrelated import failure as an error without revalidation or dispatch', async () => {
    io.importChain.mockRejectedValueOnce(new Error('Testimportens lagring är otillgänglig.'))
    const result = await run()
    expect(result.get('runStatus')).toBe('error')
    expect(result.get('runMessage')).toBe('Testimportens lagring är otillgänglig.')
    expect(io.revalidate).not.toHaveBeenCalled()
    expect(io.external).not.toHaveBeenCalled()
  })

  it('preserves a database error even when its detail quotes the expected energy rejection', async () => {
    io.importChain.mockRejectedValueOnce({ message: 'Testimportens behörighetskontroll avvisades.', code: '42501', details: energyBlock })
    const result = await run()
    expect(result.get('runStatus')).toBe('error')
    expect(result.get('runMessage')).toBe('Testimportens behörighetskontroll avvisades. · kod: 42501 · ' + energyBlock)
    expect(io.revalidate).not.toHaveBeenCalled()
    expect(io.external).not.toHaveBeenCalled()
  })

  it('fails when the negative test unexpectedly returns a successful chain result', async () => {
    io.importChain.mockResolvedValueOnce({})
    const result = await run()
    expect(result.get('runStatus')).toBe('error')
    expect(result.get('runMessage')).toMatch(/Missing-values-scenariot/)
    expect(io.revalidate).not.toHaveBeenCalled()
    expect(io.external).not.toHaveBeenCalled()
  })
})
