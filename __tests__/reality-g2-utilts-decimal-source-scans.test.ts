// reality-defects: G-2
// G-2 / P1: validate_decimal_source_v2 scanned every token of the file per quantity (O(quantities x tokens)) and ran
// 4x per stored E66 value. Migration 20261024120000 restricts the per-quantity scans to own-transaction subsets of the
// same token elements. These tests execute the reviewed pre-image (20261012120000) and the installed post-image in
// embedded PostgreSQL and require identical results on generated E66-shaped inputs (valid, forged and malformed),
// that the migration installs only over the exact pre-image, and that function metadata is unchanged.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const migration = read('supabase/migrations/20261024120000_g2_utilts_decimal_source_own_transaction_scans.sql')
const preSource = read('supabase/migrations/20261012120000_ediel_utilts_source_quantity_quality_v2.sql')
const decimalSource = read('supabase/migrations/20260930145350_ediel_utilts_exact_decimal_contract_v2.sql')

function between(text: string, start: string, end: string) {
  const i = text.indexOf(start)
  const j = text.indexOf(end, i)
  if (i < 0 || j < 0) throw new Error(`missing ${start}`)
  return text.slice(i, j)
}
function dollarBody(text: string, from: string) {
  const m = /AS (\$[^$]*\$)([\s\S]*?)\1/.exec(text.slice(text.indexOf(from)))
  if (!m) throw new Error(from)
  return m[2]
}

async function freshDb() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema gridex_utilts_binding;`)
  await db.exec(between(decimalSource, 'CREATE FUNCTION gridex_utilts_binding.canonical_decimal_v2', '\nCREATE FUNCTION gridex_utilts_binding.', ))
  await db.exec(between(preSource, 'CREATE OR REPLACE FUNCTION gridex_utilts_binding.missing_source_quality_v2', 'REVOKE ALL ON FUNCTION gridex_utilts_binding.missing_source_quality_v2'))
  await db.exec(between(preSource, 'CREATE OR REPLACE FUNCTION gridex_utilts_binding.validate_decimal_source_v2', 'REVOKE ALL ON FUNCTION gridex_utilts_binding.validate_decimal_source_v2'))
  return db
}

type Token = { index: number; tag: string; elements: string[][] }
// Seeded generator of E66-shaped token streams: own transaction plus an optional foreign one, per-quantity SEQ/QTY/STS.
function rng(seed: number) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) }
function makeCase(seed: number) {
  const r = rng(seed)
  const n = 1 + Math.floor(r() * 12)
  const tokens: Token[] = []
  const push = (tag: string, elements: string[][]) => tokens.push({ index: tokens.length, tag, elements: [[tag], ...elements] })
  push('UNH', [['1'], ['UTILTS']])
  push('BGM', [[r() < 0.9 ? 'E66' : 'E30']])
  const foreignFirst = r() < 0.3
  const foreign = () => { push('IDE', [['24'], ['OTHER']]); push('SEQ', [[''], ['1']]); push('QTY', [['136', '9']]); push('STS', [['8'], ['21']]) }
  if (foreignFirst) foreign()
  push('IDE', [['24'], ['OWN']])
  const unit = r() < 0.9 ? 'KWH' : 'MWH'
  if (r() < 0.95) push('MEA', [['AAZ'], [''], [unit]])
  const quantities: Array<{ qualifier: string; value: string | null; quality?: string | null }> = []
  const observations: unknown[] = []
  for (let k = 0; k < n; k++) {
    if (r() > 0.05) push('SEQ', [[''], [String(k + 1)]])
    if (r() < 0.05) push('MEA', [[r() < 0.5 ? 'AAZ' : 'X'], [''], [r() < 0.5 ? unit : 'MWH']])
    const isNull = r() < 0.15
    const raw = isNull ? 'NULL' : (Math.floor(r() * 100000) / 1000).toString()
    push('QTY', [['136', raw]])
    const sts = r()
    const quality = isNull ? (sts < 0.9 ? '46' : '21') : sts < 0.7 ? '21' : sts < 0.85 ? null : '56'
    if (quality !== null) push('STS', [['8'], [quality]])
    if (r() < 0.05) push('STS', [['8'], ['99']])
    let value: string | null = isNull ? null : raw
    if (r() < 0.05) value = '1.5'
    const q: { qualifier: string; value: string | null; quality?: string | null } = { qualifier: '136', value }
    if (r() < 0.85) q.quality = r() < 0.05 ? '21' : quality
    quantities.push(q)
    if (!isNull) observations.push({ sourceOrdinal: k, quantity: unit === 'MWH' ? String(Number(raw) * 1000) : raw })
  }
  if (!foreignFirst && r() < 0.3) foreign()
  push('UNT', [[String(tokens.length + 1)], ['1']])
  if (r() < 0.03) tokens.splice(4, 0, { index: 3.5, tag: 'SEQ', elements: [['SEQ'], [''], ['9']] } as Token)
  return { tokens, item: { transactionId: 'OWN', disposition: 'accepted', unit, quantities, consumptionContract: { observations } } }
}

async function evaluate(db: PGlite, cases: ReturnType<typeof makeCase>[]) {
  const out: boolean[] = []
  for (const c of cases) {
    const { rows } = await db.query<{ v: boolean }>('select gridex_utilts_binding.validate_decimal_source_v2($1::jsonb,$2::jsonb,$3) v', [JSON.stringify(c.tokens), JSON.stringify(c.item), '.'])
    out.push(rows[0].v)
  }
  return out
}
const catalog = async (db: PGlite) => (await db.query<{ m: Record<string, unknown> }>(
  "select to_jsonb(p)-'prosrc'-'oid' m from pg_proc p where oid='gridex_utilts_binding.validate_decimal_source_v2(jsonb,jsonb,text)'::regprocedure")).rows[0].m

describe('G-2 validate_decimal_source_v2 own-transaction scans', () => {
  it('pins the reviewed pre-image and the installed post-image', () => {
    expect(sha(dollarBody(preSource, 'CREATE OR REPLACE FUNCTION gridex_utilts_binding.validate_decimal_source_v2'))).toBe('bb11ba59f76ee781cea7e456e237377bbdfd25802d6781e2277432883376115d')
    const body = /new_body constant text := \$g2body\$([\s\S]*?)\$g2body\$;/.exec(migration)![1]
    expect(sha(body)).toBe('ef375fac0ea02250db91baf4e437bbd3e7a931580710d7cbb814fca13a14d981')
  })

  it('returns identical results before and after the migration on generated E66 inputs', async () => {
    const cases = Array.from({ length: 400 }, (_, i) => makeCase(i + 1))
    const db = await freshDb()
    const before = await evaluate(db, cases)
    const metaBefore = await catalog(db)
    await db.exec(migration)
    const after = await evaluate(db, cases)
    expect(after).toEqual(before)
    expect(await catalog(db)).toEqual(metaBefore)
    // The generator exercises both outcomes, so equality is not vacuous.
    expect(before.filter(Boolean).length).toBeGreaterThan(20)
    expect(before.filter((v) => !v).length).toBeGreaterThan(20)
    await db.close()
  }, 120_000)

  it('refuses to install over any other body', async () => {
    const db = await freshDb()
    await db.exec(`CREATE OR REPLACE FUNCTION gridex_utilts_binding.validate_decimal_source_v2(tokens jsonb,item jsonb,decimal_mark text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$BEGIN RETURN false; END$$;`)
    await expect(db.exec(migration)).rejects.toThrow('g2_decimal_source_pre_image_changed')
    await db.close()
  })
})
