import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { expect, it } from 'vitest'

const API = 'http://127.0.0.1:54321'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const ACTION = 'customer_internal_note_created'
const BODY = 'Synthetic persisted internal note: navigation receipt proof'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`
type Actor = { userId: string; sessionId: string; email: string }
type Fixture = { context: { companyId: string; companyB: string; customerId: string; invoiceId: string;
  invoiceExportItemId: string; accountId: string; actorUserId: string; sessionId: string };
  writer: Actor; reader: Actor; decisionCount: number; eventCount: number; expectedReason: string }
type Snapshot = { version: 1; fixtureSha256: string; expectedBody: string; original: Record<string, string>;
  foreign: Record<string, string>; decisionCount: number; eventCount: number }
function sql<T>(command: string): T {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== API) throw new Error('note_navigation_local_only')
  return JSON.parse(execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: command, encoding: 'utf8', timeout: 20_000, maxBuffer: 32 * 1024 * 1024,
  }).trim()) as T
}
function privatePath(value: string | undefined, mustExist: boolean): string {
  if (!value || !process.env.RUNNER_TEMP) throw new Error('note_navigation_private_path_required')
  const temp = realpathSync(process.env.RUNNER_TEMP), path = resolve(value)
  const parent = realpathSync(dirname(path))
  if (!path.startsWith(temp + sep) || (parent !== temp && !parent.startsWith(temp + sep))) throw new Error('note_navigation_runner_temp_required')
  if (mustExist && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()
    || (lstatSync(path).mode & 0o077) !== 0 || !realpathSync(path).startsWith(temp + sep))) {
    throw new Error('note_navigation_private_regular_file_required')
  }
  return path
}
// Fingerprint canonical PostgreSQL text BEFORE JSON.parse. Bigint/numeric
// fields never pass through an IEEE-754 number before the digest is computed.
function fingerprint(relation: string, predicate = ''): string {
  return sql<string>(`SELECT to_jsonb(encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r)
    ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text,'UTF8')),'hex')) FROM ${relation} r ${predicate};`)
}
const financialTables = [
  'companies', 'customers', 'customer_contacts', 'customer_addresses', 'customer_sites', 'metering_points',
  'customer_contracts', 'billing_underlays', 'pricing_runs', 'pricing_preview_lines', 'customer_invoices',
  'customer_invoice_lines', 'customer_invoice_documents', 'invoice_export_items', 'invoice_export_runs',
  'invoice_export_attempts', 'billing_export_runs', 'billing_export_run_items', 'invoice_purchase_events',
  'customer_portal_accounts',
]
function original(f: Fixture, auditIds: string[], usageIds: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const table of financialTables) out[table] = fingerprint(`public.${identifier(table)}`)
  const c = f.context, ownNote = `company_id=${quote(c.companyId)} AND customer_id=${quote(c.customerId)} AND created_by=${quote(f.writer.userId)}`
  out.otherNotes = fingerprint('public.customer_internal_notes', `WHERE NOT coalesce((${ownNote}),false)`)
  // Compare every original audit/usage row by captured IDs. Postcheck also
  // requires exactly one added row each; no broad tenant exclusion is used.
  out.existingAudits = fingerprint('public.audit_logs', auditIds.length ? `WHERE id IN(${auditIds.map(quote).join(',')})` : 'WHERE false')
  out.existingUsage = fingerprint('public.platform_usage_events', usageIds.length ? `WHERE id IN(${usageIds.map(quote).join(',')})` : 'WHERE false')
  out.originalAuthUsers = fingerprint('auth.users', `WHERE id NOT IN(${quote(f.writer.userId)},${quote(f.reader.userId)})`)
  out.allProfiles = fingerprint('public.user_profiles')
  out.ownedIdentity = fingerprint(`(SELECT a.id,a.email,a.email_confirmed_at,a.raw_user_meta_data,a.raw_app_meta_data,
    a.banned_until,a.deleted_at,to_jsonb(p) AS profile FROM auth.users a JOIN public.user_profiles p ON p.id=a.id
    WHERE a.id IN(${quote(f.writer.userId)},${quote(f.reader.userId)}))`)
  return out
}
function foreign(f: Fixture): Record<string, string> {
  const tables = sql<string[]>(`SELECT coalesce(jsonb_agg(c.relname ORDER BY c.relname),'[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind IN('r','p') AND a.attname='company_id' AND a.attnum>0 AND NOT a.attisdropped;`)
  return Object.fromEntries(tables.map(table => [table, fingerprint(`public.${identifier(table)}`, `WHERE company_id=${quote(f.context.companyB)}`)]))
}
function rows(table: string, predicate: string) {
  return sql<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]'::jsonb) FROM public.${identifier(table)} r WHERE ${predicate};`)
}
function capturedIds(table: string): string[] {
  return sql<string[]>(`SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]'::jsonb) FROM public.${identifier(table)};`)
}

it('snapshots the reused fresh U12 graph and independently qualifies the exact persisted note/browser outcome', () => {
  const fixturePath = privatePath(process.env.GRIDEX_REDELIVERY_NAVIGATION_FIXTURE_PATH, true)
  const snapshotPath = privatePath(process.env.GRIDEX_NOTE_UNSAVED_SNAPSHOT_PATH, false)
  if (fixturePath === snapshotPath) throw new Error('note_navigation_separate_snapshot_required')
  const phase = process.env.GRIDEX_NOTE_UNSAVED_PHASE
  if (!['baseline', 'post-browser'].includes(phase ?? '')) throw new Error('note_navigation_unknown_phase')
  const fixtureBytes = readFileSync(fixturePath), f = JSON.parse(fixtureBytes.toString()) as Fixture, c = f.context
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  for (const value of [c.companyId,c.companyB,c.customerId,c.invoiceId,c.invoiceExportItemId,c.accountId,c.actorUserId,c.sessionId,
    f.writer.userId,f.reader.userId,f.writer.sessionId,f.reader.sessionId]) expect(value).toMatch(uuid)
  expect(c.companyId).not.toBe(c.companyB); expect(c.actorUserId).toBe(f.writer.userId); expect(c.sessionId).toBe(f.writer.sessionId)
  expect(f.writer.userId).not.toBe(f.reader.userId); expect(f.decisionCount).toBe(0)
  const notePredicate = `company_id=${quote(c.companyId)} AND customer_id=${quote(c.customerId)}`
  const auditPredicate = `company_id=${quote(c.companyId)} AND action=${quote(ACTION)}`
  const usagePredicate = `company_id=${quote(c.companyId)} AND event_key=${quote(ACTION)}`
  if (phase === 'baseline') {
    if (existsSync(snapshotPath)) throw new Error('note_navigation_snapshot_already_exists')
    expect(rows('customer_internal_notes', notePredicate)).toEqual([])
    expect(rows('audit_logs', auditPredicate)).toEqual([]); expect(rows('platform_usage_events', usagePredicate)).toEqual([])
    const decisions = rows('invoice_redelivery_decisions', `company_id=${quote(c.companyId)}`)
    expect(decisions).toHaveLength(0)
    const auditIds = capturedIds('audit_logs'), usageIds = capturedIds('platform_usage_events')
    const baseline: Snapshot & { auditIds: string[]; usageIds: string[] } = {
      version: 1, fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'), expectedBody: BODY,
      original: original(f, auditIds, usageIds), foreign: foreign(f),
      decisionCount: f.decisionCount, eventCount: f.eventCount, auditIds, usageIds,
    }
    writeFileSync(snapshotPath, JSON.stringify(baseline), { mode: 0o600, flag: 'wx' })
    console.log('NOTE_NAVIGATION_NATIVE_BASELINE_PASS readonly_snapshot=true reused_fixture_unchanged=true notes0=true')
    return
  }
  privatePath(snapshotPath, true)
  const baseline = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot & { auditIds: string[]; usageIds: string[] }
  expect(baseline.version).toBe(1); expect(baseline.expectedBody).toBe(BODY)
  expect(createHash('sha256').update(fixtureBytes).digest('hex')).toBe(baseline.fixtureSha256)
  for (const id of [...baseline.auditIds, ...baseline.usageIds]) expect(id).toMatch(uuid)
  expect(original(f, baseline.auditIds, baseline.usageIds)).toEqual(baseline.original)
  expect(foreign(f)).toEqual(baseline.foreign)
  const notes = rows('customer_internal_notes', notePredicate)
  expect(notes).toHaveLength(1)
  expect(notes[0]).toMatchObject({ company_id: c.companyId, customer_id: c.customerId, body: BODY,
    created_by: f.writer.userId, updated_by: f.writer.userId })
  expect(String(notes[0].id)).toMatch(uuid)
  const audits = rows('audit_logs', auditPredicate), usage = rows('platform_usage_events', usagePredicate)
  expect(audits).toHaveLength(1); expect(usage).toHaveLength(1)
  expect(capturedIds('audit_logs').filter(id => !baseline.auditIds.includes(id))).toEqual([audits[0].id])
  expect(capturedIds('platform_usage_events').filter(id => !baseline.usageIds.includes(id))).toEqual([usage[0].id])
  expect(audits[0]).toMatchObject({ actor_user_id: f.writer.userId, company_id: c.companyId, entity_type: 'customer_internal_note',
    entity_id: notes[0].id, old_values: null, new_values: notes[0], metadata: { customerId: c.customerId, companyId: c.companyId, source: 'customer_card' } })
  expect(usage[0]).toMatchObject({ actor_user_id: f.writer.userId, company_id: c.companyId, customer_id: c.customerId,
    entity_type: 'customer_internal_note', entity_id: notes[0].id, event_key: ACTION, source: 'customer_card' })
  expect(rows('invoice_redelivery_decisions', `company_id=${quote(c.companyId)}`)).toHaveLength(baseline.decisionCount + 1)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.domain_events WHERE company_id=${quote(c.companyId)};`)).toBe(baseline.eventCount + 1)
  console.log('NOTE_NAVIGATION_NATIVE_POSTCHECK_PASS exact_note1_audit1_usage1=true original_pg_finance_foreign_identity_unchanged=true prior_decision1=true')
})
