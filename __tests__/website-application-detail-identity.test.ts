import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ tables: {} as Record<string, Array<Record<string, unknown>>> }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const filters: Array<[string, unknown]> = []
  let take = 1000
  const rows = () => (io.tables[table] ?? []).filter((row) => filters.every(([key, value]) =>
    Array.isArray(value) ? value.includes(row[key]) : row[key] === value)).slice(0, take)
  const q = {
    select: () => q, order: () => q,
    limit: (count: number) => { take = count; return q },
    eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
    in: (key: string, value: unknown) => { filters.push([key, value]); return q },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error: null }),
  }
  return q
} } }))
import { getWebsiteApplicationAdminRow, listWebsiteApplications } from '@/lib/admin/websiteIntegrationOps'

beforeEach(() => { io.tables = {} })

function work(id: string, source = 'website_customer_applications', mirror: string | null = null) {
  return { application_id: id, company_id: 'company', source_table: source, status: 'pending_review', work_state: 'action_required', is_pending: true, linked_external_intake_id: mirror }
}

it('keeps ambiguous shared-key external customers out of canonical details', async () => {
  io.tables.website_customer_applications = [
    { id: 'a', company_id: 'company', api_client_id: 'client-a', idempotency_key: 'shared', customer_id: null },
    { id: 'b', company_id: 'company', api_client_id: 'client-b', idempotency_key: 'shared', customer_id: null },
  ]
  io.tables.external_contract_intakes = [{ id: 'e', company_id: 'company', idempotency_key: 'shared', created_customer_id: 'external-customer' }]
  io.tables.gridex_website_application_work_items_v = [work('a'), work('b'), work('e', 'external_contract_intakes', 'e')]
  const detail = await getWebsiteApplicationAdminRow('a', { companyId: 'company', sourceTable: 'website_customer_applications' })
  expect(detail?.customer_id).toBeNull()
  expect(detail?.linked_external_intake_id).toBeNull()
})

it('hydrates the explicit older mirror beyond twenty unrelated recent intakes and shares list state', async () => {
  io.tables.website_customer_applications = [{ id: 'a', company_id: 'company', idempotency_key: 'old-key', customer_id: null, status: 'partial' }]
  io.tables.external_contract_intakes = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `new-${i}`, company_id: 'company', idempotency_key: `new-${i}` })),
    { id: 'old-e', company_id: 'company', idempotency_key: 'old-key', created_customer_id: 'old-customer', payload: { website_application_id: 'a' } },
  ]
  io.tables.gridex_website_application_work_items_v = [work('a', 'website_customer_applications', 'old-e')]
  const detail = await getWebsiteApplicationAdminRow('a', { companyId: 'company', sourceTable: 'website_customer_applications' })
  expect(detail).toMatchObject({ customer_id: 'old-customer', status: 'pending_review', work_state: 'action_required', is_pending: true })
  expect((await listWebsiteApplications({ companyId: 'company' }))[0]).toMatchObject({ customer_id: 'old-customer', status: 'pending_review', work_state: 'action_required' })
})

it('resolves hosted-form request/task aliases to their actual owned tables in detail and list', async () => {
  io.tables.external_contract_intakes = [{ id: 'e', company_id: 'company', source_channel: 'public_contract_form', created_info_request_id: 'info', created_case_id: 'task' }]
  io.tables.gridex_website_application_work_items_v = [work('e', 'external_contract_intakes', 'e')]
  io.tables.customer_info_requests = [{ id: 'info', company_id: 'company' }]
  io.tables.customer_operation_tasks = [{ id: 'task', company_id: 'company' }]
  const detail = await getWebsiteApplicationAdminRow('e', { companyId: 'company', sourceTable: 'external_contract_intakes' })
  expect(detail).toMatchObject({ customer_info_request_id: 'info', customer_operation_task_id: 'task', customer_match_review_case_id: null, grid_owner_information_request_id: null })
  expect((await listWebsiteApplications({ companyId: 'company' }))[0]).toMatchObject({ customer_info_request_id: 'info', customer_operation_task_id: 'task', grid_owner_information_request_id: null })
})

it('resolves actual grid-owner requests and ambiguous-match review cases without pretending they are tasks', async () => {
  io.tables.external_contract_intakes = [{ id: 'e', company_id: 'company', created_info_request_id: 'grid-info', created_case_id: 'review-case' }]
  io.tables.gridex_website_application_work_items_v = [work('e', 'external_contract_intakes', 'e')]
  io.tables.grid_owner_information_requests = [{ id: 'grid-info', company_id: 'company' }]
  io.tables.customer_match_review_cases = [{ id: 'review-case', company_id: 'company' }]
  const detail = await getWebsiteApplicationAdminRow('e', { companyId: 'company', sourceTable: 'external_contract_intakes' })
  expect(detail).toMatchObject({ grid_owner_information_request_id: 'grid-info', customer_info_request_id: null, customer_match_review_case_id: 'review-case', customer_operation_task_id: null })
})

it('leaves foreign, missing or table-ambiguous legacy references null with visible manual-review issues', async () => {
  io.tables.external_contract_intakes = [{ id: 'e', company_id: 'company', created_info_request_id: 'foreign-info', created_case_id: 'ambiguous-case' }]
  io.tables.gridex_website_application_work_items_v = [work('e', 'external_contract_intakes', 'e')]
  io.tables.grid_owner_information_requests = [{ id: 'foreign-info', company_id: 'foreign-company' }]
  io.tables.customer_operation_tasks = [{ id: 'ambiguous-case', company_id: 'company' }]
  io.tables.customer_match_review_cases = [{ id: 'ambiguous-case', company_id: 'company' }]
  const detail = await getWebsiteApplicationAdminRow('e', { companyId: 'company', sourceTable: 'external_contract_intakes' })
  expect(detail).toMatchObject({ grid_owner_information_request_id: null, customer_info_request_id: null, customer_operation_task_id: null, customer_match_review_case_id: null })
  expect(detail?.reference_resolution_issues).toHaveLength(2)
  expect(detail?.warnings).toEqual(expect.arrayContaining(detail?.reference_resolution_issues ?? []))
  expect(detail?.next_step).toMatch(/manuellt/)
})

it('does not load a different tenant through a requested application id', async () => {
  io.tables.website_customer_applications = [{ id: 'a', company_id: 'foreign-company', customer_id: 'foreign-customer' }]
  io.tables.gridex_website_application_work_items_v = [{ ...work('a'), company_id: 'foreign-company' }]
  expect(await getWebsiteApplicationAdminRow('a', { companyId: 'company', sourceTable: 'website_customer_applications' })).toBeNull()
})

it('keeps the shared completion state authoritative while surfacing unresolved optional links', async () => {
  io.tables.external_contract_intakes = [{ id: 'e', company_id: 'company', status: 'created', created_info_request_id: 'missing' }]
  io.tables.gridex_website_application_work_items_v = [{ ...work('e', 'external_contract_intakes', 'e'), status: 'completed', work_state: 'completed', is_pending: false }]
  const detail = await getWebsiteApplicationAdminRow('e', { companyId: 'company', sourceTable: 'external_contract_intakes' })
  expect(detail).toMatchObject({ status: 'completed', work_state: 'completed', is_pending: false, customer_info_request_id: null, grid_owner_information_request_id: null })
  expect(detail?.reference_resolution_issues).toHaveLength(1)
  expect(detail?.blocking_reasons).toEqual([])
  expect(detail?.next_step).toMatch(/avslutade status är oförändrad/)
})

it('preserves a readable legacy mirror URL without guessing a canonical owner', async () => {
  io.tables.external_contract_intakes = [{ id: 'e', company_id: 'company', status: 'needs_review', idempotency_key: 'shared' }]
  io.tables.gridex_website_application_work_items_v = [work('a', 'website_customer_applications', 'e'), work('b')]
  const detail = await getWebsiteApplicationAdminRow('e', { companyId: 'company', sourceTable: 'external_contract_intakes' })
  expect(detail).toMatchObject({ id: 'e', source_table: 'external_contract_intakes', linked_website_application_id: null })
  expect(detail?.reference_resolution_issues).toHaveLength(1)
})
