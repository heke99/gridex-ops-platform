K10: importen nådde parse/match men nekades vid kvittoklockan – 2026-11-15

**Fyra genuina nativeåtgärder lyckades och ACK/checkpoints förseglades. En normal File-POST200 gav därefter denied/unknown utan retry.** POST-lookupen fungerade nu:200/null kl07:06:12.723, följd av envelope201 kl12.783. Tre inbound-scopes avancerade, men ingen ekonomisk/native14/lineageförändring kvalificerades. Antalen kvarstår **38 PASS / 1 gap / 66 ofullständiga**; inget exakt totalt försöksantal av alla slag påstås.

Detta tillägg använder det sparade diagnosunderlaget senast07:19:27 UTC och avslutade K10-kvitton. En separat nedan daterad efter-avslut-extraktion ur dump lades till före dokumentfrysning; den görs inte om till en tidigare livefråga. Senare fixar och resursarbete fylls inte bakåt i utfallet. Exakta hashar finns i [results.safe.json](results.safe.json).

| Gräns | Faktiskt resultat | Fortsatt begränsning |
| --- | --- | --- |
| ISSUE → RECEIVE → PREPARE → ATTEST | Alla fyra genuina ACKs/checkpoints. Root granskade **nytt** dokument2ca386 med reviewa770 före ATTEST. | Ingen återanvänd granskning från K9, kundsignatur eller ekonomisk acceptans påstås. |
| Normal File-import | En POST200; UI denied, ACKunknown. Ny lookup-POST200/null och envelope201. | Ingen retry. HTTP200 eller mottagen envelope är inte full import-PASS. |
| Parse/match | inbound_email6→7, parse_results7→8, match_attempts0→2. | Finansiell graf/native14/lineage och övriga kvalificerade klonscopes oförändrade. Hela klonen var alltså **inte** oförändrad. |
| Faktiskt nytt fel | `ediel_actual_inbound_receipt_clock_required`,43 tecken, SHA cd0e4092…; appfel och UI-observation överensstämmer. | Faktiskt värde för `received_at` var **inte observerat** vid cutoff. FullJSON innehåller aggregatehash/count, inte radens scalars. Påstå inte faktisk NULL. |

Källspåret visar att normal mailproducent sätter `received_at` från faktisk mottagning eller serverns observationstid; IMAP-adaptern använder internalDate. Raw test-center-insert utelämnar däremot fältet och sätter created/updated från serverns nu. Den existerande guarden kräver verklig, giltig mottagningsklocka. Kombinationen är en konkret källdiagnos, men exakt historiskt radvärde måste fortfarande läsas ur bevarat underlag. Klonen var redan stängd när en separat scalarprojektion föreslogs.

Korrekt framåtriktning är att en **ny** File-envelope får riktig serverobserverad mottagningstid vid första persistens, skild från businessAsOf och rå EDIFACT-DTM. Gamla dedupe-/replayrader får inte bakfyllas och klockguarden ska inte försvagas. Ingen fix eller aktuell run-reparation görs genom denna rapport.

Den tidigare GET-blockern är passerad i K10:s faktiska lookuptrafik. K9:s isolerade279567-byte GET gav431 i komponentförsök, men historisk K9-wire431 fångades aldrig; den distinktionen bevaras. Den tidigare source-only POST-fixen hade före K10 separat native-/HTTP-kvalificering. K10:s65-valda/full2193-källprofil fick scoped compiler-PASS:1563 Programfiler,817 lokala,0 diagnostics, exit0/noOOM och oförändrade källor. Detta är ingen fullprojektkontroll eller allomfattande Next-typverifiering.

O:s ursprungliga Auth-target3dcd förblev NOTRUN: kompileringen slutade tio sekunder efter full3000-fönstrets sista start. Inga TTL-gränser sänktes. Därefter kvalificerades normal officiell P-förnyelse, MainK och genuint **ny** READY med färsk efter-READY Main/Fc/all7-sekvensbas. Full3000/perfas900 och övriga tillämpliga guards ersattes inte av gammal session eller gammal baslinje.

Två separata driftprecisioner är viktiga. Entry805306368byte/TMP134217728byte (768MiB/128MiB) passerade faktiskt; senare allokeringar gav ändå resursbrist i privatkörningen. Failure-dump-reserven134217728 byte avskaffades inte. Exakt bytejämförda slutna fullfångster deduplicerades med hardlinks, med alla originalvägar och bevis kvar. Där en andra faktisk helgrafsläsning gjordes i minnet och matchade kanoniska bytes användes denna läsning+hash+link; det beskrivs inte som en påhittad fysisk skrivning följd av unlink. Planerade besparingar är inte faktiska.

Roots första jämförelse slog KeyError på fel `external_id`-nyckel **före** slutgranskningen. Korrekt `metering_point_id` användes därefter och faktisk dokument-/nativekontroll passerade i nya reviewa770. Det första misslyckandet suddas inte ut. Importens unknown-ACK409 med utgången färskhetsgräns bevaras utan retry.

K10 är avslutad: runtime, forwarder, klon/REST och browser stängda. UI-logout=false behålls, separat egen Auth GET200/local-logout204 och native sessions/refresh0 är kvalificerade. Main och alla sju sekvenser bevarades före egen logout. Över efterföljande logout ändrades bara fyra Auth-scopes: sessions/refresh/AMR1→0 och audit257→258; andra518 tabeller och3370 funktioner/metadata bevarades. Ingen generell JWT-invalidering eller helt oförändrad Main över logout påstås.

Efter avslutet tillkom separat faktiskt scalarbevis: en av sju envelope-rader matchade exakt eget ID/bolag/test/råhash7c. `received_at` var COPY\N/JSONnull, created_at2026-11-15 07:06:12.724+00. Filtrering av den förseglade Fc-dumpen77e2 med pg_restore gav exit0 på0,344s och216962 streambyte, utan databasanslutning, DB-restore eller skrivning; originaldumpen bevarades. Oberoende actualgranskning är bunden i JSON. Detta stärker nu den konkreta klockdiagnosen, men reparerar inte historisk liveNOTRUN, unknown-ACK eller importen. Ingen klockfix har native-/browser-PASS här.

Nästa riktiga väg fortsätter från normal File-mottagning med giltig mottagningsklocka, via bevarad tenant/nativebasis till faktisk import och finansiell graf. Det kräver nytt kvalificerat käll-/native-/runtimeunderlag och separat genuin körning, inte reset eller replay av K10. Tidigare rapporter, gamla originalblockerare och kanoniska statusar bevaras. Dokumentarbetet kör ingen backend, Node, Auth, RAW-restore eller produktändring och gör ingen push.
