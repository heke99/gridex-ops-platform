// Ursprung:
//  - 766f49636b0269a56b5738abb43850344dde6135 (origin/claude/sim-20261029-track4):scripts/simulation/track4/fixtures/flows.mjs
//    (prepare via POST /api/internal/invoice-exports/create, approve via approveAndSendReadyInvoicesAction, fil via createInvoiceFileAction,
//     actionId-skrapning av `$ACTION_ID_<id>`; GET /admin/billing/invoice-files/<id>)
//  - 3ea5cd2b6d37b910674e71993ac94e5720ed31a8 (origin/claude/sim-20261029-track1):scripts/simulation/track1/fixtures/main04Support.ts (enableFileInvoiceProvider)
//    -- här först via integrationssidans UI-åtgärder (selectInvoiceProviderAction, saveNordfinClientIdAction, setInvoiceDispatchEnabledAction);
//    ersättningssteg (service role/psql) BARA om UI-åtgärden avvisas, och då markerat.
// Alla skrivningar mot billing-tabellerna sker i appen; här läses bara rader (dbRead är skrivskyddad).
import { nativeSql as sql, literal } from '@/scripts/helpers/ediel-normal-switch-native-fixture'
import { supabaseService } from '@/lib/supabase/service'
import { substitute } from './substitutions'
import { dbRead, findActionForm, http, lit, postServerAction, sha256Hex, type HttpResult, type Session } from './runtime'
import { DELIVERY01_BILLING_MONTH } from './synthetic'

export type FlowLog = { step: string; via: 'ui-action' | 'api' | 'ersättningssteg'; detail: unknown }

const PROVIDER_PAGE = '/admin/billing/integrations'
export const BILLING_PAGE = `/admin/billing?month=${DELIVERY01_BILLING_MONTH}`

type CompanyProviderRow = { invoice_export_target_system: string | null; billing_provider_environment: string | null; invoice_export_enabled: boolean | null }
const companyProvider = (companyId: string) => dbRead<CompanyProviderRow>(`SELECT to_jsonb(x) FROM (SELECT invoice_export_target_system,billing_provider_environment,invoice_export_enabled FROM public.companies WHERE id=${lit(companyId)}) x`)
const nordfinClientId = (companyId: string) => dbRead<string | null>(`SELECT to_json(settings->>'client_id') FROM public.billing_provider_connections WHERE company_id=${lit(companyId)} AND provider='nordfin' AND environment='test'`)

/**
 * Select Nordfin (test), save its ClientId and enable dispatch through the integrations page actions. Each action that the app refuses or
 * that cannot be driven falls back to a marked substitute, so the run still reaches the XML; the log says which path was used.
 */
export async function enableNordfinProvider(session: Session, companyId: string, clientId: string): Promise<{ log: FlowLog[]; final: CompanyProviderRow; clientId: string | null }> {
  const log: FlowLog[] = []
  const stepSelect = async () => {
    const form = await findActionForm(session, PROVIDER_PAGE, html => /name="provider"/.test(html))
    if (!form) return { ok: false, detail: 'no provider form on page' }
    const r = await postServerAction(session, PROVIDER_PAGE, form, { provider: 'nordfin', environment: 'test' })
    return { ok: r.params.provider === 'selected', detail: { status: r.status, location: r.location } }
  }
  const select = await stepSelect()
  log.push({ step: 'select provider nordfin/test', via: 'ui-action', detail: select.detail })
  if (!select.ok) {
    substitute({ id: 'invoice-provider-selection', step: 'DELIVERY01 setup: invoice provider', substitute: "RPC gridex_select_invoice_provider_v1 anropad med service role (samma RPC som selectInvoiceProviderAction anropar)",
      notVerified: 'integrationssidans formulär, katalogens valbarhet för nordfin och behörighetskontrollen i selectInvoiceProviderAction' })
    const { error } = await supabaseService.rpc('gridex_select_invoice_provider_v1', { p_company_id: companyId, p_provider: 'nordfin', p_environment: 'test', p_actor_user_id: session.userId })
    log.push({ step: 'select provider nordfin/test', via: 'ersättningssteg', detail: { error: error?.message ?? null } })
  }

  const clientForm = await findActionForm(session, PROVIDER_PAGE, html => /name="client_id"/.test(html))
  let savedClient = false
  if (clientForm) {
    const r = await postServerAction(session, PROVIDER_PAGE, clientForm, { client_id: clientId })
    savedClient = r.params.provider === 'nordfin_client_id_saved'
    log.push({ step: 'save Nordfin ClientId', via: 'ui-action', detail: { status: r.status, location: r.location } })
  } else log.push({ step: 'save Nordfin ClientId', via: 'ui-action', detail: 'no client_id form on page (provider not selected?)' })
  if (!savedClient || nordfinClientId(companyId) !== clientId) {
    substitute({ id: 'nordfin-client-id', step: 'DELIVERY01 setup: Nordfin ClientId', substitute: 'billing_provider_connections.settings.client_id skriven med psql',
      notVerified: 'saveNordfinClientIdAction, ClientId-valideringen och sidans formulär' })
    sql(`UPDATE public.billing_provider_connections SET settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('client_id',${literal(clientId)}) WHERE company_id=${literal(companyId)} AND provider='nordfin' AND environment='test'`)
    log.push({ step: 'save Nordfin ClientId', via: 'ersättningssteg', detail: { stored: nordfinClientId(companyId) } })
  }

  if (companyProvider(companyId)?.invoice_export_enabled !== true) {
    const enableForm = await findActionForm(session, PROVIDER_PAGE, html => /name="enabled"/.test(html))
    if (enableForm) {
      const r = await postServerAction(session, PROVIDER_PAGE, enableForm, { enabled: 'true' })
      log.push({ step: 'enable dispatch', via: 'ui-action', detail: { status: r.status, location: r.location } })
    } else log.push({ step: 'enable dispatch', via: 'ui-action', detail: 'no enabled form on page' })
  }
  if (companyProvider(companyId)?.invoice_export_enabled !== true) {
    substitute({ id: 'invoice-dispatch-enabled', step: 'DELIVERY01 setup: invoice dispatch enabled', substitute: 'RPC gridex_set_invoice_dispatch_enabled_v1 anropad med service role',
      notVerified: 'setInvoiceDispatchEnabledAction och att knappen är avstängd tills kopplingen är testad' })
    const { error } = await supabaseService.rpc('gridex_set_invoice_dispatch_enabled_v1', { p_company_id: companyId, p_enabled: true, p_actor_user_id: session.userId })
    log.push({ step: 'enable dispatch', via: 'ersättningssteg', detail: { error: error?.message ?? null } })
  }
  return { log, final: companyProvider(companyId), clientId: nordfinClientId(companyId) }
}

export const generateUnderlay = (session: Session): Promise<HttpResult> =>
  http(session, 'POST', '/api/internal/billing/generate-underlay', { json: { billing_month: DELIVERY01_BILLING_MONTH } })

export const prepareInvoices = (session: Session, companyId: string): Promise<HttpResult> =>
  http(session, 'POST', '/api/internal/invoice-exports/create', { json: { companyId, billing_month: DELIVERY01_BILLING_MONTH } })

const ACTION_MARKERS = { approve: /Godkänn/, createFile: /Skapa fakturafil/ } as const

/** approveAndSendReadyInvoicesAction / createInvoiceFileAction posted like a browser form from /admin/billing. */
export async function runBillingAction(session: Session, kind: keyof typeof ACTION_MARKERS) {
  const form = await findActionForm(session, BILLING_PAGE, html => ACTION_MARKERS[kind].test(html))
  if (!form) {
    const page = await http(session, 'GET', BILLING_PAGE, { headers: { accept: 'text/html' } })
    const hint = { status: page.status, forms: (page.text.match(/<form/g) ?? []).length, actionIds: (page.text.match(/\$ACTION_ID_/g) ?? []).length, containsMarker: ACTION_MARKERS[kind].test(page.text), month: DELIVERY01_BILLING_MONTH }
    throw new Error(`no <form> with a server action matching ${ACTION_MARKERS[kind]} on ${BILLING_PAGE} (rendered only when there is something to ${kind === 'approve' ? 'approve' : 'put in a file'}): ${JSON.stringify(hint)}`)
  }
  const r = await postServerAction(session, BILLING_PAGE, form, { billing_month: DELIVERY01_BILLING_MONTH })
  return { ...r, fileId: r.params.file ?? null, fileError: r.params.file_error ?? null }
}

export const downloadInvoiceFile = (session: Session, fileId: string, format = 'nordfin_xml'): Promise<HttpResult> =>
  http(session, 'GET', `/admin/billing/invoice-files/${fileId}?format=${format}`, { headers: { accept: '*/*' } })

// ------------------------------------------------------------------ row readers (read-only)

export const underlaysFor = (companyId: string) => dbRead<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(to_jsonb(u) - 'payload' - 'billing_configuration_snapshot' ORDER BY u.created_at),'[]'::jsonb)
  FROM public.billing_underlays u WHERE u.company_id=${lit(companyId)}`)

export const exportItemsFor = (companyId: string) => dbRead<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'billing_underlay_id',i.billing_underlay_id,'export_file_id',i.export_file_id,'approval',i.metadata->'approval') ORDER BY i.created_at),'[]'::jsonb)
  FROM public.invoice_export_items i WHERE i.company_id=${lit(companyId)}`)

/** billing_export_run_items: the frozen recipient/address/email per item (what the file rows are built from). */
export const runItemsFor = (companyId: string) => dbRead<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg((to_jsonb(r) - 'payload_snapshot' - 'adapter_payload_snapshot' - 'pricing_line_items' - 'payload') ORDER BY r.created_at),'[]'::jsonb)
  FROM public.billing_export_run_items r WHERE r.company_id=${lit(companyId)}`)

export const filesFor = (companyId: string) => dbRead<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.created_at),'[]'::jsonb) FROM public.invoice_export_files f WHERE f.company_id=${lit(companyId)}`)

export const revisionsFor = (companyId: string, customerId: string) => dbRead<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.revision),'[]'::jsonb)
  FROM public.customer_billing_profile_revisions r WHERE r.company_id=${lit(companyId)} AND r.customer_id=${lit(customerId)}`)

/**
 * SUBSTITUTE (DELIVERY01.05 trigger): there is no normal entry that edits customers.billing_* after creation (portal profile-update takes invoice_email only,
 * partner API creates only, no customer edit server action), so the new invoice email and address B2 are written by psql; the DB trigger
 * gridex_customer_billing_profile_bump/record then logs customer_billing_profile_revisions exactly as for any other writer.
 */
export function changeBillingProfileAfterApproval(customerId: string, companyId: string, next: { invoiceEmail: string; street: string; postalCode: string; city: string }): void {
  substitute({ id: 'billing-profile-change', step: 'DELIVERY01.05 change of the customer billing profile after approval',
    substitute: 'UPDATE customers SET invoice_email/billing_street/billing_postal_code/billing_city via psql (triggern loggar revisionen)',
    notVerified: 'customer-portal profile-update-routen, staff API (kontakt-PATCH rör bara email/phone), partner API och adminvyer som normalt ändrar faktureringsprofilen' })
  sql(`UPDATE public.customers SET invoice_email=${literal(next.invoiceEmail)}, billing_street=${literal(next.street)}, billing_postal_code=${literal(next.postalCode)}, billing_city=${literal(next.city)}
    WHERE id=${literal(customerId)} AND company_id=${literal(companyId)}`)
}

// ------------------------------------------------------------------ Nordfin XML (mini reader)

const unescapeXml = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/** The text between <tag>..</tag> inside `scope`; '' for <tag />; null when absent. First match only. */
export function xmlField(scope: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s*/>|>([\\s\\S]*?)</${tag}>)`).exec(scope)
  return m ? unescapeXml(m[1] ?? '') : null
}
export const xmlBlocks = (xml: string, tag: string): string[] => [...xml.matchAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'))].map(m => m[0])

export type NordfinInvoice = {
  customerName: string | null; customerNumber: string | null; address: string | null; zip: string | null; city: string | null; email: string | null
  delivery: string | null; invoiceNumber: string | null
  facility: { address: string | null; zip: string | null; city: string | null } | null
}
export function parseNordfinXml(xml: string): NordfinInvoice[] {
  return xmlBlocks(xml, 'Inv').map(inv => {
    const customer = xmlBlocks(inv, 'Customer')[0] ?? '', invoice = xmlBlocks(inv, 'Invoice')[0] ?? '', facility = xmlBlocks(inv, 'Facility')[0] ?? null
    return {
      customerName: xmlField(customer, 'Customername'), customerNumber: xmlField(customer, 'CustomerNumber'), address: xmlField(customer, 'Customeradress'),
      zip: xmlField(customer, 'ZipCode'), city: xmlField(customer, 'City'), email: xmlField(customer, 'CustomerEmail'),
      delivery: xmlField(invoice, 'Delivery'), invoiceNumber: xmlField(invoice, 'InvoiceNumber'),
      facility: facility ? { address: xmlField(facility, 'FacilityAddress'), zip: xmlField(facility, 'FacilityZipCode'), city: xmlField(facility, 'FacilityCity') } : null,
    }
  })
}

/**
 * Where a readiness blocker code can surface through normal entries: the /admin/billing page for the month (invoiceReviewData blocker text) and the underlay
 * row. The account-level codes (invoice_distribution_missing, invoice_recipient_missing; billingReadiness.ts) are produced only by
 * evaluateBillingMonthInvoiceReadiness, whose only caller is createInvoiceExportRun (lib/integrations/billing/invoiceExportCore.ts:53); no route calls that
 * (grep app/ lib/ on this base), and the nordfin flow prepare -> approve -> file does not call it.
 */
export async function readinessSurfaces(session: Session, companyId: string, codes: string[]): Promise<{ page: { status: number; sha256: string; codesFound: string[]; blockerSnippets: string[] }; underlayRowCodes: string[] }> {
  const page = await http(session, 'GET', BILLING_PAGE, { headers: { accept: 'text/html' } })
  const text = page.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const blockerSnippets = [...text.matchAll(/(?:Flaggad|Saknar mätvärden|blockerad)[^.]{0,160}/gi)].map(m => m[0]).slice(0, 6)
  const rows = JSON.stringify(underlaysFor(companyId))
  return { page: { status: page.status, sha256: sha256Hex(page.bytes), codesFound: codes.filter(c => page.text.includes(c)), blockerSnippets }, underlayRowCodes: codes.filter(c => rows.includes(c)) }
}
