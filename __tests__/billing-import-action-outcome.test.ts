import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'

type Row = Record<string, unknown>
const fixture = vi.hoisted(() => ({
  companyId: '22222222-2222-4222-8222-222222222222', actorId: '11111111-1111-4111-8111-111111111111',
  authorizedCompanyId: '22222222-2222-4222-8222-222222222222',
  redirects: [] as string[], tables: {} as Record<string, Row[]>, calls: [] as Array<{ table: string; operation: string; values: Row; filters: Row }>,
  denied: false, failTable: '', failOperation: '', emptyResult: false, failUnderlayCustomer: '', refreshFailure: false,
  permissions: ['billing_underlay.export'] as string[], wrongFinalIdentity: false,
  guard: vi.fn(), scopedGuard: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => { if (fixture.refreshFailure) throw new Error('Synthetic cache refresh failure') } }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { fixture.redirects.push(url); throw new Error('NEXT_REDIRECT') } }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: fixture.guard,
  requireCompanyScopedActionAccess: fixture.scopedGuard,
  requireAdminPageKeyAccess: async () => ({ userId: fixture.actorId, companyId: fixture.authorizedCompanyId, isPlatformAdmin: false, permissions: fixture.permissions }),
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({ companyId: fixture.companyId }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    const filters: Row = {}
    let operation = '', values: Row = {}, single = false
    const query = {
      select: () => query, order: () => query, limit: () => query,
      insert: (value: Row) => { operation = 'insert'; values = structuredClone(value); return query },
      update: (value: Row) => { operation = 'update'; values = structuredClone(value); return query },
      eq: (field: string, value: unknown) => { filters[field] = value; return query },
      single: () => { single = true; return query }, maybeSingle: () => { single = true; return query },
      then: (resolve: (value: unknown) => unknown) => {
        fixture.calls.push({ table, operation, values: structuredClone(values), filters: { ...filters } })
        const fails = (table === fixture.failTable && operation === fixture.failOperation)
          || (table === 'billing_underlays' && values.customer_id === fixture.failUnderlayCustomer)
        if (fails) return Promise.resolve({ data: null, error: fixture.emptyResult ? null : { code: 'XX000', message: 'SYNTHETIC SQL PRIVATE DETAIL secret=never-show' } }).then(resolve)
        const rows = fixture.tables[table]
        if (!rows) throw new Error(`unexpected_table:${table}`)
        const matched = rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value))
        let result: Row[] = matched
        if (operation === 'insert') { const row = { id: `${table}-${rows.length + 1}`, ...values }; rows.push(row); result = [row] }
        if (operation === 'update') matched.forEach(row => Object.assign(row, values))
        if (table === 'billing_import_batches' && operation === 'update' && fixture.wrongFinalIdentity) result = result.map(row => ({ ...row, id: 'unexpected-final-batch' }))
        return Promise.resolve({ data: structuredClone(single ? result[0] ?? null : result), error: null }).then(resolve)
      },
    }
    return query
  },
} }))
import { importBillingUnderlayFileAction } from '@/app/admin/billing/import/actions'
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
import BillingImportPage from '@/app/admin/billing/import/page'

const customer = '33333333-3333-4333-8333-333333333333'
const secondCustomer = '44444444-4444-4444-8444-444444444444'
const validLine = (id = customer) => `${id};2026;9;100;125.00;SEK`
function form(lines = [validLine()]) {
  const data = new FormData()
  data.set('billing_text', ['customer_id;underlay_year;underlay_month;total_kwh;total_sek_ex_vat;currency', ...lines].join('\n'))
  return data
}
async function submit(data = form()) {
  await expect(importBillingUnderlayFileAction(data)).rejects.toThrow('NEXT_REDIRECT')
  return new URL(fixture.redirects.at(-1)!, 'https://example.invalid').searchParams
}
beforeEach(() => {
  fixture.redirects = []; fixture.calls = []; fixture.tables = { billing_import_batches: [], billing_import_rows: [], billing_underlays: [] }
  fixture.denied = false; fixture.failTable = ''; fixture.failOperation = ''; fixture.emptyResult = false; fixture.failUnderlayCustomer = ''
  fixture.refreshFailure = false; fixture.permissions = ['billing_underlay.export']; fixture.wrongFinalIdentity = false
  fixture.authorizedCompanyId = fixture.companyId
  fixture.guard.mockReset().mockImplementation(async () => {
    if (fixture.denied) throw new Error('SYNTHETIC SQL PRIVATE DETAIL Forbidden')
    return { userId: fixture.actorId, companyId: fixture.authorizedCompanyId, isPlatformAdmin: false }
  })
  fixture.scopedGuard.mockReset().mockResolvedValue({ userId: fixture.actorId, companyId: fixture.companyId })
})

describe('billing import reports its actual persisted outcome', () => {
  it('redirects once to genuine success after all rows and final counts are confirmed', async () => {
    const notice = await submit()
    expect(fixture.redirects).toHaveLength(1)
    expect(notice.get('status')).toBe('success')
    expect(notice.get('message')).toContain('1 importerade, 0 blockerade')
    expect(fixture.tables.billing_import_rows).toHaveLength(1)
    expect(fixture.tables.billing_import_batches[0]).toMatchObject({ status: 'imported', rows_imported: 1, rows_failed: 0 })
  })
  it.each(['billing_import_rows', 'billing_import_batches'])('does not claim completion when %s persistence fails', async (table) => {
    fixture.failTable = table; fixture.failOperation = table === 'billing_import_rows' ? 'insert' : 'update'
    const notice = await submit()
    expect(fixture.redirects.some(url => new URL(url, 'https://example.invalid').searchParams.get('status') === 'success')).toBe(false)
    expect(notice.get('status')).toBe('error')
    expect(notice.get('message')).not.toMatch(/NEXT_REDIRECT|SQL PRIVATE|secret=/)
    expect(notice.get('message')).toContain('Referens:')
    expect(fixture.tables.billing_import_batches[0].status).not.toBe('imported')
  })
  it.each(['billing_import_rows', 'billing_import_batches'])('requires an actual saved %s result even if its query has no error', async (table) => {
    fixture.failTable = table; fixture.failOperation = table === 'billing_import_rows' ? 'insert' : 'update'; fixture.emptyResult = true
    expect((await submit()).get('status')).toBe('error')
    expect(fixture.redirects).toHaveLength(1)
    expect(fixture.tables.billing_import_batches[0].status).not.toBe('imported')
  })
  it('distinguishes a durable partial import from full success and uses confirmed row counts', async () => {
    const notice = await submit(form([validLine(), ';2026;9;100;125.00;SEK']))
    expect(notice.get('status')).toBe('partial')
    expect(notice.get('message')).toContain('1 importerade, 1 blockerade')
    expect(fixture.tables.billing_import_batches[0]).toMatchObject({ status: 'partially_imported', rows_imported: 1, rows_failed: 1 })
  })
  it('reports all failed underlays without leaking their database errors into the persisted public issues', async () => {
    fixture.failUnderlayCustomer = secondCustomer
    const notice = await submit(form([validLine(secondCustomer)]))
    expect(notice.get('status')).toBe('error')
    expect(notice.get('message')).toContain('0 importerade, 1 blockerade')
    expect(JSON.stringify(fixture.tables.billing_import_rows[0].issues)).not.toMatch(/SQL PRIVATE|secret=/)
    expect(fixture.tables.billing_import_batches[0]).toMatchObject({ status: 'failed', rows_imported: 0, rows_failed: 1 })
  })
  it('uses the current actor and company guard instead of forged form authority', async () => {
    const data = form(); data.set('company_id', 'foreign-company'); data.set('actor_user_id', 'forged-actor')
    await submit(data)
    expect(fixture.scopedGuard).toHaveBeenCalledWith(fixture.companyId, { anyOf: ['billing_underlay.write', 'billing_underlay.export'] })
    expect(fixture.tables.billing_import_batches[0]).toMatchObject({ company_id: fixture.companyId, created_by: fixture.actorId })
    expect(fixture.tables.billing_underlays[0]).toMatchObject({ company_id: fixture.companyId, created_by: fixture.actorId, updated_by: fixture.actorId })
    expect(fixture.calls.find(call => call.table === 'billing_import_batches' && call.operation === 'update')?.filters).toMatchObject({ company_id: fixture.companyId })
  })
  it('denies before any persistence and presents a safe failure when current action authority is absent', async () => {
    fixture.denied = true
    const notice = await submit()
    expect(fixture.calls).toEqual([])
    expect(notice.get('status')).toBe('error')
    expect(notice.get('message')).not.toMatch(/SQL PRIVATE|Forbidden/)
  })
  it('requires a confirmed batch before any underlay is created', async () => {
    fixture.failTable = 'billing_import_batches'; fixture.failOperation = 'insert'; fixture.emptyResult = true
    expect((await submit()).get('status')).toBe('error')
    expect(fixture.tables.billing_underlays).toEqual([])
  })
  it('imports the actual selected file instead of unrelated pasted rows and retains its file identity', async () => {
    const data = form()
    data.set('billing_file', new File([['customer_id;underlay_year;underlay_month;total_kwh;total_sek_ex_vat;currency', validLine(secondCustomer)].join('\n')], 'selected-underlay.csv', { type: 'text/csv' }))
    expect((await submit(data)).get('status')).toBe('success')
    expect(fixture.tables.billing_underlays[0].customer_id).toBe(secondCustomer)
    expect(fixture.tables.billing_import_batches[0]).toMatchObject({ file_name: 'selected-underlay.csv', source_type: 'file_upload' })
  })
  it('preserves a confirmed import outcome when only list refresh fails afterward', async () => {
    fixture.refreshFailure = true
    const notice = await submit()
    expect(notice.get('status')).toBe('success')
    expect(notice.get('message')).toContain('Läs om sidan')
    expect(fixture.tables.billing_import_batches[0]).toMatchObject({ status: 'imported', rows_imported: 1, rows_failed: 0 })
  })
  it('leaves already saved underlays visible without confirming completion after the row log fails', async () => {
    fixture.failTable = 'billing_import_rows'; fixture.failOperation = 'insert'
    const notice = await submit()
    expect(fixture.tables.billing_underlays).toHaveLength(1)
    expect(fixture.tables.billing_import_rows).toEqual([])
    expect(notice.get('message')).toContain('1 underlag har redan sparats')
    expect(fixture.tables.billing_import_batches[0].status).toBe('previewed')
  })
  it('denies a changed tenant scope before parsing or persistence even if target membership guard would allow it', async () => {
    fixture.authorizedCompanyId = '55555555-5555-4555-8555-555555555555'
    const notice = await submit()
    expect(notice.get('status')).toBe('error')
    expect(notice.get('message')).toContain('Bolagsvalet ändrades')
    expect(fixture.scopedGuard).not.toHaveBeenCalled()
    expect(fixture.calls).toEqual([])
  })
  it('requires the confirmed final result to identify the original batch', async () => {
    fixture.wrongFinalIdentity = true
    expect((await submit()).get('status')).toBe('error')
    expect(fixture.redirects).toHaveLength(1)
  })
})

function nodes(value: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!isValidElement(value)) return []
  const node = value as ReactElement<Record<string, unknown>>
  return [node, ...nodes(node.props.children as ReactNode)]
}
it('binds the real import action and disables every upload/paste/submit control for a read-only actor', async () => {
  fixture.permissions = ['billing_underlay.read']
  const tree = nodes(await BillingImportPage({}))
  const bound = tree.find(node => node.type === 'form')!
  expect(bound.props.action).toBe(importBillingUnderlayFileAction)
  const controls = nodes(bound.props.children as ReactNode).filter(node => ['input', 'textarea', 'button'].includes(String(node.type)))
  expect(controls).toHaveLength(3)
  expect(controls.every(node => node.props.disabled === true)).toBe(true)
})
it('renders the authoritative partial result with a visible warning state', async () => {
  const tree = nodes(await BillingImportPage({ searchParams: Promise.resolve({ status: 'partial', message: 'Import delvis klar: 1 importerade, 1 blockerade/felaktiga rader.' }) }))
  const notice = tree.find(node => node.props.role === 'alert')!
  expect(notice.props.className).toContain('amber')
  expect(notice.props.children).toContain('1 importerade, 1 blockerade')
})
