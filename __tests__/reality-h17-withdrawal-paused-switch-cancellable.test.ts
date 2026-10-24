// reality-defects: H-17
// H-17 (reality H run 5): the withdrawal pauses the sent switch for cancellation (cancellation_requested,
// lifecycle_blocked), and gridex_switch_cancellations.context_v1 refused every lifecycle_blocked switch, so the Z03C
// the withdrawal asked for was always held. Migration 20261024170000 lets exactly that block through. These tests pin
// the reviewed pre-image (supabase/schema.sql), check that the migration changes only the block clause, and evaluate
// the old and new clause in embedded PostgreSQL over every block state.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const migration = read('supabase/migrations/20261024170000_h17_withdrawal_paused_switch_stays_cancellable.sql')
const quoted = (tag: string) => new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(migration)![1]

function preImage() {
  const schema = read('supabase/schema.sql')
  const start = schema.indexOf('CREATE FUNCTION gridex_switch_cancellations.context_v1(')
  return /AS (\$[^$]*\$)([\s\S]*?)\1;/.exec(schema.slice(start))![2]
}

// The refusal clause before and after, as one boolean over the switch row (true = refused for its block).
const OLD_CLAUSE = 's.lifecycle_blocked IS TRUE'
const NEW_CLAUSE = /\n {2}OR (\(s\.lifecycle_blocked IS TRUE AND [^\n]*)\n/.exec(quoted('new'))![1]

describe('H-17 the block that requested a cancellation does not refuse it', () => {
  it('pins the pre-image and changes only the block clause', () => {
    const body = preImage()
    expect(sha(body)).toBe('600e83702ed4695229aeaa133b258867d9736ac1939b8196e7d2e56ca145aa4e')
    expect(body.split(quoted('old')).length).toBe(2)
    const after = body.replace(quoted('old'), quoted('new'))
    // Removing the H-17 lines from the new body gives back the pre-image without its old block clause.
    expect(after.replace(quoted('new'), '')).toBe(body.replace(quoted('old'), ''))
    expect(quoted('old')).toContain(OLD_CLAUSE)
  })

  it('refuses every block except a withdrawal or cancel decision that requested the cancellation', async () => {
    const db = new PGlite()
    await db.exec(`create table s(lifecycle_blocked boolean, status text, lifecycle_block_source text)`)
    const states: Array<[boolean | null, string, string | null]> = []
    for (const blocked of [true, false, null]) for (const status of ['prepared', 'cancellation_requested', 'manual_followup_required', 'cancelled_before_start'])
      for (const source of ['customer_case', 'customer_lifecycle_decision', 'technical_blocker', null]) states.push([blocked, status, source])
    for (const row of states) await db.query('insert into s values($1,$2,$3)', row)
    const { rows } = await db.query<{ blocked: boolean | null; status: string; source: string | null; old: boolean; new: boolean }>(
      `select lifecycle_blocked blocked, status, lifecycle_block_source source, coalesce(${OLD_CLAUSE},false) old, coalesce(${NEW_CLAUSE},false) new from s`)
    for (const r of rows) {
      const requested = r.blocked === true && r.status === 'cancellation_requested' && ['customer_case', 'customer_lifecycle_decision'].includes(String(r.source))
      expect(r.new, JSON.stringify(r)).toBe(requested ? false : r.old)
    }
    expect(rows.filter(r => r.old !== r.new)).toHaveLength(2)
    await db.close()
  })

  it('refuses to install over any other body', () => {
    expect(migration).toContain("raise exception 'h17_switch_cancellation_context_pre_image_changed'")
    expect(migration).toContain("'600e83702ed4695229aeaa133b258867d9736ac1939b8196e7d2e56ca145aa4e'")
  })
})
