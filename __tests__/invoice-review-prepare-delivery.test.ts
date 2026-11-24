import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { resolveInvoiceDeliveryFor } from '@/lib/billing/effectiveInvoiceDelivery';
type DeliveryArguments = Parameters<typeof resolveInvoiceDeliveryFor>;
type InvoiceAddress = {
    recipient: string | null;
    email: string | null;
    reference: string | null;
    street: string | null;
    postal_code: string | null;
    city: string | null;
    country: string | null;
};
type DraftRpcArgs = {
    p_company_id: string;
    p_run: {
        legacy_items: Array<FixtureRow & {
            invoice_address_snapshot: InvoiceAddress;
        }>;
    };
    p_items: Array<FixtureRow & {
        id: string;
    }>;
    p_invoices: FixtureRow[];
    p_enrichment: {
        invoice_export_item_id: string;
    };
};
const state = vi.hoisted(() => ({
    tables: {} as FixtureTables,
    calls: [] as Array<{
        name: string;
        args: DraftRpcArgs;
    }>,
    queries: [] as FixtureQueryRead[],
    updates: [] as FixtureUpdate[],
    resolverInputs: [] as DeliveryArguments[]
}));
const fixtureSchema: Record<string, string[]> = {
    "billing_underlays": [
        "billing_block_reason",
        "billing_configuration_snapshot_sha256",
        "billing_period_end",
        "billing_period_start",
        "company_id",
        "contract_id",
        "contract_price_snapshot_id",
        "currency",
        "customer_contract_id",
        "customer_id",
        "customer_site_id",
        "energy_direction",
        "id",
        "metering_point_id",
        "missing_values_count",
        "portfolio_id",
        "portfolio_monthly_settlement_id",
        "portfolio_settlement_revision",
        "portfolio_settlement_sha256",
        "price_area",
        "price_plan_id",
        "price_plan_version_id",
        "pricing_snapshot_id",
        "readiness_status",
        "settlement_type",
        "site_id",
        "source_meter_value_count",
        "status",
        "total_kwh",
        "underlay_month",
        "underlay_year",
        "vat_rate"
    ],
    "invoice_export_items": [
        "status",
        "billing_underlay_id",
        "company_id",
        "customer_id",
        "id",
        "metering_point_id"
    ],
    "customer_contracts": [
        "billing_address_same_as_site",
        "billing_city",
        "billing_country",
        "billing_level",
        "billing_postal_code",
        "billing_street",
        "company_id",
        "consolidated_invoice",
        "contract_name",
        "contract_number",
        "contract_price_snapshot_id",
        "contract_product_version_id",
        "contract_type",
        "customer_id",
        "customer_site_id",
        "id",
        "invoice_email",
        "invoice_recipient",
        "invoice_reference",
        "metering_point_id",
        "price_area_used",
        "price_plan_id",
        "price_plan_version_id",
        "site_id",
        "snapshot_hash",
        "status",
        "updated_at",
        "vat_rate"
    ],
    "customers": [
        "billing_country",
        "billing_city",
        "billing_postal_code",
        "billing_street",
        "company_id",
        "company_name",
        "customer_number",
        "full_name",
        "id",
        "invoice_email"
    ],
    "contract_price_snapshots": [
        "area_price_reference",
        "company_id",
        "contract_id",
        "customer_id",
        "fixed_weight_percent",
        "id",
        "invoice_delivery_method",
        "portfolio_weight_percent",
        "price_option_reference",
        "price_plan_id",
        "price_plan_version_id",
        "pricing_model",
        "snapshot_hash",
        "snapshot_schema_version",
        "spot_weight_percent",
        "valid_from",
        "valid_to"
    ],
    "customer_sites": [
        "city",
        "company_id",
        "country",
        "customer_id",
        "customer_site_id",
        "id",
        "postal_code",
        "street"
    ],
    "metering_points": [
        "company_id",
        "customer_id",
        "customer_site_id",
        "id",
        "metering_point_id",
        "site_id"
    ]
};
function allowedColumns(table: string) {
    return fixtureSchema[table];
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
        async rpc(name: string, args: DraftRpcArgs) {
            if (name !== 'gridex_create_invoice_review_draft_v1')
                throw new Error('Unexpected RPC');
            state.calls.push({
                name,
                args: structuredClone(args)
            });
            return {
                data: {},
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
vi.mock('@/lib/events/domainEvents', () => ({
    emitDomainEvent: vi.fn(async () => null)
}));
vi.mock('@/lib/pricing/engine', () => ({
    lockPricingPreview: vi.fn(() => {
        throw Error('Unexpected pricing lock fallback');
    })
}));
vi.mock('@/lib/pricing/underlayPricingAdapter', () => ({
    loadLockedUnderlayPricingWithCore: vi.fn(async () => ({
        locked: true,
        pricingRunId: 'pricing-A',
        engine: 'fixture',
        lines: [],
        intervalEvidence: {
            source: 'declared synthetic locked pricing'
        },
        subtotalSekExVat: 100,
        vatSek: 25,
        totalSekIncVat: 125
    })),
    calculateUnderlayPricingWithCore: vi.fn(() => {
        throw Error('Unexpected unlocked pricing');
    })
}));
vi.mock('@/lib/billing/effectiveInvoiceDelivery', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/billing/effectiveInvoiceDelivery')>();
    return {
        ...actual,
        resolveInvoiceDeliveryFor: (...args: DeliveryArguments) => {
            state.resolverInputs.push(structuredClone(args));
            return actual.resolveInvoiceDeliveryFor(...args);
        }
    };
});
import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare';
const run = () => prepareInvoiceDraftsForReview({
    companyId: 'company-A',
    billingMonth: '2026-11',
    environment: 'test',
    provider: 'file_export',
    actorUserId: 'actor-A',
    customerId: 'customer-A',
    billingUnderlayId: 'underlay-A'
});
function snapshot(): InvoiceAddress {
    const call = state.calls.find(call => call.name === 'gridex_create_invoice_review_draft_v1');
    if (!call)
        throw new Error('Expected an actual draft RPC');
    return call.args.p_run.legacy_items[0].invoice_address_snapshot;
}
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
    vi.stubEnv('GRIDEX_INVOICE_DELIVERY_RESOLVER', 'shared');
    state.calls = [];
    state.queries = [];
    state.resolverInputs = [];
    state.tables = {
        billing_underlays: [{
            id: 'underlay-A',
            company_id: 'company-A',
            customer_id: 'customer-A',
            customer_contract_id: 'contract-A',
            customer_site_id: 'site-A',
            metering_point_id: 'meter-A',
            underlay_year: 2026,
            underlay_month: 11,
            status: 'validated',
            readiness_status: 'ready',
            contract_price_snapshot_id: 'price-A',
            price_area: 'SE3',
            total_kwh: 10
            }],
        invoice_export_items: [],
        customer_contracts: [{
                id: 'contract-A',
                company_id: 'company-A',
                customer_id: 'customer-A',
                customer_site_id: 'site-A',
                site_id: 'site-A',
                metering_point_id: 'meter-A',
                billing_address_same_as_site: true,
                updated_at: '2026-11-01T12:00:00Z'
            }],
        customers: [{
                id: 'customer-A',
                company_id: 'company-A',
                full_name: 'Fixture recipient',
                email: 'contact-only@example.invalid'
            }],
        metering_points: [{
                id: 'meter-A',
                company_id: 'company-A',
                customer_id: 'customer-A',
                customer_site_id: 'site-A',
                site_id: 'site-A'
            }],
        contract_price_snapshots: [{
                id: 'price-A',
                company_id: 'company-A',
                contract_id: 'contract-A'
            }],
        customer_sites: [{
                id: 'site-B',
                company_id: 'company-A',
                customer_id: 'customer-A',
                street: 'Wrong second street',
                postal_code: '33333',
                city: 'Wrong second city'
            }, {
                id: 'site-A',
                company_id: 'company-A',
                customer_id: 'customer-A',
                street: 'Exact site street',
                postal_code: '22222',
                city: 'Exact site city'
            }]
    };
});
describe('invoice review for a held price timeline', () => {
    const reason = 'price_timeline_invoice_review_required';
    const runMonth = () => prepareInvoiceDraftsForReview({
        companyId: 'company-A', billingMonth: '2026-11', environment: 'test',
        provider: 'file_export', actorUserId: 'actor-A'
    });

    it('keeps the two price intervals out of invoice preparation and lets the standard customer continue', async () => {
        const ordinary = state.tables.billing_underlays[0];
        state.tables.customers.push({ ...state.tables.customers[0], id: 'customer-held' });
        state.tables.customer_sites.push({ ...state.tables.customer_sites[1], id: 'site-held', customer_id: 'customer-held' });
        state.tables.metering_points.push({ ...state.tables.metering_points[0], id: 'meter-held',
            customer_id: 'customer-held', customer_site_id: 'site-held', site_id: 'site-held' });
        state.tables.customer_contracts.push({ ...state.tables.customer_contracts[0], id: 'contract-held',
            customer_id: 'customer-held', customer_site_id: 'site-held', site_id: 'site-held', metering_point_id: 'meter-held' });
        state.tables.contract_price_snapshots.push({ ...state.tables.contract_price_snapshots[0],
            id: 'price-held', contract_id: 'contract-held', customer_id: 'customer-held' });
        const held = { ...ordinary, customer_id: 'customer-held', billing_block_reason: reason,
            customer_contract_id: 'contract-held', customer_site_id: 'site-held', metering_point_id: 'meter-held',
            contract_price_snapshot_id: 'price-held' };
        state.tables.billing_underlays.push(
            { ...held, id: 'split-first' },
            { ...held, id: 'split-second' }
        );

        await expect(runMonth()).resolves.toMatchObject({ underlays: 3, candidates: 1, blocked: 2, created: 1, failed: 0 });
        expect(state.calls).toHaveLength(1);
        expect(state.calls[0].args.p_items[0].billing_underlay_id).toBe('underlay-A');

        state.calls = [];
        await expect(prepareInvoiceDraftsForReview({
            companyId: 'company-A', billingMonth: '2026-11', environment: 'test', provider: 'file_export',
            actorUserId: 'actor-A', customerId: 'customer-held', billingUnderlayId: 'split-first'
        })).resolves.toMatchObject({ underlays: 1, candidates: 0, blocked: 1, created: 0, failed: 0 });
        expect(state.calls).toHaveLength(0);
    });

    it('keeps all members of an explicit group when one member is held for review', async () => {
        const ordinary = state.tables.billing_underlays[0];
        state.tables.customer_contracts.push({
            ...state.tables.customer_contracts[0], id: 'contract-held', customer_id: 'customer-held',
            consolidated_invoice: true
        });
        state.tables.billing_underlays.push(
            { ...ordinary, id: 'held-member', customer_id: 'customer-held', customer_contract_id: 'contract-held',
                billing_block_reason: reason },
            { ...ordinary, id: 'other-site', customer_id: 'customer-held', customer_contract_id: 'contract-held',
                customer_site_id: 'site-B' }
        );

        await expect(runMonth()).resolves.toMatchObject({ underlays: 3, candidates: 1, blocked: 2, created: 1, failed: 0 });
        expect(state.calls).toHaveLength(1);
        expect(state.calls[0].args.p_items[0].billing_underlay_id).toBe('underlay-A');
    });
});

describe('DELIVERY01.04 public prepare with projection-correct reads and real shared resolver', () => {
    it('loads same-as-site intent into draft contract snapshot independently of site availability', async () => {
        await run();
        expect(state.resolverInputs[0][0]).toBe('document');
        expect(state.resolverInputs[0][1].contract!.billing_address_same_as_site).toBe(true);
    });
    it('passes exact siteAddress to the real resolver independently of selected flag', async () => {
        await run();
        expect(state.resolverInputs[0][1].siteAddress).toMatchObject({
            street: 'Exact site street',
            postalCode: '22222',
            city: 'Exact site city'
        });
    });
    it('freezes the exact site address rather than another site or customer billing fallback', async () => {
        const result = await run();
        expect(result.created).toBe(1);
        expect(snapshot()).toMatchObject({
            street: 'Exact site street',
            postal_code: '22222',
            city: 'Exact site city'
        });
        const args = state.calls[0].args;
        expect(args.p_company_id).toBe('company-A');
        expect(args.p_run.legacy_items[0]).toMatchObject({
            company_id: 'company-A',
            customer_id: 'customer-A',
            contract_id: 'contract-A',
            site_id: 'site-A',
            metering_point_id: 'meter-A'
        });
        expect(args.p_items[0]).toMatchObject({
            company_id: 'company-A',
            customer_id: 'customer-A',
            customer_contract_id: 'contract-A',
            metering_point_id: 'meter-A'
        });
        expect(args.p_invoices[0]).toMatchObject({
            customer_id: 'customer-A',
            customer_contract_id: 'contract-A'
        });
        expect(args.p_enrichment.invoice_export_item_id).toBe(args.p_items[0].id);
    });
    it('permits confirmed invoice email without unused site or meter identities or queries', async () => {
        state.tables.customers[0].invoice_email = 'billing@example.invalid';
        for (const table of ['billing_underlays', 'customer_contracts']) {
            delete state.tables[table][0].customer_site_id;
            delete state.tables[table][0].site_id;
            delete state.tables[table][0].metering_point_id;
        }
        state.tables.customer_sites = [];
        state.tables.metering_points = [];
        const result = await run();
        expect(result.created).toBe(1);
        expect(snapshot().email).toBe('billing@example.invalid');
        expect(state.queries.some(q => ['customer_sites', 'metering_points'].includes(q.table))).toBe(false);
    });
    it.each([
        [undefined, 'paper'],
        ['shared', 'paper'],
        [undefined, 'email'],
        ['shared', 'email']
    ])('freezes %s resolver choice %s when both delivery channels are configured', async (mode, method) => {
        vi.stubEnv('GRIDEX_INVOICE_DELIVERY_RESOLVER', mode);
        state.tables.contract_price_snapshots[0].invoice_delivery_method = method;
        Object.assign(state.tables.customer_contracts[0], {
            invoice_recipient: 'Avtalad fakturamottagare',
            invoice_email: 'faktura@example.invalid',
            billing_street: 'Fakturagatan 1',
            billing_postal_code: '11111',
            billing_city: 'Stockholm',
            billing_country: 'SE'
        });
        const result = await run();
        expect(result.created).toBe(1);
        expect(state.calls[0].args.p_enrichment).toMatchObject({
            calculation_snapshot: { invoice_delivery_method: method }
        });
        expect(snapshot()).toMatchObject({
            email: 'faktura@example.invalid',
            street: 'Fakturagatan 1',
            country: 'SE'
        });
    });
    it('freezes explicit paper and the foreign address while retaining billing contact data', async () => {
        state.tables.contract_price_snapshots[0].invoice_delivery_method = 'paper';
        state.tables.customer_contracts[0].billing_address_same_as_site = false;
        Object.assign(state.tables.customers[0], {
            invoice_email: 'retained-invoice@example.invalid',
            billing_street: 'Norwegian street',
            billing_postal_code: '0123',
            billing_city: 'Oslo',
            billing_country: 'NO'
        });
        const result = await run();
        expect(result.created).toBe(1);
        expect(state.calls[0].args.p_enrichment).toMatchObject({
            calculation_snapshot: { invoice_delivery_method: 'paper' },
            calculation_snapshot_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
        });
        expect(snapshot()).toMatchObject({
            email: 'retained-invoice@example.invalid',
            street: 'Norwegian street',
            postal_code: '0123',
            city: 'Oslo',
            country: 'NO'
        });
    });
    it('refuses explicit paper with only a confirmed email before draft RPC', async () => {
        state.tables.contract_price_snapshots[0].invoice_delivery_method = 'paper';
        state.tables.customer_contracts[0].billing_address_same_as_site = false;
        state.tables.customers[0].invoice_email = 'billing@example.invalid';
        const result = await run();
        expect(result.errors).toContainEqual({
            billingUnderlayId: 'underlay-A',
            error: 'Pappersfaktura har valts men en komplett fakturaadress saknas.'
        });
        expect(state.calls).toEqual([]);
    });
    it('refuses explicit email with only a complete postal address before draft RPC', async () => {
        state.tables.contract_price_snapshots[0].invoice_delivery_method = 'email';
        const result = await run();
        expect(result.errors).toContainEqual({
            billingUnderlayId: 'underlay-A',
            error: 'Faktura via e-post har valts men en bekräftad faktura-e-post saknas.'
        });
        expect(state.calls).toEqual([]);
    });
    it('refuses shared missing recipient despite complete postal channel before draft RPC', async () => {
        delete state.tables.customers[0].full_name;
        delete state.tables.customers[0].company_name;
        delete state.tables.customer_contracts[0].invoice_recipient;
        const result = await run();
        expect(result.created).toBe(0);
        expect(result.failed).toBe(1);
        expect(state.calls).toEqual([]);
    });
    it('uses complete contract postal address without requiring unused site or meter fallback', async () => {
        Object.assign(state.tables.customer_contracts[0], {
            billing_street: 'Contract street',
            billing_postal_code: '44444',
            billing_city: 'Contract city'
        });
        for (const table of ['billing_underlays', 'customer_contracts']) {
            delete state.tables[table][0].customer_site_id;
            delete state.tables[table][0].site_id;
            delete state.tables[table][0].metering_point_id;
        }
        state.tables.customer_sites = [];
        state.tables.metering_points = [];
        const result = await run();
        expect(result.created).toBe(1);
        expect(snapshot()).toMatchObject({
            street: 'Contract street',
            postal_code: '44444',
            city: 'Contract city'
        });
        expect(state.queries.some(q => ['customer_sites', 'metering_points'].includes(q.table))).toBe(false);
    });
    it('preserves complete explicit contract postal precedence', async () => {
        Object.assign(state.tables.customer_contracts[0], {
            billing_street: 'Contract street',
            billing_postal_code: '44444',
            billing_city: 'Contract city'
        });
        await run();
        expect(snapshot()).toMatchObject({
            street: 'Contract street',
            postal_code: '44444',
            city: 'Contract city'
        });
    });
    it('inherits confirmed invoice email and never general contact email in shared mode', async () => {
        state.tables.customers[0].invoice_email = 'billing@example.invalid';
        await run();
        expect(snapshot().email).toBe('billing@example.invalid');
        state.calls = [];
        state.resolverInputs = [];
        delete state.tables.customers[0].invoice_email;
        await run();
        expect(state.resolverInputs[0][1].customer!.invoice_email).toBeUndefined();
    });
    it.each(['legacy', undefined])('keeps legacy/default %s document behavior contract-only', async (mode) => {
        vi.stubEnv('GRIDEX_INVOICE_DELIVERY_RESOLVER', mode);
        await run();
        expect(snapshot()).toMatchObject({
            recipient: null,
            email: null,
            street: null,
            postal_code: null,
            city: null
        });
    });
    it('preserves existing reserved item without rewriting its frozen snapshot', async () => {
        state.tables.invoice_export_items = [{
            company_id: 'company-A',
            billing_underlay_id: 'underlay-A',
            status: 'ready',
            invoice_address_snapshot: {
                    street: 'Frozen original'
                }
            }];
        const before = structuredClone(state.tables.invoice_export_items);
        const result = await run();
        expect(result.alreadyPrepared).toBe(1);
        expect(result.created).toBe(0);
        expect(state.calls).toEqual([]);
        expect(state.tables.invoice_export_items).toEqual(before);
    });
});
// Oracle: current readiness requires recipient AND (confirmed invoice email OR complete postal address).
// Identity denials use exact synthetic rows, never a first-site fallback or another tenant's data.
describe('DELIVERY01.04 exact identity and distribution boundaries', () => {
    it('uses exact site even when a complete customer billing fallback exists', async () => {
        Object.assign(state.tables.customers[0], {
            billing_street: 'Customer street',
            billing_postal_code: '11111',
            billing_city: 'Customer city'
        });
        await run();
        expect(snapshot()).toMatchObject({
            street: 'Exact site street',
            postal_code: '22222',
            city: 'Exact site city'
        });
    });
    it.each(['customer_site_id', 'site_id'])('accepts matching %s legacy site alias only', async (alias) => {
        for (const table of ['billing_underlays', 'customer_contracts', 'metering_points']) {
            const row = state.tables[table][0];
            delete row.customer_site_id;
            delete row.site_id;
            row[alias] = 'site-A';
        }
        const result = await run();
        expect(result.created).toBe(1);
        expect(snapshot().street).toBe('Exact site street');
    });
    it('accepts the underlay contract_id alias', async () => {
        delete state.tables.billing_underlays[0].customer_contract_id;
        state.tables.billing_underlays[0].contract_id = 'contract-A';
        const result = await run();
        expect(result.created).toBe(1);
        expect(snapshot().street).toBe('Exact site street');
    });
    it.each([
        ['contract belongs to another customer', (t: FixtureTables) => {
                t.customer_contracts[0].customer_id = 'customer-B';
            }],
        ['contract belongs to another company', (t: FixtureTables) => {
                t.customer_contracts[0].company_id = 'company-B';
            }],
        ['contract site contradicts underlay', (t: FixtureTables) => {
                t.customer_contracts[0].customer_site_id = 'site-B';
                t.customer_contracts[0].site_id = 'site-B';
            }],
        ['contract meter contradicts underlay', (t: FixtureTables) => {
                t.customer_contracts[0].metering_point_id = 'meter-B';
            }],
        ['site belongs to another customer', (t: FixtureTables) => {
                t.customer_sites[1].customer_id = 'customer-B';
            }],
        ['site belongs to another company', (t: FixtureTables) => {
                t.customer_sites[1].company_id = 'company-B';
            }],
        ['exact site is absent', (t: FixtureTables) => {
                t.customer_sites = t.customer_sites.filter((r: FixtureRow) => r.id !== 'site-A');
            }],
        ['meter belongs to another customer', (t: FixtureTables) => {
                t.metering_points[0].customer_id = 'customer-B';
            }],
        ['meter belongs to another company', (t: FixtureTables) => {
                t.metering_points[0].company_id = 'company-B';
            }],
        ['meter points at another site', (t: FixtureTables) => {
                t.metering_points[0].customer_site_id = 'site-B';
                t.metering_points[0].site_id = 'site-B';
            }],
        ['exact meter is absent', (t: FixtureTables) => {
                t.metering_points = [];
            }],
        ['underlay meter identity is absent', (t: FixtureTables) => {
                delete t.billing_underlays[0].metering_point_id;
            }],
        ['underlay site identity is absent', (t: FixtureTables) => {
                delete t.billing_underlays[0].customer_site_id;
                delete t.billing_underlays[0].site_id;
            }],
        ['underlay site aliases contradict', (t: FixtureTables) => {
                t.billing_underlays[0].site_id = 'site-B';
            }],
        ['contract site aliases contradict', (t: FixtureTables) => {
                t.customer_contracts[0].site_id = 'site-B';
            }],
        ['meter site aliases contradict', (t: FixtureTables) => {
                t.metering_points[0].site_id = 'site-B';
            }],
        ['underlay contract aliases contradict', (t: FixtureTables) => {
                t.billing_underlays[0].contract_id = 'contract-B';
            }]
    ] as const)('refuses %s before draft RPC', async (_label, mutate) => {
        mutate(state.tables);
        const result = await run();
        expect(result.created).toBe(0);
        expect(result.failed).toBe(1);
        expect(state.calls).toEqual([]);
    });
    it.each(['street', 'postal_code', 'city'])('refuses incomplete required site %s with no confirmed email', async (field) => {
        state.tables.customer_sites[1][field] = '  ';
        const result = await run();
        expect(result.created).toBe(0);
        expect(result.failed).toBe(1);
        expect(state.calls).toEqual([]);
    });
    it('permits confirmed invoice email without complete postal address', async () => {
        state.tables.customers[0].invoice_email = 'billing@example.invalid';
        state.tables.customer_sites[1].street = null;
        const result = await run();
        expect(result.created).toBe(1);
        expect(snapshot().email).toBe('billing@example.invalid');
    });
    it('does not substitute general contact email for a missing confirmed channel', async () => {
        state.tables.customer_sites[1].street = null;
        const result = await run();
        expect(result.created).toBe(0);
        expect(result.failed).toBe(1);
        expect(state.calls).toEqual([]);
    });
});
