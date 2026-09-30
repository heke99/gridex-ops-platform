import { createHash, randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proofReference, proofSql, quote, withLegacyReadDatabase, type LegacyReadClient } from './customer-read-proof-native'

const state = vi.hoisted(() => ({ client: null as LegacyReadClient | null, companyId: '', customerId: '', telemetry: vi.fn(async () => undefined) }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => state.client!.from(table) } }))
vi.mock('@/lib/integrations/apiAuth', async original => ({ ...await original<typeof import('@/lib/integrations/apiAuth')>(), logIntegrationApiRequest: state.telemetry }))
vi.mock('@/lib/customer-portal/externalApi', async original => ({ ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => ({ ok: true, startedAt: Date.now(), client: { id: 'synthetic-schema-client', company_id: state.companyId },
    identity: { customer_id: state.customerId, external_customer_id: null } }) }))
// Only transport is redirected to a private old-shape database schema. The
// real query builder, fallback classifier, cursor and public DTO all execute.
import { listPortalLegalAcceptancesPage } from '@/lib/customer-portal/apiData'
import { publicPortalLegalAcceptance } from '@/lib/customer-portal/publicDto'
import { GET } from '@/app/api/v1/customer/legal-acceptances/route'

for (const shape of ['legacy', 'minimal'] as const) {
  it(`reads the ${shape} legal schema through real PostgREST without altering current public tables`, async () => {
    const companyId = randomUUID(), customerId = randomUUID(), otherCustomer = randomUUID(), otherCompany = randomUUID(), document = randomUUID()
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort().reverse()
    const acceptedAt = '2026-09-30T10:00:00.123456+00:00'
    const currentColumns = () => proofSql<unknown>(`SELECT jsonb_agg(jsonb_build_array(column_name,data_type,is_nullable) ORDER BY ordinal_position)
      FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_legal_acceptances';`)
    const publicBefore = currentColumns()
    await withLegacyReadDatabase('legal', async ({ schema, client }) => {
      state.client = client
      const snapshot = () => createHash('sha256').update(JSON.stringify(proofSql(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM ${schema}.customer_legal_acceptances t;`))).digest('hex')
      const before = snapshot()
      const context = { companyId, customerId, externalCustomerId: null, customerNumber: null, provider: 'synthetic_legacy_schema' }
      const projected = []
      let cursor: string | null = null
      do {
        const page = await listPortalLegalAcceptancesPage(context, { limit: 1, cursor })
        const replay = await listPortalLegalAcceptancesPage(context, { limit: 1, cursor })
        expect(replay.items).toEqual(page.items)
        expect(page.items).toHaveLength(1)
        projected.push(...page.items.map(row => publicPortalLegalAcceptance(companyId, row)))
        cursor = page.page.next_cursor
        expect(projected.length).toBeLessThanOrEqual(3)
      } while (cursor)
      expect(projected.map(row => row.acceptance_reference)).toEqual(ids.map(id => proofReference('acceptance', companyId, id)))
      for (const row of projected) expect(row).toEqual({ acceptance_reference: row.acceptance_reference, acceptance_type: 'terms',
        document_reference: shape === 'legacy' ? proofReference('legal_document', companyId, document) : null,
        document_code: null, document_version: null, document_hash: null, accepted_at: acceptedAt, source: null, created_at: acceptedAt })
      expect(snapshot()).toBe(before)
      expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM ${schema}.customer_portal_api_access_logs WHERE company_id=${quote(companyId)}
        AND customer_id=${quote(customerId)} AND action='read_legal_acceptances_page';`)).toBe(6)
    }, schema => {
      proofSql(`CREATE TABLE ${schema}.customer_legal_acceptances(id uuid PRIMARY KEY,company_id uuid NOT NULL,customer_id uuid NOT NULL,
        acceptance_type text NOT NULL,accepted_at timestamptz NOT NULL,metadata jsonb,created_at timestamptz NOT NULL
        ${shape === 'legacy' ? ',legal_text_version_id uuid,contract_id uuid,contract_application_id uuid,snapshot jsonb' : ''});
        CREATE TABLE ${schema}.customer_portal_api_access_logs(company_id uuid,customer_id uuid,external_customer_id text,route text,action text,metadata jsonb);
        INSERT INTO ${schema}.customer_legal_acceptances(id,company_id,customer_id,acceptance_type,accepted_at,created_at,metadata${shape === 'legacy' ? ',legal_text_version_id' : ''}) VALUES
          ${[...ids.map(id => ({ id, company: companyId, customer: customerId })), { id: randomUUID(), company: companyId, customer: otherCustomer }, { id: randomUUID(), company: otherCompany, customer: customerId }].map(row =>
            `(${quote(row.id)},${quote(row.company)},${quote(row.customer)},'terms',${quote(acceptedAt)},${quote(acceptedAt)},'{"private":"not exposed"}'${shape === 'legacy' ? `,${quote(document)}` : ''})`).join(',')};
        SELECT to_jsonb(true);`)
    })
    expect(currentColumns()).toEqual(publicBefore)
    console.log(shape === 'legacy' ? 'LEGAL_READ_LEGACY_SCHEMA_NATIVE_PASS real_postgrest=true rows=3 fallback=true microseconds=true public_schema_unchanged=true'
      : 'LEGAL_READ_MINIMAL_SCHEMA_NATIVE_PASS real_postgrest=true rows=3 fallback=true nullable_fields=true public_schema_unchanged=true')
  })
}

it('returns canonical safe retryable 503 for actual absent legal tables and required order columns', async () => {
  state.companyId = randomUUID(); state.customerId = randomUUID()
  const publicColumns = () => proofSql<unknown>(`SELECT jsonb_agg(jsonb_build_array(column_name,data_type,is_nullable) ORDER BY ordinal_position)
    FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_legal_acceptances';`)
  const before = publicColumns()
  for (const shape of ['missing_table', 'missing_order_column']) {
    await withLegacyReadDatabase('legal', async ({ client }) => {
      state.client = client
      const response = await GET(new NextRequest('http://127.0.0.1:3000/api/v1/customer/legal-acceptances'))
      expect(response.status).toBe(503)
      const body = await response.json()
      expect(body.error).toMatchObject({ code: 'platform_schema_not_ready', retryable: true })
      expect(body.data).toBeUndefined()
      expect(JSON.stringify(body)).not.toMatch(/42703|PGRST|accepted_at|customer_legal_acceptances|schema cache/)
    }, schema => {
      proofSql(shape === 'missing_table' ? `CREATE TABLE ${schema}.unrelated_marker(id uuid); SELECT to_jsonb(true);`
        : `CREATE TABLE ${schema}.customer_legal_acceptances(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,
          acceptance_type text,metadata jsonb,created_at timestamptz); SELECT to_jsonb(true);`)
    })
  }
  expect(publicColumns()).toEqual(before)
  console.log('LEGAL_READ_UNAVAILABLE_SCHEMA_NATIVE_PASS real_postgrest=true absent_table=true missing_required_column=true safe_retryable_503=true public_schema_unchanged=true')
})
