import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { expect, it, vi } from 'vitest'
import { proofSql, quote, withLegacyReadDatabase, type LegacyReadClient } from './customer-read-proof-native'

const state = vi.hoisted(() => ({ client: null as LegacyReadClient | null, companyId: '', customerId: '', telemetry: vi.fn(async () => undefined) }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => state.client!.from(table) } }))
vi.mock('@/lib/integrations/apiAuth', async original => ({ ...await original<typeof import('@/lib/integrations/apiAuth')>(), logIntegrationApiRequest: state.telemetry }))
vi.mock('@/lib/customer-portal/externalApi', async original => ({ ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => ({ ok: true, startedAt: Date.now(), client: { id: 'synthetic-schema-client', company_id: state.companyId },
    identity: { customer_id: state.customerId, external_customer_id: null } }) }))
import { GET } from '@/app/api/v1/customer/metering-values/route'

it('returns safe retryable 503 from actual missing legacy metering columns without altering current public schema', async () => {
  state.companyId = randomUUID(); state.customerId = randomUUID()
  const publicColumns = () => proofSql<unknown>(`SELECT jsonb_agg(jsonb_build_array(column_name,data_type,is_nullable) ORDER BY ordinal_position)
    FROM information_schema.columns WHERE table_schema='public' AND table_name='normalized_metering_values';`)
  const before = publicColumns()
  await withLegacyReadDatabase('metering', async ({ schema, client }) => {
    state.client = client
    const response = await GET(new NextRequest('http://127.0.0.1:3000/api/v1/customer/metering-values'))
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error).toMatchObject({ code: 'platform_schema_not_ready', retryable: true })
    expect(body.data).toBeUndefined()
    expect(JSON.stringify(body)).not.toMatch(/42703|PGRST|customer_site_id|normalized_metering_values|column|schema cache/)
    expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM ${schema}.normalized_metering_values;`)).toBe(1)
  }, schema => {
    // This representative old shape is intentionally separate. The external
    // paged API requires its full current selector and safely declines it;
    // nullable DTO characterization is covered by the route/unit contract.
    proofSql(`CREATE TABLE ${schema}.normalized_metering_values(id uuid PRIMARY KEY,company_id uuid NOT NULL,customer_id uuid NOT NULL,
      metering_point_id uuid,period_start timestamptz,period_end timestamptz,quantity_kwh numeric,status text,created_at timestamptz);
      INSERT INTO ${schema}.normalized_metering_values VALUES(${quote(randomUUID())},${quote(state.companyId)},${quote(state.customerId)},NULL,
        '2026-09-30 10:00:00.123456+00','2026-09-30 11:00:00.123456+00',NULL,'legacy','2026-09-30 10:00:00.123456+00'); SELECT to_jsonb(true);`)
  })
  expect(publicColumns()).toEqual(before)
  console.log('METERING_READ_LEGACY_SCHEMA_NATIVE_PASS real_postgrest_missing_column=true safe_retryable_503=true public_schema_unchanged=true')
})
