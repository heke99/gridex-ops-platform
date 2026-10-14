import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  calls: [] as Array<{ table: string; fields: string; filters: Array<[string, unknown]> }>,
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    const call = { table, fields: '', filters: [] as Array<[string, unknown]> }
    io.calls.push(call)
    const rows = () => (io.tables[table] ?? []).filter(row => call.filters.every(([key, value]) =>
      Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
    ))
    const query = {
      select: (fields: string) => { call.fields = fields; return query },
      order: () => query,
      limit: () => query,
      eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query },
      in: (key: string, value: unknown) => { call.filters.push([key, value]); return query },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (result: unknown) => unknown) => resolve({ data: rows(), error: null }),
    }
    return query
  },
} }))

import { getWebsiteApplicationAdminRow, listWebsiteApplications } from '@/lib/admin/websiteIntegrationOps'

const sourcePath = path.join(process.cwd(), 'lib/admin/websiteIntegrationOps.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

const ambiguousEmbed = 'customers(full_name,company_name,email,phone)'
const tenantSafeEmbed = 'customers!website_customer_applications_company_customer_fkey(full_name,company_name,email,phone)'

beforeEach(() => {
  io.calls = []
  io.tables = {
    gridex_website_application_work_items_v: [{
      application_id: 'application', company_id: 'company', source_table: 'website_customer_applications',
      status: 'pending_review', work_state: 'action_required', is_pending: true, linked_external_intake_id: null,
    }],
    website_customer_applications: [
      { id: 'application', company_id: 'company', status: 'pending_review', customers: { full_name: 'Rätt kund' } },
      { id: 'application', company_id: 'foreign-company', status: 'pending_review', customers: { full_name: 'Annat bolags kund' } },
    ],
  }
})

describe('website application customer relationship', () => {
  it('never uses the ambiguous customer relationship for website applications', () => {
    expect(source).not.toContain(ambiguousEmbed)
  })

  it.each(['list', 'detail'] as const)('hydrates the %s through the explicit company + customer relationship', async (read) => {
    const row = read === 'list'
      ? (await listWebsiteApplications({ companyId: 'company' }))[0]
      : await getWebsiteApplicationAdminRow('application', { companyId: 'company', sourceTable: 'website_customer_applications' })

    expect(row).toMatchObject({ id: 'application', company_id: 'company', customers: { full_name: 'Rätt kund' } })
    const hydration = io.calls.filter(call => call.table === 'website_customer_applications')
    expect(hydration).toHaveLength(1)
    expect(hydration[0].fields).toContain(tenantSafeEmbed)
    expect(hydration[0].filters).toContainEqual(['company_id', 'company'])
    expect(hydration[0].filters.some(([key, value]) => key === 'id' &&
      (Array.isArray(value) ? value.length === 1 && value[0] === 'application' : value === 'application'),
    )).toBe(true)
    const canonicalReads = io.calls.filter(call => call.table === 'gridex_website_application_work_items_v')
    expect(canonicalReads).toHaveLength(1)
    expect(canonicalReads[0].filters).toContainEqual(['company_id', 'company'])
  })
})
