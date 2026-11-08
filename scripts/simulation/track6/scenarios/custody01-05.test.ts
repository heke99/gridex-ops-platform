// CUSTODY01.05: backup/återställning bevarar custody-data. Spår 6, kampanj 20261029-3f1a8ab1. Ingen webbläsare/Playwright.
//   Under pg_dump OCH pg_restore körs en syntetisk "främmande körning" (lib/custody/foreign.ts) i en separat tenant: loop av autentiserade PostgREST-operationer
//   (INSERT/SELECT/UPDATE på public.customer_operation_tasks med GoTrue-session, produktens egen skrivväg) som committar. Alla iterationer ska lyckas, ingen operation får vänta > 5 s, minst N iterationer
//   ska överlappa vardera fönstret (N loggas) och den främmande tenantens rader ska vara intakta (källan + återställd kopia).
//   Hälsopollen (/api/internal/system/health) är ENDAST information om processens responsivitet: routen svarar 503 före all DB-åtkomst (route.ts:41-43), så 503 är avsiktligt.
//   Stackens databas pg_dump -Fc:as till SIM_HOME,
//   en NY databas t6_restore_<runid> skapas på samma server, pg_restore körs dit, och per-tabell radantal samt sha256 över ordnat innehåll jämförs
//   (ediel_messages originalkroppar, invoice_export_files inkl. rows_sha256, billing_underlays, gridex_billing_source.*, gridex_received_sources.*, storage.objects-metadata).
//   Återställningsdatabasen droppas sist (städkvitto). Storage-BYTES ingår inte i en databasdump; endast objektmetadata jämförs (se observation).
//   Körs lämpligen efter custody01-01/03/04 (alfabetisk ordning) så att det finns innehåll att jämföra.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHealthPoll } from '../lib/custody/app'
import { maxOpMs, overlaps, startForeignRun, type ForeignIteration } from '../lib/custody/foreign'
import { createTenantUser } from '../lib/custody/postgrest'
import { custodyDir, mode } from '../lib/custody/base'
import { protectionsInventory, consistencyBlocks, runBlock, psqlRows, baseTables, chooseTooling, contentHashes, createDb, dbExists, dropDb, dump, platformOnly, restore, restoreUrl, rowCounts, type Tooling } from '../lib/custody/restore'
import { dbUrl, lit, newRunContext, sql } from '../lib/seed.mjs'
import { Evidence } from '../lib/evidence'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

const ev = new Evidence()
const run = newRunContext('custody01-05')
const restoreDb = `t6_restore_${run.runId.replace(/[^a-z0-9]/gi, '').toLowerCase()}`
const sourceUrl = dbUrl()
const receipt: Record<string, unknown> = { restoreDb, created: false, dropped: false }
let createdDb: ReturnType<typeof createDb> | undefined

let tooling: Tooling
let tables: string[] = []
let health: ReturnType<typeof startHealthPoll>
let healthResult: Awaited<ReturnType<ReturnType<typeof startHealthPoll>['stop']>> | null = null
let dumped: ReturnType<typeof dump>
let dumpFile = ''
let before: { counts: Record<string, number>; hashes: ReturnType<typeof contentHashes> }
let drift: string[] = []
let afterCounts: Record<string, number> = {}
const isCustody = (t: string) => /^(public\.ediel_messages|public\.invoice_export_files|public\.billing_underlays|gridex_billing_source\.|gridex_received_sources\.|storage\.objects)/.test(t)
let restoreResult: ReturnType<typeof restore>
let foreign: ReturnType<typeof startForeignRun> | null = null
let foreignCompany = ''
let foreignTag = ''
const windows: { dump?: { start: number; end: number }; restore?: { start: number; end: number } } = {}
const LOCK_WAIT_BOUND_MS = 5000
const MIN_OVERLAP = { dump: 3, restore: 5 }

beforeAll(() => {
  // A failed setup must block all later fixture writers, even under another Vitest config.
  tooling = chooseTooling()
  ev.observe('run', { ...run, mode: mode(), restoreDb, sourceDb: new URL(sourceUrl).pathname })
})
afterAll(async () => {
  const failures: Array<{ step: string; kind: string }> = []
  const attempt = async (step: string, action: () => unknown) => {
    try { await action() } catch (error) {
      failures.push({ step, kind: error instanceof Error ? error.name : 'UnknownError' })
    }
  }
  await attempt('database', () => {
    if (!createdDb) {
      receipt.databaseCleanup = 'not_created_or_unqualified'
      if (receipt.creationAttempted) throw new Error('restore_database_creation_unqualified')
      return
    }
    dropDb(restoreDb, createdDb, run.runId)
    receipt.dropped = !dbExists(restoreDb)
    if (!receipt.dropped) throw new Error('restore_database_cleanup_unconfirmed')
  })
  await attempt('foreign_stop', async () => { if (foreign) await foreign.stop(); foreign = null })
  await attempt('health_stop', async () => { if (!healthResult && health) healthResult = await health.stop() })
  receipt.finishedAt = new Date().toISOString()
  receipt.cleanupFailures = failures
  await attempt('storage_note', () => ev.observe('storage_bytes_note', 'pg_dump täcker storage.objects-metadata, inte objektens bytes i Storage-volymen; bytesåterställning kräver separat storage-backup (docs/backup-restore-checklist.md).'))
  await attempt('receipt_observation', () => ev.observe('cleanup_receipt', receipt))
  await attempt('evidence_finalize', () => ev.finalize())
  await attempt('receipt_write', () => writeFileSync(join(custodyDir('receipts'), `${restoreDb}.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 }))
  if (failures.length) throw new AggregateError(failures.map(f => new Error(`T6_cleanup_${f.step}_failed`)), 'T6 cleanup failed: ' + failures.map(f => f.step).join(', '))
}, 300_000)

describe('CUSTODY01.05 backup och återställning under drift', () => {
  it('CUSTODY01.05 förberedelse: verktyg, tabellista och hälso-pollning startar', () => {
    tables = baseTables(sourceUrl)
    health = startHealthPoll(400)
    ev.observe('tooling', tooling); ev.observe('source_tables', tables.length)
    expect(tables.length).toBeGreaterThan(100)
    expect(tables).toContain('public.ediel_messages')
  })

  it('CUSTODY01.05 främmande körning startas i separat tenant (egen tenant + GoTrue-session; första iterationerna lyckas före dumpen)', async () => {
    foreignTag = `fr${run.runId.replace(/[^a-z0-9]/gi, '').toLowerCase()}`
    const name = `T6SIM Custody05 Foreign AB ${foreignTag}`
    foreignCompany = sql(`INSERT INTO public.companies(name,status,default_environment) VALUES(${lit(name)},'active','test') RETURNING id`).split('\n')[0]
    // Fixtur (SQL): en kund i den främmande tenanten som uppgifterna refererar till (kundskapande går annars via serverkod).
    const foreignCustomer = sql(`INSERT INTO public.customers(company_id,name,customer_number) VALUES(${lit(foreignCompany)},'T6SIM foreign customer','${foreignTag}') RETURNING id`).split('\n')[0]
    const user = await createTenantUser(foreignCompany, ['customers.read', 'customers.write', 'operations.read', 'operations.write'], 'company_admin')
    foreign = startForeignRun({ companyId: foreignCompany, customerId: foreignCustomer, accessToken: user.accessToken, tag: foreignTag, intervalMs: 100 })
    const first = await foreign.waitForFirst(3)
    ev.observe('foreign_run', { company: foreignCompany, tag: foreignTag, user: user.id, preflightIterations: first.length, preflightOk: first.filter((x) => x.ok).length, firstError: first.find((x) => !x.ok)?.error ?? null })
    expect(first.length, 'främmande körning kom igång').toBeGreaterThanOrEqual(3)
    expect(first.filter((x) => !x.ok).map((x) => x.error)).toEqual([])
  }, 120_000)

  it('CUSTODY01.05 pg_dump -Fc av stackens databas utan driftavbrott (källans innehåll är stabilt före/efter dumpen)', () => {
    let lastDrift: string[] = []
    for (let attempt = 1; attempt <= 3; attempt++) {
      const b = { counts: rowCounts(sourceUrl, tables), hashes: contentHashes(sourceUrl, tables) }
      dumpFile = join(custodyDir('backup'), `${restoreDb}-attempt${attempt}.dump`)
      const w0 = Date.now()
      dumped = dump(tooling, dumpFile)
      windows.dump = { start: w0, end: Date.now() }
      const a = { counts: rowCounts(sourceUrl, tables), hashes: contentHashes(sourceUrl, tables) }
      lastDrift = tables.filter((t) => b.counts[t] !== a.counts[t]).concat(Object.keys(b.hashes).filter((t) => b.hashes[t].sha256 !== a.hashes[t]?.sha256))
      ev.observe(`dump_attempt_${attempt}`, { ms: dumped.ms, bytes: dumped.bytes, sha256: dumped.sha256, drift: lastDrift })
      before = b
      afterCounts = a.counts
      // Främmande skrivningar gör att icke-custody-tabeller driver; omförsök bara om en custody-tabell drev.
      if (!lastDrift.some(isCustody)) break
    }
    drift = [...new Set(lastDrift)]
    expect(dumped.bytes).toBeGreaterThan(10_000)
    // Driftande tabeller (aktiv app skriver) undantas från jämförelsen och listas; custody-tabellerna får inte driva.
    const custodyDrift = drift.filter(isCustody)
    expect(custodyDrift, 'custody-tabeller ändrades under dumpen; körningen ogiltig').toEqual([])
  }, 900_000)

  it('CUSTODY01.05 pg_restore till NY databas på samma server', () => {
    receipt.creationAttempted = true
    createdDb = createDb(restoreDb, run.runId)
    receipt.created = true; receipt.creation = createdDb
    const r0 = Date.now()
    try {
      restoreResult = restore(tooling, dumpFile, restoreDb, createdDb, run.runId)
    } catch (error) {
      const failure = error && typeof error === 'object' && 'restoreFailure' in error ? error.restoreFailure : { reason: 'backend_or_target_refused' }
      ev.save('pg_restore-failure.json', failure)
      ev.observe('pg_restore_failure', failure)
      throw error
    }
    windows.restore = { start: r0, end: Date.now() }
    ev.save('pg_restore-errors.json', { status: restoreResult.status, errors: restoreResult.errors, tail: restoreResult.stderrTail })
    ev.observe('pg_restore', { ms: restoreResult.ms, status: restoreResult.status, errorLines: restoreResult.errors.length })
    expect([0, 1]).toContain(restoreResult.status)
    // Datapåverkande fel (COPY/constraint/ogiltigt värde) är aldrig acceptabla; tillägg/roller/extensions utanför databasen kan ge ofarliga fel och loggas.
    // Endast plattformsägda objekt (postgres saknar rätt att återskapa dem) accepteras; allt annat fel är underkänt. Se restore.ts för avvikelsen mot checklistan.
    const unexpected = restoreResult.blocks.filter((b) => !platformOnly(b))
    ev.observe('pg_restore_platform_only', restoreResult.blocks.filter(platformOnly))
    expect(unexpected).toEqual([])
  }, 900_000)

  it('CUSTODY01.05 främmande körning: alla iterationer lyckades, ingen väntan > 5 s, överlapp med dump- och restorefönstren, egna rader intakta (källa + återställd kopia)', async () => {
    const iters: ForeignIteration[] = await foreign!.stop(); foreign = null
    const lat = iters.flatMap((x) => [x.insertMs, x.selectMs, x.updateMs]).sort((a, b) => a - b)
    const nDump = iters.filter((x) => x.ok && overlaps(x, windows.dump!)).length
    const nRestore = iters.filter((x) => x.ok && overlaps(x, windows.restore!)).length
    ev.save('foreign-iterations.json', iters)
    ev.observe('foreign_summary', {
      iterations: iters.length, ok: iters.filter((x) => x.ok).length, failed: iters.filter((x) => !x.ok).length,
      maxOpMs: lat.at(-1) ?? 0, p95OpMs: lat[Math.floor(lat.length * 0.95)] ?? 0, lockWaitBoundMs: LOCK_WAIT_BOUND_MS,
      dumpWindowMs: windows.dump!.end - windows.dump!.start, restoreWindowMs: windows.restore!.end - windows.restore!.start,
      overlapDump: nDump, overlapRestore: nRestore, requiredN: MIN_OVERLAP,
    })
    expect(iters.filter((x) => !x.ok).map((x) => ({ i: x.i, error: x.error, statuses: x.statuses }))).toEqual([])
    expect(iters.filter((x) => maxOpMs(x) > LOCK_WAIT_BOUND_MS).map((x) => ({ i: x.i, ms: maxOpMs(x) })), 'operation väntade längre än gränsen').toEqual([])
    expect(nDump, 'iterationer som överlappar pg_dump').toBeGreaterThanOrEqual(MIN_OVERLAP.dump)
    expect(nRestore, 'iterationer som överlappar pg_restore').toBeGreaterThanOrEqual(MIN_OVERLAP.restore)
    // Egna rader intakta i källan: en rad per lyckad iteration, alla uppdaterade (':u').
    const srcCount = psqlRows(sourceUrl, `SELECT count(*) FROM public.customer_operation_tasks WHERE company_id=${lit(foreignCompany)} AND title LIKE ${lit(foreignTag + '-%:u')};`)[0][0]
    const srcOther = psqlRows(sourceUrl, `SELECT count(*) FROM public.customer_operation_tasks WHERE company_id=${lit(foreignCompany)} AND title NOT LIKE ${lit('%:u')};`)[0][0]
    expect(Number(srcCount)).toBe(iters.length)
    expect(Number(srcOther)).toBe(0)
    // Rader som var färdiga innan den återställda dumpen startade ska vara identiska i den återställda databasen.
    const done = iters.filter((x) => x.t1 < windows.dump!.start && x.id).map((x) => x.id as string)
    const q = `SELECT id, title, status, company_id FROM public.customer_operation_tasks WHERE id IN (${done.map(lit).join(',')}) ORDER BY id;`
    const a = psqlRows(sourceUrl, q), b = psqlRows(restoreUrl(restoreDb), q)
    ev.observe('foreign_rows_in_restored', { checked: done.length, source: a.length, restored: b.length })
    expect(done.length).toBeGreaterThan(0)
    expect(b).toEqual(a)
    expect(b).toHaveLength(done.length)
  }, 120_000)

  it('CUSTODY01.05 per tabell: radantal och innehålls-sha256 i återställd databas == källan (originalkroppar, fakturafiler, underlag, gridex_billing_source, storage.objects-metadata)', () => {
    const rUrl = restoreUrl(restoreDb)
    const restoredTables = baseTables(rUrl)
    const missing = tables.filter((t) => !restoredTables.includes(t))
    const counts = rowCounts(rUrl, tables.filter((t) => restoredTables.includes(t)))
    const countDiffs = tables.filter((t) => !drift.includes(t) && counts[t] !== before.counts[t]).map((t) => ({ table: t, source: before.counts[t], restored: counts[t] ?? null }))
    const hashes = contentHashes(rUrl, restoredTables)
    const hashDiffs = Object.keys(before.hashes).filter((t) => !drift.includes(t) && (hashes[t]?.sha256 !== before.hashes[t].sha256 || hashes[t]?.rows !== before.hashes[t].rows))
      .map((t) => ({ table: t, source: before.hashes[t], restored: hashes[t] ?? null }))
    // Jämförelsen gäller den återställda DUMPENS ögonblicksbild, inte källan efter dumpen. Tabeller som drev under dumpen (föreg. räkning != efterföljande) undantas från exakt
    // radantal/hash-jämförelse och får i stället en gränskontroll: före <= återställt <= efter (tabellerna är insert-only under körningen).
    const driftBounds = drift.map((t) => ({ table: t, before: before.counts[t] ?? null, restored: counts[t] ?? null, after: afterCounts[t] ?? null }))
    const boundViolations = driftBounds.filter((d) => d.restored === null || (d.before !== null && d.restored < d.before) || (d.after !== null && d.restored > d.after))
    ev.observe('drift_handling', {
      excludedFromExactCompare: drift, bounds: driftBounds,
      explanation: 'gridex_correction_process.facts är ett trigger-matat journalbord (gridex_correction_process.capture_v1 på 24 spårade tabeller, bl.a. customer_operation_tasks); varje INSERT/UPDATE i den främmande körningen skapar en facts-rad. Driften är alltså den främmande körningens följd, inte ett bakgrundsjobb.',
      scope: 'compare = den återställda dumpens snapshot; källan efter dumpen har fler rader i driftande tabeller (främmande körningen pågick även under restore).',
    })
    const emptyCustody = Object.entries(before.hashes).filter(([, v]) => v.rows === 0).map(([t]) => t)
    ev.save('compare.json', { missing, countDiffs, hashDiffs, drift, emptyCustodyTables: emptyCustody, compared: { tables: tables.length, hashed: Object.keys(before.hashes).length }, sourceHashes: before.hashes })
    ev.observe('empty_custody_tables_count', { computed: emptyCustody.length, note: 'beräknas per körning (rows=0 i custody-tabellerna). 39 -> 37 -> 36 i körningarna 161811, 162702, 164432: tidigare tomma tabeller fylls av övriga scenarier (senast gridex_received_sources.utilts_header_validations), inte av restore' })
    ev.observe('compare', { missing: missing.length, countDiffs: countDiffs.length, hashDiffs: hashDiffs.length, drift, emptyCustodyTables: emptyCustody, ediel_messages: before.hashes['public.ediel_messages'], invoice_export_files: before.hashes['public.invoice_export_files'], storage_objects: before.hashes['storage.objects'] })
    expect(missing, 'tabeller saknas efter återställning').toEqual([])
    expect(countDiffs).toEqual([])
    expect(hashDiffs).toEqual([])
    expect(boundViolations, 'driftande tabeller utanför före/efter-gränserna').toEqual([])
    expect(before.hashes['public.ediel_messages']?.rows ?? 0, 'det finns original att jämföra (kör efter custody01-01/03)').toBeGreaterThan(0)
  }, 900_000)

  it('CUSTODY01.05 checklistans steg 3: production_consistency_checks.sql, varje block separat, identiskt resultat i källa och återställd databas', () => {
    const blocks = consistencyBlocks()
    ev.observe('consistency_blocks_found', blocks.map((b) => ({ n: b.n, title: b.title })))
    expect(blocks.length, 'filen har 10 numrerade block').toBe(10)
    const rUrl = restoreUrl(restoreDb)
    const rows: Array<{ n: number; title: string; source: number; restored: number }> = []
    const diffs: Array<{ n: number; onlySource: string[]; onlyRestored: string[] }> = []
    for (const b of blocks) {
      const src = runBlock(sourceUrl, b.sql), res = runBlock(rUrl, b.sql)
      rows.push({ n: b.n, title: b.title, source: src.length, restored: res.length })
      if (JSON.stringify(src) !== JSON.stringify(res)) diffs.push({ n: b.n, onlySource: src.filter((x) => !res.includes(x)).slice(0, 5), onlyRestored: res.filter((x) => !src.includes(x)).slice(0, 5) })
    }
    ev.observe('consistency_rows_per_block', rows)
    ev.save('consistency-checks.json', { rows, diffs, note: 'rader sorterade textuellt (blocken saknar ORDER BY och har limit 100); källan jämförs efter dumpen, de berörda tabellerna skrivs inte av den främmande körningen' })
    expect(rows.filter(r => r.source !== 0 || r.restored !== 0), 'every non-zero consistency check must be resolved; matching violations are not healthy').toEqual([])
    expect(diffs).toEqual([])
  }, 600_000)

  it('CUSTODY01.05 skydd överlever återställning med ägare/ACL: policies, ACL+ägare, SECURITY DEFINER+search_path, RLS-flaggor och triggers är identiska (sorterade) i källa och återställd databas', () => {
    const src = protectionsInventory(sourceUrl), res = protectionsInventory(restoreUrl(restoreDb))
    const counts: Record<string, { source: number; restored: number }> = {}
    const diffs: Record<string, { onlySource: string[]; onlyRestored: string[] }> = {}
    const diffOf = (k: string) => ({ onlySource: src[k].filter((x) => !(res[k] ?? []).includes(x)), onlyRestored: (res[k] ?? []).filter((x) => !src[k].includes(x)) })
    for (const k of Object.keys(src).filter((x) => !x.startsWith('raw_'))) {
      counts[k] = { source: src[k].length, restored: res[k]?.length ?? 0 }
      if (JSON.stringify(src[k]) !== JSON.stringify(res[k] ?? [])) diffs[k] = { onlySource: diffOf(k).onlySource.slice(0, 8), onlyRestored: diffOf(k).onlyRestored.slice(0, 8) }
    }
    // ACL jämförs som EFFEKTIVA privilegier (coalesce(acl, acldefault)); rå ACL-text avviker ofarligt när källan har explicit ägar-default och den återställda NULL.
    // Allt som skiljer i rå text men är lika effektivt listas här (inget döljs).
    const effOf: Record<string, string> = { raw_relation_acl: 'relation_acl_owner', raw_schema_acl: 'schema_acl_owner', raw_function_acl: 'function_owner_acl_secdef_config' }
    const rawOnly: Record<string, string[]> = {}
    for (const [raw, eff] of Object.entries(effOf)) {
      const d = diffOf(raw), names = new Set([...d.onlySource, ...d.onlyRestored].map((x) => x.split('|')[0]))
      const effDiff = new Set([...(diffs[eff]?.onlySource ?? []), ...(diffs[eff]?.onlyRestored ?? [])].map((x) => x.split('|')[0]))
      rawOnly[raw] = [...names].filter((n) => !effDiff.has(n))
    }
    ev.observe('acl_raw_text_differs_effective_same', {
      count: Object.values(rawOnly).reduce((n, l) => n + l.length, 0), objects: rawOnly,
      explanation: 'pg_dump emitterar ingen GRANT för en ACL som är lika med ägarens default (acldefault), så källan kan ha explicit {owner=arwdDxtm/owner} medan den återställda databasen har NULL; effektiva privilegier (aclexplode(coalesce(acl, acldefault(typ, ägare)))) är identiska.',
    })
    ev.observe('protections_counts', counts)
    ev.save('protections-diffs.json', { counts, diffs })
    expect(diffs).toEqual({})
    for (const k of ['policies', 'rls_flags', 'relation_acl_owner', 'function_owner_acl_secdef_config', 'triggers']) expect(src[k].length, `${k}: inventeringen är inte tom`).toBeGreaterThan(0)
    const res_tr = res.triggers
    for (const must of ['public.ediel_messages:registered_reception_original_immutable', 'gridex_received_sources.sources:no_evidence_update_delete', 'gridex_received_sources.snapshots:no_evidence_update_delete', 'gridex_billing_source.correction_journal:immutable_update_delete']) expect(res_tr, must).toContain(must)
  }, 300_000)

  it('CUSTODY01.05 (information) hälsopoll: processen svarade under proceduren; 503 är avsiktligt och säger inget om databasen', async () => {
    healthResult = await health.stop()
    ev.save('health-samples.json', healthResult.samples)
    ev.observe('health_informational', { samples: healthResult.samples.length, failures: healthResult.failures.length, maxMs: healthResult.maxMs, p95Ms: healthResult.p95Ms, statuses: [...new Set(healthResult.samples.map((x) => x.status))], note: 'Routen svarar 503 före all DB-åtkomst (app/api/internal/system/health/route.ts:41-43); enbart processens responsivitet, inte DB-hälsa. Beviset för orörda främmande körningar är foreign_summary.' })
    expect(healthResult.samples.length).toBeGreaterThanOrEqual(1)
  })
})
