import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

// Actual application modules; only external I/O is replaced. Run with Node >=22.13.
async function load(relative, mocks) {
  const cache = new Map();
  async function moduleFor(id) {
    if (cache.has(id)) return cache.get(id);
    if (mocks[id] || id.startsWith('node:')) {
      const object = mocks[id] ?? await import(id);
      const boundaryModule = new vm.SyntheticModule(Object.keys(object), function () {
        for (const [key, value] of Object.entries(object)) this.setExport(key, value);
      });
      cache.set(id, boundaryModule);
      return boundaryModule;
    }
    const file = path.resolve(id.startsWith('@/') ? `${id.slice(2)}.ts` : id);
    const sourceRef = process.argv.find(arg => arg.startsWith('--source-ref='))?.slice(13);
    const source = sourceRef ? execFileSync('git', ['show', `${sourceRef}:${path.relative(process.cwd(), file)}`], { encoding: 'utf8' }) : fs.readFileSync(file, 'utf8');
    const sourceModule = new vm.SourceTextModule(stripTypeScriptTypes(source), { identifier: file });
    cache.set(id, sourceModule);
    return sourceModule;
  }
  const rootModule = await moduleFor(relative);
  await rootModule.link(moduleFor);
  await rootModule.evaluate();
  return rootModule.namespace;
}

function fixture({ start = '2026-05-31T22:00:00Z', count = 2880, civilStart = '2026-06-01', civilEnd = '2026-07-01' } = {}) {
  const underlay = { id: 'u', company_id: 'c', customer_id: 'cu', metering_point_id: 'mp', contract_id: 'ct', customer_contract_id: 'ct', contract_price_snapshot_id: 'snap', underlay_year: 2026, underlay_month: Number(civilStart.slice(5,7)), billing_period_start: civilStart, billing_period_end: civilEnd, price_area: 'SE3', total_kwh: count, source_meter_value_count: count, status: 'validated', readiness_status: 'ready', readiness_issues: [], missing_values_count: 0, energy_direction: 'consumption', settlement_type: 'invoice', invoice_readiness_status: 'pending_pricing', pricing_snapshot: { interval_resolution: 'quarterly', base_price_components:[{source_type:'spot',weight_percent:100}] } };
  const contract = { id: 'ct', company_id: 'c', customer_id: 'cu', metering_point_id: 'mp', status: 'active', starts_at: '2026-01-01', contract_type: 'fixed' };
  const snapshot = { id: 'snap', company_id: 'c', contract_id: 'ct', snapshot_json: { pricing_model: 'fixed', vat_rate: 0.25 }, base_price_components_snapshot: [{ source_type: 'fixed', weight_percent: 100, fixed_price_sek_per_kwh: 1 }], price_components_snapshot: [] };
  const items = Array.from({ length: count }, (_, i) => ({ id: `i${String(i).padStart(5, '0')}`, company_id: 'c', billing_underlay_id: 'u', customer_id: 'cu', metering_point_id: 'mp', contract_id: 'ct', source_normalized_metering_value_id: `n${i}`, price_area: 'SE3', energy_direction: 'consumption', settlement_type: 'invoice', period_start: new Date(Date.parse(start) + i * 900000).toISOString(), period_end: new Date(Date.parse(start) + (i + 1) * 900000).toISOString(), quantity_kwh: 1, quantity: 1, unit: 'kWh', status: 'ready_for_pricing', warnings: [] }));
  const prices = items.map((item, i) => ({ id: `p${String(i).padStart(5, '0')}`, source: 'test', price_area: 'SE3', time_start: item.period_start, time_end: item.period_end, resolution: 'quarter_hour', sek_per_kwh: i < 1000 ? 1 : 2 }));
  const evidence = items.map((item, i) => ({ id: `e${String(i).padStart(5, '0')}`, company_id: 'c', pricing_run_id: 'run', billing_underlay_id: 'u', billing_underlay_item_id: item.id, customer_contract_id: 'ct', metering_interval_start: item.period_start, metering_interval_end: item.period_end, resolution: 'quarter', consumption_kwh: 1, price_sek_per_kwh: prices[i].sek_per_kwh, amount_ex_vat: prices[i].sek_per_kwh, price_source_id: prices[i].id, price_area: 'SE3', evidence_sha256: 'a'.repeat(64) }));
  const run = { id: 'run', company_id: 'c', billing_underlay_id: 'u', customer_id: 'cu', billing_period_start: civilStart, billing_period_end: civilEnd, status: 'locked', locked_at: '2026-07-02', total_ex_vat: 4760, vat_amount: 1190, total_inc_vat: 5950, errors: [], warnings: [] };
  const approval = { status: 'approved', approved_by: 'actor' };
  const item = { id: 'export', company_id: 'c', export_run_id: 'export-run', billing_underlay_id: 'u', pricing_run_id: 'run', customer_id: 'cu', customer_contract_id: 'ct', status: 'pending', total_kwh: count, amount_ex_vat: 4760, vat_amount: 1190, amount_inc_vat: 5950, metadata: { approval } };
  const invoice = { id: 'invoice', company_id: 'c', invoice_export_item_id: 'export', status: 'draft', total_kwh: count, amount_inc_vat: 5950, price_area_code: 'SE3', calculation_snapshot_sha256: 'hash', calculation_snapshot: { interval_evidence: evidence.map(row => ({ id: row.id, billingUnderlayItemId: row.billing_underlay_item_id, meteringIntervalStart: row.metering_interval_start, meteringIntervalEnd: row.metering_interval_end, resolution: row.resolution, consumptionKwh: row.consumption_kwh, priceSekPerKwh: row.price_sek_per_kwh, amountExVat: row.amount_ex_vat, priceSourceId: row.price_source_id, priceArea: row.price_area, evidenceSha256: row.evidence_sha256 })) }, metadata: { approval } };
  const tables = { billing_underlays: [underlay], customer_contracts: [contract], contract_price_snapshots: [snapshot], billing_underlay_items: items, spot_price_intervals: prices, pricing_interval_evidence: evidence, pricing_runs: [run], pricing_preview_lines: [{ id: 'line', company_id: 'c', pricing_run_id: 'run', amount_ex_vat: 4760, metadata: { source_type: 'spot' } }], invoice_export_items: [item], customer_invoices: [invoice], invoice_export_runs: [{ id: 'export-run', company_id: 'c', billing_month: '2026-06', environment: 'test' }], customers: [{ id: 'cu', company_id: 'c' }], companies: [{ id: 'c' }], spot_price_monthly_summaries: [], market_price_previews: [], spot_price_daily_summaries: [], billing_export_run_items: [], billing_export_runs: [], invoice_export_attempts: [], invoice_dead_letters: [], contract_charge_ledger: [], spot_price_months: [], portfolio_period_prices: [] };
  const effects = [];
  const options = { truncateTable: null, failPageTable: null };
  const db = { rpc: async (name, args) => { effects.push({ name, args }); if(name==='gridex_create_invoice_export_graph_v1') { tables.invoice_export_items.push(...args.p_items); tables.customer_invoices.push(...args.p_invoices.map((row,i)=>({...row,company_id:args.p_run.company_id,id:`created-invoice-${i}`}))); } return { data: 'run', error: null }; }, from(table) {
    const filters = [], orders = []; let from = 0, to = 999, single = false, op = 'select', payload;
    const query = { select() { return query; }, not() { return query; }, or() { return query; }, lte() { return query; }, gte() { return query; }, eq(key,value) { filters.push(row => row[key] === value); return query; }, neq(key,value) { filters.push(row => row[key] !== value); return query; }, in(key,values) { filters.push(row => values.includes(row[key])); return query; }, lt(key,value) { filters.push(row => Date.parse(row[key]) < Date.parse(value)); return query; }, gt(key,value) { filters.push(row => Date.parse(row[key]) > Date.parse(value)); return query; }, order(key,opts) { orders.push([key,opts?.ascending !== false]); return query; }, range(a,b) { from=a; to=b; return query; }, limit(n) { to=n-1; return query; }, single() { single=true; return query; }, maybeSingle() { single=true; return query; }, update(value) { op='update'; payload=value; return query; }, insert(value) { op='insert'; payload=value; return query; }, then(resolve,reject) { return Promise.resolve().then(() => {
      if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
      let rows = tables[table].filter(row => filters.every(filter => filter(row)));
      rows = rows.toSorted((a,b) => { for (const [key, asc] of orders) { const result=String(a[key]).localeCompare(String(b[key])); if(result) return asc?result:-result; } return 0; });
      if (op !== 'select') {effects.push({ name: `${table}:${op}`, payload });if(op==='update')for(const row of rows)Object.assign(row,payload);}
      if (from > 0 && options.failPageTable === table) return { error: new Error('page unavailable'), data: null, count: rows.length };
      const end = options.truncateTable === table ? Math.min(to+1, from+500) : to+1;
      return { error: null, count: rows.length, data: single ? rows[0] ?? null : rows.slice(from, Math.min(end, from+1000)) };
    }).then(resolve,reject); } };
    return query;
  } };
  const mocks = {
    '@/lib/supabase/service': { supabaseService: db },
    '@/lib/billing/invoiceReadiness': { assertBillingPeriodOpen: async () => {}, lockBillingPeriodForInvoiceExport: async () => {} },
    '@/lib/pricing/spot/spotImportScheduler': { ensureSpotPricesForBillingMonth: async () => ({ imported: false }) },
    '@/lib/pricing/marketPriceSources': { loadMarketPriceSourcePolicies: async () => [{ sourceKey: 'test', priority: 1, supportedResolutions: ['quarterly','hourly'], priceAreas: ['SE3'] }, { sourceKey: 'backup', priority: 2, supportedResolutions: ['quarterly'], priceAreas: ['SE3'] }], policySupports: () => true, selectMarketPriceRow: () => null, selectMarketPricePreviewRow: () => null },
    '@/lib/tenant/governance': { requireCompanyOperationalForWrites: async () => {} },
    '@/lib/events/domainEvents': { emitDomainEvent: async () => {} },
    '@/lib/platform/outboundFreeze': { assertOutboundAllowed: async () => {} },
    '@/lib/automation/locks': { withAutomationLock: async input => input.run() },
    '@/lib/integrations/billing/capway/auth': { resolveCapwayConnectionConfig: async () => ({}) },
    '@/lib/integrations/billing/capway/client': { CapwayApticClient: class { async createInvoices() { effects.push({ name: 'provider' }); return { invoiceGuids: ['guid'] }; } } },
    '@/lib/integrations/billing/exportErrorClassification': { classifyInvoiceExportError: error => ({outcome:'failed', message:error.message}), computeNextRetryAt:()=>null, INVOICE_EXPORT_MAX_ATTEMPTS:3 },
    '@/lib/integrations/billing/capway/purchase': { buildPurchasePayload:()=>({}) },
    '@/lib/integrations/billing/capway/payloadBuilder': { buildCapwayInvoicePayload: () => ({}) },
  };
  return { underlay, contract, snapshot, items, prices, evidence, run, invoice, tables, effects, options, mocks };
}
let activeLoader = load;
const cases = {};
const intervalInput = { companyId: 'c', billingUnderlayId: 'u', priceArea: 'SE3', periodStart: '2026-06-01', periodEnd: '2026-07-01', requiredResolution: 'quarterly', spotWeightPercent: 100 };
async function interval(f, changes={}) { changes={periodStart:f.items[0].period_start,periodEnd:f.items.at(-1).period_end,...changes}; return (await activeLoader('lib/pricing/intervalPricing.ts', f.mocks)).resolveIntervalSpotPricing({ ...intervalInput, ...changes }); }
async function preview(f) { return (await activeLoader('lib/pricing/engine.ts', f.mocks)).calculatePricingPreviewForUnderlay({ companyId: 'c', billingUnderlayId: 'u', persist: true }); }
async function denied(operation) { try { const result=await operation(); assert.ok(result.errors?.length || result.status !== 'success' && result.weightedAverageSekPerKwh === null, 'invalid evidence was accepted'); } catch(error) { if (error instanceof assert.AssertionError) throw error; assert.ok(error); } }
cases.month = async () => { const f=fixture(); const result=await interval(f); assert.deepEqual(result.errors, []); const {calculateBasePrice}=await activeLoader('lib/pricing/basePriceCalculator.ts',f.mocks);const base=calculateBasePrice({underlay:{quantityKwh:2880},components:[{sourceType:'spot',weightPercent:100}],sourceValues:{spotSekPerKwh:result.weightedAverageSekPerKwh}});assert.equal(base.lines[0].amountExVat,4760);assert.equal(result.evidence.length, 2880); };
for (const [name, mutate] of Object.entries({ missing: f => f.items.splice(1500,1), overlap: f => { f.items[1].period_start=f.items[0].period_start;f.items[1].period_end=f.items[0].period_end; }, duplicate: f => { f.items[1].id=f.items[0].id; }, quantity: f => { f.underlay.total_kwh=3000; }, identity: f => { f.items[1700].customer_id='foreign'; }, truncated_items: f => { f.options.truncateTable='billing_underlay_items'; }, truncated_prices: f => { f.options.truncateTable='spot_price_intervals'; }, failed_page: f => { f.options.failPageTable='spot_price_intervals'; } })) cases[name]=async()=>{const f=fixture();mutate(f);await denied(()=>interval(f));};
cases.source_priority = async () => {const f=fixture(); f.prices.push(...f.prices.map(row=>({...row,id:`backup-${row.id}`,source:'backup',sek_per_kwh:9})));const result=await interval(f);assert.deepEqual(result.errors,[]);assert.equal(result.evidence.length,2880);assert.equal(result.evidence[1500].price_source_id,'p01500');};
for(const [name,start,count,civilStart,civilEnd] of [['spring','2026-02-28T23:00:00Z',2972,'2026-03-01','2026-04-01'],['autumn','2026-09-30T22:00:00Z',2980,'2026-10-01','2026-11-01']]) cases[name]=async()=>{const f=fixture({start,count,civilStart,civilEnd});const result=await interval(f,{periodStart:civilStart,periodEnd:civilEnd});assert.deepEqual(result.errors,[]);assert.equal(result.evidence.length,count);assert.equal(result.evidence[0].metering_interval_start,new Date(start).toISOString());};
cases.zero_interval = async()=>{const f=fixture();f.items[1100].quantity_kwh=0;f.items[1100].quantity=0;f.underlay.total_kwh--;const result=await interval(f);assert.deepEqual(result.errors,[]);assert.equal(result.evidence.length,2880);assert.equal(result.evidence[1100].consumption_kwh,0);};
for (const name of ['fixed','production','correction']) cases[name]=async()=>{const f=fixture();f.underlay.pricing_snapshot={}; if(name==='production'){f.underlay.energy_direction='production';f.underlay.settlement_type='credit_invoice';f.snapshot.snapshot_json.production={enabled:true,compensation_sek_per_kwh:1,settlement_mode:'credit_invoice',vat_rate:0};} if(name==='correction'){f.underlay.energy_direction='consumption_correction';f.underlay.settlement_type='credit_invoice';}for(const item of f.items){item.energy_direction=f.underlay.energy_direction;item.settlement_type=f.underlay.settlement_type;}const result=await preview(f);assert.equal(result.status,'success',result.errors.join(' '));assert.equal(result.totalExVat,name==='fixed'?2880:-2880);};
cases.blocked_preview=async()=>{const f=fixture();Object.assign(f.underlay,{status:'pending',readiness_status:'blocked',readiness_issues:[{code:'overlapping_intervals',message:'Overlapping metering evidence'}]});const result=await preview(f);assert.notEqual(result.status,'success');assert.ok(result.errors.some(error=>/overlap/i.test(error)));assert.ok(!f.effects.some(effect=>effect.args?.p_result?.status==='success'));};
cases.blocked_lock=async()=>{const f=fixture();f.underlay.readiness_issues=[{code:'overlapping_intervals'}];const engine=await activeLoader('lib/pricing/engine.ts',f.mocks);await assert.rejects(()=>engine.lockPricingPreview({companyId:'c',pricingRunId:'run'}));assert.ok(!f.effects.some(effect=>effect.name==='gridex_lock_pricing_run'));};
cases.blocked_prepare=async()=>{const f=fixture();f.tables.invoice_export_items=[];f.underlay.readiness_issues=[{code:'overlapping_intervals'}];const prepare=await activeLoader('lib/billing/invoiceReviewPrepare.ts',f.mocks);const result=await prepare.prepareInvoiceDraftsForReview({companyId:'c',billingMonth:'2026-06',actorUserId:'actor'});assert.equal(result.created,0);assert.ok(result.blocked+result.failed>0);assert.ok(!f.effects.some(effect=>effect.name==='gridex_create_invoice_export_graph_v1'));};
cases.blocked_send=async()=>{const f=fixture();f.underlay.readiness_issues=[{code:'overlapping_intervals'}];const dispatch=await activeLoader('lib/billing/invoiceApprovedDispatch.ts',f.mocks);await assert.rejects(()=>dispatch.sendApprovedInvoiceExportRun({companyId:'c',exportRunId:'export-run',actorUserId:'actor'}));assert.ok(!f.effects.some(effect=>effect.name==='provider'));};
cases.saved_evidence=async()=>{const f=fixture();const adapter=await activeLoader('lib/pricing/underlayPricingAdapter.ts',f.mocks);const result=await adapter.loadLockedUnderlayPricingWithCore({companyId:'c',billingUnderlayId:'u'});assert.equal(result.intervalEvidence.length,2880);assert.equal(result.intervalEvidence[2879].priceSourceId,'p02879');};
cases.saved_mismatch=async()=>{const f=fixture();f.evidence[1200].consumption_kwh=9;const adapter=await activeLoader('lib/pricing/underlayPricingAdapter.ts',f.mocks);await assert.rejects(()=>adapter.loadLockedUnderlayPricingWithCore({companyId:'c',billingUnderlayId:'u'}));};
cases.truncated_snapshot_send=async()=>{const f=fixture();f.invoice.calculation_snapshot.interval_evidence.length=1000;const dispatch=await activeLoader('lib/billing/invoiceApprovedDispatch.ts',f.mocks);await assert.rejects(()=>dispatch.sendApprovedInvoiceExportRun({companyId:'c',exportRunId:'export-run',actorUserId:'actor'}));assert.ok(!f.effects.some(effect=>effect.name==='provider'));};
cases.segment = async()=>{const f=fixture({start:'2026-06-14T22:00:00Z',count:1440,civilStart:'2026-06-15',civilEnd:'2026-06-30'});const result=await interval(f);assert.deepEqual(result.errors,[]);assert.equal(result.evidence.length,1440);};
cases.original_instants = async()=>{const f=fixture({start:'2026-06-15T10:00:00Z',count:96,civilStart:'2026-06-15',civilEnd:'2026-06-16'});f.underlay.payload={billing_period_start_instant:f.items[0].period_start,billing_period_end_instant:f.items.at(-1).period_end};const result=await interval(f);assert.deepEqual(result.errors,[]);assert.equal(result.evidence.length,96);};
cases.contradictory_period = async()=>{const f=fixture();f.underlay.payload={billing_period_start_instant:'2026-06-02T00:00:00Z',billing_period_end_instant:f.items.at(-1).period_end};await denied(()=>interval(f));};
cases.price_ties = async()=>{const f=fixture();f.mocks['@/lib/pricing/marketPriceSources'].loadMarketPriceSourcePolicies=async()=>[{sourceKey:'test',priority:1,supportedResolutions:['quarterly']},{sourceKey:'backup',priority:1,supportedResolutions:['quarterly']}];f.prices.push(...f.prices.map(row=>({...row,id:`z-${row.id}`,source:'backup',sek_per_kwh:9})));const result=await interval(f);assert.deepEqual(result.errors,[]);assert.equal(result.evidence[1500].price_source_id,'p01500');};
cases.missing_saved_evidence = async()=>{const f=fixture();f.tables.pricing_interval_evidence=[];f.contract.contract_type='variable_quarterly';const adapter=await activeLoader('lib/pricing/underlayPricingAdapter.ts',f.mocks);await assert.rejects(()=>adapter.loadLockedUnderlayPricingWithCore({companyId:'c',billingUnderlayId:'u'}));};
cases.saved_page_failure = async()=>{const f=fixture();f.options.failPageTable='pricing_interval_evidence';const adapter=await activeLoader('lib/pricing/underlayPricingAdapter.ts',f.mocks);await assert.rejects(()=>adapter.loadLockedUnderlayPricingWithCore({companyId:'c',billingUnderlayId:'u'}));};
cases.valid_lock = async()=>{const f=fixture();f.run.status='success';f.run.billing_period_start='2026-06-01T00:00:00Z';f.run.billing_period_end='2026-07-01T00:00:00Z';const engine=await activeLoader('lib/pricing/engine.ts',f.mocks);await engine.lockPricingPreview({companyId:'c',pricingRunId:'run'});assert.equal(f.effects.filter(effect=>effect.name==='gridex_lock_pricing_run').length,1);};
cases.monthly_fee = async()=>{const f=fixture();f.underlay.pricing_snapshot={};f.snapshot.price_components_snapshot=[{component_type:'fixed_monthly_fee',name:'Monthly fee',calculation_type:'fixed_monthly',amount:39,unit:'sek_month'}];const result=await preview(f);assert.equal(result.status,'success',result.errors.join(' '));assert.equal(result.totalExVat,2919);};
cases.valid_prepare = async()=>{const f=fixture();f.tables.invoice_export_items=[];const prepare=await activeLoader('lib/billing/invoiceReviewPrepare.ts',f.mocks);const result=await prepare.prepareInvoiceDraftsForReview({companyId:'c',billingMonth:'2026-06',actorUserId:'actor'});assert.equal(result.created,1,JSON.stringify(result.errors));const graph=f.effects.find(effect=>effect.name==='gridex_create_invoice_export_graph_v1');assert.equal(graph.args.p_run.legacy_items[0].payload_snapshot.calculation.interval_evidence.length,2880);};
cases.valid_send = async()=>{const f=fixture();const dispatch=await activeLoader('lib/billing/invoiceApprovedDispatch.ts',f.mocks);const result=await dispatch.sendApprovedInvoiceExportRun({companyId:'c',exportRunId:'export-run',actorUserId:'actor'});assert.equal(result.sent,1);assert.equal(f.effects.filter(effect=>effect.name==='provider').length,1);};
cases.saved_amount_mismatch = async()=>{const f=fixture();f.evidence[1200].amount_ex_vat=200;const adapter=await activeLoader('lib/pricing/underlayPricingAdapter.ts',f.mocks);await assert.rejects(()=>adapter.loadLockedUnderlayPricingWithCore({companyId:'c',billingUnderlayId:'u'}));};
cases.stale_persist = async()=>{const f=fixture();f.underlay.pricing_snapshot={};f.mocks['@/lib/pricing/marketPriceSources'].loadMarketPriceSourcePolicies=async()=>{f.underlay.readiness_issues=[{code:'overlapping_intervals'}];return [];};await assert.rejects(()=>preview(f));assert.ok(!f.effects.some(effect=>effect.args?.p_result?.status==='success'));};
cases.interval_preview = async()=>{const f=fixture();f.contract.contract_type='variable_quarterly';f.snapshot.snapshot_json.interval_resolution='quarterly';f.snapshot.base_price_components_snapshot=[{source_type:'spot',weight_percent:100}];const result=await preview(f);assert.equal(result.status,'success',result.errors.join(' '));assert.equal(result.totalExVat,4760);const persisted=f.effects.find(effect=>effect.args?.p_result?.status==='success');assert.equal(persisted.args.p_result.interval_evidence.length,2880);};
async function resolvedSnapshotLockCase(shape, missingEvidence = false) {
  const f = fixture();
  f.contract.contract_type = 'variable_quarterly';
  const snapshotJson = { pricing_model: 'spot', interval_resolution: 'quarterly', vat_rate: 0.25 };
  const components = shape === 'legacy' ? [] : [
    { source_type: 'spot', weight_percent: 100, price_area: 'SE3' },
    { source_type: 'spot', weight_percent: 100, price_area: 'SE4' },
  ];
  if (shape === 'period_and_dedup') {
    components.push({ source_type: 'spot', weight_percent: 100, price_area: 'SE3' });
    components.push({ source_type: 'spot', weight_percent: 35, price_area: 'SE3', valid_from: '2026-07-01' });
  }
  f.snapshot.snapshot_json = snapshotJson;
  f.snapshot.base_price_components_snapshot = components;
  f.underlay.pricing_snapshot = { ...snapshotJson, base_price_components: components };
  const result = await preview(f);
  assert.equal(result.status, 'success', result.errors.join(' '));
  assert.equal(result.totalExVat, 4760);
  assert.equal(f.effects.find(effect => effect.args?.p_result?.status === 'success').args.p_result.interval_evidence.length, 2880);
  f.run.status = 'success';
  if (missingEvidence) f.tables.pricing_interval_evidence = [];
  const engine = await activeLoader('lib/pricing/engine.ts', f.mocks);
  const lock = () => engine.lockPricingPreview({ companyId: 'c', pricingRunId: 'run' });
  if (missingEvidence) {
    await assert.rejects(lock);
    assert.equal(f.effects.filter(effect => effect.name === 'gridex_lock_pricing_run').length, 0);
  } else {
    await assert.doesNotReject(lock);
    assert.equal(f.effects.filter(effect => effect.name === 'gridex_lock_pricing_run').length, 1);
  }
}
cases.canonical_area_components = () => resolvedSnapshotLockCase('area');
cases.canonical_legacy_missing_evidence = () => resolvedSnapshotLockCase('legacy', true);
cases.canonical_legacy_saved_evidence = () => resolvedSnapshotLockCase('legacy');
cases.canonical_period_and_dedup = () => resolvedSnapshotLockCase('period_and_dedup');
export const billingEvidenceCaseNames = Object.keys(cases);
export async function runBillingEvidenceCase(name, moduleLoader = load) {
  if (!cases[name]) throw new Error(`Unknown billing evidence case: ${name}`);
  activeLoader = moduleLoader;
  try { await cases[name](); } finally { activeLoader = load; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--list')) console.log(billingEvidenceCaseNames.join('\n'));
  else {
    const selected=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7);
    let failures=0;
    for(const name of billingEvidenceCaseNames) { if(selected && name!==selected)continue; try { await runBillingEvidenceCase(name); console.log(`PASS ${name}`); } catch(error) { failures++;console.error(`FAIL ${name}: ${error.message.slice(0,500)}`); } }
    if(failures)process.exitCode=1;
  }
}
