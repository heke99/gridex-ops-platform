// Component qualification only: real fixture orchestration, finite HTTP/SQL ports.
// No Auth, database, native runner or complete TERM acceptance is exercised.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ids = {
  company: '00000000-0000-4000-8000-000000000001', customer: '00000000-0000-4000-8000-000000000002',
  site: '00000000-0000-4000-8000-000000000003', point: '00000000-0000-4000-8000-000000000004',
  contract: '00000000-0000-4000-8000-000000000005', snapshot: '00000000-0000-4000-8000-000000000006',
  publication: '00000000-0000-4000-8000-000000000007', intake: '00000000-0000-4000-8000-000000000008',
}
type Options = {
  http?: number; threw?: boolean; errorRows?: string[]; redirect?: string | null; state?: unknown; transportError?: Error
  mismatch?: 'company' | 'customer' | 'site' | 'point' | 'gsrn' | 'email' | 'personal' | 'area' | 'intake-company' | 'intake-customer' | 'intake-result' | 'intake-status'
  missingGraph?: boolean; missingIntake?: boolean; duplicateGraph?: boolean; duplicateIntake?: boolean; existing?: boolean
}

function control(options: Options = {}) {
  const actions: Array<{ route: string; filename: string; exportedName: string; worker: string; args: unknown[] }> = []
  const writes: string[] = [], reads: string[] = [], signatures: string[] = []
  let form: FormData | undefined
  let contractCreated = false
  const forbidden = () => { throw new Error('undeclared component IO') }
  const field = (key: string) => String(form?.get(key) ?? '')
  const actionState = { status: 'success', createdCustomerId: ids.customer, createdSiteId: ids.site, createdMeteringPointId: ids.point }
  const graph = () => ({
    customer_id: ids.customer, company_id: options.mismatch === 'company' ? ids.site : ids.company,
    customer_email: options.mismatch === 'email' ? 'foreign@example.invalid' : field('email'),
    personal_number: options.mismatch === 'personal' ? 'different-person' : field('personalNumber'), site_id: ids.site,
    site_company_id: ids.company, site_customer_id: options.mismatch === 'customer' ? ids.site : ids.customer,
    facility_id: options.mismatch === 'gsrn' ? 'wrong-gsrn' : field('facilityId'),
    price_area_code: options.mismatch === 'area' ? 'SE3' : field('priceAreaCode'),
    metering_point_id: ids.point, point_company_id: ids.company, point_customer_id: ids.customer,
    point_site_id: options.mismatch === 'site' ? ids.customer : ids.site,
    point_gsrn: options.mismatch === 'point' ? 'wrong-gsrn' : field('meterPointId'),
  })
  const psql = (sql: string): string => {
    if (/^\s*(BEGIN|INSERT)/i.test(sql)) throw new Error('SQL graph insertion is not ordinary intake')
    if (/^\s*UPDATE/i.test(sql)) { writes.push(sql); return '' }
    if (sql.includes('jsonb_typeof(commercial_snapshot')) return 'true'
    if (sql.includes('select contract_publication_version_id')) return ids.publication
    if (sql.includes('select email from public.customers')) return 'existing@example.invalid'
    throw new Error('undeclared SQL scalar read: ' + sql)
  }
  const psqlRows = (sql: string) => {
    reads.push(sql)
    if (sql.includes('customer_application_intakes')) {
      if (options.missingIntake) return []
      const row = { id: ids.intake, company_id: options.mismatch === 'intake-company' ? ids.site : ids.company,
        status: options.mismatch === 'intake-status' ? 'processing' : 'completed',
        customer_id: options.mismatch === 'intake-customer' ? ids.point : ids.customer,
        result: { customer_id: ids.customer, created_site_id: ids.site,
          created_metering_point_id: options.mismatch === 'intake-result' ? ids.customer : ids.point } }
      return options.duplicateIntake ? [row, row] : [row]
    }
    if (sql.includes('FROM public.customers c')) {
      if (options.missingGraph) return []
      return options.duplicateGraph ? [graph(), graph()] : [graph()]
    }
    if (sql.includes('select id from public.customer_contracts')) return contractCreated ? [{ id: ids.contract }] : []
    if (sql.includes('select status,source_type,metadata')) return [{ status: 'draft', source_type: 'catalog', metadata: { source_of_truth: 'contract_price_options' } }]
    if (sql.includes('SELECT * FROM public.customer_contracts')) return [{ status: 'signed', signed_at: '2026-11-01T00:00:00Z', contract_price_snapshot_id: ids.snapshot }]
    if (sql.includes('SELECT * FROM public.contract_price_snapshots')) return [{ snapshot_json: {}, price_components_snapshot: [{ component_code: 'monthly_fee', amount: 49 }] }]
    throw new Error('undeclared SQL rows read: ' + sql)
  }
  const ports: Record<string, unknown> = {
    'node:crypto': crypto, 'node:child_process': { execFileSync: forbidden },
    './db': { psql, psqlRows, serviceClient: () => ({ rpc: async (name: string) => { signatures.push(name); return { error: null } } }) },
    './env': { sim: {} }, './fixture': { createAdminFixture: forbidden }, './session': { loginSession: forbidden },
    './server-action': { callServerAction: async (_session: unknown, input: typeof actions[number]) => {
      actions.push(input)
      if (input.exportedName === 'createCustomerAction') {
        form = input.args[1] as FormData
        if (options.transportError) throw options.transportError
        return { httpStatus: options.http ?? 200, threw: options.threw ?? false, errorRows: options.errorRows ?? [],
          redirect: options.redirect ?? null, excerpt: '', requestId: 'component-intake-request',
          value: Object.hasOwn(options, 'state') ? options.state : actionState }
      }
      if (input.exportedName !== 'createContractFromOfferAction') return forbidden()
      contractCreated = true
      return { httpStatus: 200, threw: false, errorRows: [], redirect: null, excerpt: '', value: null }
    } },
  }
  const filename = fileURLToPath(new URL('../scripts/simulation/track2/lib/term-fixture.ts', import.meta.url))
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText
  const output: { createSignedContract?: (...args: unknown[]) => Promise<Record<string, unknown>> } = {}
  // Offer creation is a declared already-qualified port. The real customer,
  // contract and signing sequence below it is executed without replacement.
  runInNewContext(code + '\nensureOffer=async()=>({offerId:"component-offer",publicationVersionId:"",priceOptionId:"",optionReference:"component-option"});', {
    exports: output, require: (name: string) => { if (!Object.hasOwn(ports, name)) return forbidden(); return ports[name] },
    FormData, Intl, console: { info() {} },
  }, { filename, timeout: 5000 })
  if (!output.createSignedContract) throw new Error('missing real fixture export')
  const tenant = { companyId: ids.company, builderUserId: ids.company, runId: 'finite', gridOwnerId: ids.site, session: {} }
  const input = { contractType: 'variable_hourly', bindingMonths: 12, noticeMonths: 1, startsAt: '2026-11-01', priceArea: 'SE4',
    ...(options.existing ? { existing: { customerId: ids.customer, siteId: ids.site, meteringPointId: ids.point, gsrn: '735123456789000001' } } : {}) }
  return { run: () => output.createSignedContract!(tenant, input), actions, writes, reads, signatures, field }
}

function ordinaryAppIntakeKey(field: (key: string) => string): string {
  // Execute the actual pure application key builder rather than copying its
  // field order into the assertion. Its module's unrelated service ports stay out.
  const filename = fileURLToPath(new URL('../app/admin/customers/actions.part-3.ts', import.meta.url))
  const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.ES2022, true)
  const declaration = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'buildAdminIntakeIdempotencyKey')
  if (!declaration) throw new Error('actual application intake key builder missing')
  const output: { buildAdminIntakeIdempotencyKey?: (params: Record<string, unknown>) => string } = {}
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText
  runInNewContext(code, { exports: output, createHash: crypto.createHash }, { timeout: 1000 })
  if (!output.buildAdminIntakeIdempotencyKey) throw new Error('application intake key export missing')
  const keys = ['customerType', 'personalNumber', 'email', 'firstName', 'lastName', 'facilityId', 'meterPointId', 'street', 'postalCode', 'city', 'siteName']
  return output.buildAdminIntakeIdempotencyKey({ companyId: ids.company, duplicateResolution: 'create_new_pending_review',
    optionalFeeLines: [], ...Object.fromEntries(keys.map(key => [key, field(key)])) })
}

describe('T2 ordinary customer intake fixture', () => {
  it('uses the ordinary intake HTTP binding and correlated returned graph before contract/signing', async () => {
    const c = control()
    const result = await c.run()
    expect(c.actions.map(action => action.exportedName)).toEqual(['createCustomerAction', 'createContractFromOfferAction'])
    expect(c.actions[0]).toMatchObject({ route: '/admin/customers/intake', filename: 'app/admin/customers/actions.ts', worker: 'app/admin/customers/intake/page' })
    expect(c.field('priceAreaCode')).toBe('SE4')
    expect(c.field('postCreateAction')).toBe('open_customer')
    expect(c.field('contractOfferId')).toBe('')
    expect(result).toMatchObject({ companyId: ids.company, customerId: ids.customer, siteId: ids.site, meteringPointId: ids.point,
      creation: { customerAction: { httpStatus: 200, redirect: null, requestId: 'component-intake-request', intakeId: ids.intake,
        idempotencyKey: ordinaryAppIntakeKey(c.field), state: { status: 'success' } } } })
    const key = ordinaryAppIntakeKey(c.field)
    expect(c.reads.some(sql => sql.includes('customer_application_intakes') && sql.includes(ids.company) && sql.includes(key))).toBe(true)
    expect(c.signatures).toHaveLength(2)
  })
  it('preserves the existing graph path without resubmitting customer intake', async () => {
    const c = control({ existing: true })
    const result = await c.run()
    expect(c.actions.map(action => action.exportedName)).toEqual(['createContractFromOfferAction'])
    expect(result).toMatchObject({ customerId: ids.customer, siteId: ids.site, meteringPointId: ids.point,
      creation: { customerAction: { httpStatus: 0, redirect: null, state: 'existing_graph_reused' } } })
  })
  it.each([0, 302, 401, 403, 500])('stops on HTTP %i without a fallback, contract or signing attempt', async http => {
    const c = control({ http })
    await expect(c.run()).rejects.toThrow(/intake/)
    expect(c.actions.map(action => action.exportedName)).toEqual(['createCustomerAction'])
    expect(c.writes).toEqual([]); expect(c.signatures).toEqual([])
  })
  it.each([
    { threw: true }, { errorRows: ['1:E{"digest":"controlled"}'] }, { redirect: '/login' },
    { state: { status: 'committed_review', createdCustomerId: ids.customer, createdSiteId: ids.site, createdMeteringPointId: ids.point } },
    { state: { status: 'error', createdCustomerId: ids.customer, createdSiteId: ids.site, createdMeteringPointId: ids.point } },
    { state: null }, { state: [] }, { state: { status: 'success', createdCustomerId: ids.customer } },
    { state: { status: 'success', createdCustomerId: 'not-a-uuid', createdSiteId: ids.site, createdMeteringPointId: ids.point } },
  ])('stops on uncertain or incomplete intake outcome %j', async options => {
    const c = control(options)
    await expect(c.run()).rejects.toThrow(/intake/)
    expect(c.actions).toHaveLength(1); expect(c.writes).toEqual([]); expect(c.signatures).toEqual([])
  })
  it('propagates transport uncertainty once without retry or SQL fallback', async () => {
    const error = new Error('transport outcome unknown')
    const c = control({ transportError: error })
    await expect(c.run()).rejects.toBe(error)
    expect(c.actions).toHaveLength(1); expect(c.writes).toEqual([])
  })
  it.each(['company', 'customer', 'site', 'point', 'gsrn', 'email', 'personal', 'area', 'intake-company', 'intake-customer', 'intake-result', 'intake-status'] as const)(
    'requires exact tenant and business graph correlation: %s', async mismatch => {
      const c = control({ mismatch })
      await expect(c.run()).rejects.toThrow(/intake/)
      expect(c.actions).toHaveLength(1); expect(c.writes).toEqual([]); expect(c.signatures).toEqual([])
    })
  it.each([{ missingGraph: true }, { missingIntake: true }, { duplicateGraph: true }, { duplicateIntake: true }])(
    'rejects absent or ambiguous receipt rows: %j', async options => {
      const c = control(options)
      await expect(c.run()).rejects.toThrow(/intake/)
      expect(c.actions).toHaveLength(1); expect(c.writes).toEqual([])
    })
})
