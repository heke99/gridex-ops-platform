import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const reconciliation = fs.readFileSync(
  path.join(process.cwd(), 'lib/website/legacyFacilityRequestReconciliation.ts'),
  'utf8',
)
const cron = fs.readFileSync(
  path.join(process.cwd(), 'app/api/internal/customer-operations/cron/route.ts'),
  'utf8',
)

describe('zero-admin legacy facility reconciliation', () => {
  it('runs inside the canonical customer-operations cron', () => {
    expect(cron).toContain('reconcileLegacyFacilityRequestLinks')
    expect(cron).toContain('legacyFacilityRequestReconciliation')
  })

  it('requires exact tenant, customer and site scope and a unique candidate', () => {
    expect(reconciliation).toContain("clean(workflow.company_id) === clean(request.company_id)")
    expect(reconciliation).toContain("clean(workflow.customer_id) === clean(request.customer_id)")
    expect(reconciliation).toContain("clean(workflow.customer_site_id) === clean(request.customer_site_id)")
    expect(reconciliation).toContain('candidates.length !== 1')
  })

  it('only correlates already external-waiting requests and never creates or dispatches one', () => {
    expect(reconciliation).toContain('EXTERNAL_WAIT_REQUEST_STATUSES')
    expect(reconciliation).toContain(".from('grid_owner_information_requests')")
    expect(reconciliation).not.toMatch(/\.from\(['"]grid_owner_information_requests['"]\)[\s\S]{0,120}\.insert\(/)
    expect(reconciliation).not.toContain('sendGridOwner')
    expect(reconciliation).not.toContain('createGridOwner')
  })

  it('closes only stale customer-data review tasks using the canonical task status', () => {
    expect(reconciliation).toContain(".eq('task_type', 'customer_data_review')")
    expect(reconciliation).toContain("status: 'done'")
    expect(reconciliation).not.toContain("status: 'completed'")
    expect(reconciliation).toContain("zero_admin_reason: 'canonical_facility_request_waiting_external_response'")
    expect(reconciliation).not.toContain("task_type', 'contract_lifecycle_reconciliation")
  })
})
