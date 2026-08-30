import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
const sha256 = (file: string) => crypto.createHash('sha256').update(read(file)).digest('hex')

const parityMigration = 'supabase/migrations/20260830091937_manual_inbound_canonical_correlation_parity.sql'
const tenantGraphMigration = 'supabase/migrations/20260830102119_manual_inbound_tenant_graph_hardening.sql'

describe('manual inbound canonical tenant graph', () => {
  it('pins the live migration versions and checksums in the runtime manifest', () => {
    const manifest = JSON.parse(read('scripts/migration-history-manifest.runtime.additions.json')) as { files: Record<string, string> }
    expect(manifest.files[path.basename(parityMigration)]).toBe(sha256(parityMigration))
    expect(manifest.files[path.basename(tenantGraphMigration)]).toBe(sha256(tenantGraphMigration))
  })

  it('enforces company -> customer -> site -> metering point in the database', () => {
    const source = read(tenantGraphMigration)
    expect(source).toContain('manual_inbound_customer_requires_company_ck')
    expect(source).toContain('manual_inbound_site_requires_customer_ck')
    expect(source).toContain('manual_inbound_meter_requires_site_ck')
    expect(source).toContain('foreign key (company_id, customer_id)')
    expect(source).toContain('references public.customers(company_id, id)')
    expect(source).toContain('foreign key (company_id, customer_id, customer_site_id)')
    expect(source).toContain('references public.customer_sites(company_id, customer_id, id)')
    expect(source).toContain('foreign key (company_id, customer_id, customer_site_id, metering_point_id)')
    expect(source).toContain('references public.metering_points(company_id, customer_id, site_id, id)')
    expect(source).toContain('validate constraint manual_inbound_company_customer_site_meter_fk')
  })
})

describe('billing review lifecycle', () => {
  it('treats customer invoice projection as an optional later lifecycle stage', () => {
    const source = read('lib/billing/invoiceReviewData.ts')
    expect(source).toContain(".from('customer_invoices').select('*')")
    expect(source).toContain('.maybeSingle()')
    expect(source).toContain("'awaiting_invoice_projection'")
    expect(source).toContain('invoice: invoiceRow')
    expect(source).toContain('lifecycleStage')
  })

  it('renders an explicit intermediate state instead of dereferencing a missing invoice', () => {
    const source = read('app/admin/billing/invoices/[id]/page.tsx')
    expect(source).toContain("detail.lifecycleStage === 'awaiting_invoice_projection'")
    expect(source).toContain('Fakturaprojektion pågår')
    expect(source).toContain('const invoice: Row = detail.invoice ?? {}')
    expect(source).not.toContain('detail.invoice.calculation_snapshot')
  })
})
