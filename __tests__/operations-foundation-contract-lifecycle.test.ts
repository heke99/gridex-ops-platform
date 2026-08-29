import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const migration = read('supabase/migrations/20260829140500_operations_foundation_contract_lifecycle_v1.sql')
const worker = read('lib/customer-operations/automation.part-3.ts')
const readiness = read('lib/customer-operations/switchReadiness.ts')
const startSupplierSwitch = read('lib/operations/businessActions/startSupplierSwitch.ts')

const normalize = (value: string) => value.replace(/\s+/g, ' ').toLowerCase()
const sql = normalize(migration)

describe('operations foundation + signed contract lifecycle', () => {
  it('extends the existing operation primitives instead of creating parallel tables', () => {
    expect(sql).not.toContain('create table operation_events')
    expect(sql).not.toContain('create table operation_actions')
    expect(sql).toContain('customer_operation_jobs')
    expect(sql).toContain('customer_operation_events')
    expect(sql).toContain('customer_operation_tasks')
  })

  it('projects the existing job state machine into AUTO/RETRY/REVIEW/STOP', () => {
    expect(sql).toContain('gridex_customer_operation_outcome_class')
    expect(sql).toContain("then 'review'")
    expect(sql).toContain("then 'retry'")
    expect(sql).toContain("then 'stop'")
    expect(sql).toContain("else 'auto'")
    expect(sql).toContain('with (security_invoker = true)')
  })

  it('permanently deduplicates the immutable contract-signed edge', () => {
    expect(sql).toContain('customer_operation_jobs_contract_signed_uidx')
    expect(sql).toContain("job_type = 'start_supplier_switch'")
    expect(sql).toContain("idempotency_key like 'contract-signed:%'")
  })

  it('atomically enqueues signed consumption contracts into the canonical worker', () => {
    expect(sql).toContain('gridex_enqueue_signed_contract_operation_v1')
    expect(sql).toContain("new.status is distinct from 'signed'")
    expect(sql).toContain("coalesce(new.energy_direction, 'consumption') <> 'consumption'")
    expect(sql).toContain("'start_supplier_switch'")
    expect(sql).toContain("'queued'")
    expect(sql).toContain("'contract-signed:' || new.id::text")
    expect(sql).toContain('v_operation_id')
    expect(sql).toContain('v_trace_id')
  })

  it('fails closed to review when the signed contract lacks a tenant-safe site', () => {
    expect(sql).toContain('signed_contract_site_missing')
    expect(sql).toContain('signed_contract_site_tenant_mismatch')
    expect(sql).toContain("'contract_lifecycle_readiness'")
    expect(sql).toContain("'needs_review'")
  })

  it('does not retroactively auto-dispatch historical signed contracts', () => {
    expect(sql).toContain('historical_signed_contract_requires_reconciliation')
    expect(sql).toContain("'contract_lifecycle_reconciliation'")
    expect(sql).toContain('ingen extern kommunikation startas retroaktivt')
  })

  it('keeps readiness, switch creation and outbound dispatch in their existing canonical owners', () => {
    expect(worker).toContain('processSupplierSwitch')
    expect(worker).toContain('syncOperationTasksFromReadiness')
    expect(worker).toContain('createSupplierSwitchRequest')
    expect(worker).toContain('startSupplierSwitch')
    expect(readiness).toContain('checkSupplierSwitchReadiness')
    expect(readiness).toContain('customer_contract_lifecycle_readiness_v')
    expect(startSupplierSwitch).toContain('prepareAndQueueEdielZ03')
    expect(startSupplierSwitch).toContain('checkSupplierSwitchReadiness')
  })

  it('keeps the trigger internal and tenant-derived', () => {
    expect(sql).toContain('security definer')
    expect(sql).toContain('set search_path = pg_catalog, public')
    expect(sql).toContain('revoke all on function public.gridex_enqueue_signed_contract_operation_v1() from authenticated')
    expect(sql).toContain('s.company_id = new.company_id')
    expect(sql).toContain('s.customer_id = new.customer_id')
  })
})
