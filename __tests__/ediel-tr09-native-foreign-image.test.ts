// Actual PostgreSQL row serialization and SHA bytes over declared fixture rows;
// this does not qualify native production or tenant authority.
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {afterAll, beforeAll, beforeEach, expect, it} from 'vitest'
import {nativeForeignRowArrayImage, type NativeForeignImage} from '../scripts/helpers/ediel-tr09-native-foreign-image'

const own = '00000000-0000-4000-8000-000000000001'
const foreign = '00000000-0000-4000-8000-000000000002'
const db = new PGlite()
const rowArray = `(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb)
  FROM frame t WHERE t.company_id IS DISTINCT FROM '${own}'::uuid)`
beforeAll(async () => {
  await db.exec(`CREATE SCHEMA extensions;
    CREATE FUNCTION extensions.digest(body text,algorithm text) RETURNS bytea
    LANGUAGE plpgsql IMMUTABLE STRICT AS $$ BEGIN
      IF algorithm<>'sha256' THEN RAISE EXCEPTION 'fixture_sha256_only'; END IF;
      RETURN pg_catalog.sha256(convert_to(body,'UTF8')); END $$;
    CREATE TABLE frame(id integer PRIMARY KEY,company_id uuid,payload text,other_field jsonb);`)
})
beforeEach(async () => {
  await db.exec('TRUNCATE frame')
  await db.query(`INSERT INTO frame VALUES (1,$1,'owned','{"field":"own"}'),
    (2,$2,$3,'{"field":"foreign"}'),(3,NULL,'global','{"field":"global"}')`,
  [own, foreign, 'X'.repeat(1100000)])
})
afterAll(async () => {await db.close()})
async function image(expression = rowArray) {
  return (await db.query<{image: NativeForeignImage}>(`SELECT ${nativeForeignRowArrayImage(expression)} AS image`)).rows[0].image
}

it('hashes the entire >1MiB array and includes NULL-company rows with a bounded result', async () => {
  const text = (await db.query<{text: string}>(`SELECT (${rowArray})::text AS text`)).rows[0].text
  expect(Buffer.byteLength(text)).toBeGreaterThan(1024 * 1024)
  const captured = await image()
  expect(captured).toEqual({rowCount: 2, sha256: createHash('sha256').update(text).digest('hex')})
  expect(Buffer.byteLength(JSON.stringify(captured))).toBeLessThan(128)
})

it.each([
  ['payload tail', "UPDATE frame SET payload=left(payload,length(payload)-1)||'Y' WHERE id=2"],
  ['other field', `UPDATE frame SET other_field='{"field":"changed"}' WHERE id=2`],
  ['NULL-company row', "UPDATE frame SET payload='global changed' WHERE id=3"],
  ['row added', `INSERT INTO frame VALUES(4,NULL,'added','{}')`],
  ['row removed', 'DELETE FROM frame WHERE id=3'],
])('detects %s without dropping any field or row', async (_name, mutation) => {
  const before = await image(); await db.exec(mutation)
  expect(await image()).not.toEqual(before)
})

it('keeps the explicit own/foreign boundary and remains stable across physical ordering', async () => {
  const before = await image()
  await db.exec("UPDATE frame SET payload='own changed' WHERE id=1; CREATE INDEX frame_reverse ON frame(id DESC)")
  expect(await image()).toEqual(before)
  await db.exec('DROP INDEX frame_reverse')
})

it('captures empty arrays deterministically and preserves SQL capture failures', async () => {
  await db.exec('DELETE FROM frame WHERE company_id IS DISTINCT FROM '+`'${own}'::uuid`)
  expect(await image()).toEqual({rowCount: 0, sha256: createHash('sha256').update('[]').digest('hex')})
  expect(await image()).toEqual(await image())
  await expect(image('(SELECT missing FROM absent_table)')).rejects.toMatchObject({code: '42P01'})
})
