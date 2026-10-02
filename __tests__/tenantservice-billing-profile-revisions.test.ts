import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// P3: versioned billing profile. The behaviour is exercised against a real database by
// scripts/tenantservice-identity-billing-regression.sql in the clean replay; these checks pin
// the migration's safety properties.
describe('P3 billing profile revisions migration', () => {
  const sql = readFileSync('supabase/migrations/20261002140000_customer_billing_profile_revisions.sql', 'utf8')

  it('versions every billing write in the database, whatever the writer', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public.customers')
    expect(sql).toContain('AFTER INSERT OR UPDATE ON public.customers')
    for (const column of ['invoice_email', 'billing_street', 'billing_postal_code', 'billing_city', 'billing_country']) {
      expect(sql).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`)
    }
    // Writers cannot move the revision themselves.
    expect(sql).toContain('NEW.billing_profile_revision := OLD.billing_profile_revision;')
  })

  it('keeps history append-only except when the customer itself is deleted', () => {
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.customer_billing_profile_revisions')
    expect(sql).toContain("IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN")
  })

  it('locks the revision on every billing item and refuses to change it later', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public.billing_export_run_items')
    expect(sql).toContain('billing_item_profile_revision_immutable')
  })

  it('is tenant-scoped, service-role read only and forward-only', () => {
    expect(sql).toContain('UNIQUE (company_id, customer_id, revision)')
    expect(sql).toContain('REVOKE ALL ON TABLE public.customer_billing_profile_revisions FROM PUBLIC, anon, authenticated')
    expect(sql).toContain('GRANT SELECT ON TABLE public.customer_billing_profile_revisions TO service_role')
    expect(sql).not.toMatch(/\bDROP\b/)
  })

  it('the native regression runs in the clean replay', () => {
    const workflow = readFileSync('.github/workflows/ops-hardening.yml', 'utf8')
    expect(workflow).toContain('scripts/tenantservice-identity-billing-regression.sql')
  })
})
