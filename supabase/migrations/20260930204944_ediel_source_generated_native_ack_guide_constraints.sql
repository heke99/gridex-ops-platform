-- Created by actual Supabase CLI2.118.0. Derivative source data is generated
-- from the SAME canonical ACK guide consumer, never a local error-code table.
BEGIN;
CREATE SCHEMA gridex_ediel_ack_guide;
REVOKE ALL ON SCHEMA gridex_ediel_ack_guide FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ediel_ack_guide.editions(source_version text PRIMARY KEY CHECK(source_version~'^[a-f0-9]{64}$'),input_manifest jsonb NOT NULL,projection jsonb NOT NULL,installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ediel_ack_guide.source_bindings(source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,kind text NOT NULL CHECK(kind IN('national','technical','common')),company_id uuid NOT NULL,environment text NOT NULL,payload_sha256 text NOT NULL,source_version text NOT NULL REFERENCES gridex_ediel_ack_guide.editions(source_version),original_basis jsonb NOT NULL,PRIMARY KEY(source_message_id,kind));
ALTER TABLE gridex_ediel_ack_guide.editions ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_ediel_ack_guide.editions FORCE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_ack_guide.source_bindings ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_ediel_ack_guide.source_bindings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_ack_guide.editions,gridex_ediel_ack_guide.source_bindings FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_ediel_ack_guide.editions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_ack_guide.editions FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_ediel_ack_guide.source_bindings FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_ack_guide.source_bindings FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
-- BEGIN CANONICAL ACK GUIDE PROJECTION
INSERT INTO gridex_ediel_ack_guide.editions(source_version,input_manifest,projection)
SELECT value->>'sourceVersion',value->'inputManifest',value->'projection' FROM (SELECT '{"sourceVersion":"ded88fd81c4aedd3c03d9c20fab502339734a9cfbae535bd4a94021f528eb4b4","inputManifest":{"docs/ediel/masterplan-v2/registers/source_manifest.json":"ae5561799f6c81d78a139e4f5f82e74228bb765369fc6876668ae99ac338892d","lib/ediel/core/edifactTokenizer.ts":"cf39d5c9f374ae4b0d5087a269f0f675ac891e8f7ff75a3891944e72d8817f79","lib/ediel/core/una.ts":"800c59c1bed62e014161b6e98cea096c5506046a2cda4a1c770fac655548e7a4","lib/ediel/prodat/prodat26AFieldMatrix.ts":"a96b7dcddb564aad04d3be6ee7aef1117601eccd893b47869a8ddc60b3794382","lib/ediel/prodat/prodatAperakText.ts":"bed3706c44c07dbf19a504f9c9449de566c6f5a2900859cdfda2d5c684e48ae4","lib/ediel/prodat/prodatFailureEvidence.ts":"185330ecaa4783fdc9c50c62a62a2d40310f5a09cc3a53621f2c6e3e490c7b69","lib/ediel/prodat/prodatRegisterFields.ts":"1d171216b8fd8be093a4b6d5e0d9e04cf969468ba342dfcde4771b46fe5df09c","lib/ediel/prodat/prodatRegisterGroups.ts":"142e9e441e6a94708841dec9aaddb9656b091aa04536c00ec358a6b59bcfe291","lib/ediel/rulebook/ackGuidePolicy.ts":"ae04aad84286416cd1813909e07533504d7fa89fcd5a5753cb2b75c1540b52ec","scripts/generate-ediel-native-ack-guide-projection.cjs":"059248767759829cf114c87013cf38f2e967e3be276f08b9f05c47e733dbf463"},"projection":{"constraints":{"version":1,"common":{"documentDate":{"qualifier":"137","format":"203","pattern":"^[0-9]{12}$"},"positiveText":"OK"},"PRODAT":{"technicalProfile":["APERAK","D","96A","UN","E2SE6A"],"allowedErc":["100","40","41","42"],"allowedFunctions":["27","34"],"legalAgency":"SVK","legalQualifier":"160","countryPattern":"^[A-Z]{2}$","missingSuffix":" saknas","missingCustomerPrefix":" saknas, kundid","invalidPrefix":"Felaktigt ","agency":"260","textQualifier":"AAO","textMax":70,"fieldReferenceMax":3,"fieldLabels":{"202":"Meddelandenamn","203":"Meddelandeidentifikation","204":"Meddelandefunktion","205":"Meddelandedatum","206":"Tidszon","207":"Avsändare (Ediel-ID)","208":"Mottagare (Ediel-ID)","209":"Anläggnings-id","210":"Avtal, startdatum","211":"Avtal, slutdatum","212":"Datum för första mätaravläsning","213":"Uppskattad årsenergi","214":"Konstant för mätare","215":"Konstant, gammal mätare","216":"Giltighetsdatum - giltig from","217":"Mätmetod","218":"Antal siffror, mätare","219":"Antal siffror, gammal mätare","220":"Prioritet","222":"Rapporteringsfrekvens","223":"Transaktionstyp (undertyp)","224":"Mätarnummer","225":"Gammalt mätarnummer","226":"Ärendereferens","227":"Kund-id","228":"Namn-elanvändare","229":"Adress-elanvändare","231":"Postnr-elanvändare","232":"Postort-elanvändare","233":"Anläggnings-id","234":"Adress-anläggning","235":"Postnr-anläggning","236":"Postort-anläggning","237":"Land-anläggning","240":"Serie-id","242":"Produktkod","249":"Födelsedatum","250":"Fakturamottagare ID","251":"Namn-fakturamottagare","252":"Adress-fakturamottagare","253":"Postnr-fakturamottgare","254":"Avräkningsmetod (dygns/månads)","258":"Sekvensnummer","259":"Mätare, tidsintervall (räkneverkskod)","260":"Nätområdesid","261":"Referens till avtal/fullmakt","262":"Balansansvarig","301":"Fritext (huvud)","302":"Rapportstartdatum","303":"Fritext (per anläggning)","306":"Installationsstatus","307":"Tariffkod","308":"Leverantörens avtalsnr","310":"Kundstatus","311":"Application Reference","312":"Version","313":"Kvittensbegäran","314":"Sekvensnummer","315":"Avsändarens org.nr","316":"Land-elanvändare","317":"Postort-fakturamottagare","318":"Land-fakturamottagare","319":"Referens till anläggning","320":"Värmevärdesområde","321":"Rapportslutdatum","322":"Tillståndets status","323":"Tillståndets syfte","324":"Orsak till tillståndets upphörande","325":"Tillståndets id","326":"Tillståndets tidstämpel","327":"Tjänsten/rapporteringen upphör","506":"Produkt id (Energiprodukt)","508":"Tidslängd (tidsperiod)","513":"Riktning (Typ av anläggning)"},"applicationTexts":{"100":"Meddelandetyp/funktion är inte implementerad i applikationen","102":"Meddelandehuvudet kunde inte läsas","103":"Dubblett av meddelandet","104":"Liknande meddelande mottaget tidigare","105":"Anläggningen kan inte identifieras","106":"Liknande meddelande mottaget från annan aktör","107":"Aktören är inte knuten till aktuell anläggning","108":"Aktören är redan knuten till aktuell anläggning","109":"En period anges där endast en dag/tidpunkt förväntas","110":"Okänd eller ogiltig avsändare"},"source":{"id":"P","sections":["3.3","3.4","3.5"],"pages":[89,105],"availableBasis":"authenticated_original_page_excerpt"}},"UTILTS":{"technicalProfile":["APERAK","D","04A","UN","E5SE5A"],"allowedErc":["100","41","42"],"allowedDocumentStatuses":["312","313"],"messageFunction":"9","documentIdMax":35,"fixedOffset":["735","+0100","406"],"legalAgencies":["260","9","305"],"svkAgency":"260","svkQualifier":"SVK","agency":"260","textQualifier":"AAO","textMax":512,"fieldReferenceMax":17,"ownDmMax":70,"originalAcwMax":70,"missingText":"MANDATORY FIELD MISSING","invalidTextPattern":"^INCORRECT DATA .+$","source":{"id":"U","sections":["5.3","5.4","5.5"],"pages":[108,119],"availableBasis":"authentic_original"}},"CONTRL":{"technicalProfile":["CONTRL","2","2","UN"],"optionalAssociation":"EDIEL2","allowedActions":["1","4"],"forbiddenSegments":["BGM","DOC","ERC","FTX","RFF","NAD"],"originalUciMax":14,"source":{"id":"T","section":"2.1","availableBasis":"frozen_authenticated_contract"}}},"originalSources":[{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":140},{"id":"T","filename":"260220_Ediel-anvisning-generella_tekniska_regler_version_24-A-6(4).pdf","sha256":"5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951","pages":60},{"id":"U","filename":"260331_Ediel_UTILTS-APERAK_Anvisning_version_25-A-4.pdf","sha256":"0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be","pages":135}]}}'::jsonb value) edition;
-- END CANONICAL ACK GUIDE PROJECTION
CREATE FUNCTION gridex_ediel_ack_guide.bind_source_v1(m public.ediel_messages,p_kind text,p_basis jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b gridex_ediel_ack_guide.source_bindings%rowtype;e gridex_ediel_ack_guide.editions%rowtype;observed timestamptz;c uuid;
BEGIN
 c:=CASE WHEN p_kind IN('technical','common') THEN (p_basis->>'companyId')::uuid ELSE m.company_id END;
 SELECT * INTO b FROM gridex_ediel_ack_guide.source_bindings WHERE source_message_id=m.id AND kind=p_kind FOR SHARE;
 IF FOUND THEN IF b.company_id IS DISTINCT FROM c OR b.environment IS DISTINCT FROM m.environment OR b.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR b.original_basis IS DISTINCT FROM p_basis THEN RAISE EXCEPTION 'ediel_ack_guide_original_basis_changed';END IF;RETURN;END IF;
 IF p_kind IN('technical','common') THEN observed:=(p_basis->>'observedAt')::timestamptz;
 ELSE observed:=(gridex_ediel_inbound_context.require_v1(m.company_id,m.id)->>'observedAt')::timestamptz;END IF;
 SELECT * INTO e FROM gridex_ediel_ack_guide.editions ORDER BY installed_at DESC,source_version LIMIT 1 FOR SHARE;
 IF observed IS NULL OR e.source_version IS NULL OR observed<e.installed_at OR NOT isfinite(observed) THEN RAISE EXCEPTION 'ediel_historical_ack_guide_basis_unavailable';END IF;
 INSERT INTO gridex_ediel_ack_guide.source_bindings VALUES(m.id,p_kind,c,m.environment,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),e.source_version,p_basis);
END $$;
CREATE FUNCTION gridex_ediel_ack_guide.tail_populated_v1(a jsonb,p_after integer) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(a,'[]')) WITH ORDINALITY v(value,n) WHERE n>p_after AND coalesce(value,'')<>'')$$;
CREATE FUNCTION gridex_ediel_ack_guide.date_time_v1(v text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN IF v!~'^[0-9]{12}$' THEN RETURN false;END IF;RETURN to_char(make_timestamp(substr(v,1,4)::int,substr(v,5,2)::int,substr(v,7,2)::int,substr(v,9,2)::int,substr(v,11,2)::int,0),'YYYYMMDDHH24MI')=v;EXCEPTION WHEN OTHERS THEN RETURN false;END $$;
CREATE FUNCTION gridex_ediel_ack_guide.validate_v1(p_raw text,p_source_raw text,p_projection jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(p_raw);original jsonb:=gridex_utilts_binding.wire_tokens_v1(p_source_raw);a jsonb:=gridex_ack_authority.wire_v1(p_raw);s jsonb:=gridex_ack_authority.wire_v1(p_source_raw);cfg jsonb;common jsonb:=p_projection#>'{constraints,common}';is_utilts boolean;first_erc integer;t jsonb;e jsonb;part jsonb;opposite jsonb;group_start integer;group_end integer;g jsonb;erc text;reference text;literal text;label text;dm text[]:='{}';ref_count integer;party_count integer;family text;own_li text;own_object text;source_objects jsonb;matches jsonb;answered text[]:='{}';
BEGIN
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH')<>1 THEN RETURN false;END IF;
 SELECT x#>>'{elements,2,0}' INTO family FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH';
 IF family='CONTRL' THEN
  SELECT jsonb_build_object('type',x#>'{elements,2}') INTO a FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH';
  SELECT a||jsonb_build_object('uciRef',x#>>'{elements,1,0}','uciAction',x#>>'{elements,4,0}') INTO a FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UCI';
 END IF;
 IF family='CONTRL' THEN
  cfg:=p_projection#>'{constraints,CONTRL}';
  IF a#>'{type}'->>0 IS DISTINCT FROM cfg#>>'{technicalProfile,0}' OR a#>'{type}'->>1 IS DISTINCT FROM cfg#>>'{technicalProfile,1}' OR a#>'{type}'->>2 IS DISTINCT FROM cfg#>>'{technicalProfile,2}' OR a#>'{type}'->>3 IS DISTINCT FROM cfg#>>'{technicalProfile,3}' OR (nullif(a#>>'{type,4}','') IS NOT NULL AND a#>>'{type,4}' IS DISTINCT FROM cfg->>'optionalAssociation') OR gridex_ediel_ack_guide.tail_populated_v1(a->'type',5)
   OR EXISTS(SELECT FROM jsonb_array_elements(tokens)x WHERE cfg->'forbiddenSegments' ? (x->>'tag')) OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UCI')<>1 OR nullif(a->>'uciRef','') IS NULL OR length(a->>'uciRef')>(cfg->>'originalUciMax')::int OR NOT coalesce(cfg->'allowedActions' ? (a->>'uciAction'),false) THEN RETURN false;END IF;
  RETURN true; -- Exact source/UCI/endpoint/outcome remain the technical owner.
 END IF;
 IF a IS NULL OR s IS NULL OR original IS NULL OR family<>'APERAK' OR s->>'family' NOT IN('PRODAT','UTILTS') OR NOT coalesce(gridex_ack_authority.source_match_v1(a,s),false) THEN RETURN false;END IF;
 is_utilts:=s->>'family'='UTILTS';cfg:=p_projection#>ARRAY['constraints',s->>'family'];
 IF cfg IS NULL OR a->'type' IS DISTINCT FROM cfg->'technicalProfile' THEN RETURN false;END IF;
 IF is_utilts THEN
  IF NOT cfg->'allowedDocumentStatuses' ? (a->>'code') OR a->>'function' IS DISTINCT FROM cfg->>'messageFunction' OR nullif(a->>'document','') IS NULL OR length(a->>'document')>(cfg->>'documentIdMax')::int OR a#>>'{sender,2}'='PRODAT' OR a#>>'{receiver,2}'='PRODAT' THEN RETURN false;END IF;
 ELSE IF NOT cfg->'allowedFunctions' ? (a->>'function') THEN RETURN false;END IF;END IF;
 SELECT min((x->>'index')::int) INTO first_erc FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='ERC';IF first_erc IS NULL THEN RETURN false;END IF;
 SELECT count(*) INTO party_count FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='DTM' AND x#>>'{elements,1,0}'=common#>>'{documentDate,qualifier}';
 IF party_count<>1 THEN RETURN false;END IF;
 SELECT x->'elements'->1 INTO part FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='DTM' AND x#>>'{elements,1,0}'=common#>>'{documentDate,qualifier}';
 IF part->>2 IS DISTINCT FROM common#>>'{documentDate,format}' OR NOT coalesce(gridex_ediel_ack_guide.date_time_v1(part->>1),false) THEN RETURN false;END IF;
 IF is_utilts AND (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='DTM' AND x#>>'{elements,1,0}'=cfg#>>'{fixedOffset,0}' AND x#>'{elements,1}'=cfg->'fixedOffset')<>1 THEN RETURN false;END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='NAD' AND (x->>'index')::int<first_erc LOOP
  e:=t->'elements';reference:=e#>>'{1,0}';
  IF reference IN(CASE WHEN is_utilts THEN 'MS' ELSE 'FR' END,CASE WHEN is_utilts THEN 'MR' ELSE 'DO' END) THEN
   part:=e->2;IF nullif(part->>0,'') IS NULL OR length(part->>0)>35 THEN RETURN false;END IF;
   IF is_utilts THEN IF NOT cfg->'legalAgencies' ? (part->>2) OR (part->>2=cfg->>'svkAgency' AND part->>1 IS DISTINCT FROM cfg->>'svkQualifier') THEN RETURN false;END IF;
   ELSE IF part->>1 IS DISTINCT FROM cfg->>'legalQualifier' OR part->>2 IS DISTINCT FROM cfg->>'legalAgency' OR NOT coalesce(e#>>'{9,0}'~(cfg->>'countryPattern'),false) THEN RETURN false;END IF;END IF;
   SELECT count(*) INTO party_count FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='NAD' AND (x->>'index')::int<first_erc AND x#>>'{elements,1,0}'=reference;IF party_count<>1 THEN RETURN false;END IF;
   SELECT x->'elements' INTO opposite FROM jsonb_array_elements(original)x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'=CASE reference WHEN 'MS' THEN 'MR' WHEN 'MR' THEN 'MS' WHEN 'FR' THEN 'DO' ELSE 'FR' END ORDER BY(x->>'index')::int LIMIT 1;
   IF opposite->2 IS DISTINCT FROM part OR (NOT is_utilts AND opposite#>>'{9,0}' IS DISTINCT FROM e#>>'{9,0}') THEN RETURN false;END IF;
  END IF;
 END LOOP;
 IF NOT is_utilts THEN
  SELECT coalesce(jsonb_agg(DISTINCT object),'[]') INTO source_objects FROM (
   SELECT jsonb_build_object('id',lin#>>'{elements,3,0}','li',(SELECT min(r#>>'{elements,1,1}') FROM jsonb_array_elements(original)r WHERE r->>'tag'='RFF' AND r#>>'{elements,1,0}'='LI' AND (r->>'index')::int>(lin->>'index')::int AND (r->>'index')::int<coalesce((SELECT min((n->>'index')::int) FROM jsonb_array_elements(original)n WHERE n->>'tag' IN('LIN','UNT') AND (n->>'index')::int>(lin->>'index')::int),2147483647))) object
   FROM jsonb_array_elements(original)lin WHERE lin->>'tag'='LIN') objects;
 END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='ERC' ORDER BY(x->>'index')::int LOOP
  group_start:=(t->>'index')::int;SELECT min((x->>'index')::int) INTO group_end FROM jsonb_array_elements(tokens)x WHERE (x->>'index')::int>group_start AND x->>'tag' IN('ERC','UNT','UNZ');
  e:=t->'elements';erc:=e#>>'{1,0}';
  IF NOT cfg->'allowedErc' ? erc OR nullif(e#>>'{1,1}','') IS NOT NULL OR e#>>'{1,2}' IS DISTINCT FROM cfg->>'agency' OR gridex_ediel_ack_guide.tail_populated_v1(e->1,3) THEN RETURN false;END IF;
  IF (is_utilts AND ((a->>'code'='312' AND erc<>'100') OR (a->>'code'='313' AND erc='100'))) OR (NOT is_utilts AND a->>'function'='27' AND erc='100') THEN RETURN false;END IF;
  SELECT count(*) INTO party_count FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='FTX' AND (x->>'index')::int>group_start AND (x->>'index')::int<group_end;IF party_count<>1 THEN RETURN false;END IF;
  SELECT x->'elements' INTO e FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='FTX' AND (x->>'index')::int=group_start+1;IF e IS NULL OR e#>>'{1,0}' IS DISTINCT FROM cfg->>'textQualifier' OR gridex_ediel_ack_guide.tail_populated_v1(e->2,0) OR gridex_ediel_ack_guide.tail_populated_v1(e->4,1) OR gridex_ediel_ack_guide.tail_populated_v1(e->5,0) OR gridex_ediel_ack_guide.tail_populated_v1(e->6,0) THEN RETURN false;END IF;
  literal:=e#>>'{4,0}';reference:=e#>>'{3,0}';IF nullif(literal,'') IS NULL OR length(literal)>(cfg->>'textMax')::int THEN RETURN false;END IF;
  IF erc='100' THEN IF literal IS DISTINCT FROM common->>'positiveText' OR gridex_ediel_ack_guide.tail_populated_v1(e->3,0) THEN RETURN false;END IF;
  ELSE
   IF nullif(reference,'') IS NULL OR length(reference)>(cfg->>'fieldReferenceMax')::int OR nullif(e#>>'{3,1}','') IS NOT NULL OR e#>>'{3,2}' IS DISTINCT FROM cfg->>'agency' OR gridex_ediel_ack_guide.tail_populated_v1(e->3,3) THEN RETURN false;END IF;
   IF is_utilts THEN IF (erc='41' AND literal IS DISTINCT FROM cfg->>'missingText') OR (erc='42' AND literal!~(cfg->>'invalidTextPattern')) THEN RETURN false;END IF;
   ELSE
    label:=cfg#>>ARRAY['fieldLabels',reference];
    IF erc IN('41','42') AND label IS NULL THEN RETURN false;END IF;
    IF erc='40' AND (cfg#>>ARRAY['applicationTexts',reference] IS NULL OR literal IS DISTINCT FROM cfg#>>ARRAY['applicationTexts',reference]) THEN RETURN false;END IF;
    IF erc='41' AND literal<>label||(cfg->>'missingSuffix') AND left(literal,length(label||(cfg->>'missingCustomerPrefix')))<>label||(cfg->>'missingCustomerPrefix') THEN RETURN false;END IF;
    IF erc='42' AND (left(literal,length((cfg->>'invalidPrefix')||label||' '))<>(cfg->>'invalidPrefix')||label||' ' OR length(literal)<=length((cfg->>'invalidPrefix')||label||' ')) THEN RETURN false;END IF;
   END IF;
  END IF;
  IF is_utilts THEN
   SELECT count(*),min(x#>>'{elements,1,1}') INTO ref_count,reference FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='DM' AND (x->>'index')::int>group_start AND (x->>'index')::int<group_end;
   IF ref_count<>1 OR nullif(reference,'') IS NULL OR length(reference)>(cfg->>'ownDmMax')::int OR reference=ANY(dm) THEN RETURN false;END IF;dm:=array_append(dm,reference);
   SELECT count(*),min(x#>>'{elements,1,1}') INTO ref_count,reference FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='ACW' AND (x->>'index')::int>group_start AND (x->>'index')::int<group_end;
   IF ref_count>1 OR (ref_count=1 AND (nullif(reference,'') IS NULL OR length(reference)>(cfg->>'originalAcwMax')::int)) OR (erc='100' AND ref_count<>1) THEN RETURN false;END IF;
  ELSE
   SELECT count(*),min(x#>>'{elements,1,1}') INTO ref_count,own_li FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI' AND (x->>'index')::int>group_start AND (x->>'index')::int<group_end;
   IF ref_count>1 OR (erc='100' AND ref_count<>1) OR (ref_count=1 AND (nullif(own_li,'') IS NULL OR length(own_li)>35)) THEN RETURN false;END IF;
   SELECT count(*),min(x#>>'{elements,1,1}') INTO ref_count,own_object FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='Z07' AND (x->>'index')::int>group_start AND (x->>'index')::int<group_end;
   IF ref_count>1 OR (ref_count=1 AND (nullif(own_object,'') IS NULL OR length(own_object)>25)) THEN RETURN false;END IF;
   IF NOT (a->>'function'='27' AND own_li IS NULL AND own_object IS NULL) THEN
    SELECT jsonb_agg(x) INTO matches FROM jsonb_array_elements(source_objects)x WHERE CASE WHEN own_li IS NOT NULL THEN x->>'li'=own_li ELSE x->>'id'=own_object END;
    IF jsonb_array_length(coalesce(matches,'[]'))<>1 OR matches#>>'{0,li}' IS DISTINCT FROM own_li OR (nullif(matches#>>'{0,id}','') IS NOT NULL AND matches#>>'{0,id}' IS DISTINCT FROM own_object AND NOT(erc='100' AND s->>'code'='Z13')) THEN RETURN false;END IF;
    answered:=array_append(answered,coalesce(matches#>>'{0,id}','')||'|'||coalesce(matches#>>'{0,li}',''));
   END IF;
  END IF;
 END LOOP;
 IF NOT is_utilts AND a->>'function'='34' AND EXISTS(SELECT FROM jsonb_array_elements(source_objects)x WHERE NOT(coalesce(x->>'id','')||'|'||coalesce(x->>'li','')=ANY(answered))) THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION gridex_ediel_ack_guide.require_v1(m public.ediel_messages) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;b gridex_ediel_ack_guide.source_bindings%rowtype;edition gridex_ediel_ack_guide.editions%rowtype;basis jsonb;binding_kind text;
BEGIN
 IF m.message_family NOT IN('APERAK','CONTRL') THEN RETURN;END IF;
 binding_kind:=CASE WHEN m.message_family='CONTRL' THEN 'technical' WHEN m.execution_context_snapshot->>'prodatCommonHeaderNegativeWitnessId' IS NOT NULL THEN 'common' ELSE 'national' END;
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND (company_id=m.company_id OR (binding_kind IN('technical','common') AND company_id IS NULL)) AND environment=m.environment AND direction='inbound' FOR SHARE;
 IF source.id IS NULL THEN RAISE EXCEPTION 'ediel_native_ack_guide_source_required';END IF;
 basis:=CASE binding_kind WHEN 'technical' THEN gridex_ediel_technical_ack.require_source_v1(m.company_id,source.id) WHEN 'common' THEN gridex_ediel_common_header.require_ack_v1(m) ELSE gridex_ediel_source_rules.require_v1(m.company_id,source.id) END;
 SELECT * INTO b FROM gridex_ediel_ack_guide.source_bindings WHERE source_message_id=source.id AND source_bindings.kind=binding_kind FOR SHARE;
 IF b.source_message_id IS NULL THEN RAISE EXCEPTION 'ediel_historical_ack_guide_basis_unavailable';END IF;
 IF b.company_id IS DISTINCT FROM m.company_id OR b.environment IS DISTINCT FROM m.environment OR b.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') OR b.original_basis IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ediel_ack_guide_original_basis_changed';END IF;
 SELECT * INTO STRICT edition FROM gridex_ediel_ack_guide.editions WHERE source_version=b.source_version;
 IF NOT coalesce(gridex_ediel_ack_guide.validate_v1(m.raw_payload,source.raw_payload,edition.projection),false) THEN RAISE EXCEPTION 'ediel_native_ack_guide_invalid';END IF;
END $$;
ALTER FUNCTION gridex_ediel_source_rules.capture_v1(uuid,uuid) RENAME TO capture_before_native_ack_guide_v1;
CREATE FUNCTION gridex_ediel_source_rules.capture_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;m public.ediel_messages%rowtype;
BEGIN
 basis:=gridex_ediel_source_rules.capture_before_native_ack_guide_v1(p_company_id,p_message_id);
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF m.message_family IN('PRODAT','UTILTS') THEN PERFORM gridex_ediel_ack_guide.bind_source_v1(m,'national',basis);END IF;
 RETURN basis;
END $$;
ALTER FUNCTION gridex_ediel_technical_ack.capture_reply_v1(uuid,uuid) RENAME TO capture_reply_before_native_ack_guide_v1;
CREATE FUNCTION gridex_ediel_technical_ack.capture_reply_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;m public.ediel_messages%rowtype;
BEGIN
 basis:=gridex_ediel_technical_ack.capture_reply_before_native_ack_guide_v1(p_company_id,p_message_id);
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND (company_id=p_company_id OR company_id IS NULL) FOR SHARE;
 PERFORM gridex_ediel_ack_guide.bind_source_v1(m,'technical',basis);RETURN basis;
END $$;
ALTER FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) RENAME TO prepare_before_native_ack_guide_v1;
CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;tokens jsonb;
BEGIN
 tokens:=gridex_utilts_binding.wire_tokens_v1(p_input->>'rawPayload');SELECT x#>>'{elements,2,0}' INTO m.message_family FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH';
 IF m.message_family IN('APERAK','CONTRL') THEN m.company_id:=(p_input->>'companyId')::uuid;m.environment:=p_input->>'environment';m.direction:='outbound';m.raw_payload:=p_input->>'rawPayload';m.related_message_id:=(p_input->>'relatedMessageId')::uuid;PERFORM gridex_ediel_ack_guide.require_v1(m);END IF;
 RETURN gridex_ediel_outbound_owner.prepare_before_native_ack_guide_v1(p_input);
END $$;
ALTER FUNCTION gridex_ediel_outbound_owner.assert_message_v1(public.ediel_messages,gridex_ediel_outbound_owner.witnesses) RENAME TO assert_message_before_native_ack_guide_v1;
CREATE FUNCTION gridex_ediel_outbound_owner.assert_message_v1(m public.ediel_messages,w gridex_ediel_outbound_owner.witnesses) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM gridex_ediel_outbound_owner.assert_message_before_native_ack_guide_v1(m,w);PERFORM gridex_ediel_ack_guide.require_v1(m);END $$;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_native_ack_guide_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;
BEGIN
 result:=gridex_ediel_transport.mutate_before_native_ack_guide_v1(p_input);
 IF p_input->>'action' IN('prepare','enter') AND result->>'proceed'='true' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid AND company_id=(p_input->>'companyId')::uuid AND environment=p_input->>'environment' AND direction='outbound' FOR SHARE;PERFORM gridex_ediel_ack_guide.require_v1(m);
 END IF;RETURN result;
END $$;
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_native_ack_guide_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;
BEGIN
 result:=gridex_outbound_dispatch.mutate_before_native_ack_guide_v1(p_input);
 IF p_input->>'action' IN('prepare','enter') AND result->>'proceed'='true' THEN SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid AND company_id=(p_input->>'companyId')::uuid AND environment=p_input->>'environment' AND direction='outbound' FOR SHARE;PERFORM gridex_ediel_ack_guide.require_v1(m);END IF;RETURN result;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_ack_guide FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_ediel_source_rules.capture_before_native_ack_guide_v1(uuid,uuid),gridex_ediel_source_rules.capture_v1(uuid,uuid),gridex_ediel_technical_ack.capture_reply_before_native_ack_guide_v1(uuid,uuid),gridex_ediel_technical_ack.capture_reply_v1(uuid,uuid),gridex_ediel_outbound_owner.prepare_before_native_ack_guide_v1(jsonb),gridex_ediel_outbound_owner.prepare_v1(jsonb),gridex_ediel_outbound_owner.assert_message_before_native_ack_guide_v1(public.ediel_messages,gridex_ediel_outbound_owner.witnesses),gridex_ediel_outbound_owner.assert_message_v1(public.ediel_messages,gridex_ediel_outbound_owner.witnesses),gridex_ediel_transport.mutate_before_native_ack_guide_v1(jsonb),gridex_outbound_dispatch.mutate_before_native_ack_guide_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb),gridex_ediel_source_rules.capture_v1(uuid,uuid),gridex_ediel_technical_ack.capture_reply_v1(uuid,uuid),gridex_ediel_outbound_owner.prepare_v1(jsonb) TO service_role;
COMMIT;
