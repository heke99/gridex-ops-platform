import { beforeEach, expect, it, vi } from 'vitest';
import { calculatePricingPreviewForUnderlay } from '@/lib/pricing/engine';

type Row = Record<string, unknown>;
const fixture = vi.hoisted(() => ({
  tables: {} as Record<string, Row>,
  authority: null as unknown,
  authorityError: null as unknown,
  retentionError: null as unknown,
  computedSnapshot: null as unknown,
  calls: [] as { name: string; args: Row }[],
}));
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    const filters: {key: string; value: unknown}[] = [];
    const read = async () => {
      const row = fixture.tables[table];
      if (!row) throw new Error('Unexpected fixture table ' + table);
      return { data: filters.every(({ key, value }) => row[key] === value) ? row : null, error: null };
    };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push({ key, value }); return query; },
      in: () => query,
      single: read,
      maybeSingle: read,
    };
    return query;
  },
  async rpc(name: string, args: Row) {
    fixture.calls.push({ name, args });
    if (name === 'gridex_read_billing_underlay_source_basis_v1') {
      return { data: fixture.authority, error: fixture.authorityError };
    }
    if (name === 'ediel_require_invoice_source_copies_available_v1') {
      return { data: null, error: fixture.retentionError };
    }
    if (name === 'gridex_persist_pricing_run') return { data: 'pricing-run', error: null };
    throw new Error('Unexpected fixture RPC ' + name);
  },
} }));
vi.mock('@/lib/billing/invoiceReadiness', () => ({ assertBillingPeriodOpen: async () => undefined }));
vi.mock('@/lib/pricing/spot/spotImportScheduler', () => ({ ensureSpotPricesForBillingMonth: async () => { throw new Error('Unexpected spot import'); } }));
vi.mock('@/lib/pricing/priceSourceResolver', () => ({
  async resolvePricingConfiguration(input: { underlay: { pricingSnapshot: unknown } }) {
    fixture.computedSnapshot = input.underlay.pricingSnapshot;
    return {
      baseComponents: [{ sourceType: 'fixed', weightPercent: 100 }],
      priceComponents: [], vatRate: 0.25, warnings: [],
    };
  },
  resolveBasePriceSourceValues: async () => ({ fixedSekPerKwh: 1 }),
}));

const companyId = 'company', underlayId = 'underlay', cps = 'snapshot';
const exact = { stable_snapshot_marker: 'stored-only', vat_rate: 0.25 };
const proof = { id: underlayId, qualified: true, sourceBasisHash: 'a'.repeat(64), correctionRequired: false, totalKwh: '12' };
const preview = (persist = true) => calculatePricingPreviewForUnderlay({ companyId, billingUnderlayId: underlayId, persist });
const persistence = () => fixture.calls.filter(call => call.name === 'gridex_persist_pricing_run');
const expectedRead = {
  name: 'gridex_read_billing_underlay_source_basis_v1',
  args: { p_company_id: companyId, p_underlay_ids: [underlayId] },
};
const expectedRetention = {
  name: 'ediel_require_invoice_source_copies_available_v1',
  args: { p_company_id: companyId, p_underlay_id: underlayId, p_invoice_id: null, p_export_item_id: null },
};
beforeEach(() => {
  fixture.tables = {
    billing_underlays: { id: underlayId, company_id: companyId, customer_id: 'customer', metering_point_id: 'meter',
      contract_id: 'contract', contract_price_snapshot_id: cps, underlay_year: 2026, underlay_month: 10,
      total_kwh: 12, price_area: 'SE3', pricing_snapshot: exact },
    customer_contracts: { id: 'contract', company_id: companyId, status: 'active', contract_type: 'fixed',
      actual_start_date: '2026-01-01', fixed_price_ore_per_kwh: 100 },
    contract_price_snapshots: { id: cps, company_id: companyId, contract_id: 'contract', pricing_model: 'fixed',
      snapshot_json: { contract_type: 'fixed' }, price_components_snapshot: [], base_price_components_snapshot: [] },
  };
  fixture.authority = [{ ...proof }];
  fixture.authorityError = null;
  fixture.retentionError = null;
  fixture.computedSnapshot = null;
  fixture.calls = [];
});
it('calculates from the enriched snapshot and persists exactly the frozen raw source snapshot', async () => {
  const result = await preview();
  expect([result.status, result.totalIncVat, result.pricingRunId]).toEqual(['success', 15, 'pricing-run']);
  expect(fixture.computedSnapshot).toMatchObject({ ...exact, contract_type: 'fixed', contract_price_snapshot_id: cps });
  expect(fixture.calls[0]).toEqual(expectedRead);
  expect(persistence()[0]?.args.p_pricing_snapshot).toStrictEqual(exact);
});
it('retains enriched persistence for a positively identified legacy unbound row', async () => {
  fixture.authority = [{ ...proof, qualified: false, sourceBasisHash: null }];
  const result = await preview();
  expect(result.status).toBe('success');
  expect(fixture.calls[0]).toEqual(expectedRead);
  expect(persistence()[0]?.args.p_pricing_snapshot).toStrictEqual(fixture.computedSnapshot);
  expect(persistence()[0]?.args.p_pricing_snapshot).toMatchObject({ contract_price_snapshot_id: cps });
  expect(fixture.calls.map(call => call.name)).toEqual([
    expectedRead.name, expectedRetention.name, 'gridex_persist_pricing_run',
  ]);
});
it('refuses to persist legacy enrichment when the source authority read masks the retention denial', async () => {
  fixture.authority = [{ ...proof, qualified: false, sourceBasisHash: null }];
  const error = { code: '23514', message: 'finance_copy_retention_tombstoned' };
  fixture.retentionError = error;
  await expect(preview()).rejects.toBe(error);
  expect(fixture.calls).toEqual([expectedRead, expectedRetention]);
});
it('uses the same frozen snapshot for a persisted validation failure', async () => {
  fixture.tables.billing_underlays.customer_id = null;
  const result = await preview();
  expect([result.status, result.pricingRunId]).toEqual(['failed', null]);
  expect(fixture.calls[0]).toEqual(expectedRead);
  expect(persistence()[0]?.args.p_pricing_snapshot).toStrictEqual(exact);
  expect(persistence()[0]?.args.p_result).toMatchObject({ status: 'failed' });
});
it.each([false, true])('records failed diagnostics against the frozen binding when correctionRequired=%s', async correctionRequired => {
  fixture.authority = [{ ...proof, qualified: false, correctionRequired }];
  fixture.tables.billing_underlays.customer_id = null;
  const result = await preview();
  expect([result.status, result.pricingRunId]).toEqual(['failed', null]);
  expect(fixture.calls.slice(0, 2)).toEqual([expectedRead, expectedRetention]);
  expect(persistence()).toHaveLength(1);
  expect(persistence()[0]?.args.p_pricing_snapshot).toStrictEqual(exact);
  expect(persistence()[0]?.args.p_result).toMatchObject({ status: 'failed' });
});
it('does not write failed diagnostics for unavailable bound snapshot bytes', async () => {
  const error = { code: '23514', message: 'finance_copy_retention_tombstoned' };
  fixture.authority = [{ ...proof, qualified: false }];
  fixture.retentionError = error;
  fixture.tables.billing_underlays.customer_id = null;
  await expect(preview()).rejects.toBe(error);
  expect(fixture.calls).toEqual([expectedRead, expectedRetention]);
});
it('uses the same frozen snapshot for production while settlement uses enrichment', async () => {
  fixture.tables.billing_underlays.energy_direction = 'production';
  fixture.tables.billing_underlays.settlement_type = 'credit_invoice';
  fixture.tables.contract_price_snapshots.snapshot_json = {
    production: { enabled: true, settlement_mode: 'credit_invoice', compensation_sek_per_kwh: 2, vat_rate_decimal: 0 },
  };
  const result = await preview();
  expect([result.status, result.totalIncVat, result.pricingRunId]).toEqual(['success', -24, 'pricing-run']);
  expect(fixture.calls[0]).toEqual(expectedRead);
  expect(persistence()[0]?.args.p_pricing_snapshot).toStrictEqual(exact);
});
it.each([false, undefined])('does no authority lookup or persistence for persist=%s', async persist => {
  const result = await calculatePricingPreviewForUnderlay({ companyId, billingUnderlayId: underlayId, persist });
  expect([result.status, result.totalIncVat, result.pricingRunId]).toEqual(['success', 15, null]);
  expect(fixture.calls).toEqual([]);
});
it('propagates a fresh authority error and performs no persist', async () => {
  const error = { code: '57014', message: 'fixture authority failure' };
  fixture.authorityError = error;
  await expect(preview()).rejects.toBe(error);
  expect(fixture.calls).toEqual([expectedRead]);
});
it.each([
  ['missing', []],
  ['wrong identity', [{ ...proof, id: 'other' }]],
  ['missing marker', [{ id: underlayId, qualified: false, correctionRequired: false }]],
  ['invalid marker', [{ ...proof, sourceBasisHash: 'bad' }]],
  ['duplicate', [proof, proof]],
  ['unqualified binding', [{ ...proof, qualified: false }]],
  ['correction required', [{ ...proof, correctionRequired: true }]],
  ['contradictory', [{ ...proof, sourceBasisHash: null }]],
])('fails closed for %s authority', async (_label, authority) => {
  fixture.authority = authority;
  await expect(preview()).rejects.toThrow('pricing_source_basis_unavailable');
  expect(fixture.calls).toEqual([expectedRead]);
});
it('fails closed when the bound raw projection is missing', async () => {
  delete fixture.tables.billing_underlays.pricing_snapshot;
  await expect(preview()).rejects.toThrow('pricing_source_basis_unavailable');
  expect(fixture.calls).toEqual([expectedRead]);
});
