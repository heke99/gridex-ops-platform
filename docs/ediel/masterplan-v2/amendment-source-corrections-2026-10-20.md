# Precisa källrättningar — tillägg 2026-10-20, version1

Detta är ett additivt kravtillägg till frysta masterplan-v2 på bas
`fd4acbc50e9d73c7f2f317d3e806723522708b16`. Det ändrar inga frysta filer,
121 regelposter, 231 kontrakt eller deras statusar. Här skiljs källans krav,
redan befintligt beteende och återstående verifiering. Varje nedan nämnt
test är en läsingång; ett filnamn påstår ingen färsk fullständig provkörning.

T är svenska generella tekniska regler 24-A-6, SHA256
`5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951`.
P är aktuell PRODAT 26-A/16-B, SHA256
`83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`.
U5 är enbart svenska UTILTS 25-A-5, med hash och datum i
[det aktuella källmanifestet](../utilts-25a5/source-manifest.json).
Generell AP 05.B.5 ersätter inte P-/U-specifika APERAK-profiler.

1. ENV/gemensamt kuvert: ersätt planens ”UNA om använd” med obligatoriskt UNA
   vid svensk Ediel-sändning, T4.1.1 p23. Separat mottagartolerans bevaras.
   `EdifactEnvelopeCodec.encode` skickar redan UNA via gemensam serializer.
   Detta dokumenterar ett korrekt befintligt beteende och ett fel i plantexten.
2. CV-SYNTAX/ST-T07/nationell CONTRL: T2.1.3 p14 föreskriver UNH/UCI/UNT,
   med rätt originalkorrelation och åtgärd 1/4 i nationell CONTRL 2:2.
   UCM/UCS/UCD är inte obligatorisk nationell sändstruktur. Intern
   feldiagnostik och källstödd inkommande internationell tolerans skiljs från
   nationell sändprofil. `contrlEngine` bygger redan den nationella kärnan.
3. U-14/AT-U-14/CV-U-STORE: U5 §3.6.6 p37 kräver positiv APERAK för en
   annars giltig nyare rättelse när erforderlig avisering ännu inte hunnit
   fram. Mottagaren FÅR vänta med hantering/lagring av mätvärden. Efter
   avisering får ingen andra positiv eller negativ Edielkvittens skickas.
   Ett särskilt vänteläge är inte obligatoriskt. Beständigt original,
   disposition och ACK-avsikt kvarstår som internt säkerhetskrav; normalt
   lagringsfelprov kvarstår. Saknat funktionsnamn visar inget runtimefel.

I följande 15 AT-kontrakt ska `expected` prövas på positivgrenen,
`on_failure` som förväntad åtgärd vid sitt specificerade fel, och förbjuden
effekt anges uttryckligen per gren. Den frysta kopieringen av hela
`on_failure` till `prohibited` får inte tolkas som förbud mot rätt felåtgärd.

| Kontrakt | Positivgren | Fel-/gränsgren som ska bevaras | Förbjuden effekt |
| --- | --- | --- | --- |
| AT-GOV-03 | Välj familjebunden P-/U-APERAK. | Stoppa blandad eller okvalificerad profil. | Generisk GAS16-B-APERAK för EL eller godtyckligt nytt gemensamt wirebyte. |
| AT-GOV-06 | För sammanhängande explicit tids-/guidebeslut vidare. | Stoppa lokalt osammanhängande beslut före mutation. | Externt fältavslag för ett eget internt kontextfel. |
| AT-TEN-06 | Härled entydig ansvarig aktör och rätt tenant/servicekontext. | Håll oklar attribution i skyddad karantän. | Gissad tenant från kund-id eller mutation i fel tenant. |
| AT-TEN-14 | Aktivera enbart efter konkreta avtal/rättigheter och dataansvar. | Låt uppdraget förbli spärrat när bevis saknas. | Aktivering enbart från rollnamn eller intern grant. |
| AT-IMP-01 | Läs rätt XML-/TXT-struktur till typad normalform. | Avvisa oläsbar post med diagnos. | Att redovisa 0 användbara routes som lyckad import. |
| AT-ENV-06 | BGM bär Z-funktion; CCI/CAV bär korrekt undertypskod. | Avvisa fel egen kombination på rätt kontrollnivå. | BGM+Z03L eller validering mot en annan undertyp. |
| AT-ENV-07 | Batcha kompatibla objekt med samma PRODAT-funktion. | Dela en föreslagen inkompatibel sändbatch. | Blandade PRODAT-funktioner i samma UNB–UNZ. |
| AT-P-02 | Ignorera tillåtna nationella extra X/ej tillämpliga D i affärsprojektionen. | Skilj verkligt syntaxöverskott från nationellt tillåten extra information. | Negativ APERAK enbart för extra information som källan säger ska ignoreras. |
| AT-P-03 | Pröva varje D-villkor; falskt kan ge O eller X enligt källan. | Okänd lokal förutsättning blockerar egen sändning. | Universell D=false→X eller sändning med gissade obligatoriska fakta. |
| AT-P-05 | Pröva egna registervillkor och tillåten första-registerärvning. | Hantera register2+ enligt bilaga2, inklusive ignorerbara extra fält. | Att kopiera alla basmatrisens R till register2+. |
| AT-P-07 | Placera506 i andra7110; rapport90/91 och faktiskt LIN. | Klassificera saknat/fel eget fält på rätt nivå. | Att använda positivt exempel som generell norm eller byta till242/92/93. |
| AT-P-08 | Z09D bär 210 XOR211; bygg92 eller93. | Båda datumen ger P-APERAK40/109. | Generell157 eller 216 som ersättning. |
| AT-P-17 | Obruten LIN-sekvens från 1; fortsätt över egna objekt/register. | Fel314-sekvens avvisar hela meddelandet med P-APERAK BGM27 och relevant fel. | Att godkänna resten partiellt eller kalla sekvensfel felaktigt anläggningsid. |
| AT-ESCO-07 | Avsluta bara korrelerat marknadstillstånd eller historikjobb. | Oklar/fel egen upphörandekontext får inte ändra andra rättigheter. | Historikslut som upphäver separat V-tillstånd eller DDQ-leverans. |
| AT-TR-02 | Registrera egna transportförsök och deras faktiska observationer. | Okänt sändutfall förblir uttryckligen okänt. | Att `sent` ensam betyder leveransaktiv eller att SMTP innebär APERAK/affärsgodkännande. |

Detta är 15 dokumentära grenpreciseringar, inte15 nya påvisade runtimefel.
AT-P-17/SC-034 har särskild källa P bilaga4 p119; befintliga läsingångar är
`prodatRegisterGroups.ts`, `prodatAckMessageFunction.ts` och
`ediel-prodat-registers.test.ts`. Andra befintliga läsingångar är
`prodatDependentConditionEngine.ts`, `prodatRegisterGroups.ts`,
`canonicalPolicyFieldValidator.ts` och respektive AT-rads coverageevidens.
Det frysta ledgervärdet ensam bevisar inte den här preciseringens alla grenar.

ST-E07/ST-E09 kompletteras med följande uttryckliga interna övergångar.
Varje svar ska först kvalificeras mot eget original, ärende, parter,
miljö, transaktion och tillstånd; tabellen ger ingen fristående authority.

| Eget nuvarande tillstånd/händelse | Förväntad fortsatt hantering |
| --- | --- |
| `termination_requested`, giltigt eget Z15 efter Z18 | Avsluta det berörda tillståndet; andra tillstånd och DDQ bevaras. |
| Begärt eget tillstånd, giltigt negativt Z14 före positiv APERAK | Tillämpa det faktiska avslaget utan att invänta en ordningsmässigt tidigare ACK. |
| `overdue`/bevakning eller saknad ACK, senare giltigt eget Z14/Z15 | Korrelatera och tillämpa det faktiska svaret; timeout är ingen ny marknadsstatus. |
| Samma redan tillämpade original/svar igen | Idempotent hantering utan dubblerad marknadseffekt. |

`permissionMarketTransition.ts`, den befintliga egna svarskorrelationen och
`ediel-permission-process-order.test.ts` är läsingångar. Koden har redan
relevanta negativa Z14- och Z18→Z15-grenar. Ingen ny runtimebrist härleds ur
den frysta tillståndstabellens lucka. Verklig DB-/outbox-verifiering prövas
separat; nya källrättningar ska inte ersätta tidigare kvalificerad evidens.

PRODAT-kvalificeringarna läses med aktuellt P26-underlag:

- CASE-Z09E avser enbart dödsfall, P p112. Den bilaterala generella E-ändringen
  för Z06E utvidgar inte Z09E. Använd befintlig `prodatDeathStatus.ts` och
  egna wire-/händelsevillkor i `prodatDependentConditionEngine.ts`.
- PG-IV omfattar även ändrad-till-samma-adress i Z06E, P p109. Rätt egna
  adressvärden ska fortfarande rapporteras. `prodatInvoicee.ts` är läsingång.
- Positivt Z14 kopierar det egna mottagna Z13-syftet 323, P p74. Ett generellt
  förbud för företagskund är fel: officiellt TGT ESCO8.1.3 har B72 för
  Sonjas Fröhandel AB. Det enskilda fallet gör inte 323 universellt obligatoriskt
  eller universellt utelämningsbart. TGT-original är inte ett utfört marknadsprov.

UTILTS-fält-/kontrollprojektionerna preciseras mot svenska U5:

| Fryst läsingång | Korrigerat källvillkor och normgrad |
| --- | --- |
| UF-metering_settlement-260a-54 / C57 | Fortsättningen p55 gäller: E30 är valfritt; i angivna Exchange-profiler med 260b+260c anges inte 260a. S01/S05 beror på OT. |
| UF-metering_settlement-527-57 / C78 | Fortsättningen p58 skiljer mätarställningar från energivärden; E30/E66/S07 när ställningar rapporteras och källans register-/mätmetodsvillkor gäller. |
| QTY136-grupp / C94–96 | Föräldravillkoret p61: gruppen används inte vid enbart priser/belopp. Barnets R gäller inom tillämplig energigrupp. |
| UG-125-9 / C218 | `1519` är värdet15 plus upphöjd fotnot19 ”För kvartsvärden”. Bevara den separata60-regelns avtal-/datumvillkor. |
| UG-121-7 | Fortsättningen pp121–122 anger aktuell och föregående giltig guide under två veckors övergång. |
| NULL-mätarställning / SG12 CAV | U5 p99 kräver ursprung E27 vid NULL. NULL ska inte omvandlas till en känd nolla. |
| Typade identiteter | GSRN 18 siffror utan AI 8018, U5 p78/134–135. GIAI upp till 30 tecken utan AI 8004 ; 16 är ett svenskt exempel. Nationell byrå 89 ska inte få generell GSRN-begränsning. |
| E14-fallback | U5 p133 gäller annan domänvalidering vid inläggning som inte passar specificerade kontroller och omöjliggör lagring. Använd så långt möjligt inte E14. Vanliga SQL-/infrastruktur-/tenantincidenter hålls interna. |
| UG-124-12 | Källans PIS-locator annoteras som PIA/C212/7143 enligt detalj p81; bevara originalets tryckfel. |
| UF-error-503-67 | Källans BGM/C106/1001 annoteras: dokumentnamn1001 hör till C002; C106 avser1004. |
| UG-127-25 | Det avklippta namnet fortsätter på p128; detta är en etikettkomplettering. |
| CV-U-FN-224/527 | Hänvisningen för E61/E62 är p132, inte p131. Mappningen ändras inte av sidrättningen. |

Råtabeller är fortsatt underlag, inte direkt validator. Fortsättnings- och
föräldravillkor ska följas tillsammans med aktuell profil och verkliga egna
fakta. Befintliga runtimeingångar är bland annat `utiltsEngine.ts`,
`utiltsRulebook.ts`, `quantityUnitScope.ts` och typade observations-/strukturägare.
De historiska [E61/E62](amendment-prior-utilts-e61-e62-2026-09-24.md)- och
[identitetstilläggen](amendment-prior-utilts-identity-2026-09-28.md) behåller
sin uttryckliga äldre utgåvescope och blir inte retroaktiv svensk U5-källa.

Källspänningar ska förbli synliga: detaljerad LIN p80 innehåller 7331507000105
som appendixlistan p124 utelämnar; detaljerad MEA p85 innehåller SEC/CEL som
p126 utelämnar; diagrammets SG8-kardinalitet skiljer sig från nationell
detalj. Välj rätt nationellt/internationellt lager med kvalificering i berörd
implementation. Detta tillägg inför varken blind union eller nytt generellt
avslag för dessa fall.

Handbok 26B, skilda metodbytes-/underrättelsefrister och första ESCO-rapportstart
har en egen aktuell läsingång i [handbokspaketet](../handbook-26b/README.md).
Mottagning, fullständig begäran, senare start, kundgodkännande, fysisk ändring
och lokal ACK/apply-tid är skilda ankare. Detta tillägg skriver inte om den
redan levererade 26B-policyn eller dess separata verifieringsscope.

Framtida P27-A, el-wire 2027-04-01 och sistahandsleverantör 2027-07-01 är
separat framtidsarbete. Nuvarande U5-rolltext, EIFS-kundinformation och
interna tenantgrants får inte användas som påhittade energidelningstillstånd.
Detta dokument innebär ingen full rättslig, organisatorisk eller kundspecifik
certifiering och ingen aktivering eller utökning av 352-baslinjens godkännande.
