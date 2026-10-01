import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: database }))

import {
  listCustomerPortalAccountsByCustomerId,
  listCustomerPortalClaimsByCustomerId,
  listRecentCustomerPortalClaims,
} from '@/lib/customer-portal/admin'
import CustomerPortalAccessCard from '@/components/admin/customers/CustomerPortalAccessCard'

type Row = Record<string, unknown>
type Query = { table: string; columns: string[]; filters: [string, unknown][]; limit: number | null; descending: boolean }
const schema = fs.readFileSync(path.join(process.cwd(), 'supabase/schema.sql'), 'utf8')
const tableColumns = new Map(['customer_portal_accounts', 'customer_portal_claims'].map((table) => {
  const ddl = schema.match(new RegExp(`CREATE TABLE public\\.${table} \\(([\\s\\S]*?)\\n\\);`))?.[1]
  if (!ddl) throw new Error(`Canonical table absent: ${table}`)
  return [table, new Set([...ddl.matchAll(/^    ([a-z_]+) (?!CHECK\b)(?:[a-z])/gm)].map((match) => match[1]))]
}))
let rows: Record<string, Row[]>
let queries: Query[]
let forcedError: unknown

function installReadOnlyDatabase() {
  database.from.mockImplementation((table: string) => {
    const query: Query = { table, columns: [], filters: [], limit: null, descending: false }
    queries.push(query)
    const builder = {
      select(columns: string) { query.columns = columns.split(','); return builder },
      eq(column: string, value: unknown) { query.filters.push([column, value]); return builder },
      order(column: string, options: { ascending: boolean }) {
        expect(column).toBe('created_at'); query.descending = !options.ascending; return builder
      },
      limit(value: number) { query.limit = value; return builder },
      then(resolve: (value: { data: Row[] | null; error: unknown }) => unknown) {
        const missing = query.columns.find((column) => !tableColumns.get(table)?.has(column))
        if (missing) return Promise.resolve({ data: null, error: { code: '42703', message: `column ${missing} does not exist` } }).then(resolve)
        if (forcedError) return Promise.resolve({ data: null, error: forcedError }).then(resolve)
        const selected = (rows[table] ?? []).filter((row) => query.filters.every(([key, value]) => row[key] === value))
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) * (query.descending ? -1 : 1))
          .slice(0, query.limit ?? Infinity)
          .map((row) => Object.fromEntries(query.columns.map((column) => [column, row[column]])))
        return Promise.resolve({ data: selected, error: null }).then(resolve)
      },
    }
    return builder
  })
}

const account: Row = {
  id: 'account-1', company_id: 'company-A', customer_id: 'customer-A', user_id: 'native-user-A',
  portal_user_id: null, user_email: 'saved-account@example.invalid', role: 'billing', is_active: true,
  status: 'active', invited_at: null, activated_at: '2026-09-30T09:00:00Z', verified_at: null,
  last_seen_at: null, match_method: 'saved-method', verified_identity_snapshot: { inputName: 'Saved identity' },
  metadata: {}, created_at: '2026-09-30T09:00:00Z', updated_at: '2026-09-30T09:00:00Z',
}
const claim: Row = {
  id: 'claim-1', company_id: 'company-A', customer_id: 'customer-A', user_id: 'native-user-A',
  claim_type: 'self_claim', status: 'approved', metadata: {},
  created_at: '2026-09-30T10:00:00Z', updated_at: '2026-09-30T10:00:00Z',
}

function recognizedMetadata(): Row {
  return {
    schemaVersion: 1, source: 'native_account_completion_reconstructed_v1',
    user_email: 'historical-approved@example.invalid', match_method: 'self_claim_strict_identity',
    personal_number_last4: '1234', email_matched: true, name_matched: false,
    personal_number_matched: true, installation_matched: true,
    matched_site_id: 'saved-site-A', matched_metering_point_id: null, failure_reason: null,
    input_snapshot: { email: 'historical-approved@example.invalid', firstName: 'Saved', lastName: 'Name',
      fullName: 'Saved Name', personalNumberLast4: '1234', installationId: 'saved-facility', companySlug: 'saved-company' },
    match_snapshot: { customerId: 'customer-A', customerNumber: 'saved-number', emailMatched: true,
      nameMatched: false, personalNumberMatched: true, installationMatched: true, matchedSiteId: 'saved-site-A' },
    reviewed_at: '2026-09-30T10:00:00Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks(); rows = { customer_portal_accounts: [structuredClone(account)], customer_portal_claims: [structuredClone(claim)] }
  queries = []; forcedError = null; installReadOnlyDatabase()
})

describe('actual portal admin readers against canonical column declarations', () => {
  it('reads the saved account without requesting a nonexistent notes column', async () => {
    const result = await listCustomerPortalAccountsByCustomerId('customer-A', { companyId: 'company-A' })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'account-1', role: 'billing', notes: null })
  })
  it('reads customer claims from canonical metadata rather than nonexistent debug columns', async () => {
    const result = await listCustomerPortalClaimsByCustomerId('customer-A', { companyId: 'company-A' })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'claim-1', status: 'approved', user_email: null, email_matched: null })
  })
  it('reads recent claims without requesting nonexistent legacy projection fields', async () => {
    const result = await listRecentCustomerPortalClaims({ status: 'approved' })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'claim-1', match_method: null, input_snapshot: {} })
  })
})

describe('saved evidence and canonical query behavior', () => {
  it('projects only the recognized saved v1 facts without substituting a current account email', async () => {
    rows.customer_portal_claims[0].metadata = recognizedMetadata()
    const [result] = await listCustomerPortalClaimsByCustomerId('customer-A', { companyId: 'company-A' })
    expect(result).toEqual({
      id: 'claim-1', user_id: 'native-user-A', customer_id: 'customer-A', status: 'approved',
      user_email: 'historical-approved@example.invalid', match_method: 'self_claim_strict_identity',
      personal_number_last4: '1234', email_matched: true, name_matched: false,
      personal_number_matched: true, installation_matched: true,
      matched_site_id: 'saved-site-A', matched_metering_point_id: null, failure_reason: null,
      input_snapshot: recognizedMetadata().input_snapshot, match_snapshot: recognizedMetadata().match_snapshot,
      created_at: '2026-09-30T10:00:00Z', updated_at: '2026-09-30T10:00:00Z',
    })
    expect(queries.map((query) => query.table)).toEqual(['customer_portal_claims'])
  })

  it.each([
    ['empty history', {}], ['null history', null], ['array history', []],
    ['unversioned history', { ...recognizedMetadata(), schemaVersion: undefined }],
    ['string version', { ...recognizedMetadata(), schemaVersion: '1' }],
    ['future version', { ...recognizedMetadata(), schemaVersion: 2 }],
    ['different source', { ...recognizedMetadata(), source: 'unqualified_history' }],
  ])('keeps %s unknown even for an approved canonical claim', async (_label, metadata) => {
    rows.customer_portal_claims[0].metadata = metadata
    const [result] = await listCustomerPortalClaimsByCustomerId('customer-A')
    expect(result).toMatchObject({ status: 'approved', user_email: null, match_method: null,
      email_matched: null, name_matched: null, personal_number_matched: null, installation_matched: null,
      input_snapshot: {}, match_snapshot: {}, failure_reason: null })
  })

  it('does not coerce malformed evidence or use claim status as a matching flag', async () => {
    rows.customer_portal_claims[0].status = 'rejected'
    rows.customer_portal_claims[0].metadata = {
      ...recognizedMetadata(), user_email: 123, match_method: {}, personal_number_last4: '12345',
      email_matched: 'true', name_matched: 1, personal_number_matched: null, installation_matched: false,
      matched_site_id: [], matched_metering_point_id: 12, failure_reason: { message: 'not-a-saved-string' },
      input_snapshot: { fullName: 'Saved Name', email: {}, unknownKey: 'unused', personalNumber: 'not-to-project' },
      match_snapshot: { nameMatched: 'true', emailMatched: false, customerNumber: 'saved-number', unknownKey: 'unused' },
    }
    const [result] = await listRecentCustomerPortalClaims({ status: 'rejected' })
    expect(result).toMatchObject({ status: 'rejected', user_email: null, match_method: null,
      personal_number_last4: null, email_matched: null, name_matched: null,
      personal_number_matched: null, installation_matched: false,
      matched_site_id: null, matched_metering_point_id: null, failure_reason: null,
      input_snapshot: { fullName: 'Saved Name' }, match_snapshot: { emailMatched: false, customerNumber: 'saved-number' } })
  })

  it('preserves saved restricted roles, native-null aliases, evidence and dates without any row mutation', async () => {
    rows.customer_portal_accounts.push({ ...account, id: 'account-2', role: 'viewer', user_id: null,
      portal_user_id: 'saved-portal-alias', user_email: null, verified_at: null })
    const before = JSON.stringify(rows)
    const result = await listCustomerPortalAccountsByCustomerId('customer-A', { companyId: 'company-A' })
    expect(result.map((row) => row.role)).toEqual(['billing', 'viewer'])
    expect(result[1]).toMatchObject({ user_id: null, user_email: null, verified_at: null, notes: null })
    expect(result[0].verified_identity_snapshot).toEqual({ inputName: 'Saved identity' })
    expect(result[0].activated_at).toBe(account.activated_at)
    expect(JSON.stringify(rows)).toBe(before)
  })

  it('does not display a canonical disabled tombstone as active when legacy is_active remains true', async () => {
    rows.customer_portal_accounts[0].status = 'disabled'
    const [result] = await listCustomerPortalAccountsByCustomerId('customer-A')
    expect(result.is_active).toBe(false)
    expect(rows.customer_portal_accounts[0].is_active).toBe(true)
  })

  it('retains exact customer/company scope, descending order and caller limits on both customer readers', async () => {
    for (const table of ['customer_portal_accounts', 'customer_portal_claims']) {
      const base = rows[table][0]
      rows[table] = [
        { ...base, id: 'old', created_at: '2026-09-29T00:00:00Z' },
        { ...base, id: 'new', created_at: '2026-09-30T00:00:00Z' },
        { ...base, id: 'foreign-company', company_id: 'company-B', created_at: '2026-10-01T00:00:00Z' },
        { ...base, id: 'other-customer', customer_id: 'customer-B', created_at: '2026-10-01T00:00:00Z' },
      ]
    }
    const options = { companyId: 'company-A', limit: 1 }
    expect((await listCustomerPortalAccountsByCustomerId('customer-A', options)).map((row) => row.id)).toEqual(['new'])
    expect((await listCustomerPortalClaimsByCustomerId('customer-A', options)).map((row) => row.id)).toEqual(['new'])
    expect(queries.map(({ filters, limit, descending }) => ({ filters, limit, descending }))).toEqual([
      { filters: [['customer_id', 'customer-A'], ['company_id', 'company-A']], limit: 1, descending: true },
      { filters: [['customer_id', 'customer-A'], ['company_id', 'company-A']], limit: 1, descending: true },
    ])
  })

  it('keeps default bounds 50/20/50 and recent status filtering without silently treating all as a status', async () => {
    await listCustomerPortalAccountsByCustomerId('customer-A')
    await listCustomerPortalClaimsByCustomerId('customer-A')
    await listRecentCustomerPortalClaims({ status: 'all' })
    await listRecentCustomerPortalClaims({ status: 'approved', limit: 1 })
    expect(queries.map((query) => query.limit)).toEqual([50, 20, 50, 1])
    expect(queries[2].filters).toEqual([])
    expect(queries[3].filters).toEqual([['status', 'approved']])
  })

  it('returns normal empty only for successful canonical reads', async () => {
    rows = {}
    expect(await listCustomerPortalAccountsByCustomerId('customer-A')).toEqual([])
    expect(await listCustomerPortalClaimsByCustomerId('customer-A')).toEqual([])
    expect(await listRecentCustomerPortalClaims()).toEqual([])
  })

  it('propagates unavailable read errors unchanged through every exported reader', async () => {
    forcedError = { code: 'PT503', message: 'controlled unavailable database' }
    await expect(listCustomerPortalAccountsByCustomerId('customer-A')).rejects.toBe(forcedError)
    await expect(listCustomerPortalClaimsByCustomerId('customer-A')).rejects.toBe(forcedError)
    await expect(listRecentCustomerPortalClaims()).rejects.toBe(forcedError)
  })

  it('renders unknown historical matching and a truthful shown count through the actual server component', async () => {
    rows.customer_portal_claims[0].user_id = null
    const accounts = await listCustomerPortalAccountsByCustomerId('customer-A')
    const claims = await listCustomerPortalClaimsByCustomerId('customer-A')
    const html = renderToStaticMarkup(React.createElement(CustomerPortalAccessCard, { customerId: 'customer-A', accounts, claims }))
    expect(html).toContain('Visade verifieringsförsök')
    expect(html).not.toContain('Totala claims')
    expect(html).toContain('Okänd användare')
    for (const field of ['E-post', 'Namn', 'Personnummer', 'Anläggning']) {
      expect(html).toContain(`${field} match: Okänt`)
      expect(html).not.toContain(`${field} match: Nej`)
    }
    expect(html).toContain('Roll: billing')
    expect(html).toContain('Saved identity')
  })

  it('renders an actual saved negative separately from a missing matching fact', async () => {
    rows.customer_portal_claims[0].metadata = { ...recognizedMetadata(), email_matched: undefined }
    const claims = await listCustomerPortalClaimsByCustomerId('customer-A')
    const html = renderToStaticMarkup(React.createElement(CustomerPortalAccessCard, { customerId: 'customer-A', accounts: [], claims }))
    expect(html).toContain('E-post match: Okänt')
    expect(html).toContain('Namn match: Nej')
    expect(html).toContain('Personnummer match: Ja')
    expect(html).toContain('historical-approved@example.invalid')
  })
})
