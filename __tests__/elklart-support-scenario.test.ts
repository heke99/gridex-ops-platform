import { describe, expect, it } from 'vitest'
import { validateSupportTarget, matchKarinCustomer, validateSupportReceipt, supportMessages } from '../scripts/demo/elklart-support-scenario.mjs'
const companyId = '00000000-0000-0000-0000-000000000001'
const customerId = '00000000-0000-0000-0000-000000000002'
const tenant = { companyId, fictional: true }
const account = { email: 'administrator@elklart.example.invalid', password: 'private', role: 'company_admin' }
describe('guarded ordinary support scenario', () => {
  it('requires the dedicated loopback target, fictitious tenant and scoped support account', () => {
    expect(() => validateSupportTarget('https://localhost:3000', tenant, account)).not.toThrow()
    for (const origin of ['https://app.gridex.se', 'http://localhost:3000', 'https://localhost:3000.evil.test', 'https://localhost:3000/path', 'https://localhost:3000?x=1']) expect(() => validateSupportTarget(origin, tenant, account)).toThrow()
    expect(() => validateSupportTarget('https://localhost:3000', { ...tenant, fictional: false }, account)).toThrow()
    expect(() => validateSupportTarget('https://localhost:3000', tenant, { ...account, role: 'operations_agent' })).toThrow()
    expect(() => validateSupportTarget('https://localhost:3000', tenant, { ...account, email: 'real@example.com' })).toThrow()
  })
  it('resolves one exact fictional customer and refuses ambiguous or conflicting IDs', () => {
    const options = [{ value: customerId, label: 'Karin Holm · E2E-1' }, { value: companyId, label: 'Karin Holmlund' }]
    expect(matchKarinCustomer(options)).toBe(customerId)
    expect(matchKarinCustomer([])).toBeNull()
    expect(() => matchKarinCustomer([...options, { value: companyId, label: 'Karin Holm' }])).toThrow(/Ambiguous/)
    expect(() => matchKarinCustomer(options, companyId)).toThrow(/mismatch/)
  })
  it('refuses foreign or malformed resumptions and keeps internal/public markers distinct', () => {
    expect(() => validateSupportReceipt({ companyId, customerId, runId: 'test-run', version: 1 }, companyId)).not.toThrow()
    expect(() => validateSupportReceipt({ companyId, customerId, runId: 'test-run', version: 1 }, customerId)).toThrow()
    expect(() => validateSupportReceipt({ companyId, customerId: 'invalid', runId: 'test-run', version: 1 }, companyId)).toThrow()
    const messages = supportMessages('test-run')
    expect(new Set(Object.values(messages)).size).toBe(4)
    expect(messages.internal).toContain('INTERNT')
    expect(messages.reply).not.toContain('INTERNT')
  })
})
