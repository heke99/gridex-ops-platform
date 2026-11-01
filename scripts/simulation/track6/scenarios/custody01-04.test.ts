// CUSTODY01.04: ett syntetiskt, retention-berättigat fakturaunderlag (PDF i Storage) raderas enligt policy; låsta objekt förblir orörda;
// retainUntil i framtiden nekas. Spår 6, kampanj 20261029-3f1a8ab1. Ingen webbläsare/Playwright.
//   Flöde (invoice-file retention, lib/ediel/retention/invoiceFileRetention.ts via appens egen route-handler app/api/ediel/invoice-file-retention):
//   capture (ediel_register_invoice_file_source_v1) -> submit med HMAC-signerat policykvitto (ediel_invoice_file_retention_policy_v1) ->
//   review av ANNAN användare -> begin purge -> Storage-radering med HTTP 404-återläsning -> finish purge.
//   ERSÄTTNINGSSTEG (som repots native-test, scripts/ediel-invoice-file-retention-native.test.ts): route-handlern körs i testprocessen med
//   mockad cookie/Supabase-server-klient (riktiga GoTrue-sessioner); utfärdarkompetens (issuers, HMAC-nyckel) och billing-/pricing-rader är syntetiska GIVEN.
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const current = vi.hoisted(() => ({ client: null as SupabaseClient | null, company: '' }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: async () => null }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: async () => null }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => { if (!current.client) throw Error('actual_local_gotrue_client_required'); return current.client } }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: current.company }) }) }))

import { POST } from '@/app/api/ediel/invoice-file-retention/route'
import { supabaseService } from '@/lib/supabase/service'
import { mode, sha256, sqlIn } from '../lib/custody/base'
import {
  approved, basisSchema, capture, expectExactBytes, expectPhysical404, invoicePdfCore, invoicePdfEffects, invoicePdfHash, purged,
  seedQualifiedSyntheticInvoicePdfGiven, sourceView, storageBytes, storageObjectCount, submitted, type InvoicePdfFixture,
} from '../lib/custody/invoicePdf'
import { Evidence } from '../lib/evidence'
import { newRunContext } from '../lib/seed.mjs'

const ev = new Evidence()
const run = newRunContext('custody01-04')
const http = (body: unknown) => POST(new NextRequest('http://localhost/api/ediel/invoice-file-retention', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
async function httpOk<T>(body: unknown, schema: z.ZodType<T>): Promise<T> {
  const r = await http(body)
  expect(r.status, await r.clone().text()).toBe(200)
  return schema.parse(z.object({ data: z.unknown() }).parse(await r.json()).data)
}
afterEach(() => { current.client = null; current.company = '' })

/** Fingeravtryck (rad-hash) för låsta objekt som redan finns: registrerade mottagna original, ledger-källor och underlay-bindningar. */
const lockedHashes = (): Record<string, string> => sqlIn<Record<string, string>>(`SELECT coalesce(jsonb_object_agg(k,h),'{}'::jsonb) FROM (
  SELECT 'ediel_messages:'||m.id::text k, encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') h FROM public.ediel_messages m
    WHERE EXISTS (SELECT 1 FROM gridex_ediel_inbound_receptions.receptions r WHERE r.source_message_id=m.id)
  UNION ALL SELECT 'received_sources:'||s.source_message_id::text, encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM gridex_received_sources.sources s
  UNION ALL SELECT 'underlay_bindings:'||b.underlay_id::text, encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex') FROM gridex_billing_source.underlay_bindings b) z`)

let A: InvoicePdfFixture, B: InvoicePdfFixture
let lockedBefore: Record<string, string> = {}
let coreA: Record<string, unknown>, coreB: Record<string, unknown>
const obs: Record<string, unknown> = {}

beforeAll(() => { ev.observe('run', { ...run, mode: mode() }) })
afterAll(() => { ev.observe('details', obs); ev.finalize() })

async function decide(f: InvoicePdfFixture) {
  current.client = f.writer.client; current.company = f.companyId
  const sources: z.infer<typeof capture>[] = [], decisions: z.infer<typeof submitted>[] = []
  for (const chosen of f.targets) {
    const source = await httpOk({ action: 'capture', ...chosen }, capture)
    expect(source).toMatchObject({ ...chosen, sourceHash: f.sourceHash, byteLength: f.byteLength, authority: 'none' }); sources.push(source)
  }
  for (const [i, chosen] of f.targets.entries()) {
    const basis = await httpOk({ action: 'basis', ...chosen }, basisSchema)
    expect(basis).toMatchObject({ ...chosen, sourceId: sources[i].sourceId, sourceHash: f.sourceHash, storagePath: f.path, allIncludedScopesClosed: true })
    const document = Buffer.from('SYNTHETIC independent exact invoice PDF CODE policy ' + chosen.retentionClass)
    decisions.push(await httpOk({ action: 'submit', ...chosen, documentBase64: document.toString('base64'), issuerReceipt: f.policy(basis, document) }, submitted))
  }
  return { sources, decisions }
}
async function reviewAll(f: InvoicePdfFixture, decisions: z.infer<typeof submitted>[]) {
  for (const d of decisions) {
    current.client = f.reviewer.client
    const r = await httpOk({ action: 'review', decisionId: d.decisionId, outcome: 'approve', reason: 'SYNTHETIC independent exact-copy CODE review' }, approved)
    expect(r.decisionId).toBe(d.decisionId)
    current.client = f.writer.client
  }
}

describe('CUSTODY01.04 förberedelse', () => {
  it('CUSTODY01.04 setup: två syntetiska fakturaobjekt (A: retainUntil förfallen = berättigad, B: retainUntil framtid = ej berättigad) + fingeravtryck av befintliga låsta objekt', async () => {
    lockedBefore = lockedHashes()
    A = await seedQualifiedSyntheticInvoicePdfGiven('-1 minute')
    B = await seedQualifiedSyntheticInvoicePdfGiven('+1 day')
    lockedBefore = { ...lockedBefore, ...Object.fromEntries(Object.entries(lockedHashes()).filter(([k]) => k.includes(B.underlayId))) }
    coreA = invoicePdfCore(A); coreB = invoicePdfCore(B)
    ev.observe('setup', { companyA: A.companyId, companyB: B.companyId, lockedObjectsBefore: Object.keys(lockedBefore).length, lockedKinds: [...new Set(Object.keys(lockedBefore).map((k) => k.split(':')[0]))] })
    expect(A.writer.id).not.toBe(A.reviewer.id)
    expect(Object.keys(lockedBefore).some((k) => k.endsWith(B.underlayId)), 'B:s bindning ingår som låst kontroll').toBe(true)
  }, 600_000)
})

describe('CUSTODY01.04 negativt: retainUntil i framtiden och otillåtna vägar', () => {
  it('CUSTODY01.04 (neg) samma användare får inte godkänna egen inlämning; framtida retainUntil ger ingen radering (begin purge nekas), objektet finns kvar', async (ctx) => {
    if (!A || !B) return ctx.skip('setup misslyckades (fixturerna A/B saknas); se setup-steget')
    const { decisions } = await decide(B)
    // Samma användare (writer) kan inte godkänna sin egen inlämning.
    const self = await B.writer.client.rpc('ediel_review_invoice_file_retention_v1', { p_company_id: B.companyId, p_actor_user_id: B.writer.id, p_decision_id: decisions[0].decisionId, p_outcome: 'approve', p_reason: 'SYNTHETIC self review' })
    obs.self_review = { error: self.error?.message ?? null, code: self.error?.code ?? null }
    expect(self.data).toBeNull(); expect(self.error?.message).toContain('invoice_file_separate_reviewer_required')
    await reviewAll(B, decisions)
    const args = { p_company_id: B.companyId, p_actor_user_id: B.writer.id, p_decision_id: decisions[0].decisionId }
    const begin = await B.writer.client.rpc('ediel_begin_invoice_file_purge_v1', args)
    obs.future_retain_begin = { error: begin.error?.message ?? null, code: begin.error?.code ?? null }
    expect(begin.data).toBeNull()
    expect(begin.error?.message).toContain('invoice_file_each_copy_current_legal_review_required')
    const viaHttp = await http({ action: 'purge', decisionId: decisions[0].decisionId })
    obs.future_retain_http = { status: viaHttp.status, body: (await viaHttp.text()).slice(0, 500) }
    expect(viaHttp.status).not.toBe(200)
    // Direkt Storage-radering av den ägande användaren förbi policyn nekas av Storage-guarden (ingen tombstone).
    const direct = await B.writer.client.storage.from('billing-exports').remove([B.path])
    obs.future_retain_direct_storage_remove = { error: direct.error?.message ?? null, removed: direct.data?.length ?? null }
    await expectExactBytes(B.path, B.pdf)
    expect(storageObjectCount(B.path)).toBe(1)
    expect(invoicePdfEffects(B)).toEqual({ tombstones: [], events: [] })
    expect(invoicePdfCore(B)).toEqual(coreB)
  }, 600_000)
})

describe('CUSTODY01.04 positivt: berättigat objekt raderas enligt policy', () => {
  it('CUSTODY01.04 tre klassbeslut kräver granskning av annan användare; purge ger tombstone, HTTP 404 och bytesAvailable=false; finans oförändrad', async (ctx) => {
    if (!A || !B) return ctx.skip('setup misslyckades (fixturerna A/B saknas); se setup-steget')
    const { sources, decisions } = await decide(A)
    expect(new Set(decisions.map((d) => d.decisionId)).size).toBe(3)
    await reviewAll(A, [decisions[0], decisions[1]])
    // Utan alla delade granskningar nekas purge.
    const args = { p_company_id: A.companyId, p_actor_user_id: A.writer.id, p_decision_id: decisions[0].decisionId }
    const unreviewed = await A.writer.client.rpc('ediel_begin_invoice_file_purge_v1', args)
    expect(unreviewed.data).toBeNull(); expect(unreviewed.error?.message).toContain('invoice_file_each_copy_current_legal_review_required')
    await expectExactBytes(A.path, A.pdf)
    expect(invoicePdfEffects(A)).toEqual({ tombstones: [], events: [] })
    await reviewAll(A, [decisions[2]])

    current.client = A.writer.client; current.company = A.companyId
    // Purge via appens route: Storage-radering med verklig 404-återläsning före finish.
    let absenceObservations = 0
    const rpc = A.writer.client.rpc.bind(A.writer.client)
    const observer = vi.spyOn(A.writer.client, 'rpc').mockImplementation((...params: Parameters<typeof rpc>) => {
      const command = rpc(...params)
      if (params[0] !== 'ediel_finish_invoice_file_purge_v1') return command
      const observed: typeof command.then = (fulfilled, rejected) => expectPhysical404(A.path).then(() => { absenceObservations += 1; return command.then() }).then(fulfilled, rejected)
      return new Proxy(command, { get: (t, k, r) => (k === 'then' ? observed : Reflect.get(t, k, r)) })
    })
    try {
      const result = await httpOk({ action: 'purge', decisionId: decisions[0].decisionId }, purged)
      expect(result).toEqual({ status: 'purged', sourceId: sources[0].sourceId, sourceHash: A.sourceHash, byteLength: A.byteLength, bytesAvailable: false, replay: false })
      expect(absenceObservations).toBe(1)
      await expectPhysical404(A.path)
      expect(storageObjectCount(A.path)).toBe(0)
      const effects = invoicePdfEffects(A)
      expect(effects.tombstones.map((t) => t.sourceId).sort()).toEqual(sources.map((s) => s.sourceId).sort())
      expect(effects.tombstones.every((t) => t.actorId === A.writer.id)).toBe(true)
      expect(effects.events.map((e) => e.kind).sort()).toEqual(['storage_delete_authorized', 'storage_delete_authorized', 'storage_delete_authorized', 'storage_object_absent', 'storage_object_absent', 'storage_object_absent'])
      obs.purge = { result, effects }
      for (const [i, d] of decisions.entries()) {
        if (i > 0) expect(await httpOk({ action: 'purge', decisionId: d.decisionId }, purged)).toMatchObject({ status: 'purged', bytesAvailable: false, replay: true })
        const unavailable = await supabaseService.rpc('ediel_require_invoice_file_copy_available_v1', { p_company_id: A.companyId, p_retention_class: A.targets[i].retentionClass, p_target_id: A.targets[i].targetId })
        expect(unavailable.data).toBeNull(); expect(unavailable.error).toMatchObject({ code: '23514', message: 'invoice_file_copy_retention_tombstoned' })
        const view = await httpOk({ action: 'source', ...A.targets[i] }, sourceView)
        expect(view).toMatchObject({ sourceId: sources[i].sourceId, sourceHash: A.sourceHash, bytesAvailable: false })
      }
      expect(invoicePdfCore(A), 'belopp, perioder, status och bindning oförändrade').toEqual(coreA)
      // Syskon- och originalobjekt (andra sökvägar) är orörda.
      await expectExactBytes(A.siblingPath, A.pdf)
      await expectExactBytes(A.originalPath, A.pdf, 'customer-contract-documents')
    } finally { observer.mockRestore() }
  }, 900_000)

  it('CUSTODY01.04 låsta objekt är orörda efter raderingen: B (ej berättigad), befintliga registrerade original, ledger-källor och underlay-bindningar', async (ctx) => {
    if (!A || !B || !coreB) return ctx.skip('setup misslyckades (fixturerna A/B saknas); se setup-steget')
    await expectExactBytes(B.path, B.pdf)
    expect(invoicePdfCore(B)).toEqual(coreB)
    expect(invoicePdfEffects(B)).toEqual({ tombstones: [], events: [] })
    const after = lockedHashes()
    const changed = Object.entries(lockedBefore).filter(([k, h]) => after[k] !== h).map(([k]) => k)
    ev.observe('locked_untouched', { checked: Object.keys(lockedBefore).length, changed })
    expect(changed).toEqual([])
    const bytes = await storageBytes(A.path)
    expect(bytes).toBeNull()
    expect(invoicePdfHash(B.pdf)).toBe(sha256(B.pdf))
  })
})
