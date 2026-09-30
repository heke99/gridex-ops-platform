# U-03 / ACK-03 — native syntax och huvudscope, test först

Baseline `d30fa0203f0499a8e15faeddda7676af81296c86` är slutverifierad: 439/439 native och fem obligatoriska arbetsflöden SUCCESS. SC-044 PASSED har separat fullständigt kvitto. E72/E73/ERR/S02 ska inte göras om.

Aktiva kriterier: U-03/AT-U-03 syntax före anvisning/funktion; ACK-03/AT-ACK-03 huvudfel utan uppfunnen fysisk IDE; SC-045 negativ U-APERAK på huvudnivå och inga efterföljande funktionskontroller. U §5.2/5.3–5.5, original SHA256 `0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be`; fält206 huvudets DTM735, ERC41 vid saknat fält. BGM313 är negativ svarskod, inte fältnumret i denna fixture.

## Test-only native-paket

Tre nya prov i `scripts/ediel-utilts-err-gateway-native.test.ts`; ingen produktändring:

| Fall | Verklig kontroll / fel | Orakel |
| --- | --- | --- |
| Direkt UNT-antal | Valid accepterad E66-kontroll, sedan en ny source med endast UNT/0074=999. | Befintlig full syntaxvalidator avvisar. Verklig direkt konsument får inte lagra accepterad serie/kontrakt eller skapa APERAK/ERR; tillämplig negativ technical CONTRL, noll downstream-sinks och stabil retry. |
| Direkt UNH/UNT-reference | Samma giltiga kontroll; endast trailer0062 blir OTHER. | Samma syntax-före-affärseffekt och full retry; ingen policy-/fixture-/mode-bypass. |
| SC-045 huvud206 | Valid tvåIDE-kontroll: egen positiv serie/APERAK +egen E87 ERR. Ta sedan bort endast huvudets DTM735 och räkna om inklusivt UNH→UNT. | Syntax fortsatt godkänd; inga funktionella issue/svar eller accepterad data; ett negativt meddelandesvar BGM313/ERC41/206, message-scope, ingen fysisk ACW, käll-/tenant/policybindning och stabil retry. |

Fixture-buildern beräknar först giltigt UNT. Native-helpern ändrar enbart UNB/UNZ-referenser. Source capture sker med den verkliga INSERT-triggern; inga prefilled regelbevis. Parser, matching, canonical policy/dispatcher, privata SQL receipts/reservationer, ACK-gateway/writer/finalizer är verkliga. Endast efterföljande meter/billing/completion-sinks observeras, inga transportworkers eller nätverkssändningar.

Kandidaterna är **oprövade beständiga risker** tills native faktiskt visar dem. Source-inspektion pekar på direkt syntaxgate som bara ser UNB/UNH och huvudfel som blir två per-IDE-APERAK med BGM/IDE som ACW. Ett verkligt guardavslag ska läsas och får inte kringgås för att tillverka RED. Full grammar, tom fysisk IDE, DM-unikhet, manual positive-storage, PRODAT mixed mutations och same-IDE-samtidighet är andra grindar.

Oberoende fixture-/facitgranskning `/root/acceptance_ack03`: APPROVE; UNH/DOC/egen DM och faktisk reservationsfinalisering förstärks i oraklet. Internal finalisering på samma huvud-ACK är implementeringsbevis, ingen föreskrift om Ediels databasmodell. `/root/acceptance_u02` refuterar affärslagringsrisken i UNH/UNT-ref-fallet: befintlig singleMessage identity-guard håller den IDE:n internt, men runtime-planen ser fortfarande positiv syntax-CONTRL. Där väntas ett eventuellt native-fel alltså vid kvittensnivå, inte ett andra påstått affärsskrivningsgap. UNT-antalets beständiga beteende och båda faktiska CI-utfallen är fortfarande okörda.

UNT-fixturerna använder en ny fysisk IDE efter den faktiskt konsumerade positiva kontrollen och en separat giltig men okonsumerad companion med samma nya IDE. Endast trailern ändras från den nya giltiga formen. Därmed kan en redan lagrad kontrollserie inte återanvändas av SQL och dölja ett fel eller skapa en ovidkommande binding-conflict. Oraklet kontrollerar även accepterad reservation, applikations-ACK och sinkcalls, inte bara source-filterade lagringsrader.

Planerad native total: 439 befintliga +3 =442. Local scripts TypeScript/orakelgranskning är bara statisk verifiering; ingen lokal PostgreSQL/Docker är tillgänglig. Publicera prov-/beviscommit på samma draft utan force-push, läs första verkliga CI-fel och gör först därefter minsta produktändring. Avsaknad av affärsoutbox i denna direkta testkonsument är en karakterisering; en korrekt framtida ACK-outbox är inte nationellt förbjuden.

Skill routing: per-ID `spec-to-code-compliance` och oberoende facit/refutation; TDD/native, systematisk debugging, canonical policy/tenant/SQL/callgraph, differential review och verification-before-completion. Inga UI-/performance-/externa operativa förändringar. Root enda skrivare; oberoende read-only reviewers granskar fixture/scope före publication.

Draft #421, #310 orörd, trafik HELD; inga staging/TGT/AGT/motpartsprov/verklig sändning. Whole 121/231 och masterplan är fortsatt öppna enligt den fullständiga aktuella ID-avstämningen.

Oberoende slutreview av hela prov-/bevisdiffen `/root/review_err_policy_facade`: APPROVE, inga introducerade Critical/Important. Alla352 originalkriterier/statusar/grindar och354 committed hash/byte/changeflags kontrollerade; faktisk SC044/replay/artefaktkvitto inspekterat. Minor-grindförtydligande korrigerat: deadline/schemalagd bevakning hör till SC054, inte extra U14/ATU14-kriterier.
