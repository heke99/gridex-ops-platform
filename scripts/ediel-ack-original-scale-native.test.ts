// masterplan: DB-04
// ACK original reads must not visit the tenant's whole ACK history. Before
// 20261016013000 read_outbound_originals_v1 read every outbound ACK of the
// tenant to evaluate its five-way OR (~23 us each; ~100k ACKs reached the 8 s
// statement timeout). Candidates now come from indexed branches. The test
// counts the ediel_messages tuples the read actually touches, which is
// deterministic, instead of timing it.
import { describe, expect, it } from 'vitest'
import { nativeSql as sql } from './helpers/ediel-normal-switch-native-fixture'

const UNRELATED = 500

function scenario() {
  return sql<{ originals: Array<{ id: string }>; touched: number; related: string }>(`BEGIN;
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
ANALYZE public.ediel_messages;
CREATE TEMP TABLE before ON COMMIT DROP AS SELECT coalesce(seq_tup_read,0)+coalesce(idx_tup_fetch,0) n FROM pg_stat_xact_user_tables WHERE relid='public.ediel_messages'::regclass;
CREATE TEMP TABLE result ON COMMIT DROP AS SELECT gridex_ack_authority.read_outbound_originals_v1((SELECT source FROM ids),'CONTRL') r;
SELECT jsonb_build_object(
 'originals',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',o#>>'{message,id}')),'[]') FROM result, jsonb_array_elements(r->'originals') o),
 'touched',(SELECT coalesce(seq_tup_read,0)+coalesce(idx_tup_fetch,0) FROM pg_stat_xact_user_tables WHERE relid='public.ediel_messages'::regclass)-(SELECT n FROM before),
 'related',(SELECT related FROM ids));
ROLLBACK;`)
}

describe('ACK original read with a large tenant ACK history', () => {
  it('returns the related CONTRL without visiting the unrelated history', () => {
    const result = scenario()
    expect(result.originals).toEqual([{ id: result.related }])
    // Source row, candidate rows and their re-reads; never the 500 unrelated ACKs.
    expect(result.touched).toBeLessThan(50)
  })
})
