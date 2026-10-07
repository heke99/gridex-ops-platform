// Real PostgreSQL catalog behavior in a declared, configuration-only PGlite
// fixture. The original fingerprint query and actual expand migration execute;
// fixture hashes do not attest native replay or the recorded production hashes.
import {execFileSync, spawnSync} from 'node:child_process'
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PGlite} from '@electric-sql/pglite'
import {afterAll, expect, it} from 'vitest'

const templatePath = 'scripts/gridex-aud-003-schema-fingerprint.sql'
const helper = 'scripts/ediel-actor-profile-expansion-fingerprint.py'
const template = readFileSync(templatePath, 'utf8')
const projectedQuery = () => execFileSync('python3', [helper, templatePath], {encoding: 'utf8'})
const forward = readFileSync('supabase/migrations/20261007111843_ediel_actor_profile_current_authority.sql', 'utf8')
const databases: PGlite[] = []
afterAll(async () => {for (const db of databases) await db.close()})

async function hash(db: PGlite, query: string) {
  const result = await db.exec(query)
  return (result.at(-1)!.rows[0] as {encode: string}).encode
}
async function fixture(precreatedGeneratedEmail = false) {
  const db = new PGlite(); databases.push(db)
  // Only the hash adapter is supplied. No production authority function or
  // accepted/readiness state is fabricated; all metadata below is test input.
  await db.exec(`CREATE SCHEMA extensions;
    CREATE FUNCTION extensions.digest(body text,algorithm text) RETURNS bytea
    LANGUAGE plpgsql IMMUTABLE STRICT AS $$ BEGIN
      IF algorithm<>'sha256' THEN RAISE EXCEPTION 'fixture_sha256_only'; END IF;
      RETURN pg_catalog.sha256(convert_to(body,'UTF8')); END $$;
    CREATE TABLE public.companies(id uuid PRIMARY KEY,name text);
    CREATE TABLE public.price_plans(id uuid PRIMARY KEY,label text);`)
  const original = await hash(db, template)
  if (precreatedGeneratedEmail) {
    // Declare an already expanded layout before the unchanged IF NOT EXISTS
    // migration. Generated metadata is absent from the old fingerprint query.
    await db.exec(forward.replace('technical_contact_email text NULL',
      'technical_contact_email text GENERATED ALWAYS AS (technical_contact_name) STORED'))
  }
  await db.exec(forward)
  return {db, original}
}

it('admits only the six actual appended fields and preserves every original fingerprint input', async () => {
  const {db, original} = await fixture()
  expect(await hash(db, projectedQuery())).toBe(original)
  expect(await hash(db, template)).not.toBe(original)
  expect(await db.query('SELECT * FROM companies')).toMatchObject({rows: []})
})

it.each([
  ['missing column', 'ALTER TABLE companies DROP COLUMN brp_name'],
  ['wrong type', 'ALTER TABLE companies ALTER COLUMN brp_name TYPE varchar'],
  ['text domain constraint', `CREATE DOMAIN public.profile_fingerprint_text AS text CHECK (VALUE IS NULL);
    ALTER TABLE companies ALTER COLUMN brp_name TYPE public.profile_fingerprint_text`],
  ['wrong nullability', 'ALTER TABLE companies ALTER COLUMN market_role SET NOT NULL'],
  ['wrong status default', "ALTER TABLE companies ALTER COLUMN esett_status SET DEFAULT 'ready'"],
  ['unexpected contact default', "ALTER TABLE companies ALTER COLUMN technical_contact_name SET DEFAULT 'invented'"],
  ['changed ordinal', 'ALTER TABLE companies DROP COLUMN market_role; ALTER TABLE companies ADD COLUMN market_role text'],
])('rejects %s before removing any fields from the fingerprint', async (_name, mutation) => {
  const {db} = await fixture(); await db.exec(mutation)
  await expect(hash(db, projectedQuery())).rejects.toMatchObject({code: '23514', message: 'ediel_profile_expansion_metadata_drift'})
})

it.each([
  ['unrelated column', 'ALTER TABLE price_plans ADD COLUMN foreign_change text'],
  ['constraint', "ALTER TABLE companies ADD CONSTRAINT original_name_guard CHECK (name<>'')"],
  ['function definition', `CREATE FUNCTION public.gridex_contract_platform_readiness(p_company_id uuid)
    RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`],
])('retains unrelated %s drift in the projected fingerprint', async (_name, mutation) => {
  const {db, original} = await fixture(); await db.exec(mutation)
  expect(await hash(db, projectedQuery())).not.toBe(original)
})

it.each(['absent', 'duplicate'])('refuses a %s template insertion point without emitting SQL', kind => {
  const dir = mkdtempSync(join(tmpdir(), 'ediel-profile-fingerprint-'))
  try {
    const path = join(dir, 'query.sql'), slot = " where c.table_schema='public'\n"
    writeFileSync(path, kind === 'absent' ? template.replace(slot, '') : template + slot)
    const result = spawnSync('python3', [helper, path], {encoding: 'utf8'})
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('profile expansion fingerprint template drift')
  } finally {rmSync(dir, {recursive: true, force: true})}
})

it('refuses an already expanded generated text field that the original full hash cannot distinguish', async () => {
  const ordinary = await fixture(), generated = await fixture(true)
  expect(await hash(generated.db, template)).toBe(await hash(ordinary.db, template))
  await expect(hash(generated.db, projectedQuery())).rejects.toMatchObject({code: '23514', message: 'ediel_profile_expansion_metadata_drift'})
})
