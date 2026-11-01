// Track 4 scenario: invoice drafts -> approval -> invoice file (MAIN04.02/.05, BILLNEG01.01-.04, MAIN05.01-.06).
//
// Run:  bash scripts/simulation/track4/run.sh scripts/simulation/track4/scenarios/billing-invoice-files.mjs [--only MAIN05.03]
// Every step name starts with its scenario ID. The assertions below are my reading of each ID's expected effect
// from the task text; they are NOT the register's qualified oracle (not read by the harness author). Before a step
// is used as evidence for an ID, check its assertions against that ID's rule/acceptance entry.
// Step `scope` tells the executionScope: all steps here are HTTP/API/server-action + SQL reads; none uses a
// browser (no Playwright), the server actions are posted as a no-JS form post.
import { randomUUID } from 'node:crypto'
import { fixtureSteps, ensureSession } from '../fixtures/seed.mjs'
import { FIXTURE_MONTHS } from '../fixtures/expected.mjs'
import { lit } from '../runner/lib/sql.mjs'
import { countsFor, diffCounts, prepare, runAction, actionId, getFile, itemsFor, filesFor, pricingRunsFor, rowsSha256, money, assertCreateFileRedirect, assertApproveRedirect, assertFileReplayRedirect, assertPrepareResponse, assertFileNotFound, assertAnonymousFileLogin, freezeFileSnapshot, assertInvoiceJson, assertInvoiceXml } from '../fixtures/flows.mjs'

const M = FIXTURE_MONTHS
const N = Number(process.env.T4_CONCURRENCY ?? 10)
const DENIED_FILE_FORMATS = [undefined, 'nordfin_xml', 'json', 'csv', 'xlsx']
const histogram = (list) => list.reduce((h, v) => ((h[v] = (h[v] ?? 0) + 1), h), {})

async function concurrentActors(ctx) {
  ctx.assert.ok(Number.isSafeInteger(N) && N >= 2 && N <= 100, 'bounded concurrency requires 2–100 requests')
  const fx = ctx.fixture
  ctx.assert.ok(fx.userA?.id && fx.userA2?.id && fx.userA.id !== fx.userA2.id, 'two distinct qualified same-tenant actors required')
  const actors = [await ensureSession(ctx, 'A'), await ensureSession(ctx, 'A2')]
  ctx.assert.equal(actors[0].userId, fx.userA.id, 'first actual Auth identity must match fixture actor A')
  ctx.assert.equal(actors[1].userId, fx.userA2.id, 'second actual Auth identity must match fixture actor A2')
  ctx.value('actorIds', actors.map(actor => actor.userId))
  return actors
}

async function frozenXml(ctx, session, label) {
  const fx = ctx.fixture
  const file = (await filesFor(ctx.sql, fx.companyA)).find(row => row.id === fx.fileId)
  ctx.assert.deepEqual(file, fx.fileRow, 'complete frozen file snapshot must remain unchanged')
  const download = await getFile(ctx, session, fx.fileId, { format: 'nordfin_xml', label })
  ctx.assert.equal(download.status, 200, 'protected replay XML must remain downloadable')
  assertInvoiceXml(download, fx.fileRow)
  return download
}

function sameReplayBytes(ctx, before, after, prefix) {
  ctx.assert.equal(after.sha256, before.sha256, 'protected replay body hash must remain unchanged')
  ctx.assert.deepEqual(after.bytes, before.bytes, 'protected replay raw bytes must remain unchanged')
  ctx.file(`${prefix}-before.xml`, before.bytes)
  ctx.file(`${prefix}-after.xml`, after.bytes)
}

/** Amounts of the single invoice in `items` must equal the independently computed expectation. */
function assertAmounts(ctx, item, expectedKey) {
  const e = ctx.fixture.expected[expectedKey].exact_per_line
  ctx.assert.equal(money(item.amount_ex_vat), e.total_ex_vat, 'amount_ex_vat vs oracle candidate')
  ctx.assert.equal(money(item.vat_amount), e.total_vat, 'vat_amount vs oracle candidate')
  ctx.assert.equal(money(item.amount_inc_vat), e.total_inc_vat, 'amount_inc_vat vs oracle candidate')
  const f = ctx.fixture.expected[expectedKey].js_float
  if (money(item.amount_inc_vat) !== f.total_inc_vat) ctx.finding(`product amount_inc_vat ${money(item.amount_inc_vat)} differs from the float formula ${f.total_inc_vat}`)
}

const steps = [
  ...fixtureSteps().map((s) => ({ ...s, fixture: true })),

  {
    id: 'MAIN04.02', title: 'prepare invoice drafts twice -> one draft graph, second call changes nothing', scope: 'api+sql-read',
    needs: ['FX04', 'FX05', 'FX06'],
    async run(ctx) {
      const fx = ctx.fixture, s = await ensureSession(ctx, 'A'), month = M.main.month
      const before = await countsFor(ctx.sql, fx.companyA)
      const t0 = new Date().toISOString()
      const r1 = await prepare(ctx, s, { companyId: fx.companyA, month, label: 'prepare #1' })
      ctx.assert.equal(r1.status, 200, `prepare #1: ${r1.text().slice(0, 300)}`)
      const d1 = r1.json().data
      ctx.value('prepare1', d1)
      // The API masks the cause (invoiceReviewPrepare.ts:454); the Postgres log has the real RPC error.
      ctx.assert.equal(d1.failed, 0, `prepare #1 errors: ${JSON.stringify(d1.errors)}; db log: ${JSON.stringify(await ctx.dbErrorsSince(t0))}`)
      ctx.assert.equal(d1.created, 1, 'prepare #1 must create exactly one draft')
      const mid = await countsFor(ctx.sql, fx.companyA)
      const delta = diffCounts(before, mid)
      ctx.value('delta1', delta)
      for (const t of ['invoice_export_runs', 'invoice_export_items', 'customer_invoices']) ctx.assert.equal(delta[t] ?? 0, 1, `${t} +1 after first prepare`)
      const items = await itemsFor(ctx.sql, fx.companyA, month)
      ctx.assert.equal(items.length, 1)
      ctx.assert.equal(items[0].status, 'pending')
      assertAmounts(ctx, items[0], 'main')
      const pr = await pricingRunsFor(ctx.sql, fx.companyA, fx.underlays.main)
      ctx.value('pricingRuns', pr.map((p) => ({ id: p.id, status: p.status, locked: !!p.locked_at })))
      ctx.assert.ok(pr.some((p) => p.locked_at), 'a locked pricing run must back the draft')
      const lines = await ctx.sql.rows(`SELECT amount_ex_vat, vat_amount FROM public.pricing_preview_lines WHERE pricing_run_id=${lit(items[0].pricing_run_id)} ORDER BY sort_order`)
      const e = ctx.fixture.expected.main.exact_per_line
      ctx.assert.deepEqual(lines.map((l) => [money(l.amount_ex_vat), money(l.vat_amount)]), [[e.energy_ex_vat, e.energy_vat], [e.fee_ex_vat, e.fee_vat]], 'pricing lines vs oracle candidate')
      fx.mainItemId = items[0].id

      const r2 = await prepare(ctx, s, { companyId: fx.companyA, month, label: 'prepare #2' })
      ctx.assert.equal(r2.status, 200, `prepare #2: ${r2.text().slice(0, 300)}`)
      const d2 = r2.json().data
      ctx.value('prepare2', d2)
      ctx.assert.equal(d2.created, 0, 'second prepare must create nothing')
      ctx.assert.equal(d2.alreadyPrepared, 1)
      const after = await countsFor(ctx.sql, fx.companyA)
      ctx.assert.deepEqual(diffCounts(mid, after), {}, 'no row count may change on the second prepare')
      const items2 = await itemsFor(ctx.sql, fx.companyA, month)
      ctx.assert.deepEqual(items2.map((i) => i.id), items.map((i) => i.id), 'same draft ids')
    },
  },

  {
    id: 'MAIN04.05', title: 'approve drafts twice -> approved once, second call changes nothing', scope: 'api(server action)+sql-read', needs: ['MAIN04.02'],
    note: 'Approval has no JSON API: it is the server action approveAndSendReadyInvoicesAction posted as a form (see fixtures/flows.mjs). File providers approve only (no send).',
    async run(ctx) {
      const fx = ctx.fixture, s = await ensureSession(ctx, 'A'), month = M.main.month
      const a1 = await runAction(ctx, s, 'approve', month, 'approve #1')
      ctx.value('approve1', { status: a1.status, params: a1.params })
      ctx.assert.equal(assertApproveRedirect(a1, month), 1, 'first approval must create exactly one approval')
      const [item1] = await itemsFor(ctx.sql, fx.companyA, month)
      ctx.assert.equal(item1.approval?.status, 'approved')
      ctx.assert.ok(item1.approval.approved_at && item1.approval.review_hash && item1.approval.approved_by === fx.userA.id, 'approval record complete')
      const ev = () => ctx.sql.scalar(`SELECT count(*) FROM public.domain_events WHERE company_id=${lit(fx.companyA)} AND event_type='invoice.approved' AND aggregate_id=${lit(item1.id)}`)
      ctx.assert.equal(Number(await ev()), 1, 'one invoice.approved event')
      const mid = await countsFor(ctx.sql, fx.companyA)
      const a2 = await runAction(ctx, s, 'approve', month, 'approve #2')
      ctx.value('approve2', { status: a2.status, params: a2.params })
      ctx.assert.equal(assertApproveRedirect(a2, month), 0, 'second approve must approve nothing new')
      const [item2] = await itemsFor(ctx.sql, fx.companyA, month)
      ctx.assert.deepEqual(item2.approval, item1.approval, 'approval record (time, hash, actor) unchanged')
      ctx.assert.equal(Number(await ev()), 1, 'still one invoice.approved event')
      ctx.assert.deepEqual(diffCounts(mid, await countsFor(ctx.sql, fx.companyA)), {})
    },
  },

  {
    id: 'BILLNEG01.01', title: `N=${N} concurrent prepare for one month -> exactly one draft graph`, scope: 'api+sql-read', needs: ['FX04', 'FX05', 'FX06'],
    async run(ctx) {
      const fx = ctx.fixture, actors = await concurrentActors(ctx), month = M.concurrentPrepare.month
      const before = await countsFor(ctx.sql, fx.companyA)
      const t0 = new Date().toISOString()
      const results = await Promise.all(Array.from({ length: N }, (_, i) => prepare(ctx, actors[i % actors.length], { companyId: fx.companyA, month, label: `prepare concurrent #${i + 1}` })))
      const statuses = results.map((r) => r.status)
      ctx.value('statusHistogram', histogram(statuses))
      ctx.value('createdPerResponse', results.map((r) => { try { return r.json().data?.created ?? null } catch { return null } }))
      const preparations = results.map(result => assertPrepareResponse(result, month))
      ctx.assert.equal(preparations.reduce((sum, result) => sum + result.created, 0), 1, 'exactly one response may claim the preparation win')
      const after = await countsFor(ctx.sql, fx.companyA)
      const delta = diffCounts(before, after)
      ctx.value('delta', delta)
      for (const t of ['invoice_export_runs', 'invoice_export_items', 'customer_invoices']) ctx.assert.equal(delta[t] ?? 0, 1, `${t}: exactly one after ${N} concurrent prepares (response created=${JSON.stringify(ctx.step.evidence.values.createdPerResponse)}; db log: ${JSON.stringify(await ctx.dbErrorsSince(t0))})`)
      const items = await itemsFor(ctx.sql, fx.companyA, month)
      ctx.assert.equal(items.length, 1)
      assertAmounts(ctx, items[0], 'concurrentPrepare')
      const pr = await pricingRunsFor(ctx.sql, fx.companyA, fx.underlays.concurrentPrepare)
      ctx.value('pricingRunCount', pr.length)
      if (pr.length !== 1) ctx.finding(`${pr.length} pricing_runs exist for the underlay after ${N} concurrent prepares (draft graph is exactly-once, pricing runs are not)`)
    },
  },

  {
    id: 'BILLNEG01.02', title: `N=${N} concurrent approve -> approved exactly once`, scope: 'api(server action)+sql-read', needs: ['FX04', 'FX05', 'FX06'],
    async run(ctx) {
      const fx = ctx.fixture, actors = await concurrentActors(ctx), s = actors[0], month = M.concurrentApprove.month
      const p = await prepare(ctx, s, { companyId: fx.companyA, month, label: 'prepare (setup)' })
      ctx.assert.equal(p.status, 200, p.text().slice(0, 200))
      ctx.assert.equal(p.json().data.failed, 0, 'approval setup must not contain failed preparations')
      ctx.assert.deepEqual(p.json().data.errors, [], 'approval setup must not hide preparation errors')
      ctx.assert.equal(p.json().data.created, 1, `setup prepare created ${p.json().data.created}: ${JSON.stringify(p.json().data.errors)}; db log: ${JSON.stringify(await ctx.dbErrorsSince(new Date(Date.now() - 60_000).toISOString()))}`)
      await actionId(ctx, s, 'approve', month) // resolve (and cache) the action id once, before the burst
      const before = await countsFor(ctx.sql, fx.companyA)
      const results = await Promise.all(Array.from({ length: N }, (_, i) => runAction(ctx, actors[i % actors.length], 'approve', month, `approve concurrent #${i + 1}`)))
      ctx.value('statusHistogram', histogram(results.map((r) => r.status)))
      ctx.value('approvedPerResponse', results.map((r) => r.params.approved ?? null))
      const approvedCounts = results.map(r => assertApproveRedirect(r, month))
      const totalApproved = approvedCounts.reduce((n, count) => n + count, 0)
      ctx.assert.equal(totalApproved, 1, 'sum of "approved" over all responses must be exactly 1')
      const [item] = await itemsFor(ctx.sql, fx.companyA, month)
      ctx.assert.equal(item.approval?.status, 'approved')
      const winningActor = actors[approvedCounts.indexOf(1) % actors.length]
      ctx.assert.equal(item.approval.approved_by, winningActor.userId, 'stored approval must belong to the actual actor reporting the unique win')
      ctx.assert.ok(typeof item.approval.approved_at === 'string' && Number.isFinite(Date.parse(item.approval.approved_at)), 'winning approval timestamp required')
      ctx.assert.match(item.approval.review_hash ?? '', /^[0-9a-f]{64}$/, 'winning review hash required')
      assertAmounts(ctx, item, 'concurrentApprove')
      const totalEvents = Number(await ctx.sql.scalar(`SELECT count(*) FROM public.domain_events WHERE company_id=${lit(fx.companyA)} AND event_type='invoice.approved' AND aggregate_id=${lit(item.id)}`))
      ctx.assert.equal(totalEvents, 1, 'exactly one approval event in total, including malformed or foreign-actor events')
      const events = Number(await ctx.sql.scalar(`SELECT count(*) FROM public.domain_events WHERE company_id=${lit(fx.companyA)} AND event_type='invoice.approved' AND aggregate_id=${lit(item.id)}
        AND actor_user_id=${lit(item.approval.approved_by)} AND payload->>'review_hash'=${lit(item.approval.review_hash)}`))
      ctx.assert.equal(events, 1, 'one invoice.approved event')
      ctx.value('delta', diffCounts(before, await countsFor(ctx.sql, fx.companyA)))
    },
  },

  {
    id: 'MAIN05.01', title: 'create invoice file from the approved snapshot', scope: 'api(server action)+sql-read', needs: ['MAIN04.05'],
    async run(ctx) {
      const fx = ctx.fixture, s = await ensureSession(ctx, 'A'), month = M.main.month
      const filesBefore = (await filesFor(ctx.sql, fx.companyA)).length
      const a = await runAction(ctx, s, 'createFile', month, 'create file #1')
      ctx.value('create1', { status: a.status, params: a.params })
      assertCreateFileRedirect(a, month)
      fx.fileId = a.params.file
      const files = await filesFor(ctx.sql, fx.companyA)
      ctx.assert.equal(files.length, filesBefore + 1, 'one new invoice_export_files row')
      const file = files.find((f) => f.id === fx.fileId)
      ctx.assert.ok(file, 'file row for the redirected id')
      ctx.assert.equal(file.billing_month, month); ctx.assert.equal(file.provider, fx.provider); ctx.assert.equal(file.row_count, 1)
      ctx.assert.equal(file.rows_sha256, rowsSha256(file.rows), 'stored rows_sha256 equals sha256 of the stored rows')
      const e = ctx.fixture.expected.main.exact_per_line
      ctx.assert.equal(money(file.rows[0].amount_ex_vat), e.total_ex_vat)
      ctx.assert.equal(money(file.rows[0].vat_amount), e.total_vat)
      ctx.assert.equal(money(file.rows[0].amount_inc_vat), e.total_inc_vat)
      ctx.assert.equal(Number(file.rows[0].kwh), Number((ctx.fixture.months ?? M).main.kwh))
      const [item] = await itemsFor(ctx.sql, fx.companyA, month)
      ctx.assert.equal(item.export_file_id, fx.fileId, 'item is bound to the file')
      ctx.value('item', { status: item.status, export_file_id: item.export_file_id })
      const dl = await getFile(ctx, s, fx.fileId, { format: 'json', label: 'GET file (json) after create' })
      ctx.assert.equal(dl.status, 200)
      ctx.file('invoice-file.json', dl.bytes)
      assertInvoiceJson(dl, file)
      fx.fileRow = freezeFileSnapshot(file)
    },
  },

  {
    id: 'MAIN05.02', title: 'create invoice file twice -> second call creates no file', scope: 'api(server action)+sql-read', needs: ['MAIN05.01'],
    async run(ctx) {
      const fx = ctx.fixture, s = await ensureSession(ctx, 'A'), month = M.main.month
      const original = await frozenXml(ctx, s, 'MAIN05.02 XML before replay')
      const before = await countsFor(ctx.sql, fx.companyA)
      const a = await runAction(ctx, s, 'createFile', month, 'create file #2')
      ctx.value('create2', { status: a.status, params: a.params })
      assertFileReplayRedirect(a, month)
      ctx.assert.deepEqual(diffCounts(before, await countsFor(ctx.sql, fx.companyA)), {})
      sameReplayBytes(ctx, original, await frozenXml(ctx, s, 'MAIN05.02 XML after replay'), 'MAIN05.02-replay')
    },
  },

  {
    id: 'MAIN05.03', title: 'two authenticated GETs of /admin/billing/invoice-files/<id> return byte-identical content', scope: 'api', needs: ['MAIN05.01'],
    async run(ctx) {
      const fx = ctx.fixture, s = await ensureSession(ctx, 'A')
      // Explicit XML is supported by both real file providers; their default format is not this oracle.
      const formats = ['nordfin_xml', undefined, ...(fx.provider === 'nordfin' ? ['xlsx', 'csv'] : ['csv', 'xlsx', 'json'])]
      for (const format of formats) {
        const g1 = await getFile(ctx, s, fx.fileId, { format, label: `GET #1 ${format ?? 'default'}` })
        const g2 = await getFile(ctx, s, fx.fileId, { format, label: `GET #2 ${format ?? 'default'}` })
        ctx.assert.equal(g1.status, 200, `format ${format}`); ctx.assert.equal(g2.status, 200)
        if (format === 'nordfin_xml') { assertInvoiceXml(g1, fx.fileRow); assertInvoiceXml(g2, fx.fileRow) }
        ctx.assert.ok(g1.bytes.length > 0, 'non-empty body')
        ctx.assert.equal(g1.sha256, g2.sha256, `sha256 equal for format ${format ?? 'default'}`)
        ctx.assert.equal(g1.bytes.length, g2.bytes.length)
        ctx.assert.deepEqual(g1.bytes, g2.bytes, `raw bytes equal for format ${format ?? 'default'}`)
        ctx.file(`file-${format ?? 'default'}`, g1.bytes)
      }
    },
  },

  {
    id: 'MAIN05.04', title: 'anonymous GET of an invoice file returns no file bytes', scope: 'api', needs: ['MAIN05.01'],
    async run(ctx) {
      const fx = ctx.fixture, owner = await ensureSession(ctx, 'A')
      const control = await getFile(ctx, owner, fx.fileId, { format: 'nordfin_xml', label: 'anonymous test control: owner XML' })
      ctx.assert.equal(control.status, 200, 'a real owned file must be available before anonymous probes')
      assertInvoiceXml(control, fx.fileRow)
      for (const format of DENIED_FILE_FORMATS) {
        const target = `/admin/billing/invoice-files/${fx.fileId}${format ? `?format=${format}` : ''}`
        const response = await getFile(ctx, null, fx.fileId, { format, label: `anonymous GET ${format ?? 'default'}` })
        assertAnonymousFileLogin(response, ctx.env.T4_APP_URL, target)
        ctx.value(`anon_${format ?? 'default'}`, { status: response.status, location: response.location, bytes: response.bytes.length })
      }
    },
  },

  {
    id: 'MAIN05.05', title: 'unknown UUID and malformed id -> 404', scope: 'api', needs: ['FX06'],
    note: 'Needs only the staff session (no fixture data, no file).',
    async run(ctx) {
      const a = await ensureSession(ctx, 'A')
      const unknownId = randomUUID()
      for (const format of DENIED_FILE_FORMATS) {
        assertFileNotFound(await getFile(ctx, a, unknownId, { format, label: `unknown uuid (A) ${format ?? 'default'}` }))
        assertFileNotFound(await getFile(ctx, a, 'not-a-uuid', { format, label: `malformed id (A) ${format ?? 'default'}` }))
      }
    },
  },

  {
    id: 'MAIN05.05b', scenarioId: 'MAIN05.05', title: 'invoice file id of another tenant -> 404 (and own file still 200)', scope: 'api', needs: ['MAIN05.01'],
    async run(ctx) {
      const fx = ctx.fixture, a = await ensureSession(ctx, 'A'), b = await ensureSession(ctx, 'B')
      // Establish the file is real and readable by its owner before interpreting a denial.
      const own = await getFile(ctx, a, fx.fileId, { format: 'nordfin_xml', label: 'control: tenant A own XML' })
      ctx.assert.equal(own.status, 200, 'control request still works')
      assertInvoiceXml(own, fx.fileRow)
      for (const format of DENIED_FILE_FORMATS) {
        assertFileNotFound(await getFile(ctx, b, fx.fileId, { format, label: `tenant A file requested by B ${format ?? 'default'}` }))
      }
    },
  },

  {
    id: 'MAIN05.06', title: "'-' x 36 as file id -> exact 404 not-found response", scope: 'api', needs: ['FX06'],
    note: 'Regression for the original weak UUID guard. Authentication, permission or rate-limit failures must not count as a controlled malformed-ID response.',
    async run(ctx) {
      const a = await ensureSession(ctx, 'A')
      const r = await getFile(ctx, a, '-'.repeat(36), { label: "GET id='-'x36" })
      ctx.value('status', r.status)
      assertFileNotFound(r)
    },
  },

  {
    id: 'BILLNEG01.03', title: 'file replay creates nothing; direct UPDATE of invoice_export_files is refused with 42501', scope: 'api+sql', needs: ['MAIN05.01'],
    note: 'The append-only trigger raises 42501 for every role (also postgres), so the direct UPDATE is tried through psql (postgres), PostgREST as service_role and PostgREST as the staff user.',
    async run(ctx) {
      const fx = ctx.fixture, s = await ensureSession(ctx, 'A'), month = M.main.month
      const original = await frozenXml(ctx, s, 'BILLNEG01.03 XML before replay')
      const before = await countsFor(ctx.sql, fx.companyA)
      const replay = await runAction(ctx, s, 'createFile', month, 'file replay')
      assertFileReplayRedirect(replay, month)
      ctx.assert.deepEqual(diffCounts(before, await countsFor(ctx.sql, fx.companyA)), {})

      const target = lit(fx.fileId)
      const direct = await ctx.sql.attempt(`UPDATE public.invoice_export_files SET rows_sha256=repeat('0',64) WHERE id=${target}`)
      ctx.value('psqlUpdate', direct)
      ctx.assert.equal(direct.ok, false, 'direct UPDATE must fail'); ctx.assert.equal(direct.code, '42501')
      const directRows = await ctx.sql.attempt(`UPDATE public.invoice_export_files SET rows='[]'::jsonb WHERE id=${target}`)
      ctx.assert.equal(directRows.code, '42501', 'UPDATE of rows must fail with 42501')

      const rest = async (label, token) => {
        const res = await fetch(`${ctx.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/invoice_export_files?id=eq.${fx.fileId}`, {
          method: 'PATCH', headers: { apikey: label === 'service_role' ? ctx.env.SUPABASE_SERVICE_ROLE_KEY : ctx.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
          body: JSON.stringify({ rows_sha256: '0'.repeat(64) }),
        })
        const text = await res.text()
        let code = null; try { code = JSON.parse(text).code } catch { /* not json */ }
        return { httpStatus: res.status, code, bodyBytes: text.length }
      }
      const svc = await rest('service_role', ctx.env.SUPABASE_SERVICE_ROLE_KEY)
      const usr = await rest('authenticated', s.accessToken)
      ctx.value('postgrestServiceRole', svc); ctx.value('postgrestStaff', usr)
      ctx.assert.equal(svc.code, '42501', 'service_role PATCH must be refused with 42501')
      ctx.assert.ok(usr.code === '42501' || usr.httpStatus === 401 || usr.httpStatus === 403 || usr.httpStatus === 404 || usr.bodyBytes <= 2, `staff PATCH must not change the row (http ${usr.httpStatus} code ${usr.code})`)

      const [row] = await filesFor(ctx.sql, fx.companyA).then((rows) => rows.filter((r) => r.id === fx.fileId))
      ctx.assert.equal(row.rows_sha256, fx.fileRow.rows_sha256, 'rows_sha256 unchanged')
      ctx.assert.equal(rowsSha256(row.rows), row.rows_sha256, 'rows still hash to rows_sha256')
      sameReplayBytes(ctx, original, await frozenXml(ctx, s, 'BILLNEG01.03 XML after replay and mutation probes'), 'BILLNEG01.03-replay')
    },
  },

  {
    id: 'BILLNEG01.04a', scenarioId: 'BILLNEG01.04', title: 'after the file exists: re-generating the underlay and editing the locked underlay do not change billed data', scope: 'api+sql', needs: ['MAIN05.01'],
    note: 'PARTIAL for BILLNEG01.04: probes the API (generate-underlay) and a direct UPDATE of the exported underlay. A genuinely NEW qualified meter value needs the inbound UTILTS fixture (see BILLNEG01.04b).',
    async run(ctx) {
      const fx = ctx.fixture, s = await ensureSession(ctx, 'A'), month = M.main.month
      const snapshotRow = () => ctx.sql.one(`SELECT status, readiness_status, total_kwh, updated_at FROM public.billing_underlays WHERE id=${lit(fx.underlays.main)}`)
      const lock = await ctx.sql.rows(`SELECT status, locked_at FROM public.billing_period_locks WHERE company_id=${lit(fx.companyA)} AND billing_month=${lit(month)}`)
      ctx.value('periodLock', lock)
      const u0 = await snapshotRow(); const c0 = await countsFor(ctx.sql, fx.companyA)
      const gen = await ctx.http.post('/api/internal/billing/generate-underlay', { cookie: s.cookie(), json: { billing_month: month }, label: 'generate-underlay after file' })
      ctx.value('generateStatus', gen.status)
      ctx.assert.ok(gen.status < 500, `generate-underlay must not fail with ${gen.status}`)
      const u1 = await snapshotRow()
      ctx.assert.deepEqual(u1, u0, 'exported underlay unchanged by re-generation')
      ctx.assert.equal(diffCounts(c0, await countsFor(ctx.sql, fx.companyA)).invoice_export_items, undefined, 'no new export items')
      if (lock.length > 0) ctx.assert.equal(gen.status, 409, 'locked period: generate-underlay answers 409')
      else ctx.finding('no billing_period_locks row for the month after the file was created; lock behaviour not exercised')
      const probe = await ctx.sql.attempt(`BEGIN; UPDATE public.billing_underlays SET total_kwh=total_kwh+1 WHERE id=${lit(fx.underlays.main)}; ROLLBACK;`)
      ctx.value('directUpdateOfExportedUnderlay', probe)
      if (probe.ok) ctx.finding('direct UPDATE of an exported underlay.total_kwh is NOT refused by the database (rolled back by the probe)')
      ctx.assert.deepEqual(await snapshotRow(), u0, 'probe left the row unchanged')
    },
  },
  {
    id: 'BILLNEG01.04b', scenarioId: 'BILLNEG01.04', title: 'new qualified meter value arrives after the pricing lock / file creation -> billed amounts stay', scope: 'api+sql+ediel-inbound',
    todo: 'needs a genuine inbound UTILTS E66 message (ediel_messages + metering_values + normalized_metering_values with a qualifying billing_source_basis) for the fixture meter; T4-FX04b. Then: insert it after lock, POST generate-underlay, assert invoice/pricing/file unchanged and the value held back or flagged.',
  },
]

export const scenarios = [{ id: 'T4-BILLING-INVOICE-FILES', title: 'Invoice drafts, approval and invoice files (MAIN04/05, BILLNEG01)', steps }]
