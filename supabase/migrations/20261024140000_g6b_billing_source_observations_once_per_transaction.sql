-- FINDINGS G-6b (quality/audits/live-chain-20261015/FINDINGS.md): gridex_store_billing_underlay_batch could never store
-- one quarter-hour meter-month (2880 values in 30 daily sources) inside the 8 s statement timeout. Measured in the
-- world DB (rolled back, synthetic tenant): 82 s for one meter-month. Of that: bases_v1 21 s, of which
-- gridex_billing_source.observation_v1 15.4 s (per value it scans the whole token array about twenty times and counts
-- the energy index with a nested scan per earlier quantity, O(tokens^2) per value); ~60 s in the store's own
-- rows_basis jsonb concatenation (O(n^2)); ~2 s in before_source_v2, whose (jsonb_populate_record(...)).* evaluates
-- the record once per column of billing_underlay_items.
--
-- Change (exact pre-images, refused otherwise with g6b_billing_source_observation_rule_source_changed; owner, ACL,
-- security, volatility and configuration preserved and checked, g6b_billing_source_observation_metadata_changed):
--   * gridex_billing_source.observations_v1(tokens, tx, decimal_mark): observation_v1 for every ordinal of one
--     transaction in one pass (window functions over the transaction's tokens, then observation_v1's own statements
--     in its order per ordinal). It returns SQL NULL wherever observation_v1 would raise or the input is not
--     reproduced exactly (non-unique token indices, a register reference that is not single, any unexpected error);
--     the caller then evaluates observation_v1 itself.
--   * gridex_billing_source.bases_v1 takes a value's physical observation from observations_v1, memoized per
--     (raw-payload sha256, transaction); a NULL result, a NULL or negative ordinal fall back to observation_v1.
--     Its STRICT lookup of the contract observation by sourceOrdinal uses the contract's observations grouped by
--     sourceOrdinal once per (source, transaction): none raises no_data_found, more than one too_many_rows, exactly
--     as the STRICT lookup; if the grouping fails the STRICT lookup itself is evaluated.
--   * gridex_store_billing_underlay accumulates the value bases in a jsonb[] serialized once (the same JSON array).
--   * gridex_store_billing_underlay_before_source_v2 evaluates jsonb_populate_record once per item (LATERAL).
-- observation_v1 itself, every validation, qualification rule, result shape, error path and permission are unchanged.
begin;

create function pg_temp.g6b_rewrite(p_target regprocedure, p_pre text, p_post text, p_old text[], p_new text[]) returns void
language plpgsql as $rewrite$
declare
  f record;
  body text;
  i integer;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = p_target;
  if encode(sha256(convert_to(f.prosrc, 'UTF8')), 'hex') is distinct from p_pre
    or cardinality(p_old) <> cardinality(p_new)
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'g6b_billing_source_observation_rule_source_changed:%', p_target using errcode = 'P0U01';
  end if;
  body := f.prosrc;
  for i in 1 .. cardinality(p_old) loop
    if (length(body) - length(replace(body, p_old[i], ''))) / length(p_old[i]) <> 1 then
      raise exception 'g6b_billing_source_observation_rule_source_changed:%:%', p_target, i using errcode = 'P0U01';
    end if;
    body := replace(body, p_old[i], p_new[i]);
  end loop;
  if encode(sha256(convert_to(body, 'UTF8')), 'hex') is distinct from p_post then
    raise exception 'g6b_billing_source_observation_rule_source_changed:%:post', p_target using errcode = 'P0U01';
  end if;
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'g6b_billing_source_observation_metadata_changed:%', p_target using errcode = 'P0U01';
  end if;
end
$rewrite$;

-- observations_v1 reproduces this exact observation_v1 body.
do $g6bpre$
begin
  if encode(sha256(convert_to((select prosrc from pg_proc where oid = 'gridex_billing_source.observation_v1(jsonb,text,integer,text)'::regprocedure), 'UTF8')), 'hex')
    is distinct from 'c5528b30547f784af93965091c1550391e937a40beadceaa3a922533042ad132' then
    raise exception 'g6b_billing_source_observation_rule_source_changed:observation_v1' using errcode = 'P0U01';
  end if;
end
$g6bpre$;

CREATE FUNCTION gridex_billing_source.observations_v1(tokens jsonb, tx text, decimal_mark text DEFAULT '.'::text) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog' SET "TimeZone" TO 'UTC'
 AS $g6bobs$
-- G-6b (20261024140000): observation_v1(tokens,tx,k,decimal_mark) for every k of transaction tx in one pass. Element k
-- of the returned array is exactly observation_v1's result for ordinal k (JSON null for its NULL); an ordinal beyond
-- the array is NULL in observation_v1 as well. The token scans that observation_v1 repeats for every value (and its
-- O(tokens^2) energy-index count) are done once: token indices must be unique integers, and every lookup is the same
-- predicate as in observation_v1. Where observation_v1 would raise (a register reference that is not single, an
-- unexpected error) or could depend on anything not reproduced here, SQL NULL is returned and the caller evaluates
-- observation_v1 per value, so the outcome is always observation_v1's own.
DECLARE start_at integer;stop_at integer;first_seq integer;quantity jsonb;q text;count_q integer;product text;app text;code text;register text;
 unit text;amount numeric;period text;resolution text;format text;offset_raw text;offset_mins integer;energy_index integer;duration interval;local_start timestamp;local_end timestamp;quantity_kwh numeric;period_start timestamp;period_end timestamp;
 offset_n integer;offset_v text;app_n integer;app_v text;code_n integer;code_v text;r record;physical jsonb;result jsonb[]:='{}';
BEGIN
 IF (SELECT count(*)<>count(DISTINCT (t->>'index')::integer) FROM jsonb_array_elements(tokens) t) THEN RETURN NULL; END IF;
 BEGIN
  SELECT (t->>'index')::integer INTO STRICT start_at FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE' AND t#>>'{elements,2,0}'=tx;
 EXCEPTION WHEN no_data_found OR too_many_rows THEN RETURN '[]'::jsonb;
 END;
 SELECT min((t->>'index')::integer) INTO stop_at FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>start_at AND t->>'tag' IN ('IDE','UNT');
 SELECT min((t->>'index')::integer) INTO first_seq FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at AND t->>'tag'='SEQ';
 IF first_seq IS NULL THEN RETURN '[]'::jsonb; END IF;
 -- Transaction-wide lookups of observation_v1, each the same statement, evaluated once.
 SELECT t#>>'{elements,3,0}' INTO product FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<first_seq;
 SELECT t#>>'{elements,3,0}' INTO unit FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='MEA' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<first_seq;
 SELECT t#>>'{elements,1,1}' INTO period FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='324' AND t#>>'{elements,1,2}'='719' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<first_seq;
 SELECT t#>>'{elements,1,1}',t#>>'{elements,1,2}' INTO resolution,format FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='354' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<first_seq;
 SELECT count(*),min(t#>>'{elements,1,1}') INTO offset_n,offset_v FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='735' AND t#>>'{elements,1,2}'='406' AND (t->>'index')::integer<start_at;
 SELECT count(*),min(t#>>'{elements,7,0}') INTO app_n,app_v FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNB';
 SELECT count(*),min(t#>>'{elements,1,0}') INTO code_n,code_v FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM';
 -- Per quantity of the transaction in index order (ordinal k): its quality statuses (STS 8 up to the next QTY/SEQ),
 -- its register (the RFF AES after its sequence's SEQ) and its energy index (earlier QTY 136 with the same register).
 FOR r IN
  WITH tok AS (SELECT (t->>'index')::integer i,t->>'tag' tag,t FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at),
  w AS (SELECT i,tag,t,
    max(i) FILTER (WHERE tag='SEQ' AND i>=first_seq) OVER (ORDER BY i ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) seq_at,
    max(i) FILTER (WHERE tag IN ('QTY','SEQ')) OVER (ORDER BY i ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) owner_at
   FROM tok),
  sts AS (SELECT owner_at,count(*) sts_n,min(t#>>'{elements,2,0}') sts_q FROM w WHERE tag='STS' AND t#>>'{elements,1,0}'='8' GROUP BY owner_at),
  refq AS (SELECT i,tag,t,seq_at,
    count(*) FILTER (WHERE tag='RFF') OVER (PARTITION BY seq_at ORDER BY i ROWS UNBOUNDED PRECEDING) ref_n,
    max(t#>>'{elements,1,1}') FILTER (WHERE tag='RFF') OVER (PARTITION BY seq_at ORDER BY i ROWS UNBOUNDED PRECEDING) ref_v
   FROM w WHERE seq_at IS NOT NULL AND (tag='QTY' OR (tag='RFF' AND t#>>'{elements,1,0}'='AES'))),
  qty AS (SELECT w.i,w.t,coalesce(s.sts_n,0) sts_n,s.sts_q,CASE WHEN rq.seq_at IS NULL THEN 0 ELSE rq.ref_n END ref_n,CASE WHEN rq.seq_at IS NULL THEN NULL ELSE rq.ref_v END reg
   FROM w LEFT JOIN sts s ON s.owner_at=w.i LEFT JOIN refq rq ON rq.i=w.i WHERE w.tag='QTY')
  SELECT i,t,sts_n,sts_q,ref_n,reg,
   coalesce(count(*) FILTER (WHERE t#>>'{elements,1,0}'='136') OVER (PARTITION BY reg ORDER BY i ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)::integer energy,
   max(ref_n) OVER () max_ref_n
  FROM qty ORDER BY i
 LOOP
  -- A QTY whose register reference is not single makes observation_v1's energy-index subquery raise: not reproduced.
  IF r.max_ref_n>1 THEN RETURN NULL; END IF;
  quantity:=r.t;count_q:=r.sts_n;q:=r.sts_q;register:=r.reg;energy_index:=r.energy;physical:=NULL;
  <<one>>
  BEGIN
   -- From here on observation_v1's own statements, in its order.
   IF count_q>1 OR (count_q=1 AND (q IS NULL OR q NOT IN ('21','46','56','113','125'))) THEN EXIT one; END IF;
   amount:=gridex_utilts_binding.canonical_decimal_v2(quantity#>>'{elements,1,1}',decimal_mark)::numeric;
   quantity_kwh:=amount*CASE unit WHEN 'KWH' THEN 1 WHEN 'MWH' THEN 1000 WHEN 'GWH' THEN 1000000 END;
   IF offset_n=0 THEN RAISE no_data_found; ELSIF offset_n>1 THEN RAISE too_many_rows; END IF;
   offset_raw:=offset_v;
   IF period !~ '^[0-9]{24}$' OR offset_raw !~ '^[+-][0-9]{4}$' OR resolution !~ '^[0-9]+$' THEN EXIT one; END IF;
   IF substring(offset_raw,2,2)::integer>23 OR substring(offset_raw,4,2)::integer>59 THEN EXIT one; END IF;
   period_start:=to_timestamp(left(period,12),'YYYYMMDDHH24MI')::timestamp;period_end:=to_timestamp(right(period,12),'YYYYMMDDHH24MI')::timestamp;
   IF to_char(period_start,'YYYYMMDDHH24MI') IS DISTINCT FROM left(period,12) OR to_char(period_end,'YYYYMMDDHH24MI') IS DISTINCT FROM right(period,12) OR period_end<=period_start THEN EXIT one; END IF;
   offset_mins:=(substring(offset_raw,2,2)::integer*60+substring(offset_raw,4,2)::integer)*CASE left(offset_raw,1) WHEN '-' THEN -1 ELSE 1 END;
   duration:=CASE format WHEN '806' THEN make_interval(mins=>resolution::integer) WHEN '805' THEN make_interval(hours=>resolution::integer) WHEN '802' THEN make_interval(months=>resolution::integer) WHEN '801' THEN make_interval(years=>resolution::integer) END;
   IF duration IS NULL OR duration<=interval '0' THEN EXIT one; END IF;
   local_start:=period_start+duration*energy_index;
   local_end:=local_start+duration;
   IF local_end>period_end THEN EXIT one; END IF;
   IF app_n=0 THEN RAISE no_data_found; ELSIF app_n>1 THEN RAISE too_many_rows; END IF;
   app:=app_v;
   IF code_n=0 THEN RAISE no_data_found; ELSIF code_n>1 THEN RAISE too_many_rows; END IF;
   code:=code_v;
   physical:=jsonb_build_object('quantityType',quantity#>>'{elements,1,0}','quantityKwh',gridex_utilts_binding.canonical_decimal_v2(quantity_kwh::text),'quality',q,'qualityEstablished',true,'productCode',nullif(product,''),'registerCode',nullif(register,''),'applicationReference',app,'messageCode',code,
    'periodStart',(local_start-make_interval(mins=>offset_mins)) AT TIME ZONE 'UTC','periodEnd',(local_end-make_interval(mins=>offset_mins)) AT TIME ZONE 'UTC');
  EXCEPTION WHEN no_data_found OR too_many_rows OR invalid_parameter_value OR datetime_field_overflow THEN physical:=NULL;
  END;
  result:=result||physical;
 END LOOP;
 RETURN to_jsonb(result);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END$g6bobs$;
REVOKE ALL ON FUNCTION gridex_billing_source.observations_v1(jsonb,text,text) FROM PUBLIC, anon, authenticated, service_role;

do $g6bcheck$
begin
  if encode(sha256(convert_to((select prosrc from pg_proc where oid = 'gridex_billing_source.observations_v1(jsonb,text,text)'::regprocedure), 'UTF8')), 'hex') is distinct from 'ce6a4433d181d6a432d81acd3bbd90d1a3c0b19eda7c3651d72d342ffe5131df'
    or exists (select from pg_proc p, pg_proc b where b.oid = 'gridex_billing_source.observation_v1(jsonb,text,integer,text)'::regprocedure
      and p.oid = 'gridex_billing_source.observations_v1(jsonb,text,text)'::regprocedure
      and (p.proowner, p.proacl::text, p.prosecdef, p.provolatile, p.proconfig::text, p.proparallel, p.proisstrict) is distinct from (b.proowner, b.proacl::text, b.prosecdef, b.provolatile, b.proconfig::text, b.proparallel, b.proisstrict)) then
    raise exception 'g6b_billing_source_observation_metadata_changed:observations_v1' using errcode = 'P0U01';
  end if;
end
$g6bcheck$;

select pg_temp.g6b_rewrite(
  'gridex_billing_source.bases_v1(uuid,uuid[],boolean,boolean)'::regprocedure,
  'fe9b0b98bb2c66aa6ef60adc31aa45198aefa4cef74944024b3f7fbf542365f2',
  'e4a8b979a5ce5d6316fbc6ad2548fff3b28b31df6404a5fb4bd63e0171315193',
  array[
    $g6bold$ payload_hash text;memo_key text;hit jsonb;tokens jsonb;e_state text;e_message text;e_detail text;e_hint text;
$g6bold$,
    $g6bold$    SELECT value,(value->>'ordinal')::integer INTO STRICT o,ordinal FROM jsonb_array_elements(c->'observations') WHERE (value->>'sourceOrdinal')::integer=source_ordinal;
$g6bold$,
    $g6bold$    physical:=gridex_billing_source.observation_v1(tokens,n.source_transaction_reference,source_ordinal,CASE WHEN left(s.raw_payload,3)='UNA' THEN substring(s.raw_payload,6,1) ELSE '.' END);
$g6bold$
  ],
  array[
    $g6bnew$ payload_hash text;memo_key text;hit jsonb;tokens jsonb;e_state text;e_message text;e_detail text;e_hint text;
 -- G-6b (20261024140000): the observations of a transaction per (raw-payload sha256, transaction).
 observation_keys text[]:='{}';observation_values jsonb[]:='{}';observations jsonb;
 -- G-6b: the contract's observations grouped by sourceOrdinal per (source, transaction).
 ordinal_keys text[]:='{}';ordinal_values jsonb[]:='{}';by_ordinal jsonb;
$g6bnew$,
    $g6bnew$    -- G-6b (20261024140000): the contract observation of this value's sourceOrdinal from the contract's observations
    -- grouped by sourceOrdinal once per (source, transaction); none raises no_data_found and more than one too_many_rows
    -- as the STRICT lookup does. If the grouping itself fails, the STRICT lookup is evaluated as before.
    memo_key:=s.id::text||'/'||n.source_transaction_reference;
    at:=array_position(ordinal_keys,memo_key);by_ordinal:=ordinal_values[at];
    IF by_ordinal IS NULL THEN
     BEGIN
      SELECT jsonb_build_object('m',coalesce(jsonb_object_agg(g.k,g.v),'{}'::jsonb)) INTO STRICT by_ordinal FROM (SELECT (e.value->>'sourceOrdinal')::integer::text k,jsonb_agg(e.value ORDER BY e.position) v FROM jsonb_array_elements(c->'observations') WITH ORDINALITY e(value,position) GROUP BY 1) g;
     EXCEPTION WHEN OTHERS THEN by_ordinal:='{}'::jsonb;
     END;
     ordinal_keys:=ordinal_keys||memo_key;ordinal_values:=ordinal_values||by_ordinal;
    END IF;
    IF by_ordinal ? 'm' THEN
     hit:=by_ordinal->'m'->(source_ordinal::text);
     IF hit IS NULL THEN RAISE no_data_found; ELSIF jsonb_array_length(hit)>1 THEN RAISE too_many_rows; END IF;
     o:=hit->0;ordinal:=(o->>'ordinal')::integer;
    ELSE
     SELECT value,(value->>'ordinal')::integer INTO STRICT o,ordinal FROM jsonb_array_elements(c->'observations') WHERE (value->>'sourceOrdinal')::integer=source_ordinal;
    END IF;
$g6bnew$,
    $g6bnew$    -- G-6b (20261024140000): every observation of the transaction in one observations_v1 pass (IMMUTABLE, equal to
    -- observation_v1 per ordinal), memoized per (raw-payload sha256, transaction); where observations_v1 returns NULL,
    -- or the ordinal is NULL or negative, observation_v1 itself is evaluated for this value.
    memo_key:=payload_hash||'/'||n.source_transaction_reference;
    at:=array_position(observation_keys,memo_key);observations:=observation_values[at];
    IF observations IS NULL THEN
     observations:=jsonb_build_object('o',gridex_billing_source.observations_v1(tokens,n.source_transaction_reference,CASE WHEN left(s.raw_payload,3)='UNA' THEN substring(s.raw_payload,6,1) ELSE '.' END));
     IF memo_key IS NOT NULL THEN observation_keys:=observation_keys||memo_key;observation_values:=observation_values||observations; END IF;
    END IF;
    IF jsonb_typeof(observations->'o')='array' AND source_ordinal>=0 THEN physical:=nullif(observations->'o'->source_ordinal,'null'::jsonb);
    ELSE physical:=gridex_billing_source.observation_v1(tokens,n.source_transaction_reference,source_ordinal,CASE WHEN left(s.raw_payload,3)='UNA' THEN substring(s.raw_payload,6,1) ELSE '.' END);
    END IF;
$g6bnew$
  ]
);

select pg_temp.g6b_rewrite(
  'public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'::regprocedure,
  '014b52dff80a6fed8d95aa4e1549dfe2d304fa16c63641018a6aa36f14e9115b',
  'cff64d4893f1933db1e5d337037902a746e510819048501865aa57671f651704',
  array[
    $g6bold$rows_basis jsonb:='[]';$g6bold$,
    $g6bold$rows_basis:=rows_basis||jsonb_build_array(basis||jsonb_build_object('revisionNumber',n.revision_number,'supplyPeriodId',sp.id));$g6bold$,
    $g6bold$jsonb_build_object('values',rows_basis,$g6bold$
  ],
  array[
    $g6bnew$rows_basis jsonb[]:='{}';$g6bnew$,
    $g6bnew$rows_basis:=rows_basis||(basis||jsonb_build_object('revisionNumber',n.revision_number,'supplyPeriodId',sp.id));$g6bnew$,
    $g6bnew$jsonb_build_object('values',to_jsonb(rows_basis),$g6bnew$
  ]
);

select pg_temp.g6b_rewrite(
  'gridex_billing_source.gridex_store_billing_underlay_before_source_v2(uuid,jsonb,jsonb,uuid)'::regprocedure,
  '790cc345f79352526b83ae18c3bd1de637d94521d5c06f2400389ecd30a51303',
  'c3f50a52f9a5d11d47383cbc611d02f29098a841074b2c9fa3b734d91b252ede',
  array[
    $g6bold$  select (jsonb_populate_record(null::public.billing_underlay_items,
    item || jsonb_build_object('id',gen_random_uuid(),'company_id',p_company_id,'billing_underlay_id',v_id,'created_at',now(),'updated_at',now()))).*
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item;$g6bold$
  ],
  array[
    $g6bnew$  -- G-6b (20261024140000): one jsonb_populate_record per item ((f(x)).* evaluated it once per column).
  select r.*
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item
  cross join lateral jsonb_populate_record(null::public.billing_underlay_items,
    item || jsonb_build_object('id',gen_random_uuid(),'company_id',p_company_id,'billing_underlay_id',v_id,'created_at',now(),'updated_at',now())) r;$g6bnew$
  ]
);

-- G-6b: the value bases are accumulated in an array and serialized once (rows_basis was an O(n^2) jsonb
-- concatenation of ~2 kB bases: ~60 s of the 68 s a quarter-hour meter-month took); the same JSON array results.
commit;
