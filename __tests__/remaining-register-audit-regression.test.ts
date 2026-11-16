import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let captureIndex = 0;
function captureRender(element: React.ReactNode): string {
    const html = renderToStaticMarkup(element);
    if (process.env.GRIDEX_REGISTERS_CAPTURE === '1') fs.writeFileSync(`/tmp/gridex-registers-render-${captureIndex++}.html`, html);
    return html;
}
type Row = Record<string, unknown>;
type Query = {
    [key: string]: unknown;
    then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
};
const io = vi.hoisted(() => ({ platform: false, cap: Infinity, missingCount: false, failedTable: '', tables: {} as Record<string, Row[]>, calls: [] as Array<{
        table: string;
        filters: Array<[
            string,
            unknown
        ]>;
        limit: number;
    }>, portalFailure: false, customers: [] as Array<{id:string;label:string;sublabel:null}>, requests: [] as Row[], scopes: [] as Row[], permissions: [] as Row[], replies: new Map<string, Row[]>(), blockers: [] as Row[] }));
function query(table: string) {
    let start = 0, end = 999, columns = '*';
    const filters: Array<[
        string,
        unknown
    ]> = [];
    const orders: Array<[
        string,
        boolean
    ]> = [];
    const result = () => { let rows = (io.tables[table] ?? []).filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)); for (const [key, asc] of [...orders].reverse())
        rows = [...rows].sort((a, b) => { const x = a[key], y = b[key]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''))) * (asc ? 1 : -1); }); const count = rows.length; rows = rows.slice(start, Math.min(end + 1, start + io.cap)); if (columns !== '*')
        rows = rows.map(row => Object.fromEntries(columns.split(',').map(x => x.trim()).filter(x => x in row).map(x => [x, row[x]]))); io.calls.push({ table, filters, limit: end - start + 1 }); return { data: rows, error: io.failedTable === table ? { message: 'synthetic transport error' } : null, count: io.missingCount ? null : count }; };
    const q: Query = { select: (value: string) => { columns = value; return q; }, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, in: (key: string, value: unknown[]) => { filters.push([key, value]); return q; }, order: (key: string, options?: {
            ascending?: boolean;
        }) => { orders.push([key, options?.ascending !== false]); return q; }, limit: (limit: number) => { end = limit - 1; return q; }, range: (a: number, b: number) => { start = a; end = b; return q; }, or: () => q, neq: () => q, gt: () => q, gte: () => q, lt: () => q, lte: () => q, not: () => q, ilike: () => q, is: () => q,
        single: async () => ({ ...result(), data: result().data[0] ?? null }), maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return q;
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => query(table), rpc: async () => ({ data: [], error: null }) } }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ from: (table: string) => query(table), rpc: async () => ({ data: [], error: null }), auth: { getUser: async () => ({ data: { user: { id: 'operator', email: 'operator@example.invalid' } } }) } }) }));
const admin = () => ({ userId: 'operator', email: 'operator@example.invalid', companyId: 'A', permissions: ['customers.read', 'billing_underlay.read', 'metering.read', 'poa.read'], isPlatformAdmin: io.platform, roles: [] });
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => admin(), isPlatformAdminContext: () => io.platform }));
vi.mock('@/lib/auth/requirePermissionServer', () => ({ requirePermissionServer: async () => admin() }));
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => ({ companyId: 'A', isPlatformAdmin: io.platform, companyName: 'Syntetiskt bolag' }), resolveAdminSelectedCompanyReadScope: async () => ({ companyId: 'A', isPlatformAdmin: io.platform, companyName: 'Syntetiskt bolag' }) }));
vi.mock('@/lib/tenant/scope', () => ({ isMissingRelationError: (error: unknown) => String((error as {
        message?: string;
    })?.message).includes('does not exist'), getOperationalCompanyScope: async () => ({ memberships: [{ companyId: 'A', status: 'active', companyStatus: 'active' }] }) }));
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: {
        title: string;
    }) => React.createElement('h1', null, title) }));
vi.mock('@/components/admin/CompanySelect', () => ({ default: () => null }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: {
        href: string;
        children?: React.ReactNode;
    }) => React.createElement('a', { href, ...props }, children) }));
vi.mock('@/lib/onboarding/infoRequests', () => ({ listCustomersForInfoRequestSelector: async () => io.customers, listCustomerInfoRequests: async () => io.requests, listAuthorizationScopes: async () => io.scopes, listMeteringPermissions: async () => io.permissions, listCustomerInfoRequestResourceOptions: async () => ({ sites: [], meteringPoints: [], gridOwners: [] }) }));
vi.mock('@/lib/onboarding/infoRequestPortalReplies', () => ({ listPortalRepliesForInfoRequests: async () => { if (io.portalFailure)
        throw Error('synthetic transport'); return io.replies; } }));
vi.mock('@/lib/customers/readinessScore', () => ({ calculateCustomerReadinessScore: () => ({ customerScore: 50, siteScore: 50, contractScore: 50, powerOfAttorneyScore: 50, billingScore: 50, blockers: io.blockers }) }));
vi.mock('@/lib/ediel/operations/processNextAction', () => ({ readEdielProcessNextActions: async () => new Map() }));
vi.mock('@/lib/ediel/services/manualPermissionOptions', () => ({ readManualServicePermissionOptions: async () => [] }));
const inert = () => { throw Error('No actions may execute'); };
vi.mock('@/app/admin/customer-info-requests/actions', () => ({ applyZ14SnapshotAction: () => inert(), closeCustomerInfoRequestAction: () => inert(), createAuthorizationScopeAction: () => inert(), createCustomerInfoRequestAction: () => inert(), createMeteringPermissionDraftAction: () => inert(), queueCustomerInfoRequestAction: () => inert(), queueMeteringPermissionZ13Action: () => inert() }));
function extract(file: string, names: string[], globals: Record<string, unknown> = {}) { const code = fs.readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')); expect(functions).toHaveLength(names.length); const sandboxModule = { exports: {} as Record<string, (...args: unknown[]) => unknown> }; vm.runInNewContext(ts.transpileModule(functions.map(node => 'export ' + node.getText(ast).replace(/^export\s+/, '')).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: sandboxModule, exports: sandboxModule.exports, Date, Intl, Map, Set, ...globals }); return sandboxModule.exports; }
beforeEach(() => { io.platform = false; io.cap = Infinity; io.missingCount = false; io.failedTable = ''; io.tables = {}; io.calls = []; io.portalFailure = false; io.customers = []; io.requests = []; io.scopes = []; io.permissions = []; io.replies = new Map(); io.blockers = []; vi.stubGlobal('React', React); });
it('retains customer identity lookups beyond the first 100 and the company boundary', async () => { const { InvalidReadModelResponseError } = await import('@/lib/read-models/readResult'); const fn = extract('app/admin/work-queue/page.tsx', ['customerRows', 'loadCustomersByIds'], { InvalidReadModelResponseError }); io.tables.customers = Array.from({ length: 101 }, (_, i) => ({ id: `c-${i}`, company_id: 'A' })); const rows = await fn.loadCustomersByIds({ from: query }, 'A', io.tables.customers.map(row => row.id)) as Row[]; expect(rows).toHaveLength(101); expect(io.calls.every(call => call.filters.some(([key, value]) => key === 'company_id' && value === 'A'))).toBe(true); });
it('summarizes allowed portal fields with business labels and values instead of raw payload keys', () => { const { portalReplySummary } = extract('app/admin/customer-info-requests/page.tsx', ['portalReplySummary']); const result = portalReplySummary({ submitted_payload: { facility_id: '735999000000000001', grid_owner_name: 'Exempelnät', annual_consumption_kwh: 12000, internal_payload: 'secret' } }); expect(result).toContain('Anläggningsnummer'); expect(result).toContain('735999000000000001'); expect(result).not.toContain('facility_id'); expect(result).not.toContain('internal_payload'); });
it('shows a portal reply load failure explicitly', async () => { io.requests = [{ id: 'request', company_id: 'A', status: 'draft', request_type: 'customer_masterdata', target_party_type: 'customer' }]; io.portalFailure = true; const { default: Page } = await import('@/app/admin/customer-info-requests/page'); expect(captureRender(await Page())).toContain('Svar från kundportalen kunde inte läsas'); });
it('makes the thirteenth loaded request reachable', async () => { io.requests = Array.from({ length: 13 }, (_, i) => ({ id: `request-${i}`, company_id: 'A', status: 'draft', request_type: 'customer_masterdata', target_party_type: 'customer', target_party_name: `Mottagare ${i}` })); const { default: Page } = await import('@/app/admin/customer-info-requests/page'); const html = captureRender(await Page({ searchParams: Promise.resolve({ requestPage: '2' }) })); expect(html).toContain('Mottagare 12'); });
it('orders the latest billing underlays before limiting their page', async () => { io.tables.billing_underlays = Array.from({ length: 81 }, (_, i) => ({ id: `underlay-${i}`, company_id: 'A', customer_id: 'customer', underlay_year: i === 80 ? 2027 : 2026, underlay_month: 1, updated_at: i === 80 ? '2027-01-01' : '2026-01-01' })); const { default: Page } = await import('@/app/admin/billing/underlays/page'); const html = captureRender(await Page()); expect(html.replace(/<!--.*?-->/g, '')).toContain('2027-01'); expect(html).toContain('81'); expect(html).toContain('page=2'); });
function billingRows() { io.tables.billing_underlays = [{ id: 'underlay', company_id: 'A', customer_id: 'customer', underlay_year: 2026, underlay_month: 10, total_kwh: 100 }]; io.tables.customers = [{ id: 'customer', company_id: 'A', full_name: 'Syntetisk kund', first_name: 'Syntetisk', last_name: 'Kund' }]; io.tables.customer_contracts = [{ id: 'contract', company_id: 'A', customer_id: 'customer' }]; io.tables.pricing_runs = [{ id: 'run', company_id: 'A', billing_underlay_id: 'underlay', status: 'success', created_at: '2026-10-01', total_ex_vat: 100, total_inc_vat: 125 }]; io.tables.pricing_preview_lines = [{ id: 'line', company_id: 'A', billing_underlay_id: 'underlay', pricing_run_id: 'run', description: 'Elförbrukning', line_type: 'raw_technical_line', amount_ex_vat: 100, metadata: { calculation_type: 'technical_calculation' } }]; }
it('keeps technical pricing diagnostics out of the company underlay view', async () => { billingRows(); const { default: Page } = await import('@/app/admin/billing/underlays/[id]/page'); const html = captureRender(await Page({ params: Promise.resolve({ id: 'underlay' }) })); expect(html).toContain('Elförbrukning'); expect(html).not.toContain('raw_technical_line'); expect(html).not.toContain('technical_calculation'); expect(html).not.toContain('pricing_preview_lines'); });
it('selects the preferred run beyond the old 200-row history cap', async () => { billingRows(); io.platform = true; io.tables.pricing_runs = Array.from({ length: 201 }, (_, i) => ({ id: i === 200 ? 'preferred-locked-run' : `old-${i}`, company_id: 'A', billing_underlay_id: 'underlay', status: i === 200 ? 'locked' : 'success', created_at: '2026-10-01' })); const { default: Page } = await import('@/app/admin/billing/underlays/[id]/page'); const html = captureRender(await Page({ params: Promise.resolve({ id: 'underlay' }) })); expect(html).toContain('preferred-locked-run'); });
it('filters price lines by the selected run before any global history cap', async () => { billingRows(); io.tables.pricing_preview_lines = [...Array.from({ length: 5000 }, (_, i) => ({ id: `old-line-${i}`, company_id: 'A', billing_underlay_id: 'underlay', pricing_run_id: 'old' })), { id: 'chosen', company_id: 'A', billing_underlay_id: 'underlay', pricing_run_id: 'run', description: 'Vald prisrad efter historiken' }]; const { default: Page } = await import('@/app/admin/billing/underlays/[id]/page'); expect(captureRender(await Page({ params: Promise.resolve({ id: 'underlay' }) }))).toContain('Vald prisrad efter historiken'); });
it('shows invoice approval separately from a failed export', async () => { billingRows(); io.tables.invoice_export_items = [{ id: 'item', company_id: 'A', customer_id: 'customer', customer_contract_id: 'contract', billing_underlay_id: 'underlay', pricing_run_id: 'run', status: 'failed', metadata: { approval: { status: 'approved' } }, error_payload: { message: 'raw_provider_diagnostic' } }]; io.tables.customer_invoices = [{ id: 'invoice', company_id: 'A', invoice_export_item_id: 'item', status: 'draft' }]; const { default: Page } = await import('@/app/admin/billing/invoices/[id]/page'); const html = captureRender(await Page({ params: Promise.resolve({ id: 'item' }) })); expect(html).toContain('Godkänd'); expect(html).toContain('Överföringen kräver åtgärd'); expect(html).not.toContain('raw_provider_diagnostic'); expect(html).not.toContain('Snapshot-hash'); });
it('keeps the fourth billing blocker accessible', async () => { io.tables.customers = [{ id: 'customer', company_id: 'A', full_name: 'Syntetisk kund' }]; io.blockers = Array.from({ length: 4 }, (_, i) => ({ code: `blocker-${i}`, title: `Orsak ${i}` })); const { default: Page } = await import('@/app/admin/billing/quality/page'); expect(captureRender(await Page())).toContain('Orsak 3'); });
it('keeps audit raw codes and IDs in the platform view only', async () => { io.tables.audit_logs = [{ id: 'audit', company_id: 'A', action: 'customer.updated', entity_type: 'customer', entity_id: 'raw-internal-identity', created_at: '2026-10-01' }]; const { default: Page } = await import('@/app/admin/audit/page'); const html = captureRender(await Page({})); expect(html).not.toContain('raw-inte'); expect(html).not.toContain('Entity ID'); expect(html).not.toContain('customer.updated'); expect(html).toContain('Kund'); io.platform = true; expect(captureRender(await Page({}))).toContain('customer.updated'); });
it('keeps raw connection diagnostics out of the ordinary data quality view', async () => { io.tables.webhook_deliveries = [{ id: 'delivery', company_id: 'A', event_type: 'raw_internal_event', status: 'failed', failure_reason: 'raw_transport_diagnostic' }]; const { default: Page } = await import('@/app/admin/data-quality/page'); const html = captureRender(await Page()); expect(html).not.toContain('raw_transport_diagnostic'); expect(html).not.toContain('Severity'); expect(html).not.toContain('Entity'); io.platform = true; expect(captureRender(await Page())).toContain('raw_transport_diagnostic'); });
it('fills a billing page despite a lower backend cap and excludes another company', async () => {
    const { readBillingPage } = await import('@/lib/pricing/adminData');
    io.cap = 2;
    io.tables.billing_underlays = [...Array.from({ length: 7 }, (_, i) => ({ id: `own-${i}`, company_id: 'A', underlay_year: 2026 })), { id: 'foreign', company_id: 'B', underlay_year: 2027 }];
    const result = await readBillingPage('billing_underlays', 'A', { pageSize: 5, order: [{ column: 'id' }] });
    expect(result.total).toBe(7);
    expect(result.rows).toHaveLength(5);
    expect(result.rows.every(row => row.company_id === 'A')).toBe(true);
    expect(io.calls.every(call => call.filters.some(([key, value]) => key === 'company_id' && value === 'A'))).toBe(true);
});
it('does not infer a complete billing dataset from a short capped page without an exact count', async () => {
    const { readBillingRows } = await import('@/lib/pricing/adminData');
    io.cap = 2;
    io.missingCount = true;
    io.tables.pricing_preview_lines = Array.from({ length: 5 }, (_, i) => ({ id: `line-${i}`, company_id: 'A' }));
    await expect(readBillingRows('pricing_preview_lines', 'A')).rejects.toThrow('fullständigt');
});
it('reads every selected-run price line across pages without including foreign or other-run rows', async () => {
    const { readBillingRows } = await import('@/lib/pricing/adminData');
    io.cap = 37;
    io.tables.pricing_preview_lines = [...Array.from({ length: 1001 }, (_, i) => ({ id: `line-${String(i).padStart(4, '0')}`, company_id: 'A', pricing_run_id: 'selected' })), { id: 'foreign', company_id: 'B', pricing_run_id: 'selected' }, { id: 'old', company_id: 'A', pricing_run_id: 'old' }];
    const rows = await readBillingRows('pricing_preview_lines', 'A', { pricing_run_id: 'selected' });
    expect(rows).toHaveLength(1001);
    expect(new Set(rows.map(row => row.id)).size).toBe(1001);
    expect(rows.every(row => row.company_id === 'A' && row.pricing_run_id === 'selected')).toBe(true);
});
it('rejects billing reads without a company before querying', async () => {
    const { readBillingPage } = await import('@/lib/pricing/adminData');
    await expect(readBillingPage('billing_underlays', null)).rejects.toThrow('bolag');
    expect(io.calls).toHaveLength(0);
});
it('keeps incomplete underlay reads visibly unavailable instead of showing zero or partial totals', async () => {
    billingRows();
    io.failedTable = 'pricing_preview_lines';
    const { default: Page } = await import('@/app/admin/billing/underlays/[id]/page');
    const html = captureRender(await Page({ params: Promise.resolve({ id: 'underlay' }) }));
    expect(html).toContain('Underlaget kunde inte läsas fullständigt');
    expect(html).not.toContain('Summa');
    expect(html).not.toContain('Elförbrukning');
});
it('makes the next underlay page reachable and preserves the exact total', async () => {
    io.tables.billing_underlays = Array.from({ length: 81 }, (_, i) => ({ id: `underlay-${String(i).padStart(3, '0')}`, company_id: 'A', underlay_year: 2026, underlay_month: 1 }));
    const { default: Page } = await import('@/app/admin/billing/underlays/page');
    const html = captureRender(await Page({ searchParams: Promise.resolve({ page: '2' }) }));
    expect(html).toContain('/underlay-080');
    expect(html).not.toContain('/underlay-000');
    expect(html).toContain('81');
});
it('retains platform pricing provenance and makes history page two reachable', async () => {
    billingRows();
    io.platform = true;
    io.tables.pricing_runs = Array.from({ length: 21 }, (_, i) => ({ id: `history-${String(i).padStart(2, '0')}`, company_id: 'A', billing_underlay_id: 'underlay', status: 'success', created_at: '2026-10-01', total_inc_vat: i === 20 ? 4321 : 123 }));
    io.tables.pricing_preview_lines[0].pricing_run_id = 'history-00';
    const { default: Page } = await import('@/app/admin/billing/underlays/[id]/page');
    const html = captureRender(await Page({ params: Promise.resolve({ id: 'underlay' }), searchParams: Promise.resolve({ runPage: '2' }) }));
    expect(html).toContain('technical_calculation');
    expect(html).toContain('raw_technical_line');
    expect(html).toContain('4 321');
    expect(html).toContain('runPage=1');
});
it('shows physical meter labels only when the company/customer/site chain matches', async () => {
    const { billingMeterLabels } = await import('@/lib/pricing/adminData');
    io.tables.metering_points = [{ id: 'meter', company_id: 'A', site_id: 'site', meter_point_id: '735999000000000001' }, { id: 'foreign', company_id: 'B', site_id: 'site', meter_point_id: 'secret' }];
    io.tables.customer_sites = [{ id: 'site', company_id: 'A', customer_id: 'customer' }];
    const rows = [{ id: 'valid', customer_id: 'customer', metering_point_id: 'meter' }, { id: 'wrong-customer', customer_id: 'other', metering_point_id: 'meter' }, { id: 'wrong-site', customer_id: 'customer', site_id: 'other-site', metering_point_id: 'meter' }, { id: 'foreign', customer_id: 'customer', metering_point_id: 'foreign' }];
    const labels = await billingMeterLabels('A', rows);
    expect([...labels]).toEqual([['valid', '735999000000000001']]);
});
it('does not claim an unknown export state is transferred or waiting', async () => {
    const { invoiceExportStatus } = await import('@/lib/billing/invoiceReviewData');
    expect(invoiceExportStatus('unexpected')).toEqual({ label: 'Överföringsstatus behöver kontrolleras', needsAction: false });
    expect(invoiceExportStatus('sent').label).toContain('Överförd');
});
it('retains raw invoice diagnostics for the platform only', async () => {
    billingRows();
    io.platform = true;
    io.tables.invoice_export_items = [{ id: 'item', company_id: 'A', customer_id: 'customer', customer_contract_id: 'contract', billing_underlay_id: 'underlay', pricing_run_id: 'run', status: 'failed', metadata: { approval: { status: 'approved' } }, error_payload: { message: 'raw_provider_diagnostic' } }];
    io.tables.customer_invoices = [{ id: 'invoice', company_id: 'A', invoice_export_item_id: 'item', status: 'draft' }];
    const { default: Page } = await import('@/app/admin/billing/invoices/[id]/page');
    const html = captureRender(await Page({ params: Promise.resolve({ id: 'item' }) }));
    expect(html).toContain('raw_provider_diagnostic');
    expect(html).toContain('Snapshot-hash');
    expect(html).toContain('Godkänd');
    expect(html).toContain('Överföringen kräver åtgärd');
});
it('makes loaded scopes and permissions beyond twelve reachable and preserves other page selections', async () => {
    io.scopes = Array.from({ length: 13 }, (_, i) => ({ id: `scope-${i}`, company_id: 'A', status: 'active', scope_type: i === 12 ? 'metering_data_access' : 'customer_onboarding' }));
    io.permissions = Array.from({ length: 13 }, (_, i) => ({ id: `permission-${i}`, company_id: 'A', status: 'active', permission_reference: `Tillstånd ${i}` }));
    const { default: Page } = await import('@/app/admin/customer-info-requests/page');
    const html = captureRender(await Page({ searchParams: Promise.resolve({ scopePage: '2', permissionPage: '2', requestPage: '1' }) }));
    expect(html).toContain('Mätvärdesåtkomst');
    expect(html).toContain('Tillstånd 12');
    expect(html).not.toContain('Tillstånd 0');
    expect(html).toContain('scopePage=1&amp;permissionPage=2&amp;requestPage=1');
});
it('keeps billing totals unknown when the underlay list read fails', async () => {
    io.failedTable = 'billing_underlays';
    const { default: Page } = await import('@/app/admin/billing/underlays/page');
    const html = captureRender(await Page());
    expect(html).toContain('Faktureringsunderlagen kunde inte läsas fullständigt');
    expect(html).not.toContain('Inga faktureringsunderlag finns ännu.');
    expect(html).not.toContain('>0</div>');
});
it('retains work queue identity rows with a lower backend cap and rejects unavailable counts', async () => {
    const { InvalidReadModelResponseError } = await import('@/lib/read-models/readResult');
    const fn = extract('app/admin/work-queue/page.tsx', ['customerRows', 'loadCustomersByIds'], { InvalidReadModelResponseError });
    io.cap = 2;
    io.tables.customers = Array.from({ length: 7 }, (_, i) => ({ id: `c-${i}`, company_id: 'A' }));
    const args = [{ from: query }, 'A', io.tables.customers.map(row => row.id)];
    expect(await fn.loadCustomersByIds(...args)).toHaveLength(7);
    io.missingCount = true;
    await expect(fn.loadCustomersByIds(...args)).rejects.toThrow();
});

it('preselects the created customer only when it is in the scoped selector', async () => {
    io.customers = [{ id: 'own-customer', label: 'Egen kund', sublabel: null }];
    const { default: Page } = await import('@/app/admin/customer-info-requests/page');
    const html = captureRender(await Page({ searchParams: Promise.resolve({ customer_id: 'own-customer' }) }));
    const requestForm = html.match(/<details[^>]*id="create-info-request"[\s\S]*?<\/form>/)?.[0];
    expect(requestForm).toBeDefined();
    expect(requestForm).toMatch(/<option value="own-customer" selected="">Egen kund<\/option>/);
});
it('does not preselect foreign or non-scalar customer parameters', async () => {
    io.customers = [{ id: 'own-customer', label: 'Egen kund', sublabel: null }];
    const { default: Page } = await import('@/app/admin/customer-info-requests/page');
    for (const customer_id of ['foreign-customer', ['own-customer', 'foreign-customer']]) {
        const html = captureRender(await Page({ searchParams: Promise.resolve({ customer_id }) }));
        const requestForm = html.match(/<details[^>]*id="create-info-request"[\s\S]*?<\/form>/)?.[0];
        expect(requestForm).toBeDefined();
        expect(requestForm).not.toMatch(/<option value="own-customer" selected="">/);
        expect(requestForm).not.toContain('<option value="foreign-customer"');
    }
});

it('labels real emitted import and case audit actions and offers their exact filter values', async () => {
    io.tables.audit_logs = [
        { id: 'created', company_id: 'A', action: 'customer_created_from_import', entity_type: 'customer' },
        { id: 'registered', company_id: 'A', action: 'customer_case_registered', entity_type: 'customer_case' },
        { id: 'withdrawal', company_id: 'A', action: 'withdrawal_registered', entity_type: 'customer_case' },
    ];
    const { default: Page } = await import('@/app/admin/audit/page');
    const html = captureRender(await Page({}));
    expect(html).toContain('<option value="customer_created_from_import">Kund registrerad från import</option>');
    expect(html).toContain('<option value="customer_case_registered">Kundärende registrerat</option>');
    expect(html).toContain('<option value="withdrawal_registered">Ånger registrerad</option>');
    expect(html).not.toContain('value="customer."');
    expect(html).toMatch(/<td[^>]*>Kund registrerad från import<\/td>/);
    expect(html).toMatch(/<td[^>]*>Kundärende registrerat<\/td>/);
    expect(html).toMatch(/<td[^>]*>Ånger registrerad<\/td>/);
    // The test rows follow the actual audit insert contracts, not webhook names.
    expect(fs.readFileSync('app/admin/customers/actions.part-4.ts', 'utf8')).toContain('action: "customer_created_from_import"');
    const cases = fs.readFileSync('lib/customer-cases/db.ts', 'utf8');
    expect(cases).toContain("entity_type: 'customer_case'");
    expect(cases).toContain("action: row.case_type === 'withdrawal' ? 'withdrawal_registered' : 'customer_case_registered'");
});
it('filters exact company audit action and entity contracts without mixing customer categories', async () => {
    io.tables.audit_logs = [
        { id: 'customer', company_id: 'A', action: 'customer_created_from_import', entity_type: 'customer' },
        { id: 'case', company_id: 'A', action: 'customer_case_registered', entity_type: 'customer_case' },
        { id: 'withdrawal', company_id: 'A', action: 'withdrawal_registered', entity_type: 'customer_case' },
        { id: 'foreign', company_id: 'B', action: 'customer_case_registered', entity_type: 'customer_case' },
    ];
    const { default: Page } = await import('@/app/admin/audit/page');
    await Page({ searchParams: Promise.resolve({ action: 'customer_case_registered', entity: 'customer_case' }) });
    expect(io.calls.at(-1)?.filters).toEqual(expect.arrayContaining([['company_id', 'A'], ['action', 'customer_case_registered'], ['entity_type', 'customer_case']]));
    const customerHtml = captureRender(await Page({ searchParams: Promise.resolve({ entity: 'customer' }) }));
    expect(customerHtml).toMatch(/<td[^>]*>Kund registrerad från import<\/td>/);
    expect(customerHtml).not.toMatch(/<td[^>]*>Kundärende registrerat<\/td>/);
    expect(customerHtml).not.toMatch(/<td[^>]*>Ånger registrerad<\/td>/);
});

it('keys the actual request selector by company and validated route customer for same-page navigation', async () => {
    io.customers = [{ id: 'own-customer', label: 'Egen kund', sublabel: null }, { id: 'other-customer', label: 'Annan kund', sublabel: null }];
    const { default: Page } = await import('@/app/admin/customer-info-requests/page');
    const { default: ResourceSelects } = await import('@/app/admin/customer-info-requests/CustomerResourceSelects');
    function find(node: React.ReactNode): Array<React.ReactElement<{ children?: React.ReactNode; initialCustomerId?: string }>> {
        if (Array.isArray(node)) return node.flatMap(find);
        if (!React.isValidElement(node)) return [];
        const element = node as React.ReactElement<{ children?: React.ReactNode; initialCustomerId?: string }>;
        return [element, ...find(element.props.children)];
    }
    for (const [customerId, expected] of [['own-customer', 'own-customer'], ['other-customer', 'other-customer'], ['foreign-customer', '']]) {
        const page = await Page({ searchParams: Promise.resolve({ customer_id: customerId }) });
        const selector = find(page).find(element => element.type === ResourceSelects);
        expect(selector?.props.initialCustomerId).toBe(expected);
        expect(selector?.key).toBe(`A:${expected}`);
    }
});
