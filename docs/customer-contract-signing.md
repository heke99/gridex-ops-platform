# Kundsignering och uppladdade avtal

## Publik länk

`PUBLIC_SIGNING_BASE_URL` anger kundsigneringens gemensamma publika ursprung,
exempelvis `https://avtalslank.se`. Värdet ska vara ett rent HTTPS-ursprung utan
användaruppgifter, sökväg, frågeparametrar eller fragment. Signeringsvägen är
`/sign/contract/{engångstoken}`. Tenant och kund kommer från den sparade
signeringsbegäran, aldrig från domännamnet eller formulärets mottagaradress.

Aktivera inställningen först när rätt projekt har verifierad domän, DNS och
HTTPS. Fram till dess används den befintliga appadressen. Behåll den gamla
adressen kopplad så att redan utskickade giltiga länkar fortsätter fungera.
Inställningen ändrar inte personalens inloggningsadress.

## Utskick och återkallelse

OPS sparar signeringsbegäran, kommunikationslogg och ett beständigt utskicksjobb
innan transporten startar. Den exakta nya könoden kan skickas direkt; samma
ordinarie kö tar hand om återhämtning. Tenant, kund, avtal, begäran och logg
kontrolleras före ett villkorat anspråk på jobbet. Cron och direktutskick delar
lås och leverantörens stabila idempotensnyckel.

Precis före transporten kontrolleras att begäran fortfarande tillhör samma
tenant, kund, avtal och mottagare, är oanvänd, inte är återkallad och inte har
löpt ut. Avtalet ska fortfarande vänta på signering. Inaktuella köjobb
annulleras. Ett pågående utskick som redan har lämnats till leverantören kan
inte tas tillbaka, men den återkallade signeringslänken kan inte användas.

Ett okänt leveransutfall efter leverantörsanrop hålls för granskning och skickas
inte automatiskt igen. Ett providerkvitto betyder skickat; leverans till
mottagarens server bekräftas separat av leveranshändelsen. Ingen av dessa
statusar bevisar att kunden läst mejlet.

Signeringsbegärans äldre `sent_at` avser kvittens på begärt utskick och visas
som ”Utskick begärt”. Faktisk transport och leverans läses från
`communication_logs.sent_at` respektive `delivered_at`.

Att ändra mottagaren i signeringsformuläret ändrar just det utskicket. Kundens
kontaktadress ändras på kundkortet.

Avtalet ska ha en entydig anläggningskoppling inom samma kund och tenant
innan en länk skickas. Saknad eller motstridig koppling ger granskning och
stoppar både automatiskt utskick och manuell omsändning före ny begäran/kö.
Systemet väljer inte kundens första anläggning som ersättning. Nya formulär
förväljer endast en ensam synlig anläggning; flera alternativ kräver val.
Ett äldre `site_id` fungerar om det är verifierat och inte motsäger
`customer_site_id`. Samma regel används vid kundens fullmaktsgodkännande.
Ett redan sparat osignerat avtal utan koppling behöver kompletteras i det
ordinarie OPS-flödet; historisk signering eller IP konstrueras inte i efterhand.

## Signering före leveransstart

Avtal får signeras innan nätägaren lämnat uppgifterna som bestämmer faktisk
leveransstart. `starts_at` förblir då tomt. Aktivering och avslutad leverans
behåller sina krav på ett verkligt leveransdatum. Bindningstid räknas från
leveransstarten när den blir känd; ett datum skapas inte för att kringgå en
signeringsspärr.

Signeringen behåller den frysta avtals-, pris- och juridikversionen och den
verkliga acceptanstidpunkten. IP-underlag ska hämtas från kundens faktiska
förfrågan. Signeringsbevis, dokumenthash och fullmaktsbevis ska kunna följas
till samma kund och tenant. En personligt besvarad testförfrågan kvalificerar
inte en verifierad nätägares svar eller ett skarpt marknadsutskick.

## Fullmaktsbevis vid online-signering

Den publika signeringen använder `gridex_finalize_customer_contract_signature_v2`.
V1 behålls oförändrad för befintliga integrationer. V2 behåller samma låsta
pris-, produkt-, juridik-, kund- och tenantkontroller och hanterar dessutom
ett uttryckligt fullmaktsval. Kryssrutan är tom från början. När fullmakt är
valfri får ett uteblivet val inte skapa någon fullmaktsacceptans eller fullmakt.
Ett avtal utan fullmakt får inte automatiskt inleda leverantörsbytet.

Godkända rättigheter är `supplier_switch` och `facility_information_lookup`.
Valet visas tillsammans med den exakta frysta fullmaktstexten. Fullmakten gäller
vald avtalsanläggning i tolv kalendermånader från signeringsdagen; sista
angivna dag är inkluderad i svensk tid. Ingen fristående rätt att säga upp
andra avtal läggs till. Företagssignering som behöver särskilt bevis om
firmatecknare ska kompletteras genom behörigt flöde, inte anta kundens
organisationsnummer som en persons signatur.

Samma transaktion sparar signering, fullmakt, uttryckliga rättigheter,
originalets faktiska IP-adress och användaruppgifter, juridikversion,
verifikatsnummer och acceptanstidpunkt. Fullmaktens ögonblicksbild ingår i
signeringens SHA-256 och avtalsacceptansen. IP-adressens SHA-256 i fullmakten
hålls åtskild från avtalssigneringens HMAC. Ett verifikatsnummer identifierar
OPS-beviset; det utger sig inte för att vara BankID.

Signeringens leverantörsbytesjobb hålls atomiskt med `poa_archive_pending`
tills PDF:en är verifierad. Originalbeviset skapar ett privat dokument under
`customer-documents/companies/{tenant}/customers/{kund}/powers-of-attorney/{fullmakt}/`.
Arkivets PDF-hash och bevisfingeravtryck kontrolleras. Ett separat servicekommando
kontrollerar exakt signering, fullmakt, kund, tenant och privat lagringsobjekt,
registrerar dokumentet och dess exakta `authorization_scopes` innan det släpper sitt eget arkivstopp. Behörigheterna härleds enbart från originalets signerade rättigheter; tidigare återkallad eller avvikande behörighet återställs inte. Andra
manuella beslut, återkallelser och tenantspärrar överskrivs inte.

Ordinarie bekräftelsehantering och dess cron återupptar väntande arkiv med
oförändrat original. Återhämtning tar aldrig emot en ny IP eller ett nytt
samtycke. Äldre signeringar utan ursprungligt fullmaktsbevis fylls inte ut med
antaganden. Avtalsbekräftelsen bifogar den verifierade fullmakts-PDF:en när en
sådan har godkänts. Misslyckad arkivering lämnar fortsatt hantering spärrad.

Originalets kund- och tenantkoppling är låst. Kundsammanslagning som skulle
skriva om en sådan online-fullmakt stoppas tills en separat, revisionsbevarande
överföring har kvalificerats. Äldre fullmakters sammanslagningsprov bevisar
inte stöd för denna nya källa. Bevislåset får inte lättas för att genomföra en merge.

Avtalets vanliga redigeringsformulär skapar inget signeringsbevis. Signerat
statusval är spärrat innan en verklig signering har registrerats. Backendens
kontroller kvarstår även för manipulerade eller äldre formulär. Det kända
`customer_contract_signature_evidence_incomplete` visas som ett återställbart
meddelande via samma behörighetskontrollerade atomiska avtalskommando,
medan okända fel och Next-kontrollflöde bevaras. Signeringsdatumet visas
skrivskyddat och den fullständiga ursprungliga tidsstämpeln skickas oförändrad
när andra avtalsfält sparas; den kortas inte till kalenderdatum.

Efter en lyckad redigering monteras avtalsformuläret om från den sparade
radens identitet, ändringstid, anläggningskoppling och status. Det hindrar
React från att återställa okontrollerade fält till gamla standardvärden:
ett andra Spara får inte ta bort den anläggning som just sparats. Befintlig
`customer_site_id` visas även om det äldre `site_id` saknas. Övriga delar av
kundkortet behåller sitt visningsläge.

## Uppladdning

Dokumentkopior på dokumentfliken sparas i kundens arkiv. Ett redan signerat
avtal registreras genom avtalsflödets särskilda PDF-import, med rätt kundavtal
och uppgift om originalets signeringsdatum. Det verkliga uppladdningstillfället
sparas separat.

Dokumentsparandet verifierar kund, tenant och eventuella anläggnings-, avtals-
och mätpunktskopplingar. Dokumentfliken kontrollerar anläggningen innan bytes
skickas till lagringen. Den kanoniska importen använder det behöriga
servicekommandot först efter kontroll av den verkliga inloggade handläggaren,
kundåtkomst och avtalsbehörighet; den försvagar inte databasens servicegräns.

PDF-originalet, dess SHA-256 och deklarerade signeringsdatum ska bevaras.
Automatisk bekräftelse av importerade original behöver egen verifierad
fortsättning; den får inte fabricera en online-signering eller ersätta det
uppladdade originalet med en nygenererad PDF.
