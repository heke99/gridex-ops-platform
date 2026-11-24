-- Apply the E66 month owner and record its migration in the same transaction.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_e66_month_owner$
BEGIN
-- A bulk proof for a single physical E66 quarter transaction. The caller
-- retains its scalar decoder when any admissibility condition is absent.
CREATE FUNCTION gridex_billing_source.observations_e66_quarter_v1(tokens jsonb, tx text, decimal_mark text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE start_at integer; stop_at integer; first_seq integer; period text; offset_raw text;
  p_start timestamp; p_end timestamp; offset_minutes integer; product text; app text;
  requested_count integer; output_count integer; decoded jsonb; raw_qty_count integer;
BEGIN
 IF jsonb_typeof(tokens) IS DISTINCT FROM 'array' OR tx IS NULL OR decimal_mark NOT IN ('.',',')
 THEN RETURN NULL; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(tokens) t
   WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='AES') THEN RETURN NULL; END IF;
 SELECT (t->>'index')::integer INTO STRICT start_at FROM jsonb_array_elements(tokens) t
 WHERE t->>'tag'='IDE' AND t#>>'{elements,2,0}'=tx;
 SELECT min((t->>'index')::integer) INTO stop_at FROM jsonb_array_elements(tokens) t
 WHERE t->>'tag' IN ('IDE','UNT') AND (t->>'index')::integer>start_at;
 SELECT min((t->>'index')::integer) INTO first_seq FROM jsonb_array_elements(tokens) t
 WHERE t->>'tag'='SEQ' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at;
 IF first_seq IS NULL THEN RETURN NULL; END IF;
 SELECT t#>>'{elements,7,0}' INTO STRICT app FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNB';
 IF app IS NULL OR app NOT IN ('23-DDQ-E66-S','23-DDQ-E66-T') OR
   (SELECT t#>>'{elements,1,0}' FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM') IS DISTINCT FROM 'E66'
 THEN RETURN NULL; END IF;
 SELECT t#>>'{elements,3,0}' INTO STRICT product FROM jsonb_array_elements(tokens) t
 WHERE t->>'tag'='LIN' AND (t->>'index')::integer BETWEEN start_at+1 AND first_seq-1;
 IF (SELECT t#>>'{elements,3,0}' FROM jsonb_array_elements(tokens) t
      WHERE t->>'tag'='MEA' AND (t->>'index')::integer BETWEEN start_at+1 AND first_seq-1)
      IS DISTINCT FROM 'KWH'
  OR (SELECT t->'elements'->1 FROM jsonb_array_elements(tokens) t
      WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='354' AND (t->>'index')::integer BETWEEN start_at+1 AND first_seq-1)
      IS DISTINCT FROM '["354","15","806"]'::jsonb THEN RETURN NULL; END IF;
 SELECT t#>>'{elements,1,1}' INTO STRICT period FROM jsonb_array_elements(tokens) t
 WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='324' AND t#>>'{elements,1,2}'='719'
   AND (t->>'index')::integer BETWEEN start_at+1 AND first_seq-1;
 SELECT t#>>'{elements,1,1}' INTO STRICT offset_raw FROM jsonb_array_elements(tokens) t
 WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='735' AND t#>>'{elements,1,2}'='406' AND (t->>'index')::integer<start_at;
 IF period IS NULL OR period !~ '^[0-9]{24}$' OR offset_raw IS NULL OR offset_raw !~ '^[+-][0-9]{4}$'
   OR substring(offset_raw,2,2)::integer>23 OR substring(offset_raw,4,2)::integer>59 THEN RETURN NULL; END IF;
 p_start:=to_timestamp(left(period,12),'YYYYMMDDHH24MI')::timestamp;
 p_end:=to_timestamp(right(period,12),'YYYYMMDDHH24MI')::timestamp;
 IF to_char(p_start,'YYYYMMDDHH24MI') IS DISTINCT FROM left(period,12)
   OR to_char(p_end,'YYYYMMDDHH24MI') IS DISTINCT FROM right(period,12) OR p_end<=p_start THEN RETURN NULL; END IF;
 offset_minutes:=(substring(offset_raw,2,2)::integer*60+substring(offset_raw,4,2)::integer)
    *CASE left(offset_raw,1) WHEN '-' THEN -1 ELSE 1 END;
 SELECT count(*) INTO requested_count FROM jsonb_array_elements(tokens) t
 WHERE t->>'tag'='QTY' AND (t->>'index')::integer BETWEEN start_at+1 AND stop_at-1;
 WITH selected AS (
   SELECT (t->>'index')::integer AS idx,t->>'tag' AS tag,t->'elements' AS elements
   FROM jsonb_array_elements(tokens) t
   WHERE (t->>'index')::integer BETWEEN first_seq AND stop_at-1
 ), segmented AS (
   SELECT *,sum(CASE WHEN tag IN ('QTY','SEQ') THEN 1 ELSE 0 END) OVER (ORDER BY idx) AS bucket
   FROM selected
 ), measurements AS (
   SELECT bucket,min(idx) FILTER(WHERE tag='QTY') AS qty_index,
     min(elements#>>'{1,0}') FILTER(WHERE tag='QTY') AS qualifier,
     min(elements#>>'{1,1}') FILTER(WHERE tag='QTY') AS textual_quantity,
     count(*) FILTER(WHERE tag='STS' AND elements#>>'{1,0}'='8') AS quality_count,
     min(elements#>>'{2,0}') FILTER(WHERE tag='STS' AND elements#>>'{1,0}'='8') AS quality
   FROM segmented GROUP BY bucket HAVING count(*) FILTER(WHERE tag='QTY')=1
 ), consecutive AS (
   SELECT *,row_number() OVER(ORDER BY qty_index)-1 AS ordinal FROM measurements
 ), candidate AS (
   SELECT ordinal,jsonb_build_object('quantityType','136','quantityKwh',
       gridex_utilts_binding.canonical_decimal_v2(textual_quantity,decimal_mark),
       'quality',quality,'qualityEstablished',true,'productCode',nullif(product,''),'registerCode',NULL,
       'applicationReference',app,'messageCode','E66',
       'periodStart',(p_start+interval '15 minutes'*ordinal-make_interval(mins=>offset_minutes)) AT TIME ZONE 'UTC',
       'periodEnd',(p_start+interval '15 minutes'*(ordinal+1)-make_interval(mins=>offset_minutes)) AT TIME ZONE 'UTC') AS proof
   FROM consecutive
   WHERE qualifier='136' AND textual_quantity IS NOT NULL AND textual_quantity<>'NULL'
     AND (quality_count=0 OR (quality_count=1 AND quality IN ('21','46','56','113','125')))
     AND p_start+interval '15 minutes'*(ordinal+1)<=p_end
 )
 SELECT (SELECT count(*) FROM measurements),count(*),jsonb_agg(proof ORDER BY ordinal)
 INTO raw_qty_count,output_count,decoded FROM candidate;
 IF requested_count<1 OR raw_qty_count<>requested_count OR output_count<>requested_count THEN RETURN NULL; END IF;
 RETURN decoded;
EXCEPTION WHEN no_data_found OR too_many_rows OR cardinality_violation OR invalid_parameter_value
  OR invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION gridex_billing_source.observations_e66_quarter_v1(jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE f record; output text;
 declaration constant text := 'e_state text;e_message text;e_detail text;e_hint text;';
 vars constant text := 'e_state text;e_message text;e_detail text;e_hint text; observation_keys text[]:=''{}''; observation_values jsonb[]:=''{}'';';
 scalar constant text := $scalar$    physical:=gridex_billing_source.observation_v1(tokens,n.source_transaction_reference,source_ordinal,CASE WHEN left(s.raw_payload,3)='UNA' THEN substring(s.raw_payload,6,1) ELSE '.' END);$scalar$;
 bulk constant text := $bulk$    physical:=NULL;
    IF cardinality(p_values)>=32 AND s.message_code='E66' AND source_ordinal>=0 THEN
     memo_key:=s.id::text||'/'||n.source_transaction_reference;
     at:=array_position(observation_keys,memo_key);hit:=observation_values[at];
     IF hit IS NULL THEN
      hit:=jsonb_build_object('values',gridex_billing_source.observations_e66_quarter_v1(
       tokens,n.source_transaction_reference,
       CASE WHEN left(s.raw_payload,3)='UNA' THEN substring(s.raw_payload,6,1) ELSE '.' END));
      observation_keys:=array_append(observation_keys,memo_key);observation_values:=array_append(observation_values,hit);
     END IF;
     IF jsonb_typeof(hit->'values')='array' THEN physical:=hit->'values'->source_ordinal; END IF;
    END IF;
    IF physical IS NULL THEN
     physical:=gridex_billing_source.observation_v1(tokens,n.source_transaction_reference,source_ordinal,
      CASE WHEN left(s.raw_payload,3)='UNA' THEN substring(s.raw_payload,6,1) ELSE '.' END);
    END IF;$bulk$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
 INTO STRICT f FROM pg_proc p
 WHERE p.oid=to_regprocedure('gridex_billing_source.bases_v1(uuid,uuid[],boolean,boolean)');
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM
      'de8da5591fead1ff5ba0d63ed07579f0a10434ac3b3829cb3d820e65202b578e'
  OR (length(f.prosrc)-length(replace(f.prosrc,declaration,'')))/length(declaration)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,scalar,'')))/length(scalar)<>1
 THEN RAISE EXCEPTION 'billing_bulk_observations_predecessor_changed'; END IF;
 output:=replace(replace(f.prosrc,declaration,vars),scalar,bulk);
 EXECUTE replace(f.definition,f.prosrc,output);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata
  OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM output
 THEN RAISE EXCEPTION 'billing_bulk_observations_metadata_changed'; END IF;
END
$migration$;
END
$gridex_e66_month_owner$;
RESET statement_timeout;
RESET lock_timeout;
