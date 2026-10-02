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

  it('both adapters write through the single P2b transaction, never sequential table writes (F10)', () => {
    for (const source of [ops, api]) {
      expect(source).toContain('applyCustomerContactChange(')
      expect(source).not.toMatch(/tenant(Update|Insert)\([^)]*"?'?(customers|customer_contacts|audit_logs)/)
    }
    expect(api).toContain("kind: 'customer_portal'")
    expect(api).toContain('profile_version_conflict')
    expect(ops).toContain('kind: "staff"')
  })
})

describe('P2b transaction migration', () => {
  const sql = readFileSync('supabase/migrations/20261001210000_customer_contact_change_transaction.sql', 'utf8')

  it('is SECURITY INVOKER, pinned search_path, executable only by service_role', () => {
    expect(sql).toContain('SECURITY INVOKER')
    expect(sql).toContain("SET search_path TO ''")
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.gridex_customer_contact_change_v1\([^)]*\)\s+FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.gridex_customer_contact_change_v1\([^)]*\)\s+TO service_role/)
  })

  it('locks the tenant-scoped row, checks version and authorizes staff in that company', () => {
    expect(sql).toContain('WHERE id=p_customer_id AND company_id=p_company_id FOR UPDATE')
    expect(sql).toContain("MESSAGE='contact_change_version_conflict'")
    expect(sql).toContain("gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'masterdata.write')")
  })

  it('writes audit, domain event and outbox in the same function, idempotent per company and key', () => {
    for (const table of ['public.audit_logs', 'public.domain_events', 'public.event_outbox']) {
      expect(sql).toContain(`INSERT INTO ${table}`)
    }
    expect(sql).toContain("'customer.contact_changed:'||p_company_id||':'||p_idempotency_key")
    // Only changed field names leave the database through the outbox payload.
    expect(sql).toContain("'changed_fields'")
  })

  it('repairs the invoice_email replay drift idempotently and deletes nothing', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS invoice_email text')
    expect(sql).not.toMatch(/\b(DELETE|DROP|TRUNCATE)\b/)
  })
})

describe('F13: profile automation enqueue is awaited', () => {
  it('never leaves the enqueue as a floating promise in the serverless route', async () => {
    const { readFileSync } = await import('node:fs')
    const route = readFileSync('app/api/v1/customer/profile-update/route.ts', 'utf8')
    expect(route).not.toMatch(/void\s+enqueueCustomerDataRequestAutomation/)
    expect(route).toMatch(/await enqueueCustomerDataRequestAutomation\(/)
  })
})
