-- Narrow source-only L359 area owner. Swedish UTILTS25-A-5 p54/56/81;
-- current TSP20260928.xls Document2702 Tidsserieprodukter row21 / OT row85,
-- SHA256 53034f2fd3de416a84f755b454fc72378930126446909cee5eae968111db816b.
-- This tuple does not certify a remote institution. Existing protected source,
-- issuer/transport, recipient and execution-actor guards remain authoritative.
-- No sink contracts, point ownership, LOC175 permission or historical data change.

CREATE TEMP TABLE s01_area_owner_profiles ON COMMIT DROP AS
 SELECT oid,proowner,proacl,prosecdef,proconfig,proargtypes,prorettype,provolatile
 FROM pg_proc WHERE oid IN (
 'gridex_utilts_binding.persist_consumption_before_precision_v1(uuid,text,uuid,text,text,jsonb)'::regprocedure,
 'gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)'::regprocedure);
DO $preconditions$
DECLARE verified record;
BEGIN
 FOR verified IN SELECT q.*,n.nspname FROM pg_proc q JOIN pg_namespace n ON n.oid=q.pronamespace
  WHERE q.oid IN (SELECT oid FROM pg_temp.s01_area_owner_profiles) LOOP
  IF pg_get_userbyid(verified.proowner)<>'postgres'
   OR EXISTS(SELECT FROM aclexplode(coalesce(verified.proacl,acldefault('f',verified.proowner))) a WHERE a.grantee<>verified.proowner)
   OR (verified.proname='persist_consumption_before_precision_v1' AND
    (encode(sha256(convert_to(verified.prosrc,'UTF8')),'hex')<>'ac53c3f07f74dc8829e4b5d8d6407c7b96f57f5a8c4d44147ab660b62c06c892'
     OR NOT verified.prosecdef OR verified.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, extensions','TimeZone=UTC']))
   OR (verified.proname='stored_contract_v1' AND
    (encode(sha256(convert_to(verified.prosrc,'UTF8')),'hex')<>'0e74bd2f78c2d81c06cd8216d96f31a362204cf4f2aa61e3d651179d78cdeae9'
     OR verified.prosecdef OR verified.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, extensions'])) THEN
   RAISE EXCEPTION 'utilts_s01_area_predecessor_unqualified'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_temp.s01_area_owner_profiles)<>2
  OR to_regprocedure('gridex_utilts_binding.s01_l359_area_identity_v1(jsonb,text)') IS NOT NULL
  OR to_regprocedure('gridex_utilts_binding.s01_l359_item_matches_v1(jsonb,jsonb)') IS NOT NULL
  OR to_regprocedure('gridex_utilts_binding.require_s01_l359_basis_v1(uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'utilts_s01_area_predecessor_unqualified'; END IF;
END $preconditions$;

CREATE FUNCTION gridex_utilts_binding.s01_l359_area_identity_v1(tokens jsonb, transaction_id text) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog' SET "TimeZone" TO 'UTC'
AS $identity$
DECLARE own_start integer; own_end integer; first_seq integer; first_ide integer;
 header jsonb; own jsonb; x jsonb; a jsonb; product jsonb; area text;
 period text; latest text; start_time timestamptz; end_time timestamptz; latest_time timestamptz;
BEGIN
 IF jsonb_typeof(tokens) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 SELECT min((t->>'index')::integer) INTO first_ide FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='IDE';
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='IDE' AND t#>>'{elements,2,0}'=transaction_id;
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>'{0,elements,1}' IS DISTINCT FROM '["24"]'::jsonb
  OR a#>'{0,elements,2}' IS DISTINCT FROM jsonb_build_array(transaction_id) THEN RETURN NULL; END IF;
 own_start:=(a#>>'{0,index}')::integer;
 SELECT min((t->>'index')::integer) INTO own_end FROM jsonb_array_elements(tokens)t WHERE (t->>'index')::integer>own_start AND t->>'tag' IN('IDE','UNT');
 SELECT min((t->>'index')::integer) INTO first_seq FROM jsonb_array_elements(tokens)t WHERE (t->>'index')::integer>own_start AND (t->>'index')::integer<own_end AND t->>'tag'='SEQ';
 IF own_end IS NULL OR first_seq IS NULL THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t ORDER BY (t->>'index')::integer) INTO own FROM jsonb_array_elements(tokens)t WHERE (t->>'index')::integer>own_start AND (t->>'index')::integer<own_end;
 SELECT jsonb_agg(t ORDER BY (t->>'index')::integer) INTO header FROM jsonb_array_elements(own)t WHERE (t->>'index')::integer<first_seq;
 -- Current TSP L359 row21 is explicitly andelstal. Swedish U5 field520
 -- (p38/p61) excludes observation status for andelstal, including temporary21.
 -- This identity helper owns only that exact product; no other S01 is inferred.
 IF EXISTS(SELECT FROM jsonb_array_elements(own)t WHERE t->>'tag'='STS'
  AND t#>>'{elements,1,0}'='8' AND (t->>'index')::integer>first_seq) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(own)t WHERE t->>'tag'='NAD' OR (t->>'tag'='LOC' AND t#>>'{elements,1,0}'<>'239')
  OR ((t->>'index')::integer>first_seq AND t->>'tag' IN('LOC','PIA','LIN','CCI','CAV'))) THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>>'{0,elements,1,0}' IS DISTINCT FROM 'S01' THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='MKS' AND (t->>'index')::integer<first_ide;
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>'{0,elements,1}' IS DISTINCT FROM '["23"]'::jsonb OR a#>'{0,elements,2}' IS DISTINCT FROM '["E03","","260"]'::jsonb THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='735' AND (t->>'index')::integer<first_ide;
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>'{0,elements,1}' IS DISTINCT FROM '["735","+0100","406"]'::jsonb THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(header)t WHERE t->>'tag'='LOC';
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>'{0,elements,1}' IS DISTINCT FROM '["239"]'::jsonb
  OR jsonb_array_length(a#>'{0,elements,2}') IS DISTINCT FROM 3 OR a#>>'{0,elements,2,1}' IS DISTINCT FROM 'SVK' OR a#>>'{0,elements,2,2}' IS DISTINCT FROM '260' THEN RETURN NULL; END IF;
 area:=a#>>'{0,elements,2,0}';IF area IS NULL OR area !~ '^[A-Z0-9]{1,3}$' THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(header)t WHERE t->>'tag'='LIN';
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>'{0,elements,3}' IS DISTINCT FROM '["8716867000030","","","9"]'::jsonb THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(header)t WHERE t->>'tag'='PIA';
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR jsonb_array_length(a#>'{0,elements}') IS DISTINCT FROM 7 OR a#>'{0,elements,1}' IS DISTINCT FROM '["1"]'::jsonb THEN RETURN NULL; END IF;
 -- Swedish U5 p81 fixes the five C212 positions. An unordered category
 -- map must not make a PC/PT (or any later-slot) permutation authoritative.
 IF a#>'{0,elements,2}' IS DISTINCT FROM '["Z04","PC","SVK","260"]'::jsonb
  OR a#>'{0,elements,3}' IS DISTINCT FROM '["U46","PT","SVK","260"]'::jsonb
  OR a#>'{0,elements,4}' IS DISTINCT FROM '["Z02","OT","SVK","260"]'::jsonb
  OR a#>'{0,elements,5}' IS DISTINCT FROM '["Z58","LOD","SVK","260"]'::jsonb
  OR a#>'{0,elements,6}' IS DISTINCT FROM '["Z05","BAP","SVK","260"]'::jsonb THEN RETURN NULL; END IF;
 product:='{}';
 FOR x IN SELECT value FROM jsonb_array_elements(a#>'{0,elements}') WITH ORDINALITY e(value,n) WHERE n>2 LOOP
  IF jsonb_array_length(x) IS DISTINCT FROM 4 OR x->>2 IS DISTINCT FROM 'SVK' OR x->>3 IS DISTINCT FROM '260'
   OR product ? (x->>1) OR x->>1 NOT IN('PC','PT','OT','LOD','BAP') THEN RETURN NULL; END IF;
  product:=product||jsonb_build_object(x->>1,x->>0);
 END LOOP;
 IF product IS DISTINCT FROM '{"PC":"Z04","PT":"U46","OT":"Z02","LOD":"Z58","BAP":"Z05"}'::jsonb THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(header)t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='354';
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>'{0,elements,1}' IS DISTINCT FROM '["354","1","802"]'::jsonb THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(header)t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='324';
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>>'{0,elements,1,2}' IS DISTINCT FROM '719' THEN RETURN NULL; END IF;
 period:=a#>>'{0,elements,1,1}';IF period IS NULL OR period !~ '^[0-9]{24}$' THEN RETURN NULL; END IF;
 start_time:=gridex_utilts_binding.esco_local_time_v1(left(period,12),'+0100');end_time:=gridex_utilts_binding.esco_local_time_v1(right(period,12),'+0100');
 IF start_time IS NULL OR end_time IS NULL OR substring(period,7,6)<>'010000' OR substring(period,19,6)<>'010000'
  OR end_time IS DISTINCT FROM (start_time+interval '1 hour'+interval '1 month'-interval '1 hour') THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(header)t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='368';
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>>'{0,elements,1,2}' IS DISTINCT FROM '203'
  OR EXISTS(SELECT FROM jsonb_array_elements(own)t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='597') THEN RETURN NULL; END IF;
 latest:=a#>>'{0,elements,1,1}';latest_time:=gridex_utilts_binding.esco_local_time_v1(latest,'+0100');
 IF latest_time IS NULL OR latest_time<end_time THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(header)t WHERE t->>'tag'='STS';
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>'{0,elements,1}' IS DISTINCT FROM '["7"]'::jsonb OR a#>'{0,elements,3}' IS DISTINCT FROM '["E43","","260"]'::jsonb THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(header)t WHERE t->>'tag'='MEA';
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>'{0,elements,1}' IS DISTINCT FROM '["AAZ"]'::jsonb OR a#>'{0,elements,3}' IS DISTINCT FROM '["KWH"]'::jsonb THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(header)t WHERE t->>'tag'='CCI';
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>'{0,elements,3}' IS DISTINCT FROM '["E02","","260"]'::jsonb THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO a FROM jsonb_array_elements(header)t WHERE t->>'tag'='CAV';
 IF jsonb_array_length(a) IS DISTINCT FROM 1 OR a#>'{0,elements,1}' IS DISTINCT FROM '["E01","","260"]'::jsonb THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(own)t WHERE t->>'tag'='SEQ')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(own)t WHERE t->>'tag'='QTY')<>1
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(own)t WHERE t->>'tag'='QTY' AND (t->>'index')::integer>first_seq AND t#>>'{elements,1,0}'='136') THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('gridAreaId',area,'timeSeriesProduct',product,'periodStart',start_time,'periodEnd',end_time,'latestUpdateDate',latest_time);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $identity$;

CREATE FUNCTION gridex_utilts_binding.s01_l359_item_matches_v1(tokens jsonb, item jsonb) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog' SET "TimeZone" TO 'UTC'
AS $matches$
DECLARE identity jsonb; c jsonb:=item->'consumptionContract'; sink text; field text;
BEGIN
 identity:=gridex_utilts_binding.s01_l359_area_identity_v1(tokens,item->>'transactionId');
 IF identity IS NULL OR item->>'seriesKind' IS DISTINCT FROM 'aggregate' OR item->>'disposition' IS DISTINCT FROM 'accepted'
  OR item->>'responseType' IS DISTINCT FROM 'positive_aperak' OR item->>'productId' IS DISTINCT FROM '8716867000030'
  OR item->>'gridAreaId' IS DISTINCT FROM identity->>'gridAreaId'
  OR item->'meteringPointId' IS DISTINCT FROM 'null'::jsonb OR item->'externalMeteringPointId' IS DISTINCT FROM 'null'::jsonb
  OR (item ? 'timeSeriesProduct' AND item->'timeSeriesProduct' IS DISTINCT FROM identity->'timeSeriesProduct')
  OR (item ? 'actorContext' AND item->'actorContext' IS DISTINCT FROM '{}'::jsonb)
  OR (item->>'periodStart')::timestamptz IS DISTINCT FROM (identity->>'periodStart')::timestamptz
  OR (item->>'periodEnd')::timestamptz IS DISTINCT FROM (identity->>'periodEnd')::timestamptz
  OR (item->>'latestUpdateDate')::timestamptz IS DISTINCT FROM (identity->>'latestUpdateDate')::timestamptz
  OR item->>'registrationDate' IS NOT NULL OR item->>'resolution' IS DISTINCT FROM '1'
  OR item->>'unit' IS DISTINCT FROM 'KWH' OR item->>'reasonForTransaction' IS DISTINCT FROM 'E43'
  OR c->'version' IS DISTINCT FROM '2'::jsonb OR c->>'messageCode' IS DISTINCT FROM 'S01'
  OR c->>'transactionId' IS DISTINCT FROM item->>'transactionId' OR c->>'seriesKind' IS DISTINCT FROM 'aggregate'
  OR c->'observations' IS DISTINCT FROM '[]'::jsonb OR c->'billingContributionOrdinals' IS DISTINCT FROM '[]'::jsonb
  OR c#>>'{interpretation,timestampPolicy}' IS DISTINCT FROM 'no-consumption-v1'
  OR c->>'guideRevision' IS DISTINCT FROM '25-A-5'
  OR c#>>'{interpretation,resolutionValue}' IS DISTINCT FROM '1'
  OR c#>>'{interpretation,resolutionFormat}' IS DISTINCT FROM '802'
  OR c#>>'{interpretation,timezoneRaw}' IS DISTINCT FROM '+0100'
  OR c#>>'{interpretation,timezoneFormat}' IS DISTINCT FROM '406'
  OR c#>'{interpretation,offsetMinutes}' IS DISTINCT FROM '60'::jsonb
  OR c#>'{interpretation,localRegistration}' IS DISTINCT FROM 'null'::jsonb
  OR (c#>>'{interpretation,localPeriodStart}')::timestamp IS DISTINCT FROM ((identity->>'periodStart')::timestamptz AT TIME ZONE 'UTC')+interval '1 hour'
  OR (c#>>'{interpretation,localPeriodEnd}')::timestamp IS DISTINCT FROM ((identity->>'periodEnd')::timestamptz AT TIME ZONE 'UTC')+interval '1 hour' THEN RETURN false; END IF;
 FOREACH sink IN ARRAY ARRAY['metering','billing'] LOOP
  IF c#>>ARRAY[sink,'capability'] IS DISTINCT FROM 'skip' THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['customerId','siteId','customerSiteId','meteringPointId','gridOwnerId','sourceRequestId'] LOOP
   IF c#>ARRAY[sink,field] IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $matches$;

CREATE FUNCTION gridex_utilts_binding.require_s01_l359_basis_v1(company uuid, source uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $basis$
DECLARE basis jsonb;
BEGIN
 basis:=gridex_ediel_source_rules.require_v1(company,source);
 IF basis->>'version' IS DISTINCT FROM '25-A-5:r5' OR basis#>>'{snapshot,version}' IS DISTINCT FROM '25-A-5:r5'
  OR basis#>>'{snapshot,rulePack,market}' IS DISTINCT FROM 'electricity'
  OR basis#>>'{snapshot,rulePack,family}' IS DISTINCT FROM 'UTILTS'
  OR basis#>>'{snapshot,rulePack,guide_version}' IS DISTINCT FROM '25-A-5'
  OR basis#>>'{snapshot,rulePack,guide_revision}' IS DISTINCT FROM '5'
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(basis#>'{snapshot,guideSources}')s WHERE s->>'source_type'='technical_guide'
   AND s->>'revision'='25-A-5' AND s->>'source_hash'='b76a61b9aa6f136771e5db4948296d1b632b8d775314eb6c93783595ae419db2'
   AND nullif(btrim(s->>'source_locator'),'') IS NOT NULL) THEN
  RAISE EXCEPTION 'utilts_s01_area_source_basis_unavailable' USING ERRCODE='P0U01'; END IF;
END $basis$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.s01_l359_area_identity_v1(jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION gridex_utilts_binding.s01_l359_item_matches_v1(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION gridex_utilts_binding.require_s01_l359_basis_v1(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION gridex_utilts_binding.s01_l359_area_identity_v1(jsonb,text) OWNER TO postgres;
ALTER FUNCTION gridex_utilts_binding.s01_l359_item_matches_v1(jsonb,jsonb) OWNER TO postgres;
ALTER FUNCTION gridex_utilts_binding.require_s01_l359_basis_v1(uuid,uuid) OWNER TO postgres;
DO $patch$
DECLARE old_body text; new_body text; ddl text;
BEGIN
 old_body:=$old$
DECLARE
 source public.ediel_messages%rowtype; receipt gridex_utilts_binding.receipts%rowtype;
 stored gridex_utilts_binding.contracts%rowtype; series public.meter_reading_series%rowtype;
 tokens jsonb; membership jsonb; expected jsonb; raw_hash text; item jsonb; c jsonb; r jsonb; results jsonb; answer jsonb:='[]';
 v_series_id uuid; identity text; contract_hash text; origin gridex_utilts_binding.receipts%rowtype;
 decimal_mark text; legacy_transactions jsonb;
 own_start integer; own_end integer; sequence_start integer; sequence_end integer; sequence_count integer;
BEGIN
 IF p_company_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test','production') OR p_message_code IS NULL OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_transactions)=0 THEN
  RAISE EXCEPTION 'utilts_consumption_input_invalid' USING ERRCODE='P0U01';
 END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id FOR UPDATE;
 IF NOT FOUND OR source.company_id IS DISTINCT FROM p_company_id OR source.environment IS DISTINCT FROM p_environment OR source.direction<>'inbound' OR source.message_family<>'UTILTS' OR source.message_code IS DISTINCT FROM p_message_code
 OR p_raw_payload IS NULL OR source.raw_payload IS DISTINCT FROM p_raw_payload THEN RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01'; END IF;
 raw_hash:=encode(digest(convert_to(source.raw_payload,'UTF8'),'sha256'),'hex');
 decimal_mark:=CASE WHEN left(source.raw_payload,3)='UNA' THEN substring(source.raw_payload,6,1) ELSE '.' END;
 tokens:=gridex_utilts_binding.wire_tokens_v1(source.raw_payload);
 IF tokens IS NULL THEN RAISE EXCEPTION 'utilts_physical_membership_unavailable' USING ERRCODE='P0U01'; END IF;
 -- This owner deliberately does not reinterpret multiple physical messages.
 IF (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH')<>1
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='UTILTS')
 OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM')<>1
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'=p_message_code) THEN
  RAISE EXCEPTION 'utilts_physical_membership_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT coalesce(jsonb_agg(coalesce(nullif(t#>>'{elements,2,0}',''),'transaction-'||ordinal::text) ORDER BY ordinal),'["transaction-1"]') INTO membership
 FROM (SELECT t,row_number() OVER(ORDER BY (t->>'index')::integer) ordinal FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE') physical;
 SELECT jsonb_agg(t->'transactionId' ORDER BY ordinal) INTO expected FROM jsonb_array_elements(p_transactions) WITH ORDINALITY x(t,ordinal);
 IF membership IS DISTINCT FROM expected OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(membership))<>jsonb_array_length(membership) THEN
  RAISE EXCEPTION 'utilts_physical_membership_conflict' USING ERRCODE='P0U01'; END IF;
 -- An invalid physical IDE remains a member so its negative guide outcome can
 -- be bound to this source. It must never create accepted consumption authority.
 IF EXISTS(SELECT FROM jsonb_array_elements(p_transactions) x(item)
  JOIN jsonb_array_elements(tokens) t ON t->>'tag'='IDE' AND t#>>'{elements,2,0}'=x.item->>'transactionId'
  WHERE x.item->>'disposition'='accepted' AND t#>>'{elements,1,0}' IS DISTINCT FROM '24') THEN
  RAISE EXCEPTION 'utilts_consumption_identity_unsupported' USING ERRCODE='P0U01'; END IF;
 -- Namespace validation precedes receipt/ACK/series writes, independently of
 -- application comparison exemptions and mutable plain-ID matches.
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  c:=item->'consumptionContract';
  IF NOT coalesce(CASE WHEN c->'version'='3'::jsonb THEN gridex_utilts_binding.valid_rejected_item_v3(item) ELSE gridex_utilts_binding.validate_contract_v1(c) END,false) THEN
   RAISE EXCEPTION 'utilts_consumption_contract_invalid' USING ERRCODE='P0U01'; END IF;
  IF c->'version'='2'::jsonb AND NOT coalesce(gridex_utilts_binding.validate_decimal_source_v2(tokens,item,decimal_mark),false) THEN
   RAISE EXCEPTION 'utilts_consumption_decimal_source_conflict' USING ERRCODE='P0U01'; END IF;
  IF item->>'disposition'='accepted' AND (p_message_code IN ('E30','E66','S07','E72','S02') OR jsonb_array_length(c->'observations')>0
   OR (p_message_code IN ('S01','E73') AND NOT gridex_utilts_binding.unowned_regulating_object_v1(tokens,item->>'transactionId'))) THEN
   identity:=gridex_utilts_binding.supported_point_v1(tokens,item->>'transactionId');
   IF identity IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(c->'observations') o WHERE o->>'externalPoint' IS DISTINCT FROM identity) THEN
    RAISE EXCEPTION 'utilts_consumption_identity_unsupported' USING ERRCODE='P0U01'; END IF;
  END IF;
  IF item->>'disposition'='accepted' AND p_message_code='S02' THEN
   SELECT (t->>'index')::integer INTO STRICT own_start FROM jsonb_array_elements(tokens) t
    WHERE t->>'tag'='IDE' AND t#>>'{elements,2,0}'=item->>'transactionId';
   SELECT min((t->>'index')::integer) INTO own_end FROM jsonb_array_elements(tokens) t
    WHERE (t->>'index')::integer>own_start AND t->>'tag' IN ('IDE','UNT');
   sequence_count:=0;
   FOR sequence_start IN SELECT (t->>'index')::integer FROM jsonb_array_elements(tokens) t
    WHERE t->>'tag'='SEQ' AND (t->>'index')::integer>own_start AND (t->>'index')::integer<own_end ORDER BY 1 LOOP
    sequence_count:=sequence_count+1;
    SELECT coalesce(min((t->>'index')::integer),own_end) INTO sequence_end FROM jsonb_array_elements(tokens) t
     WHERE (t->>'index')::integer>sequence_start AND (t->>'index')::integer<own_end AND t->>'tag'='SEQ';
    IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='QTY'
     AND (t->>'index')::integer>sequence_start AND (t->>'index')::integer<sequence_end
     AND t#>>'{elements,1,0}'='135' AND nullif(btrim(t#>>'{elements,1,1}'),'') IS NOT NULL) THEN
     RAISE EXCEPTION 'utilts_s02_quantity_required' USING ERRCODE='P0U01'; END IF;
   END LOOP;
   IF sequence_count=0 THEN RAISE EXCEPTION 'utilts_s02_quantity_required' USING ERRCODE='P0U01'; END IF;
  END IF;
 END LOOP;
 SELECT * INTO receipt FROM gridex_utilts_binding.receipts WHERE source_message_id=p_source_message_id;
 IF NOT FOUND THEN
  IF EXISTS(SELECT FROM jsonb_array_elements(p_transactions) t WHERE t#>'{consumptionContract,version}' IS DISTINCT FROM '2'::jsonb AND NOT coalesce(gridex_utilts_binding.valid_rejected_item_v3(t),false)) THEN
   RAISE EXCEPTION 'utilts_new_consumption_requires_v2' USING ERRCODE='P0U01'; END IF;
  IF EXISTS(SELECT FROM public.ediel_ack_transaction_results WHERE source_message_id=p_source_message_id)
  OR EXISTS(SELECT FROM public.meter_reading_series WHERE source_ediel_message_id=p_source_message_id) THEN
   RAISE EXCEPTION 'utilts_historical_binding_unavailable' USING ERRCODE='P0U01'; END IF;
  INSERT INTO gridex_utilts_binding.receipts(source_message_id,company_id,environment,message_code,raw_hash,source_context,membership,contract_version)
   VALUES(p_source_message_id,p_company_id,p_environment,p_message_code,raw_hash,gridex_utilts_binding.source_context_v1(source),membership,2) RETURNING * INTO receipt;
 ELSIF receipt.company_id IS DISTINCT FROM p_company_id OR receipt.environment IS DISTINCT FROM p_environment
 OR receipt.message_code IS DISTINCT FROM p_message_code OR receipt.contract_version NOT IN (1,2) OR receipt.raw_hash IS DISTINCT FROM raw_hash OR receipt.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(source) OR receipt.membership IS DISTINCT FROM membership THEN
  RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01';
 END IF;
 -- A retained V1 is solely an authentic retry of this exact source/hash.
 -- New accepted effects require V2; an old held/negative receipt cannot mint V1.
 IF receipt.contract_version=1 THEN
  FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
   IF item->>'disposition'='accepted' AND NOT EXISTS(
    SELECT FROM public.ediel_ack_transaction_results a JOIN gridex_utilts_binding.contracts old ON old.series_id=a.persisted_series_id
    WHERE a.source_message_id=p_source_message_id AND a.company_id=p_company_id AND a.environment=p_environment
    AND a.source_transaction_id=item->>'transactionId' AND a.disposition='accepted' AND a.persistence_status='persisted'
    AND old.contract_version=1 AND old.company_id=p_company_id AND old.environment=p_environment) THEN
    RAISE EXCEPTION 'utilts_legacy_retry_contract_unavailable' USING ERRCODE='P0U01'; END IF;
  END LOOP;
  SELECT jsonb_agg(gridex_utilts_binding.legacy_retry_item_v1(t) ORDER BY ordinal) INTO legacy_transactions
   FROM jsonb_array_elements(p_transactions) WITH ORDINALITY x(t,ordinal);
  p_transactions:=legacy_transactions;
 END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_transactions) t WHERE t#>'{consumptionContract,version}' IS DISTINCT FROM to_jsonb(receipt.contract_version) AND NOT (receipt.contract_version=2 AND coalesce(gridex_utilts_binding.valid_rejected_item_v3(t),false))) THEN
  RAISE EXCEPTION 'utilts_consumption_version_conflict' USING ERRCODE='P0U01'; END IF;
 -- Acquire all locks before insertion, in stable order (including the private
 -- insertion core's logical-series lock) to avoid opposite-order batch deadlocks.
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) ORDER BY value->>'transactionId' LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||'|'||p_environment||'|'||p_source_message_id::text||'|'||(item->>'transactionId'),0));
 END LOOP;
 FOR identity IN SELECT DISTINCT concat_ws('|',p_company_id::text,p_environment,coalesce(t->>'seriesKind','actual'),p_message_code,coalesce(t->>'externalMeteringPointId',''),coalesce(t->>'gridAreaId',''),coalesce(t->>'periodStart',''),coalesce(t->>'periodEnd',''),coalesce(t->>'resolution','UNKNOWN'),coalesce(t->>'productId','')) FROM jsonb_array_elements(p_transactions) t ORDER BY 1 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(identity,0));
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  c:=item->'consumptionContract';
  IF NOT coalesce(CASE WHEN c->'version'='3'::jsonb THEN gridex_utilts_binding.valid_rejected_item_v3(item) ELSE gridex_utilts_binding.validate_contract_v1(c) END,false) OR c->>'companyId' IS DISTINCT FROM p_company_id::text OR c->>'environment' IS DISTINCT FROM p_environment
   OR c->>'messageCode' IS DISTINCT FROM p_message_code OR c->>'transactionId' IS DISTINCT FROM item->>'transactionId' OR c->>'seriesKind' IS DISTINCT FROM item->>'seriesKind' THEN
   RAISE EXCEPTION 'utilts_consumption_contract_invalid' USING ERRCODE='P0U01'; END IF;
 END LOOP;
 results:=gridex_utilts_binding.persist_series_v1(p_company_id,p_environment,p_source_message_id,p_message_code,p_transactions);
 FOR r IN SELECT value FROM jsonb_array_elements(results) LOOP
  SELECT value INTO STRICT item FROM jsonb_array_elements(p_transactions) WHERE value->>'transactionId'=r->>'transactionId';
  c:=item->'consumptionContract';
  IF r->>'persistenceStatus'='persisted' THEN
   v_series_id:=(r->>'seriesId')::uuid;
   SELECT * INTO series FROM public.meter_reading_series WHERE id=v_series_id AND company_id=p_company_id FOR SHARE;
   IF NOT FOUND OR series.message_code IS DISTINCT FROM p_message_code OR series.source_transaction_reference IS DISTINCT FROM item->>'transactionId'
    OR jsonb_typeof(series.raw_transaction) IS DISTINCT FROM 'object' OR series.immutable_hash IS DISTINCT FROM encode(digest(convert_to(series.raw_transaction::text,'UTF8'),'sha256'),'hex')
    OR series.raw_transaction IS DISTINCT FROM item THEN RAISE EXCEPTION 'utilts_consumption_raw_conflict' USING ERRCODE='P0U01'; END IF;
   SELECT * INTO origin FROM gridex_utilts_binding.receipts WHERE source_message_id=series.source_ediel_message_id;
   IF NOT FOUND OR origin.company_id<>p_company_id OR origin.environment<>p_environment OR origin.message_code<>p_message_code THEN RAISE EXCEPTION 'utilts_consumption_origin_conflict' USING ERRCODE='P0U01'; END IF;
   SELECT * INTO stored FROM gridex_utilts_binding.contracts WHERE contracts.series_id=v_series_id;
   IF NOT FOUND THEN
    IF coalesce((r->>'idempotentReplay')::boolean,true) THEN RAISE EXCEPTION 'utilts_historical_contract_unavailable' USING ERRCODE='P0U01'; END IF;
    INSERT INTO gridex_utilts_binding.contracts(series_id,company_id,environment,source_message_id,transaction_id,contract_version,contract,contract_hash)
     VALUES(v_series_id,p_company_id,p_environment,p_source_message_id,item->>'transactionId',receipt.contract_version,c,encode(digest(convert_to(c::text,'UTF8'),'sha256'),'hex')) RETURNING * INTO stored;
   END IF;
   contract_hash:=encode(digest(convert_to(stored.contract::text,'UTF8'),'sha256'),'hex');
   IF stored.company_id<>p_company_id OR stored.environment<>p_environment OR stored.transaction_id<>item->>'transactionId' OR stored.contract_version IS DISTINCT FROM receipt.contract_version OR stored.contract->'version' IS DISTINCT FROM to_jsonb(stored.contract_version)
    OR NOT coalesce(gridex_utilts_binding.validate_contract_v1(stored.contract),false) OR stored.contract_hash IS DISTINCT FROM contract_hash OR stored.contract IS DISTINCT FROM c THEN
    RAISE EXCEPTION 'utilts_consumption_contract_conflict' USING ERRCODE='P0U01'; END IF;
   r:=r||jsonb_build_object('contractVersion',stored.contract_version,'contractHash',stored.contract_hash,'consumptionContract',stored.contract);
  END IF;
  answer:=answer||jsonb_build_array(r||jsonb_build_object('sourceBinding',jsonb_build_object('sourceMessageId',receipt.source_message_id,'rawHash',receipt.raw_hash,'boundAt',receipt.bound_at)));
 END LOOP;
 RETURN answer;
END $old$;
 new_body:=$new$
DECLARE
 source public.ediel_messages%rowtype; receipt gridex_utilts_binding.receipts%rowtype;
 stored gridex_utilts_binding.contracts%rowtype; series public.meter_reading_series%rowtype;
 tokens jsonb; membership jsonb; expected jsonb; raw_hash text; item jsonb; c jsonb; r jsonb; results jsonb; answer jsonb:='[]';
 v_series_id uuid; identity text; contract_hash text; origin gridex_utilts_binding.receipts%rowtype;
 decimal_mark text; legacy_transactions jsonb;
 area_identity jsonb; enriched jsonb:='[]'; historical boolean;
 own_start integer; own_end integer; sequence_start integer; sequence_end integer; sequence_count integer;
BEGIN
 IF p_company_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test','production') OR p_message_code IS NULL OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_transactions)=0 THEN
  RAISE EXCEPTION 'utilts_consumption_input_invalid' USING ERRCODE='P0U01';
 END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id FOR UPDATE;
 IF NOT FOUND OR source.company_id IS DISTINCT FROM p_company_id OR source.environment IS DISTINCT FROM p_environment OR source.direction<>'inbound' OR source.message_family<>'UTILTS' OR source.message_code IS DISTINCT FROM p_message_code
 OR p_raw_payload IS NULL OR source.raw_payload IS DISTINCT FROM p_raw_payload THEN RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01'; END IF;
 raw_hash:=encode(digest(convert_to(source.raw_payload,'UTF8'),'sha256'),'hex');
 decimal_mark:=CASE WHEN left(source.raw_payload,3)='UNA' THEN substring(source.raw_payload,6,1) ELSE '.' END;
 tokens:=gridex_utilts_binding.wire_tokens_v1(source.raw_payload);
 IF tokens IS NULL THEN RAISE EXCEPTION 'utilts_physical_membership_unavailable' USING ERRCODE='P0U01'; END IF;
 -- This owner deliberately does not reinterpret multiple physical messages.
 IF (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH')<>1
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='UTILTS')
 OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM')<>1
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'=p_message_code) THEN
  RAISE EXCEPTION 'utilts_physical_membership_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT coalesce(jsonb_agg(coalesce(nullif(t#>>'{elements,2,0}',''),'transaction-'||ordinal::text) ORDER BY ordinal),'["transaction-1"]') INTO membership
 FROM (SELECT t,row_number() OVER(ORDER BY (t->>'index')::integer) ordinal FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE') physical;
 SELECT jsonb_agg(t->'transactionId' ORDER BY ordinal) INTO expected FROM jsonb_array_elements(p_transactions) WITH ORDINALITY x(t,ordinal);
 IF membership IS DISTINCT FROM expected OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(membership))<>jsonb_array_length(membership) THEN
  RAISE EXCEPTION 'utilts_physical_membership_conflict' USING ERRCODE='P0U01'; END IF;
 -- An invalid physical IDE remains a member so its negative guide outcome can
 -- be bound to this source. It must never create accepted consumption authority.
 IF EXISTS(SELECT FROM jsonb_array_elements(p_transactions) x(item)
  JOIN jsonb_array_elements(tokens) t ON t->>'tag'='IDE' AND t#>>'{elements,2,0}'=x.item->>'transactionId'
  WHERE x.item->>'disposition'='accepted' AND t#>>'{elements,1,0}' IS DISTINCT FROM '24') THEN
  RAISE EXCEPTION 'utilts_consumption_identity_unsupported' USING ERRCODE='P0U01'; END IF;
 -- L359 is a source-only area domain. Metadata is derived from this immutable
 -- physical IDE, never from a match, DTO product flag or neighbouring IDE.
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  IF p_message_code='S01' AND item->>'disposition'='accepted' THEN
   area_identity:=gridex_utilts_binding.s01_l359_area_identity_v1(tokens,item->>'transactionId');
   IF area_identity IS NOT NULL THEN
    PERFORM gridex_utilts_binding.require_s01_l359_basis_v1(p_company_id,p_source_message_id);
    IF NOT coalesce(gridex_utilts_binding.s01_l359_item_matches_v1(tokens,item),false) THEN
     RAISE EXCEPTION 'utilts_s01_area_identity_conflict' USING ERRCODE='P0U01'; END IF;
    item:=jsonb_set(item,'{timeSeriesProduct}',area_identity->'timeSeriesProduct');
   ELSE
    -- A new point-S01 cannot use the point guard as national permission. Only
    -- an exact already committed historical interpretation may be replayed.
    SELECT EXISTS(SELECT FROM gridex_utilts_binding.receipts h
     JOIN public.ediel_ack_transaction_results a ON a.source_message_id=h.source_message_id
     JOIN public.meter_reading_series s ON s.id=a.persisted_series_id
     JOIN gridex_utilts_binding.contracts k ON k.series_id=s.id
     WHERE h.source_message_id=p_source_message_id AND h.company_id=p_company_id AND h.environment=p_environment
      AND h.raw_hash=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') AND h.source_context=gridex_utilts_binding.source_context_v1(source)
      AND a.company_id=p_company_id AND a.environment=p_environment AND a.source_transaction_id=item->>'transactionId'
      AND a.disposition='accepted' AND a.persistence_status='persisted' AND a.planned_response_type='positive_aperak'
      AND s.company_id=p_company_id AND s.raw_transaction=item
      AND s.immutable_hash=encode(sha256(convert_to(item::text,'UTF8')),'hex')
      AND k.company_id=p_company_id AND k.environment=p_environment AND k.contract=item->'consumptionContract'
      AND k.contract_hash=encode(sha256(convert_to(k.contract::text,'UTF8')),'hex')) INTO historical;
    IF NOT historical THEN RAISE EXCEPTION 'utilts_consumption_identity_unsupported' USING ERRCODE='P0U01'; END IF;
   END IF;
  END IF;
  enriched:=enriched||jsonb_build_array(item);
 END LOOP;
 p_transactions:=enriched;
 -- Namespace validation precedes receipt/ACK/series writes, independently of
 -- application comparison exemptions and mutable plain-ID matches.
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  c:=item->'consumptionContract';
  IF NOT coalesce(CASE WHEN c->'version'='3'::jsonb THEN gridex_utilts_binding.valid_rejected_item_v3(item) ELSE gridex_utilts_binding.validate_contract_v1(c) END,false) THEN
   RAISE EXCEPTION 'utilts_consumption_contract_invalid' USING ERRCODE='P0U01'; END IF;
  IF c->'version'='2'::jsonb AND NOT coalesce(gridex_utilts_binding.validate_decimal_source_v2(tokens,item,decimal_mark),false) THEN
   RAISE EXCEPTION 'utilts_consumption_decimal_source_conflict' USING ERRCODE='P0U01'; END IF;
  IF item->>'disposition'='accepted' AND (p_message_code IN ('E30','E66','S07','E72','S02') OR jsonb_array_length(c->'observations')>0
   OR (p_message_code IN ('S01','E73') AND NOT gridex_utilts_binding.unowned_regulating_object_v1(tokens,item->>'transactionId')
    AND NOT (p_message_code='S01' AND coalesce(gridex_utilts_binding.s01_l359_item_matches_v1(tokens,item),false)))) THEN
   identity:=gridex_utilts_binding.supported_point_v1(tokens,item->>'transactionId');
   IF identity IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(c->'observations') o WHERE o->>'externalPoint' IS DISTINCT FROM identity) THEN
    RAISE EXCEPTION 'utilts_consumption_identity_unsupported' USING ERRCODE='P0U01'; END IF;
  END IF;
  IF item->>'disposition'='accepted' AND p_message_code='S02' THEN
   SELECT (t->>'index')::integer INTO STRICT own_start FROM jsonb_array_elements(tokens) t
    WHERE t->>'tag'='IDE' AND t#>>'{elements,2,0}'=item->>'transactionId';
   SELECT min((t->>'index')::integer) INTO own_end FROM jsonb_array_elements(tokens) t
    WHERE (t->>'index')::integer>own_start AND t->>'tag' IN ('IDE','UNT');
   sequence_count:=0;
   FOR sequence_start IN SELECT (t->>'index')::integer FROM jsonb_array_elements(tokens) t
    WHERE t->>'tag'='SEQ' AND (t->>'index')::integer>own_start AND (t->>'index')::integer<own_end ORDER BY 1 LOOP
    sequence_count:=sequence_count+1;
    SELECT coalesce(min((t->>'index')::integer),own_end) INTO sequence_end FROM jsonb_array_elements(tokens) t
     WHERE (t->>'index')::integer>sequence_start AND (t->>'index')::integer<own_end AND t->>'tag'='SEQ';
    IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='QTY'
     AND (t->>'index')::integer>sequence_start AND (t->>'index')::integer<sequence_end
     AND t#>>'{elements,1,0}'='135' AND nullif(btrim(t#>>'{elements,1,1}'),'') IS NOT NULL) THEN
     RAISE EXCEPTION 'utilts_s02_quantity_required' USING ERRCODE='P0U01'; END IF;
   END LOOP;
   IF sequence_count=0 THEN RAISE EXCEPTION 'utilts_s02_quantity_required' USING ERRCODE='P0U01'; END IF;
  END IF;
 END LOOP;
 SELECT * INTO receipt FROM gridex_utilts_binding.receipts WHERE source_message_id=p_source_message_id;
 IF NOT FOUND THEN
  IF EXISTS(SELECT FROM jsonb_array_elements(p_transactions) t WHERE t#>'{consumptionContract,version}' IS DISTINCT FROM '2'::jsonb AND NOT coalesce(gridex_utilts_binding.valid_rejected_item_v3(t),false)) THEN
   RAISE EXCEPTION 'utilts_new_consumption_requires_v2' USING ERRCODE='P0U01'; END IF;
  IF EXISTS(SELECT FROM public.ediel_ack_transaction_results WHERE source_message_id=p_source_message_id)
  OR EXISTS(SELECT FROM public.meter_reading_series WHERE source_ediel_message_id=p_source_message_id) THEN
   RAISE EXCEPTION 'utilts_historical_binding_unavailable' USING ERRCODE='P0U01'; END IF;
  INSERT INTO gridex_utilts_binding.receipts(source_message_id,company_id,environment,message_code,raw_hash,source_context,membership,contract_version)
   VALUES(p_source_message_id,p_company_id,p_environment,p_message_code,raw_hash,gridex_utilts_binding.source_context_v1(source),membership,2) RETURNING * INTO receipt;
 ELSIF receipt.company_id IS DISTINCT FROM p_company_id OR receipt.environment IS DISTINCT FROM p_environment
 OR receipt.message_code IS DISTINCT FROM p_message_code OR receipt.contract_version NOT IN (1,2) OR receipt.raw_hash IS DISTINCT FROM raw_hash OR receipt.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(source) OR receipt.membership IS DISTINCT FROM membership THEN
  RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01';
 END IF;
 -- A retained V1 is solely an authentic retry of this exact source/hash.
 -- New accepted effects require V2; an old held/negative receipt cannot mint V1.
 IF receipt.contract_version=1 THEN
  FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
   IF item->>'disposition'='accepted' AND NOT EXISTS(
    SELECT FROM public.ediel_ack_transaction_results a JOIN gridex_utilts_binding.contracts old ON old.series_id=a.persisted_series_id
    WHERE a.source_message_id=p_source_message_id AND a.company_id=p_company_id AND a.environment=p_environment
    AND a.source_transaction_id=item->>'transactionId' AND a.disposition='accepted' AND a.persistence_status='persisted'
    AND old.contract_version=1 AND old.company_id=p_company_id AND old.environment=p_environment) THEN
    RAISE EXCEPTION 'utilts_legacy_retry_contract_unavailable' USING ERRCODE='P0U01'; END IF;
  END LOOP;
  SELECT jsonb_agg(gridex_utilts_binding.legacy_retry_item_v1(t) ORDER BY ordinal) INTO legacy_transactions
   FROM jsonb_array_elements(p_transactions) WITH ORDINALITY x(t,ordinal);
  p_transactions:=legacy_transactions;
 END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_transactions) t WHERE t#>'{consumptionContract,version}' IS DISTINCT FROM to_jsonb(receipt.contract_version) AND NOT (receipt.contract_version=2 AND coalesce(gridex_utilts_binding.valid_rejected_item_v3(t),false))) THEN
  RAISE EXCEPTION 'utilts_consumption_version_conflict' USING ERRCODE='P0U01'; END IF;
 -- Acquire all locks before insertion, in stable order (including the private
 -- insertion core's logical-series lock) to avoid opposite-order batch deadlocks.
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) ORDER BY value->>'transactionId' LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||'|'||p_environment||'|'||p_source_message_id::text||'|'||(item->>'transactionId'),0));
 END LOOP;
 FOR identity IN SELECT DISTINCT concat_ws('|',p_company_id::text,p_environment,coalesce(t->>'seriesKind','actual'),p_message_code,coalesce(t->>'externalMeteringPointId',''),coalesce(t->>'gridAreaId',''),coalesce(t->>'periodStart',''),coalesce(t->>'periodEnd',''),coalesce(t->>'resolution','UNKNOWN'),coalesce(t->>'productId','')) FROM jsonb_array_elements(p_transactions) t ORDER BY 1 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(identity,0));
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  c:=item->'consumptionContract';
  IF NOT coalesce(CASE WHEN c->'version'='3'::jsonb THEN gridex_utilts_binding.valid_rejected_item_v3(item) ELSE gridex_utilts_binding.validate_contract_v1(c) END,false) OR c->>'companyId' IS DISTINCT FROM p_company_id::text OR c->>'environment' IS DISTINCT FROM p_environment
   OR c->>'messageCode' IS DISTINCT FROM p_message_code OR c->>'transactionId' IS DISTINCT FROM item->>'transactionId' OR c->>'seriesKind' IS DISTINCT FROM item->>'seriesKind' THEN
   RAISE EXCEPTION 'utilts_consumption_contract_invalid' USING ERRCODE='P0U01'; END IF;
 END LOOP;
 -- The legacy cohort uses generic LIN, not the five-part product. Until a
 -- general owner exists, never merge L359 into an unqualified historical area
 -- cohort. The same logical-series locks have already been acquired above.
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  IF p_message_code='S01' AND item->>'disposition'='accepted'
   AND gridex_utilts_binding.s01_l359_area_identity_v1(tokens,item->>'transactionId') IS NOT NULL
   AND EXISTS(SELECT FROM public.meter_reading_series s JOIN public.ediel_messages m ON m.id=s.source_ediel_message_id
    WHERE s.company_id=p_company_id AND m.company_id=p_company_id AND m.environment=p_environment
     AND s.series_kind='aggregate' AND s.message_code='S01' AND coalesce(s.external_metering_point_id,'')=''
     AND coalesce(s.grid_area_id,'')=coalesce(item->>'gridAreaId','')
     AND s.period_start IS NOT DISTINCT FROM (item->>'periodStart')::timestamptz
     AND s.period_end IS NOT DISTINCT FROM (item->>'periodEnd')::timestamptz
     AND s.resolution=coalesce(item->>'resolution','UNKNOWN') AND coalesce(s.product_id,'')=coalesce(item->>'productId','')
     AND (NOT coalesce(gridex_utilts_binding.s01_l359_item_matches_v1(gridex_utilts_binding.wire_tokens_v1(m.raw_payload),s.raw_transaction),false)
      OR s.time_series_product IS DISTINCT FROM item->'timeSeriesProduct'
      OR s.metering_point_id IS NOT NULL)) THEN
   RAISE EXCEPTION 'utilts_s01_area_cohort_unavailable' USING ERRCODE='P0U01';
  END IF;
 END LOOP;
 results:=gridex_utilts_binding.persist_series_v1(p_company_id,p_environment,p_source_message_id,p_message_code,p_transactions);
 FOR r IN SELECT value FROM jsonb_array_elements(results) LOOP
  SELECT value INTO STRICT item FROM jsonb_array_elements(p_transactions) WHERE value->>'transactionId'=r->>'transactionId';
  c:=item->'consumptionContract';
  IF r->>'persistenceStatus'='persisted' THEN
   v_series_id:=(r->>'seriesId')::uuid;
   SELECT * INTO series FROM public.meter_reading_series WHERE id=v_series_id AND company_id=p_company_id FOR SHARE;
   IF NOT FOUND OR series.message_code IS DISTINCT FROM p_message_code OR series.source_transaction_reference IS DISTINCT FROM item->>'transactionId'
    OR jsonb_typeof(series.raw_transaction) IS DISTINCT FROM 'object' OR series.immutable_hash IS DISTINCT FROM encode(digest(convert_to(series.raw_transaction::text,'UTF8'),'sha256'),'hex')
    OR series.raw_transaction IS DISTINCT FROM item THEN RAISE EXCEPTION 'utilts_consumption_raw_conflict' USING ERRCODE='P0U01'; END IF;
   SELECT * INTO origin FROM gridex_utilts_binding.receipts WHERE source_message_id=series.source_ediel_message_id;
   IF NOT FOUND OR origin.company_id<>p_company_id OR origin.environment<>p_environment OR origin.message_code<>p_message_code THEN RAISE EXCEPTION 'utilts_consumption_origin_conflict' USING ERRCODE='P0U01'; END IF;
   SELECT * INTO stored FROM gridex_utilts_binding.contracts WHERE contracts.series_id=v_series_id;
   IF NOT FOUND THEN
    IF coalesce((r->>'idempotentReplay')::boolean,true) THEN RAISE EXCEPTION 'utilts_historical_contract_unavailable' USING ERRCODE='P0U01'; END IF;
    INSERT INTO gridex_utilts_binding.contracts(series_id,company_id,environment,source_message_id,transaction_id,contract_version,contract,contract_hash)
     VALUES(v_series_id,p_company_id,p_environment,p_source_message_id,item->>'transactionId',receipt.contract_version,c,encode(digest(convert_to(c::text,'UTF8'),'sha256'),'hex')) RETURNING * INTO stored;
   END IF;
   contract_hash:=encode(digest(convert_to(stored.contract::text,'UTF8'),'sha256'),'hex');
   IF stored.company_id<>p_company_id OR stored.environment<>p_environment OR stored.transaction_id<>item->>'transactionId' OR stored.contract_version IS DISTINCT FROM receipt.contract_version OR stored.contract->'version' IS DISTINCT FROM to_jsonb(stored.contract_version)
    OR NOT coalesce(gridex_utilts_binding.validate_contract_v1(stored.contract),false) OR stored.contract_hash IS DISTINCT FROM contract_hash OR stored.contract IS DISTINCT FROM c THEN
    RAISE EXCEPTION 'utilts_consumption_contract_conflict' USING ERRCODE='P0U01'; END IF;
   r:=r||jsonb_build_object('contractVersion',stored.contract_version,'contractHash',stored.contract_hash,'consumptionContract',stored.contract);
  END IF;
  answer:=answer||jsonb_build_array(r||jsonb_build_object('sourceBinding',jsonb_build_object('sourceMessageId',receipt.source_message_id,'rawHash',receipt.raw_hash,'boundAt',receipt.bound_at)));
 END LOOP;
 RETURN answer;
END $new$;
 SELECT pg_get_functiondef('gridex_utilts_binding.persist_consumption_before_precision_v1(uuid,text,uuid,text,text,jsonb)'::regprocedure) INTO ddl;
 IF position(old_body IN ddl)=0 THEN RAISE EXCEPTION 'utilts_s01_area_patch_anchor_unqualified';END IF;
 EXECUTE replace(ddl,old_body,new_body);
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='gridex_utilts_binding.persist_consumption_before_precision_v1(uuid,text,uuid,text,text,jsonb)'::regprocedure)<>'347be38f343292dc1993b506b9d30fc359e8688f5a9103cc411f524538c72f4a' THEN RAISE EXCEPTION 'utilts_s01_area_patch_postcondition_failed';END IF;
END $patch$;

DO $patch$
DECLARE old_body text; new_body text; ddl text;
BEGIN
 old_body:=$old$
DECLARE v_source public.ediel_messages%rowtype; v_receipt gridex_utilts_binding.receipts%rowtype;
 v_ack public.ediel_ack_transaction_results%rowtype; v_series public.meter_reading_series%rowtype;
 v_contract gridex_utilts_binding.contracts%rowtype; v_point text;
BEGIN
 SELECT s.* INTO v_source FROM public.ediel_messages s WHERE s.id=p_source AND s.company_id=p_company FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_source_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT r.* INTO v_receipt FROM gridex_utilts_binding.receipts r WHERE r.source_message_id=p_source AND r.company_id=p_company;
 IF NOT FOUND OR v_receipt.environment IS DISTINCT FROM v_source.environment OR v_receipt.message_code IS DISTINCT FROM v_source.message_code
 OR v_receipt.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(v_source)
 OR v_receipt.raw_hash IS DISTINCT FROM encode(digest(convert_to(v_source.raw_payload,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'utilts_consumption_source_binding_invalid' USING ERRCODE='P0U01'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements_text(v_receipt.membership) m(transaction_id) WHERE NOT EXISTS(
  SELECT FROM public.ediel_ack_transaction_results a WHERE a.company_id=p_company AND a.environment=v_source.environment AND a.source_message_id=p_source AND a.source_transaction_id=m.transaction_id))
 OR (SELECT count(*) FROM public.ediel_ack_transaction_results a WHERE a.source_message_id=p_source)<>jsonb_array_length(v_receipt.membership) THEN
  RAISE EXCEPTION 'utilts_consumption_membership_incomplete' USING ERRCODE='P0U01'; END IF;
 SELECT a.* INTO v_ack FROM public.ediel_ack_transaction_results a WHERE a.company_id=p_company AND a.environment=v_source.environment
 AND a.source_message_id=p_source AND a.source_transaction_id=p_transaction FOR SHARE;
 IF NOT FOUND OR v_ack.disposition IS DISTINCT FROM 'accepted' OR v_ack.persistence_status IS DISTINCT FROM 'persisted'
 OR v_ack.planned_response_type IS DISTINCT FROM 'positive_aperak' THEN RAISE EXCEPTION 'utilts_consumption_not_accepted' USING ERRCODE='P0U01'; END IF;
 SELECT s.* INTO v_series FROM public.meter_reading_series s WHERE s.id=v_ack.persisted_series_id AND s.company_id=p_company FOR SHARE;
 IF NOT FOUND OR v_series.immutable_hash IS DISTINCT FROM encode(digest(convert_to(v_series.raw_transaction::text,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'utilts_consumption_raw_conflict' USING ERRCODE='P0U01'; END IF;
 SELECT c.* INTO v_contract FROM gridex_utilts_binding.contracts c WHERE c.series_id=v_series.id AND c.company_id=p_company;
 IF NOT FOUND OR v_contract.contract_version NOT IN (1,2) OR v_contract.contract_version IS DISTINCT FROM v_receipt.contract_version
 OR v_contract.contract->'version' IS DISTINCT FROM to_jsonb(v_contract.contract_version) OR v_contract.environment IS DISTINCT FROM v_source.environment OR v_contract.transaction_id IS DISTINCT FROM p_transaction
 OR v_contract.contract->>'companyId' IS DISTINCT FROM p_company::text OR v_contract.contract->>'environment' IS DISTINCT FROM v_source.environment
 OR v_contract.contract->>'messageCode' IS DISTINCT FROM v_source.message_code OR v_contract.contract->>'transactionId' IS DISTINCT FROM p_transaction
 OR v_contract.contract_hash IS DISTINCT FROM encode(digest(convert_to(v_contract.contract::text,'UTF8'),'sha256'),'hex')
 OR v_contract.contract IS DISTINCT FROM v_series.raw_transaction->'consumptionContract'
 OR NOT coalesce(gridex_utilts_binding.validate_contract_v1(v_contract.contract),false) THEN
  RAISE EXCEPTION 'utilts_consumption_contract_conflict' USING ERRCODE='P0U01'; END IF;
 -- Pre-forward receipts are not a namespace approval either. All sinks use
 -- this check, including direct calls with an already committed contract.
 v_point:=gridex_utilts_binding.supported_point_v1(gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload),p_transaction);
 IF v_point IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(v_contract.contract->'observations') o WHERE o->>'externalPoint' IS DISTINCT FROM v_point) THEN
  RAISE EXCEPTION 'utilts_consumption_identity_unsupported' USING ERRCODE='P0U01'; END IF;
 IF v_contract.contract_version=2 AND NOT coalesce(gridex_utilts_binding.validate_decimal_source_v2(gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload),v_series.raw_transaction,
  CASE WHEN left(v_source.raw_payload,3)='UNA' THEN substring(v_source.raw_payload,6,1) ELSE '.' END),false) THEN
  RAISE EXCEPTION 'utilts_consumption_decimal_source_conflict' USING ERRCODE='P0U01'; END IF;
 RETURN v_contract.contract;
END $old$;
 new_body:=$new$
DECLARE v_source public.ediel_messages%rowtype; v_receipt gridex_utilts_binding.receipts%rowtype;
 v_ack public.ediel_ack_transaction_results%rowtype; v_series public.meter_reading_series%rowtype;
 v_contract gridex_utilts_binding.contracts%rowtype; v_point text; area_identity jsonb;
BEGIN
 SELECT s.* INTO v_source FROM public.ediel_messages s WHERE s.id=p_source AND s.company_id=p_company FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_source_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT r.* INTO v_receipt FROM gridex_utilts_binding.receipts r WHERE r.source_message_id=p_source AND r.company_id=p_company;
 IF NOT FOUND OR v_receipt.environment IS DISTINCT FROM v_source.environment OR v_receipt.message_code IS DISTINCT FROM v_source.message_code
 OR v_receipt.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(v_source)
 OR v_receipt.raw_hash IS DISTINCT FROM encode(digest(convert_to(v_source.raw_payload,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'utilts_consumption_source_binding_invalid' USING ERRCODE='P0U01'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements_text(v_receipt.membership) m(transaction_id) WHERE NOT EXISTS(
  SELECT FROM public.ediel_ack_transaction_results a WHERE a.company_id=p_company AND a.environment=v_source.environment AND a.source_message_id=p_source AND a.source_transaction_id=m.transaction_id))
 OR (SELECT count(*) FROM public.ediel_ack_transaction_results a WHERE a.source_message_id=p_source)<>jsonb_array_length(v_receipt.membership) THEN
  RAISE EXCEPTION 'utilts_consumption_membership_incomplete' USING ERRCODE='P0U01'; END IF;
 SELECT a.* INTO v_ack FROM public.ediel_ack_transaction_results a WHERE a.company_id=p_company AND a.environment=v_source.environment
 AND a.source_message_id=p_source AND a.source_transaction_id=p_transaction FOR SHARE;
 IF NOT FOUND OR v_ack.disposition IS DISTINCT FROM 'accepted' OR v_ack.persistence_status IS DISTINCT FROM 'persisted'
 OR v_ack.planned_response_type IS DISTINCT FROM 'positive_aperak' THEN RAISE EXCEPTION 'utilts_consumption_not_accepted' USING ERRCODE='P0U01'; END IF;
 SELECT s.* INTO v_series FROM public.meter_reading_series s WHERE s.id=v_ack.persisted_series_id AND s.company_id=p_company FOR SHARE;
 IF NOT FOUND OR v_series.immutable_hash IS DISTINCT FROM encode(digest(convert_to(v_series.raw_transaction::text,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'utilts_consumption_raw_conflict' USING ERRCODE='P0U01'; END IF;
 SELECT c.* INTO v_contract FROM gridex_utilts_binding.contracts c WHERE c.series_id=v_series.id AND c.company_id=p_company;
 IF NOT FOUND OR v_contract.contract_version NOT IN (1,2) OR v_contract.contract_version IS DISTINCT FROM v_receipt.contract_version
 OR v_contract.contract->'version' IS DISTINCT FROM to_jsonb(v_contract.contract_version) OR v_contract.environment IS DISTINCT FROM v_source.environment OR v_contract.transaction_id IS DISTINCT FROM p_transaction
 OR v_contract.contract->>'companyId' IS DISTINCT FROM p_company::text OR v_contract.contract->>'environment' IS DISTINCT FROM v_source.environment
 OR v_contract.contract->>'messageCode' IS DISTINCT FROM v_source.message_code OR v_contract.contract->>'transactionId' IS DISTINCT FROM p_transaction
 OR v_contract.contract_hash IS DISTINCT FROM encode(digest(convert_to(v_contract.contract::text,'UTF8'),'sha256'),'hex')
 OR v_contract.contract IS DISTINCT FROM v_series.raw_transaction->'consumptionContract'
 OR NOT coalesce(gridex_utilts_binding.validate_contract_v1(v_contract.contract),false) THEN
  RAISE EXCEPTION 'utilts_consumption_contract_conflict' USING ERRCODE='P0U01'; END IF;
 -- Pre-forward receipts are not a namespace approval either. All sinks use
 -- this check, including direct calls with an already committed contract.
 area_identity:=CASE WHEN v_source.message_code='S01' THEN gridex_utilts_binding.s01_l359_area_identity_v1(gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload),p_transaction) END;
 IF area_identity IS NOT NULL THEN
  PERFORM gridex_utilts_binding.require_s01_l359_basis_v1(p_company,p_source);
  IF NOT coalesce(gridex_utilts_binding.s01_l359_item_matches_v1(gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload),v_series.raw_transaction),false)
   OR v_series.time_series_product IS DISTINCT FROM area_identity->'timeSeriesProduct'
   OR v_series.raw_transaction->'timeSeriesProduct' IS DISTINCT FROM area_identity->'timeSeriesProduct'
   OR v_series.metering_point_id IS NOT NULL OR v_series.external_metering_point_id IS NOT NULL
   OR v_series.grid_area_id IS DISTINCT FROM area_identity->>'gridAreaId'
   OR v_series.series_kind IS DISTINCT FROM 'aggregate' OR v_series.product_id IS DISTINCT FROM '8716867000030'
   OR v_series.resolution IS DISTINCT FROM '1' OR v_series.unit IS DISTINCT FROM 'KWH'
   OR v_series.period_start IS DISTINCT FROM (area_identity->>'periodStart')::timestamptz
   OR v_series.period_end IS DISTINCT FROM (area_identity->>'periodEnd')::timestamptz
   OR v_series.latest_update_date IS DISTINCT FROM (area_identity->>'latestUpdateDate')::timestamptz
   OR v_series.registration_date IS NOT NULL THEN
   RAISE EXCEPTION 'utilts_s01_area_identity_conflict' USING ERRCODE='P0U01'; END IF;
 ELSE
 v_point:=gridex_utilts_binding.supported_point_v1(gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload),p_transaction);
 IF v_point IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(v_contract.contract->'observations') o WHERE o->>'externalPoint' IS DISTINCT FROM v_point) THEN
  RAISE EXCEPTION 'utilts_consumption_identity_unsupported' USING ERRCODE='P0U01'; END IF;
 END IF;
 IF v_contract.contract_version=2 AND NOT coalesce(gridex_utilts_binding.validate_decimal_source_v2(gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload),v_series.raw_transaction,
  CASE WHEN left(v_source.raw_payload,3)='UNA' THEN substring(v_source.raw_payload,6,1) ELSE '.' END),false) THEN
  RAISE EXCEPTION 'utilts_consumption_decimal_source_conflict' USING ERRCODE='P0U01'; END IF;
 RETURN v_contract.contract;
END $new$;
 SELECT pg_get_functiondef('gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)'::regprocedure) INTO ddl;
 IF position(old_body IN ddl)=0 THEN RAISE EXCEPTION 'utilts_s01_area_patch_anchor_unqualified';END IF;
 EXECUTE replace(ddl,old_body,new_body);
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)'::regprocedure)<>'63fa2bb2786d2ae65604bdab34475a46080cc2463347c6e4bf6cf4d6148d798c' THEN RAISE EXCEPTION 'utilts_s01_area_patch_postcondition_failed';END IF;
END $patch$;
DO $postconditions$
BEGIN
 IF EXISTS(SELECT FROM pg_temp.s01_area_owner_profiles old JOIN pg_proc p ON p.oid=old.oid
  WHERE (p.proowner,p.proacl,p.prosecdef,p.proconfig,p.proargtypes,p.prorettype,p.provolatile)
   IS DISTINCT FROM (old.proowner,old.proacl,old.prosecdef,old.proconfig,old.proargtypes,old.prorettype,old.provolatile)) THEN
  RAISE EXCEPTION 'utilts_s01_area_owner_envelope_changed';END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
  LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE n.nspname='gridex_utilts_binding' AND p.proname IN('s01_l359_area_identity_v1','s01_l359_item_matches_v1','require_s01_l359_basis_v1')
   AND (pg_get_userbyid(p.proowner)<>'postgres' OR a.grantee<>p.proowner)) THEN
  RAISE EXCEPTION 'utilts_s01_area_private_helper_acl_changed';END IF;
END $postconditions$;
