import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceFileArtifact, InvoiceFileRow } from '@/lib/billing/invoiceFileExport';
const itemId = '33000000-0000-4000-8000-000000000001';
const approverId = '33000000-0000-4000-8000-000000000002';
const reviewHash = 'c'.repeat(64);
const approvedAt = '2026-11-01T10:00:00.000Z';
type FileRpcArgs = {
    p_company_id: string;
    p_environment: string;
    p_rows: InvoiceFileRow[];
    p_file_id: string;
    p_created_at: string;
    p_rows_sha256: string;
    p_artifacts: InvoiceFileArtifact[];
};
const state = vi.hoisted(() => ({
    tables: {} as FixtureTables,
    writeError: null as { code: string; message: string } | null,
    calls: [] as Array<{
        name: string;
        args: FileRpcArgs;
    }>,
    updates: [] as FixtureUpdate[],
    queries: [] as FixtureQueryRead[]
}));
const declaredColumns: Record<string, string> = {
    pricing_preview_lines: 'company_id,pricing_run_id,sort_order',
    customer_sites: 'facility_id,street,postal_code,city,grid_area_code,annual_consumption_kwh',
    metering_points: 'metering_point_id,ediel_metering_point_id,site_facility_id,grid_area_code,grid_owner_name,estimated_annual_consumption_kwh',
    customer_contracts: 'contract_name,contract_number,contract_type,actual_start_date,confirmed_start_date,starts_at,ends_at,binding_months,notice_months,auto_renew_enabled,fixed_price_ore_per_kwh,spot_markup_ore_per_kwh,markup_ore_per_kwh,monthly_fee_sek',
    billing_export_run_items: 'invoice_recipient,invoice_email,invoice_reference,invoice_address_snapshot'
};
function allowedColumns(table: string) {
    return [...state.tables[table].flatMap(row => Object.keys(row)), ...(declaredColumns[table] ?? '').split(','), 'created_at'];
}
type FixtureRow = Record<string, unknown>;
type FixtureTables = Record<string, FixtureRow[]>;
type QueryResult = {
    data: FixtureRow | FixtureRow[] | null;
    error: null;
};
type FixtureQueryRead = {
    table: string;
    cols: string;
};
type FixtureUpdate = {
    table: string;
    values: FixtureRow;
};
/** Filter full stored rows first, then expose only the actual production projection. */
class ProjectionQuery implements PromiseLike<QueryResult> {
    private columns = '*';
    private filters: Array<(row: FixtureRow) => boolean> = [];
    private bounds: [
        number,
        number
    ] | null = null;
    private sortKey: string | null = null;
    private sortAscending = true;
    private oneRow = false;
    private updateValues: FixtureRow | null = null;
    constructor(private readonly table: string) {
        if (!Object.hasOwn(state.tables, table))
            throw new Error('Unknown fixture table: ' + table);
    }
    private check(column: string) {
        if (!allowedColumns(this.table).includes(column)) {
            throw new Error('Unknown fixture column: ' + this.table + '.' + column);
        }
    }
    select(columns: string) {
        if (columns !== '*')
            columns.split(',').map(column => column.trim()).forEach(column => this.check(column));
        this.columns = columns;
        return this;
    }
    eq(column: string, value: unknown) {
        this.check(column);
        this.filters.push(row => row[column] === value);
        return this;
    }
    neq(column: string, value: unknown) {
        this.check(column);
        this.filters.push(row => row[column] !== value);
        return this;
    }
    in(column: string, values: unknown[]) {
        this.check(column);
        this.filters.push(row => values.includes(row[column]));
        return this;
    }
    is(column: string, value: unknown) {
        return this.eq(column, value);
    }
    order(column: string, options: {
        ascending?: boolean;
    } = {}) {
        this.check(column);
        this.sortKey = column;
        this.sortAscending = options.ascending !== false;
        return this;
    }
    range(from: number, to: number) {
        this.bounds = [from, to];
        return this;
    }
    single() {
        this.oneRow = true;
        return this;
    }
    maybeSingle() {
        return this.single();
    }
    update(values: FixtureRow) {
        if (!['billing_export_run_items', 'billing_export_runs'].includes(this.table)) {
            throw new Error('Unexpected fixture update');
        }
        this.updateValues = values;
        return this;
    }
    private async execute(): Promise<QueryResult> {
        let rows = state.tables[this.table].filter(row => this.filters.every(filter => filter(row)));
        if (this.sortKey) {
            const key = this.sortKey;
            rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (this.sortAscending ? 1 : -1));
        }
        if (this.bounds)
            rows = rows.slice(this.bounds[0], this.bounds[1] + 1);
        if (this.oneRow && rows.length > 1)
            throw new Error('Multiple rows for single-row fixture query');
        if (this.updateValues) {
            const values = this.updateValues;
            state.updates.push({
                table: this.table,
                values: structuredClone(values)
            });
            rows.forEach(row => Object.assign(row, values));
        }
        state.queries.push({
            table: this.table,
            cols: this.columns
        });
        const projected = rows.map(row => this.columns === '*'
            ? structuredClone(row)
            : Object.fromEntries(this.columns.split(',').map(column => column.trim())
                .filter(column => Object.hasOwn(row, column)).map(column => [column, row[column]])));
        return {
            data: this.oneRow ? projected[0] ?? null : projected,
            error: null
        };
    }
    then<TResult1 = QueryResult, TResult2 = never>(onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2> {
        return this.execute().then(onfulfilled, onrejected);
    }
}
vi.mock('@/lib/supabase/service', () => ({
    supabaseService: {
        from: (table: string) => new ProjectionQuery(table),
        async rpc(name: string, args: FileRpcArgs) {
            if (name === 'gridex_read_invoice_file_intent_v2') return { data: null, error: null };
            if (name !== 'gridex_write_invoice_file_intent_v2')
                throw new Error('Unexpected RPC ' + name);
            state.calls.push({
                name,
                args: structuredClone(args)
            });
            if (state.writeError) return { data: null, error: state.writeError };
            return {
                data: { fileId: args.p_file_id, rowCount: args.p_rows.length, rowsSha256: args.p_rows_sha256, replayed: false,
                    provider: 'file_export', environment: args.p_environment, createdAt: args.p_created_at,
                    artifacts: args.p_artifacts.map(({ bodyBase64: _storedBody, ...manifest }) => manifest) },
                error: null
            };
        }
    }
}));
vi.mock('@/lib/ediel/retention/financeCopyRetention', () => ({
    requireInvoiceSourceCopiesAvailable: vi.fn()
}));
vi.mock('@/lib/tenant/governance', () => ({
    requireCompanyOperationalForWrites: vi.fn()
}));
vi.mock('@/lib/platform/outboundFreeze', () => ({
    assertOutboundAllowed: vi.fn()
}));
vi.mock('@/lib/events/domainEvents', () => ({
    emitDomainEvent: vi.fn(async () => null)
}));
// API authentication, automation and month-lock boundaries are not used by this file-export fixture.
vi.mock('@/lib/integrations/billing/capway/auth', () => ({
    resolveCapwayConnectionConfig: vi.fn(() => {
        throw Error('Unexpected API auth');
    })
}));
vi.mock('@/lib/integrations/billing/capway/client', () => ({
    CapwayApticClient: class {
        constructor() {
            throw Error('Unexpected API client');
        }
    }
}));
vi.mock('@/lib/automation/locks', () => ({
    withAutomationLock: vi.fn(() => {
        throw Error('Unexpected automation lock');
    })
}));
vi.mock('@/lib/billing/invoiceReadiness', () => ({
    lockBillingPeriodForInvoiceExport: vi.fn(() => {
        throw Error('Unexpected month lock');
    })
}));
import { createInvoiceFile } from '@/lib/billing/invoiceFileExport';
const run = () => createInvoiceFile({
    companyId: 'company-A',
    billingMonth: '2026-11',
    actorUserId: approverId,
    exportIntentId: '33000000-0000-4000-8000-000000000003',
    exportIntentScope: { provider: 'file_export', environment: 'test', selection: [{ itemId, approvedBy: approverId, approvedAt, reviewHash }] },
    now: new Date('2026-11-01T12:00:00Z')
});
const legacy = () => state.tables.billing_export_run_items[0] as FixtureRow & {
    invoice_address_snapshot: FixtureRow;
};
beforeEach(() => {
    state.calls = [];
    state.writeError = null;
    state.updates = [];
    state.tables = {
        companies: [{
            id: 'company-A',
            invoice_export_target_system: 'file_export',
            billing_provider_environment: 'test',
            invoice_export_enabled: true
            }],
        invoice_export_runs: [{
            id: 'run-A',
            company_id: 'company-A',
            billing_month: '2026-11',
            provider: 'file_export',
            environment: 'test'
            }],
        invoice_export_items: [{
            id: itemId,
            company_id: 'company-A',
            export_run_id: 'run-A',
            customer_id: 'customer-A',
            customer_contract_id: 'contract-A',
            billing_underlay_id: 'underlay-A',
            pricing_run_id: 'pricing-A',
            status: 'pending',
            export_file_id: null,
            metadata: {
                    approval: {
                        status: 'approved', approved_by: approverId, approved_at: approvedAt, review_hash: reviewHash
                    }
                },
            total_kwh: 10,
            amount_ex_vat: 100,
            vat_amount: 25,
            amount_inc_vat: 125
            }],
        pricing_runs: [{
            id: 'pricing-A',
            company_id: 'company-A',
            billing_underlay_id: 'underlay-A',
            status: 'locked',
            locked_at: '2026-11-01T00:00:00Z',
            total_ex_vat: 100,
            vat_amount: 25,
            total_inc_vat: 125
            }],
        pricing_preview_lines: [],
        customers: [{
            id: 'customer-A',
            company_id: 'company-A',
            full_name: 'Changed live recipient',
            invoice_email: 'changed-live@example.invalid',
            billing_street: 'Changed live customer street',
            billing_postal_code: '99999',
            billing_city: 'Changed live city'
            }],
        billing_underlays: [{
            id: 'underlay-A',
            company_id: 'company-A',
            customer_id: 'customer-A',
            customer_contract_id: 'contract-A',
            customer_site_id: 'site-A',
            metering_point_id: 'meter-A',
            status: 'validated',
            readiness_status: 'ready',
            missing_values_count: 0,
            total_kwh: 10,
            price_area: 'SE3',
            underlay_year: 2026,
            underlay_month: 11
            }],
        customer_invoices: [{
            id: 'invoice-A',
            company_id: 'company-A',
            invoice_export_item_id: itemId,
            invoice_reference: 'invoice-stable-reference',
            price_area_code: 'SE3',
            calculation_snapshot_sha256: 'a'.repeat(64),
            total_kwh: 10,
            amount_inc_vat: 125
            }],
        billing_export_run_items: [{
            id: itemId,
            company_id: 'company-A',
            invoice_recipient: 'Frozen recipient',
            invoice_email: null,
            invoice_reference: 'Frozen contact reference',
            invoice_address_snapshot: {
                    recipient: 'Frozen recipient',
                    email: null,
                    street: 'Frozen approved street',
                    postal_code: '12345',
                    city: 'Frozen approved city',
                    country: 'SE'
                }
            }],
        billing_export_runs: [{
                id: 'run-A',
                company_id: 'company-A'
            }],
        customer_sites: [{
            id: 'site-A',
            company_id: 'company-A',
            street: 'Changed live site street',
            postal_code: '88888',
            city: 'Changed live site city'
            }],
        metering_points: [{
                id: 'meter-A',
                company_id: 'company-A'
            }],
        customer_contracts: [{
                id: 'contract-A',
                company_id: 'company-A'
            }]
    };
});
describe('DELIVERY01.04 public file export frozen delivery boundary', () => {
    it.each([
        'billing_finalized_supply_basis_changed',
        'ended_supply_pricing_basis_changed',
    ])('reports %s as a changed approved file selection', async (message) => {
        state.writeError = { code: '23514', message };
        await expect(run()).rejects.toMatchObject({ code: 'invoice_file_selection_changed' });
        expect(state.calls).toHaveLength(1);
    });

    it('preserves the named recoverable archive lock for a retry', async () => {
        state.writeError = { code: '55P03', message: 'invoice_file_finance_lock_busy' };
        await expect(run()).rejects.toMatchObject({ code: 'invoice_file_finance_lock_busy' });
        expect(state.calls).toHaveLength(1);
    });

    it.each([
        { code: '40001', message: 'billing_finalized_supply_basis_changed' },
        { code: '23514', message: 'unexpected_file_constraint' },
        { code: '23514', message: 'invoice_file_finance_lock_busy' },
        { code: '55P03', message: 'unexpected_file_lock' },
    ])('preserves unexpected archive error $code and $message', async (error) => {
        state.writeError = error;
        await expect(run()).rejects.toThrow(error.message);
        expect(state.calls).toHaveLength(1);
    });

    it('refuses a new export without its identified frozen intent before reading or writing', async () => {
        await expect(createInvoiceFile({ companyId: 'company-A', billingMonth: '2026-11', actorUserId: approverId }))
            .rejects.toMatchObject({ code: 'invoice_file_intent_invalid' });
        expect(state.calls).toEqual([]);
    });
    it.each(['street', 'postal_code', 'city'])('refuses approved snapshot missing %s before file RPC', async (field) => {
        legacy().invoice_address_snapshot[field] = '  ';
        await expect(run()).rejects.toMatchObject({ code: 'invoice_distribution_missing' });
        expect(state.calls).toEqual([]);
        expect(state.updates).toEqual([]);
    });
    it('refuses absent frozen address and never backfills live customer/site email or postal data', async () => {
        legacy().invoice_address_snapshot = {
            recipient: 'Frozen recipient'
        };
        await expect(run()).rejects.toMatchObject({ code: 'invoice_distribution_missing' });
        expect(state.calls).toEqual([]);
    });
    it('persists the approved frozen address despite changed live customer and site addresses', async () => {
        const before = structuredClone(legacy().invoice_address_snapshot);
        const result = await run();
        expect(result.rowCount).toBe(1);
        expect(state.calls).toHaveLength(1);
        expect(state.calls[0].args).toMatchObject({
            p_company_id: 'company-A',
            p_environment: 'test'
        });
        expect(state.calls[0].args.p_rows[0]).toMatchObject({
            invoice_export_item_id: itemId,
            invoice_number: null,
            invoice_reference: 'invoice-stable-reference',
            reference: 'Frozen contact reference',
            recipient: 'Frozen recipient',
            email: null,
            street: 'Frozen approved street',
            postal_code: '12345',
            city: 'Frozen approved city'
        });
        expect(legacy().invoice_address_snapshot).toEqual(before);
    });
    it('permits confirmed frozen email-only delivery without inventing a postal requirement', async () => {
        legacy().invoice_address_snapshot = {
            recipient: 'Frozen recipient',
            email: 'approved@example.invalid'
        };
        await run();
        expect(state.calls[0].args.p_rows[0]).toMatchObject({
            email: 'approved@example.invalid',
            street: null,
            postal_code: null,
            city: null
        });
    });
});
