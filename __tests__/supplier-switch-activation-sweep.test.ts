import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getSupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'

describe('supplier switch automatic activation', () => {
  it('requires business confirmation and the Swedish effective date', () => {
    const now = new Date('2026-09-03T10:00:00Z')

    expect(getSupplierSwitchActivationReadiness({
      status: 'accepted',
      inbound_z04_message_id: null,
      confirmed_start_date: '2026-09-03',
      requested_start_date: '2026-09-03',
    }, now).ready).toBe(false)

    expect(getSupplierSwitchActivationReadiness({
      status: 'accepted',
      inbound_z04_message_id: '11111111-1111-4111-8111-111111111111',
      confirmed_start_date: '2026-09-04',
      requested_start_date: '2026-09-03',
    }, now).code).toBe('awaiting_effective_start_date')

    expect(getSupplierSwitchActivationReadiness({
      status: 'accepted',
      inbound_z04_message_id: '11111111-1111-4111-8111-111111111111',
      confirmed_start_date: '2026-09-03',
      requested_start_date: '2026-09-02',
    }, now).ready).toBe(true)
  })

  it('wires a tenant-scoped atomic activation sweep into customer operations cron', () => {
    const sweep = readFileSync('lib/operations/supplierSwitchActivationSweep.ts', 'utf8')
    const cron = readFileSync('app/api/internal/customer-operations/cron/route.ts', 'utf8')
    const migration = readFileSync(
      'supabase/migrations/20260903090000_atomic_supplier_switch_activation_sweep.sql',
      'utf8',
    )

    expect(cron).toContain('processReadySupplierSwitchActivations')
    expect(cron).toContain('supplierSwitchActivations')

    expect(sweep).toContain(".eq('status', 'accepted')")
    expect(sweep).toContain('getSupplierSwitchActivationReadiness(request).ready')
    expect(sweep).toContain("rpc(\n        'gridex_finalize_supplier_switch_activation'")
    expect(sweep).toContain('p_company_id: companyId')
    expect(sweep).toContain('p_request_id: request.id')

    expect(migration).toContain('for update')
    expect(migration).toContain('company_id = p_company_id')
    expect(migration).toContain("m.direction = 'inbound'")
    expect(migration).toContain("m.message_family = 'PRODAT'")
    expect(migration).toContain("m.message_code = 'Z04'")
    expect(migration).toContain("now() at time zone 'Europe/Stockholm'")
    expect(migration).toContain("status = 'completed'")
    expect(migration).toContain('to service_role')
    expect(migration).not.toContain('to anon')
    expect(migration).not.toContain('to authenticated')
  })
})
