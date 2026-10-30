-- psql $LOCAL_STACK_DB_URL -X -v D=<fix010> -f measure.sql
-- All mutation/anrop inom BEGIN..ROLLBACK. Temp-objekt är sessionslokala.
\set C '''61c175f2-0f4e-4093-8945-8fea44993479'''
\pset footer off
\timing on
SELECT 'BASE' tag, md5(pg_get_functiondef('gridex_utilts_binding.wire_tokens_v1(text)'::regprocedure)) wt, md5(pg_get_functiondef('public.gridex_read_billing_source_values_v1(uuid,uuid[])'::regprocedure)) rd, md5(pg_get_functiondef('gridex_utilts_binding.validate_decimal_source_v2(jsonb,jsonb,text)'::regprocedure)) vd,
 (SELECT count(*) FROM normalized_metering_values WHERE company_id=:C) nmv,(SELECT count(*) FROM metering_values WHERE company_id=:C) mv,(SELECT count(*) FROM billing_underlays WHERE company_id=:C) bu;

SELECT 'BASE' tag, md5(pg_get_functiondef('gridex_utilts_binding.wire_tokens_v1(text)'::regprocedure)) def_md5,
 (SELECT count(*) FROM normalized_metering_values WHERE company_id=:C) nmv,
 (SELECT count(*) FROM metering_values WHERE company_id=:C) mv,
 (SELECT count(*) FROM billing_underlays WHERE company_id=:C) bu;
CREATE TEMP TABLE IF NOT EXISTS ids AS SELECT id, row_number() OVER (ORDER BY id) rn FROM normalized_metering_values WHERE company_id=:C;
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
BEGIN;
\set ON_ERROR_STOP on
\i :D/fin_wire_notx.sql
\i :D/fin_g2_notx.sql
\set ON_ERROR_STOP off
SELECT 'A_DEFS', p.oid::regprocedure, md5(pg_get_functiondef(p.oid)), p.proacl, p.prosecdef FROM pg_proc p WHERE p.oid IN ('gridex_utilts_binding.wire_tokens_v1(text)'::regprocedure,'gridex_utilts_binding.validate_decimal_source_v2(jsonb,jsonb,text)'::regprocedure,'public.gridex_read_billing_source_values_v1(uuid,uuid[])'::regprocedure,'gridex_received_sources.wire_tokens_bounded_v1(text,integer)'::regprocedure,'gridex_ediel_technical_ack.envelope(text)'::regprocedure) ORDER BY 2;
SELECT 'A_B1000_1', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn<=1000));
SELECT 'A_B1000_2', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn>1000 AND rn<=2000));
SELECT 'A_B1000_3', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn>2000));
SELECT 'A_STATS', funcname, calls, round(total_time) tot_ms, round(self_time) self_ms FROM pg_stat_xact_user_functions ORDER BY total_time DESC LIMIT 10;
ROLLBACK;
BEGIN;
\set ON_ERROR_STOP on
\i :D/fin_wire_notx.sql
\i :D/fin_g2_notx.sql
\i :D/read_billing_linear.sql
\set ON_ERROR_STOP off
SELECT 'B_DEFS', p.oid::regprocedure, md5(pg_get_functiondef(p.oid)), p.proacl, p.prosecdef FROM pg_proc p WHERE p.oid IN ('gridex_utilts_binding.wire_tokens_v1(text)'::regprocedure,'gridex_utilts_binding.validate_decimal_source_v2(jsonb,jsonb,text)'::regprocedure,'public.gridex_read_billing_source_values_v1(uuid,uuid[])'::regprocedure,'gridex_received_sources.wire_tokens_bounded_v1(text,integer)'::regprocedure,'gridex_ediel_technical_ack.envelope(text)'::regprocedure) ORDER BY 2;
SELECT 'B_B1000_1', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn<=1000));
SELECT 'B_B1000_2', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn>1000 AND rn<=2000));
SELECT 'B_B1000_3', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn>2000));
SELECT 'B_STATS', funcname, calls, round(total_time) tot_ms, round(self_time) self_ms FROM pg_stat_xact_user_functions ORDER BY total_time DESC LIMIT 10;
\i :D/neg.sql
ROLLBACK;
SELECT 'END' tag, md5(pg_get_functiondef('gridex_utilts_binding.wire_tokens_v1(text)'::regprocedure)) wt, md5(pg_get_functiondef('public.gridex_read_billing_source_values_v1(uuid,uuid[])'::regprocedure)) rd, md5(pg_get_functiondef('gridex_utilts_binding.validate_decimal_source_v2(jsonb,jsonb,text)'::regprocedure)) vd,
 (SELECT count(*) FROM normalized_metering_values WHERE company_id=:C) nmv,(SELECT count(*) FROM metering_values WHERE company_id=:C) mv,(SELECT count(*) FROM billing_underlays WHERE company_id=:C) bu;
