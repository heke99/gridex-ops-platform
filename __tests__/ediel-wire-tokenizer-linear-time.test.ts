// Received EDIFACT lexers must stay linear in the number of segments. A month
// of quarter-hour UTILTS E66 (~12,000 segments) took ~96 s per call when each
// segment copied the whole growing jsonb result; the forward migration keeps
// every result identical and only changes the accumulation.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { energyHandoffMessage, observationHandoffMessage } from './helpers/utiltsObservationHandoff'
import { ownerSource } from './helpers/sourceOwnerFixtures'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261015130000_ediel_wire_tokenizer_linear_time.sql', 'utf8')

function definition(name: string, source = schema) {
  const start = source.indexOf(`CREATE FUNCTION ${name}(`)
  if (start < 0) throw Error(`Missing actual function ${name}`)
  const match = /\bAS (\$[\w]*\$)/.exec(source.slice(start))
  if (!match) throw Error(`Missing actual function body ${name}`)
  const end = source.indexOf(`${match[1]};`, start + match.index + match[0].length)
  return source.slice(start, end + match[1].length + 1)
}

const LEXERS = ['gridex_utilts_binding.wire_tokens_v1', 'gridex_received_sources.wire_tokens_bounded_v1',
  'gridex_prodat_object_batch.raw_segments_v1', 'gridex_ediel_technical_ack.envelope'] as const

async function database(currentDefinitions: boolean) {
  const db = new PGlite()
  for (const name of ['gridex_utilts_binding', 'gridex_received_sources', 'gridex_prodat_object_batch', 'gridex_ediel_technical_ack']) await db.exec(`create schema ${name}`)
  for (const name of LEXERS) await db.exec(definition(name))
  await db.exec(definition('gridex_received_sources.closure_wire_tokens_v2'))
  if (currentDefinitions) await db.exec(forward)
  return db
}

/** Month of energy-only UTILTS E66 observations, one SEQ group per interval. */
function monthlyE66(observations: number) {
  const segments = ["UNA:+.? '", "UNB+UNOC:3+91100:ZZ+21660:ZZ+260831:1811+R1++23-DDQ-E66-T++1'", "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    "BGM+E66::260+M1+9+AB'", "IDE+24+T1'", "LOC+172+735999260731000007::9'", "DTM+354:15:806'"]
  for (let index = 1; index <= observations; index += 1) segments.push(`SEQ++${index}'`, `QTY+136:0.${index % 1000}'`, "DTM+597:202607010000:203'", "STS+7++21::260'")
  segments.push(`UNT+${segments.length - 1}+1'`, "UNZ+1+R1'")
  return segments.join('\n')
}

const call = (name: string) => name.endsWith('bounded_v1') ? `${name}($1,999999)` : `${name}($1)`
async function run(db: PGlite, name: string, raw: string | null) {
  const result = await db.query<{ value: unknown }>(`select ${call(name)} as value`, [raw])
  return result.rows[0].value
}

describe('received EDIFACT lexers', () => {
  let before: PGlite, after: PGlite
  beforeAll(async () => { [before, after] = await Promise.all([database(false), database(true)]) }, 60_000)
  afterAll(async () => { await Promise.all([before.close(), after.close()]) })

  const inputs: Array<[string, string | null]> = [
    ['null', null], ['empty', ''], ['no terminator', 'UNB+X'], ['trailing data', "UNA:+.? 'UNB+1'abc"],
    ['released separator', "UNB+a?+b'UNH+1'"], ['empty segment', "UNA:+.? ''UNB+1'"], ['two headers', "UNB+1'UNB+2'"],
    ['owner PRODAT source', ownerSource().raw_payload!], ['monthly E66', observationHandoffMessage().raw_payload!],
    ['quarter E66', energyHandoffMessage().raw_payload!], ['generated 0', monthlyE66(0)], ['generated 96', monthlyE66(96)],
    ['generated 1100 (over bounded segment cap)', monthlyE66(1100)],
  ]

  it.each(LEXERS)('%s returns exactly the previous result for every input', async name => {
    for (const [label, raw] of inputs) {
      expect(await run(after, name, raw), `${name}: ${label}`).toEqual(await run(before, name, raw))
    }
  }, 120_000)

  it('lexes a month of quarter-hour observations in bounded time', async () => {
    const raw = monthlyE66(2976)
    const started = performance.now()
    const tokens = await run(after, 'gridex_utilts_binding.wire_tokens_v1', raw) as Array<{ tag: string }>
    const envelope = await run(after, 'gridex_ediel_technical_ack.envelope', raw) as Record<string, unknown>
    const elapsed = performance.now() - started
    expect(tokens).toHaveLength(6 + 4 * 2976 + 2)
    expect(tokens.filter(token => token.tag === 'QTY')).toHaveLength(2976)
    expect(envelope).toMatchObject({ interchangeReference: 'R1' })
    // The quadratic predecessor needed ~96 s for the tokenizer alone.
    expect(elapsed).toBeLessThan(20_000)
  }, 60_000)

  it('lexes the bounded segment maximum in bounded time', async () => {
    const raw = monthlyE66(1000)
    const started = performance.now()
    const bounded = await run(after, 'gridex_received_sources.wire_tokens_bounded_v1', raw) as unknown[]
    const segments = await run(after, 'gridex_prodat_object_batch.raw_segments_v1', raw) as unknown[]
    expect(bounded).toHaveLength(4008)
    expect(segments).toHaveLength(4008)
    // The quadratic predecessor needed ~9 s for each of these at this size.
    expect(performance.now() - started).toBeLessThan(10_000)
  }, 60_000)
})
