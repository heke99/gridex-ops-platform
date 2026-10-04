-- Actual CLI forward. U§4 p104 prescribes APERAK on received UTILTS-ERR.
-- The actual committed correlation/guide owner authorizes this acknowledgement;
-- it never becomes a metering storage, business effect or new guide selection.
BEGIN;
-- BEGIN CANONICAL RESPONSE GUIDE PROJECTION
INSERT INTO gridex_ediel_ack_guide.editions(source_version,input_manifest,projection)
SELECT value->>'sourceVersion',value->'inputManifest',value->'projection' FROM (SELECT '{"sourceVersion":"2aa60b57531a3bf2bf95c7e7cc66aa099bb8db4ac9a8e2fc26f8168d6083642c","inputManifest":{"docs/ediel/masterplan-v2/registers/source_manifest.json":"ae5561799f6c81d78a139e4f5f82e74228bb765369fc6876668ae99ac338892d","lib/ediel/ack/canonicalAckEngine.ts":"12c4f5202a6bb9c5c072eda4c8a393688cab0a66ff598d11f1760bb89e15dbf6","lib/ediel/core/edifactEncoding.ts":"b9bb995a1a6072a74125bcbcc5be912ed524dcc991a8b00ddee018ded6822806","lib/ediel/core/edifactEnvelopeCodec.ts":"847f4138395629bd574ce6d84678509bda6c205176f878c59069e224e1df669f","lib/ediel/core/edifactSerializer.ts":"0e9739be139c6bfaca27a7890ac9b816e371790d228a98708d5887e8a04c8232","lib/ediel/core/edifactTokenizer.ts":"11b8b0546e794a2fe60c9aeaf6c3d811e9e6ca0e5a777171b4064a6679ced93f","lib/ediel/core/messageIdentity.ts":"47a30eb06d921331c7064ee60bae15bcf13e277dac283dc252dd52769bc99c55","lib/ediel/core/una.ts":"800c59c1bed62e014161b6e98cea096c5506046a2cda4a1c770fac655548e7a4","lib/ediel/prodat/canonicalRenderSemantics.ts":"02e7904aefa40024e322b2fe76300633d149ac47c70778a09076829fd602b44c","lib/ediel/prodat/prodat26AFieldMatrix.ts":"a96b7dcddb564aad04d3be6ee7aef1117601eccd893b47869a8ddc60b3794382","lib/ediel/prodat/prodatAperakText.ts":"bed3706c44c07dbf19a504f9c9449de566c6f5a2900859cdfda2d5c684e48ae4","lib/ediel/prodat/prodatFailureEvidence.ts":"185330ecaa4783fdc9c50c62a62a2d40310f5a09cc3a53621f2c6e3e490c7b69","lib/ediel/prodat/prodatRegisterFields.ts":"1d171216b8fd8be093a4b6d5e0d9e04cf969468ba342dfcde4771b46fe5df09c","lib/ediel/prodat/prodatRegisterGroups.ts":"142e9e441e6a94708841dec9aaddb9656b091aa04536c00ec358a6b59bcfe291","lib/ediel/rulebook/ackGuidePolicy.ts":"f2dd37e5a73b518a7830c2d187fed8e863ab2d032e9ae6773e603d8a508f6bfc","lib/ediel/rulebook/businessSemantics.ts":"89037706cdf2433f0c3f5e08dcb079bbc564b2da5b2c8dd5b3e9d87dc4ab235d","lib/ediel/rulebook/canonicalEdielFacade.ts":"b9ab529d62762db092b7dbcb9ec0c360220d9f881a8b224b5a91215d519b43b8","lib/ediel/rulebook/deadlinePolicy.ts":"5fe8333f61a4460a979fc62f15f9b15ffafb2faa3702b09392a5042eb08b2f34","lib/ediel/rulebook/guideRegistry.ts":"0c65aab5e0cd39959791b1dd947a199c8fa298a3813826a4f49cda8f46d098f4","lib/ediel/rulebook/mapEdielError.ts":"8374ce5f34d3657273b1e6a650e1734997df4bfe57633a7bfc0a77612cd95cea","lib/ediel/rulebook/prodatApplicationReference.ts":"fe20ad0bac7fb89ce5ebc85fd058c2d5644d18ad7d1b08bfe595d09a5aa9f785","lib/ediel/rulebook/prodatRulebook.ts":"bc8a47b4e2b8860026ae179e65163986039b1838c802dea7aada7f346ce4336b","lib/ediel/rulebook/prodatSubtypeRegistry.ts":"f3fb3418ee73333a097c3203384bd6d41b680adfb5ecf6e4752316c3e08568de","lib/ediel/rulebook/utilts25A4.ts":"4681b2ed91b1122e420532d7fd26aba13e8d8192bc1effb0f67cdd30e7846be2","lib/ediel/rulebook/utiltsApplicationReference.ts":"2a2a841900d51dfe5b121705357c8506a62365b8ec11614352a3fdf2a8711dbd","lib/ediel/rulebook/utiltsFieldMatrix.ts":"96673bf16652616e0715b3bfb36bda06caa5462c26783eacefa8f04ca4928655","lib/ediel/rulebook/utiltsMarketEngine.ts":"efece4736d43999c47aa5ad68cb226fe1b22578abe247e821a68a5b78b763f41","lib/ediel/rulebook/utiltsMarketSemantics.ts":"9262f1ea53ceeae77da7d1fb1093999f86890ae6d63b19a3d92712b417be2f10","lib/ediel/rulebook/utiltsRulebook.ts":"9e24ef3ffe369f63917faa0ee70754786550aa44c719b05baa4a5a5e3ac07227","lib/ediel/utilts/canonicalObservationScope.ts":"07f3cc93e88c8b65889dff6f44fceaae14c0492e4370ee307a7bc0bcde3ebecb","lib/ediel/utilts/errSourceCopy.ts":"fb3281479f77c5471bac52b4e9522f824fefe72b428ae57220fd7bc5f06eb1f5","lib/ediel/utilts/headerIdentityGuide.ts":"9070dd6248561a6be60f487ace38fe59324393f81854a5b8b121a8db47d3d9ee","scripts/generate-ediel-native-response-guide-projection.cjs":"8be096b7c7b64fc622337a600cfd03f6a5ca6f91a6b2d2c9eecc046d4be22221"},"projection":{"constraints":{"version":1,"common":{"documentDate":{"qualifier":"137","format":"203","pattern":"^[0-9]{12}$"},"positiveText":"OK"},"PRODAT":{"technicalProfile":["APERAK","D","96A","UN","E2SE6A"],"allowedErc":["100","40","41","42"],"allowedFunctions":["27","34"],"legalAgency":"SVK","legalQualifier":"160","countryPattern":"^[A-Z]{2}$","missingSuffix":" saknas","missingCustomerPrefix":" saknas, kundid","invalidPrefix":"Felaktigt ","agency":"260","textQualifier":"AAO","textMax":70,"fieldReferenceMax":3,"fieldLabels":{"202":"Meddelandenamn","203":"Meddelandeidentifikation","204":"Meddelandefunktion","205":"Meddelandedatum","206":"Tidszon","207":"Avsändare (Ediel-ID)","208":"Mottagare (Ediel-ID)","209":"Anläggnings-id","210":"Avtal, startdatum","211":"Avtal, slutdatum","212":"Datum för första mätaravläsning","213":"Uppskattad årsenergi","214":"Konstant för mätare","215":"Konstant, gammal mätare","216":"Giltighetsdatum - giltig from","217":"Mätmetod","218":"Antal siffror, mätare","219":"Antal siffror, gammal mätare","220":"Prioritet","222":"Rapporteringsfrekvens","223":"Transaktionstyp (undertyp)","224":"Mätarnummer","225":"Gammalt mätarnummer","226":"Ärendereferens","227":"Kund-id","228":"Namn-elanvändare","229":"Adress-elanvändare","231":"Postnr-elanvändare","232":"Postort-elanvändare","233":"Anläggnings-id","234":"Adress-anläggning","235":"Postnr-anläggning","236":"Postort-anläggning","237":"Land-anläggning","240":"Serie-id","242":"Produktkod","249":"Födelsedatum","250":"Fakturamottagare ID","251":"Namn-fakturamottagare","252":"Adress-fakturamottagare","253":"Postnr-fakturamottgare","254":"Avräkningsmetod (dygns/månads)","258":"Sekvensnummer","259":"Mätare, tidsintervall (räkneverkskod)","260":"Nätområdesid","261":"Referens till avtal/fullmakt","262":"Balansansvarig","301":"Fritext (huvud)","302":"Rapportstartdatum","303":"Fritext (per anläggning)","306":"Installationsstatus","307":"Tariffkod","308":"Leverantörens avtalsnr","310":"Kundstatus","311":"Application Reference","312":"Version","313":"Kvittensbegäran","314":"Sekvensnummer","315":"Avsändarens org.nr","316":"Land-elanvändare","317":"Postort-fakturamottagare","318":"Land-fakturamottagare","319":"Referens till anläggning","320":"Värmevärdesområde","321":"Rapportslutdatum","322":"Tillståndets status","323":"Tillståndets syfte","324":"Orsak till tillståndets upphörande","325":"Tillståndets id","326":"Tillståndets tidstämpel","327":"Tjänsten/rapporteringen upphör","506":"Produkt id (Energiprodukt)","508":"Tidslängd (tidsperiod)","513":"Riktning (Typ av anläggning)"},"applicationTexts":{"100":"Meddelandetyp/funktion är inte implementerad i applikationen","102":"Meddelandehuvudet kunde inte läsas","103":"Dubblett av meddelandet","104":"Liknande meddelande mottaget tidigare","105":"Anläggningen kan inte identifieras","106":"Liknande meddelande mottaget från annan aktör","107":"Aktören är inte knuten till aktuell anläggning","108":"Aktören är redan knuten till aktuell anläggning","109":"En period anges där endast en dag/tidpunkt förväntas","110":"Okänd eller ogiltig avsändare"},"source":{"id":"P","sections":["3.3","3.4","3.5"],"pages":[89,105],"availableBasis":"authenticated_original_page_excerpt"}},"UTILTS":{"technicalProfile":["APERAK","D","04A","UN","E5SE5A"],"allowedErc":["100","41","42"],"allowedDocumentStatuses":["312","313"],"messageFunction":"9","documentIdMax":35,"fixedOffset":["735","+0100","406"],"legalAgencies":["260","9","305"],"svkAgency":"260","svkQualifier":"SVK","agency":"260","textQualifier":"AAO","textMax":512,"fieldReferenceMax":17,"ownDmMax":70,"originalAcwMax":70,"missingText":"MANDATORY FIELD MISSING","invalidTextPattern":"^INCORRECT DATA .+$","source":{"id":"U","sections":["5.3","5.4","5.5"],"pages":[108,119],"availableBasis":"authentic_original"}},"CONTRL":{"technicalProfile":["CONTRL","2","2","UN"],"optionalAssociation":"EDIEL2","allowedActions":["1","4"],"forbiddenSegments":["BGM","DOC","ERC","FTX","RFF","NAD"],"originalUciMax":14,"source":{"id":"T","section":"2.1","availableBasis":"frozen_authenticated_contract"}}},"utiltsErr":{"version":1,"technicalProfile":["UTILTS","D","02B","UN","E5SE5A"],"documentCode":"ERR","documentAgency":"260","optionalDocumentCodeLists":["","SVK"],"documentIdMax":35,"allowedFunctions":["5","9"],"allowedAcknowledgementRequests":["AB","NA"],"documentDate":{"qualifier":"137","format":"203","pattern":"^[0-9]{12}$","noFuture":true},"fixedOffset":["735","+0100","406"],"marketCodes":["23","27"],"phaseCodes":["E02","E03","E04"],"agency":"260","identity":{"legalRoles":["MS","MR"],"ancillaryRoles":["DDK","DDQ","DDX","DEA","DEC","DER","DGG","DGI","EZ","MDR","PQ"],"legalAgencies":["260","9","305"],"gs1Agencies":["9","305"],"edielQualifier":"SVK","edielIdPattern":"^\\d{5}$","glnPattern":"^\\d{13}$","glnCheckWeights":[1,3]},"legalAgencies":["260","9","305"],"svkAgency":"260","svkQualifier":"SVK","subordinateRoles":["DDK","DDQ","DDX","DEA","DEC","DER","DGG","DGI","EZ","MDR","PQ"],"transactionQualifier":"24","ownTransactionIdMax":35,"originalTransactionIdMax":70,"responseQualifier":"E01","responseStatus":"41","referenceQualifier":"TN","allowedReasons":["E10","E14","E16","E18","E29","E47","E49","E50","E51","E55","E61","E62","E73","E87","E90","E97","E98"],"originalMessageCodes":["E30","E31","E66","E72","E73","E74","S01","S02","S03","S04","S05","S06","S07"],"forbiddenSegments":["ERC","FTX","DOC","LIN","SEQ","QTY","MEA","CCI","CAV"],"source":{"id":"U","section":"3.7.4","pages":[66,68],"reasonField":"531","validityPages":[122,126],"availableBasis":"authentic_original"}},"utiltsErrSourceCopyFields":[{"fieldNo":"209","tag":"LOC","qualifier":"172"},{"fieldNo":"533","tag":"LOC","qualifier":"175"},{"fieldNo":"260a","tag":"LOC","qualifier":"239"},{"fieldNo":"260b","tag":"LOC","qualifier":"232"},{"fieldNo":"260c","tag":"LOC","qualifier":"233"},{"fieldNo":"262","tag":"NAD","qualifier":"DDK"},{"fieldNo":"510","tag":"NAD","qualifier":"DDQ"},{"fieldNo":"524","tag":"NAD","qualifier":"BY"},{"fieldNo":"525","tag":"NAD","qualifier":"SE"},{"fieldNo":"526","tag":"NAD","qualifier":"EZ"},{"fieldNo":"511","tag":"PIA","qualifier":"1"},{"fieldNo":"245","tag":"DTM","qualifier":"324"},{"fieldNo":"223","tag":"STS","qualifier":"7"}],"registeredGuideScopes":[{"family":"UTILTS","guideVersion":"25-A-3","guideRevision":"3","version":"25-A-3:r3","canonicalGuideRevision":"25-A-3","associationAssignedCode":"E5SE5A","documentName":"251001_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-3"},{"family":"UTILTS","guideVersion":"25-A-4","guideRevision":"4","version":"25-A-4:r4","canonicalGuideRevision":"25-A-4","associationAssignedCode":"E5SE5A","documentName":"260331_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-4"},{"family":"PRODAT","guideVersion":"26.A","guideRevision":"3","version":"26.A:r3","canonicalGuideRevision":"26-A","associationAssignedCode":"E2SE6A","documentName":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B"},{"family":"CONTRL","guideVersion":"24-A-6","guideRevision":null,"version":"24-A-6","canonicalGuideRevision":"24-A-6","associationAssignedCode":null,"documentName":"260220_Ediel-anvisning-generella_tekniska_regler_version_24-A-6"}],"utiltsErrReasonGuideScopes":[{"family":"UTILTS","guideVersion":"25-A-3","guideRevision":"3","version":"25-A-3:r3","canonicalGuideRevision":"25-A-3","associationAssignedCode":"E5SE5A","documentName":"251001_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-3","allowedReasons":["E10","E14","E16","E18","E29","E47","E49","E50","E51","E55","E61","E62","E73","E87","E90","E97","E98","E19"],"source":{"document":"251001_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-3","sha256":"fad5cf4f775f86258ab9d5827426d54e57881b6298836110359cf0e41706a798","field":"531","pages":[131,138]}},{"family":"UTILTS","guideVersion":"25-A-4","guideRevision":"4","version":"25-A-4:r4","canonicalGuideRevision":"25-A-4","associationAssignedCode":"E5SE5A","documentName":"260331_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-4","allowedReasons":["E10","E14","E16","E18","E29","E47","E49","E50","E51","E55","E61","E62","E73","E87","E90","E97","E98"],"source":{"document":"260331_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-4","sha256":"0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be","field":"531","pages":[126,132]}}],"originalSources":[{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":140},{"id":"T","filename":"260220_Ediel-anvisning-generella_tekniska_regler_version_24-A-6(4).pdf","sha256":"5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951","pages":60},{"id":"U","filename":"260331_Ediel_UTILTS-APERAK_Anvisning_version_25-A-4.pdf","sha256":"0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be","pages":135}]}}'::jsonb value) edition;
INSERT INTO gridex_ediel_ack_guide.edition_extensions(original_source_version,extended_source_version)
SELECT original.source_version,'2aa60b57531a3bf2bf95c7e7cc66aa099bb8db4ac9a8e2fc26f8168d6083642c' FROM gridex_ediel_ack_guide.editions original WHERE original.source_version<>'2aa60b57531a3bf2bf95c7e7cc66aa099bb8db4ac9a8e2fc26f8168d6083642c' AND original.projection->'constraints'='{"version":1,"common":{"documentDate":{"qualifier":"137","format":"203","pattern":"^[0-9]{12}$"},"positiveText":"OK"},"PRODAT":{"technicalProfile":["APERAK","D","96A","UN","E2SE6A"],"allowedErc":["100","40","41","42"],"allowedFunctions":["27","34"],"legalAgency":"SVK","legalQualifier":"160","countryPattern":"^[A-Z]{2}$","missingSuffix":" saknas","missingCustomerPrefix":" saknas, kundid","invalidPrefix":"Felaktigt ","agency":"260","textQualifier":"AAO","textMax":70,"fieldReferenceMax":3,"fieldLabels":{"202":"Meddelandenamn","203":"Meddelandeidentifikation","204":"Meddelandefunktion","205":"Meddelandedatum","206":"Tidszon","207":"Avsändare (Ediel-ID)","208":"Mottagare (Ediel-ID)","209":"Anläggnings-id","210":"Avtal, startdatum","211":"Avtal, slutdatum","212":"Datum för första mätaravläsning","213":"Uppskattad årsenergi","214":"Konstant för mätare","215":"Konstant, gammal mätare","216":"Giltighetsdatum - giltig from","217":"Mätmetod","218":"Antal siffror, mätare","219":"Antal siffror, gammal mätare","220":"Prioritet","222":"Rapporteringsfrekvens","223":"Transaktionstyp (undertyp)","224":"Mätarnummer","225":"Gammalt mätarnummer","226":"Ärendereferens","227":"Kund-id","228":"Namn-elanvändare","229":"Adress-elanvändare","231":"Postnr-elanvändare","232":"Postort-elanvändare","233":"Anläggnings-id","234":"Adress-anläggning","235":"Postnr-anläggning","236":"Postort-anläggning","237":"Land-anläggning","240":"Serie-id","242":"Produktkod","249":"Födelsedatum","250":"Fakturamottagare ID","251":"Namn-fakturamottagare","252":"Adress-fakturamottagare","253":"Postnr-fakturamottgare","254":"Avräkningsmetod (dygns/månads)","258":"Sekvensnummer","259":"Mätare, tidsintervall (räkneverkskod)","260":"Nätområdesid","261":"Referens till avtal/fullmakt","262":"Balansansvarig","301":"Fritext (huvud)","302":"Rapportstartdatum","303":"Fritext (per anläggning)","306":"Installationsstatus","307":"Tariffkod","308":"Leverantörens avtalsnr","310":"Kundstatus","311":"Application Reference","312":"Version","313":"Kvittensbegäran","314":"Sekvensnummer","315":"Avsändarens org.nr","316":"Land-elanvändare","317":"Postort-fakturamottagare","318":"Land-fakturamottagare","319":"Referens till anläggning","320":"Värmevärdesområde","321":"Rapportslutdatum","322":"Tillståndets status","323":"Tillståndets syfte","324":"Orsak till tillståndets upphörande","325":"Tillståndets id","326":"Tillståndets tidstämpel","327":"Tjänsten/rapporteringen upphör","506":"Produkt id (Energiprodukt)","508":"Tidslängd (tidsperiod)","513":"Riktning (Typ av anläggning)"},"applicationTexts":{"100":"Meddelandetyp/funktion är inte implementerad i applikationen","102":"Meddelandehuvudet kunde inte läsas","103":"Dubblett av meddelandet","104":"Liknande meddelande mottaget tidigare","105":"Anläggningen kan inte identifieras","106":"Liknande meddelande mottaget från annan aktör","107":"Aktören är inte knuten till aktuell anläggning","108":"Aktören är redan knuten till aktuell anläggning","109":"En period anges där endast en dag/tidpunkt förväntas","110":"Okänd eller ogiltig avsändare"},"source":{"id":"P","sections":["3.3","3.4","3.5"],"pages":[89,105],"availableBasis":"authenticated_original_page_excerpt"}},"UTILTS":{"technicalProfile":["APERAK","D","04A","UN","E5SE5A"],"allowedErc":["100","41","42"],"allowedDocumentStatuses":["312","313"],"messageFunction":"9","documentIdMax":35,"fixedOffset":["735","+0100","406"],"legalAgencies":["260","9","305"],"svkAgency":"260","svkQualifier":"SVK","agency":"260","textQualifier":"AAO","textMax":512,"fieldReferenceMax":17,"ownDmMax":70,"originalAcwMax":70,"missingText":"MANDATORY FIELD MISSING","invalidTextPattern":"^INCORRECT DATA .+$","source":{"id":"U","sections":["5.3","5.4","5.5"],"pages":[108,119],"availableBasis":"authentic_original"}},"CONTRL":{"technicalProfile":["CONTRL","2","2","UN"],"optionalAssociation":"EDIEL2","allowedActions":["1","4"],"forbiddenSegments":["BGM","DOC","ERC","FTX","RFF","NAD"],"originalUciMax":14,"source":{"id":"T","section":"2.1","availableBasis":"frozen_authenticated_contract"}}}'::jsonb AND original.projection->'originalSources'='[{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":140},{"id":"T","filename":"260220_Ediel-anvisning-generella_tekniska_regler_version_24-A-6(4).pdf","sha256":"5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951","pages":60},{"id":"U","filename":"260331_Ediel_UTILTS-APERAK_Anvisning_version_25-A-4.pdf","sha256":"0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be","pages":135}]'::jsonb AND NOT(original.projection ? 'registeredGuideScopes') AND NOT EXISTS(SELECT FROM gridex_ediel_ack_guide.edition_extensions x WHERE x.original_source_version=original.source_version);
-- END CANONICAL RESPONSE GUIDE PROJECTION
CREATE SCHEMA gridex_received_err_response;
REVOKE ALL ON SCHEMA gridex_received_err_response FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_received_err_response.receipts(
 source_message_id uuid PRIMARY KEY REFERENCES gridex_ack_authority.source_correlations(ack_message_id),
 company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),
 payload_hash text NOT NULL,canonical_assessment_id uuid NOT NULL,
 correlated_original_message_id uuid NOT NULL,evidence jsonb NOT NULL,transactions jsonb NOT NULL,
 local_context jsonb NOT NULL,observed_at timestamptz NOT NULL
);
CREATE TABLE gridex_received_err_response.final_responses(
 source_message_id uuid NOT NULL REFERENCES gridex_received_err_response.receipts(source_message_id),
 transaction_id text NOT NULL,company_id uuid NOT NULL,environment text NOT NULL,
 ack_message_id uuid NOT NULL REFERENCES public.ediel_messages(id) DEFERRABLE INITIALLY DEFERRED,
 ack_payload_hash text NOT NULL,established_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(source_message_id,transaction_id)
);
ALTER TABLE gridex_received_err_response.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_err_response.receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_err_response.final_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_err_response.final_responses FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA gridex_received_err_response FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_err_response.receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_err_response.receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_err_response.final_responses FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_err_response.final_responses FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_received_err_response.require_v1(p_company uuid,p_environment text,p_source uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r gridex_received_err_response.receipts%rowtype;c gridex_ack_authority.source_correlations%rowtype;m public.ediel_messages%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source AND company_id=p_company AND environment=p_environment AND direction='inbound' FOR SHARE;
 SELECT * INTO r FROM gridex_received_err_response.receipts WHERE source_message_id=p_source;
 SELECT * INTO c FROM gridex_ack_authority.source_correlations WHERE ack_message_id=p_source;
 IF m.id IS NULL OR m.message_family IS DISTINCT FROM 'UTILTS_ERR' OR r.source_message_id IS NULL OR c.ack_family IS DISTINCT FROM 'UTILTS_ERR'
  OR r.company_id IS DISTINCT FROM m.company_id OR r.environment IS DISTINCT FROM m.environment OR r.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR r.payload_hash IS DISTINCT FROM c.ack_payload_hash OR c.company_id IS DISTINCT FROM r.company_id OR c.environment IS DISTINCT FROM r.environment
  OR r.canonical_assessment_id IS DISTINCT FROM c.canonical_assessment_id OR r.correlated_original_message_id IS DISTINCT FROM c.source_message_id
  OR r.evidence IS DISTINCT FROM gridex_ediel_source_rules.require_v1(p_company,c.source_message_id)
 THEN RAISE EXCEPTION 'utilts_err_application_response_authority_unavailable';END IF;
 RETURN jsonb_build_object('version',1,'sourceMessage',to_jsonb(m),'sourceRulePackEvidence',r.evidence,'sourceHash',r.payload_hash,
  'canonicalAssessmentId',r.canonical_assessment_id,'correlatedOriginalMessageId',r.correlated_original_message_id,'transactions',r.transactions,
  'localContext',r.local_context,'observedAt',r.observed_at,'authorizesBusinessEffect',false);
END $$;
CREATE FUNCTION gridex_received_err_response.capture_v1(p_company uuid,p_environment text,p_source uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c gridex_ack_authority.source_correlations%rowtype;m public.ediel_messages%rowtype;original public.ediel_messages%rowtype;
 captured gridex_received_sources.sources%rowtype;a gridex_received_sources.validation_assessments%rowtype;
 facts jsonb;evidence jsonb;expected jsonb;wire jsonb;source_wire jsonb;transactions jsonb;context jsonb;
BEGIN
 SELECT * INTO c FROM gridex_ack_authority.source_correlations WHERE ack_message_id=p_source;
 SELECT * INTO original FROM public.ediel_messages WHERE id=c.source_message_id FOR SHARE;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source AND company_id=p_company AND environment=p_environment AND direction='inbound' FOR UPDATE;
 IF EXISTS(SELECT FROM gridex_received_err_response.receipts WHERE source_message_id=p_source) THEN PERFORM gridex_received_err_response.require_v1(p_company,p_environment,p_source);RETURN;END IF;
 SELECT * INTO captured FROM gridex_received_sources.sources WHERE source_message_id=m.id;
 SELECT * INTO a FROM gridex_received_sources.validation_assessments WHERE id=c.canonical_assessment_id;
 wire:=gridex_ack_authority.wire_v1(m.raw_payload);source_wire:=gridex_ack_authority.wire_v1(original.raw_payload);
 IF m.id IS NULL OR m.message_family IS DISTINCT FROM 'UTILTS_ERR' OR m.message_standard IS DISTINCT FROM 'edifact' OR c.ack_family IS DISTINCT FROM 'UTILTS_ERR'
  OR c.company_id IS DISTINCT FROM p_company OR c.environment IS DISTINCT FROM p_environment OR c.ack_outcome IS DISTINCT FROM 'negative'
  OR original.id IS NULL OR original.company_id IS DISTINCT FROM p_company OR original.environment IS DISTINCT FROM p_environment OR original.direction IS DISTINCT FROM 'outbound'
  OR original.message_sent_at IS NULL OR original.immutable_rendered_at IS NULL OR c.source_payload_hash IS DISTINCT FROM original.immutable_payload_hash
  OR c.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(original.raw_payload,'UTF8')),'hex')
  OR c.ack_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR captured.raw_payload IS DISTINCT FROM m.raw_payload
  OR captured.company_id IS DISTINCT FROM p_company OR captured.environment IS DISTINCT FROM p_environment OR captured.payload_hash IS DISTINCT FROM c.ack_payload_hash OR captured.received_context IS NULL
  OR a.id IS NULL OR a.source_message_id IS DISTINCT FROM m.id OR a.company_id IS DISTINCT FROM p_company OR a.environment IS DISTINCT FROM p_environment OR a.source_payload_hash IS DISTINCT FROM c.ack_payload_hash
  OR a.owner IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR a.facts_hash IS DISTINCT FROM encode(sha256(convert_to(a.facts_text,'UTF8')),'hex')
  OR a.xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296)
  OR wire IS NULL OR wire->>'family' IS DISTINCT FROM 'UTILTS' OR wire->>'code' IS DISTINCT FROM 'ERR' OR NOT coalesce(gridex_ack_authority.source_match_v1(wire,source_wire),false)
 THEN RAISE EXCEPTION 'utilts_err_application_response_authority_unavailable';END IF;
 facts:=a.facts_text::jsonb;evidence:=gridex_ediel_source_rules.require_v1(p_company,original.id);
 expected:=jsonb_build_object('profileKey',evidence->'profileKey','messageProfileId',evidence->'messageProfileId','rulePackId',evidence->'rulePackId','sourceHash',evidence->'sourceHash','version',evidence->'version',
  'snapshot',jsonb_build_object('rulePack',evidence#>'{snapshot,rulePack}','messageProfile',evidence#>'{snapshot,messageProfile}','guideSources',evidence#>'{snapshot,guideSources}'));
 IF facts->>'owner' IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR facts->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR facts->>'applicationDecision' IS DISTINCT FROM 'accepted'
  OR facts->>'functionalDecision' IS DISTINCT FROM 'accepted' OR facts->'rulePackEvidence' IS DISTINCT FROM expected
  OR jsonb_typeof(wire->'ide') IS DISTINCT FROM 'array' OR jsonb_array_length(wire->'ide')=0
  OR EXISTS(SELECT FROM jsonb_array_elements_text(wire->'ide')t WHERE nullif(t,'') IS NULL)
  OR (SELECT count(*) FROM jsonb_array_elements_text(wire->'ide'))<>(SELECT count(DISTINCT t) FROM jsonb_array_elements_text(wire->'ide')t)
 THEN RAISE EXCEPTION 'utilts_err_application_response_authority_unavailable';END IF;
 SELECT jsonb_agg(jsonb_build_object('transactionIndex',n-1,'transactionId',t) ORDER BY n) INTO transactions FROM jsonb_array_elements_text(wire->'ide') WITH ORDINALITY x(t,n);
 -- The source's actual local outbound endpoint already had an immutable legal
 -- authority. Full physical reversal was proved by the correlation owner;
 -- this does not choose a current role or change the held receipt at insertion.
 context:=gridex_ediel_inbound_context.require_v1(p_company,original.id);
 IF context->>'transportEdielId' IS DISTINCT FROM wire#>>'{receiver,0}' OR context->>'legalEdielId' IS DISTINCT FROM wire->>'legalReceiver'
  OR context->>'applicationReference' IS DISTINCT FROM wire->>'app' THEN RAISE EXCEPTION 'utilts_err_application_response_authority_unavailable';END IF;
 context:=context||jsonb_build_object('basisKind','accepted_received_err_application','companyId',p_company,'environment',p_environment,'direction','inbound',
  'family','UTILTS_ERR','code','ERR','wireFamily','UTILTS','wireCode','ERR','observedAt',c.correlated_at,'sourceReceivedAt',m.message_received_at,
  'correlatedOriginalMessageId',original.id,'canonicalAssessmentId',a.id,'sourceHash',c.ack_payload_hash,'authorizesBusinessEffect',false);
 INSERT INTO gridex_received_err_response.receipts VALUES(m.id,p_company,p_environment,c.ack_payload_hash,a.id,original.id,evidence,transactions,context,c.correlated_at);
 INSERT INTO gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,canonical_assessment_id,original_source_message_id,evidence)
  VALUES(m.id,p_company,p_environment,'inbound',c.ack_payload_hash,a.id,original.id,evidence);
 PERFORM gridex_ediel_ack_guide.bind_source_v1(m,'national',evidence);
END $$;
-- New genuine ERR correlations get the response basis in the SAME application
-- transaction. Existing committed correlations replay first and are never
-- backfilled or reevaluated against a current guide/role.
ALTER FUNCTION gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) RENAME TO apply_before_received_err_response_v1;
CREATE FUNCTION gridex_ack_authority.apply_v1(p_company uuid,p_environment text,p_ack uuid,p_original uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;prior boolean;m public.ediel_messages%rowtype;
BEGIN
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 prior:=EXISTS(SELECT FROM gridex_ack_authority.source_correlations WHERE ack_message_id=p_ack);
 result:=gridex_ack_authority.apply_before_received_err_response_v1(p_company,p_environment,p_ack,p_original,p_actor);
 IF NOT prior THEN
  SELECT * INTO m FROM public.ediel_messages WHERE id=p_ack;
  IF m.message_family='UTILTS_ERR' THEN PERFORM gridex_received_err_response.capture_v1(p_company,p_environment,p_ack);END IF;
 END IF;
 RETURN result;
END $$;
ALTER FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RENAME TO require_before_received_err_response_v1;
CREATE FUNCTION gridex_ediel_inbound_context.require_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;basis jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id;
 IF m.direction='inbound' AND m.message_family='UTILTS_ERR' AND EXISTS(SELECT FROM gridex_received_err_response.receipts WHERE source_message_id=m.id) THEN
  basis:=gridex_received_err_response.require_v1(p_company_id,m.environment,m.id);RETURN basis->'localContext';
 END IF;
 RETURN gridex_ediel_inbound_context.require_before_received_err_response_v1(p_company_id,p_message_id);
END $$;
ALTER FUNCTION gridex_ediel_inbound_context.derive(public.ediel_messages,timestamptz) RENAME TO derive_before_received_err_response_v1;
CREATE FUNCTION gridex_ediel_inbound_context.derive(m public.ediel_messages,p_observed_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;basis jsonb;a jsonb;s jsonb;
BEGIN
 IF m.direction='outbound' AND m.message_family='APERAK' THEN
  SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND company_id=m.company_id AND environment=m.environment AND direction='inbound' FOR SHARE;
  IF source.message_family='UTILTS_ERR' THEN
   basis:=gridex_received_err_response.require_v1(m.company_id,m.environment,source.id);a:=gridex_ack_authority.wire_v1(m.raw_payload);s:=gridex_ack_authority.wire_v1(source.raw_payload);
   IF a IS NULL OR a->>'family' IS DISTINCT FROM 'APERAK' OR NOT coalesce(gridex_ack_authority.source_match_v1(a,s),false) THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required';END IF;
   RETURN basis->'localContext'||jsonb_build_object('basisKind','prescribed_outbound_ack','originalSourceMessageId',source.id,'originalSourceHash',basis->'sourceHash','direction','outbound','wireFamily','APERAK','wireCode',a->>'code');
  END IF;
 END IF;
 RETURN gridex_ediel_inbound_context.derive_before_received_err_response_v1(m,p_observed_at);
END $$;
CREATE FUNCTION public.ediel_read_received_err_application_response_authority_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active' FOR SHARE;
 IF NOT FOUND OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501';END IF;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501';END IF;
 RETURN gridex_received_err_response.require_v1(p_company_id,p_environment,p_source_message_id);
END $$;
ALTER FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text) SET SCHEMA gridex_received_err_response;
ALTER FUNCTION gridex_received_err_response.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text) RENAME TO require_positive_before_received_err_v1;
CREATE FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_transaction_id text,p_ack_message_id uuid DEFAULT NULL,p_ack_raw_payload text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;basis jsonb;f gridex_received_err_response.final_responses%rowtype;ack public.ediel_messages%rowtype;
BEGIN
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id AND environment=p_environment FOR SHARE;
 IF source.message_family IS DISTINCT FROM 'UTILTS_ERR' THEN RETURN gridex_received_err_response.require_positive_before_received_err_v1(p_company_id,p_environment,p_source_message_id,p_transaction_id,p_ack_message_id,p_ack_raw_payload);END IF;
 basis:=gridex_received_err_response.require_v1(p_company_id,p_environment,p_source_message_id);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(basis->'transactions')t WHERE t->>'transactionId'=p_transaction_id) THEN RAISE EXCEPTION 'utilts_err_application_response_authority_unavailable';END IF;
 IF p_ack_message_id IS NOT NULL OR p_ack_raw_payload IS NOT NULL THEN
  SELECT * INTO f FROM gridex_received_err_response.final_responses WHERE source_message_id=p_source_message_id AND transaction_id=p_transaction_id;
  SELECT * INTO ack FROM public.ediel_messages WHERE id=p_ack_message_id AND company_id=p_company_id AND environment=p_environment AND direction='outbound';
  IF ack.id IS NULL OR f.ack_message_id IS DISTINCT FROM p_ack_message_id OR ack.related_message_id IS DISTINCT FROM p_source_message_id OR ack.raw_payload IS DISTINCT FROM p_ack_raw_payload
   OR f.company_id IS DISTINCT FROM p_company_id OR f.environment IS DISTINCT FROM p_environment OR f.ack_payload_hash IS DISTINCT FROM encode(sha256(convert_to(p_ack_raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'utilts_err_application_response_authority_unavailable';END IF;
 END IF;
 RETURN jsonb_build_object('authorityVersion',1,'companyId',p_company_id,'environment',p_environment,'sourceMessageId',p_source_message_id,'transactionId',p_transaction_id,'ackMessageId',p_ack_message_id,
  'sourceRawHash',basis->'sourceHash','ackRawHash',CASE WHEN p_ack_message_id IS NULL THEN NULL ELSE encode(sha256(convert_to(p_ack_raw_payload,'UTF8')),'hex') END);
END $$;
ALTER FUNCTION gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(public.ediel_messages,boolean) RENAME TO require_positive_before_received_err_v1;
CREATE FUNCTION gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(m public.ediel_messages,p_sending boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;a jsonb;s jsonb;groups jsonb;g jsonb;ids text[]:='{}';dms text[]:='{}';tx text;dm text;
BEGIN
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'APERAK' THEN RETURN;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND company_id=m.company_id AND environment=m.environment AND direction='inbound' FOR SHARE;
 IF source.message_family IS DISTINCT FROM 'UTILTS_ERR' THEN PERFORM gridex_ediel_outbound_owner.require_positive_before_received_err_v1(m,p_sending);RETURN;END IF;
 a:=gridex_ack_authority.wire_v1(m.raw_payload);s:=gridex_ack_authority.wire_v1(source.raw_payload);groups:=a->'ercGroups';
 IF a IS NULL OR a->>'family' IS DISTINCT FROM 'APERAK' OR a->>'code' IS DISTINCT FROM '312' OR a#>>'{type,2}' IS DISTINCT FROM '04A' OR a#>>'{type,4}' IS DISTINCT FROM 'E5SE5A'
  OR NOT coalesce(gridex_ack_authority.source_match_v1(a,s),false) OR jsonb_typeof(groups) IS DISTINCT FROM 'array' OR jsonb_array_length(groups)=0 THEN RAISE EXCEPTION 'utilts_err_application_response_authority_unavailable';END IF;
 FOR g IN SELECT x FROM jsonb_array_elements(groups)x LOOP
  tx:=g#>>'{acw,0}';dm:=g#>>'{dm,0}';
  IF g->>'code' IS DISTINCT FROM '100' OR jsonb_array_length(g->'acw')<>1 OR jsonb_array_length(g->'dm')<>1 OR nullif(tx,'') IS NULL OR nullif(dm,'') IS NULL OR length(dm)>35 OR tx=ANY(ids) OR dm=ANY(dms) THEN RAISE EXCEPTION 'utilts_err_application_response_authority_unavailable';END IF;
  ids:=array_append(ids,tx);dms:=array_append(dms,dm);
  PERFORM public.gridex_require_utilts_positive_ack_authority_v1(m.company_id,m.environment,source.id,tx,CASE WHEN p_sending THEN m.id ELSE NULL END,CASE WHEN p_sending THEN m.raw_payload ELSE NULL END);
 END LOOP;
END $$;
CREATE FUNCTION gridex_received_err_response.bind_final_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;a jsonb;tx text;prior gridex_received_err_response.final_responses%rowtype;
BEGIN
 IF NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_family IS DISTINCT FROM 'APERAK' THEN RETURN NEW;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=NEW.related_message_id AND company_id=NEW.company_id AND environment=NEW.environment AND direction='inbound' FOR UPDATE;
 IF source.message_family IS DISTINCT FROM 'UTILTS_ERR' THEN RETURN NEW;END IF;
 PERFORM gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(NEW,false);a:=gridex_ack_authority.wire_v1(NEW.raw_payload);
 FOR tx IN SELECT jsonb_array_elements_text(a#>'{refs,ACW}') LOOP
  SELECT * INTO prior FROM gridex_received_err_response.final_responses WHERE source_message_id=source.id AND transaction_id=tx;
  IF FOUND AND (prior.ack_message_id IS DISTINCT FROM NEW.id OR prior.ack_payload_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'utilts_err_application_response_final_scope_conflict' USING ERRCODE='23505';END IF;
  IF NOT FOUND THEN INSERT INTO gridex_received_err_response.final_responses(source_message_id,transaction_id,company_id,environment,ack_message_id,ack_payload_hash) VALUES(source.id,tx,NEW.company_id,NEW.environment,NEW.id,encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex'));END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER a_gridex_bind_received_err_application_response BEFORE INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_received_err_response.bind_final_v1();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_received_err_response FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid),gridex_ack_authority.apply_before_received_err_response_v1(uuid,text,uuid,uuid,uuid),gridex_ediel_inbound_context.require_v1(uuid,uuid),gridex_ediel_inbound_context.require_before_received_err_response_v1(uuid,uuid),gridex_ediel_inbound_context.derive(public.ediel_messages,timestamptz),gridex_ediel_inbound_context.derive_before_received_err_response_v1(public.ediel_messages,timestamptz),gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(public.ediel_messages,boolean),gridex_ediel_outbound_owner.require_positive_before_received_err_v1(public.ediel_messages,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_read_received_err_application_response_authority_v1(uuid,text,uuid,uuid),public.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_read_received_err_application_response_authority_v1(uuid,text,uuid,uuid),public.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text) TO service_role;
COMMIT;
