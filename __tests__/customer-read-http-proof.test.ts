import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it, vi } from 'vitest'
import { buildPortalDatabasePage, decodePortalCursor } from '@/lib/customer-portal/keysetPagination'
import { readAllPages } from '../e2e/helpers/customer-api-proof.mjs'

vi.mock('@/lib/env/supabaseServer', () => ({ getSupabaseServiceEnv: () => ({ serviceRoleKey: 'synthetic-proof-cursor-key' }) }))

it('verifies replayed pages through both fresh encrypted continuation cursors', async () => {
  const companyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const customerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const resource = 'legal-acceptances'
  const rows = ['33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111']
    .map(id => ({ id, accepted_at: '2026-09-30T10:00:00.123456Z' }))
  const observedCursors = new Set<string>()
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost')
    const cursor = url.searchParams.get('cursor')
    if (cursor) observedCursors.add(cursor)
    const tuple = decodePortalCursor({ cursor, companyId, customerId, resource })
    const selected = rows.filter(row => !tuple || row.id < tuple.id)
    const page = buildPortalDatabasePage(selected.slice(0, 2), { limit: 1, companyId, customerId, resource, orderColumn: 'accepted_at' })
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-gridex-contract-version': 'synthetic' })
    response.end(JSON.stringify({ data: page.items, page: page.page, contract_schema_version: 'synthetic' }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const request = { get: async (path: string, options: RequestInit) => {
      const response = await fetch(`${base}${path}`, options)
      return { status: () => response.status, headers: () => Object.fromEntries(response.headers), json: () => response.json() }
    } }
    const result = await readAllPages(request, expect, '/api/v1/customer/legal-acceptances', { key: 'synthetic', assertion: 'synthetic' }, ['id', 'accepted_at'])
    expect(result.rows).toEqual(rows)
    expect(result.pages).toBe(3)
    // The actual encoder uses random IVs: two tokens for the same tuple must
    // both be followed, instead of treating byte inequality as a replay error.
    expect(observedCursors.size).toBeGreaterThanOrEqual(4)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
