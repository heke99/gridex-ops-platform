// Product-entrypoint helpers shared by the T4 scenario steps. Everything here goes through the running app
// (HTTP API routes, Next server actions posted exactly like a browser form post, authenticated file download)
// or reads rows; nothing here writes billing tables.
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
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

/** Exact installed denial contract: a 404 must never carry invoice data or download headers. */
export function assertFileNotFound(response) {
  assert.equal(response.status, 404, 'file lookup must reach the controlled not-found response')
  assert.match(response.contentType ?? '', /^text\/plain(?:;|$)/i, 'not-found response must be plain text')
  assert.deepEqual(response.bytes, Buffer.from('Fakturafilen hittades inte.', 'utf8'), 'exact not-found bytes without private content')
  assert.ok(!response.contentDisposition, 'not-found response must not advertise a file')
  assert.ok(!response.location, 'not-found response must not redirect to file content')
}

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

// Consumer-side file contract. Expected values come from the frozen native file row, never
// from rendering an expected download with the producer. This checks serialization fidelity;
// it does not establish an independent financial oracle, XSD validity or receiver acceptance.
const FILE_LIMIT = 16 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function assertCreateFileRedirect(action, month) {
  assert.equal(action.status, 303, 'create file must use the installed Next action redirect')
  assert.equal(typeof action.location, 'string', 'create file redirect missing')
  // Product action returns a relative same-application target. Never resolve a foreign origin.
  assert.ok(action.location.startsWith('/admin/billing?'), 'create file target must be the billing page')
  const url = new URL(action.location, 'http://t4.invalid')
  assert.equal(url.origin, 'http://t4.invalid')
  assert.equal(url.pathname, '/admin/billing'); assert.equal(url.hash, '')
  assert.deepEqual([...url.searchParams.keys()].sort(), ['file', 'month'], 'exact successful action parameters')
  assert.equal(url.searchParams.get('month'), month)
  assert.match(url.searchParams.get('file') ?? '', UUID, 'created file UUID')
}

function billingActionRedirect(action, month, keys) {
  assert.equal(action.status, 303, 'billing action must use the installed Next action redirect')
  assert.equal(typeof action.location, 'string', 'billing action redirect missing')
  assert.ok(action.location.startsWith('/admin/billing?'), 'billing action target must be the billing page')
  const url = new URL(action.location, 'http://t4.invalid')
  assert.equal(url.origin, 'http://t4.invalid')
  assert.equal(url.pathname, '/admin/billing'); assert.equal(url.hash, '')
  assert.deepEqual([...url.searchParams.keys()].sort(), [...keys].sort(), 'exact action parameters without duplicates')
  assert.equal(url.searchParams.get('month'), month, 'action must retain the requested billing month')
  return url.searchParams
}

export function assertApproveRedirect(action, month) {
  const params = billingActionRedirect(action, month, ['approved', 'sent', 'failed', 'mode', 'month'])
  assert.equal(params.get('mode'), 'file', 'file-provider approval mode required')
  assert.equal(params.get('sent'), '0', 'file approval must not send individual invoices')
  assert.equal(params.get('failed'), '0', 'failed contenders are not successful approval replays')
  assert.match(params.get('approved') ?? '', /^(0|1)$/, 'one canonical winner or a successful replay required')
  return Number(params.get('approved'))
}

export function assertFileReplayRedirect(action, month) {
  const params = billingActionRedirect(action, month, ['month', 'file_error'])
  assert.equal(params.get('file_error'), 'invoice_file_empty', 'file replay must find no approved unfiled invoices')
}

export function assertPrepareResponse(response, month) {
  assert.equal(response.status, 200, 'every qualified prepare contender must reach the preparation API')
  const body = response.json()
  assert.equal(body.mode, 'prepare_only')
  assert.equal(body.approval_required, true)
  assert.equal(body.blocked_customers_are_not_reserved_or_sent, true)
  const data = body.data
  assert.ok(data && typeof data === 'object' && !Array.isArray(data), 'canonical preparation result required')
  assert.equal(data.billingMonth, month)
  assert.equal(data.failed, 0, 'failed contenders are not successful preparation replays')
  assert.deepEqual(data.errors, [], 'successful preparation must not hide errors')
  assert.ok(data.created === 0 || data.created === 1, 'canonical created count required')
  assert.ok(data.alreadyPrepared === 0 || data.alreadyPrepared === 1, 'canonical replay count required')
  assert.equal(data.created + data.alreadyPrepared, 1, 'exactly one fixture underlay must be prepared or reused')
  return data
}

function assertStoredFile(file) {
  assert.ok(file && typeof file === 'object', 'frozen file row missing')
  assert.match(file.id, UUID); assert.match(file.billing_month, /^\d{4}-(0[1-9]|1[0-2])$/)
  assert.ok(['file_export', 'nordfin'].includes(file.provider), 'actual file provider required')
  assert.ok(typeof file.created_at === 'string' && Number.isFinite(Date.parse(file.created_at)), 'stored creation timestamp')
  assert.ok(Array.isArray(file.rows) && file.rows.length > 0, 'stored invoice rows required')
  assert.equal(file.row_count, file.rows.length, 'stored invoice cardinality')
  assert.equal(file.rows_sha256, rowsSha256(file.rows), 'stored rows hash')
}

export function freezeFileSnapshot(file) {
  assertStoredFile(file)
  const freeze = value => {
    if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value) }
    return value
  }
  return freeze(structuredClone(file))
}

function downloadText(download, file, format) {
  assertStoredFile(file)
  assert.equal(download.status, 200, 'protected file GET must succeed')
  assert.ok(!download.location, 'protected file GET must not redirect')
  const xml = format === 'nordfin_xml'
  assert.equal(download.contentType?.toLowerCase(), `application/${xml ? 'xml' : 'json'}; charset=utf-8`, 'file MIME/UTF8')
  const filename = `${xml ? 'nordfin-' : ''}fakturor-${file.billing_month}-${file.id.slice(0, 8)}.${xml ? 'xml' : 'json'}`
  assert.equal(download.contentDisposition, `attachment; filename="${filename}"`, 'protected file attachment identity')
  assert.ok(Buffer.isBuffer(download.bytes) && download.bytes.length > 0 && download.bytes.length <= FILE_LIMIT, 'bounded nonempty file bytes')
  assert.equal(download.sha256, createHash('sha256').update(download.bytes).digest('hex'), 'recorded raw body hash')
  return new TextDecoder('utf-8', { fatal: true }).decode(download.bytes)
}

export function assertInvoiceJson(download, file) {
  const data = JSON.parse(downloadText(download, file, 'json'))
  assert.deepEqual(data, { format: 'gridex_invoice_file_v1', file_id: file.id,
    billing_month: file.billing_month, created_at: file.created_at, rows_sha256: file.rows_sha256,
    invoices: file.rows }, 'JSON v1 exact six-field envelope and complete frozen invoice rows')
}

// XML text is compared after one standard XML entity decode. Preserve scalar whitespace;
// only XML 1.0 controls deliberately stripped by the canonical formatter are projected away.
const xmlText = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\r\n?/g, '\n')
const periodText = (start, end) => start && end ? `${start}-${end}` : ''
function fixed(value, places) {
  assert.ok(typeof value === 'number' && Number.isFinite(value), 'stored XML numeric field must be finite')
  return (Math.round(value * 10 ** places) / 10 ** places).toFixed(places)
}
const optionalFixed = (value, places) => value == null ? '' : fixed(value, places)

function invoiceXmlProjection(row) {
  const e = row.electricity, facilities = e?.facilities ?? [], contract = e?.contract, reconciliation = e?.reconciliation
  const electricity = {
    InvoiceType: e?.invoice_type === 'credit' ? 'CREDIT' : 'DEBIT',
    ConsumptionBasis: e ? ({ measured: 'MEASURED', estimated: 'ESTIMATED', measured_with_estimate: 'MEASURED_WITH_ESTIMATE', reconciliation: 'RECONCILIATION' })[e.consumption_basis] : '',
    PriceArea: xmlText(row.price_area), Period: periodText(row.period_start, row.period_end),
    ConsumptionKwh: optionalFixed(row.kwh, 3),
    AveragePriceOrePerKwh: e?.average_price_ore_per_kwh == null ? '' : e.average_price_ore_per_kwh.toFixed(2),
    ...(reconciliation ? { Reconciliation: {
      Role: reconciliation.role === 'credit_preliminary' ? 'CREDIT_PRELIMINARY' : 'CHARGE_FINAL',
      ReconciledMonth: xmlText(reconciliation.reconciled_month), PreliminaryKwh: optionalFixed(reconciliation.preliminary_kwh, 3),
      FinalKwh: optionalFixed(reconciliation.final_kwh, 3), DifferenceKwh: optionalFixed(reconciliation.difference_kwh, 3),
    } } : {}),
    FacilityCount: String(facilities.length),
    Facilities: facilities.length ? { Facility: facilities.map(f => ({
      FacilityId: xmlText(f.facility_id), MeteringPointId: xmlText(f.metering_point_id), FacilityAddress: xmlText(f.site_street),
      FacilityZipCode: xmlText(f.site_postal_code), FacilityCity: xmlText(f.site_city), PriceArea: xmlText(f.price_area),
      GridArea: xmlText(f.grid_area), GridOwner: xmlText(f.grid_owner), Period: periodText(f.period_start, f.period_end),
      ConsumptionKwh: optionalFixed(f.consumption_kwh, 3), EstimatedAnnualConsumptionKwh: optionalFixed(f.estimated_annual_kwh, 3),
    })) } : '',
    ...(contract ? { Contract: {
      ContractName: xmlText(contract.name), ContractNumber: xmlText(contract.number), ContractType: xmlText(contract.type),
      StartDate: xmlText(contract.start_date), BindingMonths: xmlText(contract.binding_months), BindingEndDate: xmlText(contract.binding_end_date),
      BindingMonthsRemaining: xmlText(contract.binding_months_remaining), NoticeMonths: xmlText(contract.notice_months),
      AutoRenew: contract.auto_renew === null ? '' : contract.auto_renew ? 'true' : 'false',
      FixedPriceOrePerKwh: xmlText(contract.fixed_price_ore_per_kwh), SpotMarkupOrePerKwh: xmlText(contract.spot_markup_ore_per_kwh),
      MonthlyFeeSek: optionalFixed(contract.monthly_fee_sek, 2),
    } } : {}),
  }
  return {
    Customer: {
      Customername: xmlText(row.customer_name), CustomerNumber: xmlText(row.customer_number), Customeradress: xmlText(row.street),
      ZipCode: xmlText(row.postal_code), City: xmlText(row.city), OrganizationNumber: xmlText(row.identity_number?.replace(/\D/g, '')),
      CustomerEmail: xmlText(row.email), CustomerType: row.customer_type === 'business' ? 'FTG' : 'PRV',
      CoName: xmlText(row.recipient && row.recipient !== row.customer_name ? row.recipient : null), ClientId: xmlText(row.nordfin_client_id),
    },
    Invoice: {
      InvoiceAmount: fixed(row.amount_inc_vat, 2), RemainingAmount: fixed(row.amount_inc_vat, 2),
      AmountExclVat: fixed(row.amount_ex_vat, 2), InvoiceVATAmount: fixed(row.vat_amount, 2),
      BillDate: xmlText(row.invoice_date), DueDate: xmlText(row.due_date), Delivery: row.email ? 'EMAIL' : 'PRINT',
      InvoiceNumber: xmlText(row.invoice_number), PaymentReference: '',
    },
    Electricity: electricity,
    InvoiceSpecification: row.lines.length ? { InvoiceRowsSpecification: row.lines.map(line => {
      // Existing formatter defaults are serialization compatibility, not an independent tax calculation.
      const rate = line.vat_rate ?? 0.25, percent = rate <= 1 ? rate * 100 : rate
      return { Period: periodText(row.period_start, row.period_end), Description: xmlText(line.description),
        LineType: xmlText(line.line_type), Quantity: xmlText(line.quantity), Unit: xmlText(line.unit), UnitPrice: xmlText(line.unit_price_ex_vat),
        Amount: fixed(line.amount_ex_vat, 2), Vat: percent.toFixed(6),
        Total: fixed(line.amount_inc_vat ?? line.amount_ex_vat * (1 + percent / 100), 2) }
    }) } : '',
  }
}

function stripIndentation(value, path = '') {
  if (Array.isArray(value)) return value.map(item => stripIndentation(item, path))
  if (typeof value === 'string' && /^[ \t\r\n]*$/.test(value) &&
    ['Invoices.Inv.InvoiceSpecification', 'Invoices.Inv.Electricity.Facilities'].includes(path)) return ''
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => !(key === '#text' && typeof item === 'string' && /^[ \t\r\n]*$/.test(item)))
    .map(([key, item]) => [key, stripIndentation(item, path ? `${path}.${key}` : key)]))
}

export function assertInvoiceXml(download, file) {
  const text = downloadText(download, file, 'nordfin_xml')
  // XMLValidator does not enforce the full XML 1.0 Char production. Check every
  // decoded literal codepoint before the parser or indentation handling can discard it.
  for (const character of text) {
    const code = character.codePointAt(0)
    assert.ok(code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xD7FF) ||
      (code >= 0xE000 && code <= 0xFFFD) || (code >= 0x10000 && code <= 0x10FFFF), 'literal character outside XML 1.0 Char')
  }
  assert.match(text, /^<\?xml version="1\.0" encoding="utf-8"\?>\r?\n/, 'canonical XML 1.0 UTF8 declaration')
  assert.ok(!/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text), 'DTD and entity declarations forbidden')
  // XMLValidator alone accepts unresolved named references. Only the five predefined entities
  // and valid XML 1.0 numeric references are permitted, before any entity expansion occurs.
  for (const match of text.matchAll(/&([^;\s<&]+);/g)) {
    const name = match[1]
    if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(name)) continue
    assert.match(name, /^(?:#\d+|#x[0-9a-fA-F]+)$/, 'unbound XML entity')
    const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    assert.ok(code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xD7FF) ||
      (code >= 0xE000 && code <= 0xFFFD) || (code >= 0x10000 && code <= 0x10FFFF), 'invalid XML 1.0 reference')
  }
  assert.equal(XMLValidator.validate(text), true, 'well-formed XML required')
  const parsed = new XMLParser({ ignoreAttributes: false, ignoreDeclaration: true, parseTagValue: false,
    parseAttributeValue: false, trimValues: false, processEntities: true, htmlEntities: false,
    cdataPropName: '#cdata', maxNestedTags: 32,
    isArray: (_name, path) => ['Invoices.Inv', 'Invoices.Inv.Electricity.Facilities.Facility',
      'Invoices.Inv.InvoiceSpecification.InvoiceRowsSpecification'].includes(path),
  }).parse(text)
  // Exact deep shape rejects extra roots, duplicate scalars, nested scalar markup, missing rows
  // and unknown fields. Scalars remain strings, retaining identifiers/decimal precision/escaping.
  assert.deepEqual(stripIndentation(parsed), { Invoices: {
    '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance', '@_xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
    Inv: file.rows.map(invoiceXmlProjection),
  } }, 'XML structure and complete frozen row projection')
}
