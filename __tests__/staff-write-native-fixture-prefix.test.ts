import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { staffWriteNativeFixture } from '../scripts/helpers/staff-write-native-fixture'

// Execute the actual helper's client INSERT under the immutable historical
// table declaration, including its global (not company-scoped) prefix unique
// constraint. This focused diagnostic does not replace authentic clean replay.
it('seeds distinct native staff client prefixes across companies and fixture cohorts', async () => {
  const migration = readFileSync('supabase/migrations/20260531111600_system_readiness_foundation.sql', 'utf8')
  const clients = /create table if not exists public\.integration_api_clients \([\s\S]+?\n\);/.exec(migration)?.[0]
  if (!clients) throw new Error('Missing historical API-client declaration')
  const db = new PGlite()
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE TABLE public.companies(id uuid PRIMARY KEY); ${clients}`)
    for (let i = 0; i < 2; i++) {
      const fixture = staffWriteNativeFixture()
      const actualInsert = /INSERT INTO public\.integration_api_clients[\s\S]+?;/.exec(fixture.seed)?.[0]
      if (!actualInsert) throw new Error('Missing actual staff fixture client INSERT')
      await db.query('INSERT INTO public.companies(id) VALUES($1),($2)', [fixture.companyId, fixture.foreignCompanyId])
      await db.exec(actualInsert)
    }
    expect((await db.query<{ total: number; prefixes: number }>('SELECT count(*)::integer total,count(DISTINCT key_prefix)::integer prefixes FROM public.integration_api_clients')).rows[0]).toEqual({ total: 4, prefixes: 4 })
    // The actual global constraint still rejects reuse, even across companies.
    await expect(db.exec(`INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash)
      SELECT gen_random_uuid(), (SELECT id FROM companies WHERE id<>c.company_id LIMIT 1),'Collision control',c.key_prefix,'synthetic-no-real-key'
      FROM public.integration_api_clients c LIMIT 1;`)).rejects.toMatchObject({ code: '23505', constraint: 'integration_api_clients_key_prefix_unique' })
  } finally { await db.close() }
}, 20_000)
