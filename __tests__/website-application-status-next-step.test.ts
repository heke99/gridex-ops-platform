import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/v1/website/customer-applications/[applicationId]/route'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  companyId: '13110000-0000-4000-8000-000000000001',
  tables: {} as Record<string, Row[]>,
  calls: [] as Array<{ table: string; columns: string; filters: Record<string, unknown> }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async (original) => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  requireIntegrationApiAccess: async (_request: NextRequest, scopes: string[]) => {
    expect(scopes).toEqual(['website_switch_status.read'])
    const client = { id: '13110000-0000-4000-8000-000000000003', metadata: {} }
    return { ok: true, client, context: { companyId: io.companyId } }
  },
  logIntegrationApiRequest: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      let columns = '*'
      const filters: Record<string, unknown> = {}
      let limit = Infinity
      const matches = (row: Row, filter: unknown) => {
        if (!filter || typeof filter !== 'object') return false
        return Object.entries(filter).every(([key, value]) => row[key] === value)
      }
      const read = () => {
        io.calls.push({ table, columns, filters: { ...filters } })
        const rows = (io.tables[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => {
          return value && typeof value === 'object' ? matches(row[key] as Row, value) : row[key] === value
        }))
        return rows.slice(0, limit).map(row => columns === '*'
          ? row : Object.fromEntries(columns.split(',').map(column => {
            if (!column.includes(':')) return [column, row[column]]
            expect(column).toBe('first_blocker_code:result->blockers->0->>code')
            const blockers = (row.result as Row | null)?.blockers
            const code = Array.isArray(blockers) ? (blockers[0] as Row | undefined)?.code : undefined
            return ['first_blocker_code', typeof code === 'string' ? code : null]
          })))
      }
      const query = {
        select: (value: string) => { columns = value; return query },
        eq: (column: string, value: unknown) => { filters[column] = value; return query },
        contains: (column: string, value: unknown) => { filters[column] = value; return query },
        or: () => {
          expect(table).toBe('supplier_switch_requests')
          expect(io.tables[table] ?? []).toHaveLength(0)
          return query
        },
        order: () => query,
        limit: (value: number) => { limit = value; return query },
        maybeSingle: async () => ({ data: read()[0] ?? null, error: null }),
        then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: read(), error: null }).then(resolve),
      }
      return query
    },
  },
}))

const applicationNumber = 'APP-P01-LOCAL'
const timestamp = '2026-11-25T12:00:00.000Z'
const applicationId = '13110000-0000-4000-8000-000000000011'
const customerId = '13110000-0000-4000-8000-000000000012'
const facilityId = '13110000-0000-4000-8000-000000000013'
const contractId = '13110000-0000-4000-8000-000000000014'
const workflowId = '13110000-0000-4000-8000-000000000015'
const jobId = '13110000-0000-4000-8000-000000000016'
const signatureHash = 'b'.repeat(64)

function fixture() {
  const company_id = io.companyId
  io.calls.length = 0
  io.tables = {
    website_customer_applications: [{
      id: applicationId, company_id, application_number: applicationNumber,
      customer_number: 'LOCAL-CUSTOMER', customer_id: customerId, customer_site_id: facilityId,
      metering_point_id: null, contract_id: contractId, status: 'pending_review', next_step: 'blocked',
      response_payload: { status: 'needs_customer_information', next_step: 'blocked' }, updated_at: timestamp,
    }],
    customer_application_workflows: [{
      id: workflowId, company_id, customer_application_id: applicationId, state: 'switch_blocked',
      next_action: 'blocked', failure_code: null, last_job_id: jobId, updated_at: timestamp,
    }],
    customer_contracts: [{
      id: contractId, company_id, contract_number: 'LOCAL-CONTRACT', status: 'signed', signed_at: timestamp,
      signature_snapshot_sha256: signatureHash, updated_at: timestamp,
    }],
    customer_operation_jobs: [{
      id: jobId, company_id, workflow_id: workflowId, job_type: 'customer_application_continuation',
      status: 'needs_review', attempts: 1, max_attempts: 5, completed_at: timestamp,
      last_error: null, last_error_code: null, last_error_message: null, updated_at: timestamp,
      result: { blockers: [{ code: 'metering_point_missing', message: 'PRIVATE WORKER detail' }] },
    }],
  }
}

const getStatus = () => GET(new NextRequest(
  'http://127.0.0.1/api/v1/website/customer-applications/' + applicationNumber,
  { headers: { Prefer: 'omit-webhook-diagnostics' } },
), { params: Promise.resolve({ applicationId: applicationNumber }) })

describe('public website status next step', () => {
  it('uses a customer action and a stable reason for the current missing metering point review', async () => {
    fixture()
    const response = await getStatus()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const { data } = await response.json()
    expect(data).toMatchObject({
      application_number: applicationNumber, customer_number: 'LOCAL-CUSTOMER', contract_number: 'LOCAL-CONTRACT',
      contract_status: 'signed', next_step: 'provide_facility_information', blocking_reason: 'metering_point_missing',
      status: 'needs_customer_information', stage: 'switch_blocked', missing_customer_action: true,
      supplier_switch_status: 'unknown', supply_status: null,
      automation: { status: 'needs_review', attempts: 1, last_error: null },
      checkout: {
        page_state: 'success_action_required', customer_action_required: true,
        agreement: { status: 'signed', signature_snapshot_sha256: signatureHash },
      },
    })
    const job = io.calls.find(call => call.table === 'customer_operation_jobs')
    expect(job?.filters).toEqual({ company_id: io.companyId, workflow_id: workflowId, job_type: 'customer_application_continuation' })
    expect(job?.columns.split(',')).not.toContain('result')
    expect(JSON.stringify(data)).not.toContain('PRIVATE WORKER detail')
    expect(data).not.toHaveProperty('automation.result')
  })

  it.each([
    ['empty', {}, 'needs_review', jobId],
    ['unknown', { blockers: [{ code: 'PRIVATE WORKER detail' }] }, 'needs_review', jobId],
    ['another type', { blockers: [{ code: 'grid_owner_missing' }] }, 'needs_review', jobId],
    ['a different job', { blockers: [{ code: 'metering_point_missing' }] }, 'needs_review', 'older-job'],
    ['a queued job', { blockers: [{ code: 'metering_point_missing' }] }, 'queued', jobId],
  ])('does not expose an action derived from %s worker information', async (_name, result, status, id) => {
    fixture()
    Object.assign(io.tables.customer_operation_jobs[0], { id, status, result })
    const response = await getStatus()
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data).toMatchObject({ next_step: 'blocked', blocking_reason: null })
    expect(JSON.stringify(data)).not.toContain('PRIVATE WORKER detail')
  })

  it('keeps an already visible reason and a concrete recorded action', async () => {
    fixture()
    io.tables.customer_application_workflows[0].failure_code = 'existing_reason'
    const first = await getStatus()
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ data: {
      next_step: 'provide_facility_information', blocking_reason: 'existing_reason',
    } })
    io.tables.customer_application_workflows[0].next_action = 'contact_support'
    const second = await getStatus()
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ data: {
      next_step: 'contact_support', blocking_reason: 'existing_reason',
    } })
  })
})
