import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CustomerContactChangeError,
  assertProfileEditableStatus,
  changedFields,
  normalizeContactEmail,
  normalizeContactPhone,
  planPrimaryContactSync,
} from '@/lib/customer-service/contactChange'

describe('shared contact-change rules', () => {
  it('distinguishes omitted, cleared and set values', () => {
    expect(normalizeContactEmail(undefined)).toBeUndefined()
    expect(normalizeContactEmail(null)).toBeNull()
    expect(normalizeContactEmail('  ')).toBeNull()
    expect(normalizeContactEmail(' Kund@Example.TEST ')).toBe('kund@example.test')
    expect(normalizeContactPhone(undefined)).toBeUndefined()
    expect(normalizeContactPhone('070-123 45 67')).toBe('070-123 45 67')
    expect(normalizeContactPhone('070/123 45 67')).toBe('070/123 45 67')
    expect(normalizeContactPhone('+46 (0)70 123 45 67')).toBe('+46 (0)70 123 45 67')
  })

  it('rejects invalid email and phone', () => {
    expect(() => normalizeContactEmail('not-an-email')).toThrow(CustomerContactChangeError)
    expect(() => normalizeContactPhone('<script>')).toThrow(CustomerContactChangeError)
  })

  it('allows only profile-editable statuses; archive goes through its own flow (F6)', () => {
    expect(assertProfileEditableStatus('active', 'draft')).toBe('active')
    expect(assertProfileEditableStatus(null, 'draft')).toBe('draft')
    expect(() => assertProfileEditableStatus('archived', 'draft')).toThrow(/arkivflödet/)
    expect(() => assertProfileEditableStatus('anything', 'draft')).toThrow(CustomerContactChangeError)
  })

  it('mirrors private customer to primary contact including clears', () => {
    expect(planPrimaryContactSync({ customerType: 'private', contactName: 'Anna A', email: null, phone: '070' }))
      .toEqual({ name: 'Anna A', email: null, phone: '070' })
  })

  it('never wipes a company contact person email/phone from an empty customer field (F7)', () => {
    expect(planPrimaryContactSync({ customerType: 'business', contactName: 'Bo B', email: null, phone: null }))
      .toEqual({ name: 'Bo B' })
  })

  it('a phone-only change touches only phone', () => {
    expect(planPrimaryContactSync({ customerType: 'private', contactName: null, email: undefined, phone: '0701' }))
      .toEqual({ phone: '0701' })
  })

  it('changedFields reports only real changes', () => {
    expect(changedFields({ email: 'a@x.se', phone: '1' }, { email: 'a@x.se', phone: '2', updated_at: 'x' }))
      .toEqual({ phone: { from: '1', to: '2' } })
  })
})

describe('OPS and API adapters use the shared rules', () => {
  const ops = readFileSync('app/admin/customers/[id]/profile-actions.part-1.ts', 'utf8')
  const api = readFileSync('app/api/v1/customer/profile-update/route.ts', 'utf8')

  it('both adapters sync the primary contact through planPrimaryContactSync', () => {
    expect(ops).toContain('planPrimaryContactSync(')
    expect(api).toContain('planPrimaryContactSync(')
  })

  it('OPS validates status and supports an optimistic version check', () => {
    expect(ops).toContain('assertProfileEditableStatus(')
    expect(ops).toContain('expected_updated_at')
    // Unchanged legacy values never block an unrelated save.
    expect(ops).toContain('rawPhone === (stored.phone ?? null) ? rawPhone')
    expect(ops).toContain('rawStatus && rawStatus === stored.status')
    expect(ops).not.toMatch(/getNullableString\(formData, "status"\) \?\? "draft"/)
  })

  it('API writes a fail-closed audit row with machine/portal actor and version lock (F10)', () => {
    expect(api).toContain("tenantInsert(input.companyId, 'audit_logs'")
    expect(api).toContain("actor_type: 'customer_portal_account'")
    expect(api).toContain("profile_version_conflict")
  })
})
