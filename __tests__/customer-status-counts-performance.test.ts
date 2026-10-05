import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const customerSource = readFileSync(join(repoRoot, 'lib/customers/getCustomers.ts'), 'utf8')
const migrationSource = readFileSync(
  join(repoRoot, 'supabase/migrations/20260825235900_gridex_customer_status_counts_v1.sql'),
  'utf8'
)

describe('customer registry status-count performance invariants', () => {
  it('collapses the status chips into one service-role RPC', () => {
    expect(customerSource).toContain(".rpc('gridex_customer_status_counts_v1'")
    expect(customerSource).toContain('p_company_id: params.companyId')
    expect(customerSource).toContain('p_customer_type: params.customerType')
    expect(customerSource).toContain('p_exclude_test_data: params.excludeTestData')
    expect(customerSource).not.toContain('const countForStatus = async')
    expect(customerSource).not.toContain("select('id', { count: 'exact', head: true })")
  })

  it('keeps the aggregate security-invoker and service-role-only', () => {
    expect(migrationSource.toLowerCase()).toContain('security invoker')
    expect(migrationSource).toContain('c.company_id is not null')
    expect(migrationSource).toContain('(p_company_id is null or c.company_id = p_company_id)')
    expect(migrationSource).toContain("c.source <> 'ediel_portal_test'")
    expect(migrationSource).toContain("c.source not ilike '%test%'")
    expect(migrationSource).toContain('revoke all on function public.gridex_customer_status_counts_v1(uuid, text, boolean) from authenticated')
    expect(migrationSource).toContain('grant execute on function public.gridex_customer_status_counts_v1(uuid, text, boolean) to service_role')
    expect(migrationSource.toLowerCase()).not.toContain('security definer')
  })

  it('computes every customer status chip in the same aggregate query', () => {
    for (const status of [
      'draft',
      'pending_verification',
      'active',
      'inactive',
      'moved',
      'terminated',
      'blocked',
      'archived',
    ]) {
      expect(migrationSource).toContain(`count(*) filter (where c.status = '${status}')`)
    }
  })
})
