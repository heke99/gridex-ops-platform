# Flytt till Mac: vad som faktiskt behöver kontrolleras

**Codex på Mac kan vara arbetsplatsen, men den nuvarande köraren är skriven för Linux och kan inte köras oförändrad i macOS-terminalen.** Börja med det separata läsande skriptet `local-preflight.sh`. Den här granskningen har inte startat Docker, byggt något, kopierat databaser eller överfört privata filer.

Root har kontrollerat den officiella beskrivningen av **Work in → This computer**: valet avser en lokal Codex-uppgift. Det överför inte automatiskt filer eller processer från den befintliga molnmiljön. Det finns heller ingen verifierad lokal Mac-terminalanslutning i den här sessionen. Preflight måste därför köras i den lokala uppgiftens terminal på den avsedda Macen.

## Konkreta skillnader i den befintliga koden

| Befintligt antagande | Konsekvens vid en lokal flytt |
| --- | --- |
| Processidentitet och portägande läses ur `/proc/PID/stat`, `/proc/PID/cmdline` och `/proc/net/tcp*`. PID, Linux-starttid och UID jämförs med en tidigare fysisk observation. | macOS har inte dessa Linux-gränssnitt. En Linux-container ser dessutom inte automatiskt den processrymd som Docker-daemonens andra processer använder. Gamla PID- eller starttidsvärden får inte återanvändas. |
| Minnesvakten läser cgroup-v2-filerna `memory.max`, `memory.current` och `memory.stat` under `/sys/fs/cgroup`. | Macens totala RAM är inte samma sak som den Linux-miljöns tilldelade minne. Docker Desktop har en separat Linux-VM och egna resursgränser. Den befintliga vaktens gränser behöver mätas där köraren faktiskt ska arbeta. |
| Docker anropas med exakt `/usr/local/bin/docker --host=unix:///var/run/docker.sock`. | En vanlig `docker info` i vald lokal Docker-context kan avse en annan daemon. Docker Desktop kan använda en socket under användarens hemkatalog. Kontrollera CLI, faktisk socket, context och daemon tillsammans; den hårdkodade köraren väljer inte automatiskt den lokala contexten. |
| Topologins kvalificerade operatör har UID `1000`; flera filvakter bevarar UID/GID och gör läsningar av samma användares processer. | En Mac-användare kan ha exempelvis UID `501`. Att köra med `sudo` ger inte motsvarande bevis och ändrar ägar- och processförutsättningarna. Eventuell Linux-användare och Docker-åtkomst måste bindas uttryckligen. |
| Egna REST- och Storage-containrar delar nätverksrymd; Linux-köraren kontaktar containerns interna IP direkt. | Docker Desktop placerar containernätet inne i Linux-VM:n. Mac-värden kan normalt inte använda samma interna container-IP som den nuvarande Linux-värden. `127.0.0.1` betyder också olika värdar i olika nätverksrymder. Nuvarande loopbackportar, TLS-certifikat och nätverksägande måste fungera tillsammans i den valda miljön. |
| `/workspace`, `/tmp`, nodbinären, beroenden och monteringskällor är absoluta, hashbundna sökvägar. Filvakter kontrollerar verklig sökväg, symlänkar, läge och ibland inode/länkantal/tidsstämplar. | De kan inte flyttas genom enbart sök-och-ersätt. macOS använder normalt `/private/tmp` bakom `/tmp`; en sådan aliasväg kan bryta kravet `realpath === path`. Delade Mac-kataloger har också andra filsystemsegenskaper än den kvalificerade Linux-volymen. |

## Intel och Apple Silicon

Den faktiskt sparade Storage-imageinspektionen anger **`Os: linux`, `Architecture: amd64`**, image-ID `sha256:da6409e5fd135ab8895f0c344f82066d99c107ca1031ed4a1ab1d33f0b775572`. Den valda Node-binärens filhuvud är **ELF64, maskintyp 62: Linux x86-64**. Den kördes inte under granskningen. Inte heller en Intel-Mac kan köra denna ELF-binär direkt som ett macOS-program.

På Apple Silicon är en `linux/arm64`-image en annan kvalificeringsbas än den låsta `linux/amd64`-imagen, även om taggnamnet liknar det gamla. AMD64-emulering kan vara möjlig i en lämplig Linux-miljö, men dess funktion, minnesbehov och tider är inte verifierade här. Den får inte antas klara de nuvarande tidsfönstren. Kopiera inte Linux `node_modules` till en ny Mac-installation och anta att eventuella inbyggda moduler passar den nya plattformen.

## Minsta rimliga nästa steg

1. Kör endast `local-preflight.sh` lokalt och granska arkitektur, fritt diskutrymme, RAM, tillgänglig Docker-CLI samt vald contexts säkra daemonfält. Skriptet ska inte installera, starta, hämta images eller ändra inställningar. Saknad eller avstängd Docker är ett preflight-resultat.
2. Välj därefter en **avgränsad Linux-exekveringsmiljö på Macen** med kontrollerad disk, minne, användare och nätverk. Valet av native ARM64 eller AMD64/emulering måste göras utifrån preflight-resultatet. Docker Desktop ensamt gör inte macOS-terminalen kompatibel med Linux-köraren.
3. Kontrollera först att köraren där kan se rätt Docker-daemon, rätt process- och nätverksrymd samt en Linux-volym med de filsemantiker som bevisen kräver. Den befintliga källan behöver små granskade miljöbindningar och färska verkliga identiteter; gamla körningar och deras bevis förblir historiska.
4. Bestäm separat vad som över huvud taget behöver föras över. Källkod, historiska rapporter, databaser, inloggningsuppgifter och servernycklar är olika material. Den här preflighten väljer eller överför inget av dem. Gamla användarsessioner eller servernycklar ger inte automatiskt giltig lokal behörighet.

**Starta inte en privilegierad Docker-in-Docker-container och ändra inte global lagringsdrivrutin eller Docker-context som genväg.** Inga sådana åtgärder behövs för den läsande preflighten. Tillgänglig arbetsdisk på Macen bevisar inte heller ledigt utrymme i Docker-VM:ns disk; containerlager, skrivbara lager, databas, arkiv och temporära filer måste rymmas samtidigt. Resursbesparing eller förbättrad körtid är ännu inte uppmätt.

## Underlag och gräns för granskningen

Granskningen läste befintliga lokala källor och sparad inspektion, utan nya Docker- eller nätverksanrop:

- `/tmp/gridex-ediel-four-case-prep-20261116-b/normal-auth-topology.four-case.ad.py`: fast Docker-socket, UID och `/proc`-identitet.
- `/tmp/gridex-ediel-four-case-prep-20261116-b/owned-four-runtime.v2.py`: fasta sökvägar, databas-/nätverksbindning och containergränser.
- `/tmp/gridex-ediel-four-case-prep-20261116-b/four-rest-bridge.py` och `four-mail-transports.py`: interna container-IP-adresser, loopback och fysisk processidentitet.
- `/tmp/gridex-ediel-owned-storage-integration-prep-20261116-a/owned_storage.py`: `--network container:<egen REST>`, bind mount och direkt åtkomst till REST-containerns IP.
- `/workspace/gridex-cgroup-available-memory-prep-20261116/available-memory.py`: Linux cgroup-v2.
- `/tmp/gridex-ediel-four-case-actual-20261116-a/proper-closure/storage-image-inspect.process.private.json`: sparad faktisk Linux/AMD64-imageinspektion.
- `/tmp/gridex-lean-actual-qualification-20261113/node22.selected`: läsning av de första 64 filbyten, utan programstart.

Ingen lokal Mac-kompatibilitet, image-tillgänglighet, fungerande VM-montering eller ursprunglig scenariopassning har verifierats av denna källgranskning. Nästa konkreta beslut är att läsa preflight-resultatet innan en lokal exekveringsmiljö väljs.
