// reality-defects: J2-02
// FINDINGS J2-02 / owner decision 40 (migration 20261028120000): a grid owner's correction of an already invoiced month
// reaches the customer as a traceable correction or credit document. Native proof in the world database with the
// world's own J2 data: facility A's September underlay (invoiced, 10 September corrected by +0.012 kWh in 24
// quarter-hours = +0.288 kWh) and C's (12 September, 24 quarter-hours). Every case runs in ONE transaction that is
// always rolled back; the migration is applied inside it when it is not installed yet. The world never changes.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json
//   npx vitest run -c scripts/reality-j2-02-metering-correction-native.config.ts
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const MIGRATION = resolve(__dirname, '../supabase/migrations/20261028120000_j2_02_metering_correction_after_billing.sql')
const migrationBody = readFileSync(MIGRATION, 'utf8').replace(/^begin;$/m, '').replace(/^commit;$/m, '')

type Row = Record<string, unknown>
function psql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: 'pipe', timeout: 110_000 }).trim()
  return (out ? JSON.parse(out.split('\n').at(-1)!) : undefined) as T
}

/**
 * One rolled-back transaction: the world's corrected and invoiced September underlay of a facility (A: 10 September,
 * the largest journal for the day), the migration if missing, then the case's statements, which write into temp table
 * j202(k, v) and end with the result row.
 */
function inWorld<T>(statements: string): T {
  return psql<T>(`BEGIN;
  CREATE TEMP TABLE j202(k text primary key, v jsonb) ON COMMIT DROP;
  GRANT ALL ON j202 TO service_role;
  SELECT to_regclass('public.metering_billing_corrections') IS NULL AS apply \\gset
  \\if :apply
  ${migrationBody}
  \\endif
  -- A: the world's invoiced September consumption underlay whose 10 September values were corrected after invoicing.
  INSERT INTO j202 SELECT 'a', jsonb_build_object('company',u.company_id,'underlay',u.id,'contract',u.contract_id,'supply',u.supply_period_id,
      'invoice',(SELECT i.id FROM public.customer_invoices i WHERE i.billing_underlay_id=u.id AND i.status NOT IN ('cancelled','failed') ORDER BY i.created_at LIMIT 1))
    FROM public.billing_underlays u
   WHERE u.energy_direction='consumption' AND u.underlay_year=2026 AND u.underlay_month=9 AND coalesce(u.payload->>'charge_kind','')=''
     AND EXISTS(SELECT FROM public.customer_invoices i WHERE i.billing_underlay_id=u.id AND i.status NOT IN ('cancelled','failed'))
     AND EXISTS(SELECT FROM gridex_billing_source.correction_journal j JOIN public.normalized_metering_values n ON n.id=j.new_normalized_value_id
                 WHERE j.underlay_id=u.id AND n.period_start>='2026-09-09T23:00Z' AND n.period_end<='2026-09-10T23:00Z')
   ORDER BY u.created_at DESC LIMIT 1;
  INSERT INTO j202 SELECT 'snapshot', jsonb_build_object(
      'invoice',(SELECT to_jsonb(i) - 'updated_at' FROM public.customer_invoices i WHERE i.id=(SELECT (v->>'invoice')::uuid FROM j202 WHERE k='a')),
      'underlay',(SELECT to_jsonb(u) - 'updated_at' FROM public.billing_underlays u WHERE u.id=(SELECT (v->>'underlay')::uuid FROM j202 WHERE k='a')),
      'items',(SELECT md5(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id)) FROM public.billing_underlay_items i WHERE i.billing_underlay_id=(SELECT (v->>'underlay')::uuid FROM j202 WHERE k='a')),
      'binding',(SELECT to_jsonb(b) FROM gridex_billing_source.underlay_bindings b WHERE b.underlay_id=(SELECT (v->>'underlay')::uuid FROM j202 WHERE k='a')));
  ${statements}
  ROLLBACK;`)
}

const A = `(SELECT v FROM j202 WHERE k='a')`
const company = `(${A}->>'company')::uuid`
const original = `(${A}->>'underlay')::uuid`
const record = (month: string) => `public.gridex_record_metering_billing_corrections_v1(${company},'${month}',jsonb_build_object('customer_id',
  (SELECT customer_id FROM public.billing_underlays WHERE id=${original})),null)`
const correctionsOfA = `(SELECT coalesce(jsonb_agg(jsonb_build_object('direction',mc.direction,'delta',mc.delta_kwh,'revisions',mc.revision_count,'status',mc.status,
    'flow',mc.flow,'flowReason',mc.flow_reason,'approval',mc.approval_required,'invoice',mc.original_invoice_id,'underlay',mc.correction_underlay_id,
    'case',(SELECT jsonb_build_object('status',c.status,'reason',c.reason,'original',c.original_billing_underlay_id,'invoice',c.original_invoice_id,'approval',c.approval_required)
      FROM public.billing_adjustment_cases c WHERE c.id=mc.adjustment_case_id)) ORDER BY mc.direction),'[]'::jsonb)
  FROM public.metering_billing_corrections mc WHERE mc.original_billing_underlay_id=${original})`
const documentOf = (direction: string) => `(SELECT jsonb_build_object('month',u.underlay_month,'start',u.billing_period_start,'end',u.billing_period_end,
    'kwh',u.total_kwh,'direction',u.energy_direction,'settlement',u.settlement_type,'status',u.status,'readiness',u.readiness_status,
    'snapshot',u.contract_price_snapshot_id=(SELECT contract_price_snapshot_id FROM public.billing_underlays WHERE id=${original}),
    'contract',u.contract_id=(SELECT contract_id FROM public.billing_underlays WHERE id=${original}),
    'startInstant',u.payload->>'billing_period_start_instant','endInstant',u.payload->>'billing_period_end_instant',
    'boundInvoice',u.payload->>'original_invoice_id'=${A}->>'invoice','boundUnderlay',u.payload->>'original_billing_underlay_id'=${A}->>'underlay',
    'items',(SELECT count(*) FROM public.billing_underlay_items i WHERE i.billing_underlay_id=u.id),
    'itemKwh',(SELECT sum(i.quantity_kwh) FROM public.billing_underlay_items i WHERE i.billing_underlay_id=u.id),
    'currentSources',(SELECT bool_and(n.revision_status='current') FROM public.billing_underlay_items i JOIN public.normalized_metering_values n ON n.id=i.source_normalized_metering_value_id WHERE i.billing_underlay_id=u.id))
  FROM public.metering_billing_corrections mc JOIN public.billing_underlays u ON u.id=mc.correction_underlay_id
  WHERE mc.original_billing_underlay_id=${original} AND mc.direction='${direction}')`
const unchanged = `(SELECT jsonb_build_object(
    'invoice',(SELECT to_jsonb(i) - 'updated_at' FROM public.customer_invoices i WHERE i.id=(${A}->>'invoice')::uuid) = (SELECT v->'invoice' FROM j202 WHERE k='snapshot'),
    'underlay',(SELECT to_jsonb(u) - 'updated_at' FROM public.billing_underlays u WHERE u.id=${original}) = (SELECT v->'underlay' FROM j202 WHERE k='snapshot'),
    'items',(SELECT md5(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id)) FROM public.billing_underlay_items i WHERE i.billing_underlay_id=${original}) = (SELECT v->>'items' FROM j202 WHERE k='snapshot'),
    'binding',(SELECT to_jsonb(b) FROM gridex_billing_source.underlay_bindings b WHERE b.underlay_id=${original}) = (SELECT v->'binding' FROM j202 WHERE k='snapshot')))`
const basis = (id: string) => `(SELECT public.gridex_read_billing_underlay_source_basis_v1(${company}, ARRAY[${id}])->0)`
const correctionUnderlay = (direction: string) => `(SELECT correction_underlay_id FROM public.metering_billing_corrections WHERE original_billing_underlay_id=${original} AND direction='${direction}')`
/** An invoice row of a correction document as the invoice draft inserts it (amount sign given). */
const insertInvoice = (direction: string, amount: string) => `INSERT INTO public.customer_invoices(company_id,customer_id,billing_underlay_id,customer_contract_id,contract_id,
    period_start,period_end,total_kwh,amount_ex_vat,vat_amount,amount_inc_vat,status,source_system,invoice_reference)
  SELECT u.company_id,u.customer_id,u.id,u.contract_id,u.contract_id,u.billing_period_start,u.billing_period_end,u.total_kwh,${amount},0,${amount},'draft','j202_probe','J202-'||left(u.id::text,8)
  FROM public.billing_underlays u WHERE u.id=${correctionUnderlay(direction)}`
const caught = (key: string, statement: string) => `DO $c$ DECLARE e text; BEGIN BEGIN ${statement}; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  INSERT INTO j202 VALUES('${key}', to_jsonb(e)); END $c$;`
const value = (key: string) => `(SELECT v FROM j202 WHERE k='${key}')`

describe('J2-02 a metering correction of an invoiced month (world data, rolled back)', () => {
  it('the +0.288 kWh correction becomes exactly one charge document in the run month, bound to the original invoice, period, revisions and price snapshot; the original is unchanged', () => {
    const result = inWorld<Row>(`
    SET LOCAL ROLE service_role;
    INSERT INTO j202 SELECT 'first', ${record('2026-10')};
    INSERT INTO j202 SELECT 'second', ${record('2026-10')};
    INSERT INTO j202 SELECT 'otherMonth', ${record('2026-11')};
    INSERT INTO j202 SELECT 'basisOriginal', ${basis(original)};
    INSERT INTO j202 SELECT 'basisDocument', ${basis(correctionUnderlay('charge'))};
    RESET ROLE;
    SELECT jsonb_build_object('a',${A},'corrections',${correctionsOfA},'document',${documentOf('charge')},'unchanged',${unchanged},
      'firstOutcome',(SELECT e->>'outcome' FROM jsonb_array_elements(${value('first')}->'results') e WHERE e->>'originalUnderlayId'=${A}->>'underlay'),
      'second',(SELECT e FROM jsonb_array_elements(${value('second')}->'results') e WHERE e->>'originalUnderlayId'=${A}->>'underlay'),
      'otherMonth',(SELECT e FROM jsonb_array_elements(${value('otherMonth')}->'results') e WHERE e->>'originalUnderlayId'=${A}->>'underlay'),
      'documents',(SELECT count(*) FROM public.billing_underlays u WHERE u.payload->>'original_billing_underlay_id'=${A}->>'underlay'),
      'revisions',(SELECT count(*) FROM public.metering_billing_correction_revisions r WHERE r.original_billing_underlay_id=${original}),
      'basisOriginal',${value('basisOriginal')},'basisDocument',${value('basisDocument')});`)
    expect(result.a, 'the world has J2 facility A invoiced and corrected (run J2 first)').toBeTruthy()
    expect(result.firstOutcome).toBe('recorded')
    expect(result.corrections).toEqual([{ direction: 'charge', delta: 0.288, revisions: 24, status: 'underlaid', flow: 'next_invoice', flowReason: null, approval: false,
      invoice: (result.a as Row).invoice, underlay: expect.any(String),
      case: { status: 'rebill_queued', reason: 'metering_correction_after_billing', original: (result.a as Row).underlay, invoice: (result.a as Row).invoice, approval: false } }])
    // The Ediel day 10 September [09-09T23:00Z, 09-10T23:00Z) of the original period, in the run month (October).
    expect(result.document).toEqual({ month: 10, start: '2026-09-10', end: '2026-09-11', kwh: 0.288, direction: 'consumption', settlement: 'invoice',
      status: 'validated', readiness: 'ready', snapshot: true, contract: true, startInstant: '2026-09-09T23:00:00Z', endInstant: '2026-09-10T23:00:00Z',
      boundInvoice: true, boundUnderlay: true, items: 24, itemKwh: 0.288, currentSources: true })
    // Never charged twice: a re-run and a later month find nothing new.
    expect(result.second).toMatchObject({ outcome: 'handled', pending: 0, corrections: [] })
    expect(result.otherMonth).toMatchObject({ outcome: 'handled', pending: 0, corrections: [] })
    expect(result.documents).toBe(1)
    expect(result.revisions).toBe(24)
    // The original invoice, underlay, items and source binding are untouched; the guard still reports the correction.
    expect(result.unchanged).toEqual({ invoice: true, underlay: true, items: true, binding: true })
    expect(result.basisOriginal).toMatchObject({ qualified: false, correctionRequired: true, correctionPending: false })
    expect(result.basisDocument).toMatchObject({ qualified: true, correctionRequired: false, correctionPending: false })
  })

  it('the document is invoiced through the export run once; it never changes afterwards; an unbound underlay is still refused', () => {
    const result = inWorld<Row>(`
    SET LOCAL ROLE service_role;
    INSERT INTO j202 SELECT 'run', ${record('2026-10')};
    INSERT INTO j202 SELECT 'pricing', to_jsonb(public.gridex_persist_pricing_run(${company}, ${correctionUnderlay('charge')},
      jsonb_build_object('status','success','total_ex_vat',0.3,'vat_amount',0.08,'total_inc_vat',0.38,'warnings','[]'::jsonb,'errors','[]'::jsonb,'lines','[]'::jsonb), '{}'::jsonb));
    SELECT public.gridex_lock_pricing_run(${company}, (${value('pricing')}#>>'{}')::uuid, null);
    INSERT INTO j202 SELECT 'export', public.gridex_create_billing_export_run(jsonb_build_object('company_id',${company},'period_month','2026-10','rows_total',1,'rows_ready',1,
      'status','ready','idempotency_key','j202-probe'), jsonb_build_array(jsonb_build_object('billing_underlay_id',${correctionUnderlay('charge')},
      'contract_id',(SELECT contract_id FROM public.billing_underlays WHERE id=${correctionUnderlay('charge')}),'status','ready','readiness_status','ready',
      'payload_snapshot',jsonb_build_object('pricing',jsonb_build_object('pricingRunId',${value('pricing')}#>>'{}'))))) - 'id' - 'created_at' - 'updated_at';
    ${caught('unbound', `PERFORM public.gridex_create_billing_export_run(jsonb_build_object('company_id',${company},'period_month','2026-10','rows_total',1,'idempotency_key','j202-unbound'),
      jsonb_build_array(jsonb_build_object('billing_underlay_id',${original},'contract_id',(SELECT contract_id FROM public.billing_underlays WHERE id=${original}),'status','ready')))`)}
    RESET ROLE;
    ${caught('wrongSign', insertInvoice('charge', '-0.30'))}
    ${insertInvoice('charge', '0.30')};
    ${caught('second', insertInvoice('charge', '0.30'))}
    ${caught('mutate', `UPDATE public.billing_underlays SET total_kwh=1 WHERE id=${correctionUnderlay('charge')}`)}
    ${caught('items', `DELETE FROM public.billing_underlay_items WHERE billing_underlay_id=${correctionUnderlay('charge')}`)}
    SELECT jsonb_build_object('export',${value('export')}->>'status','unbound',${value('unbound')},'wrongSign',${value('wrongSign')},'second',${value('second')},
      'mutate',${value('mutate')},'items',${value('items')},'corrections',${correctionsOfA},
      'invoice',(SELECT jsonb_build_object('of',i.metadata->>'correction_of_invoice_id'=${A}->>'invoice','underlay',i.metadata->>'correction_of_billing_underlay_id'=${A}->>'underlay',
        'direction',i.metadata->>'metering_correction_direction','revisions',i.metadata->'metering_revision_count')
        FROM public.customer_invoices i WHERE i.billing_underlay_id=${correctionUnderlay('charge')}),
      'unchanged',${unchanged});`)
    expect(result.export).toBe('ready')
    expect(result.unbound).toBe('billing_finalized_source_basis_required')
    expect(result.wrongSign).toBe('metering_correction_amount_sign_mismatch')
    expect(result.invoice).toEqual({ of: true, underlay: true, direction: 'charge', revisions: 24 })
    expect(result.second).toBe('metering_correction_already_invoiced')
    expect(result.corrections).toMatchObject([{ status: 'invoiced', case: { status: 'completed' } }])
    expect(result.mutate).toBe('metering_correction_underlay_immutable')
    expect(result.items).toBe('metering_correction_items_immutable')
    expect(result.unchanged).toEqual({ invoice: true, underlay: true, items: true, binding: true })
  })

  it('a negative correction becomes a credit document and a credit invoice; a positive amount is refused', () => {
    // Fixture (rolled back): what was last billed for each corrected quarter-hour is recorded 0.05 kWh above the grid
    // owner's current value, as after an earlier over-correction; the current values themselves are the world's.
    const result = inWorld<Row>(`
    INSERT INTO public.metering_billing_correction_revisions(company_id,correction_id,original_billing_underlay_id,original_item_id,previous_value_id,previous_kwh,
        current_value_id,current_kwh,delta_kwh,period_start,period_end)
      SELECT ${company},null,${original},i.id,o.id,i.quantity_kwh,o.id,abs(c.quantity_kwh)+0.05,0,i.period_start,i.period_end
      FROM public.billing_underlay_items i JOIN public.normalized_metering_values o ON o.id=i.source_normalized_metering_value_id
      JOIN public.normalized_metering_values c ON c.company_id=o.company_id AND c.canonical_dedupe_key=o.canonical_dedupe_key AND c.revision_status='current'
      WHERE i.billing_underlay_id=${original} AND o.revision_status<>'current';
    SET LOCAL ROLE service_role;
    INSERT INTO j202 SELECT 'run', ${record('2026-10')};
    RESET ROLE;
    ${caught('positive', insertInvoice('credit', '0.10'))}
    ${insertInvoice('credit', '-0.10')};
    SELECT jsonb_build_object('corrections',${correctionsOfA},'document',${documentOf('credit')},'unchanged',${unchanged},
      'credit',(SELECT jsonb_build_object('status',c.status,'creditInvoice',c.credit_invoice_id IS NOT NULL) FROM public.billing_adjustment_cases c
        JOIN public.metering_billing_corrections mc ON mc.adjustment_case_id=c.id WHERE mc.original_billing_underlay_id=${original}),
      'positive',${value('positive')});`)
    expect(result.corrections).toMatchObject([{ direction: 'credit', delta: 1.2, revisions: 24, flow: 'next_invoice', approval: false }])
    expect(result.document).toMatchObject({ month: 10, start: '2026-09-10', end: '2026-09-11', kwh: 1.2, direction: 'consumption_correction',
      settlement: 'credit_invoice', snapshot: true, boundInvoice: true, items: 24, itemKwh: 1.2, currentSources: true })
    expect(result.positive).toBe('metering_correction_amount_sign_mismatch')
    expect(result.credit).toEqual({ status: 'credited', creditInvoice: true })
    expect(result.unchanged).toEqual({ invoice: true, underlay: true, items: true, binding: true })
  })

  it('a terminated customer goes to the separate correction flow (still charged, bound to the original invoice)', () => {
    const result = inWorld<Row>(`
    -- Fixture (rolled back): A's contract terminated by its supply end. Contract triggers are bypassed for this one update only.
    SET LOCAL session_replication_role = replica;
    UPDATE public.customer_contracts SET status='terminated', termination_reason='supply_end', ended_at='2026-10-01T00:00:00Z' WHERE id=(${A}->>'contract')::uuid;
    SET LOCAL session_replication_role = origin;
    SET LOCAL ROLE service_role;
    INSERT INTO j202 SELECT 'run', ${record('2026-10')};
    RESET ROLE;
    SELECT jsonb_build_object('corrections',${correctionsOfA},'document',${documentOf('charge')},'unchanged',${unchanged});`)
    expect(result.corrections).toMatchObject([{ direction: 'charge', delta: 0.288, status: 'underlaid', flow: 'separate_correction', flowReason: 'contract_terminated' }])
    expect(result.document).toMatchObject({ kwh: 0.288, boundInvoice: true, snapshot: true })
    expect(result.unchanged).toEqual({ invoice: true, underlay: true, items: true, binding: true })
  })

  it('a correction document is never invoiced against a cancelled original invoice', () => {
    const result = inWorld<Row>(`
    SET LOCAL ROLE service_role;
    INSERT INTO j202 SELECT 'run', ${record('2026-10')};
    RESET ROLE;
    -- Fixture (rolled back): the original invoice is cancelled after the correction was recorded (triggers bypassed for it).
    SET LOCAL session_replication_role = replica;
    UPDATE public.customer_invoices SET status='cancelled' WHERE id=(${A}->>'invoice')::uuid;
    SET LOCAL session_replication_role = origin;
    ${caught('cancelled', insertInvoice('charge', '0.30'))}
    SELECT jsonb_build_object('cancelled',${value('cancelled')},'corrections',${correctionsOfA});`)
    expect(result.cancelled).toBe('metering_correction_original_invoice_cancelled')
    expect(result.corrections).toMatchObject([{ status: 'underlaid' }])
  })

  it('above the approval limit the correction waits for a person, is never dropped, and is charged once after approval', () => {
    const result = inWorld<Row>(`
    INSERT INTO public.metering_correction_policies(company_id,customer_category,approval_threshold_kwh,prescription_rule,documentation)
      VALUES (${company}, null, 0.1, 'not_enforced', 'J2-02 native probe: tenant limit 0.1 kWh');
    INSERT INTO j202 SELECT 'actor', to_jsonb(cm.user_id) FROM public.company_memberships cm
      WHERE cm.company_id=${company} AND public.gridex_actor_has_company_permission(cm.user_id, cm.company_id, 'billing_underlay.export') LIMIT 1;
    SET LOCAL ROLE service_role;
    INSERT INTO j202 SELECT 'run', ${record('2026-10')};
    INSERT INTO j202 SELECT 'pending', ${correctionsOfA};
    INSERT INTO j202 SELECT 'rerun', ${record('2026-10')};
    -- The decision is called as the service (cron/API) on behalf of the deciding member, as PostgREST would.
    SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.role', 'service_role', true);
    ${caught('noReason', `PERFORM public.gridex_decide_metering_billing_correction_v1(${company}, (SELECT id FROM public.metering_billing_corrections WHERE original_billing_underlay_id=${original}), 'reject', ' ', (${value('actor')}#>>'{}')::uuid)`)}
    INSERT INTO j202 SELECT 'decision', public.gridex_decide_metering_billing_correction_v1(${company}, (SELECT id FROM public.metering_billing_corrections WHERE original_billing_underlay_id=${original}),
      'approve', null, (${value('actor')}#>>'{}')::uuid);
    INSERT INTO j202 SELECT 'afterApproval', ${record('2026-10')};
    RESET ROLE;
    SELECT jsonb_build_object('actor',${value('actor')},'pending',${value('pending')},'noReason',${value('noReason')},'decision',${value('decision')}->>'status',
      'rerun',(SELECT e->'corrections' FROM jsonb_array_elements(${value('rerun')}->'results') e WHERE e->>'originalUnderlayId'=${A}->>'underlay'),
      'corrections',${correctionsOfA},'document',${documentOf('charge')});`)
    expect(result.actor, 'a tenant member with billing_underlay.export').toBeTruthy()
    expect(result.pending).toMatchObject([{ direction: 'charge', delta: 0.288, status: 'pending_approval', approval: true, underlay: null,
      case: { status: 'blocked', approval: true } }])
    expect(result.rerun).toEqual([])
    expect(result.noReason).toBe('metering_correction_rejection_reason_required')
    expect(result.decision).toBe('approved')
    expect(result.corrections).toMatchObject([{ status: 'underlaid', approval: true, case: { status: 'rebill_queued' } }])
    expect(result.document).toMatchObject({ kwh: 0.288, items: 24 })
  })
})
