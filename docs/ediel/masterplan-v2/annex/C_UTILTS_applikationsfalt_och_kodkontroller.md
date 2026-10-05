# Bilaga C — UTILTS-fält och nationella kodkontroller

Avser tillgänglig svenska oktober 2026-guide. Aktuell septemberprofil kräver separat original25-A-3. Rader är kontextberoende; samma fältnummer kan återkomma med olika grupper/villkor.

## C1. Applikationsfält
| ID/fält | Kontext | Namn | Användning | Locator | Villkor och källa |
| --- | --- | --- | --- | --- | --- |
| UF-planning-311-50 / 311 | planning | Application Reference | S02=R, S03=R, S04=R | UNB/0026 | För S02: ska vara 23-DDQ-S02-S För S03: 23-DDQ-S03-S, 23-DDK-S03-S eller 23-DDX- S03-S För S04: 23-DDK-S04-S. [U s.50] |
| UF-planning-312-50 / 312 | planning | Version | S02=R, S03=R, S04=R | UNH/S009/0057 | Aktuell version av Ediel-meddelandet. [U s.50] |
| UF-planning-202-50 / 202 | planning | Dokumentnamn, kod | S02=R, S03=R, S04=R | BGM/C002/1001 | UTILTS-meddelandetyp: S02, S03, S04 [U s.50] |
| UF-planning-203-50 / 203 | planning | Dokument id | S02=R, S03=R, S04=R | BGM/C106/1004 | Unik identitet på hela UTILTS-medd. [U s.50] |
| UF-planning-204-50 / 204 | planning | Meddelandefunktion | S02=R, S03=R, S04=R | BGM/1225 | Funktion, se kod i BGM [U s.50] |
| UF-planning-313-50 / 313 | planning | Kvittensbegäran | S02=R, S03=R, S04=R | BGM/4343 | Begäran om APERAK [U s.50] |
| UF-planning-205-50 / 205 | planning | Meddelandedatum | S02=R, S03=R, S04=R | DTM+137/C507/2380 | Datum då UTILTS-medd skapas i applikationen, format enligt DTM [U s.50] |
| UF-planning-206-50 / 206 | planning | Tidzon | S02=R, S03=R, S04=R | DTM+735/C507/2380 | Tidzon anges som "offset" till UTC. [U s.50] |
| UF-planning-501-51 / 501 | planning | Marknad | S02=R, S03=R, S04=R | MKS/7293 | El eller gas, se kod i MKS [U s.51] |
| UF-planning-502-51 / 502 | planning | Skede | S02=R, S03=R, S04=R | MKS/C332/3496 | Aktuellt skede = planning, se kod i MKS [U s.51] |
| UF-planning-207-51 / 207 | planning | Avsändare | S02=R, S03=R, S04=R | SG2/NAD+MS/C082/3039 | Juridisk avsändare, Ediel-id [U s.51] |
| UF-planning-208-51 / 208 | planning | Mottagare | S02=R, S03=R, S04=R | SG2/NAD+MR/C082/303 9 | Juridisk mottagare, Ediel-id [U s.51] |
| UF-planning-509-51 / 509 | planning | Underordnad roll | S02=R, S03=R, S04=R | SG2/NAD+rollkod | Kod för den part som ej är ansvarig för meddelandet, i dessa fall mottagarens roll, t ex systemansvarig, balansansvarig osv [U s.51] |
| UF-planning-505-51 / 505 | planning | Transaktionsnr | S02=R, S03=R, S04=R | SG5/IDE+24/C206/7402 | Avsändarens unika id på transaktionen. Används för att kunna referera till en specifik transaktion. [U s.51] |
| UF-planning-209-51 / 209 | planning | Anläggningsid | S02=R, S03=-, S04=- | SG5/LOC+172/C517/3225 | Anläggningsid, normalt GS1-nr [U s.51] |
| UF-planning-260a-51 / 260a | planning | Nätområdesid | S02=R, S03=R, S04=R (se not) | SG5/LOC+239/C517/3225 | Nätområdesid S04: Om/när det blir aktuellt att skicka aggregerade värden med annat än andelstal kan fältet bli villkorat av vad som skickas (tidsserieprodukten), alternativt används en ny meddelandetyp. [U s.51] |
| UF-planning-262-51 / 262 | planning | Balansansvarig | S02=-, S03=D, S04=D | SG5/NAD+DDK//C082/30 39 | Balansansvarig: Villkor om detta fält ska skickas eller inte är beroende på vilken tidsserieprodukt (OT) som är aktuell. [U s.51] |
| UF-planning-510-51 / 510 | planning | Leverantör | S02=-, S03=D, S04=- | SG5/NAD+DDQ//C082/30 39 | Leverantör: Villkor om detta fält ska skickas eller inte är beroende på vilken tidsserieprodukt (OT) som är aktuell. [U s.51] |
| UF-planning-506-51 / 506 | planning | Produkt id | S02=R, S03=R, S04=R | SG5/LIN/C212/7140 | Generell produktkod, se koder i LIN [U s.51] |
| UF-planning-511-51 / 511 | planning | Tidsserieprodukt | S02=-, S03=R, S04=R | SG5/PIA+1/C212/7140 (x5) | Tidsserieprodukt Fem koder anges i enlighet med Svenska kraftnäts kodlista, fält 511a, 511b, 511c, 511d och 511e. [U s.51] |
| UF-planning-245-51 / 245 | planning | Leveransperiod | S02=R, S03=R, S04=R | SG5/DTM+324/C507/238 0 | Aktuell period för transaktionen [U s.51] |
| UF-planning-532-51 / 532 | planning | Senaste uppdaterings- tidpunkt | S02=R, S03=R, S04=R | SG5/DTM+368/C507/238 0 | Senaste uppdateringstidpunkt [U s.51] |
| UF-planning-508-51 / 508 | planning | Upplösning | S02=R, S03=R, S04=R | SG5/DTM+354/C507/238 0 | Upplösning för hela transaktionen, t ex månad, format enligt DTM [U s.51] |
| UF-planning-223-52 / 223 | planning | Anledning till transaktionen | S02=R, S03=R, S04=R | SG5/STS+7/C556/9013 | Anledning till trans. = Planning [U s.52] |
| UF-planning-264-52 / 264 | planning | Enhet | S02=R, S03=R, S04=R | SG5/MEA+AAZ/C174/64 11 | Anger enhet för hela transaktionen. [U s.52] |
| UF-planning-226-52 / 226 | planning | Referens till PRODAT- ärendereferens | S02=O, S03=-, S04=- | SG6/RFF+TN/C506/1154 | Kan anges för att knyta ihop UTILTS-transaktionen med PRODAT-ärendet. [U s.52] |
| UF-planning-254-52 / 254 | planning | Avräkningsmetod | S02=-, S03=R, S04=- | SG7/CAV/C889/7111 under SG7/CCI+++E02 | ”Profiled” eller ”Non-profiled” [U s.52] |
| UF-planning-513-52 / 513 | planning | Typ av anläggning(ar) | S02=-, S03=R, S04=- | SG7/CAV/C889/7111 under SG7/CCI+++E12 | Kod för ”Consumption”, ”Production” eller ”Exchange”. Är i UTILTS S03 alltid förbrukning. [U s.52] |
| UF-planning-507a-52 / 507a | planning | Antal mätpunkter | S02=-, S03=D, S04=- | SG7/CAV/C889/7110 under SG7/CCI+++Z01 | Ange default antal mätpunkter. Används vid rapportering av aggregerade serier, användningen beror på aktuell tidsserieprodukt (PC+PT). Se vidare beskrivning i CAV-segmentet (SG7). [U s.52] |
| UF-planning-514-52 / 514 | planning | Observationsnr | S02=R, S03=R, S04=R | SG8/SEQ/C286/1050 | Löpnr/sekvens för resp detaljrad, starta alltid på 1 och räkna upp med 1 för varje detaljrad. [U s.52] |
| UF-planning-515-52 / 515 | planning | Planerad periodisk kvantitet | S02=R, S03=R, S04=R | SG11/QTY+135/C186/606 0 | Prognostiserad energimängd (eller andelstal) [U s.52] |
| UF-planning-520-52 / 520 | planning | Kvantitetskvalitet | S02=D, S03=-, S04=- | SG11/STS+8/C555/4405 | Obligatoriskt om värde i fält 515 har lägre kvalitet än godkänt. Se koder i SG11/STS. [U s.52] |
| UF-planning-507b-52 / 507b | planning | Avvikande antal mätpunkter | S02=-, S03=D, S04=- | SG12/CAV/C889/7110 under SG12/CCI+++Z01 | Anger faktiska antalet mätpunkter för aktuell observation. Används endast om det skiljer mot fält 507a ovan, användningen beror också på angiven tidsserieprodukt (PC och PT). Används vid rapportering av aggregerade serier. Se vidare beskrivning i CAV-segmentet (SG12). [U s.52] |
| UF-metering_settlement-311-53 / 311 | metering_settlement | Application Reference | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | UNB/0026 | För E30: ska vara 23-MDR-E30-S eller -T För E31: 23-DDQ-E31-S eller -T, 23-DDK-E31-S/-T, 23-DEA-E31- T eller 23-DDX-E31-S/-T För E66: 23-DEA-E66-S eller -T, 23-DDQ-E66-S/-T, 23-DEC-E66- S/-T, 23-DGI-E66-S/-T, 23-DDK- E66-S/-T, 23-PQ-E66-T eller 23- EZ-E66-T För S01: 23-DDK-S01-S eller -< processtyp> eller 23-DEA-S01-T För S05: 23-DDQ-S05-S eller -< processtyp> För S07: 23-DDQ-S07-S eller -T, 23-DEC-S07-S/-T, 23-DDK-S07- S/-T För aktuell lista över processtyper, se dokumentet med tidsserieprodukter. [U s.53] |
| UF-metering_settlement-312-53 / 312 | metering_settlement | Version | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | UNH/S009/0057 | Aktuell version av Ediel- meddelandet. [U s.53] |
| UF-metering_settlement-202-53 / 202 | metering_settlement | Dokumentnamn, kod | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | BGM/C002/1001 | UTILTS-meddelandetyp: E30, E31, E66, S01, S05, S07 [U s.53] |
| UF-metering_settlement-203-53 / 203 | metering_settlement | Dokument id | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | BGM/C106/1004 | Unik identitet på hela UTILTS- medd. [U s.53] |
| UF-metering_settlement-204-54 / 204 | metering_settlement | Meddelandefunktion | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | BGM/1225 | Funktion, se kod i BGM [U s.54] |
| UF-metering_settlement-313-54 / 313 | metering_settlement | Kvittensbegäran | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | BGM/4343 | Begäran om APERAK [U s.54] |
| UF-metering_settlement-205-54 / 205 | metering_settlement | Meddelandedatum | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | DTM+137/C507/2 380 | Datum då UTILTS-medd skapas i applikationen, format enligt DTM [U s.54] |
| UF-metering_settlement-206-54 / 206 | metering_settlement | Tidzon | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | DTM+735/C507/2 380 | Tidzon anges som ”offset” till UTC. [U s.54] |
| UF-metering_settlement-501-54 / 501 | metering_settlement | Marknad | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | MKS/7293 | El eller gas, se kod i MKS [U s.54] |
| UF-metering_settlement-502-54 / 502 | metering_settlement | Skede | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | MKS/C332/3496 | Aktuellt skede, se kod i MKS [U s.54] |
| UF-metering_settlement-207-54 / 207 | metering_settlement | Avsändare | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | SG2/NAD+MS/C 082/3039 | Juridisk avsändare, Ediel-id [U s.54] |
| UF-metering_settlement-208-54 / 208 | metering_settlement | Mottagare | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | SG2/NAD+MR/C 082/3039 | Juridisk mottagare, Ediel-id [U s.54] |
| UF-metering_settlement-509-54 / 509 | metering_settlement | Underordnad roll | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | SG2/NAD+rollko d | Kod för den part som ej är ansvarig för meddelandet, i dessa fall mottagarens roll, t ex systemansvarig, balansansvarig osv [U s.54] |
| UF-metering_settlement-505-54 / 505 | metering_settlement | Transaktionsnr | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | SG5/IDE+24/C20 6/7402 | Avsändarens unika id på transaktionen. Används för att kunna referera till en specifik transaktion. [U s.54] |
| UF-metering_settlement-209-54 / 209 | metering_settlement | Anläggningsid | E30=R, E31=-, E66=D, S01=-, S05=-, S07=R | SG5/LOC+172/C5 17/3225 | Anläggningsid, normalt GS1-nr. Används i E66 utom då mätvärden för reglerobjekt skickas. [U s.54] |
| UF-metering_settlement-533-54 / 533 | metering_settlement | Reglerobjektsid | E30=-, E31=-, E66=D, S01=D, S05=-, S07=- | SG5/LOC+175/C5 17/3225 | Reglerobjektsid. Används i E66 då mätvärden för reglerobjekt skickas. Används i S01 beroende på tidsserieprodukt (dvs då tidsserien avser ett reglerobjekt). [U s.54] |
| UF-metering_settlement-260a-54 / 260a | metering_settlement | Nätområdesid | E30=O, E31=D, E66=D, S01=D, S05=D, S07=D | SG5/LOC+239/C5 17/3225 | Nätområdesid (eller identitet på annat område, t.ex. snittområde). [U s.54] |
| UF-metering_settlement-260b-55 / 260b | metering_settlement | Nätområde18 – utmatning | E30=O, E31=D, E66=D, S01=D, S05=-, S07=D | SG5/LOC+232/C5 17/3225 | Nätområdesid för utmatning. Skickas alltid tillsammans med 260c Frivilligt i E30 Obligatoriskt annars om fält 513 = Exchange [U s.55] |
| UF-metering_settlement-260c-55 / 260c | metering_settlement | Nätområde18 – inmatning | E30=O, E31=D, E66=D, S01=D, S05=-, S07=D | SG5/LOC+233/C5 17/3225 | Nätområdesid för inmatning. Skickas alltid tillsammans med 260b Frivilligt i E30 Obligatoriskt annars om fält 513 = Exchange [U s.55] |
| UF-metering_settlement-262-55 / 262 | metering_settlement | Balansansvarig | E30=-, E31=D, E66=-, S01=D, S05=D, S07=- | SG5/NAD+DDK// C082/3039 | Balansansvarig villkor om detta fält ska skickas eller inte är beroende på vilken tidsserieprodukt (OT) som är aktuell. [U s.55] |
| UF-metering_settlement-510-55 / 510 | metering_settlement | Leverantör | E30=-, E31=D, E66=-, S01=-, S05=D, S07=- | SG5/NAD+DDQ// C082/3039 | Leverantör villkor om detta fält ska skickas eller inte är beroende på vilken tidsserieprodukt (OT) som är aktuell. [U s.55] |
| UF-metering_settlement-524-56 / 524 | metering_settlement | Köpare | E30=-, E31=-, E66=-, S01=D, S05=D, S07=- | SG5/NAD+BY//C 082/3039 | Köpare villkor om detta fält ska skickas eller inte är beroende på vilken tidsserieprodukt (OT) som är aktuell. [U s.56] |
| UF-metering_settlement-525-56 / 525 | metering_settlement | Säljare | E30=-, E31=-, E66=-, S01=D, S05=D, S07=- | SG5/NAD+SE//C 082/3039 | Säljare villkor om detta fält ska skickas eller inte är beroende på vilken tidsserieprodukt (OT) som är aktuell. [U s.56] |
| UF-metering_settlement-526-56 / 526 | metering_settlement | Systemansvarig | E30=-, E31=-, E66=-, S01=D, S05=D, S07=- | SG5/NAD+EZ//C 082/3039 | Systemansvarig villkor om detta fält ska skickas eller inte är beroende på vilken tidsserieprodukt (OT) som är aktuell. [U s.56] |
| UF-metering_settlement-506-56 / 506 | metering_settlement | Produkt id | E30=-, E31=R, E66=R, S01=R, S05=R, S07=R | SG5/LIN/C212/71 40 | Generell produktkod, se koder i LIN [U s.56] |
| UF-metering_settlement-511-56 / 511 | metering_settlement | Tidsserieprodukt | E30=-, E31=R, E66=-, S01=R, S05=R, S07=- | SG5/PIA+1/C212/ 7140 | Tidsserieprodukt Fem koder anges i enlighet med Svenska kraftnäts kodlista, fält 511a, 511b, 511c, 511d och 511e. [U s.56] |
| UF-metering_settlement-245-56 / 245 | metering_settlement | Leveransperiod | E30=D, E31=R, E66=D, S01=R, S05=R, S07=R | SG5/DTM+324/C 507/2380 | Aktuell period för transaktionen Anges i E30 och E66 om antal observationer > 1, dvs när fler än en enskild mätarställning skickas. [U s.56] |
| UF-metering_settlement-512-56 / 512 | metering_settlement | Registreringstidpunkt | E30=R, E31=-, E66=R, S01=-, S05=-, S07=R | SG5/DTM+597/C 507/2380 | Registreringstidpunkten för rapporterade värden. [U s.56] |
| UF-metering_settlement-532-56 / 532 | metering_settlement | Senaste uppdateringstidpunkt | E30=-, E31=R, E66=-, S01=R, S05=R, S07=- | SG5/DTM+368/C 507/2380 | Senaste uppdateringstidpunkten för rapporterade värden. [U s.56] |
| UF-metering_settlement-508-56 / 508 | metering_settlement | Upplösning | E30=D, E31=R, E66=D, S01=R, S05=R, S07=R | SG5/DTM+354/C 507/2380 | Upplösning för hela transaktionen, t ex månad, format enligt DTM. Anges i E30 och E66 när energivolymer skickas. [U s.56] |
| UF-metering_settlement-223-57 / 223 | metering_settlement | Anledning till transaktionen | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | SG5/STS+7/C556/ 9013 | E30, E66, S07: se koder i SG5/STS E31, S01, S05: Settlement om avräkningsmetod = “Non- profiled” och Reconciliation om avräkningsmetod = “Profiled”. [U s.57] |
| UF-metering_settlement-264-57 / 264 | metering_settlement | Enhet | E30=-, E31=R, E66=R, S01=D, S05=D, S07=R | SG5/MEA+AAZ/ C174/6411 | Ange enhet för hela transaktionen. Används inte i S01 och S05 om enbart belopp skickas, användningen beror på aktuell tidsserieprodukt. [U s.57] |
| UF-metering_settlement-226-57 / 226 | metering_settlement | Referens till PRODAT- ärendereferens | E30=-, E31=-, E66=D, S01=-, S05=-, S07=- | SG6/RFF+TN/C5 06/1154 | Fylls i när transaktionen hör ihop med ett PRODAT-ärende för icke dygnsavräknade anläggningar. Se vidare kapitel 3.6.12. [U s.57] |
| UF-metering_settlement-254-57 / 254 | metering_settlement | Avräkningsmetod | E30=-, E31=R, E66=-, S01=D, S05=D, S07=- | SG7/CAV/C889/7 111 under SG7/CCI+++E02 | ”Profiled” eller ”Non-profiled”, användningen i S01 och S05 beror på aktuell tidsserieprodukt. [U s.57] |
| UF-metering_settlement-507a-57 / 507a | metering_settlement | Antal mätpunkter | E30=-, E31=D, E66=-, S01=-, S05=D, S07=- | SG7/CAV/C889/7 110 under SG7/CCI+++Z01 | Ange default antal mätpunkter. Används vid rapportering av aggregerade serier, användningen beror på aktuell tidsserieprodukt (PC+PT). Se vidare beskrivning i CAV-segmentet (SG7). [U s.57] |
| UF-metering_settlement-513-57 / 513 | metering_settlement | Typ av anläggning(ar) | E30=-, E31=R, E66=R, S01=-, S05=-, S07=R | SG7/CAV/C889/7 111 under SG7/CCI+++E12 | ”Consumption”, ”Production” eller ”Exchange” [U s.57] |
| UF-metering_settlement-514-57 / 514 | metering_settlement | Observationsnr | E30=R, E31=R, E66=R, S01=R, S05=R, S07=R | SG8/SEQ/C286/10 50 | Löpnr/sekvens för resp detaljrad, starta normalt alltid på 1 och räkna upp med 1 för varje detaljrad (observation). [U s.57] |
| UF-metering_settlement-527-57 / 527 | metering_settlement | RegisterId | E30=D, E31=-, E66=D, S01=-, S05=-, S07=D | SG8/RFF+AES/C 506/1154 | RegisterId [U s.57] |
| UF-metering_settlement-224-58 / 224 | metering_settlement | Mätarnummer | E30=D, E31=-, E66=D, S01=-, S05=-, S07=O | SG8/RFF+MGaltS E/ C506/1154 | Anges endast en gång per register (räkneverk). Anges då för den första observationen med mätarställningar. Anges alltid i E30 och E66 då mätarställningar skickas. Frivilligt i S07. Anges inte i E66 med maxeffektvärden (Normalt ett GIAI-nummer, se bilaga 7). [U s.58] |
| UF-metering_settlement-522-58 / 522 | metering_settlement | Belopp | E30=-, E31=-, E66=-, S01=D, S05=D, S07=- | SG8/MOA+9/C51 6/5004 | Belopp, villkor om detta fält ska skickas eller inte är beroende på aktuell tidsserieprodukt. Notera att flera belopp (med olika valutor) är möjliga att skicka för en och samma tidsserie. [U s.58] |
| UF-metering_settlement-269a-58 / 269a | metering_settlement | Valuta | E30=-, E31=-, E66=-, S01=D, S05=D, S07=- | SG8/MOA+9/C51 6/6345 | Valutakod för fält 522, enligt ISO [U s.58] |
| UF-metering_settlement-523-58 / 523 | metering_settlement | Pris | E30=-, E31=-, E66=-, S01=D, S05=D, S07=- | SG10/PRI/C509/5 118 | Pris, villkor om detta fält ska skickas eller inte är beroende på aktuell tidsserieprodukt. Notera att flera priser (med olika valutor) är möjliga att skicka för en och samma tidsserie. [U s.58] |
| UF-metering_settlement-269b-58 / 269b | metering_settlement | Valuta | E30=-, E31=-, E66=-, S01=D, S05=D, S07=- | SG10/CUX+2/634 5 | Valutakod för fält 523, enligt ISO [U s.58] |
| UF-meter_stands-517-59 / 517 | meter_stands | Mätarställning | E30=D, E66=D, S07=D | SG11/QTY+220/C186/606 0 | Mätarställning, saknas mätarställning anges ”NULL” i fältet. Anges om mätarställningar skickas. [U s.59] |
| UF-meter_stands-530a-59 / 530a | meter_stands | Datum för mätar- ställning | E30=D, E66=D, S07=D | SG11/DTM+597/C507/23 80 | Tidpunkt för mätarregistrering. Anges om mätarställningar skickas. [U s.59] |
| UF-meter_stands-520-59 / 520 | meter_stands | Kvantitetskvalitet | E30=D, E66=-, S07=- | SG11/STS+8/C555/4405 | Mätaravläsningskvalitet. Obligatoriskt om mätaravläsningsvärdet (fält 517) har lägre kvalitet än godkänt. Se koder i SG11/STS. [U s.59] |
| UF-meter_stands-309-59 / 309 | meter_stands | Mätaravläsare | E30=-, E66=D, S07=D | SG12/CAV/C889/7111 under SG12/CCI+++E22 | Mätaravläsare Anges om mätarställningar skickas. Se koder i SG12/CAV [U s.59] |
| UF-quantity-516-59 / 516 | quantity | Uppnådd periodisk kvantitet | E30=D, E66=D, S07=D | SG11/QTY+136/C186/60 60 | Uppnådd energimängd. Anges om energimängd skickas. [U s.59] |
| UF-quantity-520-59 / 520 | quantity | Kvantitetskvalitet | E30=D, E66=D, S07=D | SG11/STS+8/C555/4405 | Mätaravläsningskvalitet. Obligatoriskt om värde i fält 516 har lägre kvalitet än godkänt. Se koder i SG11/STS. [U s.59] |
| UF-maximum_demand-521-60 / 521 | maximum_demand | Maxeffektvärde | E30=-, E66=D, S07=- | SG11/QTY+42/C186/606 0 | Maxeffektvärde (i kilowatt) Anges om maxeffektvärden skickas. [U s.60] |
| UF-maximum_demand-530b-60 / 530b | maximum_demand | Tidpunkt för effektvärde | E30=-, E66=D, S07=- | SG11/DTM+597/C507/23 80 | Används när effektvärdet avser en specifik tidpunkt. Inte om effektvärdet uttrycks som maxeffektvärde över hela leveransperioden. [U s.60] |
| UF-maximum_demand-520-60 / 520 | maximum_demand | Kvantitetskvalitet | E30=-, E66=D, S07=- | SG11/STS+8/C555/4405 | Mätaravläsningskvalitet. Obligatoriskt om värde i fält 521 har lägre kvalitet än godkänt. Se koder i SG11/STS. [U s.60] |
| UF-maximum_demand-259-60 / 259 | maximum_demand | Tidsintervall | E30=-, E66=D, S07=- | SG12/CAV/C889/7111 under SG12/CCI+++E07 | Tidsintervall som anger att effektvärdet är ett maxvärde. Giltig kod: E12 (Peak) Anges om maxeffektvärden skickas. [U s.60] |
| UF-aggregate_observations-516-61 / 516 | aggregate_observations | Uppnådd periodisk kvantitet | E31=R, S01=R, S05=R | SG11/QTY+136/C186/6 060 | Kvantitet [U s.61] |
| UF-aggregate_observations-520-61 / 520 | aggregate_observations | Kvantitetskvalitet | E31=D, S01=D, S05=D | SG11/STS+8/C555/440 5 | Obligatoriskt om värde i fält 516 har lägre kvalitet än godkänt. Används ej för andelstal. Se koder i SG11/STS. [U s.61] |
| UF-aggregate_observations-507b-61 / 507b | aggregate_observations | Avvikande antal mätpunkter | E31=D, S01=-, S05=D | SG12/CAV/C889/7110 under SG12/CCI+++Z01 | Anger faktiska antalet mätpunkter, anges om antal mätpunker avviker från ”default”-antal mätpunkter på transaktionsnivån (fält 507a). Används inte för aggregerade högupplösta mätvärden. Om fältet kan förekomma beror även på aktuell tidsserieprodukt (PC och PT). [U s.61] |
| UF-request-311-62 / 311 | request | Application Reference | E72=R, E73=R, E74=R, S06=R | UNB/0026 | Ska vara den kod som gäller för det begärda meddelandet, se kapitel 3.7.1 och 3.7.2 ovan. [U s.62] |
| UF-request-312-62 / 312 | request | Version | E72=R, E73=R, E74=R, S06=R | UNH/S009/0057 | Aktuell version av Ediel-meddelandet. [U s.62] |
| UF-request-202-62 / 202 | request | Dokumentnamn, kod | E72=R, E73=R, E74=R, S06=R | BGM/C002/1001 | UTILTS-meddelandetyp: E72, E73, E74 eller S06 [U s.62] |
| UF-request-203-62 / 203 | request | Dokument id | E72=R, E73=R, E74=R, S06=R | BGM/C106/1004 | Unik identitet på hela UTILTS-medd. [U s.62] |
| UF-request-204-62 / 204 | request | Meddelandefunktion | E72=R, E73=R, E74=R, S06=R | BGM/1225 | Funktion, se kod i BGM [U s.62] |
| UF-request-313-62 / 313 | request | Kvittensbegäran | E72=R, E73=R, E74=R, S06=R | BGM/4343 | Begäran om APERAK [U s.62] |
| UF-request-205-62 / 205 | request | Meddelandedatum | E72=R, E73=R, E74=R, S06=R | DTM+137/C507/2380 | Datum då UTILTS-medd skapas i applikationen, format enligt DTM [U s.62] |
| UF-request-206-62 / 206 | request | Tidzon | E72=R, E73=R, E74=R, S06=R | DTM+735/C507/2380 | Tidzon anges som ”offset” till UTC. [U s.62] |
| UF-request-501-62 / 501 | request | Marknad | E72=R, E73=R, E74=R, S06=R | MKS/7293 | El eller gas, se kod i MKS [U s.62] |
| UF-request-502-62 / 502 | request | Skede | E72=R, E73=R, E74=R, S06=R | MKS/C332/3496 | Aktuellt skede, se kod i MKS [U s.62] |
| UF-request-207-62 / 207 | request | Avsändare | E72=R, E73=R, E74=R, S06=R | SG2/NAD+MS/C082/3039 | Juridisk avsändare, Ediel-id [U s.62] |
| UF-request-208-62 / 208 | request | Mottagare | E72=R, E73=R, E74=R, S06=R | SG2/NAD+MR/C082/3039 | Juridisk mottagare, Ediel-id [U s.62] |
| UF-request-509-62 / 509 | request | Underordnad roll | E72=R, E73=R, E74=R, S06=R | SG2/NAD/3035 | Kod för den part som ej är ansvarig för det medde- lande som begärs, för UTILTS-Request blir det avsändarens roll, t ex leverantör, balansansvarig osv [U s.62] |
| UF-request-505-62 / 505 | request | Transaktionsnr | E72=R, E73=R, E74=R, S06=R | SG5/IDE+24/C206/7402 | Avsändarens unika id på transaktionen. Används för att kunna referera till en specifik transaktion. [U s.62] |
| UF-request-209-63 / 209 | request | Anläggningsid | E72=R, E73=D, E74=-, S06=- | SG5/LOC+172/C517/3225 | Anläggningsid, nätägarens id alt GS1 (GSRN). Anges alltid i E73 såvida inte man begär mätvärden (E66) för ett reglerobjekt. [U s.63] |
| UF-request-533-63 / 533 | request | Reglerobjektsid | E72=-, E73=D, E74=-, S06=D | SG5/LOC+175/C517/3225 | Reglerobjektsid Används i E73 respektive S06 om man begär mätvärden (E66 resp. S01) för ett visst reglerobjekt. [U s.63] |
| UF-request-260a-63 / 260a | request | Nätområdesid | E72=O, E73=D, E74=D, S06=D | SG5/LOC+239/C517/3225 | Nätområdesid I E72 är fält 260a eller 260b+260c frivilligt att använda. Fält 260a används alltid i E74 om en S03 begärs. Fält 260a eller 260b+260c används i E74 då E31 begärs beroende på aktuell tidsserieprodukt (OT). Fält 260a används i S06 om S04 begärs. Fält 260a används i E73 om S02 begärs. Fält 260a eller 260b+260c används i E73 om E66 begärs. Fält 260a eller 260b+260c används i S06 om S01 begärs beroende på aktuell tidsserieprodukt (OT). [U s.63] |
| UF-request-260b-63 / 260b | request | Nätområde – utmatning | E72=O, E73=D, E74=D, S06=D | SG5/LOC+232/C517/3225 | Nätområdesid för utmatning Skickas alltid tillsammans med 260c Obligatoriskt i E74 om 513 = Exchange Ej aktuell i S06 om S04 begärs. Ej aktuell i E73 om S02 begärs. Ej aktuell i E74 om S03 begärs. [U s.63] |
| UF-request-260c-63 / 260c | request | Nätområde – inmatning | E72=O, E73=D, E74=D, S06=D | SG5/LOC+233/C517/3225 | Nätområdesid för inmatning Skickas alltid tillsammans med 260b Obligatoriskt i E74 om 513 = Exchange Ej aktuell i S06 om S04 begärs. Ej aktuell i E73 om S02 begärs. Ej aktuell i E74 om S03 begärs. [U s.63] |
| UF-request-262-64 / 262 | request | Balansansvarig | E72=-, E73=-, E74=D, S06=D | SG5/NAD+DDK//C082/3039 | Balansansvarig Villkor om detta fält ska skickas eller inte är beroende på vilken tidsserieprodukt (OT) som är aktuell. [U s.64] |
| UF-request-510-64 / 510 | request | Leverantör | E72=-, E73=-, E74=D, S06=- | SG5/NAD+DDQ//C082/3039 | Leverantör Villkor om detta fält ska skickas eller inte är beroende på vilken tidsserieprodukt (OT) som är aktuell. [U s.64] |
| UF-request-524-64 / 524 | request | Köpare | E72=-, E73=-, E74=-, S06=D | SG5/NAD+BY//C082/3039 | Köpare Villkor om detta fält ska skickas eller inte är beroende på vilken tidsserieprodukt (OT) som är aktuell. [U s.64] |
| UF-request-525-64 / 525 | request | Säljare | E72=-, E73=-, E74=-, S06=D | SG5/NAD+SE//C082/3039 | Säljare Villkor om detta fält ska skickas eller inte är beroende på vilken tidsserieprodukt (OT) som är aktuell. [U s.64] |
| UF-request-526-64 / 526 | request | Systemansvarig | E72=-, E73=-, E74=-, S06=D | SG5/NAD+EZ//C082/3039 | Systemansvarig Villkor om detta fält ska skickas eller inte är beroende på vilken tidsserieprodukt (OT) som är aktuell. [U s.64] |
| UF-request-506-64 / 506 | request | Produkt id | E72=-, E73=R, E74=-, S06=- | SG5/LIN/C212/7140 | Generell produktkod, se koder i LIN [U s.64] |
| UF-request-511-64 / 511 | request | Tidsserieprodukt | E72=-, E73=-, E74=R, S06=R | SG5/PIA+1/C212/7140 (x5) | Tidsserieprodukt Fem koder anges i enlighet med Svenska kraftnäts kodlista, fält 511a, 511b, 511c, 511d och 511e. [U s.64] |
| UF-request-245-64 / 245 | request | Leveransperiod | E72=R, E73=R, E74=R, S06=R | SG5/DTM+324/C507/2380 | Begärd period för efterfrågade värden [U s.64] |
| UF-request-223-64 / 223 | request | Anledning till transaktionen | E72=R, E73=R, E74=R, S06=R | SG5/STS+7/C556/9013 | Anledning till trans. = det som ska skickas i det begärda meddelandet [U s.64] |
| UF-request-503-64 / 503 | request | Referens till meddelandetyp | E72=R, E73=R, E74=R, S06=R | SG6/RFF/1153 | Referens till UTILTS-meddelandetyp, E30, E31, E66, S01, S02, S03, S04 [U s.64] |
| UF-request-254-64 / 254 | request | Avräkningsmetod | E72=-, E73=-, E74=R, S06=- | SG7/CAV/C889/7111 under SG7/CCI+++E02 | ”Profiled” eller ”Non-profiled” [U s.64] |
| UF-request-513-65 / 513 | request | Typ av anläggningar | E72=-, E73=R, E74=R, S06=- | SG7/CAV/C889/7111 under SG7/CCI+++E12 | ”Consumption”, ”Production” eller ”Exchange” [U s.65] |
| UF-error-311-66 / 311 | error | Application Reference | ERR=R | UNB/0026 | Samma som i det kvitterade meddelandet [U s.66] |
| UF-error-312-66 / 312 | error | Version | ERR=R | UNH/S009/0057 | Samma version som i det mottagna Ediel-meddelandet (var den versionen fel, skickas negativt APERAK). [U s.66] |
| UF-error-202-66 / 202 | error | Dokumentnamn, kod | ERR=R | BGM/C002/1001 | UTILTS-meddelandetyp: ERR [U s.66] |
| UF-error-203-66 / 203 | error | Dokument id | ERR=R | BGM/C106/1004 | Unik identitet på hela UTILTS-medd. [U s.66] |
| UF-error-204-66 / 204 | error | Meddelandefunktion | ERR=R | BGM/1225 | Funktion, se kod i BGM [U s.66] |
| UF-error-313-66 / 313 | error | Kvittensbegäran | ERR=R | BGM/4343 | Begäran om APERAK [U s.66] |
| UF-error-205-66 / 205 | error | Meddelandedatum | ERR=R | DTM+137/C507/2380 | Datum då UTILTS-medd skapas i applikationen, format enligt DTM [U s.66] |
| UF-error-206-66 / 206 | error | Tidzon | ERR=R | DTM+735/C507/2380 | Tidzon anges som "offset" till UTC. [U s.66] |
| UF-error-501-66 / 501 | error | Marknad | ERR=R | MKS/7293 | El eller gas, se kod i MKS (Samma som i det kvitterade meddelandet) [U s.66] |
| UF-error-502-66 / 502 | error | Skede | ERR=R | MKS/C332/3496 | Aktuellt skede, se kod i MKS (Samma som i det kvitterade meddelandet) [U s.66] |
| UF-error-207-66 / 207 | error | Avsändare | ERR=R | SG2/NAD+MS/C082/3039 | Juridisk avsändare, Ediel-id [U s.66] |
| UF-error-208-66 / 208 | error | Mottagare | ERR=R | SG2/NAD+MR/C082/3039 | Juridisk mottagare, Ediel-id [U s.66] |
| UF-error-509-66 / 509 | error | Underordnad roll | ERR=R | SG2/NAD/3035 | Kod för den part som ej är ansvarig för meddelandet, för UTILTS ERR blir det avsändarens roll, t ex leverantör, balansansvarig osv, hämtas från mottaget meddelande. [U s.66] |
| UF-error-505-66 / 505 | error | Transaktionsnr | ERR=R | SG5/IDE+24/C206/7402 | Avsändarens unika id på UTILTS-ERR-transaktionen. Används för att i APERAK-svaret kunna referera till en specifik transaktion. [U s.66] |
| UF-error-209-66 / 209 | error | Anläggningsid | ERR=D | SG5/LOC+172/C517/3225 | Anläggningsid från mottagen transaktion. Ska anges i ERR som svar på UTILTS med enskilda anläggningar (ej reglerobjekt). [U s.66] |
| UF-error-533-66 / 533 | error | Reglerobjektsid | ERR=D | SG5/LOC+175/C517/3225 | Reglerobjektsid från mottagen transaktion. Ska anges i ERR som svar på UTILTS med reglerobjekt (gäller då svar på E66 eller S01). [U s.66] |
| UF-error-260a-66 / 260a | error | Nätområdesid | ERR=D | SG5/LOC+239/C517/3225 | Nätområdesid, samma som i mottagen transaktion. Ska anges i ERR om det finns i mottagen transaktion och felet ej inträffade tidigare och omöjliggjorde att ange nätområdes-id i kvittensen. [U s.66] |
| UF-error-260b-66 / 260b | error | Nätområde – utmatning | ERR=D | SG5/LOC+232/C517/3225 | Nätområdesid för utmatning, samma som i mottagen transaktion. Ska anges i ERR om det finns i mottagen transaktion och felet ej inträffade tidigare och omöjliggjorde att ange nätområdes-id i kvittensen. [U s.66] |
| UF-error-260c-67 / 260c | error | Nätområde – inmatning | ERR=D | SG5/LOC+233/C517/3225 | Nätområdesid för inmatning, samma som i mottagen transaktion. Ska anges i ERR om det finns i mottagen transaktion och felet ej inträffade tidigare och omöjliggjorde att ange nätområdes-id i kvittensen. [U s.67] |
| UF-error-262-67 / 262 | error | Balansansvarig | ERR=D | SG5/NAD+DDK//C082/303 9 | Samma som i mottagen transaktion. Ska anges i ERR om det finns i mottagen transaktion och felet ej inträffade tidigare och omöjliggjorde att ange balansansvarig i kvittensen. [U s.67] |
| UF-error-510-67 / 510 | error | Leverantör | ERR=D | SG5/NAD+DDQ//C082/303 9 | Samma som i mottagen transaktion. Ska anges i ERR om det finns i mottagen transaktion och felet ej inträffade tidigare och omöjliggjorde att ange leverantören i kvittensen. [U s.67] |
| UF-error-524-67 / 524 | error | Köpare | ERR=D | SG5/NAD+BY//C082/3039 | Samma som i mottagen transaktion. Ska anges i ERR om det finns i mottagen transaktion och felet ej inträffade tidigare och omöjliggjorde att ange köparen i kvittensen. [U s.67] |
| UF-error-525-67 / 525 | error | Säljare | ERR=D | SG5/NAD+SE//C082/3039 | Samma som i mottagen transaktion. Ska anges i ERR om det finns i mottagen transaktion och felet ej inträffade tidigare och omöjliggjorde att ange säljaren i kvittensen. [U s.67] |
| UF-error-526-67 / 526 | error | Systemansvarig | ERR=D | SG5/NAD+EZ//C082/3039 | Samma som i mottagen transaktion. Ska anges i ERR om det finns i mottagen transaktion och felet ej inträffade tidigare och omöjliggjorde att ange systemansvarig i kvittensen. [U s.67] |
| UF-error-511-67 / 511 | error | Tidsserieprodukt | ERR=D | SG5/PIA+1/C212/7140 (x5) | Samma som i mottagen transaktion. Ska anges i ERR om det finns i mottagen transaktion och felet ej inträffade tidigare och omöjliggjorde att ange tidsserieprodukten i kvittensen. [U s.67] |
| UF-error-245-67 / 245 | error | Leveransperiod | ERR=D | SG5/DTM+324/C507/2380 | Samma som i mottagen transaktion. Ska anges i ERR om det finns i mottagen transaktion och felet ej inträffade tidigare och omöjliggjorde att ange leveransperioden i kvittensen. [U s.67] |
| UF-error-223-67 / 223 | error | Anledning till transaktionen | ERR=D | SG5/STS+7/C556/9013 | Samma som i mottaget meddelande. Ska anges i ERR om det finns i mottagen transaktion och felet ej inträffade tidigare och omöjliggjorde att ange anledning till transaktionen i kvittensen. [U s.67] |
| UF-error-528-67 / 528 | error | Svarskod | ERR=R | SG5/STS+E01/C555/4405 | Alltid kod 41 (avvisad) [U s.67] |
| UF-error-531-67 / 531 | error | Avvisningsorsak | ERR=R | SG5/STS+E01/C556/9013 | Avvisningsorsak [U s.67] |
| UF-error-503-67 / 503 | error | Referens till meddelandetyp | ERR=R | SG6/RFF/1153 | Referens till UTILTS-meddelandetyp, tas från BGM/C106/1001 i mottaget meddelande [U s.67] |
| UF-error-504-68 / 504 | error | Referens till meddelandeid | ERR=R | SG6/RFF/1154 | Referens till urspr. UTILTS meddelandeid (från UTILTS BGM/C106/1004). [U s.68] |
| UF-error-529-68 / 529 | error | Referens till transaktionsnr | ERR=R | SG6/RFF+TN/1154 | Referens till transaktionsnr i mottagen transaktion från IDE/C206/7402 [U s.68] |

## C2. Kodkontroller enligt bilaga 1
Nationell kodkontroll är inte samma sak som syntaxkontroll. Om möjligt-referenser och ignorera-regeln för PRODAT-ärendereferens får inte tas bort.
| ID/locator | Fältreferens | Namn | Tillåtna värden/villkor | Notering/källa |
| --- | --- | --- | --- | --- |
| UG-121-2 / UNB/0026 | 311 | Application Reference | Giltiga koder för Application Reference, se ovan 3.7. För mer information se Ediels generella tekniska anvisning. |  U bilaga 1 s.121 |
| UG-121-3 / UNH/S009/0065 | - |  | UTILTS |  U bilaga 1 s.121 |
| UG-121-4 / UNH/S009/0052 | - |  | D |  U bilaga 1 s.121 |
| UG-121-5 / UNH/S009/0054 | - |  | 02B |  U bilaga 1 s.121 |
| UG-121-6 / UNH/S009/0051 | - |  | UN |  U bilaga 1 s.121 |
| UG-121-7 / UNH/S009/0057 | 312 | Version | E5SE5A | Aktuell samt föregående version (under en U bilaga 1 s.121 |
| UG-122-4 / BGM/C002/1001 | 202 | Dokumentnamn, kod | E30, E31, E66, E72, E73, E74, S01, S02, S03, S04, S05, S06, S07, ERR |  U bilaga 1 s.122 |
| UG-122-5 / BGM/C002/1131 | 202 |  | SVK om 1001=S01–S07 |  U bilaga 1 s.122 |
| UG-122-6 / BGM/C002/3055 | 202 |  | 260 |  U bilaga 1 s.122 |
| UG-122-7 / BGM/C106/1004 | 203 | Dokument id | Ej blankt Kontrollera att dokument id är unikt över tid | Felkod 42 används om dokument id ej är unikt över tid. U bilaga 1 s.122 |
| UG-122-8 / BGM/1225 | 204 | Meddelandefunktion | 5, 9 |  U bilaga 1 s.122 |
| UG-122-9 / BGM/4343 | 313 | Kvittensbegäran | AB, NA |  U bilaga 1 s.122 |
| UG-122-11 / DTM+137/C507/2005 | 205 (om möjligt) |  | 137 |  U bilaga 1 s.122 |
| UG-122-12 / DTM+137/C507/2380 | 205 | Meddelandedatum | Datum enligt format 203 (CCYYMMDDHHmm) Ej framtida datum |  U bilaga 1 s.122 |
| UG-122-13 / DTM+137/C507/2379 | 205 |  | 203 |  U bilaga 1 s.122 |
| UG-122-15 / DTM+735/C507/2005 | 206 (om möjligt) |  | 735 |  U bilaga 1 s.122 |
| UG-122-16 / DTM+735/C507/2380 | 206 | Tidzon | +0100 | +0100 gäller endast samma tidzon som Sverige, i meddelanden från andra länder kan annan tidzon (offset till UTC) förekomma. U bilaga 1 s.122 |
| UG-122-17 / DTM+735/C507/2379 | 206 |  | 406 |  U bilaga 1 s.122 |
| UG-122-19 / MKS/7293 | 501 | Marknad | 23, 27 |  U bilaga 1 s.122 |
| UG-122-20 / MKS/C332/3496 | 502 | Skede | E02, E03, E04 |  U bilaga 1 s.122 |
| UG-122-21 / MKS/C332/3055 | 502 |  | 260 |  U bilaga 1 s.122 |
| UG-122-23 / SG2/NAD/3035 | 207 eller 208 (om möjligt) |  | MS, MR |  U bilaga 1 s.122 |
| UG-122-24 / SG2/NAD/C082/3039 | 207 eller 208 | Avsändare eller Mottagare | Om 1131=SVK: Kontrollera femsiffrigt (Ediel-id) Om 3055=9 eller 305: kontrollera checksiffra. | * Algoritm för kontroll av GS1-checksiffra, se längst ner i bilagan. U bilaga 1 s.122 |
| UG-123-2 / SG2/NAD/C082/1131 | 207 eller 208 |  | SVK om 3055=260 |  U bilaga 1 s.123 |
| UG-123-3 / SG2/NAD/C082/3055 | 207 eller 208 |  | 260, 9, 305 |  U bilaga 1 s.123 |
| UG-123-5 / SG2/NAD/3035 | 509 | Underordnad roll | DDK, DDQ, DDX, DEA, DEC, DER, DGG, DGI, EZ, MDR, PQ | DGG används i utbyten med leverantör av balanstjänster och koden behöver endast kontrolleras om man har sådan trafik. U bilaga 1 s.123 |
| UG-123-7 / SG5/IDE/7495 | 505 |  | 24 |  U bilaga 1 s.123 |
| UG-123-8 / SG5/IDE+24/C206/7402 | 505 | Transaktionsnr | Ej blankt Kontrollera att transaktionsnr är unikt över tid | Felkod 42 används om transaktionsnr ej är unikt över tid. U bilaga 1 s.123 |
| UG-123-10 / SG5/LOC+172/3227 | 209 (om möjligt) |  | 172 |  U bilaga 1 s.123 |
| UG-123-11 / SG5/LOC+172/C517/3225 | 209 | Anläggningsid | Ej blankt Om GS1-nr kontrollera GS1-checksiffra | * Algoritm för kontroll av GS1-checksiffra, se längst ner i bilagan. U bilaga 1 s.123 |
| UG-123-12 / SG5/LOC+172/C517/3055 | 209 |  | 9, 89 |  U bilaga 1 s.123 |
| UG-123-14 / SG5/LOC+175/3227 | 533 (om möjligt) |  | 175 |  U bilaga 1 s.123 |
| UG-123-15 / SG5/LOC+175/C517/3225 | 533 | Reglerobjektsid | Ej blankt Om GS1-nr kontrollera GS1-checksiffra | * Algoritm för kontroll av GS1-checksiffra, se längst ner i bilagan. U bilaga 1 s.123 |
| UG-123-16 / SG5/LOC+175/C517/3055 | 533 |  | 9, 89 |  U bilaga 1 s.123 |
| UG-123-18 / SG5/LOC+232,233,239/3227 | 260a, 260b, 260c (om möjligt) |  | 232, 233, 239 |  U bilaga 1 s.123 |
| UG-123-19 / SG5/LOC+232,233,239/C517/3225 | 260a, 260b, 260c | Nätområdesid, Nätområde – utmatning, Nätområde – inmatning | Ej blankt, alltid tre tecken |  U bilaga 1 s.123 |
| UG-123-20 / SG5/LOC+232,233,239/C517/1131 | 260a, 260b, 260c |  | SVK |  U bilaga 1 s.123 |
| UG-123-21 / SG5/LOC+232,233,239/C517/3055 | 260a, 260b, 260c |  | 260 |  U bilaga 1 s.123 |
| UG-124-2 / SG5/NAD/3035 | 262, 510, 524, 525, 526 (om möjligt) |  | DDK, DDQ, BY, SE, EZ |  U bilaga 1 s.124 |
| UG-124-3 / SG5/NAD/C082/3039 | 262, 510, 524, 525, 526 | Balansansvarig, Leverantör, Köpare, Säljare, Systemansvarig | Kontrollera femsiffrigt (Ediel-id) |  U bilaga 1 s.124 |
| UG-124-4 / SG5/NAD/C082/1131 | 262, 510, 524, 525, 526 |  | SVK |  U bilaga 1 s.124 |
| UG-124-5 / SG5/NAD/C082/3055 | 262, 510, 524, 525, 526 |  | 260 |  U bilaga 1 s.124 |
| UG-124-7 / SG5/LIN/C212/7140 | 506 | Produkt id | 8716867000016 (power active) 8716867000023 (power reactive) 8716867000030 (energy active) 8716867000047 (energy reactive) 8716867000054 (connection capacity) 8716867000061 (connection use) 8716867000078 (transport capacity) 8716867000085 (transport use) 8716867000139 (energy reactive capacitive) 8716867000146 (energy reactive inductive) 5410000100016 (natural gas) 7331507000013 (tid) 7331507000020 (belopp) 7331507000051 (frekvens) |  U bilaga 1 s.124 |
| UG-124-8 / SG5/LIN/C212/3055 | 506 |  | 9 |  U bilaga 1 s.124 |
| UG-124-10 / SG5/PIA/4347 | 511 |  | 1 |  U bilaga 1 s.124 |
| UG-124-11 / SG5/PIA/C212/7140 | 511a, 511b, 511c, 511d, 511e | Tidsserieprodukt | Ej blankt |  U bilaga 1 s.124 |
| UG-124-12 / SG5/PIS/C212/7143 | 511a, 511b, 511c, 511d, 511e |  | PC, PT, OT, LOD, BAP |  U bilaga 1 s.124 |
| UG-124-13 / SG5/PIA/C212/1131 | 511a, 511b, 511c, 511d, 511e |  | SVK |  U bilaga 1 s.124 |
| UG-125-2 / SG5/PIA/C212/3055 | 511a, 511b, 511c, 511d, 511e |  | 260 |  U bilaga 1 s.125 |
| UG-125-4 / SG5/DTM+324/C507/2005 | 245 (om möjligt) |  | 324 |  U bilaga 1 s.125 |
| UG-125-5 / SG5/DTM+324/C507/2380 | 245 | Leveransperiod | Datum enligt format 719 (CCYYMMDDHHmmCCYYMMDDHHmm) Om meddelandetyp = E30, E31, E66, S01, S05 eller S07 kontrollera att ej framtida datum, för preliminära andelstal (S03, S04) och förbrukningsprognos (S02) är det tillåtet med framtida datum. |  U bilaga 1 s.125 |
| UG-125-6 / SG5/DTM+324/C507/2379 | 245 |  | 719 |  U bilaga 1 s.125 |
| UG-125-8 / SG5/DTM+354/C507/2005 | 508 (om möjligt) |  | 354 |  U bilaga 1 s.125 |
| UG-125-9 / SG5/DTM+354/C507/2380 | 508 | Upplösning | 1 om 2379 = 801, 802, 804 1519, 60 om 2379 = 806 | 2379 = 801 och 804 är endast tillåtna efter överenskommelse. 60 för 2379 = 806 är för värden efter den 1 novem- ber 2023 endast tillåtet efter överenskommelse. U bilaga 1 s.125 |
| UG-125-10 / SG5/DTM+354/C507/2379 | 508 |  | 801, 802, 804, 806 |  U bilaga 1 s.125 |
| UG-125-12 / SG5/DTM+597/C507/2005 | 512 (om möjligt) |  | 597 |  U bilaga 1 s.125 |
| UG-125-13 / SG5/DTM+597/C507/2380 | 512 | Registreringstidpunkt | Datum enligt format 203 (CCYYMMDDHHmm) Kontrollera att ej framtida datum |  U bilaga 1 s.125 |
| UG-125-14 / SG5/DTM+597/C507/2379 | 512 |  | 203 |  U bilaga 1 s.125 |
| UG-125-16 / SG5/DTM+368/C507/2005 | 532 (om möjligt) |  | 368 |  U bilaga 1 s.125 |
| UG-125-17 / SG5/DTM+368/C507/2380 | 532 | Senaste uppdateringstidpunkt | Datum enligt format 203 (CCYYMMDDHHmm) Kontrollera att ej framtida datum |  U bilaga 1 s.125 |
| UG-125-18 / SG5/DTM+368/C507/2379 | 532 |  | 203 |  U bilaga 1 s.125 |
| UG-125-20 / SG5/STS+7/C601/9015 | 223 (om möjligt) |  | 7 |  U bilaga 1 s.125 |
| UG-126-2 / SG5/STS+7/C556/9013 | 223 | Anledning till transaktionen | E03, E20, E23, E24, E25, E43, E44, E64, E67, E77, E88, Z01 |  U bilaga 1 s.126 |
| UG-126-3 / SG5/STS+7/C556/1131 | 223 |  | SVK om 9013=Z01 |  U bilaga 1 s.126 |
| UG-126-4 / SG5/STS+7/C556/3055 | 223 |  | 260 |  U bilaga 1 s.126 |
| UG-126-6 / SG5/STS+E01/C601/9015 | 528 (om möjligt) |  | E01 |  U bilaga 1 s.126 |
| UG-126-7 / SG5/STS+E01/C601/3055 | 528 |  | 260 |  U bilaga 1 s.126 |
| UG-126-8 / SG5/STS+E01/C555/4405 | 528 | Svarskod | 41 |  U bilaga 1 s.126 |
| UG-126-10 / SG5/STS+E01/C556/9013 | 531 | Avvisningsorsak | E10, E14, E16, E18, E29, E47, E49, E50, E51, E55, E61, E62, E73, E87, E90, E97, E98 |  U bilaga 1 s.126 |
| UG-126-11 / SG5/STS+E01/C556/3055 | 531 |  | 260 |  U bilaga 1 s.126 |
| UG-126-13 / SG5/MEA/6311 | 264 |  | AAZ |  U bilaga 1 s.126 |
| UG-126-14 / SG5/MEA/C174/6411 | 264 | Enhet | KWH, KVR, KVA, KWT, MAW, 3B, GWH, K3, MWH, E08, MQH, MTQ, E46, D90, P1, HTZ |  U bilaga 1 s.126 |
| UG-126-16 / SG6/RFF/C506/1153 | 503 | Referens till meddelandetyp | E30, E31, E66, E72, E73, E74, S01, S02, S03, S04, S05, S06, S07 |  U bilaga 1 s.126 |
| UG-126-17 / SG6/RFF/C506/1154 | 504 | Referens till meddelandeid | Om BGM/C002/1001=ERR: Ej blankt |  U bilaga 1 s.126 |
| UG-126-19 / SG6/RFF/C506/1153 | 529 |  | TN |  U bilaga 1 s.126 |
| UG-126-20 / SG6/RFF/C506/1154 | 529 | Referens till transaktionsnr | Ej blankt |  U bilaga 1 s.126 |
| UG-126-22 / SG6/RFF/C506/1153 | 226 |  | Fältet ska innehålla TN, men ingen avvisning sker av transaktionen om koden är felaktig. |  U bilaga 1 s.126 |
| UG-126-23 / SG6/RFF/C506/1154 | 226 | Referens till PRODAT- ärendereferens | Inga kontroller görs av fältet, se kapitel 3.6.12. |  U bilaga 1 s.126 |
| UG-126-25 / SG7/CCI/C240/7037 | 507a (om möjligt) |  | E02, E12, Z01 |  U bilaga 1 s.126 |
| UG-126-26 / SG7/CCI/C240/1131 | 507a |  | SVK om 7037=Z01 |  U bilaga 1 s.126 |
| UG-126-27 / SG7/CCI/C240/3055 | 507a (om möjligt) |  | 260 |  U bilaga 1 s.126 |
| UG-127-3 / SG7/CAV/C889/7111 | 254 513 | Avräkningsmetod Typ av anläggning(ar) | E01, E02 om CCI/C240/7037 = E02 E17, E18, E19, E20 om CCI/C240/7037 = E12 |  U bilaga 1 s.127 |
| UG-127-4 / SG7/CAV/C889/3055 | 254 eller 513 |  | 260 om CCI/C240/7037 = E02 eller E12 |  U bilaga 1 s.127 |
| UG-127-5 / SG7/CAV/C889/7110 | 507a | Antal mätpunkter | Heltal >= 0 om CCI/C240/7037 = Z01 |  U bilaga 1 s.127 |
| UG-127-7 / SG8/SEQ/C286/1050 | 514 | Observationsnr | Ej blankt |  U bilaga 1 s.127 |
| UG-127-9 / SG8/RFF/C506/1153 | 224 (om möjligt) |  | MG, SE |  U bilaga 1 s.127 |
| UG-127-10 / SG8/RFF/C506/1154 | 224 | Mätarnummer | Om 1153=SE, mätarnummer ska vara GS1-nr, kontrollera checksiffra. Om 1153=MG, ingen kontroll görs av (ev.) checksiffra. | * Algoritm för kontroll av checksiffra, se längst ner i bilagan. U bilaga 1 s.127 |
| UG-127-12 / SG8/RFF/C506/1153 | 527 (om möjligt) |  | AES |  U bilaga 1 s.127 |
| UG-127-13 / SG8/RFF/C506/1154 | 527 | RegisterId | Ej blankt Den angivna koden kontrolleras mot ”master data” (strukturinformation), den kontrollen görs i Funktionskontrollen, se nedan. |  U bilaga 1 s.127 |
| UG-127-15 / SG8/MOA/C516/5025 | 522 |  | 9 |  U bilaga 1 s.127 |
| UG-127-16 / SG8/MOA/C516/5004 | 522 | Belopp | Numeriskt |  U bilaga 1 s.127 |
| UG-127-17 / SG8/MOA/C516/6345 | 269a | Valuta | Tre bokstäver (A-Z) |  U bilaga 1 s.127 |
| UG-127-19 / SG10/PRI/C509/5125 | 523 |  | CAL |  U bilaga 1 s.127 |
| UG-127-20 / SG10/PRI/C509/5118 | 523 | Pris | Numeriskt |  U bilaga 1 s.127 |
| UG-127-21 / SG10/CUX/C504/6347 | 269b |  | 2 |  U bilaga 1 s.127 |
| UG-127-22 / SG10/CUX/C504/6345 | 269b | Valuta | Tre bokstäver (A-Z) |  U bilaga 1 s.127 |
| UG-127-24 / SG11/QTY/C186/6063 | 516, 515, 517, eller 521 (om möjligt) |  | 135, 136, 220, 42, 194, 195 |  U bilaga 1 s.127 |
| UG-127-25 / SG11/QTY/C186/6060 | 516, 515, 517, eller 521 | Uppnådd periodisk kvantitet, Planerad | Numeriskt eller ”NULL” |  U bilaga 1 s.127 |
| UG-128-4 / SG11/DTM/C507/2005 | 530a, 530b |  | 597 |  U bilaga 1 s.128 |
| UG-128-5 / SG11/DTM/C507/2380 | 530a, 530b | Datum för mätarställning, Tidpunkt för effektvärde | Datum enligt format 203 (CCYYMMDDHHmm) Kontrollera att ej framtida datum |  U bilaga 1 s.128 |
| UG-128-6 / SG11/DTM/C507/2379 | 530a, 530b |  | 203 |  U bilaga 1 s.128 |
| UG-128-8 / SG11/STS/C601/9015 | 520 (om möjligt) |  | 8 |  U bilaga 1 s.128 |
| UG-128-9 / SG11/STS/C555/4405 | 520 | Kvantitetskvalitet | 21, 46, 56, 113, 125 |  U bilaga 1 s.128 |
| UG-128-11 / SG12/CCI/C240/7037 | 259 (om möjligt) |  | E07 |  U bilaga 1 s.128 |
| UG-128-12 / SG12/CCI/C240/3055 | 259 |  | 260 |  U bilaga 1 s.128 |
| UG-128-14 / SG12/CAV/C889/7111 | 259 | Tidsintervall | E12 |  U bilaga 1 s.128 |
| UG-128-15 / SG12/CAV/C889/3055 | 259 |  | 260 |  U bilaga 1 s.128 |
| UG-128-17 / SG12/CCI/C240/7037 | 309 (om möjligt) |  | E22 |  U bilaga 1 s.128 |
| UG-128-18 / SG12/CCI/C240/3055 | 309 |  | 260 |  U bilaga 1 s.128 |
| UG-128-20 / SG12/CAV/C889/7111 | 309 | Mätaravläsare | E26, E27, E28 |  U bilaga 1 s.128 |
| UG-128-21 / SG12/CAV/C889/3055 | 309 |  | 260 |  U bilaga 1 s.128 |
| UG-128-23 / SG12/CCI/C240/7037 | 507b (om möjligt) |  | Z01 |  U bilaga 1 s.128 |
| UG-128-24 / SG12/CCI/C240/1131 | 507b |  | SVK om 7037=Z01 |  U bilaga 1 s.128 |
| UG-128-25 / SG12/CCI/C240/3055 | 507b |  | 260 |  U bilaga 1 s.128 |
| UG-128-27 / SG12/CAV/C889/7110 | 507b | Avvikande antal mätpunkter | Heltal >=0 |  U bilaga 1 s.128 |

## C3. Regelkomposition
Använd den tillämpliga meddelande-/skede-/rollprofilen, välj rätt source-rad och tillämpa dess parent- och villkor. En tom cell i extraktionen får inte tolkas som ett nytt R-krav. “R(se not)” kräver noteringen. Tidsserieproduktens olika komponenter avgör vissa parter, områden och observationstyper; produktlistan måste därför vara en versionsstyrd typad katalog, inte bara tillåtnaL-strängar.

Full segmentgrammatik, nationell elementanvändning och funktionskontroll ska vara skilda moduler. En rå källtabell ska inte direkt laddas som en exekverbar valideringsmotor utan kontroll av gruppgränser, valda kolumner, villkor och felkodsmappning. `source_tables.json` bevarar de ursprungliga cellpositionerna för den granskningen.
