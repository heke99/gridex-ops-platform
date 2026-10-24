// Tests exact parsed runtime function bodies, with the real tenantDb wrapper.
// Finite query/storage ports; no hosted database, transport or customer sends.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type Row = Record<string, unknown>
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
function functions(file: string, names: string[]) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.resolve(file), 'utf8'), ts.ScriptTarget.Latest, true)
  return names.map(name => {
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    if (!declaration) throw new Error(`missing actual function ${name}`)
    return declaration.getText(source)
  }).join('\n')
}
function fixture(rows: Row[], error: Row | null = null) {
  const updates: Row[] = [], predicates: Array<[string, unknown]> = []
  const service = { from: (table: string) => {
    if (!['ediel_messages', 'inbound_email_messages'].includes(table)) throw new Error(`unexpected table ${table}`)
    const filters: Array<(row: Row) => boolean> = []
    let patch: Row | null = null, single = false, max = Infinity
    const q = {
      select: () => q,
      update: (value: Row) => { patch = value; updates.push(value); return q },
      eq: (key: string, value: unknown) => { predicates.push([key, value]); filters.push(row => row[key] === value); return q },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return q },
      is: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
      limit: (n: number) => { max = n; return q }, maybeSingle: () => { single = true; return q },
      then: <T, U>(resolve: (result: { data: Row | Row[] | null; error: Row | null }) => T | PromiseLike<T>, reject?: (reason: unknown) => U | PromiseLike<U>) => {
        const matches = rows.filter(row => filters.every(filter => filter(row))).slice(0, max)
        if (patch && !error) for (const row of matches) Object.assign(row, patch)
        return Promise.resolve({ data: single ? matches[0] ?? null : matches, error: patch ? error : null }).then(resolve, reject)
      },
    }
    return q
  } }
  // Load the complete actual wrapper, with only its service dependency supplied.
  const wrapperExports = {}
  const wrapper = fs.readFileSync(path.resolve('lib/supabase/tenantDb.ts'), 'utf8')
  vm.runInNewContext(ts.transpileModule(wrapper, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: wrapperExports, require: (name: string) => { if (name !== '@/lib/supabase/service') throw new Error(name); return { supabaseService: service } } })
  const tenantDb = (wrapperExports as { tenantDb: (company: string) => unknown }).tenantDb
  function load<T>(file: string, names: string[]): T {
    const exports = {}
    const code = functions(file, names) + '\n' + names.map(name => `exports.${name} = ${name};`).join('\n')
    vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, supabaseService: service, tenantDb, Date, Error, Object, String })
    return exports as T
  }
  return { load, predicates, updates, rows }
}

describe('recovery source reads retain real company and environment', () => {
  it.each(['missedTechnicalAckResume', 'unqueuedUtiltsRuntimeReplyResume'])('%s accepts own source and denies another company/lane', async name => {
    const state = fixture([{ id: 'source', company_id: A, environment: 'production' }, { id: 'other', company_id: B, environment: 'production' }])
    const subject = state.load<{ readMessage: (id: string, company: string, environment: string) => Promise<Row | null> }>(`lib/inbound-mail/${name}.ts`, ['readMessage'])
    expect(await subject.readMessage('source', A, 'production')).toMatchObject({ id: 'source' })
    expect(await subject.readMessage('source', B, 'production')).toBeNull()
    expect(await subject.readMessage('other', A, 'production')).toBeNull()
    expect(await subject.readMessage('source', A, 'test')).toBeNull()
    await expect(subject.readMessage('source', '', 'production')).rejects.toThrow()
    expect(state.updates).toHaveLength(0)
  })
})

describe('shared-mail attribution uses the actual resolved destination', () => {
  function attribution(state: ReturnType<typeof fixture>) {
    return state.load<{ attributeInboundEmailToTenant: (input: { inboundEmailMessageId: string; companyId: string; row: Row }) => Promise<{ duplicateOf: { id: string; samePayload: boolean } | null }> }>(
      'lib/inbound-mail/edielInboundProcessor.ts', ['text', 'findAttributedTwin', 'attributeInboundEmailToTenant'])
  }
  it('moves a NULL shared row once, then confirms through the destination tenant', async () => {
    const state = fixture([{ id: 'mail', company_id: null }]), subject = attribution(state)
    expect(await subject.attributeInboundEmailToTenant({ inboundEmailMessageId: 'mail', companyId: A, row: {} })).toEqual({ duplicateOf: null })
    expect(state.rows[0].company_id).toBe(A)
    expect(state.predicates).toContainEqual(['company_id', A])
  })
  it('retains existing same-company attribution without reassigning it', async () => {
    const state = fixture([{ id: 'mail', company_id: A }]), subject = attribution(state)
    expect(await subject.attributeInboundEmailToTenant({ inboundEmailMessageId: 'mail', companyId: A, row: {} })).toEqual({ duplicateOf: null })
    expect(state.rows[0].company_id).toBe(A)
  })
  it('refuses an already foreign-attributed row and does not change its company', async () => {
    const state = fixture([{ id: 'mail', company_id: B }]), subject = attribution(state)
    await expect(subject.attributeInboundEmailToTenant({ inboundEmailMessageId: 'mail', companyId: A, row: {} })).rejects.toThrow('inbound_email_tenant_attribution_conflict')
    expect(state.rows[0].company_id).toBe(B)
  })
  it('refuses a missing destination before the unscoped NULL update is built', async () => {
    const state = fixture([{ id: 'mail', company_id: null }]), subject = attribution(state)
    await expect(subject.attributeInboundEmailToTenant({ inboundEmailMessageId: 'mail', companyId: '', row: {} })).rejects.toThrow()
    expect(state.updates).toHaveLength(0)
  })
  it.each([true, false])('keeps23505 same-tenant duplicate identity and samePayload=%s', async samePayload => {
    const state = fixture([{ id: 'mail', company_id: null }, { id: 'foreign', company_id: B, environment: 'production', sender_ediel_id: 'S', interchange_reference: 'REF', raw_edifact_payload: 'payload' },
      { id: 'own', company_id: A, environment: 'production', sender_ediel_id: 'S', interchange_reference: 'REF', raw_edifact_payload: samePayload ? 'payload' : 'other' }], { code: '23505' }), subject = attribution(state)
    expect(await subject.attributeInboundEmailToTenant({ inboundEmailMessageId: 'mail', companyId: A, row: { environment: 'production', sender_ediel_id: 'S', interchange_reference: 'REF', raw_edifact_payload: 'payload' } })).toEqual({ duplicateOf: { id: 'own', samePayload } })
    expect(state.rows[0].company_id).toBeNull()
  })
  it('does not accept another tenant twin after a23505 conflict', async () => {
    const state = fixture([{ id: 'foreign', company_id: B, environment: 'production', sender_ediel_id: 'S', interchange_reference: 'REF' }], { code: '23505' }), subject = attribution(state)
    await expect(subject.attributeInboundEmailToTenant({ inboundEmailMessageId: 'mail', companyId: A, row: { environment: 'production', sender_ediel_id: 'S', interchange_reference: 'REF' } })).rejects.toMatchObject({ code: '23505' })
  })
})
