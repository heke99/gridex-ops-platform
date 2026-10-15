// Technical ACK original lookup must not parse the tenant's whole history.
// read_outbound_originals_v1 now evaluates retained_source_v1(m,false) only
// when may_reference_uci_v1 says the CONTRL wire can carry the source's UCI
// reference. That guard may never be false when wire_v1 actually decodes the
// reference (it would drop a genuine original), and it should be false for an
// unrelated plain CONTRL (otherwise nothing is pruned). Generated cases cover
// UNA advice, release characters (also before ordinary letters) and CR/LF
// inside values, which wire_tokens_v1 removes before decoding.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const tokenizer = readFileSync('supabase/migrations/20261015130000_ediel_wire_tokenizer_linear_time.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261015231500_ediel_technical_ack_original_lookup_by_uci.sql', 'utf8')

function definition(name: string, source = schema, create = 'CREATE FUNCTION') {
  const start = source.indexOf(`${create} ${name}(`)
  if (start < 0) throw Error(`Missing actual function ${name}`)
  const match = /\bAS (\$[\w]*\$)/.exec(source.slice(start))
  if (!match) throw Error(`Missing actual function body ${name}`)
  const end = source.indexOf(`${match[1]};`, start + match.index + match[0].length)
  return source.slice(start, end + match[1].length + 1)
}

// Deterministic PRNG so a failure is reproducible from its index.
function prng(seed: number) {
  return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const SEPARATOR_SETS = [
  { una: null, component: ':', data: '+', release: '?', terminator: "'" },
  { una: "UNA:+.? '", component: ':', data: '+', release: '?', terminator: "'" },
  { una: 'UNA#*,! ~', component: '#', data: '*', release: '!', terminator: '~' },
  { una: 'UNA|^.\\ %', component: '|', data: '^', release: '\\', terminator: '%' },
]

/** CONTRL wire whose UCI reference decodes to `ref`, optionally released/split. */
function contrl(random: () => number, ref: string, set: typeof SEPARATOR_SETS[number], options: { release: boolean; breaks: boolean }) {
  const special = [set.component, set.data, set.release, set.terminator]
  let encoded = ''
  for (const ch of ref) {
    if (special.includes(ch) || (options.release && random() < 0.3)) encoded += set.release
    encoded += ch
    if (options.breaks && random() < 0.2) encoded += random() < 0.5 ? '\n' : '\r\n'
  }
  const s = (...elements: string[]) => elements.join(set.data) + set.terminator
  const body = [
    s('UNB', `UNOC${set.component}3`, `70011${set.component}ZZ`, `80010${set.component}ZZ`, `261015${set.component}2348`, 'IC1', '', '23-DDQ-E66-T', '', '', '', '1'),
    s('UNH', '1', ['CONTRL', '2', '2', 'UN', 'EDIEL2'].join(set.component)),
    s('UCI', encoded, `80010${set.component}ZZ`, `70011${set.component}ZZ`, '1'),
    s('UNT', '3', '1'), s('UNZ', '1', 'IC1'),
  ].join(random() < 0.5 ? '\n' : '')
  return (set.una ?? '') + body
}

function reference(random: () => number, alphabet: string, length: number) {
  return Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
}

describe('technical ACK original lookup guard', () => {
  let db: PGlite
  beforeAll(async () => {
    db = new PGlite()
    for (const name of ['gridex_utilts_binding', 'gridex_ack_authority', 'gridex_ediel_technical_ack']) await db.exec(`create schema ${name}`)
    await db.exec(definition('gridex_utilts_binding.wire_tokens_v1'))
    await db.exec(definition('gridex_utilts_binding.wire_tokens_v1', tokenizer, 'CREATE OR REPLACE FUNCTION'))
    await db.exec(definition('gridex_ack_authority.wire_v1'))
    await db.exec(definition('gridex_ediel_technical_ack.may_reference_uci_v1', forward, 'CREATE OR REPLACE FUNCTION'))
  }, 60_000)
  afterAll(async () => { await db.close() })

  async function check(raw: string, ref: string) {
    const { rows } = await db.query<{ decoded: string | null; guard: boolean }>(
      `select gridex_ack_authority.wire_v1($1)->>'uciRef' as decoded, gridex_ediel_technical_ack.may_reference_uci_v1($1,$2) as guard`, [raw, ref])
    return rows[0]
  }

  it('never rejects a CONTRL whose decoded UCI reference is the source reference', async () => {
    const random = prng(20261015)
    let decodedCases = 0
    for (let index = 0; index < 400; index += 1) {
      const set = SEPARATOR_SETS[index % SEPARATOR_SETS.length]
      const alphabet = index % 3 === 0 ? ALNUM + set.component + set.data + set.release + set.terminator + ' ' : ALNUM
      const ref = reference(random, alphabet, 1 + Math.floor(random() * 14))
      const raw = contrl(random, ref, set, { release: index % 2 === 0, breaks: index % 5 < 2 })
      const { decoded, guard } = await check(raw, ref)
      if (decoded === ref) {
        decodedCases += 1
        expect(guard, `case ${index}: ${JSON.stringify(raw)}`).toBe(true)
      }
    }
    expect(decodedCases).toBeGreaterThan(300)
  })

  it('prunes an unrelated plain CONTRL and keeps the full check whenever a release character is present', async () => {
    const random = prng(7)
    for (const set of SEPARATOR_SETS) {
      const plain = contrl(random, '260908015169', set, { release: false, breaks: false })
      expect((await check(plain, '260908015169')).guard).toBe(true)
      expect((await check(plain, '260909015169')).guard).toBe(false)
      // A released ordinary character still decodes to the same reference.
      const released = plain.replace('260908015169', `${set.release}260908015169`)
      expect((await check(released, '260908015169')).decoded).toBe('260908015169')
      expect((await check(released, 'UNRELATED')).guard).toBe(true)
    }
    expect((await check("UNA:+.? 'UNB+X'", null as unknown as string)).guard).toBe(false)
  })
})
