import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { buildCustomerParamsFromImportRow } from '@/app/admin/customers/actions.part-3'

describe('import keeps contact and billing destinations separate', () => {
  const parse = (row: Record<string, string>) => buildCustomerParamsFromImportRow({
    actorUserId: 'synthetic-actor', companyId: 'synthetic-company', row,
  })
  it('T50 contact-only import does not create a billing override', async () => {
    const result = await parse({ email: 'contact@example.test', first_name: 'Synthetic' })
    expect(result.email).toBe('contact@example.test')
    expect(result.invoiceEmail).toBeNull()
  })
  it('keeps an explicitly imported invoice destination even when contact changes', async () => {
    const result = await parse({ email: 'contact@example.test', invoice_email: 'accountant@example.test' })
    expect(result.email).toBe('contact@example.test')
    expect(result.invoiceEmail).toBe('accountant@example.test')
  })
  it('keeps the documented billing_email import alias explicit', async () => {
    expect((await parse({ email: 'contact@example.test', billing_email: 'billing@example.test' })).invoiceEmail).toBe('billing@example.test')
  })
})
