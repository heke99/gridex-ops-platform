// Product-entrypoint helpers shared by the T4 scenario steps. Everything here goes through the running app
// (HTTP API routes, Next server actions posted exactly like a browser form post, authenticated file download)
// or reads rows; nothing here writes billing tables.
import { createHash } from 'node:crypto'
import { lit } from '../runner/lib/sql.mjs'

/** Tables whose row counts are recorded before/after every step (all carry company_id). */
export const COUNT_TABLES = [
  'billing_underlays', 'pricing_runs', 'pricing_preview_lines', 'invoice_export_runs', 'invoice_export_items',
  'customer_invoices', 'customer_invoice_lines', 'invoice_export_files', 'billing_export_runs', 'billing_export_run_items', 'billing_period_locks',
]

export async function countsFor(sql, companyId) {
  const out = {}
  for (const t of COUNT_TABLES) out[t] = Number(await sql.scalar(`SELECT count(*) FROM public.${t} WHERE company_id=${lit(companyId)}`))
  out.domain_events_invoice = Number(await sql.scalar(`SELECT count(*) FROM public.domain_events WHERE company_id=${lit(companyId)} AND event_type LIKE 'invoice.%'`))
  return out
}

export function diffCounts(before, after) {
  const d = {}
  for (const k of Object.keys(after)) if (after[k] !== before[k]) d[k] = after[k] - before[k]
  return d
}

// ---- POST /api/internal/invoice-exports/create  (prepareInvoiceDraftsForReview) -----------------------
export function prepare(ctx, session, { companyId, month, label }) {
  return ctx.http.post('/api/internal/invoice-exports/create', {
    cookie: session.cookie(), json: { companyId, billing_month: month }, label: label ?? `prepare ${month}`,
  })
}

// ---- Next server actions, posted like a no-JS browser form (multipart + $ACTION_ID_<id> field) ----------
const ACTION_FORMS = {
  approve: { marker: /Godkänn/, name: 'approveAndSendReadyInvoicesAction (app/admin/billing/actions.ts)' },
  createFile: { marker: /Skapa fakturafil/, name: 'createInvoiceFileAction (app/admin/billing/invoice-files/actions.ts)' },
}

/**
 * The action id is read from the rendered /admin/billing page (hidden `$ACTION_ID_<id>` input of the form whose
 * button text matches). Ids are stable per build, so they are cached; the approve form is only rendered while
 * something is approvable, hence the cache when approving a second time.
 * Override: T4_ACTION_ID_APPROVE / T4_ACTION_ID_CREATE_FILE.
 */
export async function actionId(ctx, session, kind, month) {
  const override = process.env[kind === 'approve' ? 'T4_ACTION_ID_APPROVE' : 'T4_ACTION_ID_CREATE_FILE']
  if (override) return override
  ctx.actionIds ??= {}
  if (ctx.actionIds[kind]) return ctx.actionIds[kind]
  const page = await ctx.http.get(`/admin/billing?month=${month}`, { cookie: session.cookie(), label: `GET /admin/billing (resolve ${kind} action id)` })
  if (page.status !== 200) throw new Error(`cannot render /admin/billing to find the ${kind} action (status ${page.status})`)
  const html = page.text()
  for (const form of html.match(/<form[\s\S]*?<\/form>/g) ?? []) {
    if (!ACTION_FORMS[kind].marker.test(form)) continue
    const m = /name="\$ACTION_ID_([0-9a-f]+)"/.exec(form)
    if (m) { ctx.actionIds[kind] = m[1]; return m[1] }
  }
  throw new Error(`no <form> with a server action matching ${ACTION_FORMS[kind].marker} on /admin/billing?month=${month} (the form is only rendered when there is something to ${kind}); set T4_ACTION_ID_* to override`)
}

export async function runAction(ctx, session, kind, month, label) {
  const id = await actionId(ctx, session, kind, month)
  const form = new FormData()
  form.set(`$ACTION_ID_${id}`, '')
  form.set('billing_month', month)
  const res = await ctx.http.post(`/admin/billing?month=${month}`, { cookie: session.cookie(), form, label: label ?? `${kind} ${month}` })
  const params = res.location ? Object.fromEntries(new URL(res.location, 'http://x').searchParams) : {}
  return { res, status: res.status, location: res.location, params }
}

// ---- Invoice file download --------------------------------------------------------------------------
export const getFile = (ctx, session, id, { format, label } = {}) =>
  ctx.http.get(`/admin/billing/invoice-files/${id}${format ? `?format=${format}` : ''}`, { cookie: session?.cookie(), label: label ?? `GET invoice-file ${id}${format ? ` (${format})` : ''}` })

// ---- Row readers --------------------------------------------------------------------------------------
export const itemsFor = (sql, companyId, month) => sql.rows(`
  SELECT i.id, i.status, i.billing_underlay_id, i.pricing_run_id, i.total_kwh, i.amount_ex_vat, i.vat_amount, i.amount_inc_vat, i.export_file_id,
         i.metadata->'approval' AS approval, r.billing_month
  FROM public.invoice_export_items i JOIN public.invoice_export_runs r ON r.id=i.export_run_id
  WHERE i.company_id=${lit(companyId)} AND r.billing_month=${lit(month)} ORDER BY i.created_at`)

export const filesFor = (sql, companyId) => sql.rows(`
  SELECT id, billing_month, provider, environment, row_count, total_inc_vat, rows_sha256, created_at, rows
  FROM public.invoice_export_files WHERE company_id=${lit(companyId)} ORDER BY created_at`)

export const pricingRunsFor = (sql, companyId, underlayId) => sql.rows(`
  SELECT id, status, total_ex_vat, vat_amount, total_inc_vat, locked_at FROM public.pricing_runs
  WHERE company_id=${lit(companyId)} AND billing_underlay_id=${lit(underlayId)} ORDER BY created_at`)

// ---- rows_sha256 as the product computes it ---------------------------------------------------------
// Copied (logic only) from lib/billing/invoiceFileExport.ts @ 1c0c088cb4ed66d0dd8b3e34c9606019342a1a56 (stableJson, rowsSha256).
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
export const rowsSha256 = (rows) => createHash('sha256').update(stableJson(rows)).digest('hex')

export const money = (v) => Number(v).toFixed(2)
