// masterplan: DB-04
// reality-defects: F99
// ACK original reads must not visit the tenant's whole ACK history. Before
// 20261020120200 read_outbound_originals_v1 read every outbound ACK of the
// tenant to evaluate its five-way OR (~23 us each; ~100k ACKs reached the 8 s
// statement timeout). Candidates now come from indexed branches. The test
// counts the ediel_messages tuples the read actually touches, which is
// deterministic, instead of timing it.
// F99 (20261023120000): the fifth (UCI) branch reads the derived column
// contrl_uci_ref through ediel_messages_contrl_uci_ref_col_idx; the former
// expression index called the postgres-only wire_v1 under the writer's role.
// The fixture bypasses triggers (replica), so it states the derived value the
// a_00_ediel_contrl_uci_ref_derive trigger would store; that trigger itself is
// proven in ediel-contrl-uci-ref-service-role-native.test.ts.
import { describe, expect, it } from 'vitest'
import { nativeSql as sql } from './helpers/ediel-normal-switch-native-fixture'

const UNRELATED = 500

type Plan = { 'Index Name'?: string; Plans?: Plan[] }
const indexNames = (plan: Plan): string[] => [...(plan['Index Name'] ? [plan['Index Name']] : []), ...(plan.Plans ?? []).flatMap(indexNames)]

function scenario() {
  return sql<{ originals: Array<{ id: string }>; touched: number; related: string; derived: number; uciPlan: Array<{ Plan: Plan }>; expressionIndex: boolean }>(`BEGIN;
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE ids ON COMMIT DROP AS SELECT gen_random_uuid() company, gen_random_uuid() source, gen_random_uuid() related;
INSERT INTO public.ediel_messages(id,company_id,direction,environment,message_standard,message_family,message_code,raw_payload,interchange_reference,status)
 SELECT source, company, 'inbound', 'test', 'edifact', 'UTILTS', 'E66',
  'UNA:+.? ''UNB+UNOC:3+80001:ZZ+70001:ZZ+261016:0100+SCALESRC00001++23-DDQ-E66-T++++1''UNH+1+UTILTS:D:02B:UN:E5SE5A''BGM+E66::260+M1+9+AB''UNT+3+1''UNZ+1+SCALESRC00001''',
  'SCALESRC00001', 'validated' FROM ids;
INSERT INTO public.ediel_messages(id,company_id,direction,environment,message_standard,message_family,message_code,raw_payload,related_message_id,status)
 SELECT gen_random_uuid(), i.company, 'outbound', 'test', 'edifact', 'CONTRL', 'CONTRL',
  'UNA:+.? ''UNB+UNOC:3+70001:ZZ+80001:ZZ+261016:0101+ACK'||g||'++23-DDQ-E66-T++++1''UNH+1+CONTRL:2:2:UN:EDIEL2''UCI+OTHER'||lpad(g::text,8,'0')||'+80001:ZZ+70001:ZZ+1''UNT+3+1''UNZ+1+ACK'||g||'''',
  gen_random_uuid(), 'sent' FROM ids i, generate_series(1,${UNRELATED}) g;
INSERT INTO public.ediel_messages(id,company_id,direction,environment,message_standard,message_family,message_code,raw_payload,related_message_id,status)
 SELECT related, company, 'outbound', 'test', 'edifact', 'CONTRL', 'CONTRL',
  'UNA:+.? ''UNB+UNOC:3+70001:ZZ+80001:ZZ+261016:0101+ACKREL++23-DDQ-E66-T++++1''UNH+1+CONTRL:2:2:UN:EDIEL2''UCI+SCALESRC00001+80001:ZZ+70001:ZZ+1''UNT+3+1''UNZ+1+ACKREL''',
  source, 'sent' FROM ids;
UPDATE public.ediel_messages m SET contrl_uci_ref=gridex_ack_authority.wire_v1(m.raw_payload)->>'uciRef' FROM ids WHERE m.company_id=ids.company AND m.direction='outbound';
ANALYZE public.ediel_messages;
-- The plan of the read's fifth candidate branch (same predicate shape).
CREATE FUNCTION pg_temp.uci_plan(company uuid) RETURNS jsonb LANGUAGE plpgsql AS $plan$DECLARE p jsonb;BEGIN
 EXECUTE format($q$EXPLAIN (FORMAT JSON) SELECT x.id FROM public.ediel_messages x WHERE x.direction='outbound' AND x.message_family='CONTRL'
  AND x.company_id=%L AND x.environment='test' AND x.contrl_uci_ref='SCALESRC00001'$q$,company) INTO p;RETURN p;END$plan$;
CREATE TEMP TABLE shape ON COMMIT DROP AS SELECT
 (SELECT count(*) FROM public.ediel_messages m, ids WHERE m.company_id=ids.company AND m.direction='outbound' AND m.contrl_uci_ref IS NOT NULL) derived,
 to_regclass('public.ediel_messages_contrl_uci_ref_idx') IS NOT NULL expression_index,
 pg_temp.uci_plan((SELECT company FROM ids)) uci_plan;
CREATE TEMP TABLE before ON COMMIT DROP AS SELECT coalesce(seq_tup_read,0)+coalesce(idx_tup_fetch,0) n FROM pg_stat_xact_user_tables WHERE relid='public.ediel_messages'::regclass;
CREATE TEMP TABLE result ON COMMIT DROP AS SELECT gridex_ack_authority.read_outbound_originals_v1((SELECT source FROM ids),'CONTRL') r;
SELECT jsonb_build_object(
 'originals',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',o#>>'{message,id}')),'[]') FROM result, jsonb_array_elements(r->'originals') o),
 'touched',(SELECT coalesce(seq_tup_read,0)+coalesce(idx_tup_fetch,0) FROM pg_stat_xact_user_tables WHERE relid='public.ediel_messages'::regclass)-(SELECT n FROM before),
 'related',(SELECT related FROM ids),
 'derived',(SELECT derived FROM shape),'expressionIndex',(SELECT expression_index FROM shape),'uciPlan',(SELECT uci_plan FROM shape));
ROLLBACK;`)
}

describe('ACK original read with a large tenant ACK history', () => {
  it('returns the related CONTRL without visiting the unrelated history', () => {
    const result = scenario()
    expect(result.originals).toEqual([{ id: result.related }])
    expect(result.derived).toBe(UNRELATED + 1)
    expect(result.expressionIndex).toBe(false)
    expect(indexNames(result.uciPlan[0].Plan)).toContain('ediel_messages_contrl_uci_ref_col_idx')
    // Source row, candidate rows and their re-reads; never the 500 unrelated ACKs.
    expect(result.touched).toBeLessThan(50)
  })
})
