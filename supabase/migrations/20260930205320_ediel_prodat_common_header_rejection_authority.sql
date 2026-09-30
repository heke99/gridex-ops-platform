-- Actual CLI forward; common national field202 authority is deliberately
-- distinct from a code profile, business acceptance and market-role authority.
BEGIN;
CREATE SCHEMA gridex_ediel_common_header;
REVOKE ALL ON SCHEMA gridex_ediel_common_header FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ediel_common_header.source_editions(version text PRIMARY KEY,evidence jsonb NOT NULL);
INSERT INTO gridex_ediel_common_header.source_editions SELECT value->>'sourceVersion',value FROM(SELECT '{"sourceVersion":"362242319584246d24507e2a3c7aa6530dfda17a5aa7b0ed4f8f7d7390f66dd0","inputManifest":{"docs/ediel/masterplan-v2/registers/source_manifest.json":"ae5561799f6c81d78a139e4f5f82e74228bb765369fc6876668ae99ac338892d","lib/ediel/core/edifactTokenizer.ts":"cf39d5c9f374ae4b0d5087a269f0f675ac891e8f7ff75a3891944e72d8817f79","lib/ediel/core/una.ts":"800c59c1bed62e014161b6e98cea096c5506046a2cda4a1c770fac655548e7a4","lib/ediel/prodat/prodat26AFieldMatrix.ts":"a96b7dcddb564aad04d3be6ee7aef1117601eccd893b47869a8ddc60b3794382","lib/ediel/prodat/prodatAperakText.ts":"bed3706c44c07dbf19a504f9c9449de566c6f5a2900859cdfda2d5c684e48ae4","lib/ediel/prodat/prodatFailureEvidence.ts":"185330ecaa4783fdc9c50c62a62a2d40310f5a09cc3a53621f2c6e3e490c7b69","lib/ediel/prodat/prodatRegisterFields.ts":"1d171216b8fd8be093a4b6d5e0d9e04cf969468ba342dfcde4771b46fe5df09c","lib/ediel/prodat/prodatRegisterGroups.ts":"142e9e441e6a94708841dec9aaddb9656b091aa04536c00ec358a6b59bcfe291","lib/ediel/rulebook/ackGuidePolicy.ts":"ae04aad84286416cd1813909e07533504d7fa89fcd5a5753cb2b75c1540b52ec","lib/ediel/rulebook/guideRegistry.ts":"63fefd35e3fff23fbbca16d7dd702310308cbc363676e57ac1a26dcab70ad4da","lib/ediel/rulebook/mapEdielError.ts":"56cbf1985c3c82f305a4a43aa5352ff072c9be450264c479b77638c92c637334","lib/ediel/rulebook/prodatApplicationReference.ts":"fe20ad0bac7fb89ce5ebc85fd058c2d5644d18ad7d1b08bfe595d09a5aa9f785","lib/ediel/rulebook/prodatRulebook.ts":"bc8a47b4e2b8860026ae179e65163986039b1838c802dea7aada7f346ce4336b","lib/ediel/rulebook/prodatSubtypeRegistry.ts":"f3fb3418ee73333a097c3203384bd6d41b680adfb5ecf6e4752316c3e08568de","scripts/generate-ediel-common-header-source.cjs":"bab870b8aaed9fbb9704adefad65efb82d03fea6f9299e087005cffddf1f3fed"},"catalog":{"ackConstraints":{"technicalProfile":["APERAK","D","96A","UN","E2SE6A"],"allowedErc":["100","40","41","42"],"allowedFunctions":["27","34"],"legalAgency":"SVK","legalQualifier":"160","countryPattern":"^[A-Z]{2}$","missingSuffix":" saknas","missingCustomerPrefix":" saknas, kundid","invalidPrefix":"Felaktigt ","agency":"260","textQualifier":"AAO","textMax":70,"fieldReferenceMax":3,"fieldLabels":{"202":"Meddelandenamn","203":"Meddelandeidentifikation","204":"Meddelandefunktion","205":"Meddelandedatum","206":"Tidszon","207":"Avsändare (Ediel-ID)","208":"Mottagare (Ediel-ID)","209":"Anläggnings-id","210":"Avtal, startdatum","211":"Avtal, slutdatum","212":"Datum för första mätaravläsning","213":"Uppskattad årsenergi","214":"Konstant för mätare","215":"Konstant, gammal mätare","216":"Giltighetsdatum - giltig from","217":"Mätmetod","218":"Antal siffror, mätare","219":"Antal siffror, gammal mätare","220":"Prioritet","222":"Rapporteringsfrekvens","223":"Transaktionstyp (undertyp)","224":"Mätarnummer","225":"Gammalt mätarnummer","226":"Ärendereferens","227":"Kund-id","228":"Namn-elanvändare","229":"Adress-elanvändare","231":"Postnr-elanvändare","232":"Postort-elanvändare","233":"Anläggnings-id","234":"Adress-anläggning","235":"Postnr-anläggning","236":"Postort-anläggning","237":"Land-anläggning","240":"Serie-id","242":"Produktkod","249":"Födelsedatum","250":"Fakturamottagare ID","251":"Namn-fakturamottagare","252":"Adress-fakturamottagare","253":"Postnr-fakturamottgare","254":"Avräkningsmetod (dygns/månads)","258":"Sekvensnummer","259":"Mätare, tidsintervall (räkneverkskod)","260":"Nätområdesid","261":"Referens till avtal/fullmakt","262":"Balansansvarig","301":"Fritext (huvud)","302":"Rapportstartdatum","303":"Fritext (per anläggning)","306":"Installationsstatus","307":"Tariffkod","308":"Leverantörens avtalsnr","310":"Kundstatus","311":"Application Reference","312":"Version","313":"Kvittensbegäran","314":"Sekvensnummer","315":"Avsändarens org.nr","316":"Land-elanvändare","317":"Postort-fakturamottagare","318":"Land-fakturamottagare","319":"Referens till anläggning","320":"Värmevärdesområde","321":"Rapportslutdatum","322":"Tillståndets status","323":"Tillståndets syfte","324":"Orsak till tillståndets upphörande","325":"Tillståndets id","326":"Tillståndets tidstämpel","327":"Tjänsten/rapporteringen upphör","506":"Produkt id (Energiprodukt)","508":"Tidslängd (tidsperiod)","513":"Riktning (Typ av anläggning)"},"applicationTexts":{"100":"Meddelandetyp/funktion är inte implementerad i applikationen","102":"Meddelandehuvudet kunde inte läsas","103":"Dubblett av meddelandet","104":"Liknande meddelande mottaget tidigare","105":"Anläggningen kan inte identifieras","106":"Liknande meddelande mottaget från annan aktör","107":"Aktören är inte knuten till aktuell anläggning","108":"Aktören är redan knuten till aktuell anläggning","109":"En period anges där endast en dag/tidpunkt förväntas","110":"Okänd eller ogiltig avsändare"},"source":{"id":"P","sections":["3.3","3.4","3.5"],"pages":[89,105],"availableBasis":"authenticated_original_page_excerpt"}},"commonAckConstraints":{"documentDate":{"qualifier":"137","format":"203","pattern":"^[0-9]{12}$"},"positiveText":"OK"},"family":"PRODAT","technicalType":["PRODAT","D","97A","UN","E2SE6A"],"guides":[{"family":"PRODAT","guideRevision":"26-A","associationAssignedCode":"E2SE6A","documentName":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B","latestUpdated":"2026-06-30","effectiveFrom":"2026-04-01","effectiveTo":null,"authority":"Svenska kraftnät","certificationScope":"production_current","fieldMatrixStatus":"certified"}],"registeredVersion":"26.A:r3","allowedCodes":["Z01","Z02","Z03","Z04","Z05","Z06","Z08","Z09","Z10","Z13","Z14","Z15","Z18"],"applicationReferences":["23-DDQ-PRODAT","23-DGI-PRODAT"],"field":"202","label":"Meddelandenamn"},"originalSource":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":140}}'::jsonb value) edition;
CREATE TABLE gridex_ediel_common_header.sources(source_message_id uuid PRIMARY KEY,source_company_id uuid,company_id uuid,environment text NOT NULL,payload_sha256 text NOT NULL,source_received_at timestamptz,observed_at timestamptz NOT NULL,status text NOT NULL,reason text,evidence jsonb NOT NULL);
CREATE TABLE gridex_ediel_common_header.negative_witnesses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,environment text NOT NULL,source_message_id uuid NOT NULL REFERENCES gridex_ediel_common_header.sources(source_message_id),actor_user_id uuid NOT NULL,payload_sha256 text NOT NULL,evidence jsonb NOT NULL);
CREATE TABLE gridex_ediel_common_header.negative_consumptions(witness_id uuid PRIMARY KEY REFERENCES gridex_ediel_common_header.negative_witnesses(id),ack_message_id uuid UNIQUE NOT NULL,company_id uuid NOT NULL,environment text NOT NULL,payload_sha256 text NOT NULL);
CREATE FUNCTION gridex_ediel_common_header.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'ediel_common_header_basis_immutable';END$$;
DO $$DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['source_editions','sources','negative_witnesses','negative_consumptions'] LOOP
 EXECUTE format('ALTER TABLE gridex_ediel_common_header.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE gridex_ediel_common_header.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON TABLE gridex_ediel_common_header.%I FROM PUBLIC,anon,authenticated,service_role',tab);
 EXECUTE format('CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_ediel_common_header.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_common_header.immutable()',tab);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_common_header.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_common_header.immutable()',tab);
END LOOP;END$$;
CREATE FUNCTION gridex_ediel_common_header.capture_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE observed timestamptz:=clock_timestamp();tokens jsonb;header jsonb;bgm jsonb;parts jsonb;u jsonb;fr jsonb;recipient jsonb;edition jsonb;guide jsonb;pack public.ediel_rule_packs%rowtype;sources jsonb;
 cs uuid[];actors uuid[];c uuid;namespace jsonb;state text:='ready';reason text;defect text;description text;first_detail integer;date date;editions jsonb;
BEGIN
 IF TG_OP='UPDATE' AND nullif(OLD.raw_payload,'') IS NOT NULL THEN RETURN NEW;END IF;
 IF NEW.direction IS DISTINCT FROM 'inbound' OR nullif(NEW.raw_payload,'') IS NULL OR EXISTS(SELECT FROM gridex_ediel_common_header.sources WHERE source_message_id=NEW.id) THEN RETURN NEW;END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(NEW.raw_payload);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1 THEN RETURN NEW;END IF;
 SELECT t INTO header FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';IF header#>>'{elements,2,0}' IS DISTINCT FROM 'PRODAT' THEN RETURN NEW;END IF;
 SELECT min((t->>'index')::integer) INTO first_detail FROM jsonb_array_elements(tokens)t WHERE t->>'tag' IN('LIN','UNT','UNZ');
 SELECT t INTO bgm FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM' AND (t->>'index')::integer<first_detail;
 IF bgm IS NULL THEN RETURN NEW;END IF;parts:=bgm#>'{elements,1}';
 -- The source-generated original family list owns field202; no arbitrary
 -- selected code, subtype or market role can be manufactured for an unknown.
 SELECT coalesce(jsonb_agg(e.evidence),'[]') INTO editions FROM gridex_ediel_common_header.source_editions e WHERE EXISTS(SELECT FROM jsonb_array_elements(e.evidence#>'{catalog,guides}')g WHERE (g->>'effectiveFrom')::date<=(NEW.message_received_at AT TIME ZONE 'Europe/Stockholm')::date AND(g->>'effectiveTo' IS NULL OR(NEW.message_received_at AT TIME ZONE 'Europe/Stockholm')::date<=(g->>'effectiveTo')::date));
 edition:=editions->0;IF jsonb_array_length(editions)=1 AND edition#>'{catalog,allowedCodes}' ? coalesce(parts->>0,'') THEN RETURN NEW;END IF;
 BEGIN
  IF jsonb_array_length(editions)<>1 THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;
  IF NEW.environment NOT IN('test','production') OR NEW.message_received_at IS NULL OR octet_length(NEW.raw_payload)>262144 THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;
  date:=(NEW.message_received_at AT TIME ZONE 'Europe/Stockholm')::date;
  SELECT g INTO STRICT guide FROM jsonb_array_elements(edition#>'{catalog,guides}')g WHERE (g->>'effectiveFrom')::date<=date AND (g->>'effectiveTo' IS NULL OR date<=(g->>'effectiveTo')::date);
  IF header#>'{elements,2}' IS DISTINCT FROM edition#>'{catalog,technicalType}' THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;
  u:=gridex_ediel_technical_ack.envelope(NEW.raw_payload);
  IF u IS NULL OR u->>'environment' IS DISTINCT FROM NEW.environment OR NOT(edition#>'{catalog,applicationReferences}' ? (u->>'applicationReference')) THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;
  SELECT t INTO STRICT fr FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='FR' AND (t->>'index')::integer<first_detail;
  SELECT t INTO STRICT recipient FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='DO' AND (t->>'index')::integer<first_detail;
  IF jsonb_array_length(fr#>'{elements,2}')<>3 OR jsonb_array_length(recipient#>'{elements,2}')<>3 OR nullif(fr#>>'{elements,2,0}','') IS NULL OR nullif(recipient#>>'{elements,2,0}','') IS NULL
   OR fr#>>'{elements,2,1}' IS DISTINCT FROM '160' OR fr#>>'{elements,2,2}' IS DISTINCT FROM 'SVK' OR recipient#>>'{elements,2,1}' IS DISTINCT FROM '160' OR recipient#>>'{elements,2,2}' IS DISTINCT FROM 'SVK'
   OR coalesce(fr#>>'{elements,9,0}','')!~'^[A-Z]{2}$' OR coalesce(recipient#>>'{elements,9,0}','')!~'^[A-Z]{2}$' THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;
  -- Namespace ownership is a legal identity fact only, never an inferred role,
  -- grant or entitlement to process the unknown business message.
  LOCK TABLE public.tenant_actor_identifiers IN SHARE MODE;
  SELECT array_agg(DISTINCT i.company_id),array_agg(DISTINCT i.actor_id) INTO cs,actors FROM public.tenant_actor_identifiers i WHERE i.environment=NEW.environment AND i.identifier_type='EdielId' AND i.identifier_value=recipient#>>'{elements,2,0}' AND i.valid_from<=observed AND(i.valid_to IS NULL OR observed<i.valid_to);
  IF cardinality(cs) IS DISTINCT FROM 1 OR cardinality(actors) IS DISTINCT FROM 1 OR (NEW.company_id IS NOT NULL AND NEW.company_id IS DISTINCT FROM cs[1]) THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;c:=cs[1];
  SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) INTO namespace FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.actor_id=actors[1] AND i.environment=NEW.environment AND i.identifier_type='EdielId' AND i.identifier_value=recipient#>>'{elements,2,0}' AND i.valid_from<=observed AND(i.valid_to IS NULL OR observed<i.valid_to);
  LOCK TABLE public.ediel_rule_packs,public.ediel_rule_pack_sources IN SHARE MODE;
  SELECT * INTO STRICT pack FROM public.ediel_rule_packs r WHERE r.family='PRODAT' AND r.market='electricity' AND r.status IN('active','transition') AND r.guide_version||':r'||r.guide_revision=edition#>>'{catalog,registeredVersion}' AND r.unh_association_code=guide->>'associationAssignedCode' AND r.valid_from<=date AND(r.valid_to IS NULL OR date<=r.valid_to);
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') INTO sources FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=pack.id;
  defect:=CASE WHEN EXISTS(SELECT FROM jsonb_array_elements_text(parts)p WHERE nullif(p,'') IS NOT NULL) THEN 'invalid' ELSE 'missing' END;
  description:=CASE defect WHEN 'missing' THEN (edition#>>'{catalog,label}')||' saknas' ELSE 'Felaktigt '||(edition#>>'{catalog,label}')||' '||(SELECT string_agg(p,':' ORDER BY i) FROM jsonb_array_elements_text(parts)WITH ORDINALITY x(p,i)) END;
 EXCEPTION WHEN OTHERS THEN state:='held';reason:='ediel_common_header_rejection_basis_required';END;
 INSERT INTO gridex_ediel_common_header.sources VALUES(NEW.id,NEW.company_id,c,NEW.environment,encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex'),NEW.message_received_at,observed,state,reason,
  jsonb_build_object('kind','prodat_common_header_rejection','version',1,'companyId',c,'environment',NEW.environment,'sourceMessageId',NEW.id,'sourceHash',encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex'),'sourceReceivedAt',NEW.message_received_at,'observedAt',observed,
   'field202',jsonb_build_object('fieldCode','202','ercCode',CASE defect WHEN 'missing' THEN '41' ELSE '42' END,'text',description),'guide',guide,'familyEdition',jsonb_build_object('version',edition#>>'{catalog,registeredVersion}','rulePack',to_jsonb(pack),'guideSources',sources,'sourceProjection',edition),
   'identities',jsonb_build_object('family','PRODAT','transport',jsonb_build_object('interchangeReference',u->>'interchangeReference','uciReference',u->>'uciReference','senderComponents',u->'sender','receiverComponents',u->'receiver'),
    'legalSender',jsonb_build_object('id',fr#>>'{elements,2,0}','identityComponents',fr#>'{elements,2}','country',fr#>>'{elements,9,0}'),'legalReceiver',jsonb_build_object('id',recipient#>>'{elements,2,0}','identityComponents',recipient#>'{elements,2}','country',recipient#>>'{elements,9,0}'),'applicationReference',u->>'applicationReference'),
   'legalNamespace',namespace,'authorizesBusinessEffect',false));RETURN NEW;
END$$;
CREATE TRIGGER ediel_capture_common_prodat_header AFTER INSERT OR UPDATE OF raw_payload ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_common_header.capture_source();
CREATE FUNCTION gridex_ediel_common_header.require_v1(c uuid,env text,msg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;b gridex_ediel_common_header.sources%rowtype;f gridex_ediel_technical_ack.syntax_facets%rowtype;t gridex_ediel_technical_ack.sources%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=msg AND direction='inbound' FOR SHARE;SELECT * INTO b FROM gridex_ediel_common_header.sources WHERE source_message_id=msg;
 IF b.source_message_id IS NULL THEN RAISE EXCEPTION 'ediel_historical_common_header_basis_unavailable';END IF;
 IF m.id IS NULL OR b.status<>'ready' OR b.company_id IS DISTINCT FROM c OR b.environment IS DISTINCT FROM env OR m.environment IS DISTINCT FROM env OR m.company_id IS DISTINCT FROM b.source_company_id
  OR b.source_received_at IS DISTINCT FROM m.message_received_at OR b.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;
 SELECT * INTO f FROM gridex_ediel_technical_ack.syntax_facets a WHERE a.source_message_id=msg AND a.company_id=c AND a.environment=env AND a.payload_sha256=b.payload_sha256 AND a.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296) FOR SHARE;
 SELECT * INTO t FROM gridex_ediel_technical_ack.sources WHERE source_message_id=msg;
 IF f.id IS NULL OR f.facts_hash IS DISTINCT FROM encode(sha256(convert_to(f.facts_text,'UTF8')),'hex') OR f.facts_text::jsonb->>'owner' IS DISTINCT FROM 'canonical-runtime-syntax-v1' OR f.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted'
  OR t.status IS DISTINCT FROM 'ready' OR t.company_id IS DISTINCT FROM c OR t.environment IS DISTINCT FROM env OR t.payload_sha256 IS DISTINCT FROM b.payload_sha256 THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;
 RETURN b.evidence||jsonb_build_object('syntaxAssessmentId',f.id);
END$$;
CREATE FUNCTION gridex_ediel_common_header.read_v1(c uuid,env text,msg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE e jsonb;m public.ediel_messages%rowtype;BEGIN
 e:=gridex_ediel_common_header.require_v1(c,env,msg);SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=msg FOR SHARE;RETURN jsonb_build_object('version',1,'sourceMessage',to_jsonb(m),'evidence',e);END$$;
CREATE FUNCTION gridex_ediel_common_header.assert_ack_v1(m public.ediel_messages,e jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tokens jsonb;wire jsonb;source public.ediel_messages%rowtype;u jsonb;g jsonb;ftx jsonb;unb jsonb;unh jsonb;bgm jsonb;
BEGIN
 IF m.company_id::text IS DISTINCT FROM e->>'companyId' OR m.environment IS DISTINCT FROM e->>'environment' OR m.related_message_id::text IS DISTINCT FROM e->>'sourceMessageId' OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'APERAK' OR m.message_code IS DISTINCT FROM 'APERAK'
  OR m.canonical_rule_pack_id IS NOT NULL OR m.rule_profile_version_id IS NOT NULL OR m.rule_profile_key IS NOT NULL OR m.rule_profile_version IS NOT NULL OR m.rule_pack_checksum IS NOT NULL OR coalesce(m.rule_pack_snapshot,'{}')<>'{}' THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);wire:=gridex_ack_authority.wire_v1(m.raw_payload);
 IF wire IS NULL OR wire->>'family'<>'APERAK' OR wire->>'function' IS DISTINCT FROM '27' OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='FTX')<>1 THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
 SELECT t->'elements' INTO unb FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB';SELECT t->'elements' INTO unh FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';SELECT t->'elements' INTO bgm FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 SELECT t->'elements' INTO g FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC';SELECT t->'elements' INTO ftx FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='FTX';
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE id=m.related_message_id FOR SHARE;u:=gridex_ediel_technical_ack.envelope(source.raw_payload);
 IF unh->2 IS DISTINCT FROM e#>'{familyEdition,sourceProjection,catalog,ackConstraints,technicalProfile}' OR unb->2 IS DISTINCT FROM u->'receiver' OR unb->3 IS DISTINCT FROM u->'sender' OR coalesce(unb#>>'{7,0}','') IS DISTINCT FROM u->>'applicationReference' OR coalesce(unb#>>'{11,0}','') IS DISTINCT FROM u->>'testIndicator'
  OR g->1 IS DISTINCT FROM jsonb_build_array(e#>>'{field202,ercCode}','','260') OR ftx->1 IS DISTINCT FROM '["AAO"]'::jsonb OR ftx->3 IS DISTINCT FROM '["202","","260"]'::jsonb OR ftx->4 IS DISTINCT FROM jsonb_build_array(e#>>'{field202,text}') OR length(ftx#>>'{4,0}')>(e#>>'{familyEdition,sourceProjection,catalog,ackConstraints,textMax}')::integer
  OR wire->>'legalSender' IS DISTINCT FROM e#>>'{identities,legalReceiver,id}' OR wire->>'legalReceiver' IS DISTINCT FROM e#>>'{identities,legalSender,id}' THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
 -- Full legal qualifiers/country and known original document reference stay
 -- tied to the actual physical own header, not merely matching public IDs.
 IF EXISTS(SELECT FROM unnest(ARRAY['FR','DO'])role WHERE (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'=role)<>1) THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='FR' AND t#>'{elements,2}'=e#>'{identities,legalReceiver,identityComponents}' AND t#>>'{elements,9,0}'=e#>>'{identities,legalReceiver,country}')
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='DO' AND t#>'{elements,2}'=e#>'{identities,legalSender,identityComponents}' AND t#>>'{elements,9,0}'=e#>>'{identities,legalSender,country}') THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
 IF jsonb_array_length(ftx)>5 OR coalesce(ftx->2,'[]') NOT IN('[]'::jsonb,'[""]'::jsonb) OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'=e#>>'{familyEdition,sourceProjection,catalog,commonAckConstraints,documentDate,qualifier}' AND t#>>'{elements,1,2}'=e#>>'{familyEdition,sourceProjection,catalog,commonAckConstraints,documentDate,format}' AND t#>>'{elements,1,1}'~'^[0-9]{12}$')<>1
  OR EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag' IN('IDE','LIN','UCI','UCM'))
  OR EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}' NOT IN('ACW')) THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
 IF NOT coalesce(gridex_ack_authority.source_match_v1(wire,gridex_ack_authority.wire_v1(source.raw_payload)),false) THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
END$$;
CREATE FUNCTION gridex_ediel_common_header.require_current_scope_v1(e jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE companies uuid[];actors uuid[];technical jsonb;observed timestamptz:=clock_timestamp();BEGIN
 SELECT array_agg(DISTINCT i.company_id),array_agg(DISTINCT i.actor_id) INTO companies,actors FROM public.tenant_actor_identifiers i WHERE i.environment=e->>'environment' AND i.identifier_type='EdielId' AND i.identifier_value=e#>>'{identities,legalReceiver,id}' AND i.valid_from<=observed AND(i.valid_to IS NULL OR observed<i.valid_to);
 IF cardinality(companies) IS DISTINCT FROM 1 OR cardinality(actors) IS DISTINCT FROM 1 OR companies[1]::text IS DISTINCT FROM e->>'companyId' OR NOT EXISTS(SELECT FROM jsonb_array_elements(e->'legalNamespace')n WHERE n->>'actor_id'=actors[1]::text) THEN RAISE EXCEPTION 'ediel_common_header_current_identity_unavailable';END IF;
 SELECT evidence INTO technical FROM gridex_ediel_technical_ack.sources WHERE source_message_id=(e->>'sourceMessageId')::uuid;
 PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(technical);END$$;
CREATE FUNCTION gridex_ediel_common_header.prepare_v1(c uuid,env text,msg uuid,actor uuid,raw text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e jsonb;m public.ediel_messages%rowtype;token uuid;
BEGIN
 IF NOT EXISTS(SELECT FROM public.company_memberships x WHERE x.company_id=c AND x.user_id=actor AND x.status='active' AND x.is_active AND x.accepted_at IS NOT NULL) OR NOT EXISTS(SELECT FROM public.user_profiles x WHERE x.id=actor AND x.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.send'),false) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden';END IF;
 e:=gridex_ediel_common_header.require_v1(c,env,msg);PERFORM gridex_ediel_common_header.require_current_scope_v1(e);m.company_id:=c;m.environment:=env;m.related_message_id:=msg;m.direction:='outbound';m.message_family:='APERAK';m.message_code:='APERAK';m.raw_payload:=raw;
 PERFORM gridex_ediel_common_header.assert_ack_v1(m,e);
 PERFORM gridex_ediel_ack_guide.bind_source_v1(source,'common',e) FROM public.ediel_messages source WHERE source.id=msg;
 INSERT INTO gridex_ediel_common_header.negative_witnesses(company_id,environment,source_message_id,actor_user_id,payload_sha256,evidence) VALUES(c,env,msg,actor,encode(sha256(convert_to(raw,'UTF8')),'hex'),e)RETURNING id INTO token;
 RETURN jsonb_build_object('witnessId',token,'evidence',e);
END$$;
CREATE FUNCTION gridex_ediel_common_header.witness_v1(m public.ediel_messages) RETURNS gridex_ediel_common_header.negative_witnesses LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_ediel_common_header.negative_witnesses%rowtype;BEGIN
 SELECT * INTO w FROM gridex_ediel_common_header.negative_witnesses WHERE id=(m.execution_context_snapshot->>'prodatCommonHeaderNegativeWitnessId')::uuid FOR SHARE;
 IF w.id IS NULL OR w.company_id IS DISTINCT FROM m.company_id OR w.environment IS DISTINCT FROM m.environment OR w.source_message_id IS DISTINCT FROM m.related_message_id OR w.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_common_header_negative_witness_required';END IF;
 PERFORM gridex_ediel_common_header.assert_ack_v1(m,w.evidence);RETURN w;END$$;
CREATE FUNCTION gridex_ediel_common_header.consume_v1(m public.ediel_messages) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE w gridex_ediel_common_header.negative_witnesses%rowtype;p gridex_ediel_common_header.negative_consumptions%rowtype;BEGIN
 w:=gridex_ediel_common_header.witness_v1(m);SELECT * INTO p FROM gridex_ediel_common_header.negative_consumptions WHERE witness_id=w.id FOR UPDATE;
 IF FOUND THEN IF p.ack_message_id IS DISTINCT FROM m.id THEN RAISE EXCEPTION 'ediel_common_header_negative_witness_already_consumed';END IF;RETURN;END IF;
 INSERT INTO gridex_ediel_common_header.negative_consumptions VALUES(w.id,m.id,m.company_id,m.environment,w.payload_sha256);END$$;
CREATE FUNCTION gridex_ediel_common_header.require_ack_v1(m public.ediel_messages) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE w gridex_ediel_common_header.negative_witnesses%rowtype;BEGIN
 w:=gridex_ediel_common_header.witness_v1(m);PERFORM gridex_ediel_common_header.require_current_scope_v1(w.evidence);
 IF NOT EXISTS(SELECT FROM gridex_ediel_common_header.negative_consumptions p WHERE p.witness_id=w.id AND p.ack_message_id=m.id AND p.company_id=m.company_id AND p.environment=m.environment AND p.payload_sha256=w.payload_sha256) THEN RAISE EXCEPTION 'ediel_common_header_negative_witness_required';END IF;RETURN w.evidence;END$$;
CREATE FUNCTION public.ediel_read_prodat_common_header_rejection_v1(p_company_id uuid,p_environment text,p_source_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;RETURN gridex_ediel_common_header.read_v1(p_company_id,p_environment,p_source_message_id);END$$;
CREATE FUNCTION public.ediel_prepare_common_header_negative_ack_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_actor_user_id uuid,p_raw_payload text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;RETURN gridex_ediel_common_header.prepare_v1(p_company_id,p_environment,p_source_message_id,p_actor_user_id,p_raw_payload);END$$;
CREATE FUNCTION gridex_ediel_common_header.read_ack_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE m public.ediel_messages%rowtype;e jsonb;result jsonb;BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_ack_message_id AND company_id=p_company_id AND environment=p_environment AND direction='outbound' FOR SHARE;
 e:=gridex_ediel_common_header.require_ack_v1(m);result:=gridex_ediel_common_header.read_v1(p_company_id,p_environment,m.related_message_id);RETURN result||jsonb_build_object('ackMessage',to_jsonb(m));END$$;
CREATE FUNCTION public.ediel_read_common_header_negative_ack_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;RETURN gridex_ediel_common_header.read_ack_v1(p_company_id,p_environment,p_ack_message_id);END$$;

CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.consume() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_ediel_outbound_owner.witnesses%rowtype;prior gridex_ediel_outbound_owner.consumptions%rowtype;token uuid;
BEGIN
 IF NEW.direction='outbound' AND NEW.message_family='APERAK' AND NEW.execution_context_snapshot ? 'prodatCommonHeaderNegativeWitnessId' THEN
  PERFORM gridex_ediel_common_header.consume_v1(NEW);PERFORM gridex_ediel_ack_guide.require_v1(NEW);RETURN NEW;
 END IF;
 IF NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_family NOT IN('PRODAT','UTILTS','APERAK','UTILTS_ERR') OR nullif(NEW.raw_payload,'') IS NULL THEN RETURN NEW;END IF;
 token:=(NEW.execution_context_snapshot->>'outboundOwnerWitnessId')::uuid;
 SELECT * INTO w FROM gridex_ediel_outbound_owner.witnesses WHERE id=token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_historical_outbound_owner_witness_unavailable';END IF;
 PERFORM gridex_ediel_outbound_owner.assert_message_v1(NEW,w);
 PERFORM gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(NEW,false);
 SELECT * INTO prior FROM gridex_ediel_outbound_owner.consumptions WHERE witness_id=w.id;
 IF FOUND THEN
  IF prior.source_message_id IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_already_consumed';END IF;
  RETURN NEW;
 END IF;
 -- The same INSERT transaction owns both actual immutable physical message
 -- scope and one-use protected witness consumption. Failure rolls back both.
 INSERT INTO gridex_ediel_outbound_owner.consumptions VALUES(w.id,NEW.id,w.company_id,w.environment,w.payload_sha256);
 RETURN NEW;
END $$;


create or replace function public.gridex_capture_ediel_rule_pack_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile_rule_pack_id uuid;
begin
  if new.direction='outbound' and new.message_family='APERAK' and new.execution_context_snapshot ? 'prodatCommonHeaderNegativeWitnessId' then
    perform gridex_ediel_common_header.witness_v1(new);return new;
  end if;
  -- A protected technical CONTRL does not borrow a nonexistent businesspack.
  -- The actual original syntax owner and qualified endpoint/wire scope suffice.
  if new.direction='outbound' and new.message_family='CONTRL' then
    perform gridex_ediel_technical_ack.require_contrl_v1(new);
    return new;
  end if;
  if new.direction='outbound' and new.message_family in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR') then
    if new.company_id is null then
      raise exception 'outbound_ediel_company_id_required' using errcode='23502';
    end if;

    if nullif(new.rule_profile_key,'') is null or new.rule_profile_version_id is null
       or nullif(new.rule_profile_version,'') is null or nullif(new.rule_pack_checksum,'') is null
       or coalesce(new.rule_pack_snapshot,'{}'::jsonb)='{}'::jsonb then
      raise exception 'outbound_ediel_rule_pack_snapshot_required' using errcode='23514';
    end if;

    select mp.rule_pack_id into v_profile_rule_pack_id
    from public.ediel_message_profiles mp
    where mp.id = new.rule_profile_version_id
      and mp.is_enabled = true;

    if v_profile_rule_pack_id is null then
      raise exception 'canonical_ediel_message_profile_required:%', new.rule_profile_version_id using errcode='23503';
    end if;

    if new.canonical_rule_pack_id is null or new.canonical_rule_pack_id <> v_profile_rule_pack_id then
      raise exception 'canonical_ediel_rule_pack_profile_mismatch:%:%', coalesce(new.canonical_rule_pack_id::text,'null'), v_profile_rule_pack_id::text using errcode='23514';
    end if;

    insert into public.ediel_rule_pack_snapshots(
      company_id,ediel_message_id,profile_key,rule_profile_version_id,profile_version,checksum,snapshot
    ) values (
      new.company_id,new.id,new.rule_profile_key,new.rule_profile_version_id,new.rule_profile_version,new.rule_pack_checksum,new.rule_pack_snapshot
    ) on conflict(ediel_message_id) do update set
      company_id=excluded.company_id,
      profile_key=excluded.profile_key,
      rule_profile_version_id=excluded.rule_profile_version_id,
      profile_version=excluded.profile_version,
      checksum=excluded.checksum,
      snapshot=excluded.snapshot;
  end if;
  return new;
end;
$function$;



CREATE OR REPLACE FUNCTION gridex_ediel_transport.mutate_before_positive_storage_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;evidence jsonb;attempt gridex_ediel_transport.attempts%rowtype;r gridex_ediel_transport.reservations%rowtype;actor uuid:=(p_input->>'actorUserId')::uuid;
BEGIN
 IF p_input->>'action'='enter' THEN
  SELECT * INTO m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid AND company_id=(p_input->>'companyId')::uuid AND environment=p_input->>'environment' AND direction='outbound' FOR UPDATE;
  SELECT * INTO r FROM gridex_ediel_transport.reservations WHERE message_id=m.id FOR UPDATE;
  IF r.state IN('entered','observed') THEN
   SELECT * INTO attempt FROM gridex_ediel_transport.attempts WHERE id=r.attempt_id AND id=(p_input->>'attemptId')::uuid AND message_id=m.id AND company_id=m.company_id AND environment=m.environment AND actor_user_id=actor FOR SHARE;
   IF attempt.id IS NULL OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR attempt.binding->>'originalHash' IS DISTINCT FROM m.immutable_payload_hash
    OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
    OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(actor,m.company_id,'communication.send'),false) THEN RAISE EXCEPTION 'ediel_transport_replay_scope_invalid';END IF;
   RETURN jsonb_build_object('proceed',false,'state',r.state);
  END IF;
 END IF;
 result:=gridex_ediel_transport.mutate_before_original_basis_v1(p_input);
 IF p_input->>'action' NOT IN('prepare','enter') OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid AND company_id=(p_input->>'companyId')::uuid AND environment=p_input->>'environment' AND direction='outbound' FOR UPDATE;
 IF m.message_family NOT IN('PRODAT','UTILTS','APERAK','UTILTS_ERR','CONTRL') THEN RETURN result;END IF;
 IF m.message_family='CONTRL' THEN
  evidence:=gridex_ediel_technical_ack.require_contrl_v1(m);
  IF p_input->>'action'='prepare' AND p_input#>'{binding,technicalSyntaxAckEvidence}' IS DISTINCT FROM evidence THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 ELSIF m.message_family='APERAK' AND m.execution_context_snapshot ? 'prodatCommonHeaderNegativeWitnessId' THEN
  evidence:=gridex_ediel_common_header.require_ack_v1(m);PERFORM gridex_ediel_ack_guide.require_v1(m);
  IF p_input->>'action'='prepare' AND p_input#>'{binding,prodatCommonHeaderRejectionEvidence}' IS DISTINCT FROM evidence THEN RAISE EXCEPTION 'ediel_common_header_negative_witness_required';END IF;
 ELSE
  evidence:=gridex_ediel_source_rules.capture_v1(m.company_id,m.id);
  IF p_input->>'action'='prepare' AND p_input#>'{binding,sourceRulePackEvidence}' IS DISTINCT FROM evidence THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required';END IF;
 END IF;
 SELECT * INTO STRICT attempt FROM gridex_ediel_transport.attempts WHERE id=(p_input->>'attemptId')::uuid AND message_id=m.id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
 IF m.message_family='CONTRL' AND attempt.binding->'technicalSyntaxAckEvidence' IS DISTINCT FROM evidence OR m.message_family='APERAK' AND m.execution_context_snapshot ? 'prodatCommonHeaderNegativeWitnessId' AND attempt.binding->'prodatCommonHeaderRejectionEvidence' IS DISTINCT FROM evidence OR m.message_family<>'CONTRL' AND NOT(m.message_family='APERAK' AND m.execution_context_snapshot ? 'prodatCommonHeaderNegativeWitnessId') AND attempt.binding->'sourceRulePackEvidence' IS DISTINCT FROM evidence THEN RAISE EXCEPTION 'ediel_transport_original_basis_binding_required';END IF;
 RETURN result;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_common_header FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gridex_ediel_common_header TO service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_common_header.read_v1(uuid,text,uuid),gridex_ediel_common_header.read_ack_v1(uuid,text,uuid),gridex_ediel_common_header.prepare_v1(uuid,text,uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_read_prodat_common_header_rejection_v1(uuid,text,uuid),public.ediel_prepare_common_header_negative_ack_v1(uuid,text,uuid,uuid,text),public.ediel_read_common_header_negative_ack_v1(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_read_prodat_common_header_rejection_v1(uuid,text,uuid),public.ediel_prepare_common_header_negative_ack_v1(uuid,text,uuid,uuid,text),public.ediel_read_common_header_negative_ack_v1(uuid,text,uuid) TO service_role;
COMMIT;
