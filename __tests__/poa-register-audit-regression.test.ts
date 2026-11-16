import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ client: null as unknown, platform: false }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({ companyId: '11111111-1111-4111-8111-111111111111', permissions: ['poa.read'], isPlatformAdmin: io.platform }),
  isPlatformAdminContext: (admin: { isPlatformAdmin: boolean }) => admin.isPlatformAdmin,
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => io.client }))
vi.mock('@/app/admin/powers-of-attorney/actions', () => ({ resolvePoaReplyAction: async () => {} }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('h1', null, title) }))

import Page from '@/app/admin/powers-of-attorney/page'
import { readPoaRegister } from '@/lib/customers/poaRegister'
import { derivePowerOfAttorneyLifecycleStatus, hasLegalPoaAcceptance } from '@/lib/customers/poaReadiness'

type Row = Record<string, unknown>
const companyId = '11111111-1111-4111-8111-111111111111'
const admin = { companyId, isPlatformAdmin: false }
const row = (extra: Row = {}): Row => ({
  id: 'poa-a', company_id: companyId, customer_id: 'customer-a', status: 'pending',
  evidence_payload: {}, created_at: '2026-11-15T12:00:00Z', ...extra,
})

// Exercise the real loader, including its select projection, rather than handing
// the page a complete row that a real database query would never return.
function database(powers: Row[]) {
  const tables: Record<string, Row[]> = {
    powers_of_attorney: powers,
    customers: [{ id: 'customer-a', company_id: companyId, full_name: 'Syntetisk kund', customer_number: 'K-1' }],
    companies: [{ id: companyId, name: 'Syntetiskt bolag' }],
    grid_owner_information_requests: [],
  }
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const from = (table: string) => {
    let fields = '*'
    let selected = [...(tables[table] ?? [])]
    const filters: Array<[string, unknown]> = []
    const query = {
      select(value: string) { fields = value; return query },
      eq(key: string, value: unknown) { filters.push([key, value]); selected = selected.filter(item => item[key] === value); return query },
      in(key: string, values: unknown[]) { selected = selected.filter(item => values.includes(item[key])); return query },
      order() { return query },
      limit(value: number) { selected = selected.slice(0, value); return query },
      range(start: number, end: number) { selected = selected.slice(start, end + 1); return query },
      then(resolve: (value: { data: Row[]; error: null }) => unknown) {
        reads.push({ table, filters })
        const data = selected.map(item => fields === '*' ? item : Object.fromEntries(fields.split(',').filter(key => key in item).map(key => [key, item[key]])))
        return Promise.resolve(resolve({ data, error: null }))
      },
    }
    return query
  }
  return { client: { from } as unknown as Pick<SupabaseClient, 'from'>, reads }
}

beforeEach(() => { vi.stubGlobal('React', React); io.platform = false })
async function render(powers: Row[]) {
  io.client = database(powers).client
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
}

it('shows no registered approval for an unsigned pending power of attorney', async () => {
  const html = await render([row()])
  expect(html).toContain('Inväntar godkännande')
  expect(html).not.toContain('Registrerat godkännande')
  expect(html).not.toContain('BankID verifierat')
  expect(html).not.toContain('Öppna PDF')
  expect(html).not.toContain('<form action=')
})

it.each([
  ['legal version', { legal_text_version_id: 'synthetic-legal-version' }],
  ['locked snapshot', { fullmakt_snapshot: { rendered_body: 'Syntetiskt godkännande' } }],
])('retains %s acceptance through the actual register select and page', async (_name, evidence) => {
  const powers = [row({ status: 'accepted', ...evidence }), row({ id: 'foreign-poa', company_id: '22222222-2222-4222-8222-222222222222', status: 'accepted', ...evidence })]
  const db = database(powers)
  const result = await readPoaRegister(db.client, admin, {})
  expect(result.powers).toHaveLength(1)
  expect(result.powers[0]).toMatchObject({ id: 'poa-a' })
  expect(hasLegalPoaAcceptance(result.powers[0])).toBe(true)
  expect(derivePowerOfAttorneyLifecycleStatus(result.powers[0])).toBe('valid')
  expect(db.reads.find(read => read.table === 'powers_of_attorney')?.filters).toContainEqual(['company_id', companyId])
  const html = await render(powers)
  expect(html).toContain('>Giltig</div>')
  expect(html).toContain('Registrerat godkännande')
  expect(html).not.toContain('Inväntar godkännande')
})

it('keeps manual acceptance distinct from verified BankID', async () => {
  const manual = await render([row({ status: 'accepted', accepted_at: '2026-11-15T12:00:00Z', method: 'manual' })])
  expect(manual).toContain('Registrerat godkännande')
  expect(manual).not.toContain('BankID verifierat')
  const bankid = await render([row({ status: 'accepted', accepted_at: '2026-11-15T12:00:00Z', evidence_payload: { verified_signature: { provider: 'bankid', status: 'completed', verification_source: 'server_callback', reference: 'synthetic-bankid-reference' } } })])
  expect(bankid).toContain('BankID verifierat')
})

it.each([
  ['expired', { status: 'accepted', accepted_at: '2026-01-01T12:00:00Z', valid_to: '2026-01-02' }, 'Utgången'],
  ['revoked', { status: 'revoked', accepted_at: '2026-01-01T12:00:00Z' }, 'Återkallad'],
  ['future', { status: 'accepted', accepted_at: '2026-01-01T12:00:00Z', valid_from: '2099-01-01' }, 'Signerad, ännu inte giltig'],
])('preserves %s lifecycle and document access presentation', async (_name, properties, label) => {
  const html = await render([row(properties)])
  expect(html).toContain(label)
  expect(html).toContain('/api/admin/powers-of-attorney/poa-a/document')
})

it('does not infer acceptance from accepted status without evidence or a stored PDF', async () => {
  const html = await render([row({ status: 'accepted', document_path: 'synthetic-private.pdf' })])
  expect(html).toContain('Inväntar godkännande')
  expect(html).not.toContain('Registrerat godkännande')
  // A stored document remains available under its separate authorized endpoint.
  expect(html).toContain('/api/admin/powers-of-attorney/poa-a/document')
})

it('keeps company columns and matching empty-state span specific to the platform register', async () => {
  const company = await render([])
  expect(company).not.toContain('>Tenant</th>')
  expect(company).not.toContain('>Bolag</th>')
  expect(company).toMatch(/colspan="4"/i)
  io.platform = true
  const platform = await render([])
  expect(platform).toContain('>Bolag</th>')
  expect(platform).toMatch(/colspan="5"/i)
})
