// reality-defects: K-W1
// K-W1: the simulated SVK grid-area feature must name the ALS owner exactly as Ediel's actor registry does. The platform
// binds an SVK owner to the registry (mapped) owner by gridex_grid_owner_name_key; the simulator's former name
// "Alingsås Energi Nät AB" got its own key, so the import created an unmapped platform owner, rebound ALS to it, and every
// exact address in ALS resolved with platform_to_ops_grid_owner_mapping_missing (no grid owner, no Z03).
import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { ALS_FEATURE } from '../scripts/reality/simulators/svkArcgisFeature'
import { ALS_GRID_AREA, ALS_GRID_OWNER_NAME } from '../scripts/helpers/reality/alsRegistry'

const schema = readFileSync(path.resolve(__dirname, '../supabase/schema.sql'), 'utf8')
const start = schema.indexOf('CREATE FUNCTION public.gridex_grid_owner_name_key(p_name text)')
const nameKey = schema.slice(start, schema.indexOf('$_$;', start) + 4)

let db: PGlite
const key = async (name: string) => (await db.query<{ k: string }>('select public.gridex_grid_owner_name_key($1) k', [name])).rows[0].k

describe('K-W1 the simulated SVK owner binds to the registry owner', () => {
  beforeAll(async () => { db = new PGlite(); await db.exec(nameKey) })

  it('the feature names ALS and the registry owner, and the platform name key matches', async () => {
    expect(ALS_FEATURE.properties.Natomrade).toBe(ALS_GRID_AREA)
    expect(ALS_FEATURE.properties.Agare).toBe(ALS_GRID_OWNER_NAME)
    expect(await key(ALS_FEATURE.properties.Agare)).toBe(await key('Alingsås Energi Elnät AB'))
  })

  it('the former simulator name does not match the registry owner (the defect)', async () => {
    expect(await key('Alingsås Energi Nät AB')).not.toBe(await key(ALS_GRID_OWNER_NAME))
  })
})
