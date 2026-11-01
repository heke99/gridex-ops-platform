// SQLite relational component regression only. This is not PostgreSQL/native,
// constraints/RLS, mailbox or business acceptance. No disk database is created.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Node22 provides node:sqlite; the repository's older @types/node does not.
type MemoryDb = { exec: (sql: string) => void; prepare: (sql: string) => { get: () => Record<string, unknown> }; close: () => void }
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: ':memory:') => MemoryDb }
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const companyA = uuid(101), companyB = uuid(102), pointA = uuid(201), pointB = uuid(202)
const lit = (value: string) => "'" + value.replaceAll("'", "''") + "'"

function withCounts(run: (count: () => number, db: MemoryDb) => void) {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`ATTACH DATABASE ':memory:' AS public;
      CREATE TABLE public.ediel_messages (id TEXT PRIMARY KEY, company_id TEXT, direction TEXT, message_family TEXT, metering_point_id TEXT, related_message_id TEXT);
      CREATE TABLE public.ediel_outbox (id TEXT PRIMARY KEY, company_id TEXT, source_message_id TEXT, ediel_message_id TEXT);`)
    const filename = fileURLToPath(new URL('../scripts/simulation/track3/lib/e02-state.ts', import.meta.url))
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    const exports: { e02Counts?: (fixture: unknown, prefix: string) => { outbox: number } } = {}
    const ports = { lit, sql: (query: string) => {
      // Execute the actual emitted outbox query unchanged. All other counters
      // are explicitly ancillary finite-port values, not qualified effects.
      if (!query.includes('FROM public.ediel_outbox')) return '0'
      const row = db.prepare(query).get()
      return String(Object.values(row)[0])
    }, sqlJson: () => { throw new Error('Undeclared ancillary SQL operation') } }
    runInNewContext(code, { exports, require: (name: string) => {
      if (name !== './seed.mjs') throw new Error('Undeclared import: ' + name)
      return ports
    } }, { filename, timeout: 5000 })
    const fixture = { companyId: companyA, pointId: pointA, customerId: uuid(301) }
    run(() => exports.e02Counts!(fixture, 'synthetic-component').outbox, db)
  } finally { db.close() }
}
function source(db: MemoryDb, id: number, company = companyA, point = pointA) {
  db.exec(`INSERT INTO public.ediel_messages VALUES (${lit(uuid(id))},${lit(company)},'inbound','UTILTS',${lit(point)},NULL)`)
}
function response(db: MemoryDb, sourceId: number, ackId: number, outboxId: number, family: 'CONTRL' | 'APERAK', company = companyA) {
  db.exec(`INSERT INTO public.ediel_messages VALUES (${lit(uuid(ackId))},${lit(company)},'outbound',${lit(family)},NULL,${lit(uuid(sourceId))});
    INSERT INTO public.ediel_outbox VALUES (${lit(uuid(outboxId))},${lit(company)},${lit(uuid(sourceId))},${lit(uuid(ackId))})`)
}
function ownPair(db: MemoryDb) {
  source(db, 1); response(db, 1, 2, 4, 'CONTRL'); response(db, 1, 3, 5, 'APERAK')
}

describe('T3 E02 outbox count follows the inbound source foreign key', () => {
  it('counts zero in an empty queue', () => withCounts(count => { expect(count()).toBe(0) }))
  it('changes from zero to two for the own CONTRL and APERAK rows', () => withCounts((count, db) => {
    const before = count(); ownPair(db)
    expect([before, count()]).toEqual([0, 2])
  }))
  it('detects own queue growth from two to three', () => withCounts((count, db) => {
    ownPair(db); const before = count()
    source(db, 6); response(db, 6, 7, 8, 'APERAK')
    expect([before, count()]).toEqual([2, 3])
  }))
  it('excludes unrelated metering points and companies while counting own responses', () => withCounts((count, db) => {
    ownPair(db)
    source(db, 9, companyB, uuid(203)); response(db, 9, 10, 11, 'CONTRL', companyB)
    source(db, 12, companyA, pointB); response(db, 12, 13, 14, 'APERAK')
    expect(count()).toBe(2)
  }))
  it('counts the single APERAK even when no CONTRL exists', () => withCounts((count, db) => {
    const before = count(); source(db, 1); response(db, 1, 3, 5, 'APERAK')
    expect([before, count()]).toEqual([0, 1])
  }))
})
