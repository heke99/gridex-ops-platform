# Gridex Ediel — baslinje för fem nya agenter

Beslut 2026-10-12: gamla agenter slutar; **två nya regelagenter och tre nya kontraktsagenter** fortsätter från bevarad kod, PR och bevis. Det här är den enda aktiva startpunkten. De nya agenterna behöver inte hitta eller invänta tidigare ägare.

## Verifierat läge

Main `95bb437137ce3bc0b0246bed6cf1d149493c92b9`, tree `7bd2141514d29b9cf6deee8eb412367f1a3f7420`. **118/121 regler +196/231 kontrakt =314/352 godkända;38 kvar (3 regler + 35 kontrakt).** [Coverage](../quality/audits/ediel-masterplan-v2/coverage.json) är den enda godkännandeledgern. Baslinjen ger0nycoverage. Frysta regel- och acceptansregister är fortsatt oförändrade.

De fem push/main-workflows och produktionsdeployen lyckades på denna main. Den senare [schemalagda E2E-körningen](https://github.com/heke99/gridex-ops-platform/actions/runs/38228631308) misslyckades i runtime-staging, real-customer-staging och nightly-release-certificate. Grundorsaken är inte kvalificerad. Detta är därför ingen all-green- eller helhetsacceptans.

Aktiv samordning: [#766](https://github.com/heke99/gridex-ops-platform/issues/766). [Gemensamma startprompter](masterplan-five-agent-prompt-20261012.md), [ny överlämning](masterplan-five-agent-transition-20261012.md), [alla38ordagranna krav och exakta källor](masterplan-five-agent-baseline-20261012.json), [hela PR-inventeringen](masterplan-five-agent-pr-inventory-20261012.json).

## Gamla agenter är pensionerade

- [Ditt stopp-/överlämningsbeslut](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6122223028) återkallar alla gamla Ediel-identiteters fortsatta arbets-, producent-, reservations- och mergemandat. Ingen väntan på gamla ägare krävs.
- [Administrativ frigivning](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6122307591): **205 gamla refs faktiskt raderade**, var och en med inventerat kvitto-SHA, GET_MATCH och två 404kontroller. Kvittomeddelanden, source/checkpoints och kvarvarande krav är bevarade. Baslinjepaketets nya dokumentationsrefs undantogs.
- De två gamla aktiva Ediel-automationerna är pausade. Inga köade/pågående GitHub-körningar fanns på de inventerade gamla grenarna vid stoppkontrollen.
- Privata Claude-processer kan inte tekniskt avslutas från denna miljö. Därför ska de nya agenterna använda egna grenar, separata disponibla backends och nya input-/körningsepoker. Sen gammal source/CI får inte räknas som ny leverans. Om en verkligt delad miljö används måste dess gamla producent först vara faktiskt avslutad.

De nya agenterna skaffar egna atomiska slot-, ID-, fil- och producentreservationer. De är frisläppta att börja förbereda och claima sitt nästa paket; prompten är inte själv en claim. Ett nytt tagg med fel/retiredkvitto är en konflikt att dokumentera, inte tillstånd att skriva över någon.

## Vad som redan är gjort

- DB-01/AT-DB-01 är godkända efter#743. AT-Z05C är godkänt efter#756. P-08,TR-09, de levererade H-godkännandena och SC-071 ska inte byggas om.
- #750 levererade två strikta Z10M-fall; hela Z10M återstår. #760 levererade BRP/ACK-komponent; hela AT-Z09B är PARTIAL. #761:s relay-evaluator finns på main; faktisk provider-/TLS-/SPF-bevisning återstår.
- #752/#763:s ESCO-delbevis och #765:s journalbevarande är levererade. Hela ESCO/VH/V/DDQ och juridisk DB05-livscykel är kvar.
- #699/#725 samt API-,portal-,Nordfin-,avtals-/signerings- och schemadelar i#724/#726–#730 är levererade. Återöppna gamla fel endast efter jämförelse med verklig kod.
-67 PR mergades sedan8oktober. Inventeringen innehåller766 historiska PR-metadata, inte ett nytt godkännande av deras samtliga kodändringar.

## PR-beslut och donorunderlag

**Alla13 gamla öppna förslag är nu administrativt stängda med grenarna kvar.** #638 är tekniskt supersederat av#771. De andra12är bevarade donorunderlag för nya agenter, inte förkastade tekniska lösningar eller färdiga hela krav. De nya agenterna skapar nya små PR:er från faktisk main och återanvänder valda exakta donorändringar.

| Donor | Slot | Vad som ska återanvändas och slutföras |
| --- | --- | --- |
| [#638](https://github.com/heke99/gridex-ops-platform/pull/638) | C1 | Whole-Z01 fortsätter i #771; originalbranch/checkpoint/felbevis bevarade; inga refs frigivna. |
| [#744](https://github.com/heke99/gridex-ops-platform/pull/744) | C2 | Kvalificera db01-historical-upgrade-felets faktiska orsak och exakt GEN/schema/quality-proof. |
| [#745](https://github.com/heke99/gridex-ops-platform/pull/745) | C2 | Kvalificera avbrutet native och befintlig consumerinverse; nationell request→ACK→beständig effekt. |
| [#749](https://github.com/heke99/gridex-ops-platform/pull/749) | C2 | Slutför komponentleverans; hela SC054 behöver verkligt DB-lagringsfel/rollback/deadline och ACK-exclusion. |
| [#753](https://github.com/heke99/gridex-ops-platform/pull/753) | C2 | Slutför GEN/main-komposition; genuine512/532 äldre-last persistens→SQL-authority→ACK→receipt/replay. |
| [#755](https://github.com/heke99/gridex-ops-platform/pull/755) | C1 | Exakt124500-checksum/GEN och publicZ04→samma giltiga period före/vid start; wholeSC037 kvar. |
| [#758](https://github.com/heke99/gridex-ops-platform/pull/758) | C3 | Rätta och bevisa ignored-occurrence/matcher med syskon/topologi/repetition och oförändrad affärsdata. |
| [#759](https://github.com/heke99/gridex-ops-platform/pull/759) | C1 | Kvalificera34-fallsfel och leverera två genuina signing/PDF/current-network-prefixpaket till Z02-ägaren. |
| [#762](https://github.com/heke99/gridex-ops-platform/pull/762) | C1 | Återställ replayvärdens Docker-root-kapacitet genom dess ansvariga; kvalificera exakt job_insert-orsak och forward20261011220811. |
| [#764](https://github.com/heke99/gridex-ops-platform/pull/764) | C2 | Exakt140000-checksum/schema/GEN, public originals och populatedVH/V/DDQ-separation samt riktiga effekter. |
| [#768](https://github.com/heke99/gridex-ops-platform/pull/768) | C3 | Kvalificera current H05/H08-nativefel och rätta reproducerad orsak under originalcustody. |
| [#771](https://github.com/heke99/gridex-ops-platform/pull/771) | C1 | Återanvänd #762:s faktiska kompatibla output, fyra Z02-förutsättningar och en motiverad94-falls successor. |
| [#772](https://github.com/heke99/gridex-ops-platform/pull/772) | Baslinjen, dokumentation | Befintlig025 levererar sina tre filer eller explicit lämnar över. Den nya baslinjen ändrar inte deras custody. |

Varje donor har fryst head/branch, originalbodyhash, arkivkvitto och ändradepaths/blob-SHA i maskinunderlaget. Läs de slutna PR:ernas originalreviews och körresultat vid relevant återstart. Inga källgrenar eller bevisartefakter har raderats. Privat-only opublicerad kod är inte tillgänglig och får inte antas finnas i en PR; nya agenter härleder då en korrigering från publicerad kod, felbevis och frysta krav.

Äldre630/662/710/720/721/666är administrativt supersederade med unika resttillgångar bevarade.635/658/665/687/674har bevis som ska jämföras med759/762/768/745/750. DB05:s599/718 och TR08:s543/545ska porteras selektivt till nya små regel-PR:er. C03/C04:s627/676behåller sina hela kvarvarande kriterier. #310är fortfarande PAUSED; andra HOLD-/normativa/legal/LIVE-grindar upphävs inte.

## Fördelning

| Ny slot | Slutansvar | Antal | Rekommenderade oberoende reviewers |
| --- | --- | --- | --- |
| R1 | Datalivscykel och retention | 1 | C1 + C2 |
| R2 | Transport och kontrollerat motpartsprov | 2 | C1 + C2 |
| C1 | Leverantör L/LK/C, Z02 och timing | 13 | R1 + C2 |
| C2 | ESCO, historik, mätvärden och ACK | 10 | C1 + C3 |
| C3 | H/F/G/BRP, gemensam intake och externa acceptanser | 12 | C1 + C2 |

### R1

**ID:** `DB-05`.

Skapa ny DB05-PR på aktuell main. Återanvänd levererade SQL/HTTP/journalrättningar och bevarat599/718underlag. Bevisa kanoniskt kundavslut→senare same-customer/same-decision due-purge, separata behörigheter, klocka, vägransfall, replay/tombstone och skyddad historik. Legal retentionklass/tidsfrist/raderingsgrund måste vara behörigt beslutad. R1 producerar en enda DB-kedja; C3 använder den för AT-DB-05 och SC-070.

### R2

**ID:** `TR-08`, `OPS-04`.

Skapa små nya PR för kvarvarande TR08/OPS04. Återanvänd #761-evaluatorn och relevanta543/545kriterier. Kvalificera autentisk operatorägd provider-/relay-/TLS-/SPF-trace och ett överenskommet verkligt motpartsprov med rätt miljö,tenant,certifikat,rutt,profil,incident och befintligt LIVE-mandat. C3 använder samma underlag; mekanismtest ersätter inte externa beslut.

### C1

**ID:** `AT-Z01L-SUPPLIER`, `AT-Z01LK-SUPPLIER`, `AT-Z02L-SUPPLIER`, `AT-Z02LK-SUPPLIER`, `AT-Z03L-SUPPLIER`, `AT-Z03LK-SUPPLIER`, `AT-Z04L-SUPPLIER`, `AT-Z04LK-SUPPLIER`, `AT-Z03C-SUPPLIER`, `AT-Z04C-SUPPLIER`, `SC-035`, `SC-037`, `SC-039`.

Återanvänd frozen771/762/759/755 och C03/C04-underlaget. Börja med Z02:s verkliga job_insert-fel och signing/PDF/current-network-prefixkrav; återskapa från publicerade kriterier om privata utkast saknas. Kontrollera den använda replaymiljöns kapacitet. Kvalificera samma faktiska kedja till Z01/Z03/Z04, timing och cancellation utan extra parallella producenter.

### C2

**ID:** `AT-Z13V-ESCO`, `AT-Z13VH-ESCO`, `AT-Z14VH-ESCO`, `AT-Z15V-ESCO`, `AT-Z15VH-ESCO`, `SC-023`, `SC-046`, `SC-053`, `SC-054`, `AT-Z10M-SUPPLIER`.

Återanvänd frozen745/764/744/749/753 samt levererade763/750. Slutför ESCO-V/VH/DDQ-separation, verklig persistens→ACK och Z10-history/effective-boundary. C2 är dessutom den enda seriella GEN-/schema-/types-/manifestskrivaren för alla fem agenter; fortsätt kvarvarande744→753→755→764/qualifiedforwardkällor en åt gången, med ny egen GENclaim och kvalificerade inputs.

### C3

**ID:** `AT-Z05H-SUPPLIER`, `AT-Z08H-SUPPLIER`, `AT-Z06F-SUPPLIER`, `AT-Z09F-SUPPLIER`, `AT-Z06G-SUPPLIER`, `AT-Z09G-SUPPLIER`, `AT-Z09B-SUPPLIER`, `SC-031`, `SC-070`, `AT-DB-05`, `AT-TR-08`, `AT-OPS-04`.

Återanvänd frozen768/758, levererad760 och original F/G-bevis. Kvalificera H, F/G, BRP-historik och ignorerade PRODAT-fält med oförändrade affärsdata/syskon/topologi. AT-DB-05/SC-070 och AT-TR-08/AT-OPS-04 prövas mot R1/R2:s enda faktiska kedjor; skapa inga andra DB/transport/LIVEproducenter.

## Rent samarbete

1. En arbetande ny identitet per slot. Claima `slot-R1`/`slot-R2`/`slot-C1`/`slot-C2`/`slot-C3` atomiskt enligt protokollet; sedan bara nästa sammanhängande paket med dess exakta ID/filer och producentresurser. Varje slotansvar förekommer exakt en gång.
2. Extra agenter får gå in direkt som read-only granskare. De får läsa PR/kod/bevis och lämna konkreta fynd. För att rätta kod får de en avgränsad filöverlämning inom den NYA epoken, med källa/output och egna GET_MATCHrefs. Den tidigare skrivaren pausar just dessa filer; ingen dubbel författare.
3. En producent per kedja/källa. Atomic `producer-*`-resurser hindrar två native/GEN/capture/artefaktinsamlingar. Varje körning binds till ny source/inputepoch, miljö och orakel. R1/R2 delar sina faktiska bevis med C3. C2 skriver delad GEN seriellt, inte samtidigt med en annan genererare.
4. Två reviewers som inte medförfattat den exakta kandidaten granskar före merge. Om en reviewer rättar kod,test,fixture,proof eller kandidatens GEN-output är den medförfattare och ersätts som slutgranskare. Rekommenderade par är förslag; fler read-only reviewers kan ansluta när femgruppen saknar två oberoende peers.
5. READY anger exactPR/head/base/paths/ID, samtliga frysta expected/prohibited-kriterier, faktiskt körda resultat och begränsningar. Författaren rättar, affectedproof kvalificeras och reviews binds till slutversionen. Äldre bevis återanvänds bara med explicit source-/miljöapplicability.
6. Små PR:er, mandatorychecks för aktuell version och relevant genuinewholeproof krävs före normal expected-headmerge under role-merge. Kontrollera faktisk PR/main/parents/tree/coverage. Egen mergeroll frigörs först; bara receiptmatchade egna resurser frigörs därefter.
7. Ett eget checkpoint per packet, en approvalledger och en aktiv samordningstavla. Taken/done/source+verification/blocker(owner+output+resumption)/next skrivs vid meningsfull förändring. Gemensamt minne behöver role-memory och exactfiles. Ingen gammal självvals-/två-ID-/owner-wait-process är aktiv.

## Kvarvarande hinder

- Dagens main-E2E är röd; en ny verifierad loggläsare/fixägare diagnostiserar faktisk orsak innan motiverad omkörning.
- #762:s gamla replayvärd hade Docker-rootENOSPC. Det säger inte något om den nya värdens disk. C1 kontrollerar och använder en ny disponibel backend med tillräcklig kapacitet, utan främmande prune.
- Genuina signing/PDF/current-network-prefixinputs och korrekt manifest/checksum/schemaoutput återstår. Privat-only forward20261011220811har ingen publicerad/applied/nativecredit; rekonstruera och testa vid behov.
- Legal retentiongrund, autentisk providertrace, normativa källluckor och överenskommet LIVE/motpartsmandat kvarstår. Syntetiska fixtures får bevisa mekanismen men inte ersätta dessa inputs. #310återupptas inte.

## Rensad dokumentation

README,AGENTS och startfiler pekar hit. Current-start,work-queue och legacyindex är nu samstämmiga ingångar; #772är ett arkiverat donorunderlag. Gamla självvals- och fortsättningsinstruktioner är borttagna från aktiv läsning.

**113 gamla agent-/statusfiler har tagits bort från den aktiva katalogen.** [Historikindexet](masterplan-five-agent-retired-memory-index-20261012.json) binder varje originalpath till exakt hash och immutable95bb-källa. Originalbytes finns kvar i Git; nya agenter återställer bara relevant bevis. Det kodrefererade OPS03-checkpointet behålls byteidentiskt. Frysta specifikationer, originalbevis, qualitydata och produktkod behålls.

BaslinjeJSON är ett daterat inventerings-/överlämningsunderlag, inte en andra godkännandeledger. Förändrad main/PR/körning kräver ny aktuell kontroll. Sidospår för tenantservice,kundportfölj och kund/admin-UI är separata.

## Validera

```bash
python - <<'PY'
import collections, hashlib, json
from pathlib import Path
root = Path('.')
b = json.loads((root / '.agent-memory/masterplan-five-agent-baseline-20261012.json').read_text())
ledger = root / b['coverage']['path']
assert hashlib.sha256(ledger.read_bytes()).hexdigest() == b['coverage']['sha256'], 'Baslinjen är supersederad: läs aktuell ledger och välj bara kvarvarande ID.'
live = json.loads(ledger.read_text())
for kind, key, approved in [('rules', 'rules', 'VERIFIED'), ('contracts', 'acceptance_contracts', 'PASSED')]:
    assigned = [i for a in b['assignments'].values() if a['kind'] == kind for i in a['ids']]
    remaining = {x['id'] for x in live[key] if x['status'] != approved}
    assert set(assigned) == remaining and all(n == 1 for n in collections.Counter(assigned).values())
print('Alla 3 regler och 35 kontrakt förekommer exakt en gång; ledger byteidentisk.')
PY
git diff --check
```

Kontrollen verifierar exakt3+35fördelning, ordagranna krav, oförändrad ledger/spec/schema, kvittobunden205adminrelease, donorbevarande och113hashbundna historikposter. Den gör inga nät-/beteendetestoperationer; liveclaims kontrolleras vid faktisk start.
