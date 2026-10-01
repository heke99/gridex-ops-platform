import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveEffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'

const migration = readFileSync(new URL('../supabase/migrations/20260930161500_customer_billing_profile_command.sql', import.meta.url), 'utf8')

describe('billing profile migration prerequisites and legacy destination preservation', () => {
  it('guards the country projection for every customer writer and updates it inside the canonical command', () => {
    const customerGuard = migration.match(/if tg_table_name='customers' then([\s\S]*?)\n  else\n/)?.[1] ?? ''
    expect(customerGuard.includes('old.billing_country')).toBe(true)
    expect(customerGuard.includes('new.billing_country')).toBe(true)
    const customerCommand = migration.match(/update public\.customers set billing_profile=v_profile([\s\S]*?)returning \* into v_customer;/)?.[1] ?? ''
    expect(customerCommand.includes("billing_country=v_profile->>'country'")).toBe(true)
    expect(customerCommand).not.toMatch(/billing_country\s*=\s*coalesce/)
  })

  it('allows an explicit missing invoice country without replacing it with the legacy SE default', () => {
    expect(/alter table public\.customers\s+alter column billing_country drop not null/i.test(migration)).toBe(true)
    const effective = resolveEffectiveBillingProfile({
      companyId: 'tenant-a', customerId: 'customer-a', defaultDistributionMethod: 'paper',
      customer: { id: 'customer-a', company_id: 'tenant-a', billing_profile_revision: 2,
        billing_country: 'SE', billing_profile: { recipient: 'Synthetic Customer', street: 'Synthetic Street',
          postalCode: '0123', city: 'Synthetic City', country: null } },
    })
    expect(effective.address.country).toBeNull()
  })

  it('introduces the invoice e-mail projection omitted by the canonical replay schema before using it', () => {
    const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
    const canonicalCustomers = schema.match(/CREATE TABLE public\.customers \(([\s\S]*?)\n\);/)?.[1] ?? ''
    const existingColumn = /^\s*invoice_email text[,\s]/m.test(canonicalCustomers)
    const firstRead = migration.search(/btrim\(invoice_email\)|p_customer->>'invoice_email'/)
    const prerequisite = migration.search(/add column if not exists invoice_email text/i)
    expect(existingColumn || (prerequisite >= 0 && prerequisite < firstRead)).toBe(true)
  })

  it('uses one initializer for backfill and insertion that preserves the supplied country and billing-only e-mail', () => {
    const initializer = migration.match(/create function private\.gridex_billing_default_from_legacy_v1\(p_customer jsonb\)([\s\S]*?)\$initial\$;/)?.[1] ?? ''
    expect(initializer).toContain("p_customer->>'billing_country'")
    expect(initializer).toContain("p_customer->>'invoice_email'")
    expect(initializer).not.toContain("p_customer->>'email'")
    expect(migration).toContain('private.gridex_billing_default_from_legacy_v1(to_jsonb(c))')
    expect(migration).toContain('private.gridex_billing_default_from_legacy_v1(to_jsonb(new))')
  })

  it('does not turn the presence of an e-mail or postal address into a new customer channel choice', () => {
    expect(migration).not.toMatch(/'distributionMethod',case when nullif\(btrim\((?:new\.)?invoice_email\)/)
    const initializer = migration.match(/create function private\.gridex_billing_default_from_legacy_v1\(p_customer jsonb\)([\s\S]*?)\$initial\$;/)?.[1] ?? ''
    expect(initializer).not.toContain('distributionMethod')
    const effective = resolveEffectiveBillingProfile({
      companyId: 'tenant-a', customerId: 'customer-a', defaultDistributionMethod: 'paper',
      customer: { id: 'customer-a', company_id: 'tenant-a', billing_profile_revision: 0,
        billing_profile: { recipient: 'Synthetic Customer', email: 'invoice@example.invalid',
          street: 'Synthetic Street', postalCode: '0123', city: 'Synthetic City', country: 'NO' } },
      contract: { id: 'contract-a', company_id: 'tenant-a', customer_id: 'customer-a',
        billing_profile_override: {}, billing_profile_override_revision: 0 },
    })
    expect(effective).toMatchObject({ distributionMethod: 'paper', address: { country: 'NO' },
      sources: { distributionMethod: 'tenant_default' }, blockers: [] })
  })
})
