// Fixture allocation component only; actual native replay remains a separate gate.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { syntheticSwedishOrganizationNumber } from '../e2e/production/helpers/swedish-organization-number.mjs'
import { nativeFixtureCompanyIdentitySql } from '../scripts/helpers/native-fixture-company-identity'

const own = '00000000-0000-4000-8000-000000000001'
const foreign = '00000000-0000-4000-8000-000000000002'
const absent = '00000000-0000-4000-8000-000000000003'
const candidates = ['occupied', 'available'].map(syntheticSwedishOrganizationNumber)
const normalized = (value: string) => value.replace(/\D/g, '')
let db: PGlite

async function rows() {
  return (await db.query<{ id: string; [key: string]: unknown }>('SELECT * FROM public.companies ORDER BY id')).rows
}

async function executeAllocation(companyId: string, numbers = candidates) {
  const results = await db.exec(nativeFixtureCompanyIdentitySql(companyId, numbers))
  return results.flatMap(result => result.rows)
}

describe('native fixture organization-number allocation under the real company index', () => {
  beforeAll(async () => {
    db = new PGlite()
    // Execute the canonical normalizer and index DDL. Only the surrounding
    // company table is reduced to the fields this fixture actually writes.
    const migration = readFileSync(resolve('supabase/migrations/20260522_db1_schema_repair_backfill_foundation.sql'), 'utf8')
    const normalizer = migration.match(/create or replace function public\.gridex_normalize_org_number\(p_value text\)[\s\S]*?\$\$;/i)?.[0]
    if (!normalizer) throw Error('canonical company normalizer missing')
    await db.exec(normalizer)
  })
  beforeEach(async () => {
    const migration = readFileSync(resolve('supabase/migrations/20260522_db1_schema_repair_backfill_foundation.sql'), 'utf8')
    const index = migration.match(/'(create unique index if not exists ux_companies_normalized_org[^']+)'/)?.[1]
    if (!index) throw Error('canonical company uniqueness index missing')
    await db.exec(`DROP TABLE IF EXISTS public.companies;
      CREATE TABLE public.companies (
        id uuid PRIMARY KEY, name text NOT NULL, legal_name text, org_number text,
        normalized_org_number text GENERATED ALWAYS AS (public.gridex_normalize_org_number(org_number)) STORED,
        address_line_1 text, postal_code text, city text, country_code text,
        support_email text, phone text, website text);
      ${index};`)
    await db.query('INSERT INTO public.companies(id,name) VALUES ($1,$2),($3,$4)', [own, 'own', foreign, 'foreign'])
  })
  afterEach(async () => { await db.exec('ROLLBACK;') })
  afterAll(async () => { await db.close() })

  it('reproduces the original collision, allocates the next valid candidate and preserves the foreign company', async () => {
    await db.query('UPDATE public.companies SET org_number=$1 WHERE id=$2', [candidates[0], foreign])
    const foreignBefore = (await rows()).find(row => row.id === foreign)
    await expect(db.query('UPDATE public.companies SET org_number=$1 WHERE id=$2', [normalized(candidates[0]), own]))
      .rejects.toMatchObject({ code: '23505', constraint: 'ux_companies_normalized_org' })

    expect(await executeAllocation(own)).toEqual([{ to_jsonb: normalized(candidates[1]) }])
    const actual = await rows()
    expect(actual.find(row => row.id === foreign)).toEqual(foreignBefore)
    expect(actual.find(row => row.id === own)).toEqual({
      id: own, name: 'own', legal_name: 'Synthetic Archive AB', org_number: normalized(candidates[1]),
      normalized_org_number: normalized(candidates[1]), address_line_1: 'Testgatan 1',
      postal_code: '123 45', city: 'Teststad', country_code: 'SE',
      support_email: 'service@example.invalid', phone: '0101234567', website: 'https://example.invalid',
    })
  })

  it('fails explicitly when all supplied candidates are occupied without leaking a partial company update', async () => {
    await db.query('UPDATE public.companies SET org_number=$1 WHERE id=$2', [candidates[0], foreign])
    const before = await rows()
    await expect(executeAllocation(own, [candidates[0], candidates[0]]))
      .rejects.toMatchObject({ code: 'P0001', message: 'native_fixture_company_org_candidates_exhausted' })
    await db.exec('ROLLBACK;')
    expect(await rows()).toEqual(before)
  })

  it('propagates a different unique violation instead of treating it as an organization collision', async () => {
    await db.exec('CREATE UNIQUE INDEX fixture_support_email_unique ON public.companies(support_email)')
    await db.query('UPDATE public.companies SET support_email=$1 WHERE id=$2', ['service@example.invalid', foreign])
    const before = await rows()
    await expect(executeAllocation(own)).rejects.toMatchObject({ code: '23505', constraint: 'fixture_support_email_unique' })
    await db.exec('ROLLBACK;')
    expect(await rows()).toEqual(before)
  })

  it('propagates a non-unique constraint failure without changing either company', async () => {
    await db.exec("ALTER TABLE public.companies ADD CONSTRAINT fixture_country_guard CHECK (country_code IS DISTINCT FROM 'SE')")
    const before = await rows()
    await expect(executeAllocation(own)).rejects.toMatchObject({ code: '23514', constraint: 'fixture_country_guard' })
    await db.exec('ROLLBACK;')
    expect(await rows()).toEqual(before)
  })

  it('rejects an absent disposable company without creating or changing another company', async () => {
    const before = await rows()
    await expect(executeAllocation(absent)).rejects.toMatchObject({ code: 'P0001', message: 'native_fixture_company_required' })
    await db.exec('ROLLBACK;')
    expect(await rows()).toEqual(before)
  })
})
