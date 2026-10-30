// CUSTODY01.05: backup/återställning bevarar custody-data. Spår 6, kampanj 20261029-3f1a8ab1. Ingen webbläsare/Playwright.
//   Under hela proceduren pollas appen (/api/internal/system/health) parallellt; inga fel tillåts. Stackens databas pg_dump -Fc:as till SIM_HOME,
//   en NY databas t6_restore_<runid> skapas på samma server, pg_restore körs dit, och per-tabell radantal samt sha256 över ordnat innehåll jämförs
//   (ediel_messages originalkroppar, invoice_export_files inkl. rows_sha256, billing_underlays, gridex_billing_source.*, gridex_received_sources.*, storage.objects-metadata).
//   Återställningsdatabasen droppas sist (städkvitto). Storage-BYTES ingår inte i en databasdump; endast objektmetadata jämförs (se observation).
//   Körs lämpligen efter custody01-01/03/04 (alfabetisk ordning) så att det finns innehåll att jämföra.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHealthPoll } from '../lib/custody/app'
import { custodyDir, mode } from '../lib/custody/base'
import { baseTables, chooseTooling, contentHashes, createDb, dbExists, dropDb, dump, restore, restoreUrl, rowCounts, triggerInventory, type Tooling } from '../lib/custody/restore'
import { dbUrl, newRunContext } from '../lib/seed.mjs'
import { Evidence } from '../lib/evidence'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

const ev = new Evidence()
const run = newRunContext('custody01-05')
const restoreDb = `t6_restore_${run.runId.replace(/[^a-z0-9]/gi, '').toLowerCase()}`
const sourceUrl = dbUrl()
const receipt: Record<string, unknown> = { restoreDb, created: false, dropped: false }

let tooling: Tooling
let tables: string[] = []
let health: ReturnType<typeof startHealthPoll>
let healthResult: Awaited<ReturnType<ReturnType<typeof startHealthPoll>['stop']>> | null = null
let dumped: ReturnType<typeof dump>
let dumpFile = ''
let before: { counts: Record<string, number>; hashes: ReturnType<typeof contentHashes> }
let drift: string[] = []
let restoreResult: ReturnType<typeof restore>

beforeAll(() => { ev.observe('run', { ...run, mode: mode(), restoreDb, sourceDb: new URL(sourceUrl).pathname }) })
afterAll(async () => {
  try {
    if (dbExists(restoreDb)) dropDb(restoreDb)
    receipt.dropped = !dbExists(restoreDb)
  } catch (e) { receipt.dropError = e instanceof Error ? e.message : String(e) }
  if (!healthResult && health) healthResult = await health.stop()
  receipt.finishedAt = new Date().toISOString()
  ev.observe('storage_bytes_note', 'pg_dump täcker storage.objects-metadata, inte objektens bytes i Storage-volymen; bytesåterställning kräver separat storage-backup (docs/backup-restore-checklist.md).')
  ev.observe('cleanup_receipt', receipt)
  writeFileSync(join(custodyDir('receipts'), `${restoreDb}.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 })
  ev.finalize()
}, 300_000)

describe('CUSTODY01.05 backup och återställning under drift', () => {
  it('CUSTODY01.05 förberedelse: verktyg, tabellista och hälso-pollning startar', () => {
    tooling = chooseTooling()
    tables = baseTables(sourceUrl)
    health = startHealthPoll(400)
    ev.observe('tooling', tooling); ev.observe('source_tables', tables.length)
    expect(tables.length).toBeGreaterThan(100)
    expect(tables).toContain('public.ediel_messages')
  })

  it('CUSTODY01.05 pg_dump -Fc av stackens databas utan driftavbrott (källans innehåll är stabilt före/efter dumpen)', () => {
    let lastDrift: string[] = []
    for (let attempt = 1; attempt <= 3; attempt++) {
      const b = { counts: rowCounts(sourceUrl, tables), hashes: contentHashes(sourceUrl, tables) }
      dumpFile = join(custodyDir('backup'), `${restoreDb}-attempt${attempt}.dump`)
      dumped = dump(tooling, dumpFile)
      const a = { counts: rowCounts(sourceUrl, tables), hashes: contentHashes(sourceUrl, tables) }
      lastDrift = tables.filter((t) => b.counts[t] !== a.counts[t]).concat(Object.keys(b.hashes).filter((t) => b.hashes[t].sha256 !== a.hashes[t]?.sha256))
      ev.observe(`dump_attempt_${attempt}`, { ms: dumped.ms, bytes: dumped.bytes, sha256: dumped.sha256, drift: lastDrift })
      before = b
      if (lastDrift.length === 0) break
    }
    drift = [...new Set(lastDrift)]
    expect(dumped.bytes).toBeGreaterThan(10_000)
    // Driftande tabeller (aktiv app skriver) undantas från jämförelsen och listas; custody-tabellerna får inte driva.
    const custodyDrift = drift.filter((t) => /^(public\.ediel_messages|public\.invoice_export_files|public\.billing_underlays|gridex_billing_source\.|gridex_received_sources\.|storage\.objects)/.test(t))
    expect(custodyDrift, 'custody-tabeller ändrades under dumpen; körningen ogiltig').toEqual([])
  }, 900_000)

  it('CUSTODY01.05 pg_restore till NY databas på samma server', () => {
    createDb(restoreDb); receipt.created = true
    restoreResult = restore(tooling, dumpFile, restoreDb)
    ev.save('pg_restore-errors.json', { status: restoreResult.status, errors: restoreResult.errors, tail: restoreResult.stderrTail })
    ev.observe('pg_restore', { ms: restoreResult.ms, status: restoreResult.status, errorLines: restoreResult.errors.length })
    // Datapåverkande fel (COPY/constraint/ogiltigt värde) är aldrig acceptabla; tillägg/roller/extensions utanför databasen kan ge ofarliga fel och loggas.
    const dataErrors = restoreResult.errors.filter((l) => /COPY|violates|invalid input|could not|out of memory|No space/i.test(l))
    expect(dataErrors).toEqual([])
  }, 900_000)

  it('CUSTODY01.05 per tabell: radantal och innehålls-sha256 i återställd databas == källan (originalkroppar, fakturafiler, underlag, gridex_billing_source, storage.objects-metadata)', () => {
    const rUrl = restoreUrl(restoreDb)
    const restoredTables = baseTables(rUrl)
    const missing = tables.filter((t) => !restoredTables.includes(t))
    const counts = rowCounts(rUrl, tables.filter((t) => restoredTables.includes(t)))
    const countDiffs = tables.filter((t) => !drift.includes(t) && counts[t] !== before.counts[t]).map((t) => ({ table: t, source: before.counts[t], restored: counts[t] ?? null }))
    const hashes = contentHashes(rUrl, restoredTables)
    const hashDiffs = Object.keys(before.hashes).filter((t) => !drift.includes(t) && (hashes[t]?.sha256 !== before.hashes[t].sha256 || hashes[t]?.rows !== before.hashes[t].rows))
      .map((t) => ({ table: t, source: before.hashes[t], restored: hashes[t] ?? null }))
    const emptyCustody = Object.entries(before.hashes).filter(([, v]) => v.rows === 0).map(([t]) => t)
    ev.save('compare.json', { missing, countDiffs, hashDiffs, drift, emptyCustodyTables: emptyCustody, compared: { tables: tables.length, hashed: Object.keys(before.hashes).length }, sourceHashes: before.hashes })
    ev.observe('compare', { missing: missing.length, countDiffs: countDiffs.length, hashDiffs: hashDiffs.length, drift, emptyCustodyTables: emptyCustody, ediel_messages: before.hashes['public.ediel_messages'], invoice_export_files: before.hashes['public.invoice_export_files'], storage_objects: before.hashes['storage.objects'] })
    expect(missing, 'tabeller saknas efter återställning').toEqual([])
    expect(countDiffs).toEqual([])
    expect(hashDiffs).toEqual([])
    expect(before.hashes['public.ediel_messages']?.rows ?? 0, 'det finns original att jämföra (kör efter custody01-01/03)').toBeGreaterThan(0)
  }, 900_000)

  it('CUSTODY01.05 skydden överlever: triggerinventeringen (immutability/append-only) är identisk i den återställda databasen', () => {
    const src = triggerInventory(sourceUrl), res = triggerInventory(restoreUrl(restoreDb))
    const missing = src.filter((t) => !res.includes(t))
    ev.observe('triggers', { source: src.length, restored: res.length, missing })
    expect(missing).toEqual([])
    for (const must of ['public.ediel_messages:registered_reception_original_immutable', 'gridex_received_sources.sources:received_sources_no_update_delete']) expect(res, must).toContain(must)
  })

  it('CUSTODY01.05 appen svarade under hela proceduren (hälsopollning utan fel)', async () => {
    healthResult = await health.stop()
    ev.save('health-samples.json', healthResult.samples)
    ev.observe('health', { samples: healthResult.samples.length, failures: healthResult.failures.length, maxMs: healthResult.maxMs, p95Ms: healthResult.p95Ms, statuses: [...new Set(healthResult.samples.map((s) => s.status))] })
    expect(healthResult.samples.length).toBeGreaterThanOrEqual(5)
    expect(healthResult.failures).toEqual([])
  })
})
