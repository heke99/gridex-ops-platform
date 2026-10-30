-- psql $LOCAL_STACK_DB_URL -X -v D=<fix010> -f measure.sql
-- All mutation/anrop inom BEGIN..ROLLBACK. Temp-objekt är sessionslokala.
\set C '''61c175f2-0f4e-4093-8945-8fea44993479'''
\pset footer off
\timing on
SELECT 'BASE' tag, md5(pg_get_functiondef('gridex_utilts_binding.wire_tokens_v1(text)'::regprocedure)) def_md5,
 (SELECT count(*) FROM normalized_metering_values WHERE company_id=:C) nmv,
 (SELECT count(*) FROM metering_values WHERE company_id=:C) mv,
 (SELECT count(*) FROM billing_underlays WHERE company_id=:C) bu;
CREATE TEMP TABLE ids AS SELECT id, row_number() OVER (ORDER BY id) rn FROM normalized_metering_values WHERE company_id=:C;
GRANT SELECT ON ids TO service_role;
CREATE FUNCTION pg_temp.try(c uuid, v uuid[]) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text; BEGIN SET LOCAL ROLE service_role; r:='OK '||md5(public.gridex_read_billing_source_values_v1(c,v)::text); RESET ROLE; RETURN r;
EXCEPTION WHEN OTHERS THEN RETURN 'ERR '||SQLSTATE||' '||SQLERRM; END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.try(uuid,uuid[]) TO service_role;
CREATE FUNCTION pg_temp.wt_len(n int) RETURNS text LANGUAGE sql AS $f$
 SELECT 'UNB+UNOC:3+7300009000001:14+7365565000001:14+261030:1200+REF1''UNH+1+UTILTS:D:02B:UN:E5SE1B''BGM+E66+DOC1+9''NAD+MS+7300009000001::9'''
  || string_agg(CASE WHEN i%3=0 THEN 'LIN+'||i||'''' ELSE 'QTY+220:'||i||'?.'||(i%10)||':KWH''' END,'' ORDER BY i)
  || 'UNT+1+1''UNZ+1+REF1''' FROM generate_series(0,n-7) i $f$;
SET track_functions='all';
-- ===== FÖRE =====
BEGIN;
SELECT 'PRE_WT406', jsonb_array_length(gridex_utilts_binding.wire_tokens_v1(pg_temp.wt_len(406)));
SELECT 'PRE_WT812', jsonb_array_length(gridex_utilts_binding.wire_tokens_v1(pg_temp.wt_len(812)));
SELECT 'PRE_WT1624', jsonb_array_length(gridex_utilts_binding.wire_tokens_v1(pg_temp.wt_len(1624)));
SELECT 'PRE_1',   pg_temp.try(:C, array(SELECT id FROM ids WHERE rn<=1));
SELECT 'PRE_10',  pg_temp.try(:C, array(SELECT id FROM ids WHERE rn<=10));
SELECT 'PRE_100', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn<=100));
SELECT 'PRE_STATS', funcname, calls, round(total_time) tot_ms, round(self_time) self_ms FROM pg_stat_xact_user_functions ORDER BY total_time DESC LIMIT 8;
\i :D/neg.sql
SELECT 'PRE_B1000_1', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn<=1000));
SELECT 'PRE_B1000_2', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn>1000 AND rn<=2000));
SELECT 'PRE_B1000_3', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn>2000));
ROLLBACK;
-- ===== EFTER (riktig funktion ersatt i tx) =====
BEGIN;
\i :D/new_wire_tokens.sql
SELECT 'IN_TX_def_md5', md5(pg_get_functiondef('gridex_utilts_binding.wire_tokens_v1(text)'::regprocedure)), (SELECT proacl FROM pg_proc WHERE oid='gridex_utilts_binding.wire_tokens_v1(text)'::regprocedure);
SELECT 'POST_WT406', jsonb_array_length(gridex_utilts_binding.wire_tokens_v1(pg_temp.wt_len(406)));
SELECT 'POST_WT812', jsonb_array_length(gridex_utilts_binding.wire_tokens_v1(pg_temp.wt_len(812)));
SELECT 'POST_WT1624', jsonb_array_length(gridex_utilts_binding.wire_tokens_v1(pg_temp.wt_len(1624)));
SELECT 'POST_1',   pg_temp.try(:C, array(SELECT id FROM ids WHERE rn<=1));
SELECT 'POST_10',  pg_temp.try(:C, array(SELECT id FROM ids WHERE rn<=10));
SELECT 'POST_100', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn<=100));
SELECT 'POST_STATS', funcname, calls, round(total_time) tot_ms, round(self_time) self_ms FROM pg_stat_xact_user_functions ORDER BY total_time DESC LIMIT 8;
\i :D/neg.sql
SELECT 'POST_B1000_1', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn<=1000));
SELECT 'POST_B1000_2', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn>1000 AND rn<=2000));
SELECT 'POST_B1000_3', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn>2000));
SELECT 'POST_STATS_ALL', funcname, calls, round(total_time) tot_ms, round(self_time) self_ms FROM pg_stat_xact_user_functions ORDER BY total_time DESC LIMIT 8;
ROLLBACK;
SELECT 'END' tag, md5(pg_get_functiondef('gridex_utilts_binding.wire_tokens_v1(text)'::regprocedure)) def_md5,
 (SELECT count(*) FROM normalized_metering_values WHERE company_id=:C) nmv,
 (SELECT count(*) FROM metering_values WHERE company_id=:C) mv,
 (SELECT count(*) FROM billing_underlays WHERE company_id=:C) bu;
