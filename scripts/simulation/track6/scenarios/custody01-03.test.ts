// CUSTODY01.03 (negativt): låsta/registrerade original kan inte raderas eller ändras av någon roll; bytes och rad oförändrade efter varje försök.
// Spår 6, kampanj 20261029-3f1a8ab1. Ingen webbläsare/Playwright.
//   Skapande: ett inkommande E66 via normala kedjan (IMAP -> HTTP inbound-cron -> [ERSÄTTNINGSSTEG: motor med aktör] -> createInboundEdielMessage
//   -> ediel_record_inbound_reception_v1). Låst = rad i gridex_ediel_inbound_receptions.receptions (trigger registered_reception_original_immutable).
//   (a) authenticated via PostgREST, (b) service_role via PostgREST, (c) direkt SQL som postgres (alla med efterkontroll av rad + sha256 av kroppen).
//   Append-only: gridex_received_sources.*, gridex_billing_source.underlay_bindings/correction_journal, billing_underlays (om rader finns; annars skipped med skäl).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { triggerInbound } from '../lib/custody/app'
import { appendToInbox, purgeInbox } from '../lib/counterparty'
import { lit, resetMailboxSchedule } from '../lib/db'
import { mode, messageFingerprint, sha256, sqlIn, sqlTry, type MessageFingerprint } from '../lib/custody/base'
import { buildRoutableE66 } from '../lib/custody/e66'
import { mailRows, runIntakeWithActor, sourceRows } from '../lib/custody/intake'
import { createTenantUser, rest } from '../lib/custody/postgrest'
import { seedRoutableChain, seedSupplierTenant, type SupplierTenant } from '../lib/custody/tenant'
import { Evidence } from '../lib/evidence'
import { buildEdifactMime } from '../lib/mime'
import { newRunContext } from '../lib/seed.mjs'

const ev = new Evidence()
const run = newRunContext('custody01-03')
// Kända skydd (fil:rad i supabase/migrations/):
//  * ediel_registered_reception_original_immutable, SQLSTATE P0001 (RAISE utan errcode): 20261001000459_ediel_immutable_inbound_reception_response_requests.sql:39-49 (guard_original_v1, trigger rad 49).
//  * immutable_ediel_payload_cannot_change, SQLSTATE 23514: 20260713100000_ediel_completion_and_platform_contract.sql:698-699; 20260921171346_ediel_inbound_prodat_source_seal.sql:34-35;
//    20260921224255_ediel_inbound_prodat_receive_context.sql:18-19,61-62; 20261005043923_ediel_unattributed_technical_intake.sql:443,492 (BEFORE UPDATE-trigger på raw_payload/immutable_payload_hash; skjuter före reception-guarden vid UPDATE).
//  * received_source_evidence_is_append_only, 23514: 20260922095911_ediel_received_source_ledger.sql:62-67 (reject_mutation; triggers rad 69-80, 20260930175405_*.sql:195-197 för bindings/journal).
//  * received_original_immutable_without_native_retention, P0001: 20261001000700_ediel_message_content_and_mime_retention.sql:72-75 (source_guard_v1 ersatte reject_mutation som no_evidence_update_delete på gridex_received_sources.sources).
const CODE = 'ediel_registered_reception_original_immutable'
const PAYLOAD_GUARD = 'immutable_ediel_payload_cannot_change'
const APPEND_ONLY = 'received_source_evidence_is_append_only'
const SOURCES_GUARD = 'received_original_immutable_without_native_retention'
const ORIGINAL_GUARDS = [CODE, PAYLOAD_GUARD]
const TENANT = { name: 'T6SIM Custody03 Supplier AB', edielId: '16763' }

let tenant: SupplierTenant
let sourceId = ''
let baseline: MessageFingerprint
let builtBodySha = ''
const attempts: Record<string, unknown> = {}

const unchanged = (label: string) => {
  const now = messageFingerprint(sourceId)
  expect(now, `${label}: raden finns kvar`).not.toBeNull()
  expect(now!.rowSha256, `${label}: hela raden oförändrad`).toBe(baseline.rowSha256)
  expect(now!.bodySha256, `${label}: kroppens sha256 oförändrad`).toBe(baseline.bodySha256)
  expect(now!.bodyBytes, `${label}: kroppens bytes oförändrade`).toBe(baseline.bodyBytes)
}

beforeAll(() => { ev.observe('run', { ...run, mode: mode(), tenant: TENANT }) })
afterAll(() => { ev.observe('attempts', attempts); ev.finalize() })

describe('CUSTODY01.03 skapande av låst original via normala ingångar', () => {
  it('CUSTODY01.03 setup: inkommande E66 -> ediel_messages-original med registrerad mottagning (låst)', async () => {
    tenant = seedSupplierTenant(TENANT)
    const spec = buildRoutableE66({ prefix: run.prefix, seq: 1, receiver: TENANT.edielId })
    await seedRoutableChain(tenant, [spec.meteringPoint])
    const subject = `E66 ${run.prefix} 001`
    const built = buildEdifactMime({ from: '70007@dso.t6.sim.invalid', to: process.env.T6_MAILBOX_ADDRESS ?? 'ediel@t6.sim.invalid', subject, raw: spec.raw, placement: 'inline', messageId: `<${run.prefix.toLowerCase()}-001@dso.t6.sim.invalid>` })
    ev.save('e66-001.edi', spec.raw); ev.save('e66-001.eml', built.mime)
    await purgeInbox()
    await appendToInbox(built.mime)
    resetMailboxSchedule(mode())
    const cron = await triggerInbound(mode())
    ev.observe('http_inbound_cron', { status: cron.status, ms: cron.ms, body: cron.body ?? cron.text.slice(0, 500), mailsStored: mailRows(`E66 ${run.prefix} %`).length, edielMessages: sourceRows(`E66 ${run.prefix} %`).length })
    let rows = sourceRows(`E66 ${run.prefix} %`)
    if (rows.length < 1) {
      // ERSÄTTNINGSSTEG: HTTP-cron skickar ingen actorUserId (app/api/internal/inbound-mail/cron/route.ts) -> mottagning kan inte slutföras.
      const r = await runIntakeWithActor(`E66 ${run.prefix} %`, 1)
      ev.observe('ersattningssteg_motor_med_aktor', r)
      rows = sourceRows(`E66 ${run.prefix} %`)
    }
    expect(rows.length, 'ett ediel_messages-original skapat').toBe(1)
    sourceId = rows[0].id
    const receptions = sqlIn<number>(`SELECT count(*) FROM gridex_ediel_inbound_receptions.receptions WHERE source_message_id=${lit(sourceId)}`)
    ev.observe('locked_source', { sourceId, companyId: rows[0].company_id, receptions: Number(receptions) })
    expect(Number(receptions), 'originalet har registrerad mottagning (låst av triggern)').toBeGreaterThanOrEqual(1)
    expect(rows[0].company_id).toBe(tenant.companyId)
    // Oraklet: originalet SOM LAGRAT vid registreringen är oförändrat. Ögonblicksbilden tas direkt efter registreringen; byggda bytes är bara observation
    // (produkten lagrar MIME-kroppen med CRLF, utan avslutande radbrytning; jfr lib/mime.ts buildEdifactMime som ersätter LF med CRLF).
    builtBodySha = sha256(Buffer.from(spec.raw, 'utf8'))
    baseline = messageFingerprint(sourceId)!
    const stored = sqlIn<string>(`SELECT to_jsonb(raw_payload) FROM public.ediel_messages WHERE id=${lit(sourceId)}`)
    ev.observe('baseline', baseline)
    ev.observe('built_vs_stored', { builtSha256: builtBodySha, storedSha256: baseline.bodySha256, storedHasCrlf: stored.includes('\r\n'), storedEndsWithNewline: /\r?\n$/.test(stored), storedLfNormalizedEqualsBuilt: sha256(Buffer.from(stored.replace(/\r\n/g, '\n'), 'utf8')) === builtBodySha, storedBytes: baseline.bodyBytes, builtBytes: Buffer.byteLength(spec.raw) })
    expect(baseline.bodySha256).toMatch(/^[a-f0-9]{64}$/)
  }, 600_000)
})

describe('CUSTODY01.03 radering/ändring nekas', () => {
  it('CUSTODY01.03 (a) authenticated tenantanvändare via PostgREST: DELETE och PATCH berör 0 rader / nekas', async () => {
    const user = await createTenantUser(tenant.companyId, ['communication.read', 'communication.write', 'ediel.read', 'ediel.write'])
    const readable = await rest('GET', 'ediel_messages', `id=eq.${sourceId}&select=id`, user.accessToken)
    const del = await rest('DELETE', 'ediel_messages', `id=eq.${sourceId}`, user.accessToken)
    const patch = await rest('PATCH', 'ediel_messages', `id=eq.${sourceId}`, user.accessToken, { raw_payload: 'MANIPULERAD' })
    attempts.authenticated = { readableRows: readable.rows?.length ?? null, readableStatus: readable.status, del, patch }
    const denied = (r: { status: number; rows: unknown[] | null }) => (r.status >= 200 && r.status < 300 ? (r.rows?.length ?? 0) === 0 : [400, 401, 403, 404].includes(r.status))
    expect(denied(del), `DELETE nekad: ${del.status} ${del.text}`).toBe(true)
    expect(denied(patch), `PATCH nekad: ${patch.status} ${patch.text}`).toBe(true)
    unchanged('(a)')
  }, 120_000)

  it('CUSTODY01.03 (b) service_role via PostgREST: DELETE och PATCH ger triggerfelet', async () => {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const del = await rest('DELETE', 'ediel_messages', `id=eq.${sourceId}`, key)
    const patch = await rest('PATCH', 'ediel_messages', `id=eq.${sourceId}`, key, { raw_payload: 'MANIPULERAD' })
    attempts.service_role = { del, patch }
    expect(del.status, `DELETE: ${del.text}`).toBeGreaterThanOrEqual(400)
    expect(del.message, 'DELETE nekas av reception-guarden').toBe(CODE)
    expect(del.code).toBe('P0001')
    expect(patch.status, `PATCH: ${patch.text}`).toBeGreaterThanOrEqual(400)
    expect(ORIGINAL_GUARDS, `PATCH nekas av ett känt immutability-skydd (fick ${patch.code} ${patch.message})`).toContain(patch.message)
    unchanged('(b)')
  }, 120_000)

  it('CUSTODY01.03 (c) direkt SQL som postgres: DELETE och UPDATE av kroppen ger triggerfelet (körs i transaktion som rullas tillbaka)', () => {
    const del = sqlTry(`BEGIN; WITH d AS (DELETE FROM public.ediel_messages WHERE id=${lit(sourceId)} RETURNING 1) SELECT count(*) FROM d; ROLLBACK;`)
    const upd = sqlTry(`BEGIN; WITH u AS (UPDATE public.ediel_messages SET raw_payload=raw_payload||' ' WHERE id=${lit(sourceId)} RETURNING 1) SELECT count(*) FROM u; ROLLBACK;`)
    const updHash = sqlTry(`BEGIN; WITH u AS (UPDATE public.ediel_messages SET immutable_payload_hash=repeat('0',64) WHERE id=${lit(sourceId)} RETURNING 1) SELECT count(*) FROM u; ROLLBACK;`)
    attempts.postgres = { del, upd, updHash }
    expect(del.ok, `DELETE lyckades (stdout ${del.stdout})`).toBe(false)
    expect(del.message).toBe(CODE)
    expect(del.sqlstate).toBe('P0001')
    expect(upd.ok, `UPDATE lyckades (stdout ${upd.stdout})`).toBe(false)
    expect(ORIGINAL_GUARDS, `UPDATE av kroppen nekas av ett känt skydd (fick ${upd.sqlstate} ${upd.message})`).toContain(upd.message)
    expect(updHash.ok).toBe(false)
    expect(ORIGINAL_GUARDS, `UPDATE av hash nekas av ett känt skydd (fick ${updHash.sqlstate} ${updHash.message})`).toContain(updHash.message)
    ev.observe('guards_fired', { delete: [del.sqlstate, del.message], updateBody: [upd.sqlstate, upd.message], updateHash: [updHash.sqlstate, updHash.message] })
    unchanged('(c)')
  })
})

describe('CUSTODY01.03 append-only-lager', () => {
  it('CUSTODY01.03 gridex_received_sources / underlay_bindings / correction_journal / billing_underlays: UPDATE/DELETE nekas, rader oförändrade', (ctx) => {
    const tables: Array<{ table: string; key: string }> = [
      { table: 'gridex_received_sources.sources', key: 'source_message_id' },
      { table: 'gridex_received_sources.snapshots', key: 'id' },
      { table: 'gridex_billing_source.underlay_bindings', key: 'underlay_id' },
      { table: 'gridex_billing_source.correction_journal', key: 'id' },
    ]
    const present = tables.map((t) => ({ ...t, n: Number(sqlIn<number>(`SELECT count(*) FROM ${t.table}`)) }))
    ev.observe('append_only_rows_present', present)
    const results: Record<string, unknown> = {}
    let tried = 0
    for (const t of present.filter((p) => p.n > 0)) {
      const before = sqlIn<string>(`SELECT to_jsonb(encode(sha256(convert_to((SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.${t.key}::text),'[]')::text FROM ${t.table} x),'UTF8')),'hex'))`)
      const id = sqlIn<string>(`SELECT to_jsonb(${t.key}::text) FROM ${t.table} ORDER BY ${t.key}::text LIMIT 1`)
      const del = sqlTry(`BEGIN; WITH d AS (DELETE FROM ${t.table} WHERE ${t.key}=${lit(id)} RETURNING 1) SELECT count(*) FROM d; ROLLBACK;`)
      const upd = sqlTry(`BEGIN; WITH u AS (UPDATE ${t.table} SET ${t.key}=${t.key} WHERE ${t.key}=${lit(id)} RETURNING 1) SELECT count(*) FROM u; ROLLBACK;`)
      const after = sqlIn<string>(`SELECT to_jsonb(encode(sha256(convert_to((SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.${t.key}::text),'[]')::text FROM ${t.table} x),'UTF8')),'hex'))`)
      results[t.table] = { id, del, upd, before, after }
      // sources har sedan 20261001000700:75 retention-guarden (P0001); övriga append-only-lager reject_mutation (23514).
      const expected = t.table === 'gridex_received_sources.sources' ? { state: 'P0001', message: SOURCES_GUARD } : { state: '23514', message: APPEND_ONLY }
      expect(del.ok, `${t.table} DELETE lyckades`).toBe(false)
      expect([del.sqlstate, del.message]).toEqual([expected.state, expected.message])
      expect(upd.ok, `${t.table} UPDATE lyckades`).toBe(false)
      expect([upd.sqlstate, upd.message]).toEqual([expected.state, expected.message])
      expect(after, `${t.table} innehåll oförändrat`).toBe(before)
      tried++
    }
    const bound = sqlIn<string | undefined>(`SELECT to_jsonb(underlay_id::text) FROM gridex_billing_source.underlay_bindings ORDER BY underlay_id LIMIT 1`)
    if (bound) {
      const del = sqlTry(`BEGIN; WITH d AS (DELETE FROM public.billing_underlays WHERE id=${lit(bound)} RETURNING 1) SELECT count(*) FROM d; ROLLBACK;`)
      results['public.billing_underlays'] = { id: bound, del }
      expect(del.ok).toBe(false)
      expect([del.sqlstate, del.message]).toEqual(['55000', 'billing_source_finalized_underlay_immutable'])
      tried++
    }
    attempts.append_only = results
    if (tried === 0) ctx.skip('inga rader i gridex_received_sources.* / underlay_bindings / correction_journal i stacken (ingen kvalificerad PRODAT-mottagning eller bunden underlay har producerats av normala flöden i denna stack)')
  })
})
