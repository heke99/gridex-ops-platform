import { readFileSync } from 'node:fs'
import { beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

type Row = Record<string, unknown>
const f = vi.hoisted(() => ({
  user: 'ad300000-0000-4000-8000-000000000001', company: 'ad100000-0000-4000-8000-000000000001',
  foreign: 'ad100000-0000-4000-8000-000000000002', customer: 'ad200000-0000-4000-8000-000000000001',
  second: 'ad200000-0000-4000-8000-000000000002', site: 'ad500000-0000-4000-8000-000000000001',
  secondSite: 'ad500000-0000-4000-8000-000000000002', rows: {} as Record<string, Row[]>,
  writes: [] as Array<Row[]>, authError: false, readError: null as unknown, writeError: null as unknown,
  receiptChange: null as ((rows: Row[]) => Row[]) | null, rpc: [] as unknown[],
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: f.authError ? null : { id: f.user, email: 'attempt@example.invalid' } }, error: f.authError ? { code: 'synthetic_auth_fault' } : null }),
} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/customer-portal/accountCompletion', () => ({
  AccountCompletionError: class extends Error {},
  completeNativePortalAccount: async (input: unknown) => { f.rpc.push(input); throw new Error('positive_completion_not_in_this_attempt_suite') },
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    const filters: Array<(row: Row) => boolean> = []
    let mode = 'select', payload: Row[] | null = null, columns = '*', maximum = Infinity
    const execute = () => {
      if (mode === 'select' && f.readError) throw f.readError
      if (mode === 'insert') {
        f.writes.push(structuredClone(payload!))
        if (f.writeError) return { data: null, error: f.writeError }
        // Real canonical column declarations constrain the controlled write seam.
        const ddl = readFileSync('supabase/schema.sql', 'utf8').match(/CREATE TABLE public\.customer_portal_claims \(([\s\S]*?)\n\);/)![1]
        const allowed = new Set([...ddl.matchAll(/^    ([a-z_]+) /gm)].map(match => match[1]))
        const absent = payload!.flatMap(row => Object.keys(row)).find(key => !allowed.has(key))
        if (absent) return { data: null, error: { code: '42703', message: 'same_known_legacy_claim_column_mismatch' } }
        const saved = payload!.map((row, index) => ({ id: `ad700000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...structuredClone(row) }))
        f.rows[table].push(...saved)
        return { data: f.receiptChange ? f.receiptChange(structuredClone(saved)) : structuredClone(saved), error: null }
      }
      return { data: structuredClone((f.rows[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(0, maximum))
        .map(row => columns === '*' ? row : Object.fromEntries(columns.split(',').map(key => [key, row[key]]))), error: null }
    }
    const q = {
      select: (value = '*') => { columns = value; return q }, order: () => q,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q },
      limit: (value: number) => { maximum = value; return q },
      insert: (value: Row | Row[]) => { mode = 'insert'; payload = Array.isArray(value) ? value : [value]; return q },
      maybeSingle: async () => { const r = execute(); return { data: r.data?.[0] ?? null, error: r.error } },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve().then(execute).then(resolve),
    }
    return q
  },
} }))

import { claimPortalCustomerAction } from '@/lib/customer-portal/claim'
import { projectAdminPortalClaim } from '@/lib/customer-portal/adminProjection'
import { insertRejectedClaimAttempts, type RejectedClaimAttempt } from '@/lib/customer-portal/claimAttemptEvidence'
import CustomerPortalAccessCard from '@/components/admin/customers/CustomerPortalAccessCard'
import { getRedirectError } from 'next/dist/client/components/redirect'
import { RedirectType } from 'next/navigation'

function candidate(id = f.customer, company = f.company, name = 'Wrong Name') {
  return { id, company_id: company, customer_type: 'private', first_name: name, last_name: '', full_name: name,
    email: 'attempt@example.invalid', personal_number: '199001011234', customer_number: `SYN-${id}`, profile_revision: 1, contact_revision: 1 }
}
function form(overrides: Record<string, string> = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ email: 'attempt@example.invalid', personal_number: '199001011234',
    full_name: 'Synthetic Attempt', installation_id: '735999000000001', company_slug: 'attempt-a', ...overrides })) data.set(key, value)
  return data
}
async function run(overrides: Record<string, string> = {}) {
  return claimPortalCustomerAction({ ok: false, message: '' }, form(overrides))
}
function noGrants() { expect(f.rpc).toEqual([]);expect(f.rows.customer_portal_accounts).toEqual([]);expect(f.rows.customer_portal_events).toEqual([]) }
function saved() { return f.rows.customer_portal_claims }
function projected(row: Row) { return projectAdminPortalClaim(row as Parameters<typeof projectAdminPortalClaim>[0]) }
beforeEach(() => {
  f.authError = false; f.readError = null; f.writeError = null; f.receiptChange = null; f.writes = []; f.rpc = []
  f.rows = { companies: [{ id: f.company, slug: 'attempt-a' }, { id: f.foreign, slug: 'attempt-b' }],
    customers: [candidate()], customer_contacts: [], customer_sites: [{ id: f.site, company_id: f.company,
      customer_id: f.customer, facility_id: '735999000000001' }], metering_points: [], customer_portal_claims: [],
    customer_portal_accounts: [], customer_portal_events: [] }
})

it.each(['scoped', 'unscoped'])('actual zero-candidate %s rejection saves only genuine scope and attempted facts', async scope => {
  f.rows.customers = []
  const result = await run(scope === 'unscoped' ? { company_slug: '' } : {})
  expect(result.ok).toBe(false);expect(saved()).toHaveLength(1)
  expect(saved()[0]).toMatchObject({ company_id: scope === 'scoped' ? f.company : null, customer_id: null, user_id: f.user,
    status: 'rejected', metadata: { schemaVersion: 1, source: 'native_self_claim_attempt_v1',
      personal_number_last4: '1234', email_matched: false, name_matched: false, personal_number_matched: false,
      installation_matched: false, attempt_reason: 'no_candidate' } })
  expect(projected(saved()[0])).toMatchObject({ email_matched: false, failure_reason: 'Inget kundkort matchade angivet personnummer.' })
  noGrants()
})

it('actual ambiguous full matches save one canonical batch with all true attempt flags and no verified account', async () => {
  f.rows.customers = [candidate(f.customer, f.company, 'Synthetic Attempt'), candidate(f.second, f.foreign, 'Synthetic Attempt')]
  f.rows.customer_sites.push({ id: f.secondSite, company_id: f.foreign, customer_id: f.second, facility_id: '735999000000001' })
  expect((await run({ company_slug: '' })).ok).toBe(false)
  expect(f.writes).toHaveLength(1);expect(saved()).toHaveLength(2)
  expect(saved().map(row => [row.company_id, row.customer_id])).toEqual([[f.company, f.customer], [f.foreign, f.second]])
  for (const row of saved()) expect(projected(row)).toMatchObject({ status: 'rejected', email_matched: true,
    name_matched: true, personal_number_matched: true, installation_matched: true })
  expect(saved()[0].metadata).toMatchObject({ attempt_reason: 'ambiguous_strict_match' });noGrants()
})

it('actual mismatched name keeps saved false versus true booleans and renders the attempted evidence', async () => {
  expect((await run()).ok).toBe(false);expect(saved()).toHaveLength(1)
  const claim = projected(saved()[0])
  expect(claim).toMatchObject({ status: 'rejected', user_email: 'attempt@example.invalid', email_matched: true,
    name_matched: false, personal_number_matched: true, installation_matched: true, matched_site_id: f.site })
  const html = renderToStaticMarkup(createElement(CustomerPortalAccessCard, { customerId: f.customer, accounts: [], claims: [claim] }))
  expect(html).toContain('Namn match: Nej');expect(html).toContain('E-post match: Ja');noGrants()
})

it('actual mixed candidates preserve each evaluated flag in one insert and omit full PN and unknown form fields', async () => {
  f.rows.customers.push({ ...candidate(f.second), email: 'other@example.invalid' })
  const before = JSON.stringify(f.rows.customers)
  await run({ actorUserId: f.foreign, status: 'approved', schemaVersion: '88', token: 'synthetic-forbidden-token' })
  expect(f.writes).toHaveLength(1);expect(saved()).toHaveLength(2)
  expect(saved().map(row => projected(row).email_matched)).toEqual([true, false])
  const serialized = JSON.stringify(saved())
  expect(serialized).not.toContain('199001011234');expect(serialized).not.toContain('synthetic-forbidden-token')
  expect(serialized).not.toContain('"status":"approved"');expect(saved().every(row => row.user_id === f.user)).toBe(true)
  expect(JSON.stringify(f.rows.customers)).toBe(before);noGrants()
})

it('an exact resolved tenant excludes quiet foreign candidates before any rejected attempt write', async () => {
  f.rows.customers = [candidate(f.second, f.foreign)]
  await run();expect(saved()).toHaveLength(1)
  expect(saved()[0]).toMatchObject({ company_id: f.company, customer_id: null });noGrants()
})
it('a short nonmatching PN remains an ordinary rejected attempt with unknown last-four evidence', async () => {
  expect((await run({ personal_number: '12' })).ok).toBe(false);expect(saved()).toHaveLength(1)
  expect(saved()[0].metadata).toMatchObject({ personal_number_last4: null, input_snapshot: { personalNumberLast4: null } })
  expect(projected(saved()[0]).personal_number_last4).toBe(null);noGrants()
})
it('an oversized nonmatching input name stays rejected and is left unknown rather than truncated into a different saved fact', async () => {
  expect((await run({ full_name: 'x'.repeat(2049) })).ok).toBe(false);expect(saved()).toHaveLength(1)
  expect(saved()[0].metadata).toMatchObject({ name_matched: false, input_snapshot: { fullName: null } });noGrants()
})
it('missing current Auth returns installed login controlflow with zero attempt writes', async () => {
  f.authError = true
  await expect(run()).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
  expect(f.writes).toEqual([]);noGrants()
})
it('missing required input and an unknown company do not persist a guessed identity or tenant', async () => {
  expect((await run({ personal_number: '' })).ok).toBe(false)
  expect((await run({ company_slug: 'missing' })).ok).toBe(false)
  expect(f.writes).toEqual([]);noGrants()
})
it('the actual write error is rethrown unchanged without account/event side effects', async () => {
  const original = { code: 'XX000', message: 'synthetic_write_failure' };f.writeError = original
  await expect(run()).rejects.toBe(original);expect(saved()).toEqual([]);noGrants()
})
it('installed Next read controlflow is preserved and creates no attempt evidence', async () => {
  const signal = getRedirectError('/synthetic-controlflow', RedirectType.replace);f.readError = signal
  await expect(run()).rejects.toBe(signal);expect(f.writes).toEqual([]);noGrants()
})
it('an attempt source never upgrades approved status or unversioned history into verified match facts', () => {
  const row = { id: f.customer, user_id: f.user, customer_id: f.customer, status: 'approved',
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    metadata: { schemaVersion: 1, source: 'native_self_claim_attempt_v1', email_matched: true } }
  expect(projected(row).email_matched).toBe(null)
  expect(projected({ ...row, status: 'rejected', metadata: { email_matched: true } }).email_matched).toBe(null)
})

it.each([
  ['missing rows', (rows: Row[]) => rows.slice(1)],
  ['extra row', (rows: Row[]) => [...rows, { ...rows[0], id: 'ad700000-0000-4000-8000-000000000099' }]],
  ['duplicate receipt id', (rows: Row[]) => rows.map(row => ({ ...row, id: rows[0].id }))],
  ['malformed id', (rows: Row[]) => rows.map(row => ({ ...row, id: 'not-a-stored-id' }))],
  ['foreign actor', (rows: Row[]) => rows.map(row => ({ ...row, user_id: f.foreign }))],
  ['foreign company', (rows: Row[]) => rows.map(row => ({ ...row, company_id: f.foreign }))],
  ['changed status', (rows: Row[]) => rows.map(row => ({ ...row, status: 'approved' }))],
  ['changed attempted evidence', (rows: Row[]) => rows.map(row => ({ ...row, metadata: {} }))],
] as const)('actual Action cannot report an ordinary saved rejection from %s receipt', async (_label, change) => {
  f.rows.customers.push(candidate(f.second));f.receiptChange = change
  await expect(run()).rejects.toThrow('portal_claim_attempt_receipt_unavailable');noGrants()
  // This is an acknowledgement fault after controlled persistence; no false
  // rollback/zero-claim-write guarantee is inferred from a malformed reply.
  expect(f.writes).toHaveLength(1)
})
it('a reversed genuine returned batch still matches its exact unordered persisted tuples', async () => {
  f.rows.customers.push(candidate(f.second));f.receiptChange = rows => rows.reverse()
  expect((await run()).ok).toBe(false);expect(saved()).toHaveLength(2);expect(f.writes).toHaveLength(1);noGrants()
})
function helperInput(): RejectedClaimAttempt {
  return { userId: f.user, userEmail: 'attempt@example.invalid', companyId: f.company, customerId: f.customer,
    personalNumberLast4: '1234', inputSnapshot: { email: 'attempt@example.invalid', personalNumber: '199001011234',
      token: 'synthetic-forbidden-extra', personalNumberLast4: '1234' }, matchSnapshot: { personalNumber: '199001011234' },
    flags: { emailMatched: true, nameMatched: false, personalNumberMatched: true, installationMatched: false }, reason: 'identity_mismatch' }
}
it('the actual new writer omits unknown nested fields and never stores a verified or claimed timestamp', async () => {
  await insertRejectedClaimAttempts([helperInput()])
  expect(JSON.stringify(saved())).not.toContain('199001011234');expect(JSON.stringify(saved())).not.toContain('synthetic-forbidden-extra')
  expect(saved()[0]).not.toHaveProperty('claimed_at');expect(saved()[0]).not.toHaveProperty('reviewed_at')
  expect(saved()[0].metadata).not.toHaveProperty('reviewed_at');noGrants()
})
it.each(['bad-flag', 'bad-last4', 'missing-company', 'prototype-reason'])('invalid %s attempt facts fail before a write', async kind => {
  const input = helperInput()
  if (kind === 'bad-flag') input.flags.emailMatched = 'true' as unknown as boolean
  if (kind === 'bad-last4') input.personalNumberLast4 = '199001011234'
  if (kind === 'missing-company') input.companyId = null
  if (kind === 'prototype-reason') input.reason = '__proto__' as RejectedClaimAttempt['reason']
  await expect(insertRejectedClaimAttempts([input])).rejects.toThrow('portal_claim_attempt_invalid')
  expect(f.writes).toEqual([]);noGrants()
})
