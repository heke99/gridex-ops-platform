// simulation: MAIN04.01, MAIN04.03, MAIN04.04
//
// MAIN04 — consume the separately sealed successful MAIN03 cohort, prepare and
// compare its draft with independently admitted inputs. No tenant/source/price
// or underlay is created as a setup fallback. MAIN04.04 remains HOLD.
// MAIN04.02 (second prepare call) belongs to track 4 and is deliberately NOT exercised.
//
// Browser: none (no Playwright). HTTP against the running app for generate-underlay and prepare; the approve
// path is called as a library function (see SUBSTITUTE below). Reads of stored results use read-only psql.
//
// Requires a distinct root-pinned business-phase admission, terminal process
// and native unknown-outcome resolution evidence, exact source vectors and a
// separately private existing actual SSR session. Current hosted smoke grants
// none of these. One qualified cohort writer must remain exclusive.
//
// WHAT THE CODE SAYS ABOUT THE DRAFT (base 1c0c088c):
//  - Prepare (lib/billing/invoiceReviewPrepare.ts prepareInvoiceDraftsForReview) calculates and LOCKS the pricing run
//    itself (ensureLockedPricing :150-172) and takes amounts straight from that run (:330, :344). No invoice fee,
//    rounding row or other line is added at draft time; the 19 SEK invoice fee of the seed offer is only used by
//    quote/contract creation (lib/pricing/canonicalInvoiceFee.ts importers: offerQuote, publicContracts, admin
//    contracts actions), never by billing. The oracle therefore equals MAIN03's: spot + markup + monthly fee.
//  - The route takes billing_month only (app/api/internal/invoice-exports/create/route.ts:25-45); a
//    billingUnderlayId scope exists only in the library function. With exactly one underlay in the month the
//    effect is the same; the test asserts the scope it actually got.
//  - Approve (invoiceApprovedDispatch.ts approveItem :128-175) does NOT lock the draft and does NOT compare anything
//    with an external receipt. It requires status pending/draft, assertItemStillReady (:100-126: locked pricing run,
//    same underlay/customer/contract, snapshot sha merely NON-EMPTY, kWh and amounts equal to the locked pricing run),
//    then writes metadata.approval {status, review_hash, calculation_snapshot_sha256} on invoice_export_items and
//    customer_invoices. With a file provider (registry FILE_PROVIDERS) approveAndSendReadyInvoicesForMonth is
//    approve-only (:428, :451): nothing is sent. Sending (Capway) is never reached here.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: vi.fn() }) } }))
vi.mock('server-only', () => ({}))
import { supabaseService, SUPABASE_SERVICE_URL } from '@/lib/supabase/service'
import { approveAndSendReadyInvoicesForMonth } from '@/lib/billing/invoiceApprovedDispatch'
import { adoptMain03CohortFromEnv, assertAdoptedCohortUnchanged, recordPreparedDraftCandidate, type Main04Cohort } from '../fixtures/main03Cohort'
import { SUBSTITUTIONS, resetSubstitutions, substitute } from '../fixtures/substitutions'
import { dbRead, http, lit, TIMINGS, timed, writeArtifact } from '../fixtures/runtime'
import { cents, enableFileInvoiceProvider, expectedReviewHash, sha256Hex } from '../fixtures/main04Support'
import { centsText, parseMilliKwh } from '../fixtures/synthetic'

let fx: Main04Cohort
let underlayId = ''
const results: Record<string, unknown> = {}
let BILLING_MONTH = ''
const company = () => lit(fx.companyId)

type Draft = {
  invoices: Array<{ id: string; status: string; underlay: string; item: string; sha: string | null; ex: string; vat: string; inc: string; kwh: string; vatRate: string; area: string | null; approval: Record<string, unknown> | null
    snapshotTotalKwh: unknown; snapshotUnderlay: unknown; evidenceCount: number; lineCount: number; snapshotEx: unknown; snapshotVat: unknown; snapshotInc: unknown }>
  items: Array<{ id: string; status: string; run: string; pricingRun: string; ex: string; vat: string; inc: string; kwh: string; provider: string; environment: string; approval: Record<string, unknown> | null; metaSha: string | null }>
  runs: Array<{ id: string; provider: string; environment: string; billingMonth: string; status: string; totalItems: number }>
  legacyItems: number
  pricingRun: { id: string; status: string; lockedAt: string | null; ex: string; vat: string; inc: string } | null
  lines: Array<{ type: string; unit: string; source: string | null; ex: string; vat: string; quantity: string | null }>
  attempts: number
  files: number
}

function readDraft(): Draft {
  return dbRead<Draft>(`SELECT jsonb_build_object(
    'invoices',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'underlay',i.billing_underlay_id,'item',i.invoice_export_item_id,'sha',i.calculation_snapshot_sha256,
      'ex',i.amount_ex_vat::text,'vat',i.vat_amount::text,'inc',i.amount_inc_vat::text,'kwh',trim_scale(coalesce(i.consumption_kwh,i.total_kwh))::text,'vatRate',i.vat_rate::text,'area',i.price_area_code,
      'approval',i.metadata->'approval','snapshotTotalKwh',i.calculation_snapshot->'total_kwh','snapshotUnderlay',i.calculation_snapshot->>'billing_underlay_id',
      'evidenceCount',jsonb_array_length(coalesce(i.calculation_snapshot->'interval_evidence','[]'::jsonb)),'lineCount',jsonb_array_length(coalesce(i.calculation_snapshot->'pricing_lines','[]'::jsonb)),
      'snapshotEx',i.calculation_snapshot->'subtotal_sek_ex_vat','snapshotVat',i.calculation_snapshot->'vat_sek','snapshotInc',i.calculation_snapshot->'total_sek_inc_vat'))
      FROM public.customer_invoices i WHERE i.company_id=${company()} AND i.billing_underlay_id=${lit(underlayId)}),'[]'::jsonb),
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'status',x.status,'run',x.export_run_id,'pricingRun',x.pricing_run_id,'ex',x.amount_ex_vat::text,'vat',x.vat_amount::text,'inc',x.amount_inc_vat::text,
      'kwh',trim_scale(x.total_kwh)::text,'provider',x.provider,'environment',x.environment,'approval',x.metadata->'approval','metaSha',x.metadata->>'calculation_snapshot_sha256'))
      FROM public.invoice_export_items x WHERE x.company_id=${company()} AND x.billing_underlay_id=${lit(underlayId)} AND x.status<>'cancelled'),'[]'::jsonb),
    'runs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'provider',r.provider,'environment',r.environment,'billingMonth',r.billing_month,'status',r.status,'totalItems',r.total_items))
      FROM public.invoice_export_runs r WHERE r.company_id=${company()}),'[]'::jsonb),
    'legacyItems',(SELECT count(*) FROM public.billing_export_run_items b WHERE b.company_id=${company()} AND b.billing_underlay_id=${lit(underlayId)}),
    'pricingRun',(SELECT jsonb_build_object('id',p.id,'status',p.status,'lockedAt',p.locked_at,'ex',p.total_ex_vat::text,'vat',p.vat_amount::text,'inc',p.total_inc_vat::text)
      FROM public.pricing_runs p WHERE p.company_id=${company()} AND p.billing_underlay_id=${lit(underlayId)} AND p.status='locked' ORDER BY p.locked_at DESC LIMIT 1),
    'lines',coalesce((SELECT jsonb_agg(jsonb_build_object('type',l.line_type,'unit',l.unit,'source',l.metadata->>'source_type','ex',l.amount_ex_vat::text,'vat',l.vat_amount::text,'quantity',l.quantity::text) ORDER BY l.sort_order)
      FROM public.pricing_preview_lines l WHERE l.company_id=${company()} AND l.pricing_run_id=(SELECT p.id FROM public.pricing_runs p WHERE p.company_id=${company()} AND p.billing_underlay_id=${lit(underlayId)} AND p.status='locked' ORDER BY p.locked_at DESC LIMIT 1)),'[]'::jsonb),
    'attempts',(SELECT count(*) FROM public.invoice_export_attempts a WHERE a.company_id=${company()}),
    'files',(SELECT count(*) FROM public.invoice_export_files f WHERE f.company_id=${company()}))`)
}

beforeAll(async () => {
  resetSubstitutions()
  fx = await adoptMain03CohortFromEnv(SUPABASE_SERVICE_URL) // all admission/live/Auth/input checks precede the first write
  underlayId = fx.underlayId
  BILLING_MONTH = fx.params.billingMonth
  await enableFileInvoiceProvider(fx.companyId)
  writeArtifact('main04-fixture.json', { note: 'adopted same cohort; prepare/review only, no independent draft acceptance or approval', cohortSha256: fx.cohortSha256,
    companyId: fx.companyId, customerId: fx.customerId, pointId: fx.pointId, contractId: fx.contractId, underlayId, salt: fx.salt,
    oracle: { totalKwh: fx.oracle.totalKwhText, lines: fx.oracle.lines, vatCents: fx.oracle.vatCents, totalExVatCents: fx.oracle.totalExVatCents, totalIncVatCents: fx.oracle.totalIncVatCents } })
}, 900_000)

afterAll(() => {
  writeArtifact('main04-substitutions.json', SUBSTITUTIONS)
  writeArtifact('main04-timings.json', TIMINGS)
  writeArtifact('main04-results.json', results)
})

let draftAfterPrepare: Draft | null = null
let receipt: { itemId: string; invoiceId: string; underlayId: string; pricingRunId: string; calculationSha: string; totalKwh: number; ex: number; vat: number; inc: number; priceArea: string } | null = null

describe('MAIN04 prepare, oracle and approval', () => {
  it('MAIN04.01 Prepare från exakt underlag ger exakt ett utkast bundet till underlags-ID:t', async () => {
    await assertAdoptedCohortUnchanged(fx) // reobserve immediately before month-scoped prepare
    const before = readDraft()
    expect(before.invoices).toHaveLength(0)
    expect(before.items).toHaveLength(0)
    const prepared = await timed('MAIN04.01 invoice-exports/create (normal API)', () => http(fx.session, 'POST', '/api/internal/invoice-exports/create', { json: { billing_month: BILLING_MONTH } }))
    expect(prepared.status, JSON.stringify(prepared.body)?.slice(0, 800)).toBe(200)
    const body = prepared.body as { data?: Record<string, unknown>; mode?: string; approval_required?: boolean } | null
    results['MAIN04.01.response'] = { ms: prepared.ms, data: body?.data, mode: body?.mode, approval_required: body?.approval_required }
    expect(body?.mode).toBe('prepare_only')
    expect(body?.approval_required).toBe(true)
    expect(body?.data).toMatchObject({ billingMonth: BILLING_MONTH, underlays: 1, candidates: 1, created: 1, failed: 0, alreadyPrepared: 0 })
    expect(body?.data?.errors).toEqual([])
    // The route offers month scope only: the effective scope must still be exactly our one underlay.
    expect((body?.data?.scope as { billingUnderlayId: unknown }).billingUnderlayId).toBeNull()

    const draft = readDraft()
    draftAfterPrepare = draft
    results['MAIN04.01.graph'] = { invoices: draft.invoices.length, items: draft.items.length, runs: draft.runs.length, legacyItems: draft.legacyItems, pricingRun: draft.pricingRun }
    expect(draft.invoices).toHaveLength(1)
    expect(draft.items).toHaveLength(1)
    const [invoice] = draft.invoices, [item] = draft.items
    expect(invoice).toMatchObject({ status: 'draft', underlay: underlayId, item: item.id, area: 'SE3' })
    expect(invoice.sha).toMatch(/^[a-f0-9]{64}$/)
    expect(item).toMatchObject({ status: 'pending', provider: 'file_export', environment: 'test' })
    expect(item.metaSha).toBe(invoice.sha)
    expect(item.approval).toMatchObject({ status: 'pending_review', calculation_snapshot_sha256: invoice.sha })
    expect(invoice.approval).toMatchObject({ status: 'pending_review', calculation_snapshot_sha256: invoice.sha })
    expect(draft.runs).toHaveLength(1)
    expect(draft.runs[0]).toMatchObject({ id: item.run, provider: 'file_export', environment: 'test', billingMonth: BILLING_MONTH, totalItems: 1 })
    expect(draft.legacyItems).toBe(1)
    expect(draft.pricingRun?.status).toBe('locked')
    expect(draft.pricingRun?.id).toBe(item.pricingRun)
    expect(invoice.snapshotUnderlay).toBe(underlayId)
    // Nothing was sent or exported by prepare.
    expect(draft.attempts).toBe(0)
    expect(draft.files).toBe(0)
  }, 900_000)

  it('MAIN04.03 Utkastet matchar det oberoende oraklet och bygger på exakt underlagets 2688 intervall-evidens', async () => {
    const draft = draftAfterPrepare ?? readDraft()
    expect(draft.invoices, 'MAIN04.01 must have produced the draft').toHaveLength(1)
    const [invoice] = draft.invoices, [item] = draft.items
    const o = fx.oracle
    // Amounts on invoice, export item and locked pricing run (netto / moms / brutto) against the oracle only.
    for (const [name, record] of [['invoice', invoice], ['item', item], ['pricingRun', draft.pricingRun!]] as const) {
      expect({ name, ex: cents(record.ex), vat: cents(record.vat as string), inc: cents(record.inc) }, name)
        .toEqual({ name, ex: o.totalExVatCents, vat: o.vatCents.total, inc: o.totalIncVatCents })
    }
    expect(Number(invoice.vatRate)).toBeCloseTo(fx.params.pricing.vatPercent / 100, 10)
    expect(parseMilliKwh(invoice.kwh)).toBe(o.totalMilliKwh)
    expect(parseMilliKwh(item.kwh)).toBe(o.totalMilliKwh)
    // Lines: exactly spot, per-kWh markup, fixed monthly fee. No invoice fee, rounding row or discount.
    const spot = draft.lines.filter(line => line.source === 'spot')
    const markup = draft.lines.filter(line => line.source !== 'spot' && line.type !== 'base_price' && line.unit === 'kWh')
    const fee = draft.lines.filter(line => line.source !== 'spot' && line.unit === 'månad')
    results['MAIN04.03.lines'] = draft.lines
    expect(spot.map(line => cents(line.ex))).toEqual([o.lines.spotCents])
    expect(markup.map(line => cents(line.ex))).toEqual([o.lines.markupCents])
    expect(fee.map(line => cents(line.ex))).toEqual([o.lines.monthlyFeeCents])
    expect(draft.lines, 'no other line than spot, markup and monthly fee (no invoice fee at draft time)').toHaveLength(3)
    expect(draft.lines.reduce((sum, line) => sum + cents(line.vat), 0)).toBe(o.vatCents.total)
    // The frozen calculation snapshot repeats the same money and 3 lines.
    expect(invoice.lineCount).toBe(3)
    expect(cents(invoice.snapshotEx)).toBe(o.totalExVatCents)
    expect(cents(invoice.snapshotVat)).toBe(o.vatCents.total)
    expect(cents(invoice.snapshotInc)).toBe(o.totalIncVatCents)
    expect(Math.round(Number(invoice.snapshotTotalKwh) * 1000)).toBe(o.totalMilliKwh)
    // Sources: the snapshot's interval evidence is exactly the oracle's 2688 intervals (start, kWh, spot price).
    expect(invoice.evidenceCount).toBe(2688)
    const evidence = dbRead<Array<[number, number, number]>>(`SELECT jsonb_agg(jsonb_build_array((extract(epoch from (e->>'meteringIntervalStart')::timestamptz)*1000)::bigint,
      round((e->>'consumptionKwh')::numeric*1000)::bigint, round((e->>'priceSekPerKwh')::numeric*100000)::bigint) ORDER BY (e->>'meteringIntervalStart')::timestamptz)
      FROM public.customer_invoices i, jsonb_array_elements(i.calculation_snapshot->'interval_evidence') e WHERE i.id=${lit(invoice.id)}`)
    expect(evidence.map(([start, milli, e5]) => `${start}:${milli}:${e5}`)).toEqual(o.intervals.map(interval => `${interval.startMs}:${interval.milliKwh}:${interval.spotE5}`))
    const itemLinks = dbRead<{ evidenceItems: number; underlayItems: number; matched: number }>(`SELECT jsonb_build_object(
      'evidenceItems',(SELECT count(DISTINCT e->>'billingUnderlayItemId') FROM public.customer_invoices i, jsonb_array_elements(i.calculation_snapshot->'interval_evidence') e WHERE i.id=${lit(invoice.id)}),
      'underlayItems',(SELECT count(*) FROM public.billing_underlay_items WHERE company_id=${company()} AND billing_underlay_id=${lit(underlayId)}),
      'matched',(SELECT count(DISTINCT e->>'billingUnderlayItemId') FROM public.customer_invoices i, jsonb_array_elements(i.calculation_snapshot->'interval_evidence') e
        WHERE i.id=${lit(invoice.id)} AND (e->>'billingUnderlayItemId')::uuid IN (SELECT id FROM public.billing_underlay_items WHERE company_id=${company()} AND billing_underlay_id=${lit(underlayId)})))`)
    expect(itemLinks).toEqual({ evidenceItems: 2688, underlayItems: 2688, matched: 2688 })
    results['MAIN04.03'] = { oracle: { ex: centsText(o.totalExVatCents), vat: centsText(o.vatCents.total), inc: centsText(o.totalIncVatCents), kwh: o.totalKwhText }, evidence: evidence.length }
    await recordPreparedDraftCandidate(fx, draft)
  })

  // HOLD: separate independent actual-draft acceptance and T4 repeat handoff
  // are not implemented/admitted by this source packet. Preserve the original
  // negative/approval body below without executing service-role tamper/approve.
  it.skip('MAIN04.04 Approve efter oberoende kvitto: kvittot läses före, approve binder exakt samma sha/belopp, ändrat utkast vägras', async () => {
    const draft = readDraft()
    expect(draft.invoices).toHaveLength(1)
    const [invoice] = draft.invoices, [item] = draft.items
    const o = fx.oracle

    // (a) Independent receipt: read the ACTUAL locked draft and compare with the oracle and with the pricing run lock.
    expect(draft.pricingRun?.status, 'the draft is locked via its locked pricing run').toBe('locked')
    expect(draft.pricingRun?.lockedAt).toBeTruthy()
    receipt = { itemId: item.id, invoiceId: invoice.id, underlayId, pricingRunId: item.pricingRun, calculationSha: String(invoice.sha), totalKwh: Number(invoice.kwh),
      ex: cents(invoice.ex), vat: cents(invoice.vat), inc: cents(invoice.inc), priceArea: String(invoice.area) }
    expect(receipt.calculationSha).toMatch(/^[a-f0-9]{64}$/)
    expect(item.metaSha).toBe(receipt.calculationSha)
    expect({ ex: receipt.ex, vat: receipt.vat, inc: receipt.inc }).toEqual({ ex: o.totalExVatCents, vat: o.vatCents.total, inc: o.totalIncVatCents })
    const stored = dbRead<{ snapshot: unknown }>(`SELECT jsonb_build_object('snapshot',calculation_snapshot) FROM public.customer_invoices WHERE id=${lit(invoice.id)}`).snapshot
    // Recomputed from the stored snapshot with this harness's own canonical JSON (soft evidence, see results).
    const recomputed = sha256Hex(stored)
    results['MAIN04.04.receipt'] = { ...receipt, storedSnapshotRecomputeMatches: recomputed === receipt.calculationSha }

    // APPROVE ROUTE. SUBSTITUTE: approveAndSendReadyInvoicesAction is a Next server action (requires a browser form post with action
    // id and cookies); the library function it calls is invoked directly with the same arguments
    // (billing month, company, actor) — verifierar inte åtgärdens auth-kontroll (requireAdminActionAccess), UI-formuläret eller den
    // förberedelse (prepareInvoiceDraftsForReview) som åtgärden kör före approve.
    substitute({ id: 'approve-action-direct', step: 'MAIN04.04 approve', substitute: 'approveAndSendReadyInvoicesForMonth called directly (file_export provider = approve-only)',
      notVerified: 'server action auth/permission check, the form post, and the action preparing drafts first' })
    const approve = () => approveAndSendReadyInvoicesForMonth({ companyId: fx.companyId, billingMonth: BILLING_MONTH, actorUserId: fx.actorUserId })

    // (d) Negative cases, before the real approval. Changes are made by service role and always undone.
    // SUBSTITUTE: direct updates of customer_invoices instead of a normal edit path — verifierar inte att en användare kan ändra utkastet;
    // verifierar bara om approve upptäcker en ändring som skett efter kvittot.
    substitute({ id: 'draft-tamper', step: 'MAIN04.04 negative cases', substitute: 'service-role UPDATE of customer_invoices (amount_inc_vat, calculation_snapshot_sha256), restored afterwards',
      notVerified: 'any user-facing way to change a draft; only approve-time detection of a post-receipt change is tested' })
    const negative: Record<string, unknown> = {}
    const tamper = async (name: string, patch: Record<string, unknown>, original: Record<string, unknown>) => {
      const update = await supabaseService.from('customer_invoices').update(patch).eq('company_id', fx.companyId).eq('id', invoice.id)
      if (update.error) { negative[name] = { blockedByDatabase: update.error.message }; return { blocked: true as const } }
      try {
        const outcome = await approve()
        const after = readDraft()
        negative[name] = { outcome, approvalAfter: after.items[0]?.approval?.status ?? null }
        return { blocked: false as const, approved: outcome.approved, failed: outcome.failed, errors: outcome.errors, approvalStatus: after.items[0]?.approval?.status }
      } finally {
        await supabaseService.from('customer_invoices').update(original).eq('company_id', fx.companyId).eq('id', invoice.id)
        const current = readDraft()
        if (current.items[0]?.approval?.status === 'approved') {
          // Keep the positive path testable after a missed refusal: put the pending-review approval metadata back (harness cleanup).
          await supabaseService.from('invoice_export_items').update({ metadata: { ...(await currentMetadata('invoice_export_items', item.id)), approval: item.approval } }).eq('company_id', fx.companyId).eq('id', item.id)
          await supabaseService.from('customer_invoices').update({ metadata: { ...(await currentMetadata('customer_invoices', invoice.id)), approval: invoice.approval } }).eq('company_id', fx.companyId).eq('id', invoice.id)
        }
      }
    }
    const missedRefusals: string[] = []
    const amount = await tamper('amount_changed_after_receipt', { amount_inc_vat: Number(invoice.inc) + 1 }, { amount_inc_vat: Number(invoice.inc) })
    if (!amount.blocked && (amount.approved !== 0 || amount.failed !== 1)) missedRefusals.push(`amount_inc_vat changed by +1 SEK after the receipt was approved (outcome ${JSON.stringify(negative.amount_changed_after_receipt)})`)
    const sha = await tamper('snapshot_sha_changed_after_receipt', { calculation_snapshot_sha256: 'f'.repeat(64) }, { calculation_snapshot_sha256: receipt.calculationSha })
    if (!sha.blocked && (sha.approved !== 0 || sha.failed !== 1)) missedRefusals.push(`calculation_snapshot_sha256 replaced after the receipt was approved (outcome ${JSON.stringify(negative.snapshot_sha_changed_after_receipt)})`)
    results['MAIN04.04.negative'] = negative

    // Restored state must equal the receipt before the real approval.
    const restored = readDraft()
    expect(restored.invoices[0].sha).toBe(receipt.calculationSha)
    expect(cents(restored.invoices[0].inc)).toBe(receipt.inc)
    expect(restored.items[0].approval?.status).toBe('pending_review')

    // (b) Real approval through the normal library path.
    const outcome = await timed('MAIN04.04 approve', () => approve())
    results['MAIN04.04.approve'] = outcome
    expect(outcome).toMatchObject({ approved: 1, sent: 0, failed: 0, errors: [], approveOnly: true })

    // (c) The approved invoice carries exactly the receipt's sha and amounts.
    const done = readDraft()
    const [approvedInvoice] = done.invoices, [approvedItem] = done.items
    expect(approvedInvoice.sha).toBe(receipt.calculationSha)
    expect(approvedInvoice.approval).toMatchObject({ status: 'approved', calculation_snapshot_sha256: receipt.calculationSha })
    expect(approvedItem.approval).toMatchObject({ status: 'approved', calculation_snapshot_sha256: receipt.calculationSha })
    expect(approvedItem.approval?.approved_by).toBe(fx.actorUserId)
    expect(approvedItem.approval?.review_hash).toBe(expectedReviewHash({ itemId: item.id, underlayId, pricingRunId: item.pricingRun, calculationSha: receipt.calculationSha,
      totalKwh: receipt.totalKwh, totalIncVat: Number(approvedInvoice.inc), priceArea: receipt.priceArea }))
    expect({ ex: cents(approvedInvoice.ex), vat: cents(approvedInvoice.vat), inc: cents(approvedInvoice.inc) }).toEqual({ ex: receipt.ex, vat: receipt.vat, inc: receipt.inc })
    expect({ ex: cents(approvedItem.ex), vat: cents(approvedItem.vat), inc: cents(approvedItem.inc) }).toEqual({ ex: receipt.ex, vat: receipt.vat, inc: receipt.inc })
    // Approve-only: still unsent, no provider attempt, no file, no invoice sent.
    expect(approvedItem.status).toBe('pending')
    expect(approvedInvoice.status).toBe('draft')
    expect(done.attempts).toBe(0)
    expect(done.files).toBe(0)

    // The refusal expectations are asserted last so the positive path above is always evidenced first.
    expect(missedRefusals, 'PRODUCT FINDING CANDIDATE: approve (lib/billing/invoiceApprovedDispatch.ts approveItem/assertItemStillReady :100-175) must refuse a draft that was changed after the independent receipt; it only checks that the snapshot sha is non-empty and that amounts equal the locked pricing run, and it never compares with a receipt').toEqual([])
  }, 900_000)
})

async function currentMetadata(table: 'invoice_export_items' | 'customer_invoices', id: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseService.from(table).select('metadata').eq('id', id).single()
  if (error) throw error
  return ((data as { metadata?: Record<string, unknown> }).metadata ?? {})
}
