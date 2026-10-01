import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CustomerCaseRow } from '@/lib/customer-cases/types'

type PgFixture = { exec: (sql: string) => Promise<unknown>; query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; close: () => Promise<void> }
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite') as { PGlite: new () => PgFixture }
const io = vi.hoisted(() => ({ db: null as PgFixture | null }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    return { update(patch: Record<string, unknown>) {
      const filters: Array<[string, unknown]> = []
      const query = {
        eq(column: string, value: unknown) { filters.push([column, value]); return query },
        in() { return query },
        async then(resolve: (result: { error: unknown }) => unknown) {
          if (table !== 'customer_contracts') return resolve({ error: null })
          const entries = Object.entries(patch)
          const values = [...entries.map(([, value]) => value), ...filters.map(([, value]) => value)]
          try {
            await io.db!.query(`UPDATE public.customer_contracts SET ${entries.map(([key], i) => `"${key}"=$${i + 1}`).join(',')}
              WHERE ${filters.map(([key], i) => `"${key}"=$${entries.length + i + 1}`).join(' AND ')}`, values)
            return resolve({ error: null })
          } catch (error) { return resolve({ error }) }
        },
      }
      return query
    } }
  },
} }))
// Only the transport and the separate switch/lifecycle owner are controlled.
// The actual exported case writer executes the installed table/state function.
vi.mock('@/lib/operations/switchLifecycleBlocks', () => ({
  createLifecycleDecisionFromCase: async () => null,
  switchLifecycleBlockFromCase: () => null,
  pauseOpenSupplierSwitchesForLifecycleBlock: async () => ({ paused: 0, requestIds: [] }),
}))
import { applyCustomerCaseOperationalStops } from '@/lib/customer-cases/engine'

const id = (n: number) => `ca5e0000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = id(1), customer = id(2), contract = id(3), caseId = id(4)
const schema = readFileSync('supabase/schema.sql', 'utf8')
const table = schema.match(/CREATE TABLE public\.customer_contracts \([\s\S]*?\n\);/)![0]
const functionStart = schema.indexOf('CREATE FUNCTION public.gridex_enforce_customer_contract_state_v1(')
const functionEnd = schema.indexOf('$$;', functionStart) + 3
const bindingStart = schema.indexOf('CREATE FUNCTION public.gridex_require_customer_contract_canonical_binding(')
const bindingEnd = schema.indexOf('$$;', bindingStart) + 3

beforeEach(async () => {
  io.db = new PGlite()
  // The public reference default is an unrelated ID boundary. Every contract
  // constraint and the complete installed state machine remain unchanged.
  await io.db.exec(`CREATE FUNCTION public.gridex_new_public_resource_reference(text) RETURNS text LANGUAGE sql AS $$SELECT 'SYNTHETIC'::text$$;
    ${table}
    ${schema.slice(functionStart, functionEnd)}
    ${schema.slice(bindingStart, bindingEnd)}
    CREATE TRIGGER actual_contract_state BEFORE INSERT OR UPDATE OF status ON public.customer_contracts
      FOR EACH ROW EXECUTE FUNCTION public.gridex_enforce_customer_contract_state_v1();
    CREATE TRIGGER zz_actual_contract_binding BEFORE INSERT OR UPDATE OF status,contract_publication_version_id,contract_product_version_id,price_plan_version_id,legal_bundle_version_id ON public.customer_contracts
      FOR EACH ROW EXECUTE FUNCTION public.gridex_require_customer_contract_canonical_binding();
    INSERT INTO public.customer_contracts(id,company_id,customer_id,status,contract_publication_version_id,
      contract_product_version_id,price_plan_version_id,legal_bundle_version_id)
      VALUES('${contract}','${company}','${customer}','draft','${id(10)}','${id(11)}','${id(12)}','${id(13)}');`)
})
afterEach(async () => { await io.db?.close(); io.db = null })
function caseRow(scenario: CustomerCaseRow['withdrawal_scenario'], selectedCompany = company) {
  return { id: caseId, company_id: selectedCompany, customer_id: customer,
    customer_contract_id: contract, withdrawal_scenario: scenario, title: 'Synthetic withdrawal' } as CustomerCaseRow
}
async function current() {
  return (await io.db!.query('SELECT status,ended_at,status_reason_code,billing_blocked_by_case_id FROM public.customer_contracts')).rows[0]
}

it('reproduces the legacy invalid status against the actual state machine', async () => {
  await expect(io.db!.query("UPDATE public.customer_contracts SET status='cancelled_by_customer'"))
    .rejects.toMatchObject({ code: '23514' })
  expect((await current()).status).toBe('draft')
})
it('the actual before-send writer persists canonical cancellation and terminal evidence', async () => {
  await applyCustomerCaseOperationalStops(caseRow('before_prodat_sent'), null)
  expect(await current()).toMatchObject({ status: 'cancelled', billing_blocked_by_case_id: caseId,
    status_reason_code: 'customer_withdrawal' })
  expect((await current()).ended_at).toBeTruthy()
})
it.each(['after_prodat_before_start', 'cannot_stop_switch'] as const)('the actual %s writer retains contract status and records the billing hold', async scenario => {
  await applyCustomerCaseOperationalStops(caseRow(scenario), null)
  expect(await current()).toEqual({ status: 'draft', ended_at: null, status_reason_code: null,
    billing_blocked_by_case_id: caseId })
})
it('the actual writer cannot mutate a contract belonging to a different company', async () => {
  await applyCustomerCaseOperationalStops(caseRow('before_prodat_sent', id(99)), null)
  expect(await current()).toEqual({ status: 'draft', ended_at: null, status_reason_code: null,
    billing_blocked_by_case_id: null })
})
it('a forbidden terminal transition propagates the actual database rejection', async () => {
  // INSERT does not manufacture a signed or active agreement. A terminal row
  // is sufficient to exercise the installed no-reopening transition boundary.
  await io.db!.exec(`DELETE FROM public.customer_contracts;
    INSERT INTO public.customer_contracts(id,company_id,customer_id,status,ended_at,status_reason_code,
      contract_publication_version_id,contract_product_version_id,price_plan_version_id,legal_bundle_version_id)
    VALUES('${contract}','${company}','${customer}','expired',now(),'prior_expiry','${id(10)}','${id(11)}','${id(12)}','${id(13)}');`)
  await expect(applyCustomerCaseOperationalStops(caseRow('before_prodat_sent'), null))
    .rejects.toMatchObject({ code: '23514' })
  expect(await current()).toMatchObject({ status: 'expired', status_reason_code: 'prior_expiry', billing_blocked_by_case_id: null })
})
it('the installed binding guard rejects an unbound legacy draft without hiding its error', async () => {
  // Core-only nullability/state boundary: the native fixture separately obtains
  // genuine version IDs through offer/legal/publication owners and exercises
  // the full native binding/FK/quote/availability graph. No signature is seeded.
  await io.db!.exec('UPDATE public.customer_contracts SET contract_publication_version_id=NULL,contract_product_version_id=NULL,price_plan_version_id=NULL,legal_bundle_version_id=NULL')
  await expect(applyCustomerCaseOperationalStops(caseRow('before_prodat_sent'), null))
    .rejects.toMatchObject({ code: '23514', message: 'customer_contract_canonical_versions_required' })
  expect(await current()).toEqual({ status: 'draft', ended_at: null, status_reason_code: null, billing_blocked_by_case_id: null })
})
