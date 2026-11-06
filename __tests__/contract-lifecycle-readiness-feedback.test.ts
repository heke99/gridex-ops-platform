import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
import { contractDatabaseErrorMessage, contractLifecycleError } from '@/lib/contracts/lifecycleErrors'
import { toSafeContractError } from '@/lib/errors/safeActionErrors'

const expected = 'Avtalsversionen kan inte publiceras förrän blockerarna är åtgärdade.'

describe('structured contract readiness feedback', () => {
  it('maps a structured readiness denial without relying on translated message text', () => {
    const error = contractLifecycleError({ ok: false, code: 'contract_version_not_publishable', blockers: [{ code: 'tenant_go_live_not_ready', message: 'Produktionsrouting saknas.' }] }, 'Fallback')
    expect(contractDatabaseErrorMessage(error)).toBe(expected)
    const safe = toSafeContractError(error, { action: 'publish_contract_version' })
    expect(safe).toMatch(/^Avtalsversionen kan inte publiceras förrän blockerarna är åtgärdade\. Referens: [A-F0-9]{12}\.$/)
    expect(safe).not.toContain('Produktionsrouting saknas.')
  })
  it('returns the approved message instead of arbitrary diagnostics', () => {
    expect(contractDatabaseErrorMessage({ code: 'contract_version_not_publishable', message: 'SYNTHETIC_PRIVATE_DIAGNOSTIC' })).toBe(expected)
  })
  it.each(['toString', 'constructor', '__proto__', 'XX000'])('does not map unknown or inherited code %s', (code) => {
    expect(contractDatabaseErrorMessage({ code, message: 'SYNTHETIC_PRIVATE_DIAGNOSTIC' })).toBeNull()
  })
  it('keeps legacy embedded reason-code mapping', () => {
    expect(contractDatabaseErrorMessage(new Error('contract_version_not_publishable'))).toBe(expected)
  })
  it('preserves database integrity feedback', () => {
    expect(contractDatabaseErrorMessage({ code: '23503' })).toContain('refererar')
  })
  it('handles absent errors', () => {
    expect(contractDatabaseErrorMessage(null)).toBeNull()
  })
})
